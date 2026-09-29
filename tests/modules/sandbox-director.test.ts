import { describe, expect, it } from 'vitest'
import { distanceNm } from '@/core/geometry'
import { bankDeg, exteriorLights, gearDown, papi, papiAngleDeg, papiReading, stepPitch, targetPitchDeg } from '@/pages/Sandbox/aircraftState'
import {
  autoSpeed,
  clipPlanes,
  floorSpeed,
  followIntent,
  isStopEvent,
  PHASE_SPEED,
  resolveView,
  SANDBOX_SPEEDS,
  STOP_EVENTS,
  STOP_SLOWDOWN_MAX,
  towerFovDeg,
  viewForPhase,
} from '@/pages/Sandbox/director'
import { FLIGHT_PHASES, THRESHOLD, TICK_S, type FlightPhase } from '@/pages/Sandbox/journey'
import { createJourneyAircraft, getJourneyIndex, journeyEvents, flightPhase, stepJourneyTick } from '@/pages/Sandbox/phases'
import { TABLE_RADIUS_NM } from '@/stage/scale'

const idx = getJourneyIndex()

describe('views follow the controller who owns the flight', () => {
  it('airport → terminal area → region map → terminal area → airport', () => {
    const views = FLIGHT_PHASES.map(viewForPhase).filter((v, i, a) => i === 0 || v !== a[i - 1])
    expect(views).toEqual(['airport', 'terminal', 'map', 'terminal', 'airport'])
  })

  it('each view lasts long enough to follow (at least 20 s of flight)', () => {
    let start = 0
    let view = viewForPhase('gate')
    for (const p of FLIGHT_PHASES.slice(1)) {
      const v = viewForPhase(p)
      if (v === view) continue
      const t = idx.phaseStartTick[p]
      expect((t - start) * TICK_S).toBeGreaterThan(20)
      start = t
      view = v
    }
  })

  it('the aircraft is always inside the world being shown', () => {
    for (const s of idx.samples) {
      const v = viewForPhase(s.phase)
      const d = distanceNm(s.pos, { x: 0, y: 0 })
      if (v === 'airport') expect(d * 1852).toBeLessThan(20000)
      if (v === 'terminal') expect(d).toBeLessThan(TABLE_RADIUS_NM)
    }
  })

  it('a manual choice overrides the automatic view', () => {
    expect(resolveView('auto', 'ocean')).toBe('map')
    expect(resolveView('airport', 'ocean')).toBe('airport')
  })
})

describe('automatic time-lapse', () => {
  it('always uses an allowed clock speed', () => {
    for (const p of FLIGHT_PHASES) {
      expect(SANDBOX_SPEEDS).toContain(PHASE_SPEED[p])
      for (const secs of [null, 0, 1, 10, 24, 50, 100, 1000]) expect(SANDBOX_SPEEDS).toContain(autoSpeed(p, secs))
    }
    expect(floorSpeed(0.5)).toBe(1)
    expect(floorSpeed(29.9)).toBe(16)
  })

  it('is slow on the runway and fast over the ocean', () => {
    expect(autoSpeed('takeoff', null)).toBeLessThanOrEqual(2)
    expect(autoSpeed('ocean', null)).toBe(60)
  })

  it('slows to at most ×8 as a guided stop comes up', () => {
    expect(autoSpeed('ocean', 10)).toBeLessThanOrEqual(STOP_SLOWDOWN_MAX)
    expect(autoSpeed('climb', 20)).toBeLessThanOrEqual(STOP_SLOWDOWN_MAX)
    expect(autoSpeed('climb', 1000)).toBe(PHASE_SPEED.climb)
  })

  it('plays the whole journey in 6–12 minutes', () => {
    const stops = idx.events.filter((e) => isStopEvent(e.kind)).map((e) => e.tick)
    let real = 0
    let a = createJourneyAircraft()
    let stopsHit = 0
    while (a.journey!.phase !== 'complete') {
      const next = stepJourneyTick(a)
      const t = a.journey!.tick
      const upcoming = stops.find((s) => s > t)
      const speed = autoSpeed(flightPhase(a), upcoming === undefined ? null : (upcoming - t) * TICK_S)
      if (journeyEvents(a, next).some(isStopEvent)) {
        stopsHit++
        expect(speed).toBeLessThanOrEqual(STOP_SLOWDOWN_MAX)
      }
      real += TICK_S / speed
      a = next
    }
    expect(stopsHit).toBe(STOP_EVENTS.length)
    expect(real / 60).toBeGreaterThan(6)
    expect(real / 60).toBeLessThan(12)
  })
})

describe('camera', () => {
  it('frames every phase with finite, sensible numbers', () => {
    for (const p of FLIGHT_PHASES as readonly FlightPhase[]) {
      for (const view of ['airport', 'terminal'] as const) {
        for (const h of [0, 300, 3000]) {
          const c = followIntent(view, p, h, 1)
          for (const v of [c.dist, c.elevDeg, c.yawDeg, c.fov]) expect(Number.isFinite(v)).toBe(true)
          expect(c.dist).toBeGreaterThan(0)
          expect(c.elevDeg).toBeGreaterThan(0)
          expect(c.elevDeg).toBeLessThan(80)
        }
      }
    }
    expect(followIntent('airport', 'taxi', 0, 2).dist).toBeCloseTo(followIntent('airport', 'taxi', 0, 1).dist / 2)
  })
  it('the tower binoculars keep the aircraft a steady size', () => {
    expect(towerFovDeg(1)).toBe(55)
    expect(towerFovDeg(1e6)).toBe(4)
    expect(towerFovDeg(500)).toBeCloseTo((2 * Math.atan(60 / 500) * 180) / Math.PI, 6)
  })
  it('keeps the near plane in front of the far plane', () => {
    for (const d of [1, 50, 500, 5000, 50000]) for (const v of ['airport', 'terminal', 'map'] as const) {
      const c = clipPlanes(v, d)
      expect(c.near).toBeGreaterThan(0)
      expect(c.near).toBeLessThan(c.far)
      if (v === 'airport') expect(c.far).toBeGreaterThan(d * 2)
    }
  })
})

describe('aircraft state', () => {
  it('PAPI: two white and two red on the 3° path, all white when high, all red when low', () => {
    expect(papi(3)).toEqual([true, true, false, false])
    expect(papi(3.6)).toEqual([true, true, true, true])
    expect(papi(2.4)).toEqual([false, false, false, false])
    expect(papiReading(papi(3))).toBe('On the glide path')
    expect(papiReading(papi(3.3))).toBe('Slightly high')
    expect(papiReading(papi(2.6))).toBe('Slightly low')
  })

  it('CNS700 sees two white and two red all the way down the final approach', () => {
    let a = createJourneyAircraft()
    let checked = 0
    while (a.journey!.phase !== 'rollout') {
      a = stepJourneyTick(a)
      const toGo = THRESHOLD.x - a.pos.x
      if (a.journey!.phase === 'final' && toGo < 8 && toGo > 0.3) {
        const ang = papiAngleDeg({ x: a.pos.x * 1852, y: a.pos.y * 1852 }, a.altitudeFt)
        expect(papi(ang)).toEqual([true, true, false, false])
        checked++
      }
    }
    expect(checked).toBeGreaterThan(1000)
  })

  it('pitch: level on the ground, rotation just before lift-off, climb and approach attitudes', () => {
    expect(targetPitchDeg('taxiOut', 18, 0)).toBe(0)
    expect(targetPitchDeg('takeoff', 100, 0)).toBe(0)
    expect(targetPitchDeg('takeoff', 145, 0)).toBe(10)
    const climb = targetPitchDeg('plan', 150, 2000)
    expect(climb).toBeGreaterThan(8)
    expect(climb).toBeLessThan(13)
    expect(targetPitchDeg('plan', 460, 0)).toBeCloseTo(2.5)
    expect(Math.abs(targetPitchDeg('final', 140, -743))).toBeLessThan(1)
    expect(stepPitch(0, 10, 1)).toBe(3)
    expect(stepPitch(0, 1, 1)).toBe(1)
  })

  it('bank: coordinated turns, capped at 30°, wings level on the ground', () => {
    expect(bankDeg(200, 1, true)).toBeCloseTo(10.4, 0)
    expect(bankDeg(460, 3, true)).toBe(30)
    expect(bankDeg(460, -3, true)).toBe(-30)
    expect(bankDeg(18, 20, false)).toBe(0)
  })

  it('gear up after lift-off, down for the final approach and on the ground', () => {
    expect(gearDown('plan', 60, false)).toBe(true)
    expect(gearDown('plan', 3000, false)).toBe(false)
    expect(gearDown('plan', 60, true)).toBe(false)
    expect(gearDown('final', 3000, true)).toBe(true)
    expect(gearDown('taxiIn', 30, true)).toBe(true)
  })

  it('exterior lights follow the airline procedure', () => {
    expect(exteriorLights('boarding', 30, false)).toMatchObject({ beacon: false, strobe: false })
    expect(exteriorLights('pushback', 30, false)).toMatchObject({ beacon: true, strobe: false, taxi: true })
    expect(exteriorLights('lineup', 30, true)).toMatchObject({ strobe: true })
    expect(exteriorLights('takeoff', 30, true)).toMatchObject({ strobe: true, landing: true })
    expect(exteriorLights('plan', 5000, false)).toMatchObject({ landing: true, strobe: true })
    expect(exteriorLights('plan', 35000, false)).toMatchObject({ landing: false, strobe: true })
    expect(exteriorLights('rollout', 30, false)).toMatchObject({ strobe: false, taxi: true })
  })
})
