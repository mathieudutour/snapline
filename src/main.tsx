import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// expose the store for debugging / scripting in the console
import { useEditor } from './model/store'
import { startLiveCollaboration } from './sync/liveController'
;(window as unknown as { snapline: typeof useEditor }).snapline = useEditor
void useEditor
  .getState()
  .loadCustomModels()
  .then(() => useEditor.getState().initAccount())
  .then(() => startLiveCollaboration())
