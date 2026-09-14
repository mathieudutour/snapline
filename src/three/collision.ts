import type { Blocker, FurnitureBlocker } from './buildScene'

/** Push a point (x,z) out of thick wall segments; doors are not blockers so they stay walkable. */
export function resolveCollisions(pos: { x: number; z: number }, blockers: Blocker[], radius: number, furniture: FurnitureBlocker[] = []) {
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
    for (const f of furniture) {
      // into the piece's local frame (plan y == world z)
      const c = Math.cos(f.angle)
      const s = Math.sin(f.angle)
      const dx = pos.x - f.x
      const dz = pos.z - f.z
      const lx = dx * c + dz * s
      const lz = -dx * s + dz * c
      const px = f.hw + radius - Math.abs(lx)
      const pz = f.hd + radius - Math.abs(lz)
      if (px <= 0 || pz <= 0) continue
      let nx = lx
      let nz = lz
      if (px < pz) nx = Math.sign(lx || 1) * (f.hw + radius)
      else nz = Math.sign(lz || 1) * (f.hd + radius)
      pos.x = f.x + nx * c - nz * s
      pos.z = f.z + nx * s + nz * c
      moved = true
    }
    if (!moved) break
  }
}
