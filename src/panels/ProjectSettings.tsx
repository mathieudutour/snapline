import { useEffect } from 'react'
import { isReadOnly, useEditor } from '../model/store'
import { SiteProps } from './Site'
import { LengthField } from './Sidebar'
import { Icon } from '../brand/Icons'

/**
 * Facts about the building that are set once: where it stands, which way the plan faces,
 * how thick the slab between floors is. They used to sit in the inspector under "nothing
 * selected", where forty words of help text about latitude shared a scroll with the wall
 * thickness you change while drawing. They are project settings, so this is a sheet opened
 * from the project menu — and from the north arrow on the canvas, which is the one place
 * north is visible.
 */
export function ProjectSettingsDialog() {
  const open = useEditor((s) => s.projectSettingsOpen)
  const setOpen = useEditor((s) => s.setProjectSettingsOpen)
  const slab = useEditor((s) => s.project.slabThickness)
  const setSlabThickness = useEditor((s) => s.setSlabThickness)
  const units = useEditor((s) => s.units)
  const readOnly = useEditor(isReadOnly)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, setOpen])
  if (!open) return null
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="modal settings" role="dialog" aria-modal="true" aria-label="Project settings" onPointerDown={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <strong>Project settings</strong>
          <button className="x" onClick={() => setOpen(false)} title="Close (Esc)">
            <Icon name="close" size={15} strokeWidth={2} />
          </button>
        </div>
        <fieldset className="plain" disabled={readOnly}>
          <SiteProps />
          <div className="props">
            <h3>Building</h3>
            <LengthField label="Slab between floors" units={units} value={slab} onChange={setSlabThickness} />
            <p className="muted small">The concrete slab each upper floor stands on. A floor's own height is set on the floor, in the inspector with nothing selected.</p>
          </div>
        </fieldset>
      </div>
    </div>
  )
}
