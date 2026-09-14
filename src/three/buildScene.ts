import * as THREE from 'three'
import type { Opening, Plan, Vec2, Wall } from '../model/types'
import { add, clipPolygonConvex, clipPolygonToRange, findRooms, normalize, polygonArea, scale, sub, wallLength, wallPolygon, planBounds } from '../model/geometry'
import { roofFootprint, type Roof } from '../model/project'

export interface WallMeshData {
  id: string
  geometry: THREE.BufferGeometry
}

export interface OpeningMeshData {
  id: string
  opening: Opening
  /** world position of the opening's centre on the wall axis, at floor level */
  position: THREE.Vector3
  /** rotation around Y so that local +X runs along the wall from A to B */
  rotationY: number
  thickness: number
  /** hinge on the -x (A) or +x (B) side in local space */
  hingeAtB: boolean
  /** door swings towards local +z (the wall's right-hand side, plan-view) */
  swingPositiveZ: boolean
}

export interface FloorMeshData {
  id: string
  geometry: THREE.BufferGeometry
  ceiling: THREE.BufferGeometry
  height: number
}

export interface Blocker {
  a: Vec2
  b: Vec2
  halfThickness: number
}

/** rotated footprint of a piece of furniture the player cannot walk through */
export interface FurnitureBlocker {
  x: number
  z: number
  angle: number
  hw: number
  hd: number
}

export interface SceneData {
  walls: WallMeshData[]
  openings: OpeningMeshData[]
  floors: FloorMeshData[]
  blockers: Blocker[]
  furnitureBlockers: FurnitureBlocker[]
  center: Vec2
  radius: number
  spawn: Vec2
  maxHeight: number
  dispose: () => void
}

/** Extrude a convex plan polygon between y0 and y1 (world y is up, plan y maps to world z). */
function prismGeometry(poly: Vec2[], y0: number, y1: number): { positions: number[]; normals: number[] } {
  const positions: number[] = []
  const normals: number[] = []
  if (poly.length < 3 || y1 - y0 < 1e-6) return { positions, normals }
  // make polygon clockwise in plan coordinates so the top face (seen from +y) is counter-clockwise
  const pts = polygonArea(poly) > 0 ? [...poly].reverse() : [...poly]
  const pushTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, expected: THREE.Vector3) => {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a))
    if (n.lengthSq() < 1e-14) return
    n.normalize()
    if (n.dot(expected) < 0) {
      const t = b
      b = c
      c = t
      n.negate()
    }
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
    normals.push(n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z)
  }
  const top = pts.map((p) => new THREE.Vector3(p.x, y1, p.y))
  const bottom = pts.map((p) => new THREE.Vector3(p.x, y0, p.y))
  const up = new THREE.Vector3(0, 1, 0)
  const down = new THREE.Vector3(0, -1, 0)
  for (let i = 1; i < pts.length - 1; i++) {
    pushTri(top[0], top[i], top[i + 1], up)
    pushTri(bottom[0], bottom[i], bottom[i + 1], down)
  }
  let cx = 0
  let cz = 0
  for (const p of pts) {
    cx += p.x
    cz += p.y
  }
  cx /= pts.length
  cz /= pts.length
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % pts.length]
    const mid = new THREE.Vector3((p.x + q.x) / 2 - cx, 0, (p.y + q.y) / 2 - cz)
    const expected = mid.lengthSq() > 1e-12 ? mid.normalize() : new THREE.Vector3(0, 0, 1)
    pushTri(bottom[i], bottom[(i + 1) % pts.length], top[(i + 1) % pts.length], expected)
    pushTri(bottom[i], top[(i + 1) % pts.length], top[i], expected)
  }
  return { positions, normals }
}

function wallGeometry(plan: Plan, wall: Wall, bandBelow = 0): THREE.BufferGeometry {
  const poly = wallPolygon(plan, wall)
  const a = plan.points[wall.a]
  const b = plan.points[wall.b]
  const u = normalize(sub(b, a))
  const L = wallLength(plan, wall)
  const H = wall.height
  const openings = Object.values(plan.openings)
    .filter((o) => o.wallId === wall.id)
    .sort((m, n) => m.offset - n.offset)
  const pieces: { s0: number; s1: number; y0: number; y1: number }[] = []
  let cursor = 0
  for (const o of openings) {
    const s0 = Math.max(cursor, o.offset)
    const s1 = Math.min(L, o.offset + o.width)
    if (s0 > cursor + 1e-4) pieces.push({ s0: cursor, s1: s0, y0: 0, y1: H })
    if (s1 > s0 + 1e-4) {
      const bottom = o.kind === 'window' ? o.sill : 0
      const top = Math.min(H, bottom + o.height)
      if (bottom > 1e-4) pieces.push({ s0, s1, y0: 0, y1: bottom })
      if (H - top > 1e-4) pieces.push({ s0, s1, y0: top, y1: H })
    }
    cursor = Math.max(cursor, s1)
  }
  if (L - cursor > 1e-4) pieces.push({ s0: cursor, s1: L, y0: 0, y1: H })
  // solid band covering the slab edge between this floor and the one below
  if (bandBelow > 1e-4) pieces.push({ s0: 0, s1: L, y0: -bandBelow, y1: 0 })
  const positions: number[] = []
  const normals: number[] = []
  for (const piece of pieces) {
    // extend end pieces past the mitre so corners are filled
    const s0 = piece.s0 <= 1e-4 ? -10 : piece.s0
    const s1 = piece.s1 >= L - 1e-4 ? L + 10 : piece.s1
    const clipped = clipPolygonToRange(poly, a, u, s0, s1)
    const g = prismGeometry(clipped, piece.y0, piece.y1)
    positions.push(...g.positions)
    normals.push(...g.normals)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  // planar UVs so materials with textures would still work
  const uvs: number[] = []
  for (let i = 0; i < positions.length; i += 3) uvs.push(positions[i] + positions[i + 2], positions[i + 1])
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  return geometry
}

function floorGeometry(polygon: Vec2[], ceiling: boolean, holes: Vec2[][] = []): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  polygon.forEach((p, i) => {
    const x = p.x
    const y = ceiling ? p.y : -p.y
    if (i === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  })
  shape.closePath()
  // openings in the slab (stairwells, voids): each cut is clipped to the room so the triangulation stays valid
  for (const hole of holes) {
    const inside = clipPolygonConvex(polygon, hole)
    if (inside.length < 3) continue
    const path = new THREE.Path()
    inside.forEach((p, i) => (i === 0 ? path.moveTo(p.x, ceiling ? p.y : -p.y) : path.lineTo(p.x, ceiling ? p.y : -p.y)))
    path.closePath()
    shape.holes.push(path)
  }
  const geometry = new THREE.ShapeGeometry(shape)
  geometry.rotateX(ceiling ? Math.PI / 2 : -Math.PI / 2)
  return geometry
}

export function buildScene(plan: Plan, options: { bandBelow?: number; floorHoles?: Vec2[][]; ceilingHoles?: Vec2[][] } = {}): SceneData {
  const walls: WallMeshData[] = []
  const blockers: Blocker[] = []
  let maxHeight = 2.5
  for (const wall of Object.values(plan.walls)) {
    if (!plan.points[wall.a] || !plan.points[wall.b]) continue
    walls.push({ id: wall.id, geometry: wallGeometry(plan, wall, options.bandBelow ?? 0) })
    maxHeight = Math.max(maxHeight, wall.height)
    const a = plan.points[wall.a]
    const b = plan.points[wall.b]
    const u = normalize(sub(b, a))
    const L = wallLength(plan, wall)
    const doors = Object.values(plan.openings)
      .filter((o) => o.wallId === wall.id && o.kind === 'door')
      .sort((m, n) => m.offset - n.offset)
    let cursor = 0
    for (const d of doors) {
      if (d.offset > cursor) blockers.push({ a: add(a, scale(u, cursor)), b: add(a, scale(u, d.offset)), halfThickness: wall.thickness / 2 })
      cursor = Math.max(cursor, d.offset + d.width)
    }
    if (L > cursor) blockers.push({ a: add(a, scale(u, cursor)), b: add(a, scale(u, L)), halfThickness: wall.thickness / 2 })
  }
  const openings: OpeningMeshData[] = []
  for (const o of Object.values(plan.openings)) {
    const wall = plan.walls[o.wallId]
    if (!wall) continue
    const a = plan.points[wall.a]
    const b = plan.points[wall.b]
    const u = normalize(sub(b, a))
    const centre = add(a, scale(u, o.offset + o.width / 2))
    openings.push({
      id: o.id,
      opening: o,
      position: new THREE.Vector3(centre.x, 0, centre.y),
      rotationY: -Math.atan2(u.y, u.x),
      thickness: wall.thickness,
      hingeAtB: o.hingeB,
      // plan-view "left" normal (-u.y, u.x) maps to world (-u.y, 0, u.x); in local space that is -z
      swingPositiveZ: o.swingRight,
    })
  }
  const furnitureBlockers: FurnitureBlocker[] = Object.values(plan.furniture ?? {})
    .filter((f) => f.elevation < 1.2 && f.elevation + f.height > 0.25 && Math.min(f.width, f.depth) > 0.15)
    .map((f) => ({ x: f.x, z: f.y, angle: f.angle, hw: f.width / 2, hd: f.depth / 2 }))
  const rooms = findRooms(plan)
  const floors: FloorMeshData[] = rooms.map((r) => {
    const heights = r.pointIds.flatMap((pid) => Object.values(plan.walls).filter((w) => w.a === pid || w.b === pid).map((w) => w.height))
    const height = heights.length ? Math.min(...heights) : plan.settings.wallHeight
    return { id: r.id, geometry: floorGeometry(r.polygon, false, options.floorHoles), ceiling: floorGeometry(r.polygon, true, options.ceilingHoles), height }
  })
  const bounds = planBounds(plan)
  const center = bounds ? { x: (bounds.min.x + bounds.max.x) / 2, y: (bounds.min.y + bounds.max.y) / 2 } : { x: 0, y: 0 }
  const radius = bounds ? Math.max(4, Math.hypot(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y) / 2) : 6
  const largest = rooms.slice().sort((m, n) => n.area - m.area)[0]
  const spawn = largest ? largest.centroid : center
  return {
    walls,
    openings,
    floors,
    blockers,
    furnitureBlockers,
    center,
    radius,
    spawn,
    maxHeight,
    dispose: () => {
      for (const w of walls) w.geometry.dispose()
      for (const f of floors) {
        f.geometry.dispose()
        f.ceiling.dispose()
      }
    },
  }
}

/**
 * Roof shell over the footprint of `plan`, its eaves at `eaveY` (world y). Gable and hip roofs are a
 * closed shell (two slopes, two ends, underside); a flat roof is a slab. Returns null when there is
 * nothing to cover.
 */
export function buildRoofGeometry(plan: Plan, roof: Roof, wallTopY: number): THREE.BufferGeometry | null {
  if (roof.type === 'none') return null
  const rect = roofFootprint(plan)
  if (!rect) return null
  const u = { x: rect.ux, y: rect.uy }
  const v = { x: -u.y, y: u.x }
  const hl = rect.long / 2 + roof.overhang
  const hs = rect.short / 2 + roof.overhang
  const at = (a: number, b: number, y: number) => new THREE.Vector3(rect.cx + u.x * a + v.x * b, y, rect.cy + u.y * a + v.y * b)
  const positions: number[] = []
  const normals: number[] = []
  const tri = (p: THREE.Vector3, q: THREE.Vector3, r: THREE.Vector3, expected: THREE.Vector3) => {
    const n = new THREE.Vector3().subVectors(q, p).cross(new THREE.Vector3().subVectors(r, p))
    if (n.lengthSq() < 1e-14) return
    n.normalize()
    let b = q
    let c = r
    if (n.dot(expected) < 0) {
      b = r
      c = q
      n.negate()
    }
    positions.push(p.x, p.y, p.z, b.x, b.y, b.z, c.x, c.y, c.z)
    normals.push(n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z)
  }
  const quad = (p: THREE.Vector3, q: THREE.Vector3, r: THREE.Vector3, s: THREE.Vector3, expected: THREE.Vector3) => {
    tri(p, q, r, expected)
    tri(p, r, s, expected)
  }
  const up = new THREE.Vector3(0, 1, 0)
  const down = new THREE.Vector3(0, -1, 0)
  if (roof.type === 'flat') {
    const y0 = wallTopY
    const y1 = wallTopY + roof.thickness
    const c = [at(-hl, -hs, 0), at(hl, -hs, 0), at(hl, hs, 0), at(-hl, hs, 0)]
    const top = c.map((p) => new THREE.Vector3(p.x, y1, p.z))
    const bottom = c.map((p) => new THREE.Vector3(p.x, y0, p.z))
    quad(top[0], top[1], top[2], top[3], up)
    quad(bottom[0], bottom[1], bottom[2], bottom[3], down)
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4
      const mid = new THREE.Vector3().addVectors(bottom[i], bottom[j]).multiplyScalar(0.5).sub(new THREE.Vector3(rect.cx, y0, rect.cy)).setY(0)
      quad(bottom[i], bottom[j], top[j], top[i], mid)
    }
  } else {
    // ridge along P (half extent hp), slopes rise across Q (half extent hq)
    const alongLong = roof.ridge === 'long'
    const hp = alongLong ? hl : hs
    const hq = alongLong ? hs : hl
    const P = (p: number, q: number, y: number) => (alongLong ? at(p, q, y) : at(q, p, y))
    const tan = Math.tan((roof.pitch * Math.PI) / 180)
    // the slope passes through the wall top at the wall face, so the eave sits lower by the overhang
    const eaveY = wallTopY - roof.overhang * tan
    const rise = hq * tan
    const rl = roof.type === 'gable' ? hp : Math.max(0, hp - hq)
    const B1 = P(-hp, -hq, eaveY)
    const B2 = P(hp, -hq, eaveY)
    const B3 = P(hp, hq, eaveY)
    const B4 = P(-hp, hq, eaveY)
    const R1 = P(-rl, 0, eaveY + rise)
    const R2 = P(rl, 0, eaveY + rise)
    quad(B1, B2, R2, R1, up)
    quad(B4, B3, R2, R1, up)
    const endDir = (sign: number) => new THREE.Vector3().subVectors(P(sign, 0, 0), P(0, 0, 0)).normalize().add(new THREE.Vector3(0, 0.3, 0))
    tri(B1, R1, B4, endDir(-1))
    tri(B2, R2, B3, endDir(1))
    // soffit: a flat ring under the overhang only, so room ceilings stay visible from inside
    const o = Math.min(roof.overhang, hp, hq)
    if (o > 1e-4) {
      const I1 = P(-hp + o, -hq + o, eaveY)
      const I2 = P(hp - o, -hq + o, eaveY)
      const I3 = P(hp - o, hq - o, eaveY)
      const I4 = P(-hp + o, hq - o, eaveY)
      quad(B1, B2, I2, I1, down)
      quad(B2, B3, I3, I2, down)
      quad(B3, B4, I4, I3, down)
      quad(B4, B1, I1, I4, down)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  return geometry
}
