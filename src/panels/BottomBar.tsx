import { isReadOnly, useEditor, type Tool } from '../model/store'
import { Icon, type IconName } from '../brand/Icons'

const TOOLS: { id: Tool; label: string; key: string; icon: IconName }[] = [
  { id: 'select', label: 'Select', key: 'V', icon: 'select' },
  { id: 'wall', label: 'Wall', key: 'W', icon: 'wall' },
  { id: 'door', label: 'Door', key: 'D', icon: 'door' },
  { id: 'window', label: 'Window', key: 'N', icon: 'window' },
  { id: 'furniture', label: 'Furniture', key: 'F', icon: 'furniture' },
  { id: 'comment', label: 'Comment', key: 'C', icon: 'comment' },
  { id: 'pan', label: 'Hand', key: 'H', icon: 'hand' },
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
  const shown = readOnly ? TOOLS.filter((t) => t.id === 'select' || t.id === 'pan') : TOOLS
  return (
    <div className="bottom-bar">
      {shown.map((t) => (
        <button key={t.id} className={tool === t.id ? 'active' : ''} onClick={() => setTool(t.id)} title={`${t.label} (${t.key})`}>
          <Icon name={t.icon} size={20} title={t.label} />
          <span className="tool-key">{t.key}</span>
        </button>
      ))}
      <span className="bar-sep" />
      {readOnly ? (
        <span className="view-only">View only</span>
      ) : (
        <>
          <button disabled={!canUndo} onClick={undo} title="Undo (Ctrl+Z)">
            <Icon name="undo" size={18} strokeWidth={1.9} title="Undo" />
          </button>
          <button disabled={!canRedo} onClick={redo} title="Redo (Ctrl+Shift+Z)">
            <Icon name="redo" size={18} strokeWidth={1.9} title="Redo" />
          </button>
        </>
      )}
    </div>
  )
}
