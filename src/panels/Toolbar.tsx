import { useEffect, useRef, useState } from 'react'
import { useEditor, type SyncStatus, type Tool, type ViewMode } from '../model/store'
import { signInUrl, type AccountUser } from '../sync/api'

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
  const user = useEditor((s) => s.user)
  const syncStatus = useEditor((s) => s.syncStatus)
  const signOut = useEditor((s) => s.signOut)
  const syncNow = useEditor((s) => s.syncNow)
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
      <AccountButton user={user} syncStatus={syncStatus} onSignOut={signOut} onSync={syncNow} />
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

const SYNC_LABEL: Record<SyncStatus, string> = { offline: 'Local only', idle: 'Signed in', syncing: 'Saving…', synced: 'Saved to your account', error: 'Sync failed, retrying on next change' }

function AccountButton({ user, syncStatus, onSignOut, onSync }: { user: AccountUser | null | undefined; syncStatus: SyncStatus; onSignOut: () => void; onSync: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])
  if (user === undefined) return null
  if (!user) {
    return (
      <a className="button signin" href={signInUrl()} title="Sign in to save projects to your account and use them on other devices">
        <GoogleMark /> Sign in
      </a>
    )
  }
  return (
    <div className="project-menu" ref={ref}>
      <button className={`account ${syncStatus}`} onClick={() => setOpen((o) => !o)} title={SYNC_LABEL[syncStatus]}>
        {user.picture ? <img src={user.picture} alt="" referrerPolicy="no-referrer" /> : <span className="avatar">{(user.name || user.email).slice(0, 1).toUpperCase()}</span>}
        <span className={`dot ${syncStatus}`} />
      </button>
      {open && (
        <div className="menu">
          <div className="menu-title">{user.email}</div>
          <div className="menu-item muted">{SYNC_LABEL[syncStatus]}</div>
          <button className="menu-item" onClick={() => (onSync(), setOpen(false))}>
            Sync now
          </button>
          <div className="menu-sep" />
          <button className="menu-item" onClick={() => (onSignOut(), setOpen(false))}>
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

function GoogleMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.8 6C12.3 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8C43.8 38 46.5 31.8 46.5 24.5z" />
      <path fill="#FBBC05" d="M10.4 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6C.9 16.5 0 20.1 0 24s.9 7.5 2.6 10.7l7.8-6z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.7-4.1-13.6-9.8l-7.8 6C6.5 42.6 14.6 48 24 48z" />
    </svg>
  )
}
