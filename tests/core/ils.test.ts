import { describe, expect, it } from 'vitest'
import {
  activeMarker,
  cdiLateral,
  cdiVertical,
  courseShiftDdm,
  coverageNoiseDdm,
  createIlsSite,
  distanceFromGpipFt,
  distanceToThresholdNm,
  flagProbability,
  glidePathAngles,
  glidePathDescentFpm,
  glideslopeAzimuthDeg,
  glideslopeCoverageSeverity,
  glideslopeDdm,
  glideslopeElevationDeg,
  glideslopeFrequencyFor,
  glideslopeRangeNm,
  GS_FULL_SCALE_DDM,
  GS_HALF_SECTOR_DDM,
  GS_MODEL_AMPLITUDE,
  GS_TONE_DEPTH,
  ILS_CATEGORIES,
  ILS_CHANNEL_PAIRS,
  insideMarker,
  isLocalizerFrequency,
  lateralOffsetNm,
  LOC_CLEARANCE_DDM,
  LOC_FULL_SCALE_DDM,
  LOC_HALF_WIDTH_AT_THRESHOLD_M,
  LOC_TONE_DEPTH,
  localizerAzimuthDeg,
  localizerCoverageSeverity,
  localizerDdm,
  localizerElevationDeg,
  localizerHalfSectorDeg,
  localizerRangeNm,
  markerHalfAngleDeg,
  MARKER_DISTANCE_NM,
  onPathHeightFt,
  toneDepths,
  vehicleMultipathDdm,
  visualReference,
} from '@/core/ils'
import { toRad } from '@/core/geometry'
import { FT_PER_NM, METRES_PER_FT, METRES_PER_NM } from '@/core/units'
import { LAB_AIRPORT } from '@/core/world'
import { dmeChannelForVhf } from '@/core/dme'

const rwy = LAB_AIRPORT.runways[0]
const site = createIlsSite(rwy, LAB_AIRPORT.elevationFt)
/** A point `d` NM before the threshold, `rightNm` to the right of the centreline (runway 09: right = south). */
const approachPoint = (d: number, rightNm = 0) => ({ x: rwy.threshold.x - d, y: -rightNm })

describe('ILS frequencies', () => {
  it('has 40 localizer channels on odd tenths, each paired with one glideslope frequency', () => {
    expect(ILS_CHANNEL_PAIRS).toHaveLength(40)
    const gs = new Set(ILS_CHANNEL_PAIRS.map(([, g]) => g))
    expect(gs.size).toBe(40)
    for (const [l, g] of ILS_CHANNEL_PAIRS) {
      expect(isLocalizerFrequency(l)).toBe(true)
      expect(g).toBeGreaterThanOrEqual(329.15)
      expect(g).toBeLessThanOrEqual(335)
      // Every localizer channel is also paired with a DME channel.
      expect(dmeChannelForVhf(l)).not.toBeNull()
    }
    expect(isLocalizerFrequency(108.2)).toBe(false)
    expect(isLocalizerFrequency(108.0)).toBe(false)
    expect(isLocalizerFrequency(112.1)).toBe(false)
    expect(glideslopeFrequencyFor(110.3)).toBe(335)
    expect(glideslopeFrequencyFor(110.2)).toBeNull()
    expect(site.gsMHz).toBe(335)
    expect(dmeChannelForVhf(site.locMHz)).toEqual({ channel: 40, mode: 'X' })
  })
})

describe('ILS site geometry', () => {
  it('puts the localizer 1,000 ft past the stop end and the course sector about ±2°', () => {
    expect(site.locAntenna.x - rwy.end.x).toBeCloseTo(1000 / FT_PER_NM, 9)
    expect(site.locAntenna.y).toBeCloseTo(0, 12)
    const locToThrM = (site.locAntenna.x - rwy.threshold.x) * METRES_PER_NM
    expect(site.halfSectorDeg).toBeCloseTo((Math.atan(107 / locToThrM) * 180) / Math.PI, 9)
    expect(site.halfSectorDeg).toBeGreaterThan(1.7)
    expect(site.halfSectorDeg).toBeLessThan(2.1)
    expect(localizerHalfSectorDeg(1)).toBeGreaterThan(localizerHalfSectorDeg(2))
  })

  it('makes the glide path cross the threshold at 50 ft and meet the runway about 954 ft past it', () => {
    expect(site.gpipFt).toBeCloseTo(954, 0)
    expect(onPathHeightFt(site, 0)).toBeCloseTo(50, 6)
    expect(onPathHeightFt(site, 10)).toBeCloseTo(50 + 10 * FT_PER_NM * Math.tan(toRad(3)), 6)
    // The middle marker sits where a 3° path is at roughly 200 ft.
    const hMM = onPathHeightFt(site, MARKER_DISTANCE_NM.middle)
    expect(hMM).toBeGreaterThan(180)
    expect(hMM).toBeLessThan(250)
    expect(site.gsAntenna.y).toBeGreaterThan(0)
    expect(distanceFromGpipFt(site, site.gpip)).toBe(0)
  })

  it('measures distance to the threshold and sideways offset with the pilot’s left/right', () => {
    expect(distanceToThresholdNm(site, approachPoint(5))).toBeCloseTo(5, 12)
    // (world.ts rounds feet per NM to 6076.12 for the runway ends, so allow a few mm.)
    expect(distanceToThresholdNm(site, rwy.end)).toBeCloseTo(-rwy.lengthFt / FT_PER_NM, 4)
    // Runway 09 is flown eastbound: the pilot's right is south (y < 0).
    expect(lateralOffsetNm(site, approachPoint(5, 0.2))).toBeCloseTo(0.2, 12)
    expect(lateralOffsetNm(site, { x: -5, y: 0.3 })).toBeCloseTo(-0.3, 12)
    expect(localizerAzimuthDeg(site, approachPoint(5, 0.1))).toBeGreaterThan(0)
    expect(localizerAzimuthDeg(site, approachPoint(5, -0.1))).toBeLessThan(0)
    expect(localizerAzimuthDeg(site, approachPoint(5))).toBeCloseTo(0, 9)
    expect(Math.abs(localizerAzimuthDeg(site, { x: site.locAntenna.x + 2, y: 0 }))).toBeCloseTo(180, 6)
    expect(localizerAzimuthDeg(site, site.locAntenna)).toBe(0)
    expect(localizerRangeNm(site, approachPoint(5))).toBeCloseTo(5 + (site.locAntenna.x - rwy.threshold.x), 9)
    expect(localizerElevationDeg(site, approachPoint(5), 30)).toBeCloseTo(0, 9)
    expect(glideslopeAzimuthDeg(site, approachPoint(5, 0.1))).toBeGreaterThan(0)
    expect(glideslopeRangeNm(site, site.gsAntenna)).toBe(0)
  })
})

describe('Localizer signal', () => {
  const th = site.halfSectorDeg

  it('makes 90 Hz stronger on the left (fly right) and 150 Hz on the right (fly left)', () => {
    const leftAz = localizerAzimuthDeg(site, approachPoint(6, -0.05))
    const ddmLeft = localizerDdm(leftAz, th)
    expect(ddmLeft).toBeGreaterThan(0)
    const t = toneDepths(ddmLeft, LOC_TONE_DEPTH)
    expect(t.m90).toBeGreaterThan(t.m150)
    expect(cdiLateral(ddmLeft)).toBeGreaterThan(0)
    const ddmRight = localizerDdm(localizerAzimuthDeg(site, approachPoint(6, 0.05)), th)
    expect(ddmRight).toBeCloseTo(-ddmLeft, 12)
    expect(cdiLateral(ddmRight)).toBeLessThan(0)
    expect(localizerDdm(0, th)).toBeCloseTo(0, 12)
    expect(toneDepths(0, LOC_TONE_DEPTH)).toEqual({ m90: 0.2, m150: 0.2 })
  })

  it('reaches full scale (DDM 0.155) about 107 m either side of the centreline at the threshold', () => {
    const off = LOC_HALF_WIDTH_AT_THRESHOLD_M / METRES_PER_NM
    const ddm = localizerDdm(localizerAzimuthDeg(site, approachPoint(0, -off)), th)
    expect(ddm).toBeCloseTo(LOC_FULL_SCALE_DDM, 6)
    expect(cdiLateral(ddm)).toBeCloseTo(1, 6)
    // Linear inside the sector.
    expect(localizerDdm(th / 2, th)).toBeCloseTo(-LOC_FULL_SCALE_DDM / 2, 9)
  })

  it('is more sensitive near the runway: the same offset moves the needle further', () => {
    const offset = 100 / METRES_PER_NM
    const far = cdiLateral(localizerDdm(localizerAzimuthDeg(site, approachPoint(8, offset)), th))
    const near = cdiLateral(localizerDdm(localizerAzimuthDeg(site, approachPoint(0.3, offset)), th))
    expect(Math.abs(far)).toBeLessThan(0.25)
    expect(Math.abs(near)).toBeGreaterThan(0.8)
  })

  it('keeps at least the clearance DDM outside the course sector out to 35°', () => {
    for (let a = 1.2 * th * (LOC_CLEARANCE_DDM / LOC_FULL_SCALE_DDM); a <= 35; a += 0.25) {
      expect(Math.abs(localizerDdm(a, th))).toBeGreaterThanOrEqual(LOC_CLEARANCE_DDM - 1e-12)
      expect(localizerDdm(-a, th)).toBeGreaterThan(0)
    }
    // Continuous at the end of the linear part.
    const a1 = th * (LOC_CLEARANCE_DDM / LOC_FULL_SCALE_DDM)
    expect(Math.abs(localizerDdm(a1 + 1e-9, th) - localizerDdm(a1 - 1e-9, th))).toBeLessThan(1e-6)
    // Never decreases with angle.
    let prev = 0
    for (let a = 0; a <= 90; a += 0.5) {
      const v = Math.abs(localizerDdm(a, th))
      expect(v).toBeGreaterThanOrEqual(prev - 1e-12)
      prev = v
    }
  })

  it('turns a course shift into the matching DDM error', () => {
    expect(courseShiftDdm(LOC_HALF_WIDTH_AT_THRESHOLD_M)).toBeCloseTo(LOC_FULL_SCALE_DDM, 12)
    expect(courseShiftDdm(-10.5)).toBeLessThan(0)
  })

  it('models a vehicle in the critical area as a course error that is largest near the runway', () => {
    expect(Math.abs(vehicleMultipathDdm(0))).toBeGreaterThan(0.03)
    let maxFar = 0
    for (let d = 8; d <= 12; d += 0.05) maxFar = Math.max(maxFar, Math.abs(vehicleMultipathDdm(d)))
    expect(maxFar).toBeLessThan(0.05)
    expect(maxFar).toBeGreaterThan(0.015)
  })
})

describe('Glideslope signal', () => {
  it('makes 150 Hz stronger below the path (fly up) and 90 Hz above it (fly down)', () => {
    const below = glideslopeDdm(2.6)
    const above = glideslopeDdm(3.4)
    expect(below).toBeLessThan(0)
    expect(above).toBeGreaterThan(0)
    expect(cdiVertical(below)).toBeGreaterThan(0)
    expect(cdiVertical(above)).toBeLessThan(0)
    const t = toneDepths(below, GS_TONE_DEPTH)
    expect(t.m150).toBeGreaterThan(t.m90)
    expect(glideslopeDdm(3)).toBeCloseTo(0, 12)
  })

  it('gives DDM 0.0875 at 0.12θ and about full scale at 0.24θ', () => {
    expect(glideslopeDdm(1.12 * 3)).toBeCloseTo(GS_HALF_SECTOR_DDM, 9)
    expect(glideslopeDdm(0.88 * 3)).toBeCloseTo(-GS_HALF_SECTOR_DDM, 9)
    expect(GS_MODEL_AMPLITUDE).toBeCloseTo(0.2377, 4)
    const fs = glideslopeDdm(1.24 * 3)
    expect(fs).toBeGreaterThan(0.155)
    expect(fs).toBeLessThan(GS_FULL_SCALE_DDM)
    expect(cdiVertical(glideslopeDdm(1.3 * 3))).toBeLessThan(-1)
  })

  it('has false glide paths: reversed at 2θ, normal at 3θ', () => {
    const paths = glidePathAngles(3)
    expect(paths.map((p) => p.angleDeg)).toEqual([3, 6, 9])
    for (const p of paths) expect(glideslopeDdm(p.angleDeg)).toBeCloseTo(0, 9)
    // Just above 6° the needle says "fly up" although the aircraft is far too high: reversed sensing.
    expect(cdiVertical(glideslopeDdm(6.3))).toBeGreaterThan(0)
    expect(cdiVertical(glideslopeDdm(5.7))).toBeLessThan(0)
    // Around 9° the sensing is normal again.
    expect(cdiVertical(glideslopeDdm(9.3))).toBeLessThan(0)
    expect(cdiVertical(glideslopeDdm(8.7))).toBeGreaterThan(0)
  })

  it('keeps saying "fly up" far below the path instead of centring', () => {
    for (const e of [0, 0.3, 1, 1.4]) expect(cdiVertical(glideslopeDdm(e))).toBeGreaterThan(1)
  })

  it('puts an aircraft on the path at the path angle', () => {
    for (const d of [0.5, 3, 9]) {
      const h = onPathHeightFt(site, d)
      expect(glideslopeElevationDeg(site, approachPoint(d), site.elevationFt + h)).toBeCloseTo(3, 6)
    }
  })

  it('gives the 3° descent rate at approach speed (about 740 ft/min at 140 kt)', () => {
    expect(glidePathDescentFpm(140)).toBeCloseTo(743, 0)
  })
})

describe('Coverage', () => {
  it('is complete inside ±10° to 25 NM and ±35° to 17 NM', () => {
    expect(localizerCoverageSeverity(5, 24, 3)).toBe(0)
    expect(localizerCoverageSeverity(30, 16, 3)).toBe(0)
    expect(localizerCoverageSeverity(30, 22, 3)).toBeGreaterThan(0.3)
    expect(localizerCoverageSeverity(50, 10, 3)).toBe(1)
    expect(localizerCoverageSeverity(0, 10, 12)).toBe(1)
    expect(glideslopeCoverageSeverity(4, 9)).toBe(0)
    expect(glideslopeCoverageSeverity(20, 9)).toBe(1)
    expect(glideslopeCoverageSeverity(0, 10.2)).toBeLessThan(0.1)
    expect(glideslopeCoverageSeverity(0, 14)).toBe(1)
  })

  it('raises the flag only well outside coverage and adds noise in the fringe', () => {
    expect(flagProbability(0)).toBe(0)
    expect(flagProbability(0.1)).toBe(0)
    expect(flagProbability(1)).toBe(1)
    expect(coverageNoiseDdm(0)).toBe(0)
    expect(coverageNoiseDdm(0.5)).toBeGreaterThan(0)
  })
})

describe('Marker beacons', () => {
  it('lights each marker only when passing over it on the glide path', () => {
    for (const k of ['outer', 'middle', 'inner'] as const) {
      const d = MARKER_DISTANCE_NM[k]
      const h = onPathHeightFt(site, d)
      expect(insideMarker(site, k, approachPoint(d), h)).toBe(true)
      expect(activeMarker(site, approachPoint(d), h)).toBe(k)
      expect(insideMarker(site, k, approachPoint(d + 0.6), onPathHeightFt(site, d + 0.6))).toBe(false)
      expect(markerHalfAngleDeg(site, k)).toBeGreaterThan(10)
      expect(markerHalfAngleDeg(site, k)).toBeLessThan(80)
    }
    expect(activeMarker(site, approachPoint(2.5), onPathHeightFt(site, 2.5))).toBeNull()
    expect(insideMarker(site, 'outer', approachPoint(MARKER_DISTANCE_NM.outer), 0)).toBe(false)
  })

  it('has a wider beam higher up (it points straight up)', () => {
    const d = MARKER_DISTANCE_NM.outer + 0.2
    expect(insideMarker(site, 'outer', approachPoint(d), 1000)).toBe(false)
    expect(insideMarker(site, 'outer', approachPoint(d), 4000)).toBe(true)
  })
})

describe('Categories and visual reference', () => {
  it('uses the category minima', () => {
    expect(ILS_CATEGORIES.I.dhFt).toBe(200)
    expect(ILS_CATEGORIES.I.minRvrM).toBe(550)
    expect(ILS_CATEGORIES.II.dhFt).toBe(100)
    expect(ILS_CATEGORIES.II.minRvrM).toBe(300)
    expect(ILS_CATEGORIES.IIIA.dhFt!).toBeLessThan(100)
    expect(ILS_CATEGORIES.IIIA.minRvrM).toBe(175)
    expect(ILS_CATEGORIES.IIIB.fogRvrM).toBeGreaterThanOrEqual(50)
    expect(ILS_CATEGORIES.IIIB.fogRvrM).toBeLessThan(175)
  })

  /** Height (ft) at which the lights or the runway first come into view on the glide path. */
  function firstSightFt(visibilityM: number, what: 'approachLights' | 'runway'): number {
    for (let h = 1500; h >= 0; h -= 1) {
      const d = (h / Math.tan(toRad(3)) - site.gpipFt) / FT_PER_NM
      if (visualReference(site, approachPoint(d), h, visibilityM)[what]) return h
    }
    return -1
  }

  it('shows the approach lights about at the decision height, sooner in lighter fog', () => {
    for (const k of ['I', 'II', 'IIIA'] as const) {
      const c = ILS_CATEGORIES[k]
      const h = firstSightFt(c.fogRvrM, 'approachLights')
      // Lights come into view before the decision height ...
      expect(h).toBeGreaterThanOrEqual(c.dhFt!)
      // ... but not long before it.
      expect(h).toBeLessThan(c.dhFt! + 250)
    }
    const cat1 = firstSightFt(ILS_CATEGORIES.I.fogRvrM, 'approachLights')
    const cat3b = firstSightFt(ILS_CATEGORIES.IIIB.fogRvrM, 'approachLights')
    expect(cat1).toBeGreaterThan(250)
    expect(cat3b).toBeLessThan(80)
  })

  it('sees the runway itself later than the lights, and nothing ahead when past the far end', () => {
    const lights = firstSightFt(550, 'approachLights')
    const runway = firstSightFt(550, 'runway')
    expect(runway).toBeLessThan(lights)
    expect(runway).toBeGreaterThan(100)
    const beyond = visualReference(site, { x: rwy.end.x + 1, y: 0 }, 100, 10000)
    expect(beyond.approachLights).toBe(false)
    expect(beyond.runway).toBe(false)
    const clear = visualReference(site, approachPoint(10), 3000, 20000)
    expect(clear.runway).toBe(true)
    expect(clear.nearestM).toBeGreaterThan(10 * METRES_PER_NM - 900 - 10)
    // Nothing hidden under the nose: on the runway at 0 ft the runway ahead is visible.
    expect(visualReference(site, { x: 0, y: 0 }, 0, 100).runway).toBe(true)
    expect(METRES_PER_FT).toBeCloseTo(0.3048, 12)
  })
})
