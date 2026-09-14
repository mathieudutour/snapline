import * as THREE from 'three'

/**
 * Render a normalised model (metres, centred on x/z, floor at y=0) to PNG blobs:
 * a top-down plan symbol covering a max(width, depth) square, and a 3/4 thumbnail.
 */
export async function renderModelIcons(model: THREE.Object3D, width: number, depth: number, height: number): Promise<{ plan: Blob; thumb: Blob }> {
  const SIZE = 256
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setSize(SIZE, SIZE, false)
  renderer.setClearColor(0x000000, 0)
  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 1.6))
  const sun = new THREE.DirectionalLight(0xffffff, 1.2)
  sun.position.set(1, 3, 2)
  scene.add(sun)
  scene.add(model)
  const toBlob = () => new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'))
  try {
    // plan symbol: orthographic, straight down, front (+z) at the bottom of the image
    const half = (Math.max(width, depth) / 2) * 1.02
    const top = new THREE.OrthographicCamera(-half, half, half, -half, 0.01, 100)
    top.position.set(0, height + 5, 0)
    top.up.set(0, 0, -1)
    top.lookAt(0, 0, 0)
    renderer.render(scene, top)
    const plan = await toBlob()
    // thumbnail: perspective from the front-left, slightly above
    const radius = Math.max(width, depth, height)
    const cam = new THREE.PerspectiveCamera(35, 1, 0.01, 100)
    cam.position.set(-radius * 1.4, height * 0.5 + radius * 1.1, radius * 1.9)
    cam.lookAt(0, height / 2, 0)
    renderer.render(scene, cam)
    const thumb = await toBlob()
    return { plan, thumb }
  } finally {
    scene.remove(model)
    renderer.dispose()
  }
}
