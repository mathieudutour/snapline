import { create } from 'zustand'
import type { Constraint, ConstraintInput, Furniture, Opening, OpeningKind, Plan, PlanPoint, Vec2, Wall } from './types'
import { CATALOG_BY_KEY } from '../furniture/catalog'
import { emptyPlan, newId } from './types'
import { constraintsReferencing, solvePlan, type DragTarget, type FurnitureDrag, type SolveReport } from './constraints'
import { dist, projectOnSegment, wallLength, wallsAtPoint, type WallSide } from './geometry'
import { exampleProject } from './example'
import { defaultFloorName, floorElevation, newProject, normalizeProject, type Floor, type Project, type ProjectMeta, type Roof } from './project'
import type { Units } from './units'
import { deleteRemoteProject, fetchMe, getRemoteProject, listRemoteProjects, putRemoteProject, signOut as apiSignOut, type AccountUser } from '../sync/api'

export type Tool = 'select' | 'wall' | 'door' | 'window' | 'furniture' | 'pan'
export type ViewMode = 'plan' | '3d' | 'walk'

export type SelectionItem = { kind: 'point' | 'wall' | 'opening' | 'furniture'; id: string }

interface Snapshot {
  project: Project
  activeFloorId: string
}

export type SyncStatus = 'offline' | 'idle' | 'syncing' | 'synced' | 'error'

export interface EditorState {
  /** signed-in account; null when signed out, undefined until checked */
  user: AccountUser | null | undefined
  /** false when no Worker answers (plain `vite dev`): the editor then runs in local-only mode */
  apiAvailable: boolean | undefined
  syncStatus: SyncStatus
  /** check the session cookie and, when signed in, merge local and remote projects */
  initAccount: () => Promise<void>
  signOut: () => Promise<void>
  syncNow: () => Promise<void>

  /** the current project; `plan` mirrors the active floor's plan */
  project: Project
  activeFloorId: string
  projects: ProjectMeta[]
  showFloorBelow: boolean
  cutAboveActive: boolean
  units: Units
  /** which left-panel tab is open */
  railTab: 'layers' | 'furniture'
  setRailTab: (tab: 'layers' | 'furniture') => void
  prefsOpen: boolean
  setPrefsOpen: (v: boolean) => void
  /** current 2D zoom in pixels per metre (display only) */
  zoomLevel: number
  setZoomLevel: (z: number) => void
  requestFit: () => void
  plan: Plan
  report: SolveReport
  selection: SelectionItem[]
  tool: Tool
  mode: ViewMode
  snapGrid: boolean
  gridSize: number
  autoHV: boolean
  undoStack: Snapshot[]
  redoStack: Snapshot[]
  dragSnapshot: Snapshot | null
  lastSaved: number
  /** bumped whenever a whole new plan is loaded so the editor zooms to fit */
  fitVersion: number
  showShortcuts: boolean
  toggleShortcuts: (v?: boolean) => void
  /** catalogue key of the piece being placed with the furniture tool */
  placing: string | null
  setPlacing: (key: string | null) => void

  setTool: (tool: Tool) => void
  setMode: (mode: ViewMode) => void
  setSnapGrid: (v: boolean) => void
  setAutoHV: (v: boolean) => void
  setUnits: (u: Units) => void
  setSettings: (patch: Partial<Plan['settings']>) => void

  select: (items: SelectionItem[], additive?: boolean) => void
  clearSelection: () => void

  commit: (plan: Plan, label?: string) => void
  beginDrag: () => void
  dragTo: (drags: DragTarget[]) => void
  dragOpening: (openingId: string, offset: number) => void
  dragFurniture: (drags: FurnitureDrag[]) => void
  endDrag: () => void

  ensurePoint: (pos: Vec2, opts?: { onPointId?: string; onWall?: { wallId: string; t: number } }) => { plan: Plan; pointId: string }
  addWall: (from: { pos: Vec2; pointId?: string; wall?: { wallId: string; t: number } }, to: { pos: Vec2; pointId?: string; wall?: { wallId: string; t: number } }) => string | null
  addOpening: (wallId: string, offset: number, kind: OpeningKind) => string
  updateWall: (id: string, patch: Partial<Wall>) => void
  updateOpening: (id: string, patch: Partial<Opening>) => void
  updatePoint: (id: string, patch: Partial<PlanPoint>) => void
  addFurniture: (catalogKey: string, pos: Vec2, angle: number) => string | null
  updateFurniture: (id: string, patch: Partial<Furniture>) => void
  /** set a wall length; with `side` the value is the face-to-face length on that side */
  setWallLength: (wallId: string, value: number, lock: boolean, side?: WallSide) => void
  addConstraint: (c: ConstraintInput) => void
  removeConstraint: (id: string) => void
  deleteSelection: () => void
  deleteItems: (items: SelectionItem[]) => void
  /** merge point `fromId` into `toId` (joining walls), or onto a wall by splitting it */
  mergePoint: (fromId: string, target: { pointId?: string; wall?: { wallId: string; t: number } }) => void

  undo: () => void
  redo: () => void

  // floors, roof and projects
  setShowFloorBelow: (v: boolean) => void
  setCutAboveActive: (v: boolean) => void
  setActiveFloor: (id: string) => void
  addFloor: () => void
  duplicateFloor: (id: string) => void
  removeFloor: (id: string) => void
  renameFloor: (id: string, name: string) => void
  setRoof: (patch: Partial<Roof>) => void
  setSlabThickness: (v: number) => void
  renameProject: (name: string) => void
  newProject: () => void
  openProject: (id: string) => void
  deleteProject: (id: string) => void
  importProject: (raw: unknown) => void
  loadExample: () => void
}

const PREFS_KEY = 'snapline.prefs'
interface Prefs {
  units: Units
  snapGrid: boolean
  autoHV: boolean
  showFloorBelow: boolean
}
function loadPrefs(): Prefs {
  const d: Prefs = { units: 'm', snapGrid: true, autoHV: true, showFloorBelow: true }
  const raw = readJson<Partial<Prefs>>(PREFS_KEY)
  return raw ? { ...d, ...raw } : d
}
function savePrefs(p: Prefs) {
  if (!hasStorage()) return
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p))
  } catch {
    // ignore
  }
}

const LEGACY_KEY = 'snapline.plan.v1'
const INDEX_KEY = 'snapline.projects.v2'
const projectKey = (id: string) => `snapline.project.${id}`

interface ProjectIndex {
  activeId: string | null
  list: ProjectMeta[]
}

const hasStorage = () => typeof localStorage !== 'undefined'

function readJson<T>(key: string): T | null {
  if (!hasStorage()) return null
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function loadIndex(): ProjectIndex {
  const idx = readJson<ProjectIndex>(INDEX_KEY)
  if (idx && Array.isArray(idx.list)) return idx
  // migrate a v1 single plan into a project
  const legacy = readJson<Partial<Plan>>(LEGACY_KEY)
  if (legacy && legacy.points && legacy.walls) {
    const project = newProject('My home', normalizePlan(legacy))
    saveProjectNow(project)
    const index = { activeId: project.id, list: [{ id: project.id, name: project.name, updatedAt: project.updatedAt }] }
    writeIndex(index)
    return index
  }
  return { activeId: null, list: [] }
}

function writeIndex(index: ProjectIndex) {
  if (!hasStorage()) return
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(index))
  } catch {
    // ignore
  }
}

function loadProject(id: string): Project | null {
  const raw = readJson<unknown>(projectKey(id))
  return raw ? normalizeProject(raw, normalizePlan) : null
}

function saveProjectNow(project: Project) {
  if (!hasStorage()) return
  try {
    localStorage.setItem(projectKey(project.id), JSON.stringify(project))
  } catch {
    // ignore quota errors
  }
}

function updateIndex(project: Project, list: ProjectMeta[]): ProjectMeta[] {
  const meta = { id: project.id, name: project.name, updatedAt: project.updatedAt }
  const next = list.some((p) => p.id === project.id) ? list.map((p) => (p.id === project.id ? meta : p)) : [...list, meta]
  writeIndex({ activeId: project.id, list: next })
  return next
}

export function normalizePlan(raw: Partial<Plan>): Plan {
  const base = emptyPlan()
  return {
    points: raw.points ?? {},
    walls: raw.walls ?? {},
    openings: raw.openings ?? {},
    furniture: raw.furniture ?? {},
    constraints: raw.constraints ?? {},
    settings: { ...base.settings, ...(raw.settings ?? {}) },
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
let syncTimer: ReturnType<typeof setTimeout> | null = null
/** set by the store so saves can also push to the account when signed in */
let pushProject: ((project: Project) => void) | null = null
function scheduleSave(project: Project) {
  if (!hasStorage()) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => saveProjectNow(project), 300)
  if (pushProject) {
    if (syncTimer) clearTimeout(syncTimer)
    syncTimer = setTimeout(() => pushProject?.(project), 1500)
  }
}

function withFloorPlan(project: Project, floorId: string, plan: Plan): Project {
  return { ...project, updatedAt: Date.now(), floors: project.floors.map((f) => (f.id === floorId ? { ...f, plan } : f)) }
}

function activePlan(project: Project, floorId: string): Plan {
  return (project.floors.find((f) => f.id === floorId) ?? project.floors[0]).plan
}

/** re-key every entity of a plan so a duplicated floor does not share ids with its source */
function clonePlanWithNewIds(plan: Plan): Plan {
  const map = new Map<string, string>()
  const fresh = (id: string, prefix: string) => {
    if (!map.has(id)) map.set(id, newId(prefix))
    return map.get(id)!
  }
  const points: Plan['points'] = {}
  for (const p of Object.values(plan.points)) points[fresh(p.id, 'p')] = { ...p, id: fresh(p.id, 'p') }
  const walls: Plan['walls'] = {}
  for (const w of Object.values(plan.walls)) walls[fresh(w.id, 'w')] = { ...w, id: fresh(w.id, 'w'), a: fresh(w.a, 'p'), b: fresh(w.b, 'p') }
  const openings: Plan['openings'] = {}
  for (const o of Object.values(plan.openings)) openings[fresh(o.id, 'o')] = { ...o, id: fresh(o.id, 'o'), wallId: fresh(o.wallId, 'w') }
  const furniture: Plan['furniture'] = {}
  for (const f of Object.values(plan.furniture)) furniture[fresh(f.id, 'f')] = { ...f, id: fresh(f.id, 'f') }
  const constraints: Plan['constraints'] = {}
  for (const c of Object.values(plan.constraints)) {
    const id = fresh(c.id, 'c')
    const remap = (obj: Record<string, unknown>) => {
      const out: Record<string, unknown> = { ...obj, id }
      for (const k of ['wallId', 'wallA', 'wallB', 'pointId', 'pointA', 'pointB', 'openingId', 'furnitureId']) if (typeof out[k] === 'string') out[k] = map.get(out[k] as string) ?? out[k]
      return out
    }
    constraints[id] = remap(c as unknown as Record<string, unknown>) as unknown as Constraint
  }
  return { ...plan, points, walls, openings, furniture, constraints }
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
    } else if (c.type === 'furnitureWallGap' && existing.type === 'furnitureWallGap') {
      drop = existing.furnitureId === c.furnitureId && existing.side === c.side
    } else if (c.type === 'furnitureFixed' && existing.type === 'furnitureFixed') {
      drop = existing.furnitureId === c.furnitureId
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
    } else if (c.type === 'furnitureWallGap' && c.wallId === wallId) {
      const f = plan.furniture[c.furnitureId]
      const along = f ? ((f.x - a.x) * (b.x - a.x) + (f.y - a.y) * (b.y - a.y)) / (total * total || 1) : 0
      constraints[c.id] = { ...c, wallId: along <= t ? w1.id : w2.id }
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
  const prefs = loadPrefs()
  const persistPrefs = () => {
    const s = get()
    savePrefs({ units: s.units, snapGrid: s.snapGrid, autoHV: s.autoHV, showFloorBelow: s.showFloorBelow })
  }
  const index = loadIndex()
  let initialProject = (index.activeId && loadProject(index.activeId)) || null
  let projects = index.list
  if (!initialProject) {
    initialProject = exampleProject()
    saveProjectNow(initialProject)
    projects = updateIndex(initialProject, projects)
  }
  const initialFloorId = initialProject.floors[0].id
  const solved = solvePlan(activePlan(initialProject, initialFloorId))
  initialProject = withFloorPlan(initialProject, initialFloorId, solved.plan)

  /** replace the active floor's plan (no undo entry) */
  const applyPlan = (plan: Plan, report: SolveReport) => {
    const { project, activeFloorId } = get()
    const nextProject = withFloorPlan(project, activeFloorId, plan)
    set({ project: nextProject, plan, report })
    return nextProject
  }
  /** structural project change with an undo entry; re-solves the active floor */
  const commitProject = (nextProject: Project, activeFloorId = get().activeFloorId, extra: Partial<EditorState> = {}) => {
    const { project, activeFloorId: prevFloor, undoStack } = get()
    const solvedFloor = solvePlan(activePlan(nextProject, activeFloorId))
    const withSolved = withFloorPlan(nextProject, activeFloorId, solvedFloor.plan)
    set({
      project: withSolved,
      activeFloorId,
      plan: solvedFloor.plan,
      report: solvedFloor.report,
      undoStack: [...undoStack, { project, activeFloorId: prevFloor }].slice(-MAX_UNDO),
      redoStack: [],
      selection: [],
      projects: updateIndex(withSolved, get().projects),
      ...extra,
    })
    scheduleSave(withSolved)
  }
  const restore = (snapshot: Snapshot) => {
    const solvedFloor = solvePlan(activePlan(snapshot.project, snapshot.activeFloorId))
    const project = withFloorPlan(snapshot.project, snapshot.activeFloorId, solvedFloor.plan)
    set({ project, activeFloorId: snapshot.activeFloorId, plan: solvedFloor.plan, report: solvedFloor.report, selection: [], projects: updateIndex(project, get().projects) })
    scheduleSave(project)
  }
  const openProjectState = (project: Project) => {
    const floorId = project.floors[0].id
    const solvedFloor = solvePlan(activePlan(project, floorId))
    const withSolved = withFloorPlan(project, floorId, solvedFloor.plan)
    set({
      project: withSolved,
      activeFloorId: floorId,
      plan: solvedFloor.plan,
      report: solvedFloor.report,
      undoStack: [],
      redoStack: [],
      selection: [],
      projects: updateIndex(withSolved, get().projects),
      fitVersion: get().fitVersion + 1,
      placing: null,
    })
    saveProjectNow(withSolved)
  }

  const push = async (project: Project) => {
    if (!get().user) return
    set({ syncStatus: 'syncing' })
    try {
      await putRemoteProject(project)
      set({ syncStatus: 'synced' })
    } catch {
      set({ syncStatus: 'error' })
    }
  }
  pushProject = (project) => void push(project)

  /** merge the account's projects with the local ones: newer copy wins, missing ones are copied both ways */
  const mergeWithRemote = async () => {
    set({ syncStatus: 'syncing' })
    try {
      const remote = await listRemoteProjects()
      const remoteById = new Map(remote.map((r) => [r.id, r]))
      let list = get().projects
      const localIds = new Set(list.map((p) => p.id))
      for (const r of remote) {
        const local = list.find((p) => p.id === r.id)
        const localProject = local ? loadProject(r.id) : null
        if (!localProject || localProject.updatedAt < r.updatedAt) {
          const { project } = await getRemoteProject(r.id)
          const normalized = normalizeProject(project, normalizePlan)
          saveProjectNow(normalized)
          list = list.some((p) => p.id === normalized.id) ? list.map((p) => (p.id === normalized.id ? { id: normalized.id, name: normalized.name, updatedAt: normalized.updatedAt } : p)) : [...list, { id: normalized.id, name: normalized.name, updatedAt: normalized.updatedAt }]
          if (normalized.id === get().project.id) openProjectState(normalized)
        }
      }
      for (const id of localIds) {
        const local = loadProject(id)
        if (!local) continue
        const r = remoteById.get(id)
        if (!r || r.updatedAt < local.updatedAt) await putRemoteProject(local)
      }
      writeIndex({ activeId: get().project.id, list })
      set({ projects: list, syncStatus: 'synced' })
    } catch {
      set({ syncStatus: 'error' })
    }
  }

  return {
    user: undefined,
    apiAvailable: undefined,
    syncStatus: 'offline',
    initAccount: async () => {
      try {
        const user = await fetchMe()
        set({ user, apiAvailable: true, syncStatus: user ? 'idle' : 'offline' })
        if (user) await mergeWithRemote()
      } catch {
        // no worker behind the app (plain vite dev) or network down: work locally
        set({ user: null, apiAvailable: false, syncStatus: 'offline' })
      }
    },
    signOut: async () => {
      try {
        await apiSignOut()
      } finally {
        set({ user: null, syncStatus: 'offline' })
      }
    },
    syncNow: async () => {
      if (get().user) await mergeWithRemote()
    },

    project: initialProject,
    activeFloorId: initialFloorId,
    projects,
    showFloorBelow: prefs.showFloorBelow,
    cutAboveActive: false,
    units: prefs.units,
    railTab: 'layers',
    setRailTab: (railTab) => set({ railTab }),
    prefsOpen: false,
    setPrefsOpen: (prefsOpen) => set({ prefsOpen }),
    zoomLevel: 70,
    setZoomLevel: (zoomLevel) => set({ zoomLevel }),
    requestFit: () => set({ fitVersion: get().fitVersion + 1 }),
    plan: solved.plan,
    report: solved.report,
    selection: [],
    tool: 'select',
    mode: 'plan',
    snapGrid: prefs.snapGrid,
    gridSize: 0.05,
    autoHV: prefs.autoHV,
    undoStack: [],
    redoStack: [],
    dragSnapshot: null,
    lastSaved: Date.now(),
    fitVersion: 0,
    showShortcuts: false,
    toggleShortcuts: (v) => set({ showShortcuts: v ?? !get().showShortcuts }),
    placing: null,
    setPlacing: (placing) => set({ placing }),

    setTool: (tool) => set({ tool, selection: tool === 'select' ? get().selection : [], placing: tool === 'furniture' ? get().placing : null, railTab: tool === 'furniture' ? 'furniture' : get().railTab }),
    setMode: (mode) => set({ mode }),
    setSnapGrid: (snapGrid) => {
      set({ snapGrid })
      persistPrefs()
    },
    setAutoHV: (autoHV) => {
      set({ autoHV })
      persistPrefs()
    },
    setUnits: (units) => {
      set({ units })
      persistPrefs()
    },
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
      const { project, activeFloorId } = get()
      const { plan: solvedPlan, report } = solvePlan(plan)
      const undoStack = [...get().undoStack, { project, activeFloorId }].slice(-MAX_UNDO)
      const selection = get().selection.filter((s) => {
        if (s.kind === 'point') return !!solvedPlan.points[s.id]
        if (s.kind === 'wall') return !!solvedPlan.walls[s.id]
        if (s.kind === 'furniture') return !!solvedPlan.furniture[s.id]
        return !!solvedPlan.openings[s.id]
      })
      const nextProject = withFloorPlan(project, activeFloorId, solvedPlan)
      set({ project: nextProject, plan: solvedPlan, report, undoStack, redoStack: [], selection, projects: updateIndex(nextProject, get().projects) })
      scheduleSave(nextProject)
    },

    beginDrag: () => set({ dragSnapshot: { project: get().project, activeFloorId: get().activeFloorId } }),
    dragTo: (drags) => {
      const { plan: solvedPlan, report } = solvePlan(get().plan, drags)
      applyPlan(solvedPlan, report)
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
      applyPlan(solvedPlan, report)
    },
    dragFurniture: (drags) => {
      const { plan: solvedPlan, report } = solvePlan(get().plan, [], drags)
      applyPlan(solvedPlan, report)
    },
    endDrag: () => {
      const snapshot = get().dragSnapshot
      if (!snapshot) return
      const plan = get().plan
      const before = activePlan(snapshot.project, snapshot.activeFloorId)
      const changed =
        JSON.stringify(before.points) !== JSON.stringify(plan.points) || JSON.stringify(before.openings) !== JSON.stringify(plan.openings) || JSON.stringify(before.furniture) !== JSON.stringify(plan.furniture)
      if (changed) {
        const project = get().project
        set({ undoStack: [...get().undoStack, snapshot].slice(-MAX_UNDO), redoStack: [], dragSnapshot: null, projects: updateIndex(project, get().projects) })
        scheduleSave(project)
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

    addFurniture: (catalogKey, pos, angle) => {
      const item = CATALOG_BY_KEY[catalogKey]
      if (!item) return null
      const plan = get().plan
      const id = newId('f')
      const piece: Furniture = { id, catalogKey, name: item.name, x: pos.x, y: pos.y, angle, width: item.width, depth: item.depth, height: item.height, elevation: item.elevation }
      get().commit({ ...plan, furniture: { ...plan.furniture, [id]: piece } })
      return id
    },
    updateFurniture: (id, patch) => {
      const plan = get().plan
      if (!plan.furniture[id]) return
      get().commit({ ...plan, furniture: { ...plan.furniture, [id]: { ...plan.furniture[id], ...patch } } })
    },

    setWallLength: (wallId, value, lock, side) => {
      const plan = get().plan
      const wall = plan.walls[wallId]
      if (!wall || value <= 0) return
      if (lock) {
        get().addConstraint({ type: 'length', wallId, value, side })
        return
      }
      // one-off resize: move B along the wall direction, then let the solver settle the rest
      const a = plan.points[wall.a]
      const b = plan.points[wall.b]
      const l = dist(a, b) || 1
      const nb = { ...b, x: a.x + ((b.x - a.x) / l) * value, y: a.y + ((b.y - a.y) / l) * value }
      const tmp = { id: newId('c'), type: 'length' as const, wallId, value, side }
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
      const furnitureIds = items.filter((i) => i.kind === 'furniture').map((i) => i.id)
      if (furnitureIds.length) {
        const furniture = { ...plan.furniture }
        const constraints = { ...plan.constraints }
        for (const id of furnitureIds) delete furniture[id]
        for (const c of constraintsReferencing(plan, { furniture: furnitureIds })) delete constraints[c.id]
        plan = { ...plan, furniture, constraints }
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
        if (c.type === 'furnitureWallGap' && !walls[c.wallId]) delete constraints[c.id]
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
      const { undoStack, project, activeFloorId } = get()
      if (undoStack.length === 0) return
      const prev = undoStack[undoStack.length - 1]
      set({ undoStack: undoStack.slice(0, -1), redoStack: [...get().redoStack, { project, activeFloorId }] })
      restore(prev)
    },
    redo: () => {
      const { redoStack, project, activeFloorId } = get()
      if (redoStack.length === 0) return
      const next = redoStack[redoStack.length - 1]
      set({ redoStack: redoStack.slice(0, -1), undoStack: [...get().undoStack, { project, activeFloorId }] })
      restore(next)
    },

    setShowFloorBelow: (showFloorBelow) => {
      set({ showFloorBelow })
      persistPrefs()
    },
    setCutAboveActive: (cutAboveActive) => set({ cutAboveActive }),
    setActiveFloor: (id) => {
      const { project, activeFloorId } = get()
      if (id === activeFloorId || !project.floors.some((f) => f.id === id)) return
      const solvedFloor = solvePlan(activePlan(project, id))
      const withSolved = withFloorPlan(project, id, solvedFloor.plan)
      set({ project: withSolved, activeFloorId: id, plan: solvedFloor.plan, report: solvedFloor.report, selection: [], placing: null })
    },
    addFloor: () => {
      const { project } = get()
      const below = project.floors[project.floors.length - 1]
      const plan: Plan = { ...emptyPlan(), settings: { ...below.plan.settings } }
      const floor: Floor = { id: newId('fl'), name: defaultFloorName(project.floors.length), plan }
      commitProject({ ...project, floors: [...project.floors, floor] }, floor.id)
    },
    duplicateFloor: (id) => {
      const { project } = get()
      const idx = project.floors.findIndex((f) => f.id === id)
      if (idx < 0) return
      const src = project.floors[idx]
      const floor: Floor = { id: newId('fl'), name: defaultFloorName(idx + 1), plan: clonePlanWithNewIds(src.plan) }
      const floors = [...project.floors]
      floors.splice(idx + 1, 0, floor)
      // renumber default names of the floors above
      const renamed = floors.map((f, i) => (i > idx + 1 && /^(Ground floor|\d+(st|nd|rd|th) floor)$/.test(f.name) ? { ...f, name: defaultFloorName(i) } : f))
      commitProject({ ...project, floors: renamed }, floor.id)
    },
    removeFloor: (id) => {
      const { project, activeFloorId } = get()
      if (project.floors.length <= 1) return
      const idx = project.floors.findIndex((f) => f.id === id)
      if (idx < 0) return
      const floors = project.floors.filter((f) => f.id !== id)
      const nextActive = activeFloorId === id ? floors[Math.max(0, idx - 1)].id : activeFloorId
      commitProject({ ...project, floors }, nextActive)
    },
    renameFloor: (id, name) => {
      const { project } = get()
      commitProject({ ...project, floors: project.floors.map((f) => (f.id === id ? { ...f, name } : f)) })
    },
    setRoof: (patch) => {
      const { project } = get()
      commitProject({ ...project, roof: { ...project.roof, ...patch } })
    },
    setSlabThickness: (v) => {
      const { project } = get()
      commitProject({ ...project, slabThickness: Math.max(0, v) })
    },
    renameProject: (name) => {
      const { project } = get()
      commitProject({ ...project, name: name.trim() || project.name })
    },
    newProject: () => {
      const n = get().projects.length + 1
      openProjectState(newProject(`Project ${n}`))
    },
    openProject: (id) => {
      if (id === get().project.id) return
      const project = loadProject(id)
      if (project) openProjectState(project)
    },
    deleteProject: (id) => {
      const { projects, project } = get()
      const list = projects.filter((p) => p.id !== id)
      if (get().user) void deleteRemoteProject(id).catch(() => set({ syncStatus: 'error' }))
      if (hasStorage()) {
        try {
          localStorage.removeItem(projectKey(id))
        } catch {
          // ignore
        }
      }
      if (id === project.id) {
        const nextId = list[0]?.id
        const next = (nextId && loadProject(nextId)) || newProject('Project 1')
        set({ projects: list })
        openProjectState(next)
      } else {
        set({ projects: list })
        writeIndex({ activeId: project.id, list })
      }
    },
    importProject: (raw) => {
      const project = normalizeProject(raw, normalizePlan)
      // imported projects get a fresh id so they never clobber an existing one
      openProjectState({ ...project, id: newId('prj') })
    },
    loadExample: () => openProjectState(exampleProject()),
  }
})

export function isSelected(selection: SelectionItem[], kind: SelectionItem['kind'], id: string): boolean {
  return selection.some((s) => s.kind === kind && s.id === id)
}

/** finished-floor elevation of the active floor */
export function activeFloorElevation(state: Pick<EditorState, 'project' | 'activeFloorId'>): number {
  return floorElevation(state.project, state.activeFloorId)
}

/** plan of the floor directly below the active one, if any */
export function floorBelow(state: Pick<EditorState, 'project' | 'activeFloorId'>): Plan | null {
  const idx = state.project.floors.findIndex((f) => f.id === state.activeFloorId)
  return idx > 0 ? state.project.floors[idx - 1].plan : null
}
