import { create } from 'zustand'
import type { Author, Constraint, ConstraintInput, Furniture, Opening, OpeningKind, Plan, PlanPoint, Room, Vec2, Wall } from './types'
import { roomLabel } from './rooms'
import { CATALOG_BY_KEY } from '../furniture/catalog'
import { emptyPlan, newId } from './types'
import { constraintsReferencing, solvePlan, type DragTarget, type FurnitureDrag, type SolveReport } from './constraints'
import { dist, findRooms, projectOnSegment, wallLength, wallsAtPoint, type WallSide } from './geometry'
import { exampleProject } from './example'
import { defaultFloorName, floorElevation, newProject, normalizeProject, type Floor, type Project, type ProjectMeta, type Roof, type Underlay } from './project'
import { addFile, newFileKey, rasterize, removeFile } from '../files/planFiles'
import { deleteProjectFile, putProjectFile } from '../sync/api'
import type { Units } from './units'
import type { Season, Site } from './sun'
import { applyOps, diffProjects, floorsTouched, type Op, type Peer, type Presence } from './collab'
import { CUSTOM_CATEGORY, type CatalogItem } from '../furniture/catalog'
import { deleteModelBlobs, getModelBlobs, loadCustomModelMeta, newModelKey, parseModelFile, putModelBlobs, registerModelUrls, saveCustomModelMeta, unregisterModelUrls, type CustomModel } from '../furniture/customModels'
import { renderModelIcons } from '../furniture/renderIcon'
import { ConflictError, deleteRemoteModel, deleteRemoteProject, fetchMe, getRemoteModelFile, getRemoteProject, getViewedProject, listRemoteModels, listRemoteProjects, putRemoteModelFile, putRemoteModelMeta, putRemoteProject, signOut as apiSignOut, type AccountUser, type Person, type RemoteProjectMeta } from '../sync/api'

export type Tool = 'select' | 'wall' | 'door' | 'window' | 'furniture' | 'pan' | 'comment'
export type ViewMode = 'plan' | '3d' | 'walk'

/** rooms are derived from the walls; their id is the sorted list of their corner ids, so it survives until a corner goes */
export type SelectionItem = { kind: 'point' | 'wall' | 'opening' | 'furniture' | 'room'; id: string }

interface Snapshot {
  project: Project
  activeFloorId: string
}

export type SyncStatus = 'offline' | 'idle' | 'syncing' | 'synced' | 'error' | 'conflict'

/** a project edited here and, in the meantime, saved by someone else (or by you on another device) */
export interface SyncConflict {
  projectId: string
  name: string
  /** this device's version, with the unsaved edits */
  local: Project
  remote: Project
  remoteVersion: number
  remoteUpdatedAt: number
  updatedBy: Person | null
}
export type ConflictChoice = 'overwrite' | 'duplicate' | 'theirs'

/** state of the live-collaboration connection for the open project */
export interface LiveState {
  status: 'off' | 'connecting' | 'on'
  /** our own peer id in the room */
  you: string | null
  peers: Peer[]
  presence: Record<string, Presence>
}

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
  /** projects whose account copy diverged from the local edits; the first one is shown in a dialog */
  conflicts: SyncConflict[]
  /** true while the user chose "decide later" on the current conflict */
  conflictHidden: boolean
  setConflictHidden: (v: boolean) => void
  resolveConflict: (projectId: string, choice: ConflictChoice) => Promise<void>
  /** short transient message (e.g. "updated by …") */
  notice: string | null
  setNotice: (n: string | null) => void
  /** refresh sharing info of a project after inviting or removing people */
  refreshProjectMeta: (id: string) => Promise<void>
  live: LiveState
  setLive: (patch: Partial<LiveState>) => void
  /** set while looking at a project through an "anyone with the link can view" link */
  viewLink: { token: string; owner: Person } | null
  /** load the project behind a view link into the editor, read-only, without touching the local project list */
  openViewLink: (token: string) => Promise<void>
  /** leave view-link mode and go back to the local projects */
  closeViewLink: () => void
  /** apply operations received from the room; the caller holds them back while a drag is in progress */
  applyRemoteOps: (ops: Op[]) => void
  /** take the room's copy of a project as the local one (no undo entry, keeps the view) */
  adoptRoomProject: (project: Project, version: number) => void
  /** the room wrote the project to the account */
  markSaved: (projectId: string, version: number, updatedAt: number) => void
  /** report a diverging room copy (offline edits on top of an older version) */
  reportConflict: (c: SyncConflict) => void

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
  /** on narrow screens the side panels are drawers over the canvas */
  drawer: 'left' | 'right' | null
  setDrawer: (d: 'left' | 'right' | null) => void
  /** models imported by the user (metadata; files live in IndexedDB and, when signed in, in the account) */
  customModels: CustomModel[]
  /** load imported models from the browser and expose their files */
  loadCustomModels: () => Promise<void>
  importModel: (file: File, name: string, unitScale: number) => Promise<CustomModel>
  deleteCustomModel: (key: string) => Promise<void>
  /** catalogue lookup covering bundled and imported models */
  catalogItem: (key: string) => CatalogItem | undefined
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
  /** apply the same patch to several walls / openings / pieces in one undo step */
  updateWalls: (ids: string[], patch: Partial<Wall>) => void
  updateOpenings: (ids: string[], patch: Partial<Opening>) => void
  updateFurniturePieces: (ids: string[], patch: Partial<Furniture>) => void
  updatePoint: (id: string, patch: Partial<PlanPoint>) => void
  addFurniture: (catalogKey: string, pos: Vec2, angle: number) => string | null
  updateFurniture: (id: string, patch: Partial<Furniture>) => void
  /** set a wall length; with `side` the value is the face-to-face length on that side */
  setWallLength: (wallId: string, value: number, lock: boolean, side?: WallSide) => void
  addConstraint: (c: ConstraintInput) => void
  /** name a room (a label pinned at its centroid; an empty name removes it) */
  nameRoom: (room: Room, name: string) => void
  /** floor and wall finishes of a room (label created on demand); undefined resets to the default */
  setRoomFinish: (room: Room | Room[], patch: { floor?: string; wall?: string }) => void
  setProjectFinishes: (patch: { exterior?: string; roof?: string }) => void
  // comments pinned on the plan
  addComment: (pos: Vec2, text: string) => string | null
  replyComment: (id: string, text: string) => void
  setCommentResolved: (id: string, resolved: boolean) => void
  deleteComment: (id: string) => void
  /** thread open in the editor */
  openComment: string | null
  setOpenComment: (id: string | null) => void
  showResolved: boolean
  setShowResolved: (v: boolean) => void
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
  /** underlay image of the active floor */
  setUnderlay: (patch: Partial<Underlay> | null) => void
  /** import an image or PDF as the active floor's underlay */
  importUnderlay: (file: File) => Promise<void>
  /** two clicks on the underlay and a typed distance set its scale */
  calibrating: { a: Vec2 | null } | null
  setCalibrating: (v: { a: Vec2 | null } | null) => void
  /** location and orientation of the building; null removes it */
  setSite: (site: Site | null) => void
  /** moment shown by the sun in 3D (a view setting, not part of the project) */
  sun: { season: Season; hour: number }
  setSun: (patch: Partial<{ season: Season; hour: number }>) => void
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

/** counts local edits so a push can tell whether more edits happened while it was in flight */
let editSeq = 0
/** record a project in the index; `edited` marks it as carrying local changes not yet saved to the account */
function updateIndex(project: Project, list: ProjectMeta[], edited = false): ProjectMeta[] {
  if (edited) editSeq++
  const prev = list.find((p) => p.id === project.id)
  const meta: ProjectMeta = { ...prev, id: project.id, name: project.name, updatedAt: project.updatedAt, dirty: edited || prev?.dirty }
  const next = prev ? list.map((p) => (p.id === project.id ? meta : p)) : [...list, meta]
  writeIndex({ activeId: project.id, list: next })
  return next
}

function patchMeta(list: ProjectMeta[], id: string, patch: Partial<ProjectMeta>): ProjectMeta[] {
  return list.map((p) => (p.id === id ? { ...p, ...patch } : p))
}

function metaFromRemote(r: RemoteProjectMeta): Pick<ProjectMeta, 'role' | 'owner' | 'updatedBy' | 'memberCount' | 'viewToken'> {
  return { role: r.role, owner: r.owner, updatedBy: r.updatedBy, memberCount: r.memberCount, viewToken: r.viewToken }
}

export function personLabel(p: Person | null | undefined): string {
  if (!p) return 'someone'
  return p.name ? `${p.name} (${p.email})` : p.email
}

export function normalizePlan(raw: Partial<Plan>): Plan {
  const base = emptyPlan()
  return {
    points: raw.points ?? {},
    walls: raw.walls ?? {},
    openings: raw.openings ?? {},
    furniture: raw.furniture ?? {},
    constraints: raw.constraints ?? {},
    rooms: raw.rooms ?? {},
    comments: raw.comments ?? {},
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
  const rooms: Plan['rooms'] = {}
  for (const r of Object.values(plan.rooms ?? {})) {
    const id = newId('rm')
    rooms[id] = { ...r, id }
  }
  return { ...plan, points, walls, openings, furniture, constraints, rooms, comments: {} }
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
  const readOnly = () => isReadOnly(get())
  /** who signs comments: the account, or "Me" when working locally */
  const author = (): Author => {
    const u = get().user
    return u ? { name: u.name || u.email, email: u.email } : { name: 'Me', email: '' }
  }
  /** structural project change with an undo entry; re-solves the active floor */
  const commitProject = (nextProject: Project, activeFloorId = get().activeFloorId, extra: Partial<EditorState> = {}) => {
    if (readOnly()) return
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
      projects: updateIndex(withSolved, get().projects, true),
      ...extra,
    })
    scheduleSave(withSolved)
  }
  const restore = (snapshot: Snapshot) => {
    if (readOnly()) return
    const solvedFloor = solvePlan(activePlan(snapshot.project, snapshot.activeFloorId))
    const project = withFloorPlan(snapshot.project, snapshot.activeFloorId, solvedFloor.plan)
    set({ project, activeFloorId: snapshot.activeFloorId, plan: solvedFloor.plan, report: solvedFloor.report, selection: [], projects: updateIndex(project, get().projects, true) })
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
  /** swap in a newer account copy of the open project without losing the view or the active floor */
  const replaceOpenProject = (project: Project) => {
    const { activeFloorId } = get()
    const floorId = project.floors.some((f) => f.id === activeFloorId) ? activeFloorId : project.floors[0].id
    const solvedFloor = solvePlan(activePlan(project, floorId))
    const withSolved = withFloorPlan(project, floorId, solvedFloor.plan)
    set({ project: withSolved, activeFloorId: floorId, plan: solvedFloor.plan, report: solvedFloor.report, undoStack: [], redoStack: [], selection: [], projects: get().viewLink ? get().projects : updateIndex(withSolved, get().projects), placing: null })
    if (!get().viewLink) saveProjectNow(withSolved)
  }

  const saveModels = (list: CustomModel[]) => {
    saveCustomModelMeta(list)
    set({ customModels: list })
  }
  const uploadModel = async (meta: CustomModel) => {
    const blobs = await getModelBlobs(meta.key)
    if (!blobs) return
    await putRemoteModelMeta({ key: meta.key, name: meta.name, width: meta.width, depth: meta.depth, height: meta.height, fit: meta.fit, createdAt: meta.createdAt })
    await putRemoteModelFile(meta.key, 'glb', blobs.glb)
    await putRemoteModelFile(meta.key, 'plan', blobs.plan)
    await putRemoteModelFile(meta.key, 'thumb', blobs.thumb)
  }
  /** copy models both ways so the same catalogue is available on every device */
  const syncModels = async () => {
    const { storage, models: remote } = await listRemoteModels()
    if (!storage) return // the worker has no R2 bucket: models stay in this browser
    const local = get().customModels
    const localKeys = new Set(local.map((m) => m.key))
    const list = [...local]
    for (const r of remote) {
      if (localKeys.has(r.key)) continue
      const [glbBlob, plan, thumb] = await Promise.all([getRemoteModelFile(r.key, 'glb'), getRemoteModelFile(r.key, 'plan'), getRemoteModelFile(r.key, 'thumb')])
      const blobs = { glb: await glbBlob.arrayBuffer(), plan, thumb }
      await putModelBlobs(r.key, blobs)
      await registerModelUrls(r.key, blobs)
      list.push({ key: r.key, name: r.name, category: CUSTOM_CATEGORY, width: r.width, depth: r.depth, height: r.height, elevation: 0, creator: 'me', license: 'own', library: 'imported', fit: r.fit, createdAt: r.createdAt })
    }
    saveModels(list)
    const remoteKeys = new Set(remote.map((m) => m.key))
    for (const m of local) if (!remoteKeys.has(m.key)) await uploadModel(m)
  }

  const metaOf = (id: string) => get().projects.find((p) => p.id === id)
  const setMeta = (id: string, patch: Partial<ProjectMeta>) => {
    const list = patchMeta(get().projects, id, patch)
    writeIndex({ activeId: get().project.id, list })
    set({ projects: list })
  }
  const addConflict = (c: SyncConflict) => {
    if (get().conflicts.some((x) => x.projectId === c.projectId)) set({ conflicts: get().conflicts.map((x) => (x.projectId === c.projectId ? c : x)), syncStatus: 'conflict' })
    else set({ conflicts: [...get().conflicts, c], conflictHidden: false, syncStatus: 'conflict' })
  }
  const dropConflict = (projectId: string) => {
    const conflicts = get().conflicts.filter((c) => c.projectId !== projectId)
    set({ conflicts, syncStatus: conflicts.length ? 'conflict' : 'synced' })
  }

  /** the same content on both sides (timestamps aside) is not a divergence, whatever the versions say */
  const sameContent = (a: Project, b: Project) => diffProjects(a, b).length === 0
  /** one save at a time per project: a second request would race the first one and trip the version check */
  const pushing = new Map<string, Promise<void>>()
  const pushAgain = new Set<string>()
  /** save one project to the account on top of the version this device last synced */
  const push = (project: Project, force = false): Promise<void> => {
    const inFlight = pushing.get(project.id)
    if (inFlight) {
      pushAgain.add(project.id) // run once more with the latest copy when this one is done
      return inFlight
    }
    const run = pushNow(project, force).finally(() => {
      pushing.delete(project.id)
      if (pushAgain.delete(project.id)) {
        const latest = get().project.id === project.id ? get().project : loadProject(project.id)
        if (latest && metaOf(project.id)?.dirty) void push(latest)
      }
    })
    pushing.set(project.id, run)
    return run
  }
  const pushNow = async (project: Project, force: boolean) => {
    if (!get().user) return
    if (!force && get().conflicts.some((c) => c.projectId === project.id)) return // paused until the user decides
    if (!force && get().live.status === 'on' && project.id === get().project.id) return // the live room saves for us
    const meta = metaOf(project.id)
    const seqAtStart = editSeq
    set({ syncStatus: 'syncing' })
    try {
      const r = await putRemoteProject(project, meta?.syncedVersion ?? 0, force)
      // edits made while the request was in flight keep the project dirty; the pending timer pushes them next
      const stillEditing = editSeq !== seqAtStart
      setMeta(project.id, { syncedVersion: r.version, dirty: stillEditing, role: meta?.role ?? 'owner', updatedBy: get().user ? { email: get().user!.email, name: get().user!.name } : null })
      if (force) dropConflict(project.id)
      else set({ syncStatus: get().conflicts.length ? 'conflict' : 'synced' })
    } catch (e) {
      if (e instanceof ConflictError) {
        const remote = normalizeProject(e.remote.project, normalizePlan)
        if (sameContent(remote, project)) {
          // the account already holds exactly this (e.g. an earlier save of ours landed): just adopt the version
          setMeta(project.id, { syncedVersion: e.remote.version, dirty: editSeq !== seqAtStart, updatedBy: e.remote.updatedBy })
          set({ syncStatus: get().conflicts.length ? 'conflict' : 'synced' })
          return
        }
        addConflict({ projectId: project.id, name: project.name, local: project, remote, remoteVersion: e.remote.version, remoteUpdatedAt: e.remote.updatedAt, updatedBy: e.remote.updatedBy })
      } else set({ syncStatus: 'error' })
    }
  }
  pushProject = (project) => void push(project)

  /** copy the account's version of a project into local storage (and into the editor when it is open) */
  const download = async (r: RemoteProjectMeta) => {
    const remote = await getRemoteProject(r.id)
    const project = normalizeProject(remote.project, normalizePlan)
    saveProjectNow(project)
    const meta: ProjectMeta = { id: project.id, name: project.name, updatedAt: project.updatedAt, syncedVersion: remote.version, dirty: false, ...metaFromRemote(r) }
    const list = get().projects.some((p) => p.id === project.id) ? get().projects.map((p) => (p.id === project.id ? meta : p)) : [...get().projects, meta]
    set({ projects: list })
    writeIndex({ activeId: get().project.id, list })
    if (project.id === get().project.id) replaceOpenProject(project)
    return project
  }

  let merging = false
  /**
   * Reconcile the account's projects with the local ones using versions:
   * new remote projects are downloaded, local edits on the synced version are pushed,
   * a newer remote copy replaces an unedited local one, and a newer remote copy on top of local edits is a conflict.
   * `quiet` (periodic polling) leaves the status indicator alone when there is nothing to do.
   */
  const mergeWithRemote = async (quiet = false) => {
    if (merging) return
    merging = true
    if (!quiet) set({ syncStatus: 'syncing' })
    try {
      // a save in flight would make the versions below stale
      await Promise.all([...pushing.values()])
      const remote = await listRemoteProjects()
      const remoteById = new Map(remote.map((r) => [r.id, r]))
      const notices: string[] = []
      for (const r of remote) {
        const meta = metaOf(r.id)
        const local = meta ? loadProject(r.id) : null
        if (!meta || !local) {
          await download(r)
          continue
        }
        setMeta(r.id, metaFromRemote(r))
        if (meta.syncedVersion === undefined) {
          // synced before versions existed: keep the newer copy, as before
          if (local.updatedAt < r.updatedAt) await download(r)
          else await push(local, true)
          continue
        }
        const isOpen = r.id === get().project.id
        if (isOpen && get().live.status === 'on') continue // the live room keeps this one in sync
        const editingHere = isOpen && get().dragSnapshot
        if (r.version > meta.syncedVersion) {
          if (meta.dirty) {
            const remoteProject = await getRemoteProject(r.id)
            const remote = normalizeProject(remoteProject.project, normalizePlan)
            const current = (isOpen ? get().project : local) ?? local
            if (sameContent(remote, current)) setMeta(r.id, { syncedVersion: r.version, dirty: false })
            else addConflict({ projectId: r.id, name: local.name, local: current, remote, remoteVersion: r.version, remoteUpdatedAt: r.updatedAt, updatedBy: r.updatedBy })
          } else if (!editingHere) {
            await download(r)
            if (quiet) notices.push(`“${r.name}” was updated by ${personLabel(r.updatedBy)}`)
          }
        } else if (meta.dirty && !get().conflicts.some((c) => c.projectId === r.id)) await push(local)
      }
      for (const meta of [...get().projects]) {
        if (remoteById.has(meta.id)) continue
        const local = loadProject(meta.id)
        if (!local) continue
        if (meta.syncedVersion === undefined) {
          await push(local) // never on the account yet
        } else if (meta.dirty && meta.role !== 'editor') {
          setMeta(meta.id, { syncedVersion: undefined })
          await push(local) // deleted elsewhere but edited here: keep it
        } else {
          // deleted by its owner, or you were removed from it
          removeLocalProject(meta.id)
          notices.push(meta.role === 'editor' ? `“${meta.name}” is no longer shared with you` : `“${meta.name}” was deleted on another device`)
        }
      }
      if (notices.length) set({ notice: notices.join(' · ') })
      if (get().syncStatus !== 'error' || !quiet) set({ syncStatus: get().conflicts.length ? 'conflict' : 'synced' })
    } catch {
      if (!quiet) set({ syncStatus: 'error' })
    } finally {
      merging = false
    }
  }

  const removeLocalProject = (id: string) => {
    const list = get().projects.filter((p) => p.id !== id)
    if (hasStorage()) {
      try {
        localStorage.removeItem(projectKey(id))
      } catch {
        // ignore
      }
    }
    if (id === get().project.id) {
      const nextId = list[0]?.id
      const next = (nextId && loadProject(nextId)) || newProject('Project 1')
      set({ projects: list })
      openProjectState(next)
    } else {
      set({ projects: list })
      writeIndex({ activeId: get().project.id, list })
    }
  }

  let pollTimer: ReturnType<typeof setInterval> | null = null
  /** look for changes made elsewhere every 30 s and whenever the tab comes back into view */
  const startPolling = () => {
    if (pollTimer || typeof window === 'undefined') return
    const poll = () => {
      if (get().user && document.visibilityState === 'visible') void mergeWithRemote(true)
    }
    pollTimer = setInterval(poll, 30_000)
    window.addEventListener('focus', poll)
    document.addEventListener('visibilitychange', poll)
  }

  return {
    user: undefined,
    apiAvailable: undefined,
    syncStatus: 'offline',
    initAccount: async () => {
      try {
        const user = await fetchMe()
        set({ user, apiAvailable: true, syncStatus: user ? 'idle' : 'offline' })
        if (user) {
          await mergeWithRemote()
          await syncModels().catch(() => set({ syncStatus: 'error' }))
          startPolling()
        }
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
      if (get().user) {
        await mergeWithRemote()
        await syncModels().catch(() => set({ syncStatus: 'error' }))
      }
    },
    conflicts: [],
    conflictHidden: false,
    setConflictHidden: (conflictHidden) => set({ conflictHidden }),
    resolveConflict: async (projectId, choice) => {
      const c = get().conflicts.find((x) => x.projectId === projectId)
      if (!c) return
      // edits may have continued since the conflict was detected: resolve with the latest local copy
      const local = (get().project.id === projectId ? get().project : loadProject(projectId)) ?? c.local
      const takeTheirs = () => {
        saveProjectNow(c.remote)
        setMeta(projectId, { syncedVersion: c.remoteVersion, dirty: false, updatedBy: c.updatedBy, name: c.remote.name, updatedAt: c.remote.updatedAt })
        if (get().project.id === projectId) replaceOpenProject(c.remote)
      }
      if (choice === 'overwrite') {
        await push(local, true)
        return
      }
      if (choice === 'theirs') {
        takeTheirs()
        dropConflict(projectId)
        return
      }
      // duplicate: your edits continue in a project of your own, the shared one takes their version
      const copy: Project = { ...local, id: newId('prj'), name: `${local.name} (my copy)`, createdAt: Date.now(), updatedAt: Date.now() }
      saveProjectNow(copy)
      set({ projects: [...get().projects, { id: copy.id, name: copy.name, updatedAt: copy.updatedAt, dirty: true, role: 'owner' }] })
      const wasOpen = get().project.id === projectId
      takeTheirs()
      dropConflict(projectId)
      if (wasOpen) openProjectState(copy)
      else writeIndex({ activeId: get().project.id, list: get().projects })
      await push(copy)
    },
    notice: null,
    setNotice: (notice) => set({ notice }),
    live: { status: 'off', you: null, peers: [], presence: {} },
    setLive: (patch) => set({ live: { ...get().live, ...patch } }),
    applyRemoteOps: (ops) => {
      if (!ops.length) return
      const { project, activeFloorId, undoStack, redoStack } = get()
      let next = applyOps(project, ops)
      const touched = floorsTouched(ops)
      const floorId = next.floors.some((f) => f.id === activeFloorId) ? activeFloorId : next.floors[0].id
      let plan = get().plan
      let report = get().report
      if (touched === 'all' || touched.has(floorId) || floorId !== activeFloorId) {
        const solved = solvePlan(activePlan(next, floorId))
        next = withFloorPlan(next, floorId, solved.plan)
        plan = solved.plan
        report = solved.report
      }
      let roomIds: Set<string> | null = null
      const exists = (s: SelectionItem) => {
        if (s.kind === 'room') return (roomIds ??= new Set(findRooms(plan).map((r) => r.id))).has(s.id)
        return s.kind === 'point' ? !!plan.points[s.id] : s.kind === 'wall' ? !!plan.walls[s.id] : s.kind === 'furniture' ? !!plan.furniture[s.id] : !!plan.openings[s.id]
      }
      // rebase the undo history so undoing your own step does not revert other people's edits
      set({
        project: next,
        activeFloorId: floorId,
        plan,
        report,
        selection: get().selection.filter(exists),
        undoStack: undoStack.map((u) => ({ ...u, project: applyOps(u.project, ops) })),
        redoStack: redoStack.map((u) => ({ ...u, project: applyOps(u.project, ops) })),
        projects: get().viewLink ? get().projects : updateIndex(next, get().projects),
      })
      if (!get().viewLink) saveProjectNow(next)
    },
    adoptRoomProject: (project, version) => {
      if (!get().viewLink) {
        saveProjectNow(project)
        setMeta(project.id, { syncedVersion: version, dirty: false, name: project.name, updatedAt: project.updatedAt })
      }
      if (get().project.id === project.id) replaceOpenProject(project)
    },
    viewLink: null,
    openViewLink: async (token) => {
      const r = await getViewedProject(token)
      const project = normalizeProject(r.project, normalizePlan)
      const floorId = project.floors[0].id
      const solvedFloor = solvePlan(activePlan(project, floorId))
      set({ viewLink: { token, owner: r.owner }, project: withFloorPlan(project, floorId, solvedFloor.plan), activeFloorId: floorId, plan: solvedFloor.plan, report: solvedFloor.report, undoStack: [], redoStack: [], selection: [], tool: 'select', placing: null, fitVersion: get().fitVersion + 1 })
    },
    closeViewLink: () => {
      if (!get().viewLink) return
      set({ viewLink: null })
      const index = loadIndex()
      openProjectState((index.activeId && loadProject(index.activeId)) || (index.list[0] && loadProject(index.list[0].id)) || exampleProject())
    },
    markSaved: (projectId, version, updatedAt) => {
      if (get().viewLink) return // a link viewer keeps nothing locally
      const u = get().user
      setMeta(projectId, { syncedVersion: version, dirty: false, updatedAt, updatedBy: u ? { email: u.email, name: u.name } : null })
      if (get().syncStatus !== 'conflict' && get().syncStatus !== 'error') set({ syncStatus: 'synced' })
    },
    reportConflict: (c) => addConflict(c),
    refreshProjectMeta: async (id) => {
      const remote = await listRemoteProjects()
      const r = remote.find((p) => p.id === id)
      if (r) setMeta(id, metaFromRemote(r))
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
    drawer: null,
    setDrawer: (drawer) => set({ drawer }),
    customModels: [],
    loadCustomModels: async () => {
      const list = loadCustomModelMeta()
      const loaded: CustomModel[] = []
      for (const m of list) {
        try {
          const blobs = await getModelBlobs(m.key)
          if (blobs) {
            await registerModelUrls(m.key, blobs)
            loaded.push(m)
          }
        } catch {
          // skip unreadable entries
        }
      }
      set({ customModels: loaded })
    },
    importModel: async (file, name, unitScale) => {
      const buffer = await file.arrayBuffer()
      const parsed = await parseModelFile(buffer, unitScale)
      const icons = await renderModelIcons(parsed.object, parsed.width, parsed.depth, parsed.height)
      const key = newModelKey()
      const meta: CustomModel = {
        key,
        name: name.trim() || file.name.replace(/\.(glb|gltf)$/i, ''),
        category: CUSTOM_CATEGORY,
        width: +parsed.width.toFixed(4),
        depth: +parsed.depth.toFixed(4),
        height: +parsed.height.toFixed(4),
        elevation: 0,
        creator: 'me',
        license: 'own',
        library: 'imported',
        fit: parsed.fit,
        createdAt: Date.now(),
      }
      const blobs = { glb: buffer, plan: icons.plan, thumb: icons.thumb }
      await putModelBlobs(key, blobs)
      await registerModelUrls(key, blobs)
      saveModels([...get().customModels, meta])
      if (get().user) uploadModel(meta).catch(() => set({ syncStatus: 'error' }))
      return meta
    },
    deleteCustomModel: async (key) => {
      unregisterModelUrls(key)
      await deleteModelBlobs(key).catch(() => undefined)
      saveModels(get().customModels.filter((m) => m.key !== key))
      if (get().user) deleteRemoteModel(key).catch(() => set({ syncStatus: 'error' }))
    },
    catalogItem: (key) => CATALOG_BY_KEY[key] ?? get().customModels.find((m) => m.key === key),
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

    setTool: (tool) => set({ tool: readOnly() && tool !== 'pan' ? 'select' : tool, selection: tool === 'select' ? get().selection : [], placing: tool === 'furniture' ? get().placing : null, railTab: tool === 'furniture' ? 'furniture' : get().railTab }),
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
      if (readOnly()) return
      const { project, activeFloorId } = get()
      const { plan: solvedPlan, report } = solvePlan(plan)
      const undoStack = [...get().undoStack, { project, activeFloorId }].slice(-MAX_UNDO)
      let roomIds: Set<string> | null = null
      const selection = get().selection.filter((s) => {
        if (s.kind === 'point') return !!solvedPlan.points[s.id]
        if (s.kind === 'wall') return !!solvedPlan.walls[s.id]
        if (s.kind === 'furniture') return !!solvedPlan.furniture[s.id]
        if (s.kind === 'room') return (roomIds ??= new Set(findRooms(solvedPlan).map((r) => r.id))).has(s.id)
        return !!solvedPlan.openings[s.id]
      })
      const nextProject = withFloorPlan(project, activeFloorId, solvedPlan)
      set({ project: nextProject, plan: solvedPlan, report, undoStack, redoStack: [], selection, projects: updateIndex(nextProject, get().projects, true) })
      scheduleSave(nextProject)
    },

    beginDrag: () => {
      if (readOnly()) return
      set({ dragSnapshot: { project: get().project, activeFloorId: get().activeFloorId } })
    },
    dragTo: (drags) => {
      if (!get().dragSnapshot) return
      const { plan: solvedPlan, report } = solvePlan(get().plan, drags)
      applyPlan(solvedPlan, report)
    },
    dragOpening: (openingId, offset) => {
      if (!get().dragSnapshot) return
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
      if (!get().dragSnapshot) return
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
        set({ undoStack: [...get().undoStack, snapshot].slice(-MAX_UNDO), redoStack: [], dragSnapshot: null, projects: updateIndex(project, get().projects, true) })
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
    updateWalls: (ids, patch) => {
      const plan = get().plan
      const walls = { ...plan.walls }
      let changed = false
      for (const id of ids) if (walls[id]) (walls[id] = { ...walls[id], ...patch }), (changed = true)
      if (changed) get().commit({ ...plan, walls })
    },
    updateOpenings: (ids, patch) => {
      const plan = get().plan
      const openings = { ...plan.openings }
      let changed = false
      for (const id of ids) if (openings[id]) (openings[id] = { ...openings[id], ...patch }), (changed = true)
      if (changed) get().commit({ ...plan, openings })
    },
    updateFurniturePieces: (ids, patch) => {
      const plan = get().plan
      const furniture = { ...plan.furniture }
      let changed = false
      for (const id of ids) if (furniture[id]) (furniture[id] = { ...furniture[id], ...patch }), (changed = true)
      if (changed) get().commit({ ...plan, furniture })
    },
    updatePoint: (id, patch) => {
      const plan = get().plan
      if (!plan.points[id]) return
      get().commit({ ...plan, points: { ...plan.points, [id]: { ...plan.points[id], ...patch } } })
    },

    addFurniture: (catalogKey, pos, angle) => {
      const item = get().catalogItem(catalogKey)
      if (!item) return null
      const plan = get().plan
      // a flight of stairs climbs to the floor above: floor height plus the slab
      const height = catalogKey === 'sys-stairs' ? plan.settings.wallHeight + get().project.slabThickness : item.height
      const id = newId('f')
      const piece: Furniture = { id, catalogKey, name: item.name, x: pos.x, y: pos.y, angle, width: item.width, depth: item.depth, height, elevation: item.elevation }
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
    setRoomFinish: (room, patch) => {
      const plan = get().plan
      const rooms = { ...plan.rooms }
      for (const r of Array.isArray(room) ? room : [room]) {
        const existing = roomLabel(plan, r)
        const label = existing ? { ...existing, ...patch } : { id: newId('rm'), name: '', x: r.centroid.x, y: r.centroid.y, ...patch }
        for (const k of ['floor', 'wall'] as const) if (label[k] === undefined) delete label[k]
        rooms[label.id] = label
      }
      get().commit({ ...plan, rooms })
    },
    setProjectFinishes: (patch) => {
      const { project } = get()
      const finishes = { ...(project.finishes ?? {}), ...patch }
      commitProject({ ...project, finishes })
    },
    addComment: (pos, text) => {
      const body = text.trim().slice(0, 2000)
      if (!body || readOnly()) return null
      const plan = get().plan
      const id = newId('cm')
      get().commit({ ...plan, comments: { ...plan.comments, [id]: { id, x: pos.x, y: pos.y, text: body, author: author(), createdAt: Date.now(), replies: [] } } })
      return id
    },
    replyComment: (id, text) => {
      const body = text.trim().slice(0, 2000)
      const plan = get().plan
      const c = plan.comments[id]
      if (!body || !c) return
      get().commit({ ...plan, comments: { ...plan.comments, [id]: { ...c, replies: [...c.replies, { id: newId('cr'), text: body, author: author(), createdAt: Date.now() }] } } })
    },
    setCommentResolved: (id, resolved) => {
      const plan = get().plan
      const c = plan.comments[id]
      if (!c) return
      get().commit({ ...plan, comments: { ...plan.comments, [id]: { ...c, resolved } } })
    },
    deleteComment: (id) => {
      const plan = get().plan
      if (!plan.comments[id]) return
      const comments = { ...plan.comments }
      delete comments[id]
      if (get().openComment === id) set({ openComment: null })
      get().commit({ ...plan, comments })
    },
    openComment: null,
    setOpenComment: (openComment) => set({ openComment }),
    showResolved: false,
    setShowResolved: (showResolved) => set({ showResolved }),
    nameRoom: (room, name) => {
      const plan = get().plan
      const existing = roomLabel(plan, room)
      const rooms = { ...plan.rooms }
      if (!name.trim()) {
        if (!existing) return
        delete rooms[existing.id]
      } else if (existing) rooms[existing.id] = { ...existing, name: name.trim() }
      else {
        const id = newId('rm')
        rooms[id] = { id, name: name.trim(), x: room.centroid.x, y: room.centroid.y }
      }
      get().commit({ ...plan, rooms })
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
      const underlay = project.floors[idx].underlay
      if (underlay) {
        void removeFile(underlay.key)
        if (get().user && !get().viewLink) void deleteProjectFile(project.id, underlay.key).catch(() => undefined)
      }
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
    setUnderlay: (patch) => {
      const { project, activeFloorId } = get()
      const floor = project.floors.find((f) => f.id === activeFloorId)
      if (!floor) return
      if (patch === null) {
        if (!floor.underlay) return
        const key = floor.underlay.key
        void removeFile(key)
        if (get().user && !get().viewLink) void deleteProjectFile(project.id, key).catch(() => undefined)
        const { underlay: _drop, ...rest } = floor
        void _drop
        commitProject({ ...project, floors: project.floors.map((f) => (f.id === floor.id ? rest : f)) })
        return
      }
      if (!floor.underlay) return
      commitProject({ ...project, floors: project.floors.map((f) => (f.id === floor.id ? { ...f, underlay: { ...floor.underlay!, ...patch } } : f)) })
    },
    importUnderlay: async (file) => {
      if (readOnly()) return
      const { blob, width, height } = await rasterize(file)
      const key = newFileKey()
      await addFile(key, blob)
      const { project, activeFloorId, plan } = get()
      const floor = project.floors.find((f) => f.id === activeFloorId)
      if (!floor) return
      // start at a plausible size (12 m across) centred on the existing plan, or at the origin
      const scale = 12 / Math.max(width, height)
      const pts = Object.values(plan.points)
      const cx = pts.length ? pts.reduce((a, p) => a + p.x, 0) / pts.length : 6
      const cy = pts.length ? pts.reduce((a, p) => a + p.y, 0) / pts.length : 4
      const underlay: Underlay = { key, name: file.name, width, height, scale, x: cx - (width * scale) / 2, y: cy - (height * scale) / 2, rotation: 0, opacity: 0.6, locked: false }
      if (floor.underlay) void removeFile(floor.underlay.key)
      commitProject({ ...project, floors: project.floors.map((f) => (f.id === floor.id ? { ...f, underlay } : f)) })
      if (get().user && !get().viewLink) await putProjectFile(project.id, key, blob).catch(() => set({ notice: 'The underlay stays on this device: it could not be uploaded to the account.' }))
    },
    calibrating: null,
    setCalibrating: (calibrating) => set({ calibrating }),
    setSite: (site) => {
      const { project } = get()
      const next = { ...project }
      if (site) next.site = site
      else delete next.site
      commitProject(next)
    },
    sun: { season: 'summer', hour: 14 },
    setSun: (patch) => set({ sun: { ...get().sun, ...patch } }),
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
    /** owners delete the project for everyone; invited editors leave it */
    deleteProject: (id) => {
      if (get().user) void deleteRemoteProject(id).catch(() => set({ syncStatus: 'error' }))
      dropConflict(id)
      removeLocalProject(id)
    },
    importProject: (raw) => {
      const project = normalizeProject(raw, normalizePlan)
      // imported projects get a fresh id so they never clobber an existing one
      openProjectState({ ...project, id: newId('prj') })
    },
    loadExample: () => openProjectState(exampleProject()),
  }
})

/** true when the open project must not be edited: a view link, or a project shared read-only */
export function isReadOnly(s: Pick<EditorState, 'viewLink' | 'projects' | 'project'>): boolean {
  if (s.viewLink) return true
  return s.projects.find((p) => p.id === s.project.id)?.role === 'viewer'
}

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
