import type { Plan, Vec2 } from '../model/types'
import { projectOnSegment } from '../model/geometry'

export interface SnapResult {
  pos: Vec2
  pointId?: string
  wall?: { wallId: string; t: number }
  guides: { axis: 'x' | 'y'; value: number }[]
  angleSnapped: boolean
}

export interface SnapOptions {
  /** threshold in world units */
  threshold: number
  gridSize: number | null
  /** previous point when drawing a chain, enables angle snapping */
  from?: Vec2
  excludePoints?: Set<string>
  excludeWalls?: Set<string>
  /** disable all snapping except point snapping (Shift) */
  free?: boolean
}

export function snapPosition(plan: Plan, raw: Vec2, opts: SnapOptions): SnapResult {
  const guides: SnapResult['guides'] = []
  const thr = opts.threshold
  // 1. existing points
  let bestPoint: { id: string; d: number } | null = null
  for (const p of Object.values(plan.points)) {
    if (opts.excludePoints?.has(p.id)) continue
    const d = Math.hypot(p.x - raw.x, p.y - raw.y)
    if (d < thr && (!bestPoint || d < bestPoint.d)) bestPoint = { id: p.id, d }
  }
  if (bestPoint) {
    const p = plan.points[bestPoint.id]
    return { pos: { x: p.x, y: p.y }, pointId: p.id, guides, angleSnapped: false }
  }
  if (opts.free) return { pos: raw, guides, angleSnapped: false }

  // 2. onto a wall segment
  let bestWall: { id: string; t: number; d: number; point: Vec2 } | null = null
  for (const w of Object.values(plan.walls)) {
    if (opts.excludeWalls?.has(w.id)) continue
    if (opts.excludePoints?.has(w.a) || opts.excludePoints?.has(w.b)) continue
    const a = plan.points[w.a]
    const b = plan.points[w.b]
    const pr = projectOnSegment(raw, a, b)
    if (pr.distance < thr && pr.t > 0.02 && pr.t < 0.98 && (!bestWall || pr.distance < bestWall.d)) bestWall = { id: w.id, t: pr.t, d: pr.distance, point: pr.point }
  }
  if (bestWall) {
    return { pos: bestWall.point, wall: { wallId: bestWall.id, t: bestWall.t }, guides, angleSnapped: false }
  }

  let pos = { ...raw }
  let lockX = false
  let lockY = false
  let angleSnapped = false
  // 3. angle snapping relative to the chain start
  if (opts.from) {
    const dx = raw.x - opts.from.x
    const dy = raw.y - opts.from.y
    const l = Math.hypot(dx, dy)
    if (l > 1e-6) {
      const angle = Math.atan2(dy, dx)
      const step = Math.PI / 4
      const snapped = Math.round(angle / step) * step
      const diff = Math.abs(angle - snapped)
      if (diff < (6 * Math.PI) / 180) {
        pos = { x: opts.from.x + Math.cos(snapped) * l, y: opts.from.y + Math.sin(snapped) * l }
        angleSnapped = true
        const k = Math.round(snapped / step)
        if (k % 4 === 0) lockY = true // horizontal
        else if (k % 2 === 0) lockX = true // vertical
        else {
          lockX = true
          lockY = true
        }
        if (k % 4 === 0) pos.y = opts.from.y
        if (k % 4 === 2 || k % 4 === -2) pos.x = opts.from.x
      }
    }
  }
  // 4. alignment with existing points
  if (!lockX) {
    let best: { x: number; d: number } | null = null
    for (const p of Object.values(plan.points)) {
      if (opts.excludePoints?.has(p.id)) continue
      const d = Math.abs(p.x - pos.x)
      if (d < thr && (!best || d < best.d)) best = { x: p.x, d }
    }
    if (best) {
      pos.x = best.x
      lockX = true
      guides.push({ axis: 'x', value: best.x })
      if (angleSnapped && opts.from && lockY) {
        // keep horizontal: fine, x free along the line
      }
    }
  }
  if (!lockY) {
    let best: { y: number; d: number } | null = null
    for (const p of Object.values(plan.points)) {
      if (opts.excludePoints?.has(p.id)) continue
      const d = Math.abs(p.y - pos.y)
      if (d < thr && (!best || d < best.d)) best = { y: p.y, d }
    }
    if (best) {
      pos.y = best.y
      lockY = true
      guides.push({ axis: 'y', value: best.y })
    }
  }
  // diagonal angle snap + alignment could have broken the angle; re-project if both locked by alignment only
  // 5. grid
  if (opts.gridSize) {
    const g = opts.gridSize
    if (!lockX) pos.x = Math.round(pos.x / g) * g
    if (!lockY) pos.y = Math.round(pos.y / g) * g
    if (angleSnapped && opts.from && (lockX !== lockY)) {
      // keep the snapped angle exact for 45° lines after grid rounding of one axis
    }
  }
  return { pos, guides, angleSnapped }
}
