import { describe, expect, it } from 'vitest'
import { emptyPlan, type Plan } from './types'
import { solvePlan } from './constraints'
import { findRooms, wallLength, wallPolygon, clipPolygonToRange, polygonArea } from './geometry'
import { examplePlan } from './example'
import { splitWall } from './store'

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
  return plan
}

describe('solver', () => {
  it('keeps a satisfied plan untouched', () => {
    const plan = rect()
    plan.constraints.c1 = { id: 'c1', type: 'length', wallId: 'ab', value: 4 }
    const { plan: solved, report } = solvePlan(plan)
    expect(report.violated.size).toBe(0)
    expect(solved.points.b.x).toBeCloseTo(4, 6)
  })

  it('enforces a length constraint by moving the closest points', () => {
    const plan = rect()
    plan.constraints.c1 = { id: 'c1', type: 'length', wallId: 'ab', value: 5 }
    plan.constraints.c2 = { id: 'c2', type: 'horizontal', wallId: 'ab' }
    plan.constraints.c3 = { id: 'c3', type: 'fixed', pointId: 'a', x: 0, y: 0 }
    const { plan: solved, report } = solvePlan(plan)
    expect(report.violated.size).toBe(0)
    expect(wallLength(solved, solved.walls.ab)).toBeCloseTo(5, 4)
    expect(solved.points.a.x).toBeCloseTo(0, 4)
    expect(solved.points.b.y).toBeCloseTo(0, 4)
  })

  it('keeps the rectangle rigid while dragging a corner with H/V constraints and a locked length', () => {
    const plan = rect()
    plan.constraints.h1 = { id: 'h1', type: 'horizontal', wallId: 'ab' }
    plan.constraints.h2 = { id: 'h2', type: 'horizontal', wallId: 'cd' }
    plan.constraints.v1 = { id: 'v1', type: 'vertical', wallId: 'bc' }
    plan.constraints.v2 = { id: 'v2', type: 'vertical', wallId: 'da' }
    plan.constraints.l1 = { id: 'l1', type: 'length', wallId: 'ab', value: 4 }
    // drag corner c far away: the width must stay 4, the height should follow
    const { plan: solved, report } = solvePlan(plan, [{ pointId: 'c', x: 6, y: 5 }])
    expect(report.violated.size).toBe(0)
    expect(wallLength(solved, solved.walls.ab)).toBeCloseTo(4, 3)
    expect(wallLength(solved, solved.walls.cd)).toBeCloseTo(4, 3)
    expect(solved.points.c.y).toBeCloseTo(5, 2)
    expect(solved.points.c.x - solved.points.d.x).toBeCloseTo(4, 3)
  })

  it('reports conflicting constraints instead of silently breaking', () => {
    const plan = rect()
    plan.constraints.l1 = { id: 'l1', type: 'length', wallId: 'ab', value: 4 }
    plan.constraints.l2 = { id: 'l2', type: 'length', wallId: 'ab', value: 6 }
    const { report } = solvePlan(plan)
    expect(report.violated.size).toBeGreaterThan(0)
  })

  it('handles perpendicular and equal-length constraints', () => {
    const plan = rect()
    plan.points.c = { id: 'c', x: 4.5, y: 3.2 }
    plan.constraints.p = { id: 'p', type: 'perpendicular', wallA: 'ab', wallB: 'bc' }
    plan.constraints.e = { id: 'e', type: 'equalLength', wallA: 'ab', wallB: 'bc' }
    const { plan: solved, report } = solvePlan(plan)
    expect(report.violated.size).toBe(0)
    const a = solved.points.a
    const b = solved.points.b
    const c = solved.points.c
    const d1 = { x: b.x - a.x, y: b.y - a.y }
    const d2 = { x: c.x - b.x, y: c.y - b.y }
    expect(d1.x * d2.x + d1.y * d2.y).toBeCloseTo(0, 3)
    expect(Math.hypot(d1.x, d1.y)).toBeCloseTo(Math.hypot(d2.x, d2.y), 3)
  })

  it('keeps an opening at a locked distance from the far wall end', () => {
    const plan = rect()
    plan.openings.o = { id: 'o', kind: 'door', wallId: 'ab', offset: 0.5, width: 0.9, height: 2.1, sill: 0, hingeB: false, swingRight: false }
    plan.constraints.k = { id: 'k', type: 'openingOffsetB', openingId: 'o', value: 0.3 }
    plan.constraints.l = { id: 'l', type: 'length', wallId: 'ab', value: 6 }
    plan.constraints.h = { id: 'h', type: 'horizontal', wallId: 'ab' }
    plan.constraints.f = { id: 'f', type: 'fixed', pointId: 'a', x: 0, y: 0 }
    const { plan: solved, report } = solvePlan(plan)
    expect(report.violated.size).toBe(0)
    expect(solved.openings.o.offset).toBeCloseTo(6 - 0.9 - 0.3, 3)
  })

  it('solves the example plan without violations', () => {
    const { report } = solvePlan(examplePlan())
    expect(report.violated.size).toBe(0)
  })
})

describe('geometry', () => {
  it('finds the room inside a rectangle', () => {
    const rooms = findRooms(rect())
    expect(rooms).toHaveLength(1)
    expect(Math.abs(rooms[0].area)).toBeCloseTo(12, 6)
  })

  it('finds three rooms in the example plan', () => {
    const rooms = findRooms(examplePlan())
    expect(rooms.length).toBe(4)
    const total = rooms.reduce((s, r) => s + r.area, 0)
    expect(total).toBeCloseTo(9 * 6.5, 6)
  })

  it('mitres corners so the wall polygon area matches a mitred joint', () => {
    const plan = rect()
    const poly = wallPolygon(plan, plan.walls.ab)
    expect(poly).toHaveLength(4)
    // the outer side extends to (-0.1, -0.1) and (4.1, -0.1); the inner to (0.1, 0.1) and (3.9, 0.1)
    const xs = poly.map((p) => p.x).sort((m, n) => m - n)
    expect(xs[0]).toBeCloseTo(-0.1, 6)
    expect(xs[3]).toBeCloseTo(4.1, 6)
    expect(Math.abs(polygonArea(poly))).toBeCloseTo(0.2 * 4, 6)
  })

  it('clips a wall polygon to a range along its axis', () => {
    const plan = rect()
    const poly = wallPolygon(plan, plan.walls.ab)
    const piece = clipPolygonToRange(poly, plan.points.a, { x: 1, y: 0 }, 1, 2)
    expect(Math.abs(polygonArea(piece))).toBeCloseTo(0.2, 6)
  })

  it('splits a wall and keeps its openings', () => {
    const plan = rect()
    plan.openings.o = { id: 'o', kind: 'window', wallId: 'ab', offset: 3, width: 0.8, height: 1.2, sill: 0.9, hingeB: false, swingRight: false }
    plan.constraints.l = { id: 'l', type: 'length', wallId: 'ab', value: 4 }
    const { plan: next, pointId } = splitWall(plan, 'ab', 0.5)
    expect(next.walls.ab).toBeUndefined()
    expect(Object.keys(next.walls)).toHaveLength(5)
    expect(next.points[pointId].x).toBeCloseTo(2)
    const o = next.openings.o
    expect(o.offset).toBeCloseTo(1)
    expect(next.walls[o.wallId].b).toBe('b')
    const { report } = solvePlan(next)
    expect(report.violated.size).toBe(0)
  })
})

describe('wall gap constraint', () => {
  function twoWalls(): Plan {
    const plan = emptyPlan()
    for (const [id, x, y] of [
      ['a1', 0, 0],
      ['a2', 6, 0],
      ['b1', 1, 2],
      ['b2', 5, 2],
    ] as [string, number, number][])
      plan.points[id] = { id, x, y }
    plan.walls.wa = { id: 'wa', a: 'a1', b: 'a2', thickness: 0.2, height: 2.5 }
    plan.walls.wb = { id: 'wb', a: 'b1', b: 'b2', thickness: 0.4, height: 2.5 }
    return plan
  }
  it('holds the clear distance between two parallel walls', () => {
    const plan = twoWalls()
    plan.constraints.g = { id: 'g', type: 'wallGap', wallA: 'wa', wallB: 'wb', value: 1.5 }
    const { plan: solved, report } = solvePlan(plan)
    expect(report.violated.size).toBe(0)
    // centrelines 1.5 + 0.1 + 0.2 apart, whichever wall moved
    const ya = (solved.points.a1.y + solved.points.a2.y) / 2
    const yb = (solved.points.b1.y + solved.points.b2.y) / 2
    expect(Math.abs(yb - ya - 0.1 - 0.2 - 1.5)).toBeLessThan(1e-3)
  })
  it('reports a gap that conflicts with anchored corners', () => {
    const plan = twoWalls()
    for (const id of ['a1', 'a2', 'b1', 'b2']) plan.constraints['f' + id] = { id: 'f' + id, type: 'fixed', pointId: id, x: plan.points[id].x, y: plan.points[id].y }
    plan.constraints.g = { id: 'g', type: 'wallGap', wallA: 'wa', wallB: 'wb', value: 1.0 }
    const { report } = solvePlan(plan)
    expect(report.violated.has('g')).toBe(true)
  })
})
