/**
 * Render top-down plan icons (transparent PNG) for every model in src/furniture/catalog.json,
 * using headless Chromium + three.js. Output: public/furniture/plan/<key>.png
 *
 * Usage: node scripts/render-plan-icons.mjs [--chromium /path/to/chromium]
 */
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import sharp from 'sharp'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const require = createRequire(import.meta.url)
const args = process.argv.slice(2)
const chromiumArg = args.indexOf('--chromium')
const executablePath = chromiumArg >= 0 ? args[chromiumArg + 1] : undefined
const outDir = path.join(root, 'public/furniture/plan')
fs.mkdirSync(outDir, { recursive: true })
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'src/furniture/catalog.json'), 'utf8'))

// bundle a tiny renderer with esbuild (a vite dependency)
const bundleDir = fs.mkdtempSync(path.join(root, 'node_modules/.cache/plan-icons-'))
fs.writeFileSync(
  path.join(bundleDir, 'renderer.js'),
  `
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
const SIZE = 256
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
renderer.setSize(SIZE, SIZE)
renderer.setClearColor(0x000000, 0)
document.body.appendChild(renderer.domElement)
const loader = new GLTFLoader()
window.renderTop = (url, w, d) => new Promise((resolve, reject) => {
  loader.load(url, (gltf) => {
    const scene = new THREE.Scene()
    scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 1.6))
    const sun = new THREE.DirectionalLight(0xffffff, 1.2)
    sun.position.set(1, 3, 2)
    scene.add(sun)
    scene.add(gltf.scene)
    const box = new THREE.Box3().setFromObject(gltf.scene)
    const half = Math.max(w, d) / 2 * 1.02
    const cam = new THREE.OrthographicCamera(-half, half, half, -half, 0.01, 100)
    cam.position.set(0, box.max.y + 5, 0)
    cam.up.set(0, 0, -1)
    cam.lookAt(0, 0, 0)
    renderer.render(scene, cam)
    resolve(renderer.domElement.toDataURL('image/png'))
  }, undefined, reject)
})
`,
)
const esbuild = require.resolve('esbuild/bin/esbuild')
execFileSync(esbuild, [path.join(bundleDir, 'renderer.js'), '--bundle', '--format=iife', `--outfile=${path.join(bundleDir, 'bundle.js')}`], { cwd: root, stdio: 'inherit' })
fs.writeFileSync(path.join(bundleDir, 'index.html'), `<!doctype html><body style="margin:0;background:transparent"><script src="bundle.js"></script></body>`)

const publicDir = path.join(root, 'public')
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0])
  const file = url.startsWith('/furniture/') ? path.join(publicDir, url) : path.join(bundleDir, url === '/' ? 'index.html' : url)
  if (!fs.existsSync(file)) {
    res.writeHead(404)
    return res.end()
  }
  res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})
await new Promise((r) => server.listen(0, r))
const port = server.address().port

const { chromium } = await import('playwright').catch(() => import(path.join(process.env.PLAYWRIGHT_DIR ?? '', 'node_modules/playwright/index.mjs')))
const browser = await chromium.launch({ executablePath, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 300, height: 300 } })
page.on('pageerror', (e) => console.error('page error', e.message))
await page.goto(`http://127.0.0.1:${port}/`)
for (const item of catalog) {
  const dataUrl = await page.evaluate(({ url, w, d }) => window.renderTop(url, w, d), { url: `/furniture/models/${item.key}.glb`, w: item.width, d: item.depth })
  // palette PNGs are ~4x smaller and plenty for a plan symbol
  await sharp(Buffer.from(dataUrl.split(',')[1], 'base64')).png({ palette: true, quality: 90, compressionLevel: 9 }).toFile(path.join(outDir, `${item.key}.png`))
  process.stdout.write('.')
}
console.log(`\nrendered ${catalog.length} plan icons`)
await browser.close()
server.close()
fs.rmSync(bundleDir, { recursive: true, force: true })
