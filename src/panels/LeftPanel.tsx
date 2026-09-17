import { useEffect, useRef, useState } from 'react'
import { isReadOnly, useEditor } from '../model/store'
import { NotesList, PlanTree, RulesList } from './Hierarchy'
import { FinishesProps } from './Finishes'
import { CataloguePanel } from './Sidebar'
import { ShareDialog } from './Share'
import { ExportDialog } from './Export'
import { confirmAction, InlineRename } from './Confirm'
import { Icon } from '../brand/Icons'
import { navigate } from '../router'

function ProjectMenu() {
  const project = useEditor((s) => s.project)
  const renameProject = useEditor((s) => s.renameProject)
  const deleteProject = useEditor((s) => s.deleteProject)
  const importProject = useEditor((s) => s.importProject)
  const setNotice = useEditor((s) => s.setNotice)
  const user = useEditor((s) => s.user)
  const meta = useEditor((s) => s.projects.find((p) => p.id === s.project.id))
  const viewLink = useEditor((s) => s.viewLink)
  const readOnly = useEditor(isReadOnly)
  const setProjectSettingsOpen = useEditor((s) => s.setProjectSettingsOpen)
  const isEditor = meta?.role === 'editor' || meta?.role === 'viewer'
  const [open, setOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
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
  const remove = async () => {
    setOpen(false)
    const ok = await confirmAction(
      isEditor
        ? { title: `Leave “${project.name}”?`, body: 'It stays with its owner, and you can be invited again later.', confirmLabel: 'Leave project' }
        : { title: `Delete “${project.name}”?`, body: 'The plan, every floor on it and its rules go with it. This cannot be undone.', confirmLabel: 'Delete project' },
    )
    if (ok) deleteProject(project.id)
  }
  return (
    <div className="popover-anchor project-head" ref={ref}>
      {renaming && !readOnly ? (
        <InlineRename value={project.name} onCommit={(name) => (renameProject(name), setRenaming(false))} onCancel={() => setRenaming(false)} />
      ) : (
        <button className="project-name" onClick={() => setOpen((o) => !o)} onDoubleClick={() => !readOnly && setRenaming(true)} title={readOnly ? 'Project menu' : 'Project menu · double-click to rename'}>
          <span>{project.name}</span>
          {viewLink ? <span className="badge">view only · by {viewLink.owner.name || viewLink.owner.email}</span> : readOnly ? <span className="badge">view only</span> : isEditor ? <span className="badge">shared with you</span> : meta?.memberCount || meta?.viewToken ? <span className="badge">shared</span> : null}
          <span className="chev">
            <Icon name="chevronDown" size={13} strokeWidth={2} />
          </span>
        </button>
      )}
      {open && (
        <div className="menu">
          <button className="menu-item" onClick={() => (navigate('/projects'), setOpen(false))}>
            {viewLink ? 'My projects…' : 'All projects…'}
          </button>
          <div className="menu-sep" />
          {!readOnly && (
            <button className="menu-item" onClick={() => (setRenaming(true), setOpen(false))}>
              Rename
            </button>
          )}
          <button className="menu-item" onClick={() => (setProjectSettingsOpen(true), setOpen(false))}>
            Settings…
          </button>
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
              <button className="menu-item danger" onClick={() => void remove()}>
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
          if (f)
            f.text()
              .then((t) => importProject(JSON.parse(t)))
              .catch(() => setNotice('That file could not be read as a Cordeau project.'))
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
  const [renaming, setRenaming] = useState<string | null>(null)
  const remove = async (id: string, name: string) => {
    if (await confirmAction({ title: `Remove “${name}”?`, body: 'Its walls, doors, windows, furniture and the rules that hold them go with it.', confirmLabel: 'Remove floor' })) removeFloor(id)
  }
  // top floor first, like a building
  const floors = [...project.floors].reverse()
  return (
    <div className="section">
      <div className="section-head">
        <span>Floors</span>
        {!readOnly && (
          <button className="icon-btn" onClick={addFloor} title="Add a floor on top">
            <Icon name="plus" size={14} strokeWidth={2} title="Add a floor" />
          </button>
        )}
      </div>
      {floors.map((f) => (
        <div
          key={f.id}
          className={`floor-row ${f.id === activeFloorId ? 'on' : ''}`}
          onClick={() => setActiveFloor(f.id)}
          onDoubleClick={() => !readOnly && setRenaming(f.id)}
          title={readOnly ? 'PageUp / PageDown' : 'Double-click to rename · PageUp / PageDown'}
        >
          {renaming === f.id ? (
            <InlineRename value={f.name} onCommit={(name) => (renameFloor(f.id, name), setRenaming(null))} onCancel={() => setRenaming(null)} />
          ) : (
            <>
              <span className="tree-label">{f.name}</span>
              <span className="row-actions" hidden={readOnly}>
                <button className="icon-btn" title="Duplicate above" onClick={(e) => (e.stopPropagation(), duplicateFloor(f.id))}>
                  <Icon name="duplicate" size={14} strokeWidth={1.9} title="Duplicate" />
                </button>
                <button
                  className="icon-btn"
                  title="Remove floor"
                  disabled={project.floors.length <= 1}
                  onClick={(e) => {
                    e.stopPropagation()
                    void remove(f.id, f.name)
                  }}
                >
                  <Icon name="trash" size={14} strokeWidth={1.9} title="Remove" />
                </button>
              </span>
            </>
          )}
        </div>
      ))}
    </div>
  )
}

/**
 * Under the floors, four views: the plan's tree, its rules, its notes and the finishes schedule.
 * The rules used to be one group at the bottom of the tree; once a rule lights its geometry
 * on hover, forty of them are a view in their own right, not a folder three levels down.
 */
function LayerTabs() {
  const leftTab = useEditor((s) => s.leftTab)
  const setLeftTab = useEditor((s) => s.setLeftTab)
  const rules = useEditor((s) => Object.keys(s.plan.constraints).length)
  const violated = useEditor((s) => s.report.violated.size)
  const notes = useEditor((s) => Object.values(s.plan.comments ?? {}).filter((c) => !c.resolved).length)
  // Finishes is a schedule — a per-room table — which is what this panel is for, not an inspector section
  const tabs: { id: 'plan' | 'rules' | 'notes' | 'finishes'; label: string; count?: number; bad?: boolean }[] = [
    { id: 'plan', label: 'Plan' },
    { id: 'rules', label: 'Rules', count: rules, bad: violated > 0 },
    { id: 'notes', label: 'Notes', count: notes },
    { id: 'finishes', label: 'Finishes' },
  ]
  return (
    <div className="section">
      <div className="seg panel-tabs">
        {tabs.map((t) => (
          <button key={t.id} className={leftTab === t.id ? 'active' : ''} onClick={() => setLeftTab(t.id)}>
            {t.label}
            {t.count ? <span className={`count ${t.bad ? 'bad' : ''}`}>{t.count}</span> : null}
          </button>
        ))}
      </div>
      {leftTab === 'plan' && <PlanTree />}
      {leftTab === 'rules' && <RulesList />}
      {leftTab === 'notes' && <NotesList />}
      {leftTab === 'finishes' && <FinishesProps />}
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
          <LayerTabs />
        </div>
      )}
    </aside>
  )
}
