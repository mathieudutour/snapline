import { isReadOnly, useEditor, type Tool } from '../model/store'

const TOOLS: { id: Tool; label: string; key: string; icon: string }[] = [
  { id: 'select', label: 'Select', key: 'V', icon: 'M5 3l14 8-6 2-3 6z' },
  { id: 'wall', label: 'Wall', key: 'W', icon: 'M3 10h18v4H3z' },
  { id: 'door', label: 'Door', key: 'D', icon: 'M4 20V5h10v15M14 5a8 8 0 0 1 6 8M4 20h16' },
  { id: 'window', label: 'Window', key: 'N', icon: 'M4 5h16v14H4zM12 5v14M4 12h16' },
  { id: 'furniture', label: 'Furniture', key: 'F', icon: 'M4 11V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3M3 11h18v6H3zM5 17v3M19 17v3' },
  { id: 'pan', label: 'Hand', key: 'H', icon: 'M8 13V5a1.5 1.5 0 0 1 3 0v6m0-7a1.5 1.5 0 0 1 3 0v7m0-5a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-3l-3-5a1.5 1.5 0 0 1 2.5-1.6L8 13' },
]

export function BottomBar() {
  const tool = useEditor((s) => s.tool)
  const setTool = useEditor((s) => s.setTool)
  const mode = useEditor((s) => s.mode)
  const canUndo = useEditor((s) => s.undoStack.length > 0)
  const canRedo = useEditor((s) => s.redoStack.length > 0)
  const undo = useEditor((s) => s.undo)
  const redo = useEditor((s) => s.redo)
  const readOnly = useEditor(isReadOnly)
  if (mode !== 'plan') return null
  if (readOnly)
    return (
      <div className="bottom-bar">
        {TOOLS.filter((t) => t.id === 'select' || t.id === 'pan').map((t) => (
          <button key={t.id} className={tool === t.id ? 'active' : ''} onClick={() => setTool(t.id)} title={`${t.label} (${t.key})`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={t.icon} />
            </svg>
            <span className="tool-key">{t.key}</span>
          </button>
        ))}
        <span className="bar-sep" />
        <span className="muted small view-only">View only</span>
      </div>
    )
  return (
    <div className="bottom-bar">
      {TOOLS.map((t) => (
        <button key={t.id} className={tool === t.id ? 'active' : ''} onClick={() => setTool(t.id)} title={`${t.label} (${t.key})`}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={t.icon} />
          </svg>
          <span className="tool-key">{t.key}</span>
        </button>
      ))}
      <span className="bar-sep" />
      <button disabled={!canUndo} onClick={undo} title="Undo (Ctrl+Z)">
        ↶
      </button>
      <button disabled={!canRedo} onClick={redo} title="Redo (Ctrl+Shift+Z)">
        ↷
      </button>
    </div>
  )
}
