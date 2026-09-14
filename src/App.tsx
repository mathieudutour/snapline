import { lazy, Suspense, useEffect } from 'react'
import { Editor2D } from './editor/Editor2D'
import { Rail } from './panels/Rail'
import { LeftPanel } from './panels/LeftPanel'
import { Inspector } from './panels/Inspector'
import { BottomBar } from './panels/BottomBar'
import { PreferencesPanel } from './panels/Preferences'
import { Projects } from './pages/Projects'
import { useEditor } from './model/store'
import { Landing } from './pages/Landing'
import { Login } from './pages/Login'
import { navigate, useRoute } from './router'

const Scene3D = lazy(() => import('./three/Scene3D').then((m) => ({ default: m.Scene3D })))

function EditorApp() {
  const mode = useEditor((s) => s.mode)
  const prefsOpen = useEditor((s) => s.prefsOpen)
  return (
    <div className="app">
      <Rail />
      <LeftPanel />
      <div className="canvas-area">
        {mode === 'plan' ? (
          <Editor2D />
        ) : (
          <Suspense fallback={<div className="loading">Loading 3D…</div>}>
            <Scene3D walk={mode === 'walk'} />
          </Suspense>
        )}
        <BottomBar />
        {prefsOpen && <PreferencesPanel />}
      </div>
      <Inspector />
    </div>
  )
}

/**
 * Routes, GitHub-style:
 *   /       editor when signed in (or when there is no backend, in local-only mode), landing page otherwise
 *   /home   landing page, always
 *   /login  sign-in page (sends signed-in users to the editor)
 *   /projects  list of projects
 */
export function App() {
  const path = useRoute()
  const user = useEditor((s) => s.user)
  const apiAvailable = useEditor((s) => s.apiAvailable)
  const checking = user === undefined
  const canEdit = !!user || apiAvailable === false

  useEffect(() => {
    if (checking) return
    if (path === '/login' && canEdit) navigate('/', true)
    else if (path === '/projects' && !canEdit) navigate('/login', true)
    else if (path !== '/' && path !== '/home' && path !== '/login' && path !== '/projects') navigate(canEdit ? '/' : '/home', true)
  }, [path, checking, canEdit])

  if (checking) return <div className="loading">Loading…</div>
  if (path === '/home') return <Landing />
  if (path === '/login') return canEdit ? null : <Login />
  if (path === '/projects') return canEdit ? <Projects /> : null
  if (path === '/') return canEdit ? <EditorApp /> : <Landing />
  return null
}
