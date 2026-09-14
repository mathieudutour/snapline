/**
 * Convert a curated set of Sweet Home 3D furniture models into normalised, optimised GLB files
 * plus a catalogue JSON and credits file.
 *
 * Usage: node scripts/import-furniture.mjs <dir with unpacked .sh3f libraries>
 * Each library must be unpacked into <dir>/<LibraryName>/ (PluginFurnitureCatalog.properties at its root).
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import obj2gltf from 'obj2gltf'
import sharp from 'sharp'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, prune, weld, quantize, simplify, textureCompress, getBounds } from '@gltf-transform/functions'
import { MeshoptSimplifier } from 'meshoptimizer'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const libsDir = process.argv[2]
if (!libsDir) {
  console.error('usage: node scripts/import-furniture.mjs <libraries dir>')
  process.exit(1)
}
const selection = JSON.parse(fs.readFileSync(path.join(root, 'scripts/furniture-selection.json'), 'utf8'))
const outModels = path.join(root, 'public/furniture/models')
const outIcons = path.join(root, 'public/furniture/icons')
fs.mkdirSync(outModels, { recursive: true })
fs.mkdirSync(outIcons, { recursive: true })

function parseCatalog(lib) {
  const txt = fs.readFileSync(path.join(libsDir, lib, 'PluginFurnitureCatalog.properties'), 'utf8')
  const byIndex = new Map()
  for (const line of txt.split(/\r?\n/)) {
    const m = /^([a-zA-Z]+)#(\d+)=(.*)$/.exec(line)
    if (!m) continue
    const idx = Number(m[2])
    if (!byIndex.has(idx)) byIndex.set(idx, {})
    byIndex.get(idx)[m[1]] = m[3].replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
  }
  const byId = new Map()
  for (const e of byIndex.values()) if (e.id) byId.set(e.id.split('#').pop(), e)
  return byId
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const catalogs = new Map()
const catalog = []
const credits = []
let totalBytes = 0

for (const item of selection.items) {
  if (!catalogs.has(item.lib)) catalogs.set(item.lib, parseCatalog(item.lib))
  const entry = catalogs.get(item.lib).get(item.id)
  const libInfo = selection.libraries[item.lib]
  if (!entry) {
    console.warn(`!! ${item.lib}#${item.id} not found`)
    continue
  }
  const key = `${libInfo.short}-${item.id.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  const modelPath = path.join(libsDir, item.lib, entry.model)
  let objPath = modelPath
  let tmp = null
  if (modelPath.endsWith('.zip')) {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sh3d-'))
    execFileSync('unzip', ['-q', '-o', modelPath, '-d', tmp])
    const found = fs.readdirSync(tmp, { recursive: true }).find((f) => f.toLowerCase().endsWith('.obj'))
    objPath = path.join(tmp, found)
  }
  const width = parseFloat(entry.width) / 100
  const depth = parseFloat(entry.depth) / 100
  const height = parseFloat(entry.height) / 100
  const elevation = entry.elevation ? parseFloat(entry.elevation) / 100 : 0

  const t0 = Date.now()
  const origWarn = console.warn
  console.warn = () => {}
  const raw = await obj2gltf(objPath, { binary: true })
  console.warn = origWarn
  const doc = await io.readBinary(new Uint8Array(raw))
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]

  // Sweet Home 3D optional model rotation (row-major 3x3)
  const rot = entry.modelRotation ? entry.modelRotation.trim().split(/\s+/).map(Number) : [1, 0, 0, 0, 1, 0, 0, 0, 1]
  const rotNode = doc.createNode('sh3d-rotation')
  // column-major 4x4 for glTF
  rotNode.setMatrix([rot[0], rot[3], rot[6], 0, rot[1], rot[4], rot[7], 0, rot[2], rot[5], rot[8], 0, 0, 0, 0, 1])
  for (const child of scene.listChildren()) {
    scene.removeChild(child)
    rotNode.addChild(child)
  }
  scene.addChild(rotNode)
  const b = getBounds(scene)
  const size = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]].map((s) => (s > 1e-6 ? s : 1))
  const sx = width / size[0]
  const sy = height / size[1]
  const sz = depth / size[2]
  const cx = (b.min[0] + b.max[0]) / 2
  const cz = (b.min[2] + b.max[2]) / 2
  const fit = doc.createNode('fit')
  fit.setMatrix([sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, -cx * sx, -b.min[1] * sy, -cz * sz, 1])
  scene.removeChild(rotNode)
  fit.addChild(rotNode)
  scene.addChild(fit)

  await doc.transform(dedup(), prune(), weld())
  // heavy meshes get simplified so the whole catalogue stays small
  let triangles = 0
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) triangles += (prim.getIndices()?.getCount() ?? prim.getAttribute('POSITION').getCount()) / 3
  if (triangles > 20000) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: Math.max(0.2, 20000 / triangles), error: 0.001 }))
  await doc.transform(quantize(), textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 80, resize: [512, 512] }))
  const glb = await io.writeBinary(doc)
  fs.writeFileSync(path.join(outModels, `${key}.glb`), glb)
  totalBytes += glb.length

  const iconSrc = path.join(libsDir, item.lib, entry.icon)
  await sharp(iconSrc).resize(128, 128, { fit: 'inside' }).png().toFile(path.join(outIcons, `${key}.png`))

  if (tmp) fs.rmSync(tmp, { recursive: true, force: true })
  const creator = entry.creator || 'unknown'
  catalog.push({
    key,
    name: item.name || entry.name,
    category: item.category || entry.category,
    width: +width.toFixed(4),
    depth: +depth.toFixed(4),
    height: +height.toFixed(4),
    elevation: +elevation.toFixed(4),
    creator,
    license: entry.license || libInfo.license,
    library: item.lib,
  })
  credits.push(`| ${item.name || entry.name} | \`${key}\` | ${creator} | ${entry.license || libInfo.license} | ${item.lib} |`)
  console.log(`${key.padEnd(34)} ${(glb.length / 1024).toFixed(0).padStart(5)} KB  ${width.toFixed(2)}x${depth.toFixed(2)}x${height.toFixed(2)}  ${Date.now() - t0} ms`)
}

fs.mkdirSync(path.join(root, 'src/furniture'), { recursive: true })
fs.writeFileSync(path.join(root, 'src/furniture/catalog.json'), JSON.stringify(catalog, null, 1))
const libLines = Object.entries(selection.libraries).map(([lib, info]) => `- **${lib}**: ${info.source}. Licence: [${info.license}](${info.licenseUrl}).`)
fs.writeFileSync(
  path.join(root, 'public/furniture/CREDITS.md'),
  `# Furniture model credits\n\nThe furniture catalogue is built from the free model libraries distributed with [Sweet Home 3D](https://www.sweethome3d.com/), converted to glTF for the web with the script in \`scripts/import-furniture.mjs\`. Models keep their original licences; converted files are derivative works distributed under the same licence as their source.\n\n${libLines.join('\n')}\n\n| Model | Key | Author | Licence | Library |\n| --- | --- | --- | --- | --- |\n${credits.join('\n')}\n`,
)
console.log(`\n${catalog.length} models, ${(totalBytes / 1024 / 1024).toFixed(1)} MB of GLB`)
