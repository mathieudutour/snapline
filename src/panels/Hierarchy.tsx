import { useMemo, useState } from 'react'
import { isSelected, useEditor, type SelectionItem } from '../model/store'
import { findRooms, wallLength } from '../model/geometry'
import { constraintsReferencing, describeConstraint, shortId } from '../model/constraints'
import { formatArea, formatLength } from '../model/units'
import type { Constraint } from '../model/types'

function Group({ title, count, children, defaultOpen = true }: { title: string; count: number; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="tree-group">
      <button className="tree-head" onClick={() => setOpen((o) => !o)}>
        <span className={`chevron ${open ? 'open' : ''}`}>▸</span>
        {title}
        <span className="count">{count}</span>
      </button>
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
  const row = (item: SelectionItem, label: React.ReactNode, detail?: React.ReactNode, extra?: React.ReactNode) => (
    <div key={item.kind + item.id} className={`tree-row ${isSelected(selection, item.kind, item.id) ? 'on' : ''}`} onClick={(e) => pick([item], e)}>
      <span className="tree-label">{label}</span>
      {detail !== undefined && <span className="tree-detail">{detail}</span>}
      {extra}
    </div>
  )
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

  return (
    <div className="tree">
      <Group title="Rooms" count={rooms.length}>
        {rooms.length === 0 && <div className="tree-empty">Close a loop of walls to create a room.</div>}
        {rooms.map((r, i) => {
          const wallIds = walls.filter((w) => r.pointIds.includes(w.a) && r.pointIds.includes(w.b)).map((w) => w.id)
          const on = wallIds.length > 0 && wallIds.every((id) => isSelected(selection, 'wall', id))
          return (
            <div key={r.id} className={`tree-row ${on ? 'on' : ''}`} onClick={(e) => pick(wallIds.map((id) => ({ kind: 'wall' as const, id })), e)}>
              <span className="tree-label">Room {i + 1}</span>
              <span className="tree-detail">{formatArea(r.area, units)}</span>
            </div>
          )
        })}
      </Group>
      <Group title="Walls" count={walls.length} defaultOpen={false}>
        {walls.map((w) => row({ kind: 'wall', id: w.id }, `Wall ${shortId(w.id)}`, formatLength(wallLength(plan, w), units)))}
      </Group>
      <Group title="Doors & windows" count={openings.length}>
        {openings.map((o) => row({ kind: 'opening', id: o.id }, `${o.kind === 'door' ? 'Door' : 'Window'} ${shortId(o.id)}`, formatLength(o.width, units)))}
      </Group>
      <Group title="Furniture" count={furniture.length}>
        {furniture.map((f) => row({ kind: 'furniture', id: f.id }, f.name, `${formatLength(f.width, units, false)} × ${formatLength(f.depth, units, false)}`))}
      </Group>
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
