import { useEffect, useRef, useState } from 'react'
import { useEditor } from '../model/store'
import { Hierarchy } from './Hierarchy'
import { CataloguePanel } from './Sidebar'
import { navigate } from '../router'

function ProjectMenu() {
  const project = useEditor((s) => s.project)
  const renameProject = useEditor((s) => s.renameProject)
  const deleteProject = useEditor((s) => s.deleteProject)
  const importProject = useEditor((s) => s.importProject)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])
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
  return (
    <div className="popover-anchor project-head" ref={ref}>
      <button className="project-name" onClick={() => setOpen((o) => !o)} title="Project menu">
        {project.name} <span className="chev">▾</span>
      </button>
      {open && (
        <div className="menu">
          <button className="menu-item" onClick={() => (navigate('/projects'), setOpen(false))}>
            All projects…
          </button>
          <div className="menu-sep" />
          <button
            className="menu-item"
            onClick={() => {
              const name = prompt('Project name', project.name)
              if (name) renameProject(name)
              setOpen(false)
            }}
          >
            Rename…
          </button>
          <button className="menu-item" onClick={() => (fileRef.current?.click(), setOpen(false))}>
            Import…
          </button>
          <button className="menu-item" onClick={() => (exportJson(), setOpen(false))}>
            Export
          </button>
          <div className="menu-sep" />
          <button
            className="menu-item danger"
            onClick={() => {
              if (confirm(`Delete project "${project.name}"? This cannot be undone.`)) deleteProject(project.id)
              setOpen(false)
            }}
          >
            Delete project
          </button>
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) f.text().then((t) => importProject(JSON.parse(t))).catch(() => alert('Could not read this file as a Snapline project.'))
          e.target.value = ''
        }}
      />
    </div>
  )
}

function FloorsList() {
  const project = useEditor((s) => s.project)
  const activeFloorId = useEditor((s) => s.activeFloorId)
  const setActiveFloor = useEditor((s) => s.setActiveFloor)
  const addFloor = useEditor((s) => s.addFloor)
  const duplicateFloor = useEditor((s) => s.duplicateFloor)
  const removeFloor = useEditor((s) => s.removeFloor)
  const renameFloor = useEditor((s) => s.renameFloor)
  const rename = (id: string, current: string) => {
    const name = prompt('Floor name', current)
    if (name && name.trim()) renameFloor(id, name.trim())
  }
  // top floor first, like a building
  const floors = [...project.floors].reverse()
  return (
    <div className="section">
      <div className="section-head">
        <span>Floors</span>
        <button className="icon-btn" onClick={addFloor} title="Add a floor on top">
          +
        </button>
      </div>
      {floors.map((f) => (
        <div key={f.id} className={`floor-row ${f.id === activeFloorId ? 'on' : ''}`} onClick={() => setActiveFloor(f.id)} onDoubleClick={() => rename(f.id, f.name)} title="Double-click to rename · PageUp / PageDown">
          <span className="tree-label">{f.name}</span>
          <span className="row-actions">
            <button className="icon-btn" title="Duplicate above" onClick={(e) => (e.stopPropagation(), duplicateFloor(f.id))}>
              ⧉
            </button>
            <button
              className="icon-btn"
              title="Remove floor"
              disabled={project.floors.length <= 1}
              onClick={(e) => {
                e.stopPropagation()
                if (confirm(`Remove "${f.name}" and everything on it?`)) removeFloor(f.id)
              }}
            >
              ✕
            </button>
          </span>
        </div>
      ))}
    </div>
  )
}

export function LeftPanel() {
  const railTab = useEditor((s) => s.railTab)
  return (
    <aside className="left-panel">
      <ProjectMenu />
      {railTab === 'furniture' ? (
        <div className="panel-scroll">
          <CataloguePanel />
        </div>
      ) : (
        <div className="panel-scroll">
          <FloorsList />
          <div className="section">
            <div className="section-head">
              <span>Layers</span>
            </div>
            <Hierarchy />
          </div>
        </div>
      )}
    </aside>
  )
}
