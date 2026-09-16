import { useEffect, useMemo, useRef, useState } from 'react'
import { isReadOnly, useEditor } from '../model/store'
import { AccountButton } from './Account'
import { PeerAvatars } from '../editor/Peers'
import { Icon, WarningIcon } from '../brand/Icons'
import { describeConstraint } from '../model/constraints'
import type { Constraint } from '../model/types'
import type { SelectionItem } from '../model/store'

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

/** floor · zoom · the scale the plan is actually drawn at */
function ViewPill() {
  const floors = useEditor((s) => s.project.floors)
  const activeFloorId = useEditor((s) => s.activeFloorId)
  const setActiveFloor = useEditor((s) => s.setActiveFloor)
  const zoom = useEditor((s) => s.zoomLevel)
  const requestFit = useEditor((s) => s.requestFit)
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
  const floor = floors.find((f) => f.id === activeFloorId)
  const denominator = zoom > 0 ? Math.round(1000 / (zoom / PX_PER_MM)) : 0
  return (
    <div className="canvas-chrome left popover-anchor" ref={ref}>
      <button className="pill-item strong" onClick={() => setOpen((o) => !o)} title="Switch floor (PageUp / PageDown)">
        {floor?.name ?? 'Floor'}
      </button>
      <span className="pill-sep" />
      <span className="pill-item num" title="Screen zoom: how many pixels a metre is drawn across">
        {Math.round(zoom)}%
      </span>
      <span className="pill-sep" />
      <span className="pill-item num" title="The scale the plan is drawn at on a 96 dpi screen">
        1:{denominator || '—'}
      </span>
      <span className="pill-sep" />
      <button className="pill-item" onClick={requestFit} title="Zoom to fit (Shift+1)">
        <Icon name="dimension" size={15} title="Zoom to fit" />
      </button>
      {open && (
        <div className="menu">
          <div className="menu-title">Floors</div>
          {[...floors].reverse().map((f) => (
            <button key={f.id} className={`menu-item ${f.id === activeFloorId ? 'on' : ''}`} onClick={() => (setActiveFloor(f.id), setOpen(false))}>
              {f.name}
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

/** the geometry a rule is about, so "Show both rules" can take you to it */
function targetsOf(c: Constraint): SelectionItem[] {
  switch (c.type) {
    case 'length':
    case 'horizontal':
    case 'vertical':
      return [{ kind: 'wall', id: c.wallId }]
    case 'parallel':
    case 'perpendicular':
    case 'equalLength':
    case 'angle':
    case 'wallGap':
      return [
        { kind: 'wall', id: c.wallA },
        { kind: 'wall', id: c.wallB },
      ]
    case 'fixed':
      return [{ kind: 'point', id: c.pointId }]
    case 'distance':
      return [
        { kind: 'point', id: c.pointA },
        { kind: 'point', id: c.pointB },
      ]
    case 'furnitureWallGap':
    case 'furnitureFixed':
      return [{ kind: 'furniture', id: c.furnitureId }]
    default:
      return [{ kind: 'opening', id: c.openingId }]
  }
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
        .map((c) => ({ id: c.id, text: describeConstraint(plan, c), targets: targetsOf(c) })),
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
