import { describe, expect, it } from 'vitest'
import {
  createRangeRateFilter,
  deadTimeEfficiency,
  DME_BAND_MHZ,
  DME_CODES,
  DME_SEARCH_RATE_PPS,
  DME_TRACK_RATE_PPS,
  DME_TRANSPONDER,
  DME_TX_RX_SPACING_MHZ,
  dmeChannelForVhf,
  dmeDistanceFromTimingNm,
  dmeFrequencies,
  dmeReplyDelayUs,
  dmeTiming,
  findConsistentDelayUs,
  formatDmeChannel,
  maxAcceptedInterrogationPps,
  minimumDmeReadingNm,
  nextInterrogationIntervalS,
  poissonSample,
  randomReplyDelaysUs,
  replyHistogram,
  slantRangeRateKt,
  stationLoad,
  timeToStationMin,
  updateRangeRateFilter,
  vhfPairedFrequencyMHz,
  type DmeInterrogator,
} from '@/core/dme'
import { roundTripTimeUs, slantRangeNm } from '@/core/propagation'
import { mulberry32 } from '@/core/random'
import { ROUND_TRIP_US_PER_NM } from '@/core/units'

describe('DME channels', () => {
  it('uses X and Y pulse codes from Annex 10', () => {
    expect(DME_CODES.X).toEqual({ interrogationSpacingUs: 12, replySpacingUs: 12, replyDelayUs: 50 })
    expect(DME_CODES.Y).toEqual({ interrogationSpacingUs: 36, replySpacingUs: 30, replyDelayUs: 56 })
    expect(dmeReplyDelayUs('X')).toBe(50)
    expect(dmeReplyDelayUs('Y')).toBe(56)
  })

  it('keeps interrogation and reply 63 MHz apart and inside 962–1213 MHz', () => {
    for (const mode of ['X', 'Y'] as const) {
      for (let ch = 1; ch <= 126; ch++) {
        const f = dmeFrequencies(ch, mode)
        expect(Math.abs(f.replyMHz - f.interrogationMHz)).toBe(DME_TX_RX_SPACING_MHZ)
        expect(f.interrogationMHz).toBeGreaterThanOrEqual(1025)
        expect(f.interrogationMHz).toBeLessThanOrEqual(1150)
        expect(f.replyMHz).toBeGreaterThanOrEqual(DME_BAND_MHZ.min)
        expect(f.replyMHz).toBeLessThanOrEqual(DME_BAND_MHZ.max)
      }
    }
    expect(dmeFrequencies(1, 'X')).toEqual({ interrogationMHz: 1025, replyMHz: 962 })
    expect(dmeFrequencies(126, 'X')).toEqual({ interrogationMHz: 1150, replyMHz: 1213 })
    expect(dmeFrequencies(1, 'Y')).toEqual({ interrogationMHz: 1025, replyMHz: 1088 })
    expect(dmeFrequencies(64, 'Y')).toEqual({ interrogationMHz: 1088, replyMHz: 1025 })
    expect(() => dmeFrequencies(0, 'X')).toThrow()
    expect(() => dmeFrequencies(127, 'Y')).toThrow()
  })

  it('pairs channels with VOR and ILS frequencies both ways', () => {
    expect(vhfPairedFrequencyMHz(17, 'X')).toBe(108.0)
    expect(vhfPairedFrequencyMHz(17, 'Y')).toBe(108.05)
    expect(vhfPairedFrequencyMHz(40, 'X')).toBe(110.3)
    expect(vhfPairedFrequencyMHz(59, 'X')).toBe(112.2)
    expect(vhfPairedFrequencyMHz(70, 'X')).toBe(112.3)
    expect(vhfPairedFrequencyMHz(126, 'Y')).toBe(117.95)
    expect(vhfPairedFrequencyMHz(5, 'X')).toBeNull()
    expect(vhfPairedFrequencyMHz(65, 'Y')).toBeNull()
    expect(dmeChannelForVhf(108.0)).toEqual({ channel: 17, mode: 'X' })
    expect(dmeChannelForVhf(114.3)).toEqual({ channel: 90, mode: 'X' })
    expect(dmeChannelForVhf(117.95)).toEqual({ channel: 126, mode: 'Y' })
    expect(dmeChannelForVhf(118.0)).toBeNull()
    expect(dmeChannelForVhf(108.02)).toBeNull()
    for (const mode of ['X', 'Y'] as const) {
      for (let ch = 1; ch <= 126; ch++) {
        const f = vhfPairedFrequencyMHz(ch, mode)
        if (f !== null) expect(dmeChannelForVhf(f)).toEqual({ channel: ch, mode })
      }
    }
    expect(formatDmeChannel(90, 'X')).toBe('CH 90X')
  })
})

describe('DME timing', () => {
  it('splits a question and answer into trip out, fixed wait and trip back', () => {
    const t = dmeTiming(30, 'X')
    expect(t.delayUs).toBe(50)
    expect(t.outboundUs).toBeCloseTo((30 * ROUND_TRIP_US_PER_NM) / 2, 9)
    expect(t.returnUs).toBeCloseTo(t.outboundUs, 12)
    expect(t.totalUs).toBeCloseTo(t.outboundUs + t.delayUs + t.returnUs, 9)
    expect(t.totalUs).toBeCloseTo(roundTripTimeUs(30) + 50, 9)
    // One NM round trip ≈ 12.36 µs.
    expect(dmeTiming(1, 'X').totalUs - 50).toBeCloseTo(12.36, 2)
  })

  it('recovers the slant range by removing the reply delay (X and Y)', () => {
    for (const mode of ['X', 'Y'] as const) {
      for (const r of [0.5, 1, 12.3, 30, 199]) expect(dmeDistanceFromTimingNm(dmeTiming(r, mode).totalUs, mode)).toBeCloseTo(r, 9)
    }
    // Forgetting that Y has a longer delay would read 6 µs ≈ 0.49 NM too far.
    expect(dmeDistanceFromTimingNm(dmeTiming(10, 'Y').totalUs, 'X') - 10).toBeCloseTo(6 / ROUND_TRIP_US_PER_NM, 6)
    expect(dmeDistanceFromTimingNm(10, 'X')).toBe(0)
  })

  it('never reads less than the height above the station', () => {
    expect(minimumDmeReadingNm(6000)).toBeCloseTo(0.987, 3)
    expect(slantRangeNm(0, 6000)).toBeCloseTo(minimumDmeReadingNm(6000), 9)
    for (const g of [0, 0.3, 1, 5]) expect(slantRangeNm(g, 6000)).toBeGreaterThanOrEqual(minimumDmeReadingNm(6000) - 1e-12)
  })
})

describe('DME groundspeed from range rate', () => {
  it('equals the true speed when flying straight at the station far away', () => {
    let f = createRangeRateFilter()
    const v = 300 / 3600
    for (let t = 0; t <= 20; t += 1 / 30) f = updateRangeRateFilter(f, t, 40 - v * t)
    expect(f.rateKt).toBeCloseTo(-300, 3)
    expect(timeToStationMin(40 - v * 20, f.rateKt)).toBeCloseTo(((40 - v * 20) / 300) * 60, 3)
  })

  it('primes on the first sample and gives the raw rate on the second', () => {
    let f = updateRangeRateFilter(createRangeRateFilter(), 0, 10)
    expect(f.rateKt).toBeNull()
    f = updateRangeRateFilter(f, 1, 10 + 1 / 36)
    expect(f.rateKt).toBeCloseTo(100, 6)
    // A repeated timestamp does not divide by zero.
    expect(updateRangeRateFilter(f, 1, 11).rateKt).toBeCloseTo(100, 6)
  })

  it('ignores a stray measurement that would mean an impossible change of speed', () => {
    let f = createRangeRateFilter()
    for (let t = 0; t <= 5; t += 0.1) f = updateRangeRateFilter(f, t, 40 - (300 / 3600) * t, 2, 400)
    const before = f.rateKt!
    const stray = updateRangeRateFilter(f, 5.2, 40 - (300 / 3600) * 5.2 + 0.2, 2, 400)
    expect(stray).toBe(f)
    expect(updateRangeRateFilter(f, 5.2, 40 - (300 / 3600) * 5.2, 2, 400).rateKt!).toBeCloseTo(before, 0)
  })

  it('is nearly zero when circling the station and shows no time to station when not closing', () => {
    expect(slantRangeRateKt(10, 8000, 250, 90)).toBeCloseTo(0, 9)
    expect(timeToStationMin(10, 0)).toBeNull()
    expect(timeToStationMin(10, 120)).toBeNull()
    expect(timeToStationMin(10, null)).toBeNull()
  })

  it('reads far below the true speed close to the station at height', () => {
    // 0.5 NM from the station at 10,000 ft, flying straight at it at 300 kt.
    const r = slantRangeRateKt(0.5, 10000, 300, 180)
    expect(Math.abs(r)).toBeLessThan(100)
    expect(r).toBeLessThan(0)
  })
})

describe('DME jitter and reply recognition', () => {
  it('spaces interrogations randomly around the mean rate, or evenly without jitter', () => {
    const rand = mulberry32(3)
    const xs = Array.from({ length: 4000 }, () => nextInterrogationIntervalS(30, rand))
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length
    expect(mean).toBeCloseTo(1 / 30, 3)
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0.5 / 30 - 1e-12)
    expect(Math.max(...xs)).toBeLessThanOrEqual(1.5 / 30 + 1e-12)
    expect(new Set(xs.slice(0, 10)).size).toBe(10)
    expect(nextInterrogationIntervalS(30, null)).toBeCloseTo(1 / 30, 12)
    expect(DME_SEARCH_RATE_PPS).toBeGreaterThan(DME_TRACK_RATE_PPS)
  })

  it('samples Poisson counts with the right mean', () => {
    const rand = mulberry32(9)
    for (const lambda of [0.5, 4, 60]) {
      let s = 0
      for (let i = 0; i < 3000; i++) s += poissonSample(rand, lambda)
      expect(s / 3000).toBeCloseTo(lambda, lambda > 10 ? 0 : 1)
    }
    expect(poissonSample(rand, 0)).toBe(0)
  })

  it('spreads other aircraft replies over the listening window', () => {
    const rand = mulberry32(11)
    let n = 0
    for (let i = 0; i < 500; i++) {
      const d = randomReplyDelaysUs(rand, 2700, 1000)
      n += d.length
      for (const x of d) {
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThan(1000)
      }
    }
    expect(n / 500).toBeCloseTo(2.7, 0)
  })

  it('finds its own reply because only it keeps the same delay after jittered questions', () => {
    const rand = mulberry32(5)
    const own = dmeTiming(30, 'X').totalUs
    const rows = Array.from({ length: 40 }, () => [own, ...randomReplyDelaysUs(rand, 2700, 2600)])
    const found = findConsistentDelayUs(rows)
    expect(found).not.toBeNull()
    expect(found!).toBeCloseTo(own, 0)
    const bins = replyHistogram(rows, 4, 2600)
    const ownBin = Math.floor(own / 4)
    const others = bins.filter((_, i) => i !== ownBin)
    expect(bins[ownBin]).toBeGreaterThanOrEqual(40)
    expect(Math.max(...others)).toBeLessThan(8)
  })

  it('locks onto the first line of replies when another aircraft stays in step (no jitter)', () => {
    const rand = mulberry32(6)
    const own = dmeTiming(30, 'X').totalUs
    const twin = 230
    const rows = Array.from({ length: 40 }, () => [own, twin, ...randomReplyDelaysUs(rand, 1500, 2600)])
    expect(findConsistentDelayUs(rows)!).toBeCloseTo(twin, 0)
    // Without its twin the same data gives the true reply.
    expect(findConsistentDelayUs(rows.map((r) => r.filter((d) => d !== twin)))!).toBeCloseTo(own, 0)
    // Noise alone never looks like a reply.
    expect(findConsistentDelayUs(Array.from({ length: 40 }, () => randomReplyDelaysUs(rand, 2700, 2600)))).toBeNull()
    expect(findConsistentDelayUs([])).toBeNull()
  })

  it('ignores replies outside the delays it is looking at', () => {
    const rows = Array.from({ length: 10 }, () => [30, 400])
    expect(findConsistentDelayUs(rows, { minDelayUs: 50 })).toBeCloseTo(400, 6)
    expect(findConsistentDelayUs(rows, { maxDelayUs: 20 })).toBeNull()
  })
})

describe('DME transponder capacity', () => {
  it('fills quiet periods with squitter up to the minimum transmission rate', () => {
    const idle = deadTimeEfficiency(0)
    expect(idle.replyPps).toBe(0)
    expect(idle.squitterPps).toBeCloseTo(DME_TRANSPONDER.minTransmissionPps, 9)
    const busy = deadTimeEfficiency(3000)
    expect(busy.squitterPps).toBe(0)
    expect(busy.efficiency).toBeCloseTo(1 / (1 + 3000 * 60e-6), 9)
    // Continuous where squitter stops being needed.
    const edge = DME_TRANSPONDER.minTransmissionPps / (1 - DME_TRANSPONDER.minTransmissionPps * 60e-6)
    expect(deadTimeEfficiency(edge - 1e-6).efficiency).toBeCloseTo(deadTimeEfficiency(edge + 1e-6).efficiency, 6)
  })

  it('reaches the maximum reply rate exactly at the accepted-rate limit', () => {
    const aMax = maxAcceptedInterrogationPps()
    expect(deadTimeEfficiency(aMax).replyPps).toBeCloseTo(DME_TRANSPONDER.maxReplyPps, 6)
  })

  const traffic = (n: number, extra: DmeInterrogator[] = []): DmeInterrogator[] => [
    ...Array.from({ length: n }, (_, i) => ({ id: `T${i}`, rangeNm: 3 + (87 * (i + 0.5)) / n, ratePps: i % 20 === 0 ? 150 : 25 })),
    ...extra,
  ]

  it('answers about 100 aircraft without overload', () => {
    const load = stationLoad(traffic(100, [{ id: 'OWN', rangeNm: 80, ratePps: 30 }]))
    expect(load.overloaded).toBe(false)
    expect(load.cutoffNm).toBe(Infinity)
    expect(load.answeredCount).toBe(101)
    expect(load.efficiency.get('OWN')!).toBeGreaterThan(0.8)
  })

  it('lowers its sensitivity when overloaded so the farthest aircraft lose their replies first', () => {
    const load = stationLoad(traffic(150, [{ id: 'OWN', rangeNm: 80, ratePps: 30 }, { id: 'NEAR', rangeNm: 5, ratePps: 30 }]))
    expect(load.overloaded).toBe(true)
    expect(load.replyPps).toBeCloseTo(DME_TRANSPONDER.maxReplyPps, 3)
    expect(load.cutoffNm).toBeLessThan(80)
    expect(load.efficiency.get('OWN')).toBe(0)
    expect(load.efficiency.get('NEAR')!).toBeGreaterThan(0.8)
    expect(load.answeredCount).toBeLessThan(152)
    // Efficiency never increases with distance.
    const ids = traffic(150).map((q) => q.id)
    const effs = ids.map((id) => load.efficiency.get(id)!)
    for (let i = 1; i < effs.length; i++) expect(effs[i]).toBeLessThanOrEqual(effs[i - 1] + 1e-12)
  })

  it('does not answer aircraft it cannot hear', () => {
    const load = stationLoad([{ id: 'A', rangeNm: 20, ratePps: 30, heard: false }, { id: 'B', rangeNm: 30, ratePps: 30 }])
    expect(load.efficiency.get('A')).toBe(0)
    expect(load.efficiency.get('B')!).toBeGreaterThan(0.9)
    expect(load.heardCount).toBe(1)
  })
})
