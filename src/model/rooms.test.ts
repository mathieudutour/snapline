import { describe, expect, it } from 'vitest'
import { exampleProject } from './example'
import { findRooms } from './geometry'
import { floorArea, roomLabel, roomName } from './rooms'

describe('room names', () => {
  it('names rooms by the label pinned inside them and falls back to a number', () => {
    const plan = { ...exampleProject().floors[0].plan, rooms: {} as Record<string, { id: string; name: string; x: number; y: number }> }
    const rooms = findRooms(plan)
    expect(rooms.length).toBeGreaterThan(1)
    expect(roomName(plan, rooms[0], 0)).toBe('Room 1')
    plan.rooms.l1 = { id: 'l1', name: 'Kitchen', x: rooms[1].centroid.x, y: rooms[1].centroid.y }
    expect(roomName(plan, rooms[1], 1)).toBe('Kitchen')
    expect(roomLabel(plan, rooms[0])).toBeUndefined()
    expect(floorArea(rooms)).toBeCloseTo(rooms.reduce((a, r) => a + r.area, 0), 9)
  })
})
