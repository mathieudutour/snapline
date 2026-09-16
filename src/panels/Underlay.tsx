import { useRef, useState } from 'react'
import { isReadOnly, useEditor } from '../model/store'
import { confirmAction } from './Confirm'

/** the active floor's underlay image: import, opacity, rotation, lock, scale calibration */
export function UnderlayProps() {
  const underlay = useEditor((s) => s.project.floors.find((f) => f.id === s.activeFloorId)?.underlay)
  const setUnderlay = useEditor((s) => s.setUnderlay)
  const importUnderlay = useEditor((s) => s.importUnderlay)
  const calibrating = useEditor((s) => s.calibrating)
  const setCalibrating = useEditor((s) => s.setCalibrating)
  const setMode = useEditor((s) => s.setMode)
  const setTool = useEditor((s) => s.setTool)
  const readOnly = useEditor(isReadOnly)
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (readOnly && !underlay) return null
  const pick = async (f: File) => {
    setBusy(true)
    setError(null)
    try {
      await importUnderlay(f)
    } catch (e) {
      setError((e as Error).message || 'Could not import this file.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="props">
      <h3>Underlay</h3>
      {!underlay ? (
        <>
          <p className="muted small">Trace over an existing plan: import an image or a PDF, set its scale from a known distance, then draw walls on top of it.</p>
          <button onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? 'Importing…' : 'Import image or PDF…'}
          </button>
        </>
      ) : (
        <>
          <p className="muted small" title={underlay.name}>
            {underlay.name} · {underlay.width}×{underlay.height} px
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
                <button onClick={() => fileRef.current?.click()} disabled={busy}>
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
        </>
      )}
      {error && <p className="warn small">{error}</p>}
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
    </div>
  )
}
