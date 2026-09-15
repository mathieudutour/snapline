/**
 * Structures are placed like furniture (same footprint, drag, rotation and wall snapping) but are
 * drawn and built differently: stairs, openings in the floor (voids) and balconies.
 */
import type { CatalogItem } from '../furniture/catalog'
import type { Furniture, Vec2 } from './types'
import { furnitureCorners } from './furniture'

export type StructureKind = 'stairs' | 'void' | 'balcony'

export const STRUCTURE_CATEGORY = 'Structures'

export const STRUCTURES: CatalogItem[] = [
  { key: 'sys-stairs', name: 'Stairs', category: STRUCTURE_CATEGORY, width: 1, depth: 3, height: 2.75, elevation: 0, creator: 'Cordeau', license: 'built-in', library: 'built-in' },
  { key: 'sys-void', name: 'Floor opening', category: STRUCTURE_CATEGORY, width: 2, depth: 3, height: 0.02, elevation: 0, creator: 'Cordeau', license: 'built-in', library: 'built-in' },
  { key: 'sys-balcony', name: 'Balcony', category: STRUCTURE_CATEGORY, width: 3, depth: 1.5, height: 1.1, elevation: 0, creator: 'Cordeau', license: 'built-in', library: 'built-in' },
]

export function structureKind(catalogKey: string): StructureKind | null {
  if (catalogKey === 'sys-stairs') return 'stairs'
  if (catalogKey === 'sys-void') return 'void'
  if (catalogKey === 'sys-balcony') return 'balcony'
  return null
}

/** footprint corners in plan coordinates */
export function structureFootprint(piece: Furniture): Vec2[] {
  return furnitureCorners(piece)
}

/** number of steps for a flight of the given rise (about 18 cm each) */
export function stairSteps(height: number): number {
  return Math.max(2, Math.round(height / 0.18))
}

/** what cuts a floor: openings on that floor, plus stairs arriving from the floor below */
export function floorCutouts(pieces: Record<string, Furniture>, below?: Record<string, Furniture>): Vec2[][] {
  const out: Vec2[][] = []
  for (const p of Object.values(pieces)) if (structureKind(p.catalogKey) === 'void') out.push(structureFootprint(p))
  if (below) for (const p of Object.values(below)) if (structureKind(p.catalogKey) === 'stairs') out.push(structureFootprint(p))
  return out
}

/** icons for the catalogue tiles (inline SVG) */
const icon = (body: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="#3b3b3b" stroke-width="2.5">${body}</svg>`)}`
export const STRUCTURE_ICONS: Record<string, string> = {
  'sys-stairs': icon('<rect x="18" y="8" width="28" height="48" fill="#fff"/><path d="M18 16h28M18 24h28M18 32h28M18 40h28M18 48h28"/><path d="M32 52V14M27 19l5-5 5 5" stroke="#2f6fed"/>'),
  'sys-void': icon('<rect x="10" y="12" width="44" height="40" fill="#fff" stroke-dasharray="4 3"/><path d="M10 12l44 40M54 12L10 52" stroke="#9aa0a6"/>'),
  'sys-balcony': icon('<rect x="8" y="24" width="48" height="24" fill="#fff"/><path d="M8 48h48M8 24v24M56 24v24" stroke-width="4"/><path d="M14 24v24M20 24v24M26 24v24M32 24v24M38 24v24M44 24v24M50 24v24" stroke="#9aa0a6"/>'),
}
