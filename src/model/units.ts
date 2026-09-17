export type Units = 'm' | 'cm' | 'mm' | 'ft'

export const UNIT_LABELS: Record<Units, string> = { m: 'Metres', cm: 'Centimetres', mm: 'Millimetres', ft: 'Feet & inches' }
export const UNIT_ORDER: Units[] = ['m', 'cm', 'mm', 'ft']

const INCH = 0.0254

/** Format a length for display; `withUnit: false` gives the bare value that `parseLength` accepts back. */
export function formatLength(metres: number, units: Units, withUnit = true): string {
  if (units === 'cm') {
    const cm = Math.round(metres * 100)
    return withUnit ? `${cm} cm` : `${cm}`
  }
  if (units === 'mm') {
    const mm = Math.round(metres * 1000)
    return withUnit ? `${mm} mm` : `${mm}`
  }
  if (units === 'ft') {
    const sign = metres < 0 ? '-' : ''
    const totalInches = Math.abs(metres) / INCH
    let feet = Math.floor(totalInches / 12)
    let inches = Math.round((totalInches - feet * 12) * 10) / 10
    if (inches >= 12) {
      feet += 1
      inches = 0
    }
    const inchText = Number.isInteger(inches) ? `${inches}` : inches.toFixed(1)
    return feet > 0 ? `${sign}${feet}' ${inchText}"` : `${sign}${inchText}"`
  }
  const m = (Math.round(metres * 1000) / 1000).toFixed(2)
  return withUnit ? `${m} m` : m
}

/**
 * Parse a length into metres. Accepts "3.5", "3,5", "350cm", "3.5 m", "3m50", "12'", "5' 10.5\"",
 * "5ft 10in", "70\"", "5 1/2\"". Bare numbers use the current unit. Returns null when unparseable.
 */
export function parseLength(input: string, units: Units): number | null {
  const s = input.trim().toLowerCase().replace(',', '.').replace(/[′’]/g, "'").replace(/[″”]/g, '"')
  if (!s) return null
  const mixedMetric = /^(\d+(?:\.\d+)?)\s*m\s*(\d+)$/.exec(s)
  if (mixedMetric) return parseFloat(mixedMetric[1]) + parseFloat(mixedMetric[2]) / 100
  // feet and inches: 5' 10", 5ft 10in, 5' 10 1/2", 5', 10"
  const imperial = /^(-?)(?:(\d+(?:\.\d+)?)\s*(?:'|ft|feet|foot))?\s*(?:(\d+(?:\.\d+)?)(?:\s+(\d+)\/(\d+))?\s*(?:"|in|inch|inches))?$/.exec(s)
  if (imperial && (imperial[2] !== undefined || imperial[3] !== undefined) && /['"]|ft|in/.test(s)) {
    const feet = imperial[2] ? parseFloat(imperial[2]) : 0
    let inches = imperial[3] ? parseFloat(imperial[3]) : 0
    if (imperial[4] && imperial[5]) inches += parseFloat(imperial[4]) / parseFloat(imperial[5])
    const metres = (feet * 12 + inches) * INCH
    return imperial[1] === '-' ? -metres : metres
  }
  const m = /^(-?\d+(?:\.\d+)?)\s*(mm|cm|m)?$/.exec(s)
  if (!m) return null
  const value = parseFloat(m[1])
  if (!Number.isFinite(value)) return null
  const unit = m[2] ?? units
  if (unit === 'mm') return value / 1000
  if (unit === 'cm') return value / 100
  if (unit === 'ft') return value * 12 * INCH
  return value
}

export function formatArea(m2: number, units: Units = 'm'): string {
  if (units === 'ft') return `${(m2 / (INCH * INCH * 144)).toFixed(1)} ft²`
  return `${m2.toFixed(2)} m²`
}
