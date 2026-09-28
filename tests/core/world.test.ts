import { describe, expect, it } from 'vitest'
import { bearingDeg, distanceNm } from '@/core/geometry'
import {
  commandedHeading,
  createAircraft,
  DEFAULT_TERRAIN,
  isWater,
  LAB_AIRPORT,
  radialSpeedKt,
  sampleTerrainGrid,
  stepAircraft,
  stepAircraftFine,
  terrainElevationFt,
  turnRadiusNm,
  velocityNmPerS,
  type Aircraft,
} from '@/core/world'

const base = () =>
  createAircraft({ id: 'T1', pos: { x: 0, y: 0 }, altitudeFt: 5000, headingDeg: 90, speedKt: 360 })

describe('airport', () => {
  it('sits at the origin with runway 09/27 east-west', () => {
    const rwy = LAB_AIRPORT.runways[0]
    expect(rwy.headingTrue).toBe(90)
    expect(bearingDeg(rwy.threshold, rwy.end)).toBeCloseTo(90)
    expect(rwy.threshold.x + rwy.end.x).toBeCloseTo(0)
    expect(distanceNm(rwy.threshold, rwy.end) * 6076.12).toBeCloseTo(rwy.lengthFt, 0)
  })
})

describe('terrain', () => {
  it('is flat at airport elevation near the airport', () => {
    expect(terrainElevationFt({ x: 0, y: 0 })).toBe(LAB_AIRPORT.elevationFt)
  })
  it('has the lone hill at its stated peak', () => {
    const hill = DEFAULT_TERRAIN.hills[0]
    expect(terrainElevationFt(hill.center)).toBeGreaterThan(hill.peakFt * 0.99)
  })
  it('is sea level over the ocean to the east', () => {
    expect(isWater({ x: 80, y: 0 })).toBe(true)
    expect(terrainElevationFt({ x: 80, y: 0 })).toBe(0)
    expect(isWater({ x: 0, y: 0 })).toBe(false)
  })
  it('samples a grid with water flags', () => {
    const g = sampleTerrainGrid(-60, 60, -60, 60, 24, 24)
    expect(g.heights.length).toBe(576)
    expect(Array.from(g.water).some((w) => w === 1)).toBe(true)
  })
})

describe('aircraft motion', () => {
  it('flies straight at its speed: 360 kt = 0.1 NM/s', () => {
    const a = stepAircraft(base(), 10)
    expect(a.pos.x).toBeCloseTo(1, 6)
    expect(a.pos.y).toBeCloseTo(0, 6)
    expect(velocityNmPerS(a).x).toBeCloseTo(0.1)
  })
  it('turns at no more than 3°/s the short way', () => {
    const a = { ...base(), targetHeadingDeg: 60 }
    const b = stepAircraft(a, 5)
    expect(b.headingDeg).toBeCloseTo(75)
    const c = stepAircraft({ ...base(), headingDeg: 350, targetHeadingDeg: 10 }, 2)
    expect(c.headingDeg).toBeCloseTo(356)
  })
  it('climbs at the performance rate and reports vertical speed', () => {
    const a = { ...base(), targetAltitudeFt: 10000 }
    const b = stepAircraft(a, 30)
    expect(b.altitudeFt).toBeCloseTo(6000)
    expect(b.verticalSpeedFpm).toBeCloseTo(2000)
    const c = stepAircraft({ ...b, targetAltitudeFt: 6000 }, 1)
    expect(c.altitudeFt).toBe(6000)
  })
  it('does not overshoot the target altitude or speed', () => {
    const a = stepAircraft({ ...base(), targetAltitudeFt: 5010, targetSpeedKt: 361 }, 60)
    expect(a.altitudeFt).toBe(5010)
    expect(a.speedKt).toBe(361)
  })
  it('does not move while held (being dragged)', () => {
    const a = stepAircraft({ ...base(), held: true }, 10)
    expect(a.pos).toEqual({ x: 0, y: 0 })
  })
  it('a 360° standard-rate turn takes 2 minutes and returns near the start', () => {
    let a = { ...base(), speedKt: 180, targetSpeedKt: 180 }
    // Command a continuous right turn by moving the target ahead each step.
    for (let t = 0; t < 120; t += 0.1) {
      a = stepAircraft({ ...a, targetHeadingDeg: a.headingDeg + 90 }, 0.1)
    }
    expect(Math.abs(((a.headingDeg + 180) % 360) - 180 - 90)).toBeLessThan(0.5)
    expect(distanceNm(a.pos, { x: 0, y: 0 })).toBeLessThan(0.02)
  })
  it('turn radius r = v/ω: 180 kt at 3°/s ≈ 0.95 NM', () => {
    expect(turnRadiusNm(180, 3)).toBeCloseTo(0.955, 2)
  })
  it('direct-to flies to the point and then holds heading', () => {
    let a: Aircraft = { ...base(), mode: { kind: 'direct', to: { x: 10, y: 10 } } }
    for (let i = 0; i < 400; i++) a = stepAircraftFine(a, 1)
    expect(a.mode.kind).toBe('heading')
    expect(distanceNm(a.pos, { x: 10, y: 10 })).toBeGreaterThan(0)
  })
  it('orbit mode converges onto the circle', () => {
    let a = createAircraft({ id: 'O', pos: { x: 6, y: 0 }, altitudeFt: 3000, headingDeg: 0, speedKt: 150 })
    a = { ...a, mode: { kind: 'orbit', center: { x: 0, y: 0 }, radiusNm: 4, clockwise: true } }
    for (let i = 0; i < 900; i++) a = stepAircraftFine(a, 1)
    expect(Math.abs(distanceNm(a.pos, { x: 0, y: 0 }) - 4)).toBeLessThan(0.25)
    // Clockwise tangent: heading ≈ bearing-from-centre + 90
    const expected = (bearingDeg({ x: 0, y: 0 }, a.pos) + 90) % 360
    const diff = Math.abs(((commandedHeading(a) - expected + 540) % 360) - 180)
    expect(diff).toBeLessThan(15)
  })
  it('radial speed is positive moving away and zero on a circle', () => {
    const away = createAircraft({ id: 'R', pos: { x: 5, y: 0 }, altitudeFt: 0, headingDeg: 90, speedKt: 200 })
    expect(radialSpeedKt(away, { x: 0, y: 0 })).toBeCloseTo(200)
    const tangential = { ...away, headingDeg: 0 }
    expect(radialSpeedKt(tangential, { x: 0, y: 0 })).toBeCloseTo(0)
    const toward = { ...away, headingDeg: 270 }
    expect(radialSpeedKt(toward, { x: 0, y: 0 })).toBeCloseTo(-200)
  })
})
