import { describe, expect, it } from 'vitest'
import { HF_CHANNELS_MHZ, SELCAL_TOTAL_S, groundWaveRangeNm, owfMHz } from '@/core/hf'
import { radioLineOfSightNm } from '@/core/propagation'
import { CRUISE_FT, HfEngine, LEARNER_CODE, TIMELAPSE_H_PER_S } from '@/modules/hf/engine'

const ch = (mhz: number) => HF_CHANNELS_MHZ.indexOf(mhz)

function run(e: HfEngine, s: number, dt = 1 / 30) {
  for (let t = 0; t < s; t += dt) e.step(dt)
}

describe('HF engine: frequency and time of day', () => {
  it('a daytime frequency works by day and is lost at night (escapes into space)', () => {
    const e = new HfEngine()
    e.params = { ...e.params, hour: 13, channelIndex: ch(17.946), distanceNm: 1350 }
    expect(e.reception().mode).toBe('sky')
    e.params = { ...e.params, hour: 23 }
    const r = e.reception()
    expect(r.mode).toBeNull()
    expect(r.reason).toBe('escapes')
    expect(e.rays().every((x) => x.fate === 'escaped')).toBe(true)
    expect(e.wrongFrequency()).toBe(true)
  })

  it('by day a low frequency is absorbed by the D layer; at night it works', () => {
    const e = new HfEngine()
    e.params = { ...e.params, hour: 12, channelIndex: ch(2.899), distanceNm: 1350 }
    expect(e.reception().reason).toBe('absorbed')
    expect(e.rays().filter((x) => x.fate === 'absorbed').length).toBeGreaterThan(20)
    e.params = { ...e.params, hour: 1 }
    expect(e.reception().mode).toBe('sky')
  })

  it('suggests about 0.85 × MUF: higher by day, lower at night', () => {
    const e = new HfEngine()
    e.params = { ...e.params, hour: 13 }
    const day = e.suggestion()!
    expect(day.mHz).toBeLessThanOrEqual(owfMHz(e.muf()!.mufMHz))
    e.params = { ...e.params, hour: 2 }
    const night = e.suggestion()!
    expect(night.mHz).toBeLessThan(day.mHz)
    expect(night.mHz).toBeLessThanOrEqual(owfMHz(e.muf()!.mufMHz))
    e.params = { ...e.params, channelIndex: night.index }
    expect(e.reception().snrDb).toBeGreaterThan(10)
  })

  it('the wrong-frequency choice is the top channel at night and the bottom one by day', () => {
    const e = new HfEngine()
    e.params = { ...e.params, hour: 23 }
    e.params = { ...e.params, channelIndex: e.wrongChannelIndex() }
    expect(e.reception().reason).toBe('escapes')
    e.params = { ...e.params, hour: 12 }
    e.params = { ...e.params, channelIndex: e.wrongChannelIndex() }
    expect(e.reception().reason).toBe('absorbed')
  })

  it('time-lapse moves the time of day with the clock', () => {
    const e = new HfEngine()
    e.params = { ...e.params, hour: 10, timelapse: true }
    run(e, 8)
    expect(e.params.hour).toBeCloseTo(10 + 8 * TIMELAPSE_H_PER_S, 1)
  })
})

describe('HF engine: skip zone', () => {
  it('at night on 8.864 MHz an aircraft 400 NM out hears nothing, while one 1,350 NM out hears it clearly', () => {
    const e = new HfEngine()
    e.params = { ...e.params, hour: 2, channelIndex: ch(8.864), distanceNm: 400 }
    const z = e.skipZone()!
    expect(z.fromNm).toBeCloseTo(groundWaveRangeNm(8.864), 9)
    expect(400).toBeGreaterThan(radioLineOfSightNm(100, CRUISE_FT))
    expect(400).toBeLessThan(z.toNm)
    expect(e.reception().reason).toBe('skip')
    expect(e.coverage().some((s) => s.kind === 'skip' && s.fromNm <= 400 && s.toNm >= 400)).toBe(true)
    e.params = { ...e.params, distanceNm: 1350 }
    expect(e.reception().mode).toBe('sky')
    expect(e.reception().snrDb).toBeGreaterThan(20)
  })

  it('close to the station a high aircraft hears the direct wave', () => {
    const e = new HfEngine()
    e.params = { ...e.params, hour: 2, channelIndex: ch(8.864), distanceNm: 150 }
    expect(e.reception().mode).toBe('direct')
  })
})

describe('HF engine: failures', () => {
  it('a solar flare blacks out every channel by day, and nothing at night', () => {
    const e = new HfEngine()
    e.params = { ...e.params, hour: 12 }
    e.failures = { ...e.failures, flare: true }
    for (let i = 0; i < HF_CHANNELS_MHZ.length; i++) expect(e.reception('CNS101', HF_CHANNELS_MHZ[i]).mode).toBeNull()
    expect(e.suggestion()).toBeNull()
    expect(e.wrongFrequency()).toBe(false)
    e.params = { ...e.params, hour: 0 }
    expect(e.suggestion()).not.toBeNull()
  })

  it('thunderstorm static lowers the signal-to-noise ratio, most at low frequencies', () => {
    const e = new HfEngine()
    e.params = { ...e.params, hour: 2, distanceNm: 1350 }
    const drop = (mhz: number) => {
      e.failures = { flare: false, storm: false }
      const a = e.reception('CNS101', mhz).snrDb
      e.failures = { flare: false, storm: true }
      return a - e.reception('CNS101', mhz).snrDb
    }
    expect(drop(3.476)).toBeGreaterThan(drop(8.864))
    expect(drop(8.864)).toBeGreaterThan(drop(13.306))
    expect(drop(13.306)).toBeGreaterThan(0)
  })
})

describe('HF engine: SELCAL', () => {
  it('only the called aircraft chimes, about 2.2 s after the call starts', () => {
    const e = new HfEngine()
    e.params = { ...e.params, hour: 13, channelIndex: ch(17.946), distanceNm: 1350 }
    e.sendSelcal('CNS101')
    expect(e.selcal!.code).toBe(LEARNER_CODE)
    expect(e.selcalPairNow()).toBe(0)
    run(e, SELCAL_TOTAL_S - 0.1)
    expect(e.results.CNS101).toBeUndefined()
    run(e, 0.2)
    expect(e.results.CNS101!.rang).toBe(true)
    expect(e.results.CNS202!.rang).toBe(false)
    expect(e.results.CNS202!.forMe).toBe(false)
  })

  it('no chime when the aircraft is in the skip zone', () => {
    const e = new HfEngine()
    e.params = { ...e.params, hour: 2, channelIndex: ch(8.864), distanceNm: 400 }
    e.sendSelcal('CNS101')
    run(e, SELCAL_TOTAL_S + 0.1)
    expect(e.results.CNS101!.forMe).toBe(true)
    expect(e.results.CNS101!.rang).toBe(false)
    expect(e.results.CNS101!.received).toBe(false)
  })
})
