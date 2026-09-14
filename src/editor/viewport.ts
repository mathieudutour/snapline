import type { Vec2 } from '../model/types'

export interface Viewport {
  /** world coordinate at the centre of the screen */
  cx: number
  cy: number
  /** pixels per metre */
  scale: number
}

export function worldToScreen(vp: Viewport, p: Vec2, width: number, height: number): Vec2 {
  return { x: (p.x - vp.cx) * vp.scale + width / 2, y: (p.y - vp.cy) * vp.scale + height / 2 }
}

export function screenToWorld(vp: Viewport, s: Vec2, width: number, height: number): Vec2 {
  return { x: (s.x - width / 2) / vp.scale + vp.cx, y: (s.y - height / 2) / vp.scale + vp.cy }
}
