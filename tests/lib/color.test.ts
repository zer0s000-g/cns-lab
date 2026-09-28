import { describe, expect, it } from 'vitest'
import { alphaOf, mix, parseColor, toThreeStyle, withAlpha } from '@/lib/color'

describe('colour token parsing', () => {
  it('parses space-separated hsl() as used in globals.css', () => {
    const c = parseColor('hsl(221 83% 53%)')!
    // #2563EB = rgb(37, 99, 235)
    expect(Math.round(c.r)).toBeCloseTo(37, -1)
    expect(Math.round(c.g)).toBeCloseTo(99, -1)
    expect(Math.round(c.b)).toBeCloseTo(235, -1)
    expect(c.a).toBe(1)
  })
  it('parses hsl with alpha and comma syntax', () => {
    expect(parseColor('hsl(221 83% 53% / 0.12)')!.a).toBeCloseTo(0.12)
    expect(parseColor('hsla(0, 0%, 100%, 0.5)')!.a).toBeCloseTo(0.5)
    expect(parseColor('hsl(0, 0%, 100%)')!.r).toBeCloseTo(255)
  })
  it('parses rgb and hex', () => {
    expect(parseColor('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30, a: 1 })
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 })
    expect(parseColor('#00000080')!.a).toBeCloseTo(0.5, 2)
    expect(parseColor('not a colour')).toBeNull()
  })
  it('withAlpha multiplies existing alpha', () => {
    expect(withAlpha('hsl(0 0% 0% / 0.5)', 0.5)).toBe('rgba(0, 0, 0, 0.250)')
    expect(withAlpha('garbage', 0.5)).toBe('garbage')
  })
  it('mix interpolates between two tokens', () => {
    expect(mix('rgb(0, 0, 0)', 'rgb(200, 100, 50)', 0.5)).toBe('rgba(100, 50, 25, 1.000)')
  })
  it('three.js style uses comma rgb syntax', () => {
    expect(toThreeStyle('hsl(0 0% 100%)')).toBe('rgb(255, 255, 255)')
    expect(alphaOf('hsl(0 0% 100% / 0.3)')).toBeCloseTo(0.3)
  })
})
