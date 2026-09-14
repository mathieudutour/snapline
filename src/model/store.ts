import { create } from 'zustand'
import type { Constraint, ConstraintInput, Opening, OpeningKind, Plan, PlanPoint, Vec2, Wall } from './types'
import { emptyPlan, newId } from './types'
import { constraintsReferencing, solvePlan, type DragTarget, type SolveReport } from './constraints'
import { dist, projectOnSegment, wallLength, wallsAtPoint } from './geometry'
import { examplePlan } from './example'

export type Tool = 'select' | 'wall' | 'door' | 'window' | 'pan'
export type ViewMode = 'plan' | '3d' | 'walk'

export type SelectionItem = { kind: 'point' | 'wall' | 'opening'; id: string }

export interface EditorState {
  plan: Plan
  report: SolveReport
  selection: SelectionItem[]
  tool: Tool
  mode: ViewMode
  snapGrid: boolean
  gridSize: number
  autoHV: boolean
  undoStack: Plan[]
  redoStack: Plan[]
  dragSnapshot: Plan | null
  lastSaved: number

  setTool: (tool: Tool) => void
  setMode: (mode: ViewMode) => void
  setSnapGrid: (v: boolean) => void
  setAutoHV: (v: boolean) => void
  setUnits: (u: Plan['settings']['units']) => void
  setSettings: (patch: Partial<Plan['settings']>) => void

  select: (items: SelectionItem[], additive?: boolean) => void
  clearSelection: () => void

  commit: (plan: Plan, label?: string) => void
  beginDrag: () => void
  dragTo: (drags: DragTarget[]) => void
  dragOpening: (openingId: string, offset: number) => void
  endDrag: () => void

  ensurePoint: (pos: Vec2, opts?: { onPointId?: string; onWall?: { wallId: string; t: number } }) => { plan: Plan; pointId: string }
  addWall: (from: { pos: Vec2; pointId?: string; wall?: { wallId: string; t: number } }, to: { pos: Vec2; pointId?: string; wall?: { wallId: string; t: number } }) => string | null
  addOpening: (wallId: string, offset: number, kind: OpeningKind) => string
  updateWall: (id: string, patch: Partial<Wall>) => void
  updateOpening: (id: string, patch: Partial<Opening>) => void
  updatePoint: (id: string, patch: Partial<PlanPoint>) => void
  setWallLength: (wallId: string, value: number, lock: boolean) => void
  addConstraint: (c: ConstraintInput) => void
  removeConstraint: (id: string) => void
  deleteSelection: () => void
  deleteItems: (items: SelectionItem[]) => void
  /** merge point `fromId` into `toId` (joining walls), or onto a wall by splitting it */
  mergePoint: (fromId: string, target: { pointId?: string; wall?: { wallId: string; t: number } }) => void

  undo: () => void
  redo: () => void
  resetPlan: (plan?: Plan) => void
  loadExample: () => void
}

const STORAGE_KEY = 'snapline.plan.v1'

function loadSaved(): Plan | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed && parsed.points && parsed.walls) return normalizePlan(parsed)
  } catch {
    // ignore
  }
  return null
}

export function normalizePlan(raw: Partial<Plan>): Plan {
  const base = emptyPlan()
  return {
    points: raw.points ?? {},
    walls: raw.walls ?? {},
    openings: raw.openings ?? {},
    constraints: raw.constraints ?? {},
    settings: { ...base.settings, ...(raw.settings ?? {}) },
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSave(plan: Plan) {
  if (typeof localStorage === 'undefined') return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(plan))
    } catch {
      // ignore quota errors
    }
  }, 300)
}

const MAX_UNDO = 100

/** Remove constraints that reference the same entity with the same "slot" as the new one. */
function withoutConflicting(plan: Plan, c: ConstraintInput): Record<string, Constraint> {
  const out: Record<string, Constraint> = {}
  for (const existing of Object.values(plan.constraints)) {
    let drop = false
    if ((c.type === 'length' || c.type === 'horizontal' || c.type === 'vertical') && (existing.type === 'length' || existing.type === 'horizontal' || existing.type === 'vertical')) {
      const sameWall = existing.wallId === c.wallId
      const sameSlot = existing.type === c.type || (existing.type !== 'length' && c.type !== 'length')
      drop = sameWall && sameSlot
    } else if (c.type === 'fixed' && existing.type === 'fixed') {
      drop = existing.pointId === c.pointId
    } else if ((c.type === 'openingOffsetA' || c.type === 'openingOffsetB' || c.type === 'openingCentered') && (existing.type === 'openingOffsetA' || existing.type === 'openingOffsetB' || existing.type === 'openingCentered')) {
      drop = existing.openingId === c.openingId && (existing.type === c.type || existing.type === 'openingCentered' || c.type === 'openingCentered')
    } else if (
      (c.type === 'parallel' || c.type === 'perpendicular' || c.type === 'angle' || c.type === 'equalLength') &&
      (existing.type === 'parallel' || existing.type === 'perpendicular' || existing.type === 'angle' || existing.type === 'equalLength')
    ) {
      const samePair = (existing.wallA === c.wallA && existing.wallB === c.wallB) || (existing.wallA === c.wallB && existing.wallB === c.wallA)
      const angular = (t: string) => t === 'parallel' || t === 'perpendicular' || t === 'angle'
      drop = samePair && (existing.type === c.type || (angular(existing.type) && angular(c.type)))
    } else if (c.type === 'distance' && existing.type === 'distance') {
      drop = (existing.pointA === c.pointA && existing.pointB === c.pointB) || (existing.pointA === c.pointB && existing.pointB === c.pointA)
    }
    if (!drop) out[existing.id] = existing
  }
  return out
}

function removeWalls(plan: Plan, wallIds: string[]): Plan {
  const walls = { ...plan.walls }
  const openings = { ...plan.openings }
  const constraints = { ...plan.constraints }
  const removedOpenings: string[] = []
  for (const id of wallIds) {
    delete walls[id]
    for (const o of Object.values(openings)) {
      if (o.wallId === id) {
        delete openings[o.id]
        removedOpenings.push(o.id)
      }
    }
  }
  for (const c of constraintsReferencing(plan, { walls: wallIds, openings: removedOpenings })) delete constraints[c.id]
  const next = { ...plan, walls, openings, constraints }
  // drop orphan points
  const points = { ...next.points }
  for (const p of Object.values(points)) {
    if (wallsAtPoint(next, p.id).length === 0) {
      delete points[p.id]
      for (const c of constraintsReferencing(next, { points: [p.id] })) delete constraints[c.id]
    }
  }
  return { ...next, points, constraints }
}

/** Split a wall at parameter t, returning the new plan and the id of the new point. */
export function splitWall(plan: Plan, wallId: string, t: number): { plan: Plan; pointId: string } {
  const wall = plan.walls[wallId]
  const a = plan.points[wall.a]
  const b = plan.points[wall.b]
  const pointId = newId('p')
  const point: PlanPoint = { id: pointId, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
  const total = dist(a, b)
  const split = total * t
  const w1: Wall = { ...wall, id: newId('w'), a: wall.a, b: pointId }
  const w2: Wall = { ...wall, id: newId('w'), a: pointId, b: wall.b }
  const walls = { ...plan.walls }
  delete walls[wallId]
  walls[w1.id] = w1
  walls[w2.id] = w2
  const openings = { ...plan.openings }
  for (const o of Object.values(openings)) {
    if (o.wallId !== wallId) continue
    const centre = o.offset + o.width / 2
    if (centre <= split) openings[o.id] = { ...o, wallId: w1.id, offset: Math.min(o.offset, Math.max(0, split - o.width)) }
    else openings[o.id] = { ...o, wallId: w2.id, offset: Math.max(0, o.offset - split) }
  }
  const constraints = { ...plan.constraints }
  for (const c of Object.values(constraints)) {
    if (c.type === 'horizontal' || c.type === 'vertical') {
      if (c.wallId === wallId) {
        delete constraints[c.id]
        for (const id of [w1.id, w2.id]) {
          const nid = newId('c')
          constraints[nid] = { id: nid, type: c.type, wallId: id }
        }
      }
    } else if (c.type === 'length') {
      if (c.wallId === wallId) {
        // preserve the overall length as a distance constraint between the original ends
        delete constraints[c.id]
        const nid = newId('c')
        constraints[nid] = { id: nid, type: 'distance', pointA: wall.a, pointB: wall.b, value: c.value }
        // and keep them collinear through the split point
        const cid = newId('c')
        constraints[cid] = { id: cid, type: 'parallel', wallA: w1.id, wallB: w2.id }
      }
    } else if (c.type === 'parallel' || c.type === 'perpendicular' || c.type === 'equalLength' || c.type === 'angle') {
      if (c.wallA === wallId || c.wallB === wallId) {
        if (c.type === 'equalLength') delete constraints[c.id]
        else constraints[c.id] = { ...c, wallA: c.wallA === wallId ? w1.id : c.wallA, wallB: c.wallB === wallId ? w1.id : c.wallB }
      }
    }
  }
  return { plan: { ...plan, points: { ...plan.points, [pointId]: point }, walls, openings, constraints }, pointId }
}

export const useEditor = create<EditorState>((set, get) => {
  const initial = (typeof localStorage !== 'undefined' && loadSaved()) || examplePlan()
  const solved = solvePlan(initial)
  return {
    plan: solved.plan,
    report: solved.report,
    selection: [],
    tool: 'select',
    mode: 'plan',
    snapGrid: true,
    gridSize: 0.05,
    autoHV: true,
    undoStack: [],
    redoStack: [],
    dragSnapshot: null,
    lastSaved: Date.now(),

    setTool: (tool) => set({ tool, selection: tool === 'select' ? get().selection : [] }),
    setMode: (mode) => set({ mode }),
    setSnapGrid: (snapGrid) => set({ snapGrid }),
    setAutoHV: (autoHV) => set({ autoHV }),
    setUnits: (units) => get().setSettings({ units }),
    setSettings: (patch) => {
      const plan = get().plan
      get().commit({ ...plan, settings: { ...plan.settings, ...patch } })
    },

    select: (items, additive = false) => {
      const current = get().selection
      if (!additive) return set({ selection: items })
      const next = [...current]
      for (const it of items) {
        const idx = next.findIndex((s) => s.kind === it.kind && s.id === it.id)
        if (idx >= 0) next.splice(idx, 1)
        else next.push(it)
      }
      set({ selection: next })
    },
    clearSelection: () => set({ selection: [] }),

    commit: (plan) => {
      const prev = get().plan
      const { plan: solvedPlan, report } = solvePlan(plan)
      const undoStack = [...get().undoStack, prev].slice(-MAX_UNDO)
      const selection = get().selection.filter((s) => {
        if (s.kind === 'point') return !!solvedPlan.points[s.id]
        if (s.kind === 'wall') return !!solvedPlan.walls[s.id]
        return !!solvedPlan.openings[s.id]
      })
      set({ plan: solvedPlan, report, undoStack, redoStack: [], selection })
      scheduleSave(solvedPlan)
    },

    beginDrag: () => set({ dragSnapshot: get().plan }),
    dragTo: (drags) => {
      const { plan: solvedPlan, report } = solvePlan(get().plan, drags)
      set({ plan: solvedPlan, report })
    },
    dragOpening: (openingId, offset) => {
      const plan = get().plan
      const o = plan.openings[openingId]
      if (!o) return
      const wall = plan.walls[o.wallId]
      const max = Math.max(0, wallLength(plan, wall) - o.width)
      const clamped = Math.min(Math.max(0, offset), max)
      const next = { ...plan, openings: { ...plan.openings, [openingId]: { ...o, offset: clamped } } }
      const { plan: solvedPlan, report } = solvePlan(next)
      // keep the user's requested offset unless a constraint overrides it
      set({ plan: solvedPlan, report })
    },
    endDrag: () => {
      const snapshot = get().dragSnapshot
      if (!snapshot) return
      const plan = get().plan
      const changed = JSON.stringify(snapshot.points) !== JSON.stringify(plan.points) || JSON.stringify(snapshot.openings) !== JSON.stringify(plan.openings)
      if (changed) {
        set({ undoStack: [...get().undoStack, snapshot].slice(-MAX_UNDO), redoStack: [], dragSnapshot: null })
        scheduleSave(plan)
      } else set({ dragSnapshot: null })
    },

    ensurePoint: (pos, opts = {}) => {
      let plan = get().plan
      if (opts.onPointId && plan.points[opts.onPointId]) return { plan, pointId: opts.onPointId }
      if (opts.onWall && plan.walls[opts.onWall.wallId]) {
        const res = splitWall(plan, opts.onWall.wallId, opts.onWall.t)
        return res
      }
      const id = newId('p')
      plan = { ...plan, points: { ...plan.points, [id]: { id, x: pos.x, y: pos.y } } }
      return { plan, pointId: id }
    },

    addWall: (from, to) => {
      const state = get()
      const original = state.plan
      const first = state.ensurePoint(from.pos, { onPointId: from.pointId, onWall: from.wall })
      let plan = first.plan
      // the second point must be resolved against the updated plan
      let toPointId: string
      if (to.pointId && plan.points[to.pointId]) toPointId = to.pointId
      else if (to.wall && plan.walls[to.wall.wallId]) {
        const res = splitWall(plan, to.wall.wallId, to.wall.t)
        plan = res.plan
        toPointId = res.pointId
      } else if (to.wall && !plan.walls[to.wall.wallId]) {
        // the wall we snapped to was just split by the first point: find the closest new segment
        let best: { wallId: string; t: number; d: number } | null = null
        for (const w of Object.values(plan.walls)) {
          const pr = projectOnSegment(to.pos, plan.points[w.a], plan.points[w.b])
          if (!best || pr.distance < best.d) best = { wallId: w.id, t: pr.t, d: pr.distance }
        }
        if (best && best.d < 1e-3) {
          const res = splitWall(plan, best.wallId, best.t)
          plan = res.plan
          toPointId = res.pointId
        } else {
          const id = newId('p')
          plan = { ...plan, points: { ...plan.points, [id]: { id, x: to.pos.x, y: to.pos.y } } }
          toPointId = id
        }
      } else {
        const id = newId('p')
        plan = { ...plan, points: { ...plan.points, [id]: { id, x: to.pos.x, y: to.pos.y } } }
        toPointId = id
      }
      if (toPointId === first.pointId) return null
      // avoid duplicating an existing wall
      for (const w of Object.values(plan.walls)) {
        if ((w.a === first.pointId && w.b === toPointId) || (w.b === first.pointId && w.a === toPointId)) return null
      }
      const id = newId('w')
      const wall: Wall = { id, a: first.pointId, b: toPointId, thickness: plan.settings.wallThickness, height: plan.settings.wallHeight }
      plan = { ...plan, walls: { ...plan.walls, [id]: wall } }
      if (state.autoHV) {
        const a = plan.points[wall.a]
        const b = plan.points[wall.b]
        const dx = Math.abs(b.x - a.x)
        const dy = Math.abs(b.y - a.y)
        const cid = newId('c')
        if (dy < 1e-6 && dx > 1e-6) plan.constraints = { ...plan.constraints, [cid]: { id: cid, type: 'horizontal', wallId: id } }
        else if (dx < 1e-6 && dy > 1e-6) plan.constraints = { ...plan.constraints, [cid]: { id: cid, type: 'vertical', wallId: id } }
      }
      if (plan === original) return null
      state.commit(plan)
      return id
    },

    addOpening: (wallId, offset, kind) => {
      const plan = get().plan
      const wall = plan.walls[wallId]
      const id = newId('o')
      const width = kind === 'door' ? 0.9 : 1.2
      const max = Math.max(0, wallLength(plan, wall) - width)
      const opening: Opening = {
        id,
        kind,
        wallId,
        offset: Math.min(Math.max(0, offset), max),
        width,
        height: kind === 'door' ? 2.1 : 1.2,
        sill: kind === 'door' ? 0 : 0.9,
        hingeB: false,
        swingRight: false,
      }
      get().commit({ ...plan, openings: { ...plan.openings, [id]: opening } })
      return id
    },

    updateWall: (id, patch) => {
      const plan = get().plan
      if (!plan.walls[id]) return
      get().commit({ ...plan, walls: { ...plan.walls, [id]: { ...plan.walls[id], ...patch } } })
    },
    updateOpening: (id, patch) => {
      const plan = get().plan
      if (!plan.openings[id]) return
      get().commit({ ...plan, openings: { ...plan.openings, [id]: { ...plan.openings[id], ...patch } } })
    },
    updatePoint: (id, patch) => {
      const plan = get().plan
      if (!plan.points[id]) return
      get().commit({ ...plan, points: { ...plan.points, [id]: { ...plan.points[id], ...patch } } })
    },

    setWallLength: (wallId, value, lock) => {
      const plan = get().plan
      const wall = plan.walls[wallId]
      if (!wall || value <= 0) return
      if (lock) {
        get().addConstraint({ type: 'length', wallId, value })
        return
      }
      // one-off resize: move B along the wall direction, then let the solver settle the rest
      const a = plan.points[wall.a]
      const b = plan.points[wall.b]
      const l = dist(a, b) || 1
      const nb = { ...b, x: a.x + ((b.x - a.x) / l) * value, y: a.y + ((b.y - a.y) / l) * value }
      const tmp = { id: newId('c'), type: 'length' as const, wallId, value }
      const withTmp: Plan = { ...plan, points: { ...plan.points, [wall.b]: nb }, constraints: { ...plan.constraints, [tmp.id]: tmp } }
      const solved = solvePlan(withTmp).plan
      const constraints = { ...solved.constraints }
      delete constraints[tmp.id]
      get().commit({ ...solved, constraints })
    },

    addConstraint: (c) => {
      const plan = get().plan
      const id = newId('c')
      const constraints = withoutConflicting(plan, c)
      constraints[id] = { ...c, id } as Constraint
      get().commit({ ...plan, constraints })
    },
    removeConstraint: (id) => {
      const plan = get().plan
      const constraints = { ...plan.constraints }
      delete constraints[id]
      get().commit({ ...plan, constraints })
    },

    deleteSelection: () => {
      const items = get().selection
      if (items.length === 0) return
      get().deleteItems(items)
      set({ selection: [] })
    },
    deleteItems: (items) => {
      let plan = get().plan
      const wallIds = new Set<string>()
      for (const it of items) {
        if (it.kind === 'wall') wallIds.add(it.id)
        if (it.kind === 'point') for (const w of wallsAtPoint(plan, it.id)) wallIds.add(w.id)
      }
      const openingIds = items.filter((i) => i.kind === 'opening').map((i) => i.id)
      if (openingIds.length) {
        const openings = { ...plan.openings }
        const constraints = { ...plan.constraints }
        for (const id of openingIds) delete openings[id]
        for (const c of constraintsReferencing(plan, { openings: openingIds })) delete constraints[c.id]
        plan = { ...plan, openings, constraints }
      }
      if (wallIds.size) plan = removeWalls(plan, [...wallIds])
      get().commit(plan)
    },

    mergePoint: (fromId, target) => {
      let plan = get().plan
      if (!plan.points[fromId]) return
      let toId: string | undefined = target.pointId
      if (!toId && target.wall && plan.walls[target.wall.wallId]) {
        const w = plan.walls[target.wall.wallId]
        if (w.a === fromId || w.b === fromId) return
        const res = splitWall(plan, w.id, target.wall.t)
        plan = res.plan
        toId = res.pointId
      }
      if (!toId || toId === fromId || !plan.points[toId]) return
      const walls = { ...plan.walls }
      for (const w of Object.values(walls)) {
        if (w.a === fromId || w.b === fromId) {
          const na = w.a === fromId ? toId : w.a
          const nb = w.b === fromId ? toId : w.b
          if (na === nb) delete walls[w.id]
          else walls[w.id] = { ...w, a: na, b: nb }
        }
      }
      // drop duplicated walls between the same two points
      const seen = new Set<string>()
      for (const w of Object.values(walls)) {
        const key = [w.a, w.b].sort().join('|')
        if (seen.has(key)) delete walls[w.id]
        else seen.add(key)
      }
      const points = { ...plan.points }
      delete points[fromId]
      const constraints = { ...plan.constraints }
      for (const c of Object.values(constraints)) {
        if (c.type === 'fixed' && c.pointId === fromId) delete constraints[c.id]
        if (c.type === 'distance' && (c.pointA === fromId || c.pointB === fromId)) {
          const pa = c.pointA === fromId ? toId : c.pointA
          const pb = c.pointB === fromId ? toId : c.pointB
          if (pa === pb) delete constraints[c.id]
          else constraints[c.id] = { ...c, pointA: pa, pointB: pb }
        }
        if ((c.type === 'length' || c.type === 'horizontal' || c.type === 'vertical') && !walls[c.wallId]) delete constraints[c.id]
        if ((c.type === 'parallel' || c.type === 'perpendicular' || c.type === 'equalLength' || c.type === 'angle') && (!walls[c.wallA] || !walls[c.wallB])) delete constraints[c.id]
      }
      const openings = { ...plan.openings }
      for (const o of Object.values(openings)) {
        if (!walls[o.wallId]) {
          delete openings[o.id]
          for (const c of constraintsReferencing(plan, { openings: [o.id] })) delete constraints[c.id]
        }
      }
      get().commit({ ...plan, points, walls, openings, constraints })
    },

    undo: () => {
      const { undoStack, plan } = get()
      if (undoStack.length === 0) return
      const prev = undoStack[undoStack.length - 1]
      const solved = solvePlan(prev)
      set({ plan: solved.plan, report: solved.report, undoStack: undoStack.slice(0, -1), redoStack: [...get().redoStack, plan], selection: [] })
      scheduleSave(solved.plan)
    },
    redo: () => {
      const { redoStack, plan } = get()
      if (redoStack.length === 0) return
      const next = redoStack[redoStack.length - 1]
      const solved = solvePlan(next)
      set({ plan: solved.plan, report: solved.report, redoStack: redoStack.slice(0, -1), undoStack: [...get().undoStack, plan], selection: [] })
      scheduleSave(solved.plan)
    },
    resetPlan: (plan) => {
      const next = plan ? normalizePlan(plan) : emptyPlan()
      const solved = solvePlan(next)
      set({ plan: solved.plan, report: solved.report, undoStack: [...get().undoStack, get().plan].slice(-MAX_UNDO), redoStack: [], selection: [] })
      scheduleSave(solved.plan)
    },
    loadExample: () => get().resetPlan(examplePlan()),
  }
})

export function isSelected(selection: SelectionItem[], kind: SelectionItem['kind'], id: string): boolean {
  return selection.some((s) => s.kind === kind && s.id === id)
}
