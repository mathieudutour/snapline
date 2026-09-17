import { useMemo, useState } from 'react'
import { isReadOnly, isSelected, ROOF_ITEM, useEditor, type SelectionItem } from '../model/store'
import { floorArea, readingOrder, roomIsNamed, roomName, roomNameSuggestions } from '../model/rooms'
import { findRooms, pointInPolygon, wallLength } from '../model/geometry'
import { constraintsReferencing, constraintTargets, describeConstraint, shortId } from '../model/constraints'
import { formatArea, formatLength } from '../model/units'
import type { Constraint, Furniture, Opening, Wall } from '../model/types'
import { Icon, LockIcon, WarningIcon } from '../brand/Icons'
import { InlineRename } from './Confirm'

function Group({
  title,
  count,
  children,
  defaultOpen = true,
  depth = 0,
  detail,
  selected,
  onSelect,
  renaming,
  onStartRename,
  onRename,
  onCancelRename,
  suggestions,
  provisional,
}: {
  title: string
  count: number
  children: React.ReactNode
  defaultOpen?: boolean
  depth?: number
  detail?: React.ReactNode
  selected?: boolean
  onSelect?: (e: React.MouseEvent) => void
  renaming?: boolean
  onStartRename?: () => void
  onRename?: (name: string) => void
  onCancelRename?: () => void
  suggestions?: string[]
  /** the title is a placeholder, not a name */
  provisional?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={`tree-group depth-${depth}`}>
      <div className={`tree-head ${selected ? 'on' : ''}`} style={{ paddingLeft: 12 + depth * 14 }} onClick={onSelect} onDoubleClick={onStartRename} title={onStartRename ? 'Double-click to rename' : undefined}>
        <button
          className={`chevron ${open ? 'open' : ''}`}
          onClick={(e) => {
            e.stopPropagation()
            setOpen((o) => !o)
          }}
          aria-label={open ? 'Collapse' : 'Expand'}
        >
          <Icon name="chevronRight" size={12} strokeWidth={2.2} />
        </button>
        {renaming && onRename && onCancelRename ? (
          <InlineRename value={title} onCommit={onRename} onCancel={onCancelRename} suggestions={suggestions} />
        ) : (
          <>
            <span className={`tree-label ${provisional ? 'provisional' : ''}`}>{title}</span>
            {detail !== undefined ? <span className="tree-detail">{detail}</span> : <span className="count">{count}</span>}
          </>
        )}
      </div>
      {open && <div className="tree-items">{children}</div>}
    </div>
  )
}

/** rooms (in reading order, ids stable) with their walls, openings and furniture, what is outside any room, and the roof on the top floor */
export function PlanTree() {
  const plan = useEditor((s) => s.plan)
  const selection = useEditor((s) => s.selection)
  const select = useEditor((s) => s.select)
  const units = useEditor((s) => s.units)
  const rooms = useMemo(() => findRooms(plan), [plan])
  const underlay = useEditor((s) => s.project.floors.find((f) => f.id === s.activeFloorId)?.underlay)
  const nameRoom = useEditor((s) => s.nameRoom)
  const readOnly = useEditor(isReadOnly)
  const [renamingRoom, setRenamingRoom] = useState<string | null>(null)
  // the roof is one object per building, sitting on the top floor: it is listed there and selected like anything else
  const roof = useEditor((s) => s.project.roof)
  const onTopFloor = useEditor((s) => s.project.floors[s.project.floors.length - 1]?.id === s.activeFloorId)
  const walls = Object.values(plan.walls)
  const openings = Object.values(plan.openings)
  const furniture = Object.values(plan.furniture)

  const pick = (items: SelectionItem[], e: React.MouseEvent) => select(items, e.shiftKey)

  // membership: a wall belongs to every room it bounds; an opening to its wall's rooms; furniture to the room containing its centre.
  // Rooms are listed in reading order on the plan — top-left to bottom-right — so a row's place in the list means something.
  // A placeholder name carries the geometric index, so "Room 4" keeps its name wherever it lands.
  const roomsWithContent = readingOrder(rooms).map(({ room: r, index }) => {
    const roomWalls = walls.filter((w) => r.pointIds.includes(w.a) && r.pointIds.includes(w.b))
    const wallIds = new Set(roomWalls.map((w) => w.id))
    return {
      room: r,
      index,
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
    <div key={'wall' + w.id} className={`tree-row ${isSelected(selection, 'wall', w.id) ? 'on' : ''}`} style={{ paddingLeft: 12 + depth * 14 }} onClick={(e) => pick([{ kind: 'wall', id: w.id }], e)}>
      <span className="tree-icon">
        <Icon name="wall" size={13} strokeWidth={2} />
      </span>
      <span className="tree-label">Wall {shortId(w.id)}</span>
      <span className="tree-detail">{formatLength(wallLength(plan, w), units)}</span>
    </div>
  )
  const openingRow = (o: Opening, depth: number) => (
    <div key={'op' + o.id} className={`tree-row ${isSelected(selection, 'opening', o.id) ? 'on' : ''}`} style={{ paddingLeft: 12 + depth * 14 }} onClick={(e) => pick([{ kind: 'opening', id: o.id }], e)}>
      <span className="tree-icon">
        <Icon name={o.kind === 'door' ? 'door' : 'window'} size={13} strokeWidth={2} />
      </span>
      <span className="tree-label">
        {o.kind === 'door' ? 'Door' : 'Window'} {shortId(o.id)}
      </span>
      <span className="tree-detail">{formatLength(o.width, units)}</span>
    </div>
  )
  const furnitureRow = (f: Furniture, depth: number) => (
    <div key={'f' + f.id} className={`tree-row ${isSelected(selection, 'furniture', f.id) ? 'on' : ''}`} style={{ paddingLeft: 12 + depth * 14 }} onClick={(e) => pick([{ kind: 'furniture', id: f.id }], e)}>
      <span className="tree-icon">
        <Icon name="furnitureSmall" size={13} strokeWidth={2} />
      </span>
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
      {rooms.length > 0 && (
        <div className="tree-total">
          <span>Floor area</span>
          <span className="tree-detail">
            {formatArea(floorArea(rooms), units)} · {rooms.length} room{rooms.length > 1 ? 's' : ''}
          </span>
        </div>
      )}
      {roomsWithContent.map((r) => {
        const on = isSelected(selection, 'room', r.room.id)
        return (
          <Group
            key={r.room.id}
            title={roomName(plan, r.room, r.index)}
            provisional={!roomIsNamed(plan, r.room)}
            count={0}
            detail={formatArea(r.room.area, units)}
            selected={on}
            onSelect={(e) => pick([{ kind: 'room' as const, id: r.room.id }], e)}
            renaming={renamingRoom === r.room.id}
            onStartRename={readOnly ? undefined : () => setRenamingRoom(r.room.id)}
            onRename={(name) => (nameRoom(r.room, name), setRenamingRoom(null))}
            onCancelRename={() => setRenamingRoom(null)}
            suggestions={renamingRoom === r.room.id ? roomNameSuggestions(underlay, r.room) : undefined}
          >
            {contents(r, 1)}
          </Group>
        )
      })}
      {(outside.walls.length > 0 || outside.openings.length > 0 || outside.furniture.length > 0) && (
        <Group title="Outside rooms" count={outside.walls.length + outside.openings.length + outside.furniture.length} defaultOpen={rooms.length === 0}>
          {contents(outside, 1)}
        </Group>
      )}
      {onTopFloor && (
        <div className={`tree-row ${isSelected(selection, 'roof', 'roof') ? 'on' : ''}`} onClick={() => select([ROOF_ITEM])} title="The roof covers this floor's outline">
          <span className="tree-icon">
            <Icon name="roof" size={13} strokeWidth={2} />
          </span>
          <span className="tree-label">Roof</span>
          <span className="tree-detail">{describeRoof(roof)}</span>
        </div>
      )}
    </div>
  )
}

/** "Gable 35°", "Flat", "None" */
export function describeRoof(roof: { type: string; pitch: number }): string {
  if (roof.type === 'none') return 'None'
  const name = roof.type[0].toUpperCase() + roof.type.slice(1)
  return roof.type === 'flat' ? name : `${name} ${Math.round(roof.pitch)}°`
}

/**
 * Every rule on the floor, as a view of its own. A row under the pointer lights the geometry
 * it is about and draws its badge on the plan — the badges used to sit on every wall by
 * default, which made forty rules look like clutter instead of the feature they are.
 * "Rule" is what the user typed; "constraint" is the maths underneath it.
 */
export function RulesList() {
  const plan = useEditor((s) => s.plan)
  const selection = useEditor((s) => s.selection)
  const select = useEditor((s) => s.select)
  const violated = useEditor((s) => s.report.violated)
  const removeConstraint = useEditor((s) => s.removeConstraint)
  const setHoverRule = useEditor((s) => s.setHoverRule)
  const readOnly = useEditor(isReadOnly)
  const constraints = Object.values(plan.constraints)
  // the ones that cannot hold first: they are the ones you came here for
  const ordered = [...constraints].sort((a, b) => Number(violated.has(b.id)) - Number(violated.has(a.id)))
  const constraintSelected = (c: Constraint) =>
    constraintsReferencing(plan, {
      walls: selection.filter((s) => s.kind === 'wall').map((s) => s.id),
      points: selection.filter((s) => s.kind === 'point').map((s) => s.id),
      openings: selection.filter((s) => s.kind === 'opening').map((s) => s.id),
      furniture: selection.filter((s) => s.kind === 'furniture').map((s) => s.id),
    }).some((x) => x.id === c.id)
  return (
    <div className="tree">
      {constraints.length === 0 && <div className="tree-empty">Select a wall and lock its length in the inspector, or ⌥ + click a measurement on the plan and type a value.</div>}
      {constraints.length > 0 && (
        <div className="tree-total">
          <span>Rules</span>
          <span className="tree-detail">
            {constraints.length}
            {violated.size > 0 && ` · ${violated.size} can't hold`}
          </span>
        </div>
      )}
      {ordered.map((c) => (
        <div
          key={c.id}
          className={`tree-row ${violated.has(c.id) ? 'bad' : ''} ${constraintSelected(c) ? 'on' : ''}`}
          onClick={(e) => select(constraintTargets(c), e.shiftKey)}
          onPointerEnter={() => setHoverRule(c.id)}
          onPointerLeave={() => setHoverRule(null)}
          title="Hover to see it on the plan · click to select what it holds"
        >
          <span className="tree-icon">{violated.has(c.id) ? <WarningIcon size={13} strokeWidth={2} /> : <LockIcon size={13} strokeWidth={2} />}</span>
          <span className="tree-label">{describeConstraint(plan, c)}</span>
          {!readOnly && (
            <button
              className="x"
              title="Drop this rule"
              onClick={(e) => {
                e.stopPropagation()
                removeConstraint(c.id)
              }}
            >
              <Icon name="close" size={12} strokeWidth={2} />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

/** the comments pinned on this floor's plan */
export function NotesList() {
  const plan = useEditor((s) => s.plan)
  const comments = useMemo(() => Object.values(plan.comments ?? {}).sort((a, b) => a.createdAt - b.createdAt), [plan])
  const openComment = useEditor((s) => s.openComment)
  const setOpenComment = useEditor((s) => s.setOpenComment)
  const showResolved = useEditor((s) => s.showResolved)
  const setShowResolved = useEditor((s) => s.setShowResolved)
  const setMode = useEditor((s) => s.setMode)
  return (
    <div className="tree">
      {comments.length === 0 && <div className="tree-empty">Press C and click on the plan to pin a comment.</div>}
      {comments
        .filter((c) => showResolved || !c.resolved)
        .map((c) => (
          <div key={c.id} className={`tree-row comment ${c.resolved ? 'resolved' : ''} ${openComment === c.id ? 'on' : ''}`} onClick={() => (setMode('plan'), setOpenComment(openComment === c.id ? null : c.id))}>
            <span className="tree-icon">
              <Icon name={c.resolved ? 'check' : 'comment'} size={13} strokeWidth={2} />
            </span>
            <span className="tree-label">
              <b>{c.author.name}</b> {c.text.length > 60 ? c.text.slice(0, 60) + '…' : c.text}
              {c.replies.length > 0 && (
                <span className="muted">
                  {' '}
                  · {c.replies.length} repl{c.replies.length > 1 ? 'ies' : 'y'}
                </span>
              )}
            </span>
          </div>
        ))}
      {comments.some((c) => c.resolved) && (
        <label className="toggle block tree-empty">
          <span>Show resolved</span>
          <input className="switch" type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
        </label>
      )}
    </div>
  )
}
