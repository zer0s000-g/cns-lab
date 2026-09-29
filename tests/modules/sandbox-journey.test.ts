import { describe, expect, it } from 'vitest'
import { angleDiff, bearingVector } from '@/core/geometry'
import { mulberry32 } from '@/core/random'
import { ktToMs, METRES_PER_NM } from '@/core/units'
import { LAB_AIRPORT } from '@/core/world'
import * as surfaceEngine from '@/modules/surface/engine'
import { STANDS, STOP_BAR_Y, TWY_A_Y, TURNOFF_X } from '@/modules/surface/layout'
import type { SbAircraft } from '@/pages/Sandbox/aircraft'
import { SandboxEngine } from '@/pages/Sandbox/engine'
import { MAX_BRAKE, ROLLOUT_DECEL, ROTATE_KT, TAKEOFF_ACCEL, TAXI_KT } from '@/pages/Sandbox/ground'
import { FLIGHT_PHASES, TICK_S } from '@/pages/Sandbox/journey'
import { OCEANIC_BOUNDARY_X } from '@/pages/Sandbox/systems'
import {
  createJourneyAircraft,
  EVENT_ORDER,
  flightPhase,
  getJourneyIndex,
  journeyAt,
  journeyEvents,
  lerpPose,
  stepJourneyTick,
  type JourneyEventKind,
} from '@/pages/Sandbox/phases'

const MS_PER_KT = ktToMs(1)
/** Half the length of an A320-class airliner, m (nose ahead of the reference point). */
const HALF_LENGTH_M = 18.8

interface Step {
  prev: SbAircraft
  next: SbAircraft
  events: JourneyEventKind[]
}

/** Every tick of the journey, gate to gate. */
function allTicks(): Step[] {
  const out: Step[] = []
  let a = createJourneyAircraft()
  while (a.journey!.phase !== 'complete') {
    const next = stepJourneyTick(a)
    out.push({ prev: a, next, events: journeyEvents(a, next) })
    a = next
  }
  return out
}

const STEPS = allTicks()
const idx = getJourneyIndex()
const posM = (a: SbAircraft) => ({ x: a.pos.x * METRES_PER_NM, y: a.pos.y * METRES_PER_NM })
const speedMs = (a: SbAircraft) => a.speedKt * MS_PER_KT
const ground = (a: SbAircraft) => a.journey!.ground != null
const firstTick = (kind: JourneyEventKind) => idx.events.find((e) => e.kind === kind)!.tick

describe('ground movement constants', () => {
  it('match the Surface Movement engine', () => {
    expect(TAXI_KT).toBe(surfaceEngine.TAXI_KT)
    expect(TAKEOFF_ACCEL).toBe(surfaceEngine.TAKEOFF_ACCEL)
    expect(ROTATE_KT).toBe(surfaceEngine.ROTATE_KT)
    expect(ROLLOUT_DECEL).toBe(surfaceEngine.ROLLOUT_DECEL)
    expect(MAX_BRAKE).toBe(surfaceEngine.MAX_BRAKE)
  })
})

describe('gate-to-gate journey', () => {
  it('passes through the twelve flight phases in order, each exactly once', () => {
    const seen: string[] = [flightPhase(STEPS[0].prev)]
    for (const s of STEPS) {
      const p = flightPhase(s.next)
      if (p !== seen[seen.length - 1]) seen.push(p)
    }
    expect(seen).toEqual([...FLIGHT_PHASES])
  })

  it('raises every journey event once, in order', () => {
    const kinds = STEPS.flatMap((s) => s.events)
    expect(kinds).toEqual([...EVENT_ORDER])
    expect(idx.events.map((e) => e.kind)).toEqual([...EVENT_ORDER])
  })

  it('moves continuously: no jumps in position, speed, heading or height (including both hand-overs)', () => {
    for (const { prev, next } of STEPS) {
      for (const v of [next.pos.x, next.pos.y, next.altitudeFt, next.headingDeg, next.speedKt]) expect(Number.isFinite(v)).toBe(true)
      const d = Math.hypot(posM(next).x - posM(prev).x, posM(next).y - posM(prev).y)
      const v = Math.max(speedMs(prev), speedMs(next))
      expect(d).toBeLessThanOrEqual(v * TICK_S * 1.05 + 0.5)
      const onGround = ground(prev) || ground(next)
      const dv = Math.abs(next.speedKt - prev.speedKt)
      if (onGround) expect(dv * MS_PER_KT).toBeLessThanOrEqual(MAX_BRAKE * TICK_S + 1e-6)
      else expect(dv).toBeLessThanOrEqual(2 * TICK_S + 1e-6)
      const turn = Math.abs(angleDiff(prev.headingDeg, next.headingDeg))
      expect(turn).toBeLessThanOrEqual((onGround ? 25 : 3) * TICK_S + 1e-6)
      expect(Math.abs(next.altitudeFt - prev.altitudeFt)).toBeLessThanOrEqual((2000 / 60) * TICK_S + 1e-6)
    }
  })

  it('stays on the ground at airport elevation until lift-off, and after touchdown', () => {
    for (const { next } of STEPS) if (ground(next)) expect(next.altitudeFt).toBe(LAB_AIRPORT.elevationFt)
  })

  it('pushes back slowly and taxis within the taxi speed, slowing for bends', () => {
    for (const { next } of STEPS) {
      const p = next.journey!.phase
      if (p === 'pushback') expect(next.speedKt).toBeLessThanOrEqual(3.2)
      if (p === 'taxiOut' || p === 'taxiIn') expect(next.speedKt).toBeLessThanOrEqual(18.5)
      const g = next.journey!.ground
      if (g?.path && (p === 'taxiOut' || p === 'taxiIn')) {
        // Within 5 m of a bend of more than 25°, the aircraft is at bend speed.
        const pts = g.path.points
        for (let i = 1; i < pts.length - 1; i++) {
          const a = Math.atan2(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
          const b = Math.atan2(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y)
          const turn = Math.abs(angleDiff((a * 180) / Math.PI, (b * 180) / Math.PI))
          if (turn > 25 && Math.abs(g.path.cum[i] - g.s) < 5) expect(next.speedKt).toBeLessThanOrEqual(14.5)
        }
      }
    }
  })

  it('stops short of the runway stop bar at holding point A1', () => {
    for (const { next } of STEPS) {
      const p = next.journey!.phase
      if (p !== 'taxiOut' && p !== 'holding') continue
      const nose = bearingVector(next.headingDeg)
      expect(posM(next).y + nose.y * HALF_LENGTH_M).toBeGreaterThan(STOP_BAR_Y)
    }
  })

  it('takes off along the centreline and lifts off near mid-runway at the rotation speed', () => {
    const roll = STEPS.filter((s) => s.next.journey!.phase === 'takeoff')
    expect(roll.length).toBeGreaterThan(300)
    const start = posM(roll[0].next).x
    for (const { next } of roll) {
      expect(Math.abs(posM(next).y)).toBeLessThan(1)
      if (posM(next).x - start > 100) expect(Math.abs(angleDiff(next.headingDeg, 90))).toBeLessThan(1)
    }
    const lift = journeyAt(firstTick('liftoff'))
    expect(posM(lift).x).toBeGreaterThan(-200)
    expect(posM(lift).x).toBeLessThan(400)
    expect(lift.speedKt).toBeCloseTo(ROTATE_KT, 5)
    const later = journeyAt(firstTick('liftoff') + Math.round(60 / TICK_S))
    expect(later.altitudeFt).toBeGreaterThan(1500)
    expect(later.altitudeFt).toBeLessThan(2600)
  })

  it('touches down in the touchdown zone on the centreline, gently', () => {
    const i = STEPS.findIndex((s) => s.events.includes('touchdown'))
    const td = STEPS[i].next
    const x = posM(td).x
    expect(x).toBeGreaterThan(-1350)
    expect(x).toBeLessThan(-900)
    expect(Math.abs(posM(td).y)).toBeLessThan(5)
    expect(Math.abs(STEPS[i].prev.verticalSpeedFpm)).toBeLessThanOrEqual(1000)
  })

  it('brakes to turn-off speed at A3, never goes past it on the runway, and reaches taxiway A', () => {
    let atTurnoff: number | null = null
    let reachedA = false
    for (const { prev, next } of STEPS) {
      const p = next.journey!.phase
      if (p !== 'rollout' && p !== 'taxiIn') continue
      const m = posM(next)
      if (Math.abs(m.y) < 23) expect(m.x).toBeLessThan(150)
      if (atTurnoff === null && posM(prev).x < TURNOFF_X && m.x >= TURNOFF_X) atTurnoff = next.speedKt
      if (m.y >= TWY_A_Y - 1) reachedA = true
    }
    expect(atTurnoff).not.toBeNull()
    expect(atTurnoff!).toBeLessThanOrEqual(20)
    expect(reachedA).toBe(true)
  })

  it('parks on stand S3 facing the terminal', () => {
    const end = STEPS[STEPS.length - 1].next
    const m = end.journey!.ground!.posM
    expect(Math.hypot(m.x - STANDS.S3.x, m.y - STANDS.S3.y)).toBeLessThan(1)
    expect(Math.abs(angleDiff(end.headingDeg, 0))).toBeLessThan(5)
    expect(end.journey!.phase).toBe('complete')
  })

  it('takes a plausible time: 65–170 min off-block to on-block, 5–15 min off-block to lift-off', () => {
    const offBlock = firstTick('pushback') * TICK_S
    const onBlock = firstTick('onBlocks') * TICK_S
    expect((onBlock - offBlock) / 60).toBeGreaterThan(65)
    expect((onBlock - offBlock) / 60).toBeLessThan(170)
    const lift = firstTick('liftoff') * TICK_S
    expect((lift - offBlock) / 60).toBeGreaterThan(5)
    expect((lift - offBlock) / 60).toBeLessThan(15)
  })

  it('crosses into oceanic airspace only beyond the boundary', () => {
    for (const { next } of STEPS) if (flightPhase(next) === 'ocean') expect(next.pos.x).toBeGreaterThan(OCEANIC_BOUNDARY_X - 0.2)
  })
})

describe('journey index', () => {
  it('is quick to build and matches the tick-by-tick flight', () => {
    for (const k of [0, 1, 99, 100, 101, 12345, 50000, idx.totalTicks - 1, idx.totalTicks]) {
      const a = journeyAt(k)
      const b = STEPS[Math.min(STEPS.length - 1, Math.max(0, k - 1))]
      const ref = k === 0 ? STEPS[0].prev : b.next
      expect(a.journey!.tick).toBe(ref.journey!.tick)
      expect(a.pos).toEqual(ref.pos)
      expect(a.altitudeFt).toBe(ref.altitudeFt)
      expect(a.headingDeg).toBe(ref.headingDeg)
    }
  })

  it('records the first tick of every phase', () => {
    for (const p of FLIGHT_PHASES) expect(flightPhase(journeyAt(idx.phaseStartTick[p]))).toBe(p)
  })
})

describe('smooth drawing between ticks', () => {
  it('interpolates position and takes the short way round for headings', () => {
    const a = { ...createJourneyAircraft(), pos: { x: 0, y: 0 }, headingDeg: 359, speedKt: 100, altitudeFt: 1000 }
    const b = { ...a, pos: { x: 1, y: 2 }, headingDeg: 1, speedKt: 110, altitudeFt: 1100 }
    const m = lerpPose(a, b, 0.5)
    expect(m.pos).toEqual({ x: 0.5, y: 1 })
    expect(m.headingDeg).toBeCloseTo(0, 9)
    expect(m.altitudeFt).toBe(1050)
    expect(lerpPose(a, b, 2).pos).toEqual(b.pos)
  })
})

describe('engine: live flight equals the journey index', () => {
  it('whatever the frame times and clock speed', () => {
    for (const speed of [1, 8, 60]) {
      const e = new SandboxEngine()
      const r = mulberry32(speed)
      for (let f = 0; f < 600; f++) e.step((0.004 + r() * 0.096) * speed)
      const live = e.journeyAircraft!
      const ref = journeyAt(live.journey!.tick)
      expect(live.pos.x).toBeCloseTo(ref.pos.x, 9)
      expect(live.pos.y).toBeCloseTo(ref.pos.y, 9)
      expect(live.altitudeFt).toBeCloseTo(ref.altitudeFt, 9)
      // The journey clock keeps pace with the world clock.
      expect(e.timeS - e.journeyStartS - live.journey!.tick * TICK_S).toBeGreaterThanOrEqual(-1e-9)
      expect(e.timeS - e.journeyStartS - live.journey!.tick * TICK_S).toBeLessThan(TICK_S)
    }
  })

  it('draws CNS700 without jumps between frames', () => {
    const e = new SandboxEngine()
    e.jumpToTick(firstTick('takeoffClearance'))
    let last = e.journeyPose()!
    for (let f = 0; f < 900; f++) {
      e.step(1 / 60)
      const p = e.journeyPose()!
      const d = Math.hypot(p.posM.x - last.posM.x, p.posM.y - last.posM.y)
      expect(d).toBeLessThanOrEqual(Math.max(p.speedKt, last.speedKt) * MS_PER_KT * (1 / 60) * 1.5 + 0.05)
      last = p
    }
  })

  it('reset repeats the run exactly', () => {
    const a = new SandboxEngine()
    const b = new SandboxEngine()
    for (let i = 0; i < 200; i++) a.step(0.5)
    a.reset()
    for (let i = 0; i < 200; i++) {
      a.step(0.5)
      b.step(0.5)
    }
    expect([...a.tracks.keys()].sort()).toEqual([...b.tracks.keys()].sort())
    for (const [id, t] of a.tracks) expect(t.ax.p).toBe(b.tracks.get(id)!.ax.p)
  })
})

describe('engine: jumps', () => {
  it('every phase jump lands in that phase', () => {
    const e = new SandboxEngine()
    for (const p of FLIGHT_PHASES) {
      e.jumpToPhase(p)
      expect(e.phase).toBe(p)
      e.step(1)
    }
  })

  it('jumping from the ocean back to the gate leaves nothing of the flight behind, and time keeps going', () => {
    const e = new SandboxEngine()
    e.jumpToTick(idx.samples.find((s) => s.pos.x > 330)!.tick)
    for (let i = 0; i < 90; i++) e.step(1)
    expect(e.tracks.has('CNS700')).toBe(true)
    const t = e.timeS
    const run = e.runId
    e.jumpToPhase('gate')
    expect(e.timeS).toBe(t)
    expect(e.runId).toBeGreaterThan(run)
    expect(e.tracks.has('CNS700')).toBe(false)
    expect(e.adscLog).toEqual([])
    for (let i = 0; i < 30; i++) {
      e.step(1)
      expect(e.timeS).toBeGreaterThan(t)
      expect(e.tracks.has('CNS700')).toBe(false)
      expect(e.alerts.some((al) => al.ids.includes('CNS700'))).toBe(false)
    }
  })

  it('survives random jumps and failures without producing NaN', () => {
    const r = mulberry32(99)
    const e = new SandboxEngine()
    const scenarios = ['normal', 'radarOutage', 'gnssJam', 'vhfFail', 'mountain'] as const
    for (let k = 0; k < 50; k++) {
      e.jumpToTick(Math.floor(r() * idx.totalTicks))
      e.setScenario(scenarios[Math.floor(r() * scenarios.length)])
      if (r() < 0.2) e.spawnConflict()
      for (let i = 0; i < 12; i++) e.step(5)
      for (const a of e.aircraft) for (const v of [a.pos.x, a.pos.y, a.altitudeFt, a.headingDeg, a.speedKt]) expect(Number.isFinite(v)).toBe(true)
      for (const t of e.tracks.values()) expect(Number.isFinite(t.ax.p) && Number.isFinite(t.ay.p)).toBe(true)
      const pose = e.journeyPose()!
      expect(Number.isFinite(pose.posM.x) && Number.isFinite(pose.altitudeFt)).toBe(true)
    }
  })
})

describe('engine: surveillance on the ground', () => {
  it('at the gate the transponder is on standby: CNS700 is not tracked', () => {
    const e = new SandboxEngine()
    for (let i = 0; i < 60; i++) e.step(1)
    expect(e.tracks.has('CNS700')).toBe(false)
  })

  it('taxiing, it is seen by ADS-B and multilateration but never by the approach or en-route radar', () => {
    const e = new SandboxEngine()
    e.jumpToPhase('taxi')
    for (let i = 0; i < 60; i++) {
      e.step(1)
      const src = e.sources('CNS700')
      expect(src).not.toContain('psr')
      expect(src).not.toContain('ssr')
    }
    expect(e.sources('CNS700')).toContain('adsb')
  })

  it('on blocks the track ends quietly (no "track lost" message)', () => {
    const e = new SandboxEngine()
    e.jumpToTick(firstTick('onBlocks') - Math.round(40 / TICK_S))
    for (let i = 0; i < 20; i++) e.step(1)
    expect(e.tracks.has('CNS700')).toBe(true)
    for (let i = 0; i < 120; i++) e.step(1)
    expect(e.tracks.has('CNS700')).toBe(false)
    expect(e.log.some((l) => /lost/.test(l.text) && /CNS700/.test(l.text))).toBe(false)
  })
})

describe('engine: guided stops', () => {
  it('halts exactly at the ocean boundary even with 6-second steps', () => {
    const e = new SandboxEngine()
    e.jumpToTick(firstTick('oceanEntry') - Math.round(60 / TICK_S))
    let halted = null
    for (let i = 0; i < 30 && !halted; i++) halted = e.step(6, (k) => k === 'oceanEntry').halted
    expect(halted).toBe('oceanEntry')
    const x = e.journeyAircraft!.pos.x
    expect(Math.abs(x - OCEANIC_BOUNDARY_X)).toBeLessThanOrEqual(0.07)
    expect(e.phase).toBe('ocean')
    // The world stands at the moment of the event.
    expect(e.timeS - e.journeyStartS).toBeCloseTo(e.journeyTick * TICK_S, 9)
  })

  it('reports the events of each step', () => {
    const e = new SandboxEngine()
    e.jumpToTick(firstTick('liftoff') - 5)
    e.step(1)
    expect(e.lastEvents).toContain('liftoff')
    e.step(1)
    expect(e.lastEvents).not.toContain('liftoff')
  })
})
