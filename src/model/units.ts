import type { PlanSettings } from './types'

export function formatLength(metres: number, units: PlanSettings['units'], withUnit = true): string {
  if (units === 'cm') {
    const cm = Math.round(metres * 100)
    return withUnit ? `${cm} cm` : `${cm}`
  }
  const m = (Math.round(metres * 1000) / 1000).toFixed(2)
  return withUnit ? `${m} m` : m
}

/** Parse "3.5", "3,5", "350cm", "3.5 m", "3m50" into metres. Returns null when unparseable. */
export function parseLength(input: string, units: PlanSettings['units']): number | null {
  const s = input.trim().toLowerCase().replace(',', '.')
  if (!s) return null
  const mixed = /^(\d+(?:\.\d+)?)\s*m\s*(\d+)$/.exec(s)
  if (mixed) return parseFloat(mixed[1]) + parseFloat(mixed[2]) / 100
  const m = /^(-?\d+(?:\.\d+)?)\s*(mm|cm|m)?$/.exec(s)
  if (!m) return null
  const value = parseFloat(m[1])
  if (!Number.isFinite(value)) return null
  const unit = m[2] ?? units
  if (unit === 'mm') return value / 1000
  if (unit === 'cm') return value / 100
  return value
}

export function formatArea(m2: number): string {
  return `${m2.toFixed(2)} m²`
}
