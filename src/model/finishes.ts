/**
 * Finishes: the materials of floors, room walls, exterior walls and roofs. Textures are drawn
 * procedurally at runtime (see src/three/textures.ts), so a finish is just a recipe.
 */
export type FinishUse = 'floor' | 'wall' | 'exterior' | 'roof'
export type Pattern = 'plain' | 'planks' | 'tiles' | 'carpet' | 'concrete' | 'brick' | 'stone' | 'shingles' | 'slate' | 'metal' | 'cladding'

export interface Finish {
  key: string
  name: string
  uses: FinishUse[]
  /** base colour */
  color: string
  /** grout, gaps or grain colour */
  accent?: string
  pattern: Pattern
  /** metres covered by one repeat of the pattern */
  tile: number
  roughness: number
  /** tint used for the room on the 2D plan */
  planColor?: string
}

export const FINISHES: Finish[] = [
  // paint
  { key: 'paint-white', name: 'White paint', uses: ['wall'], color: '#f2efe9', pattern: 'plain', tile: 1, roughness: 0.9 },
  { key: 'paint-warm', name: 'Warm white', uses: ['wall'], color: '#f4ead8', pattern: 'plain', tile: 1, roughness: 0.9 },
  { key: 'paint-grey', name: 'Light grey', uses: ['wall'], color: '#d8dadc', pattern: 'plain', tile: 1, roughness: 0.9 },
  { key: 'paint-sage', name: 'Sage', uses: ['wall'], color: '#b7c4ad', pattern: 'plain', tile: 1, roughness: 0.9 },
  { key: 'paint-terracotta', name: 'Terracotta', uses: ['wall'], color: '#c9805c', pattern: 'plain', tile: 1, roughness: 0.9 },
  { key: 'paint-navy', name: 'Navy', uses: ['wall'], color: '#2f3f5c', pattern: 'plain', tile: 1, roughness: 0.85 },
  { key: 'wall-tiles', name: 'White wall tiles', uses: ['wall'], color: '#f3f3f0', accent: '#cfcfc9', pattern: 'tiles', tile: 0.6, roughness: 0.3 },
  { key: 'wall-brick', name: 'Exposed brick', uses: ['wall', 'exterior'], color: '#9c5a45', accent: '#d9cfc2', pattern: 'brick', tile: 0.5, roughness: 0.95 },
  // floors
  { key: 'oak', name: 'Oak planks', uses: ['floor'], color: '#c9a877', accent: '#a8865a', pattern: 'planks', tile: 1.2, roughness: 0.6, planColor: '#f3e6cf' },
  { key: 'walnut', name: 'Walnut planks', uses: ['floor'], color: '#7a5a3f', accent: '#5b4130', pattern: 'planks', tile: 1.2, roughness: 0.6, planColor: '#e7d8c6' },
  { key: 'tiles-white', name: 'White tiles', uses: ['floor'], color: '#ececea', accent: '#c8c8c3', pattern: 'tiles', tile: 0.6, roughness: 0.35, planColor: '#f4f4f2' },
  { key: 'tiles-grey', name: 'Grey tiles', uses: ['floor'], color: '#a9aaa8', accent: '#8b8c8a', pattern: 'tiles', tile: 0.6, roughness: 0.4, planColor: '#e6e6e4' },
  { key: 'tiles-terracotta', name: 'Terracotta tiles', uses: ['floor'], color: '#c27a52', accent: '#a0623f', pattern: 'tiles', tile: 0.4, roughness: 0.7, planColor: '#f2dccd' },
  { key: 'carpet', name: 'Beige carpet', uses: ['floor'], color: '#cbbba0', pattern: 'carpet', tile: 0.5, roughness: 1, planColor: '#efe8db' },
  { key: 'concrete', name: 'Polished concrete', uses: ['floor', 'exterior'], color: '#b9b8b3', pattern: 'concrete', tile: 1, roughness: 0.5, planColor: '#e9e9e6' },
  // exterior
  { key: 'render', name: 'White render', uses: ['exterior'], color: '#ebe7df', pattern: 'concrete', tile: 1, roughness: 0.95 },
  { key: 'render-cream', name: 'Cream render', uses: ['exterior'], color: '#e6d6b8', pattern: 'concrete', tile: 1, roughness: 0.95 },
  { key: 'stone', name: 'Stone', uses: ['exterior'], color: '#b9ae9a', accent: '#8f8676', pattern: 'stone', tile: 0.9, roughness: 0.95 },
  { key: 'cladding', name: 'Timber cladding', uses: ['exterior'], color: '#8b6a48', accent: '#6a4f36', pattern: 'cladding', tile: 0.6, roughness: 0.8 },
  // roofs
  { key: 'clay', name: 'Clay tiles', uses: ['roof'], color: '#a8563a', accent: '#7f3f2b', pattern: 'shingles', tile: 0.5, roughness: 0.9 },
  { key: 'slate', name: 'Slate', uses: ['roof'], color: '#4a4f57', accent: '#2f333a', pattern: 'slate', tile: 0.6, roughness: 0.7 },
  { key: 'metal', name: 'Standing-seam metal', uses: ['roof'], color: '#6f7479', accent: '#4f5459', pattern: 'metal', tile: 0.5, roughness: 0.4 },
  { key: 'roof-plain', name: 'Plain colour', uses: ['roof'], color: '#8d5a3c', pattern: 'plain', tile: 1, roughness: 0.85 },
]

export const FINISH_BY_KEY: Record<string, Finish> = Object.fromEntries(FINISHES.map((f) => [f.key, f]))
export const finishesFor = (use: FinishUse) => FINISHES.filter((f) => f.uses.includes(use))

export const DEFAULT_FINISHES = { floor: 'oak', wall: 'paint-white', exterior: 'render', roof: 'clay' } as const

export function finish(key: string | undefined, fallback: keyof typeof DEFAULT_FINISHES): Finish {
  return (key && FINISH_BY_KEY[key]) || FINISH_BY_KEY[DEFAULT_FINISHES[fallback]]
}
