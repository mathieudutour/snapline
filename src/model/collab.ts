/**
 * Live collaboration operations.
 *
 * A project is a set of entity maps (points, walls, openings, furniture, constraints per floor)
 * plus a few scalars. Edits are exchanged as entity-level operations: "entity X on floor F is now V"
 * (or deleted). The last write for an entity wins, which keeps every client and the room in the
 * same state without a merge step. This file is shared by the app and the Worker's room.
 */
import type { Plan, PlanSettings } from './types'
import type { Floor, Project, Roof } from './project'
import type { Site } from './sun'

export type Collection = 'points' | 'walls' | 'openings' | 'furniture' | 'constraints' | 'rooms' | 'comments'
export const COLLECTIONS: Collection[] = ['points', 'walls', 'openings', 'furniture', 'constraints', 'rooms', 'comments']

export type Op =
  | { k: 'entity'; floorId: string; coll: Collection; id: string; v: unknown | null }
  | { k: 'settings'; floorId: string; v: PlanSettings }
  | { k: 'floor'; id: string; v: { name: string; plan?: Plan } | null; index?: number }
  | { k: 'floors'; order: string[] }
  | { k: 'project'; v: { name?: string; roof?: Roof; slabThickness?: number; site?: Site | null } }
  /** whole-project replacement (used when a client decides to overwrite the room) */
  | { k: 'replace'; project: Project }

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b)

/** operations that turn `prev` into `next` */
export function diffProjects(prev: Project, next: Project): Op[] {
  const ops: Op[] = []
  if (prev === next) return ops
  const proj: { name?: string; roof?: Roof; slabThickness?: number; site?: Site | null } = {}
  if (prev.name !== next.name) proj.name = next.name
  if (!same(prev.roof, next.roof)) proj.roof = next.roof
  if (prev.slabThickness !== next.slabThickness) proj.slabThickness = next.slabThickness
  if (!same(prev.site, next.site)) proj.site = next.site ?? null
  if (Object.keys(proj).length) ops.push({ k: 'project', v: proj })

  const prevFloors = new Map(prev.floors.map((f) => [f.id, f]))
  next.floors.forEach((f, index) => {
    const before = prevFloors.get(f.id)
    if (!before) {
      ops.push({ k: 'floor', id: f.id, v: { name: f.name, plan: f.plan }, index })
      return
    }
    if (before.name !== f.name) ops.push({ k: 'floor', id: f.id, v: { name: f.name } })
    if (before.plan === f.plan) return
    if (!same(before.plan.settings, f.plan.settings)) ops.push({ k: 'settings', floorId: f.id, v: f.plan.settings })
    for (const coll of COLLECTIONS) {
      const a = before.plan[coll] as Record<string, unknown>
      const b = f.plan[coll] as Record<string, unknown>
      if (a === b) continue
      for (const id of Object.keys(b)) if (!(id in a) || !same(a[id], b[id])) ops.push({ k: 'entity', floorId: f.id, coll, id, v: b[id] })
      for (const id of Object.keys(a)) if (!(id in b)) ops.push({ k: 'entity', floorId: f.id, coll, id, v: null })
    }
  })
  for (const f of prev.floors) if (!next.floors.some((n) => n.id === f.id)) ops.push({ k: 'floor', id: f.id, v: null })
  const prevOrder = prev.floors.map((f) => f.id).filter((id) => next.floors.some((f) => f.id === id))
  const nextOrder = next.floors.map((f) => f.id).filter((id) => prevFloors.has(id))
  if (prevOrder.join() !== nextOrder.join()) ops.push({ k: 'floors', order: next.floors.map((f) => f.id) })
  return ops
}

/** apply operations immutably; unknown floors or entities are ignored so late ops never crash */
export function applyOps(project: Project, ops: Op[]): Project {
  let p = project
  for (const op of ops) {
    switch (op.k) {
      case 'replace':
        p = op.project
        break
      case 'project': {
        const { site, ...rest } = op.v
        p = { ...p, ...rest }
        if (site !== undefined) p = { ...p, site: site ?? undefined }
        break
      }
      case 'floors': {
        const byId = new Map(p.floors.map((f) => [f.id, f]))
        const ordered = op.order.map((id) => byId.get(id)).filter((f): f is Floor => !!f)
        for (const f of p.floors) if (!ordered.includes(f)) ordered.push(f)
        p = { ...p, floors: ordered }
        break
      }
      case 'floor': {
        if (op.v === null) {
          if (p.floors.length > 1) p = { ...p, floors: p.floors.filter((f) => f.id !== op.id) }
          break
        }
        const existing = p.floors.find((f) => f.id === op.id)
        if (existing) {
          p = { ...p, floors: p.floors.map((f) => (f.id === op.id ? { ...f, name: op.v!.name, plan: op.v!.plan ?? f.plan } : f)) }
        } else if (op.v.plan) {
          const floors = [...p.floors]
          floors.splice(Math.min(op.index ?? floors.length, floors.length), 0, { id: op.id, name: op.v.name, plan: op.v.plan })
          p = { ...p, floors }
        }
        break
      }
      case 'settings':
        p = mapFloor(p, op.floorId, (plan) => ({ ...plan, settings: op.v }))
        break
      case 'entity':
        p = mapFloor(p, op.floorId, (plan) => {
          const coll = { ...(plan[op.coll] as Record<string, unknown>) }
          if (op.v === null) delete coll[op.id]
          else coll[op.id] = op.v
          return { ...plan, [op.coll]: coll }
        })
        break
    }
  }
  return p
}

function mapFloor(p: Project, floorId: string, fn: (plan: Plan) => Plan): Project {
  if (!p.floors.some((f) => f.id === floorId)) return p
  return { ...p, floors: p.floors.map((f) => (f.id === floorId ? { ...f, plan: fn(f.plan) } : f)) }
}

/** floors touched by a batch of operations (to decide whether the open floor must be re-solved) */
export function floorsTouched(ops: Op[]): Set<string> | 'all' {
  const set = new Set<string>()
  for (const op of ops) {
    if (op.k === 'replace' || op.k === 'floors' || op.k === 'project') return 'all'
    if (op.k === 'floor') set.add(op.id)
    else set.add(op.floorId)
  }
  return set
}

// ---- wire protocol ----
export interface Peer {
  id: string
  userId: string
  name: string
  email: string
  color: string
  /** viewers receive everything but their operations are ignored */
  role: 'editor' | 'viewer'
}
export interface Presence {
  floorId: string | null
  cursor: { x: number; y: number } | null
  selection: { kind: string; id: string }[]
}
export type ClientMessage = { t: 'ops'; ops: Op[] } | { t: 'presence'; p: Presence }
export type ServerMessage =
  | { t: 'welcome'; you: string; project: Project; version: number; peers: Peer[]; presence: Record<string, Presence> }
  | { t: 'ops'; from: string; ops: Op[] }
  | { t: 'presence'; from: string; p: Presence }
  | { t: 'join'; peer: Peer }
  | { t: 'leave'; id: string }
  | { t: 'saved'; version: number; updatedAt: number }
  /** the stored project changed outside the room (a REST save); everyone reloads */
  | { t: 'reset'; project: Project; version: number }

export const PEER_COLORS = ['#e8590c', '#2f9e44', '#7048e8', '#e03131', '#0c8599', '#f08c00', '#c2255c', '#1971c2']
