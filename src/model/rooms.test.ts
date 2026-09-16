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

describe('room names read off the underlay', () => {
  const room = { id: 'r', pointIds: [], polygon: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }], area: 12, centroid: { x: 2, y: 1.5 } }
  const underlay = { key: 'k', name: 'plan.pdf', width: 1000, height: 800, scale: 0.01, x: 0, y: 0, rotation: 0, opacity: 0.6, locked: false }
  it('offers the text inside the room first, then the nearest text outside it', async () => {
    const { roomNameSuggestions } = await import('./rooms')
    const texts = [
      { text: 'Kitchen', x: 200, y: 150 },
      { text: 'Hall', x: 450, y: 150 },
      { text: 'Garage', x: 900, y: 700 },
    ]
    expect(roomNameSuggestions({ ...underlay, texts }, room)).toEqual(['Kitchen', 'Hall'])
    expect(roomNameSuggestions(underlay, room)).toEqual([])
    expect(roomNameSuggestions(undefined, room)).toEqual([])
  })
  it('follows the underlay when it is moved and turned', async () => {
    const { roomNameSuggestions, underlayToPlan } = await import('./rooms')
    const turned = { ...underlay, x: 2, y: 1.5, rotation: 90, texts: [{ text: 'Bath', x: 100, y: -100 }] }
    const p = underlayToPlan(turned, { x: 100, y: -100 })
    expect(p.x).toBeCloseTo(3, 6)
    expect(p.y).toBeCloseTo(2.5, 6)
    expect(roomNameSuggestions(turned, room)).toEqual(['Bath'])
  })
})
