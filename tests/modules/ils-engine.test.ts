import { describe, expect, it } from 'vitest'
import { angleDiff, distanceNm } from '@/core/geometry'
import { glideslopeElevationDeg, ILS_CATEGORIES, LOC_SHIFT_ALARM_M } from '@/core/ils'
import { ktToNmPerS } from '@/core/units'
import { FACILITY_MONITOR_DELAY_S, IlsEngine, type IlsEvent } from '@/modules/ils/engine'

function run(e: IlsEngine, seconds: number, dt = 1 / 30, each?: (e: IlsEngine, ev: IlsEvent[]) => void) {
  const n = Math.round(seconds / dt)
  for (let i = 0; i < n; i++) {
    e.step(dt)
    const ev = e.events
    e.events = []
    each?.(e, ev)
  }
}

describe('ILS engine: a normal approach', () => {
  it('flies a stabilised 3° approach from 10 NM and lands on the centreline', () => {
    const e = new IlsEngine()
    expect(e.distanceToThresholdNm).toBeCloseTo(10, 6)
    expect(e.heightAboveRunwayFt).toBeCloseTo(e.onPathHeightFt, 6)
    let maxDev = 0
    let maxLat = 0
    run(e, 340, 1 / 30, (x) => {
      if (x.phase === 'approach' && x.distanceToThresholdNm > 0.3) {
        maxDev = Math.max(maxDev, Math.abs(x.heightAboveRunwayFt - x.onPathHeightFt))
        maxLat = Math.max(maxLat, Math.abs(x.lateralOffsetM))
      }
    })
    expect(maxDev).toBeLessThan(10)
    expect(maxLat).toBeLessThan(1)
    expect(e.touchdown?.onRunway).toBe(true)
    expect(Math.abs(e.touchdown!.lateralM)).toBeLessThan(2)
    expect(e.touchdown!.pastThresholdM).toBeGreaterThan(150)
    expect(e.touchdown!.pastThresholdM).toBeLessThan(900)
    expect(e.touchdown!.vsFpm).toBeGreaterThan(-400)
    // It brakes to a stop on the runway.
    expect(e.phase).toBe('stopped')
    expect(e.aircraft.speedKt).toBe(0)
    expect(-e.distanceToThresholdNm * 1852).toBeLessThan(e.site.runway.lengthFt * 0.3048)
  })

  it('moves physically: turns at most 3°/s and never jumps', () => {
    const e = new IlsEngine()
    e.guidance = false
    e.setTargetHeading(180)
    let prev = { ...e.aircraft }
    run(e, 20, 1 / 30, (x) => {
      const a = x.aircraft
      expect(Math.abs(angleDiff(prev.headingDeg, a.headingDeg))).toBeLessThanOrEqual(3 / 30 + 1e-9)
      expect(distanceNm(prev.pos, a.pos)).toBeLessThanOrEqual(ktToNmPerS(a.speedKt + 1) / 30 + 1e-9)
      prev = { ...a }
    })
    expect(e.aircraft.speedKt).toBeCloseTo(140, 0)
  })

  it('changes vertical speed gradually and limits it', () => {
    const e = new IlsEngine()
    e.guidance = false
    e.setSelectedVs(5000)
    run(e, 1)
    expect(e.pilot.vsFpm).toBeLessThan(0)
    run(e, 10)
    expect(e.pilot.vsFpm).toBeLessThanOrEqual(2000)
    expect(e.pilot.vsFpm).toBeGreaterThan(1500)
  })

  it('passes the outer, middle and inner markers in order, each lit only overhead', () => {
    const e = new IlsEngine()
    const seq: string[] = []
    run(e, 300, 1 / 30, (_x, ev) => ev.forEach((v) => v.kind === 'marker' && seq.push(v.marker ?? '-')))
    expect(seq).toEqual(['outer', '-', 'middle', '-', 'inner', '-'])
  })

  it('sends the localizer ident about every 10 seconds', () => {
    const e = new IlsEngine()
    let n = 0
    run(e, 41, 1 / 10, (_x, ev) => (n += ev.filter((v) => v.kind === 'ident').length))
    expect(n).toBe(4)
  })
})

describe('ILS engine: needles and tones', () => {
  it('left of the centreline: 90 Hz louder, needle right (fly right)', () => {
    const e = new IlsEngine()
    e.resetApproach(8, { lateralNm: -0.3 })
    expect(e.aircraft.pos.y).toBeGreaterThan(0) // left of runway 09 is north
    const loc = e.receiver.loc
    expect(loc.ddm).toBeGreaterThan(0)
    expect(loc.m90).toBeGreaterThan(loc.m150)
    expect(e.lateralNeedle).toBeGreaterThan(0.5)
    e.resetApproach(8, { lateralNm: 0.3 })
    expect(e.receiver.loc.m150).toBeGreaterThan(e.receiver.loc.m90)
    expect(e.lateralNeedle).toBeLessThan(-0.5)
  })

  it('below the path: 150 Hz louder, needle up (fly up); above: 90 Hz louder, needle down', () => {
    const e = new IlsEngine()
    e.resetApproach(6, { heightFt: 1500 })
    expect(e.receiver.gs.m150).toBeGreaterThan(e.receiver.gs.m90)
    expect(e.verticalNeedle).toBeGreaterThan(0.5)
    e.resetApproach(6, { heightFt: 2300 })
    expect(e.receiver.gs.m90).toBeGreaterThan(e.receiver.gs.m150)
    expect(e.verticalNeedle).toBeLessThan(-0.5)
  })

  it('climbing steeply finds a reversed false path near 6° and a normal one near 9°', () => {
    const e = new IlsEngine()
    e.guidance = false
    e.resetApproach(5)
    e.setSelectedVs(1500)
    const crossings: { el: number; from: number; to: number }[] = []
    let last = 0
    run(e, 70, 1 / 30, (x) => {
      const v = x.verticalNeedle
      if (Math.abs(v) > 0.005) {
        if (last !== 0 && Math.sign(v) !== Math.sign(last)) crossings.push({ el: glideslopeElevationDeg(x.site, x.aircraft.pos, x.aircraft.altitudeFt), from: last, to: v })
        last = v
      }
    })
    const six = crossings.find((c) => Math.abs(c.el - 6) < 0.2)
    const nine = crossings.find((c) => Math.abs(c.el - 9) < 0.2)
    expect(six).toBeDefined()
    expect(nine).toBeDefined()
    // Reversed at 6°: going higher makes the needle swing to "fly up".
    expect(six!.from).toBeLessThan(0)
    expect(six!.to).toBeGreaterThan(0)
    // Normal at 9°: going higher makes it swing to "fly down" again.
    expect(nine!.from).toBeGreaterThan(0)
    expect(nine!.to).toBeLessThan(0)
    // The glideslope flag never shows: the false paths look perfectly valid.
    expect(e.receiver.gs.valid).toBe(true)
  })

  it('placeHigh sets up level flight far above the path where the needle centres on false paths', () => {
    const e = new IlsEngine()
    e.guidance = false
    e.placeHigh()
    const el = glideslopeElevationDeg(e.site, e.aircraft.pos, e.aircraft.altitudeFt)
    expect(el).toBeGreaterThan(5)
    expect(el).toBeLessThan(6)
    let centredHigh = 0
    run(e, 70, 1 / 30, (x) => {
      if (Math.abs(x.verticalNeedle) < 0.03 && x.heightAboveRunwayFt - x.onPathHeightFt > 1000) centredHigh++
    })
    expect(centredHigh).toBeGreaterThan(0)
  })
})

describe('ILS engine: failures', () => {
  it('a truck in the critical area makes the needles wobble and the autopilot lands beside the centreline', () => {
    const e = new IlsEngine()
    e.weather = 'clear'
    e.setFailures({ truck: true, locFault: false })
    e.resetApproach(6)
    let lo = 0
    let hi = 0
    run(e, 200, 1 / 30, (x) => {
      if (x.phase === 'approach' && x.distanceToThresholdNm > 1) {
        lo = Math.min(lo, x.lateralNeedle)
        hi = Math.max(hi, x.lateralNeedle)
      }
    })
    expect(hi - lo).toBeGreaterThan(0.3)
    expect(e.touchdown).not.toBeNull()
    expect(Math.abs(e.touchdown!.lateralM)).toBeGreaterThan(22.5)
    expect(e.touchdown!.onRunway).toBe(false)
    // The needles said "on course" all the way down.
    const clean = new IlsEngine()
    clean.weather = 'clear'
    clean.resetApproach(6)
    run(clean, 200)
    expect(clean.touchdown!.onRunway).toBe(true)
  })

  it('a course shift is caught by the monitor, which switches the localizer off and stops the ident', () => {
    const e = new IlsEngine()
    run(e, 5)
    e.setFailures({ truck: false, locFault: true })
    let off = -1
    let identsAfter = 0
    const t0 = e.timeS
    run(e, 30, 1 / 30, (x, ev) => {
      if (off < 0 && !x.receiver.loc.valid) off = x.timeS - t0
      if (off >= 0) identsAfter += ev.filter((v) => v.kind === 'ident').length
    })
    expect(e.fault.alarmS! - t0).toBeGreaterThan(0)
    expect(e.fault.shutdown).toBe(true)
    expect(off).toBeGreaterThan(FACILITY_MONITOR_DELAY_S)
    expect(off).toBeLessThan(6)
    expect(identsAfter).toBe(0)
    expect(e.lateralNeedle).toBe(0)
    expect(LOC_SHIFT_ALARM_M).toBeCloseTo(10.5, 6)
  })

  it('shows the flag outside the coverage area and a good signal once inside it', () => {
    const e = new IlsEngine()
    e.guidance = false
    e.placeOutsideCoverage()
    expect(e.receiver.loc.valid).toBe(false)
    expect(e.receiver.gs.valid).toBe(false)
    let inside = -1
    run(e, 150, 1 / 30, (x) => {
      if (inside < 0 && x.receiver.loc.severity === 0 && x.receiver.loc.valid) inside = x.timeS
    })
    expect(inside).toBeGreaterThan(20)
    expect(inside).toBeLessThan(120)
    expect(e.lateralNeedle).toBeGreaterThan(0.9) // still left of course: fly right
  })

  it('goes around at minimums when nothing is in sight', () => {
    const e = new IlsEngine()
    e.weather = 'I'
    e.thickFog = true
    e.resetApproach(3)
    run(e, 120)
    expect(e.minimums?.continue).toBe(false)
    expect(e.phase).toBe('go-around')
    expect(e.touchdown).toBeNull()
    expect(e.heightAboveRunwayFt).toBeGreaterThan(ILS_CATEGORIES.I.dhFt!)
  })
})

describe('ILS engine: categories and fog', () => {
  function firstSight(weather: 'I' | 'II' | 'IIIA' | 'IIIB') {
    const e = new IlsEngine()
    e.weather = weather
    e.resetApproach(3)
    let lights = -1
    let runway = -1
    run(e, 120, 1 / 30, (x) => {
      if (lights < 0 && x.visual.approachLights) lights = x.heightAboveRunwayFt
      if (runway < 0 && x.visual.runway) runway = x.heightAboveRunwayFt
    })
    return { lights, runway, e }
  }

  it('shows the lights before the decision height in every category, and lands', () => {
    for (const w of ['I', 'II', 'IIIA'] as const) {
      const r = firstSight(w)
      expect(r.lights).toBeGreaterThanOrEqual(ILS_CATEGORIES[w].dhFt!)
      expect(r.e.minimums?.continue).toBe(true)
      expect(r.e.touchdown?.onRunway).toBe(true)
    }
    const b = firstSight('IIIB')
    expect(b.e.minimums).toBeNull()
    expect(b.e.touchdown?.onRunway).toBe(true)
  })

  it('in CAT I fog the lights appear near 300 ft, in CAT IIIB only below 80 ft', () => {
    const one = firstSight('I')
    const three = firstSight('IIIB')
    expect(one.lights).toBeGreaterThan(250)
    expect(one.lights).toBeLessThan(350)
    expect(three.lights).toBeLessThan(80)
    expect(three.lights).toBeGreaterThan(0)
  })
})
