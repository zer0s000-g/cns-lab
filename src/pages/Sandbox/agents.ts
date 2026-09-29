/**
 * The people and vehicles that make the airport feel alive: passengers
 * boarding and leaving CNS700 by the airstairs, people in the glass terminal
 * and at the kerb, the ramp crew around the aircraft (marshaller, baggage
 * handlers, refueller, wing walker), the controllers in the tower cab, the
 * push-back tug, stair truck, baggage train, fuel truck, cars and an airport
 * operations car.
 *
 * Every position is a pure function of time and of CNS700's journey state:
 * there is no accumulated state, so the crowd is always consistent after a
 * jump and costs nothing to rewind. Metres, airport surface frame (x east,
 * y north), heights in metres above the apron.
 */

import { bearingDeg, bearingVector, normalize360, type Vec2 } from '@/core/geometry'
import { makePath, pointAt, type Path } from '@/core/surface'
import { mulberry32 } from '@/core/random'
import { CAR_PARK, SERVICE_ROAD_Y, SOUTH_ROAD_X, SOUTH_ROAD_Y, STANDS, TERMINAL, TOWER_POS, TOWER_EYE_M } from '@/modules/surface/layout'
import { HOME_STAND_POS } from './ground'
import type { SbAircraft } from './aircraft'
import { BOARDING_S, DEBOARDING_S, LINED_S, STARTUP_S, TICK_S, type JourneyPhase } from './journey'
import { getJourneyIndex, journeyAt } from './phases'

// ---------------------------------------------------------------------------
// The aircraft on its stand (A320-class, nose to the north)
// ---------------------------------------------------------------------------

export const AIRCRAFT = {
  length: 37.6,
  span: 35.8,
  /** Nose gear ahead of the reference point, m. */
  noseGear: 13.2,
  /** Forward-left passenger door: ahead of the reference point, m. */
  doorFwd: 13.8,
  /** Door sill height, m. */
  doorSill: 3.4,
  fuselageRadius: 2.0,
} as const

const S = HOME_STAND_POS
/** Top of the airstairs at the forward-left door, and their foot. */
export const STAIRS_TOP: Vec2 = { x: S.x - AIRCRAFT.fuselageRadius - 0.8, y: S.y + AIRCRAFT.doorFwd }
export const STAIRS_FOOT: Vec2 = { x: STAIRS_TOP.x - 7.5, y: STAIRS_TOP.y }
/** The gate door in the terminal's airside face for stand S3. */
export const GATE_DOOR: Vec2 = { x: S.x - 25, y: TERMINAL.minY }
/** Tow bar between the nose gear and the tug, m; tug length, m. */
export const TOWBAR_M = 5
export const TUG_LENGTH_M = 6

const AFT_HOLD: Vec2 = { x: S.x + AIRCRAFT.fuselageRadius + 0.5, y: S.y - 9.5 }
const REFUELLER: Vec2 = { x: S.x + 28, y: S.y + 3 }
/** Where the baggage handlers take the bags from the carts. */
const CARTS: Vec2 = { x: S.x + 22, y: S.y - 19 }
const MARSHALLER: Vec2 = { x: S.x, y: S.y + 34 }
const RAMP_AGENT: Vec2 = { x: GATE_DOOR.x + 3, y: GATE_DOOR.y - 4 }

// ---------------------------------------------------------------------------
// Output buffers
// ---------------------------------------------------------------------------

export type Role = 'passenger' | 'crew' | 'controller' | 'marshaller'
export const ROLE_CODE: Record<Role, number> = { passenger: 0, crew: 1, controller: 2, marshaller: 3 }

/** Values per person in the crowd buffer: x, y, height, heading, role, gait (−1 = standing, else 0..1 of a stride), id. */
export const STRIDE = 7
export const MAX_PEOPLE = 128

export type VehicleKind = 'tug' | 'stairs' | 'bagTractor' | 'bagCart' | 'fuel' | 'car' | 'ops'
export interface VehicleState {
  kind: VehicleKind
  x: number
  y: number
  headingDeg: number
  visible: boolean
  /** 1 on the apron; shrinks to 0 over the last metres before leaving (and grows on arrival). */
  fade: number
}

export interface CrowdContext {
  /** World time, s (ambient movement). */
  timeS: number
  /** CNS700's journey phase and seconds spent in it. */
  phase: JourneyPhase
  phaseS: number
  /** Seconds since CNS700 began a timed hold in this phase (engine start after push-back), or null. */
  holdS: number | null
  /** CNS700's position (m) and heading. */
  posM: Vec2
  headingDeg: number
}

// ---------------------------------------------------------------------------
// Fixed, seeded parameters for every person
// ---------------------------------------------------------------------------

const rand = mulberry32(700)
const between = (a: number, b: number) => a + (b - a) * rand()

export const PASSENGERS = 48
const BOARD_START_S = 25
const BOARD_GAP_S = 4.5
const DEBOARD_START_S = 20
const DEBOARD_GAP_S = 4

interface Walker {
  path: Path
  speed: number
  startS: number
  /** Sideways offset from the path centreline, m. */
  lateral: number
}

/** Where each passenger waits in the gate lounge, inside the glass terminal. */
function loungeSpot(i: number): Vec2 {
  return { x: GATE_DOOR.x - 14 + (i % 8) * 3.6, y: TERMINAL.minY + 12 + Math.floor(i / 8) * 3 }
}

const boarders: Walker[] = []
const leavers: Walker[] = []
for (let i = 0; i < PASSENGERS; i++) {
  const lounge = loungeSpot(i)
  boarders.push({
    path: makePath([lounge, { x: GATE_DOOR.x, y: GATE_DOOR.y + 2 }, { x: GATE_DOOR.x, y: STAIRS_FOOT.y + 16 }, { x: STAIRS_FOOT.x - 3, y: STAIRS_FOOT.y + 2 }, STAIRS_FOOT, STAIRS_TOP]),
    speed: between(1.15, 1.45),
    startS: BOARD_START_S + i * BOARD_GAP_S + between(-1, 1),
    lateral: between(-0.7, 0.7),
  })
  const exit = { x: GATE_DOOR.x + between(-30, 30), y: TERMINAL.minY + between(30, 70) }
  leavers.push({
    path: makePath([STAIRS_TOP, STAIRS_FOOT, { x: STAIRS_FOOT.x - 3, y: STAIRS_FOOT.y + 2 }, { x: GATE_DOOR.x, y: STAIRS_FOOT.y + 16 }, { x: GATE_DOOR.x, y: GATE_DOOR.y + 2 }, exit]),
    speed: between(1.2, 1.5),
    startS: DEBOARD_START_S + i * DEBOARD_GAP_S + between(-1, 1),
    lateral: between(-0.7, 0.7),
  })
}
/** The last boarder is on board this long into boarding, s (well before push-back). */
export const BOARDING_DONE_S = Math.max(...boarders.map((w) => w.startS + w.path.length / w.speed))

interface Looper {
  path: Path
  speed: number
  offset: number
  /** Some people stand still (queues, chatting). */
  standing: boolean
}

function loop(points: Vec2[]): Path {
  return makePath([...points, points[0]])
}

const wanderers: Looper[] = []
for (let i = 0; i < 36; i++) {
  const cx = between(TERMINAL.minX + 60, TERMINAL.maxX - 60)
  const w = between(20, 90)
  const y0 = between(TERMINAL.minY + 8, TERMINAL.minY + 30)
  const y1 = between(TERMINAL.maxY - 30, TERMINAL.maxY - 8)
  wanderers.push({ path: loop([{ x: cx - w, y: y0 }, { x: cx + w, y: y0 }, { x: cx + w, y: y1 }, { x: cx - w, y: y1 }]), speed: between(0.8, 1.4), offset: between(0, 1000), standing: i % 5 === 0 })
}

const kerbside: Looper[] = []
for (let i = 0; i < 12; i++) {
  const spot = { x: between(CAR_PARK.minX + 20, CAR_PARK.maxX - 20), y: between(CAR_PARK.minY + 20, CAR_PARK.minY + 160) }
  const door = { x: between(TERMINAL.minX + 80, TERMINAL.maxX - 80), y: TERMINAL.maxY + 1 }
  kerbside.push({ path: makePath([spot, door, spot]), speed: between(1.0, 1.4), offset: between(0, 500), standing: false })
}

const otherCrew: Looper[] = []
for (const id of ['S1', 'S2', 'S4', 'S5'] as const) {
  const st = STANDS[id]
  const n = id === 'S5' ? 2 : 1
  for (let k = 0; k < n; k++) {
    const side = k === 0 ? 1 : -1
    otherCrew.push({
      path: loop([{ x: st.x + side * 22, y: st.y + 18 }, { x: st.x + side * 22, y: st.y - 12 }, { x: st.x + side * 8, y: st.y - 16 }]),
      speed: between(0.7, 1.0),
      offset: between(0, 300),
      standing: false,
    })
  }
}

const CONTROLLERS: { dx: number; dy: number; heading: number; period: number }[] = [
  { dx: -2.2, dy: -1.2, heading: 150, period: 37 },
  { dx: 1.8, dy: -1.8, heading: 170, period: 43 },
  { dx: 0.4, dy: 1.6, heading: 120, period: 51 },
]

const BAG_LOOP = makePath([CARTS, AFT_HOLD, CARTS])
const CAR_LOOP = loop([
  { x: TERMINAL.minX + 40, y: TERMINAL.maxY + 18 },
  { x: TERMINAL.maxX - 40, y: TERMINAL.maxY + 18 },
  { x: TERMINAL.maxX - 40, y: TERMINAL.maxY + 45 },
  { x: TERMINAL.minX + 40, y: TERMINAL.maxY + 45 },
])
const OPS_LOOP = makePath([
  { x: SOUTH_ROAD_X[0], y: SOUTH_ROAD_Y },
  { x: SOUTH_ROAD_X[1], y: SOUTH_ROAD_Y },
  { x: SOUTH_ROAD_X[0], y: SOUTH_ROAD_Y },
])
const CARS = 8
const carOffsets = Array.from({ length: CARS }, (_, i) => (i / CARS) * CAR_LOOP.length + between(-20, 20))
const CAR_SPEED = 7
const OPS_SPEED = 11

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STEP_M = 1.4
const mod = (a: number, n: number) => ((a % n) + n) % n

/** Position on a path with a sideways offset that fades out near the end (the stairs are one person wide). */
function onPath(path: Path, s: number, lateral: number): { pos: Vec2; trackDeg: number } {
  const at = pointAt(path, s)
  // The offset grows over the first metres and shrinks before the stairs; its direction follows
  // the smoothed track, so corners are rounded instead of making the person jump sideways.
  const fade = Math.min(1, Math.max(0, s / 4), Math.max(0, (path.length - s - 8) / 10))
  const track = smoothTrack(path, s)
  const r = bearingVector(normalize360(track + 90))
  return { pos: { x: at.pos.x + r.x * lateral * fade, y: at.pos.y + r.y * lateral * fade }, trackDeg: track }
}

/** Position along a looping path at time t. */
function looping(l: Looper, t: number): { pos: Vec2; trackDeg: number; walked: number } {
  const walked = l.standing ? 0 : t * l.speed + l.offset
  const at = pointAt(l.path, l.standing ? l.offset % l.path.length : mod(walked, l.path.length))
  return { ...at, walked }
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

/** Walk from a to b between t0 and t1 (null outside that window). */
function walkBetween(a: Vec2, b: Vec2, t: number, t0: number, t1: number): { pos: Vec2; trackDeg: number; walked: number } | null {
  if (t < t0 || t > t1) return null
  const k = (t - t0) / (t1 - t0)
  const d = Math.hypot(b.x - a.x, b.y - a.y)
  return { pos: { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }, trackDeg: bearingDeg(a, b), walked: d * k }
}

/** Crew doorway into the terminal near stand S3 (crew come and go through it). */
const CREW_DOOR: Vec2 = { x: S.x + 10, y: TERMINAL.minY + 1 }
/** Where the tractor stands at the aft hold during boarding, and during deboarding. */
const TRACTOR_OUT: Vec2 = { x: S.x + 24, y: S.y - 14 }
const CARTS_IN: Vec2 = { x: S.x + 22, y: S.y - 7 }
const BAG_LOOP_IN = makePath([CARTS_IN, AFT_HOLD, CARTS_IN])

/**
 * Fill `out` with every visible person (STRIDE values each) and return how
 * many there are.
 */
export function crowdAt(ctx: CrowdContext, out: Float32Array): number {
  let n = 0
  const push = (p: Vec2, h: number, heading: number, role: Role, gait: number, id: number) => {
    if (n >= MAX_PEOPLE || n * STRIDE + STRIDE > out.length) return
    const o = n * STRIDE
    out[o] = p.x
    out[o + 1] = p.y
    out[o + 2] = h
    out[o + 3] = heading
    out[o + 4] = ROLE_CODE[role]
    out[o + 5] = gait
    out[o + 6] = id
    n++
  }
  const walker = (w: { pos: Vec2; trackDeg: number; walked: number } | null, role: Role, id: number) => {
    if (w) push(w.pos, 0, w.trackDeg, role, mod(w.walked / STEP_M, 1), id)
    return w !== null
  }
  const { phase, phaseS, timeS } = ctx

  // Passengers boarding: waiting in the lounge, then out across the apron and up the stairs.
  if (phase === 'boarding') {
    boarders.forEach((w, i) => {
      const s = (phaseS - w.startS) * w.speed
      if (s >= w.path.length) return
      if (s < 0) {
        push(w.path.points[0], 0, 180, 'passenger', -1, 1000 + i)
        return
      }
      const at = onPath(w.path, s, w.lateral)
      push(at.pos, stairsHeight(w.path, s), at.trackDeg, 'passenger', mod(s / STEP_M, 1), 1000 + i)
    })
    // The gate agent checks boarding passes, then goes back inside.
    if (phaseS < BOARDING_S - 14) push(RAMP_AGENT, 0, 200, 'crew', -1, 3000)
    else walker(walkBetween(RAMP_AGENT, { x: GATE_DOOR.x, y: GATE_DOOR.y + 3 }, phaseS, BOARDING_S - 14, BOARDING_S - 9), 'crew', 3000)
  }
  // Passengers leaving: down the stairs, across the apron, into the terminal.
  if (phase === 'deboarding' || phase === 'complete') {
    const t = phase === 'complete' ? DEBOARDING_S + phaseS : phaseS
    leavers.forEach((w, i) => {
      const s = (t - w.startS) * w.speed
      if (s < 0 || s >= w.path.length) return
      const at = onPath(w.path, s, w.lateral)
      push(at.pos, stairsHeightDown(w.path, s), at.trackDeg, 'passenger', mod(s / STEP_M, 1), 2000 + i)
    })
  }

  // The terminal and the kerb, all day long.
  wanderers.forEach((l, i) => {
    const at = looping(l, timeS)
    push(at.pos, 0, l.standing ? mod(l.offset * 7, 360) : at.trackDeg, 'passenger', l.standing ? -1 : mod(at.walked / STEP_M, 1), 4000 + i)
  })
  kerbside.forEach((l, i) => {
    const at = looping(l, timeS)
    push(at.pos, 0, at.trackDeg, 'passenger', mod(at.walked / STEP_M, 1), 5000 + i)
  })

  // Baggage handlers: out of the tractor, loading or unloading, back into the tractor.
  const bags = phase === 'boarding' ? { t: phaseS, start: 10, end: BOARDING_S - 30, loop: BAG_LOOP, carts: CARTS } : phase === 'deboarding' ? { t: phaseS, start: 10, end: DEBOARDING_S - 20, loop: BAG_LOOP_IN, carts: CARTS_IN } : null
  if (bags) {
    for (let k = 0; k < 2; k++) {
      const side = k ? 1.2 : -1.2
      const id = 6000 + k
      const from = { x: TRACTOR_OUT.x + side, y: TRACTOR_OUT.y }
      const loopStart = pointAt(bags.loop, k * (bags.loop.length / 2)).pos
      // Up to about 25 m to walk: 20 s at an easy pace.
      if (walker(walkBetween(from, { x: loopStart.x + side, y: loopStart.y }, bags.t, bags.start, bags.start + 20), 'crew', id)) continue
      const loopEnd = bags.end - 20
      if (bags.t > bags.start + 20 && bags.t < loopEnd) {
        const walked = (bags.t - bags.start - 20) * 0.9 + k * (bags.loop.length / 2)
        const at = pointAt(bags.loop, mod(walked, bags.loop.length))
        push({ x: at.pos.x + side, y: at.pos.y }, 0, at.trackDeg, 'crew', mod(walked / STEP_M, 1), id)
        continue
      }
      const walkedEnd = (loopEnd - bags.start - 20) * 0.9 + k * (bags.loop.length / 2)
      const last = pointAt(bags.loop, mod(walkedEnd, bags.loop.length)).pos
      walker(walkBetween({ x: last.x + side, y: last.y }, from, bags.t, loopEnd, bags.end - 1), 'crew', id)
    }
  }
  // Refueller: walks back to the fuel truck and climbs in before it leaves.
  if (phase === 'boarding') {
    if (phaseS < 234) push(REFUELLER, 0, 270, 'crew', -1, 6010)
    else walker(walkBetween(REFUELLER, { x: S.x + 30.5, y: S.y + 8 }, phaseS, 234, 239), 'crew', 6010)
  }
  // Wing walker: comes out before push-back, walks beside the right wing tip, then goes back in.
  const wingSpot = (pos: Vec2, heading: number) => {
    const f = bearingVector(heading)
    const r = bearingVector(normalize360(heading + 90))
    return { x: pos.x - f.x * 1.5 + r.x * (AIRCRAFT.span / 2 + 2.5), y: pos.y - f.y * 1.5 + r.y * (AIRCRAFT.span / 2 + 2.5) }
  }
  if (phase === 'boarding' && phaseS >= BOARDING_S - 90) {
    const spot = wingSpot(S, 0)
    if (!walker(walkBetween(CREW_DOOR, spot, phaseS, BOARDING_S - 90, BOARDING_S - 30), 'crew', 6020)) push(spot, 0, 180, 'crew', -1, 6020)
  } else if (phase === 'pushback' && (ctx.holdS === null || ctx.holdS < TUG_DISCONNECT_S)) {
    // Stays by the wing tip until the tow bar is removed.
    push(wingSpot(ctx.posM, ctx.headingDeg), 0, normalize360(ctx.headingDeg + 180), 'crew', mod((phaseS * 1.3) / STEP_M, 1), 6020)
  } else if (phase === 'pushback' || phase === 'taxiOut') {
    const since = (phase === 'pushback' ? ctx.holdS! : STARTUP_S + phaseS) - TUG_DISCONNECT_S
    const end = arrival().pushEnd
    const from = wingSpot(end.pos, pushbackEndHeading())
    walker(walkBetween(from, CREW_DOOR, since, 0, Math.hypot(CREW_DOOR.x - from.x, CREW_DOOR.y - from.y) / 1.3), 'crew', 6020)
  }
  // Marshaller: walks out as CNS700 taxis in, guides it onto the stand, then goes back in.
  if (phase === 'taxiIn') {
    if (!walker(walkBetween(CREW_DOOR, MARSHALLER, phaseS, 0, 50), 'marshaller', 6030) && phaseS > 50) push(MARSHALLER, 0, 180, 'marshaller', -1, 6030)
  } else if (phase === 'deboarding') {
    if (phaseS < 8) push(MARSHALLER, 0, 180, 'marshaller', -1, 6030)
    else walker(walkBetween(MARSHALLER, CREW_DOOR, phaseS, 8, 8 + Math.hypot(CREW_DOOR.x - MARSHALLER.x, CREW_DOOR.y - MARSHALLER.y) / 1.3), 'crew', 6030)
  }

  // Crew at the other stands.
  otherCrew.forEach((l, i) => {
    const at = looping(l, timeS)
    push(at.pos, 0, at.trackDeg, 'crew', mod(at.walked / STEP_M, 1), 7000 + i)
  })

  // Controllers in the tower cab, looking out over the airfield.
  CONTROLLERS.forEach((c, i) => {
    const sway = Math.sin((timeS / c.period) * Math.PI * 2) * 25
    push({ x: TOWER_POS.x + c.dx, y: TOWER_POS.y + c.dy }, TOWER_EYE_M - 1.7, normalize360(c.heading + sway), 'controller', -1, 8000 + i)
  })
  return n
}

/** Heading of the aircraft while it waits for engine start at the end of the push-back (lined up with the taxilane). */
function pushbackEndHeading(): number {
  return arrival().pushEnd.headingDeg
}

/** Height while climbing the stairs (the last segment of a boarding path). */
function stairsHeight(path: Path, s: number): number {
  const i = path.points.length - 1
  const start = path.cum[i - 1]
  if (s <= start) return 0
  return ((s - start) / (path.length - start)) * AIRCRAFT.doorSill
}

/** Height while coming down the stairs (the first segment of a leaving path). */
function stairsHeightDown(path: Path, s: number): number {
  const end = path.cum[1]
  if (s >= end) return 0
  return (1 - s / end) * AIRCRAFT.doorSill
}

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------

/**
 * A vehicle's movements as timed legs: drive along a path (forward, or
 * reversing), or turn on the spot. Between legs it waits where the last leg
 * ended, so position and heading are always continuous.
 */
export type TripLeg =
  | { kind: 'path'; t0: number; t1: number; path: Path; reverse?: boolean; s0?: number }
  | { kind: 'pivot'; t0: number; t1: number; pos: Vec2; from: number; to: number }

export interface Trip {
  legs: TripLeg[]
  /** Hidden before the first leg starts (arrives from off the apron). */
  hiddenBefore?: boolean
  /** Hidden after the last leg ends (has left the apron). */
  hiddenAfter?: boolean
}

/** Heading along a path, averaged over a few metres so corners are taken smoothly. */
function smoothTrack(path: Path, s: number): number {
  const a = pointAt(path, Math.max(0, s - 4)).pos
  const b = pointAt(path, Math.min(path.length, s + 4)).pos
  return Math.hypot(b.x - a.x, b.y - a.y) < 1e-6 ? pointAt(path, s).trackDeg : bearingDeg(a, b)
}

function legPose(l: TripLeg, t: number): { pos: Vec2; headingDeg: number } {
  const k = l.t1 > l.t0 ? Math.max(0, Math.min(1, (t - l.t0) / (l.t1 - l.t0))) : 1
  if (l.kind === 'pivot') {
    const d = ((((l.to - l.from) % 360) + 540) % 360) - 180
    return { pos: l.pos, headingDeg: normalize360(l.from + d * k) }
  }
  const s0 = l.s0 ?? 0
  const s = s0 + k * (l.path.length - s0)
  const h = smoothTrack(l.path, s)
  return { pos: pointAt(l.path, s).pos, headingDeg: l.reverse ? normalize360(h + 180) : h }
}

/** Metres over which a vehicle fades in or out at the edge of the apron. */
const FADE_M = 12

/** Where a vehicle on a trip is at time t (and whether it is on the apron at all). */
export function tripPose(trip: Trip, t: number): { pos: Vec2; headingDeg: number; visible: boolean; fade: number } {
  const legs = trip.legs
  const first = legs[0]
  const last = legs[legs.length - 1]
  // Fading at the apron entry: over the first metres of an arrival and the last metres of a departure.
  const fadeAt = (tt: number) => {
    let f = 1
    if (trip.hiddenBefore && first.kind === 'path') f = Math.min(f, travelled(first, tt) / FADE_M)
    if (trip.hiddenAfter && last.kind === 'path') f = Math.min(f, (last.path.length - (last.s0 ?? 0) - travelled(last, tt)) / FADE_M)
    return Math.max(0, Math.min(1, f))
  }
  if (t < first.t0) return { ...legPose(first, first.t0), visible: !trip.hiddenBefore, fade: trip.hiddenBefore ? 0 : 1 }
  for (let i = 0; i < legs.length; i++) {
    const l = legs[i]
    if (t <= l.t1) return { ...legPose(l, Math.max(t, l.t0)), visible: true, fade: fadeAt(t) }
    const next = legs[i + 1]
    if (next && t < next.t0) return { ...legPose(l, l.t1), visible: true, fade: fadeAt(t) }
  }
  return { ...legPose(last, last.t1), visible: !trip.hiddenAfter, fade: trip.hiddenAfter ? 0 : 1 }
}

/** Metres driven along a path leg by time t. */
function travelled(l: TripLeg, t: number): number {
  if (l.kind !== 'path') return Infinity
  const k = l.t1 > l.t0 ? Math.max(0, Math.min(1, (t - l.t0) / (l.t1 - l.t0))) : 1
  return k * (l.path.length - (l.s0 ?? 0))
}

/** Points on a trailer path behind the towing vehicle (the baggage carts), m. */
function trailing(trip: Trip, t: number, back: number): { pos: Vec2; headingDeg: number } {
  // Find the active path leg and step back along it.
  const legs = trip.legs
  let leg = legs[0]
  let tt = t
  for (const l of legs) {
    if (t >= l.t0) {
      leg = l
      tt = Math.min(t, l.t1)
    }
  }
  if (leg.kind !== 'path') return legPose(leg, tt)
  const k = leg.t1 > leg.t0 ? Math.max(0, Math.min(1, (tt - leg.t0) / (leg.t1 - leg.t0))) : 1
  const s0 = leg.s0 ?? 0
  const s = Math.max(0, s0 + k * (leg.path.length - s0) - back)
  return { pos: pointAt(leg.path, s).pos, headingDeg: smoothTrack(leg.path, s) }
}

const APRON_ENTRY: Vec2 = { x: -720, y: SERVICE_ROAD_Y }
/** Apron vehicles drive at about this speed, m/s (under 12 kt). */
export const APRON_VEHICLE_MS = 5.8

/** A path leg timed to drive at a steady speed, starting at t0 (from s0 metres along it). */
function driveLeg(path: Path, t0: number, speed = APRON_VEHICLE_MS, opts: { reverse?: boolean; s0?: number } = {}): TripLeg {
  const len = path.length - (opts.s0 ?? 0)
  return { kind: 'path', t0, t1: t0 + len / speed, path, ...opts }
}
const endOf = (l: TripLeg) => l.t1

// Stair truck: docks square to the forward door, stairs toward the aircraft.
const STAIRS_DOCKED: Vec2 = { x: STAIRS_TOP.x - 4.2, y: STAIRS_TOP.y }
const STAIRS_BACK: Vec2 = { x: STAIRS_DOCKED.x - 14, y: STAIRS_DOCKED.y }

// Journey times of the arrival (deterministic: from the journey index), s.
let arrivalCache: { onBlocksS: number; pushEnd: { pos: Vec2; headingDeg: number } } | null = null
function arrival() {
  if (!arrivalCache) {
    const idx = getJourneyIndex()
    const onBlocks = idx.events.find((x) => x.kind === 'onBlocks')!
    // Where the aircraft stands when the tow bar is removed (it waits there for engine start).
    const taxi = idx.events.find((x) => x.kind === 'taxi')!
    const a = journeyAt(taxi.tick - Math.round((STARTUP_S - TUG_DISCONNECT_S) / TICK_S))
    arrivalCache = { onBlocksS: onBlocks.tick * TICK_S, pushEnd: { pos: { ...a.journey!.ground!.posM }, headingDeg: a.headingDeg } }
  }
  return arrivalCache
}

let tripsCache: ReturnType<typeof buildTrips> | null = null
function trips() {
  if (!tripsCache) tripsCache = buildTrips()
  return tripsCache
}

function buildTrips() {
  const O = arrival().onBlocksS
  // --- Stair truck ---------------------------------------------------------------
  const stairsOutRev = driveLeg(makePath([STAIRS_DOCKED, STAIRS_BACK]), BOARDING_S - 26, 2, { reverse: true })
  const stairsOutPivot: TripLeg = { kind: 'pivot', t0: endOf(stairsOutRev), t1: endOf(stairsOutRev) + 3, pos: STAIRS_BACK, from: 90, to: 0 }
  const stairsOut = driveLeg(makePath([STAIRS_BACK, { x: STAIRS_BACK.x, y: SERVICE_ROAD_Y - 15 }, { x: STAIRS_BACK.x - 15, y: SERVICE_ROAD_Y }, APRON_ENTRY]), endOf(stairsOutPivot))
  const stairsInPath = makePath([APRON_ENTRY, { x: STAIRS_BACK.x - 14, y: SERVICE_ROAD_Y }, { x: STAIRS_BACK.x - 14, y: SERVICE_ROAD_Y - 15 }, { x: STAIRS_BACK.x - 14, y: STAIRS_BACK.y }])
  const stairsIn = driveLeg(stairsInPath, O - 4 - stairsInPath.length / APRON_VEHICLE_MS)
  const stairsInPivot: TripLeg = { kind: 'pivot', t0: O - 4, t1: O, pos: { x: STAIRS_BACK.x - 14, y: STAIRS_BACK.y }, from: 180, to: 90 }
  const stairsDock = driveLeg(makePath([{ x: STAIRS_BACK.x - 14, y: STAIRS_BACK.y }, STAIRS_DOCKED]), O + 2, 2)
  const stairsDepart: Trip = { legs: [stairsOutRev, stairsOutPivot, stairsOut], hiddenAfter: true }
  const stairsArrive: Trip = { legs: [stairsIn, stairsInPivot, stairsDock], hiddenBefore: true }

  // --- Baggage train: tractor with two carts, alongside the aft hold -------------
  const bagX = S.x + 24
  const bagsOutPath = makePath([{ x: bagX, y: S.y - 24 }, { x: bagX, y: S.y - 14 }, { x: bagX, y: SERVICE_ROAD_Y - 15 }, { x: bagX - 15, y: SERVICE_ROAD_Y }, APRON_ENTRY])
  const bagsOut = driveLeg(bagsOutPath, BOARDING_S - 30, APRON_VEHICLE_MS, { s0: 10 })
  const bagsInPath = makePath([APRON_ENTRY, { x: bagX - 15, y: SERVICE_ROAD_Y }, { x: bagX, y: SERVICE_ROAD_Y - 15 }, { x: bagX, y: S.y - 14 }])
  const bagsIn = driveLeg(bagsInPath, O + 6 - bagsInPath.length / APRON_VEHICLE_MS)
  const bagsLeavePath = makePath([{ x: bagX, y: S.y - 4 }, { x: bagX, y: S.y - 14 }, { x: bagX, y: S.y - 34 }, { x: S.x - 60, y: S.y - 34 }, { x: S.x - 60, y: SERVICE_ROAD_Y - 15 }, { x: S.x - 75, y: SERVICE_ROAD_Y }, APRON_ENTRY])
  const bagsLeave = driveLeg(bagsLeavePath, O + DEBOARDING_S - 20, APRON_VEHICLE_MS, { s0: 10 })
  const bagsDepart: Trip = { legs: [bagsOut], hiddenAfter: true }
  const bagsArrive: Trip = { legs: [bagsIn], hiddenBefore: true }
  const bagsGoHome: Trip = { legs: [bagsLeave], hiddenAfter: true }

  // --- Fuel truck: by the right wing root during boarding ------------------------
  const fuelX = S.x + 32
  const fuelOut = driveLeg(makePath([{ x: fuelX, y: S.y + 8 }, { x: fuelX, y: SERVICE_ROAD_Y - 15 }, { x: fuelX - 15, y: SERVICE_ROAD_Y }, APRON_ENTRY]), 240)
  const fuelDepart: Trip = { legs: [fuelOut], hiddenAfter: true }

  return { stairsDepart, stairsArrive, bagsDepart, bagsArrive, bagsGoHome, fuelDepart, onBlocksS: O }
}

/** Where the tug sits while attached: ahead of the nose gear by the tow bar, facing the aircraft. */
export function tugAttached(posM: Vec2, headingDeg: number): { pos: Vec2; headingDeg: number } {
  const f = bearingVector(headingDeg)
  const d = AIRCRAFT.noseGear + TOWBAR_M + TUG_LENGTH_M / 2
  return { pos: { x: posM.x + f.x * d, y: posM.y + f.y * d }, headingDeg: normalize360(headingDeg + 180) }
}

/** The tug after push-back: backs away, turns, and drives off the apron (times from the moment the tow bar is removed). */
function tugAwayTrip(from: { pos: Vec2; headingDeg: number }): Trip {
  const back = bearingVector(normalize360(from.headingDeg + 180))
  const p1 = { x: from.pos.x + back.x * 8, y: from.pos.y + back.y * 8 }
  const rev = driveLeg(makePath([from.pos, p1]), 0, 2, { reverse: true })
  const pivot: TripLeg = { kind: 'pivot', t0: endOf(rev), t1: endOf(rev) + 3, pos: p1, from: from.headingDeg, to: 0 }
  const away = driveLeg(makePath([p1, { x: p1.x, y: SERVICE_ROAD_Y - 15 }, { x: p1.x - 15, y: SERVICE_ROAD_Y }, APRON_ENTRY]), endOf(pivot))
  return { legs: [rev, pivot, away], hiddenAfter: true }
}

export interface VehicleContext extends CrowdContext {
  /** Seconds since the journey began. */
  elapsedS: number
}

export function createVehicles(): VehicleState[] {
  const v: VehicleState[] = []
  const add = (kind: VehicleKind) => v.push({ kind, x: 0, y: 0, headingDeg: 0, visible: false, fade: 0 })
  add('tug')
  add('stairs')
  add('bagTractor')
  add('bagCart')
  add('bagCart')
  add('fuel')
  for (let i = 0; i < CARS; i++) add('car')
  add('ops')
  return v
}

function setPose(v: VehicleState, p: { pos: Vec2; headingDeg: number; fade?: number }, visible = true, fade = p.fade ?? 1) {
  v.x = p.pos.x
  v.y = p.pos.y
  v.headingDeg = p.headingDeg
  v.visible = visible
  v.fade = visible ? fade : 0
}

/** Update every vehicle for this moment. */
export function vehiclesAt(ctx: VehicleContext, v: VehicleState[]) {
  const { phase, timeS, elapsedS } = ctx
  const [tug, stairs, tractor, cart1, cart2, fuel] = v
  const t = trips()
  const departing = phase === 'boarding' || phase === 'pushback' || phase === 'taxiOut' || phase === 'holding' || phase === 'lineup' || phase === 'takeoff'
  const arriving = phase === 'rollout' || phase === 'taxiIn' || phase === 'deboarding' || phase === 'complete'

  // Push-back tug: attached at the gate and during push-back, then backs away and leaves.
  tug.visible = false
  if (phase === 'boarding' || (phase === 'pushback' && (ctx.holdS === null || ctx.holdS < TUG_DISCONNECT_S))) {
    setPose(tug, tugAttached(ctx.posM, ctx.headingDeg))
  } else if (phase === 'pushback' || phase === 'taxiOut') {
    const since = phase === 'pushback' ? ctx.holdS! - TUG_DISCONNECT_S : STARTUP_S - TUG_DISCONNECT_S + ctx.phaseS
    const end = arrival().pushEnd
    const p = tripPose(tugAwayTrip(tugAttached(end.pos, end.headingDeg)), since)
    setPose(tug, p, p.visible)
  }

  // Stair truck.
  stairs.visible = false
  if (departing) {
    const p = tripPose(t.stairsDepart, elapsedS)
    setPose(stairs, p, p.visible)
  } else if (arriving) {
    const p = tripPose(t.stairsArrive, elapsedS)
    setPose(stairs, p, p.visible)
  }

  // Baggage train (the carts follow the tractor's path).
  tractor.visible = cart1.visible = cart2.visible = false
  const bagTrip = departing ? t.bagsDepart : arriving ? (elapsedS < t.onBlocksS + DEBOARDING_S - 20 ? t.bagsArrive : t.bagsGoHome) : null
  if (bagTrip) {
    const p = tripPose(bagTrip, elapsedS)
    setPose(tractor, p, p.visible)
    // The whole train fades together at the apron entry.
    setPose(cart1, trailing(bagTrip, elapsedS, 5), p.visible, p.fade)
    setPose(cart2, trailing(bagTrip, elapsedS, 9.5), p.visible, p.fade)
  }

  // Fuel truck.
  fuel.visible = false
  if (departing) {
    const p = tripPose(t.fuelDepart, elapsedS)
    setPose(fuel, p, p.visible)
  }

  // Cars at the kerb and the airport operations car on the perimeter road.
  for (let i = 0; i < CARS; i++) {
    const s = mod(timeS * CAR_SPEED + carOffsets[i], CAR_LOOP.length)
    setPose(v[6 + i], { pos: pointAt(CAR_LOOP, s).pos, headingDeg: smoothTrack(CAR_LOOP, s) })
  }
  const so = mod(timeS * OPS_SPEED, OPS_LOOP.length)
  setPose(v[6 + CARS], { pos: pointAt(OPS_LOOP, so).pos, headingDeg: smoothTrack(OPS_LOOP, so) })
}

/** Seconds into the engine-start hold when the tow bar is removed. */
export const TUG_DISCONNECT_S = 10

/**
 * The crowd's view of CNS700's journey at a moment. `elapsedS` (seconds since
 * the journey began) may fall between ticks, so people move smoothly; the
 * pose is the aircraft as drawn.
 */
export function contextFor(a: SbAircraft, timeS: number, elapsedS?: number, pose?: { posM: Vec2; headingDeg: number }): VehicleContext {
  const j = a.journey!
  const e = elapsedS ?? j.tick * TICK_S
  const phaseStart = j.phaseTick * TICK_S
  let holdS: number | null = null
  if (j.holdUntilTick >= 0) {
    const dur = j.phase === 'pushback' ? STARTUP_S : j.phase === 'lineup' ? LINED_S : 0
    holdS = Math.max(0, dur - (j.holdUntilTick * TICK_S - e))
  }
  const posM = pose?.posM ?? j.ground?.posM ?? { x: a.pos.x * 1852, y: a.pos.y * 1852 }
  return { timeS, phase: j.phase, phaseS: Math.max(0, e - phaseStart), holdS, elapsedS: e, posM, headingDeg: pose?.headingDeg ?? a.headingDeg }
}
