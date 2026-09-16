/**
 * The Cordeau mark: two walls meeting in a mitred corner, set out on a drawing grid.
 *
 * One geometry, four cuts. Which cut you get is a property of the size, never a choice:
 * the construction comes off in a fixed order — grid first, then the dimension ticks,
 * then the 45° snap line, then the mitre itself. Never hand-thin the hairlines to make a
 * size work; switch cut.
 *
 *   setting-out  96 px +   everything. Hero, app icon, print, loading.
 *   reduced      40–96 px  grid off. Snap line and one dimension stay.
 *   full         24–40 px  mark and mitre only — rail, nav, headers.
 *   icon         16–24 px  silhouette, thicker arms. Favicon, tab.
 *
 * Colour language, borrowed from the canvas so the logo and the editor speak the same one:
 * blue is a rule you set (the mitre, the dimensions), amber is a snap (the 45° setting-out
 * line and the point it lands on), the grid is paper rather than information.
 */

export const INK = '#1f2328'
export const CHALK_BLUE = '#2f6fed'
/** the mitre and the hairlines lift to this tint when the mark sits on ink */
export const CHALK_BLUE_ON_INK = '#7aa2f7'
export const SNAP_AMBER = '#e0891d'
export const GRID_ON_PAPER = '#cfc9b8'
export const GRID_ON_INK = '#4a5058'

export type Cut = 'setting-out' | 'reduced' | 'full' | 'icon'

/** the removal order is fixed, so the cut follows from the size alone */
export function cutForSize(size: number): Cut {
  if (size >= 96) return 'setting-out'
  if (size >= 40) return 'reduced'
  if (size >= 24) return 'full'
  return 'icon'
}

interface MarkProps {
  size?: number
  /** force a cut instead of letting the size pick one (the hero wants the drawing at any size) */
  cut?: Cut
  /** the mark sits on a dark tile: the shape goes white and the hairlines lift */
  onInk?: boolean
  className?: string
  title?: string
}

export function Mark({ size = 24, cut, onInk = false, className, title }: MarkProps) {
  const which = cut ?? cutForSize(size)
  const shape = onInk ? '#ffffff' : INK
  const rule = onInk ? CHALK_BLUE_ON_INK : CHALK_BLUE
  const grid = onInk ? GRID_ON_INK : GRID_ON_PAPER
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" className={className} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      {title && <title>{title}</title>}
      {which === 'setting-out' && (
        <g stroke={grid} strokeWidth={0.7}>
          <path d="M16 6 V114 M48 6 V114 M104 6 V114 M6 16 H114 M6 48 H114 M6 104 H114" />
        </g>
      )}
      {(which === 'setting-out' || which === 'reduced') && <line x1={16} y1={16} x2={104} y2={104} stroke={SNAP_AMBER} strokeWidth={which === 'setting-out' ? 1 : 1.2} strokeDasharray="3 2.4" />}
      {which === 'icon' ? <path d="M14 14 H106 V50 H50 V106 H14 Z" fill={shape} /> : <path d="M16 16 H104 V48 H48 V104 H16 Z" fill={shape} />}
      {which !== 'icon' && <line x1={16} y1={16} x2={48} y2={48} stroke={rule} strokeWidth={which === 'full' ? 5 : which === 'reduced' ? 2.4 : 2.2} />}
      {which === 'setting-out' && <circle cx={48} cy={48} r={2.6} fill={onInk ? INK : '#fff'} stroke={SNAP_AMBER} strokeWidth={1.1} />}
      {which === 'setting-out' && (
        <g stroke={rule} strokeWidth={0.9}>
          <path d="M16 111 H48 M16 108 V114 M48 108 V114" />
          <path d="M111 16 V48 M108 16 H114 M108 48 H114" />
        </g>
      )}
      {which === 'reduced' && (
        <g stroke={rule} strokeWidth={1.1}>
          <path d="M16 111 H48 M16 108 V114 M48 108 V114" />
        </g>
      )}
    </svg>
  )
}

/** the mark in a rounded ink tile — the rail, the app icon, anywhere the mark needs its own ground */
export function MarkTile({ size = 28, radius, markSize }: { size?: number; radius?: number; markSize?: number }) {
  const inner = markSize ?? Math.round(size * 0.6)
  return (
    <span className="mark-tile" style={{ width: size, height: size, borderRadius: radius ?? Math.round(size * 0.29) }}>
      <Mark size={inner} onInk />
    </span>
  )
}

/**
 * The lockup. Archivo 600 at −3.5% tracking, never system-ui: the UI stays native, the
 * wordmark is the one place the brand speaks. Gap between mark and word is one arm
 * thickness at the mark's scale (32/120), and the clear space all round is the same.
 */
export function Lockup({ size = 24, stacked = false, onInk = false, className = '' }: { size?: number; stacked?: boolean; onInk?: boolean; className?: string }) {
  return (
    <span className={`lockup ${stacked ? 'stacked' : ''} ${className}`.trim()} style={{ gap: Math.round((size * 32) / 120), ['--wordmark-size' as string]: `${Math.round(size * (stacked ? 0.84 : 0.72))}px` }}>
      <Mark size={size} onInk={onInk} />
      <span className="wordmark">Cordeau</span>
    </span>
  )
}
