import { useEffect, useRef, useState } from 'react'
import { useEditor } from '../model/store'
import { formatHour, located, parseLatLng, SEASON_DAY, seasonLabel, sunPosition, type Season, type Site } from '../model/sun'

const SEASONS: Season[] = ['summer', 'equinox', 'winter']

/**
 * The site: where the building stands and which way the plan faces, and the sun that follows
 * from both. It is an object you select — from the Project group in the left panel, or by
 * clicking the north arrow on the plan — and edit here, while looking at the drawing. Which
 * way the plan faces is the one setting you cannot judge with a scrim over the plan, which is
 * why this is not a modal any more.
 */
export function SiteProps() {
  const site = useEditor((s) => s.project.site)
  const setSite = useEditor((s) => s.setSite)
  const sun = useEditor((s) => s.sun)
  const setSun = useEditor((s) => s.setSun)
  const isLocated = located(site)
  const [text, setText] = useState(isLocated ? `${site.lat}, ${site.lng}` : '')
  const [error, setError] = useState<string | null>(null)
  const [locating, setLocating] = useState(false)
  useEffect(() => setText(located(site) ? `${site.lat}, ${site.lng}` : ''), [site])

  const commitLocation = () => {
    if (!text.trim()) {
      if (isLocated) setSite({ north: site.north })
      setError(null)
      return
    }
    const parsed = parseLatLng(text)
    if (!parsed) return setError('Paste the two numbers Google Maps gives you, like 45.9249, 6.6815.')
    setError(null)
    setSite({ ...(site ?? { north: 0 }), ...parsed })
  }
  const locate = () => {
    if (!navigator.geolocation) return setError('Your browser does not offer location.')
    setLocating(true)
    setError(null)
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setSite({ ...(site ?? { north: 0 }), lat: Math.round(p.coords.latitude * 1e4) / 1e4, lng: Math.round(p.coords.longitude * 1e4) / 1e4 })
        setLocating(false)
      },
      (err) => {
        setError(err.code === err.PERMISSION_DENIED ? 'Location access was blocked in the browser. Paste the coordinates instead.' : 'Could not get your location. Paste the coordinates instead.')
        setLocating(false)
      },
      { timeout: 10_000 },
    )
  }
  const setNorth = (v: number) => setSite({ ...(site ?? {}), north: ((Math.round(v) % 360) + 360) % 360 })
  const pos = isLocated ? sunPosition(site, SEASON_DAY[sun.season], sun.hour) : null

  return (
    <div className="props">
      <h3>
        Site
        {isLocated && (
          <span className="num">
            {site.lat.toFixed(2)}, {site.lng.toFixed(2)}
          </span>
        )}
      </h3>
      <label className="field">
        <span>Location</span>
        <span className="field-input wide locate">
          <input
            value={text}
            placeholder="45.9249, 6.6815"
            onChange={(e) => setText(e.target.value)}
            onBlur={commitLocation}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
          />
          <button type="button" className="link" onClick={locate} disabled={locating}>
            {locating ? 'Locating…' : 'Locate me'}
          </button>
        </span>
      </label>
      {error ? <p className="warn small">{error}</p> : <p className="muted small">Paste from Google Maps as-is.</p>}
      <div className="north-row">
        <div>
          <label className="field">
            <span>North</span>
            <span className="field-input">
              <input type="number" step={1} min={-360} max={720} value={Math.round(site?.north ?? 0)} onChange={(e) => setNorth(Number(e.target.value) || 0)} />
              <em>°</em>
            </span>
          </label>
          <p className="muted small">Drag the needle, or click the north arrow on the plan. The box is your plan.</p>
        </div>
        <Compass north={site?.north ?? 0} size={96} onChange={setNorth} plan />
      </div>
      {isLocated && (
        <>
          <h4>
            Sun
            {pos && <span className="num">{pos.elevation > 0 ? `${Math.round(pos.elevation)}° up · bearing ${Math.round(pos.azimuth)}°` : 'below the horizon'}</span>}
          </h4>
          <label className="field">
            <span>Season</span>
            <select value={sun.season} onChange={(e) => setSun({ season: e.target.value as Season })}>
              {SEASONS.map((s) => (
                <option key={s} value={s}>
                  {seasonLabel(s, site.lat)}
                </option>
              ))}
            </select>
          </label>
          <label className="field sun-time">
            <span>Time</span>
            <input type="range" min={4} max={22} step={0.25} value={sun.hour} onChange={(e) => setSun({ hour: Number(e.target.value) })} />
            <em>{formatHour(sun.hour)}</em>
          </label>
        </>
      )}
      {site && (
        <div className="row" style={{ marginTop: 10 }}>
          <button className="small" onClick={() => setSite(null)}>
            Remove the site
          </button>
          <span className="muted small">Removes location and sun.</span>
        </div>
      )}
    </div>
  )
}

/** the bearing of a pointer from the centre of an element, clockwise from up */
function bearingFrom(el: Element, clientX: number, clientY: number): number {
  const r = el.getBoundingClientRect()
  const dx = clientX - (r.left + r.width / 2)
  const dy = clientY - (r.top + r.height / 2)
  return (Math.atan2(dx, -dy) * 180) / Math.PI
}

/**
 * A compass: the needle shows where north is on the plan. With `onChange` it is the control,
 * not a readout — a bearing is circular, and dragging the needle is the natural gesture (a
 * slider puts 0° and 359° at opposite ends of a track). With `plan`, a small rectangle in the
 * middle shows the plan, so you see which way it faces as you turn the needle.
 */
export function Compass({ north, size = 28, onChange, plan, className }: { north: number; size?: number; onChange?: (north: number) => void; plan?: boolean; className?: string }) {
  const ref = useRef<SVGSVGElement>(null)
  const dragging = useRef(false)
  const apply = (e: React.PointerEvent) => {
    if (!ref.current || !onChange) return
    // the needle points at the pointer: north is where the needle points, measured against the top of the plan
    onChange(((-bearingFrom(ref.current, e.clientX, e.clientY) % 360) + 360) % 360)
  }
  return (
    <svg
      ref={ref}
      className={`compass ${onChange ? 'live' : ''} ${className ?? ''}`}
      width={size}
      height={size}
      viewBox="-16 -16 32 32"
      role={onChange ? 'slider' : undefined}
      aria-label={`North at ${Math.round(north)}°`}
      aria-valuenow={onChange ? Math.round(north) : undefined}
      onPointerDown={
        onChange
          ? (e) => {
              e.preventDefault()
              e.stopPropagation()
              dragging.current = true
              ref.current?.setPointerCapture(e.pointerId)
              apply(e)
            }
          : undefined
      }
      onPointerMove={onChange ? (e) => dragging.current && apply(e) : undefined}
      onPointerUp={
        onChange
          ? (e) => {
              dragging.current = false
              ref.current?.releasePointerCapture(e.pointerId)
            }
          : undefined
      }
      onPointerCancel={onChange ? () => (dragging.current = false) : undefined}
    >
      <circle r={15} fill="white" stroke="#c9ced8" />
      {plan && <rect x={-4.5} y={-3} width={9} height={6} rx={0.8} fill="none" stroke="#8b9099" strokeWidth={0.9} />}
      <g transform={`rotate(${-north})`}>
        <path d="M0 -13 L4 0 L0 -3 L-4 0 Z" fill="#e0245e" />
        <path d="M0 13 L4 0 L0 3 L-4 0 Z" fill="#c9ced8" />
        <text y={-6} fontSize={7} textAnchor="middle" fill="white" fontWeight={700} fontFamily="ui-sans-serif, system-ui, sans-serif">
          N
        </text>
      </g>
    </svg>
  )
}

/** a site with the given north, keeping its location if it has one */
export function withNorth(site: Site | undefined, north: number): Site {
  return { ...(site ?? {}), north: ((Math.round(north) % 360) + 360) % 360 }
}
