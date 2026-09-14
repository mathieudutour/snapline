export interface Vec2 {
  x: number
  y: number
}

export interface PlanPoint {
  id: string
  x: number
  y: number
}

export interface Wall {
  id: string
  a: string
  b: string
  /** metres */
  thickness: number
  /** metres */
  height: number
}

export type OpeningKind = 'door' | 'window'

export interface Opening {
  id: string
  kind: OpeningKind
  wallId: string
  /** distance (m) from wall point A to the start of the opening, measured along the wall */
  offset: number
  width: number
  height: number
  /** height of the bottom of the opening above the floor (0 for doors) */
  sill: number
  /** door only: hinge on the B side instead of the A side */
  hingeB: boolean
  /** door only: swing towards the right-hand side of the wall (A→B) instead of the left */
  swingRight: boolean
}

export type FurnitureSide = 'back' | 'front' | 'left' | 'right'

export interface Furniture {
  id: string
  /** key into the furniture catalogue */
  catalogKey: string
  name: string
  /** centre of the footprint in plan coordinates (m) */
  x: number
  y: number
  /** rotation in radians; 0 means the front of the piece faces +y (down on the plan) */
  angle: number
  width: number
  depth: number
  height: number
  /** height of the underside above the floor (wall cabinets, pictures) */
  elevation: number
}

export type Constraint =
  /** face-to-face length on `side` (left = +normal of A→B); no side = centreline length (legacy) */
  | { id: string; type: 'length'; wallId: string; value: number; side?: 'left' | 'right' }
  | { id: string; type: 'horizontal'; wallId: string }
  | { id: string; type: 'vertical'; wallId: string }
  | { id: string; type: 'perpendicular'; wallA: string; wallB: string }
  | { id: string; type: 'parallel'; wallA: string; wallB: string }
  | { id: string; type: 'equalLength'; wallA: string; wallB: string }
  | { id: string; type: 'angle'; wallA: string; wallB: string; degrees: number }
  | { id: string; type: 'fixed'; pointId: string; x: number; y: number }
  | { id: string; type: 'distance'; pointA: string; pointB: string; value: number }
  /** distance from the wall's face corner (on `side`) to the opening; no side = from the centreline endpoint (legacy) */
  | { id: string; type: 'openingOffsetA'; openingId: string; value: number; side?: 'left' | 'right' }
  | { id: string; type: 'openingOffsetB'; openingId: string; value: number; side?: 'left' | 'right' }
  | { id: string; type: 'openingCentered'; openingId: string; side?: 'left' | 'right' }
  /** a side of a piece of furniture is parallel to a wall, `value` metres away from its face */
  | { id: string; type: 'furnitureWallGap'; furnitureId: string; wallId: string; side: FurnitureSide; value: number }
  | { id: string; type: 'furnitureFixed'; furnitureId: string; x: number; y: number; angle: number }

export type ConstraintType = Constraint['type']

/** A constraint without its id (distributive over the union so each variant keeps its fields). */
export type ConstraintInput = Constraint extends infer C ? (C extends Constraint ? Omit<C, 'id'> : never) : never

export interface PlanSettings {
  wallHeight: number
  wallThickness: number
  units: 'm' | 'cm'
}

/** a name pinned inside a room; the room it names is the one containing the pin */
export interface RoomLabel {
  id: string
  name: string
  x: number
  y: number
}

export interface Plan {
  points: Record<string, PlanPoint>
  walls: Record<string, Wall>
  openings: Record<string, Opening>
  furniture: Record<string, Furniture>
  constraints: Record<string, Constraint>
  rooms: Record<string, RoomLabel>
  settings: PlanSettings
}

export interface Room {
  id: string
  pointIds: string[]
  polygon: Vec2[]
  area: number
  centroid: Vec2
}

export function emptyPlan(): Plan {
  return {
    points: {},
    walls: {},
    openings: {},
    furniture: {},
    constraints: {},
    rooms: {},
    settings: { wallHeight: 2.5, wallThickness: 0.2, units: 'm' },
  }
}

let counter = 0
export function newId(prefix = ''): string {
  counter += 1
  return prefix + Math.random().toString(36).slice(2, 8) + counter.toString(36)
}
