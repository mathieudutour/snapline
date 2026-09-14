import { useEditor } from '../model/store'
import { navigate, onLinkClick } from '../router'

function Icon({ d }: { d: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

const ICONS = {
  layers: 'M12 3 2 8l10 5 10-5-10-5Zm-10 9 10 5 10-5M2 17l10 5 10-5',
  furniture: 'M4 11V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3M3 11h18v6H3zM5 17v3M19 17v3',
  projects: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  prefs: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1l2-1.5-2-3.4-2.3 1a7.3 7.3 0 0 0-1.7-1L15 3.7H9l-.3 2.4a7.3 7.3 0 0 0-1.7 1l-2.3-1-2 3.4L4.7 11a7.4 7.4 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a7.3 7.3 0 0 0 1.7 1l.3 2.4h6l.3-2.4a7.3 7.3 0 0 0 1.7-1l2.3 1 2-3.4-2-1.5c.1-.3.1-.7.1-1Z',
  help: 'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z',
}

export function Rail() {
  const railTab = useEditor((s) => s.railTab)
  const setRailTab = useEditor((s) => s.setRailTab)
  const prefsOpen = useEditor((s) => s.prefsOpen)
  const setPrefsOpen = useEditor((s) => s.setPrefsOpen)
  const toggleShortcuts = useEditor((s) => s.toggleShortcuts)
  const setTool = useEditor((s) => s.setTool)
  const tool = useEditor((s) => s.tool)
  return (
    <nav className="rail">
      <a className="rail-logo" href="/home" onClick={onLinkClick} title="About Snapline">
        ◫
      </a>
      <button className={railTab === 'layers' && !prefsOpen ? 'on' : ''} onClick={() => (setRailTab('layers'), setPrefsOpen(false))} title="Layers: floors, rooms, walls, furniture, constraints">
        <Icon d={ICONS.layers} />
        <span>Layers</span>
      </button>
      <button
        className={railTab === 'furniture' && !prefsOpen ? 'on' : ''}
        onClick={() => {
          setRailTab('furniture')
          setPrefsOpen(false)
          if (tool !== 'furniture') setTool('furniture')
        }}
        title="Furniture catalogue (F)"
      >
        <Icon d={ICONS.furniture} />
        <span>Furniture</span>
      </button>
      <button onClick={() => navigate('/projects')} title="All projects">
        <Icon d={ICONS.projects} />
        <span>Projects</span>
      </button>
      <button className={prefsOpen ? 'on' : ''} onClick={() => setPrefsOpen(!prefsOpen)} title="Preferences">
        <Icon d={ICONS.prefs} />
        <span>Prefs</span>
      </button>
      <div className="rail-spacer" />
      <button onClick={() => toggleShortcuts()} title="Keyboard shortcuts (?)">
        <Icon d={ICONS.help} />
        <span>Help</span>
      </button>
    </nav>
  )
}
