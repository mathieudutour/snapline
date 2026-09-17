import { useEffect, useRef, useState } from 'react'
import { isReadOnly, useEditor } from '../model/store'
import { confirmAction } from './Confirm'
import { ensureFileUrl, fileUrl, onFileUrls } from '../files/planFiles'
import { Icon } from '../brand/Icons'

/** the underlay image itself, small: the file store's URL, fetched from the account if needed */
function UnderlayThumb({ fileKey }: { fileKey: string }) {
  const projectId = useEditor((s) => s.project.id)
  const viewToken = useEditor((s) => s.viewLink?.token ?? null)
  const [url, setUrl] = useState<string | null>(() => fileUrl(fileKey))
  useEffect(() => {
    let live = true
    setUrl(fileUrl(fileKey))
    void ensureFileUrl(projectId, fileKey, viewToken).then((u) => live && setUrl(u))
    const off = onFileUrls(() => live && setUrl(fileUrl(fileKey)))
    return () => {
      live = false
      off()
    }
  }, [fileKey, projectId, viewToken])
  return url ? <img className="underlay-thumb" src={url} alt="" /> : <span className="underlay-thumb" />
}

/**
 * The active floor's underlay, collapsed to one row: thumbnail, file name, opacity and lock.
 * There is one underlay per floor, so unlike the roof or the site it genuinely belongs to the
 * floor you are on — but its six controls are set once, so they live behind the row.
 */
export function UnderlayRow() {
  const underlay = useEditor((s) => s.project.floors.find((f) => f.id === s.activeFloorId)?.underlay)
  const importUnderlay = useEditor((s) => s.importUnderlay)
  const readOnly = useEditor(isReadOnly)
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  if (readOnly && !underlay) return null
  const pick = async (f: File) => {
    setBusy(true)
    setError(null)
    try {
      await importUnderlay(f)
      setOpen(true)
    } catch (e) {
      setError((e as Error).message || 'Could not import this file.')
    } finally {
      setBusy(false)
    }
  }
  const input = (
    <input
      ref={fileRef}
      type="file"
      accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,application/pdf,.pdf"
      hidden
      onChange={(e) => {
        const f = e.target.files?.[0]
        if (f) void pick(f)
        e.target.value = ''
      }}
    />
  )
  if (!underlay)
    return (
      <>
        <button className="underlay-row" onClick={() => fileRef.current?.click()} disabled={busy} title="Trace over an existing plan: import an image or a PDF, set its scale, then draw walls on top">
          <span className="underlay-thumb empty">
            <Icon name="fileImage" size={14} />
          </span>
          <span className="status-text">
            <b>{busy ? 'Importing…' : 'Import an underlay…'}</b>
            <span>an image or a PDF to trace over</span>
          </span>
        </button>
        {error && <p className="warn small">{error}</p>}
        {input}
      </>
    )
  return (
    <>
      <button className={`underlay-row ${open ? 'open' : ''}`} onClick={() => setOpen((o) => !o)} title={underlay.name}>
        <UnderlayThumb fileKey={underlay.key} />
        <span className="status-text">
          <b>{underlay.name}</b>
          <span>
            underlay · {Math.round(underlay.opacity * 100)}% · {underlay.locked ? 'locked' : 'unlocked'}
          </span>
        </span>
        <span className="chev">
          <Icon name={open ? 'chevronDown' : 'chevronRight'} size={13} strokeWidth={2} />
        </span>
      </button>
      {open && <UnderlayDetails onReplace={() => fileRef.current?.click()} busy={busy} />}
      {error && <p className="warn small">{error}</p>}
      {input}
    </>
  )
}

/** behind the row: opacity, rotation, lock, scale, replace and remove */
function UnderlayDetails({ onReplace, busy }: { onReplace: () => void; busy: boolean }) {
  const underlay = useEditor((s) => s.project.floors.find((f) => f.id === s.activeFloorId)?.underlay)
  const setUnderlay = useEditor((s) => s.setUnderlay)
  const calibrating = useEditor((s) => s.calibrating)
  const setCalibrating = useEditor((s) => s.setCalibrating)
  const setMode = useEditor((s) => s.setMode)
  const setTool = useEditor((s) => s.setTool)
  const readOnly = useEditor(isReadOnly)
  if (!underlay) return null
  return (
    <div className="underlay-details">
      <p className="muted small mono">
        {underlay.width}×{underlay.height} px
      </p>
      <label className="field sun-time">
        <span>Opacity</span>
        <input type="range" min={0.1} max={1} step={0.05} value={underlay.opacity} disabled={readOnly} onChange={(e) => setUnderlay({ opacity: Number(e.target.value) })} />
        <em>{Math.round(underlay.opacity * 100)}%</em>
      </label>
      <label className="field">
        <span>Rotation</span>
        <span className="field-input">
          <input type="number" step={0.5} value={underlay.rotation} disabled={readOnly} onChange={(e) => setUnderlay({ rotation: Number(e.target.value) || 0 })} />
          <em>°</em>
        </span>
      </label>
      {!readOnly && (
        <>
          <label className="toggle block">
            <span>Locked in place</span>
            <input className="switch" type="checkbox" checked={underlay.locked} onChange={(e) => setUnderlay({ locked: e.target.checked })} />
          </label>
          <div className="row">
            <button
              className={calibrating ? 'active' : ''}
              onClick={() => {
                if (calibrating) setCalibrating(null)
                else {
                  setMode('plan')
                  setTool('select')
                  setCalibrating({ a: null })
                }
              }}
            >
              {calibrating ? 'Cancel' : 'Scale…'}
            </button>
            <button onClick={onReplace} disabled={busy}>
              Replace…
            </button>
            <button
              className="danger"
              onClick={() =>
                void confirmAction({ title: 'Remove the underlay?', body: 'The image you traced over is dropped from this floor. The walls you drew on top of it stay.', confirmLabel: 'Remove underlay' }).then((ok) => ok && setUnderlay(null))
              }
            >
              Remove
            </button>
          </div>
          <p className="muted small">{calibrating ? (calibrating.a ? 'Now click the second point.' : 'Click two points on the image that are a known distance apart; you will be asked for that distance.') : 'Unlock to drag the image around the plan. Set scale: click two points a known distance apart.'}</p>
        </>
      )}
    </div>
  )
}
