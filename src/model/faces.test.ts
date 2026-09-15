import { describe, expect, it } from 'vitest'
import { emptyPlan, type Plan } from './types'
import { solvePlan } from './constraints'
import { dimensionSide, findRooms, oppositeSide, wallFace, wallLength, wallPolygon } from './geometry'
import { examplePlan } from './example'

function rect(): Plan {
  const plan = emptyPlan()
  const pts: [string, number, number][] = [
    ['a', 0, 0],
    ['b', 4, 0],
    ['c', 4, 3],
    ['d', 0, 3],
  ]
  for (const [id, x, y] of pts) plan.points[id] = { id, x, y }
  const walls: [string, string, string][] = [
    ['ab', 'a', 'b'],
    ['bc', 'b', 'c'],
    ['cd', 'c', 'd'],
    ['da', 'd', 'a'],
  ]
  for (const [id, a, b] of walls) plan.walls[id] = { id, a, b, thickness: 0.2, height: 2.5 }
  plan.constraints.h = { id: 'h', type: 'horizontal', wallId: 'ab' }
  plan.constraints.v = { id: 'v', type: 'vertical', wallId: 'da' }
  plan.constraints.v2 = { id: 'v2', type: 'vertical', wallId: 'bc' }
  plan.constraints.f = { id: 'f', type: 'fixed', pointId: 'a', x: 0, y: 0 }
  return plan
}

describe('face-to-face measurements', () => {
  it('reads the outer and inner faces of a rectangle', () => {
    const plan = rect()
    const rooms = findRooms(plan)
    const side = dimensionSide(plan, rooms, plan.walls.ab)
    const outer = wallFace(plan, plan.walls.ab, side)
    const inner = wallFace(plan, plan.walls.ab, oppositeSide(side))
    expect(outer.length).toBeCloseTo(4.2, 6)
    expect(inner.length).toBeCloseTo(3.8, 6)
    expect(inner.insetA).toBeCloseTo(0.1, 6)
    expect(outer.insetA).toBeCloseTo(-0.1, 6)
  })

  it('locks a face length: the room becomes exactly that wide inside', () => {
    const plan = rect()
    const rooms = findRooms(plan)
    const inner = oppositeSide(dimensionSide(plan, rooms, plan.walls.ab))
    plan.constraints.l = { id: 'l', type: 'length', wallId: 'ab', value: 4, side: inner }
    const { plan: solved, report } = solvePlan(plan)
    expect(report.violated.size).toBe(0)
    expect(wallFace(solved, solved.walls.ab, inner).length).toBeCloseTo(4, 4)
    expect(wallLength(solved, solved.walls.ab)).toBeCloseTo(4.2, 4)
  })

  it('keeps a door at a face-based distance from the corner', () => {
    const plan = rect()
    plan.openings.o = { id: 'o', kind: 'door', wallId: 'ab', offset: 1, width: 0.9, height: 2.1, sill: 0, hingeB: false, swingRight: false }
    const rooms = findRooms(plan)
    const inner = oppositeSide(dimensionSide(plan, rooms, plan.walls.ab))
    plan.constraints.k = { id: 'k', type: 'openingOffsetA', openingId: 'o', value: 0.5, side: inner }
    const { plan: solved, report } = solvePlan(plan)
    expect(report.violated.size).toBe(0)
    const face = wallFace(solved, solved.walls.ab, inner)
    expect(solved.openings.o.offset - face.insetA).toBeCloseTo(0.5, 4)
    // thicker adjacent wall pushes the face inwards; the door follows so the clear distance stays 0.5
    const thick = { ...solved, walls: { ...solved.walls, da: { ...solved.walls.da, thickness: 0.4 } } }
    const again = solvePlan(thick)
    expect(again.report.violated.size).toBe(0)
    expect(again.plan.openings.o.offset - wallFace(again.plan, again.plan.walls.ab, inner).insetA).toBeCloseTo(0.5, 4)
    expect(again.plan.openings.o.offset).toBeGreaterThan(solved.openings.o.offset)
  })

  it('trims a wall face at a T-junction by the crossing wall', () => {
    const plan = rect()
    // interior wall from the middle of the top wall down to the middle of the bottom wall
    plan.points.m = { id: 'm', x: 2, y: 0 }
    plan.points.n = { id: 'n', x: 2, y: 3 }
    plan.walls.ab = { ...plan.walls.ab, b: 'm' }
    plan.walls.mb = { id: 'mb', a: 'm', b: 'b', thickness: 0.2, height: 2.5 }
    plan.walls.cd = { ...plan.walls.cd, b: 'n' }
    plan.walls.nd = { id: 'nd', a: 'n', b: 'd', thickness: 0.2, height: 2.5 }
    plan.walls.mn = { id: 'mn', a: 'm', b: 'n', thickness: 0.1, height: 2.5 }
    const left = wallFace(plan, plan.walls.mn, 'left')
    const right = wallFace(plan, plan.walls.mn, 'right')
    // both faces stop at the inner faces of the top and bottom walls: 3 - 0.1 - 0.1
    expect(left.length).toBeCloseTo(2.8, 6)
    expect(right.length).toBeCloseTo(2.8, 6)
    // the top wall's inner face (room side) stops at the interior wall's face, its outer face runs to the junction
    const rooms = findRooms(plan)
    const outer = dimensionSide(plan, rooms, plan.walls.ab)
    expect(wallFace(plan, plan.walls.ab, oppositeSide(outer)).length).toBeCloseTo(2 - 0.1 - 0.05, 6)
    expect(wallFace(plan, plan.walls.ab, outer).length).toBeCloseTo(2 + 0.1, 6)
  })

  it('example plans use face-based constraints and still solve', () => {
    const plan = examplePlan()
    const lengths = Object.values(plan.constraints).filter((c) => c.type === 'length')
    expect(lengths.length).toBeGreaterThan(0)
    expect(lengths.every((c) => c.type === 'length' && c.side)).toBe(true)
    expect(solvePlan(plan).report.violated.size).toBe(0)
  })

  it('keeps the bar of a T-junction square while the stem stops at its face', () => {
    const plan = emptyPlan()
    const pt = (id: string, x: number, y: number) => (plan.points[id] = { id, x, y })
    pt('l', 0, 0)
    pt('m', 3, 0)
    pt('r', 6, 0)
    pt('d', 3, 3)
    const wall = (id: string, a: string, b: string) => (plan.walls[id] = { id, a, b, thickness: 0.2, height: 2.5 })
    wall('left', 'l', 'm')
    wall('right', 'm', 'r')
    wall('stem', 'm', 'd')
    // both halves of the bar reach the junction on both faces (full 0.2 m section at x = 3)
    for (const id of ['left', 'right']) {
      const poly = wallPolygon(plan, plan.walls[id])
      const atJunction = poly.filter((p) => Math.abs(p.x - 3) < 1e-9)
      expect(atJunction).toHaveLength(2)
      expect(Math.abs(atJunction[0].y - atJunction[1].y)).toBeCloseTo(0.2, 9)
    }
    // the stem starts at the bar's lower face (y = 0.1), squarely
    const stem = wallPolygon(plan, plan.walls.stem)
    const top = stem.filter((p) => p.y < 1)
    expect(top).toHaveLength(2)
    for (const p of top) expect(p.y).toBeCloseTo(0.1, 9)
  })
})
