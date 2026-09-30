/**
 * Simulation clock: play, pause and speed (0.25x to 4x by default), plus a
 * "slow motion" factor used only to visualise radio signals.
 *
 * Two kinds of time exist in CNS Lab:
 *   - world time: aircraft move, antennas rotate. Runs at `speed` × real time.
 *   - signal time: a microsecond-scale radio event replayed so slowly that a
 *     person can watch it. While a slow-motion replay runs, world time is frozen,
 *     because in a few hundred microseconds nothing in the world moves visibly.
 */

import { clamp } from './units'

/** The speed steps from the development guide. */
export const DEFAULT_SPEEDS = [0.25, 0.5, 1, 2, 4] as const

/** Largest real frame time we accept, s. Protects against jumps after a tab was hidden. */
export const MAX_FRAME_S = 0.1

export interface ClockState {
  running: boolean
  speed: number
  /** Elapsed world time, s. */
  timeS: number
  /** Allowed speed steps for this clock. */
  speeds: readonly number[]
}

export function createClock(opts: Partial<Pick<ClockState, 'running' | 'speed' | 'speeds'>> = {}): ClockState {
  const speeds = opts.speeds ?? DEFAULT_SPEEDS
  const speed = opts.speed ?? 1
  return {
    running: opts.running ?? true,
    speed: nearestSpeed(speed, speeds),
    timeS: 0,
    speeds,
  }
}

/** Snap a speed to the nearest allowed step. */
export function nearestSpeed(speed: number, speeds: readonly number[] = DEFAULT_SPEEDS): number {
  let best = speeds[0]
  for (const s of speeds) if (Math.abs(Math.log(s / speed)) < Math.abs(Math.log(best / speed))) best = s
  return best
}

/**
 * Advance the clock by a real frame time. Returns the new state and the world
 * time step (0 while paused). Real time is clamped to MAX_FRAME_S.
 */
export function tickClock(state: ClockState, realDtS: number): { state: ClockState; dt: number } {
  if (!state.running || !(realDtS > 0)) return { state, dt: 0 }
  const dt = clamp(realDtS, 0, MAX_FRAME_S) * state.speed
  return { state: { ...state, timeS: state.timeS + dt }, dt }
}

export const play = (s: ClockState): ClockState => ({ ...s, running: true })
export const pause = (s: ClockState): ClockState => ({ ...s, running: false })
export const togglePlay = (s: ClockState): ClockState => ({ ...s, running: !s.running })
export const setSpeed = (s: ClockState, speed: number): ClockState => ({ ...s, speed: nearestSpeed(speed, s.speeds) })

/** Step the speed up or down one notch. */
export function stepSpeed(s: ClockState, direction: 1 | -1): ClockState {
  const i = s.speeds.indexOf(s.speed)
  const j = clamp(i + direction, 0, s.speeds.length - 1)
  return { ...s, speed: s.speeds[j] }
}

/** Human label for a clock speed, e.g. "Real time", "Sped up 4×", "Slowed down 0.25×". */
export function speedLabel(speed: number): string {
  if (speed === 1) return 'Real time'
  return speed > 1 ? `Sped up ${speed}×` : `Slowed down ${speed}×`
}

// ---------------------------------------------------------------------------
// Slow motion for radio signals
// ---------------------------------------------------------------------------

export interface SlowMotion {
  /** Real seconds on screen per one microsecond of signal time. */
  realSecondsPerMicrosecond: number
}

/** Convert a real frame time (s) into signal time (µs) for a slow-motion replay. */
export function realToSignalUs(realDtS: number, sm: SlowMotion): number {
  return clamp(realDtS, 0, MAX_FRAME_S) / sm.realSecondsPerMicrosecond
}

/** Choose a slow-motion factor so that an event lasting `eventUs` plays in about `targetRealS`. */
export function slowMotionFor(eventUs: number, targetRealS: number): SlowMotion {
  // A target of 0 s (or less) would be infinitely fast; show the event over at least 1 ms.
  return { realSecondsPerMicrosecond: Math.max(targetRealS, 1e-3) / Math.max(eventUs, 1e-9) }
}

/** How many times slower than reality a slow-motion setting is (e.g. 20,000×). */
export function slowdownFactor(sm: SlowMotion): number {
  return sm.realSecondsPerMicrosecond * 1e6
}

/** Friendly description, e.g. "1 second on screen = 10 microseconds". */
export function slowMotionLabel(sm: SlowMotion): string {
  const usPerSecond = 1 / sm.realSecondsPerMicrosecond
  let v: string
  if (usPerSecond >= 1000) v = `${formatSig(usPerSecond / 1000)} milliseconds`
  else if (usPerSecond >= 1) v = `${formatSig(usPerSecond)} microseconds`
  else v = `${formatSig(usPerSecond * 1000)} nanoseconds`
  return `1 second on screen = ${v} of real time`
}

function formatSig(v: number): string {
  if (v >= 100) return Math.round(v).toLocaleString('en-US')
  if (v >= 10) return v.toFixed(0)
  return Number(v.toPrecision(2)).toString()
}
