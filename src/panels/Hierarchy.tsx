import { useMemo, useState } from 'react'
import { isSelected, useEditor, type SelectionItem } from '../model/store'
import { findRooms, pointInPolygon, wallLength } from '../model/geometry'
import { constraintsReferencing, describeConstraint, shortId } from '../model/constraints'
import { formatArea, formatLength } from '../model/units'
import type { Constraint, Furniture, Opening, Wall } from '../model/types'

function Group({ title, count, children, defaultOpen = true, depth = 0, detail, selected, onSelect }: { title: string; count: number; children: React.ReactNode; defaultOpen?: boolean; depth?: number; detail?: React.ReactNode; selected?: boolean; onSelect?: (e: React.MouseEvent) => void }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={`tree-group depth-${depth}`}>
      <div className={`tree-head ${selected ? 'on' : ''}`} style={{ paddingLeft: 14 + depth * 14 }} onClick={onSelect}>
        <button
          className={`chevron ${open ? 'open' : ''}`}
          onClick={(e) => {
            e.stopPropagation()
            setOpen((o) => !o)
          }}
          aria-label={open ? 'Collapse' : 'Expand'}
        >
          ▸
        </button>
        <span className="tree-label">{title}</span>
        {detail !== undefined ? <span className="tree-detail">{detail}</span> : <span className="count">{count}</span>}
      </div>
      {open && <div className="tree-items">{children}</div>}
    </div>
  )
}

export function Hierarchy() {
  const plan = useEditor((s) => s.plan)
  const selection = useEditor((s) => s.selection)
  const select = useEditor((s) => s.select)
  const violated = useEditor((s) => s.report.violated)
  const removeConstraint = useEditor((s) => s.removeConstraint)
  const units = useEditor((s) => s.units)
  const rooms = useMemo(() => findRooms(plan), [plan])
  const walls = Object.values(plan.walls)
  const openings = Object.values(plan.openings)
  const furniture = Object.values(plan.furniture)
  const constraints = Object.values(plan.constraints)

  const pick = (items: SelectionItem[], e: React.MouseEvent) => select(items, e.shiftKey)
  const selectFor = (c: Constraint, e: React.MouseEvent) => {
    switch (c.type) {
      case 'length':
      case 'horizontal':
      case 'vertical':
        return pick([{ kind: 'wall', id: c.wallId }], e)
      case 'parallel':
      case 'perpendicular':
      case 'equalLength':
      case 'angle':
        return pick(
          [
            { kind: 'wall', id: c.wallA },
            { kind: 'wall', id: c.wallB },
          ],
          e,
        )
      case 'fixed':
        return pick([{ kind: 'point', id: c.pointId }], e)
      case 'distance':
        return pick(
          [
            { kind: 'point', id: c.pointA },
            { kind: 'point', id: c.pointB },
          ],
          e,
        )
      case 'furnitureWallGap':
      case 'furnitureFixed':
        return pick([{ kind: 'furniture', id: c.furnitureId }], e)
      default:
        return pick([{ kind: 'opening', id: c.openingId }], e)
    }
  }
  const constraintSelected = (c: Constraint) => constraintsReferencing(plan, { walls: selection.filter((s) => s.kind === 'wall').map((s) => s.id), points: selection.filter((s) => s.kind === 'point').map((s) => s.id), openings: selection.filter((s) => s.kind === 'opening').map((s) => s.id), furniture: selection.filter((s) => s.kind === 'furniture').map((s) => s.id) }).some((x) => x.id === c.id)

  // membership: a wall belongs to every room it bounds; an opening to its wall's rooms; furniture to the room containing its centre
  const roomsWithContent = rooms.map((r, i) => {
    const roomWalls = walls.filter((w) => r.pointIds.includes(w.a) && r.pointIds.includes(w.b))
    const wallIds = new Set(roomWalls.map((w) => w.id))
    return {
      room: r,
      index: i,
      walls: roomWalls,
      openings: openings.filter((o) => wallIds.has(o.wallId)),
      furniture: furniture.filter((f) => pointInPolygon({ x: f.x, y: f.y }, r.polygon)),
    }
  })
  const placedWalls = new Set(roomsWithContent.flatMap((r) => r.walls.map((w) => w.id)))
  const placedOpenings = new Set(roomsWithContent.flatMap((r) => r.openings.map((o) => o.id)))
  const placedFurniture = new Set(roomsWithContent.flatMap((r) => r.furniture.map((f) => f.id)))
  const outside = {
    walls: walls.filter((w) => !placedWalls.has(w.id)),
    openings: openings.filter((o) => !placedOpenings.has(o.id)),
    furniture: furniture.filter((f) => !placedFurniture.has(f.id)),
  }
  const wallRow = (w: Wall, depth: number) => (
    <div key={'wall' + w.id} className={`tree-row ${isSelected(selection, 'wall', w.id) ? 'on' : ''}`} style={{ paddingLeft: 14 + depth * 14 }} onClick={(e) => pick([{ kind: 'wall', id: w.id }], e)}>
      <span className="tree-icon">▬</span>
      <span className="tree-label">Wall {shortId(w.id)}</span>
      <span className="tree-detail">{formatLength(wallLength(plan, w), units)}</span>
    </div>
  )
  const openingRow = (o: Opening, depth: number) => (
    <div key={'op' + o.id} className={`tree-row ${isSelected(selection, 'opening', o.id) ? 'on' : ''}`} style={{ paddingLeft: 14 + depth * 14 }} onClick={(e) => pick([{ kind: 'opening', id: o.id }], e)}>
      <span className="tree-icon">{o.kind === 'door' ? '◧' : '▥'}</span>
      <span className="tree-label">{o.kind === 'door' ? 'Door' : 'Window'} {shortId(o.id)}</span>
      <span className="tree-detail">{formatLength(o.width, units)}</span>
    </div>
  )
  const furnitureRow = (f: Furniture, depth: number) => (
    <div key={'f' + f.id} className={`tree-row ${isSelected(selection, 'furniture', f.id) ? 'on' : ''}`} style={{ paddingLeft: 14 + depth * 14 }} onClick={(e) => pick([{ kind: 'furniture', id: f.id }], e)}>
      <span className="tree-icon">▣</span>
      <span className="tree-label">{f.name}</span>
      <span className="tree-detail">
        {formatLength(f.width, units, false)} × {formatLength(f.depth, units, false)}
      </span>
    </div>
  )
  const contents = (c: { walls: Wall[]; openings: Opening[]; furniture: Furniture[] }, depth: number) => (
    <>
      {c.walls.length > 0 && (
        <Group title="Walls" count={c.walls.length} depth={depth} defaultOpen={false}>
          {c.walls.map((w) => wallRow(w, depth + 1))}
        </Group>
      )}
      {c.openings.length > 0 && (
        <Group title="Doors & windows" count={c.openings.length} depth={depth}>
          {c.openings.map((o) => openingRow(o, depth + 1))}
        </Group>
      )}
      {c.furniture.length > 0 && (
        <Group title="Furniture" count={c.furniture.length} depth={depth}>
          {c.furniture.map((f) => furnitureRow(f, depth + 1))}
        </Group>
      )}
    </>
  )

  return (
    <div className="tree">
      {rooms.length === 0 && <div className="tree-empty">Close a loop of walls to create a room.</div>}
      {roomsWithContent.map((r) => {
        const on = r.walls.length > 0 && r.walls.every((w) => isSelected(selection, 'wall', w.id))
        return (
          <Group key={r.room.id} title={`Room ${r.index + 1}`} count={0} detail={formatArea(r.room.area, units)} selected={on} onSelect={(e) => pick(r.walls.map((w) => ({ kind: 'wall' as const, id: w.id })), e)}>
            {contents(r, 1)}
          </Group>
        )
      })}
      {(outside.walls.length > 0 || outside.openings.length > 0 || outside.furniture.length > 0) && (
        <Group title="Outside rooms" count={outside.walls.length + outside.openings.length + outside.furniture.length} defaultOpen={rooms.length === 0}>
          {contents(outside, 1)}
        </Group>
      )}
      <Group title="Constraints" count={constraints.length}>
        {constraints.length === 0 && <div className="tree-empty">Click a measurement on the plan and type a value to lock it.</div>}
        {constraints.map((c) => (
          <div key={c.id} className={`tree-row ${violated.has(c.id) ? 'bad' : ''} ${constraintSelected(c) ? 'on' : ''}`} onClick={(e) => selectFor(c, e)}>
            <span className="tree-label">
              {violated.has(c.id) ? '⚠ ' : '🔒 '}
              {describeConstraint(plan, c)}
            </span>
            <button
              className="x"
              title="Remove constraint"
              onClick={(e) => {
                e.stopPropagation()
                removeConstraint(c.id)
              }}
            >
              ×
            </button>
          </div>
        ))}
        {violated.size > 0 && <div className="tree-empty warn">Highlighted constraints conflict; the solver found the closest compromise.</div>}
      </Group>
    </div>
  )
}
