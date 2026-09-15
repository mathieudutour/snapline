import { useEffect, useRef, useState } from 'react'
import { isReadOnly, useEditor } from '../model/store'
import { Hierarchy } from './Hierarchy'
import { CataloguePanel } from './Sidebar'
import { ShareDialog } from './Share'
import { ExportDialog } from './Export'
import { navigate } from '../router'

function ProjectMenu() {
  const project = useEditor((s) => s.project)
  const renameProject = useEditor((s) => s.renameProject)
  const deleteProject = useEditor((s) => s.deleteProject)
  const importProject = useEditor((s) => s.importProject)
  const user = useEditor((s) => s.user)
  const meta = useEditor((s) => s.projects.find((p) => p.id === s.project.id))
  const viewLink = useEditor((s) => s.viewLink)
  const readOnly = useEditor(isReadOnly)
  const isEditor = meta?.role === 'editor' || meta?.role === 'viewer'
  const [open, setOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
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
  return (
    <div className="popover-anchor project-head" ref={ref}>
      <button className="project-name" onClick={() => setOpen((o) => !o)} title="Project menu">
        {project.name}{' '}
        {viewLink ? <span className="badge">view only · by {viewLink.owner.name || viewLink.owner.email}</span> : readOnly ? <span className="badge">view only</span> : isEditor ? <span className="badge">shared with you</span> : meta?.memberCount || meta?.viewToken ? <span className="badge">shared</span> : null}{' '}
        <span className="chev">▾</span>
      </button>
      {open && (
        <div className="menu">
          <button className="menu-item" onClick={() => (navigate(viewLink ? '/' : '/projects'), setOpen(false))}>
            {viewLink ? 'My projects…' : 'All projects…'}
          </button>
          <div className="menu-sep" />
          {!readOnly && (
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
          )}
          {user && !viewLink && (
            <button className="menu-item" onClick={() => (setShareOpen(true), setOpen(false))}>
              {readOnly ? 'Shared with…' : 'Share…'}
            </button>
          )}
          {!readOnly && (
            <button className="menu-item" onClick={() => (fileRef.current?.click(), setOpen(false))}>
              Import…
            </button>
          )}
          <button className="menu-item" onClick={() => (setExportOpen(true), setOpen(false))}>
            Export…
          </button>
          {!viewLink && (
            <>
              <div className="menu-sep" />
              <button
                className="menu-item danger"
                onClick={() => {
                  if (confirm(isEditor ? `Leave "${project.name}"? It stays with its owner.` : `Delete project "${project.name}"? This cannot be undone.`)) deleteProject(project.id)
                  setOpen(false)
                }}
              >
                {isEditor ? 'Leave project' : 'Delete project'}
              </button>
            </>
          )}
        </div>
      )}
      {shareOpen && <ShareDialog projectId={project.id} onClose={() => setShareOpen(false)} />}
      {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) f.text().then((t) => importProject(JSON.parse(t))).catch(() => alert('Could not read this file as a Cordeau project.'))
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
  const readOnly = useEditor(isReadOnly)
  const rename = (id: string, current: string) => {
    if (readOnly) return
    const name = prompt('Floor name', current)
    if (name && name.trim()) renameFloor(id, name.trim())
  }
  // top floor first, like a building
  const floors = [...project.floors].reverse()
  return (
    <div className="section">
      <div className="section-head">
        <span>Floors</span>
        {!readOnly && (
          <button className="icon-btn" onClick={addFloor} title="Add a floor on top">
            +
          </button>
        )}
      </div>
      {floors.map((f) => (
        <div key={f.id} className={`floor-row ${f.id === activeFloorId ? 'on' : ''}`} onClick={() => setActiveFloor(f.id)} onDoubleClick={() => rename(f.id, f.name)} title={readOnly ? 'PageUp / PageDown' : 'Double-click to rename · PageUp / PageDown'}>
          <span className="tree-label">{f.name}</span>
          <span className="row-actions" hidden={readOnly}>
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
