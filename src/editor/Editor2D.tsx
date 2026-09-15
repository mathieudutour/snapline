import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Furniture, Opening, Plan, Vec2, Wall } from '../model/types'
import { furnitureCorners, localToPlan, snapFurnitureToWall } from '../model/furniture'
import { resolvePlanIconUrl } from '../furniture/catalog'
import { add, dimensionSide, dist, dot, findRooms, normalize, oppositeSide, perp, planBounds, pointInPolygon, projectOnSegment, scale, sideNormal, sub, wallFace, wallLength, wallPolygon, wallsAtPoint } from '../model/geometry'
import { floorBelow, isReadOnly, isSelected, useEditor, type SelectionItem } from '../model/store'
import { constraintsReferencing } from '../model/constraints'
import { formatArea, formatLength, parseLength, type Units } from '../model/units'
import { snapPosition, type SnapResult } from './snapping'
import { screenToWorld, worldToScreen, type Viewport } from './viewport'
import { Dimension } from './Dimension'
import { setLiveCursor } from '../sync/liveController'
import { wallGap } from '../model/measure'
import { roomLabel, roomName } from '../model/rooms'
import { FINISH_BY_KEY } from '../model/finishes'
import { stairSteps, structureKind } from '../model/structures'
import { PeerCursors, usePeerSelections } from './Peers'
import { Compass } from '../panels/Site'
import { CommentComposer, CommentPin, CommentThread } from './Comments'
import { ensureFileUrl, fileUrl, onFileUrls } from '../files/planFiles'
import type { Underlay } from '../model/project'

type DragState =
  | { kind: 'pan'; startScreen: Vec2; startVp: Viewport }
  /** one finger: pan once it moves, select what it tapped otherwise */
  | { kind: 'touch'; startScreen: Vec2; startVp: Viewport; moved: boolean; target: SelectionItem | null }
  /** two fingers: pinch to zoom around the midpoint and pan with it */
  | { kind: 'pinch'; startVp: Viewport; startDist: number; startMid: Vec2; startWorld: Vec2 }
  | { kind: 'point'; id: string; moved: boolean; snap: SnapResult | null; start: Vec2 }
  | { kind: 'wall'; id: string; startA: Vec2; startB: Vec2; startCursor: Vec2; moved: boolean }
  | { kind: 'opening'; id: string; moved: boolean }
  | { kind: 'furniture'; id: string; start: Vec2; startAngle: number; startCursor: Vec2; moved: boolean; snappedWall: string | null }
  | { kind: 'rotate'; id: string; moved: boolean }
  | { kind: 'click-empty'; startScreen: Vec2; startWorld: Vec2 }
  /** moving the underlay image (unlocked) */
  | { kind: 'underlay'; start: Vec2; startCursor: Vec2; moved: boolean }

type Editing = { kind: 'wallLength'; wallId: string; screen: Vec2 } | { kind: 'openingOffset'; openingId: string; end: 'a' | 'b'; screen: Vec2 }

interface OpeningGeometry {
  start: Vec2
  end: Vec2
  u: Vec2
  n: Vec2
  corners: Vec2[]
}

function openingGeometry(plan: Plan, o: Opening): OpeningGeometry | null {
  const w = plan.walls[o.wallId]
  if (!w) return null
  const a = plan.points[w.a]
  const b = plan.points[w.b]
  const u = normalize(sub(b, a))
  const n = perp(u)
  const start = add(a, scale(u, o.offset))
  const end = add(a, scale(u, o.offset + o.width))
  const h = scale(n, w.thickness / 2)
  return { start, end, u, n, corners: [add(start, h), add(end, h), sub(end, h), sub(start, h)] }
}

export function Editor2D() {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [vp, setVp] = useState<Viewport>({ cx: 4.5, cy: 3.25, scale: 70 })
  const plan = useEditor((s) => s.plan)
  const report = useEditor((s) => s.report)
  const selection = useEditor((s) => s.selection)
  const tool = useEditor((s) => s.tool)
  const snapGrid = useEditor((s) => s.snapGrid)
  const gridSize = useEditor((s) => s.gridSize)
  const rooms = useMemo(() => findRooms(plan), [plan])
  const readOnly = useEditor(isReadOnly)
  const underlay = useEditor((s) => s.project.floors.find((f) => f.id === s.activeFloorId)?.underlay)
  const calibrating = useEditor((s) => s.calibrating)

  const [cursor, setCursor] = useState<Vec2 | null>(null)
  const [hover, setHover] = useState<SelectionItem | null>(null)
  /** Option/Alt held: show the distance from the selected wall to the hovered one */
  const [alt, setAlt] = useState(false)
  const [snap, setSnap] = useState<SnapResult | null>(null)
  const [drawing, setDrawing] = useState<{ pos: Vec2; pointId?: string; wall?: { wallId: string; t: number }; startPointId?: string } | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  /** a comment being written at a spot on the plan */
  const [composer, setComposer] = useState<Vec2 | null>(null)
  const openComment = useEditor((s) => s.openComment)
  const setOpenComment = useEditor((s) => s.setOpenComment)
  const showResolved = useEditor((s) => s.showResolved)
  const [shift, setShift] = useState(false)
  const [ctrl, setCtrl] = useState(false)
  const [space, setSpace] = useState(false)
  const [marquee, setMarquee] = useState<{ a: Vec2; b: Vec2 } | null>(null)
  const [placeAngle, setPlaceAngle] = useState(0)
  const fitVersion = useEditor((s) => s.fitVersion)
  const placing = useEditor((s) => s.placing)
  const autoHV = useEditor((s) => s.autoHV)
  const showFloorBelow = useEditor((s) => s.showFloorBelow)
  const below = useEditor((s) => floorBelow(s))
  const belowPoints = useMemo(() => (showFloorBelow && below ? Object.values(below.points).map((p) => ({ x: p.x, y: p.y })) : []), [showFloorBelow, below])
  const showShortcuts = useEditor((s) => s.showShortcuts)
  const dragRef = useRef<DragState | null>(null)
  /** active touch points by pointer id (for pinch zoom) */
  const touchesRef = useRef(new Map<number, Vec2>())

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }))
    ro.observe(el)
    setSize({ width: el.clientWidth, height: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const px = 1 / vp.scale
  const threshold = 10 * px

  const toWorld = useCallback(
    (e: { clientX: number; clientY: number }): Vec2 => {
      const rect = svgRef.current!.getBoundingClientRect()
      return screenToWorld(vp, { x: e.clientX - rect.left, y: e.clientY - rect.top }, size.width, size.height)
    },
    [vp, size],
  )
  const toScreen = useCallback((p: Vec2): Vec2 => worldToScreen(vp, p, size.width, size.height), [vp, size])

  const peerSelections = usePeerSelections()
  const north = useEditor((s) => s.project.site?.north)
  /** wall under the pointer for Option-hover measuring; hovering a door or window counts as its wall */
  const measureTarget = hover?.kind === 'wall' ? hover.id : hover?.kind === 'opening' ? plan.openings[hover.id]?.wallId : null
  /** the side a wall's dimension is drawn on (away from rooms) and its outward normal */
  const wallSide = useCallback((w: Wall) => dimensionSide(plan, rooms, w), [plan, rooms])
  const DIM_GAP = 0.35

  // ---- view helpers ----
  const latest = useRef({ vp, size, drawing })
  latest.current = { vp, size, drawing }

  const setZoom = useCallback((newScale: number, anchor?: Vec2) => {
    const { vp, size } = latest.current
    const s = Math.min(600, Math.max(8, newScale))
    const ax = anchor?.x ?? size.width / 2
    const ay = anchor?.y ?? size.height / 2
    const before = screenToWorld(vp, { x: ax, y: ay }, size.width, size.height)
    setVp({ cx: before.x - (ax - size.width / 2) / s, cy: before.y - (ay - size.height / 2) / s, scale: s })
  }, [])

  const fitBounds = useCallback((b: { min: Vec2; max: Vec2 } | null) => {
    const { size } = latest.current
    if (size.width === 0) return
    if (!b) {
      setVp({ cx: 0, cy: 0, scale: 70 })
      return
    }
    const w = Math.max(1, b.max.x - b.min.x + 2.5)
    const h = Math.max(1, b.max.y - b.min.y + 2.5)
    const scale = Math.min(300, Math.max(8, Math.min(size.width / w, size.height / h)))
    setVp({ cx: (b.min.x + b.max.x) / 2, cy: (b.min.y + b.max.y) / 2, scale })
  }, [])

  const selectionBounds = useCallback((): { min: Vec2; max: Vec2 } | null => {
    const { plan, selection } = useEditor.getState()
    const pts: Vec2[] = []
    for (const s of selection) {
      if (s.kind === 'point' && plan.points[s.id]) pts.push(plan.points[s.id])
      if (s.kind === 'wall' && plan.walls[s.id]) pts.push(plan.points[plan.walls[s.id].a], plan.points[plan.walls[s.id].b])
      if (s.kind === 'opening' && plan.openings[s.id]) {
        const g = openingGeometry(plan, plan.openings[s.id])
        if (g) pts.push(g.start, g.end)
      }
      if (s.kind === 'furniture' && plan.furniture[s.id]) pts.push(...furnitureCorners(plan.furniture[s.id]))
    }
    if (pts.length === 0) return null
    const min = { x: Math.min(...pts.map((p) => p.x)), y: Math.min(...pts.map((p) => p.y)) }
    const max = { x: Math.max(...pts.map((p) => p.x)), y: Math.max(...pts.map((p) => p.y)) }
    return { min, max }
  }, [])

  const sized = size.width > 0
  useEffect(() => {
    if (sized) fitBounds(planBounds(useEditor.getState().plan))
  }, [fitVersion, sized, fitBounds])

  const finishDrawing = useCallback(() => {
    setDrawing(null)
    useEditor.getState().setTool('select')
  }, [])

  const nudge = useCallback((dx: number, dy: number) => {
    const st = useEditor.getState()
    const { plan, selection } = st
    const pointIds = new Set<string>()
    for (const s of selection) {
      if (s.kind === 'point' && plan.points[s.id]) pointIds.add(s.id)
      if (s.kind === 'wall' && plan.walls[s.id]) {
        pointIds.add(plan.walls[s.id].a)
        pointIds.add(plan.walls[s.id].b)
      }
    }
    const furnitureIds = selection.filter((s) => s.kind === 'furniture' && plan.furniture[s.id]).map((s) => s.id)
    if (pointIds.size === 0 && furnitureIds.length === 0 && !selection.some((s) => s.kind === 'opening')) return
    st.beginDrag()
    if (furnitureIds.length > 0) st.dragFurniture(furnitureIds.map((id) => ({ furnitureId: id, x: plan.furniture[id].x + dx, y: plan.furniture[id].y + dy })))
    if (pointIds.size > 0) {
      st.dragTo([...pointIds].map((id) => ({ pointId: id, x: plan.points[id].x + dx, y: plan.points[id].y + dy })))
    } else {
      for (const s of selection) {
        if (s.kind !== 'opening') continue
        const o = plan.openings[s.id]
        const w = o && plan.walls[o.wallId]
        if (!w) continue
        const u = normalize(sub(plan.points[w.b], plan.points[w.a]))
        st.dragOpening(o.id, o.offset + dot({ x: dx, y: dy }, u))
      }
    }
    st.endDrag()
  }, [])

  // In fullscreen, browsers exit on Escape before the page sees it. Chromium's keyboard lock hands
  // Escape to the page instead (the user holds it to leave fullscreen); other browsers ignore this.
  useEffect(() => {
    const kb = (navigator as Navigator & { keyboard?: { lock?: (keys: string[]) => Promise<void>; unlock?: () => void } }).keyboard
    if (!kb?.lock) return
    kb.lock(['Escape']).catch(() => undefined)
    return () => kb.unlock?.()
  }, [])

  // ---- keyboard (Figma-style single-key tools and modifiers) ----
  useEffect(() => {
    const isField = (t: EventTarget | null) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        setAlt(true)
        e.preventDefault() // keep the browser from moving focus to its menu bar
      }
      if (e.key === 'Shift') setShift(true)
      if (e.key === 'Control' || e.key === 'Meta') setCtrl(true)
      if (isField(e.target)) return
      if (e.key === ' ') {
        setSpace(true)
        e.preventDefault()
        return
      }
      const st = useEditor.getState()
      const mod = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()
      const { drawing, vp } = latest.current
      if (mod && key === 'z') {
        e.preventDefault()
        if (e.shiftKey) st.redo()
        else st.undo()
        return
      }
      if (mod && key === 'y') {
        e.preventDefault()
        st.redo()
        return
      }
      if (mod && key === 'a') {
        e.preventDefault()
        st.select([
          ...Object.keys(st.plan.walls).map((id) => ({ kind: 'wall' as const, id })),
          ...Object.keys(st.plan.openings).map((id) => ({ kind: 'opening' as const, id })),
          ...Object.keys(st.plan.furniture).map((id) => ({ kind: 'furniture' as const, id })),
        ])
        return
      }
      if (e.key === '+' || e.key === '=') {
        e.preventDefault()
        setZoom(vp.scale * 1.25)
        return
      }
      if (e.key === '-' || e.key === '_') {
        e.preventDefault()
        setZoom(vp.scale / 1.25)
        return
      }
      if (e.shiftKey && !mod && e.code === 'Digit0') {
        setZoom(100)
        return
      }
      if (e.shiftKey && !mod && e.code === 'Digit1') {
        fitBounds(planBounds(st.plan))
        return
      }
      if (e.shiftKey && !mod && e.code === 'Digit2') {
        fitBounds(selectionBounds() ?? planBounds(st.plan))
        return
      }
      if (e.key === 'PageUp' || e.key === 'PageDown') {
        e.preventDefault()
        const floors = st.project.floors
        const idx = floors.findIndex((f) => f.id === st.activeFloorId)
        const next = floors[idx + (e.key === 'PageUp' ? 1 : -1)]
        if (next) st.setActiveFloor(next.id)
        return
      }
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        st.toggleShortcuts()
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault() // Escape is ours: do not let the browser act on it as well
        setEditing(null)
        setMarquee(null)
        setComposer(null)
        if (st.openComment) {
          st.setOpenComment(null)
          return
        }
        if (st.showShortcuts) {
          st.toggleShortcuts(false)
          return
        }
        if (drawing) finishDrawing()
        else if (st.placing) st.setPlacing(null)
        else {
          st.clearSelection()
          st.setTool('select')
        }
        return
      }
      if (e.key === 'Enter' && drawing) {
        finishDrawing()
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        st.deleteSelection()
        return
      }
      if (e.key.startsWith('Arrow') && st.selection.length > 0) {
        e.preventDefault()
        const step = (e.shiftKey ? 10 : 1) * st.gridSize
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        nudge(dx, dy)
        return
      }
      if (!mod && key === 'r') {
        const step = (e.shiftKey ? -1 : 1) * (Math.PI / 2)
        if (st.placing) {
          setPlaceAngle((a) => a + step)
          return
        }
        const pieces = st.selection.filter((s) => s.kind === 'furniture' && st.plan.furniture[s.id])
        if (pieces.length > 0) {
          st.beginDrag()
          st.dragFurniture(pieces.map((p) => ({ furnitureId: p.id, angle: st.plan.furniture[p.id].angle + step })))
          st.endDrag()
        }
        return
      }
      if (mod || e.altKey) return
      const map: Record<string, typeof st.tool> = { v: 'select', w: 'wall', d: 'door', n: 'window', f: 'furniture', h: 'pan', c: 'comment' }
      const t = map[key]
      if (t) {
        st.setTool(t)
        setDrawing(null)
        setEditing(null)
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setAlt(false)
      if (e.key === 'Shift') setShift(false)
      if (e.key === 'Control' || e.key === 'Meta') setCtrl(false)
      if (e.key === ' ') setSpace(false)
    }
    const blur = () => {
      setShift(false)
      setCtrl(false)
      setSpace(false)
      setAlt(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [setZoom, fitBounds, selectionBounds, finishDrawing, nudge])

  // wheel: scroll pans, Ctrl/Cmd + scroll (or pinch) zooms — registered natively so the browser zoom can be prevented
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const { vp } = latest.current
      const rect = svg.getBoundingClientRect()
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.min(2, Math.max(0.5, Math.exp(-e.deltaY * unit * 0.01)))
        setZoom(vp.scale * factor, { x: e.clientX - rect.left, y: e.clientY - rect.top })
        return
      }
      let dx = e.deltaX * unit
      let dy = e.deltaY * unit
      if (e.shiftKey && dx === 0) {
        dx = dy
        dy = 0
      }
      setVp({ ...vp, cx: vp.cx + dx / vp.scale, cy: vp.cy + dy / vp.scale })
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [setZoom])

  useEffect(() => {
    if (tool !== 'wall') setDrawing(null)
  }, [tool])

  // ---- pointer handling ----
  const computeSnap = useCallback(
    (raw: Vec2, opts: { from?: Vec2; excludePoints?: Set<string>; excludeWalls?: Set<string> } = {}) =>
      snapPosition(plan, raw, { threshold, gridSize: snapGrid ? gridSize : null, free: ctrl, constrainAngle: shift, extraPoints: belowPoints, ...opts }),
    [plan, threshold, snapGrid, gridSize, shift, ctrl, belowPoints],
  )

  const hoveredWallForOpening = useMemo(() => {
    if (!cursor || (tool !== 'door' && tool !== 'window')) return null
    let best: { wall: Wall; t: number; d: number } | null = null
    for (const w of Object.values(plan.walls)) {
      const pr = projectOnSegment(cursor, plan.points[w.a], plan.points[w.b])
      if (pr.distance < w.thickness / 2 + threshold * 2 && (!best || pr.distance < best.d)) best = { wall: w, t: pr.t, d: pr.distance }
    }
    if (!best) return null
    const width = tool === 'door' ? 0.9 : 1.2
    const len = wallLength(plan, best.wall)
    if (len < width) return null
    const offset = Math.min(Math.max(0, best.t * len - width / 2), len - width)
    return { wallId: best.wall.id, offset, width }
  }, [cursor, tool, plan, threshold])

  const catalogItem = useEditor((s) => s.catalogItem)
  useEditor((s) => s.customModels.length)
  const placingItem = placing ? catalogItem(placing) ?? null : null
  const placementGhost = useMemo(() => {
    if (!cursor || tool !== 'furniture' || !placingItem) return null
    let pos = cursor
    if (snapGrid && !ctrl) pos = { x: Math.round(pos.x / gridSize) * gridSize, y: Math.round(pos.y / gridSize) * gridSize }
    const snap = ctrl ? null : snapFurnitureToWall(plan, placingItem, pos, placeAngle, Math.max(0.3, threshold * 3))
    return snap ? { x: snap.x, y: snap.y, angle: snap.angle, wallId: snap.wallId } : { x: pos.x, y: pos.y, angle: placeAngle, wallId: null }
  }, [cursor, tool, placingItem, placeAngle, plan, snapGrid, gridSize, ctrl, threshold])

  const onPointerDown = (e: React.PointerEvent) => {
    if (editing) setEditing(null)
    const target = e.target as Element
    const svg = svgRef.current!
    svg.setPointerCapture(e.pointerId)
    const screen = { x: e.clientX, y: e.clientY }
    if (e.pointerType === 'touch') {
      touchesRef.current.set(e.pointerId, screen)
      const touches = [...touchesRef.current.values()]
      if (touches.length >= 2) {
        // a second finger turns whatever was going on into a pinch
        const [a, b] = touches
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        const rect = svg.getBoundingClientRect()
        dragRef.current = { kind: 'pinch', startVp: vp, startDist: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), startMid: mid, startWorld: screenToWorld(vp, { x: mid.x - rect.left, y: mid.y - rect.top }, size.width, size.height) }
        setMarquee(null)
        return
      }
      if (tool === 'select' || tool === 'pan') {
        const hit = target.closest('[data-kind]')
        const item = hit ? ({ kind: hit.getAttribute('data-kind'), id: hit.getAttribute('data-id') } as SelectionItem) : null
        dragRef.current = { kind: 'touch', startScreen: screen, startVp: vp, moved: false, target: item }
        return
      }
    }
    if (e.button === 1 || tool === 'pan' || space) {
      dragRef.current = { kind: 'pan', startScreen: screen, startVp: vp }
      return
    }
    if (e.button !== 0) return
    const world = toWorld(e)
    const st = useEditor.getState()
    if (tool === 'comment') {
      if (readOnly) return
      e.preventDefault() // no mousedown afterwards, so the composer keeps the focus it takes
      st.setOpenComment(null)
      setComposer(world)
      return
    }
    if (composer) setComposer(null)
    if (st.openComment && !target.closest('[data-kind="comment"]')) st.setOpenComment(null)
    if (calibrating && underlay) {
      e.preventDefault()
      if (!calibrating.a) {
        st.setCalibrating({ a: world })
        return
      }
      const measured = dist(calibrating.a, world)
      st.setCalibrating(null)
      if (measured < 1e-6) return
      const raw = prompt('Real distance between the two points', formatLength(measured, units))
      const real = raw ? parseLength(raw, units) : null
      if (!real || real <= 0) return
      // scale the image about the first point so it stays put
      const k = real / measured
      const a = calibrating.a
      st.setUnderlay({ scale: underlay.scale * k, x: a.x + (underlay.x - a.x) * k, y: a.y + (underlay.y - a.y) * k })
      return
    }
    if (tool === 'select' && underlay && !underlay.locked && !readOnly && target.closest('[data-kind="underlay"]')) {
      dragRef.current = { kind: 'underlay', start: { x: underlay.x, y: underlay.y }, startCursor: world, moved: false }
      return
    }
    if (tool === 'wall') {
      const s = computeSnap(world, { from: drawing?.pos })
      if (!drawing) {
        setDrawing({ pos: s.pos, pointId: s.pointId, wall: s.wall, startPointId: s.pointId })
        return
      }
      const wallId = st.addWall({ pos: drawing.pos, pointId: drawing.pointId, wall: drawing.wall }, { pos: s.pos, pointId: s.pointId, wall: s.wall })
      if (!wallId) {
        finishDrawing()
        return
      }
      const created = useEditor.getState().plan.walls[wallId]
      const endId = created.b
      // close the loop or land on an existing point: stop drawing
      if (s.pointId && (s.pointId === drawing.startPointId || wallsAtPoint(useEditor.getState().plan, s.pointId).length > 1)) {
        finishDrawing()
      } else {
        setDrawing({ pos: s.pos, pointId: endId, startPointId: drawing.startPointId ?? created.a })
      }
      return
    }
    if (tool === 'furniture') {
      if (placementGhost && placing) {
        const id = st.addFurniture(placing, { x: placementGhost.x, y: placementGhost.y }, placementGhost.angle)
        if (id && placementGhost.wallId && autoHV) st.addConstraint({ type: 'furnitureWallGap', furnitureId: id, wallId: placementGhost.wallId, side: 'back', value: 0 })
        st.setPlacing(null)
        st.setTool('select')
        if (id) st.select([{ kind: 'furniture', id }])
      }
      return
    }
    if (tool === 'door' || tool === 'window') {
      if (hoveredWallForOpening) {
        const id = st.addOpening(hoveredWallForOpening.wallId, hoveredWallForOpening.offset, tool)
        st.setTool('select')
        st.select([{ kind: 'opening', id }])
      }
      return
    }
    // select tool: hit-test via data attributes
    const hit = target.closest<SVGElement>('[data-kind]')
    if (!hit) {
      dragRef.current = { kind: 'click-empty', startScreen: screen, startWorld: world }
      return
    }
    const kind = hit.dataset.kind as SelectionItem['kind']
    const id = hit.dataset.id!
    if (!isSelected(st.selection, kind, id) || e.shiftKey) st.select([{ kind, id }], e.shiftKey)
    st.beginDrag()
    if (kind === 'point') dragRef.current = { kind: 'point', id, moved: false, snap: null, start: { ...plan.points[id] } }
    else if (kind === 'wall') {
      const w = plan.walls[id]
      dragRef.current = { kind: 'wall', id, startA: { ...plan.points[w.a] }, startB: { ...plan.points[w.b] }, startCursor: world, moved: false }
    } else if (kind === 'opening') dragRef.current = { kind: 'opening', id, moved: false }
    else if (kind === 'furniture') {
      const f = plan.furniture[id]
      if (hit.dataset.handle === 'rotate') dragRef.current = { kind: 'rotate', id, moved: false }
      else dragRef.current = { kind: 'furniture', id, start: { x: f.x, y: f.y }, startAngle: f.angle, startCursor: world, moved: false, snappedWall: null }
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const world = toWorld(e)
    setCursor(world)
    setLiveCursor(world)
    const drag = dragRef.current
    const st = useEditor.getState()
    if (e.pointerType === 'touch' && touchesRef.current.has(e.pointerId)) touchesRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (drag?.kind === 'pinch') {
      const touches = [...touchesRef.current.values()]
      if (touches.length < 2) return
      const [a, b] = touches
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const k = Math.hypot(b.x - a.x, b.y - a.y) / drag.startDist
      const scale = Math.min(800, Math.max(4, drag.startVp.scale * k))
      const rect = svgRef.current!.getBoundingClientRect()
      // keep the world point that was under the fingers' midpoint under it
      const local = { x: mid.x - rect.left, y: mid.y - rect.top }
      setVp({ scale, cx: drag.startWorld.x - (local.x - size.width / 2) / scale, cy: drag.startWorld.y - (local.y - size.height / 2) / scale })
      return
    }
    if (drag?.kind === 'touch') {
      const dx = e.clientX - drag.startScreen.x
      const dy = e.clientY - drag.startScreen.y
      if (!drag.moved && Math.hypot(dx, dy) < 8) return
      drag.moved = true
      setVp({ ...drag.startVp, cx: drag.startVp.cx - dx / drag.startVp.scale, cy: drag.startVp.cy - dy / drag.startVp.scale })
      return
    }
    if (drag?.kind === 'underlay') {
      drag.moved = true
      st.setUnderlay({ x: drag.start.x + (world.x - drag.startCursor.x), y: drag.start.y + (world.y - drag.startCursor.y) })
      return
    }
    if (drag?.kind === 'pan') {
      const dx = (e.clientX - drag.startScreen.x) / drag.startVp.scale
      const dy = (e.clientY - drag.startScreen.y) / drag.startVp.scale
      setVp({ ...drag.startVp, cx: drag.startVp.cx - dx, cy: drag.startVp.cy - dy })
      return
    }
    if (drag?.kind === 'click-empty') {
      if (Math.hypot(e.clientX - drag.startScreen.x, e.clientY - drag.startScreen.y) > 3) setMarquee({ a: drag.startWorld, b: world })
      return
    }
    if (drag?.kind === 'point') {
      const attached = new Set(wallsAtPoint(plan, drag.id).map((w) => w.id))
      const s = computeSnap(world, { excludePoints: new Set([drag.id]), excludeWalls: attached, from: shift ? drag.start : undefined })
      drag.moved = true
      drag.snap = s
      setSnap(s)
      st.dragTo([{ pointId: drag.id, x: s.pos.x, y: s.pos.y }])
      return
    }
    if (drag?.kind === 'wall') {
      const w = plan.walls[drag.id]
      if (!w) return
      const delta = sub(world, drag.startCursor)
      const target = add(drag.startA, delta)
      const s = computeSnap(target, { excludePoints: new Set([w.a, w.b]), excludeWalls: new Set([w.id]) })
      const d2 = s.pointId || s.wall ? delta : sub(s.pos, drag.startA)
      drag.moved = true
      setSnap(s.pointId || s.wall ? null : s)
      st.dragTo([
        { pointId: w.a, x: drag.startA.x + d2.x, y: drag.startA.y + d2.y },
        { pointId: w.b, x: drag.startB.x + d2.x, y: drag.startB.y + d2.y },
      ])
      return
    }
    if (drag?.kind === 'furniture') {
      const f = plan.furniture[drag.id]
      if (!f) return
      const delta = sub(world, drag.startCursor)
      let pos = add(drag.start, delta)
      if (snapGrid && !ctrl) pos = { x: Math.round(pos.x / gridSize) * gridSize, y: Math.round(pos.y / gridSize) * gridSize }
      const wallSnap = ctrl ? null : snapFurnitureToWall(plan, f, pos, f.angle, Math.max(0.25, threshold * 2.5))
      drag.moved = true
      drag.snappedWall = wallSnap?.wallId ?? null
      st.dragFurniture([wallSnap ? { furnitureId: f.id, x: wallSnap.x, y: wallSnap.y, angle: wallSnap.angle } : { furnitureId: f.id, x: pos.x, y: pos.y }])
      return
    }
    if (drag?.kind === 'rotate') {
      const f = plan.furniture[drag.id]
      if (!f) return
      const d = sub(world, { x: f.x, y: f.y })
      // the handle sits on the back of the piece: back normal is (sin a, -cos a)
      let angle = Math.atan2(d.x, -d.y)
      if (!ctrl) {
        const step = Math.PI / 12
        angle = Math.round(angle / step) * step
      }
      drag.moved = true
      st.dragFurniture([{ furnitureId: f.id, angle }])
      return
    }
    if (drag?.kind === 'opening') {
      const o = plan.openings[drag.id]
      if (!o) return
      const w = plan.walls[o.wallId]
      const pr = projectOnSegment(world, plan.points[w.a], plan.points[w.b])
      const len = wallLength(plan, w)
      let offset = pr.t * len - o.width / 2
      if (snapGrid && !shift) offset = Math.round(offset / gridSize) * gridSize
      drag.moved = true
      st.dragOpening(drag.id, offset)
      return
    }
    if (tool === 'wall') {
      setSnap(computeSnap(world, { from: drawing?.pos }))
    } else if (snap) setSnap(null)
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const drag = dragRef.current
    const st = useEditor.getState()
    if (e.pointerType === 'touch') {
      touchesRef.current.delete(e.pointerId)
      if (drag?.kind === 'pinch') {
        // lifting one finger ends the pinch; the other finger starts a fresh pan
        const rest = [...touchesRef.current.entries()]
        dragRef.current = rest.length === 1 ? { kind: 'touch', startScreen: rest[0][1], startVp: vp, moved: true, target: null } : null
        return
      }
      if (drag?.kind === 'touch') {
        dragRef.current = null
        if (!drag.moved) {
          if (drag.target && tool === 'select') st.select([drag.target])
          else st.clearSelection()
        }
        return
      }
    }
    dragRef.current = null
    if (!drag) return
    if (drag.kind === 'click-empty') {
      const moved = Math.hypot(e.clientX - drag.startScreen.x, e.clientY - drag.startScreen.y) > 3
      if (!moved) {
        // a click on the floor selects the room it lands in; outside any room it clears the selection
        const room = rooms.find((r) => pointInPolygon(drag.startWorld, r.polygon))
        if (room) st.select([{ kind: 'room', id: room.id }], e.shiftKey)
        else if (!e.shiftKey) st.clearSelection()
      } else if (marquee) {
        const min = { x: Math.min(marquee.a.x, marquee.b.x), y: Math.min(marquee.a.y, marquee.b.y) }
        const max = { x: Math.max(marquee.a.x, marquee.b.x), y: Math.max(marquee.a.y, marquee.b.y) }
        const inside = (p: Vec2) => p.x >= min.x && p.x <= max.x && p.y >= min.y && p.y <= max.y
        const items: SelectionItem[] = []
        for (const w of Object.values(plan.walls)) if (inside(plan.points[w.a]) && inside(plan.points[w.b])) items.push({ kind: 'wall', id: w.id })
        for (const o of Object.values(plan.openings)) {
          const g = openingGeometry(plan, o)
          if (g && inside(g.start) && inside(g.end)) items.push({ kind: 'opening', id: o.id })
        }
        for (const f of Object.values(plan.furniture)) if (inside({ x: f.x, y: f.y })) items.push({ kind: 'furniture', id: f.id })
        for (const p of Object.values(plan.points)) {
          // corners only when none of their walls made it in, so a marquee around a room selects walls, not corners
          if (inside(p) && !wallsAtPoint(plan, p.id).some((w) => items.some((i) => i.kind === 'wall' && i.id === w.id))) items.push({ kind: 'point', id: p.id })
        }
        st.select(items, e.shiftKey)
      }
      setMarquee(null)
      return
    }
    if (drag.kind === 'point') {
      st.endDrag()
      if (drag.moved && drag.snap && !ctrl && (drag.snap.pointId || drag.snap.wall)) {
        st.mergePoint(drag.id, { pointId: drag.snap.pointId, wall: drag.snap.wall })
        st.clearSelection()
      }
      setSnap(null)
      return
    }
    if (drag.kind === 'wall' || drag.kind === 'opening' || drag.kind === 'rotate') {
      st.endDrag()
      setSnap(null)
      return
    }
    if (drag.kind === 'furniture') {
      st.endDrag()
      if (drag.moved && drag.snappedWall && autoHV) {
        const f = useEditor.getState().plan.furniture[drag.id]
        const already = Object.values(useEditor.getState().plan.constraints).some((c) => c.type === 'furnitureWallGap' && c.furnitureId === drag.id && c.side === 'back' && c.wallId === drag.snappedWall)
        if (f && !already) st.addConstraint({ type: 'furnitureWallGap', furnitureId: drag.id, wallId: drag.snappedWall, side: 'back', value: 0 })
      }
    }
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    if (tool === 'wall' && drawing) {
      finishDrawing()
      return
    }
    // double-click inside a room (on empty floor) names it
    if (tool !== 'select' || readOnly) return
    const target = e.target as Element
    if (target.closest('[data-kind]')) return
    const world = toWorld(e)
    const i = rooms.findIndex((r) => pointInPolygon(world, r.polygon))
    if (i < 0) return
    const name = prompt('Room name', roomName(plan, rooms[i], i))
    if (name !== null) useEditor.getState().nameRoom(rooms[i], name)
  }

  // ---- inline editing ----
  const startEditWall = (w: Wall, e: React.MouseEvent | React.PointerEvent) => {
    e.stopPropagation()
    const side = wallSide(w)
    const face = wallFace(plan, w, side)
    const pos = add(scale(add(face.a, face.b), 0.5), scale(sideNormal(plan, w, side), DIM_GAP))
    setEditing({ kind: 'wallLength', wallId: w.id, screen: toScreen(pos) })
  }
  /** opening dimensions sit on the face opposite the wall's own dimension (usually the room side) */
  const openingFace = (o: Opening) => {
    const w = plan.walls[o.wallId]
    const side = oppositeSide(wallSide(w))
    const face = wallFace(plan, w, side)
    const n = sideNormal(plan, w, side)
    const u = normalize(sub(plan.points[w.b], plan.points[w.a]))
    const onFace = (s: number) => add(add(plan.points[w.a], scale(u, s)), scale(n, w.thickness / 2))
    const len = wallLength(plan, w)
    return { w, side, face, n, start: onFace(o.offset), end: onFace(o.offset + o.width), fromA: o.offset - face.insetA, fromB: len - o.offset - o.width - face.insetB }
  }
  const startEditOpening = (o: Opening, end: 'a' | 'b', e: React.MouseEvent | React.PointerEvent) => {
    e.stopPropagation()
    const f = openingFace(o)
    const p = end === 'a' ? scale(add(f.face.a, f.start), 0.5) : scale(add(f.end, f.face.b), 0.5)
    setEditing({ kind: 'openingOffset', openingId: o.id, end, screen: toScreen(add(p, scale(f.n, DIM_GAP))) })
  }

  const commitEdit = (raw: string, lock: boolean) => {
    if (!editing) return
    const value = parseLength(raw, units)
    const st = useEditor.getState()
    if (value !== null && value > 0) {
      if (editing.kind === 'wallLength') st.setWallLength(editing.wallId, value, lock, wallSide(plan.walls[editing.wallId]))
      else {
        const o = plan.openings[editing.openingId]
        const f = openingFace(o)
        if (lock) st.addConstraint({ type: editing.end === 'a' ? 'openingOffsetA' : 'openingOffsetB', openingId: o.id, value, side: f.side })
        else {
          const len = wallLength(plan, f.w)
          st.updateOpening(o.id, { offset: editing.end === 'a' ? value + f.face.insetA : len - o.width - value - f.face.insetB })
        }
      }
    }
    setEditing(null)
  }

  // ---- derived render data ----
  const violated = report.violated
  const lengthConstraintFor = (wallId: string) => Object.values(plan.constraints).find((c) => c.type === 'length' && c.wallId === wallId)
  const wallBadges = (wallId: string) => {
    const cs = constraintsReferencing(plan, { walls: [wallId] })
    const badges: { label: string; violated: boolean; id: string }[] = []
    for (const c of cs) {
      if (c.type === 'length' || c.type === 'furnitureWallGap' || c.type === 'furnitureFixed') continue
      const label = { horizontal: 'H', vertical: 'V', parallel: '∥', perpendicular: '⟂', equalLength: '=', angle: '∠' }[c.type as string] ?? '?'
      badges.push({ label, violated: violated.has(c.id), id: c.id })
    }
    return badges
  }

  const visibleMin = screenToWorld(vp, { x: 0, y: 0 }, size.width, size.height)
  const visibleMax = screenToWorld(vp, { x: size.width, y: size.height }, size.width, size.height)
  const showMinorGrid = vp.scale > 35
  const units = useEditor((s) => s.units)
  const setZoomLevel = useEditor((s) => s.setZoomLevel)
  useEffect(() => setZoomLevel(vp.scale), [vp.scale, setZoomLevel])

  const cursorStyle = tool === 'pan' || space ? 'grab' : tool === 'wall' || tool === 'door' || tool === 'window' || (tool === 'furniture' && placing) ? 'crosshair' : 'default'

  const selectedOpenings = selection.filter((s) => s.kind === 'opening').map((s) => plan.openings[s.id]).filter(Boolean)
  const editingValue = (() => {
    if (!editing) return ''
    if (editing.kind === 'wallLength') {
      const w = plan.walls[editing.wallId]
      return formatLength(wallFace(plan, w, wallSide(w)).length, units, false)
    }
    const f = openingFace(plan.openings[editing.openingId])
    return formatLength(editing.end === 'a' ? f.fromA : f.fromB, units, false)
  })()

  return (
    <div ref={containerRef} className="editor2d" style={{ cursor: cursorStyle }}>
      <svg
        id="plan-svg"
        ref={svgRef}
        width={size.width}
        height={size.height}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => (setCursor(null), setLiveCursor(null))}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => {
          e.preventDefault()
          if (drawing) finishDrawing()
        }}
      >
        <defs>
          <pattern id="grid-minor" width={0.1} height={0.1} patternUnits="userSpaceOnUse">
            <path d="M 0.1 0 L 0 0 0 0.1" fill="none" stroke="#e6e6e6" strokeWidth={px} />
          </pattern>
          <pattern id="grid-major" width={1} height={1} patternUnits="userSpaceOnUse">
            {showMinorGrid && <rect width={1} height={1} fill="url(#grid-minor)" />}
            <path d="M 1 0 L 0 0 0 1" fill="none" stroke="#d0d0d0" strokeWidth={px} />
          </pattern>
        </defs>
        <g transform={`translate(${size.width / 2 - vp.cx * vp.scale} ${size.height / 2 - vp.cy * vp.scale}) scale(${vp.scale})`}>
          <rect data-export="skip" x={visibleMin.x} y={visibleMin.y} width={visibleMax.x - visibleMin.x} height={visibleMax.y - visibleMin.y} fill="url(#grid-major)" />
          {/* axes */}
          <line data-export="skip" x1={visibleMin.x} y1={0} x2={visibleMax.x} y2={0} stroke="#c4c4c4" strokeWidth={px * 1.5} />
          <line data-export="skip" x1={0} y1={visibleMin.y} x2={0} y2={visibleMax.y} stroke="#c4c4c4" strokeWidth={px * 1.5} />

          {underlay && <UnderlayImage underlay={underlay} interactive={tool === 'select' && !underlay.locked && !readOnly} />}
          {/* ghost of the floor below */}
          {showFloorBelow && below && (
            <g data-export="skip" style={{ pointerEvents: 'none' }} opacity={0.18}>
              {Object.values(below.walls).map((w) => (
                <polygon key={w.id} points={wallPolygon(below, w).map((p) => `${p.x},${p.y}`).join(' ')} fill="#1d3a8a" />
              ))}
            </g>
          )}

          {/* rooms */}
          {rooms.map((r) => (
            <polygon key={r.id} points={r.polygon.map((p) => `${p.x},${p.y}`).join(' ')} fill={FINISH_BY_KEY[roomLabel(plan, r)?.floor ?? '']?.planColor ?? '#f6f1e7'} fillOpacity={underlay ? 0.35 : 1} style={{ pointerEvents: 'none' }} />
          ))}
          {/* selected rooms (yours, or a collaborator's) */}
          {rooms.map((r) => {
            const mine = isSelected(selection, 'room', r.id)
            const peer = peerSelections.get(`room:${r.id}`)
            if (!mine && !peer) return null
            return (
              <polygon key={'sel' + r.id} data-export="skip" points={r.polygon.map((p) => `${p.x},${p.y}`).join(' ')} fill={mine ? 'rgba(47,111,237,0.14)' : 'none'} stroke={mine ? '#2f6fed' : peer} strokeWidth={2 * px} strokeDasharray={`${6 * px} ${4 * px}`} style={{ pointerEvents: 'none' }} />
            )
          })}

          {/* guides */}
          {snap?.guides.map((g, i) =>
            g.axis === 'x' ? (
              <line data-export="skip" key={i} x1={g.value} y1={visibleMin.y} x2={g.value} y2={visibleMax.y} stroke="#f0a020" strokeWidth={px} strokeDasharray={`${6 * px} ${4 * px}`} />
            ) : (
              <line data-export="skip" key={i} x1={visibleMin.x} y1={g.value} x2={visibleMax.x} y2={g.value} stroke="#f0a020" strokeWidth={px} strokeDasharray={`${6 * px} ${4 * px}`} />
            ),
          )}

          {/* walls */}
          {Object.values(plan.walls).map((w) => {
            const poly = wallPolygon(plan, w)
            const sel = isSelected(selection, 'wall', w.id)
            const hov = hover?.kind === 'wall' && hover.id === w.id && tool === 'select'
            const fill = sel ? '#2f6fed' : hov ? '#5a5a5a' : '#3b3b3b'
            const peer = peerSelections.get(`wall:${w.id}`)
            return (
              <polygon
                key={w.id}
                data-kind="wall"
                data-id={w.id}
                points={poly.map((p) => `${p.x},${p.y}`).join(' ')}
                fill={fill}
                stroke={peer ?? (sel ? '#1b4fc0' : '#222')}
                strokeWidth={peer ? 3 * px : px}
                strokeLinejoin="round"
                onPointerEnter={() => setHover({ kind: 'wall', id: w.id })}
                onPointerLeave={() => setHover(null)}
                style={{ cursor: tool === 'select' ? 'move' : undefined }}
              />
            )
          })}

          {/* openings */}
          {Object.values(plan.openings).map((o) => {
            const g = openingGeometry(plan, o)
            if (!g) return null
            const w = plan.walls[o.wallId]
            const sel = isSelected(selection, 'opening', o.id)
            const hov = hover?.kind === 'opening' && hover.id === o.id && tool === 'select'
            const stroke = sel ? '#2f6fed' : hov ? '#4a7ee8' : '#333'
            const hinge = o.hingeB ? g.end : g.start
            const tip = o.hingeB ? g.start : g.end
            const swing = scale(g.n, o.swingRight ? -1 : 1)
            const leafEnd = add(hinge, scale(swing, o.width))
            const sweep = (o.hingeB ? 1 : 0) ^ (o.swingRight ? 1 : 0)
            return (
              <g
                key={o.id}
                data-kind="opening"
                data-id={o.id}
                onPointerEnter={() => setHover({ kind: 'opening', id: o.id })}
                onPointerLeave={() => setHover(null)}
                style={{ cursor: tool === 'select' ? 'ew-resize' : undefined }}
              >
                <polygon points={g.corners.map((p) => `${p.x},${p.y}`).join(' ')} fill={o.kind === 'window' ? '#dbeeff' : '#fff'} stroke={stroke} strokeWidth={px} />
                {o.kind === 'window' ? (
                  <>
                    <line x1={g.start.x} y1={g.start.y} x2={g.end.x} y2={g.end.y} stroke={stroke} strokeWidth={px * 1.5} />
                    <line
                      x1={g.start.x + g.n.x * w.thickness * 0.2}
                      y1={g.start.y + g.n.y * w.thickness * 0.2}
                      x2={g.end.x + g.n.x * w.thickness * 0.2}
                      y2={g.end.y + g.n.y * w.thickness * 0.2}
                      stroke={stroke}
                      strokeWidth={px}
                    />
                    <line
                      x1={g.start.x - g.n.x * w.thickness * 0.2}
                      y1={g.start.y - g.n.y * w.thickness * 0.2}
                      x2={g.end.x - g.n.x * w.thickness * 0.2}
                      y2={g.end.y - g.n.y * w.thickness * 0.2}
                      stroke={stroke}
                      strokeWidth={px}
                    />
                  </>
                ) : (
                  <>
                    <line x1={hinge.x} y1={hinge.y} x2={leafEnd.x} y2={leafEnd.y} stroke={stroke} strokeWidth={px * 2} />
                    <path d={`M ${leafEnd.x} ${leafEnd.y} A ${o.width} ${o.width} 0 0 ${sweep} ${tip.x} ${tip.y}`} fill="none" stroke={stroke} strokeWidth={px} strokeDasharray={`${3 * px} ${3 * px}`} />
                  </>
                )}
              </g>
            )
          })}

          {/* furniture */}
          {Object.values(plan.furniture).map((f) => (
            <FurnitureShape key={f.id} piece={f} selected={isSelected(selection, 'furniture', f.id)} hovered={hover?.kind === 'furniture' && hover.id === f.id && tool === 'select'} px={px} interactive={tool === 'select'} onHover={(h) => setHover(h ? { kind: 'furniture', id: f.id } : null)} peerColor={peerSelections.get(`furniture:${f.id}`)} />
          ))}
          {tool === 'select' && selection.filter((s) => s.kind === 'furniture' && plan.furniture[s.id]).map((s) => <FurnitureHandles key={s.id} piece={plan.furniture[s.id]} px={px} />)}
          {placementGhost && placingItem && (
            <g style={{ pointerEvents: 'none' }} opacity={0.75}>
              <FurnitureShape piece={{ id: 'ghost', catalogKey: placingItem.key, name: placingItem.name, x: placementGhost.x, y: placementGhost.y, angle: placementGhost.angle, width: placingItem.width, depth: placingItem.depth, height: placingItem.height, elevation: placingItem.elevation }} selected hovered={false} px={px} interactive={false} onHover={() => {}} />
            </g>
          )}

          {/* opening placement preview */}
          {hoveredWallForOpening &&
            (() => {
              const w = plan.walls[hoveredWallForOpening.wallId]
              const ghost: Opening = { id: 'ghost', kind: tool === 'door' ? 'door' : 'window', wallId: w.id, offset: hoveredWallForOpening.offset, width: hoveredWallForOpening.width, height: 2, sill: 0, hingeB: false, swingRight: false }
              const g = openingGeometry(plan, ghost)!
              return <polygon points={g.corners.map((p) => `${p.x},${p.y}`).join(' ')} fill="rgba(47,111,237,0.35)" stroke="#2f6fed" strokeWidth={px} style={{ pointerEvents: 'none' }} />
            })()}

          {/* wall dimensions */}
          {Object.values(plan.walls).map((w) => {
            const a = plan.points[w.a]
            const b = plan.points[w.b]
            const lc = lengthConstraintFor(w.id)
            const side = wallSide(w)
            const n = sideNormal(plan, w, side)
            const face = wallFace(plan, w, side)
            if (face.length < 0.01) return null
            const badges = wallBadges(w.id)
            const mid = scale(add(face.a, face.b), 0.5)
            const badgePos = add(mid, scale(n, DIM_GAP + 14 * px))
            const u = normalize(sub(b, a))
            return (
              <g key={w.id}>
                <Dimension
                  p1={face.a}
                  p2={face.b}
                  side={n}
                  distance={DIM_GAP}
                  text={formatLength(face.length, units)}
                  px={px}
                  locked={!!lc}
                  violated={!!lc && violated.has(lc.id)}
                  onClick={tool === 'select' ? (e) => startEditWall(w, e) : undefined}
                />
                {badges.map((bd, i) => {
                  const p = add(badgePos, scale(u, (i - (badges.length - 1) / 2) * 16 * px))
                  return (
                    <g key={bd.id} transform={`translate(${p.x} ${p.y})`} style={{ pointerEvents: 'none' }}>
                      <circle r={7 * px} fill={bd.violated ? '#d7263d' : '#1d6fe0'} />
                      <text fontSize={9 * px} textAnchor="middle" dominantBaseline="central" fill="white" fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight={600}>
                        {bd.label}
                      </text>
                    </g>
                  )
                })}
              </g>
            )
          })}

          {/* opening dimensions for selected openings */}
          {selectedOpenings.map((o) => {
            if (!plan.walls[o.wallId]) return null
            const f = openingFace(o)
            const cs = constraintsReferencing(plan, { openings: [o.id] })
            const ca = cs.find((c) => c.type === 'openingOffsetA')
            const cb = cs.find((c) => c.type === 'openingOffsetB')
            const cc = cs.find((c) => c.type === 'openingCentered')
            return (
              <g key={o.id}>
                {f.fromA > 0.01 && (
                  <Dimension p1={f.face.a} p2={f.start} side={f.n} distance={DIM_GAP} text={formatLength(f.fromA, units)} px={px} locked={!!ca || !!cc} violated={(ca && violated.has(ca.id)) || (cc && violated.has(cc.id))} onClick={tool === 'select' ? (e) => startEditOpening(o, 'a', e) : undefined} />
                )}
                <Dimension p1={f.start} p2={f.end} side={f.n} distance={DIM_GAP} text={formatLength(o.width, units)} px={px} muted />
                {f.fromB > 0.01 && (
                  <Dimension p1={f.end} p2={f.face.b} side={f.n} distance={DIM_GAP} text={formatLength(f.fromB, units)} px={px} locked={!!cb || !!cc} violated={(cb && violated.has(cb.id)) || (cc && violated.has(cc.id))} onClick={tool === 'select' ? (e) => startEditOpening(o, 'b', e) : undefined} />
                )}
              </g>
            )
          })}

          {/* points */}
          <g data-export="skip">
          {Object.values(plan.points).map((p) => {
            const sel = isSelected(selection, 'point', p.id)
            const hov = hover?.kind === 'point' && hover.id === p.id && tool === 'select'
            const fixed = Object.values(plan.constraints).some((c) => c.type === 'fixed' && c.pointId === p.id)
            return (
              <g key={p.id} data-kind="point" data-id={p.id} onPointerEnter={() => setHover({ kind: 'point', id: p.id })} onPointerLeave={() => setHover(null)} style={{ cursor: tool === 'select' ? 'grab' : undefined }}>
                <circle cx={p.x} cy={p.y} r={(sel || hov ? 7 : 4.5) * px} fill={sel ? '#2f6fed' : hov ? '#7aa2f7' : 'white'} stroke={sel ? '#1b4fc0' : '#333'} strokeWidth={px * 1.2} />
                {fixed && <circle cx={p.x} cy={p.y} r={2 * px} fill={sel ? 'white' : '#d7263d'} />}
              </g>
            )
          })}
          </g>

          {/* drawing preview */}
          {tool === 'wall' && drawing && snap && (
            <g style={{ pointerEvents: 'none' }}>
              <line x1={drawing.pos.x} y1={drawing.pos.y} x2={snap.pos.x} y2={snap.pos.y} stroke="#2f6fed" strokeWidth={plan.settings.wallThickness} strokeOpacity={0.5} strokeLinecap="butt" />
              <line x1={drawing.pos.x} y1={drawing.pos.y} x2={snap.pos.x} y2={snap.pos.y} stroke="#2f6fed" strokeWidth={px} />
              {(() => {
                const mid = scale(add(drawing.pos, snap.pos), 0.5)
                const len = dist(drawing.pos, snap.pos)
                return (
                  <g transform={`translate(${mid.x} ${mid.y - 14 * px})`}>
                    <rect x={-30 * px} y={-9 * px} width={60 * px} height={18 * px} rx={3 * px} fill="#2f6fed" />
                    <text fontSize={11 * px} textAnchor="middle" dominantBaseline="central" fill="white" fontFamily="ui-sans-serif, system-ui, sans-serif">
                      {formatLength(len, units)}
                    </text>
                  </g>
                )
              })()}
            </g>
          )}
          {tool === 'wall' && snap && (
            <circle cx={snap.pos.x} cy={snap.pos.y} r={(snap.pointId || snap.wall ? 7 : 5) * px} fill="none" stroke={snap.pointId ? '#e0891d' : snap.wall ? '#c03fc0' : '#2f6fed'} strokeWidth={px * 1.5} style={{ pointerEvents: 'none' }} />
          )}
          {marquee && (
            <rect
              data-export="skip"
              x={Math.min(marquee.a.x, marquee.b.x)}
              y={Math.min(marquee.a.y, marquee.b.y)}
              width={Math.abs(marquee.b.x - marquee.a.x)}
              height={Math.abs(marquee.b.y - marquee.a.y)}
              fill="rgba(47,111,237,0.12)"
              stroke="#2f6fed"
              strokeWidth={px}
              style={{ pointerEvents: 'none' }}
            />
          )}
          {snap && (snap.pointId || snap.wall) && dragRef.current?.kind === 'point' && (
            <circle data-export="skip" cx={snap.pos.x} cy={snap.pos.y} r={9 * px} fill="none" stroke="#e0891d" strokeWidth={px * 2} style={{ pointerEvents: 'none' }} />
          )}
          {/* comment pins */}
          <g data-export="skip">
          {Object.values(plan.comments ?? {})
            .filter((c) => showResolved || !c.resolved || c.id === openComment)
            .map((c) => (
              <CommentPin key={c.id} comment={c} px={px} open={openComment === c.id} interactive={tool === 'select' || tool === 'comment'} onOpen={() => (setComposer(null), setOpenComment(openComment === c.id ? null : c.id))} />
            ))}
          </g>
          {/* room names and areas, above the furniture */}
          {rooms.map((r, i) => (
            <g key={'label' + r.id} style={{ pointerEvents: 'none' }}>
              <text x={r.centroid.x} y={r.centroid.y - 8 * px} fontSize={12.5 * px} fontWeight={600} textAnchor="middle" dominantBaseline="central" fill="#5d5240" stroke="white" strokeWidth={3 * px} paintOrder="stroke" fontFamily="ui-sans-serif, system-ui, sans-serif">
                {roomName(plan, r, i)}
              </text>
              <text x={r.centroid.x} y={r.centroid.y + 8 * px} fontSize={11 * px} textAnchor="middle" dominantBaseline="central" fill="#7d7160" stroke="white" strokeWidth={3 * px} paintOrder="stroke" fontFamily="ui-sans-serif, system-ui, sans-serif">
                {formatArea(r.area, units)}
              </text>
            </g>
          ))}
          {/* measurement between walls, above everything on the plan */}
          {alt && tool === 'select' && selection.length === 1 && selection[0].kind === 'wall' && measureTarget && measureTarget !== selection[0].id && plan.walls[selection[0].id] && plan.walls[measureTarget] && (
            <g data-export="skip">
              <GapMeasure gap={wallGap(plan, plan.walls[selection[0].id], plan.walls[measureTarget])} px={px} units={units} />
            </g>
          )}
          {calibrating?.a && <circle data-export="skip" cx={calibrating.a.x} cy={calibrating.a.y} r={5 * px} fill="none" stroke="#e0245e" strokeWidth={2 * px} style={{ pointerEvents: 'none' }} />}
          <g data-export="skip">
            <PeerCursors px={px} />
          </g>
        </g>
      </svg>
      {north !== undefined && (
        <div className="north-arrow" title={`North is at ${Math.round(north)}° from the top of the plan`}>
          <Compass north={north} size={36} />
        </div>
      )}

      {editing && (
        <EditBox
          key={editing.kind + (editing.kind === 'wallLength' ? editing.wallId : editing.openingId + editing.end)}
          screen={editing.screen}
          initial={editingValue}
          units={units}
          onCommit={commitEdit}
          onCancel={() => setEditing(null)}
        />
      )}

      {composer && (
        <CommentComposer
          screen={toScreen(composer)}
          onCancel={() => setComposer(null)}
          onSubmit={(text) => {
            const id = useEditor.getState().addComment(composer, text)
            setComposer(null)
            if (id) useEditor.getState().setOpenComment(id)
            useEditor.getState().setTool('select')
          }}
        />
      )}
      {openComment && plan.comments?.[openComment] && <CommentThread comment={plan.comments[openComment]} screen={toScreen({ x: plan.comments[openComment].x, y: plan.comments[openComment].y })} onClose={() => setOpenComment(null)} />}

      <div className="editor-hint">
        {calibrating && (calibrating.a ? 'Click the second point on the underlay.' : 'Click the first of two points a known distance apart on the underlay.')}
        {!calibrating && tool === 'comment' && 'Click on the plan to pin a comment. Click a pin to read and reply.'}
        {tool === 'wall' && !drawing && 'Click to start a wall. Shift constrains to 45°, Ctrl/⌘ disables snapping.'}
        {tool === 'wall' && drawing && 'Click to place the next corner · Enter, Esc or right-click to finish'}
        {(tool === 'door' || tool === 'window') && `Click on a wall to place a ${tool}.`}
        {tool === 'furniture' && !placing && 'Pick a piece of furniture in the panel on the left.'}
        {tool === 'furniture' && placing && 'Click to place · R rotates · drops against walls lock the piece to the wall · Ctrl/⌘ disables snapping'}
        {tool === 'select' && 'Drag corners, walls or openings, click a room to select it, or drag on empty space to marquee-select. Click a measurement to type a value. Press ? for shortcuts.'}
        {tool === 'pan' && 'Drag to pan · scroll to pan · Ctrl/⌘ + scroll to zoom'}
      </div>
      {showShortcuts && <ShortcutsPanel onClose={() => useEditor.getState().toggleShortcuts(false)} />}
      {cursor && (
        <div className="editor-coords">
          {cursor.x.toFixed(2)}, {cursor.y.toFixed(2)} m
        </div>
      )}
    </div>
  )
}

function EditBox({ screen, initial, units, onCommit, onCancel }: { screen: Vec2; initial: string; units: Units; onCommit: (raw: string, lock: boolean) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial)
  const [lock, setLock] = useState(true)
  return (
    <div className="edit-box" style={{ left: screen.x, top: screen.y }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="edit-row">
        <input
          autoFocus
          value={value}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommit(value, e.shiftKey ? !lock : lock)
            if (e.key === 'Escape') {
              e.preventDefault() // consumed here, so the browser does not leave fullscreen
              onCancel()
            }
          }}
        />
        <span className="edit-unit">{units}</span>
      </div>
      <label className="edit-lock">
        <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} /> Lock as constraint
      </label>
      <div className="edit-hint">Enter to apply · Esc to cancel</div>
    </div>
  )
}

const SHORTCUTS: [string, string][] = [
  ['V', 'Select / move'],
  ['W', 'Wall'],
  ['D', 'Door'],
  ['N', 'Window'],
  ['H', 'Hand (pan)'],
  ['Space + drag', 'Pan'],
  ['Scroll', 'Pan'],
  ['Ctrl / ⌘ + scroll, pinch', 'Zoom'],
  ['+ / −', 'Zoom in / out'],
  ['Shift + 0', 'Zoom to 100%'],
  ['Shift + 1', 'Zoom to fit'],
  ['⌥ + hover', 'Distance from the selected wall to another wall'],
  ['Esc / Enter / right-click', 'Finish drawing walls'],
  ['C', 'Comment: click on the plan to pin one'],
  ['Shift + 2', 'Zoom to selection'],
  ['Shift + click', 'Add to selection'],
  ['Drag on empty space', 'Marquee select'],
  ['Ctrl / ⌘ + A', 'Select all'],
  ['Arrows', 'Nudge 5 cm (Shift: 50 cm)'],
  ['Shift while drawing', 'Constrain to 45°'],
  ['Ctrl / ⌘ while drawing', 'Disable snapping'],
  ['Enter / Esc', 'Finish wall chain'],
  ['Esc', 'Deselect, back to Select'],
  ['Delete', 'Delete selection'],
  ['Ctrl / ⌘ + Z', 'Undo'],
  ['Ctrl / ⌘ + Shift + Z', 'Redo'],
  ['PageUp / PageDown', 'Floor above / below'],
  ['?', 'This panel'],
]

function ShortcutsPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="shortcuts" onPointerDown={(e) => e.stopPropagation()}>
      <div className="shortcuts-head">
        <strong>Keyboard shortcuts</strong>
        <button className="x" onClick={onClose} title="Close (Esc)">
          ×
        </button>
      </div>
      <div className="shortcuts-grid">
        {SHORTCUTS.map(([k, label]) => (
          <div key={k} className="shortcut">
            <kbd>{k}</kbd>
            <span>{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function FurnitureShape({ piece, selected, hovered, px, interactive, onHover, peerColor }: { piece: Furniture; selected: boolean; hovered: boolean; px: number; interactive: boolean; onHover: (h: boolean) => void; peerColor?: string }) {
  void interactive
  const deg = (piece.angle * 180) / Math.PI
  const side = Math.max(piece.width, piece.depth) * 1.02
  const stroke = peerColor ?? (selected ? '#2f6fed' : hovered ? '#4a7ee8' : '#6b6b6b')
  const wallMounted = piece.elevation > 0.9
  const kind = structureKind(piece.catalogKey)
  if (kind) {
    const w = piece.width
    const d = piece.depth
    return (
      <g data-kind="furniture" data-id={piece.id} onPointerEnter={() => onHover(true)} onPointerLeave={() => onHover(false)} style={{ cursor: interactive ? 'move' : undefined }}>
        <g transform={`translate(${piece.x} ${piece.y}) rotate(${deg})`}>
          {kind === 'stairs' && (
            <>
              <rect x={-w / 2} y={-d / 2} width={w} height={d} fill="white" stroke={stroke} strokeWidth={px * (selected || peerColor ? 2 : 1)} />
              {Array.from({ length: stairSteps(piece.height) - 1 }, (_, i) => {
                const y = d / 2 - ((i + 1) * d) / stairSteps(piece.height)
                return <line key={i} x1={-w / 2} y1={y} x2={w / 2} y2={y} stroke="#8a8a8a" strokeWidth={px} />
              })}
              <line x1={0} y1={d / 2 - 0.15} x2={0} y2={-d / 2 + 0.25} stroke="#2f6fed" strokeWidth={px * 1.5} />
              <path d={`M${-0.12} ${-d / 2 + 0.4} L0 ${-d / 2 + 0.2} L0.12 ${-d / 2 + 0.4}`} fill="none" stroke="#2f6fed" strokeWidth={px * 1.5} />
              <text y={d / 2 - 0.1} fontSize={9 * px} textAnchor="middle" fill="#2f6fed" fontFamily="ui-sans-serif, system-ui, sans-serif" style={{ pointerEvents: 'none' }}>
                up
              </text>
            </>
          )}
          {kind === 'void' && (
            <>
              <rect x={-w / 2} y={-d / 2} width={w} height={d} fill="rgba(120,120,120,0.08)" stroke={stroke} strokeWidth={px * (selected || peerColor ? 2 : 1)} strokeDasharray={`${5 * px} ${3 * px}`} />
              <line x1={-w / 2} y1={-d / 2} x2={w / 2} y2={d / 2} stroke="#b0b0b0" strokeWidth={px} />
              <line x1={-w / 2} y1={d / 2} x2={w / 2} y2={-d / 2} stroke="#b0b0b0" strokeWidth={px} />
              <text fontSize={9 * px} textAnchor="middle" dominantBaseline="central" fill="#8a8a8a" fontFamily="ui-sans-serif, system-ui, sans-serif" style={{ pointerEvents: 'none' }}>
                open to below
              </text>
            </>
          )}
          {kind === 'balcony' && (
            <>
              <rect x={-w / 2} y={-d / 2} width={w} height={d} fill="#e9e6e0" stroke={stroke} strokeWidth={px * (selected || peerColor ? 2 : 1)} />
              {/* railing on the front and the sides */}
              <path d={`M${-w / 2} ${-d / 2} V${d / 2} H${w / 2} V${-d / 2}`} fill="none" stroke="#444" strokeWidth={px * 3} />
              {Array.from({ length: Math.max(1, Math.round(w / 0.3)) }, (_, i) => -w / 2 + ((i + 0.5) * w) / Math.round(w / 0.3)).map((x, i) => (
                <line key={i} x1={x} y1={d / 2 - 0.08} x2={x} y2={d / 2} stroke="#444" strokeWidth={px} />
              ))}
            </>
          )}
        </g>
      </g>
    )
  }
  return (
    <g data-kind="furniture" data-id={piece.id} onPointerEnter={() => onHover(true)} onPointerLeave={() => onHover(false)} style={{ cursor: interactive ? 'move' : undefined }}>
      <g transform={`translate(${piece.x} ${piece.y}) rotate(${deg})`}>
        <rect x={-piece.width / 2} y={-piece.depth / 2} width={piece.width} height={piece.depth} fill={wallMounted ? 'rgba(255,255,255,0.35)' : 'white'} stroke={stroke} strokeWidth={px * (selected || peerColor ? 2 : 1)} strokeDasharray={wallMounted ? `${4 * px} ${3 * px}` : undefined} />
        {resolvePlanIconUrl(piece.catalogKey) ? (
          <image href={resolvePlanIconUrl(piece.catalogKey)!} x={-side / 2} y={-side / 2} width={side} height={side} preserveAspectRatio="none" opacity={wallMounted ? 0.6 : 1} style={{ pointerEvents: 'none' }} />
        ) : (
          <text fontSize={10 * px} textAnchor="middle" dominantBaseline="central" fill="#666" fontFamily="ui-sans-serif, system-ui, sans-serif" style={{ pointerEvents: 'none' }}>
            {piece.name}
          </text>
        )}
      </g>
    </g>
  )
}

/** rotation handle, drawn above every piece so it is never hidden by a neighbour */
function FurnitureHandles({ piece, px }: { piece: Furniture; px: number }) {
  const handle = localToPlan(piece, 0, -piece.depth / 2 - 22 * px)
  const back = localToPlan(piece, 0, -piece.depth / 2)
  return (
    <g data-kind="furniture" data-id={piece.id} data-handle="rotate" style={{ cursor: 'grab' }}>
      <line x1={back.x} y1={back.y} x2={handle.x} y2={handle.y} stroke="#2f6fed" strokeWidth={px} />
      <circle cx={handle.x} cy={handle.y} r={6 * px} fill="white" stroke="#2f6fed" strokeWidth={px * 1.5} />
    </g>
  )
}

/** Figma-style red measurement between the selected wall and the hovered one (Option/Alt held) */
function GapMeasure({ gap, px, units }: { gap: ReturnType<typeof wallGap>; px: number; units: Units }) {
  if (!gap) return null
  const color = '#e0245e'
  const u = normalize(sub(gap.to, gap.from))
  const n = perp(u)
  const tick = scale(n, 5 * px)
  const mid = scale(add(gap.from, gap.to), 0.5)
  const label = formatLength(gap.distance, units)
  const width = (label.length * 6.6 + 10) * px
  const height = 16 * px
  let angle = (Math.atan2(u.y, u.x) * 180) / Math.PI
  if (angle > 90 || angle <= -90) angle += 180
  // the label sits beside the line, not on it, so it does not hide short gaps
  const off = scale(n, 12 * px)
  return (
    <g style={{ pointerEvents: 'none' }}>
      {gap.extension && <line x1={gap.extension[0].x} y1={gap.extension[0].y} x2={gap.extension[1].x} y2={gap.extension[1].y} stroke={color} strokeWidth={px} strokeDasharray={`${4 * px} ${3 * px}`} />}
      <line x1={gap.from.x} y1={gap.from.y} x2={gap.to.x} y2={gap.to.y} stroke={color} strokeWidth={1.5 * px} />
      <line x1={gap.from.x - tick.x} y1={gap.from.y - tick.y} x2={gap.from.x + tick.x} y2={gap.from.y + tick.y} stroke={color} strokeWidth={px} />
      <line x1={gap.to.x - tick.x} y1={gap.to.y - tick.y} x2={gap.to.x + tick.x} y2={gap.to.y + tick.y} stroke={color} strokeWidth={px} />
      <g transform={`translate(${mid.x + off.x} ${mid.y + off.y}) rotate(${angle})`}>
        <rect x={-width / 2} y={-height / 2} width={width} height={height} rx={3 * px} fill={color} />
        <text fontSize={11 * px} textAnchor="middle" dominantBaseline="central" fill="white" fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight={600}>
          {label}
        </text>
      </g>
    </g>
  )
}

/** the floor's underlay image, resolved from the local file store or the account */
function UnderlayImage({ underlay, interactive }: { underlay: Underlay; interactive: boolean }) {
  const projectId = useEditor((s) => s.project.id)
  const viewToken = useEditor((s) => s.viewLink?.token ?? null)
  const [url, setUrl] = useState<string | null>(() => fileUrl(underlay.key))
  useEffect(() => {
    let live = true
    setUrl(fileUrl(underlay.key))
    void ensureFileUrl(projectId, underlay.key, viewToken).then((u) => live && setUrl(u))
    const off = onFileUrls(() => live && setUrl(fileUrl(underlay.key)))
    return () => {
      live = false
      off()
    }
  }, [underlay.key, projectId, viewToken])
  const w = underlay.width * underlay.scale
  const h = underlay.height * underlay.scale
  return (
    <g data-kind="underlay" transform={`translate(${underlay.x} ${underlay.y}) rotate(${underlay.rotation})`} style={{ cursor: interactive ? 'move' : undefined, pointerEvents: interactive ? 'auto' : 'none' }}>
      {url ? <image href={url} x={0} y={0} width={w} height={h} opacity={underlay.opacity} preserveAspectRatio="none" /> : <rect width={w} height={h} fill="#eee" stroke="#bbb" strokeDasharray="0.1 0.1" />}
      {interactive && <rect width={w} height={h} fill="none" stroke="#e0245e" strokeDasharray="0.08 0.08" strokeWidth={0.02} />}
    </g>
  )
}
