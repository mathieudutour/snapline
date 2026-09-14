import type { Constraint, Furniture, Opening, Plan, Wall } from './types'
import { CATALOG_BY_KEY } from '../furniture/catalog'
import { dimensionSide, findRooms, oppositeSide, wallFace } from './geometry'

/** turn centreline lengths / offsets into face-based constraints measured where the plan draws its dimensions */
function faceBased(plan: Plan): void {
  const rooms = findRooms(plan)
  for (const c of Object.values(plan.constraints)) {
    if (c.type === 'length' && !c.side) {
      const side = dimensionSide(plan, rooms, plan.walls[c.wallId])
      plan.constraints[c.id] = { ...c, side, value: Math.round(wallFace(plan, plan.walls[c.wallId], side).length * 1000) / 1000 }
    }
    if ((c.type === 'openingOffsetA' || c.type === 'openingOffsetB' || c.type === 'openingCentered') && !c.side) {
      const o = plan.openings[c.openingId]
      const w = plan.walls[o.wallId]
      const side = oppositeSide(dimensionSide(plan, rooms, w))
      const f = wallFace(plan, w, side)
      if (c.type === 'openingOffsetA') plan.constraints[c.id] = { ...c, side, value: Math.round((o.offset - f.insetA) * 1000) / 1000 }
      else if (c.type === 'openingOffsetB') plan.constraints[c.id] = { ...c, side, value: Math.round((Math.hypot(plan.points[w.b].x - plan.points[w.a].x, plan.points[w.b].y - plan.points[w.a].y) - o.offset - o.width - f.insetB) * 1000) / 1000 }
      else plan.constraints[c.id] = { ...c, side }
    }
  }
}
import { emptyPlan } from './types'

/** A small two-bedroom apartment used as the onboarding example. */
export function examplePlan(): Plan {
  const plan = emptyPlan()
  const pts: Record<string, [number, number]> = {
    p1: [0, 0],
    p2: [9, 0],
    p3: [9, 6.5],
    p4: [0, 6.5],
    p5: [4, 0],
    p6: [4, 3.5],
    p7: [0, 3.5],
    p8: [9, 3.5],
    p9: [6.5, 3.5],
    p10: [6.5, 6.5],
  }
  for (const [id, [x, y]] of Object.entries(pts)) plan.points[id] = { id, x, y }
  const walls: [string, string, string][] = [
    ['w1', 'p1', 'p5'],
    ['w2', 'p5', 'p2'],
    ['w3', 'p2', 'p8'],
    ['w4', 'p8', 'p3'],
    ['w5', 'p3', 'p10'],
    ['w6', 'p10', 'p4'],
    ['w7', 'p4', 'p7'],
    ['w8', 'p7', 'p1'],
    ['w9', 'p5', 'p6'],
    ['w10', 'p7', 'p6'],
    ['w11', 'p6', 'p9'],
    ['w12', 'p9', 'p8'],
    ['w13', 'p9', 'p10'],
  ]
  for (const [id, a, b] of walls) {
    const exterior = Number(id.slice(1)) <= 8
    const wall: Wall = { id, a, b, thickness: exterior ? 0.25 : 0.12, height: plan.settings.wallHeight }
    plan.walls[id] = wall
  }
  const openings: Opening[] = [
    { id: 'o1', kind: 'door', wallId: 'w6', offset: 0.8, width: 0.9, height: 2.1, sill: 0, hingeB: false, swingRight: false },
    { id: 'o2', kind: 'door', wallId: 'w10', offset: 1.5, width: 0.8, height: 2.1, sill: 0, hingeB: true, swingRight: false },
    { id: 'o3', kind: 'door', wallId: 'w11', offset: 0.4, width: 0.8, height: 2.1, sill: 0, hingeB: false, swingRight: true },
    { id: 'o4', kind: 'door', wallId: 'w13', offset: 0.5, width: 0.8, height: 2.1, sill: 0, hingeB: false, swingRight: true },
    { id: 'o5', kind: 'window', wallId: 'w1', offset: 1.2, width: 1.4, height: 1.3, sill: 0.9, hingeB: false, swingRight: false },
    { id: 'o6', kind: 'window', wallId: 'w2', offset: 1.5, width: 2.0, height: 1.3, sill: 0.9, hingeB: false, swingRight: false },
    { id: 'o7', kind: 'window', wallId: 'w4', offset: 1.0, width: 1.2, height: 1.3, sill: 0.9, hingeB: false, swingRight: false },
    { id: 'o8', kind: 'window', wallId: 'w8', offset: 0.8, width: 1.4, height: 1.3, sill: 0.9, hingeB: false, swingRight: false },
    { id: 'o9', kind: 'window', wallId: 'w3', offset: 1.2, width: 1.2, height: 1.3, sill: 0.9, hingeB: false, swingRight: false },
  ]
  for (const o of openings) plan.openings[o.id] = o
  const constraints: Constraint[] = [
    { id: 'c1', type: 'horizontal', wallId: 'w1' },
    { id: 'c2', type: 'horizontal', wallId: 'w2' },
    { id: 'c3', type: 'vertical', wallId: 'w3' },
    { id: 'c4', type: 'vertical', wallId: 'w4' },
    { id: 'c5', type: 'horizontal', wallId: 'w5' },
    { id: 'c6', type: 'horizontal', wallId: 'w6' },
    { id: 'c7', type: 'vertical', wallId: 'w7' },
    { id: 'c8', type: 'vertical', wallId: 'w8' },
    { id: 'c9', type: 'vertical', wallId: 'w9' },
    { id: 'c10', type: 'horizontal', wallId: 'w10' },
    { id: 'c11', type: 'horizontal', wallId: 'w11' },
    { id: 'c12', type: 'horizontal', wallId: 'w12' },
    { id: 'c13', type: 'vertical', wallId: 'w13' },
    { id: 'c14', type: 'length', wallId: 'w1', value: 4 },
    { id: 'c15', type: 'length', wallId: 'w2', value: 5 },
    { id: 'c16', type: 'length', wallId: 'w3', value: 3.5 },
    { id: 'c17', type: 'length', wallId: 'w4', value: 3 },
    { id: 'c18', type: 'length', wallId: 'w9', value: 3.5 },
    { id: 'c19', type: 'fixed', pointId: 'p1', x: 0, y: 0 },
    { id: 'c20', type: 'openingCentered', openingId: 'o6' },
    { id: 'c21', type: 'openingOffsetA', openingId: 'o1', value: 0.8 },
  ]
  for (const c of constraints) plan.constraints[c.id] = c
  faceBased(plan)

  const HALF = Math.PI / 2
  const furniture: [string, string, number, number, number, string | null, number?][] = [
    // id, catalogue key, x, y, angle, wall to lock the back against, elevation
    ['f1', 'b0-bed1', 2.9, 1.75, HALF, 'w9'],
    ['f2', 'b0-bedsidetable2', 3.7, 0.79, HALF, 'w9'],
    ['f3', 'b0-bedsidetable2', 3.7, 2.71, HALF, 'w9'],
    ['f4', 'by-wardrobe', 0.585, 0.465, 0, 'w1'],
    ['f5', 'b0-couch', 8.435, 1.75, HALF, 'w3'],
    ['f6', 'by-coffeetable', 7.3, 1.75, HALF, null],
    ['f7', 'b0-televisioncabinet', 4.405, 1.75, -HALF, 'w9'],
    ['f8', 'by-biurko3', 6.5, 0.425, 0, 'w2'],
    ['f9', 'kl-office-chair', 6.5, 1.15, Math.PI, null],
    ['f10', 'b0-sinkcabinet2', 0.425, 6.07, Math.PI, 'w6'],
    ['f11', 'b0-lowercabinet', 1.025, 6.07, Math.PI, 'w6'],
    ['f12', 'b0-drawerscabinet', 1.625, 6.07, Math.PI, 'w6'],
    ['f13', 'b0-lowercabinet', 2.225, 6.07, Math.PI, 'w6'],
    ['f14', 'lp-frigo', 2.825, 6.06, Math.PI, 'w6'],
    ['f15', 'b0-uppercabinet', 0.425, 6.17, Math.PI, 'w6', 1.5],
    ['f16', 'b0-uppercabinet', 1.025, 6.17, Math.PI, 'w6', 1.5],
    ['f17', 'by-table', 3.6, 4.6, 0, null],
    ['f18', 'by-kitchenchair', 3.2, 3.9, 0, null],
    ['f19', 'by-kitchenchair', 4.0, 3.9, 0, null],
    ['f20', 'by-kitchenchair', 3.2, 5.3, Math.PI, null],
    ['f21', 'by-kitchenchair', 4.0, 5.3, Math.PI, null],
    ['f22', 'b0-toiletsunit', 8.53, 4.2, HALF, 'w4'],
    ['f23', 'b0-washbasin', 7.6, 3.79, 0, 'w12'],
    ['f24', 'co-shower-cabin', 8.425, 5.925, Math.PI, 'w5'],
  ]
  let n = 100
  for (const [id, key, x, y, angle, wallId, elevation] of furniture) {
    const item = CATALOG_BY_KEY[key]
    if (!item) continue
    const piece: Furniture = { id, catalogKey: key, name: item.name, x, y, angle, width: item.width, depth: item.depth, height: item.height, elevation: elevation ?? item.elevation }
    plan.furniture[id] = piece
    if (wallId) {
      const cid = `c${n++}`
      plan.constraints[cid] = { id: cid, type: 'furnitureWallGap', furnitureId: id, wallId, side: 'back', value: 0 }
    }
  }
  return plan
}

import { DEFAULT_ROOF, newProject, type Project } from './project'
import { newId } from './types'

/** Two-floor house with a gable roof: the furnished apartment below and bedrooms above. */
export function exampleProject(): Project {
  const project = newProject('Example house', examplePlan())
  const upper = emptyPlan()
  upper.settings.wallHeight = 2.4
  const pts: Record<string, [number, number]> = { q1: [0, 0], q2: [9, 0], q3: [9, 6.5], q4: [0, 6.5], q5: [4.5, 0], q6: [4.5, 6.5], q7: [4.5, 3.5], q8: [9, 3.5] }
  for (const [id, [x, y]] of Object.entries(pts)) upper.points[id] = { id, x, y }
  const walls: [string, string, string, number][] = [
    ['u1', 'q1', 'q5', 0.25],
    ['u2', 'q5', 'q2', 0.25],
    ['u3', 'q2', 'q8', 0.25],
    ['u4', 'q8', 'q3', 0.25],
    ['u5', 'q3', 'q6', 0.25],
    ['u6', 'q6', 'q4', 0.25],
    ['u7', 'q4', 'q1', 0.25],
    ['u8', 'q5', 'q7', 0.12],
    ['u9', 'q7', 'q6', 0.12],
    ['u10', 'q7', 'q8', 0.12],
  ]
  for (const [id, a, b, thickness] of walls) upper.walls[id] = { id, a, b, thickness, height: upper.settings.wallHeight } as Wall
  const openings: Opening[] = [
    { id: 'v1', kind: 'window', wallId: 'u1', offset: 1.5, width: 1.4, height: 1.3, sill: 0.9, hingeB: false, swingRight: false },
    { id: 'v2', kind: 'window', wallId: 'u2', offset: 1.5, width: 1.4, height: 1.3, sill: 0.9, hingeB: false, swingRight: false },
    { id: 'v3', kind: 'window', wallId: 'u7', offset: 1.8, width: 1.2, height: 1.3, sill: 0.9, hingeB: false, swingRight: false },
    { id: 'v4', kind: 'window', wallId: 'u3', offset: 1.2, width: 1.2, height: 1.3, sill: 0.9, hingeB: false, swingRight: false },
    { id: 'v5', kind: 'window', wallId: 'u5', offset: 1.5, width: 1.2, height: 1.3, sill: 0.9, hingeB: false, swingRight: false },
    { id: 'v6', kind: 'door', wallId: 'u8', offset: 1.0, width: 0.8, height: 2.1, sill: 0, hingeB: false, swingRight: true },
    { id: 'v7', kind: 'door', wallId: 'u9', offset: 0.8, width: 0.8, height: 2.1, sill: 0, hingeB: true, swingRight: true },
    { id: 'v8', kind: 'door', wallId: 'u10', offset: 0.6, width: 0.8, height: 2.1, sill: 0, hingeB: false, swingRight: false },
  ]
  for (const o of openings) upper.openings[o.id] = o
  const constraints: Constraint[] = [
    ...(['u1', 'u2', 'u5', 'u6', 'u10'] as const).map((wallId) => ({ id: newId('c'), type: 'horizontal' as const, wallId })),
    ...(['u3', 'u4', 'u7', 'u8', 'u9'] as const).map((wallId) => ({ id: newId('c'), type: 'vertical' as const, wallId })),
    { id: newId('c'), type: 'length', wallId: 'u1', value: 4.5 },
    { id: newId('c'), type: 'length', wallId: 'u2', value: 4.5 },
    { id: newId('c'), type: 'length', wallId: 'u3', value: 3.5 },
    { id: newId('c'), type: 'length', wallId: 'u4', value: 3 },
    { id: newId('c'), type: 'fixed', pointId: 'q1', x: 0, y: 0 },
  ]
  for (const c of constraints) upper.constraints[c.id] = c
  faceBased(upper)
  const HALF = Math.PI / 2
  const furniture: [string, number, number, number, string | null][] = [
    ['sc-bed1', 1.7, 2.0, HALF, 'u8'],
    ['by-bedsidetable', 4.19, 0.7, HALF, 'u8'],
    ['by-wardrobe2', 1.2, 6.075, Math.PI, 'u6'],
    ['by-juniorbed', 5.66, 1.5, -HALF, 'u8'],
    ['by-biurko3', 7.6, 0.425, 0, 'u2'],
    ['kl-office-chair', 7.6, 1.15, Math.PI, null],
    ['by-wardrobe', 8.42, 2.4, HALF, 'u3'],
    ['by-bath-jay-hardy', 8.4, 5.5, HALF, 'u4'],
    ['b0-washbasin', 6.0, 3.85, 0, 'u10'],
    ['b0-toiletsunit', 7.6, 3.965, 0, 'u10'],
  ]
  for (const [key, x, y, angle, wallId] of furniture) {
    const item = CATALOG_BY_KEY[key]
    if (!item) continue
    const id = newId('f')
    upper.furniture[id] = { id, catalogKey: key, name: item.name, x, y, angle, width: item.width, depth: item.depth, height: item.height, elevation: item.elevation }
    if (wallId) {
      const cid = newId('c')
      upper.constraints[cid] = { id: cid, type: 'furnitureWallGap', furnitureId: id, wallId, side: 'back', value: 0 }
    }
  }
  project.floors.push({ id: newId('fl'), name: '1st floor', plan: upper })
  project.roof = { ...DEFAULT_ROOF, type: 'gable', pitch: 35, overhang: 0.45 }
  return project
}
