import { describe, expect, it } from 'vitest'
import { emptyPlan } from '../model/types'
import { chainedStrings, cullLabels, drawingScale, nearestSide, nextDensity, planEnvelope, rotatedRect, zoomForScale } from './labels'

function planWith(walls: { id: string; a: [number, number]; b: [number, number]; thickness?: number }[]) {
  const plan = emptyPlan()
  const pointId = (p: [number, number]) => {
    const existing = Object.values(plan.points).find((q) => q.x === p[0] && q.y === p[1])
    if (existing) return existing.id
    const id = `p${Object.keys(plan.points).length}`
    plan.points[id] = { id, x: p[0], y: p[1] }
    return id
  }
  for (const w of walls) plan.walls[w.id] = { id: w.id, a: pointId(w.a), b: pointId(w.b), thickness: w.thickness ?? 0.2, height: 2.5 }
  return plan
}

/** a 6 × 4 house with a partition at x = 2 reaching the front wall and a short island in the middle */
const house = () =>
  planWith([
    { id: 'front', a: [0, 0], b: [2, 0] },
    { id: 'front2', a: [2, 0], b: [6, 0] },
    { id: 'right', a: [6, 0], b: [6, 4] },
    { id: 'back', a: [6, 4], b: [0, 4] },
    { id: 'left', a: [0, 4], b: [0, 0] },
    { id: 'partition', a: [2, 0], b: [2, 2.5] },
    { id: 'island', a: [3, 2], b: [5, 2] },
  ])

describe('density levels', () => {
  it('cycle overall → working → all → overall', () => {
    expect(nextDensity('overall')).toBe('working')
    expect(nextDensity('working')).toBe('all')
    expect(nextDensity('all')).toBe('overall')
  })
})

describe('envelope and chained strings', () => {
  it('measures the envelope to the outer faces, not the centrelines', () => {
    const env = planEnvelope(house())!
    expect(env.min.x).toBeCloseTo(-0.1, 6)
    expect(env.min.y).toBeCloseTo(-0.1, 6)
    expect(env.max.x).toBeCloseTo(6.1, 6)
    expect(env.max.y).toBeCloseTo(4.1, 6)
    expect(planEnvelope(emptyPlan())).toBeNull()
  })

  it('ticks a side at the faces of the walls you can see from it: wall, clear, wall', () => {
    const plan = house()
    const strings = chainedStrings(plan, planEnvelope(plan)!)
    const top = strings.find((s) => s.side === 'top')!
    const r2 = (t: number) => Math.round(t * 100) / 100
    // the left wall, the partition meeting the front wall at x = 2, and the right wall; the island in the middle is hidden
    expect(top.ticks.map(r2)).toEqual([-0.1, 0.1, 1.9, 2.1, 5.9, 6.1])
    expect(top.runs.map((r) => r2(r.length))).toEqual([0.2, 1.8, 0.2, 3.8, 0.2])
    expect(top.runs.map((r) => !!r.wall)).toEqual([true, false, true, false, true])
    expect(top.overall.length).toBeCloseTo(6.2, 6)
    const bottom = strings.find((s) => s.side === 'bottom')!
    expect(bottom.ticks.map(r2)).toEqual([-0.1, 0.1, 5.9, 6.1])
    // the island's ends are visible from the left and right only through the back or front walls: no ticks
    const left = strings.find((s) => s.side === 'left')!
    expect(left.ticks.map(r2)).toEqual([-0.1, 0.1, 3.9, 4.1])
    expect(left.normal).toEqual({ x: -1, y: 0 })
  })

  it('merges corners closer than the tolerance into one tick', () => {
    const plan = planWith([
      { id: 'a', a: [0, 0], b: [3, 0] },
      { id: 'b', a: [3.005, 0], b: [6, 0] },
    ])
    const top = chainedStrings(plan, planEnvelope(plan)!).find((s) => s.side === 'top')!
    // two collinear walls end to end: their shared end is one tick, not two
    expect(top.ticks).toHaveLength(3)
    expect(top.runs.every((r) => r.length > 0.02)).toBe(true)
  })

  it('finds the nearest side for a leader', () => {
    const env = { min: { x: 0, y: 0 }, max: { x: 10, y: 6 } }
    expect(nearestSide({ x: 1, y: 3 }, env)).toBe('left')
    expect(nearestSide({ x: 5, y: 5.5 }, env)).toBe('bottom')
  })
})

describe('collision culling', () => {
  const rect = (x: number, y: number, w = 1, h = 0.3) => ({ x, y, w, h })

  it('keeps the higher rank and drops what overlaps it', () => {
    const { kept, dropped } = cullLabels(
      [
        { key: 'derived', rect: rect(0, 0), rank: 0, length: 5 },
        { key: 'rule', rect: rect(0.5, 0.1), rank: 3, length: 1 },
        { key: 'room', rect: rect(3, 3), rank: 1, length: 12 },
      ],
      0.02,
    )
    expect(kept.map((k) => k.key)).toEqual(['rule', 'room'])
    expect(dropped.map((d) => d.key)).toEqual(['derived'])
  })

  it('breaks ties within a rank by length and respects the padding', () => {
    const { kept, dropped } = cullLabels(
      [
        { key: 'short', rect: rect(0, 0), rank: 0, length: 1 },
        { key: 'long', rect: rect(1.01, 0), rank: 0, length: 4 },
      ],
      0.05,
    )
    expect(kept.map((k) => k.key)).toEqual(['long'])
    expect(dropped.map((d) => d.key)).toEqual(['short'])
    expect(cullLabels([{ key: 'a', rect: rect(0, 0), rank: 0, length: 1 }, { key: 'b', rect: rect(1.1, 0), rank: 0, length: 1 }], 0.05).dropped).toHaveLength(0)
  })

  it('boxes a rotated chip', () => {
    const flat = rotatedRect({ x: 0, y: 0 }, 0, 2, 1)
    expect(flat).toEqual({ x: -1, y: -0.5, w: 2, h: 1 })
    const upright = rotatedRect({ x: 0, y: 0 }, 90, 2, 1)
    expect(upright.w).toBeCloseTo(1, 6)
    expect(upright.h).toBeCloseTo(2, 6)
  })
})

describe('drawing scale', () => {
  const PX_PER_MM = 96 / 25.4
  it('snaps to a conventional scale and flags the inexact ones', () => {
    expect(drawingScale(zoomForScale(100, PX_PER_MM), PX_PER_MM)).toEqual({ exact: 100, nearest: 100, approx: false })
    const near = drawingScale(zoomForScale(83, PX_PER_MM), PX_PER_MM)
    expect(near.nearest).toBe(75)
    expect(near.approx).toBe(true)
    expect(drawingScale(zoomForScale(160, PX_PER_MM), PX_PER_MM).nearest).toBe(150)
    expect(drawingScale(0, PX_PER_MM).nearest).toBe(0)
  })
})
