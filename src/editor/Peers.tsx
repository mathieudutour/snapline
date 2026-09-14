import { useMemo } from 'react'
import { useEditor } from '../model/store'

/** entity key ("wall:w1") → colour of the peer who has it selected on the active floor */
export function usePeerSelections(): Map<string, string> {
  const live = useEditor((s) => s.live)
  const floorId = useEditor((s) => s.activeFloorId)
  return useMemo(() => {
    const map = new Map<string, string>()
    for (const peer of live.peers) {
      const p = live.presence[peer.id]
      if (!p || p.floorId !== floorId) continue
      for (const s of p.selection) if (!map.has(`${s.kind}:${s.id}`)) map.set(`${s.kind}:${s.id}`, peer.color)
    }
    return map
  }, [live, floorId])
}

/** other people's pointers on the active floor, drawn in plan coordinates */
export function PeerCursors({ px }: { px: number }) {
  const live = useEditor((s) => s.live)
  const floorId = useEditor((s) => s.activeFloorId)
  if (live.status !== 'on') return null
  return (
    <g style={{ pointerEvents: 'none' }}>
      {live.peers.map((peer) => {
        const p = live.presence[peer.id]
        if (!p?.cursor || p.floorId !== floorId) return null
        const label = peer.name || peer.email
        return (
          <g key={peer.id} transform={`translate(${p.cursor.x} ${p.cursor.y}) scale(${px})`}>
            <path d="M0 0 L0 16 L4.5 12.5 L7.5 19 L10 18 L7 11.5 L12.5 11.5 Z" fill={peer.color} stroke="white" strokeWidth={1.2} strokeLinejoin="round" />
            <g transform="translate(14 16)">
              <rect x={0} y={0} width={label.length * 6.4 + 10} height={18} rx={4} fill={peer.color} />
              <text x={5} y={13} fontSize={11} fill="white" fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight={600}>
                {label}
              </text>
            </g>
          </g>
        )
      })}
    </g>
  )
}

/** who else is in the project right now (inspector header) */
export function PeerAvatars() {
  const live = useEditor((s) => s.live)
  if (live.status === 'off') return null
  return (
    <div className={`peers ${live.status}`} title={live.status === 'on' ? (live.peers.length ? `Editing live with ${live.peers.map((p) => p.name || p.email).join(', ')}` : 'Live: nobody else is here right now') : 'Connecting to the live session…'}>
      {live.peers.slice(0, 4).map((p) => (
        <span key={p.id} className={`peer ${p.role}`} style={{ background: p.color }} title={`${p.name || p.email}${p.role === 'viewer' ? ' (viewing)' : ''}`}>
          {(p.name || p.email).slice(0, 1).toUpperCase()}
        </span>
      ))}
      {live.peers.length > 4 && <span className="peer more">+{live.peers.length - 4}</span>}
      <span className="live-dot" />
    </div>
  )
}
