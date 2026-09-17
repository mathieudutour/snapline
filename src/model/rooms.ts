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

/** has the user named this room, or is it still wearing its placeholder */
export function roomIsNamed(plan: Plan, room: Room): boolean {
  return !!roomLabel(plan, room)?.name
}

/**
 * Rooms in the order the eye already reads the plan: top-left to bottom-right, by centroid.
 * Rooms whose centroids sit in the same row band read left to right; a band is as tall as the
 * gap between rows usually is. The index is the geometric one, which is what a placeholder
 * name carries, so "Room 4" keeps its name wherever it lands in the list.
 */
export function readingOrder(rooms: Room[], band = 1.5): { room: Room; index: number }[] {
  const byY = rooms.map((room, index) => ({ room, index })).sort((a, b) => a.room.centroid.y - b.room.centroid.y)
  const rows: { room: Room; index: number }[][] = []
  let rowStart = -Infinity
  for (const r of byY) {
    if (r.room.centroid.y - rowStart > band) {
      rows.push([])
      rowStart = r.room.centroid.y
    }
    rows[rows.length - 1].push(r)
  }
  return rows.flatMap((row) => row.sort((a, b) => a.room.centroid.x - b.room.centroid.x))
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
