import { describe, expect, it } from 'vitest'
import { angleDiff, bearingDeg, normalize360 } from '@/core/geometry'
import {
  adfTruth,
  bearingSum,
  cardioidResponse,
  coastalBendDeg,
  coastalRefractionErrorDeg,
  dayFactor,
  elevationDeg,
  findCoastCrossings,
  flashPull,
  groundWaveMarginDb,
  hasUsableSignal,
  isNdbFrequencyKhz,
  lightningErrorDeg,
  loopCandidates,
  loopOnlyIndication,
  loopResponse,
  mountainReflectionErrorDeg,
  NDB_BAND_KHZ,
  NDB_IDENT,
  nightEffectErrorDeg,
  nightFactor,
  noiseWanderDeg,
  polarisationErrorDeg,
  resolveWithSense,
  rmiValues,
  skyWavePathDifferenceM,
  skyWaveRatio,
  smoothNoise,
  twilightFactor,
  twoWaveErrorDeg,
  verticalMastGainDb,
  ADF_MARGIN_AT_RATED_DB,
  LIGHTNING,
  type LightningFlash,
} from '@/core/ndb'
import { DEFAULT_TERRAIN } from '@/core/world'

describe('NDB band and ident', () => {
  it('covers 190–1750 kHz', () => {
    expect(NDB_BAND_KHZ.min).toBe(190)
    expect(NDB_BAND_KHZ.max).toBe(1750)
    expect(isNdbFrequencyKhz(344)).toBe(true)
    expect(isNdbFrequencyKhz(150)).toBe(false)
    expect(isNdbFrequencyKhz(1800)).toBe(false)
  })
  it('keys the ident at about 7 words per minute on 400 or 1020 Hz', () => {
    expect(NDB_IDENT.wpm).toBe(7)
    expect([400, 1020]).toContain(NDB_IDENT.toneHz)
  })
})

describe('ADF geometry', () => {
  it('relative bearing is measured clockwise from the nose', () => {
    // Station due east, aircraft heading north: station is off the right wing.
    const t = adfTruth({ x: 0, y: 0 }, 0, { x: 10, y: 0 })
    expect(t.bearingTrue).toBeCloseTo(90)
    expect(t.relative).toBeCloseTo(90)
    expect(t.distanceNm).toBeCloseTo(10)
    // Heading east toward it: needle on the nose.
    expect(adfTruth({ x: 0, y: 0 }, 90, { x: 10, y: 0 }).relative).toBeCloseTo(0)
    // Heading west away from it: needle on the tail.
    expect(adfTruth({ x: 0, y: 0 }, 270, { x: 10, y: 0 }).relative).toBeCloseTo(180)
  })

  it('RMI: magnetic bearing = magnetic heading + relative bearing, tail = reciprocal', () => {
    // True heading 100, variation 10°E → magnetic heading 090 (East is least).
    const r = rmiValues(100, 45, 10)
    expect(r.headingMag).toBeCloseTo(90)
    expect(r.bearingToMag).toBeCloseTo(135)
    expect(r.bearingFromMag).toBeCloseTo(315)
    // Wrap-around.
    expect(rmiValues(350, 57, 0).bearingToMag).toBeCloseTo(47)
  })

  it('the RMI magnetic bearing equals the true bearing minus the variation', () => {
    for (const [hdg, variation] of [[30, 5], [200, -12], [359, 20]]) {
      const t = adfTruth({ x: 3, y: -4 }, hdg, { x: -8, y: 11 })
      const r = rmiValues(hdg, t.relative, variation)
      expect(angleDiff(r.bearingToMag, normalize360(t.bearingTrue - variation))).toBeCloseTo(0, 9)
    }
  })

  it('bearingSum always adds up after rounding', () => {
    for (let i = 0; i < 500; i++) {
      const h = (i * 37.37) % 360
      const r = (i * 91.13) % 360
      const s = bearingSum(h, r)
      expect((s.heading + s.relative) % 360).toBe(s.bearing)
      expect(s.sum).toBe(s.heading + s.relative)
      expect(s.wrapped).toBe(s.sum >= 360)
      expect(s.heading).toBeLessThan(360)
      expect(s.relative).toBeLessThan(360)
    }
    expect(bearingSum(350, 57)).toMatchObject({ heading: 350, relative: 57, sum: 407, bearing: 47, wrapped: true })
    expect(bearingSum(359.6, 0.2)).toMatchObject({ heading: 0, relative: 0, bearing: 0 })
  })
})

describe('loop and sense antennas', () => {
  it('the loop is a figure-of-eight with nulls at right angles to its axis', () => {
    expect(loopResponse(0, 0)).toBeCloseTo(1)
    expect(loopResponse(180, 0)).toBeCloseTo(-1)
    expect(Math.abs(loopResponse(90, 0))).toBeLessThan(1e-12)
    expect(Math.abs(loopResponse(270, 0))).toBeLessThan(1e-12)
  })
  it('loop plus sense is a cardioid with a single null', () => {
    expect(cardioidResponse(0, 0)).toBeCloseTo(1)
    expect(cardioidResponse(180, 0)).toBeCloseTo(0)
    expect(cardioidResponse(90, 0)).toBeCloseTo(0.5)
  })
  it('the loop alone gives two candidates 180° apart; the sense antenna picks the right one', () => {
    const c = loopCandidates(30)
    expect(c).toEqual([30, 210])
    expect(resolveWithSense(c, 30)).toBe(30)
    expect(resolveWithSense(c, 210)).toBe(210)
  })
  it('loop only shows the candidate ahead, so a station behind is shown 180° wrong', () => {
    expect(loopOnlyIndication(20)).toBe(20)
    expect(loopOnlyIndication(340)).toBe(340)
    expect(loopOnlyIndication(180)).toBe(0)
    expect(loopOnlyIndication(200)).toBe(20)
  })
})

describe('signal margin and noise', () => {
  it('is calibrated at the rated coverage and falls with distance', () => {
    expect(groundWaveMarginDb(60, 60)).toBeCloseTo(ADF_MARGIN_AT_RATED_DB)
    expect(groundWaveMarginDb(30, 60)).toBeGreaterThan(groundWaveMarginDb(60, 60))
    expect(groundWaveMarginDb(90, 60)).toBeLessThan(groundWaveMarginDb(60, 60))
    expect(hasUsableSignal(groundWaveMarginDb(60, 60))).toBe(true)
    // Lost at about twice the rated coverage.
    expect(hasUsableSignal(groundWaveMarginDb(130, 60))).toBe(false)
  })
  it('elevation angle and the vertical mast null overhead', () => {
    expect(elevationDeg(10, 0)).toBe(0)
    expect(elevationDeg(0, 5000)).toBeCloseTo(90)
    expect(elevationDeg(1, 6076.12)).toBeCloseTo(45, 3)
    expect(verticalMastGainDb(0)).toBeCloseTo(0)
    expect(verticalMastGainDb(60)).toBeCloseTo(20 * Math.log10(0.5))
    expect(verticalMastGainDb(90)).toBeCloseTo(-60)
  })
  it('a weaker signal makes the needle wander more', () => {
    expect(noiseWanderDeg(0)).toBeGreaterThan(noiseWanderDeg(10))
    expect(noiseWanderDeg(30)).toBeLessThan(0.2)
    expect(noiseWanderDeg(-100)).toBeLessThanOrEqual(20)
  })
  it('smoothNoise is deterministic and bounded', () => {
    for (let t = 0; t < 50; t += 0.37) {
      const v = smoothNoise(t, 0.5, 3, 7)
      expect(v).toBeGreaterThanOrEqual(-1)
      expect(v).toBeLessThanOrEqual(1)
      expect(smoothNoise(t, 0.5, 3, 7)).toBe(v)
    }
    // Smooth: small time steps give small changes.
    expect(Math.abs(smoothNoise(10, 0.5, 1) - smoothNoise(10.01, 0.5, 1))).toBeLessThan(0.05)
  })
})

describe('two-wave errors', () => {
  it('twoWaveErrorDeg pulls toward the second wave when in phase and away when out of phase', () => {
    expect(twoWaveErrorDeg(0.3, 90, 0)).toBeGreaterThan(0)
    expect(twoWaveErrorDeg(0.3, 90, Math.PI)).toBeLessThan(0)
    expect(twoWaveErrorDeg(0.3, -90, 0)).toBeLessThan(0)
    expect(twoWaveErrorDeg(0.3, 90, Math.PI / 2)).toBeCloseTo(0)
    expect(twoWaveErrorDeg(0, 90, 0)).toBe(0)
    // In phase at 90°: atan(0.3).
    expect(twoWaveErrorDeg(0.3, 90, 0)).toBeCloseTo((Math.atan(0.3) * 180) / Math.PI)
  })
  it('polarisationErrorDeg never exceeds asin(ratio)', () => {
    const r = 0.4
    let max = 0
    for (let p = 0; p < 2 * Math.PI; p += 0.001) max = Math.max(max, Math.abs(polarisationErrorDeg(r, p)))
    expect(max).toBeCloseTo((Math.asin(r) * 180) / Math.PI, 2)
  })
})

describe('night effect', () => {
  it('day, night and twilight factors', () => {
    expect(dayFactor(12)).toBeGreaterThan(0.999)
    expect(nightFactor(0)).toBeGreaterThan(0.999)
    expect(dayFactor(6)).toBeCloseTo(0.5, 2)
    expect(dayFactor(18)).toBeCloseTo(0.5, 2)
    expect(twilightFactor(18)).toBeCloseTo(1)
    expect(twilightFactor(6)).toBeCloseTo(1)
    expect(twilightFactor(0)).toBeLessThan(0.01)
    expect(twilightFactor(12)).toBeLessThan(0.01)
  })
  it('sky waves: none by day, some at night, most around dusk and dawn, more at long range', () => {
    expect(skyWaveRatio(60, 12)).toBeLessThan(1e-4)
    expect(skyWaveRatio(60, 0)).toBeGreaterThan(0.1)
    expect(skyWaveRatio(60, 18)).toBeGreaterThan(skyWaveRatio(60, 0))
    expect(skyWaveRatio(60, 6)).toBeGreaterThan(skyWaveRatio(60, 0))
    expect(skyWaveRatio(80, 0)).toBeGreaterThan(skyWaveRatio(20, 0))
    expect(skyWaveRatio(5, 18)).toBe(0)
    expect(skyWaveRatio(500, 18)).toBeLessThanOrEqual(0.45)
  })
  it('the sky-wave path difference shrinks relative to distance far away', () => {
    expect(skyWavePathDifferenceM(0, 100)).toBeCloseTo(200_000)
    expect(skyWavePathDifferenceM(60)).toBeLessThan(skyWavePathDifferenceM(10))
  })
  function stats(d: number, hour: number) {
    let max = 0
    let sum2 = 0
    let n = 0
    for (let t = 0; t < 600; t += 0.5) {
      const e = nightEffectErrorDeg(d, hour, 344, t, 3)
      max = Math.max(max, Math.abs(e))
      sum2 += e * e
      n++
    }
    return { max, rms: Math.sqrt(sum2 / n) }
  }
  it('the needle error is zero by day and worst at dusk, and grows with distance', () => {
    expect(stats(55, 12).max).toBe(0)
    const dusk = stats(55, 18)
    const night = stats(55, 0)
    expect(dusk.rms).toBeGreaterThan(night.rms)
    expect(night.rms).toBeGreaterThan(1)
    expect(stats(20, 18).rms).toBeLessThan(dusk.rms)
    // Plausible magnitudes: a few degrees to a few tens of degrees.
    expect(dusk.max).toBeLessThan(30)
    expect(dusk.max).toBeGreaterThan(8)
  })
})

describe('thunderstorm', () => {
  const ac = { x: 0, y: 0 }
  const stn = { x: 0, y: 30 }
  const flash: LightningFlash = { timeS: 10, pos: { x: 15, y: 0 }, strength: 1 }
  it('a flash pulls hardest right after it happens, then fades', () => {
    expect(flashPull(flash, 9, ac, stn)).toBe(0)
    const p0 = flashPull(flash, 10, ac, stn)
    expect(p0).toBeGreaterThan(0)
    expect(p0).toBeLessThanOrEqual(LIGHTNING.maxRatio)
    expect(flashPull(flash, 11, ac, stn)).toBeLessThan(p0)
    expect(flashPull(flash, 30, ac, stn)).toBe(0)
  })
  it('a closer storm or a farther beacon pulls harder', () => {
    const near = { ...flash, pos: { x: 8, y: 0 } }
    expect(flashPull(near, 10, ac, { x: 0, y: 12 })).toBeGreaterThan(flashPull(flash, 10, ac, { x: 0, y: 12 }))
  })
  it('the needle swings toward the lightning (the storm is to the right here)', () => {
    const b0 = bearingDeg(ac, stn)
    const e = lightningErrorDeg(b0, [flash], 10, ac, stn)
    expect(e).toBeGreaterThan(5)
    expect(e).toBeLessThan(90)
    expect(lightningErrorDeg(b0, [flash], 20, ac, stn)).toBeCloseTo(0, 3)
    expect(lightningErrorDeg(b0, [], 10, ac, stn)).toBe(0)
    const left = { ...flash, pos: { x: -15, y: 0 } }
    expect(lightningErrorDeg(b0, [left], 10, ac, stn)).toBeLessThan(-5)
  })
})

describe('coastal refraction', () => {
  const straight = () => 40 // coastline along x = 40, running north-south
  it('the bend grows as the path gets closer to parallel with the coast', () => {
    expect(coastalBendDeg(90)).toBeCloseTo(0, 6)
    expect(coastalBendDeg(30)).toBeGreaterThan(coastalBendDeg(60))
    expect(coastalBendDeg(10)).toBeGreaterThan(coastalBendDeg(30))
    expect(coastalBendDeg(0.1)).toBeLessThanOrEqual(12)
  })
  it('finds the crossing, its angle and direction', () => {
    const c = findCoastCrossings({ x: 20, y: 0 }, { x: 60, y: 40 }, straight)
    expect(c).toHaveLength(1)
    expect(c[0].point.x).toBeCloseTo(40, 3)
    expect(c[0].angleDeg).toBeCloseTo(45, 3)
    expect(c[0].toSea).toBe(true)
    expect(c[0].fromStationNm).toBeCloseTo(Math.hypot(20, 20), 3)
    expect(findCoastCrossings({ x: 0, y: 0 }, { x: 30, y: 30 }, straight)).toHaveLength(0)
  })
  it('land to sea bends the wave toward the coastline direction', () => {
    // Path bearing 45° (north-east), coast runs north: the wave turns anticlockwise (toward north).
    const [c] = findCoastCrossings({ x: 20, y: 0 }, { x: 60, y: 40 }, straight)
    expect(c.bendDeg).toBeLessThan(0)
    // Sea to land (path bearing 225°, coast direction 180°): bends away from the coastline, clockwise.
    const [d] = findCoastCrossings({ x: 60, y: 40 }, { x: 20, y: 0 }, straight)
    expect(d.toSea).toBe(false)
    expect(d.bendDeg).toBeGreaterThan(0)
  })
  it('no error when the path stays over land; bigger at shallow angles', () => {
    expect(coastalRefractionErrorDeg({ x: 0, y: 0 }, { x: 30, y: 30 }, straight).errorDeg).toBe(0)
    const steep = Math.abs(coastalRefractionErrorDeg({ x: 30, y: 0 }, { x: 45, y: 2 }, straight).errorDeg)
    const shallow = Math.abs(coastalRefractionErrorDeg({ x: 30, y: 0 }, { x: 45, y: 40 }, straight).errorDeg)
    expect(shallow).toBeGreaterThan(steep)
    expect(shallow).toBeGreaterThan(1)
    expect(shallow).toBeLessThan(15)
  })
  it('a beacon right on the coast has almost no coastal error', () => {
    const onCoast = Math.abs(coastalRefractionErrorDeg({ x: 39.9, y: 0 }, { x: 50, y: 40 }, straight).errorDeg)
    const inland = Math.abs(coastalRefractionErrorDeg({ x: 30, y: -40 }, { x: 50, y: 40 }, straight).errorDeg)
    expect(onCoast).toBeLessThan(0.3)
    expect(inland).toBeGreaterThan(5 * onCoast)
  })
  it('works with the real wiggly coastline', () => {
    const r = coastalRefractionErrorDeg({ x: 20, y: 8 }, { x: 50, y: 60 }, DEFAULT_TERRAIN.coastX)
    expect(r.crossings.length).toBeGreaterThanOrEqual(1)
    expect(Number.isFinite(r.errorDeg)).toBe(true)
  })
})

describe('mountain effect', () => {
  const hills = DEFAULT_TERRAIN.hills
  it('no reflections far from high terrain', () => {
    const r = mountainReflectionErrorDeg({ x: 20, y: 8 }, { x: 45, y: -20 }, 3000, hills, 344)
    expect(Math.abs(r.errorDeg)).toBeLessThan(0.5)
  })
  it('near the mountains the needle is erratic: the error changes quickly as the aircraft moves', () => {
    const errs: number[] = []
    for (let x = -12; x < -6; x += 0.1) errs.push(mountainReflectionErrorDeg({ x: 20, y: 8 }, { x, y: 24 }, 5000, hills, 344).errorDeg)
    const max = Math.max(...errs.map(Math.abs))
    expect(max).toBeGreaterThan(3)
    expect(max).toBeLessThanOrEqual(30)
    // Sign changes along a 6 NM flight: erratic, not a steady offset.
    let flips = 0
    for (let i = 1; i < errs.length; i++) if (Math.sign(errs[i]) !== Math.sign(errs[i - 1])) flips++
    expect(flips).toBeGreaterThan(3)
  })
  it('the effect is weaker well above the peaks', () => {
    const rms = (alt: number) => {
      let s = 0
      let n = 0
      for (let x = -12; x < -6; x += 0.1) {
        s += mountainReflectionErrorDeg({ x: 20, y: 8 }, { x, y: 24 }, alt, hills, 344).errorDeg ** 2
        n++
      }
      return Math.sqrt(s / n)
    }
    expect(rms(15000)).toBeLessThan(rms(4000))
  })
})
