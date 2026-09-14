import { describe, expect, it } from 'vitest'
import { applyOps, diffProjects, floorsTouched } from './collab'
import { exampleProject } from './example'
import { newProject } from './project'

describe('collab operations', () => {
  it('diffs two projects into entity operations and applies them back', () => {
    const a = exampleProject()
    const floor = a.floors[0]
    const wallId = Object.keys(floor.plan.walls)[0]
    const pointId = Object.keys(floor.plan.points)[0]
    const walls = { ...floor.plan.walls }
    delete walls[wallId]
    const b = {
      ...a,
      name: 'Renamed',
      floors: [{ ...floor, plan: { ...floor.plan, walls, points: { ...floor.plan.points, [pointId]: { ...floor.plan.points[pointId], x: 99 } } } }, ...a.floors.slice(1)],
    }
    const ops = diffProjects(a, b)
    expect(ops).toContainEqual({ k: 'project', v: { name: 'Renamed' } })
    expect(ops).toContainEqual({ k: 'entity', floorId: floor.id, coll: 'walls', id: wallId, v: null })
    expect(ops.find((o) => o.k === 'entity' && o.coll === 'points')).toMatchObject({ id: pointId, v: { x: 99 } })
    expect(ops).toHaveLength(3)
    expect(applyOps(a, ops)).toEqual(b)
    expect(diffProjects(b, applyOps(a, ops))).toEqual([])
    expect(floorsTouched(ops)).toBe('all')
  })

  it('handles floors being added, renamed, reordered and removed', () => {
    const a = newProject('P')
    const extra = { id: 'fl-2', name: 'Attic', plan: newProject('x').floors[0].plan }
    const b = { ...a, floors: [extra, { ...a.floors[0], name: 'Ground' }] }
    const ops = diffProjects(a, b)
    expect(ops.map((o) => o.k)).toEqual(['floor', 'floor'])
    expect(applyOps(a, ops)).toEqual(b)
    const c = { ...b, floors: [b.floors[1]] }
    expect(applyOps(b, diffProjects(b, c))).toEqual(c)
    // the last floor can never be removed and unknown floors are ignored
    expect(applyOps(c, [{ k: 'floor', id: c.floors[0].id, v: null }]).floors).toHaveLength(1)
    expect(applyOps(c, [{ k: 'entity', floorId: 'nope', coll: 'walls', id: 'w', v: {} }])).toEqual(c)
    expect(floorsTouched([{ k: 'entity', floorId: 'f1', coll: 'walls', id: 'w', v: {} }])).toEqual(new Set(['f1']))
  })
})
