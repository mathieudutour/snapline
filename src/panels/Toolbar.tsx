import { useRef } from 'react'
import { useEditor, type Tool, type ViewMode } from '../model/store'
import { normalizePlan } from '../model/store'

const TOOLS: { id: Tool; label: string; key: string; icon: string }[] = [
  { id: 'select', label: 'Select', key: 'V', icon: '↖' },
  { id: 'wall', label: 'Wall', key: 'W', icon: '▬' },
  { id: 'door', label: 'Door', key: 'D', icon: '◧' },
  { id: 'window', label: 'Window', key: 'N', icon: '▥' },
  { id: 'pan', label: 'Pan', key: 'H', icon: '✋' },
]

const MODES: { id: ViewMode; label: string }[] = [
  { id: 'plan', label: '2D plan' },
  { id: '3d', label: '3D' },
  { id: 'walk', label: 'Walkthrough' },
]

export function Toolbar() {
  const tool = useEditor((s) => s.tool)
  const mode = useEditor((s) => s.mode)
  const setTool = useEditor((s) => s.setTool)
  const setMode = useEditor((s) => s.setMode)
  const snapGrid = useEditor((s) => s.snapGrid)
  const setSnapGrid = useEditor((s) => s.setSnapGrid)
  const autoHV = useEditor((s) => s.autoHV)
  const setAutoHV = useEditor((s) => s.setAutoHV)
  const canUndo = useEditor((s) => s.undoStack.length > 0)
  const canRedo = useEditor((s) => s.redoStack.length > 0)
  const undo = useEditor((s) => s.undo)
  const redo = useEditor((s) => s.redo)
  const units = useEditor((s) => s.plan.settings.units)
  const setUnits = useEditor((s) => s.setUnits)
  const resetPlan = useEditor((s) => s.resetPlan)
  const loadExample = useEditor((s) => s.loadExample)
  const violations = useEditor((s) => s.report.violated.size)
  const toggleShortcuts = useEditor((s) => s.toggleShortcuts)
  const fileRef = useRef<HTMLInputElement>(null)

  const exportJson = () => {
    const plan = useEditor.getState().plan
    const blob = new Blob([JSON.stringify({ version: 1, ...plan }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'floorplan.json'
    a.click()
    URL.revokeObjectURL(url)
  }
  const importJson = (file: File) => {
    file.text().then((text) => {
      try {
        resetPlan(normalizePlan(JSON.parse(text)))
      } catch {
        alert('Could not read this file as a Snapline plan.')
      }
    })
  }

  return (
    <div className="toolbar">
      <div className="brand">
        <span className="brand-mark">◫</span> Snapline
      </div>
      <div className="seg">
        {MODES.map((m) => (
          <button key={m.id} className={mode === m.id ? 'active' : ''} onClick={() => setMode(m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      {mode === 'plan' && (
        <>
          <div className="seg">
            {TOOLS.map((t) => (
              <button key={t.id} className={tool === t.id ? 'active' : ''} onClick={() => setTool(t.id)} title={`${t.label} (${t.key})`}>
                <span className="icon">{t.icon}</span> {t.label} <kbd>{t.key}</kbd>
              </button>
            ))}
          </div>
          <div className="seg">
            <button disabled={!canUndo} onClick={undo} title="Undo (Ctrl+Z)">
              ↶ Undo
            </button>
            <button disabled={!canRedo} onClick={redo} title="Redo (Ctrl+Shift+Z)">
              ↷ Redo
            </button>
          </div>
          <label className="toggle" title="Snap to the 5 cm grid">
            <input type="checkbox" checked={snapGrid} onChange={(e) => setSnapGrid(e.target.checked)} /> Grid snap
          </label>
          <label className="toggle" title="Automatically lock walls drawn horizontally / vertically">
            <input type="checkbox" checked={autoHV} onChange={(e) => setAutoHV(e.target.checked)} /> Auto H/V
          </label>
          <div className="seg small">
            <button className={units === 'm' ? 'active' : ''} onClick={() => setUnits('m')}>
              m
            </button>
            <button className={units === 'cm' ? 'active' : ''} onClick={() => setUnits('cm')}>
              cm
            </button>
          </div>
        </>
      )}
      <div className="spacer" />
      {violations > 0 && (
        <div className="warn" title="Some constraints cannot all be satisfied at once">
          ⚠ {violations} conflicting constraint{violations > 1 ? 's' : ''}
          {canUndo && (
            <button className="warn-undo" onClick={undo} title="Undo the last change">
              Undo last change
            </button>
          )}
        </div>
      )}
      <div className="seg">
        <button
          onClick={() => {
            if (confirm('Start a new empty plan? The current plan will be kept in undo history.')) resetPlan()
          }}
        >
          New
        </button>
        <button onClick={loadExample}>Example</button>
        <button onClick={() => fileRef.current?.click()}>Import</button>
        <button onClick={exportJson}>Export</button>
      </div>
      <div className="seg">
        <button onClick={() => toggleShortcuts()} title="Keyboard shortcuts (?)">
          ?
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) importJson(f)
            e.target.value = ''
          }}
        />
      </div>
    </div>
  )
}
