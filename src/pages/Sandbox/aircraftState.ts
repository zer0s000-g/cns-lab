/**
 * How CNS700 looks: attitude, landing gear, exterior lights, and the PAPI
 * lights next to the runway as seen from the cockpit. Pure functions of the
 * journey state, so the 3D view never invents motion of its own.
 */

import { toDeg, toRad, type Vec2 } from '@/core/geometry'
import { ktToMs, METRES_PER_FT } from '@/core/units'
import { LAB_AIRPORT } from '@/core/world'
import { GPIP_X } from './journey'
import type { JourneyPhase } from './journey'
import { ROTATE_KT } from './ground'

const G = 9.80665
const ELEV = LAB_AIRPORT.elevationFt

/** Maximum bank shown, degrees (airliners rarely bank beyond 25–30°). */
export const MAX_BANK_DEG = 30
/** How fast the pitch attitude can change, degrees per second. */
export const PITCH_RATE_DEG_S = 3

/** Angle of attack added to the flight path angle to get the pitch attitude, degrees (illustrative). */
// TODO(expert-review): representative angles of attack in climb, cruise and approach.
function angleOfAttackDeg(phase: JourneyPhase): number {
  if (phase === 'final') return 3
  return 2.5
}

/**
 * Pitch attitude the aircraft is heading for, degrees nose-up. On the runway the
 * crew rotate just before lift-off; in the air pitch = flight path angle + angle of attack.
 */
export function targetPitchDeg(phase: JourneyPhase, speedKt: number, verticalSpeedFpm: number): number {
  if (phase === 'takeoff') return speedKt > ROTATE_KT - 8 ? 10 : 0
  if (phase !== 'plan' && phase !== 'final') return 0
  const gs = Math.max(1, ktToMs(speedKt))
  const vs = (verticalSpeedFpm * METRES_PER_FT) / 60
  return toDeg(Math.atan2(vs, gs)) + angleOfAttackDeg(phase)
}

/** Move the displayed pitch toward the target at a limited rate. */
export function stepPitch(current: number, target: number, dtS: number): number {
  const max = PITCH_RATE_DEG_S * Math.max(0, dtS)
  return current + Math.max(-max, Math.min(max, target - current))
}

/** Bank angle of a coordinated turn at this speed and turn rate: tan φ = v·ω / g (capped). */
export function bankDeg(speedKt: number, turnRateDegS: number, airborne: boolean): number {
  if (!airborne || !Number.isFinite(turnRateDegS)) return 0
  const phi = toDeg(Math.atan((ktToMs(speedKt) * toRad(turnRateDegS)) / G))
  return Math.max(-MAX_BANK_DEG, Math.min(MAX_BANK_DEG, phi))
}

/** Landing gear: retracted shortly after lift-off, extended for the final approach. */
export function gearDown(phase: JourneyPhase, altitudeFt: number, inbound: boolean): boolean {
  if (phase === 'plan') return !inbound && altitudeFt - ELEV < 100
  return true
}

export interface Lights {
  /** Red and green wing-tip and white tail lights. */
  nav: boolean
  /** Red rotating beacon: engines running or about to start. */
  beacon: boolean
  /** White flashing strobes: on the runway and in the air. */
  strobe: boolean
  /** Landing lights: take-off, and below 10,000 ft. */
  landing: boolean
  /** Taxi light on the nose gear. */
  taxi: boolean
}

// TODO(expert-review): typical airline exterior-light procedure (beacon from push-back, strobes entering the runway, landing lights below FL100).
export function exteriorLights(phase: JourneyPhase, altitudeFt: number, onRunway: boolean): Lights {
  const parked = phase === 'boarding' || phase === 'deboarding' || phase === 'complete'
  const airborne = phase === 'plan' || phase === 'final'
  return {
    nav: true,
    beacon: !parked,
    strobe: phase === 'lineup' || phase === 'takeoff' || airborne || (phase === 'rollout' && onRunway),
    landing: phase === 'takeoff' || (airborne && altitudeFt < 10000) || (phase === 'rollout' && onRunway),
    taxi: phase === 'pushback' || phase === 'taxiOut' || phase === 'holding' || phase === 'lineup' || phase === 'taxiIn' || (phase === 'rollout' && !onRunway),
  }
}

// ---------------------------------------------------------------------------
// PAPI
// ---------------------------------------------------------------------------

/** The PAPI stands beside the runway where the 3° glide path meets it, on the left (north) side. */
export const PAPI_POS_M: Vec2 = { x: GPIP_X * 1852, y: 38 }
/** Unit settings, degrees, from the unit farthest from the runway to the nearest. */
// TODO(expert-review): PAPI unit settings for a 3° approach (Annex 14: 2°30′, 2°50′, 3°10′, 3°30′ used here).
export const PAPI_SETTINGS_DEG = [2.5, 2 + 50 / 60, 3 + 10 / 60, 3.5] as const

/** Elevation angle of an aircraft seen from the PAPI, degrees. */
export function papiAngleDeg(posM: Vec2, altitudeFt: number): number {
  const d = Math.max(1, Math.hypot(posM.x - PAPI_POS_M.x, posM.y - PAPI_POS_M.y))
  return toDeg(Math.atan2((altitudeFt - ELEV) * METRES_PER_FT, d))
}

/**
 * What the pilot sees: true for a white light, false for red, from the unit
 * farthest from the runway to the nearest. On the glide path: two white, two red.
 */
export function papi(elevationDeg: number): boolean[] {
  return PAPI_SETTINGS_DEG.map((s) => elevationDeg > s)
}

/** Plain-words reading of the PAPI. */
export function papiReading(white: boolean[]): string {
  const n = white.filter(Boolean).length
  return n === 2 ? 'On the glide path' : n > 2 ? (n === 4 ? 'Far too high' : 'Slightly high') : n === 0 ? 'Far too low' : 'Slightly low'
}
