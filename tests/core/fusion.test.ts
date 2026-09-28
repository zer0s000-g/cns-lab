import { describe, expect, it } from 'vitest'
import {
  activeSources,
  createTrack,
  predictTrack,
  trackPosition,
  trackSigmaNm,
  trackSpeedKt,
  trackStatus,
  updateTrack,
  type Measurement,
} from '@/core/fusion'
import { gaussian, mulberry32 } from '@/core/random'

const m = (over: Partial<Measurement>): Measurement => ({ source: 'ssr', targetId: 'A', timeS: 0, x: 0, y: 0, sigmaNm: 0.1, ...over })

describe('tracker', () => {
  it('learns the velocity of a straight-flying target from noisy radar plots', () => {
    const rand = mulberry32(5)
    const v = 0.1 // NM/s = 360 kt east
    let t = createTrack(m({ x: 0, y: 0 }))
    for (let k = 1; k <= 20; k++) {
      const time = k * 5
      t = updateTrack(t, m({ timeS: time, x: v * time + gaussian(rand) * 0.1, y: gaussian(rand) * 0.1 }))
    }
    expect(trackSpeedKt(t)).toBeGreaterThan(320)
    expect(trackSpeedKt(t)).toBeLessThan(400)
    expect(Math.abs(trackPosition(t).x - 10)).toBeLessThan(0.2)
  })

  it('trusts precise sources more: ADS-B pulls the track harder than a coarse radar plot', () => {
    const t0 = createTrack(m({ x: 0, y: 0, sigmaNm: 0.5 }))
    const coarse = updateTrack(t0, m({ timeS: 1, x: 1, sigmaNm: 0.5 }))
    const precise = updateTrack(t0, m({ timeS: 1, x: 1, sigmaNm: 0.01, source: 'adsb' }))
    expect(trackPosition(precise).x).toBeGreaterThan(trackPosition(coarse).x)
    expect(trackSigmaNm(precise)).toBeLessThan(trackSigmaNm(coarse))
  })

  it('prediction grows uncertainty and moves along the velocity', () => {
    let t = createTrack(m({ x: 0, y: 0 }))
    for (let k = 1; k <= 10; k++) t = updateTrack(t, m({ timeS: k, x: 0.1 * k, y: 0, sigmaNm: 0.01, source: 'adsb' }))
    const p = predictTrack(t, 20)
    expect(trackPosition(p).x).toBeCloseTo(2, 1)
    expect(trackSigmaNm(p)).toBeGreaterThan(trackSigmaNm(t))
  })

  it('a delayed (older) measurement does not drag the position backwards', () => {
    let t = createTrack(m({ timeS: 0, x: 0 }))
    t = updateTrack(t, m({ timeS: 10, x: 1 }))
    const late = updateTrack(t, m({ timeS: 5, x: -50, source: 'adsc', callsign: 'CNS700' }))
    expect(trackPosition(late).x).toBeCloseTo(trackPosition(t).x, 9)
    expect(late.callsign).toBe('CNS700')
  })

  it('keeps identity and altitude from the sources that provide them', () => {
    let t = createTrack(m({ source: 'psr' }))
    expect(t.callsign).toBeUndefined()
    t = updateTrack(t, m({ timeS: 4, source: 'ssr', code: '4521', altitudeFt: 12000 }))
    t = updateTrack(t, m({ timeS: 5, source: 'psr' }))
    expect(t.code).toBe('4521')
    expect(t.altitudeFt).toBe(12000)
  })

  it('goes live → coast → drop as sources fall silent', () => {
    let t = createTrack(m({ source: 'adsb', timeS: 0 }))
    t = updateTrack(t, m({ source: 'adsb', timeS: 1 }))
    expect(trackStatus(t, 2)).toBe('live')
    expect(activeSources(t, 2)).toEqual(['adsb'])
    expect(trackStatus(t, 30)).toBe('coast')
    expect(trackStatus(t, 200)).toBe('drop')
  })

  it('an ADS-C report keeps an oceanic track live for many minutes', () => {
    const t = createTrack(m({ source: 'adsc', timeS: 0 }))
    expect(trackStatus(t, 10 * 60)).toBe('live')
  })
})
