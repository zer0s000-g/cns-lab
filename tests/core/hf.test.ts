import { describe, expect, it } from 'vitest'
import {
  ABSORBED_DB,
  D_LAYER_KM,
  HF_AERO_RANGE_MHZ,
  HF_CHANNELS_MHZ,
  HF_R_BANDS_KHZ,
  MIN_ELEVATION_DEG,
  SELCAL_GAP_S,
  SELCAL_LETTERS,
  SELCAL_PULSE_S,
  SELCAL_TONES_HZ,
  SELCAL_TOTAL_S,
  centralAngleRad,
  dPassAbsorptionDb,
  elevationForHopRad,
  elevationToReachRad,
  f2Ionisation,
  fanElevationsDeg,
  firstLandingNm,
  foEMHz,
  groundCoverage,
  groundWaveRangeNm,
  hfLevelDbm,
  hfNoiseDbm,
  hfQuality,
  hfSidePoint,
  hopDistanceNm,
  incidenceRad,
  ionosphereAt,
  isDaytime,
  isValidSelcalCode,
  mufAtIncidenceMHz,
  owfMHz,
  pathMuf,
  receptionAt,
  reflectingLayer,
  reflects,
  selcalDecodes,
  selcalPairAt,
  selcalPairs,
  skipZoneNm,
  skyFadingDb,
  slantToHeightNm,
  solarCosZenith,
  suggestChannel,
  topLayer,
  traceRay,
} from '@/core/hf'
import { freeSpacePathLossDbNm, radioLineOfSightNm } from '@/core/propagation'
import { EARTH_RADIUS_NM, kmToNm } from '@/core/units'

const DEG = Math.PI / 180
const R = EARTH_RADIUS_NM
const hF = kmToNm(300)

describe('bands and SELCAL', () => {
  it('HF aeronautical voice lies between about 2.85 and 22 MHz, every example channel inside an (R) band', () => {
    expect(HF_AERO_RANGE_MHZ).toEqual({ min: 2.85, max: 22 })
    for (const f of HF_CHANNELS_MHZ) {
      expect(HF_R_BANDS_KHZ.some(([a, b]) => f * 1000 >= a && f * 1000 <= b)).toBe(true)
    }
    expect([...HF_CHANNELS_MHZ].sort((a, b) => a - b)).toEqual([...HF_CHANNELS_MHZ])
  })

  it('has 16 SELCAL tones without I, N and O, rising in frequency', () => {
    expect(SELCAL_LETTERS).toHaveLength(16)
    for (const ch of 'INO') expect(SELCAL_LETTERS.includes(ch)).toBe(false)
    const f = [...SELCAL_LETTERS].map((c) => SELCAL_TONES_HZ[c])
    expect(f[0]).toBe(312.6)
    expect(f[15]).toBe(1479.1)
    for (let i = 1; i < 16; i++) expect(f[i]).toBeGreaterThan(f[i - 1])
  })

  it('turns a code into two pairs of tones', () => {
    expect(isValidSelcalCode('AB-CD')).toBe(true)
    expect(isValidSelcalCode('BA-CD')).toBe(false)
    expect(isValidSelcalCode('AI-CD')).toBe(false)
    expect(isValidSelcalCode('ABCD')).toBe(false)
    expect(selcalPairs('AB-CD')).toEqual([
      [312.6, 346.7],
      [384.6, 426.6],
    ])
    expect(selcalPairs('XX-YY')).toBeNull()
  })

  it('sends pair 1 for about 1 s, a 0.2 s gap, then pair 2', () => {
    expect(SELCAL_PULSE_S).toBe(1)
    expect(SELCAL_GAP_S).toBe(0.2)
    expect(SELCAL_TOTAL_S).toBeCloseTo(2.2)
    expect(selcalPairAt(0.5)).toBe(0)
    expect(selcalPairAt(1.1)).toBeNull()
    expect(selcalPairAt(1.5)).toBe(1)
    expect(selcalPairAt(2.3)).toBeNull()
  })

  it('a decoder rings only for its own code and a strong enough signal', () => {
    expect(selcalDecodes('AB-CD', 'AB-CD', 20)).toBe(true)
    expect(selcalDecodes('AB-CD', 'AB-CE', 20)).toBe(false)
    expect(selcalDecodes('AB-CD', 'AB-CD', 0)).toBe(false)
  })
})

describe('secant law and hop geometry', () => {
  it('sin i = R cos β / (R + h)', () => {
    const b = 20 * DEG
    expect(Math.sin(incidenceRad(b, hF))).toBeCloseTo((R * Math.cos(b)) / (R + hF), 12)
    expect(incidenceRad(90 * DEG, hF)).toBeCloseTo(0, 9)
  })

  it('reflects when f ≤ fc / cos i and not above', () => {
    const i = incidenceRad(10 * DEG, hF)
    const muf = mufAtIncidenceMHz(5, i)
    expect(muf).toBeCloseTo(5 / Math.cos(i), 12)
    expect(reflects(muf - 0.01, 5, i)).toBe(true)
    expect(reflects(muf + 0.01, 5, i)).toBe(false)
    // Straight up only frequencies up to the critical frequency come back.
    expect(reflects(4.99, 5, 0)).toBe(true)
    expect(reflects(5.01, 5, 0)).toBe(false)
  })

  it('one hop covers 2·R·φ with φ = π/2 − β − i', () => {
    const b = 15 * DEG
    const i = incidenceRad(b, hF)
    expect(hopDistanceNm(b, hF)).toBeCloseTo(2 * R * (Math.PI / 2 - b - i), 9)
    expect(hopDistanceNm(Math.PI / 2, hF)).toBeCloseTo(0, 6)
    // A low ray off the F layer goes roughly 3,500–4,000 km.
    const maxKm = (hopDistanceNm(MIN_ELEVATION_DEG * DEG, kmToNm(330)) * 1852) / 1000
    expect(maxKm).toBeGreaterThan(3300)
    expect(maxKm).toBeLessThan(4100)
  })

  it('elevationForHop inverts hopDistance', () => {
    for (const e of [3, 12, 30, 60]) {
      const g = hopDistanceNm(e * DEG, hF)
      expect(elevationForHopRad(g, hF)! / DEG).toBeCloseTo(e, 9)
    }
    expect(elevationForHopRad(5000, hF)).toBeNull()
  })

  it('slant length to a layer: h straight up, √((R+h)² − R²) along the horizon', () => {
    expect(slantToHeightNm(Math.PI / 2, hF)).toBeCloseTo(hF, 9)
    expect(slantToHeightNm(0, hF)).toBeCloseTo(Math.sqrt((R + hF) ** 2 - R * R), 6)
  })

  it('elevationToReach solves the altitude-crossing geometry', () => {
    const a = kmToNm(10.7)
    for (const [d, n] of [
      [600, 1],
      [1500, 2],
    ] as const) {
      const bDown = elevationToReachRad(d, a, hF, n, 'down')!
      expect(R * (2 * n * centralAngleRad(bDown, hF) - centralAngleRad(bDown, a))).toBeCloseTo(d, 6)
      const bUp = elevationToReachRad(d, a, hF, n, 'up')!
      expect(R * (2 * n * centralAngleRad(bUp, hF) + centralAngleRad(bUp, a))).toBeCloseTo(d, 6)
    }
    // At sea level it is the plain hop inversion.
    expect(elevationToReachRad(800, 0, hF, 1, 'down')).toBeCloseTo(elevationForHopRad(800, hF)!, 12)
  })
})

describe('ionosphere by day and night', () => {
  it('the Sun is up from 06:00 to 18:00', () => {
    expect(solarCosZenith(12)).toBeCloseTo(1)
    expect(isDaytime(9)).toBe(true)
    expect(isDaytime(21)).toBe(false)
  })

  it('F2 ionisation lags the Sun: peak in the afternoon, minimum before dawn', () => {
    const vals = Array.from({ length: 48 }, (_, k) => [k / 2, f2Ionisation(k / 2)] as const)
    const peak = vals.reduce((m, v) => (v[1] > m[1] ? v : m))
    const low = vals.reduce((m, v) => (v[1] < m[1] ? v : m))
    expect(peak[0]).toBeGreaterThan(12)
    expect(peak[0]).toBeLessThan(17)
    expect(low[0]).toBeGreaterThanOrEqual(4)
    expect(low[0]).toBeLessThanOrEqual(7)
    expect(f2Ionisation(20)).toBeGreaterThan(f2Ionisation(2))
  })

  it('foF2 ≈ 6–12 MHz by day and ≈ 3–5 MHz at night; F1 only by day', () => {
    const day = ionosphereAt(13)
    const night = ionosphereAt(2)
    expect(topLayer(day).foMHz).toBeGreaterThan(6)
    expect(topLayer(day).foMHz).toBeLessThan(12)
    expect(topLayer(night).foMHz).toBeGreaterThan(3)
    expect(topLayer(night).foMHz).toBeLessThan(5)
    expect(day.layers.map((l) => l.id)).toEqual(['E', 'F1', 'F2'])
    expect(night.layers.map((l) => l.id)).toEqual(['E', 'F'])
    expect(Math.abs(topLayer(night).heightKm - 300)).toBeLessThan(5)
    // Layers are listed from the bottom up, with rising critical frequencies.
    for (const io of [day, night]) for (let i = 1; i < io.layers.length; i++) expect(io.layers[i].heightKm).toBeGreaterThan(io.layers[i - 1].heightKm)
  })

  it('the E layer is weak at night', () => {
    expect(foEMHz(1)).toBeGreaterThan(3)
    expect(foEMHz(-0.5)).toBeLessThan(1)
  })

  it('D-layer absorption: daytime only, ∝ 1/f², larger on oblique paths, much larger in a flare', () => {
    const day = ionosphereAt(12)
    const night = ionosphereAt(0)
    const b = 10 * DEG
    expect(dPassAbsorptionDb(day, 5, b) / dPassAbsorptionDb(day, 10, b)).toBeCloseTo(4, 9)
    expect(dPassAbsorptionDb(day, 10, 5 * DEG)).toBeGreaterThan(dPassAbsorptionDb(day, 10, 60 * DEG))
    expect(dPassAbsorptionDb(night, 5, b)).toBeLessThan(dPassAbsorptionDb(day, 5, b) / 10)
    const flare = ionosphereAt(12, { flare: true })
    expect(flare.dAbsorptionDb).toBeGreaterThan(10 * day.dAbsorptionDb)
    // A flare only affects the sunlit side.
    expect(ionosphereAt(0, { flare: true }).dAbsorptionDb).toBe(night.dAbsorptionDb)
    expect(D_LAYER_KM.bottom).toBe(60)
    expect(D_LAYER_KM.top).toBe(90)
  })
})

describe('ray paths', () => {
  it('a frequency above the MUF escapes, below it is reflected and lands at 2Rφ', () => {
    const io = ionosphereAt(2)
    const F = topLayer(io)
    const e = 10
    const muf = mufAtIncidenceMHz(F.foMHz, incidenceRad(e * DEG, kmToNm(F.heightKm)))
    const up = traceRay(io, muf * 1.02, e, 3000)
    expect(up.fate).toBe('escaped')
    const down = traceRay(io, muf * 0.98, e, 3000)
    expect(down.fate).toBe('reflected')
    expect(down.layer).toBe('F')
    expect(down.landings[0].dNm).toBeCloseTo(hopDistanceNm(e * DEG, kmToNm(F.heightKm)), 9)
    // Multi-hop: each hop the same length.
    expect(down.landings[1].dNm).toBeCloseTo(2 * down.landings[0].dNm, 9)
  })

  it('segments are straight lines that kink only at the layer and the ground', () => {
    const io = ionosphereAt(2)
    const r = traceRay(io, 7, 20, 1500)
    for (const s of r.segments) {
      const top = Math.max(s.from.hNm, s.to.hNm)
      expect(top === 0 || Math.abs(top - kmToNm(topLayer(io).heightKm)) < 1e-9).toBe(true)
      expect(Math.min(s.from.hNm, s.to.hNm)).toBe(0)
    }
  })

  it('by day a low frequency is absorbed; at night the same frequency comes back', () => {
    const day = traceRay(ionosphereAt(12), 2.899, 10, 3000)
    expect(day.fate).toBe('absorbed')
    expect(day.absorbedAt!.hNm).toBeCloseTo(kmToNm(D_LAYER_KM.absorb), 9)
    const night = traceRay(ionosphereAt(0), 2.899, 10, 3000)
    expect(night.fate).toBe('reflected')
  })

  it('an absorbed ray has lost at least ABSORBED_DB; a landing one less', () => {
    const io = ionosphereAt(12)
    for (const e of fanElevationsDeg()) {
      const r = traceRay(io, 8.864, e, 2700)
      for (const L of r.landings) expect(L.absorptionDb).toBeLessThan(ABSORBED_DB)
    }
  })

  it('a daytime frequency at night passes into space', () => {
    const night = ionosphereAt(23)
    const rays = fanElevationsDeg().map((e) => traceRay(night, 17.946, e, 2700))
    expect(rays.every((r) => r.fate === 'escaped')).toBe(true)
    const day = ionosphereAt(13)
    expect(fanElevationsDeg().map((e) => traceRay(day, 17.946, e, 2700)).some((r) => r.fate === 'reflected')).toBe(true)
  })

  it('draws a straight ray as a straight line in the side view', () => {
    const b = 12 * DEG
    const pts = [0, 20, 60, 120, 162].map((h) => hfSidePoint(R * centralAngleRad(b, h), h, 900))
    const [p0, p1] = [pts[0], pts[pts.length - 1]]
    for (const p of pts) {
      const cross = (p1.x - p0.x) * (p.y - p0.y) - (p1.y - p0.y) * (p.x - p0.x)
      expect(Math.abs(cross) / Math.hypot(p1.x - p0.x, p1.y - p0.y)).toBeLessThan(1e-6)
    }
    // The surface is a circle: the centre of the view is its top.
    expect(hfSidePoint(900, 0, 900)).toEqual({ x: 0, y: 0 })
    expect(hfSidePoint(0, 0, 900).y).toBeLessThan(0)
  })
})

describe('skip zone, MUF and reception', () => {
  it('above foF2 there is a skip zone from the ground wave to the first landing', () => {
    const io = ionosphereAt(2)
    const f = 8.864
    const z = skipZoneNm(io, f)!
    expect(z.fromNm).toBeCloseTo(groundWaveRangeNm(f), 9)
    // First landing = hop of the steepest reflected ray: fo·sec i = f.
    const F = topLayer(io)
    const hL = kmToNm(F.heightKm)
    const iEdge = Math.acos(F.foMHz / f)
    const bEdge = Math.acos((Math.sin(iEdge) * (R + hL)) / R)
    expect(z.toNm).toBeCloseTo(hopDistanceNm(bEdge, hL), 3)
    // Nothing heard inside it, a sky wave just beyond it.
    expect(receptionAt(io, f, (z.fromNm + z.toNm) / 2, 0).reason).toBe('skip')
    expect(receptionAt(io, f, z.toNm + 5, 0).mode).toBe('sky')
    // No ray of a fine fan lands inside the skip zone.
    for (const e of fanElevationsDeg(0.5)) {
      const r = traceRay(io, f, e, 2700)
      if (r.landings.length) expect(r.landings[0].dNm).toBeGreaterThanOrEqual(z.toNm - 1e-6)
    }
  })

  it('below foF2 there is no skip zone', () => {
    const io = ionosphereAt(2)
    expect(firstLandingNm(io, 2.899)).toBe(0)
    expect(skipZoneNm(io, 2.899)).toBeNull()
  })

  it('ground coverage agrees with the ray paths', () => {
    const io = ionosphereAt(2)
    const f = 8.864
    const cov = groundCoverage(io, f, 2700, 10)
    expect(cov[0].kind).toBe('ground')
    expect(cov[1].kind).toBe('skip')
    expect(Math.abs(cov[1].toNm - firstLandingNm(io, f))).toBeLessThanOrEqual(10)
    // Every landing of every drawn ray is somewhere a sky wave is heard.
    for (const h of [2, 9, 13, 21]) {
      const I = ionosphereAt(h)
      for (const fr of HF_CHANNELS_MHZ) {
        for (const e of fanElevationsDeg(2)) {
          for (const L of traceRay(I, fr, e, 2700).landings) {
            const m = receptionAt(I, fr, L.dNm, 0).mode
            expect(m === 'sky' || m === 'ground').toBe(true)
          }
        }
      }
    }
  })

  it('the MUF is fc·sec i for the path, and a frequency just above it does not get through', () => {
    const io = ionosphereAt(2)
    const d = 1350
    const m = pathMuf(io, d)!
    expect(m.layer).toBe('F')
    expect(m.hops).toBe(1)
    const F = topLayer(io)
    const b = elevationForHopRad(d, kmToNm(F.heightKm))!
    expect(m.mufMHz).toBeCloseTo(F.foMHz / Math.cos(incidenceRad(b, kmToNm(F.heightKm))), 9)
    expect(receptionAt(io, m.mufMHz * 0.98, d, 0).mode).toBe('sky')
    expect(receptionAt(io, m.mufMHz * 1.05, d, 0).mode).toBeNull()
    expect(owfMHz(10)).toBeCloseTo(8.5)
  })

  it('the suggested frequency is higher by day and lower at night', () => {
    const d = 1350
    const day = suggestChannel(ionosphereAt(13), d, 35000)!
    const night = suggestChannel(ionosphereAt(2), d, 35000)!
    expect(day.mHz).toBeGreaterThan(night.mHz)
    const mDay = pathMuf(ionosphereAt(13), d, 35000)!
    expect(day.mHz).toBeLessThanOrEqual(owfMHz(mDay.mufMHz))
    expect(hfQuality(receptionAt(ionosphereAt(2), night.mHz, d, 35000))).not.toBe('none')
  })

  it('a solar flare blacks out HF on the day side only', () => {
    const d = 1350
    for (const f of HF_CHANNELS_MHZ) expect(receptionAt(ionosphereAt(12, { flare: true }), f, d, 35000).mode).toBeNull()
    expect(receptionAt(ionosphereAt(12, { flare: true }), 13.306, d, 35000).reason).toBe('absorbed')
    expect(suggestChannel(ionosphereAt(12, { flare: true }), d, 35000)).toBeNull()
    expect(receptionAt(ionosphereAt(2, { flare: true }), 8.864, d, 35000).mode).toBe('sky')
  })

  it('a high aircraft near the station hears the direct wave, like VHF', () => {
    const io = ionosphereAt(2)
    const los = radioLineOfSightNm(100, 35000)
    expect(receptionAt(io, 8.864, los - 1, 35000).mode).toBe('direct')
    expect(receptionAt(io, 8.864, los + 5, 35000).mode).toBeNull()
  })

  it('reports why nothing arrives', () => {
    expect(receptionAt(ionosphereAt(12), 2.899, 1350, 35000).reason).toBe('absorbed')
    expect(receptionAt(ionosphereAt(23), 21.964, 1350, 35000).reason).toBe('escapes')
    expect(receptionAt(ionosphereAt(2), 8.864, 400, 35000).reason).toBe('skip')
  })
})

describe('noise, ground wave and levels', () => {
  it('background noise and thunderstorm static are both stronger at lower frequencies', () => {
    expect(hfNoiseDbm(3)).toBeGreaterThan(hfNoiseDbm(10))
    const extra = (f: number) => hfNoiseDbm(f, { storm: true }) - hfNoiseDbm(f)
    expect(extra(3)).toBeGreaterThan(extra(10))
    expect(extra(10)).toBeGreaterThan(extra(20))
    expect(extra(20)).toBeGreaterThan(0)
  })

  it('the ground wave reaches tens to a few hundred km, less at higher frequency', () => {
    const km = (f: number) => (groundWaveRangeNm(f) * 1852) / 1000
    expect(km(3)).toBeCloseTo(250, 6)
    expect(km(20)).toBeLessThan(km(5))
    expect(km(22)).toBeGreaterThan(30)
  })

  it('the level follows free-space loss plus the extra losses', () => {
    expect(hfLevelDbm(1000, 10, 5)).toBeCloseTo(60 - 5 - freeSpacePathLossDbNm(1000, 10) - 5, 9)
  })

  it('fading stays within about ±6.5 dB', () => {
    for (let t = 0; t < 60; t += 0.37) expect(Math.abs(skyFadingDb(t, 3))).toBeLessThan(6.5)
  })

  it('the fan of rays starts at the lowest useful elevation', () => {
    const fan = fanElevationsDeg()
    expect(fan[0]).toBe(MIN_ELEVATION_DEG)
    expect(fan[fan.length - 1]).toBeLessThan(90)
    expect(reflectingLayer(ionosphereAt(2), 30, 45 * DEG)).toBeNull()
  })
})
