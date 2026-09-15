import { useMemo } from 'react'
import { isReadOnly, useEditor } from '../model/store'
import { DEFAULT_FINISHES, FINISH_BY_KEY, finishesFor, type FinishUse } from '../model/finishes'
import { findRooms } from '../model/geometry'
import { roomLabel, roomName } from '../model/rooms'

/** a select over the finishes for one use, with a swatch of the chosen one */
export function FinishSelect({ use, value, onChange, allowDefault }: { use: FinishUse; value: string | undefined; onChange: (key: string | undefined) => void; allowDefault?: string }) {
  const readOnly = useEditor(isReadOnly)
  const current = value ? FINISH_BY_KEY[value] : undefined
  return (
    <span className="finish-select">
      <span className="swatch" style={{ background: (current ?? FINISH_BY_KEY[DEFAULT_FINISHES[use]]).color }} />
      <select value={value ?? ''} disabled={readOnly} onChange={(e) => onChange(e.target.value || undefined)}>
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

/** exterior and roof finishes, and per-room floors and walls of the active floor */
export function FinishesProps() {
  const plan = useEditor((s) => s.plan)
  const finishes = useEditor((s) => s.project.finishes)
  const setProjectFinishes = useEditor((s) => s.setProjectFinishes)
  const setRoomFinish = useEditor((s) => s.setRoomFinish)
  const roofType = useEditor((s) => s.project.roof.type)
  const rooms = useMemo(() => findRooms(plan), [plan])
  return (
    <div className="props">
      <h3>Finishes</h3>
      <label className="field">
        <span>Exterior walls</span>
        <FinishSelect use="exterior" value={finishes?.exterior ?? DEFAULT_FINISHES.exterior} onChange={(v) => setProjectFinishes({ exterior: v })} />
      </label>
      {roofType !== 'none' && (
        <label className="field">
          <span>Roof</span>
          <FinishSelect use="roof" value={finishes?.roof ?? DEFAULT_FINISHES.roof} onChange={(v) => setProjectFinishes({ roof: v })} />
        </label>
      )}
      {rooms.length > 0 && (
        <table className="finish-table">
          <thead>
            <tr>
              <th>Room</th>
              <th>Floor</th>
              <th>Walls</th>
            </tr>
          </thead>
          <tbody>
            {rooms.map((r, i) => {
              const label = roomLabel(plan, r)
              return (
                <tr key={r.id}>
                  <td>{roomName(plan, r, i)}</td>
                  <td>
                    <FinishSelect use="floor" value={label?.floor} allowDefault="Default" onChange={(v) => setRoomFinish(r, { floor: v })} />
                  </td>
                  <td>
                    <FinishSelect use="wall" value={label?.wall} allowDefault="Default" onChange={(v) => setRoomFinish(r, { wall: v })} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <p className="muted small">Floors and room walls are set per room; a wall's own finish (select the wall) overrides its rooms. Faces with no room behind them use the exterior finish.</p>
    </div>
  )
}
