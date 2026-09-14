import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, PointerLockControls, Sky, useGLTF } from '@react-three/drei'
import { Suspense } from 'react'
import { resolveModelUrl } from '../furniture/catalog'
import { isCustomKey } from '../furniture/customModels'
import type { Furniture } from '../model/types'
import * as THREE from 'three'
import { SEASON_DAY, sunPosition, sunVector, type SunPosition } from '../model/sun'
import { useEditor } from '../model/store'
import { floorElevation, floorHeight, projectTopElevation } from '../model/project'
import { buildRoofGeometry, buildScene, type OpeningMeshData, type SceneData } from './buildScene'
import type { Plan } from '../model/types'
import { resolveCollisions } from './collision'

const WALL_COLOR = '#f2efe9'
const FLOOR_COLORS = ['#d9c2a3', '#cdb693', '#e0cbb0', '#c9b596']

interface FloorScene {
  id: string
  index: number
  plan: Plan
  elevation: number
  height: number
  data: SceneData
}

function useFloorScenes(): FloorScene[] {
  const project = useEditor((s) => s.project)
  const scenes = useMemo(
    () =>
      project.floors.map((f, index) => ({
        id: f.id,
        index,
        plan: f.plan,
        elevation: floorElevation(project, f.id),
        height: floorHeight(f),
        data: buildScene(f.plan, { bandBelow: index > 0 ? project.slabThickness : 0 }),
      })),
    [project],
  )
  useEffect(() => () => scenes.forEach((s) => s.data.dispose()), [scenes])
  return scenes
}

function RoofMesh({ top }: { top: FloorScene }) {
  const project = useEditor((s) => s.project)
  const geometry = useMemo(() => buildRoofGeometry(top.plan, project.roof, projectTopElevation(project)), [top.plan, project])
  useEffect(() => () => geometry?.dispose(), [geometry])
  if (!geometry) return null
  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial color={project.roof.color} roughness={0.85} side={THREE.DoubleSide} />
    </mesh>
  )
}

function DoorMesh({ o }: { o: OpeningMeshData }) {
  const { width, height } = o.opening
  const depth = o.thickness + 0.02
  const jamb = 0.05
  const hingeX = o.hingeAtB ? width / 2 : -width / 2
  const dir = o.hingeAtB ? -1 : 1
  const openAngle = (o.swingPositiveZ ? -1 : 1) * dir * (Math.PI / 2) * 0.85
  return (
    <group position={o.position} rotation={[0, o.rotationY, 0]}>
      <mesh position={[-width / 2 - jamb / 2, height / 2, 0]} castShadow>
        <boxGeometry args={[jamb, height, depth]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
      <mesh position={[width / 2 + jamb / 2, height / 2, 0]} castShadow>
        <boxGeometry args={[jamb, height, depth]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
      <mesh position={[0, height + jamb / 2, 0]} castShadow>
        <boxGeometry args={[width + 2 * jamb, jamb, depth]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
      <group position={[hingeX, 0, 0]} rotation={[0, openAngle, 0]}>
        <mesh position={[(dir * width) / 2, height / 2, 0]} castShadow>
          <boxGeometry args={[width, height, 0.04]} />
          <meshStandardMaterial color="#b98d5b" />
        </mesh>
        <mesh position={[dir * (width - 0.08), height * 0.48, 0.035]}>
          <sphereGeometry args={[0.025, 12, 12]} />
          <meshStandardMaterial color="#c0c0c0" metalness={0.8} roughness={0.3} />
        </mesh>
      </group>
    </group>
  )
}

function WindowMesh({ o }: { o: OpeningMeshData }) {
  const { width, height, sill } = o.opening
  const depth = o.thickness + 0.02
  const f = 0.05
  return (
    <group position={o.position} rotation={[0, o.rotationY, 0]}>
      <mesh position={[0, sill + height / 2, 0]}>
        <boxGeometry args={[width, height, 0.02]} />
        <meshPhysicalMaterial color="#9fd0ff" transparent opacity={0.35} roughness={0.05} metalness={0.1} />
      </mesh>
      <mesh position={[-width / 2 + f / 2, sill + height / 2, 0]}>
        <boxGeometry args={[f, height, depth]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
      <mesh position={[width / 2 - f / 2, sill + height / 2, 0]}>
        <boxGeometry args={[f, height, depth]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
      <mesh position={[0, sill + f / 2, 0]}>
        <boxGeometry args={[width, f, depth]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
      <mesh position={[0, sill + height - f / 2, 0]}>
        <boxGeometry args={[width, f, depth]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
      {width > 1 && (
        <mesh position={[0, sill + height / 2, 0]}>
          <boxGeometry args={[0.04, height, 0.06]} />
          <meshStandardMaterial color="#ffffff" />
        </mesh>
      )}
    </group>
  )
}

function FurnitureModel({ piece, url }: { piece: Furniture; url: string }) {
  const { scene } = useGLTF(url)
  const custom = useEditor((s) => (isCustomKey(piece.catalogKey) ? s.customModels.find((m) => m.key === piece.catalogKey) : undefined))
  const cloned = useMemo(() => {
    const c = scene.clone(true)
    c.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh) {
        mesh.castShadow = true
        mesh.receiveShadow = true
      }
    })
    return c
  }, [scene])
  const item = useEditor((s) => s.catalogItem(piece.catalogKey))
  const sx = item ? piece.width / item.width : 1
  const sy = item ? piece.height / item.height : 1
  const sz = item ? piece.depth / item.depth : 1
  if (custom) {
    // imported files are raw: scale to metres and shift so the piece is centred with its floor at y=0
    const [cx, minY, cz] = custom.fit.center
    return (
      <group scale={[sx, sy, sz]}>
        <group scale={custom.fit.unitScale}>
          <primitive object={cloned} position={[-cx, -minY, -cz]} />
        </group>
      </group>
    )
  }
  return <primitive object={cloned} scale={[sx, sy, sz]} />
}

function FurniturePlaceholder({ piece }: { piece: Furniture }) {
  return (
    <mesh position={[0, piece.height / 2, 0]}>
      <boxGeometry args={[piece.width, piece.height, piece.depth]} />
      <meshStandardMaterial color="#c9c4bb" wireframe />
    </mesh>
  )
}

function FurnitureOrBox({ piece }: { piece: Furniture }) {
  // re-render when imported models finish loading
  useEditor((s) => s.customModels.length)
  const url = resolveModelUrl(piece.catalogKey)
  if (!url) return <FurniturePlaceholder piece={piece} />
  return (
    <Suspense fallback={<FurniturePlaceholder piece={piece} />}>
      <FurnitureModel piece={piece} url={url} />
    </Suspense>
  )
}

function FurnitureMeshes({ furniture }: { furniture: Plan['furniture'] }) {
  return (
    <group>
      {Object.values(furniture ?? {}).map((piece) => (
        <group key={piece.id} position={[piece.x, piece.elevation, piece.y]} rotation={[0, -piece.angle, 0]}>
          <FurnitureOrBox piece={piece} />
        </group>
      ))}
    </group>
  )
}

function PlanMeshes({ data, showCeilings }: { data: SceneData; showCeilings: boolean }) {
  return (
    <group>
      {data.walls.map((w) => (
        <mesh key={w.id} geometry={w.geometry} castShadow receiveShadow>
          <meshStandardMaterial color={WALL_COLOR} roughness={0.9} />
        </mesh>
      ))}
      {data.floors.map((f, i) => (
        <group key={f.id}>
          <mesh geometry={f.geometry} position={[0, 0.005, 0]} receiveShadow>
            <meshStandardMaterial color={FLOOR_COLORS[i % FLOOR_COLORS.length]} roughness={0.8} />
          </mesh>
          {showCeilings && (
            <mesh geometry={f.ceiling} position={[0, f.height - 0.005, 0]}>
              <meshStandardMaterial color="#fbfbfb" roughness={1} />
            </mesh>
          )}
        </group>
      ))}
      {data.openings.map((o) => (o.opening.kind === 'door' ? <DoorMesh key={o.id} o={o} /> : <WindowMesh key={o.id} o={o} />))}
    </group>
  )
}

function Ground({ center, radius }: { center: { x: number; y: number }; radius: number }) {
  const size = Math.max(40, radius * 6)
  return (
    <group position={[center.x, 0, center.y]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[size, size]} />
        <meshStandardMaterial color="#b9c7b0" roughness={1} />
      </mesh>
      <gridHelper args={[size, size, '#9fb094', '#aebfa5']} position={[0, 0, 0]} />
    </group>
  )
}

/** direction to the sun and how bright it is: from the site and the chosen moment, or a pleasant default */
function useSun(radius: number): { dir: [number, number, number]; intensity: number; color: string; sky: number; position: SunPosition | null } {
  const site = useEditor((s) => s.project.site)
  const sun = useEditor((s) => s.sun)
  return useMemo(() => {
    if (!site) return { dir: [radius, radius * 1.6 + 6, radius * 0.6].map((v) => v / Math.hypot(radius, radius * 1.6 + 6, radius * 0.6)) as [number, number, number], intensity: 1.6, color: '#ffffff', sky: 1, position: null }
    const position = sunPosition(site, SEASON_DAY[sun.season], sun.hour)
    const dir = sunVector(position, site.north)
    const up = Math.max(0, Math.sin((position.elevation * Math.PI) / 180))
    // dim and warm near the horizon, off at night
    const intensity = position.elevation <= 0 ? 0 : 0.4 + 1.6 * Math.min(1, up * 1.5)
    const warmth = Math.min(1, Math.max(0, 1 - position.elevation / 25))
    const color = `rgb(255, ${Math.round(255 - 70 * warmth)}, ${Math.round(255 - 130 * warmth)})`
    const sky = position.elevation <= -6 ? 0.15 : position.elevation <= 0 ? 0.15 + (0.35 * (position.elevation + 6)) / 6 : 0.5 + 0.5 * Math.min(1, up * 2)
    return { dir, intensity, color, sky, position }
  }, [site, sun, radius])
}

function Lights({ center, radius }: { center: { x: number; y: number }; radius: number }) {
  const d = Math.max(10, radius * 1.5)
  const sun = useSun(radius)
  const dist = radius * 3 + 10
  return (
    <>
      <hemisphereLight args={['#ffffff', '#8a7f6a', 0.7 * sun.sky]} />
      <directionalLight
        position={[center.x + sun.dir[0] * dist, Math.max(0.5, sun.dir[1] * dist), center.y + sun.dir[2] * dist]}
        intensity={sun.intensity}
        color={sun.color}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-d}
        shadow-camera-right={d}
        shadow-camera-top={d}
        shadow-camera-bottom={-d}
        shadow-camera-near={0.5}
        shadow-camera-far={d * 4}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
        target-position={[center.x, 0, center.y]}
      />
      <ambientLight intensity={0.25 * Math.max(0.5, sun.sky)} />
    </>
  )
}

/** sky dome that follows the sun; the clear colour behind it darkens at night */
function SunSky({ radius }: { radius: number }) {
  const sun = useSun(radius)
  const { gl } = useThree()
  useEffect(() => {
    const k = sun.sky
    gl.setClearColor(new THREE.Color(0.22 + 0.65 * k, 0.28 + 0.63 * k, 0.4 + 0.54 * k))
  }, [gl, sun.sky])
  const pos: [number, number, number] = [sun.dir[0] * 100, Math.max(sun.dir[1] * 100, sun.position ? -2 : 5), sun.dir[2] * 100]
  return <Sky sunPosition={pos} turbidity={sun.position && sun.position.elevation < 10 ? 10 : 6} rayleigh={sun.position && sun.position.elevation < 10 ? 3 : 1.5} distance={400} />
}

function WalkController({ data, locked, elevation }: { data: SceneData; locked: boolean; elevation: number }) {
  const { camera } = useThree()
  const keys = useRef<Set<string>>(new Set())
  const velocity = useRef(new THREE.Vector3())
  const eye = elevation + 1.65
  useEffect(() => {
    camera.position.set(data.spawn.x, eye, data.spawn.y)
    // look towards the plan centre if we are not in it
    const target = new THREE.Vector3(data.center.x, eye, data.center.y)
    if (target.distanceTo(camera.position) > 0.5) camera.lookAt(target)
    else camera.lookAt(new THREE.Vector3(data.spawn.x + 1, eye, data.spawn.y))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      keys.current.add(e.code)
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault()
    }
    const up = (e: KeyboardEvent) => keys.current.delete(e.code)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])
  useFrame((_, dt) => {
    if (!locked) return
    const k = keys.current
    const forward = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0)
    const strafe = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0)
    const speed = k.has('ShiftLeft') || k.has('ShiftRight') ? 4.5 : 2.2
    const dir = new THREE.Vector3()
    camera.getWorldDirection(dir)
    dir.y = 0
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1)
    dir.normalize()
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize()
    const wish = new THREE.Vector3().addScaledVector(dir, forward).addScaledVector(right, strafe)
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed)
    // smooth acceleration
    velocity.current.lerp(wish, Math.min(1, dt * 12))
    const step = Math.min(dt, 0.05)
    camera.position.addScaledVector(velocity.current, step)
    resolveCollisions(camera.position, data.blockers, 0.3, data.furnitureBlockers)
    camera.position.y = eye
  })
  return null
}

function FrameOrbit({ data }: { data: { center: { x: number; y: number }; radius: number } }) {
  const { camera } = useThree()
  const done = useRef(false)
  useEffect(() => {
    if (done.current) return
    done.current = true
    camera.position.set(data.center.x + data.radius * 1.2, data.radius * 1.3 + 4, data.center.y + data.radius * 1.6)
    camera.lookAt(data.center.x, 0, data.center.y)
  }, [camera, data])
  return <OrbitControls target={[data.center.x, 0, data.center.y]} maxPolarAngle={Math.PI / 2 - 0.02} makeDefault />
}

export function Scene3D({ walk }: { walk: boolean }) {
  const scenes = useFloorScenes()
  const activeFloorId = useEditor((s) => s.activeFloorId)
  const cutAboveActive = useEditor((s) => s.cutAboveActive)
  const roofType = useEditor((s) => s.project.roof.type)
  const [locked, setLocked] = useState(false)
  const controlsRef = useRef<{ lock: () => void; unlock: () => void } | null>(null)
  useEffect(() => {
    if (!walk) setLocked(false)
  }, [walk])
  const active = scenes.find((s) => s.id === activeFloorId) ?? scenes[0]
  const top = scenes[scenes.length - 1]
  const visible = scenes.filter((s) => !cutAboveActive || s.index <= active.index)
  const showRoof = !cutAboveActive && roofType !== 'none'
  const bounds = useMemo(() => {
    let radius = 4
    let cx = 0
    let cy = 0
    let n = 0
    for (const s of scenes) {
      radius = Math.max(radius, s.data.radius)
      cx += s.data.center.x
      cy += s.data.center.y
      n++
    }
    return { center: { x: cx / (n || 1), y: cy / (n || 1) }, radius: radius + (top ? top.elevation / 3 : 0) }
  }, [scenes, top])
  return (
    <div className="scene3d">
      <Canvas shadows="percentage" camera={{ fov: walk ? 75 : 50, near: 0.05, far: 500 }} gl={{ antialias: true }} onCreated={({ gl }) => gl.setClearColor('#dfe7f0')}>
        <SunSky radius={bounds.radius} />
        <Lights center={bounds.center} radius={bounds.radius} />
        <Ground center={bounds.center} radius={bounds.radius} />
        {visible.map((s) => (
          <group key={s.id} position={[0, s.elevation, 0]}>
            <PlanMeshes data={s.data} showCeilings={walk || s.index < scenes.length - 1 || showRoof} />
            <FurnitureMeshes furniture={s.plan.furniture} />
          </group>
        ))}
        {showRoof && top && <RoofMesh top={top} />}
        {walk ? (
          <>
            <PointerLockControls ref={controlsRef as never} onLock={() => setLocked(true)} onUnlock={() => setLocked(false)} />
            <WalkController key={active.id} data={active.data} locked={locked} elevation={active.elevation} />
          </>
        ) : (
          <FrameOrbit data={bounds} />
        )}
      </Canvas>
      {walk && !locked && (
        <div className="walk-overlay" onClick={() => controlsRef.current?.lock()}>
          <div className="card">
            <h2>Walk through your plan</h2>
            <p>Click to start. Move with <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> or the arrow keys, look around with the mouse, hold <kbd>Shift</kbd> to run.</p>
            <p>Press <kbd>Esc</kbd> to release the mouse. Pick another floor in the Floors list on the left.</p>
          </div>
        </div>
      )}
      {walk && locked && <div className="crosshair" />}
      {!walk && <div className="scene-hint">Drag to orbit · right-drag to pan · scroll to zoom</div>}
    </div>
  )
}
