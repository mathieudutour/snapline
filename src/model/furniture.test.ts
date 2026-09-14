import { describe, expect, it } from 'vitest'
import { emptyPlan, type Furniture, type Plan } from './types'
import { solvePlan } from './constraints'
import { furnitureSide, snapFurnitureToWall } from './furniture'
import { examplePlan } from './example'

function roomWithBed(): { plan: Plan; bed: Furniture } {
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
  // bed with its head (back) against the top wall, 1.5 wide, 2 deep; angle 0 means the back faces -y
  const bed: Furniture = { id: 'bed', catalogKey: 'test', name: 'Bed', x: 2, y: 0.1 + 1, angle: 0, width: 1.5, depth: 2, height: 0.5, elevation: 0 }
  plan.furniture.bed = bed
  return { plan, bed }
}

describe('furniture', () => {
  it('side geometry: back of an unrotated piece faces -y', () => {
    const s = furnitureSide({ x: 0, y: 0, angle: 0, width: 2, depth: 1 }, 'back')
    expect(s.mid.y).toBeCloseTo(-0.5)
    expect(s.normal.y).toBeCloseTo(-1)
    const r = furnitureSide({ x: 0, y: 0, angle: Math.PI / 2, width: 2, depth: 1 }, 'back')
    expect(r.normal.x).toBeCloseTo(1)
  })

  it('snaps a piece against the nearest wall face and turns its back to it', () => {
    const { plan } = roomWithBed()
    // near the left wall (x = 0), roughly facing it (back normal is (sin a, -cos a), so -π/2 faces -x)
    const snap = snapFurnitureToWall(plan, { width: 1.5, depth: 2 }, { x: 1.2, y: 1.5 }, -Math.PI / 2 + 0.15, 0.4)
    expect(snap).not.toBeNull()
    expect(snap!.wallId).toBe('da')
    expect(snap!.x).toBeCloseTo(0.1 + 1, 6)
    const back = furnitureSide({ x: snap!.x, y: snap!.y, angle: snap!.angle, width: 1.5, depth: 2 }, 'back')
    expect(back.mid.x).toBeCloseTo(0.1, 6)
    expect(back.normal.x).toBeCloseTo(-1, 6)
  })

  it('keeps the bed against the wall when the wall moves', () => {
    const { plan } = roomWithBed()
    plan.constraints.g = { id: 'g', type: 'furnitureWallGap', furnitureId: 'bed', wallId: 'ab', side: 'back', value: 0 }
    expect(solvePlan(plan).report.violated.size).toBe(0)
    // move the whole top wall down by 0.5 m by dragging its ends
    const { plan: moved, report } = solvePlan(plan, [
      { pointId: 'a', x: 0, y: 0.5 },
      { pointId: 'b', x: 4, y: 0.5 },
    ])
    expect(report.violated.size).toBe(0)
    expect(moved.points.b.y).toBeCloseTo(0.5, 2)
    expect(moved.furniture.bed.y).toBeCloseTo(0.5 + 0.1 + 1, 3)
    expect(Math.abs(moved.furniture.bed.angle)).toBeLessThan(1e-3)
  })

  it('holds a gap and re-aligns a rotated piece', () => {
    const { plan } = roomWithBed()
    plan.furniture.bed = { ...plan.furniture.bed, angle: 0.2, y: 1.4 }
    plan.constraints.g = { id: 'g', type: 'furnitureWallGap', furnitureId: 'bed', wallId: 'ab', side: 'back', value: 0.3 }
    const { plan: solved, report } = solvePlan(plan)
    expect(report.violated.size).toBe(0)
    const back = furnitureSide(solved.furniture.bed, 'back')
    expect(back.mid.y).toBeCloseTo(0.1 + 0.3, 3)
    expect(Math.abs(back.normal.y + 1)).toBeLessThan(1e-3)
  })

  it('example plan furniture is consistent', () => {
    const plan = examplePlan()
    expect(Object.keys(plan.furniture).length).toBeGreaterThan(10)
    expect(solvePlan(plan).report.violated.size).toBe(0)
  })

  it('does not let a piece flip through the wall to satisfy the gap', () => {
    const { plan } = roomWithBed()
    plan.furniture.bed = { ...plan.furniture.bed, angle: Math.PI, y: 1.6 }
    plan.constraints.g = { id: 'g', type: 'furnitureWallGap', furnitureId: 'bed', wallId: 'ab', side: 'back', value: 0 }
    const { plan: solved, report } = solvePlan(plan)
    expect(report.violated.size).toBe(0)
    expect(solved.furniture.bed.y).toBeGreaterThan(0.5)
    expect(Math.abs(solved.furniture.bed.angle)).toBeLessThan(1e-3)
  })
})
