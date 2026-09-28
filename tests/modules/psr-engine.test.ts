import { describe, expect, it } from 'vitest'
import { bearingDeg, distanceNm } from '@/core/geometry'
import { apparentRange, maxUnambiguousRangeNm } from '@/core/radar'
import { slantRangeNm } from '@/core/propagation'
import { PsrEngine } from '@/modules/psr/engine'

function run(e: PsrEngine, seconds: number, dt = 1 / 60) {
  const paints = []
  for (let t = 0; t < seconds; t += dt) {
    e.step(dt)
    paints.push(...e.takePaints())
  }
  return paints
}

describe('PSR engine', () => {
  it('turns the antenna at 360° per rotation period', () => {
    const e = new PsrEngine()
    e.env = { ...e.env, groundClutter: false }
    run(e, e.params.rotationPeriodS / 4)
    expect(e.antennaAz).toBeCloseTo(90, 0)
  })

  it('looks at every aircraft once per turn', () => {
    const e = new PsrEngine()
    e.env = { ...e.env, groundClutter: false }
    run(e, e.params.rotationPeriodS * 3)
    for (const a of e.aircraft) {
      const look = e.lastLook.get(a.id)
      expect(look).toBeDefined()
      // The last look is at most one turn old.
      expect(e.timeS - look!.timeS).toBeLessThanOrEqual(e.params.rotationPeriodS + 1e-6)
    }
  })

  it('paints aircraft where the radar measures them (slant range, true bearing)', () => {
    const e = new PsrEngine()
    e.env = { ...e.env, groundClutter: false }
    e.aircraft = e.aircraft.slice(0, 1).map((a) => ({ ...a, pos: { x: 20, y: 20 }, mode: { kind: 'heading' }, speedKt: 120, targetSpeedKt: 120 }))
    const paints = run(e, e.params.rotationPeriodS + 0.1).filter((p) => p.kind === 'target')
    expect(paints.length).toBeGreaterThanOrEqual(1)
    const a = e.aircraft[0]
    const r = Math.hypot(paints[0].x, paints[0].y)
    const expected = slantRangeNm(distanceNm(e.site.pos, a.pos), a.altitudeFt, e.site.heightFt)
    expect(Math.abs(r - expected)).toBeLessThan(0.5)
    const az = bearingDeg({ x: 0, y: 0 }, paints[0])
    expect(Math.abs(az - bearingDeg(e.site.pos, a.pos))).toBeLessThan(1)
  })

  it('draws a far aircraft at the second-trace range when the PRF is high', () => {
    const e = new PsrEngine()
    e.env = { ...e.env, groundClutter: false }
    e.params = { ...e.params, prfHz: 3000 }
    const heavy = e.aircraft.find((a) => a.category === 'heavy')!
    e.aircraft = [{ ...heavy, pos: { x: 45, y: 0 }, mode: { kind: 'heading' }, headingDeg: 90, targetHeadingDeg: 90 }]
    const paints = run(e, e.params.rotationPeriodS + 0.1).filter((p) => p.kind === 'target')
    expect(paints.length).toBeGreaterThan(0)
    const shown = Math.hypot(paints[0].x, paints[0].y)
    const trueRange = slantRangeNm(45, heavy.altitudeFt, e.site.heightFt)
    expect(trueRange).toBeGreaterThan(maxUnambiguousRangeNm(3000))
    expect(Math.abs(shown - apparentRange(trueRange, 3000).rangeNm)).toBeLessThan(0.6)
  })

  it('MTI removes almost all ground clutter', () => {
    const e1 = new PsrEngine(1)
    const without = run(e1, e1.params.rotationPeriodS).filter((p) => p.kind === 'clutter').length
    const e2 = new PsrEngine(1)
    e2.env = { ...e2.env, mti: true }
    const withMti = run(e2, e2.params.rotationPeriodS).filter((p) => p.kind === 'clutter').length
    expect(without).toBeGreaterThan(200)
    expect(withMti).toBeLessThan(without * 0.05)
  })

  it('paints rain only when the shower is switched on, and MTI weakens it', () => {
    const e = new PsrEngine(2)
    e.env = { ...e.env, groundClutter: false }
    expect(run(e, e.params.rotationPeriodS).some((p) => p.kind === 'weather')).toBe(false)
    e.env = { ...e.env, rain: true }
    const rain = run(e, e.params.rotationPeriodS).filter((p) => p.kind === 'weather')
    expect(rain.length).toBeGreaterThan(50)
    e.env = { ...e.env, mti: true }
    const rainMti = run(e, e.params.rotationPeriodS).filter((p) => p.kind === 'weather')
    const sum = (ps: typeof rain) => ps.reduce((s, p) => s + p.strength, 0)
    expect(sum(rainMti)).toBeLessThan(sum(rain) * 0.6)
    expect(sum(rainMti)).toBeGreaterThan(0)
  })

  it('advanceToAzimuth points the antenna exactly at the target and moves time forward', () => {
    const e = new PsrEngine()
    const t0 = e.timeS
    e.advanceToAzimuth(123.4)
    expect(e.antennaAz).toBeCloseTo(123.4, 6)
    expect(e.timeS - t0).toBeCloseTo((123.4 / 360) * e.params.rotationPeriodS, 3)
  })

  it('lists echoes along the beam with true ranges, nearest first', () => {
    const e = new PsrEngine()
    const a = e.aircraft[0]
    const az = bearingDeg(e.site.pos, a.pos)
    const echoes = e.echoesAlong(az)
    const hit = echoes.find((x) => x.id === a.id)
    expect(hit).toBeDefined()
    expect(hit!.rangeNm).toBeCloseTo(slantRangeNm(distanceNm(e.site.pos, a.pos), a.altitudeFt, e.site.heightFt), 6)
    for (let i = 1; i < echoes.length; i++) expect(echoes[i].rangeNm).toBeGreaterThanOrEqual(echoes[i - 1].rangeNm)
  })
})
