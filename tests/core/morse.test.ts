import { describe, expect, it } from 'vitest'
import { markerKeying, MARKER_TONE_HZ, morseTimeline, morseUnitS, toMorse } from '@/core/morse'

describe('morse', () => {
  it('encodes letters', () => {
    expect(toMorse('SOS')).toBe('... --- ...')
    expect(toMorse('cns')).toBe('-.-. -. ...')
  })
  it('uses the PARIS timing standard', () => {
    // "PARIS " is 50 units, so at 10 wpm one unit is 0.12 s.
    expect(morseUnitS(10)).toBeCloseTo(0.12)
    const e = morseTimeline('E', 10)
    expect(e.segments).toHaveLength(1)
    expect(e.totalS).toBeCloseTo(0.12)
  })
  it('spaces letters by 3 units and elements by 1 unit', () => {
    const u = morseUnitS(10)
    const t = morseTimeline('EE', 10)
    expect(t.segments[1].startS).toBeCloseTo(4 * u) // dot(1) + gap(3)
    const a = morseTimeline('A', 10) // .-
    expect(a.segments[1].startS).toBeCloseTo(2 * u)
    expect(a.segments[1].durationS).toBeCloseTo(3 * u)
    expect(a.totalS).toBeCloseTo(5 * u)
  })
  it('PARIS takes 43 units without the trailing word gap', () => {
    const t = morseTimeline('PARIS', 10)
    expect(t.totalS / morseUnitS(10)).toBeCloseTo(43)
  })
})

describe('marker beacons', () => {
  it('uses 400 / 1300 / 3000 Hz tones', () => {
    expect(MARKER_TONE_HZ).toEqual({ outer: 400, middle: 1300, inner: 3000 })
  })
  it('outer keys two dashes per second, inner six dots per second', () => {
    expect(markerKeying('outer').segments).toHaveLength(2)
    expect(markerKeying('outer').periodS).toBe(1)
    expect(markerKeying('inner').segments).toHaveLength(6)
  })
  it('middle alternates a dash and a dot', () => {
    const m = markerKeying('middle')
    expect(m.segments[0].durationS).toBeGreaterThan(m.segments[1].durationS * 3)
  })
})
