import { useEffect, useMemo, useState } from 'react'
import { useEditor } from '../model/store'
import type { Constraint, Opening, Wall } from '../model/types'
import { constraintsReferencing, describeConstraint, pointDistance, shortId } from '../model/constraints'
import { findRooms, wallLength } from '../model/geometry'
import { formatArea, formatLength, parseLength } from '../model/units'

function LengthField({ value, onChange, label, units }: { value: number; onChange: (v: number) => void; label: string; units: 'm' | 'cm' }) {
  const [text, setText] = useState(formatLength(value, units, false))
  useEffect(() => setText(formatLength(value, units, false)), [value, units])
  const commit = () => {
    const v = parseLength(text, units)
    if (v !== null && Math.abs(v - value) > 1e-6) onChange(v)
    else setText(formatLength(value, units, false))
  }
  return (
    <label className="field">
      <span>{label}</span>
      <span className="field-input">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
        />
        <em>{units}</em>
      </span>
    </label>
  )
}

function WallProps({ wall }: { wall: Wall }) {
  const plan = useEditor((s) => s.plan)
  const violated = useEditor((s) => s.report.violated)
  const updateWall = useEditor((s) => s.updateWall)
  const setWallLength = useEditor((s) => s.setWallLength)
  const addConstraint = useEditor((s) => s.addConstraint)
  const removeConstraint = useEditor((s) => s.removeConstraint)
  const units = plan.settings.units
  const len = wallLength(plan, wall)
  const cs = constraintsReferencing(plan, { walls: [wall.id] })
  const lengthC = cs.find((c) => c.type === 'length')
  const hasH = cs.some((c) => c.type === 'horizontal')
  const hasV = cs.some((c) => c.type === 'vertical')
  const toggle = (type: 'horizontal' | 'vertical', has: boolean) => {
    if (has) {
      const c = cs.find((c) => c.type === type)
      if (c) removeConstraint(c.id)
    } else addConstraint({ type, wallId: wall.id })
  }
  return (
    <div className="props">
      <h3>Wall {shortId(wall.id)}</h3>
      <div className="row">
        <LengthField label="Length" units={units} value={lengthC && lengthC.type === 'length' ? lengthC.value : len} onChange={(v) => setWallLength(wall.id, v, true)} />
        <button className={`lock ${lengthC ? 'on' : ''} ${lengthC && violated.has(lengthC.id) ? 'bad' : ''}`} title={lengthC ? 'Unlock length' : 'Lock length'} onClick={() => (lengthC ? removeConstraint(lengthC.id) : addConstraint({ type: 'length', wallId: wall.id, value: len }))}>
          {lengthC ? '🔒' : '🔓'}
        </button>
      </div>
      <p className="muted small">Typing a length locks it. Unlock with the padlock.</p>
      <LengthField label="Thickness" units={units} value={wall.thickness} onChange={(v) => updateWall(wall.id, { thickness: v })} />
      <LengthField label="Height" units={units} value={wall.height} onChange={(v) => updateWall(wall.id, { height: v })} />
      <div className="chips">
        <button className={hasH ? 'chip on' : 'chip'} onClick={() => toggle('horizontal', hasH)}>
          Horizontal
        </button>
        <button className={hasV ? 'chip on' : 'chip'} onClick={() => toggle('vertical', hasV)}>
          Vertical
        </button>
      </div>
    </div>
  )
}

function TwoWallsProps({ a, b }: { a: Wall; b: Wall }) {
  const addConstraint = useEditor((s) => s.addConstraint)
  const plan = useEditor((s) => s.plan)
  const removeConstraint = useEditor((s) => s.removeConstraint)
  const existing = Object.values(plan.constraints).filter(
    (c) => (c.type === 'parallel' || c.type === 'perpendicular' || c.type === 'equalLength' || c.type === 'angle') && ((c.wallA === a.id && c.wallB === b.id) || (c.wallA === b.id && c.wallB === a.id)),
  )
  const has = (t: Constraint['type']) => existing.find((c) => c.type === t)
  const toggle = (t: 'parallel' | 'perpendicular' | 'equalLength') => {
    const c = has(t)
    if (c) removeConstraint(c.id)
    else addConstraint({ type: t, wallA: a.id, wallB: b.id })
  }
  const [angle, setAngle] = useState('90')
  return (
    <div className="props">
      <h3>
        Walls {shortId(a.id)} + {shortId(b.id)}
      </h3>
      <div className="chips">
        <button className={has('parallel') ? 'chip on' : 'chip'} onClick={() => toggle('parallel')}>
          ∥ Parallel
        </button>
        <button className={has('perpendicular') ? 'chip on' : 'chip'} onClick={() => toggle('perpendicular')}>
          ⟂ Perpendicular
        </button>
        <button className={has('equalLength') ? 'chip on' : 'chip'} onClick={() => toggle('equalLength')}>
          = Equal length
        </button>
      </div>
      <div className="row">
        <label className="field">
          <span>Angle</span>
          <span className="field-input">
            <input value={angle} onChange={(e) => setAngle(e.target.value)} />
            <em>°</em>
          </span>
        </label>
        <button
          onClick={() => {
            const v = parseFloat(angle)
            if (Number.isFinite(v)) addConstraint({ type: 'angle', wallA: a.id, wallB: b.id, degrees: v })
          }}
        >
          Set
        </button>
      </div>
    </div>
  )
}

function PointProps({ id }: { id: string }) {
  const plan = useEditor((s) => s.plan)
  const addConstraint = useEditor((s) => s.addConstraint)
  const removeConstraint = useEditor((s) => s.removeConstraint)
  const p = plan.points[id]
  const fixed = Object.values(plan.constraints).find((c) => c.type === 'fixed' && c.pointId === id)
  return (
    <div className="props">
      <h3>Corner {shortId(id)}</h3>
      <p className="muted small">
        {p.x.toFixed(3)}, {p.y.toFixed(3)} m
      </p>
      <button className={fixed ? 'chip on' : 'chip'} onClick={() => (fixed ? removeConstraint(fixed.id) : addConstraint({ type: 'fixed', pointId: id, x: p.x, y: p.y }))}>
        {fixed ? '📌 Anchored — click to release' : '📌 Anchor in place'}
      </button>
      <p className="muted small">An anchored corner never moves when constraints are solved. Anchor one corner so the plan doesn't drift.</p>
    </div>
  )
}

function TwoPointsProps({ a, b }: { a: string; b: string }) {
  const plan = useEditor((s) => s.plan)
  const addConstraint = useEditor((s) => s.addConstraint)
  const units = plan.settings.units
  const d = pointDistance(plan, a, b)
  const existing = Object.values(plan.constraints).find((c) => c.type === 'distance' && ((c.pointA === a && c.pointB === b) || (c.pointA === b && c.pointB === a)))
  return (
    <div className="props">
      <h3>Two corners</h3>
      <div className="row">
        <LengthField label="Distance" units={units} value={existing && existing.type === 'distance' ? existing.value : d} onChange={(v) => addConstraint({ type: 'distance', pointA: a, pointB: b, value: v })} />
        <button className={`lock ${existing ? 'on' : ''}`} onClick={() => addConstraint({ type: 'distance', pointA: a, pointB: b, value: d })} title="Lock current distance">
          {existing ? '🔒' : '🔓'}
        </button>
      </div>
    </div>
  )
}

function OpeningProps({ opening }: { opening: Opening }) {
  const plan = useEditor((s) => s.plan)
  const violated = useEditor((s) => s.report.violated)
  const updateOpening = useEditor((s) => s.updateOpening)
  const addConstraint = useEditor((s) => s.addConstraint)
  const removeConstraint = useEditor((s) => s.removeConstraint)
  const units = plan.settings.units
  const wall = plan.walls[opening.wallId]
  const len = wallLength(plan, wall)
  const cs = constraintsReferencing(plan, { openings: [opening.id] })
  const ca = cs.find((c) => c.type === 'openingOffsetA')
  const cb = cs.find((c) => c.type === 'openingOffsetB')
  const cc = cs.find((c) => c.type === 'openingCentered')
  const fromB = len - opening.offset - opening.width
  return (
    <div className="props">
      <h3>
        {opening.kind === 'door' ? 'Door' : 'Window'} {shortId(opening.id)}
      </h3>
      <LengthField label="Width" units={units} value={opening.width} onChange={(v) => updateOpening(opening.id, { width: v })} />
      <LengthField label="Height" units={units} value={opening.height} onChange={(v) => updateOpening(opening.id, { height: v })} />
      {opening.kind === 'window' && <LengthField label="Sill height" units={units} value={opening.sill} onChange={(v) => updateOpening(opening.id, { sill: v })} />}
      <div className="row">
        <LengthField label="From start" units={units} value={ca && ca.type === 'openingOffsetA' ? ca.value : opening.offset} onChange={(v) => addConstraint({ type: 'openingOffsetA', openingId: opening.id, value: v })} />
        <button className={`lock ${ca ? 'on' : ''} ${ca && violated.has(ca.id) ? 'bad' : ''}`} onClick={() => (ca ? removeConstraint(ca.id) : addConstraint({ type: 'openingOffsetA', openingId: opening.id, value: opening.offset }))}>
          {ca ? '🔒' : '🔓'}
        </button>
      </div>
      <div className="row">
        <LengthField label="From end" units={units} value={cb && cb.type === 'openingOffsetB' ? cb.value : fromB} onChange={(v) => addConstraint({ type: 'openingOffsetB', openingId: opening.id, value: v })} />
        <button className={`lock ${cb ? 'on' : ''} ${cb && violated.has(cb.id) ? 'bad' : ''}`} onClick={() => (cb ? removeConstraint(cb.id) : addConstraint({ type: 'openingOffsetB', openingId: opening.id, value: fromB }))}>
          {cb ? '🔒' : '🔓'}
        </button>
      </div>
      <div className="chips">
        <button className={cc ? 'chip on' : 'chip'} onClick={() => (cc ? removeConstraint(cc.id) : addConstraint({ type: 'openingCentered', openingId: opening.id }))}>
          Centre on wall
        </button>
        {opening.kind === 'door' && (
          <>
            <button className="chip" onClick={() => updateOpening(opening.id, { hingeB: !opening.hingeB })}>
              ⇄ Hinge side
            </button>
            <button className="chip" onClick={() => updateOpening(opening.id, { swingRight: !opening.swingRight })}>
              ⇅ Swing side
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function SettingsProps() {
  const settings = useEditor((s) => s.plan.settings)
  const setSettings = useEditor((s) => s.setSettings)
  return (
    <div className="props">
      <h3>Defaults for new walls</h3>
      <LengthField label="Thickness" units={settings.units} value={settings.wallThickness} onChange={(v) => setSettings({ wallThickness: v })} />
      <LengthField label="Height" units={settings.units} value={settings.wallHeight} onChange={(v) => setSettings({ wallHeight: v })} />
      <p className="muted small">Select a wall, corner, door or window to edit it. Select two walls (Shift+click) to relate them.</p>
    </div>
  )
}

export function Sidebar() {
  const plan = useEditor((s) => s.plan)
  const selection = useEditor((s) => s.selection)
  const violated = useEditor((s) => s.report.violated)
  const removeConstraint = useEditor((s) => s.removeConstraint)
  const select = useEditor((s) => s.select)
  const rooms = useMemo(() => findRooms(plan), [plan])

  const walls = selection.filter((s) => s.kind === 'wall').map((s) => plan.walls[s.id]).filter(Boolean)
  const points = selection.filter((s) => s.kind === 'point').map((s) => s.id).filter((id) => plan.points[id])
  const openings = selection.filter((s) => s.kind === 'opening').map((s) => plan.openings[s.id]).filter(Boolean)

  let props: React.ReactNode
  if (openings.length === 1 && walls.length === 0 && points.length === 0) props = <OpeningProps opening={openings[0]} />
  else if (walls.length === 1 && points.length === 0 && openings.length === 0) props = <WallProps wall={walls[0]} />
  else if (walls.length === 2 && points.length === 0 && openings.length === 0) props = <TwoWallsProps a={walls[0]} b={walls[1]} />
  else if (points.length === 1 && walls.length === 0 && openings.length === 0) props = <PointProps id={points[0]} />
  else if (points.length === 2 && walls.length === 0 && openings.length === 0) props = <TwoPointsProps a={points[0]} b={points[1]} />
  else if (selection.length === 0) props = <SettingsProps />
  else props = <div className="props muted small">{selection.length} items selected. Press Delete to remove them.</div>

  const selectFor = (c: Constraint) => {
    switch (c.type) {
      case 'length':
      case 'horizontal':
      case 'vertical':
        return select([{ kind: 'wall', id: c.wallId }])
      case 'parallel':
      case 'perpendicular':
      case 'equalLength':
      case 'angle':
        return select([
          { kind: 'wall', id: c.wallA },
          { kind: 'wall', id: c.wallB },
        ])
      case 'fixed':
        return select([{ kind: 'point', id: c.pointId }])
      case 'distance':
        return select([
          { kind: 'point', id: c.pointA },
          { kind: 'point', id: c.pointB },
        ])
      default:
        return select([{ kind: 'opening', id: c.openingId }])
    }
  }

  const constraints = Object.values(plan.constraints)
  return (
    <div className="sidebar">
      {props}
      <div className="props">
        <h3>
          Constraints <span className="count">{constraints.length}</span>
        </h3>
        {constraints.length === 0 && <p className="muted small">No constraints yet. Click a measurement on the plan and type a value to lock it.</p>}
        <ul className="constraints">
          {constraints.map((c) => (
            <li key={c.id} className={violated.has(c.id) ? 'bad' : ''}>
              <button className="link" onClick={() => selectFor(c)} title="Select">
                {violated.has(c.id) ? '⚠ ' : ''}
                {describeConstraint(plan, c)}
              </button>
              <button className="x" onClick={() => removeConstraint(c.id)} title="Remove constraint">
                ×
              </button>
            </li>
          ))}
        </ul>
        {violated.size > 0 && <p className="warn small">Highlighted constraints conflict with each other; the solver found the closest compromise. Remove or edit one of them.</p>}
      </div>
      <div className="props">
        <h3>
          Rooms <span className="count">{rooms.length}</span>
        </h3>
        {rooms.length === 0 && <p className="muted small">Close a loop of walls to create a room.</p>}
        <ul className="rooms">
          {rooms.map((r, i) => (
            <li key={r.id}>
              <span>Room {i + 1}</span>
              <span>{formatArea(r.area)}</span>
            </li>
          ))}
        </ul>
        {rooms.length > 0 && (
          <p className="muted small">
            Total: {formatArea(rooms.reduce((s, r) => s + r.area, 0))}
          </p>
        )}
      </div>
    </div>
  )
}
