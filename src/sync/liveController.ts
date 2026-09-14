/**
 * Keeps the editor connected to the live room of the open project whenever it is shared,
 * turns local edits into operations for the room, and applies what the others send.
 */
import { isReadOnly, useEditor, type EditorState } from '../model/store'
import { diffProjects, type Op, type Presence, type ServerMessage } from '../model/collab'
import { normalizeProject } from '../model/project'
import { normalizePlan } from '../model/store'
import { LiveConnection } from './live'

const SEND_INTERVAL_MS = 80
const PRESENCE_INTERVAL_MS = 50

let conn: LiveConnection | null = null
/** the project as the room last saw it from us; edits are diffed against it */
let baseline: EditorState['project'] | null = null
let sendTimer: ReturnType<typeof setTimeout> | null = null
let presenceTimer: ReturnType<typeof setTimeout> | null = null
let cursor: { x: number; y: number } | null = null
/** operations that arrived during a drag: applied once the drag is committed and sent */
let pendingOps: Op[] = []
let lastPresence = ''
let started = false
/** connecting/disconnecting updates the store, which re-enters the subscription below */
let switching = false

/** a project takes part in live collaboration when it is shared with at least one other person (or viewed through a link) */
function eligible(s: EditorState): { id: string; url: string; key: string } | null {
  if (s.viewLink) return { id: s.project.id, url: `/api/view/${s.viewLink.token}/live`, key: `view:${s.viewLink.token}` }
  if (!s.user || s.apiAvailable === false) return null
  const meta = s.projects.find((p) => p.id === s.project.id)
  if (!meta) return null
  // the role is part of the identity: a viewer promoted to editor needs a fresh socket to be allowed to send
  if (meta.role === 'editor' || meta.role === 'viewer' || (meta.memberCount ?? 0) > 0) return { id: meta.id, url: `/api/projects/${meta.id}/live`, key: `${meta.id}:${meta.role ?? 'owner'}` }
  return null
}
/** identity of the current connection (project + role) */
let connKey: string | null = null

function disconnect() {
  switching = true
  try {
    conn?.close()
    conn = null
    connKey = null
    baseline = null
    pendingOps = []
    if (sendTimer) clearTimeout(sendTimer)
    sendTimer = null
    useEditor.getState().setLive({ status: 'off', you: null, peers: [], presence: {} })
  } finally {
    switching = false
  }
}

function connect(projectId: string, url: string, key: string) {
  disconnect()
  switching = true
  try {
    openConnection(projectId, url)
    connKey = key
  } finally {
    switching = false
  }
}

function openConnection(projectId: string, url: string) {
  const store = useEditor.getState()
  conn = new LiveConnection(projectId, url, {
    onStatus: (status) => {
      const s = useEditor.getState()
      if (status !== 'on') s.setLive({ status, peers: status === 'off' ? [] : s.live.peers, presence: status === 'off' ? {} : s.live.presence })
    },
    onMessage: (msg) => handle(projectId, msg),
  })
  store.setLive({ status: 'connecting' })
}

function handle(projectId: string, msg: ServerMessage) {
  const s = useEditor.getState()
  if (s.project.id !== projectId) return
  switch (msg.t) {
    case 'welcome': {
      const room = normalizeProject(msg.project, normalizePlan)
      const meta = s.projects.find((p) => p.id === projectId)
      s.setLive({ status: 'on', you: msg.you, peers: msg.peers, presence: msg.presence })
      if (meta?.dirty && meta.syncedVersion === msg.version) {
        // edits made while disconnected sit on top of the room's version: send them as operations
        baseline = room
        scheduleSend()
      } else if (meta?.dirty && meta.syncedVersion !== undefined && meta.syncedVersion !== msg.version && diffProjects(room, s.project).length > 0) {
        // both sides moved on: let the user decide (the conflict dialog saves through the REST API, which resets the room)
        baseline = s.project
        s.reportConflict({ projectId, name: s.project.name, local: s.project, remote: room, remoteVersion: msg.version, remoteUpdatedAt: room.updatedAt, updatedBy: null })
      } else {
        s.adoptRoomProject(room, msg.version)
        baseline = useEditor.getState().project
      }
      lastPresence = ''
      schedulePresence()
      break
    }
    case 'reset': {
      const room = normalizeProject(msg.project, normalizePlan)
      s.adoptRoomProject(room, msg.version)
      baseline = useEditor.getState().project
      break
    }
    case 'ops':
      if (s.dragSnapshot) pendingOps.push(...msg.ops)
      else applyRemote(msg.ops)
      break
    case 'presence':
      s.setLive({ presence: { ...s.live.presence, [msg.from]: msg.p } })
      break
    case 'join':
      s.setLive({ peers: [...s.live.peers.filter((p) => p.id !== msg.peer.id), msg.peer] })
      break
    case 'leave': {
      const presence = { ...s.live.presence }
      delete presence[msg.id]
      s.setLive({ peers: s.live.peers.filter((p) => p.id !== msg.id), presence })
      break
    }
    case 'saved':
      s.markSaved(projectId, msg.version, msg.updatedAt)
      break
  }
}

/** apply the others' operations; what they changed (and any re-solve it caused) becomes part of the baseline, never echoed back */
function applyRemote(ops: Op[]) {
  if (!ops.length) return
  flushOps() // our own edits so far go out first, against the old baseline
  useEditor.getState().applyRemoteOps(ops)
  baseline = useEditor.getState().project
}

function scheduleSend() {
  if (sendTimer) return
  sendTimer = setTimeout(() => {
    sendTimer = null
    flushOps()
  }, SEND_INTERVAL_MS)
}

function flushOps() {
  const s = useEditor.getState()
  if (!conn || !baseline || s.live.status !== 'on' || s.project.id !== conn.projectId || isReadOnly(s)) return
  if (s.conflicts.some((c) => c.projectId === conn!.projectId)) return // paused until resolved
  const ops = diffProjects(baseline, s.project)
  if (ops.length === 0) return
  if (conn.send({ t: 'ops', ops })) baseline = s.project
}

function schedulePresence() {
  if (presenceTimer) return
  presenceTimer = setTimeout(() => {
    presenceTimer = null
    const s = useEditor.getState()
    if (!conn || s.live.status !== 'on') return
    const p: Presence = { floorId: s.activeFloorId, cursor, selection: s.mode === 'plan' ? s.selection : [] }
    const key = JSON.stringify(p)
    if (key === lastPresence) return
    if (conn.send({ t: 'presence', p })) lastPresence = key
  }, PRESENCE_INTERVAL_MS)
}

/** the 2D editor reports the pointer position in plan coordinates (null when it leaves the canvas) */
export function setLiveCursor(pos: { x: number; y: number } | null) {
  const next = pos ? { x: Math.round(pos.x * 1000) / 1000, y: Math.round(pos.y * 1000) / 1000 } : null
  if (JSON.stringify(next) === JSON.stringify(cursor)) return
  cursor = next
  schedulePresence()
}

/** connect once at start-up; the store subscription does the rest */
export function startLiveCollaboration() {
  if (started) return
  started = true
  useEditor.subscribe((s, prev) => {
    if (switching) return
    const target = eligible(s)
    if ((target?.key ?? null) !== connKey) {
      if (target) connect(target.id, target.url, target.key)
      else if (conn) disconnect()
      return
    }
    if (!conn) return
    if (prev.dragSnapshot && !s.dragSnapshot && pendingOps.length) {
      // the drag is committed: send it, then catch up with what arrived meanwhile
      const ops = pendingOps
      pendingOps = []
      applyRemote(ops)
      return
    }
    if (s.project !== prev.project && s.project.id === conn.projectId) scheduleSend() // edits and drags alike
    if (s.selection !== prev.selection || s.activeFloorId !== prev.activeFloorId || s.mode !== prev.mode) schedulePresence()
  })
  const target = eligible(useEditor.getState())
  if (target) connect(target.id, target.url, target.key)
}
