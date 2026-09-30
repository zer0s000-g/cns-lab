import { describe, expect, it } from 'vitest'
import { fixed, formatClock, formatDuration, formatHeading, formatLength, NO_VALUE, wholeDegrees } from '@/lib/format'
import { formatMetres } from '@/modules/gnss/format'
import { formatM } from '@/modules/mlat/accuracy'
import { formatLevel } from '@/core/cpdlc'
import { relativeAltitudeTag } from '@/core/ads'
import { slowMotionFor, slowMotionLabel } from '@/core/clock'

describe('shared formatting', () => {
  it('never shows NaN or Infinity', () => {
    for (const v of [NaN, Infinity, -Infinity]) {
      expect(formatLength(v)).toBe(NO_VALUE)
      expect(formatDuration(v)).toBe(NO_VALUE)
      expect(formatClock(v)).toBe(NO_VALUE)
      expect(formatHeading(v)).toBe(NO_VALUE)
    }
    expect(formatLevel(NaN)).toBe('FL—')
    expect(relativeAltitudeTag(10000, NaN)).toBe('—')
  })

  it('lengths move to the next unit once rounding reaches it', () => {
    expect(formatLength(3.14)).toBe('3.1 m')
    expect(formatLength(9.96)).toBe('10 m')
    expect(formatLength(999.4)).toBe('999 m')
    expect(formatLength(999.6)).toBe('1.0 km')
    expect(formatLength(9949)).toBe('9.9 km')
    expect(formatLength(9960)).toBe('10 km')
    expect(formatLength(-0.04)).toBe('0.0 m')
    expect(formatMetres(999.6)).toBe('1.0 km')
    expect(formatM(995)).toBe('1.0 km')
    expect(formatM(994)).toBe('990 m')
    expect(formatM(42.4)).toBe('42 m')
  })

  it('durations and timers round before choosing the unit', () => {
    expect(formatDuration(4.24)).toBe('4.2 s')
    expect(formatDuration(9.96)).toBe('10 s')
    expect(formatDuration(59.6)).toBe('1 min 00 s')
    expect(formatDuration(3599.7)).toBe('1 h 00 min')
    expect(formatDuration(-5)).toBe('0.0 s')
    expect(formatClock(247.9)).toBe('4:07')
    expect(formatClock(-3)).toBe('0:00')
  })

  it('headings are three digits 000–359', () => {
    expect(formatHeading(359.6)).toBe('000')
    expect(formatHeading(-10)).toBe('350')
    expect(formatHeading(90)).toBe('090')
    expect(wholeDegrees(359.6)).toBe(0)
    expect(wholeDegrees(NaN)).toBe(0)
  })

  it('no negative zero, flight levels never below 000', () => {
    expect(fixed(-0.001, 1)).toBe('0.0')
    expect(formatLevel(-5)).toBe('FL000')
    expect(formatLevel(350)).toBe('FL350')
  })

  it('a slow-motion target of 0 s is not "∞"', () => {
    expect(slowMotionLabel(slowMotionFor(10, 0))).not.toMatch(/∞|Infinity|NaN/)
  })
})
