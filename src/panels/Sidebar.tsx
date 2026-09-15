import { useEffect, useState } from 'react'
import { SiteProps } from './Site'
import { UnderlayProps } from './Underlay'
import { FinishesProps, FinishSelect } from './Finishes'
import { useEditor } from '../model/store'
import type { Constraint, Furniture, FurnitureSide, Opening, Wall } from '../model/types'
import { nearestWallToSide, SIDE_LABELS } from '../model/furniture'
import { CATALOG, CATEGORIES, CUSTOM_CATEGORY, creditsUrl, resolveIconUrl, type CatalogItem } from '../furniture/catalog'
import { ImportModelDialog } from './ImportModel'
import { constraintsReferencing, pointDistance, shortId } from '../model/constraints'
import { useMemo } from 'react'
import { dimensionSide, findRooms, oppositeSide, wallFace, wallLength } from '../model/geometry'
import { formatArea, formatLength, parseLength, type Units } from '../model/units'
import { floorArea } from '../model/rooms'

export function LengthField({ value, onChange, label, units }: { value: number; onChange: (v: number) => void; label: string; units: Units }) {
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
  const units = useEditor((s) => s.units)
  const rooms = useMemo(() => findRooms(plan), [plan])
  const side = dimensionSide(plan, rooms, wall)
  const face = wallFace(plan, wall, side)
  const len = face.length
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
        <LengthField label="Length" units={units} value={lengthC && lengthC.type === 'length' && lengthC.side ? lengthC.value : len} onChange={(v) => setWallLength(wall.id, v, true, side)} />
        <button className={`lock ${lengthC ? 'on' : ''} ${lengthC && violated.has(lengthC.id) ? 'bad' : ''}`} title={lengthC ? 'Unlock length' : 'Lock length'} onClick={() => (lengthC ? removeConstraint(lengthC.id) : addConstraint({ type: 'length', wallId: wall.id, value: len, side }))}>
          {lengthC ? '🔒' : '🔓'}
        </button>
      </div>
      <p className="muted small">
        Face to face, as drawn on the plan. Centreline {formatLength(wallLength(plan, wall), units)}. Typing a length locks it.
      </p>
      <LengthField label="Thickness" units={units} value={wall.thickness} onChange={(v) => updateWall(wall.id, { thickness: v })} />
      <LengthField label="Height" units={units} value={wall.height} onChange={(v) => updateWall(wall.id, { height: v })} />
        <label className="field">
          <span>Finish</span>
          <FinishSelect use="wall" value={wall.finish} allowDefault="Room walls" onChange={(v) => updateWall(wall.id, { finish: v })} />
        </label>
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
  const units = useEditor((s) => s.units)
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
      <h3>
        {opening.kind === 'door' ? 'Door' : 'Window'} {shortId(opening.id)}
      </h3>
      <LengthField label="Width" units={units} value={opening.width} onChange={(v) => updateOpening(opening.id, { width: v })} />
      <LengthField label="Height" units={units} value={opening.height} onChange={(v) => updateOpening(opening.id, { height: v })} />
      {opening.kind === 'window' && <LengthField label="Sill height" units={units} value={opening.sill} onChange={(v) => updateOpening(opening.id, { sill: v })} />}
      <div className="row">
        <LengthField label="From start" units={units} value={ca && ca.type === 'openingOffsetA' && ca.side ? ca.value : fromA} onChange={(v) => addConstraint({ type: 'openingOffsetA', openingId: opening.id, value: v, side })} />
        <button className={`lock ${ca ? 'on' : ''} ${ca && violated.has(ca.id) ? 'bad' : ''}`} onClick={() => (ca ? removeConstraint(ca.id) : addConstraint({ type: 'openingOffsetA', openingId: opening.id, value: fromA, side }))}>
          {ca ? '🔒' : '🔓'}
        </button>
      </div>
      <div className="row">
        <LengthField label="From end" units={units} value={cb && cb.type === 'openingOffsetB' && cb.side ? cb.value : fromB} onChange={(v) => addConstraint({ type: 'openingOffsetB', openingId: opening.id, value: v, side })} />
        <button className={`lock ${cb ? 'on' : ''} ${cb && violated.has(cb.id) ? 'bad' : ''}`} onClick={() => (cb ? removeConstraint(cb.id) : addConstraint({ type: 'openingOffsetB', openingId: opening.id, value: fromB, side }))}>
          {cb ? '🔒' : '🔓'}
        </button>
      </div>
      <div className="chips">
        <button className={cc ? 'chip on' : 'chip'} onClick={() => (cc ? removeConstraint(cc.id) : addConstraint({ type: 'openingCentered', openingId: opening.id, side }))}>
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
      alert('No wall found facing that side of the piece.')
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
          ↻ Rotate 90° <kbd>R</kbd>
        </button>
        <button className={fixed ? 'chip on' : 'chip'} onClick={() => (fixed ? removeConstraint(fixed.id) : addConstraint({ type: 'furnitureFixed', furnitureId: piece.id, x: piece.x, y: piece.y, angle: piece.angle }))}>
          📌 {fixed ? 'Anchored' : 'Anchor'}
        </button>
      </div>
      <h4>Wall constraints</h4>
      {gaps.length === 0 && <p className="muted small">None yet. Drop the piece against a wall, or attach a side below.</p>}
      {gaps.map((g) => (
        <div className="row" key={g.id}>
          <LengthField
            label={`${SIDE_LABELS[g.side]} → wall ${shortId(g.wallId)}`}
            units={units}
            value={g.value}
            onChange={(v) => addConstraint({ type: 'furnitureWallGap', furnitureId: piece.id, wallId: g.wallId, side: g.side, value: v })}
          />
          <button className={`lock on ${violated.has(g.id) ? 'bad' : ''}`} title="Remove constraint" onClick={() => removeConstraint(g.id)}>
            🔒
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

function FurnitureAndWallProps({ piece, wall }: { piece: Furniture; wall: Wall }) {
  const addConstraint = useEditor((s) => s.addConstraint)
  const units = useEditor((s) => s.units)
  const [side, setSide] = useState<FurnitureSide>('back')
  const [gap, setGap] = useState(0)
  return (
    <div className="props">
      <h3>
        {piece.name} + wall {shortId(wall.id)}
      </h3>
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
          + Import…
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
                  if (confirm(`Delete "${c.name}" from your models? Pieces already placed keep their size but lose the model.`)) void deleteCustomModel(c.key)
                }}
              >
                ×
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
      <span className="muted small">
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
          <span className="field-input">
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

export function SelectionInspector() {
  const plan = useEditor((s) => s.plan)
  const selection = useEditor((s) => s.selection)

  const walls = selection.filter((s) => s.kind === 'wall').map((s) => plan.walls[s.id]).filter(Boolean)
  const points = selection.filter((s) => s.kind === 'point').map((s) => s.id).filter((id) => plan.points[id])
  const openings = selection.filter((s) => s.kind === 'opening').map((s) => plan.openings[s.id]).filter(Boolean)
  const furniture = selection.filter((s) => s.kind === 'furniture').map((s) => plan.furniture[s.id]).filter(Boolean)

  if (furniture.length === 1 && walls.length === 1 && points.length === 0 && openings.length === 0) return <FurnitureAndWallProps piece={furniture[0]} wall={walls[0]} />
  if (furniture.length === 1 && walls.length === 0 && points.length === 0 && openings.length === 0) return <FurnitureProps piece={furniture[0]} />
  if (furniture.length > 0) return <div className="props muted small">{selection.length} items selected. Press Delete to remove them.</div>
  if (openings.length === 1 && walls.length === 0 && points.length === 0) return <OpeningProps opening={openings[0]} />
  if (walls.length === 1 && points.length === 0 && openings.length === 0) return <WallProps wall={walls[0]} />
  if (walls.length === 2 && points.length === 0 && openings.length === 0) return <TwoWallsProps a={walls[0]} b={walls[1]} />
  if (points.length === 1 && walls.length === 0 && openings.length === 0) return <PointProps id={points[0]} />
  if (points.length === 2 && walls.length === 0 && openings.length === 0) return <TwoPointsProps a={points[0]} b={points[1]} />
  if (selection.length === 0) return <SettingsProps />
  return <div className="props muted small">{selection.length} items selected. Press Delete to remove them.</div>
}
