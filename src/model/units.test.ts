import { describe, expect, it } from 'vitest'
import { formatLength, parseLength, formatArea } from './units'

describe('units', () => {
  it('formats metric', () => {
    expect(formatLength(3.5, 'm')).toBe('3.50 m')
    expect(formatLength(3.5, 'cm')).toBe('350 cm')
  })
  it('formats imperial as feet and inches', () => {
    expect(formatLength(0.3048 * 5 + 0.0254 * 10, 'ft')).toBe(`5' 10"`)
    expect(formatLength(0.0254 * 6.5, 'ft')).toBe('6.5"')
    expect(formatLength(3.6576, 'ft')).toBe(`12' 0"`)
  })
  it('parses imperial notations', () => {
    expect(parseLength(`5' 10"`, 'ft')).toBeCloseTo(1.778, 4)
    expect(parseLength('5ft 10in', 'm')).toBeCloseTo(1.778, 4)
    expect(parseLength(`5' 10 1/2"`, 'ft')).toBeCloseTo((70.5 * 0.0254), 5)
    expect(parseLength(`70"`, 'ft')).toBeCloseTo(1.778, 4)
    expect(parseLength('12', 'ft')).toBeCloseTo(3.6576, 5)
    expect(parseLength('3.5', 'm')).toBe(3.5)
    expect(parseLength('350cm', 'ft')).toBe(3.5)
  })
  it('round-trips the bare display value', () => {
    for (const u of ['m', 'cm', 'ft'] as const) {
      const back = parseLength(formatLength(2.44, u, false), u)!
      expect(Math.abs(back - 2.44)).toBeLessThan(u === 'ft' ? 0.002 : 0.006)
    }
  })
  it('formats area', () => {
    expect(formatArea(10, 'm')).toBe('10.00 m²')
    expect(formatArea(10, 'ft')).toBe('107.6 ft²')
  })
})
