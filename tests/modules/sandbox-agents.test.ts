import { describe, expect, it } from 'vitest'
import { angleDiff, bearingVector, normalize360 } from '@/core/geometry'
import type { SbAircraft } from '@/pages/Sandbox/aircraft'
import {
  AIRCRAFT,
  BOARDING_DONE_S,
  contextFor,
  createVehicles,
  crowdAt,
  MAX_PEOPLE,
  PASSENGERS,
  STRIDE,
  TOWBAR_M,
  TUG_LENGTH_M,
  tripPose,
  vehiclesAt,
  type VehicleState,
} from '@/pages/Sandbox/agents'
import { BOARDING_S, TICK_S } from '@/pages/Sandbox/journey'
import { createJourneyAircraft, stepJourneyTick } from '@/pages/Sandbox/phases'
import { makePath } from '@/core/surface'

interface Frame {
  a: SbAircraft
  people: Map<number, { x: number; y: number; h: number; role: number }>
  vehicles: VehicleState[]
}

const APRON_KINDS = new Set(['tug', 'stairs', 'bagTractor', 'bagCart', 'fuel'])
const inRunwayArea = (x: number, y: number) => Math.abs(y) < 90 && Math.abs(x) < 1560
const MAX_VEHICLE_MS = (12 * 1852) / 3600

/**
 * One pass over the whole journey (every tick, world time = journey time),
 * collecting every broken rule. Frames are not kept (too many).
 */
function scan() {
  const problems = { runway: [] as string[], walking: [] as string[], vehicles: [] as string[], outline: [] as string[], tug: [] as string[] }
  const boardersSeen = new Set<number>()
  const leaversSeen = new Set<number>()
  let leaverOutsidePhase = 0
  let boarderAtPushback = 0
  let tugChecked = 0
  let marshallerSeen = false
  let controllersAlways = true
  const buf = new Float32Array(MAX_PEOPLE * STRIDE)
  let prev: Frame | null = null
  let a = createJourneyAircraft()
  for (;;) {
    const j = a.journey!
    const tick = j.tick
    const ctx = contextFor(a, tick * TICK_S)
    const n = crowdAt(ctx, buf)
    const people = new Map<number, { x: number; y: number; h: number; role: number }>()
    for (let i = 0; i < n; i++) people.set(buf[i * STRIDE + 6], { x: buf[i * STRIDE], y: buf[i * STRIDE + 1], h: buf[i * STRIDE + 2], role: buf[i * STRIDE + 4] })
    const vehicles = createVehicles()
    vehiclesAt(ctx, vehicles)

    let controllers = 0
    for (const [id, p] of people) {
      if (id >= 1000 && id < 2000) {
        boardersSeen.add(id)
        if (j.phase !== 'boarding') boarderAtPushback++
      }
      if (id >= 2000 && id < 3000) {
        leaversSeen.add(id)
        if (j.phase !== 'deboarding' && j.phase !== 'complete') leaverOutsidePhase++
      }
      if (id >= 8000) controllers++
      if (p.role === 3 && j.phase === 'taxiIn') marshallerSeen = true
      if (inRunwayArea(p.x, p.y)) problems.runway.push(`person ${id} @${tick}`)
    }
    if (controllers !== 3) controllersAlways = false
    for (const v of vehicles) if (v.visible && inRunwayArea(v.x, v.y)) problems.runway.push(`${v.kind} @${tick}`)

    if (prev) {
      for (const [id, p] of people) {
        const q = prev.people.get(id)
        if (!q) continue
        const d = Math.hypot(p.x - q.x, p.y - q.y, p.h - q.h)
        if (d > (id === 6020 ? 3.5 : 2) * TICK_S + 1e-3) problems.walking.push(`person ${id} moved ${d.toFixed(2)} m @${tick}`)
      }
      vehicles.forEach((v, k) => {
        const u = prev!.vehicles[k]
        if (!APRON_KINDS.has(v.kind)) return
        if (v.visible && u.visible) {
          const d = Math.hypot(v.x - u.x, v.y - u.y)
          if (d > MAX_VEHICLE_MS * TICK_S + 1e-3) problems.vehicles.push(`${v.kind} moved ${d.toFixed(2)} m @${tick}`)
          const turn = Math.abs(angleDiff(u.headingDeg, v.headingDeg))
          if (turn > 12) problems.vehicles.push(`${v.kind} turned ${turn.toFixed(1)}° @${tick}`)
        } else if (v.visible !== u.visible) {
          // Appearing or leaving happens only once faded out, at the edge of the apron.
          const p = v.visible ? v : u
          if (p.fade > 0.05 || Math.hypot(p.x + 720, p.y - 440) > 15) problems.vehicles.push(`${v.kind} popped at (${p.x.toFixed(0)}, ${p.y.toFixed(0)}) fade ${p.fade.toFixed(2)} @${tick}`)
        }
        if (v.visible && u.visible && Math.abs(v.fade - u.fade) > 0.2) problems.vehicles.push(`${v.kind} fade jumped @${tick}`)
      })
    }

    const g = j.ground
    if (g && g.speedMs >= 0.1 && tick % 2 === 0) {
      const f = bearingVector(a.headingDeg)
      const r = bearingVector(normalize360(a.headingDeg + 90))
      const inside = (x: number, y: number) => {
        const dx = x - g.posM.x
        const dy = y - g.posM.y
        return Math.abs(dx * f.x + dy * f.y) < AIRCRAFT.length / 2 && Math.abs(dx * r.x + dy * r.y) < AIRCRAFT.span / 2
      }
      for (const [id, p] of people) if (p.h < 5 && inside(p.x, p.y)) problems.outline.push(`person ${id} @${tick}`)
      for (const v of vehicles) if (v.visible && v.kind !== 'tug' && inside(v.x, v.y)) problems.outline.push(`${v.kind} @${tick}`)
    }

    if (j.phase === 'pushback' && j.holdUntilTick < 0) {
      const tug = vehicles[0]
      const f = bearingVector(a.headingDeg)
      const want = AIRCRAFT.noseGear + TOWBAR_M + TUG_LENGTH_M / 2
      const off = Math.hypot(tug.x - (g!.posM.x + f.x * want), tug.y - (g!.posM.y + f.y * want))
      const turn = Math.abs(angleDiff(tug.headingDeg, normalize360(a.headingDeg + 180)))
      if (off >= 1 || turn >= 1 || !tug.visible) problems.tug.push(`off ${off.toFixed(2)} m, ${turn.toFixed(1)}° @${tick}`)
      tugChecked++
    }

    prev = { a, people, vehicles }
    if (j.phase === 'complete' && tick - j.phaseTick > 1200) break
    a = stepJourneyTick(a)
  }
  return { problems, boardersSeen, leaversSeen, leaverOutsidePhase, boarderAtPushback, tugChecked, marshallerSeen, controllersAlways }
}

const R = scan()

describe('crowd and vehicles', () => {
  it('are a pure function of the moment: the same inputs give the same output', () => {
    let a = createJourneyAircraft()
    for (let i = 0; i < 2000; i++) a = stepJourneyTick(a)
    const b1 = new Float32Array(MAX_PEOPLE * STRIDE)
    const b2 = new Float32Array(MAX_PEOPLE * STRIDE)
    const n1 = crowdAt(contextFor(a, 1234.5), b1)
    const n2 = crowdAt(contextFor(a, 1234.5), b2)
    expect(n1).toBe(n2)
    expect(n1).toBeGreaterThan(50)
    expect([...b1]).toEqual([...b2])
  })

  it('every passenger boards well before push-back, and every one leaves after parking', () => {
    expect(BOARDING_DONE_S).toBeLessThan(BOARDING_S - 20)
    expect(R.boarderAtPushback).toBe(0)
    expect(R.boardersSeen.size).toBe(PASSENGERS)
    expect(R.leaverOutsidePhase).toBe(0)
    expect(R.leaversSeen.size).toBe(PASSENGERS)
  })

  it('nobody and no vehicle ever enters the runway protected area', () => {
    expect(R.problems.runway.slice(0, 5)).toEqual([])
  })

  it('people walk (or jog beside the wing) and never teleport', () => {
    expect(R.problems.walking.slice(0, 5)).toEqual([])
  })

  it('apron vehicles drive under 12 kt, turn smoothly and only appear or vanish at the apron entry', () => {
    expect(R.problems.vehicles.slice(0, 5)).toEqual([])
  })

  it('nothing but the tug is inside the aircraft outline while it moves', () => {
    expect(R.problems.outline.slice(0, 5)).toEqual([])
  })

  it('the tug stays on the tow bar at the nose gear, facing the aircraft, throughout the push-back', () => {
    expect(R.tugChecked).toBeGreaterThan(100)
    expect(R.problems.tug.slice(0, 5)).toEqual([])
  })

  it('a marshaller guides CNS700 in and the controllers are always in the tower cab', () => {
    expect(R.marshallerSeen).toBe(true)
    expect(R.controllersAlways).toBe(true)
  })
})

describe('vehicle trips', () => {
  it('wait where the last leg ended, and are hidden only off the apron', () => {
    const path = makePath([{ x: 0, y: 0 }, { x: 100, y: 0 }])
    const trip = { legs: [{ kind: 'path' as const, t0: 10, t1: 20, path }], hiddenBefore: true, hiddenAfter: false }
    expect(tripPose(trip, 0)).toMatchObject({ visible: false, pos: { x: 0, y: 0 } })
    expect(tripPose(trip, 15).pos.x).toBeCloseTo(50, 9)
    expect(tripPose(trip, 99)).toMatchObject({ visible: true, pos: { x: 100, y: 0 } })
  })
  it('turn on the spot the short way round', () => {
    const trip = { legs: [{ kind: 'pivot' as const, t0: 0, t1: 2, pos: { x: 1, y: 2 }, from: 350, to: 20 }] }
    expect(tripPose(trip, 1).headingDeg).toBeCloseTo(5, 9)
    expect(tripPose(trip, 1).pos).toEqual({ x: 1, y: 2 })
  })
})
