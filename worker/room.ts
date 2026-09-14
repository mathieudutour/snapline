/**
 * Transport-agnostic core of a live project room: one per project, shared by every connected
 * editor. Keeps the authoritative project, applies and broadcasts operations, relays presence
 * and flushes to the database a little after the last edit.
 *
 * The Durable Object in room-do.ts drives it with hibernating WebSockets; the local dev server
 * drives it with plain sockets. Nothing here assumes connections survive in memory: peers are
 * listed through the transport on every call.
 */
import { applyOps, PEER_COLORS, type ClientMessage, type Op, type Peer, type Presence, type ServerMessage } from '../src/model/collab'
import type { Project } from '../src/model/project'

export interface RoomState {
  project: Project
  version: number
  /** unsaved operations were applied since the last flush */
  dirty: boolean
  /** user id of the last editor, recorded as updated_by on flush */
  lastEditor: string
  presence: Record<string, Presence>
}

export interface RoomTransport<C> {
  /** every live connection with the peer it belongs to */
  peers(): { conn: C; peer: Peer }[]
  send(conn: C, msg: ServerMessage): void
  /** ask for `flush()` to be called after `ms` (replaces any pending request) */
  scheduleFlush(ms: number): void
}

export interface RoomPersistence {
  /** current stored copy, or null when the project does not exist (anymore) */
  load(projectId: string): Promise<{ project: Project; version: number } | null>
  /** write the room's copy; returns the new version */
  save(projectId: string, project: Project, updatedBy: string): Promise<{ version: number; updatedAt: number }>
}

export const FLUSH_DELAY_MS = 2000

export class RoomCore<C> {
  state: RoomState | null = null

  constructor(
    readonly projectId: string,
    private transport: RoomTransport<C>,
    private persistence: RoomPersistence,
  ) {}

  /** restore state captured by the host (e.g. Durable Object storage) */
  restore(state: RoomState) {
    this.state = state
  }

  private async ensureLoaded(): Promise<RoomState | null> {
    if (this.state) return this.state
    const stored = await this.persistence.load(this.projectId)
    if (!stored) return null
    this.state = { project: stored.project, version: stored.version, dirty: false, lastEditor: '', presence: {} }
    return this.state
  }

  /** pick a colour not used by the current peers */
  colorFor(peers: Peer[]): string {
    const used = new Set(peers.map((p) => p.color))
    return PEER_COLORS.find((c) => !used.has(c)) ?? PEER_COLORS[peers.length % PEER_COLORS.length]
  }

  /** a peer connected: send it the room's project and tell the others */
  async join(conn: C, peer: Peer): Promise<boolean> {
    const state = await this.ensureLoaded()
    if (!state) return false
    const others = this.transport.peers().filter((p) => p.peer.id !== peer.id)
    this.transport.send(conn, { t: 'welcome', you: peer.id, project: state.project, version: state.version, peers: others.map((p) => p.peer), presence: state.presence })
    for (const o of others) this.transport.send(o.conn, { t: 'join', peer })
    return true
  }

  leave(peerId: string) {
    if (this.state) delete this.state.presence[peerId]
    for (const p of this.transport.peers()) if (p.peer.id !== peerId) this.transport.send(p.conn, { t: 'leave', id: peerId })
  }

  async message(from: Peer, raw: string): Promise<void> {
    let msg: ClientMessage
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    const state = await this.ensureLoaded()
    if (!state) return
    if (msg.t === 'ops') {
      if (from.role === 'viewer') return // read-only peers can look but not touch
      if (!Array.isArray(msg.ops) || msg.ops.length === 0) return
      state.project = applyOps(state.project, msg.ops as Op[])
      state.dirty = true
      state.lastEditor = from.userId
      this.broadcast({ t: 'ops', from: from.id, ops: msg.ops }, from.id)
      this.transport.scheduleFlush(FLUSH_DELAY_MS)
    } else if (msg.t === 'presence') {
      state.presence[from.id] = msg.p
      this.broadcast({ t: 'presence', from: from.id, p: msg.p }, from.id)
    }
  }

  /** write the room's project to the database and tell everyone the new version */
  async flush(): Promise<void> {
    const state = this.state
    if (!state || !state.dirty) return
    state.dirty = false
    try {
      const { version, updatedAt } = await this.persistence.save(this.projectId, state.project, state.lastEditor)
      state.version = version
      this.broadcast({ t: 'saved', version, updatedAt })
    } catch {
      state.dirty = true
      this.transport.scheduleFlush(FLUSH_DELAY_MS * 5)
    }
  }

  /** the stored project was replaced outside the room (a REST save): adopt it and reset every peer */
  externalSave(project: Project, version: number) {
    if (!this.state) return
    this.state.project = project
    this.state.version = version
    this.state.dirty = false
    this.broadcast({ t: 'reset', project, version })
  }

  private broadcast(msg: ServerMessage, except?: string) {
    for (const p of this.transport.peers()) if (p.peer.id !== except) this.transport.send(p.conn, msg)
  }
}
