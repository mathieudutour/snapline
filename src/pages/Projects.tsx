import { useRef } from 'react'
import { useEditor } from '../model/store'
import { navigate, onLinkClick } from '../router'
import { AccountButton } from '../panels/Account'

export function Projects() {
  const projects = useEditor((s) => s.projects)
  const current = useEditor((s) => s.project)
  const openProject = useEditor((s) => s.openProject)
  const newProject = useEditor((s) => s.newProject)
  const deleteProject = useEditor((s) => s.deleteProject)
  const renameProject = useEditor((s) => s.renameProject)
  const importProject = useEditor((s) => s.importProject)
  const loadExample = useEditor((s) => s.loadExample)
  const fileRef = useRef<HTMLInputElement>(null)
  const open = (id: string) => {
    openProject(id)
    navigate('/')
  }
  const sorted = [...projects].sort((a, b) => b.updatedAt - a.updatedAt)
  return (
    <div className="projects-page">
      <header className="projects-head">
        <a className="brand" href="/home" onClick={onLinkClick}>
          <span className="brand-mark">◫</span> Snapline
        </a>
        <div className="spacer" />
        <button onClick={() => fileRef.current?.click()}>Import…</button>
        <button onClick={() => (loadExample(), navigate('/'))}>Example house</button>
        <button className="button primary" onClick={() => (newProject(), navigate('/'))}>
          + New project
        </button>
        <AccountButton />
      </header>
      <main>
        <h1>Projects</h1>
        <div className="project-grid">
          {sorted.map((p) => (
            <div key={p.id} className={`project-card ${p.id === current.id ? 'on' : ''}`} onClick={() => open(p.id)}>
              <div className="project-card-body">
                <strong>{p.name}</strong>
                <span className="muted small">Updated {new Date(p.updatedAt).toLocaleString()}</span>
                {p.role === 'editor' ? (
                  <span className="muted small">
                    <span className="badge">shared</span> by {p.owner?.name || p.owner?.email}
                  </span>
                ) : p.memberCount ? (
                  <span className="muted small">
                    <span className="badge">shared</span> with {p.memberCount} {p.memberCount === 1 ? 'person' : 'people'}
                  </span>
                ) : null}
              </div>
              <div className="project-card-actions" onClick={(e) => e.stopPropagation()}>
                <button
                  className="icon-btn"
                  title="Rename"
                  onClick={() => {
                    const name = prompt('Project name', p.name)
                    if (!name) return
                    if (p.id !== current.id) openProject(p.id)
                    renameProject(name)
                  }}
                >
                  ✎
                </button>
                <button
                  className="icon-btn"
                  title={p.role === 'editor' ? 'Leave' : 'Delete'}
                  onClick={() => {
                    if (confirm(p.role === 'editor' ? `Leave "${p.name}"? It stays with its owner.` : `Delete project "${p.name}"? This cannot be undone.`)) deleteProject(p.id)
                  }}
                >
                  ✕
                </button>
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
              .then((t) => (importProject(JSON.parse(t)), navigate('/')))
              .catch(() => alert('Could not read this file as a Snapline project.'))
          e.target.value = ''
        }}
      />
    </div>
  )
}
