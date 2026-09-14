import { describe, expect, it } from 'vitest'
import { clipPolygonConvex } from './geometry'
import { floorCutouts, stairSteps, structureKind } from './structures'
import type { Furniture } from './types'

const piece = (key: string, x: number, y: number, angle = 0): Furniture => ({ id: key, catalogKey: key, name: key, x, y, angle, width: 2, depth: 3, height: 2.75, elevation: 0 })

describe('structures', () => {
  it('cuts floors for openings on the floor and stairs arriving from below', () => {
    const here = { a: piece('sys-void', 1, 1), b: piece('sys-stairs', 5, 5), c: piece('b0-bed1', 3, 3) }
    const below = { d: piece('sys-stairs', 8, 8), e: piece('sys-void', 9, 9) }
    const cuts = floorCutouts(here, below)
    expect(cuts).toHaveLength(2) // the void here and the stairs below; stairs here cut the floor above, not this one
    expect(structureKind('sys-balcony')).toBe('balcony')
    expect(structureKind('b0-bed1')).toBeNull()
    expect(stairSteps(2.75)).toBe(15)
  })
  it('clips a polygon to a convex rectangle', () => {
    const room = [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 4 },
      { x: 0, y: 4 },
    ]
    const rect = [
      { x: 4, y: 2 },
      { x: 8, y: 2 },
      { x: 8, y: 6 },
      { x: 4, y: 6 },
    ]
    const cut = clipPolygonConvex(room, rect)
    const xs = cut.map((p) => p.x)
    const ys = cut.map((p) => p.y)
    expect(Math.min(...xs)).toBeCloseTo(4)
    expect(Math.max(...xs)).toBeCloseTo(6)
    expect(Math.min(...ys)).toBeCloseTo(2)
    expect(Math.max(...ys)).toBeCloseTo(4)
    expect(clipPolygonConvex(room, rect.map((p) => ({ x: p.x + 10, y: p.y })))).toEqual([])
  })
})

import { buildScene } from '../three/buildScene'
import { exampleProject } from './example'

describe('slab cutouts', () => {
  it('adds a hole to the room slab that contains a floor opening', async () => {
    const plan = exampleProject().floors[0].plan
    const plain = buildScene(plan)
    const room = plain.floors[0]
    const before = room.geometry.getAttribute('position').count
    // a 1×1 opening at the centroid of the first room
    const rooms = plain.floors.map((f) => f.id)
    void rooms
    const { findRooms } = await import('./geometry')
    const c = findRooms(plan)[0].centroid
    const hole = [
      { x: c.x - 0.5, y: c.y - 0.5 },
      { x: c.x + 0.5, y: c.y - 0.5 },
      { x: c.x + 0.5, y: c.y + 0.5 },
      { x: c.x - 0.5, y: c.y + 0.5 },
    ]
    const cut = buildScene(plan, { floorHoles: [hole] })
    const after = cut.floors[0].geometry.getAttribute('position').count
    expect(after).toBeGreaterThan(before)
    // a hole far away from every room changes nothing
    const far = buildScene(plan, { floorHoles: [hole.map((p) => ({ x: p.x + 100, y: p.y }))] })
    expect(far.floors[0].geometry.getAttribute('position').count).toBe(before)
    plain.dispose()
    cut.dispose()
    far.dispose()
  })
})
