import { describe, expect, it } from 'vitest'
import { crc32, makeZip, safeFileName } from './zip'

const u32 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | ((b[at + 3] << 24) >>> 0)
const u16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8)

describe('zip writer', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789')).toString(16)).toBe('cbf43926')
    expect(crc32(new Uint8Array())).toBe(0)
  })

  it('writes stored entries that a reader can walk', () => {
    const zip = makeZip([
      { name: 'House.json', data: '{"a":1}', date: new Date(2026, 8, 17, 10, 30, 0) },
      { name: 'Flat.json', data: new Uint8Array([1, 2, 3]) },
    ])
    // local header of the first entry
    expect(u32(zip, 0)).toBe(0x04034b50)
    expect(u16(zip, 26)).toBe('House.json'.length)
    expect(u32(zip, 18)).toBe(7)
    expect(new TextDecoder().decode(zip.slice(30, 40))).toBe('House.json')
    expect(new TextDecoder().decode(zip.slice(40, 47))).toBe('{"a":1}')
    // end of central directory: two entries, and the central directory sits right after the locals
    const end = zip.length - 22
    expect(u32(zip, end)).toBe(0x06054b50)
    expect(u16(zip, end + 10)).toBe(2)
    const centralOffset = u32(zip, end + 16)
    expect(u32(zip, centralOffset)).toBe(0x02014b50)
    expect(centralOffset).toBe(30 + 10 + 7 + 30 + 9 + 3)
    // the second central entry points back at the second local header
    const secondCentral = centralOffset + 46 + 10
    expect(u32(zip, secondCentral + 42)).toBe(30 + 10 + 7)
  })

  it('makes file names safe', () => {
    expect(safeFileName('Maison / été: v2')).toBe('Maison ete v2')
    expect(safeFileName('   ')).toBe('plan')
  })
})
