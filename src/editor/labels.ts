/**
 * Measurement density: which numbers the plan shows, and how they keep out of each other's way.
 *
 * Drawing a dimension on every wall face and a badge on every rule reads as noise past a
 * handful of rooms: on an eight-room plan that is sixty-odd labels, a dozen of which sit on
 * top of each other or on a room name. The answer is not a hide toggle. Derived measurements
 * go into chained strings outside the building envelope, the way a set-out drawing carries
 * them; rules stay on the plan, because they are the point of the product; and whatever is
 * left is culled so that two numbers never overlap.
 *
 * Everything here is pure geometry so it can be tested without a DOM.
 */
import type { Plan, Vec2 } from '../model/types'
import { dot, wallDir, wallPolygon } from '../model/geometry'

export type LabelDensity = 'overall' | 'working' | 'all'

export const DENSITY_LEVELS: LabelDensity[] = ['overall', 'working', 'all']
export const DENSITY_LABELS: Record<LabelDensity, string> = { overall: 'Overall', working: 'Working', all: 'All' }
export const DENSITY_HINTS: Record<LabelDensity, string> = {
  overall: 'the overall size of the building, room names, and the selection',
  working: 'chained strings outside the building, locked and violated rules, and the selection',
  all: 'every wall face and every opening, for a checking pass',
}

/** overall → working → all → overall */
export function nextDensity(d: LabelDensity): LabelDensity {
  return DENSITY_LEVELS[(DENSITY_LEVELS.indexOf(d) + 1) % DENSITY_LEVELS.length]
}

// ---- rectangles ----

/** an axis-aligned box in plan units */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** the axis-aligned box around a w × h chip centred on `c` and turned by `angle` degrees */
export function rotatedRect(c: Vec2, angle: number, w: number, h: number): Rect {
  const a = (angle * Math.PI) / 180
  const cos = Math.abs(Math.cos(a))
  const sin = Math.abs(Math.sin(a))
  const hw = (w * cos + h * sin) / 2
  const hh = (w * sin + h * cos) / 2
  return { x: c.x - hw, y: c.y - hh, w: hw * 2, h: hh * 2 }
}

export function rectsOverlap(a: Rect, b: Rect, pad = 0): boolean {
  return a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y
}

// ---- culling ----

/**
 * How much a label matters when two want the same spot. A rule you set beats the selection,
 * which beats a room name, which beats a number the plan merely measures.
 */
export const RANK = { derived: 0, room: 1, selected: 2, rule: 3 } as const

export interface LabelCandidate {
  key: string
  rect: Rect
  rank: number
  /** tie-break within a rank: the longer measurement (or the larger room) wins */
  length: number
}

/**
 * Two numbers must never overlap. An unreadable number is worse than a hidden one, and in a
 * product whose whole claim is precision, overlapping text is the most damaging thing that
 * can be on screen. So: sort by rank, then by length, keep each label only if it clears
 * every label already kept, and let the caller draw a dot for the ones that lost.
 */
export function cullLabels(labels: LabelCandidate[], pad: number): { kept: LabelCandidate[]; dropped: LabelCandidate[] } {
  const order = [...labels].sort((a, b) => b.rank - a.rank || b.length - a.length)
  const kept: LabelCandidate[] = []
  const dropped: LabelCandidate[] = []
  for (const l of order) {
    if (kept.some((k) => rectsOverlap(k.rect, l.rect, pad))) dropped.push(l)
    else kept.push(l)
  }
  return { kept, dropped }
}

// ---- the envelope and its chained strings ----

export interface Envelope {
  min: Vec2
  max: Vec2
}

/** the box around the outer faces of every wall (the point bounds would stop at the centrelines) */
export function planEnvelope(plan: Plan): Envelope | null {
  const min = { x: Infinity, y: Infinity }
  const max = { x: -Infinity, y: -Infinity }
  let any = false
  for (const w of Object.values(plan.walls)) {
    if (!plan.points[w.a] || !plan.points[w.b]) continue
    for (const p of wallPolygon(plan, w)) {
      any = true
      min.x = Math.min(min.x, p.x)
      min.y = Math.min(min.y, p.y)
      max.x = Math.max(max.x, p.x)
      max.y = Math.max(max.y, p.y)
    }
  }
  return any ? { min, max } : null
}

export type EnvelopeSide = 'top' | 'bottom' | 'left' | 'right'
export const ENVELOPE_SIDES: EnvelopeSide[] = ['top', 'right', 'bottom', 'left']

export interface ChainRun {
  /** offsets along the side (x for top / bottom, y for left / right) */
  from: number
  to: number
  length: number
  /** a wall's thickness rather than the clear distance between two walls */
  wall?: boolean
}

export interface ChainString {
  side: EnvelopeSide
  /** outward unit normal of this side */
  normal: Vec2
  /** the coordinate the side lies on (y for top / bottom, x for left / right) */
  at: number
  ticks: number[]
  runs: ChainRun[]
  /** the whole side, face to face */
  overall: ChainRun
}

/** a point on a side of the envelope, from its offset along that side */
export function onSide(side: EnvelopeSide, env: Envelope, offset: number): Vec2 {
  switch (side) {
    case 'top':
      return { x: offset, y: env.min.y }
    case 'bottom':
      return { x: offset, y: env.max.y }
    case 'left':
      return { x: env.min.x, y: offset }
    case 'right':
      return { x: env.max.x, y: offset }
  }
}

const SIDE_NORMAL: Record<EnvelopeSide, Vec2> = { top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } }

/** do segments p1–p2 and q1–q2 cross (touching counts) */
function segmentsCross(p1: Vec2, p2: Vec2, q1: Vec2, q2: Vec2): boolean {
  const d = (a: Vec2, b: Vec2, c: Vec2) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  const d1 = d(q1, q2, p1)
  const d2 = d(q1, q2, p2)
  const d3 = d(p1, p2, q1)
  const d4 = d(p1, p2, q2)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true
  const on = (a: Vec2, b: Vec2, c: Vec2) => Math.min(a.x, b.x) - 1e-9 <= c.x && c.x <= Math.max(a.x, b.x) + 1e-9 && Math.min(a.y, b.y) - 1e-9 <= c.y && c.y <= Math.max(a.y, b.y) + 1e-9
  return (Math.abs(d1) < 1e-12 && on(q1, q2, p1)) || (Math.abs(d2) < 1e-12 && on(q1, q2, p2)) || (Math.abs(d3) < 1e-12 && on(p1, p2, q1)) || (Math.abs(d4) < 1e-12 && on(p1, p2, q2))
}

/**
 * Is a corner visible from outside a given side of the envelope? A tick on the top string
 * should mark something you can see from the top: the ends of the front wall and the walls
 * that meet it. A partition in the middle of the plan projects onto every side numerically,
 * but a tick for it on a side it never reaches is a number with nothing to measure.
 */
function visibleFrom(plan: Plan, pointId: string, side: EnvelopeSide, env: Envelope, polygons: { wallId: string; a: string; b: string; poly: Vec2[] }[]): boolean {
  const p = plan.points[pointId]
  const n = SIDE_NORMAL[side]
  const reach = side === 'top' ? p.y - env.min.y : side === 'bottom' ? env.max.y - p.y : side === 'left' ? p.x - env.min.x : env.max.x - p.x
  const far = { x: p.x + n.x * (reach + 1), y: p.y + n.y * (reach + 1) }
  for (const w of polygons) {
    if (w.a === pointId || w.b === pointId) continue
    for (let i = 0; i < w.poly.length; i++) {
      if (segmentsCross(p, far, w.poly[i], w.poly[(i + 1) % w.poly.length])) return false
    }
  }
  return true
}

/**
 * One string per side of the envelope, read the way a set-out drawing reads: wall, clear,
 * wall, clear, wall. The ticks are the faces of the walls that meet that side, so every run
 * is something a tape can be held against — the clear distance between two walls, or a
 * wall's thickness. A tick at a wall's centreline is a number nobody can measure on site.
 * Only corners visible from the side count, so a partition in the middle of the plan does
 * not tick every side. The outermost ticks are the outer faces.
 */
export function chainedStrings(plan: Plan, env: Envelope, merge = 0.02): ChainString[] {
  const polygons = Object.values(plan.walls)
    .filter((w) => plan.points[w.a] && plan.points[w.b])
    .map((w) => ({ wallId: w.id, a: w.a, b: w.b, poly: wallPolygon(plan, w) }))
  return ENVELOPE_SIDES.map((side) => {
    const along = side === 'top' || side === 'bottom' ? 'x' : 'y'
    const tangent = along === 'x' ? { x: 1, y: 0 } : { x: 0, y: 1 }
    const lo = along === 'x' ? env.min.x : env.min.y
    const hi = along === 'x' ? env.max.x : env.max.y
    /** the two faces of each wall that runs into this side */
    const faces: { lo: number; hi: number }[] = []
    const offsets: number[] = []
    for (const p of Object.values(plan.points)) {
      if (!visibleFrom(plan, p.id, side, env, polygons)) continue
      const at = p[along]
      let intoSide = false
      for (const w of polygons) {
        if (w.a !== p.id && w.b !== p.id) continue
        const wall = plan.walls[w.wallId]
        // a wall running into the side (perpendicular-ish) ticks at both faces; one running along it ends here
        if (Math.abs(dot(wallDir(plan, wall), tangent)) < 0.7) {
          intoSide = true
          faces.push({ lo: at - wall.thickness / 2, hi: at + wall.thickness / 2 })
          offsets.push(at - wall.thickness / 2, at + wall.thickness / 2)
        }
      }
      if (!intoSide) offsets.push(at)
    }
    const inside = offsets.filter((o) => o > lo + merge && o < hi - merge).sort((a, b) => a - b)
    const ticks: number[] = [lo]
    for (const o of inside) if (o - ticks[ticks.length - 1] > merge) ticks.push(o)
    if (hi - ticks[ticks.length - 1] > merge) ticks.push(hi)
    else ticks[ticks.length - 1] = hi
    const runs: ChainRun[] = []
    for (let i = 1; i < ticks.length; i++) {
      const from = ticks[i - 1]
      const to = ticks[i]
      const wall = faces.some((f) => f.lo <= from + merge && to <= f.hi + merge)
      runs.push({ from, to, length: to - from, ...(wall ? { wall: true } : {}) })
    }
    return { side, normal: SIDE_NORMAL[side], at: along === 'x' ? (side === 'top' ? env.min.y : env.max.y) : side === 'left' ? env.min.x : env.max.x, ticks, runs, overall: { from: lo, to: hi, length: hi - lo } }
  })
}

/** the side of the envelope a point is closest to, for leaders out of rooms too small for their name */
export function nearestSide(p: Vec2, env: Envelope): EnvelopeSide {
  const d: [EnvelopeSide, number][] = [
    ['top', p.y - env.min.y],
    ['bottom', env.max.y - p.y],
    ['left', p.x - env.min.x],
    ['right', env.max.x - p.x],
  ]
  return d.sort((a, b) => a[1] - b[1])[0][0]
}

// ---- drawing scales ----

/** the scales a plan is conventionally drawn at */
export const DRAWING_SCALES = [20, 25, 50, 75, 100, 150, 200, 500]

/**
 * A drawing scale is a conventional value: 1:80 as you scroll implies a precision the screen
 * does not have. Snap the readout to the nearest conventional scale and say when it is only
 * close. `zoom` is screen pixels per metre, `pxPerMm` how many of them make a millimetre.
 */
export function drawingScale(zoom: number, pxPerMm: number): { exact: number; nearest: number; approx: boolean } {
  const exact = zoom > 0 ? 1000 / (zoom / pxPerMm) : 0
  if (!exact) return { exact: 0, nearest: 0, approx: false }
  const nearest = DRAWING_SCALES.reduce((best, s) => (Math.abs(Math.log(s / exact)) < Math.abs(Math.log(best / exact)) ? s : best), DRAWING_SCALES[0])
  return { exact: Math.round(exact), nearest, approx: Math.abs(exact - nearest) / nearest > 0.015 }
}

/** the zoom (pixels per metre) that draws the plan at 1:denominator */
export function zoomForScale(denominator: number, pxPerMm: number): number {
  return (1000 * pxPerMm) / denominator
}
