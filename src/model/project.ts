import type { Plan, Vec2 } from './types'
import type { Site } from './sun'
import { emptyPlan, newId } from './types'
import { dist, polygonArea, wallLength } from './geometry'

export interface Floor {
  id: string
  name: string
  plan: Plan
}

export type RoofType = 'none' | 'flat' | 'gable' | 'hip'

export interface Roof {
  type: RoofType
  /** slope in degrees (gable / hip) */
  pitch: number
  /** eaves overhang beyond the walls, metres */
  overhang: number
  /** ridge along the longer or shorter side of the building's footprint */
  ridge: 'long' | 'short'
  /** slab thickness (flat) or roof thickness */
  thickness: number
  color: string
}

export interface Project {
  id: string
  name: string
  floors: Floor[]
  roof: Roof
  /** concrete slab between floors, metres */
  slabThickness: number
  /** where the building stands and how the plan is oriented; drives the sun in 3D */
  site?: Site
  createdAt: number
  updatedAt: number
}

export interface ProjectMeta {
  id: string
  name: string
  updatedAt: number
  /** account version this device last synced with; missing = never synced (the next sync creates it) */
  syncedVersion?: number
  /** local edits made since `syncedVersion` was synced */
  dirty?: boolean
  /** owner of the account copy, an invited editor, or an invited read-only viewer */
  role?: 'owner' | 'editor' | 'viewer'
  owner?: { email: string; name: string }
  updatedBy?: { email: string; name: string } | null
  /** how many people the owner shared it with */
  memberCount?: number
  /** "anyone with the link can view" token (owner only) */
  viewToken?: string | null
}

export const DEFAULT_ROOF: Roof = { type: 'gable', pitch: 30, overhang: 0.4, ridge: 'long', thickness: 0.2, color: '#8d5a3c' }

export function newProject(name = 'Untitled project', plan?: Plan): Project {
  const now = Date.now()
  return {
    id: newId('prj'),
    name,
    floors: [{ id: newId('fl'), name: 'Ground floor', plan: plan ?? emptyPlan() }],
    roof: { ...DEFAULT_ROOF, type: 'none' },
    slabThickness: 0.25,
    createdAt: now,
    updatedAt: now,
  }
}

/** Accepts a v2 project or a v1 single plan and returns a well-formed project. */
export function normalizeProject(raw: unknown, normalizePlan: (p: Partial<Plan>) => Plan): Project {
  const r = (raw ?? {}) as Record<string, unknown>
  if (Array.isArray(r.floors)) {
    const floors = (r.floors as Partial<Floor>[]).map((f, i) => ({
      id: f.id ?? newId('fl'),
      name: f.name ?? defaultFloorName(i),
      plan: normalizePlan((f.plan ?? {}) as Partial<Plan>),
    }))
    if (floors.length === 0) floors.push({ id: newId('fl'), name: 'Ground floor', plan: emptyPlan() })
    const now = Date.now()
    return {
      id: typeof r.id === 'string' ? r.id : newId('prj'),
      name: typeof r.name === 'string' && r.name.trim() ? r.name : 'Untitled project',
      floors,
      roof: { ...DEFAULT_ROOF, type: 'none', ...((r.roof as Partial<Roof>) ?? {}) },
      slabThickness: typeof r.slabThickness === 'number' ? r.slabThickness : 0.25,
      site: normalizeSite(r.site),
      createdAt: typeof r.createdAt === 'number' ? r.createdAt : now,
      updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : now,
    }
  }
  // v1: a bare plan
  return newProject(typeof r.name === 'string' ? r.name : 'Imported plan', normalizePlan(r as Partial<Plan>))
}

export function defaultFloorName(index: number): string {
  if (index === 0) return 'Ground floor'
  if (index === 1) return '1st floor'
  if (index === 2) return '2nd floor'
  if (index === 3) return '3rd floor'
  return `${index}th floor`
}

export function floorHeight(floor: Floor): number {
  return floor.plan.settings.wallHeight
}

/** height of the floor's finished floor above the ground */
export function floorElevation(project: Project, floorId: string): number {
  let e = 0
  for (const f of project.floors) {
    if (f.id === floorId) return e
    e += floorHeight(f) + project.slabThickness
  }
  return e
}

export function projectTopElevation(project: Project): number {
  const last = project.floors[project.floors.length - 1]
  return last ? floorElevation(project, last.id) + floorHeight(last) : 0
}

/**
 * Outer boundary of a plan: the outer face of the wall graph (largest negative-area face).
 * Returns null when no closed loop exists.
 */
export function outlinePolygon(plan: Plan): Vec2[] | null {
  const adjacency = new Map<string, string[]>()
  const addEdge = (a: string, b: string) => {
    if (!adjacency.has(a)) adjacency.set(a, [])
    const list = adjacency.get(a)!
    if (!list.includes(b)) list.push(b)
  }
  for (const w of Object.values(plan.walls)) {
    if (w.a === w.b || !plan.points[w.a] || !plan.points[w.b]) continue
    addEdge(w.a, w.b)
    addEdge(w.b, w.a)
  }
  const angleOf = (from: string, to: string) => {
    const p = plan.points[from]
    const q = plan.points[to]
    return Math.atan2(q.y - p.y, q.x - p.x)
  }
  for (const [id, list] of adjacency) list.sort((m, n) => angleOf(id, m) - angleOf(id, n))
  const visited = new Set<string>()
  let best: { polygon: Vec2[]; area: number } | null = null
  for (const [start, neighbours] of adjacency) {
    for (const first of neighbours) {
      if (visited.has(`${start}>${first}`)) continue
      const cycle: string[] = []
      let a = start
      let b = first
      let guard = 0
      while (guard++ < 10000) {
        const k = `${a}>${b}`
        if (visited.has(k)) break
        visited.add(k)
        cycle.push(a)
        const outgoing = adjacency.get(b)!
        const idx = outgoing.indexOf(a)
        const next = outgoing[(idx - 1 + outgoing.length) % outgoing.length]
        a = b
        b = next
        if (a === start && b === first) break
      }
      if (cycle.length < 3) continue
      // outer faces are traced clockwise (negative area); drop repeated vertices from dangling walls
      const polygon: Vec2[] = []
      const seen = new Set<string>()
      for (const id of cycle) {
        if (seen.has(id)) continue
        seen.add(id)
        polygon.push({ x: plan.points[id].x, y: plan.points[id].y })
      }
      const area = polygonArea(polygon)
      if (area < -1e-6 && (!best || area < best.area)) best = { polygon, area }
    }
  }
  return best ? best.polygon : null
}

export interface RoofRect {
  /** centre of the rectangle */
  cx: number
  cy: number
  /** unit direction of the rectangle's long axis in plan space */
  ux: number
  uy: number
  /** full extents along the long and short axes (walls only, no overhang) */
  long: number
  short: number
}

/** Bounding rectangle of the building footprint, aligned with its longest wall. */
export function roofFootprint(plan: Plan): RoofRect | null {
  const outline = outlinePolygon(plan)
  const pts = outline ?? Object.values(plan.points).map((p) => ({ x: p.x, y: p.y }))
  if (pts.length < 3) return null
  let longest: { u: Vec2; l: number } | null = null
  for (const w of Object.values(plan.walls)) {
    const l = wallLength(plan, w)
    if (!longest || l > longest.l) {
      const a = plan.points[w.a]
      const b = plan.points[w.b]
      longest = { u: { x: (b.x - a.x) / (l || 1), y: (b.y - a.y) / (l || 1) }, l }
    }
  }
  const u = longest?.u ?? { x: 1, y: 0 }
  const v = { x: -u.y, y: u.x }
  let minU = Infinity
  let maxU = -Infinity
  let minV = Infinity
  let maxV = -Infinity
  // extend by half of the thickest wall so the roof covers the wall faces
  const half = Math.max(0, ...Object.values(plan.walls).map((w) => w.thickness / 2))
  for (const p of pts) {
    const pu = p.x * u.x + p.y * u.y
    const pv = p.x * v.x + p.y * v.y
    minU = Math.min(minU, pu - half)
    maxU = Math.max(maxU, pu + half)
    minV = Math.min(minV, pv - half)
    maxV = Math.max(maxV, pv + half)
  }
  const cu = (minU + maxU) / 2
  const cv = (minV + maxV) / 2
  const extU = maxU - minU
  const extV = maxV - minV
  const longIsU = extU >= extV
  const lu = longIsU ? u : v
  return {
    cx: cu * u.x + cv * v.x,
    cy: cu * u.y + cv * v.y,
    ux: lu.x,
    uy: lu.y,
    long: Math.max(extU, extV),
    short: Math.min(extU, extV),
  }
}

export function samePoint(a: Vec2, b: Vec2): boolean {
  return dist(a, b) < 1e-6
}

function normalizeSite(raw: unknown): Site | undefined {
  const r = raw as Partial<Site> | null | undefined
  if (!r || typeof r.lat !== 'number' || typeof r.lng !== 'number' || !Number.isFinite(r.lat) || !Number.isFinite(r.lng)) return undefined
  return { lat: Math.max(-90, Math.min(90, r.lat)), lng: Math.max(-180, Math.min(180, r.lng)), north: typeof r.north === 'number' && Number.isFinite(r.north) ? ((r.north % 360) + 360) % 360 : 0 }
}
