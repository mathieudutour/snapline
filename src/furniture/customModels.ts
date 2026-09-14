import type { CatalogItem } from './catalog'

/** how a raw glTF is turned into a normalised piece: scale to metres, then shift so it is centred on x/z with its floor at y=0 */
export interface ModelFit {
  unitScale: number
  /** raw-model-unit offsets of the bounding box: centre x, min y, centre z */
  center: [number, number, number]
}

export interface CustomModel extends CatalogItem {
  fit: ModelFit
  createdAt: number
}

export interface ModelBlobs {
  glb: ArrayBuffer
  plan: Blob
  thumb: Blob
}

const META_KEY = 'snapline.models.v1'
const DB_NAME = 'snapline-models'
const STORE = 'models'

export function loadCustomModelMeta(): CustomModel[] {
  try {
    const raw = localStorage.getItem(META_KEY)
    return raw ? (JSON.parse(raw) as CustomModel[]) : []
  } catch {
    return []
  }
}

export function saveCustomModelMeta(list: CustomModel[]) {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(list))
  } catch {
    // ignore
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const req = fn(tx.objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    tx.oncomplete = () => db.close()
  })
}

export const putModelBlobs = (key: string, blobs: ModelBlobs) => withStore('readwrite', (s) => s.put(blobs, key))
export const getModelBlobs = (key: string) => withStore<ModelBlobs | undefined>('readonly', (s) => s.get(key))
export const deleteModelBlobs = (key: string) => withStore('readwrite', (s) => s.delete(key))

/** object URLs for loaded custom models, keyed by model key */
const urls = new Map<string, { glb: string; plan: string; thumb: string }>()

export function customModelUrls(key: string) {
  return urls.get(key) ?? null
}

export async function registerModelUrls(key: string, blobs: ModelBlobs) {
  const old = urls.get(key)
  if (old) for (const u of Object.values(old)) URL.revokeObjectURL(u)
  urls.set(key, {
    glb: URL.createObjectURL(new Blob([blobs.glb], { type: 'model/gltf-binary' })),
    plan: URL.createObjectURL(blobs.plan),
    thumb: URL.createObjectURL(blobs.thumb),
  })
}

export function unregisterModelUrls(key: string) {
  const old = urls.get(key)
  if (old) for (const u of Object.values(old)) URL.revokeObjectURL(u)
  urls.delete(key)
}

export interface ParsedModel {
  /** natural size in metres after the unit scale */
  width: number
  depth: number
  height: number
  fit: ModelFit
  /** normalised object (metres, centred, floor at 0) ready for rendering */
  object: import('three').Object3D
}

/** Parse a glTF/GLB file and measure it. `unitScale` converts the file's units to metres (1 for metres). */
export async function parseModelFile(buffer: ArrayBuffer, unitScale: number): Promise<ParsedModel> {
  const THREE = await import('three')
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
  const loader = new GLTFLoader()
  const gltf = await loader.parseAsync(buffer, '')
  const scene = gltf.scene
  scene.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(scene)
  if (!Number.isFinite(box.min.x) || box.isEmpty()) throw new Error('The file contains no visible geometry.')
  const size = new THREE.Vector3()
  box.getSize(size)
  const center = box.getCenter(new THREE.Vector3())
  const fit: ModelFit = { unitScale, center: [center.x, box.min.y, center.z] }
  const object = new THREE.Group()
  const inner = new THREE.Group()
  inner.scale.setScalar(unitScale)
  scene.position.set(-center.x, -box.min.y, -center.z)
  inner.add(scene)
  object.add(inner)
  return { width: size.x * unitScale, depth: size.z * unitScale, height: size.y * unitScale, fit, object }
}

/** guess the unit of a model from its raw size: metres unless it is absurdly large */
export function guessUnitScale(maxDimension: number): number {
  if (maxDimension > 500) return 0.001 // millimetres
  if (maxDimension > 12) return 0.01 // centimetres
  return 1
}

export function newModelKey(): string {
  const buf = new Uint8Array(6)
  crypto.getRandomValues(buf)
  return 'u-' + [...buf].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const isCustomKey = (key: string) => key.startsWith('u-')
