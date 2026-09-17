import { lazy, Suspense, useEffect } from 'react'
import { Editor2D } from './editor/Editor2D'
import { Rail } from './panels/Rail'
import { LeftPanel } from './panels/LeftPanel'
import { Inspector } from './panels/Inspector'
import { BottomBar } from './panels/BottomBar'
import { Settings } from './pages/Settings'
import { Projects } from './pages/Projects'
import { useEditor } from './model/store'
import { Landing } from './pages/Landing'
import { Login } from './pages/Login'
import { navigate, parseSelection, projectPath, useLocation } from './router'
import { findRooms } from './model/geometry'
import type { SelectionItem } from './model/store'
import { ConflictDialog, Notice } from './panels/Conflict'
import { ConfirmSheet } from './panels/Confirm'
import { CanvasChrome } from './panels/CanvasChrome'
import { MOBILE_QUERY, useMedia } from './panels/useMedia'
import { ViewLinkPage } from './pages/ViewLink'

const Scene3D = lazy(() => import('./three/Scene3D').then((m) => ({ default: m.Scene3D })))

export function EditorApp() {
  const mode = useEditor((s) => s.mode)
  const drawer = useEditor((s) => s.drawer)
  const setDrawer = useEditor((s) => s.setDrawer)
  const mobile = useMedia(MOBILE_QUERY)
  return (
    <div className={`app ${mobile ? 'mobile' : ''} ${mobile && drawer ? `drawer-${drawer}` : ''} ${mode === 'walk' ? 'walking' : ''}`}>
      <Rail />
      {mobile && drawer && <div className="drawer-backdrop" onClick={() => setDrawer(null)} />}
      {mode !== 'walk' && <LeftPanel />}
      <div className="canvas-area">
        {mode === 'plan' ? (
          <Editor2D />
        ) : (
          <Suspense fallback={<div className="loading">Loading 3D…</div>}>
            <Scene3D walk={mode === 'walk'} />
          </Suspense>
        )}
        <CanvasChrome />
        <BottomBar />
      </div>
      <Inspector />
      <ConflictDialog />
      <ConfirmSheet />
      <Notice />
    </div>
  )
}

/**
 * Routes, GitHub-style:
 *   /       the projects list when signed in (or when there is no backend, in local-only mode), landing page otherwise
 *   /home   landing page, always
 *   /login  sign-in page (sends signed-in users to their projects)
 *   /projects  list of projects
 *   /project/<id>  the editor, on that project
 *   /settings  account, units, imported furniture, your data
 *   /view/<token>  read-only view of a project shared by link (no account needed)
 */
export function App() {
  const { path, search } = useLocation()
  const user = useEditor((s) => s.user)
  const apiAvailable = useEditor((s) => s.apiAvailable)
  const checking = user === undefined
  const canEdit = !!user || apiAvailable === false

  const viewToken = /^\/view\/([A-Za-z0-9_-]{8,64})$/.exec(path)?.[1] ?? null
  const projectMatch = /^\/project\/([A-Za-z0-9_-]{1,64})(?:\/([A-Za-z0-9_-]{1,64}))?$/.exec(path)
  const projectId = projectMatch?.[1] ?? null

  useEffect(() => {
    if (checking || viewToken) return
    if ((path === '/' || path === '/login') && canEdit) navigate('/projects', true)
    else if ((path === '/projects' || path === '/settings' || projectId) && !canEdit) navigate('/login', true)
    else if (path !== '/' && path !== '/home' && path !== '/login' && path !== '/projects' && path !== '/settings' && !projectId) navigate(canEdit ? '/projects' : '/home', true)
  }, [path, checking, canEdit, viewToken, projectId])

  if (viewToken) return <ViewLinkPage token={viewToken} />
  if (checking) return <div className="loading">Loading…</div>
  if (path === '/home') return <Landing />
  if (path === '/login') return canEdit ? null : <Login />
  if (path === '/projects')
    return canEdit ? (
      <>
        <Projects />
        <ConflictDialog />
        <ConfirmSheet />
        <Notice />
      </>
    ) : null
  if (path === '/settings')
    return canEdit ? (
      <>
        <Settings />
        <ConfirmSheet />
        <Notice />
      </>
    ) : null
  if (projectId) return canEdit ? <ProjectRoute id={projectId} floorId={projectMatch?.[2] ?? null} search={search} /> : null
  if (path === '/') return canEdit ? null : <Landing />
  return null
}

const selectionKey = (items: { kind: string; id: string }[]) => items.map((s) => `${s.kind}:${s.id}`).join(',')

/**
 * The editor at /project/<id>/<floorId>?s=<selection>.
 *
 * The URL opens the project, switches to the floor and selects what it names — and zooms to
 * it, since a link to a wall is a link to the wall. In the other direction, the project, the
 * floor and the selection keep the URL true as you work, replacing rather than pushing so
 * the back button still leaves the editor rather than retracing every click.
 */
function ProjectRoute({ id, floorId, search }: { id: string; floorId: string | null; search: string }) {
  const projectId = useEditor((s) => s.project.id)
  const activeFloorId = useEditor((s) => s.activeFloorId)
  const selection = useEditor((s) => s.selection)
  const known = useEditor((s) => s.projects.some((p) => p.id === id))
  const user = useEditor((s) => s.user)
  const syncStatus = useEditor((s) => s.syncStatus)
  const wantedKey = selectionKey(parseSelection(search))
  // a plan that lives on the account may not have reached this device yet: give the first sync a chance
  const waiting = !known && !!user && (syncStatus === 'idle' || syncStatus === 'syncing')

  // store → URL: the project, the floor and the selection changed from inside the app.
  // Declared first so that, within one commit, the URL is already true when the effect below reads it.
  useEffect(() => {
    const st = useEditor.getState()
    if (location.pathname !== projectPath(id) && !location.pathname.startsWith(projectPath(id) + '/')) return
    const wanted = projectPath(st.project.id, st.activeFloorId, st.selection)
    if (location.pathname + location.search !== wanted) navigate(wanted, true)
  }, [projectId, activeFloorId, selection, id])

  // URL → store: a direct load, a pasted link, or back / forward. Reads the live location, not the
  // props, so a change the app made a moment ago (and already wrote to the URL) is not undone.
  useEffect(() => {
    const m = /^\/project\/([A-Za-z0-9_-]{1,64})(?:\/([A-Za-z0-9_-]{1,64}))?$/.exec(location.pathname)
    if (!m) return
    const urlId = m[1]
    const urlFloor = m[2] ?? null
    const st = useEditor.getState()
    if (st.project.id !== urlId) {
      if (st.projects.some((p) => p.id === urlId)) st.openProject(urlId)
      else if (!waiting) {
        st.setNotice('That plan is not on this device.')
        navigate('/projects', true)
        return
      } else return
    }
    const now = useEditor.getState()
    if (urlFloor && urlFloor !== now.activeFloorId && now.project.floors.some((f) => f.id === urlFloor)) now.setActiveFloor(urlFloor)
    const after = useEditor.getState()
    const wanted = parseSelection(location.search)
    if (selectionKey(wanted) !== selectionKey(after.selection)) {
      const plan = after.plan
      let rooms: Set<string> | null = null
      const items = wanted.filter((s): s is SelectionItem => {
        switch (s.kind) {
          case 'wall':
            return !!plan.walls[s.id]
          case 'point':
            return !!plan.points[s.id]
          case 'opening':
            return !!plan.openings[s.id]
          case 'furniture':
            return !!plan.furniture[s.id]
          case 'room':
            return (rooms ??= new Set(findRooms(plan).map((r) => r.id))).has(s.id)
          case 'roof':
          case 'building':
          case 'site':
            return true
          default:
            return false
        }
      })
      after.select(items)
      // a link to a wall is a link to the wall: bring it into view
      if (items.length > 0) after.requestFit('selection')
    }
  }, [id, floorId, wantedKey, known, waiting])

  if (waiting) return <div className="loading">Loading…</div>
  if (projectId !== id) return null
  return <EditorApp />
}
