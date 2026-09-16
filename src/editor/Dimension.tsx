import type { Vec2 } from '../model/types'
import { add, normalize, scale, sub } from '../model/geometry'

interface Props {
  p1: Vec2
  p2: Vec2
  /** unit normal pointing to the side where the dimension line is drawn */
  side: Vec2
  distance: number
  text: string
  px: number
  locked?: boolean
  violated?: boolean
  muted?: boolean
  /**
   * opens the value editor. Only ⌥ (Option / Alt) + click reaches it, so a plain click on a label
   * falls through to the canvas and selects the wall or opening instead of locking a length.
   * Touch has no modifier key, so a tap opens the editor.
   */
  onClick?: (e: React.PointerEvent | React.MouseEvent) => void
  /** ⌥ is held: show the text cursor over the label */
  editHeld?: boolean
}

const ACCENT = '#2f6fed'
const DANGER = '#d7263d'
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'

/**
 * A measurement on the plan, drawn so you can tell at a glance whether it is a rule.
 *
 * A locked length is a filled chip in chalk blue with a padlock: it is a value the plan
 * has to keep. A free one is a hairline and a quiet outlined chip: it is just what the
 * plan currently measures. A rule that cannot hold goes filled red. Before, a locked
 * value looked identical to a free one, which made the product's whole idea invisible.
 */
export function Dimension({ p1, p2, side, distance, text, px, locked, violated, muted, onClick, editHeld }: Props) {
  const a = add(p1, scale(side, distance))
  const b = add(p2, scale(side, distance))
  const u = normalize(sub(p2, p1))
  let angle = (Math.atan2(u.y, u.x) * 180) / Math.PI
  if (angle > 90 || angle <= -90) angle += 180
  const mid = scale(add(a, b), 0.5)
  const tick = scale(side, 6 * px)
  const held = !!locked || !!violated
  const line = violated ? DANGER : locked ? ACCENT : muted ? '#c8cbd1' : '#b9bcc2'
  const fill = violated ? DANGER : locked ? ACCENT : '#fff'
  const ink = held ? '#fff' : muted ? '#9aa0a6' : '#6b7280'
  const fontSize = 11 * px
  const width = (text.length * 6.7 + (locked && !violated ? 15 : 0) + 16) * px
  const height = 18 * px
  return (
    <g className="dimension" style={{ pointerEvents: 'none' }}>
      {/* the line and its ticks often cross other walls: only the label takes the pointer */}
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={line} strokeWidth={px} />
      <line x1={a.x - tick.x} y1={a.y - tick.y} x2={a.x + tick.x} y2={a.y + tick.y} stroke={line} strokeWidth={px} />
      <line x1={b.x - tick.x} y1={b.y - tick.y} x2={b.x + tick.x} y2={b.y + tick.y} stroke={line} strokeWidth={px} />
      <g
        transform={`translate(${mid.x} ${mid.y}) rotate(${angle})`}
        pointerEvents={onClick ? 'auto' : 'none'}
        onPointerDown={
          onClick
            ? (e) => {
                if (e.button !== 0 || !(e.altKey || e.pointerType === 'touch')) return // plain click: the canvas selects what the label belongs to
                // handle on pointerdown: the canvas captures the pointer, which would retarget a click
                e.stopPropagation()
                onClick(e)
              }
            : undefined
        }
        style={{ cursor: onClick && editHeld ? 'text' : undefined }}
      >
        <rect x={-width / 2} y={-height / 2} width={width} height={height} rx={height / 2} fill={fill} stroke={held ? 'none' : '#dcdde0'} strokeWidth={px} />
        {locked && !violated && (
          <g transform={`translate(${-width / 2 + 7 * px} ${-4.5 * px}) scale(${px})`} fill="none" stroke="#fff" strokeWidth={1.3}>
            <rect x={0.5} y={4} width={7} height={5.5} rx={1} fill="#fff" stroke="none" />
            <path d="M2 4 V2.5 a2 2 0 0 1 4 0 V4" />
          </g>
        )}
        <text x={locked && !violated ? 7 * px : 0} y={0} fontSize={fontSize} fontWeight={held ? 600 : 400} textAnchor="middle" dominantBaseline="central" fill={ink} fontFamily={MONO}>
          {text}
        </text>
      </g>
    </g>
  )
}
