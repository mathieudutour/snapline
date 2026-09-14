/**
 * Figma-style measurement between two walls: the clear distance between their facing sides.
 * Parallel walls get a perpendicular gap drawn across their overlap; other pairs get the
 * shortest distance between their outlines.
 */
import type { Plan, Vec2, Wall } from './types'
import { add, cross, dist, dot, normalize, perp, scale, sub, wallEnds, wallPolygon } from './geometry'

export interface WallGap {
  from: Vec2
  to: Vec2
  distance: number
  parallel: boolean
  /** dashed extension of the selected wall's face, drawn when the gap is measured beyond its end */
  extension?: [Vec2, Vec2]
}

const PARALLEL_SIN = Math.sin((2 * Math.PI) / 180)

export function wallGap(plan: Plan, a: Wall, b: Wall): WallGap | null {
  if (a.id === b.id) return null
  if (a.a === b.a || a.a === b.b || a.b === b.a || a.b === b.b) return null // joined at a corner: nothing to measure
  const [a1, a2] = wallEnds(plan, a)
  const [b1, b2] = wallEnds(plan, b)
  const u = normalize(sub(a2, a1))
  const vb = normalize(sub(b2, b1))
  if (Math.abs(cross(u, vb)) < PARALLEL_SIN) {
    const n = perp(u)
    const offset = dot(sub(scale(add(b1, b2), 0.5), a1), n)
    const sign = offset >= 0 ? 1 : -1
    const gap = Math.abs(offset) - a.thickness / 2 - b.thickness / 2
    if (gap <= 1e-6) return null
    // draw across the overlap of the two walls along a's axis; when they barely overlap, draw in front
    // of b's middle and extend a's face with a dashed line up to there (as Figma does)
    const la = dist(a1, a2)
    const tb1 = dot(sub(b1, a1), u)
    const tb2 = dot(sub(b2, a1), u)
    const lo = Math.max(0, Math.min(tb1, tb2))
    const hi = Math.min(la, Math.max(tb1, tb2))
    const face = scale(n, (sign * a.thickness) / 2)
    if (hi - lo >= 0.2) {
      const from = add(add(a1, scale(u, (lo + hi) / 2)), face)
      return { from, to: add(from, scale(n, sign * gap)), distance: gap, parallel: true }
    }
    const t = (tb1 + tb2) / 2
    const from = add(add(a1, scale(u, t)), face)
    const end = add(add(a1, scale(u, t < 0 ? 0 : t > la ? la : t)), face)
    return { from, to: add(from, scale(n, sign * gap)), distance: gap, parallel: true, extension: t < 0 || t > la ? [end, from] : undefined }
  }
  // shortest distance between the two outlines
  const pa = wallPolygon(plan, a)
  const pb = wallPolygon(plan, b)
  let best: WallGap | null = null
  for (let i = 0; i < pa.length; i++) {
    for (let j = 0; j < pb.length; j++) {
      const r = segmentGap(pa[i], pa[(i + 1) % pa.length], pb[j], pb[(j + 1) % pb.length])
      if (!best || r.distance < best.distance) best = { ...r, parallel: false }
    }
  }
  return best && best.distance > 1e-6 ? best : null
}

/** closest points between two segments */
function segmentGap(p1: Vec2, p2: Vec2, q1: Vec2, q2: Vec2): { from: Vec2; to: Vec2; distance: number } {
  const candidates = [nearest(p1, q1, q2, true), nearest(p2, q1, q2, true), nearest(q1, p1, p2, false), nearest(q2, p1, p2, false)]
  return candidates.reduce((a, b) => (b.distance < a.distance ? b : a))
}

function nearest(p: Vec2, a: Vec2, b: Vec2, pIsFirst: boolean): { from: Vec2; to: Vec2; distance: number } {
  const ab = sub(b, a)
  const l2 = dot(ab, ab)
  const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2))
  const q = add(a, scale(ab, t))
  return pIsFirst ? { from: p, to: q, distance: dist(p, q) } : { from: q, to: p, distance: dist(p, q) }
}
