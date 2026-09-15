import type { Constraint, Furniture, Opening, Plan, Wall } from './types'
import { furnitureSide } from './furniture'
import { solveLM, type Residual } from './solver'
import { dist, wallFace, wallFacePointIds, wallLength, type PointGetter } from './geometry'

export interface DragTarget {
  pointId: string
  x: number
  y: number
}

export interface FurnitureDrag {
  furnitureId: string
  x?: number
  y?: number
  angle?: number
}

export interface SolveReport {
  /** ids of constraints that could not be satisfied (residual above tolerance) */
  violated: Set<string>
  /** max absolute residual across constraints, in metres */
  maxError: number
}

export const CONSTRAINT_TOLERANCE = 5e-4

const W_CONSTRAINT = 1
/** pull of the cursor while dragging (phase 1) */
const W_DRAG = 1
/** pull towards the pre-solve position (phase 1) so the nearest layout wins */
const W_REG = 1e-2
/** residual pull while polishing onto the exact constraint manifold (phase 2) */
const W_POLISH = 1e-3
const W_REG_OPENING = 0.05

interface VarMap {
  point: Map<string, number>
  opening: Map<string, number>
  /** 3 variables per piece: x, y, angle */
  furniture: Map<string, number>
  count: number
}

function buildVarMap(plan: Plan): VarMap {
  const point = new Map<string, number>()
  const opening = new Map<string, number>()
  let count = 0
  for (const id of Object.keys(plan.points)) {
    point.set(id, count)
    count += 2
  }
  for (const id of Object.keys(plan.openings)) {
    opening.set(id, count)
    count += 1
  }
  const furniture = new Map<string, number>()
  for (const id of Object.keys(plan.furniture ?? {})) {
    furniture.set(id, count)
    count += 3
  }
  return { point, opening, furniture, count }
}

function wallResidualHelpers(plan: Plan, vars: VarMap) {
  /** variables of every point that shapes the wall's faces */
  const faceVars = (w: Wall) => wallFacePointIds(plan, w).flatMap((id) => [vars.point.get(id)!, vars.point.get(id)! + 1])
  const getter = (x: Float64Array): PointGetter => (id) => {
    const i = vars.point.get(id)!
    return { x: x[i], y: x[i + 1] }
  }
  const wallVars = (w: Wall) => {
    const ia = vars.point.get(w.a)!
    const ib = vars.point.get(w.b)!
    return [ia, ia + 1, ib, ib + 1]
  }
  const wallVec = (x: Float64Array, w: Wall) => {
    const ia = vars.point.get(w.a)!
    const ib = vars.point.get(w.b)!
    return { x: x[ib] - x[ia], y: x[ib + 1] - x[ia + 1] }
  }
  return { wallVars, wallVec, faceVars, getter }
}

function angleBetween(d1: { x: number; y: number }, d2: { x: number; y: number }): number {
  return Math.atan2(d1.x * d2.y - d1.y * d2.x, d1.x * d2.x + d1.y * d2.y)
}

function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI
  while (a < -Math.PI) a += 2 * Math.PI
  return a
}

/** Build a residual for a constraint; returns null if it references missing entities. */
function constraintResidual(plan: Plan, vars: VarMap, c: Constraint): Residual | null {
  const { wallVars, wallVec, faceVars, getter } = wallResidualHelpers(plan, vars)
  const wall = (id: string): Wall | undefined => plan.walls[id]
  const opening = (id: string): Opening | undefined => plan.openings[id]
  switch (c.type) {
    case 'length': {
      const w = wall(c.wallId)
      if (!w) return null
      if (c.side) {
        const side = c.side
        return { vars: faceVars(w), weight: W_CONSTRAINT, fn: (x) => [wallFace(plan, w, side, getter(x)).length - c.value] }
      }
      return { vars: wallVars(w), weight: W_CONSTRAINT, fn: (x) => [Math.hypot(wallVec(x, w).x, wallVec(x, w).y) - c.value] }
    }
    case 'horizontal': {
      const w = wall(c.wallId)
      if (!w) return null
      return { vars: wallVars(w), weight: W_CONSTRAINT, fn: (x) => [wallVec(x, w).y] }
    }
    case 'vertical': {
      const w = wall(c.wallId)
      if (!w) return null
      return { vars: wallVars(w), weight: W_CONSTRAINT, fn: (x) => [wallVec(x, w).x] }
    }
    case 'parallel': {
      const w1 = wall(c.wallA)
      const w2 = wall(c.wallB)
      if (!w1 || !w2) return null
      return {
        vars: [...wallVars(w1), ...wallVars(w2)],
        weight: W_CONSTRAINT,
        fn: (x) => {
          const d1 = wallVec(x, w1)
          const d2 = wallVec(x, w2)
          const l1 = Math.hypot(d1.x, d1.y) || 1e-9
          const l2 = Math.hypot(d2.x, d2.y) || 1e-9
          // sine of the angle scaled to ~metres
          return [((d1.x * d2.y - d1.y * d2.x) / (l1 * l2)) * Math.min(l1, l2)]
        },
      }
    }
    case 'perpendicular': {
      const w1 = wall(c.wallA)
      const w2 = wall(c.wallB)
      if (!w1 || !w2) return null
      return {
        vars: [...wallVars(w1), ...wallVars(w2)],
        weight: W_CONSTRAINT,
        fn: (x) => {
          const d1 = wallVec(x, w1)
          const d2 = wallVec(x, w2)
          const l1 = Math.hypot(d1.x, d1.y) || 1e-9
          const l2 = Math.hypot(d2.x, d2.y) || 1e-9
          return [((d1.x * d2.x + d1.y * d2.y) / (l1 * l2)) * Math.min(l1, l2)]
        },
      }
    }
    case 'angle': {
      const w1 = wall(c.wallA)
      const w2 = wall(c.wallB)
      if (!w1 || !w2) return null
      const target = (c.degrees * Math.PI) / 180
      return {
        vars: [...wallVars(w1), ...wallVars(w2)],
        weight: W_CONSTRAINT,
        fn: (x) => [normalizeAngle(angleBetween(wallVec(x, w1), wallVec(x, w2)) - target)],
      }
    }
    case 'equalLength': {
      const w1 = wall(c.wallA)
      const w2 = wall(c.wallB)
      if (!w1 || !w2) return null
      return {
        vars: [...wallVars(w1), ...wallVars(w2)],
        weight: W_CONSTRAINT,
        fn: (x) => {
          const d1 = wallVec(x, w1)
          const d2 = wallVec(x, w2)
          return [Math.hypot(d1.x, d1.y) - Math.hypot(d2.x, d2.y)]
        },
      }
    }
    case 'wallGap': {
      const w1 = wall(c.wallA)
      const w2 = wall(c.wallB)
      if (!w1 || !w2) return null
      const ia = vars.point.get(w1.a)!
      const ja = vars.point.get(w2.a)!
      const jb = vars.point.get(w2.b)!
      return {
        vars: [...wallVars(w1), ...wallVars(w2)],
        weight: W_CONSTRAINT,
        fn: (x) => {
          const d = wallVec(x, w1)
          const l = Math.hypot(d.x, d.y) || 1e-9
          // distance from A's centreline to the middle of B, less the two half thicknesses
          const mx = (x[ja] + x[jb]) / 2 - x[ia]
          const my = (x[ja + 1] + x[jb + 1]) / 2 - x[ia + 1]
          const offset = Math.abs((mx * -d.y + my * d.x) / l)
          return [offset - w1.thickness / 2 - w2.thickness / 2 - c.value]
        },
      }
    }
    case 'fixed': {
      const i = vars.point.get(c.pointId)
      if (i === undefined) return null
      return { vars: [i, i + 1], weight: W_CONSTRAINT, fn: (x) => [x[i] - c.x, x[i + 1] - c.y] }
    }
    case 'distance': {
      const i = vars.point.get(c.pointA)
      const j = vars.point.get(c.pointB)
      if (i === undefined || j === undefined) return null
      return { vars: [i, i + 1, j, j + 1], weight: W_CONSTRAINT, fn: (x) => [Math.hypot(x[j] - x[i], x[j + 1] - x[i + 1]) - c.value] }
    }
    case 'openingOffsetA': {
      const o = opening(c.openingId)
      const w = o && plan.walls[o.wallId]
      if (!o || !w) return null
      const k = vars.opening.get(o.id)!
      if (c.side) {
        const side = c.side
        return { vars: [k, ...faceVars(w)], weight: W_CONSTRAINT, fn: (x) => [x[k] - wallFace(plan, w, side, getter(x)).insetA - c.value] }
      }
      return { vars: [k], weight: W_CONSTRAINT, fn: (x) => [x[k] - c.value] }
    }
    case 'openingOffsetB': {
      const o = opening(c.openingId)
      const w = o && plan.walls[o.wallId]
      if (!o || !w) return null
      const k = vars.opening.get(o.id)!
      const side = c.side
      return {
        vars: [k, ...faceVars(w)],
        weight: W_CONSTRAINT,
        fn: (x) => {
          const d = wallVec(x, w)
          const inset = side ? wallFace(plan, w, side, getter(x)).insetB : 0
          return [Math.hypot(d.x, d.y) - x[k] - o.width - inset - c.value]
        },
      }
    }
    case 'openingCentered': {
      const o = opening(c.openingId)
      const w = o && plan.walls[o.wallId]
      if (!o || !w) return null
      const k = vars.opening.get(o.id)!
      const side = c.side
      return {
        vars: [k, ...faceVars(w)],
        weight: W_CONSTRAINT,
        fn: (x) => {
          const d = wallVec(x, w)
          const L = Math.hypot(d.x, d.y)
          if (!side) return [x[k] + o.width / 2 - L / 2]
          const f = wallFace(plan, w, side, getter(x))
          return [x[k] + o.width / 2 - (f.insetA + (L - f.insetA - f.insetB) / 2)]
        },
      }
    }
    case 'furnitureWallGap': {
      const f: Furniture | undefined = plan.furniture?.[c.furnitureId]
      const w = wall(c.wallId)
      if (!f || !w) return null
      const k = vars.furniture.get(f.id)!
      const ia = vars.point.get(w.a)!
      // which side of the wall the piece sits on is decided once, from the current layout
      const a0 = plan.points[w.a]
      const b0 = plan.points[w.b]
      const u0 = { x: b0.x - a0.x, y: b0.y - a0.y }
      const n0 = { x: -u0.y, y: u0.x }
      const s = Math.sign((f.x - a0.x) * n0.x + (f.y - a0.y) * n0.y) || 1
      return {
        vars: [...wallVars(w), k, k + 1, k + 2],
        weight: W_CONSTRAINT,
        fn: (x) => {
          const d = wallVec(x, w)
          const l = Math.hypot(d.x, d.y) || 1e-9
          const u = { x: d.x / l, y: d.y / l }
          const n = { x: -u.y, y: u.x }
          const side = furnitureSide({ x: x[k], y: x[k + 1], angle: x[k + 2], width: f.width, depth: f.depth }, c.side)
          const ax = x[ia]
          const ay = x[ia + 1]
          // 1. the side faces the wall: its outward normal equals -s·n (angle difference, so the piece cannot flip through the wall)
          const orient = normalizeAngle(Math.atan2(side.normal.y, side.normal.x) - Math.atan2(-s * n.y, -s * n.x))
          // 2. side face at the requested distance from the wall face
          const dist = s * ((side.mid.x - ax) * n.x + (side.mid.y - ay) * n.y) - w.thickness / 2 - c.value
          return [orient, dist]
        },
      }
    }
    case 'furnitureFixed': {
      const f: Furniture | undefined = plan.furniture?.[c.furnitureId]
      if (!f) return null
      const k = vars.furniture.get(f.id)!
      return { vars: [k, k + 1, k + 2], weight: W_CONSTRAINT, fn: (x) => [x[k] - c.x, x[k + 1] - c.y, normalizeAngle(x[k + 2] - c.angle)] }
    }
  }
}

/**
 * Solve the plan so that all constraints hold as closely as possible.
 * Points not being dragged are weakly pulled towards their current position, so the result
 * is the satisfying layout closest to what the user drew.
 */
export function solvePlan(plan: Plan, drags: DragTarget[] = [], furnitureDrags: FurnitureDrag[] = []): { plan: Plan; report: SolveReport } {
  const vars = buildVarMap(plan)
  const x0 = new Float64Array(vars.count)
  for (const [id, i] of vars.point) {
    x0[i] = plan.points[id].x
    x0[i + 1] = plan.points[id].y
  }
  for (const [id, k] of vars.opening) x0[k] = plan.openings[id].offset
  for (const [id, k] of vars.furniture) {
    const f = plan.furniture[id]
    x0[k] = f.x
    x0[k + 1] = f.y
    x0[k + 2] = f.angle
  }

  const residuals: Residual[] = []
  const constraintResiduals: { id: string; res: Residual }[] = []
  for (const c of Object.values(plan.constraints)) {
    const res = constraintResidual(plan, vars, c)
    if (res) {
      residuals.push(res)
      constraintResiduals.push({ id: c.id, res })
    }
  }
  const dragged = new Set<string>()
  const dragResiduals: Residual[] = []
  for (const d of drags) {
    const i = vars.point.get(d.pointId)
    if (i === undefined) continue
    dragged.add(d.pointId)
    dragResiduals.push({ vars: [i, i + 1], weight: W_DRAG, fn: (x) => [x[i] - d.x, x[i + 1] - d.y] })
  }
  const draggedFurniture = new Set<string>()
  for (const d of furnitureDrags) {
    const k = vars.furniture.get(d.furnitureId)
    if (k === undefined) continue
    draggedFurniture.add(d.furnitureId)
    const tx = d.x
    const ty = d.y
    const ta = d.angle
    if (tx !== undefined && ty !== undefined) dragResiduals.push({ vars: [k, k + 1], weight: W_DRAG, fn: (x) => [x[k] - tx, x[k + 1] - ty] })
    if (ta !== undefined) dragResiduals.push({ vars: [k + 2], weight: W_DRAG, fn: (x) => [normalizeAngle(x[k + 2] - ta)] })
  }
  const regularize = (anchor: Float64Array, weight: number, skipDragged: boolean): Residual[] => {
    const out: Residual[] = []
    for (const [id, k] of vars.furniture) {
      if (skipDragged && draggedFurniture.has(id)) continue
      const fx = anchor[k]
      const fy = anchor[k + 1]
      const fa = anchor[k + 2]
      out.push({ vars: [k, k + 1, k + 2], weight, fn: (x) => [x[k] - fx, x[k + 1] - fy, normalizeAngle(x[k + 2] - fa)] })
    }
    for (const [id, i] of vars.point) {
      if (skipDragged && dragged.has(id)) continue
      const px = anchor[i]
      const py = anchor[i + 1]
      out.push({ vars: [i, i + 1], weight, fn: (x) => [x[i] - px, x[i + 1] - py] })
    }
    for (const [, k] of vars.opening) {
      const o0 = anchor[k]
      out.push({ vars: [k], weight: Math.max(weight, W_REG_OPENING), fn: (x) => [x[k] - o0] })
    }
    return out
  }

  let x: Float64Array = x0
  if (constraintResiduals.length > 0 || dragResiduals.length > 0) {
    // phase 1: follow the cursor / new constraint values, staying close to the current layout
    x = solveLM(x0, [...residuals, ...dragResiduals, ...regularize(x0, W_REG, true)], { maxIter: 60 }).x
    if (constraintResiduals.length > 0) {
      // phase 2: drop the drag pull and snap exactly onto the constraints, nearest to phase 1
      x = solveLM(x, [...residuals, ...regularize(x, W_POLISH, false)], { maxIter: 40 }).x
    }
  }

  const points = { ...plan.points }
  for (const [id, i] of vars.point) points[id] = { ...plan.points[id], x: x[i], y: x[i + 1] }
  const openings = { ...plan.openings }
  const furniture = { ...plan.furniture }
  for (const [id, k] of vars.furniture) furniture[id] = { ...plan.furniture[id], x: x[k], y: x[k + 1], angle: normalizeAngle(x[k + 2]) }
  const next: Plan = { ...plan, points, openings, furniture }
  for (const [id, k] of vars.opening) {
    const o = plan.openings[id]
    const w = plan.walls[o.wallId]
    const maxOffset = w ? Math.max(0, wallLength(next, w) - o.width) : 0
    openings[id] = { ...o, offset: Math.min(Math.max(0, x[k]), maxOffset) }
  }

  const violated = new Set<string>()
  let maxError = 0
  for (const { id, res } of constraintResiduals) {
    const values = res.fn(x)
    const err = Math.max(...values.map(Math.abs))
    maxError = Math.max(maxError, err)
    if (err > CONSTRAINT_TOLERANCE) violated.add(id)
  }
  // an opening that had to be clamped is also a broken constraint
  for (const c of Object.values(plan.constraints)) {
    if ((c.type === 'openingOffsetA' || c.type === 'openingOffsetB' || c.type === 'openingCentered') && plan.openings[c.openingId]) {
      const o = openings[c.openingId]
      const k = vars.opening.get(o.id)!
      if (Math.abs(o.offset - x[k]) > CONSTRAINT_TOLERANCE) violated.add(c.id)
    }
  }
  return { plan: next, report: { violated, maxError } }
}

export function describeConstraint(plan: Plan, c: Constraint): string {
  const wallName = (id: string) => {
    const w = plan.walls[id]
    return w ? `wall ${shortId(id)}` : 'missing wall'
  }
  const openingName = (id: string) => {
    const o = plan.openings[id]
    return o ? `${o.kind} ${shortId(id)}` : 'missing opening'
  }
  switch (c.type) {
    case 'length':
      return `${wallName(c.wallId)} length = ${fmt(c.value)}${c.side ? '' : ' (centreline)'}`
    case 'horizontal':
      return `${wallName(c.wallId)} horizontal`
    case 'vertical':
      return `${wallName(c.wallId)} vertical`
    case 'parallel':
      return `${wallName(c.wallA)} ∥ ${wallName(c.wallB)}`
    case 'perpendicular':
      return `${wallName(c.wallA)} ⟂ ${wallName(c.wallB)}`
    case 'equalLength':
      return `${wallName(c.wallA)} = ${wallName(c.wallB)}`
    case 'angle':
      return `${wallName(c.wallA)} ∠ ${wallName(c.wallB)} = ${c.degrees}°`
    case 'wallGap':
      return `${wallName(c.wallA)} ↔ ${wallName(c.wallB)} = ${fmt(c.value)}`
    case 'fixed':
      return `point ${shortId(c.pointId)} fixed at (${fmt(c.x)}, ${fmt(c.y)})`
    case 'distance':
      return `distance ${shortId(c.pointA)}–${shortId(c.pointB)} = ${fmt(c.value)}`
    case 'openingOffsetA':
      return `${openingName(c.openingId)} ${fmt(c.value)} from start${c.side ? '' : ' (centreline)'}`
    case 'openingOffsetB':
      return `${openingName(c.openingId)} ${fmt(c.value)} from end${c.side ? '' : ' (centreline)'}`
    case 'openingCentered':
      return `${openingName(c.openingId)} centred on wall`
    case 'furnitureWallGap': {
      const f = plan.furniture?.[c.furnitureId]
      const side = { back: 'back', front: 'front', left: 'left side', right: 'right side' }[c.side]
      return `${f ? f.name : 'missing item'} ${side} ${c.value < 0.005 ? 'against' : fmt(c.value) + ' from'} ${wallName(c.wallId)}`
    }
    case 'furnitureFixed':
      return `${plan.furniture?.[c.furnitureId]?.name ?? 'missing item'} anchored`
  }
}

export function shortId(id: string): string {
  return id.slice(-4)
}

function fmt(m: number): string {
  return `${m.toFixed(2)} m`
}

/** Constraints that reference the given entity ids. */
export function constraintsReferencing(plan: Plan, ids: { walls?: string[]; points?: string[]; openings?: string[]; furniture?: string[] }): Constraint[] {
  const walls = new Set(ids.walls ?? [])
  const points = new Set(ids.points ?? [])
  const openings = new Set(ids.openings ?? [])
  const furniture = new Set(ids.furniture ?? [])
  return Object.values(plan.constraints).filter((c) => {
    switch (c.type) {
      case 'length':
      case 'horizontal':
      case 'vertical':
        return walls.has(c.wallId)
      case 'parallel':
      case 'perpendicular':
      case 'equalLength':
      case 'angle':
      case 'wallGap':
        return walls.has(c.wallA) || walls.has(c.wallB)
      case 'fixed':
        return points.has(c.pointId)
      case 'distance':
        return points.has(c.pointA) || points.has(c.pointB)
      case 'openingOffsetA':
      case 'openingOffsetB':
      case 'openingCentered':
        return openings.has(c.openingId)
      case 'furnitureWallGap':
        return furniture.has(c.furnitureId) || walls.has(c.wallId)
      case 'furnitureFixed':
        return furniture.has(c.furnitureId)
    }
  })
}

export function pointDistance(plan: Plan, a: string, b: string): number {
  return dist(plan.points[a], plan.points[b])
}
