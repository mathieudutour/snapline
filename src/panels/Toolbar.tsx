import { useEffect, useRef, useState } from 'react'
import { useEditor, type Tool, type ViewMode } from '../model/store'

const TOOLS: { id: Tool; label: string; key: string; icon: string }[] = [
  { id: 'select', label: 'Select', key: 'V', icon: '↖' },
  { id: 'wall', label: 'Wall', key: 'W', icon: '▬' },
  { id: 'door', label: 'Door', key: 'D', icon: '◧' },
  { id: 'window', label: 'Window', key: 'N', icon: '▥' },
  { id: 'furniture', label: 'Furniture', key: 'F', icon: '🛋' },
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
  const loadExample = useEditor((s) => s.loadExample)
  const project = useEditor((s) => s.project)
  const projects = useEditor((s) => s.projects)
  const newProject = useEditor((s) => s.newProject)
  const openProject = useEditor((s) => s.openProject)
  const deleteProject = useEditor((s) => s.deleteProject)
  const renameProject = useEditor((s) => s.renameProject)
  const importProject = useEditor((s) => s.importProject)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menuOpen) return
    const close = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [menuOpen])
  const violations = useEditor((s) => s.report.violated.size)
  const toggleShortcuts = useEditor((s) => s.toggleShortcuts)
  const fileRef = useRef<HTMLInputElement>(null)

  const exportJson = () => {
    const current = useEditor.getState().project
    const blob = new Blob([JSON.stringify({ version: 2, ...current }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${current.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'project'}.snapline.json`
    a.click()
    URL.revokeObjectURL(url)
  }
  const importJson = (file: File) => {
    file.text().then((text) => {
      try {
        importProject(JSON.parse(text))
      } catch {
        alert('Could not read this file as a Snapline project.')
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
          <label className="toggle" title="Automatically lock walls drawn horizontally / vertically, and furniture dropped against a wall">
            <input type="checkbox" checked={autoHV} onChange={(e) => setAutoHV(e.target.checked)} /> Auto-lock
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
      <div className="project-menu" ref={menuRef}>
        <button className="project-name" onClick={() => setMenuOpen((o) => !o)} title="Projects">
          📁 {project.name} ▾
        </button>
        {menuOpen && (
          <div className="menu">
            <div className="menu-title">Projects</div>
            {projects.map((p) => (
              <button key={p.id} className={p.id === project.id ? 'menu-item on' : 'menu-item'} onClick={() => (openProject(p.id), setMenuOpen(false))}>
                {p.name}
              </button>
            ))}
            <div className="menu-sep" />
            <button className="menu-item" onClick={() => (newProject(), setMenuOpen(false))}>
              New project
            </button>
            <button
              className="menu-item"
              onClick={() => {
                const name = prompt('Project name', project.name)
                if (name) renameProject(name)
                setMenuOpen(false)
              }}
            >
              Rename…
            </button>
            <button className="menu-item" onClick={() => (loadExample(), setMenuOpen(false))}>
              Load example house
            </button>
            <button className="menu-item" onClick={() => (fileRef.current?.click(), setMenuOpen(false))}>
              Import…
            </button>
            <button className="menu-item" onClick={() => (exportJson(), setMenuOpen(false))}>
              Export
            </button>
            <div className="menu-sep" />
            <button
              className="menu-item danger"
              onClick={() => {
                if (confirm(`Delete project "${project.name}"? This cannot be undone.`)) deleteProject(project.id)
                setMenuOpen(false)
              }}
            >
              Delete project
            </button>
          </div>
        )}
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
