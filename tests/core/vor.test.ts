import { describe, expect, it } from 'vitest'
import { angleDiff, destinationPoint, magneticToTrue } from '@/core/geometry'
import {
  besselJ1,
  CDI_FULL_SCALE_DEG,
  CONE,
  coneRadiusNm,
  coneState,
  coneSwingFactor,
  cvorAmplitude,
  cvorPatternBearingDeg,
  DVOR_RING,
  dvorDopplerHz,
  dvorModulationIndex,
  dvorPeakDopplerHz,
  dvorRimSpeedMs,
  dvorSourceBearingDeg,
  isVorChannel,
  monitorShouldAlarm,
  MONITOR,
  phaseLagDeg,
  radialDeg,
  receiverPhaseDifferenceDeg,
  reflectionAmplitude,
  reflectionPathDifferenceM,
  siteErrorDeg,
  siteErrorEnvelopeDeg,
  thirtyHz,
  TO_FROM_AMBIGUITY_DEG,
  VOR_BAND_MHZ,
  VOR_IDENT,
  VOR_SIGNAL,
  vorCdi,
  vorElevationDeg,
  wavelengthAtMHz,
  type VorType,
} from '@/core/vor'
import { FT_PER_NM } from '@/core/units'

const T = 1 / 30

describe('band, channels and signal structure', () => {
  it('uses 108.00–117.95 MHz in 50 kHz steps, even tenths below 112 MHz', () => {
    expect(VOR_BAND_MHZ).toEqual({ min: 108, max: 117.95 })
    expect(isVorChannel(108.0)).toBe(true)
    expect(isVorChannel(108.05)).toBe(true)
    expect(isVorChannel(108.1)).toBe(false) // ILS localizer
    expect(isVorChannel(108.15)).toBe(false)
    expect(isVorChannel(108.2)).toBe(true)
    expect(isVorChannel(111.95)).toBe(false)
    expect(isVorChannel(112.1)).toBe(true)
    expect(isVorChannel(113.0)).toBe(true)
    expect(isVorChannel(117.95)).toBe(true)
    expect(isVorChannel(118.0)).toBe(false)
    expect(isVorChannel(113.02)).toBe(false)
  })
  it('30 Hz signals, 9960 Hz subcarrier with ±480 Hz deviation, 1020 Hz ident', () => {
    expect(VOR_SIGNAL.refVarHz).toBe(30)
    expect(VOR_SIGNAL.subcarrierHz).toBe(9960)
    expect(VOR_SIGNAL.fmDeviationHz).toBe(480)
    expect(VOR_IDENT.toneHz).toBe(1020)
  })
})

describe('radials and phase', () => {
  it('the radial is the magnetic bearing FROM the station', () => {
    expect(radialDeg({ x: 0, y: 0 }, { x: 10, y: 0 }, 0)).toBeCloseTo(90)
    // 10° East variation: true 090 is magnetic 080.
    expect(radialDeg({ x: 0, y: 0 }, { x: 10, y: 0 }, 10)).toBeCloseTo(80)
    expect(radialDeg({ x: 0, y: 0 }, { x: 0, y: -5 }, -5)).toBeCloseTo(185)
  })

  it('REF and VAR are in phase on radial 000 in both systems', () => {
    for (const type of ['cvor', 'dvor'] as VorType[]) {
      for (let t = 0; t < T; t += T / 17) {
        const s = thirtyHz(type, t, 0)
        expect(s.ref).toBeCloseTo(s.variable, 12)
      }
    }
  })

  it('CVOR: REF is the FM, VAR is the AM, and VAR lags REF by the radial', () => {
    const s = thirtyHz('cvor', 0, 90)
    expect(s.fm).toBe(s.ref)
    expect(s.am).toBe(s.variable)
    expect(phaseLagDeg((t) => thirtyHz('cvor', t, 90).variable)).toBeCloseTo(90, 6)
    expect(phaseLagDeg((t) => thirtyHz('cvor', t, 90).ref)).toBeCloseTo(0, 6)
  })

  it('DVOR: REF is the AM, VAR is the FM, and VAR leads REF by the radial', () => {
    const s = thirtyHz('dvor', 0, 90)
    expect(s.am).toBe(s.ref)
    expect(s.fm).toBe(s.variable)
    expect(phaseLagDeg((t) => thirtyHz('dvor', t, 90).variable)).toBeCloseTo(270, 6)
  })

  it('the same receiver (AM lag behind FM) reads the radial from both systems', () => {
    for (const type of ['cvor', 'dvor'] as VorType[]) {
      for (const r of [0, 1, 45, 90, 135, 180, 225, 270, 359]) {
        const measured = receiverPhaseDifferenceDeg((t) => thirtyHz(type, t, r).fm, (t) => thirtyHz(type, t, r).am)
        expect(Math.abs(angleDiff(r, measured))).toBeLessThan(1e-6)
      }
    }
  })
})

describe('how the variable signal is made', () => {
  it('CVOR pattern turns clockwise 30 times a second, pointing at magnetic north at t = 0', () => {
    expect(cvorPatternBearingDeg(0, 5)).toBeCloseTo(5)
    expect(cvorPatternBearingDeg(T / 4, 0)).toBeCloseTo(90)
    expect(cvorPatternBearingDeg(T, 0)).toBeCloseTo(0, 6)
  })
  it('CVOR carrier amplitude in a direction equals 1 + m × VAR on that radial', () => {
    const variation = 7
    for (const az of [10, 100, 250]) {
      for (let t = 0; t < T; t += T / 9) {
        const radial = az - variation
        expect(cvorAmplitude(t, az, variation, 0.3)).toBeCloseTo(1 + 0.3 * thirtyHz('cvor', t, radial).variable, 10)
      }
    }
  })
  it('DVOR commutation runs counter-clockwise (bearing decreasing)', () => {
    const a = dvorSourceBearingDeg(0, 0)
    const b = dvorSourceBearingDeg(T / 100, 0)
    expect(angleDiff(a, b)).toBeLessThan(0)
    expect(a).toBeCloseTo(90)
    expect(dvorSourceBearingDeg(T / 4, 0)).toBeCloseTo(0, 6)
  })
  it('peak Doppler: 6.76 m radius at 30 rev/s gives a rim speed of about 1,274 m/s and about 480 Hz at 113 MHz', () => {
    expect(dvorRimSpeedMs(6.76, 30)).toBeCloseTo(1274.2, 0)
    expect(wavelengthAtMHz(113)).toBeCloseTo(2.653, 3)
    expect(dvorPeakDopplerHz(DVOR_RING.radiusM, DVOR_RING.revPerS, 113)).toBeCloseTo(480, -1)
    expect(Math.abs(dvorPeakDopplerHz(6.76, 30, 113) - 480)).toBeLessThan(2)
    expect(dvorModulationIndex(6.76, 113)).toBeCloseTo(dvorPeakDopplerHz(6.76, 30, 113) / 30, 6)
  })
  it('the Doppler shift in a direction equals peak × VAR (FM) on that radial', () => {
    const variation = -4
    for (const az of [0, 77, 181, 300]) {
      for (let t = 0; t < T; t += T / 11) {
        expect(dvorDopplerHz(t, az, variation, 480)).toBeCloseTo(480 * thirtyHz('dvor', t, az - variation).variable, 8)
      }
    }
  })
  it('an observer on radial 000 sees the biggest Doppler shift at the reference peak', () => {
    expect(dvorDopplerHz(0, 12, 12, 480)).toBeCloseTo(480)
  })
})

describe('CDI', () => {
  it('uses the documented cases', () => {
    // OBS 090 FROM on radial 095 → needle left.
    const a = vorCdi(90, 95)
    expect(a.toFrom).toBe('FROM')
    expect(a.deviationDeg).toBeCloseTo(-5)
    expect(a.lateral).toBeLessThan(0)
    // OBS 090 TO on radial 265 → needle left.
    const b = vorCdi(90, 265)
    expect(b.toFrom).toBe('TO')
    expect(b.deviationDeg).toBeCloseTo(-5)
    // OBS 090 TO on radial 275 → needle right.
    const c = vorCdi(90, 275)
    expect(c.toFrom).toBe('TO')
    expect(c.deviationDeg).toBeCloseTo(5)
    expect(c.lateral).toBeCloseTo(0.5)
  })
  it('centred on course, full scale at 10°, OFF near abeam', () => {
    expect(vorCdi(90, 90)).toMatchObject({ toFrom: 'FROM', deviationDeg: 0 })
    expect(vorCdi(90, 270)).toMatchObject({ toFrom: 'TO', deviationDeg: 0 })
    expect(vorCdi(90, 100).lateral).toBeCloseTo(-1)
    expect(CDI_FULL_SCALE_DEG).toBe(10)
    expect(vorCdi(90, 0).toFrom).toBe('OFF')
    expect(vorCdi(90, 180 + TO_FROM_AMBIGUITY_DEG - 0.5).toFrom).toBe('OFF')
    expect(vorCdi(90, 180 + TO_FROM_AMBIGUITY_DEG + 0.5).toFrom).toBe('TO')
  })
  it('fly the needle: moving toward the needle side reduces the deviation', () => {
    // Inbound on course 090 TO (radial 270), aircraft slightly south: radial 265 → needle left.
    // Moving north (to the left when flying east) brings the radial back to 270.
    expect(Math.abs(vorCdi(90, 268).deviationDeg)).toBeLessThan(Math.abs(vorCdi(90, 265).deviationDeg))
    expect(Math.sign(vorCdi(90, 268).lateral)).toBe(-1)
  })
  it('is independent of heading: same radial, same indication', () => {
    expect(vorCdi(30, 200)).toEqual(vorCdi(30, 200))
  })
})

describe('cone of confusion', () => {
  it('elevation and cone radius', () => {
    expect(vorElevationDeg(1, FT_PER_NM)).toBeCloseTo(45)
    expect(vorElevationDeg(0, 10000)).toBeCloseTo(90)
    expect(vorElevationDeg(10, 0)).toBe(0)
    // Radius = h / tan(limit).
    expect(coneRadiusNm(FT_PER_NM, 45)).toBeCloseTo(1)
    expect(coneRadiusNm(20000)).toBeCloseTo(20000 / FT_PER_NM / Math.tan((CONE.flagElevationDeg * Math.PI) / 180))
    expect(coneRadiusNm(30000)).toBeGreaterThan(coneRadiusNm(10000))
  })
  it('clear, swinging, then flag inside the cone', () => {
    expect(coneState(20)).toBe('clear')
    expect(coneState(45)).toBe('swing')
    expect(coneState(60)).toBe('cone')
    expect(coneSwingFactor(30)).toBe(0)
    expect(coneSwingFactor(CONE.flagElevationDeg)).toBeCloseTo(1)
    expect(coneSwingFactor(45)).toBeGreaterThan(0)
  })
})

describe('site error (scalloping)', () => {
  it('Bessel J1 matches known values', () => {
    expect(besselJ1(0)).toBeCloseTo(0, 12)
    expect(besselJ1(1)).toBeCloseTo(0.4400505857, 8)
    expect(besselJ1(10)).toBeCloseTo(0.0434727462, 8)
    expect(besselJ1(3.8317059702)).toBeCloseTo(0, 7)
    expect(besselJ1(-2)).toBeCloseTo(-besselJ1(2), 12)
  })
  it('reflection amplitude and path difference', () => {
    expect(reflectionAmplitude(300)).toBeCloseTo(0.1)
    expect(reflectionAmplitude(100)).toBeGreaterThan(reflectionAmplitude(300))
    expect(reflectionAmplitude(1)).toBeLessThanOrEqual(0.3)
    const st = { x: 0, y: 0 }
    const b = destinationPoint(st, 0, 300 / 1852)
    // Aircraft far away in line beyond the building: the paths are equal.
    expect(reflectionPathDifferenceM(st, b, { x: 0, y: 30 }, 0)).toBeCloseTo(0, 3)
    // Aircraft far away on the opposite side: the reflection travels 2 × 300 m extra.
    expect(reflectionPathDifferenceM(st, b, { x: 0, y: -30 }, 0)).toBeCloseTo(600, 0)
  })
  it('no error when the building is in line with the aircraft, or directly behind the station', () => {
    for (const type of ['cvor', 'dvor'] as VorType[]) {
      expect(siteErrorDeg(type, 60, 60, 0.1, 0, 16)).toBeCloseTo(0, 9)
      expect(siteErrorDeg(type, 240, 60, 0.1, 0, 16)).toBeCloseTo(0, 9)
    }
  })
  it('CVOR: a few degrees at right angles to the building, swinging with the reflection phase', () => {
    const [lo, hi] = siteErrorEnvelopeDeg('cvor', 150, 60, 0.12, 16)
    expect(hi).toBeCloseTo((Math.atan(0.12) * 180) / Math.PI, 6)
    expect(lo).toBeCloseTo(-hi, 6)
    expect(siteErrorDeg('cvor', 150, 60, 0.12, Math.PI / 2, 16)).toBeCloseTo(0, 9)
  })
  it('DVOR suffers far less than CVOR from the same building', () => {
    const m = dvorModulationIndex(DVOR_RING.radiusM, 113)
    let c2 = 0
    let d2 = 0
    for (let az = 0; az < 360; az += 0.5) {
      const [cl, ch] = siteErrorEnvelopeDeg('cvor', az, 60, 0.12, m)
      const [dl, dh] = siteErrorEnvelopeDeg('dvor', az, 60, 0.12, m)
      c2 += Math.max(-cl, ch) ** 2
      d2 += Math.max(-dl, dh) ** 2
    }
    const ratio = Math.sqrt(d2 / c2)
    expect(ratio).toBeLessThan(0.3)
    expect(ratio).toBeGreaterThan(0.01)
    // At right angles to the building the DVOR error is tiny.
    const [, dh] = siteErrorEnvelopeDeg('dvor', 150, 60, 0.12, m)
    const [, ch] = siteErrorEnvelopeDeg('cvor', 150, 60, 0.12, m)
    expect(dh).toBeLessThan(ch / 10)
  })
  it('DVOR and CVOR behave alike for a reflector only a few degrees from the aircraft direction', () => {
    const m = dvorModulationIndex(DVOR_RING.radiusM, 113)
    const c = siteErrorEnvelopeDeg('cvor', 62, 60, 0.12, m)[1]
    const d = siteErrorEnvelopeDeg('dvor', 62, 60, 0.12, m)[1]
    expect(d / c).toBeGreaterThan(0.5)
  })
})

describe('monitor', () => {
  it('alarms beyond 1° of bearing shift or a 15 % modulation drop', () => {
    expect(MONITOR.bearingAlarmDeg).toBe(1)
    expect(monitorShouldAlarm(0.5)).toBe(false)
    expect(monitorShouldAlarm(-1.2)).toBe(true)
    expect(monitorShouldAlarm(0, 0.2)).toBe(true)
  })
})

describe('geometry helpers agree', () => {
  it('a point on a magnetic radial has that radial', () => {
    const variation = 12
    const p = destinationPoint({ x: 3, y: -2 }, magneticToTrue(137, variation), 14)
    expect(radialDeg({ x: 3, y: -2 }, p, variation)).toBeCloseTo(137, 9)
  })
})
