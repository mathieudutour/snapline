import { useEffect, useMemo, useRef, useState } from 'react'
import { isReadOnly, isSelected, SITE_ITEM, useEditor } from '../model/store'
import { AccountButton } from './Account'
import { PeerAvatars } from '../editor/Peers'
import { Icon, LockIcon, WarningIcon } from '../brand/Icons'
import { Compass, withNorth } from './Site'
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
      {mode === 'plan' && (
        <div className="canvas-chrome-group">
          <ViewPill />
          <DrawingSwitches />
        </div>
      )}
      {mode === 'plan' && <ScaleCorner />}
      <PresencePill />
      {mode === 'plan' && <ConflictCard />}
    </>
  )
}

/**
 * Snap to grid, auto-lock and the ghost of the floor below are judged against the drawing
 * and flipped mid-draw, so they live next to the plan rather than on the settings page.
 * They are a second cluster, not more items on the view pill: the pill is text you click
 * to change a value, these are three binaries whose whole state is the fill. Icon-only —
 * a switch that is on does not need the word beside it, and the titles carry the names.
 */
function DrawingSwitches() {
  const snapGrid = useEditor((s) => s.snapGrid)
  const setSnapGrid = useEditor((s) => s.setSnapGrid)
  const autoHV = useEditor((s) => s.autoHV)
  const setAutoHV = useEditor((s) => s.setAutoHV)
  const showFloorBelow = useEditor((s) => s.showFloorBelow)
  const setShowFloorBelow = useEditor((s) => s.setShowFloorBelow)
  const hasFloorBelow = useEditor((s) => s.project.floors.findIndex((f) => f.id === s.activeFloorId) > 0)
  const readOnly = useEditor(isReadOnly)
  if (readOnly) return null
  return (
    <div className="canvas-chrome switches" role="group" aria-label="Drawing aids">
      <button className={`switch-item ${snapGrid ? 'on' : ''}`} aria-pressed={snapGrid} onClick={() => setSnapGrid(!snapGrid)} title={`Snap to the 5 cm grid: ${snapGrid ? 'on' : 'off'} (hold Ctrl / ⌘ while drawing to skip it)`}>
        <Icon name="grid" size={15} strokeWidth={1.9} title="Snap to grid" />
      </button>
      <button className={`switch-item ${autoHV ? 'on' : ''}`} aria-pressed={autoHV} onClick={() => setAutoHV(!autoHV)} title={`Auto-lock straight walls and furniture dropped against walls: ${autoHV ? 'on' : 'off'}`}>
        <LockIcon size={15} strokeWidth={2.1} />
      </button>
      <button className={`switch-item ${showFloorBelow && hasFloorBelow ? 'on' : ''}`} aria-pressed={showFloorBelow} disabled={!hasFloorBelow} onClick={() => setShowFloorBelow(!showFloorBelow)} title={hasFloorBelow ? `Show the floor below as a ghost: ${showFloorBelow ? 'on' : 'off'}` : 'Show the floor below as a ghost — there is no floor below this one'}>
        <Icon name="ghostFloor" size={15} strokeWidth={1.8} title="Floor below" />
      </button>
    </div>
  )
}

/** the zooms worth a click: 100 % is a metre drawn 100 px across, which Shift+0 also gives */
const ZOOM_PRESETS = [25, 50, 100, 200, 400]

/**
 * The bottom right corner is the drawing's: the scale it is drawn at and which way is north,
 * the two things a title block carries. The scale snaps to a conventional value (≈ when it is
 * only close) and opens a menu of scales to zoom to exactly; the north arrow selects the site.
 */
function ScaleCorner() {
  const zoom = useEditor((s) => s.zoomLevel)
  const requestZoom = useEditor((s) => s.requestZoom)
  const site = useEditor((s) => s.project.site)
  const siteSelected = useEditor((s) => isSelected(s.selection, 'site', 'site'))
  const select = useEditor((s) => s.select)
  const setSite = useEditor((s) => s.setSite)
  const readOnly = useEditor(isReadOnly)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])
  const scale = drawingScale(zoom, PX_PER_MM)
  return (
    <div className="canvas-chrome-group bottom-right">
      <div className="canvas-chrome scale popover-anchor" ref={ref}>
        <button className="pill-item num" onClick={() => setOpen((o) => !o)} title={scale.approx ? `Drawn at about 1:${scale.exact} on a 96 dpi screen — pick a scale to zoom to` : `Drawn at 1:${scale.nearest} on a 96 dpi screen — pick a scale to zoom to`}>
          {scale.nearest ? `${scale.approx ? '≈ ' : ''}1:${scale.nearest}` : '1:—'}
        </button>
        {open && (
          <div className="menu up">
            <div className="menu-title">Draw at</div>
            {DRAWING_SCALES.map((d) => (
              <button key={d} className={`menu-item num ${d === scale.nearest && !scale.approx ? 'on' : ''}`} onClick={() => (requestZoom(zoomForScale(d, PX_PER_MM)), setOpen(false))}>
                1:{d}
              </button>
            ))}
          </div>
        )}
      </div>
      {site && (
        // the arrow is the site's click target on the plan, the way a wall's poché is the wall's; selected, it turns
        <button className={`north-arrow ${siteSelected ? 'on' : ''}`} title={siteSelected ? `North is at ${Math.round(site.north)}° — drag to turn the plan` : `North is at ${Math.round(site.north)}° from the top of the plan · click to select the site`} onClick={() => !siteSelected && select([SITE_ITEM])}>
          <Compass north={site.north} size={36} onChange={siteSelected && !readOnly ? (n) => setSite(withNorth(site, n)) : undefined} />
        </button>
      )}
    </div>
  )
}

/** floor · zoom · how many measurements it shows */
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
  const hasSelection = useEditor((s) => s.selection.length > 0)
  const [open, setOpen] = useState<'floors' | 'zoom' | null>(null)
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
  const hidden = labelStats.hidden > 0 ? `, ${labelStats.hidden} hidden so none overlap` : ''
  return (
    <div className="canvas-chrome left popover-anchor" ref={ref}>
      <button className="pill-item strong" onClick={() => setOpen((o) => (o === 'floors' ? null : 'floors'))} title="Switch floor (PageUp / PageDown)">
        {floor?.name ?? 'Floor'}
      </button>
      <span className="pill-sep" />
      <button className="pill-item num" onClick={() => setOpen((o) => (o === 'zoom' ? null : 'zoom'))} title="Screen zoom: how many pixels a metre is drawn across — click to fit the plan or pick a zoom">
        {Math.round(zoom)}%
      </button>
      <span className="pill-sep" />
      <button className="pill-item density" onClick={cycleDensity} title={`Measurements: ${DENSITY_LABELS[density].toLowerCase()} — ${DENSITY_HINTS[density]} (${labelStats.shown} shown${hidden}). Shift+D cycles.`}>
        <Icon name="density" size={15} />
        {DENSITY_LABELS[density]}
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
      {open === 'zoom' && (
        <div className="menu">
          <button className="menu-item" onClick={() => (requestFit('plan'), setOpen(null))}>
            Zoom to fit <kbd>⇧1</kbd>
          </button>
          <button className="menu-item" disabled={!hasSelection} onClick={() => (requestFit('selection'), setOpen(null))}>
            Zoom to selection <kbd>⇧2</kbd>
          </button>
          <div className="menu-sep" />
          {ZOOM_PRESETS.map((z) => (
            <button key={z} className={`menu-item num ${Math.round(zoom) === z ? 'on' : ''}`} onClick={() => (requestZoom(z), setOpen(null))}>
              {z}%{z === 100 ? <kbd>⇧0</kbd> : null}
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
