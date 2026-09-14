import { lazy, Suspense } from 'react'
import { Editor2D } from './editor/Editor2D'
import { Toolbar } from './panels/Toolbar'
import { Sidebar } from './panels/Sidebar'
import { FloorStrip } from './panels/FloorStrip'
import { useEditor } from './model/store'

const Scene3D = lazy(() => import('./three/Scene3D').then((m) => ({ default: m.Scene3D })))

export function App() {
  const mode = useEditor((s) => s.mode)
  return (
    <div className="app">
      <Toolbar />
      <div className="main">
        <div className="canvas-area">
          <FloorStrip />
          {mode === 'plan' ? (
            <Editor2D />
          ) : (
            <Suspense fallback={<div className="loading">Loading 3D…</div>}>
              <Scene3D walk={mode === 'walk'} />
            </Suspense>
          )}
        </div>
        {mode === 'plan' && <Sidebar />}
      </div>
    </div>
  )
}
