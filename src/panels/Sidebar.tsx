import { useEffect, useRef, useState } from 'react'
import { SiteProps } from './Site'
import { UnderlayProps } from './Underlay'
import { FinishesProps, FinishSelect } from './Finishes'
import { useEditor } from '../model/store'
import type { Constraint, Furniture, FurnitureSide, Opening, Room, Wall } from '../model/types'
import { nearestWallToSide, SIDE_LABELS } from '../model/furniture'
import { CATALOG, CATEGORIES, CUSTOM_CATEGORY, creditsUrl, resolveIconUrl, type CatalogItem } from '../furniture/catalog'
import { ImportModelDialog } from './ImportModel'
import { confirmAction } from './Confirm'
import { Icon, LockIcon, type IconName } from '../brand/Icons'
import { constraintsReferencing, describeConstraint, pointDistance, shortId } from '../model/constraints'
import { useMemo } from 'react'
import { dimensionSide, findRooms, oppositeSide, wallFace, wallLength } from '../model/geometry'
import { formatArea, formatLength, parseLength, type Units } from '../model/units'
import { floorArea, roomLabel, roomName } from '../model/rooms'
import { wallGap } from '../model/measure'

/** a length input; `value` null means the selected items disagree and the field shows "Mixed" until a value is typed */
export function LengthField({ value, onChange, label, units }: { value: number | null; onChange: (v: number) => void; label: string; units: Units }) {
  const shown = value === null ? '' : formatLength(value, units, false)
  const [text, setText] = useState(shown)
  useEffect(() => setText(shown), [shown])
  const commit = () => {
    const v = parseLength(text, units)
    if (v !== null && (value === null || Math.abs(v - value) > 1e-6)) onChange(v)
    else setText(shown)
  }
  return (
    <label className="field">
      <span>{label}</span>
      <span className="field-input">
        <input
          value={text}
          placeholder={value === null ? 'Mixed' : undefined}
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

/** the title row of an inspector section: what is selected, and its id in mono */
function PropsTitle({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h3>
      <span>{children}</span>
      {id && <span className="num">{shortId(id)}</span>}
    </h3>
  )
}

/**
 * A measurement you have locked is the product, so it gets a card of its own with the
 * accent border — not a padlock button of the same weight as Thickness and Finish, and
 * not a value that looks identical whether it is free or held.
 */
function LockedMeasure({
  label,
  hint,
  units,
  value,
  locked,
  violated,
  onChange,
  onToggle,
}: {
  label: string
  hint: React.ReactNode
  units: Units
  value: number | null
  locked: boolean
  violated?: boolean
  onChange: (v: number) => void
  onToggle: () => void
}) {
  return (
    <div className={`locked-card ${locked ? (violated ? 'bad' : '') : 'free'}`}>
      <div className="locked-head">
        <LockIcon size={12} open={!locked} strokeWidth={2.2} />
        {locked ? (violated ? `${label} — can't hold` : `Locked ${label.toLowerCase()}`) : label}
      </div>
      <div className="locked-value">
        <LengthField label={label} units={units} value={value} onChange={onChange} />
        <button className={`lock ${locked ? 'on' : ''} ${locked && violated ? 'bad' : ''}`} title={locked ? `Unlock the ${label.toLowerCase()}` : `Lock the ${label.toLowerCase()}`} onClick={onToggle}>
          <LockIcon size={14} open={!locked} strokeWidth={2.2} />
        </button>
      </div>
      <div className="locked-note">{hint}</div>
    </div>
  )
}

const RULE_ICONS: Partial<Record<Constraint['type'], IconName>> = {
  horizontal: 'horizontal',
  vertical: 'vertical',
  parallel: 'parallel',
  perpendicular: 'perpendicular',
  equalLength: 'equal',
  angle: 'angle',
  wallGap: 'dimension',
  distance: 'dimension',
  length: 'dimension',
  fixed: 'anchor',
  furnitureFixed: 'anchor',
  furnitureWallGap: 'dimension',
  openingCentered: 'dimension',
  openingOffsetA: 'dimension',
  openingOffsetB: 'dimension',
}

/** the rules that apply to what is selected, listed where you can see and drop them */
function RuleList({ rules, onRemove, children }: { rules: Constraint[]; onRemove: (id: string) => void; children?: React.ReactNode }) {
  const plan = useEditor((s) => s.plan)
  const violated = useEditor((s) => s.report.violated)
  return (
    <div className="rule-list">
      {rules.map((c) => (
        <div key={c.id} className={`rule-row ${violated.has(c.id) ? 'bad' : ''}`}>
          <span className="rule-icon">
            <Icon name={RULE_ICONS[c.type] ?? 'dimension'} size={13} strokeWidth={2.2} />
          </span>
          <span title={describeConstraint(plan, c)}>{describeConstraint(plan, c)}</span>
          <button className="x" title="Remove this rule" onClick={() => onRemove(c.id)}>
            <Icon name="close" size={12} strokeWidth={2} />
          </button>
        </div>
      ))}
      {rules.length === 0 && <p className="muted small" style={{ margin: 0 }}>No rules yet — this part of the plan moves freely.</p>}
      {children}
    </div>
  )
}

/** "+ Add a rule": the two a single wall can hold on its own */
function AddWallRule({ wall, has, onAdd }: { wall: Wall; has: (t: 'horizontal' | 'vertical') => boolean; onAdd: (t: 'horizontal' | 'vertical') => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])
  return (
    <div className="popover-anchor" ref={ref} key={wall.id}>
      <button className="rule-add" onClick={() => setOpen((o) => !o)}>
        <Icon name="plus" size={13} strokeWidth={2} /> Add a rule
      </button>
      {open && (
        <div className="menu">
          <div className="menu-title">Hold this wall</div>
          <button className="menu-item" disabled={has('horizontal')} onClick={() => (onAdd('horizontal'), setOpen(false))}>
            Horizontal
          </button>
          <button className="menu-item" disabled={has('vertical')} onClick={() => (onAdd('vertical'), setOpen(false))}>
            Vertical
          </button>
          <div className="menu-sep" />
          <div className="menu-item muted" style={{ whiteSpace: 'normal', lineHeight: 1.4 }}>
            Select two walls to make them parallel, perpendicular, equal or a fixed distance apart.
          </div>
        </div>
      )}
    </div>
  )
}

/** the value every item shares, or null when they differ */
function common<T>(values: T[]): T | null {
  const first = values[0]
  for (const v of values) {
    if (typeof v === 'number' && typeof first === 'number' ? Math.abs(v - first) > 1e-6 : v !== first) return null
  }
  return first ?? null
}

function WallProps({ wall }: { wall: Wall }) {
  const plan = useEditor((s) => s.plan)
  const violated = useEditor((s) => s.report.violated)
  const updateWall = useEditor((s) => s.updateWall)
  const setWallLength = useEditor((s) => s.setWallLength)
  const addConstraint = useEditor((s) => s.addConstraint)
  const removeConstraint = useEditor((s) => s.removeConstraint)
  const units = useEditor((s) => s.units)
  const rooms = useMemo(() => findRooms(plan), [plan])
  const side = dimensionSide(plan, rooms, wall)
  const face = wallFace(plan, wall, side)
  const len = face.length
  const cs = constraintsReferencing(plan, { walls: [wall.id] })
  const lengthC = cs.find((c) => c.type === 'length')
  const otherRules = cs.filter((c) => c.id !== lengthC?.id)
  const has = (type: 'horizontal' | 'vertical') => cs.some((c) => c.type === type)
  return (
    <>
      <div className="props">
        <PropsTitle id={wall.id}>Wall</PropsTitle>
        <LockedMeasure
          label="Length"
          units={units}
          value={lengthC && lengthC.type === 'length' && lengthC.side ? lengthC.value : len}
          locked={!!lengthC}
          violated={!!lengthC && violated.has(lengthC.id)}
          onChange={(v) => setWallLength(wall.id, v, true, side)}
          onToggle={() => (lengthC ? removeConstraint(lengthC.id) : addConstraint({ type: 'length', wallId: wall.id, value: len, side }))}
          hint={
            <>
              Face to face, as drawn on the plan. Centreline <span className="num">{formatLength(wallLength(plan, wall), units)}</span>.{' '}
              {lengthC ? 'Unlock it to let the solver move this wall.' : 'Type a length to lock it.'}
            </>
          }
        />
      </div>
      <div className="props">
        <h4>Geometry</h4>
        <LengthField label="Thickness" units={units} value={wall.thickness} onChange={(v) => updateWall(wall.id, { thickness: v })} />
        <LengthField label="Height" units={units} value={wall.height} onChange={(v) => updateWall(wall.id, { height: v })} />
        <label className="field">
          <span>Finish</span>
          <FinishSelect use="wall" value={wall.finish} allowDefault="Room walls" onChange={(v) => updateWall(wall.id, { finish: v })} />
        </label>
      </div>
      <div className="props">
        <h4>Rules on this wall</h4>
        <RuleList rules={otherRules} onRemove={removeConstraint}>
          <AddWallRule wall={wall} has={has} onAdd={(type) => addConstraint({ type, wallId: wall.id })} />
        </RuleList>
      </div>
    </>
  )
}

/** properties shared by every selected wall; a field showing "Mixed" applies to all of them once typed */
function WallsProps({ walls }: { walls: Wall[] }) {
  const plan = useEditor((s) => s.plan)
  const updateWalls = useEditor((s) => s.updateWalls)
  const addConstraint = useEditor((s) => s.addConstraint)
  const removeConstraint = useEditor((s) => s.removeConstraint)
  const units = useEditor((s) => s.units)
  const ids = walls.map((w) => w.id)
  const has = (type: 'horizontal' | 'vertical') => walls.map((w) => constraintsReferencing(plan, { walls: [w.id] }).find((c) => c.type === type))
  const hs = has('horizontal')
  const vs = has('vertical')
  const finish = common(walls.map((w) => w.finish ?? ''))
  const toggle = (type: 'horizontal' | 'vertical', found: (Constraint | undefined)[]) => {
    // all locked: unlock all; otherwise lock the ones that are not yet
    if (found.every(Boolean)) for (const c of found) removeConstraint(c!.id)
    else walls.forEach((w, i) => !found[i] && addConstraint({ type, wallId: w.id }))
  }
  return (
    <div className="props">
      <h3>{walls.length} walls</h3>
      <LengthField label="Thickness" units={units} value={common(walls.map((w) => w.thickness))} onChange={(v) => updateWalls(ids, { thickness: v })} />
      <LengthField label="Height" units={units} value={common(walls.map((w) => w.height))} onChange={(v) => updateWalls(ids, { height: v })} />
      <label className="field">
        <span>Finish</span>
        <FinishSelect use="wall" value={finish || undefined} mixed={finish === null} allowDefault="Room walls" onChange={(v) => updateWalls(ids, { finish: v })} />
      </label>
      <div className="chips">
        <button className={hs.every(Boolean) ? 'chip on' : hs.some(Boolean) ? 'chip some' : 'chip'} onClick={() => toggle('horizontal', hs)}>
          Horizontal
        </button>
        <button className={vs.every(Boolean) ? 'chip on' : vs.some(Boolean) ? 'chip some' : 'chip'} onClick={() => toggle('vertical', vs)}>
          Vertical
        </button>
      </div>
      <p className="muted small">Changes apply to every selected wall. A field reading “Mixed” keeps each wall's own value until you type one.</p>
    </div>
  )
}

function TwoWallsProps({ a, b }: { a: Wall; b: Wall }) {
  const addConstraint = useEditor((s) => s.addConstraint)
  const plan = useEditor((s) => s.plan)
  const removeConstraint = useEditor((s) => s.removeConstraint)
  const setWallGap = useEditor((s) => s.setWallGap)
  const violated = useEditor((s) => s.report.violated)
  const units = useEditor((s) => s.units)
  const gap = wallGap(plan, a, b)
  const gapC = Object.values(plan.constraints).find((c) => c.type === 'wallGap' && ((c.wallA === a.id && c.wallB === b.id) || (c.wallA === b.id && c.wallB === a.id)))
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
        <span>Walls</span>
        <span className="num">
          {shortId(a.id)} + {shortId(b.id)}
        </span>
      </h3>
      {gap?.parallel && (
        <div className="row">
          <LengthField label="Gap" units={units} value={gapC && gapC.type === 'wallGap' ? gapC.value : gap.distance} onChange={(v) => setWallGap(a.id, b.id, v, true)} />
          <button className={`lock ${gapC ? 'on' : ''} ${gapC && violated.has(gapC.id) ? 'bad' : ''}`} title={gapC ? 'Unlock the gap' : 'Lock the gap'} onClick={() => (gapC ? removeConstraint(gapC.id) : addConstraint({ type: 'wallGap', wallA: a.id, wallB: b.id, value: gap.distance }))}>
            <LockIcon size={14} open={!gapC} strokeWidth={2.2} />
          </button>
        </div>
      )}
      {gap?.parallel && <p className="muted small">Clear distance between the facing sides. Typing a value moves the second wall and locks it.</p>}
      <div className="chips">
        <button className={has('parallel') ? 'chip on' : 'chip'} onClick={() => toggle('parallel')}>
          <Icon name="parallel" size={13} strokeWidth={2.2} /> Parallel
        </button>
        <button className={has('perpendicular') ? 'chip on' : 'chip'} onClick={() => toggle('perpendicular')}>
          <Icon name="perpendicular" size={13} strokeWidth={2.2} /> Perpendicular
        </button>
        <button className={has('equalLength') ? 'chip on' : 'chip'} onClick={() => toggle('equalLength')}>
          <Icon name="equal" size={13} strokeWidth={2.2} /> Equal length
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
      <PropsTitle id={id}>Corner</PropsTitle>
      <p className="muted small num">
        {p.x.toFixed(3)}, {p.y.toFixed(3)} m
      </p>
      <button className={fixed ? 'chip on' : 'chip'} onClick={() => (fixed ? removeConstraint(fixed.id) : addConstraint({ type: 'fixed', pointId: id, x: p.x, y: p.y }))}>
        <Icon name="anchor" size={13} strokeWidth={2} /> {fixed ? 'Anchored — click to release' : 'Anchor in place'}
      </button>
      <p className="muted small">An anchored corner never moves when constraints are solved. Anchor one corner so the plan doesn't drift.</p>
    </div>
  )
}

function TwoPointsProps({ a, b }: { a: string; b: string }) {
  const plan = useEditor((s) => s.plan)
  const addConstraint = useEditor((s) => s.addConstraint)
  const units = useEditor((s) => s.units)
  const d = pointDistance(plan, a, b)
  const existing = Object.values(plan.constraints).find((c) => c.type === 'distance' && ((c.pointA === a && c.pointB === b) || (c.pointA === b && c.pointB === a)))
  return (
    <div className="props">
      <h3>Two corners</h3>
      <div className="row">
        <LengthField label="Distance" units={units} value={existing && existing.type === 'distance' ? existing.value : d} onChange={(v) => addConstraint({ type: 'distance', pointA: a, pointB: b, value: v })} />
        <button className={`lock ${existing ? 'on' : ''}`} onClick={() => addConstraint({ type: 'distance', pointA: a, pointB: b, value: d })} title="Lock current distance">
          <LockIcon size={14} open={!existing} strokeWidth={2.2} />
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
  const units = useEditor((s) => s.units)
  const wall = plan.walls[opening.wallId]
  const len = wallLength(plan, wall)
  const rooms = useMemo(() => findRooms(plan), [plan])
  const side = oppositeSide(dimensionSide(plan, rooms, wall))
  const face = wallFace(plan, wall, side)
  const cs = constraintsReferencing(plan, { openings: [opening.id] })
  const ca = cs.find((c) => c.type === 'openingOffsetA')
  const cb = cs.find((c) => c.type === 'openingOffsetB')
  const cc = cs.find((c) => c.type === 'openingCentered')
  const fromA = opening.offset - face.insetA
  const fromB = len - opening.offset - opening.width - face.insetB
  return (
    <div className="props">
      <PropsTitle id={opening.id}>{opening.kind === 'door' ? 'Door' : 'Window'}</PropsTitle>
      <LengthField label="Width" units={units} value={opening.width} onChange={(v) => updateOpening(opening.id, { width: v })} />
      <LengthField label="Height" units={units} value={opening.height} onChange={(v) => updateOpening(opening.id, { height: v })} />
      {opening.kind === 'window' && <LengthField label="Sill height" units={units} value={opening.sill} onChange={(v) => updateOpening(opening.id, { sill: v })} />}
      <div className="row">
        <LengthField label="From start" units={units} value={ca && ca.type === 'openingOffsetA' && ca.side ? ca.value : fromA} onChange={(v) => addConstraint({ type: 'openingOffsetA', openingId: opening.id, value: v, side })} />
        <button className={`lock ${ca ? 'on' : ''} ${ca && violated.has(ca.id) ? 'bad' : ''}`} title={ca ? 'Unlock this offset' : 'Lock this offset'} onClick={() => (ca ? removeConstraint(ca.id) : addConstraint({ type: 'openingOffsetA', openingId: opening.id, value: fromA, side }))}>
          <LockIcon size={14} open={!ca} strokeWidth={2.2} />
        </button>
      </div>
      <div className="row">
        <LengthField label="From end" units={units} value={cb && cb.type === 'openingOffsetB' && cb.side ? cb.value : fromB} onChange={(v) => addConstraint({ type: 'openingOffsetB', openingId: opening.id, value: v, side })} />
        <button className={`lock ${cb ? 'on' : ''} ${cb && violated.has(cb.id) ? 'bad' : ''}`} title={cb ? 'Unlock this offset' : 'Lock this offset'} onClick={() => (cb ? removeConstraint(cb.id) : addConstraint({ type: 'openingOffsetB', openingId: opening.id, value: fromB, side }))}>
          <LockIcon size={14} open={!cb} strokeWidth={2.2} />
        </button>
      </div>
      <div className="chips">
        <button className={cc ? 'chip on' : 'chip'} onClick={() => (cc ? removeConstraint(cc.id) : addConstraint({ type: 'openingCentered', openingId: opening.id, side }))}>
          Centre on wall
        </button>
        {opening.kind === 'door' && (
          <>
            <button className="chip" onClick={() => updateOpening(opening.id, { hingeB: !opening.hingeB })}>
              <Icon name="flipH" size={13} strokeWidth={2} /> Hinge side
            </button>
            <button className="chip" onClick={() => updateOpening(opening.id, { swingRight: !opening.swingRight })}>
              <Icon name="flipV" size={13} strokeWidth={2} /> Swing side
            </button>
          </>
        )}
      </div>
    </div>
  )
}

const SIDES: FurnitureSide[] = ['back', 'left', 'right', 'front']

function FurnitureProps({ piece }: { piece: Furniture }) {
  const plan = useEditor((s) => s.plan)
  const violated = useEditor((s) => s.report.violated)
  const updateFurniture = useEditor((s) => s.updateFurniture)
  const addConstraint = useEditor((s) => s.addConstraint)
  const removeConstraint = useEditor((s) => s.removeConstraint)
  const units = useEditor((s) => s.units)
  const cs = constraintsReferencing(plan, { furniture: [piece.id] })
  const fixed = cs.find((c) => c.type === 'furnitureFixed')
  const gaps = cs.filter((c): c is Extract<Constraint, { type: 'furnitureWallGap' }> => c.type === 'furnitureWallGap')
  const [side, setSide] = useState<FurnitureSide>('back')
  const [angleText, setAngleText] = useState(String(Math.round((piece.angle * 180) / Math.PI)))
  useEffect(() => setAngleText(String(Math.round((piece.angle * 180) / Math.PI))), [piece.angle])
  const attach = () => {
    const near = nearestWallToSide(plan, piece, side)
    if (!near) {
      useEditor.getState().setNotice('No wall faces that side of the piece. Turn it, or move it closer to a wall.')
      return
    }
    addConstraint({ type: 'furnitureWallGap', furnitureId: piece.id, wallId: near.wallId, side, value: Math.round(near.gap * 100) / 100 })
  }
  return (
    <div className="props">
      <h3>{piece.name}</h3>
      <LengthField label="Width" units={units} value={piece.width} onChange={(v) => updateFurniture(piece.id, { width: v })} />
      <LengthField label="Depth" units={units} value={piece.depth} onChange={(v) => updateFurniture(piece.id, { depth: v })} />
      <LengthField label="Height" units={units} value={piece.height} onChange={(v) => updateFurniture(piece.id, { height: v })} />
      <LengthField label="Elevation" units={units} value={piece.elevation} onChange={(v) => updateFurniture(piece.id, { elevation: v })} />
      <label className="field">
        <span>Rotation</span>
        <span className="field-input">
          <input
            value={angleText}
            onChange={(e) => setAngleText(e.target.value)}
            onBlur={() => {
              const v = parseFloat(angleText)
              if (Number.isFinite(v)) updateFurniture(piece.id, { angle: (v * Math.PI) / 180 })
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
          />
          <em>°</em>
        </span>
      </label>
      <div className="chips">
        <button className="chip" onClick={() => updateFurniture(piece.id, { angle: piece.angle + Math.PI / 2 })}>
          <Icon name="rotate" size={13} strokeWidth={2} /> Rotate 90° <kbd>R</kbd>
        </button>
        <button className={fixed ? 'chip on' : 'chip'} onClick={() => (fixed ? removeConstraint(fixed.id) : addConstraint({ type: 'furnitureFixed', furnitureId: piece.id, x: piece.x, y: piece.y, angle: piece.angle }))}>
          <Icon name="anchor" size={13} strokeWidth={2} /> {fixed ? 'Anchored' : 'Anchor'}
        </button>
      </div>
      <h4>Rules against walls</h4>
      {gaps.length === 0 && <p className="muted small">None yet. Drop the piece against a wall, or attach a side below.</p>}
      {gaps.map((g) => (
        <div className="row" key={g.id}>
          <LengthField
            label={`${SIDE_LABELS[g.side]} → wall ${shortId(g.wallId)}`}
            units={units}
            value={g.value}
            onChange={(v) => addConstraint({ type: 'furnitureWallGap', furnitureId: piece.id, wallId: g.wallId, side: g.side, value: v })}
          />
          <button className={`lock on ${violated.has(g.id) ? 'bad' : ''}`} title="Drop this rule" onClick={() => removeConstraint(g.id)}>
            <LockIcon size={14} strokeWidth={2.2} />
          </button>
        </div>
      ))}
      <div className="row">
        <select value={side} onChange={(e) => setSide(e.target.value as FurnitureSide)}>
          {SIDES.map((s) => (
            <option key={s} value={s}>
              {SIDE_LABELS[s]}
            </option>
          ))}
        </select>
        <button onClick={attach}>Attach to nearest wall</button>
      </div>
      <p className="muted small">The gap is measured from that side to the wall face and stays locked while the wall moves.</p>
    </div>
  )
}

/** properties shared by every selected door / window */
function OpeningsProps({ openings }: { openings: Opening[] }) {
  const updateOpenings = useEditor((s) => s.updateOpenings)
  const units = useEditor((s) => s.units)
  const ids = openings.map((o) => o.id)
  const doors = openings.filter((o) => o.kind === 'door').length
  const windows = openings.length - doors
  const title = doors && windows ? `${openings.length} openings` : doors ? `${doors} doors` : `${windows} windows`
  return (
    <div className="props">
      <h3>{title}</h3>
      <LengthField label="Width" units={units} value={common(openings.map((o) => o.width))} onChange={(v) => updateOpenings(ids, { width: v })} />
      <LengthField label="Height" units={units} value={common(openings.map((o) => o.height))} onChange={(v) => updateOpenings(ids, { height: v })} />
      {doors === 0 && <LengthField label="Sill height" units={units} value={common(openings.map((o) => o.sill))} onChange={(v) => updateOpenings(ids, { sill: v })} />}
      {windows === 0 && (
        <div className="chips">
          <button className="chip" onClick={() => updateOpenings(ids, { hingeB: !openings.every((o) => o.hingeB) })}>
            <Icon name="flipH" size={13} strokeWidth={2} /> Hinge side
          </button>
          <button className="chip" onClick={() => updateOpenings(ids, { swingRight: !openings.every((o) => o.swingRight) })}>
            <Icon name="flipV" size={13} strokeWidth={2} /> Swing side
          </button>
        </div>
      )}
      <p className="muted small">Changes apply to every selected {doors && windows ? 'opening' : doors ? 'door' : 'window'}. A field reading “Mixed” keeps each one's own value until you type one.</p>
    </div>
  )
}

/** properties shared by every selected piece of furniture */
function FurnitureMultiProps({ pieces }: { pieces: Furniture[] }) {
  const plan = useEditor((s) => s.plan)
  const updateFurniturePieces = useEditor((s) => s.updateFurniturePieces)
  const addConstraint = useEditor((s) => s.addConstraint)
  const removeConstraint = useEditor((s) => s.removeConstraint)
  const units = useEditor((s) => s.units)
  const ids = pieces.map((p) => p.id)
  const angle = common(pieces.map((p) => Math.round((p.angle * 180) / Math.PI)))
  const [angleText, setAngleText] = useState(angle === null ? '' : String(angle))
  useEffect(() => setAngleText(angle === null ? '' : String(angle)), [angle])
  const anchors = pieces.map((p) => constraintsReferencing(plan, { furniture: [p.id] }).find((c) => c.type === 'furnitureFixed'))
  const allAnchored = anchors.every(Boolean)
  const sameKind = common(pieces.map((p) => p.catalogKey)) !== null
  return (
    <div className="props">
      <h3>{sameKind ? `${pieces.length} × ${pieces[0].name}` : `${pieces.length} pieces`}</h3>
      <LengthField label="Width" units={units} value={common(pieces.map((p) => p.width))} onChange={(v) => updateFurniturePieces(ids, { width: v })} />
      <LengthField label="Depth" units={units} value={common(pieces.map((p) => p.depth))} onChange={(v) => updateFurniturePieces(ids, { depth: v })} />
      <LengthField label="Height" units={units} value={common(pieces.map((p) => p.height))} onChange={(v) => updateFurniturePieces(ids, { height: v })} />
      <LengthField label="Elevation" units={units} value={common(pieces.map((p) => p.elevation))} onChange={(v) => updateFurniturePieces(ids, { elevation: v })} />
      <label className="field">
        <span>Rotation</span>
        <span className="field-input">
          <input
            value={angleText}
            placeholder={angle === null ? 'Mixed' : undefined}
            onChange={(e) => setAngleText(e.target.value)}
            onBlur={() => {
              const v = parseFloat(angleText)
              if (Number.isFinite(v)) updateFurniturePieces(ids, { angle: (v * Math.PI) / 180 })
              else setAngleText(angle === null ? '' : String(angle))
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
          />
          <em>°</em>
        </span>
      </label>
      <div className="chips">
        <button
          className="chip"
          onClick={() => {
            // each piece turns about its own centre
            const plan = useEditor.getState().plan
            const furniture = { ...plan.furniture }
            for (const id of ids) if (furniture[id]) furniture[id] = { ...furniture[id], angle: furniture[id].angle + Math.PI / 2 }
            useEditor.getState().commit({ ...plan, furniture })
          }}
        >
          <Icon name="rotate" size={13} strokeWidth={2} /> Rotate 90° <kbd>R</kbd>
        </button>
        <button
          className={allAnchored ? 'chip on' : anchors.some(Boolean) ? 'chip some' : 'chip'}
          onClick={() => {
            if (allAnchored) for (const c of anchors) removeConstraint(c!.id)
            else pieces.forEach((p, i) => !anchors[i] && addConstraint({ type: 'furnitureFixed', furnitureId: p.id, x: p.x, y: p.y, angle: p.angle }))
          }}
        >
          <Icon name="anchor" size={13} strokeWidth={2} /> {allAnchored ? 'Anchored' : 'Anchor'}
        </button>
      </div>
      <p className="muted small">Changes apply to every selected piece. A field reading “Mixed” keeps each piece's own value until you type one.</p>
    </div>
  )
}

function FurnitureAndWallProps({ piece, wall }: { piece: Furniture; wall: Wall }) {
  const addConstraint = useEditor((s) => s.addConstraint)
  const units = useEditor((s) => s.units)
  const [side, setSide] = useState<FurnitureSide>('back')
  const [gap, setGap] = useState(0)
  return (
    <div className="props">
      <PropsTitle id={wall.id}>{piece.name} + wall</PropsTitle>
      <div className="row">
        <select value={side} onChange={(e) => setSide(e.target.value as FurnitureSide)}>
          {SIDES.map((s) => (
            <option key={s} value={s}>
              {SIDE_LABELS[s]}
            </option>
          ))}
        </select>
        <LengthField label="Gap" units={units} value={gap} onChange={setGap} />
      </div>
      <button onClick={() => addConstraint({ type: 'furnitureWallGap', furnitureId: piece.id, wallId: wall.id, side, value: gap })}>Lock side against this wall</button>
    </div>
  )
}

export function CataloguePanel() {
  const placing = useEditor((s) => s.placing)
  const setPlacing = useEditor((s) => s.setPlacing)
  const customModels = useEditor((s) => s.customModels)
  const deleteCustomModel = useEditor((s) => s.deleteCustomModel)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string>('All')
  const [importing, setImporting] = useState(false)
  const q = query.trim().toLowerCase()
  const all: CatalogItem[] = [...customModels, ...CATALOG]
  const items = all.filter((c) => (category === 'All' || c.category === category) && (!q || c.name.toLowerCase().includes(q) || c.category.toLowerCase().includes(q)))
  const categories = customModels.length > 0 ? [CUSTOM_CATEGORY, ...CATEGORIES] : CATEGORIES
  return (
    <div className="props catalogue">
      <div className="row space">
        <h3>Furniture</h3>
        <button onClick={() => setImporting(true)} title="Import a .glb or .gltf model">
          <Icon name="upload" size={13} strokeWidth={2} /> Import
        </button>
      </div>
      {importing && <ImportModelDialog onClose={() => setImporting(false)} onImported={() => setCategory(CUSTOM_CATEGORY)} />}
      <input className="search" placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="chips">
        {['All', ...categories].map((c) => (
          <button key={c} className={category === c ? 'chip on' : 'chip'} onClick={() => setCategory(c)}>
            {c}
          </button>
        ))}
      </div>
      <p className="muted small">{placing ? 'Click on the plan to place it. Esc cancels.' : 'Pick a piece, then click on the plan. Pieces snap against walls and remember it.'}</p>
      <div className="catalogue-grid">
        {items.map((c) => (
          <button key={c.key} className={placing === c.key ? 'tile on' : 'tile'} onClick={() => setPlacing(placing === c.key ? null : c.key)} title={`${c.name} · ${Math.round(c.width * 100)}×${Math.round(c.depth * 100)}×${Math.round(c.height * 100)} cm · ${c.creator} (${c.license})`}>
            {resolveIconUrl(c.key) ? <img src={resolveIconUrl(c.key)!} alt="" loading="lazy" /> : <span className="tile-box" />}
            <span>{c.name}</span>
            <small>
              {Math.round(c.width * 100)}×{Math.round(c.depth * 100)}
            </small>
            {c.category === CUSTOM_CATEGORY && (
              <span
                className="tile-x"
                title="Delete this model"
                onClick={(e) => {
                  e.stopPropagation()
                  void confirmAction({
                    title: `Delete “${c.name}” from your models?`,
                    body: 'Pieces already placed keep their size, but lose the model they were drawn from.',
                    confirmLabel: 'Delete model',
                  }).then((ok) => {
                    if (ok) void deleteCustomModel(c.key)
                  })
                }}
              >
                <Icon name="close" size={13} strokeWidth={2} />
              </span>
            )}
          </button>
        ))}
      </div>
      <p className="muted small">
        Import your own .glb files (for example models you downloaded for your own planning). Bundled models come from the free <a href="https://www.sweethome3d.com/" target="_blank" rel="noreferrer">Sweet Home 3D</a> libraries (CC0, CC-BY and Free Art licences).{' '}
        <a href={creditsUrl} target="_blank" rel="noreferrer">
          Credits
        </a>
      </p>
    </div>
  )
}

/** total area of the rooms on this floor and of the whole project */
function FloorAreaRow() {
  const project = useEditor((s) => s.project)
  const plan = useEditor((s) => s.plan)
  const units = useEditor((s) => s.units)
  const here = useMemo(() => floorArea(findRooms(plan)), [plan])
  const total = useMemo(() => project.floors.reduce((sum, f) => sum + floorArea(findRooms(f.plan)), 0), [project])
  if (here <= 0 && total <= 0) return null
  return (
    <div className="field">
      <span>Floor area</span>
      <span className="muted small num">
        {formatArea(here, units)}
        {project.floors.length > 1 ? ` · all floors ${formatArea(total, units)}` : ''}
      </span>
    </div>
  )
}

function SettingsProps() {
  const settings = useEditor((s) => s.plan.settings)
  const units = useEditor((s) => s.units)
  const setSettings = useEditor((s) => s.setSettings)
  const project = useEditor((s) => s.project)
  const activeFloorId = useEditor((s) => s.activeFloorId)
  const renameFloor = useEditor((s) => s.renameFloor)
  const setRoof = useEditor((s) => s.setRoof)
  const setSlabThickness = useEditor((s) => s.setSlabThickness)
  const floor = project.floors.find((f) => f.id === activeFloorId)
  const roof = project.roof
  const [name, setName] = useState(floor?.name ?? '')
  useEffect(() => setName(floor?.name ?? ''), [floor?.name])
  return (
    <>
      <div className="props">
        <h3>Floor</h3>
        <label className="field">
          <span>Name</span>
          <span className="field-input wide">
            <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => floor && name.trim() && name !== floor.name && renameFloor(floor.id, name.trim())} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
          </span>
        </label>
        <FloorAreaRow />
        <LengthField label="Floor height" units={units} value={settings.wallHeight} onChange={(v) => setSettings({ wallHeight: v })} />
        <LengthField label="Wall thickness" units={units} value={settings.wallThickness} onChange={(v) => setSettings({ wallThickness: v })} />
        <p className="muted small">Floor height is the default height of new walls on this floor and sets where the floor above starts.</p>
      </div>
      <div className="props">
        <h3>Roof</h3>
        <label className="field">
          <span>Type</span>
          <select value={roof.type} onChange={(e) => setRoof({ type: e.target.value as typeof roof.type })}>
            <option value="none">None</option>
            <option value="flat">Flat</option>
            <option value="gable">Gable</option>
            <option value="hip">Hip</option>
          </select>
        </label>
        {(roof.type === 'gable' || roof.type === 'hip') && (
          <>
            <label className="field">
              <span>Pitch</span>
              <span className="field-input">
                <input type="number" min={5} max={70} value={roof.pitch} onChange={(e) => setRoof({ pitch: Math.min(70, Math.max(5, Number(e.target.value) || 0)) })} />
                <em>°</em>
              </span>
            </label>
            <label className="field">
              <span>Ridge</span>
              <select value={roof.ridge} onChange={(e) => setRoof({ ridge: e.target.value as typeof roof.ridge })}>
                <option value="long">Along the long side</option>
                <option value="short">Along the short side</option>
              </select>
            </label>
          </>
        )}
        {roof.type !== 'none' && (
          <>
            <LengthField label="Overhang" units={units} value={roof.overhang} onChange={(v) => setRoof({ overhang: Math.max(0, v) })} />
            {roof.type === 'flat' && <LengthField label="Thickness" units={units} value={roof.thickness} onChange={(v) => setRoof({ thickness: Math.max(0.05, v) })} />}
            <label className="field">
              <span>Colour</span>
              <input type="color" value={roof.color} onChange={(e) => setRoof({ color: e.target.value })} />
            </label>
          </>
        )}
        <LengthField label="Slab between floors" units={units} value={project.slabThickness} onChange={setSlabThickness} />
        <p className="muted small">The roof covers the top floor's outline, aligned with its longest wall. Select a wall, corner, door, window or piece of furniture to edit it.</p>
      </div>
      <FinishesProps />
      <UnderlayProps />
      <SiteProps />
    </>
  )
}

/** a room: its name, area and finishes; several rooms share the finish fields */
function RoomsProps({ rooms, indexOf }: { rooms: Room[]; indexOf: (room: Room) => number }) {
  const plan = useEditor((s) => s.plan)
  const units = useEditor((s) => s.units)
  const nameRoom = useEditor((s) => s.nameRoom)
  const setRoomFinish = useEditor((s) => s.setRoomFinish)
  const select = useEditor((s) => s.select)
  const single = rooms.length === 1 ? rooms[0] : null
  const currentName = single ? roomName(plan, single, indexOf(single)) : ''
  const [name, setName] = useState(currentName)
  useEffect(() => setName(currentName), [currentName])
  const labels = rooms.map((r) => roomLabel(plan, r))
  const floorFinish = common(labels.map((l) => l?.floor ?? ''))
  const wallFinish = common(labels.map((l) => l?.wall ?? ''))
  const area = rooms.reduce((sum, r) => sum + r.area, 0)
  const wallIds = Object.values(plan.walls)
    .filter((w) => rooms.some((r) => r.pointIds.includes(w.a) && r.pointIds.includes(w.b)))
    .map((w) => w.id)
  return (
    <div className="props">
      <h3>{single ? currentName : `${rooms.length} rooms`}</h3>
      {single && (
        <label className="field">
          <span>Name</span>
          <span className="field-input wide">
            <input
              value={name}
              placeholder={`Room ${indexOf(single) + 1}`}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => name.trim() !== currentName && nameRoom(single, name)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              }}
            />
          </span>
        </label>
      )}
      <p className="muted small">
        {single ? 'Area' : 'Total area'} {formatArea(area, units)}, inside the walls.
      </p>
      <label className="field">
        <span>Floor</span>
        <FinishSelect use="floor" value={floorFinish || undefined} mixed={floorFinish === null} allowDefault="Default" onChange={(v) => setRoomFinish(rooms, { floor: v })} />
      </label>
      <label className="field">
        <span>Walls</span>
        <FinishSelect use="wall" value={wallFinish || undefined} mixed={wallFinish === null} allowDefault="Default" onChange={(v) => setRoomFinish(rooms, { wall: v })} />
      </label>
      <p className="muted small">The wall finish applies to the faces looking into {single ? 'this room' : 'these rooms'}; a wall's own finish, set on the wall, wins.</p>
      <div className="chips">
        <button className="chip" onClick={() => select(wallIds.map((id) => ({ kind: 'wall' as const, id })))}>
          Select {single ? 'its' : 'their'} walls
        </button>
      </div>
    </div>
  )
}

export function SelectionInspector() {
  const plan = useEditor((s) => s.plan)
  const selection = useEditor((s) => s.selection)

  const walls = selection.filter((s) => s.kind === 'wall').map((s) => plan.walls[s.id]).filter(Boolean)
  const points = selection.filter((s) => s.kind === 'point').map((s) => s.id).filter((id) => plan.points[id])
  const openings = selection.filter((s) => s.kind === 'opening').map((s) => plan.openings[s.id]).filter(Boolean)
  const furniture = selection.filter((s) => s.kind === 'furniture').map((s) => plan.furniture[s.id]).filter(Boolean)
  const allRooms = useMemo(() => findRooms(plan), [plan])
  const rooms = selection.filter((s) => s.kind === 'room').map((s) => allRooms.find((r) => r.id === s.id)).filter((r): r is Room => !!r)

  if (rooms.length > 0 && rooms.length === selection.length) return <RoomsProps rooms={rooms} indexOf={(room) => allRooms.indexOf(room)} />

  if (furniture.length === 1 && walls.length === 1 && points.length === 0 && openings.length === 0) return <FurnitureAndWallProps piece={furniture[0]} wall={walls[0]} />
  if (furniture.length === 1 && walls.length === 0 && points.length === 0 && openings.length === 0) return <FurnitureProps piece={furniture[0]} />
  if (furniture.length > 1 && walls.length === 0 && points.length === 0 && openings.length === 0) return <FurnitureMultiProps pieces={furniture} />
  if (furniture.length > 0) return <div className="props muted small">{selection.length} items selected. Press Delete to remove them.</div>
  if (openings.length === 1 && walls.length === 0 && points.length === 0) return <OpeningProps opening={openings[0]} />
  if (openings.length > 1 && walls.length === 0 && points.length === 0) return <OpeningsProps openings={openings} />
  if (walls.length === 1 && points.length === 0 && openings.length === 0) return <WallProps wall={walls[0]} />
  if (walls.length === 2 && points.length === 0 && openings.length === 0)
    return (
      <>
        <TwoWallsProps a={walls[0]} b={walls[1]} />
        <WallsProps walls={walls} />
      </>
    )
  if (walls.length > 2 && points.length === 0 && openings.length === 0) return <WallsProps walls={walls} />
  if (points.length === 1 && walls.length === 0 && openings.length === 0) return <PointProps id={points[0]} />
  if (points.length === 2 && walls.length === 0 && openings.length === 0) return <TwoPointsProps a={points[0]} b={points[1]} />
  if (selection.length === 0) return <SettingsProps />
  return <div className="props muted small">{selection.length} items selected. Press Delete to remove them.</div>
}
