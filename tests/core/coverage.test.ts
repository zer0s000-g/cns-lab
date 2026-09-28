import { describe, expect, it } from 'vitest'
import { geoElevationDeg, geoSlantRangeM, ilsCoverage, mlatReceiversInView, siteSees, tdoaHdop } from '@/core/coverage'
import { radioLineOfSightNm } from '@/core/propagation'
import { terrainFn } from '@/core/world'

const flat = () => 0

describe('line-of-sight coverage', () => {
  const site = { pos: { x: 0, y: 0 }, heightFt: 100 }
  it('agrees with the radio horizon formula', () => {
    const r = radioLineOfSightNm(100, 10000)
    expect(siteSees(site, { x: r * 0.98, y: 0 }, 10000, flat)).toBe(true)
    expect(siteSees(site, { x: r * 1.02, y: 0 }, 10000, flat)).toBe(false)
  })
  it('respects a maximum range', () => {
    expect(siteSees(site, { x: 50, y: 0 }, 30000, flat, 40)).toBe(false)
  })
  it('is blocked by Mount Sentinel at low altitude', () => {
    expect(siteSees(site, { x: -27, y: 12 }, 3000, terrainFn())).toBe(false)
    expect(siteSees(site, { x: -27, y: 12 }, 15000, terrainFn())).toBe(true)
  })
})

describe('ILS coverage', () => {
  const geo = { locAntenna: { x: 0.97, y: 0 }, gsAntenna: { x: -0.65, y: 0.07 }, courseDeg: 90, elevationFt: 30 }
  it('covers the final approach 15 NM out on the centreline', () => {
    expect(ilsCoverage(geo, { x: -15, y: 0 }, 4500)).toEqual({ localizer: true, glidePath: false })
    expect(ilsCoverage(geo, { x: -8, y: 0 }, 2500)).toEqual({ localizer: true, glidePath: true })
  })
  it('does not cover the far side of the runway or wide angles far out', () => {
    expect(ilsCoverage(geo, { x: 10, y: 0 }, 3000).localizer).toBe(false)
    // 20° off the course at 22 NM: outside both sectors.
    const a = (20 * Math.PI) / 180
    expect(ilsCoverage(geo, { x: 0.97 - 22 * Math.cos(a), y: 22 * Math.sin(a) }, 5000).localizer).toBe(false)
    // 20° off at 15 NM: inside the ±35° / 17 NM sector.
    expect(ilsCoverage(geo, { x: 0.97 - 15 * Math.cos(a), y: 15 * Math.sin(a) }, 5000).localizer).toBe(true)
  })
})

describe('multilateration', () => {
  const rx = [
    { pos: { x: 0, y: 0 }, heightFt: 100 },
    { pos: { x: 20, y: 0 }, heightFt: 100 },
    { pos: { x: 0, y: 20 }, heightFt: 100 },
    { pos: { x: 20, y: 20 }, heightFt: 100 },
  ]
  it('counts receivers in view', () => {
    expect(mlatReceiversInView(rx, { x: 10, y: 10 }, 10000, flat)).toBe(4)
  })
  it('geometry is good inside the network and poor far outside or in a line', () => {
    const pts = rx.map((r) => r.pos)
    const inside = tdoaHdop(pts, { x: 10, y: 10 })
    const outside = tdoaHdop(pts, { x: 120, y: 120 })
    expect(outside).toBeGreaterThan(inside * 5)
    const line = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0 }]
    expect(tdoaHdop(line, { x: 15, y: 0.01 })).toBeGreaterThan(inside * 20)
  })
})

describe('geostationary satellites', () => {
  it('is straight overhead at the sub-satellite point', () => {
    expect(geoElevationDeg({ lat: 0, lon: 100 }, 100)).toBeCloseTo(90, 6)
    expect(geoSlantRangeM({ lat: 0, lon: 100 }, 100)).toBeCloseTo(35_793_000, -4)
  })
  it('sets below the horizon about 81° of latitude away', () => {
    expect(geoElevationDeg({ lat: 80, lon: 0 }, 0)).toBeGreaterThan(0)
    expect(geoElevationDeg({ lat: 82, lon: 0 }, 0)).toBeLessThan(0)
  })
  it('one-way trip to GEO takes about 0.12–0.14 s', () => {
    const t = geoSlantRangeM({ lat: 40, lon: 0 }, 0) / 299_792_458
    expect(t).toBeGreaterThan(0.119)
    expect(t).toBeLessThan(0.14)
  })
})
