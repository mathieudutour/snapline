/**
 * Sun position for a site and a moment, after the NOAA solar calculator (good to a fraction of a degree).
 * Times are the site's standard clock time, taken from its longitude (no daylight saving).
 */
export interface Site {
  /** degrees, north positive — unset until the building is located */
  lat?: number
  /** degrees, east positive */
  lng?: number
  /** compass bearing of the top of the plan, degrees clockwise from north */
  north: number
}

export type Season = 'summer' | 'equinox' | 'winter'
/** day of the year for each preset (June solstice, March equinox, December solstice) */
export const SEASON_DAY: Record<Season, number> = { summer: 172, equinox: 80, winter: 355 }

export interface SunPosition {
  /** degrees clockwise from north */
  azimuth: number
  /** degrees above the horizon (negative at night) */
  elevation: number
}

const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI

/** standard time zone offset (hours) implied by the longitude */
export function standardTimeZone(lng: number): number {
  return Math.round(lng / 15)
}

export function sunPosition(site: { lat: number; lng: number }, dayOfYear: number, hour: number): SunPosition {
  const g = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (hour - 12) / 24)
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g))
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g)
  const timeOffset = eqTime + 4 * site.lng - 60 * standardTimeZone(site.lng)
  const trueSolarMinutes = hour * 60 + timeOffset
  const hourAngle = rad(trueSolarMinutes / 4 - 180)
  const lat = rad(site.lat)
  const cosZenith = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle)
  const zenith = Math.acos(Math.max(-1, Math.min(1, cosZenith)))
  const elevation = 90 - deg(zenith)
  let azimuth: number
  const denom = Math.cos(lat) * Math.sin(zenith)
  if (Math.abs(denom) < 1e-9) azimuth = 180
  else {
    const cosAz = (Math.sin(lat) * Math.cos(zenith) - Math.sin(decl)) / denom
    azimuth = deg(Math.acos(Math.max(-1, Math.min(1, cosAz))))
    // acos gives the angle from south; before solar noon the sun is in the east
    azimuth = hourAngle > 0 ? 180 + azimuth : 180 - azimuth
  }
  return { azimuth: ((azimuth % 360) + 360) % 360, elevation }
}

/** unit vector towards the sun in scene space (x east of the plan's up, y up, z down the plan), given the plan's north bearing */
export function sunVector(sun: SunPosition, north: number): [number, number, number] {
  const bearing = rad(sun.azimuth - north) // relative to the top of the plan
  const el = rad(sun.elevation)
  return [Math.sin(bearing) * Math.cos(el), Math.sin(el), -Math.cos(bearing) * Math.cos(el)]
}

export function formatHour(hour: number): string {
  const h = Math.floor(hour)
  const m = Math.round((hour - h) * 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** season labels swap in the southern hemisphere */
export function seasonLabel(season: Season, lat: number): string {
  const south = lat < 0
  if (season === 'equinox') return 'Spring / autumn (equinox)'
  if (season === 'summer') return south ? 'Winter (21 June)' : 'Summer (21 June)'
  return south ? 'Summer (21 December)' : 'Winter (21 December)'
}

/** a site that knows where it is, which is what the sun needs */
export function located(site: Site | undefined): site is Site & { lat: number; lng: number } {
  return !!site && typeof site.lat === 'number' && typeof site.lng === 'number' && Number.isFinite(site.lat) && Number.isFinite(site.lng)
}

/**
 * Coordinates the way people paste them. Google Maps copies "45.9249, 6.6815"; other apps
 * give "45.9249 6.6815" or "45.9249; 6.6815"; a place page gives 45°55'29.6"N 6°40'53.4"E.
 * One field takes them all, so no paragraph has to explain how to split a string in two.
 */
export function parseLatLng(input: string): { lat: number; lng: number } | null {
  const s = input.trim().replace(/[′’]/g, "'").replace(/[″”]/g, '"')
  if (!s) return null
  // degrees, minutes, seconds, with a hemisphere letter
  const dms = /(\d+(?:\.\d+)?)\s*°\s*(?:(\d+(?:\.\d+)?)\s*'\s*)?(?:(\d+(?:\.\d+)?)\s*"\s*)?([NSEW])/gi
  const parts: { value: number; hemi: string }[] = []
  for (const m of s.matchAll(dms)) {
    const value = parseFloat(m[1]) + (m[2] ? parseFloat(m[2]) / 60 : 0) + (m[3] ? parseFloat(m[3]) / 3600 : 0)
    parts.push({ value, hemi: m[4].toUpperCase() })
  }
  if (parts.length === 2) {
    const lat = parts.find((p) => p.hemi === 'N' || p.hemi === 'S')
    const lng = parts.find((p) => p.hemi === 'E' || p.hemi === 'W')
    if (!lat || !lng) return null
    return check(lat.hemi === 'S' ? -lat.value : lat.value, lng.hemi === 'W' ? -lng.value : lng.value)
  }
  // two decimal numbers, separated by a comma, a semicolon or space
  const dec = /^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(s)
  if (!dec) return null
  return check(parseFloat(dec[1]), parseFloat(dec[2]))
}

function check(lat: number, lng: number): { lat: number; lng: number } | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return { lat: Math.round(lat * 1e4) / 1e4, lng: Math.round(lng * 1e4) / 1e4 }
}
