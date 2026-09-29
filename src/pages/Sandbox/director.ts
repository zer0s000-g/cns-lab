/**
 * The director decides what the learner sees and how fast time runs:
 * - the view follows the controller who owns the flight (airport for
 *   delivery, ground and tower; the terminal area for departure and approach;
 *   the region map for area and oceanic control);
 * - automatic time-lapse: slow on the runway, fast over the ocean;
 * - guided stops at four key moments;
 * - camera framing for each phase.
 * Pure functions and constants, no rendering.
 */

import { PHASE_UNIT, type AtcUnit } from './atc'
import type { FlightPhase } from './journey'
import type { JourneyEventKind } from './phases'

export type WorldView = 'airport' | 'terminal' | 'map'
export type ViewChoice = 'auto' | WorldView

export const UNIT_VIEW: Record<AtcUnit, WorldView> = {
  delivery: 'airport',
  ground: 'airport',
  tower: 'airport',
  departure: 'terminal',
  approach: 'terminal',
  area: 'map',
  oceanic: 'map',
}

export const VIEW_LABEL: Record<WorldView, string> = { airport: 'Airport', terminal: 'Terminal area', map: 'Region map' }

export const viewForPhase = (p: FlightPhase): WorldView => UNIT_VIEW[PHASE_UNIT[p]]
export const resolveView = (choice: ViewChoice, p: FlightPhase): WorldView => (choice === 'auto' ? viewForPhase(p) : choice)

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/** Clock speed steps of the sandbox. */
export const SANDBOX_SPEEDS = [1, 2, 4, 8, 16, 30, 60] as const

/** Automatic time-lapse for each phase. */
export const PHASE_SPEED: Record<FlightPhase, number> = {
  gate: 8,
  pushback: 4,
  taxi: 8,
  takeoff: 2,
  departure: 8,
  climb: 30,
  ocean: 60,
  descent: 30,
  approach: 16,
  landing: 4,
  taxiIn: 8,
  arrived: 8,
}

/** Near a guided stop, time slows so the moment itself is seen: at most ×8 when it is close. */
export const STOP_SLOWDOWN_MAX = 8

/** The largest allowed speed not above v. */
export function floorSpeed(v: number): number {
  let best: number = SANDBOX_SPEEDS[0]
  for (const s of SANDBOX_SPEEDS) if (s <= v) best = s
  return best
}

/**
 * Speed of the automatic time-lapse. `secsToNextStop` is the simulated time to
 * the next guided stop (null when there is none ahead): time slows down as it
 * approaches, so that the stop is at least about 3 s away on screen.
 */
export function autoSpeed(p: FlightPhase, secsToNextStop: number | null): number {
  let v = PHASE_SPEED[p]
  if (secsToNextStop !== null && secsToNextStop >= 0) v = Math.min(v, Math.max(STOP_SLOWDOWN_MAX, secsToNextStop / 3))
  return floorSpeed(v)
}

// ---------------------------------------------------------------------------
// Guided stops
// ---------------------------------------------------------------------------

export const STOP_EVENTS: readonly JourneyEventKind[] = ['takeoffClearance', 'oceanEntry', 'locCapture', 'touchdown']
export const isStopEvent = (k: JourneyEventKind) => STOP_EVENTS.includes(k)

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

export type CameraMode = 'follow' | 'tower' | 'overview'

export interface CameraIntent {
  /** Distance from the aircraft (airport: m; terminal table: scene units). */
  dist: number
  /** Height angle above the horizon, degrees. */
  elevDeg: number
  /** Bearing of the camera relative to the aircraft's heading, degrees (0 = ahead, 180 = behind). */
  yawDeg: number
  fov: number
}

/** Follow-camera framing in the airport view for each phase (metres, on a wide screen). */
const AIRPORT_FOLLOW: Record<FlightPhase, CameraIntent> = {
  gate: { dist: 120, elevDeg: 20, yawDeg: 228, fov: 38 },
  pushback: { dist: 130, elevDeg: 26, yawDeg: 305, fov: 38 },
  taxi: { dist: 150, elevDeg: 17, yawDeg: 200, fov: 38 },
  takeoff: { dist: 170, elevDeg: 11, yawDeg: 212, fov: 38 },
  departure: { dist: 280, elevDeg: 12, yawDeg: 200, fov: 38 },
  climb: { dist: 340, elevDeg: 12, yawDeg: 200, fov: 38 },
  ocean: { dist: 340, elevDeg: 12, yawDeg: 200, fov: 38 },
  descent: { dist: 340, elevDeg: 12, yawDeg: 200, fov: 38 },
  approach: { dist: 280, elevDeg: 10, yawDeg: 195, fov: 38 },
  landing: { dist: 190, elevDeg: 9, yawDeg: 200, fov: 38 },
  taxiIn: { dist: 150, elevDeg: 20, yawDeg: 160, fov: 38 },
  arrived: { dist: 120, elevDeg: 20, yawDeg: 228, fov: 38 },
}

/**
 * The follow camera backs off when the visible part of the view is narrow
 * (a phone held upright, or side panels covering a laptop screen), so the
 * aircraft and its surroundings still fit. `visibleAspect` = visible width / height.
 */
export function narrowViewFactor(visibleAspect: number): number {
  if (!(visibleAspect > 0)) return 1
  return Math.max(1, Math.min(2.2, 1.35 / visibleAspect))
}

/**
 * Framing for the follow camera. In the airport view the camera backs off as
 * the aircraft climbs, so the ground stays in view. `zoom` > 1 moves closer.
 */
export function followIntent(view: WorldView, p: FlightPhase, heightAboveGroundM: number, zoom: number, visibleAspect = 1.6): CameraIntent {
  const z = Math.max(0.25, Math.min(4, zoom))
  const k = narrowViewFactor(visibleAspect)
  if (view === 'airport') {
    const base = AIRPORT_FOLLOW[p]
    const h = Math.max(0, heightAboveGroundM)
    return { ...base, dist: ((base.dist + h * 0.35) * k) / z, elevDeg: base.elevDeg + Math.min(10, h / 120) }
  }
  // Terminal-area table (scene units: the table is 20 units across).
  return { dist: (7.5 * k) / z, elevDeg: 32, yawDeg: 205, fov: 36 }
}

/**
 * Field of view from the tower cab: the controller's binoculars. The aircraft
 * stays about `frameM` tall in the picture however far away it is.
 */
export function towerFovDeg(distanceM: number, frameM = 120): number {
  const d = Math.max(1, distanceM)
  const fov = (2 * Math.atan(frameM / 2 / d) * 180) / Math.PI
  return Math.max(4, Math.min(55, fov))
}

/** Camera clipping planes for a view and camera distance (keeps depth precision where it matters). */
export function clipPlanes(view: WorldView, distance: number): { near: number; far: number } {
  if (view === 'airport') {
    const near = Math.max(0.1, Math.min(4, distance / 250))
    return { near, far: Math.max(20000, distance * 4 + 8000) }
  }
  return { near: 0.05, far: 400 }
}
