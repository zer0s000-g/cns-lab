/**
 * The journey of CNS700 as a deterministic state machine advanced in fixed
 * ticks (TICK_S). Because every tick is the same length, the live flight, the
 * precomputed journey index (used by the timeline, phase jumps and guided
 * stops) and the tests all see exactly the same flight.
 *
 * Pure functions only: nothing here mutates its input or uses randomness.
 */

import { angleDiff, crossTrackNm, distanceNm, normalize360, type Vec2 } from '@/core/geometry'
import { pointAt } from '@/core/surface'
import { ktToMs, METRES_PER_NM } from '@/core/units'
import { LAB_AIRPORT, stepAircraftFine } from '@/core/world'
import { mk, type JourneyState, type SbAircraft } from './aircraft'
import {
  atPathEnd,
  clearOfRunway,
  HOME_STAND_POS,
  lineupPath,
  lineupStep,
  parkedAt,
  pushbackPath,
  pushbackStep,
  rolloutDone,
  rolloutStep,
  startPath,
  takeoffRollStep,
  takeoffRunway,
  taxiInStep,
  taxiOutFrom,
  taxiOutStep,
  touchdownGround,
  type GroundState,
} from './ground'
import {
  APPROACH_TO_TOWER_NM,
  BOARDING_S,
  CLEARANCE_AT_S,
  DEBOARDING_S,
  FIRST_OCEAN_LEG,
  FIRST_RETURN_LEG,
  FLIGHT_PHASES,
  glidePathAltitudeFt,
  HOLD_S,
  INTERCEPT_ALT_FT,
  INTERCEPT_LEG,
  JOURNEY,
  LINED_S,
  REQUEST_PUSH_AT_S,
  STARTUP_S,
  THRESHOLD,
  TICK_S,
  ticks,
  TMA_RADIUS_NM,
  TOWER_TO_DEPARTURE_FT,
  type FlightPhase,
  type JourneyPhase,
} from './journey'
import { ILS09, OCEANIC_BOUNDARY_X } from './systems'

const ELEV = LAB_AIRPORT.elevationFt

/** Turn a heading toward a target by at most maxDeg, the short way. */
function turnToward(from: number, to: number, maxDeg: number): number {
  const d = angleDiff(from, to)
  return normalize360(from + Math.max(-maxDeg, Math.min(maxDeg, d)))
}
const MS_TO_KT = 3600 / METRES_PER_NM
const ORIGIN: Vec2 = { x: 0, y: 0 }

export const JOURNEY_ID = 'CNS700'

// ---------------------------------------------------------------------------
// Creating and moving the aircraft
// ---------------------------------------------------------------------------

/** The aircraft's world fields follow its ground state (NM, ft, kt). */
function onGround(a: SbAircraft, g: GroundState, j: JourneyState): SbAircraft {
  const speedKt = g.speedMs * MS_TO_KT
  return {
    ...a,
    pos: { x: g.posM.x / METRES_PER_NM, y: g.posM.y / METRES_PER_NM },
    altitudeFt: ELEV,
    headingDeg: g.headingDeg,
    speedKt,
    verticalSpeedFpm: 0,
    targetHeadingDeg: g.headingDeg,
    targetAltitudeFt: ELEV,
    targetSpeedKt: speedKt,
    mode: { kind: 'heading' },
    journey: { ...j, ground: g },
  }
}

/** CNS700 parked at stand S3 at the start of boarding. */
export function createJourneyAircraft(): SbAircraft {
  const g = parkedAt(HOME_STAND_POS)
  const base = mk(JOURNEY_ID, { x: 0, y: 0 }, ELEV, 0, 0, { transponder: 'modeS', adsb: true, fans: true }, '4521')
  const j: JourneyState = { phase: 'boarding', legIndex: 0, tick: 0, phaseTick: 0, ground: g, holdUntilTick: -1 }
  return onGround(base, g, j)
}

function enter(j: JourneyState, phase: JourneyPhase, tick: number, patch: Partial<JourneyState> = {}): JourneyState {
  return { ...j, phase, phaseTick: tick, holdUntilTick: -1, ...patch }
}

/** Airborne legs: fly toward the leg's waypoint with its altitude and speed. */
function flyLegs(a: SbAircraft, j: JourneyState, dt: number): SbAircraft {
  let legIndex = j.legIndex
  let leg = JOURNEY[legIndex]
  const reach = Math.max(1, (a.speedKt / 3600) * dt * 2)
  if (distanceNm(a.pos, leg.to) < reach) {
    legIndex++
    if (legIndex >= JOURNEY.length) return flyFinal({ ...a, journey: enter(j, 'final', j.tick) }, dt)
    leg = JOURNEY[legIndex]
  }
  const flown = stepAircraftFine({ ...a, mode: { kind: 'direct', to: leg.to }, targetAltitudeFt: leg.altitudeFt, targetSpeedKt: leg.speedKt }, dt) as SbAircraft
  return { ...flown, mode: { kind: 'heading' }, targetHeadingDeg: flown.headingDeg, journey: { ...j, legIndex } }
}

/** Final approach: localizer capture (steer onto the centreline), glideslope, touchdown. */
function flyFinal(a: SbAircraft, dt: number): SbAircraft {
  const j = a.journey!
  const xt = crossTrackNm(a.pos, THRESHOLD, ILS09.courseDeg) // + = right of course (south)
  const heading = normalize360(ILS09.courseDeg - Math.max(-30, Math.min(30, xt * 25)))
  // Stay at 3,000 ft until the glide path comes down to meet it, then follow it to the
  // touchdown point (where the 3° path meets the runway, about 950 ft past the threshold).
  const targetAlt = Math.min(INTERCEPT_ALT_FT, glidePathAltitudeFt(a.pos.x))
  const toGo = THRESHOLD.x - a.pos.x
  const speed = toGo > 5 ? 160 : 140
  const flown = stepAircraftFine({ ...a, mode: { kind: 'heading' }, targetHeadingDeg: heading, targetAltitudeFt: targetAlt, targetSpeedKt: speed }, dt) as SbAircraft
  // Touchdown where the glide path meets the runway (the aircraft follows it all the way down).
  if (flown.pos.x >= THRESHOLD.x && flown.altitudeFt <= ELEV + 0.01) {
    const posM = { x: flown.pos.x * METRES_PER_NM, y: flown.pos.y * METRES_PER_NM }
    const g = touchdownGround(posM, ktToMs(flown.speedKt), flown.headingDeg)
    return onGround(flown, g, enter(j, 'rollout', j.tick))
  }
  return { ...flown, journey: j }
}

/** Lift-off: the flight model takes over at the rotation speed, on the runway heading. */
function liftoff(a: SbAircraft, g: GroundState, j: JourneyState): SbAircraft {
  const speedKt = g.speedMs * MS_TO_KT
  return {
    ...a,
    pos: { x: g.posM.x / METRES_PER_NM, y: g.posM.y / METRES_PER_NM },
    altitudeFt: ELEV,
    headingDeg: g.headingDeg,
    speedKt,
    targetSpeedKt: speedKt,
    targetHeadingDeg: g.headingDeg,
    mode: { kind: 'heading' },
    journey: enter(j, 'plan', j.tick, { legIndex: 0, ground: null }),
  }
}

/**
 * Advance the journey by one tick. Deterministic: the same state always gives
 * the same next state.
 */
export function stepJourneyTick(a: SbAircraft): SbAircraft {
  const j0 = a.journey!
  const dt = TICK_S
  const tick = j0.tick + 1
  const j: JourneyState = { ...j0, tick }
  const inPhase = tick - j.phaseTick
  const g = j.ground
  switch (j.phase) {
    case 'boarding':
      if (inPhase >= ticks(BOARDING_S)) return onGround(a, startPath(g!, pushbackPath(), true), enter(j, 'pushback', tick))
      return { ...a, journey: j }
    case 'pushback': {
      if (j.holdUntilTick >= 0) {
        // Tug disconnect and engine start. The tug straightens the aircraft along the taxilane meanwhile.
        const taxi = taxiOutFrom(g!.posM)
        const aligned = { ...g!, headingDeg: turnToward(g!.headingDeg, pointAt(taxi, 0).trackDeg, 3 * dt) }
        if (tick >= j.holdUntilTick) return onGround(a, startPath({ ...aligned, reverse: false }, taxi), enter(j, 'taxiOut', tick))
        return onGround(a, aligned, j)
      }
      const next = pushbackStep(g!, dt)
      if (atPathEnd(next)) return onGround(a, next, { ...j, holdUntilTick: tick + ticks(STARTUP_S) })
      return onGround(a, next, j)
    }
    case 'taxiOut': {
      const next = taxiOutStep(g!, dt)
      if (atPathEnd(next)) return onGround(a, next, enter(j, 'holding', tick))
      return onGround(a, next, j)
    }
    case 'holding':
      if (inPhase >= ticks(HOLD_S)) return onGround(a, startPath(g!, lineupPath()), enter(j, 'lineup', tick))
      return { ...a, journey: j }
    case 'lineup': {
      if (j.holdUntilTick >= 0) {
        // Lined up and waiting: the last metres of the turn bring the nose onto the runway heading.
        const runway = takeoffRunway(g!.posM)
        const aligned = { ...g!, headingDeg: turnToward(g!.headingDeg, pointAt(runway, 0).trackDeg, 5 * dt) }
        if (tick >= j.holdUntilTick) return onGround(a, startPath(aligned, runway), enter(j, 'takeoff', tick))
        return onGround(a, aligned, j)
      }
      const next = lineupStep(g!, dt)
      if (atPathEnd(next)) return onGround(a, next, { ...j, holdUntilTick: tick + ticks(LINED_S) })
      return onGround(a, next, j)
    }
    case 'takeoff': {
      const r = takeoffRollStep(g!, dt)
      if (r.liftoff) return liftoff(a, r.g, j)
      return onGround(a, r.g, j)
    }
    case 'plan':
      return flyLegs(a, j, dt)
    case 'final':
      return flyFinal({ ...a, journey: j }, dt)
    case 'rollout': {
      const next = rolloutStep(g!, dt)
      if (rolloutDone(next)) return onGround(a, next, enter(j, 'taxiIn', tick))
      return onGround(a, next, j)
    }
    case 'taxiIn': {
      const next = taxiInStep(g!, dt)
      if (atPathEnd(next)) return onGround(a, { ...next, path: null, s: 0, speedMs: 0 }, enter(j, 'deboarding', tick))
      return onGround(a, next, j)
    }
    case 'deboarding':
      if (inPhase >= ticks(DEBOARDING_S)) return { ...a, journey: enter(j, 'complete', tick) }
      return { ...a, journey: j }
    case 'complete':
      // The flight is over but time goes on (the last passengers are still walking in).
      return { ...a, journey: j }
  }
}

// ---------------------------------------------------------------------------
// What the learner sees: flight phases, controllers' handovers, events
// ---------------------------------------------------------------------------

export const isOnGround = (a: SbAircraft) => a.journey?.ground != null
/** Transponder and ADS-B are switched on from push-back until the aircraft is parked again. */
export const transponderOn = (a: SbAircraft) => {
  const p = a.journey?.phase
  return p !== 'boarding' && p !== 'deboarding' && p !== 'complete'
}
export const elapsedS = (a: SbAircraft) => (a.journey?.tick ?? 0) * TICK_S

/** The learner-facing phase of the flight. Changes only forward along a journey. */
export function flightPhase(a: SbAircraft): FlightPhase {
  const j = a.journey
  if (!j) return 'climb'
  switch (j.phase) {
    case 'boarding':
      return 'gate'
    case 'pushback':
      return 'pushback'
    case 'taxiOut':
    case 'holding':
      return 'taxi'
    case 'lineup':
    case 'takeoff':
      return 'takeoff'
    case 'plan': {
      const d = distanceNm(a.pos, ORIGIN)
      if (a.pos.x > OCEANIC_BOUNDARY_X) return 'ocean'
      if (j.legIndex < FIRST_OCEAN_LEG) {
        if (a.altitudeFt < TOWER_TO_DEPARTURE_FT && d < TMA_RADIUS_NM) return 'takeoff'
        return d < TMA_RADIUS_NM ? 'departure' : 'climb'
      }
      if (j.legIndex < FIRST_RETURN_LEG) return 'ocean'
      return d < TMA_RADIUS_NM ? 'approach' : 'descent'
    }
    case 'final':
      return THRESHOLD.x - a.pos.x > APPROACH_TO_TOWER_NM ? 'approach' : 'landing'
    case 'rollout':
    case 'taxiIn':
      return clearOfRunway(j.ground!.posM) ? 'taxiIn' : 'landing'
    case 'deboarding':
    case 'complete':
      return 'arrived'
  }
}

export type JourneyEventKind =
  | 'clearance'
  | 'requestPush'
  | 'pushback'
  | 'taxi'
  | 'holdShort'
  | 'lineUp'
  | 'takeoffClearance'
  | 'liftoff'
  | 'toDeparture'
  | 'toArea'
  | 'oceanEntry'
  | 'oceanTurn'
  | 'descentStart'
  | 'oceanExit'
  | 'toApproach'
  | 'interceptClearance'
  | 'locCapture'
  | 'gsCapture'
  | 'toTower'
  | 'touchdown'
  | 'vacated'
  | 'onBlocks'
  | 'complete'

/** Events in the order they happen on a journey. */
export const EVENT_ORDER: readonly JourneyEventKind[] = [
  'clearance',
  'requestPush',
  'pushback',
  'taxi',
  'holdShort',
  'lineUp',
  'takeoffClearance',
  'liftoff',
  'toDeparture',
  'toArea',
  'oceanEntry',
  'oceanTurn',
  'descentStart',
  'oceanExit',
  'toApproach',
  'interceptClearance',
  'locCapture',
  'gsCapture',
  'toTower',
  'touchdown',
  'vacated',
  'onBlocks',
  'complete',
]

const PHASE_EVENTS: Partial<Record<`${JourneyPhase}>${JourneyPhase}`, JourneyEventKind>> = {
  'boarding>pushback': 'pushback',
  'pushback>taxiOut': 'taxi',
  'taxiOut>holding': 'holdShort',
  'holding>lineup': 'lineUp',
  'lineup>takeoff': 'takeoffClearance',
  'takeoff>plan': 'liftoff',
  'plan>final': 'locCapture',
  'final>rollout': 'touchdown',
  'taxiIn>deboarding': 'onBlocks',
  'deboarding>complete': 'complete',
}

const FLIGHT_EVENTS: Partial<Record<`${FlightPhase}>${FlightPhase}`, JourneyEventKind>> = {
  'takeoff>departure': 'toDeparture',
  'departure>climb': 'toArea',
  'climb>ocean': 'oceanEntry',
  'ocean>descent': 'oceanExit',
  'descent>approach': 'toApproach',
  'approach>landing': 'toTower',
  'landing>taxiIn': 'vacated',
}

/** What happened between two consecutive states of the journey, in order. */
export function journeyEvents(prev: SbAircraft, next: SbAircraft): JourneyEventKind[] {
  const a = prev.journey
  const b = next.journey
  if (!a || !b) return []
  const out: JourneyEventKind[] = []
  if (a.phase === 'boarding' && b.phase === 'boarding') {
    const t0 = (a.tick - a.phaseTick) * TICK_S
    const t1 = (b.tick - b.phaseTick) * TICK_S
    if (t0 < CLEARANCE_AT_S && t1 >= CLEARANCE_AT_S) out.push('clearance')
    if (t0 < REQUEST_PUSH_AT_S && t1 >= REQUEST_PUSH_AT_S) out.push('requestPush')
  }
  if (a.phase !== b.phase) {
    const e = PHASE_EVENTS[`${a.phase}>${b.phase}`]
    // A final approach that begins and ends in the same tick is not possible, but plan>rollout would be.
    if (e) out.push(e)
    else if (a.phase === 'plan' && b.phase === 'rollout') out.push('locCapture', 'touchdown')
  }
  if (b.phase === 'plan' || a.phase === 'plan') {
    if (a.legIndex < FIRST_OCEAN_LEG + 1 && b.legIndex === FIRST_OCEAN_LEG + 1) out.push('oceanTurn')
    if (a.legIndex < FIRST_RETURN_LEG && b.legIndex === FIRST_RETURN_LEG) out.push('descentStart')
    if (a.legIndex < INTERCEPT_LEG && b.legIndex === INTERCEPT_LEG) out.push('interceptClearance')
  }
  if (b.phase === 'final' && glidePathAltitudeFt(prev.pos.x) >= INTERCEPT_ALT_FT && glidePathAltitudeFt(next.pos.x) < INTERCEPT_ALT_FT) out.push('gsCapture')
  const fa = flightPhase(prev)
  const fb = flightPhase(next)
  if (fa !== fb) {
    const e = FLIGHT_EVENTS[`${fa}>${fb}`]
    if (e) out.push(e)
  }
  return out.sort((x, y) => EVENT_ORDER.indexOf(x) - EVENT_ORDER.indexOf(y))
}

// ---------------------------------------------------------------------------
// The journey index: the whole flight computed once
// ---------------------------------------------------------------------------

export interface JourneySample {
  tick: number
  pos: Vec2
  altitudeFt: number
  phase: FlightPhase
}

export interface JourneyIndex {
  /** State every SNAPSHOT_TICKS ticks. */
  snapshots: SbAircraft[]
  /** First tick of each flight phase. */
  phaseStartTick: Record<FlightPhase, number>
  events: { kind: JourneyEventKind; tick: number }[]
  /** Every 10 s, for the timeline and the maps. */
  samples: JourneySample[]
  /** Tick at which the journey is complete. */
  totalTicks: number
}

export const SNAPSHOT_TICKS = 100
const MAX_TICKS = ticks(4 * 3600)

let cached: JourneyIndex | null = null

/** The journey index if it has been built already (never builds it). */
export function peekJourneyIndex(): JourneyIndex | null {
  return cached
}

/** The journey, flown once from the gate to the end of deboarding (cached). */
export function getJourneyIndex(): JourneyIndex {
  if (cached) return cached
  let a = createJourneyAircraft()
  const snapshots: SbAircraft[] = [a]
  const phaseStartTick = {} as Record<FlightPhase, number>
  const events: JourneyIndex['events'] = []
  const samples: JourneySample[] = []
  let phase = flightPhase(a)
  phaseStartTick[phase] = 0
  samples.push({ tick: 0, pos: a.pos, altitudeFt: a.altitudeFt, phase })
  while (a.journey!.phase !== 'complete') {
    const next = stepJourneyTick(a)
    const tick = next.journey!.tick
    if (tick > MAX_TICKS) throw new Error('journey did not complete')
    for (const kind of journeyEvents(a, next)) events.push({ kind, tick })
    const p = flightPhase(next)
    if (p !== phase) {
      phase = p
      if (phaseStartTick[p] === undefined) phaseStartTick[p] = tick
    }
    if (tick % SNAPSHOT_TICKS === 0) snapshots.push(next)
    if (tick % 100 === 0) samples.push({ tick, pos: next.pos, altitudeFt: next.altitudeFt, phase: p })
    a = next
  }
  for (const p of FLIGHT_PHASES) if (phaseStartTick[p] === undefined) throw new Error(`journey never reached ${p}`)
  cached = { snapshots, phaseStartTick, events, samples, totalTicks: a.journey!.tick }
  return cached
}

/** The journey aircraft at a given tick (from the nearest snapshot, stepped forward). */
export function journeyAt(tick: number): SbAircraft {
  const idx = getJourneyIndex()
  // Beyond the end the journey is complete and only its clock moves on.
  const t = Math.max(0, Math.round(tick))
  let a = idx.snapshots[Math.min(idx.snapshots.length - 1, Math.floor(t / SNAPSHOT_TICKS))]
  while (a.journey!.tick < t) a = stepJourneyTick(a)
  return a
}

/** Ticks of the next event of one of the given kinds after `tick` (or null). */
export function nextEventTick(tick: number, kinds: readonly JourneyEventKind[]): number | null {
  for (const e of getJourneyIndex().events) if (e.tick > tick && kinds.includes(e.kind)) return e.tick
  return null
}

// ---------------------------------------------------------------------------
// Smooth drawing between ticks
// ---------------------------------------------------------------------------

export interface JourneyPose {
  pos: Vec2
  altitudeFt: number
  headingDeg: number
  speedKt: number
  verticalSpeedFpm: number
  /** Position on the airport surface, m. */
  posM: Vec2
}

/** Interpolated pose between two consecutive ticks (heading the short way round). */
export function lerpPose(a: SbAircraft, b: SbAircraft, t: number): JourneyPose {
  const k = Math.max(0, Math.min(1, t))
  const pos = { x: a.pos.x + (b.pos.x - a.pos.x) * k, y: a.pos.y + (b.pos.y - a.pos.y) * k }
  return {
    pos,
    altitudeFt: a.altitudeFt + (b.altitudeFt - a.altitudeFt) * k,
    headingDeg: normalize360(a.headingDeg + angleDiff(a.headingDeg, b.headingDeg) * k),
    speedKt: a.speedKt + (b.speedKt - a.speedKt) * k,
    verticalSpeedFpm: b.verticalSpeedFpm,
    posM: { x: pos.x * METRES_PER_NM, y: pos.y * METRES_PER_NM },
  }
}
