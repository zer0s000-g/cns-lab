/**
 * Ground-based safety nets:
 *  - STCA (short-term conflict alert): two aircraft predicted to get too close.
 *  - MSAW (minimum safe altitude warning): an aircraft predicted to get too close to terrain.
 * Both work on the controller's tracks (position, velocity, altitude, vertical rate)
 * with straight-line prediction, as simple implementations do.
 */

import type { Vec2 } from './geometry'

export interface PredictState {
  id: string
  pos: Vec2
  /** Velocity, NM per second. */
  vel: Vec2
  altitudeFt: number
  /** Vertical speed, ft per minute. */
  verticalSpeedFpm: number
}

export interface StcaParams {
  /** Horizontal threshold, NM. */
  horizontalNm: number
  /** Vertical threshold, ft. */
  verticalFt: number
  /** How far ahead to predict, s. */
  lookaheadS: number
}

// TODO(expert-review): STCA thresholds and look-ahead are set per ANSP; these are illustrative (terminal area).
export const STCA_TMA: StcaParams = { horizontalNm: 3, verticalFt: 1000, lookaheadS: 120 }
export const STCA_ENROUTE: StcaParams = { horizontalNm: 5, verticalFt: 1000, lookaheadS: 120 }

export interface StcaResult {
  alert: boolean
  /** Time of closest horizontal approach within the look-ahead (clamped to [0, lookahead]), s. */
  tcpaS: number
  /** Horizontal distance at that time, NM. */
  minHorizontalNm: number
  /** Vertical distance at that time, ft. */
  verticalAtTcpaFt: number
  /** First time within the look-ahead when both thresholds are violated, or null. */
  timeToViolationS: number | null
  /** True if separation is already below both thresholds now. */
  violatedNow: boolean
}

/** Closest point of approach of two straight-line tracks. */
export function closestApproach(a: PredictState, b: PredictState, lookaheadS: number) {
  const dx = b.pos.x - a.pos.x
  const dy = b.pos.y - a.pos.y
  const dvx = b.vel.x - a.vel.x
  const dvy = b.vel.y - a.vel.y
  const vv = dvx * dvx + dvy * dvy
  let t = vv > 1e-15 ? -(dx * dvx + dy * dvy) / vv : 0
  t = Math.max(0, Math.min(lookaheadS, t))
  return { tcpaS: t, distanceNm: Math.hypot(dx + dvx * t, dy + dvy * t) }
}

function horizontalAt(a: PredictState, b: PredictState, t: number) {
  return Math.hypot(b.pos.x + b.vel.x * t - a.pos.x - a.vel.x * t, b.pos.y + b.vel.y * t - a.pos.y - a.vel.y * t)
}

function verticalAt(a: PredictState, b: PredictState, t: number) {
  return Math.abs(b.altitudeFt + (b.verticalSpeedFpm / 60) * t - (a.altitudeFt + (a.verticalSpeedFpm / 60) * t))
}

/** STCA for one pair of aircraft. */
export function stca(a: PredictState, b: PredictState, p: StcaParams = STCA_TMA): StcaResult {
  const cpa = closestApproach(a, b, p.lookaheadS)
  const violatedNow = horizontalAt(a, b, 0) < p.horizontalNm && verticalAt(a, b, 0) < p.verticalFt
  let tv: number | null = violatedNow ? 0 : null
  if (tv === null) {
    for (let t = 1; t <= p.lookaheadS; t += 1) {
      if (horizontalAt(a, b, t) < p.horizontalNm && verticalAt(a, b, t) < p.verticalFt) {
        tv = t
        break
      }
    }
  }
  return {
    alert: tv !== null,
    tcpaS: cpa.tcpaS,
    minHorizontalNm: cpa.distanceNm,
    verticalAtTcpaFt: verticalAt(a, b, cpa.tcpaS),
    timeToViolationS: tv,
    violatedNow,
  }
}

/** All alerting pairs among a set of aircraft. */
export function stcaAll(states: PredictState[], p: StcaParams = STCA_TMA): { a: string; b: string; result: StcaResult }[] {
  const out: { a: string; b: string; result: StcaResult }[] = []
  for (let i = 0; i < states.length; i++) {
    for (let j = i + 1; j < states.length; j++) {
      const r = stca(states[i], states[j], p)
      if (r.alert) out.push({ a: states[i].id, b: states[j].id, result: r })
    }
  }
  return out
}

export interface MsawParams {
  /** Minimum clearance above terrain, ft. */
  clearanceFt: number
  lookaheadS: number
  stepS: number
}

// TODO(expert-review): MSAW clearance and look-ahead are set per ANSP; these are illustrative.
export const MSAW_DEFAULT: MsawParams = { clearanceFt: 1000, lookaheadS: 60, stepS: 2 }

export interface MsawResult {
  alert: boolean
  /** First predicted time the clearance is broken, s (0 = already), or null. */
  timeToViolationS: number | null
  /** Smallest predicted clearance above terrain within the look-ahead, ft. */
  minClearanceFt: number
  /** Where the smallest clearance occurs. */
  worstPoint: Vec2
}

/**
 * MSAW: predicts the aircraft along a straight line with its current vertical
 * speed and compares its altitude with the terrain below plus a clearance.
 * `inhibit(pos, alt)` returns true inside areas where alerts are suppressed
 * (e.g. the final approach funnel to a runway, where aircraft are meant to be low).
 */
export function msaw(
  s: PredictState,
  terrain: (p: Vec2) => number,
  p: MsawParams = MSAW_DEFAULT,
  inhibit?: (pos: Vec2, altitudeFt: number) => boolean,
): MsawResult {
  let tv: number | null = null
  let minClear = Infinity
  let worst = s.pos
  for (let t = 0; t <= p.lookaheadS + 1e-9; t += p.stepS) {
    const pos = { x: s.pos.x + s.vel.x * t, y: s.pos.y + s.vel.y * t }
    const alt = s.altitudeFt + (s.verticalSpeedFpm / 60) * t
    if (inhibit?.(pos, alt)) continue
    const clear = alt - terrain(pos)
    if (clear < minClear) {
      minClear = clear
      worst = pos
    }
    if (tv === null && clear < p.clearanceFt) tv = t
  }
  return { alert: tv !== null, timeToViolationS: tv, minClearanceFt: minClear, worstPoint: worst }
}
