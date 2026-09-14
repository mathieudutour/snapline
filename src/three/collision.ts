import type { Blocker } from './buildScene'

/** Push a point (x,z) out of thick wall segments; doors are not blockers so they stay walkable. */
export function resolveCollisions(pos: { x: number; z: number }, blockers: Blocker[], radius: number) {
  for (let iter = 0; iter < 3; iter++) {
    let moved = false
    for (const b of blockers) {
      const abx = b.b.x - b.a.x
      const aby = b.b.y - b.a.y
      const l2 = abx * abx + aby * aby
      if (l2 < 1e-9) continue
      let t = ((pos.x - b.a.x) * abx + (pos.z - b.a.y) * aby) / l2
      t = Math.max(0, Math.min(1, t))
      const cx = b.a.x + abx * t
      const cz = b.a.y + aby * t
      let dx = pos.x - cx
      let dz = pos.z - cz
      const d = Math.hypot(dx, dz)
      const minDist = b.halfThickness + radius
      if (d < minDist) {
        if (d < 1e-6) {
          dx = -aby
          dz = abx
          const n = Math.hypot(dx, dz)
          dx /= n
          dz /= n
        } else {
          dx /= d
          dz /= d
        }
        pos.x = cx + dx * minDist
        pos.z = cz + dz * minDist
        moved = true
      }
    }
    if (!moved) break
  }
}
