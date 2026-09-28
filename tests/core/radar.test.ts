import { describe, expect, it } from 'vitest'
import {
  apparentRange,
  azimuthResolutionNm,
  buildGroundClutter,
  DEFAULT_RADAR,
  detectionProbability,
  evaluateTarget,
  hitsPerScan,
  inBeam,
  maxDetectionRangeNm,
  maxUnambiguousRangeNm,
  mtiGain,
  pulseIntervalUs,
  radarSnrDb,
  radialWindKt,
  rainReflectivity,
  rangeResolutionNm,
  snrForPd,
} from '@/core/radar'
import { rangeFromRoundTripNm, roundTripTimeUs } from '@/core/propagation'
import { DEFAULT_TERRAIN, terrainFn, isWater } from '@/core/world'

const site = { pos: { x: 0, y: 0 }, heightFt: 90 }
const flat = () => 0

describe('radar timing', () => {
  it('max unambiguous range = c / (2·PRF): 1000 Hz ≈ 81 NM', () => {
    expect(maxUnambiguousRangeNm(1000)).toBeCloseTo(80.94, 1)
    expect(maxUnambiguousRangeNm(3000)).toBeCloseTo(26.98, 1)
    expect(pulseIntervalUs(1000)).toBe(1000)
  })
  it('the echo of the unambiguous range arrives exactly when the next pulse leaves', () => {
    const ru = maxUnambiguousRangeNm(1250)
    expect(roundTripTimeUs(ru)).toBeCloseTo(pulseIntervalUs(1250), 6)
    expect(rangeFromRoundTripNm(pulseIntervalUs(1250))).toBeCloseTo(ru, 6)
  })
  it('second-trace echoes appear at R mod R_unambiguous', () => {
    const ru = maxUnambiguousRangeNm(1000)
    expect(apparentRange(50, 1000)).toEqual({ rangeNm: 50, trace: 1 })
    const a = apparentRange(100, 1000)
    expect(a.trace).toBe(2)
    expect(a.rangeNm).toBeCloseTo(100 - ru, 6)
    expect(apparentRange(2.5 * ru, 1000).trace).toBe(3)
  })
  it('range resolution is c·τ/2: 1 µs ≈ 150 m', () => {
    expect(rangeResolutionNm(1) * 1852).toBeCloseTo(149.9, 0)
  })
  it('azimuth resolution grows with range', () => {
    expect(azimuthResolutionNm(30, 1.4)).toBeCloseTo(0.733, 2)
    expect(azimuthResolutionNm(60, 1.4)).toBeCloseTo(2 * azimuthResolutionNm(30, 1.4), 9)
  })
  it('hits per scan = PRF × period × beamwidth / 360', () => {
    expect(hitsPerScan(DEFAULT_RADAR)).toBeCloseTo((1000 * 4.8 * 1.4) / 360, 9)
  })
})

describe('radar equation', () => {
  it('is calibrated: 2 m² detected with 90% probability at 60 NM by default', () => {
    expect(maxDetectionRangeNm(DEFAULT_RADAR, 2)).toBeCloseTo(60, 6)
    expect(detectionProbability(radarSnrDb(DEFAULT_RADAR, 60, 2))).toBeCloseTo(0.9, 6)
  })
  it('range grows with the fourth root of power', () => {
    const r1 = maxDetectionRangeNm(DEFAULT_RADAR, 10)
    const r16 = maxDetectionRangeNm({ ...DEFAULT_RADAR, peakPowerKw: DEFAULT_RADAR.peakPowerKw * 16 }, 10)
    expect(r16 / r1).toBeCloseTo(2, 6)
  })
  it('range grows with the fourth root of radar cross section', () => {
    expect(maxDetectionRangeNm(DEFAULT_RADAR, 32) / maxDetectionRangeNm(DEFAULT_RADAR, 2)).toBeCloseTo(2, 6)
  })
  it('SNR falls 12 dB per doubling of range', () => {
    expect(radarSnrDb(DEFAULT_RADAR, 20, 2) - radarSnrDb(DEFAULT_RADAR, 40, 2)).toBeCloseTo(12.04, 1)
  })
  it('a wider beam lowers gain more than extra hits make up for', () => {
    const wide = maxDetectionRangeNm({ ...DEFAULT_RADAR, beamWidthDeg: 2.8 }, 2)
    expect(wide).toBeLessThan(60)
    expect(wide).toBeGreaterThan(40)
  })
  it('faster rotation means fewer hits and a little less range', () => {
    expect(maxDetectionRangeNm({ ...DEFAULT_RADAR, rotationPeriodS: 2.4 }, 2)).toBeLessThan(60)
  })
  it('detection probability rises smoothly with SNR', () => {
    expect(detectionProbability(snrForPd(0.5))).toBeCloseTo(0.5, 6)
    expect(detectionProbability(0)).toBeLessThan(0.001)
    expect(detectionProbability(25)).toBeGreaterThan(0.999)
  })
})

describe('MTI', () => {
  it('removes stationary echoes and keeps fast movers', () => {
    expect(mtiGain(0)).toBe(0)
    expect(mtiGain(250)).toBeGreaterThan(0.999)
    expect(mtiGain(5)).toBeLessThan(0.1)
  })
  it('radial wind is full when the wind blows along the radial', () => {
    expect(radialWindKt({ x: 0, y: 0 }, { x: 10, y: 0 }, 20, 90)).toBeCloseTo(20)
    expect(radialWindKt({ x: 0, y: 0 }, { x: 10, y: 0 }, 20, 270)).toBeCloseTo(-20)
    expect(radialWindKt({ x: 0, y: 0 }, { x: 10, y: 0 }, 20, 0)).toBeCloseTo(0)
  })
})

describe('target evaluation', () => {
  const env = { terrain: flat, mti: false }
  it('a medium aircraft at 40 NM is detected', () => {
    const r = evaluateTarget(site, DEFAULT_RADAR, { pos: { x: 40, y: 0 }, altitudeFt: 20000, rcsM2: 10, radialSpeedKt: 300 }, env, 0.5)
    expect(r.detected).toBe(true)
    expect(r.reason).toBe('ok')
    expect(r.azimuthDeg).toBeCloseTo(90)
  })
  it('an aircraft directly overhead is in the cone of silence', () => {
    const r = evaluateTarget(site, DEFAULT_RADAR, { pos: { x: 0.5, y: 0 }, altitudeFt: 20000, rcsM2: 10, radialSpeedKt: 300 }, env, 0)
    expect(r.reason).toBe('cone')
    expect(r.detected).toBe(false)
  })
  it('a low aircraft far away is below the radar horizon', () => {
    const r = evaluateTarget(site, DEFAULT_RADAR, { pos: { x: 55, y: 0 }, altitudeFt: 500, rcsM2: 40, radialSpeedKt: 300 }, env, 0)
    expect(r.reason).toBe('horizon')
  })
  it('an aircraft behind Mount Sentinel is hidden by terrain', () => {
    const hill = DEFAULT_TERRAIN.hills[0].center // (-18, 8)
    const behind = { x: hill.x * 1.5, y: hill.y * 1.5 }
    const r = evaluateTarget(site, DEFAULT_RADAR, { pos: behind, altitudeFt: 3000, rcsM2: 10, radialSpeedKt: 250 }, { terrain: terrainFn(), mti: false }, 0)
    expect(r.reason).toBe('terrain')
    const high = evaluateTarget(site, DEFAULT_RADAR, { pos: behind, altitudeFt: 12000, rcsM2: 10, radialSpeedKt: 250 }, { terrain: terrainFn(), mti: false }, 0)
    expect(high.detected).toBe(true)
  })
  it('MTI hides an aircraft flying across the beam (no radial speed)', () => {
    const r = evaluateTarget(site, DEFAULT_RADAR, { pos: { x: 20, y: 0 }, altitudeFt: 10000, rcsM2: 10, radialSpeedKt: 0 }, { terrain: flat, mti: true }, 0.5)
    expect(r.detected).toBe(false)
    expect(r.reason).toBe('mti')
  })
  it('reports second-trace ranges for distant heavy aircraft at high PRF', () => {
    const p = { ...DEFAULT_RADAR, prfHz: 3000 }
    const r = evaluateTarget(site, p, { pos: { x: 45, y: 0 }, altitudeFt: 35000, rcsM2: 40, radialSpeedKt: 450 }, env, 0.1)
    expect(r.trace).toBe(2)
    expect(r.apparentRangeNm).toBeLessThan(20)
  })
})

describe('clutter and weather', () => {
  const cells = buildGroundClutter(site, terrainFn(), 60, { isWater: (p) => isWater(p) })
  it('has strong clutter close to the radar', () => {
    expect(cells.some((c) => c.rangeNm < 5 && c.strength > 0.3)).toBe(true)
  })
  it('lights the face of Mount Sentinel but not the ground behind it', () => {
    const hill = DEFAULT_TERRAIN.hills[0].center
    const az = (Math.atan2(hill.x, hill.y) * 180) / Math.PI + 360
    const along = cells.filter((c) => Math.abs(((c.azDeg - (az % 360) + 540) % 360) - 180) < 1)
    const face = along.filter((c) => c.rangeNm > 14 && c.rangeNm < 19.7)
    const shadow = along.filter((c) => c.rangeNm > 23 && c.rangeNm < 27)
    expect(face.length).toBeGreaterThan(0)
    expect(shadow.length).toBe(0)
  })
  it('does not put ground clutter on the ocean', () => {
    expect(cells.every((c) => !isWater(c.pos))).toBe(true)
  })
  it('rain is strongest near the storm centre and absent far away', () => {
    const storm = { center: { x: 10, y: -20 }, radiusNm: 8, intensity: 1 }
    expect(rainReflectivity({ x: 40, y: 40 }, storm)).toBe(0)
    let inside = 0
    for (let i = 0; i < 20; i++) inside += rainReflectivity({ x: 10 + (i - 10) * 0.2, y: -20 }, storm)
    expect(inside).toBeGreaterThan(0)
  })
  it('inBeam checks half a beam width either side, across north', () => {
    expect(inBeam(0.4, 359.8, 1.4)).toBe(true)
    expect(inBeam(0.6, 359.8, 1.4)).toBe(false)
  })
})
