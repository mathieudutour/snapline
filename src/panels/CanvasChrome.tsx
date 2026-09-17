import { useEffect, useMemo, useRef, useState } from 'react'
import { isReadOnly, useEditor } from '../model/store'
import { AccountButton } from './Account'
import { PeerAvatars } from '../editor/Peers'
import { Icon, WarningIcon } from '../brand/Icons'
import { constraintTargets, describeConstraint } from '../model/constraints'
import { DENSITY_HINTS, DENSITY_LABELS, drawingScale, DRAWING_SCALES, zoomForScale } from '../editor/labels'

/** a CSS pixel is 1/96 in, so a metre drawn `zoom` px across is `zoom / 3.7795` mm on the glass */
const PX_PER_MM = 96 / 25.4

/**
 * Chrome that belongs to the view rather than to the selection.
 *
 * The inspector header used to carry the mode switch, the zoom readout, the live peers and
 * the account avatar in 280 px. Presence and the account are app-level; the floor and the
 * zoom are view-level; only the mode switch is about what you are looking at. So the first
 * three move out here, onto the thing they describe.
 */
export function CanvasChrome() {
  const mode = useEditor((s) => s.mode)
  if (mode === 'walk') return null
  return (
    <>
      {mode === 'plan' && <ViewPill />}
      <PresencePill />
      {mode === 'plan' && <ConflictCard />}
    </>
  )
}

/** floor · zoom · the scale the plan is drawn at · how many measurements it shows */
function ViewPill() {
  const floors = useEditor((s) => s.project.floors)
  const activeFloorId = useEditor((s) => s.activeFloorId)
  const setActiveFloor = useEditor((s) => s.setActiveFloor)
  const zoom = useEditor((s) => s.zoomLevel)
  const requestFit = useEditor((s) => s.requestFit)
  const requestZoom = useEditor((s) => s.requestZoom)
  const density = useEditor((s) => s.labelDensity)
  const cycleDensity = useEditor((s) => s.cycleLabelDensity)
  const labelStats = useEditor((s) => s.labelStats)
  const underlay = useEditor((s) => s.project.floors.find((f) => f.id === s.activeFloorId)?.underlay)
  const setUnderlay = useEditor((s) => s.setUnderlay)
  const readOnly = useEditor(isReadOnly)
  const [open, setOpen] = useState<'floors' | 'scale' | 'underlay' | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])
  const floor = floors.find((f) => f.id === activeFloorId)
  // a drawing scale is a conventional value: 1:83 as you scroll implies a precision the screen has not got
  const scale = drawingScale(zoom, PX_PER_MM)
  const hidden = labelStats.hidden > 0 ? `, ${labelStats.hidden} hidden so none overlap` : ''
  return (
    <div className="canvas-chrome left popover-anchor" ref={ref}>
      <button className="pill-item strong" onClick={() => setOpen((o) => (o === 'floors' ? null : 'floors'))} title="Switch floor (PageUp / PageDown)">
        {floor?.name ?? 'Floor'}
      </button>
      <span className="pill-sep" />
      <span className="pill-item num" title="Screen zoom: how many pixels a metre is drawn across">
        {Math.round(zoom)}%
      </span>
      <span className="pill-sep" />
      <button className="pill-item num" onClick={() => setOpen((o) => (o === 'scale' ? null : 'scale'))} title={scale.approx ? `Drawn at about 1:${scale.exact} on a 96 dpi screen — pick a scale to zoom to` : `Drawn at 1:${scale.nearest} on a 96 dpi screen — pick a scale to zoom to`}>
        {scale.nearest ? `${scale.approx ? '≈ ' : ''}1:${scale.nearest}` : '1:—'}
      </button>
      <span className="pill-sep" />
      <button className="pill-item density" onClick={cycleDensity} title={`Measurements: ${DENSITY_LABELS[density].toLowerCase()} — ${DENSITY_HINTS[density]} (${labelStats.shown} shown${hidden}). Shift+D cycles.`}>
        <Icon name="density" size={15} />
        {DENSITY_LABELS[density]}
      </button>
      {underlay && (
        <>
          <span className="pill-sep" />
          <button className={`pill-item ${!underlay.locked ? 'attention' : ''}`} onClick={() => setOpen((o) => (o === 'underlay' ? null : 'underlay'))} title={`Underlay: ${underlay.name} · ${Math.round(underlay.opacity * 100)}% · ${underlay.locked ? 'locked' : 'unlocked — drag it on the plan'}`}>
            <Icon name="fileImage" size={15} title="Underlay" />
          </button>
        </>
      )}
      <span className="pill-sep" />
      <button className="pill-item" onClick={requestFit} title="Zoom to fit (Shift+1)">
        <Icon name="fit" size={15} title="Zoom to fit" />
      </button>
      {open === 'floors' && (
        <div className="menu">
          <div className="menu-title">Floors</div>
          {[...floors].reverse().map((f) => (
            <button key={f.id} className={`menu-item ${f.id === activeFloorId ? 'on' : ''}`} onClick={() => (setActiveFloor(f.id), setOpen(null))}>
              {f.name}
            </button>
          ))}
        </div>
      )}
      {open === 'underlay' && underlay && (
        <div className="menu underlay-menu" onPointerDown={(e) => e.stopPropagation()}>
          <div className="menu-title">Underlay</div>
          <label className="field sun-time">
            <span>Opacity</span>
            <input type="range" min={0.1} max={1} step={0.05} value={underlay.opacity} disabled={readOnly} onChange={(e) => setUnderlay({ opacity: Number(e.target.value) })} />
            <em>{Math.round(underlay.opacity * 100)}%</em>
          </label>
          <label className="toggle block">
            <span>Locked in place</span>
            <input className="switch" type="checkbox" checked={underlay.locked} disabled={readOnly} onChange={(e) => setUnderlay({ locked: e.target.checked })} />
          </label>
        </div>
      )}
      {open === 'scale' && (
        <div className="menu">
          <div className="menu-title">Draw at</div>
          {DRAWING_SCALES.map((d) => (
            <button key={d} className={`menu-item num ${d === scale.nearest && !scale.approx ? 'on' : ''}`} onClick={() => (requestZoom(zoomForScale(d, PX_PER_MM)), setOpen(null))}>
              1:{d}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** who else is here, and who you are — app-level, so it lives above the canvas, not in the inspector */
function PresencePill() {
  const live = useEditor((s) => s.live)
  const user = useEditor((s) => s.user)
  const apiAvailable = useEditor((s) => s.apiAvailable)
  // AccountButton draws nothing while we are still checking, or when there is no backend at all
  const hasAccount = user !== undefined && apiAvailable !== false
  const hasLive = live.status !== 'off'
  if (!hasAccount && !hasLive) return null
  const others = live.status === 'on' ? live.peers : []
  const label = others.length === 1 ? `${others[0].name || others[0].email} is here` : others.length > 1 ? `${others.length} others are here` : null
  return (
    <div className="canvas-chrome right">
      <PeerAvatars />
      {label && <span className="presence-label">{label}</span>}
      {hasLive && hasAccount && <span className="pill-sep" style={{ height: 18, alignSelf: 'center' }} />}
      <AccountButton />
    </div>
  )
}

/**
 * A conflict, reported next to the conflict.
 *
 * It used to show up in three places at once — a red box in the inspector, red rows deep
 * in the layers tree, a red dimension on the canvas — and none of them said which two
 * rules disagreed or took you to them. One card, both rules named, and the geometry they
 * belong to is one click away.
 */
function ConflictCard() {
  const plan = useEditor((s) => s.plan)
  const violated = useEditor((s) => s.report.violated)
  const maxError = useEditor((s) => s.report.maxError)
  const canUndo = useEditor((s) => s.undoStack.length > 0)
  const undo = useEditor((s) => s.undo)
  const select = useEditor((s) => s.select)
  const readOnly = useEditor(isReadOnly)
  const [dismissed, setDismissed] = useState<string | null>(null)

  const rules = useMemo(
    () =>
      [...violated]
        .map((id) => plan.constraints[id])
        .filter(Boolean)
        .map((c) => ({ id: c.id, text: describeConstraint(plan, c), targets: constraintTargets(c) })),
    [violated, plan],
  )
  // a different set of rules is a different conflict, so dismissing one does not hide the next
  const key = rules.map((r) => r.id).sort().join(',')
  if (rules.length === 0 || dismissed === key) return null

  const showRules = () => {
    const items = rules.flatMap((r) => r.targets)
    const seen = new Set<string>()
    select(items.filter((i) => (seen.has(`${i.kind}:${i.id}`) ? false : (seen.add(`${i.kind}:${i.id}`), true))))
  }
  const off = maxError > 0 ? (maxError >= 0.01 ? `${Math.round(maxError * 100)} cm` : `${Math.round(maxError * 1000)} mm`) : null

  return (
    <div className="conflict-card" role="alert">
      <div className="conflict-title">
        <WarningIcon size={14} />
        {rules.length > 2 ? `${rules.length} rules can't all hold` : "Two rules can't both hold"}
        <button className="x" onClick={() => setDismissed(key)} title="Dismiss">
          <Icon name="close" size={13} strokeWidth={2} />
        </button>
      </div>
      <div className="conflict-rules">
        {rules.slice(0, 4).map((r) => (
          <span key={r.id}>
            <b>·</b>
            {r.text}
          </span>
        ))}
        {rules.length > 4 && <span className="muted">and {rules.length - 4} more</span>}
      </div>
      <div className="conflict-body">
        They disagree{off ? ` by up to ${off}` : ''}. The closest compromise is drawn — unlock one of them, or change its value, to settle it.
      </div>
      <div className="row">
        {canUndo && !readOnly && (
          <button className="danger" onClick={undo}>
            Undo my change
          </button>
        )}
        <button onClick={showRules}>{rules.length > 2 ? 'Show the rules' : 'Show both rules'}</button>
      </div>
    </div>
  )
}
