import { useMemo } from 'react'
import { isReadOnly, isSelected, useEditor } from '../model/store'
import { DEFAULT_FINISHES, FINISH_BY_KEY, finishesFor, type FinishUse } from '../model/finishes'
import { findRooms } from '../model/geometry'
import { readingOrder, roomIsNamed, roomLabel, roomName } from '../model/rooms'

/** a select over the finishes for one use, with a swatch of the chosen one */
/** `mixed`: the selected items have different finishes; the select shows "Mixed" until one is picked */
export function FinishSelect({ use, value, onChange, allowDefault, mixed }: { use: FinishUse; value: string | undefined; onChange: (key: string | undefined) => void; allowDefault?: string; mixed?: boolean }) {
  const readOnly = useEditor(isReadOnly)
  const current = value ? FINISH_BY_KEY[value] : undefined
  return (
    <span className="finish-select">
      <span className="swatch" style={{ background: mixed ? 'linear-gradient(135deg, #bbb 50%, #eee 50%)' : (current ?? FINISH_BY_KEY[DEFAULT_FINISHES[use]]).color }} />
      <select value={mixed ? '__mixed' : (value ?? '')} disabled={readOnly} onChange={(e) => e.target.value !== '__mixed' && onChange(e.target.value || undefined)}>
        {mixed && (
          <option value="__mixed" disabled>
            Mixed
          </option>
        )}
        {allowDefault && <option value="">{allowDefault}</option>}
        {finishesFor(use).map((f) => (
          <option key={f.key} value={f.key}>
            {f.name}
          </option>
        ))}
      </select>
    </span>
  )
}

/**
 * The finishes schedule: every room on the floor, in reading order, with its floor and walls.
 * It is a view of rooms, not an object — the exterior finish is on the Building, the roof's on
 * the Roof — and a room's name selects the room, so the table and the tree agree on a click.
 */
export function FinishesProps() {
  const plan = useEditor((s) => s.plan)
  const selection = useEditor((s) => s.selection)
  const select = useEditor((s) => s.select)
  const setRoomFinish = useEditor((s) => s.setRoomFinish)
  // in reading order on the plan, the same order as the Plan tree, so a row's position means something
  const rooms = useMemo(() => readingOrder(findRooms(plan)), [plan])
  return (
    <div className="props">
      <h3>Finishes</h3>
      {rooms.length === 0 && <p className="muted small">Close a loop of walls to create a room; its floor and walls are set here.</p>}
      {rooms.length > 0 && (
        <div className="finish-rows">
          <div className="finish-row head">
            <span className="picks">
              <span>Floor</span>
              <span>Walls</span>
            </span>
          </div>
          {rooms.map(({ room: r, index: i }) => {
            const label = roomLabel(plan, r)
            return (
              <div key={r.id} className="finish-row">
                <button className={`link room-link ${roomIsNamed(plan, r) ? '' : 'provisional'} ${isSelected(selection, 'room', r.id) ? 'on' : ''}`} onClick={() => select([{ kind: 'room', id: r.id }])} title="Select this room">
                  {roomName(plan, r, i)}
                </button>
                <span className="picks">
                  <FinishSelect use="floor" value={label?.floor} allowDefault="Default" onChange={(v) => setRoomFinish(r, { floor: v })} />
                  <FinishSelect use="wall" value={label?.wall} allowDefault="Default" onChange={(v) => setRoomFinish(r, { wall: v })} />
                </span>
              </div>
            )
          })}
        </div>
      )}
      <p className="muted small">A wall's own finish (select the wall) overrides its rooms'. The exterior finish is on the Building, the roof's on the Roof.</p>
    </div>
  )
}
