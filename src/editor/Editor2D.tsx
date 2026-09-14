import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Opening, Plan, Vec2, Wall } from '../model/types'
import { add, dist, findRooms, normalize, perp, pointInPolygon, projectOnSegment, scale, sub, wallLength, wallPolygon, wallsAtPoint } from '../model/geometry'
import { isSelected, useEditor, type SelectionItem } from '../model/store'
import { constraintsReferencing } from '../model/constraints'
import { formatArea, formatLength, parseLength } from '../model/units'
import { snapPosition, type SnapResult } from './snapping'
import { screenToWorld, worldToScreen, type Viewport } from './viewport'
import { Dimension } from './Dimension'

type DragState =
  | { kind: 'pan'; startScreen: Vec2; startVp: Viewport }
  | { kind: 'point'; id: string; moved: boolean; snap: SnapResult | null }
  | { kind: 'wall'; id: string; startA: Vec2; startB: Vec2; startCursor: Vec2; moved: boolean }
  | { kind: 'opening'; id: string; moved: boolean }
  | { kind: 'click-empty'; startScreen: Vec2 }

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
  const [size, setSize] = useState({ width: 800, height: 600 })
  const [vp, setVp] = useState<Viewport>({ cx: 4.5, cy: 3.25, scale: 70 })
  const plan = useEditor((s) => s.plan)
  const report = useEditor((s) => s.report)
  const selection = useEditor((s) => s.selection)
  const tool = useEditor((s) => s.tool)
  const snapGrid = useEditor((s) => s.snapGrid)
  const gridSize = useEditor((s) => s.gridSize)
  const rooms = useMemo(() => findRooms(plan), [plan])

  const [cursor, setCursor] = useState<Vec2 | null>(null)
  const [hover, setHover] = useState<SelectionItem | null>(null)
  const [snap, setSnap] = useState<SnapResult | null>(null)
  const [drawing, setDrawing] = useState<{ pos: Vec2; pointId?: string; wall?: { wallId: string; t: number }; startPointId?: string } | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [shift, setShift] = useState(false)
  const [space, setSpace] = useState(false)
  const dragRef = useRef<DragState | null>(null)

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

  const wallSide = useCallback(
    (w: Wall): Vec2 => {
      const a = plan.points[w.a]
      const b = plan.points[w.b]
      const u = normalize(sub(b, a))
      const n = perp(u)
      const mid = scale(add(a, b), 0.5)
      const probe = add(mid, scale(n, w.thickness / 2 + 0.3))
      const inside = rooms.some((r) => pointInPolygon(probe, r.polygon))
      return inside ? scale(n, -1) : n
    },
    [plan, rooms],
  )

  // ---- keyboard ----
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShift(true)
      if (e.key === ' ' && !(e.target instanceof HTMLInputElement)) {
        setSpace(true)
        e.preventDefault()
      }
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return
      const st = useEditor.getState()
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) st.redo()
        else st.undo()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        st.redo()
        return
      }
      if (e.key === 'Escape') {
        setDrawing(null)
        setEditing(null)
        st.clearSelection()
        return
      }
      if (e.key === 'Enter' && drawing) {
        setDrawing(null)
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        st.deleteSelection()
        return
      }
      const map: Record<string, typeof st.tool> = { v: 'select', s: 'select', w: 'wall', d: 'door', n: 'window', h: 'pan' }
      const t = map[e.key.toLowerCase()]
      if (t && !e.metaKey && !e.ctrlKey) {
        st.setTool(t)
        setDrawing(null)
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShift(false)
      if (e.key === ' ') setSpace(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [drawing])

  useEffect(() => {
    if (tool !== 'wall') setDrawing(null)
  }, [tool])

  // ---- pointer handling ----
  const computeSnap = useCallback(
    (raw: Vec2, opts: { from?: Vec2; excludePoints?: Set<string>; excludeWalls?: Set<string> } = {}) =>
      snapPosition(plan, raw, { threshold, gridSize: snapGrid ? gridSize : null, free: shift, ...opts }),
    [plan, threshold, snapGrid, gridSize, shift],
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

  const onPointerDown = (e: React.PointerEvent) => {
    if (editing) setEditing(null)
    const target = e.target as Element
    const svg = svgRef.current!
    svg.setPointerCapture(e.pointerId)
    const screen = { x: e.clientX, y: e.clientY }
    if (e.button === 1 || tool === 'pan' || space) {
      dragRef.current = { kind: 'pan', startScreen: screen, startVp: vp }
      return
    }
    if (e.button !== 0) return
    const world = toWorld(e)
    const st = useEditor.getState()
    if (tool === 'wall') {
      const s = computeSnap(world, { from: drawing?.pos })
      if (!drawing) {
        setDrawing({ pos: s.pos, pointId: s.pointId, wall: s.wall, startPointId: s.pointId })
        return
      }
      const wallId = st.addWall({ pos: drawing.pos, pointId: drawing.pointId, wall: drawing.wall }, { pos: s.pos, pointId: s.pointId, wall: s.wall })
      if (!wallId) {
        setDrawing(null)
        return
      }
      const created = useEditor.getState().plan.walls[wallId]
      const endId = created.b
      // close the loop or land on an existing point: stop drawing
      if (s.pointId && (s.pointId === drawing.startPointId || wallsAtPoint(useEditor.getState().plan, s.pointId).length > 1)) {
        setDrawing(null)
      } else {
        setDrawing({ pos: s.pos, pointId: endId, startPointId: drawing.startPointId ?? created.a })
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
      dragRef.current = { kind: 'click-empty', startScreen: screen }
      return
    }
    const kind = hit.dataset.kind as SelectionItem['kind']
    const id = hit.dataset.id!
    if (!isSelected(st.selection, kind, id) || e.shiftKey) st.select([{ kind, id }], e.shiftKey)
    st.beginDrag()
    if (kind === 'point') dragRef.current = { kind: 'point', id, moved: false, snap: null }
    else if (kind === 'wall') {
      const w = plan.walls[id]
      dragRef.current = { kind: 'wall', id, startA: { ...plan.points[w.a] }, startB: { ...plan.points[w.b] }, startCursor: world, moved: false }
    } else if (kind === 'opening') dragRef.current = { kind: 'opening', id, moved: false }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const world = toWorld(e)
    setCursor(world)
    const drag = dragRef.current
    const st = useEditor.getState()
    if (drag?.kind === 'pan') {
      const dx = (e.clientX - drag.startScreen.x) / drag.startVp.scale
      const dy = (e.clientY - drag.startScreen.y) / drag.startVp.scale
      setVp({ ...drag.startVp, cx: drag.startVp.cx - dx, cy: drag.startVp.cy - dy })
      return
    }
    if (drag?.kind === 'point') {
      const attached = new Set(wallsAtPoint(plan, drag.id).map((w) => w.id))
      const s = computeSnap(world, { excludePoints: new Set([drag.id]), excludeWalls: attached })
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
    dragRef.current = null
    const st = useEditor.getState()
    if (!drag) return
    if (drag.kind === 'click-empty') {
      const moved = Math.hypot(e.clientX - drag.startScreen.x, e.clientY - drag.startScreen.y) > 3
      if (!moved && !e.shiftKey) st.clearSelection()
      return
    }
    if (drag.kind === 'point') {
      st.endDrag()
      if (drag.moved && drag.snap && !shift && (drag.snap.pointId || drag.snap.wall)) {
        st.mergePoint(drag.id, { pointId: drag.snap.pointId, wall: drag.snap.wall })
        st.clearSelection()
      }
      setSnap(null)
      return
    }
    if (drag.kind === 'wall' || drag.kind === 'opening') {
      st.endDrag()
      setSnap(null)
    }
  }

  const onWheel = (e: React.WheelEvent) => {
    const rect = svgRef.current!.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    const before = screenToWorld(vp, { x: sx, y: sy }, size.width, size.height)
    const factor = Math.exp(-e.deltaY * 0.0015)
    const newScale = Math.min(600, Math.max(8, vp.scale * factor))
    // keep the world point under the cursor fixed
    const cx = before.x - (sx - size.width / 2) / newScale
    const cy = before.y - (sy - size.height / 2) / newScale
    setVp({ cx, cy, scale: newScale })
  }

  const onDoubleClick = () => {
    if (tool === 'wall') setDrawing(null)
  }

  // ---- inline editing ----
  const startEditWall = (w: Wall, e: React.MouseEvent | React.PointerEvent) => {
    e.stopPropagation()
    const a = plan.points[w.a]
    const b = plan.points[w.b]
    const mid = scale(add(a, b), 0.5)
    const side = wallSide(w)
    const pos = add(mid, scale(side, w.thickness / 2 + 0.35))
    setEditing({ kind: 'wallLength', wallId: w.id, screen: toScreen(pos) })
  }
  const startEditOpening = (o: Opening, end: 'a' | 'b', e: React.MouseEvent | React.PointerEvent) => {
    e.stopPropagation()
    const g = openingGeometry(plan, o)
    const w = plan.walls[o.wallId]
    if (!g) return
    const side = scale(wallSide(w), -1)
    const p = end === 'a' ? scale(add(plan.points[w.a], g.start), 0.5) : scale(add(g.end, plan.points[w.b]), 0.5)
    setEditing({ kind: 'openingOffset', openingId: o.id, end, screen: toScreen(add(p, scale(side, w.thickness / 2 + 0.35))) })
  }

  const commitEdit = (raw: string, lock: boolean) => {
    if (!editing) return
    const value = parseLength(raw, plan.settings.units)
    const st = useEditor.getState()
    if (value !== null && value > 0) {
      if (editing.kind === 'wallLength') st.setWallLength(editing.wallId, value, lock)
      else {
        const o = plan.openings[editing.openingId]
        const w = plan.walls[o.wallId]
        if (lock) st.addConstraint({ type: editing.end === 'a' ? 'openingOffsetA' : 'openingOffsetB', openingId: o.id, value })
        else {
          const len = wallLength(plan, w)
          st.updateOpening(o.id, { offset: editing.end === 'a' ? value : len - o.width - value })
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
      if (c.type === 'length') continue
      const label = { horizontal: 'H', vertical: 'V', parallel: '∥', perpendicular: '⟂', equalLength: '=', angle: '∠' }[c.type as string] ?? '?'
      badges.push({ label, violated: violated.has(c.id), id: c.id })
    }
    return badges
  }

  const visibleMin = screenToWorld(vp, { x: 0, y: 0 }, size.width, size.height)
  const visibleMax = screenToWorld(vp, { x: size.width, y: size.height }, size.width, size.height)
  const showMinorGrid = vp.scale > 35
  const units = plan.settings.units

  const cursorStyle = tool === 'pan' || space ? 'grab' : tool === 'wall' || tool === 'door' || tool === 'window' ? 'crosshair' : 'default'

  const selectedOpenings = selection.filter((s) => s.kind === 'opening').map((s) => plan.openings[s.id]).filter(Boolean)
  const editingValue = (() => {
    if (!editing) return ''
    if (editing.kind === 'wallLength') return formatLength(wallLength(plan, plan.walls[editing.wallId]), units, false)
    const o = plan.openings[editing.openingId]
    const w = plan.walls[o.wallId]
    const len = wallLength(plan, w)
    return formatLength(editing.end === 'a' ? o.offset : len - o.offset - o.width, units, false)
  })()

  return (
    <div ref={containerRef} className="editor2d" style={{ cursor: cursorStyle }}>
      <svg
        ref={svgRef}
        width={size.width}
        height={size.height}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setCursor(null)}
        onWheel={onWheel}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => {
          e.preventDefault()
          setDrawing(null)
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
          <rect x={visibleMin.x} y={visibleMin.y} width={visibleMax.x - visibleMin.x} height={visibleMax.y - visibleMin.y} fill="url(#grid-major)" />
          {/* axes */}
          <line x1={visibleMin.x} y1={0} x2={visibleMax.x} y2={0} stroke="#c4c4c4" strokeWidth={px * 1.5} />
          <line x1={0} y1={visibleMin.y} x2={0} y2={visibleMax.y} stroke="#c4c4c4" strokeWidth={px * 1.5} />

          {/* rooms */}
          {rooms.map((r) => (
            <g key={r.id} style={{ pointerEvents: 'none' }}>
              <polygon points={r.polygon.map((p) => `${p.x},${p.y}`).join(' ')} fill="#f6f1e7" />
              <text x={r.centroid.x} y={r.centroid.y} fontSize={12 * px} textAnchor="middle" dominantBaseline="central" fill="#8a7d66" fontFamily="ui-sans-serif, system-ui, sans-serif">
                {formatArea(r.area)}
              </text>
            </g>
          ))}

          {/* guides */}
          {snap?.guides.map((g, i) =>
            g.axis === 'x' ? (
              <line key={i} x1={g.value} y1={visibleMin.y} x2={g.value} y2={visibleMax.y} stroke="#f0a020" strokeWidth={px} strokeDasharray={`${6 * px} ${4 * px}`} />
            ) : (
              <line key={i} x1={visibleMin.x} y1={g.value} x2={visibleMax.x} y2={g.value} stroke="#f0a020" strokeWidth={px} strokeDasharray={`${6 * px} ${4 * px}`} />
            ),
          )}

          {/* walls */}
          {Object.values(plan.walls).map((w) => {
            const poly = wallPolygon(plan, w)
            const sel = isSelected(selection, 'wall', w.id)
            const hov = hover?.kind === 'wall' && hover.id === w.id && tool === 'select'
            const fill = sel ? '#2f6fed' : hov ? '#5a5a5a' : '#3b3b3b'
            return (
              <polygon
                key={w.id}
                data-kind="wall"
                data-id={w.id}
                points={poly.map((p) => `${p.x},${p.y}`).join(' ')}
                fill={fill}
                stroke={sel ? '#1b4fc0' : '#222'}
                strokeWidth={px}
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
            const len = dist(a, b)
            const lc = lengthConstraintFor(w.id)
            const side = wallSide(w)
            const badges = wallBadges(w.id)
            const mid = scale(add(a, b), 0.5)
            const badgePos = add(mid, scale(side, w.thickness / 2 + 0.35 + 14 * px))
            const u = normalize(sub(b, a))
            return (
              <g key={w.id}>
                <Dimension
                  p1={a}
                  p2={b}
                  side={side}
                  distance={w.thickness / 2 + 0.35}
                  text={formatLength(len, units)}
                  px={px}
                  locked={!!lc}
                  violated={!!lc && violated.has(lc.id)}
                  onClick={(e) => startEditWall(w, e)}
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
            const g = openingGeometry(plan, o)
            const w = plan.walls[o.wallId]
            if (!g) return null
            const a = plan.points[w.a]
            const b = plan.points[w.b]
            const len = dist(a, b)
            const side = scale(wallSide(w), -1)
            const d = w.thickness / 2 + 0.35
            const cs = constraintsReferencing(plan, { openings: [o.id] })
            const ca = cs.find((c) => c.type === 'openingOffsetA')
            const cb = cs.find((c) => c.type === 'openingOffsetB')
            const cc = cs.find((c) => c.type === 'openingCentered')
            return (
              <g key={o.id}>
                {o.offset > 0.01 && (
                  <Dimension p1={a} p2={g.start} side={side} distance={d} text={formatLength(o.offset, units)} px={px} locked={!!ca || !!cc} violated={(ca && violated.has(ca.id)) || (cc && violated.has(cc.id))} onClick={(e) => startEditOpening(o, 'a', e)} />
                )}
                <Dimension p1={g.start} p2={g.end} side={side} distance={d} text={formatLength(o.width, units)} px={px} muted />
                {len - o.offset - o.width > 0.01 && (
                  <Dimension p1={g.end} p2={b} side={side} distance={d} text={formatLength(len - o.offset - o.width, units)} px={px} locked={!!cb || !!cc} violated={(cb && violated.has(cb.id)) || (cc && violated.has(cc.id))} onClick={(e) => startEditOpening(o, 'b', e)} />
                )}
              </g>
            )
          })}

          {/* points */}
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
          {snap && (snap.pointId || snap.wall) && dragRef.current?.kind === 'point' && (
            <circle cx={snap.pos.x} cy={snap.pos.y} r={9 * px} fill="none" stroke="#e0891d" strokeWidth={px * 2} style={{ pointerEvents: 'none' }} />
          )}
        </g>
      </svg>

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

      <div className="editor-hint">
        {tool === 'wall' && !drawing && 'Click to start a wall. Snaps to points, walls, alignments and the grid. Hold Shift to draw freely.'}
        {tool === 'wall' && drawing && 'Click to place the next corner · Enter / Esc / right-click to finish · double-click to stop'}
        {(tool === 'door' || tool === 'window') && `Click on a wall to place a ${tool}.`}
        {tool === 'select' && 'Drag corners, walls or openings. Click a measurement to type a value (Enter locks it as a constraint). Drop a corner onto another to join them.'}
        {tool === 'pan' && 'Drag to pan · scroll to zoom'}
      </div>
      {cursor && (
        <div className="editor-coords">
          {cursor.x.toFixed(2)}, {cursor.y.toFixed(2)} m
        </div>
      )}
    </div>
  )
}

function EditBox({ screen, initial, units, onCommit, onCancel }: { screen: Vec2; initial: string; units: 'm' | 'cm'; onCommit: (raw: string, lock: boolean) => void; onCancel: () => void }) {
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
            if (e.key === 'Escape') onCancel()
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
