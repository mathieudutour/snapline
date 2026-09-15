/** Procedural textures for finishes: drawn once per finish on a canvas, cached, shared between meshes. */
import * as THREE from 'three'
import type { Finish } from '../model/finishes'

const SIZE = 256
const cache = new Map<string, THREE.MeshStandardMaterial>()

function shade(hex: string, amount: number): string {
  const c = new THREE.Color(hex)
  c.offsetHSL(0, 0, amount)
  return `#${c.getHexString()}`
}

/** deterministic noise so the texture is the same on every machine */
function rand(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

function draw(f: Finish): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')!
  const accent = f.accent ?? shade(f.color, -0.12)
  const r = rand(f.key.length * 7919)
  ctx.fillStyle = f.color
  ctx.fillRect(0, 0, SIZE, SIZE)
  const speckle = (n: number, amt: number) => {
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = shade(f.color, (r() - 0.5) * amt)
      ctx.fillRect(r() * SIZE, r() * SIZE, 2, 2)
    }
  }
  switch (f.pattern) {
    case 'plain':
      break
    case 'planks': {
      // 4 planks across the tile, staggered ends
      const w = SIZE / 4
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = shade(f.color, (r() - 0.5) * 0.1)
        ctx.fillRect(i * w, 0, w, SIZE)
        ctx.strokeStyle = accent
        ctx.lineWidth = 1
        for (let g = 0; g < 6; g++) {
          ctx.globalAlpha = 0.25
          ctx.beginPath()
          const x = i * w + r() * w
          ctx.moveTo(x, 0)
          ctx.bezierCurveTo(x + (r() - 0.5) * 6, SIZE / 3, x + (r() - 0.5) * 6, (2 * SIZE) / 3, x + (r() - 0.5) * 4, SIZE)
          ctx.stroke()
          ctx.globalAlpha = 1
        }
        const end = (i * 0.37 * SIZE + r() * 20) % SIZE
        ctx.fillStyle = accent
        ctx.fillRect(i * w, end, w, 2)
        ctx.fillRect(i * w, 0, 1, SIZE)
      }
      break
    }
    case 'tiles': {
      const n = 2
      const t = SIZE / n
      ctx.fillStyle = accent
      ctx.fillRect(0, 0, SIZE, SIZE)
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          ctx.fillStyle = shade(f.color, (r() - 0.5) * 0.05)
          ctx.fillRect(i * t + 2, j * t + 2, t - 4, t - 4)
        }
      break
    }
    case 'carpet':
      speckle(6000, 0.18)
      break
    case 'concrete':
      speckle(2500, 0.1)
      ctx.globalAlpha = 0.08
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = shade(f.color, -0.3)
        ctx.beginPath()
        ctx.arc(r() * SIZE, r() * SIZE, 20 + r() * 40, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
      break
    case 'brick': {
      const rows = 6
      const h = SIZE / rows
      const w = SIZE / 3
      ctx.fillStyle = accent
      ctx.fillRect(0, 0, SIZE, SIZE)
      for (let j = 0; j < rows; j++) {
        const offset = j % 2 ? w / 2 : 0
        for (let i = -1; i < 4; i++) {
          ctx.fillStyle = shade(f.color, (r() - 0.5) * 0.14)
          ctx.fillRect(i * w + offset + 2, j * h + 2, w - 4, h - 4)
        }
      }
      break
    }
    case 'stone': {
      ctx.fillStyle = accent
      ctx.fillRect(0, 0, SIZE, SIZE)
      const rows = 4
      const h = SIZE / rows
      for (let j = 0; j < rows; j++) {
        let x = j % 2 ? -30 : 0
        while (x < SIZE) {
          const w = 40 + r() * 60
          ctx.fillStyle = shade(f.color, (r() - 0.5) * 0.16)
          ctx.beginPath()
          ctx.roundRect(x + 2, j * h + 2, w - 4, h - 4, 6)
          ctx.fill()
          x += w
        }
      }
      break
    }
    case 'shingles':
    case 'slate': {
      const rows = f.pattern === 'slate' ? 5 : 4
      const h = SIZE / rows
      const w = SIZE / (f.pattern === 'slate' ? 4 : 5)
      ctx.fillStyle = accent
      ctx.fillRect(0, 0, SIZE, SIZE)
      for (let j = 0; j < rows; j++) {
        const offset = j % 2 ? w / 2 : 0
        for (let i = -1; i <= SIZE / w; i++) {
          ctx.fillStyle = shade(f.color, (r() - 0.5) * 0.12)
          ctx.beginPath()
          ctx.roundRect(i * w + offset + 1, j * h + 1, w - 2, h - 2, f.pattern === 'slate' ? 1 : [0, 0, 6, 6])
          ctx.fill()
        }
        ctx.fillStyle = 'rgba(0,0,0,0.18)'
        ctx.fillRect(0, j * h, SIZE, 3)
      }
      break
    }
    case 'metal': {
      ctx.fillStyle = f.color
      ctx.fillRect(0, 0, SIZE, SIZE)
      for (let i = 0; i < 2; i++) {
        const x = i * (SIZE / 2)
        ctx.fillStyle = accent
        ctx.fillRect(x, 0, 6, SIZE)
        ctx.fillStyle = shade(f.color, 0.12)
        ctx.fillRect(x + 6, 0, 3, SIZE)
      }
      break
    }
    case 'cladding': {
      const boards = 4
      const h = SIZE / boards
      for (let j = 0; j < boards; j++) {
        ctx.fillStyle = shade(f.color, (r() - 0.5) * 0.12)
        ctx.fillRect(0, j * h, SIZE, h)
        ctx.fillStyle = accent
        ctx.fillRect(0, j * h + h - 4, SIZE, 4)
      }
      break
    }
  }
  return canvas
}

/** material for a finish; UVs are in metres so the pattern repeats every `tile` metres */
export function finishMaterial(f: Finish, opts: { color?: string; side?: THREE.Side } = {}): THREE.MeshStandardMaterial {
  const key = `${f.key}|${opts.color ?? ''}|${opts.side ?? ''}`
  const hit = cache.get(key)
  if (hit) return hit
  const mat = new THREE.MeshStandardMaterial({ color: opts.color ?? (f.pattern === 'plain' ? f.color : '#ffffff'), roughness: f.roughness, side: opts.side ?? THREE.FrontSide })
  if (f.pattern !== 'plain') {
    const canvas = draw(f)
    if (canvas) {
      const tex = new THREE.CanvasTexture(canvas)
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping
      tex.repeat.set(1 / f.tile, 1 / f.tile)
      tex.colorSpace = THREE.SRGBColorSpace
      tex.anisotropy = 4
      mat.map = tex
    }
  }
  cache.set(key, mat)
  return mat
}
