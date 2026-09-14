import { describe, expect, it } from 'vitest'
import { emptyPlan } from './types'
import { wallGap } from './measure'

function planWith(walls: { id: string; a: [number, number]; b: [number, number]; thickness?: number }[]) {
  const plan = emptyPlan()
  for (const w of walls) {
    plan.points[w.id + 'a'] = { id: w.id + 'a', x: w.a[0], y: w.a[1] }
    plan.points[w.id + 'b'] = { id: w.id + 'b', x: w.b[0], y: w.b[1] }
    plan.walls[w.id] = { id: w.id, a: w.id + 'a', b: w.id + 'b', thickness: w.thickness ?? 0.2, height: 2.5 }
  }
  return plan
}

describe('wall gap measurement', () => {
  it('measures parallel walls face to face across their overlap', () => {
    const plan = planWith([
      { id: 'w1', a: [0, 0], b: [6, 0] },
      { id: 'w2', a: [2, 3], b: [8, 3], thickness: 0.4 },
    ])
    const g = wallGap(plan, plan.walls.w1, plan.walls.w2)!
    expect(g.parallel).toBe(true)
    expect(g.distance).toBeCloseTo(3 - 0.1 - 0.2, 6)
    expect(g.from).toEqual({ x: 4, y: 0.1 })
    expect(g.to.y).toBeCloseTo(2.8, 6)
    expect(g.extension).toBeUndefined()
    // no overlap along the wall: measured in front of the other wall's middle, with an extension from the end
    plan.points.w2a.x = 8
    plan.points.w2b.x = 12
    const far = wallGap(plan, plan.walls.w1, plan.walls.w2)!
    expect(far.from.x).toBeCloseTo(10, 6)
    expect(far.extension![0]).toEqual({ x: 6, y: 0.1 })
    expect(far.extension![1].x).toBeCloseTo(10, 6)
    // symmetric
    expect(wallGap(plan, plan.walls.w2, plan.walls.w1)!.distance).toBeCloseTo(g.distance, 6)
  })

  it('uses the shortest outline distance for walls that are not parallel', () => {
    const plan = planWith([
      { id: 'w1', a: [0, 0], b: [4, 0] },
      { id: 'w2', a: [6, 1], b: [6, 5] },
    ])
    const g = wallGap(plan, plan.walls.w1, plan.walls.w2)!
    expect(g.parallel).toBe(false)
    // corner of w1 at (4, 0.1) to corner of w2 at (5.9, 1)
    expect(g.distance).toBeCloseTo(Math.hypot(1.9, 0.9), 6)
  })

  it('returns nothing for touching walls or the same wall', () => {
    const plan = planWith([
      { id: 'w1', a: [0, 0], b: [4, 0] },
      { id: 'w2', a: [4, 0], b: [4, 3] },
    ])
    plan.walls.w2.a = 'w1b' // joined at the corner, as walls drawn in the editor are
    expect(wallGap(plan, plan.walls.w1, plan.walls.w2)).toBeNull()
    expect(wallGap(plan, plan.walls.w1, plan.walls.w1)).toBeNull()
  })
})
