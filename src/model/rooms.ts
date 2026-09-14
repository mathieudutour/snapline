/** Room names: labels pinned inside rooms, matched by point-in-polygon so they survive wall edits. */
import type { Plan, Room, RoomLabel } from './types'
import { pointInPolygon } from './geometry'

export function roomLabel(plan: Plan, room: Room): RoomLabel | undefined {
  return Object.values(plan.rooms ?? {}).find((l) => pointInPolygon({ x: l.x, y: l.y }, room.polygon))
}

export function roomName(plan: Plan, room: Room, index: number): string {
  return roomLabel(plan, room)?.name || `Room ${index + 1}`
}

/** total of the rooms' areas (inside faces of the walls), square metres */
export function floorArea(rooms: Room[]): number {
  return rooms.reduce((sum, r) => sum + r.area, 0)
}
