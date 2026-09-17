import { describe, expect, it } from 'vitest'
import { SEASON_DAY, sunPosition, sunVector } from './sun'

describe('sun position', () => {
  it('puts the sun high in the south at noon in Paris on the June solstice', () => {
    const s = sunPosition({ lat: 48.86, lng: 2.35 }, SEASON_DAY.summer, 12)
    expect(s.elevation).toBeGreaterThan(62)
    expect(s.elevation).toBeLessThan(66)
    expect(Math.abs(s.azimuth - 180)).toBeLessThan(8)
  })
  it('is low in winter, in the east in the morning and below the horizon at night', () => {
    const noon = sunPosition({ lat: 48.86, lng: 2.35 }, SEASON_DAY.winter, 12)
    expect(noon.elevation).toBeGreaterThan(15)
    expect(noon.elevation).toBeLessThan(20)
    const morning = sunPosition({ lat: 48.86, lng: 2.35 }, SEASON_DAY.summer, 8)
    expect(morning.azimuth).toBeGreaterThan(60)
    expect(morning.azimuth).toBeLessThan(120)
    expect(sunPosition({ lat: 48.86, lng: 2.35 }, SEASON_DAY.summer, 1).elevation).toBeLessThan(0)
  })
  it('turns the position into a scene vector that honours the plan orientation', () => {
    // sun due south, 45° up; plan top pointing north → the sun is towards +z (bottom of the plan)
    const v = sunVector({ azimuth: 180, elevation: 45 }, 0)
    expect(v[0]).toBeCloseTo(0, 6)
    expect(v[1]).toBeCloseTo(Math.SQRT1_2, 6)
    expect(v[2]).toBeCloseTo(Math.SQRT1_2, 6)
    // plan top pointing south → the sun is towards −z (top of the plan)
    expect(sunVector({ azimuth: 180, elevation: 45 }, 180)[2]).toBeCloseTo(-Math.SQRT1_2, 6)
  })
})

describe('pasted coordinates', () => {
  it('reads the forms people paste', async () => {
    const { parseLatLng } = await import('./sun')
    expect(parseLatLng('45.9249, 6.6815')).toEqual({ lat: 45.9249, lng: 6.6815 })
    expect(parseLatLng('45.9249 6.6815')).toEqual({ lat: 45.9249, lng: 6.6815 })
    expect(parseLatLng(' -33.8688;151.2093 ')).toEqual({ lat: -33.8688, lng: 151.2093 })
    expect(parseLatLng(`45°55'29.6"N 6°40'53.4"E`)).toEqual({ lat: 45.9249, lng: 6.6815 })
    expect(parseLatLng(`33°52'S 151°12'E`)).toEqual({ lat: -33.8667, lng: 151.2 })
    expect(parseLatLng('Annecy')).toBeNull()
    expect(parseLatLng('95, 10')).toBeNull()
    expect(parseLatLng('')).toBeNull()
  })
})
