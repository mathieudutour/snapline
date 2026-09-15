/**
 * Exports: the plan as PNG or PDF at a real scale, the building as a glTF model, the project as JSON.
 * The plan drawing is taken from the live editor SVG (same dimensions, symbols and labels) with the
 * on-screen helpers removed.
 */
import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import type { Plan } from '../model/types'
import type { Project } from '../model/project'
import { planBounds, findRooms } from '../model/geometry'
import { floorArea } from '../model/rooms'
import { buildRoofGeometry, buildScene } from '../three/buildScene'
import { floorElevation, projectTopElevation } from '../model/project'
import { floorCutouts, stairSteps, structureKind } from '../model/structures'
import { formatArea, type Units } from '../model/units'
import { finish } from '../model/finishes'

export const PAPERS = { A4: [210, 297], A3: [297, 420], Letter: [215.9, 279.4] } as const
export type Paper = keyof typeof PAPERS
export const MARGIN_M = 1.4

export interface PlanCapture {
  svg: string
  /** plan metres covered by the drawing */
  widthM: number
  heightM: number
}

/** clone the editor's SVG, drop the helpers and frame the plan */
export async function capturePlan(svgEl: SVGSVGElement, plan: Plan, opts: { underlay?: boolean } = {}): Promise<PlanCapture | null> {
  const bounds = planBounds(plan)
  if (!bounds) return null
  const min = { x: bounds.min.x - MARGIN_M, y: bounds.min.y - MARGIN_M }
  const max = { x: bounds.max.x + MARGIN_M, y: bounds.max.y + MARGIN_M }
  const clone = svgEl.cloneNode(true) as SVGSVGElement
  clone.querySelectorAll('[data-export="skip"]').forEach((el) => el.remove())
  if (!opts.underlay) clone.querySelectorAll('[data-kind="underlay"]').forEach((el) => el.remove())
  // the world group carries the pan/zoom transform: replace it with the plan frame
  const world = clone.querySelector(':scope > g') as SVGGElement | null
  if (world) world.removeAttribute('transform')
  const widthM = max.x - min.x
  const heightM = max.y - min.y
  clone.setAttribute('viewBox', `${min.x} ${min.y} ${widthM} ${heightM}`)
  clone.removeAttribute('width')
  clone.removeAttribute('height')
  clone.removeAttribute('style')
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  bg.setAttribute('x', String(min.x))
  bg.setAttribute('y', String(min.y))
  bg.setAttribute('width', String(widthM))
  bg.setAttribute('height', String(heightM))
  bg.setAttribute('fill', 'white')
  clone.insertBefore(bg, clone.firstChild)
  // images must be embedded: an SVG drawn into a canvas cannot fetch them
  await Promise.all(
    [...clone.querySelectorAll('image')].map(async (img) => {
      const href = img.getAttribute('href') ?? img.getAttribute('xlink:href')
      if (!href || href.startsWith('data:')) return
      try {
        const blob = await (await fetch(href)).blob()
        const dataUrl = await new Promise<string>((res, rej) => {
          const r = new FileReader()
          r.onload = () => res(r.result as string)
          r.onerror = () => rej(r.error)
          r.readAsDataURL(blob)
        })
        img.setAttribute('href', dataUrl)
        img.removeAttribute('xlink:href')
      } catch {
        img.remove()
      }
    }),
  )
  return { svg: new XMLSerializer().serializeToString(clone), widthM, heightM }
}

/** pixels per metre for a paper scale (1:scale) at a print resolution */
export const pxPerMetre = (scale: number, dpi: number) => (1000 / scale) * (dpi / 25.4)

export async function rasterize(capture: PlanCapture, pxPerM: number, format: 'png' | 'jpeg' = 'png'): Promise<{ blob: Blob; width: number; height: number }> {
  const width = Math.round(capture.widthM * pxPerM)
  const height = Math.round(capture.heightM * pxPerM)
  const url = URL.createObjectURL(new Blob([capture.svg], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = () => rej(new Error('could not render the plan'))
      i.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(img, 0, 0, width, height)
    const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('render failed'))), format === 'jpeg' ? 'image/jpeg' : 'image/png', 0.92))
    return { blob, width, height }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export const safeName = (s: string) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'plan'

export interface PdfPage {
  capture: PlanCapture
  floorName: string
  plan: Plan
}

/** one page per floor at a fixed scale (or fitted), with a title block */
export async function makePdf(pages: PdfPage[], opts: { paper: Paper; scale: number | 'fit'; projectName: string; units: Units }): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const [pw, ph] = PAPERS[opts.paper]
  let doc: InstanceType<typeof jsPDF> | null = null
  for (const page of pages) {
    const landscape = page.capture.widthM >= page.capture.heightM
    const [w, h] = landscape ? [ph, pw] : [pw, ph]
    const margin = 12
    const titleH = 22
    const availW = w - 2 * margin
    const availH = h - 2 * margin - titleH
    let scale = opts.scale === 'fit' ? Math.max((page.capture.widthM * 1000) / availW, (page.capture.heightM * 1000) / availH) : opts.scale
    // a fixed scale that does not fit the page falls back to the next round scale that does
    const fits = (s: number) => (page.capture.widthM * 1000) / s <= availW && (page.capture.heightM * 1000) / s <= availH
    if (opts.scale !== 'fit' && !fits(scale)) scale = [50, 100, 200, 500].find((s) => s > scale && fits(s)) ?? Math.max((page.capture.widthM * 1000) / availW, (page.capture.heightM * 1000) / availH)
    const drawW = (page.capture.widthM * 1000) / scale
    const drawH = (page.capture.heightM * 1000) / scale
    const png = await rasterize(page.capture, pxPerMetre(scale, 200), 'jpeg') // JPEG keeps the file small; the drawing is flat colour
    const dataUrl = await new Promise<string>((res) => {
      const r = new FileReader()
      r.onload = () => res(r.result as string)
      r.readAsDataURL(png.blob)
    })
    if (!doc) doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: [pw, ph] })
    else doc.addPage([pw, ph], landscape ? 'landscape' : 'portrait')
    const x = margin + (availW - drawW) / 2
    const y = margin + (availH - drawH) / 2
    doc.addImage(dataUrl, 'JPEG', x, y, drawW, drawH)
    doc.setDrawColor(120)
    doc.rect(x, y, drawW, drawH)
    // title block
    const ty = h - margin - titleH + 4
    doc.setFontSize(13)
    doc.setTextColor(20)
    doc.text(opts.projectName, margin, ty + 4)
    doc.setFontSize(9)
    doc.setTextColor(90)
    const area = floorArea(findRooms(page.plan))
    const roundedScale = Math.round(scale)
    doc.text(`${page.floorName} · scale 1:${roundedScale} on ${opts.paper} · ${area > 0 ? `floor area ${formatArea(area, opts.units)} · ` : ''}${new Date().toLocaleDateString()} · Cordeau`, margin, ty + 10)
    // scale bar: 1 m
    const bar = 1000 / scale
    const bx = w - margin - bar
    doc.setDrawColor(20)
    doc.setLineWidth(0.5)
    doc.line(bx, ty + 8, bx + bar, ty + 8)
    doc.line(bx, ty + 6, bx, ty + 10)
    doc.line(bx + bar, ty + 6, bx + bar, ty + 10)
    doc.setFontSize(8)
    doc.text('1 m', bx + bar / 2, ty + 5, { align: 'center' })
  }
  return doc!.output('blob')
}

/** the whole building as a glTF binary: walls with openings, floors, ceilings, roof, furniture as labelled boxes, structures */
export async function makeGlb(project: Project): Promise<Blob> {
  const scene = new THREE.Scene()
  scene.name = project.name
  const wallMat = new THREE.MeshStandardMaterial({ color: '#f2efe9', roughness: 0.9 })
  const floorMat = new THREE.MeshStandardMaterial({ color: '#d9c2a3', roughness: 0.8 })
  const ceilingMat = new THREE.MeshStandardMaterial({ color: '#fbfbfb', roughness: 1 })
  const furnitureMat = new THREE.MeshStandardMaterial({ color: '#9aa0a6', roughness: 0.7 })
  const stairMat = new THREE.MeshStandardMaterial({ color: '#c8b294', roughness: 0.8 })
  project.floors.forEach((f, index) => {
    const g = new THREE.Group()
    g.name = f.name
    g.position.y = floorElevation(project, f.id)
    const data = buildScene(f.plan, {
      bandBelow: index > 0 ? project.slabThickness : 0,
      floorHoles: floorCutouts(f.plan.furniture, project.floors[index - 1]?.plan.furniture),
      ceilingHoles: floorCutouts(project.floors[index + 1]?.plan.furniture ?? {}, f.plan.furniture),
    })
    const colorMat = (key: string | undefined, use: 'wall' | 'floor' | 'exterior') => new THREE.MeshStandardMaterial({ color: finish(key, use).color, roughness: finish(key, use).roughness })
    for (const w of data.walls) {
      const side = (s: string | null | undefined) => (w.own ? colorMat(w.own, 'wall') : s === null ? colorMat(project.finishes?.exterior, 'exterior') : colorMat(s, 'wall'))
      g.add(Object.assign(new THREE.Mesh(w.geometry, [side(w.finishA), side(w.finishB), wallMat]), { name: `wall ${w.id}` }))
    }
    for (const fl of data.floors) {
      g.add(Object.assign(new THREE.Mesh(fl.geometry, fl.floorFinish ? colorMat(fl.floorFinish, 'floor') : floorMat), { name: `floor ${fl.id}` }))
      const c = new THREE.Mesh(fl.ceiling, ceilingMat)
      c.name = `ceiling ${fl.id}`
      c.position.y = fl.height
      g.add(c)
    }
    for (const piece of Object.values(f.plan.furniture)) {
      const kind = structureKind(piece.catalogKey)
      const holder = new THREE.Group()
      holder.name = piece.name
      holder.position.set(piece.x, piece.elevation, piece.y)
      holder.rotation.y = -piece.angle
      if (kind === 'void') continue
      if (kind === 'stairs') {
        const n = stairSteps(piece.height)
        for (let i = 0; i < n; i++) {
          const m = new THREE.Mesh(new THREE.BoxGeometry(piece.width, ((i + 1) * piece.height) / n, piece.depth / n), stairMat)
          m.position.set(0, ((i + 1) * piece.height) / n / 2, piece.depth / 2 - (piece.depth / n) * (i + 0.5))
          holder.add(m)
        }
      } else if (kind === 'balcony') {
        const slab = new THREE.Mesh(new THREE.BoxGeometry(piece.width, project.slabThickness, piece.depth), floorMat)
        slab.position.y = -project.slabThickness / 2
        holder.add(slab)
      } else {
        const m = new THREE.Mesh(new THREE.BoxGeometry(piece.width, piece.height, piece.depth), furnitureMat)
        m.position.y = piece.height / 2
        holder.add(m)
      }
      g.add(holder)
    }
    scene.add(g)
  })
  const top = project.floors[project.floors.length - 1]
  const roof = buildRoofGeometry(top.plan, project.roof, projectTopElevation(project))
  const roofFinish = finish(project.finishes?.roof, 'roof')
  if (roof) scene.add(Object.assign(new THREE.Mesh(roof, new THREE.MeshStandardMaterial({ color: roofFinish.pattern === 'plain' ? project.roof.color : roofFinish.color, roughness: roofFinish.roughness, side: THREE.DoubleSide })), { name: 'roof' }))
  const exporter = new GLTFExporter()
  const result = await exporter.parseAsync(scene, { binary: true })
  return new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' })
}
