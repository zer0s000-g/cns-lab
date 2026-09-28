import { describe, expect, it } from 'vitest'
import {
  earthDropFt,
  freeSpacePathLossDbNm,
  lineOfSight,
  minHeightForLineOfSightFt,
  radioHorizonNm,
  radioLineOfSightNm,
  rayHeightFt,
} from '@/core/propagation'
import {
  ADJACENT_REJECTION_DB,
  AIRCRAFT_RADIO,
  AUDIBLE_SNR_DB,
  BLOCKS_25KHZ,
  GROUND_RADIO,
  NOISE_PEAK_DB,
  RECEIVER_NOISE_DBM,
  SPACING_KHZ,
  UHF_GUARD_MHZ,
  UHF_MIL_BAND,
  VHF_COM_BAND,
  VHF_GUARD_MHZ,
  adjacentLeakDbm,
  channelCount,
  channelFrequencyMHz,
  channelName,
  firstObstructionNm,
  flatSea,
  hissFraction,
  isInVhfComBand,
  linkLevelDbm,
  minAltitudeForContactFt,
  nearestChannelIndex,
  overlapS,
  pathLink,
  readability,
  receiverOutput,
  sideViewPoint,
  squelchOpenedByNoise,
  wattsToDbm,
} from '@/core/vhf'

describe('VHF band and channels', () => {
  it('uses the ICAO aeronautical voice band and guard frequencies', () => {
    expect(VHF_COM_BAND).toEqual({ minMHz: 118, maxMHz: 136.975 })
    expect(UHF_MIL_BAND).toEqual({ minMHz: 225, maxMHz: 400 })
    expect(VHF_GUARD_MHZ).toBe(121.5)
    expect(UHF_GUARD_MHZ).toBe(243)
    expect(isInVhfComBand(VHF_GUARD_MHZ)).toBe(true)
    expect(isInVhfComBand(117.95)).toBe(false)
    expect(isInVhfComBand(137)).toBe(false)
  })

  it('has 760 channels at 25 kHz and three times as many at 8.33 kHz', () => {
    expect(BLOCKS_25KHZ).toBe(760)
    expect(channelCount('25')).toBe(760)
    expect(channelCount('8.33')).toBe(2280)
    expect(SPACING_KHZ['8.33'] * 3).toBeCloseTo(25, 12)
  })

  it('maps channel indices to frequencies and back', () => {
    expect(channelFrequencyMHz(0, '25')).toBeCloseTo(118, 9)
    expect(channelFrequencyMHz(759, '25')).toBeCloseTo(136.975, 9)
    expect(channelFrequencyMHz(1, '8.33')).toBeCloseTo(118 + 0.025 / 3, 9)
    expect(channelFrequencyMHz(3, '8.33')).toBeCloseTo(118.025, 9)
    const guard = nearestChannelIndex(121.5, '25')
    expect(channelFrequencyMHz(guard, '25')).toBeCloseTo(121.5, 9)
    for (const i of [0, 1, 2, 500, 2279]) expect(nearestChannelIndex(channelFrequencyMHz(i, '8.33'), '8.33')).toBe(i)
    expect(nearestChannelIndex(50, '25')).toBe(0)
    expect(nearestChannelIndex(999, '25')).toBe(759)
  })

  it('names 8.33 kHz channels .005/.010/.015 above each 25 kHz block', () => {
    expect(channelName(0, '25')).toBe('118.000')
    expect(channelName(0, '8.33')).toBe('118.005')
    expect(channelName(1, '8.33')).toBe('118.010')
    expect(channelName(2, '8.33')).toBe('118.015')
    expect(channelName(3, '8.33')).toBe('118.030')
    const i = nearestChannelIndex(128.6, '8.33')
    expect(channelName(i, '8.33')).toBe('128.605')
  })
})

describe('link budget', () => {
  it('converts watts to dBm', () => {
    expect(wattsToDbm(1)).toBeCloseTo(30)
    expect(wattsToDbm(25)).toBeCloseTo(43.98, 2)
  })

  it('loses 6 dB per doubling of distance (free space)', () => {
    const a = linkLevelDbm(GROUND_RADIO, AIRCRAFT_RADIO, 50, 128.6)
    const b = linkLevelDbm(GROUND_RADIO, AIRCRAFT_RADIO, 100, 128.6)
    expect(a - b).toBeCloseTo(6.02, 1)
    const expected = wattsToDbm(25) + 2 - 3 + 0 - 3 - freeSpacePathLossDbNm(100, 128.6)
    expect(b).toBeCloseTo(expected, 9)
  })

  it('a clear path gives a level, a blocked one gives nothing', () => {
    const ok = pathLink(0, 100, 150, 20000, flatSea, 128.6, GROUND_RADIO, AIRCRAFT_RADIO)
    expect(ok.los.visible).toBe(true)
    expect(ok.levelDbm).toBeGreaterThan(-100)
    const low = pathLink(0, 100, 150, 5000, flatSea, 128.6, GROUND_RADIO, AIRCRAFT_RADIO)
    expect(low.los.visible).toBe(false)
    expect(low.levelDbm).toBe(-Infinity)
  })
})

describe('where contact is lost', () => {
  it('equals minHeightForLineOfSightFt over a smooth Earth, and lineOfSight agrees', () => {
    for (const d of [30, 80, 150, 220]) {
      const hMin = minAltitudeForContactFt(100, d)
      expect(hMin).toBe(minHeightForLineOfSightFt(100, d))
      expect(radioLineOfSightNm(100, hMin)).toBeCloseTo(d, 9)
      const above = lineOfSight({ x: 0, y: 0 }, 100, { x: d, y: 0 }, hMin + 1, () => 0, 0.25)
      const below = lineOfSight({ x: 0, y: 0 }, 100, { x: d, y: 0 }, hMin - 1, () => 0, 0.25)
      expect(above.visible).toBe(true)
      expect(below.visible).toBe(false)
    }
  })

  it('a mountain in between raises the floor, and lineOfSight agrees', () => {
    const mountain = (s: number) => 7000 * Math.exp(-((s - 55) ** 2) / (2 * 5 * 5))
    const d = 120
    const flat = minAltitudeForContactFt(100, d)
    const hMin = minAltitudeForContactFt(100, d, mountain)
    expect(hMin).toBeGreaterThan(flat + 5000)
    const p = (x: { x: number }) => mountain(x.x)
    expect(lineOfSight({ x: 0, y: 0 }, 100, { x: d, y: 0 }, hMin + 1, p, 0.25).visible).toBe(true)
    expect(lineOfSight({ x: 0, y: 0 }, 100, { x: d, y: 0 }, hMin - 1, p, 0.25).visible).toBe(false)
  })
})

describe('first obstruction', () => {
  it('is null on a clear path and where the ray first meets the ground otherwise', () => {
    const d = 150
    const hMin = minHeightForLineOfSightFt(100, d)
    expect(firstObstructionNm(100, d, hMin + 10)).toBeNull()
    const s = firstObstructionNm(100, d, hMin - 2000)!
    expect(s).toBeGreaterThan(0)
    expect(s).toBeLessThan(d)
    // Just before it the ray is still above the ground; at it, touching or below.
    expect(rayHeightFt(s - 0.25, d, 100, hMin - 2000)).toBeGreaterThan(0)
    expect(rayHeightFt(s, d, 100, hMin - 2000)).toBeLessThanOrEqual(0)
    const mountain = (x: number) => (Math.abs(x - 40) < 2 ? 9000 : 0)
    expect(firstObstructionNm(100, d, 30000, mountain)).toBeGreaterThan(37.9)
    expect(firstObstructionNm(100, d, 30000, mountain)).toBeLessThan(42)
  })
})

describe('side view on the effective Earth', () => {
  const collinear = (pts: { x: number; y: number }[]) => {
    const [a, b] = [pts[0], pts[pts.length - 1]]
    // Largest distance (ft) of any point from the chord, measured vertically.
    return Math.max(...pts.map((p) => Math.abs(a.y + ((b.y - a.y) * (p.x - a.x)) / (b.x - a.x) - p.y)))
  }

  it('draws the straight radio ray as a straight line', () => {
    for (const center of [0, 60, 125]) {
      const pts = Array.from({ length: 21 }, (_, i) => {
        const s = (180 * i) / 20
        return sideViewPoint(s, rayHeightFt(s, 180, 100, 25000), center)
      })
      expect(collinear(pts)).toBeLessThan(1e-6)
    }
  })

  it('the tangent from the antenna touches the surface exactly at the radio horizon', () => {
    const hTx = 100
    const center = 125
    const horizon = radioHorizonNm(hTx)
    const a = sideViewPoint(0, hTx, center)
    const t = sideViewPoint(horizon, 0, center)
    const slope = (t.y - a.y) / (t.x - a.x)
    // Surface slope at the touching point equals the tangent line's slope.
    const e = 1e-4
    const surfSlope = (sideViewPoint(horizon + e, 0, center).y - sideViewPoint(horizon - e, 0, center).y) / (2 * e)
    expect(slope).toBeCloseTo(surfSlope, 6)
    // Everywhere else the surface is below the tangent line.
    for (const s of [horizon * 0.5, horizon * 1.5, horizon * 3]) {
      expect(sideViewPoint(s, 0, center).y).toBeLessThan(a.y + slope * s + 1e-9)
    }
    // And the tangent line's height above the Earth beyond the horizon is the minimum contact height.
    for (const d of [60, 150]) {
      const heightAbove = a.y + slope * d - sideViewPoint(d, 0, center).y
      expect(heightAbove).toBeCloseTo(minHeightForLineOfSightFt(hTx, d), 6)
    }
  })

  it('drops the surface by earthDropFt away from the tangent point', () => {
    expect(sideViewPoint(125, 0, 125).y).toBe(0)
    expect(sideViewPoint(25, 0, 125).y).toBeCloseTo(-earthDropFt(100), 9)
  })
})

describe('receiver', () => {
  const far = { id: 'far', levelDbm: -85 }
  const near = { id: 'near', levelDbm: -65 }

  it('squelch too low opens on noise alone: constant hiss', () => {
    expect(squelchOpenedByNoise(RECEIVER_NOISE_DBM + NOISE_PEAK_DB)).toBe(true)
    expect(squelchOpenedByNoise(-105)).toBe(false)
    expect(receiverOutput([], -125).state).toBe('hiss')
    expect(receiverOutput([], -105).state).toBe('muted')
  })

  it('squelch too high cuts out a weak station but keeps a strong one', () => {
    expect(receiverOutput([far], -80).state).toBe('muted')
    expect(receiverOutput([near], -80).state).toBe('clear')
    expect(receiverOutput([far], -105).state).toBe('clear')
  })

  it('two audible carriers at once block each other', () => {
    const r = receiverOutput([far, near], -105)
    expect(r.state).toBe('blocked')
    expect(r.heard.map((c) => c.id)).toEqual(['near', 'far'])
    // A carrier buried in the noise does not beat audibly.
    expect(receiverOutput([near, { id: 'x', levelDbm: RECEIVER_NOISE_DBM + AUDIBLE_SNR_DB - 1 }], -105).state).toBe('clear')
  })

  it('weak signals are noisy or garbled', () => {
    expect(receiverOutput([{ id: 'a', levelDbm: RECEIVER_NOISE_DBM + 15 }], -125).state).toBe('noisy')
    expect(receiverOutput([{ id: 'a', levelDbm: RECEIVER_NOISE_DBM + 8 }], -125).state).toBe('garbled')
  })

  it('adjacent-channel leakage is worse with 8.33 kHz spacing', () => {
    expect(ADJACENT_REJECTION_DB['8.33']).toBeLessThan(ADJACENT_REJECTION_DB['25'])
    const raw = -42
    const leak25 = adjacentLeakDbm(raw, '25')
    const leak833 = adjacentLeakDbm(raw, '8.33')
    expect(leak833).toBeGreaterThan(leak25)
    // A strong neighbour opens the squelch only with 8.33 kHz spacing.
    expect(receiverOutput([], -105, { interferenceDbm: leak833 }).state).toBe('bleed')
    expect(receiverOutput([], -105, { interferenceDbm: leak25 }).state).toBe('muted')
    // And it spoils a weak wanted station.
    expect(receiverOutput([far], -105, { interferenceDbm: leak833 }).state).toBe('garbled')
    expect(receiverOutput([far], -105, { interferenceDbm: leak25 }).state).toBe('clear')
  })

  it('hiss fraction falls as the signal gets stronger', () => {
    expect(hissFraction(0)).toBeCloseTo(0.5)
    expect(hissFraction(40)).toBeLessThan(0.011)
    expect(hissFraction(-Infinity)).toBe(1)
    expect(readability(35)).toBe(5)
    expect(readability(5)).toBe(1)
  })

  it('measures overlap between transmissions', () => {
    expect(overlapS({ start: 0, end: 3 }, { start: 2, end: 5 })).toBe(1)
    expect(overlapS({ start: 0, end: 3 }, { start: 3, end: 5 })).toBe(0)
  })
})
