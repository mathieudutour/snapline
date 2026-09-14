import { useState } from 'react'
import { useEditor } from '../model/store'
import type { Site } from '../model/sun'

const DEFAULT_SITE: Site = { lat: 48.8566, lng: 2.3522, north: 0 }

/** where the building stands and which way the plan faces; drives the sun in 3D */
export function SiteProps() {
  const site = useEditor((s) => s.project.site)
  const setSite = useEditor((s) => s.setSite)
  const [locating, setLocating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const locate = () => {
    if (!navigator.geolocation) return setError('Your browser does not offer location.')
    setLocating(true)
    setError(null)
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setSite({ ...(site ?? DEFAULT_SITE), lat: Math.round(p.coords.latitude * 1e4) / 1e4, lng: Math.round(p.coords.longitude * 1e4) / 1e4 })
        setLocating(false)
      },
      () => {
        setError('Could not get your location; type the coordinates instead.')
        setLocating(false)
      },
      { timeout: 10_000 },
    )
  }
  if (!site)
    return (
      <div className="props">
        <h3>Site</h3>
        <p className="muted small">Set where the building stands and which way the plan faces to light the 3D view with the real sun.</p>
        <div className="row">
          <button onClick={() => setSite(DEFAULT_SITE)}>Set the site</button>
          <button onClick={locate} disabled={locating}>
            {locating ? 'Locating…' : 'Use my location'}
          </button>
        </div>
        {error && <p className="warn small">{error}</p>}
      </div>
    )
  const num = (v: string, lo: number, hi: number, fallback: number) => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback
  }
  return (
    <div className="props">
      <h3>Site</h3>
      <label className="field coord">
        <span>Latitude</span>
        <span className="field-input">
          <input type="number" step={0.0001} min={-90} max={90} value={site.lat} onChange={(e) => setSite({ ...site, lat: num(e.target.value, -90, 90, site.lat) })} />
          <em>°</em>
        </span>
      </label>
      <label className="field coord">
        <span>Longitude</span>
        <span className="field-input">
          <input type="number" step={0.0001} min={-180} max={180} value={site.lng} onChange={(e) => setSite({ ...site, lng: num(e.target.value, -180, 180, site.lng) })} />
          <em>°</em>
        </span>
      </label>
      <div className="row">
        <button onClick={locate} disabled={locating}>
          {locating ? 'Locating…' : 'Use my location'}
        </button>
        <span className="muted small">Coordinates as in Google Maps (right-click a spot → the numbers at the top).</span>
      </div>
      <label className="field">
        <span>North</span>
        <span className="field-input">
          <input type="number" step={1} min={0} max={359} value={Math.round(site.north)} onChange={(e) => setSite({ ...site, north: ((num(e.target.value, -360, 720, site.north) % 360) + 360) % 360 })} />
          <em>°</em>
        </span>
      </label>
      <label className="field sun-time">
        <span />
        <input type="range" min={0} max={359} step={1} value={Math.round(site.north)} onChange={(e) => setSite({ ...site, north: Number(e.target.value) })} />
        <Compass north={site.north} />
      </label>
      <p className="muted small">North is the compass bearing of the top of the plan: 0° when the top of the plan faces north, 90° when it faces east. The 2D view shows the resulting north arrow.</p>
      <button className="small" onClick={() => setSite(null)}>
        Remove the site
      </button>
    </div>
  )
}

/** small compass: the needle shows where north is on the plan */
export function Compass({ north, size = 28 }: { north: number; size?: number }) {
  return (
    <svg className="compass" width={size} height={size} viewBox="-16 -16 32 32" aria-label={`North at ${Math.round(north)}°`}>
      <circle r={15} fill="white" stroke="#c9ced8" />
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
