import { isReadOnly, useEditor, type ViewMode } from '../model/store'
import { SelectionInspector } from './Sidebar'
import { SunControls } from './Sun'
import { COARSE_POINTER_QUERY, useMedia } from './useMedia'

const MODES: { id: ViewMode; label: string }[] = [
  { id: 'plan', label: '2D plan' },
  { id: '3d', label: '3D' },
  { id: 'walk', label: 'Walk' },
]

/**
 * The inspector is about the selection. Its header carries the 2D/3D/Walk switch and
 * nothing else: presence, the account and the zoom readout are app- and view-level, and
 * live on the canvas (see CanvasChrome). Conflicts are reported next to the conflict, not
 * as a red box up here.
 */
export function Inspector() {
  const mode = useEditor((s) => s.mode)
  const setMode = useEditor((s) => s.setMode)
  const cutAboveActive = useEditor((s) => s.cutAboveActive)
  const setCutAboveActive = useEditor((s) => s.setCutAboveActive)
  const activeFloor = useEditor((s) => s.project.floors.find((f) => f.id === s.activeFloorId)?.name)
  const floors = useEditor((s) => s.project.floors)
  const activeFloorId = useEditor((s) => s.activeFloorId)
  const setActiveFloor = useEditor((s) => s.setActiveFloor)
  const readOnly = useEditor(isReadOnly)
  const coarse = useMedia(COARSE_POINTER_QUERY)
  const modes = coarse ? MODES.filter((m) => m.id !== 'walk') : MODES // the walkthrough needs a mouse and a keyboard
  return (
    <aside className="inspector">
      <div className="inspector-head">
        <div className="seg">
          {modes.map((m) => (
            <button key={m.id} className={mode === m.id ? 'active' : ''} onClick={() => setMode(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div className="panel-scroll">
        {mode === 'plan' && readOnly && <p className="props muted small">View only: you can look around, switch floors and open the 3D views, but not change the plan.</p>}
        {mode === 'plan' && (
          <fieldset className="plain" disabled={readOnly}>
            <SelectionInspector />
          </fieldset>
        )}
        {mode === '3d' && (
          <div className="props">
            <h3>3D view</h3>
            <label className="toggle block">
              <span>Cut above {activeFloor ?? 'the current floor'}</span>
              <input className="switch" type="checkbox" checked={cutAboveActive} onChange={(e) => setCutAboveActive(e.target.checked)} />
            </label>
            <p className="muted small">Drag to orbit, right-drag to pan, scroll to zoom. Pick the floor to cut at in the Floors list.</p>
          </div>
        )}
        {(mode === '3d' || mode === 'walk') && <SunControls />}
        {mode === 'walk' && (
          <div className="props">
            <h3>Walkthrough</h3>
            {floors.length > 1 && (
              <label className="field">
                <span>Floor</span>
                <select value={activeFloorId} onChange={(e) => setActiveFloor(e.target.value)}>
                  {[...floors].reverse().map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <p className="muted small">
              You are on <strong>{activeFloor}</strong>. Click the view to capture the mouse, move with WASD or the arrow keys, hold Shift to run, Esc to release.
            </p>
          </div>
        )}
      </div>
    </aside>
  )
}
