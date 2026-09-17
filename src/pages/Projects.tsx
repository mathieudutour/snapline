import { useRef, useState } from 'react'
import { useEditor } from '../model/store'
import { navigate, onLinkClick, projectPath } from '../router'
import { AccountButton } from '../panels/Account'
import { confirmAction, InlineRename } from '../panels/Confirm'
import { Icon } from '../brand/Icons'
import { Lockup } from '../brand/Brand'
import { PlanThumb } from './PlanThumb'

/** "2 h ago" reads better on a card than "15/09/2026, 16:02"; the exact time is in the title attribute */
function ago(at: number): string {
  const s = Math.max(0, (Date.now() - at) / 1000)
  if (s < 90) return 'just now'
  const m = s / 60
  if (m < 60) return `${Math.round(m)} min ago`
  const h = m / 60
  if (h < 24) return `${Math.round(h)} h ago`
  const d = h / 24
  if (d < 7) return `${Math.round(d)} d ago`
  const w = d / 7
  if (w < 5) return `${Math.round(w)} w ago`
  return new Date(at).toLocaleDateString()
}

export function Projects() {
  const projects = useEditor((s) => s.projects)
  const current = useEditor((s) => s.project)
  const units = useEditor((s) => s.units)
  const openProject = useEditor((s) => s.openProject)
  const newProject = useEditor((s) => s.newProject)
  const deleteProject = useEditor((s) => s.deleteProject)
  const renameProject = useEditor((s) => s.renameProject)
  const importProject = useEditor((s) => s.importProject)
  const loadExample = useEditor((s) => s.loadExample)
  const setNotice = useEditor((s) => s.setNotice)
  const fileRef = useRef<HTMLInputElement>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const open = (id: string) => {
    openProject(id)
    navigate(projectPath(id))
  }
  /** after newProject / loadExample / importProject made a project current: go and edit it */
  const editCurrent = () => navigate(projectPath(useEditor.getState().project.id))
  const rename = (id: string, name: string) => {
    if (id !== current.id) openProject(id)
    renameProject(name)
    setRenaming(null)
  }
  const remove = async (p: (typeof projects)[number]) => {
    const shared = p.role === 'editor' || p.role === 'viewer'
    const ok = await confirmAction(
      shared
        ? { title: `Leave “${p.name}”?`, body: 'It stays with its owner, and you can be invited again later.', confirmLabel: 'Leave project' }
        : { title: `Delete “${p.name}”?`, body: 'The plan, every floor on it and its rules go with it. This cannot be undone.', confirmLabel: 'Delete project' },
    )
    if (ok) deleteProject(p.id)
  }
  const sorted = [...projects].sort((a, b) => b.updatedAt - a.updatedAt)
  const sharedCount = sorted.filter((p) => p.role === 'editor' || p.role === 'viewer' || p.memberCount || p.viewToken).length
  return (
    <div className="projects-page">
      <header className="projects-head">
        <a href="/home" onClick={onLinkClick} aria-label="Cordeau">
          <Lockup size={23} />
        </a>
        <div className="spacer" />
        <button className="quiet" onClick={() => fileRef.current?.click()}>
          Import
        </button>
        <button className="quiet" onClick={() => (loadExample(), editCurrent())}>
          Example house
        </button>
        <button className="primary" onClick={() => (newProject(), editCurrent())}>
          New plan
        </button>
        <AccountButton />
      </header>
      <main>
        <div className="projects-title">
          <h1>Your plans</h1>
          <span className="muted small">
            {sorted.length} plan{sorted.length === 1 ? '' : 's'}
            {sharedCount > 0 ? ` · ${sharedCount} shared` : ''}
          </span>
        </div>
        <div className="project-grid">
          {sorted.map((p) => (
            <div key={p.id} className={`project-card ${p.id === current.id ? 'on' : ''}`} onClick={() => renaming !== p.id && open(p.id)}>
              <PlanThumb projectId={p.id} units={units} />
              <div className="project-card-body">
                {renaming === p.id ? (
                  <InlineRename value={p.name} onCommit={(name) => rename(p.id, name)} onCancel={() => setRenaming(null)} />
                ) : (
                  <strong onDoubleClick={(e) => (e.stopPropagation(), p.role !== 'viewer' && setRenaming(p.id))} title={p.name}>
                    {p.name}
                  </strong>
                )}
                <div className="project-card-meta">
                  <span title={new Date(p.updatedAt).toLocaleString()}>Edited {ago(p.updatedAt)}</span>
                  {/* sharing is shown as the people it is shared with, not as a word */}
                  {p.role === 'viewer' && <span className="badge">view only</span>}
                  {p.owner && <Avatar person={p.owner.name || p.owner.email} title={`Owned by ${p.owner.name || p.owner.email}`} />}
                  {!!p.memberCount && <span title={`Shared with ${p.memberCount} ${p.memberCount === 1 ? 'person' : 'people'}`}>{p.memberCount === 1 ? '1 person' : `${p.memberCount} people`}</span>}
                  {p.viewToken && <Icon name="eye" size={13} strokeWidth={1.9} title="Anyone with the link can view" />}
                  <span className="project-card-actions" onClick={(e) => e.stopPropagation()}>
                    <button className="icon-btn" title="Rename" hidden={p.role === 'viewer'} onClick={() => setRenaming(p.id)}>
                      <Icon name="rename" size={14} strokeWidth={1.9} title="Rename" />
                    </button>
                    <button className="icon-btn" title={p.role === 'editor' || p.role === 'viewer' ? 'Leave' : 'Delete'} onClick={() => void remove(p)}>
                      <Icon name="trash" size={14} strokeWidth={1.9} title="Delete" />
                    </button>
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>
      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f)
            f.text()
              .then((t) => (importProject(JSON.parse(t)), editCurrent()))
              .catch(() => setNotice('That file could not be read as a Cordeau project.'))
          e.target.value = ''
        }}
      />
    </div>
  )
}

function Avatar({ person, title }: { person: string; title: string }) {
  return (
    <span className="peers" title={title}>
      <span className="peer" style={{ background: colourFor(person) }}>
        {person.slice(0, 1).toUpperCase()}
      </span>
    </span>
  )
}

/**
 * A stable colour per person, so an owner looks the same every time you open the list.
 * Live sessions hand out their own colours from the server (see worker/room.ts), which is
 * about telling people apart in one room rather than identifying them across the app.
 */
function colourFor(key: string): string {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 360
  return `hsl(${h} 62% 45%)`
}
