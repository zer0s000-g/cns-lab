/**
 * The journey of CNS700: departure, climb, en-route, ocean, return and an
 * ILS approach to runway 09. A leg is flown toward its waypoint with the
 * leg's target altitude and speed; the aircraft model limits turn, climb and
 * acceleration, so the flight stays physically plausible.
 */

import { distanceNm, type Vec2 } from '@/core/geometry'
import { LAB_AIRPORT } from '@/core/world'
import { FT_PER_NM } from '@/core/units'

export interface Leg {
  to: Vec2
  altitudeFt: number
  speedKt: number
  stage: Stage
}

export type Stage = 'Departure' | 'Climb' | 'En-route' | 'Ocean' | 'Return' | 'Approach' | 'Landing' | 'Landed'

export const STAGES: Stage[] = ['Departure', 'Climb', 'En-route', 'Ocean', 'Return', 'Approach', 'Landing']

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

export const JOURNEY: Leg[] = [
  { to: { x: 12, y: 0 }, altitudeFt: 10000, speedKt: 250, stage: 'Departure' },
  { to: { x: 45, y: 6 }, altitudeFt: 24000, speedKt: 330, stage: 'Climb' },
  { to: { x: 110, y: 10 }, altitudeFt: 35000, speedKt: 460, stage: 'Climb' },
  // Far enough out (beyond ~250 NM from the coastal ADS-B station) that only
  // satellite links remain.
  { to: { x: 360, y: 8 }, altitudeFt: 35000, speedKt: 460, stage: 'Ocean' },
  { to: { x: 372, y: -26 }, altitudeFt: 35000, speedKt: 460, stage: 'Ocean' },
  // Top of descent at the turn: 35,000 ft is too high to arrive on the ILS in time otherwise.
  { to: { x: 130, y: -34 }, altitudeFt: 28000, speedKt: 460, stage: 'Return' },
  { to: { x: 55, y: -30 }, altitudeFt: 12000, speedKt: 330, stage: 'Return' },
  { to: { x: 12, y: -24 }, altitudeFt: 8000, speedKt: 250, stage: 'Approach' },
  { to: { x: -18, y: -12 }, altitudeFt: 4000, speedKt: 210, stage: 'Approach' },
  // Turn onto a 30° intercept of the final approach course.
  { to: { x: INTERCEPT.x - 6, y: -3.5 }, altitudeFt: 3000, speedKt: 180, stage: 'Approach' },
  { to: INTERCEPT, altitudeFt: 3000, speedKt: 160, stage: 'Approach' },
]

export const JOURNEY_START = {
  pos: { x: THRESHOLD.x + 1.7, y: 0 },
  altitudeFt: 700,
  headingDeg: 90,
  speedKt: 165,
}

/** Total planned track length, NM (for progress bars). */
export function journeyLengthNm(): number {
  let d = 0
  let p = JOURNEY_START.pos
  for (const l of JOURNEY) {
    d += distanceNm(p, l.to)
    p = l.to
  }
  return d + distanceNm(INTERCEPT, THRESHOLD)
}
