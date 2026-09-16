import { useEditor } from '../model/store'
import { UNIT_LABELS, type Units } from '../model/units'
import { Icon } from '../brand/Icons'

export function PreferencesPanel() {
  const units = useEditor((s) => s.units)
  const setUnits = useEditor((s) => s.setUnits)
  const snapGrid = useEditor((s) => s.snapGrid)
  const setSnapGrid = useEditor((s) => s.setSnapGrid)
  const autoHV = useEditor((s) => s.autoHV)
  const setAutoHV = useEditor((s) => s.setAutoHV)
  const showFloorBelow = useEditor((s) => s.showFloorBelow)
  const setShowFloorBelow = useEditor((s) => s.setShowFloorBelow)
  const setPrefsOpen = useEditor((s) => s.setPrefsOpen)
  return (
    <div className="prefs" onPointerDown={(e) => e.stopPropagation()}>
      <div className="panel-head">
        <strong>Preferences</strong>
        <button className="x" onClick={() => setPrefsOpen(false)} title="Close">
          <Icon name="close" size={15} strokeWidth={2} />
        </button>
      </div>
      <div className="props">
        <h4>Units</h4>
        {(Object.keys(UNIT_LABELS) as Units[]).map((u) => (
          <label key={u} className="radio">
            <input type="radio" name="units" checked={units === u} onChange={() => setUnits(u)} /> {UNIT_LABELS[u]}
          </label>
        ))}
        <p className="muted small">Lengths are stored in metres, so switching units never changes the plan.</p>
      </div>
      <div className="props">
        <h4>Drawing</h4>
        <label className="toggle block">
          <span>Snap to the 5 cm grid</span>
          <input className="switch" type="checkbox" checked={snapGrid} onChange={(e) => setSnapGrid(e.target.checked)} />
        </label>
        <label className="toggle block">
          <span>Auto-lock straight walls and furniture dropped against walls</span>
          <input className="switch" type="checkbox" checked={autoHV} onChange={(e) => setAutoHV(e.target.checked)} />
        </label>
        <label className="toggle block">
          <span>Show the floor below as a ghost</span>
          <input className="switch" type="checkbox" checked={showFloorBelow} onChange={(e) => setShowFloorBelow(e.target.checked)} />
        </label>
      </div>
    </div>
  )
}
