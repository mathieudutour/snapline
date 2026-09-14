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

export type Constraint =
  | { id: string; type: 'length'; wallId: string; value: number }
  | { id: string; type: 'horizontal'; wallId: string }
  | { id: string; type: 'vertical'; wallId: string }
  | { id: string; type: 'perpendicular'; wallA: string; wallB: string }
  | { id: string; type: 'parallel'; wallA: string; wallB: string }
  | { id: string; type: 'equalLength'; wallA: string; wallB: string }
  | { id: string; type: 'angle'; wallA: string; wallB: string; degrees: number }
  | { id: string; type: 'fixed'; pointId: string; x: number; y: number }
  | { id: string; type: 'distance'; pointA: string; pointB: string; value: number }
  | { id: string; type: 'openingOffsetA'; openingId: string; value: number }
  | { id: string; type: 'openingOffsetB'; openingId: string; value: number }
  | { id: string; type: 'openingCentered'; openingId: string }

export type ConstraintType = Constraint['type']

/** A constraint without its id (distributive over the union so each variant keeps its fields). */
export type ConstraintInput = Constraint extends infer C ? (C extends Constraint ? Omit<C, 'id'> : never) : never

export interface PlanSettings {
  wallHeight: number
  wallThickness: number
  units: 'm' | 'cm'
}

export interface Plan {
  points: Record<string, PlanPoint>
  walls: Record<string, Wall>
  openings: Record<string, Opening>
  constraints: Record<string, Constraint>
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
    constraints: {},
    settings: { wallHeight: 2.5, wallThickness: 0.2, units: 'm' },
  }
}

let counter = 0
export function newId(prefix = ''): string {
  counter += 1
  return prefix + Math.random().toString(36).slice(2, 8) + counter.toString(36)
}
