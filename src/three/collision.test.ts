import { describe, expect, it } from 'vitest'
import { resolveCollisions } from './collision'
import { buildScene } from './buildScene'
import { examplePlan } from '../model/example'

describe('walkthrough collisions', () => {
  it('pushes the player out of a wall', () => {
    const pos = { x: 2, z: 0.05 }
    resolveCollisions(pos, [{ a: { x: 0, y: 0 }, b: { x: 4, y: 0 }, halfThickness: 0.1 }], 0.3)
    expect(pos.x).toBeCloseTo(2)
    expect(pos.z).toBeCloseTo(0.4)
  })
  it('lets the player walk through doors but not windows', () => {
    const data = buildScene(examplePlan())
    // door o1 sits on wall w6 (y = 6.5) between x = 4.8 and 5.7 → no blocker covers x = 5.25 there
    const inDoor = { x: 5.25, z: 6.5 }
    resolveCollisions(inDoor, data.blockers, 0.2)
    expect(inDoor.z).toBeCloseTo(6.5)
    // window o5 on wall w1 (y = 0) is solid
    const atWindow = { x: 1.9, z: 0.1 }
    resolveCollisions(atWindow, data.blockers, 0.3)
    expect(Math.abs(atWindow.z)).toBeGreaterThan(0.4)
    data.dispose()
  })
})
