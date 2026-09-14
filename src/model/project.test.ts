import { describe, expect, it } from 'vitest'
import { floorElevation, newProject, normalizeProject, outlinePolygon, roofFootprint } from './project'
import { examplePlan } from './example'
import { normalizePlan } from './store'
import { emptyPlan } from './types'
import { polygonArea } from './geometry'

describe('project', () => {
  it('migrates a v1 plan into a single-floor project', () => {
    const p = normalizeProject(examplePlan(), normalizePlan)
    expect(p.floors).toHaveLength(1)
    expect(Object.keys(p.floors[0].plan.walls)).toHaveLength(13)
    expect(p.roof.type).toBe('none')
  })

  it('stacks floors by wall height plus slab', () => {
    const p = newProject('x')
    const second = { id: 'f2', name: '1st', plan: emptyPlan() }
    p.floors.push(second)
    expect(floorElevation(p, p.floors[0].id)).toBe(0)
    expect(floorElevation(p, 'f2')).toBeCloseTo(2.5 + 0.25)
  })

  it('finds the outer outline of the example plan', () => {
    const outline = outlinePolygon(examplePlan())
    expect(outline).not.toBeNull()
    expect(Math.abs(polygonArea(outline!))).toBeCloseTo(9 * 6.5, 6)
    expect(outline!.length).toBe(8)
  })

  it('computes a wall-aligned roof footprint with wall thickness', () => {
    const r = roofFootprint(examplePlan())!
    expect(r.long).toBeCloseTo(9 + 0.25, 6)
    expect(r.short).toBeCloseTo(6.5 + 0.25, 6)
    expect(r.cx).toBeCloseTo(4.5)
    expect(r.cy).toBeCloseTo(3.25)
    expect(Math.abs(r.ux)).toBeCloseTo(1)
  })
})
