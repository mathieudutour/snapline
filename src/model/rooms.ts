/** Room names: labels pinned inside rooms, matched by point-in-polygon so they survive wall edits. */
import type { Plan, Room, RoomLabel, Vec2 } from './types'
import type { Underlay } from './project'
import { dist, pointInPolygon } from './geometry'

export function roomLabel(plan: Plan, room: Room): RoomLabel | undefined {
  return Object.values(plan.rooms ?? {}).find((l) => pointInPolygon({ x: l.x, y: l.y }, room.polygon))
}

export function roomName(plan: Plan, room: Room, index: number): string {
  return roomLabel(plan, room)?.name || `Room ${index + 1}`
}

/** where a pixel of the underlay image lands on the plan */
export function underlayToPlan(u: Underlay, p: { x: number; y: number }): Vec2 {
  const a = (u.rotation * Math.PI) / 180
  const x = p.x * u.scale
  const y = p.y * u.scale
  return { x: u.x + x * Math.cos(a) - y * Math.sin(a), y: u.y + x * Math.sin(a) + y * Math.cos(a) }
}

/**
 * Names for a room, read off the underlay: the text inside the room first, then the nearest
 * text outside it. A traced plan usually has its room names printed on it already.
 */
export function roomNameSuggestions(underlay: Underlay | undefined, room: Room, limit = 6): string[] {
  if (!underlay?.texts?.length) return []
  const scored = underlay.texts.map((t) => {
    const p = underlayToPlan(underlay, t)
    const inside = pointInPolygon(p, room.polygon)
    return { text: t.text, inside, d: dist(p, room.centroid) }
  })
  scored.sort((a, b) => Number(b.inside) - Number(a.inside) || a.d - b.d)
  const out: string[] = []
  for (const s of scored) {
    if (!s.inside && s.d > 6) break // far-away text is somebody else's room
    if (!out.includes(s.text)) out.push(s.text)
    if (out.length >= limit) break
  }
  return out
}

/** total of the rooms' areas (inside faces of the walls), square metres */
export function floorArea(rooms: Room[]): number {
  return rooms.reduce((sum, r) => sum + r.area, 0)
}
