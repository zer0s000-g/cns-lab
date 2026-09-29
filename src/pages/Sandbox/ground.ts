/**
 * CNS700 on the ground: push-back, taxi, line-up, take-off roll, landing
 * roll-out and taxi-in. Everything is in METRES on the airport surface frame
 * of the Surface Movement module (x east, y north, same origin as the NM world
 * frame), and reuses its layout and path builders so both pages agree.
 *
 * Pure functions: every call returns a new state and never mutates its input.
 * The aircraft model of the flight (core/world) is never used on the ground,
 * because it cannot fly slower than the aircraft's minimum airborne speed.
 */

import { angleDiff, normalize360, type Vec2 } from '@/core/geometry'
import { approachSpeed, makePath, pointAt, stopSpeedLimitMs, turnSpeedLimitKt, type Path } from '@/core/surface'
import { ktToMs } from '@/core/units'
import {
  arrivalPath,
  lineupPath,
  pushbackWestPath,
  RWY,
  STANDS,
  STOP_BAR_Y,
  takeoffPath,
  taxiOutPath,
  turnoffAlong,
} from '@/modules/surface/layout'

// The same values as the Surface Movement engine (a test checks they match).
/** Taxi speed on straight taxiways, kt. */
export const TAXI_KT = 18
/** Take-off acceleration on the runway, m/s². */
export const TAKEOFF_ACCEL = 2.0
/** Rotation speed: the aircraft lifts off here, kt. */
export const ROTATE_KT = 150
/** Normal braking after landing, m/s². */
export const ROLLOUT_DECEL = 1.7
/** Maximum braking, m/s². */
export const MAX_BRAKE = 3.5

/** Push-back speed (walking pace behind the tug), kt. */
// TODO(expert-review): typical push-back speed (about 3 kt).
export const PUSHBACK_KT = 3
/** Taxi-in speed, kt. */
export const TAXI_IN_KT = 16
/** Line-up speed, kt. */
export const LINEUP_KT = 8
/** Speed at which the arrival leaves the runway at A3, kt. */
export const TURNOFF_KT = 15

/** CNS700's stand. */
export const HOME_STAND = 'S3'
export const HOME_STAND_POS: Vec2 = STANDS[HOME_STAND]

export interface GroundState {
  /** Path being followed (null while standing still on the stand). */
  path: Path | null
  /** Distance along the path, m. */
  s: number
  speedMs: number
  /** Moving tail first (push-back). */
  reverse: boolean
  /** Position, m. */
  posM: Vec2
  /** Heading, degrees true (where the nose points). */
  headingDeg: number
}

/** Parked on the stand, nose toward the terminal (north). */
export function parkedAt(stand: Vec2 = HOME_STAND_POS): GroundState {
  return { path: null, s: 0, speedMs: 0, reverse: false, posM: { ...stand }, headingDeg: 0 }
}

/** Start following a new path from the current position (speed carries over). */
export function startPath(g: GroundState, path: Path, reverse = false): GroundState {
  return { ...g, path, s: 0, reverse }
}

/** Place the aircraft at distance s along its path; the heading swings toward the track at a limited rate. */
function place(g: GroundState, s: number, speedMs: number, dt: number, maxTurnDegS = 25): GroundState {
  if (!g.path) return { ...g, speedMs }
  const at = pointAt(g.path, s)
  const want = g.reverse ? normalize360(at.trackDeg + 180) : at.trackDeg
  const d = angleDiff(g.headingDeg, want)
  const maxTurn = maxTurnDegS * dt
  return { ...g, s, speedMs, posM: at.pos, headingDeg: normalize360(g.headingDeg + Math.max(-maxTurn, Math.min(maxTurn, d))) }
}

export interface FollowOptions {
  cruiseKt: number
  /** m/s² */
  accel: number
  /** m/s² */
  decel: number
  /** Come to a stop at the end of the path. */
  stopAtEnd: boolean
  /** How fast the nose can swing, degrees per second (default 25). */
  maxTurnDegS?: number
}

/**
 * Move along the path: the target speed respects the cruise speed, slower
 * speeds for bends ahead, and stopping at the end of the path.
 */
export function followPath(g: GroundState, dt: number, o: FollowOptions): GroundState {
  if (!g.path || dt <= 0) return g
  let target = ktToMs(Math.min(o.cruiseKt, turnSpeedLimitKt(g.path, g.s, 60, o.cruiseKt)))
  if (o.stopAtEnd) target = Math.min(target, stopSpeedLimitMs(g.path.length - g.s, o.decel * 0.8))
  const v = approachSpeed(g.speedMs, target, dt, o.accel, o.decel)
  const s = Math.min(g.path.length, g.s + v * dt)
  // At the end of the path: keep braking to a standstill there (no creeping, no sudden stop).
  if (g.path.length - s < 0.05) return place(g, g.path.length, Math.max(0, g.speedMs - o.decel * dt), dt, o.maxTurnDegS)
  return place(g, s, v, dt, o.maxTurnDegS)
}

/** At the end of the path and stopped. */
export function atPathEnd(g: GroundState): boolean {
  return !!g.path && g.s >= g.path.length - 0.05 && g.speedMs <= 1e-9
}

// ---------------------------------------------------------------------------
// Departure
// ---------------------------------------------------------------------------

export const pushbackPath = () => pushbackWestPath(HOME_STAND_POS)
export const taxiOutFrom = (p: Vec2) => taxiOutPath(p)
export { lineupPath }

/** Push-back turns are gentle: the tug swings the aircraft slowly. */
// TODO(expert-review): typical yaw rate of an aircraft being pushed back (a few degrees per second).
export const PUSHBACK_TURN_DEG_S = 5
export const pushbackStep = (g: GroundState, dt: number) => followPath(g, dt, { cruiseKt: PUSHBACK_KT, accel: 0.3, decel: 0.5, stopAtEnd: true, maxTurnDegS: PUSHBACK_TURN_DEG_S })
export const taxiOutStep = (g: GroundState, dt: number) => followPath(g, dt, { cruiseKt: TAXI_KT, accel: 0.8, decel: 1.2, stopAtEnd: true })
export const lineupStep = (g: GroundState, dt: number) => followPath(g, dt, { cruiseKt: LINEUP_KT, accel: 0.6, decel: 1.0, stopAtEnd: true })
export const taxiInStep = (g: GroundState, dt: number) => followPath(g, dt, { cruiseKt: TAXI_IN_KT, accel: 0.8, decel: 1.2, stopAtEnd: true })

/** The runway ahead of a lined-up aircraft, to the far end. */
export const takeoffRunway = (from: Vec2) => takeoffPath(from)

/**
 * One step of the take-off roll: full power, constant acceleration along the
 * centreline. Lift-off happens when the rotation speed is reached.
 */
export function takeoffRollStep(g: GroundState, dt: number): { g: GroundState; liftoff: boolean } {
  if (!g.path) return { g, liftoff: false }
  const vr = ktToMs(ROTATE_KT)
  const v = Math.min(vr, g.speedMs + TAKEOFF_ACCEL * dt)
  const s = Math.min(g.path.length, g.s + ((g.speedMs + v) / 2) * dt)
  const next = place(g, s, v, dt)
  return { g: next, liftoff: v >= vr - 1e-9 }
}

// ---------------------------------------------------------------------------
// Arrival
// ---------------------------------------------------------------------------

/** The landing roll from the actual touchdown point, exit at A3 and taxi to the stand. */
export function arrivalFrom(touchdownM: Vec2, stand: Vec2 = HOME_STAND_POS): Path {
  const plan = arrivalPath(stand)
  return makePath([{ x: touchdownM.x, y: touchdownM.y }, ...plan.points.slice(1)])
}

/** Ground state at touchdown: on the arrival path, rolling at the touchdown speed. */
export function touchdownGround(touchdownM: Vec2, speedMs: number, headingDeg: number, stand: Vec2 = HOME_STAND_POS): GroundState {
  const path = arrivalFrom(touchdownM, stand)
  return { path, s: 0, speedMs, reverse: false, posM: { ...path.points[0] }, headingDeg }
}

/** Distance along the arrival path of the A3 turn-off, m. */
export const turnoffS = (path: Path) => turnoffAlong(path)

/**
 * One step of the landing roll: brake along a profile that arrives at the
 * turn-off at taxi speed (normal braking, harder if needed), then follow the
 * exit.
 */
export function rolloutStep(g: GroundState, dt: number): GroundState {
  if (!g.path) return g
  const sTurn = turnoffS(g.path)
  const vTurn = ktToMs(TURNOFF_KT)
  const target = g.s < sTurn ? Math.sqrt(vTurn * vTurn + 2 * ROLLOUT_DECEL * (sTurn - g.s)) : vTurn
  const v = approachSpeed(g.speedMs, target, dt, 1, MAX_BRAKE)
  const s = Math.min(g.path.length, g.s + ((g.speedMs + v) / 2) * dt)
  return place(g, s, v, dt)
}

/** The roll-out ends (taxi-in begins) once the aircraft is well into the exit. */
export const rolloutDone = (g: GroundState) => !!g.path && g.s > turnoffS(g.path) + 45

/** Beyond the runway-holding position: the runway is vacated. */
export const clearOfRunway = (posM: Vec2) => Math.abs(posM.y - RWY.centreY) > STOP_BAR_Y - RWY.centreY

export { RWY, STOP_BAR_Y }
