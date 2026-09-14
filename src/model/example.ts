import type { Constraint, Opening, Plan, Wall } from './types'
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
  return plan
}
