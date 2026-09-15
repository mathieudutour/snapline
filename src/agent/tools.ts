/**
 * Tools an agent can call to build a floor plan: a small, high-level vocabulary (rooms, walls,
 * doors, windows, furniture, floors, roof, site) on top of the editor store. Exposed to the
 * browser through WebMCP (navigator.modelContext) and to scripts as window.snapline.tools.
 * Coordinates are metres on the plan: x to the right, y downwards, the top of the plan being the
 * side that faces the compass bearing `north` of the site.
 */
import { isReadOnly, useEditor, type SelectionItem } from '../model/store'
import { CATALOG } from '../furniture/catalog'
import { findRooms, wallLength } from '../model/geometry'
import { roomName, floorArea } from '../model/rooms'
import { snapFurnitureToWall } from '../model/furniture'
import { formatLength } from '../model/units'
import type { OpeningKind, Vec2 } from '../model/types'
import type { RoofType } from '../model/project'
import { navigate } from '../router'

export interface AgentTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  execute: (input: Record<string, unknown>) => Promise<unknown> | unknown
}

const st = () => useEditor.getState()
const num = (v: unknown, name: string, fallback?: number): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (fallback !== undefined) return fallback
  throw new Error(`${name} must be a number`)
}
const str = (v: unknown, name: string, fallback?: string): string => {
  if (typeof v === 'string' && v.trim()) return v.trim()
  if (fallback !== undefined) return fallback
  throw new Error(`${name} must be a non-empty string`)
}

function ensureEditable() {
  if (isReadOnly(st())) throw new Error('this project is read-only (shared with you as a viewer or opened through a view link)')
  if (location.pathname !== '/') navigate('/')
}

const EPS = 0.01

/** the id of an existing corner within a centimetre of `p`, so new walls join the plan */
function pointAt(p: Vec2): string | undefined {
  return Object.values(st().plan.points).find((q) => Math.hypot(q.x - p.x, q.y - p.y) < EPS)?.id
}

/** an existing wall that `p` lies on (not at its ends), so a new wall starting there splits it (T-junction) */
function wallUnder(p: Vec2): { wallId: string; t: number } | undefined {
  const plan = st().plan
  for (const w of Object.values(plan.walls)) {
    const a = plan.points[w.a]
    const b = plan.points[w.b]
    const ab = { x: b.x - a.x, y: b.y - a.y }
    const l2 = ab.x * ab.x + ab.y * ab.y
    if (!l2) continue
    const t = ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / l2
    if (t <= 0.001 || t >= 0.999) continue
    const d = Math.hypot(p.x - (a.x + ab.x * t), p.y - (a.y + ab.y * t))
    if (d < EPS) return { wallId: w.id, t }
  }
  return undefined
}

/** add one wall from a to b, joining existing corners and splitting walls it lands on */
function addSegment(a: Vec2, b: Vec2): string | null {
  const pa = pointAt(a)
  const pb = pointAt(b)
  // already there? (a wall between these two corners, either way round)
  if (pa && pb && Object.values(st().plan.walls).some((w) => (w.a === pa && w.b === pb) || (w.a === pb && w.b === pa))) return null
  return st().addWall({ pos: a, pointId: pa, wall: pa ? undefined : wallUnder(a) }, { pos: b, pointId: pb, wall: pb ? undefined : wallUnder(b) })
}

/** draw connected walls through the points (closed = back to the first) and return their ids.
 *  A segment passing over existing corners is split there, so rooms drawn side by side share walls
 *  instead of stacking overlapping ones. */
function polyline(points: Vec2[], closed: boolean, thickness?: number): string[] {
  const ids: string[] = []
  const segs = closed ? points.length : points.length - 1
  if (thickness) st().setSettings({ wallThickness: thickness })
  for (let i = 0; i < segs; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    const ab = { x: b.x - a.x, y: b.y - a.y }
    const l2 = ab.x * ab.x + ab.y * ab.y
    // corners already on the plan that lie strictly between a and b
    const through = Object.values(st().plan.points)
      .map((q) => ({ q, t: l2 ? ((q.x - a.x) * ab.x + (q.y - a.y) * ab.y) / l2 : 0 }))
      .filter(({ q, t }) => t > 0.001 && t < 0.999 && Math.hypot(q.x - (a.x + ab.x * t), q.y - (a.y + ab.y * t)) < EPS)
      .sort((m, n) => m.t - n.t)
      .map(({ q }) => ({ x: q.x, y: q.y }))
    const chain = [a, ...through, b]
    for (let k = 0; k < chain.length - 1; k++) {
      const id = addSegment(chain[k], chain[k + 1])
      if (id) ids.push(id)
    }
  }
  return ids
}

function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if (poly[i].y > p.y !== poly[j].y > p.y && p.x < ((poly[j].x - poly[i].x) * (p.y - poly[i].y)) / (poly[j].y - poly[i].y) + poly[i].x) c = !c
  return c
}

function floorByRef(ref: unknown) {
  const { project, activeFloorId } = st()
  if (ref === undefined || ref === null || ref === '') return project.floors.find((f) => f.id === activeFloorId)!
  const r = String(ref).toLowerCase()
  return project.floors.find((f) => f.id === ref || f.name.toLowerCase() === r) ?? project.floors[Number(ref)]
}

function wallByRef(ref: unknown, at?: Vec2) {
  const plan = st().plan
  if (typeof ref === 'string' && plan.walls[ref]) return plan.walls[ref]
  if (at) {
    let best: { id: string; d: number } | null = null
    for (const w of Object.values(plan.walls)) {
      const a = plan.points[w.a]
      const b = plan.points[w.b]
      const ab = { x: b.x - a.x, y: b.y - a.y }
      const l2 = ab.x * ab.x + ab.y * ab.y
      const t = l2 ? Math.max(0, Math.min(1, ((at.x - a.x) * ab.x + (at.y - a.y) * ab.y) / l2)) : 0
      const d = Math.hypot(at.x - (a.x + ab.x * t), at.y - (a.y + ab.y * t))
      if (!best || d < best.d) best = { id: w.id, d }
    }
    if (best && best.d < 1) return plan.walls[best.id]
  }
  throw new Error('wall not found: give a wallId from get_plan, or a point {x, y} on the wall')
}

function summary() {
  const { project, activeFloorId, units } = st()
  return {
    project: project.name,
    units,
    activeFloor: activeFloorId,
    site: project.site ?? null,
    roof: project.roof,
    floors: project.floors.map((f, index) => {
      const plan = f.plan
      const rooms = findRooms(plan)
      return {
        id: f.id,
        name: f.name,
        index,
        floorHeight: plan.settings.wallHeight,
        area: floorArea(rooms),
        rooms: rooms.map((r, i) => ({ name: roomName(plan, r, i), area: Math.round(r.area * 100) / 100, centroid: r.centroid, wallIds: Object.values(plan.walls).filter((w) => r.pointIds.includes(w.a) && r.pointIds.includes(w.b)).map((w) => w.id) })),
        walls: Object.values(plan.walls).map((w) => ({ id: w.id, from: plan.points[w.a], to: plan.points[w.b], length: Math.round(wallLength(plan, w) * 100) / 100, thickness: w.thickness, height: w.height })),
        openings: Object.values(plan.openings).map((o) => ({ id: o.id, kind: o.kind, wallId: o.wallId, offset: o.offset, width: o.width, height: o.height })),
        furniture: Object.values(plan.furniture).map((p) => ({ id: p.id, name: p.name, catalogKey: p.catalogKey, x: p.x, y: p.y, angle: p.angle, width: p.width, depth: p.depth })),
        comments: Object.values(plan.comments ?? {}).filter((c) => !c.resolved).map((c) => ({ id: c.id, text: c.text, x: c.x, y: c.y })),
      }
    }),
  }
}

const point = { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] }

export const TOOLS: AgentTool[] = [
  {
    name: 'get_plan',
    description: 'Read the whole project: floors, rooms (names, areas, centroids), walls with their end points and ids, doors and windows, furniture, site and roof. Call it first and after edits to see ids and check results. Coordinates are metres; y grows downwards on the plan.',
    inputSchema: { type: 'object', properties: {} },
    execute: () => summary(),
  },
  {
    name: 'new_project',
    description: 'Start a new empty project and make it current.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    execute: ({ name }) => {
      if (location.pathname !== '/') navigate('/')
      st().newProject()
      st().renameProject(str(name, 'name'))
      return { projectId: st().project.id, floorId: st().activeFloorId }
    },
  },
  {
    name: 'draw_room',
    description: 'Draw a rectangular room: four walls from the top-left corner (x, y) with the given width (along x) and height (along y), in metres. Walls that land on existing corners join them, so adjacent rooms share walls. Optionally name the room. Returns the wall ids.',
    inputSchema: {
      type: 'object',
      properties: { x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' }, name: { type: 'string' }, wallThickness: { type: 'number', description: 'metres, default the floor setting (0.2)' } },
      required: ['x', 'y', 'width', 'height'],
    },
    execute: ({ x, y, width, height, name, wallThickness }) => {
      ensureEditable()
      const x0 = num(x, 'x')
      const y0 = num(y, 'y')
      const w = num(width, 'width')
      const h = num(height, 'height')
      if (w <= 0 || h <= 0) throw new Error('width and height must be positive')
      const ids = polyline(
        [
          { x: x0, y: y0 },
          { x: x0 + w, y: y0 },
          { x: x0 + w, y: y0 + h },
          { x: x0, y: y0 + h },
        ],
        true,
        typeof wallThickness === 'number' ? wallThickness : undefined,
      )
      const centre = { x: x0 + w / 2, y: y0 + h / 2 }
      let roomLabel: string | null = null
      if (typeof name === 'string' && name.trim()) {
        const room = findRooms(st().plan).find((r) => pointInPolygon(centre, r.polygon))
        if (room) {
          st().nameRoom(room, name.trim())
          roomLabel = name.trim()
        }
      }
      return { wallIds: ids, room: roomLabel, centre }
    },
  },
  {
    name: 'draw_walls',
    description: 'Draw connected walls through a list of points (metres). Set closed to true to join the last point back to the first. Points on existing corners join them.',
    inputSchema: { type: 'object', properties: { points: { type: 'array', items: point, minItems: 2 }, closed: { type: 'boolean' }, wallThickness: { type: 'number' } }, required: ['points'] },
    execute: ({ points, closed, wallThickness }) => {
      ensureEditable()
      if (!Array.isArray(points) || points.length < 2) throw new Error('give at least two points')
      const pts = (points as { x: unknown; y: unknown }[]).map((p, i) => ({ x: num(p.x, `points[${i}].x`), y: num(p.y, `points[${i}].y`) }))
      return { wallIds: polyline(pts, closed === true, typeof wallThickness === 'number' ? wallThickness : undefined) }
    },
  },
  {
    name: 'add_opening',
    description: 'Add a door or a window to a wall. Identify the wall by wallId (from get_plan) or by a point on it. Position along the wall from its "from" end in metres (offset); width and height in metres; sill is the window sill height.',
    inputSchema: {
      type: 'object',
      properties: { kind: { type: 'string', enum: ['door', 'window'] }, wallId: { type: 'string' }, at: point, offset: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' }, sill: { type: 'number' } },
      required: ['kind'],
    },
    execute: ({ kind, wallId, at, offset, width, height, sill }) => {
      ensureEditable()
      const k = (kind === 'window' ? 'window' : 'door') as OpeningKind
      const wall = wallByRef(wallId, at && typeof at === 'object' ? { x: num((at as { x: unknown }).x, 'at.x'), y: num((at as { y: unknown }).y, 'at.y') } : undefined)
      const L = wallLength(st().plan, wall)
      const wdt = num(width, 'width', k === 'door' ? 0.9 : 1.2)
      const off = offset === undefined ? Math.max(0, (L - wdt) / 2) : Math.max(0, Math.min(L - wdt, num(offset, 'offset')))
      const id = st().addOpening(wall.id, off, k)
      const patch: Record<string, number> = { width: wdt }
      if (height !== undefined) patch.height = num(height, 'height')
      if (sill !== undefined && k === 'window') patch.sill = num(sill, 'sill')
      st().updateOpening(id, patch)
      return { openingId: id, wallId: wall.id, offset: off }
    },
  },
  {
    name: 'search_catalog',
    description: 'Find furniture and structures in the catalogue by name (bed, sofa, sink, stairs, balcony…). Returns keys to use with place_furniture, with sizes in metres.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    execute: ({ query }) => {
      const q = str(query, 'query').toLowerCase()
      const all = [...CATALOG, ...st().customModels]
      return all
        .filter((c) => c.name.toLowerCase().includes(q) || c.category.toLowerCase().includes(q) || c.key.includes(q))
        .slice(0, 25)
        .map((c) => ({ key: c.key, name: c.name, category: c.category, width: c.width, depth: c.depth, height: c.height }))
    },
  },
  {
    name: 'place_furniture',
    description: 'Place a catalogue item (key from search_catalog, or a name to search) with its centre at (x, y). angle in degrees, clockwise, 0 = the front faces down the plan. againstWall snaps the back of the piece to the nearest wall within a metre. Optional width/depth resize it.',
    inputSchema: {
      type: 'object',
      properties: { key: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, angle: { type: 'number' }, againstWall: { type: 'boolean' }, width: { type: 'number' }, depth: { type: 'number' } },
      required: ['key', 'x', 'y'],
    },
    execute: ({ key, x, y, angle, againstWall, width, depth }) => {
      ensureEditable()
      const ref = str(key, 'key')
      const item = st().catalogItem(ref) ?? [...CATALOG, ...st().customModels].find((c) => c.name.toLowerCase() === ref.toLowerCase()) ?? [...CATALOG, ...st().customModels].find((c) => c.name.toLowerCase().includes(ref.toLowerCase()))
      if (!item) throw new Error(`nothing in the catalogue matches "${ref}"; try search_catalog`)
      let pos = { x: num(x, 'x'), y: num(y, 'y') }
      let rad = (num(angle, 'angle', 0) * Math.PI) / 180
      const size = { width: typeof width === 'number' ? width : item.width, depth: typeof depth === 'number' ? depth : item.depth }
      if (againstWall === true) {
        const snap = snapFurnitureToWall(st().plan, size, pos, rad, 1)
        if (snap) {
          pos = { x: snap.x, y: snap.y }
          rad = snap.angle
        }
      }
      const id = st().addFurniture(item.key, pos, rad)
      if (!id) throw new Error('could not place the piece')
      if (typeof width === 'number' || typeof depth === 'number') st().updateFurniture(id, size)
      const placed = st().plan.furniture[id]
      return { furnitureId: id, name: placed.name, x: placed.x, y: placed.y, angleDeg: Math.round((placed.angle * 180) / Math.PI) }
    },
  },
  {
    name: 'set_wall_length',
    description: 'Set the length of a wall in metres (face to face on its outer side) and lock it as a constraint.',
    inputSchema: { type: 'object', properties: { wallId: { type: 'string' }, length: { type: 'number' } }, required: ['wallId', 'length'] },
    execute: ({ wallId, length }) => {
      ensureEditable()
      const wall = wallByRef(wallId)
      st().setWallLength(wall.id, num(length, 'length'), true)
      return { wallId: wall.id, length: Math.round(wallLength(st().plan, wall) * 100) / 100 }
    },
  },
  {
    name: 'name_room',
    description: 'Name the room that contains the point (x, y).',
    inputSchema: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, name: { type: 'string' } }, required: ['x', 'y', 'name'] },
    execute: ({ x, y, name }) => {
      ensureEditable()
      const p = { x: num(x, 'x'), y: num(y, 'y') }
      const room = findRooms(st().plan).find((r) => pointInPolygon(p, r.polygon))
      if (!room) throw new Error('no closed room contains that point')
      st().nameRoom(room, str(name, 'name'))
      return { area: Math.round(room.area * 100) / 100 }
    },
  },
  {
    name: 'delete',
    description: 'Delete walls, openings or furniture by id (ids from get_plan). Deleting a wall removes its doors and windows.',
    inputSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] },
    execute: ({ ids }) => {
      ensureEditable()
      const plan = st().plan
      const items: SelectionItem[] = []
      for (const id of (ids as unknown[]) ?? []) {
        const s = String(id)
        if (plan.walls[s]) items.push({ kind: 'wall', id: s })
        else if (plan.openings[s]) items.push({ kind: 'opening', id: s })
        else if (plan.furniture[s]) items.push({ kind: 'furniture', id: s })
      }
      st().deleteItems(items)
      return { deleted: items.length }
    },
  },
  {
    name: 'floor',
    description: 'Manage floors: "list", "add" (a new floor on top, optionally named), "select" (make a floor current by name, id or index), "rename".',
    inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['list', 'add', 'select', 'rename'] }, floor: { type: 'string' }, name: { type: 'string' } }, required: ['action'] },
    execute: ({ action, floor, name }) => {
      const list = () => st().project.floors.map((f, i) => ({ id: f.id, name: f.name, index: i, active: f.id === st().activeFloorId }))
      if (action === 'list') return list()
      ensureEditable()
      if (action === 'add') {
        st().addFloor()
        if (typeof name === 'string' && name.trim()) st().renameFloor(st().activeFloorId, name.trim())
        return list()
      }
      const f = floorByRef(floor)
      if (!f) throw new Error('floor not found')
      if (action === 'select') st().setActiveFloor(f.id)
      else if (action === 'rename') st().renameFloor(f.id, str(name, 'name'))
      return list()
    },
  },
  {
    name: 'set_roof',
    description: 'Set the roof: type none, flat, gable or hip; pitch in degrees; overhang in metres.',
    inputSchema: { type: 'object', properties: { type: { type: 'string', enum: ['none', 'flat', 'gable', 'hip'] }, pitch: { type: 'number' }, overhang: { type: 'number' } } },
    execute: ({ type, pitch, overhang }) => {
      ensureEditable()
      const patch: Record<string, unknown> = {}
      if (typeof type === 'string') patch.type = type as RoofType
      if (typeof pitch === 'number') patch.pitch = Math.min(70, Math.max(5, pitch))
      if (typeof overhang === 'number') patch.overhang = Math.max(0, overhang)
      st().setRoof(patch)
      return st().project.roof
    },
  },
  {
    name: 'set_site',
    description: 'Set where the building stands (latitude, longitude) and the compass bearing of the top of the plan (north, degrees clockwise), for the sun in 3D.',
    inputSchema: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' }, north: { type: 'number' } }, required: ['lat', 'lng'] },
    execute: ({ lat, lng, north }) => {
      ensureEditable()
      st().setSite({ lat: num(lat, 'lat'), lng: num(lng, 'lng'), north: num(north, 'north', 0) })
      return st().project.site
    },
  },
  {
    name: 'show',
    description: 'Show the plan in 2D, 3D or walkthrough, and zoom the 2D view to fit.',
    inputSchema: { type: 'object', properties: { view: { type: 'string', enum: ['2d', '3d', 'walk'] } } },
    execute: ({ view }) => {
      if (location.pathname !== '/') navigate('/')
      st().setMode(view === '3d' ? '3d' : view === 'walk' ? 'walk' : 'plan')
      if (view !== '3d' && view !== 'walk') st().requestFit()
      return { view: st().mode }
    },
  },
  {
    name: 'undo',
    description: 'Undo the last change.',
    inputSchema: { type: 'object', properties: {} },
    execute: () => {
      st().undo()
      return { ok: true }
    },
  },
]

/** run a tool by name with plain JSON input; results and errors are plain objects */
export async function callTool(name: string, input: Record<string, unknown> = {}): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  const tool = TOOLS.find((t) => t.name === name)
  if (!tool) return { ok: false, error: `unknown tool ${name}; available: ${TOOLS.map((t) => t.name).join(', ')}` }
  try {
    return { ok: true, result: await tool.execute(input ?? {}) }
  } catch (e) {
    return { ok: false, error: (e as Error).message || String(e) }
  }
}

export const describeTools = () => TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))

/** a hint for agents that read the page: what the plan's units and axes are */
export const AGENT_HINT = `Snapline floor plan editor. Units: metres; x to the right, y down the plan. Start with get_plan, then draw_room / draw_walls, add_opening, place_furniture. Use ${formatLength(0.2, 'm')} walls by default.`
