/**
 * The journey of CNS700, gate to gate: boarding at stand S3, push-back, taxi
 * to runway 09, take-off, climb out over the ocean, a turn far offshore, the
 * return and an ILS approach to runway 09, landing, taxi-in and deboarding.
 *
 * Airborne, a leg is flown toward its waypoint with the leg's target altitude
 * and speed; the aircraft model limits turn, climb and acceleration, so the
 * flight stays physically plausible. On the ground the aircraft follows the
 * airport's taxi routes (ground.ts).
 */

import { distanceNm, type Vec2 } from '@/core/geometry'
import { LAB_AIRPORT } from '@/core/world'
import { FT_PER_NM } from '@/core/units'

export interface Leg {
  to: Vec2
  altitudeFt: number
  speedKt: number
}

const RWY = LAB_AIRPORT.runways[0]
export const THRESHOLD = RWY.threshold
/** Glide path angle, degrees. */
export const GS_ANGLE_DEG = 3
/** Threshold crossing height, ft. */
export const TCH_FT = 50
/** Where the glide path meets the runway, NM past the threshold (TCH / tan θ). */
export const GPIP_X = THRESHOLD.x + TCH_FT / Math.tan((GS_ANGLE_DEG * Math.PI) / 180) / FT_PER_NM

/** Glide path altitude (ft MSL) at a distance along the approach (x in the world frame). */
export function glidePathAltitudeFt(x: number): number {
  const d = Math.max(0, GPIP_X - x) // NM before the glide path origin
  return LAB_AIRPORT.elevationFt + d * FT_PER_NM * Math.tan((GS_ANGLE_DEG * Math.PI) / 180)
}

/** Final approach intercept point: 13 NM from the threshold on the extended centreline. */
export const INTERCEPT: Vec2 = { x: THRESHOLD.x - 13, y: 0 }
/** The approach stays at this altitude until the glide path comes down to meet it, ft. */
export const INTERCEPT_ALT_FT = 3000

export const JOURNEY: Leg[] = [
  { to: { x: 12, y: 0 }, altitudeFt: 10000, speedKt: 250 },
  { to: { x: 45, y: 6 }, altitudeFt: 24000, speedKt: 330 },
  { to: { x: 110, y: 10 }, altitudeFt: 35000, speedKt: 460 },
  // Far enough out (beyond ~250 NM from the coastal ADS-B station) that only
  // satellite links remain.
  { to: { x: 360, y: 8 }, altitudeFt: 35000, speedKt: 460 },
  { to: { x: 372, y: -26 }, altitudeFt: 35000, speedKt: 460 },
  // Top of descent at the turn: 35,000 ft is too high to arrive on the ILS in time otherwise.
  { to: { x: 130, y: -34 }, altitudeFt: 28000, speedKt: 460 },
  { to: { x: 55, y: -30 }, altitudeFt: 12000, speedKt: 330 },
  { to: { x: 12, y: -24 }, altitudeFt: 8000, speedKt: 250 },
  { to: { x: -18, y: -12 }, altitudeFt: 4000, speedKt: 210 },
  { to: { x: INTERCEPT.x - 6, y: -3.5 }, altitudeFt: INTERCEPT_ALT_FT, speedKt: 180 },
  // A 30° intercept of the final approach course (heading 060 onto course 090).
  { to: INTERCEPT, altitudeFt: INTERCEPT_ALT_FT, speedKt: 160 },
]

/** Index of the first leg over the ocean (the legs before it are outbound). */
export const FIRST_OCEAN_LEG = 3
/** Index of the first leg of the return. */
export const FIRST_RETURN_LEG = 5
/** Index of the last leg: the 30° intercept heading onto the final approach course. */
export const INTERCEPT_LEG = 10

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/** The journey advances in fixed steps of this length, s (whatever the frame rate). */
export const TICK_S = 0.1
export const ticks = (s: number) => Math.round(s / TICK_S)

/** Boarding, shortened from about 25 minutes so the learner is not kept waiting, s. */
export const BOARDING_S = 360
/** Delivery reads out the departure clearance this long into boarding, s. */
export const CLEARANCE_AT_S = 45
/** The crew asks for push-back this long into boarding, s. */
export const REQUEST_PUSH_AT_S = 340
/** After the push-back: tug disconnect and engine start, s. */
export const STARTUP_S = 30
/** Waiting at the holding point before the line-up clearance, s. */
export const HOLD_S = 20
/** Lined up on the runway before the take-off clearance, s. */
export const LINED_S = 8
/** Deboarding, shortened, s. */
export const DEBOARDING_S = 240

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

/** What the journey is doing (the engine's view). */
export type JourneyPhase =
  | 'boarding'
  | 'pushback'
  | 'taxiOut'
  | 'holding'
  | 'lineup'
  | 'takeoff'
  | 'plan'
  | 'final'
  | 'rollout'
  | 'taxiIn'
  | 'deboarding'
  | 'complete'

export const GROUND_PHASES: readonly JourneyPhase[] = ['boarding', 'pushback', 'taxiOut', 'holding', 'lineup', 'takeoff', 'rollout', 'taxiIn', 'deboarding', 'complete']

/** The twelve phases of the flight shown to the learner, in order. */
export type FlightPhase = 'gate' | 'pushback' | 'taxi' | 'takeoff' | 'departure' | 'climb' | 'ocean' | 'descent' | 'approach' | 'landing' | 'taxiIn' | 'arrived'

export const FLIGHT_PHASES: readonly FlightPhase[] = ['gate', 'pushback', 'taxi', 'takeoff', 'departure', 'climb', 'ocean', 'descent', 'approach', 'landing', 'taxiIn', 'arrived']

export const PHASE_LABEL: Record<FlightPhase, string> = {
  gate: 'At the gate',
  pushback: 'Push-back',
  taxi: 'Taxi',
  takeoff: 'Take-off',
  departure: 'Departure',
  climb: 'Climb',
  ocean: 'Ocean',
  descent: 'Descent',
  approach: 'Approach',
  landing: 'Landing',
  taxiIn: 'Taxi-in',
  arrived: 'Arrived',
}

/** Short labels for the timeline chips. */
export const PHASE_SHORT: Record<FlightPhase, string> = {
  gate: 'Gate',
  pushback: 'Push-back',
  taxi: 'Taxi',
  takeoff: 'Take-off',
  departure: 'Departure',
  climb: 'Climb',
  ocean: 'Ocean',
  descent: 'Descent',
  approach: 'Approach',
  landing: 'Landing',
  taxiIn: 'Taxi-in',
  arrived: 'Arrived',
}

/** Handover from Tower to Departure: passing this altitude after take-off, ft. */
// TODO(expert-review): typical altitude for the tower-to-departure transfer (local procedures vary).
export const TOWER_TO_DEPARTURE_FT = 2000
/** Radius of the terminal control area around the airport, NM (Departure and Approach inside, Area control outside). */
// TODO(expert-review): TMA dimensions are set per airport; 40 NM is illustrative.
export const TMA_RADIUS_NM = 40
/** Handover from Approach to Tower on the final approach, NM from the threshold. */
// TODO(expert-review): typical distance for the approach-to-tower transfer on final (about 6–10 NM).
export const APPROACH_TO_TOWER_NM = 8

/** Total planned airborne track length from the runway, NM. */
export function journeyLengthNm(): number {
  let d = 0
  let p: Vec2 = { x: 0, y: 0 }
  for (const l of JOURNEY) {
    d += distanceNm(p, l.to)
    p = l.to
  }
  return d + distanceNm(INTERCEPT, THRESHOLD)
}
