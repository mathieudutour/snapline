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

export function Dimension({ p1, p2, side, distance, text, px, locked, violated, muted, onClick, editHeld }: Props) {
  const a = add(p1, scale(side, distance))
  const b = add(p2, scale(side, distance))
  const u = normalize(sub(p2, p1))
  let angle = (Math.atan2(u.y, u.x) * 180) / Math.PI
  if (angle > 90 || angle <= -90) angle += 180
  const mid = scale(add(a, b), 0.5)
  const tick = scale(side, 6 * px)
  const color = violated ? '#d7263d' : locked ? '#1d6fe0' : muted ? '#9a9a9a' : '#555'
  const fontSize = 11 * px
  const label = locked ? `${text}` : text
  const width = (label.length * 6.6 + (locked ? 14 : 0) + 8) * px
  const height = 16 * px
  return (
    <g className="dimension" style={{ pointerEvents: onClick ? 'auto' : 'none' }}>
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={px} />
      <line x1={a.x - tick.x} y1={a.y - tick.y} x2={a.x + tick.x} y2={a.y + tick.y} stroke={color} strokeWidth={px} />
      <line x1={b.x - tick.x} y1={b.y - tick.y} x2={b.x + tick.x} y2={b.y + tick.y} stroke={color} strokeWidth={px} />
      <g
        transform={`translate(${mid.x} ${mid.y}) rotate(${angle})`}
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
        <rect x={-width / 2} y={-height / 2} width={width} height={height} rx={3 * px} fill="white" stroke={color} strokeWidth={px * 0.75} />
        {locked && (
          <g transform={`translate(${-width / 2 + 5 * px} ${-4.5 * px}) scale(${px})`} fill="none" stroke={color} strokeWidth={1.3}>
            <rect x={0.5} y={4} width={7} height={5.5} rx={1} fill={color} stroke="none" />
            <path d="M2 4 V2.5 a2 2 0 0 1 4 0 V4" />
          </g>
        )}
        <text x={locked ? 6 * px : 0} y={0} fontSize={fontSize} textAnchor="middle" dominantBaseline="central" fill={color} fontFamily="ui-sans-serif, system-ui, sans-serif">
          {label}
        </text>
      </g>
    </g>
  )
}
