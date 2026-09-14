import { useEditor, type ViewMode } from '../model/store'
import { SelectionInspector } from './Sidebar'
import { AccountButton } from './Account'
import { PeerAvatars } from '../editor/Peers'

const MODES: { id: ViewMode; label: string }[] = [
  { id: 'plan', label: '2D' },
  { id: '3d', label: '3D' },
  { id: 'walk', label: 'Walk' },
]

export function Inspector() {
  const mode = useEditor((s) => s.mode)
  const setMode = useEditor((s) => s.setMode)
  const zoom = useEditor((s) => s.zoomLevel)
  const requestFit = useEditor((s) => s.requestFit)
  const cutAboveActive = useEditor((s) => s.cutAboveActive)
  const setCutAboveActive = useEditor((s) => s.setCutAboveActive)
  const activeFloor = useEditor((s) => s.project.floors.find((f) => f.id === s.activeFloorId)?.name)
  const violations = useEditor((s) => s.report.violated.size)
  const canUndo = useEditor((s) => s.undoStack.length > 0)
  const undo = useEditor((s) => s.undo)
  return (
    <aside className="inspector">
      <div className="inspector-head">
        <div className="seg">
          {MODES.map((m) => (
            <button key={m.id} className={mode === m.id ? 'active' : ''} onClick={() => setMode(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
        {mode === 'plan' && (
          <button className="zoom" onClick={requestFit} title="Zoom to fit (Shift+1)">
            {Math.round(zoom)}%
          </button>
        )}
        <PeerAvatars />
        <AccountButton />
      </div>
      <div className="panel-scroll">
        {violations > 0 && (
          <div className="props warn-box">
            ⚠ {violations} conflicting constraint{violations > 1 ? 's' : ''}
            {canUndo && (
              <button className="warn-undo" onClick={undo}>
                Undo last change
              </button>
            )}
          </div>
        )}
        {mode === 'plan' && <SelectionInspector />}
        {mode === '3d' && (
          <div className="props">
            <h3>3D view</h3>
            <label className="toggle block">
              <input type="checkbox" checked={cutAboveActive} onChange={(e) => setCutAboveActive(e.target.checked)} /> Cut above {activeFloor ?? 'the current floor'}
            </label>
            <p className="muted small">Drag to orbit, right-drag to pan, scroll to zoom. Pick the floor to cut at in the Floors list.</p>
          </div>
        )}
        {mode === 'walk' && (
          <div className="props">
            <h3>Walkthrough</h3>
            <p className="muted small">
              You are on <strong>{activeFloor}</strong>. Click the view to capture the mouse, move with WASD or the arrow keys, hold Shift to run, Esc to release. Pick another floor in the Floors list.
            </p>
          </div>
        )}
      </div>
    </aside>
  )
}
