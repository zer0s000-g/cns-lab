import { describe, expect, it } from 'vitest'
import { azimuthElevation, dist3, geodeticToEcef, norm3, type Vec3 } from '@/core/geometry'
import {
  EARTH_ROTATION_RAD_S,
  ELEVATION_MASK_DEG,
  GEO_RADIUS_M,
  GPS_CONSTELLATION,
  GPS_INCLINATION_DEG,
  GPS_L1_HZ,
  GPS_PLANES,
  GPS_SEMI_MAJOR_AXIS_M,
  angleBetweenDeg,
  canTrack,
  chiSquareSurvival,
  chiSquareThreshold,
  circularOrbitEci,
  clockErrorToRangeM,
  computeDop,
  dopRating,
  ecefToEci,
  eciToEcef,
  enuAzimuthDeg,
  enuUnitVector,
  epochGaussian,
  errorBudget,
  faultVisibility,
  gammaQ,
  geometryMatrix,
  geostationaryEcef,
  horizontal95M,
  invertMatrix,
  ionoObliquity,
  jammedCn0DbHz,
  lnGamma,
  meanMotionRadS,
  nominalCn0DbHz,
  orbitalPeriodS,
  predictedSigmaM,
  pseudorange,
  raimCheck,
  rangeErrors,
  receiverNoiseSigmaM,
  rms,
  satelliteEcef,
  satelliteEci,
  smoothNoise,
  solveLinear,
  solvePosition,
  solvePositionFixedClock,
  thermalNoiseDbm,
  travelTimeFromRangeS,
  tropoMapping,
  vertical95M,
  type Measurement,
  type SkyDirection,
} from '@/core/gnss'
import { gaussian, mulberry32 } from '@/core/random'
import { SPEED_OF_LIGHT_MS } from '@/core/units'

const REF = { lat: -6.2, lon: 106.8 }
const RX = geodeticToEcef(REF, 12)
const CLOCK_M = 0.35e-3 * SPEED_OF_LIGHT_MS

function visibleAt(t: number) {
  return GPS_CONSTELLATION.map((s) => {
    const ecef = satelliteEcef(s, t)
    const ae = azimuthElevation(ecef, RX, REF)
    return { id: s.id, ecef, az: ae.azimuthDeg, el: ae.elevationDeg }
  }).filter((s) => s.el >= ELEVATION_MASK_DEG)
}

/** The 4 visible satellites with the best geometry (lowest PDOP). */
function bestFour(t: number) {
  const v = visibleAt(t)
  let best = v.slice(0, 4)
  let bp = Infinity
  for (let a = 0; a < v.length; a++)
    for (let b = a + 1; b < v.length; b++)
      for (let c = b + 1; c < v.length; c++)
        for (let d = c + 1; d < v.length; d++) {
          const set = [v[a], v[b], v[c], v[d]]
          const p = computeDop(set.map((s) => ({ azDeg: s.az, elDeg: s.el })))?.pdop ?? Infinity
          if (p < bp) {
            bp = p
            best = set
          }
        }
  return best
}

function measure(sats: { id: string; ecef: Vec3 }[], errors: (i: number) => number = () => 0, rx = RX, clock = CLOCK_M): Measurement[] {
  return sats.map((s, i) => ({ id: s.id, sat: s.ecef, pseudorangeM: pseudorange(s.ecef, rx, clock) + errors(i) }))
}

describe('orbits', () => {
  it('a GPS orbit takes 11 h 58 min, half a sidereal day', () => {
    const T = orbitalPeriodS()
    expect(T / 3600).toBeCloseTo(11 + 58 / 60, 1)
    expect(Math.abs(T - 86164.0905 / 2)).toBeLessThan(15)
    expect(meanMotionRadS() * T).toBeCloseTo(2 * Math.PI, 9)
  })

  it('circular orbits keep their radius and reach 55° latitude', () => {
    let maxZ = 0
    for (let t = 0; t < orbitalPeriodS(); t += 600) {
      const p = circularOrbitEci(30, 10, t)
      expect(norm3(p)).toBeCloseTo(GPS_SEMI_MAJOR_AXIS_M, 3)
      maxZ = Math.max(maxZ, p.z)
    }
    expect(maxZ / GPS_SEMI_MAJOR_AXIS_M).toBeCloseTo(Math.sin((GPS_INCLINATION_DEG * Math.PI) / 180), 2)
  })

  it('satellites move eastward (prograde) at about 3.9 km/s', () => {
    const s = GPS_CONSTELLATION[0]
    const a = satelliteEci(s, 0)
    const b = satelliteEci(s, 1)
    expect(dist3(a, b)).toBeGreaterThan(3800)
    expect(dist3(a, b)).toBeLessThan(3950)
    // Angular momentum points north-ish (z > 0) for a prograde orbit.
    const hz = a.x * b.y - a.y * b.x
    expect(hz).toBeGreaterThan(0)
  })

  it('has 27 satellites in 6 planes spaced 60° apart', () => {
    expect(GPS_CONSTELLATION).toHaveLength(27)
    const raans = GPS_PLANES.map((p) => GPS_CONSTELLATION.find((s) => s.plane === p)!.raanDeg)
    for (let i = 1; i < raans.length; i++) expect(((raans[i] - raans[i - 1] + 360) % 360)).toBeCloseTo(60, 6)
    for (const p of GPS_PLANES) expect(GPS_CONSTELLATION.filter((s) => s.plane === p).length).toBeGreaterThanOrEqual(4)
    expect(new Set(GPS_CONSTELLATION.map((s) => s.id)).size).toBe(27)
  })

  it('ECI and ECEF are rotations of each other by the Earth-rotation angle', () => {
    const v = { x: 1.2e7, y: -3.4e6, z: 2.1e7 }
    for (const t of [0, 1234, 86400]) {
      const back = ecefToEci(eciToEcef(v, t), t)
      expect(back.x).toBeCloseTo(v.x, 3)
      expect(back.y).toBeCloseTo(v.y, 3)
      expect(back.z).toBeCloseTo(v.z, 3)
      expect(norm3(eciToEcef(v, t))).toBeCloseTo(norm3(v), 3)
    }
    // A point fixed in ECI drifts west in ECEF as the Earth turns east.
    const p0 = eciToEcef({ x: 1, y: 0, z: 0 }, 0, 0)
    const p1 = eciToEcef({ x: 1, y: 0, z: 0 }, 3600, 0)
    expect(Math.atan2(p1.y, p1.x) - Math.atan2(p0.y, p0.x)).toBeCloseTo(-EARTH_ROTATION_RAD_S * 3600, 9)
  })

  it('the same sky repeats after one sidereal day (the ground track repeats)', () => {
    const s = GPS_CONSTELLATION[5]
    const d = dist3(satelliteEcef(s, 1000), satelliteEcef(s, 1000 + 86164.0905))
    expect(d).toBeLessThan(100_000)
  })

  it('a geostationary satellite sits 42,164 km from the centre above the equator', () => {
    const g = geostationaryEcef(110.5)
    expect(norm3(g)).toBeCloseTo(GEO_RADIUS_M, 0)
    expect(g.z).toBe(0)
    expect((Math.atan2(g.y, g.x) * 180) / Math.PI).toBeCloseTo(110.5, 6)
  })

  it('between 7 and 13 satellites are above the 5° mask over the airport all day', () => {
    for (let t = 0; t < 86400; t += 900) {
      const n = visibleAt(t).length
      expect(n).toBeGreaterThanOrEqual(7)
      expect(n).toBeLessThanOrEqual(13)
    }
  })
})

describe('linear algebra', () => {
  it('solves a small system and inverts a matrix', () => {
    const A = [
      [4, 1, 2],
      [1, 3, 0],
      [2, 0, 5],
    ]
    const x = solveLinear(A, [7, 4, 7])!
    expect(x[0]).toBeCloseTo(1, 10)
    expect(x[1]).toBeCloseTo(1, 10)
    expect(x[2]).toBeCloseTo(1, 10)
    const inv = invertMatrix(A)!
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        const v = A[i].reduce((s, a, k) => s + a * inv[k][j], 0)
        expect(v).toBeCloseTo(i === j ? 1 : 0, 10)
      }
  })

  it('returns null for a singular system', () => {
    expect(solveLinear([[1, 2], [2, 4]], [1, 2])).toBeNull()
    expect(invertMatrix([[0, 0], [0, 0]])).toBeNull()
  })
})

describe('position solution', () => {
  it('pseudorange is geometric range plus the clock term, and 1 µs is about 300 m', () => {
    const s = { x: 2e7, y: 1e7, z: 5e6 }
    expect(pseudorange(s, RX, 123)).toBeCloseTo(dist3(s, RX) + 123, 6)
    expect(clockErrorToRangeM(1e-6)).toBeCloseTo(299.79, 2)
    expect(travelTimeFromRangeS(20_200_000)).toBeCloseTo(0.0674, 3)
  })

  it('recovers position and a 0.35 ms clock error exactly from 4 perfect measurements, starting at the centre of the Earth', () => {
    const sats = visibleAt(0)
    const four = [sats[0], sats[2], sats[4], sats[6]]
    const fix = solvePosition(measure(four))!
    expect(fix.converged).toBe(true)
    expect(dist3(fix.pos, RX)).toBeLessThan(1e-3)
    expect(fix.clockBiasM).toBeCloseTo(CLOCK_M, 3)
    expect(rms(fix.residuals)).toBeLessThan(1e-3)
    expect(fix.iterations).toBeLessThan(12)
  })

  it('uses every satellite when there are more than 4, and small errors give a small position error', () => {
    const sats = visibleAt(3600)
    const rand = mulberry32(3)
    const fix = solvePosition(measure(sats, () => gaussian(rand) * 2))!
    expect(fix.residuals).toHaveLength(sats.length)
    expect(dist3(fix.pos, RX)).toBeLessThan(15)
  })

  it('cannot solve for position and clock with only 3 satellites', () => {
    expect(solvePosition(measure(visibleAt(0).slice(0, 3)))).toBeNull()
  })

  it('with 3 satellites every assumed clock error gives a different answer that fits perfectly', () => {
    const three = visibleAt(0).slice(0, 3)
    const meas = measure(three)
    const answers = [-600, 0, 600].map((ns) => solvePositionFixedClock(meas, CLOCK_M + ns * 1e-9 * SPEED_OF_LIGHT_MS, { initial: RX })!)
    for (const a of answers) expect(rms(a.residuals)).toBeLessThan(1e-4)
    expect(dist3(answers[1].pos, RX)).toBeLessThan(1e-3)
    expect(dist3(answers[0].pos, answers[2].pos)).toBeGreaterThan(200)
  })

  it('with 4 satellites only the right clock makes all the spheres meet', () => {
    const meas = measure(bestFour(0))
    const right = solvePositionFixedClock(meas, CLOCK_M, { initial: RX })!
    const wrong = solvePositionFixedClock(meas, CLOCK_M + 300, { initial: RX })!
    expect(rms(right.residuals)).toBeLessThan(1e-4)
    expect(rms(wrong.residuals)).toBeGreaterThan(10)
  })
})

describe('dilution of precision', () => {
  const ring = (el: number, n: number, az0 = 0): SkyDirection[] => Array.from({ length: n }, (_, i) => ({ azDeg: az0 + (i * 360) / n, elDeg: el }))

  it('one satellite overhead and three spread low down give a small PDOP', () => {
    const d = computeDop([{ azDeg: 0, elDeg: 90 }, ...ring(5, 3)])!
    expect(d.pdop).toBeLessThan(2)
    expect(d.hdop).toBeLessThan(d.pdop)
  })

  it('clustered satellites give a much larger DOP than spread ones', () => {
    const clustered: SkyDirection[] = [
      { azDeg: 100, elDeg: 40 },
      { azDeg: 110, elDeg: 45 },
      { azDeg: 105, elDeg: 52 },
      { azDeg: 95, elDeg: 47 },
    ]
    const spread: SkyDirection[] = [{ azDeg: 10, elDeg: 80 }, ...ring(15, 3, 30)]
    const c = computeDop(clustered)!
    const s = computeDop(spread)!
    expect(c.pdop).toBeGreaterThan(20)
    expect(s.pdop).toBeLessThan(3)
    expect(c.pdop / s.pdop).toBeGreaterThan(8)
  })

  it('obeys GDOP² = PDOP² + TDOP² and PDOP² = HDOP² + VDOP²', () => {
    const d = computeDop(visibleAt(7200).map((s) => ({ azDeg: s.az, elDeg: s.el })))!
    expect(d.gdop ** 2).toBeCloseTo(d.pdop ** 2 + d.tdop ** 2, 9)
    expect(d.pdop ** 2).toBeCloseTo(d.hdop ** 2 + d.vdop ** 2, 9)
  })

  it('does not depend on which way north is (turning the whole sky keeps DOP)', () => {
    const dirs = visibleAt(100).map((s) => ({ azDeg: s.az, elDeg: s.el }))
    const a = computeDop(dirs)!
    const b = computeDop(dirs.map((d) => ({ ...d, azDeg: d.azDeg + 37 })))!
    expect(b.pdop).toBeCloseTo(a.pdop, 9)
    expect(b.hdop).toBeCloseTo(a.hdop, 9)
    expect(b.vdop).toBeCloseTo(a.vdop, 9)
  })

  it('four satellites whose directions lie on one cone cannot separate height from clock', () => {
    // At the start of the lesson G01, G02, G06 and G08 happen to line up like this: PDOP in the thousands.
    const v = visibleAt(0).filter((s) => ['G01', 'G02', 'G06', 'G08'].includes(s.id))
    expect(computeDop(v.map((s) => ({ azDeg: s.az, elDeg: s.el })))!.pdop).toBeGreaterThan(1000)
  })

  it('needs 4 satellites, and a degenerate geometry has no DOP', () => {
    expect(computeDop(ring(30, 3))).toBeNull()
    expect(computeDop(ring(30, 4))).toBeNull() // all on one cone: the height and the clock cannot be told apart
  })

  it('builds G rows as [−unit vector (ENU), 1]', () => {
    const G = geometryMatrix([{ azDeg: 90, elDeg: 0 }])
    expect(G[0][0]).toBeCloseTo(-1, 12)
    expect(G[0][1]).toBeCloseTo(0, 12)
    expect(G[0][2]).toBeCloseTo(0, 12)
    expect(G[0][3]).toBe(1)
    const u = enuUnitVector({ azDeg: 0, elDeg: 90 })
    expect(u.z).toBeCloseTo(1, 12)
  })

  it('rates DOP values in plain words', () => {
    expect(dopRating(1)).toBe('ideal')
    expect(dopRating(1.6)).toBe('excellent')
    expect(dopRating(3)).toBe('good')
    expect(dopRating(7)).toBe('moderate')
    expect(dopRating(15)).toBe('fair')
    expect(dopRating(40)).toBe('poor')
    expect(dopRating(Infinity)).toBe('poor')
  })

  it('measures the angle between sky directions', () => {
    expect(angleBetweenDeg({ azDeg: 0, elDeg: 0 }, { azDeg: 90, elDeg: 0 })).toBeCloseTo(90, 9)
    expect(angleBetweenDeg({ azDeg: 0, elDeg: 90 }, { azDeg: 123, elDeg: 0 })).toBeCloseTo(90, 9)
    expect(enuAzimuthDeg(1, 0)).toBeCloseTo(90, 9)
    expect(enuAzimuthDeg(0, -1)).toBeCloseTo(180, 9)
  })
})

describe('atmosphere and error budget', () => {
  it('the ionosphere path is 1× overhead and about 3× near the horizon', () => {
    expect(ionoObliquity(90)).toBeCloseTo(1, 9)
    expect(ionoObliquity(5)).toBeGreaterThan(2.8)
    expect(ionoObliquity(5)).toBeLessThan(3.2)
    expect(ionoObliquity(30)).toBeGreaterThan(ionoObliquity(60))
  })

  it('the troposphere mapping is 1 overhead and about 10 at 5°', () => {
    expect(tropoMapping(90)).toBeCloseTo(1, 2)
    expect(tropoMapping(5)).toBeGreaterThan(9)
    expect(tropoMapping(5)).toBeLessThan(11)
  })

  it('unaugmented ranging error is a few metres, SBAS about 1 m, GBAS a few decimetres', () => {
    const none = predictedSigmaM(errorBudget('none'), 45)
    const sbas = predictedSigmaM(errorBudget('sbas'), 45)
    const gbas = predictedSigmaM(errorBudget('gbas'), 45)
    expect(none).toBeGreaterThan(4)
    expect(none).toBeLessThan(7)
    expect(sbas).toBeGreaterThan(0.5)
    expect(sbas).toBeLessThan(1.5)
    expect(gbas).toBeLessThan(0.5)
    // The ionosphere is the biggest unaugmented term.
    const b = errorBudget('none')
    const iono = ionoObliquity(45) * Math.hypot(b.ionoVerticalBiasM, b.ionoVerticalSigmaM)
    expect(iono).toBeGreaterThan(b.clockOrbitM)
    expect(iono).toBeGreaterThan(receiverNoiseSigmaM(45, 'raw'))
  })

  it('a storm makes errors much larger, and low satellites are always worse', () => {
    for (const aug of ['none', 'sbas', 'gbas'] as const) {
      expect(predictedSigmaM(errorBudget(aug, true), 45)).toBeGreaterThan(predictedSigmaM(errorBudget(aug, false), 45))
      expect(predictedSigmaM(errorBudget(aug), 5)).toBeGreaterThan(predictedSigmaM(errorBudget(aug), 60))
    }
    expect(predictedSigmaM(errorBudget('none', true), 45)).toBeGreaterThan(12)
  })

  it('simulated errors are deterministic and about as large as predicted', () => {
    const b = errorBudget('none')
    expect(rangeErrors(b, 3, 40, 1234.5, 9).totalM).toBe(rangeErrors(b, 3, 40, 1234.5, 9).totalM)
    const v: number[] = []
    for (let k = 1; k <= 20; k++) for (let t = 0; t < 86400; t += 600) v.push(rangeErrors(b, k, 40, t, 9).totalM)
    const r = rms(v)
    const p = predictedSigmaM(b, 40)
    expect(r / p).toBeGreaterThan(0.6)
    expect(r / p).toBeLessThan(1.3)
  })

  it('smooth noise and epoch noise have zero mean and unit variance', () => {
    const a: number[] = []
    const g: number[] = []
    for (let k = 0; k < 40; k++)
      for (let t = 0; t < 20000; t += 50) {
        a.push(smoothNoise(t, k, 5, 300))
        g.push(epochGaussian(t, k, 5))
      }
    const mean = (x: number[]) => x.reduce((s, y) => s + y, 0) / x.length
    expect(Math.abs(mean(a))).toBeLessThan(0.1)
    expect(rms(a)).toBeGreaterThan(0.85)
    expect(rms(a)).toBeLessThan(1.15)
    expect(Math.abs(mean(g))).toBeLessThan(0.05)
    expect(rms(g)).toBeCloseTo(1, 1)
    // Smooth: neighbouring samples one second apart are nearly equal.
    expect(Math.abs(smoothNoise(100, 1, 5, 300) - smoothNoise(101, 1, 5, 300))).toBeLessThan(0.1)
  })

  it('the 95% circle is 2 × DOP × ranging error', () => {
    expect(horizontal95M(1.5, 4)).toBe(12)
    expect(vertical95M(2, 3)).toBe(12)
  })
})

describe('RAIM', () => {
  it('computes gamma and chi-square values', () => {
    expect(lnGamma(5)).toBeCloseTo(Math.log(24), 9)
    expect(lnGamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 9)
    expect(gammaQ(1, 2)).toBeCloseTo(Math.exp(-2), 9)
    expect(chiSquareThreshold(0.05, 1)).toBeCloseTo(3.841, 3)
    expect(chiSquareThreshold(0.05, 2)).toBeCloseTo(5.991, 3)
    expect(chiSquareThreshold(0.01, 3)).toBeCloseTo(11.345, 3)
    expect(chiSquareSurvival(chiSquareThreshold(1e-6, 2), 2)).toBeCloseTo(1e-6, 9)
  })

  it('the visibility of all faults adds up to the number of spare measurements', () => {
    const dirs = visibleAt(0).map((s) => ({ azDeg: s.az, elDeg: s.el }))
    const sum = dirs.reduce((s, _, i) => s + faultVisibility(dirs, i), 0)
    expect(sum).toBeCloseTo(dirs.length - 4, 6)
  })

  const noisy = (seed: number, sigma: number) => {
    const rand = mulberry32(seed)
    return () => gaussian(rand) * sigma
  }

  it('cannot check anything with 4 satellites', () => {
    const r = raimCheck(measure(bestFour(0)), 5)
    expect(r.status).toBe('unavailable')
    expect(r.fix).not.toBeNull()
  })

  it('with 5 satellites it detects a fault but cannot say which satellite', () => {
    const dirs = visibleAt(0)
    const five = dirs.slice(0, 5)
    const vis = five.map((_, i) => faultVisibility(five.map((s) => ({ azDeg: s.az, elDeg: s.el })), i))
    const j = vis.indexOf(Math.max(...vis))
    const clean = raimCheck(measure(five, noisy(1, 3)), 5)
    expect(clean.status).toBe('ok')
    const n = noisy(1, 3)
    const bad = raimCheck(measure(five, (i) => n() + (i === j ? 150 : 0)), 5)
    expect(bad.status).toBe('fault-detected')
    expect(bad.excludedIndex).toBeUndefined()
  })

  it('with 6 or more satellites it finds the faulty one and leaves it out', () => {
    const sats = visibleAt(0)
    expect(sats.length).toBeGreaterThanOrEqual(7)
    const n = noisy(2, 3)
    const j = 2
    const r = raimCheck(measure(sats, (i) => n() + (i === j ? 150 : 0)), 5)
    expect(r.status).toBe('fault-excluded')
    expect(r.excludedIndex).toBe(j)
    expect(dist3(r.fix!.pos, RX)).toBeLessThan(20)
  })

  it('does not raise false alarms with normal errors', () => {
    const sats = visibleAt(5000)
    for (let seed = 1; seed <= 50; seed++) expect(raimCheck(measure(sats, noisy(seed, 5)), 5).status).toBe('ok')
  })
})

describe('signals and jamming', () => {
  it('receiver noise in the 2 MHz GPS band is about −111 dBm, well above the −130 dBm signal', () => {
    expect(thermalNoiseDbm(2.046e6)).toBeCloseTo(-110.9, 1)
    expect(GPS_L1_HZ).toBe(1575.42e6)
  })

  it('signals are stronger overhead than near the horizon', () => {
    expect(nominalCn0DbHz(90)).toBeGreaterThan(nominalCn0DbHz(10))
    expect(nominalCn0DbHz(5)).toBeGreaterThan(38)
    expect(nominalCn0DbHz(90)).toBeLessThan(50)
  })

  it('a strong jammer drowns the signal; a weak one barely matters', () => {
    expect(jammedCn0DbHz(45, -50)).toBeCloseTo(45, 2)
    expect(jammedCn0DbHz(45, 20)).toBeGreaterThan(38)
    expect(jammedCn0DbHz(45, 54)).toBeLessThan(10)
    expect(jammedCn0DbHz(45, 40)).toBeLessThan(jammedCn0DbHz(45, 30))
    expect(canTrack(jammedCn0DbHz(45, 54))).toBe(false)
    expect(canTrack(45)).toBe(true)
  })
})
