import type { Plan, Room, Vec2, Wall } from './types'

export const v = (x: number, y: number): Vec2 => ({ x, y })
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y })
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y })
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s })
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x
export const len = (a: Vec2): number => Math.hypot(a.x, a.y)
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y)
export const normalize = (a: Vec2): Vec2 => {
  const l = len(a)
  return l < 1e-12 ? { x: 1, y: 0 } : { x: a.x / l, y: a.y / l }
}
/** left-hand normal (rotate +90°) */
export const perp = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x })
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })

export function wallEnds(plan: Plan, wall: Wall): [Vec2, Vec2] {
  const a = plan.points[wall.a]
  const b = plan.points[wall.b]
  return [
    { x: a.x, y: a.y },
    { x: b.x, y: b.y },
  ]
}

export function wallLength(plan: Plan, wall: Wall): number {
  const [a, b] = wallEnds(plan, wall)
  return dist(a, b)
}

export function wallDir(plan: Plan, wall: Wall): Vec2 {
  const [a, b] = wallEnds(plan, wall)
  return normalize(sub(b, a))
}

/** Closest point on segment ab to p, returns parameter t in [0,1] and the point */
export function projectOnSegment(p: Vec2, a: Vec2, b: Vec2): { t: number; point: Vec2; distance: number } {
  const ab = sub(b, a)
  const l2 = dot(ab, ab)
  let t = l2 < 1e-12 ? 0 : dot(sub(p, a), ab) / l2
  t = Math.max(0, Math.min(1, t))
  const point = add(a, scale(ab, t))
  return { t, point, distance: dist(p, point) }
}

export function wallsAtPoint(plan: Plan, pointId: string): Wall[] {
  return Object.values(plan.walls).filter((w) => w.a === pointId || w.b === pointId)
}

function lineIntersection(p1: Vec2, d1: Vec2, p2: Vec2, d2: Vec2): Vec2 | null {
  const denom = cross(d1, d2)
  if (Math.abs(denom) < 1e-9) return null
  const t = cross(sub(p2, p1), d2) / denom
  return add(p1, scale(d1, t))
}

/**
 * Corner point of a wall at endpoint P, on side `side` (+1 = left of `away`), mitred with the
 * single other wall meeting at that point when there is exactly one.
 */
function endCorner(plan: Plan, wall: Wall, pointId: string, away: Vec2, side: 1 | -1): Vec2 {
  const P = plan.points[pointId]
  const n = perp(away)
  const base = add(P, scale(n, (side * wall.thickness) / 2))
  const others = wallsAtPoint(plan, pointId).filter((w) => w.id !== wall.id)
  if (others.length !== 1) return base
  const other = others[0]
  const otherFar = plan.points[other.a === pointId ? other.b : other.a]
  const away2 = normalize(sub(otherFar, P))
  const n2 = perp(away2)
  const base2 = add(P, scale(n2, (-side * other.thickness) / 2))
  const hit = lineIntersection(base, away, base2, away2)
  if (!hit) return base
  const maxReach = Math.max(wall.thickness, other.thickness) * 3
  if (dist(hit, P) > maxReach) return base
  return hit
}

/** Plan-view outline of a wall (4 points, convex), with mitred corners where two walls meet. */
export function wallPolygon(plan: Plan, wall: Wall): Vec2[] {
  const [a, b] = wallEnds(plan, wall)
  const u = normalize(sub(b, a))
  const uBack = scale(u, -1)
  const aLeft = endCorner(plan, wall, wall.a, u, 1)
  const aRight = endCorner(plan, wall, wall.a, u, -1)
  // at B, "away" is -u; the left of -u is the right of u
  const bRight = endCorner(plan, wall, wall.b, uBack, 1)
  const bLeft = endCorner(plan, wall, wall.b, uBack, -1)
  return [aLeft, bLeft, bRight, aRight]
}

/** Clip a convex polygon to the slab s0 <= dot(p - origin, u) <= s1 */
export function clipPolygonToRange(poly: Vec2[], origin: Vec2, u: Vec2, s0: number, s1: number): Vec2[] {
  const clip = (pts: Vec2[], inside: (p: Vec2) => number): Vec2[] => {
    const out: Vec2[] = []
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i]
      const prev = pts[(i + pts.length - 1) % pts.length]
      const dc = inside(cur)
      const dp = inside(prev)
      if (dc >= 0) {
        if (dp < 0) out.push(lerp(prev, cur, dp / (dp - dc)))
        out.push(cur)
      } else if (dp >= 0) {
        out.push(lerp(prev, cur, dp / (dp - dc)))
      }
    }
    return out
  }
  let result = clip(poly, (p) => dot(sub(p, origin), u) - s0)
  result = clip(result, (p) => s1 - dot(sub(p, origin), u))
  return result
}

export function polygonArea(poly: Vec2[]): number {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    s += p.x * q.y - q.x * p.y
  }
  return s / 2
}

export function polygonCentroid(poly: Vec2[]): Vec2 {
  const a = polygonArea(poly)
  if (Math.abs(a) < 1e-12) {
    const n = poly.length || 1
    return scale(
      poly.reduce((acc, p) => add(acc, p), v(0, 0)),
      1 / n,
    )
  }
  let cx = 0
  let cy = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    const f = p.x * q.y - q.x * p.y
    cx += (p.x + q.x) * f
    cy += (p.y + q.y) * f
  }
  return { x: cx / (6 * a), y: cy / (6 * a) }
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i]
    const pj = poly[j]
    if (pi.y > p.y !== pj.y > p.y && p.x < ((pj.x - pi.x) * (p.y - pi.y)) / (pj.y - pi.y) + pi.x) inside = !inside
  }
  return inside
}

/**
 * Detect closed rooms: faces of the planar graph formed by walls.
 * Faces are traced keeping the face on the left; interior faces have positive signed area.
 */
export function findRooms(plan: Plan): Room[] {
  const adjacency = new Map<string, string[]>()
  const addEdge = (a: string, b: string) => {
    if (!adjacency.has(a)) adjacency.set(a, [])
    const list = adjacency.get(a)!
    if (!list.includes(b)) list.push(b)
  }
  for (const w of Object.values(plan.walls)) {
    if (w.a === w.b) continue
    if (!plan.points[w.a] || !plan.points[w.b]) continue
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
  const rooms: Room[] = []
  for (const [start, neighbours] of adjacency) {
    for (const first of neighbours) {
      const key = `${start}>${first}`
      if (visited.has(key)) continue
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
        // predecessor of the reverse edge in CCW-sorted order == first edge clockwise from it
        const next = outgoing[(idx - 1 + outgoing.length) % outgoing.length]
        a = b
        b = next
        if (a === start && b === first) break
      }
      if (cycle.length < 3) continue
      const polygon = cycle.map((id) => ({ x: plan.points[id].x, y: plan.points[id].y }))
      const area = polygonArea(polygon)
      if (area <= 1e-6) continue
      // discard degenerate cycles that revisit vertices (dangling walls inside a room still count)
      const unique = new Set(cycle)
      if (unique.size < 3) continue
      rooms.push({
        id: [...unique].sort().join('-'),
        pointIds: cycle,
        polygon,
        area,
        centroid: polygonCentroid(polygon),
      })
    }
  }
  return rooms
}

export function planBounds(plan: Plan): { min: Vec2; max: Vec2 } | null {
  const pts = Object.values(plan.points)
  if (pts.length === 0) return null
  const min = { x: Infinity, y: Infinity }
  const max = { x: -Infinity, y: -Infinity }
  for (const p of pts) {
    min.x = Math.min(min.x, p.x)
    min.y = Math.min(min.y, p.y)
    max.x = Math.max(max.x, p.x)
    max.y = Math.max(max.y, p.y)
  }
  return { min, max }
}
