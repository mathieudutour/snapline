import { useEditor } from '../model/store'
import { navigate, onLinkClick } from '../router'
import { MOBILE_QUERY, useMedia } from './useMedia'
import { Icon } from '../brand/Icons'
import { Mark } from '../brand/Brand'

/**
 * The rail is light, like everything else in the app. A dark rail in an otherwise white
 * product reads as borrowed from another one; it was also the only place in the UI with
 * 10 px text, so the labels have gone too — the icons carry titles and the active tab is
 * shown by the accent tint, which is how the rest of the product marks selection.
 *
 * The mark keeps its ink tile: that is the one place the brand signs the editor.
 */
export function Rail() {
  const railTab = useEditor((s) => s.railTab)
  const setRailTab = useEditor((s) => s.setRailTab)
  const prefsOpen = useEditor((s) => s.prefsOpen)
  const setPrefsOpen = useEditor((s) => s.setPrefsOpen)
  const toggleShortcuts = useEditor((s) => s.toggleShortcuts)
  const setTool = useEditor((s) => s.setTool)
  const tool = useEditor((s) => s.tool)
  const mobile = useMedia(MOBILE_QUERY)
  const drawer = useEditor((s) => s.drawer)
  const setDrawer = useEditor((s) => s.setDrawer)
  /** on phones the rail tabs open the left drawer (and close it when tapped again) */
  const openLeft = (tab: 'layers' | 'furniture') => {
    if (!mobile) return
    setDrawer(drawer === 'left' && railTab === tab && !prefsOpen ? null : 'left')
  }
  return (
    <nav className="rail">
      <a className="rail-logo" href="/home" onClick={onLinkClick} title="About Cordeau">
        <span className="mark-tile" style={{ width: 28, height: 28, borderRadius: 8 }}>
          <Mark size={17} cut="full" onInk />
        </span>
      </a>
      <button className={railTab === 'layers' && !prefsOpen && (!mobile || drawer === 'left') ? 'on' : ''} onClick={() => (openLeft('layers'), setRailTab('layers'), setPrefsOpen(false))} title="Layers: floors, rooms, walls, furniture, rules">
        <Icon name="layers" size={20} title="Layers" />
      </button>
      <button
        className={railTab === 'furniture' && !prefsOpen && (!mobile || drawer === 'left') ? 'on' : ''}
        onClick={() => {
          openLeft('furniture')
          setRailTab('furniture')
          setPrefsOpen(false)
          if (tool !== 'furniture') setTool('furniture')
        }}
        title="Furniture catalogue (F)"
      >
        <Icon name="furniture" size={20} title="Furniture" />
      </button>
      {mobile && (
        <button className={drawer === 'right' ? 'on' : ''} onClick={() => setDrawer(drawer === 'right' ? null : 'right')} title="Inspector: views, selection, settings">
          <Icon name="inspect" size={20} title="Inspector" />
        </button>
      )}
      <button onClick={() => navigate('/projects')} title="All projects">
        <Icon name="projects" size={20} title="Projects" />
      </button>
      <button className={prefsOpen ? 'on' : ''} onClick={() => setPrefsOpen(!prefsOpen)} title="Preferences">
        <Icon name="prefs" size={20} title="Preferences" />
      </button>
      <div className="rail-spacer" />
      <button onClick={() => toggleShortcuts()} title="Keyboard shortcuts (?)">
        <Icon name="help" size={20} title="Keyboard shortcuts" />
      </button>
    </nav>
  )
}
