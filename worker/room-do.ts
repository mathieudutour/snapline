/**
 * Durable Object hosting one live project room. Uses the WebSocket hibernation API so an idle
 * room costs nothing: peers are rebuilt from socket attachments, the project from DO storage.
 */
import { DurableObject } from 'cloudflare:workers'
import { RoomCore, type RoomPersistence, type RoomState, type RoomTransport } from './room'
import type { Peer, ServerMessage } from '../src/model/collab'
import type { Project } from '../src/model/project'

interface RoomEnv {
  DB: D1Database
}

const STATE_KEY = 'room-state'

export class ProjectRoom extends DurableObject<RoomEnv> {
  private core: RoomCore<WebSocket> | null = null
  private projectId = ''

  constructor(ctx: DurableObjectState, env: RoomEnv) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get<{ projectId: string; state: RoomState }>(STATE_KEY)
      if (saved) {
        this.projectId = saved.projectId
        this.core = this.makeCore(saved.projectId)
        this.core.restore(saved.state)
      }
    })
  }

  private makeCore(projectId: string): RoomCore<WebSocket> {
    const transport: RoomTransport<WebSocket> = {
      peers: () =>
        this.ctx
          .getWebSockets()
          .map((ws) => ({ conn: ws, peer: ws.deserializeAttachment() as Peer | null }))
          .filter((p): p is { conn: WebSocket; peer: Peer } => !!p.peer),
      send: (ws, msg: ServerMessage) => {
        try {
          ws.send(JSON.stringify(msg))
        } catch {
          // closed socket: it is dropped at the next getWebSockets()
        }
      },
      scheduleFlush: (ms) => void this.ctx.storage.setAlarm(Date.now() + ms),
    }
    const persistence: RoomPersistence = {
      load: async (id) => {
        const row = await this.env.DB.prepare('SELECT data, version FROM projects WHERE id = ?').bind(id).first<{ data: string; version: number }>()
        return row ? { project: JSON.parse(row.data) as Project, version: row.version ?? 1 } : null
      },
      save: async (id, project, updatedBy) => {
        const updatedAt = Date.now()
        const name = project.name?.trim() ? project.name : 'Untitled project'
        const row = await this.env.DB.prepare('UPDATE projects SET name = ?, data = ?, updated_at = ?, version = version + 1, updated_by = ? WHERE id = ? RETURNING version')
          .bind(name, JSON.stringify({ ...project, id, updatedAt }), updatedAt, updatedBy, id)
          .first<{ version: number }>()
        if (!row) throw new Error('project gone')
        return { version: row.version, updatedAt }
      },
    }
    return new RoomCore<WebSocket>(projectId, transport, persistence)
  }

  private async persistState() {
    if (this.core?.state) await this.ctx.storage.put(STATE_KEY, { projectId: this.projectId, state: this.core.state })
  }

  /** WebSocket upgrade from the Worker, which already checked the session and the project access */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 })
    const projectId = request.headers.get('X-Project-Id') ?? ''
    if (!this.core || this.projectId !== projectId) {
      this.projectId = projectId
      this.core = this.makeCore(projectId)
    }
    const peer: Peer = {
      id: crypto.randomUUID().slice(0, 8),
      userId: request.headers.get('X-User-Id') ?? '',
      name: decodeURIComponent(request.headers.get('X-User-Name') ?? ''),
      email: request.headers.get('X-User-Email') ?? '',
      role: request.headers.get('X-Role') === 'viewer' ? 'viewer' : 'editor',
      color: this.core.colorFor(this.ctx.getWebSockets().map((ws) => ws.deserializeAttachment() as Peer)),
    }
    const pair = new WebSocketPair()
    const [client, server] = [pair[0], pair[1]]
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment(peer)
    const ok = await this.core.join(server, peer)
    if (!ok) {
      server.close(4004, 'project not found')
      return new Response('project not found', { status: 404 })
    }
    await this.persistState()
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const peer = ws.deserializeAttachment() as Peer | null
    if (!peer || !this.core || typeof message !== 'string') return
    await this.core.message(peer, message)
    if (message.startsWith('{"t":"ops"')) await this.persistState()
  }

  async webSocketClose(ws: WebSocket) {
    const peer = ws.deserializeAttachment() as Peer | null
    if (peer && this.core) this.core.leave(peer.id)
    await this.flushIfEmpty()
  }

  async webSocketError(ws: WebSocket) {
    const peer = ws.deserializeAttachment() as Peer | null
    if (peer && this.core) this.core.leave(peer.id)
    await this.flushIfEmpty()
  }

  /** the last peer left: write now and forget the project so the next visit starts from the database */
  private async flushIfEmpty() {
    if (this.ctx.getWebSockets().length > 0) return
    await this.core?.flush()
    await this.ctx.storage.deleteAlarm()
    await this.ctx.storage.delete(STATE_KEY)
    this.core = null
  }

  async alarm() {
    await this.core?.flush()
    await this.persistState()
  }

  /** RPC from the Worker: the project was saved through the REST API while the room was open */
  async externalSave(project: Project, version: number) {
    if (!this.core) return
    this.core.externalSave(project, version)
    await this.persistState()
  }
}
