import type { Furniture, FurnitureSide, Plan, Vec2, Wall } from './types'
import { add, dot, normalize, perp, projectOnSegment, scale, sub } from './geometry'

/** rotate a local footprint vector (x = width axis, z = depth axis, +z is the front) into plan space */
export function localToPlan(f: { x: number; y: number; angle: number }, lx: number, lz: number): Vec2 {
  const c = Math.cos(f.angle)
  const s = Math.sin(f.angle)
  return { x: f.x + lx * c - lz * s, y: f.y + lx * s + lz * c }
}

export function planToLocal(f: { x: number; y: number; angle: number }, p: Vec2): { lx: number; lz: number } {
  const c = Math.cos(f.angle)
  const s = Math.sin(f.angle)
  const dx = p.x - f.x
  const dy = p.y - f.y
  return { lx: dx * c + dy * s, lz: -dx * s + dy * c }
}

export function furnitureCorners(f: Furniture): Vec2[] {
  const hw = f.width / 2
  const hd = f.depth / 2
  return [localToPlan(f, -hw, -hd), localToPlan(f, hw, -hd), localToPlan(f, hw, hd), localToPlan(f, -hw, hd)]
}

/** midpoint, outward normal and edge direction of a side, in plan space */
export function furnitureSide(f: { x: number; y: number; angle: number; width: number; depth: number }, side: FurnitureSide): { mid: Vec2; normal: Vec2; dir: Vec2 } {
  const hw = f.width / 2
  const hd = f.depth / 2
  const local = { back: [0, -hd, 0, -1], front: [0, hd, 0, 1], left: [-hw, 0, -1, 0], right: [hw, 0, 1, 0] }[side]
  const mid = localToPlan(f, local[0], local[1])
  const origin = localToPlan(f, 0, 0)
  const normal = normalize(sub(localToPlan(f, local[2], local[3]), origin))
  return { mid, normal, dir: perp(normal) }
}

export const SIDE_LABELS: Record<FurnitureSide, string> = { back: 'Back', front: 'Front', left: 'Left side', right: 'Right side' }

/** angle that turns `side` of a piece to face a wall whose left normal is n, from the given side of it (s = ±1) */
export function angleFacingWall(side: FurnitureSide, n: Vec2, s: number): number {
  // outward normal of the side must equal -s * n
  const target = scale(n, -s)
  const base = { back: Math.PI, front: 0, left: Math.PI / 2, right: -Math.PI / 2 }[side]
  // outward normal of the front is (−sin a, cos a)... solve for the front then offset by the side's base angle
  const frontAngle = Math.atan2(-target.x, target.y)
  return frontAngle + base
}

export interface WallSnap {
  x: number
  y: number
  angle: number
  wallId: string
}

/**
 * Snap the back of a piece against the nearest wall face when it is close enough.
 * Returns the snapped placement or null.
 */
export function snapFurnitureToWall(plan: Plan, f: { width: number; depth: number }, pos: Vec2, angle: number, threshold: number, side: FurnitureSide = 'back'): WallSnap | null {
  let best: { wall: Wall; d: number; s: number; t: number } | null = null
  const probe = { ...pos, angle, width: f.width, depth: f.depth }
  const sideInfo = furnitureSide(probe, side)
  for (const wall of Object.values(plan.walls)) {
    const a = plan.points[wall.a]
    const b = plan.points[wall.b]
    if (!a || !b) continue
    const pr = projectOnSegment(sideInfo.mid, a, b)
    const u = normalize(sub(b, a))
    const n = perp(u)
    const s = Math.sign(dot(sub(pos, a), n)) || 1
    const faceDistance = Math.abs(dot(sub(sideInfo.mid, a), n)) - wall.thickness / 2
    // the side must be roughly facing the wall and near its face, within the wall's extent
    const facing = dot(sideInfo.normal, scale(n, -s))
    if (facing < 0.5) continue
    if (pr.t <= 0 || pr.t >= 1) continue
    const d = Math.abs(faceDistance)
    if (d < threshold && (!best || d < best.d)) best = { wall, d, s, t: pr.t }
  }
  if (!best) return null
  const a = plan.points[best.wall.a]
  const b = plan.points[best.wall.b]
  const u = normalize(sub(b, a))
  const n = perp(u)
  const newAngle = angleFacingWall(side, n, best.s)
  // distance from the centre to that side
  const half = side === 'back' || side === 'front' ? f.depth / 2 : f.width / 2
  const along = dot(sub(pos, a), u)
  const foot = add(a, scale(u, along))
  const centre = add(foot, scale(n, best.s * (best.wall.thickness / 2 + half)))
  return { x: centre.x, y: centre.y, angle: newAngle, wallId: best.wall.id }
}

/** nearest wall to a given side of a piece (used when adding a gap constraint from the panel) */
export function nearestWallToSide(plan: Plan, f: Furniture, side: FurnitureSide): { wallId: string; gap: number } | null {
  const info = furnitureSide(f, side)
  let best: { wallId: string; gap: number; d: number } | null = null
  for (const wall of Object.values(plan.walls)) {
    const a = plan.points[wall.a]
    const b = plan.points[wall.b]
    const u = normalize(sub(b, a))
    const n = perp(u)
    const s = Math.sign(dot(sub({ x: f.x, y: f.y }, a), n)) || 1
    if (dot(info.normal, scale(n, -s)) < 0.5) continue
    const pr = projectOnSegment(info.mid, a, b)
    if (pr.t <= 0 || pr.t >= 1) continue
    const gap = Math.abs(dot(sub(info.mid, a), n)) - wall.thickness / 2
    if (!best || Math.abs(gap) < best.d) best = { wallId: wall.id, gap: Math.max(0, gap), d: Math.abs(gap) }
  }
  return best
}
