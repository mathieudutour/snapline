import { useEditor } from '../model/store'
import { formatHour, SEASON_DAY, seasonLabel, sunPosition, type Season } from '../model/sun'

const SEASONS: Season[] = ['summer', 'equinox', 'winter']

/** season and time of day for the sun in the 3D views (shown when the project has a site) */
export function SunControls() {
  const site = useEditor((s) => s.project.site)
  const sun = useEditor((s) => s.sun)
  const setSun = useEditor((s) => s.setSun)
  const setProjectSettingsOpen = useEditor((s) => s.setProjectSettingsOpen)
  if (!site)
    return (
      <div className="props">
        <h3>Sun</h3>
        <p className="muted small">
          Give the project a location and orientation to light it with the real sun.{' '}
          <button className="link" onClick={() => setProjectSettingsOpen(true)}>
            Set the site
          </button>{' '}
          in the project settings.
        </p>
      </div>
    )
  const pos = sunPosition(site, SEASON_DAY[sun.season], sun.hour)
  return (
    <div className="props">
      <h3>Sun</h3>
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
      <p className="muted small">{pos.elevation > 0 ? `Sun ${Math.round(pos.elevation)}° above the horizon, bearing ${Math.round(pos.azimuth)}°.` : 'Night: the sun is below the horizon.'} Drag the time to watch the shadows move.</p>
    </div>
  )
}
