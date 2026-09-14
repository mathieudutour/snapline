/**
 * Files attached to plans (underlay images): kept in IndexedDB, exposed as object URLs, and copied
 * to the account (R2) when signed in so collaborators and other devices get them too.
 */
import { getProjectFile } from '../sync/api'

const DB_NAME = 'snapline-files'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore('files')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction('files', mode)
    const req = fn(tx.objectStore('files'))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    tx.oncomplete = () => db.close()
  })
}
export const putFileBlob = (key: string, blob: Blob) => withStore('readwrite', (s) => s.put(blob, key))
export const getFileBlob = (key: string) => withStore<Blob | undefined>('readonly', (s) => s.get(key))
export const deleteFileBlob = (key: string) => withStore('readwrite', (s) => s.delete(key))

const urls = new Map<string, string>()
const pending = new Map<string, Promise<string | null>>()
const listeners = new Set<() => void>()

export function fileUrl(key: string): string | null {
  return urls.get(key) ?? null
}
export function onFileUrls(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
function register(key: string, blob: Blob): string {
  const url = URL.createObjectURL(blob)
  urls.set(key, url)
  listeners.forEach((fn) => fn())
  return url
}

/** store a new file locally and expose it */
export async function addFile(key: string, blob: Blob): Promise<string> {
  await putFileBlob(key, blob)
  return register(key, blob)
}

export async function removeFile(key: string) {
  const url = urls.get(key)
  if (url) URL.revokeObjectURL(url)
  urls.delete(key)
  await deleteFileBlob(key).catch(() => undefined)
}

/** make the file's URL available: from the browser, or by downloading it from the project when signed in / viewing a link */
export function ensureFileUrl(projectId: string, key: string, viewToken?: string | null): Promise<string | null> {
  const known = urls.get(key)
  if (known) return Promise.resolve(known)
  const inFlight = pending.get(key)
  if (inFlight) return inFlight
  const p = (async () => {
    try {
      const local = await getFileBlob(key).catch(() => undefined)
      if (local) return register(key, local)
      const remote = await getProjectFile(projectId, key, viewToken)
      await putFileBlob(key, remote).catch(() => undefined)
      return register(key, remote)
    } catch {
      return null
    } finally {
      pending.delete(key)
    }
  })()
  pending.set(key, p)
  return p
}

export function newFileKey(): string {
  const buf = new Uint8Array(6)
  crypto.getRandomValues(buf)
  return 'uf-' + [...buf].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** turn an image or PDF file into a PNG/JPEG blob with its pixel size (PDFs: first page, ~150 dpi) */
export async function rasterize(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    const pdfjs = await import('pdfjs-dist')
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default
    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const scale = Math.min(4, 4000 / Math.max(base.width, base.height), 150 / 72)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport }).promise
    const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('render failed'))), 'image/png'))
    return { blob, width: canvas.width, height: canvas.height }
  }
  if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(file.type)) throw new Error('Choose a PNG, JPEG, WebP, GIF, SVG or PDF file.')
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = () => rej(new Error('Could not read this image.'))
      i.src = url
    })
    const width = img.naturalWidth || 1000
    const height = img.naturalHeight || 1000
    // very large photos are downscaled so the plan stays responsive
    const k = Math.min(1, 4000 / Math.max(width, height))
    if (k < 1 || file.type === 'image/svg+xml') {
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(width * k)
      canvas.height = Math.round(height * k)
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('render failed'))), 'image/png'))
      return { blob, width: canvas.width, height: canvas.height }
    }
    return { blob: file, width, height }
  } finally {
    URL.revokeObjectURL(url)
  }
}
