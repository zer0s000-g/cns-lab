/**
 * The shared CNS Lab world: one airport at the origin, a simple terrain
 * height map (hills, a mountain range and an ocean to the east) and an
 * aircraft model that can be dragged or flown with heading, speed and
 * altitude targets.
 *
 * Frame: x east, y north, NM. Altitudes in ft above mean sea level.
 * Headings are TRUE degrees. There is no wind in CNS Lab, so the aircraft's
 * track equals its heading and its ground speed equals its true airspeed.
 */

import {
  angleDiff,
  bearingDeg,
  bearingVector,
  distanceNm,
  normalize360,
  type LatLon,
  type Vec2,
} from './geometry'
import { clamp, FT_PER_NM, ktToNmPerS } from './units'
import { positiveStep } from './guard'

// ---------------------------------------------------------------------------
// Airport
// ---------------------------------------------------------------------------

export interface Runway {
  /** e.g. "09/27" */
  id: string
  /** Designator of the end aircraft land on when approaching along headingTrue. */
  landingEnd: string
  /** Threshold of the landing end (map point). */
  threshold: Vec2
  /** Far end of the runway (map point). */
  end: Vec2
  /** Runway heading (true) for landing at `landingEnd`. */
  headingTrue: number
  lengthFt: number
  widthFt: number
}

export interface Airport {
  icao: string
  name: string
  /** Latitude/longitude of the airport reference point (the map origin). */
  ref: LatLon
  elevationFt: number
  runways: Runway[]
}

/** Runway length 3,000 m ≈ 9,843 ft ≈ 1.62 NM. */
const RWY_LENGTH_FT = 9843
const RWY_HALF_NM = RWY_LENGTH_FT / FT_PER_NM / 2

/**
 * The fictional CNS Lab airport. Runway 09/27 runs exactly east-west through
 * the origin. The reference position is a made-up tropical coastal location.
 */
export const LAB_AIRPORT: Airport = {
  icao: 'XCNS',
  name: 'CNS Lab International (fictional)',
  ref: { lat: -6.2, lon: 106.8 },
  elevationFt: 30,
  runways: [
    {
      id: '09/27',
      landingEnd: '09',
      threshold: { x: -RWY_HALF_NM, y: 0 },
      end: { x: RWY_HALF_NM, y: 0 },
      headingTrue: 90,
      lengthFt: RWY_LENGTH_FT,
      widthFt: 148,
    },
  ],
}

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

export interface Hill {
  name?: string
  center: Vec2
  /** Peak height above mean sea level, ft. */
  peakFt: number
  /** Gaussian spread (one standard deviation), NM. */
  sigmaNm: number
}

export interface Terrain {
  hills: Hill[]
  /** Coastline: points with x greater than coastX(y) are ocean. */
  coastX: (y: number) => number
}

/** Default terrain: a mountain range to the north-west, a lone hill and an ocean to the east. */
export const DEFAULT_TERRAIN: Terrain = {
  hills: [
    { name: 'Mount Sentinel', center: { x: -18, y: 8 }, peakFt: 4500, sigmaNm: 2.2 },
    { name: 'North Range', center: { x: -30, y: 26 }, peakFt: 9000, sigmaNm: 5 },
    { name: 'North Range', center: { x: -22, y: 34 }, peakFt: 7600, sigmaNm: 4.5 },
    { name: 'North Range', center: { x: -40, y: 18 }, peakFt: 8200, sigmaNm: 5 },
    { name: 'North Range', center: { x: -12, y: 42 }, peakFt: 6000, sigmaNm: 4 },
    { name: 'West Hills', center: { x: -32, y: -14 }, peakFt: 2500, sigmaNm: 4 },
    { name: 'South Ridge', center: { x: 6, y: -34 }, peakFt: 3200, sigmaNm: 3.5 },
  ],
  coastX: (y: number) => 40 + 4 * Math.sin(y / 9) + 2 * Math.sin(y / 3.7),
}

/** True when the point lies over the ocean. */
export function isWater(p: Vec2, terrain: Terrain = DEFAULT_TERRAIN): boolean {
  return p.x > terrain.coastX(p.y)
}

/** Terrain elevation above mean sea level at a map point, ft (0 over water). */
export function terrainElevationFt(p: Vec2, terrain: Terrain = DEFAULT_TERRAIN): number {
  if (isWater(p, terrain)) return 0
  let h = 0
  for (const hill of terrain.hills) {
    const dx = p.x - hill.center.x
    const dy = p.y - hill.center.y
    h += hill.peakFt * Math.exp(-(dx * dx + dy * dy) / (2 * hill.sigmaNm * hill.sigmaNm))
  }
  // Flat coastal plain around the airport at airport elevation.
  return Math.max(LAB_AIRPORT.elevationFt, h)
}

/** A terrain function bound to a terrain definition (for propagation.lineOfSight). */
export function terrainFn(terrain: Terrain = DEFAULT_TERRAIN) {
  return (p: Vec2) => terrainElevationFt(p, terrain)
}

/** Sample terrain on a regular grid (row-major, north row first), for drawing. */
export function sampleTerrainGrid(
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  cols: number,
  rows: number,
  terrain: Terrain = DEFAULT_TERRAIN,
): { heights: Float32Array; water: Uint8Array; cols: number; rows: number } {
  const heights = new Float32Array(cols * rows)
  const water = new Uint8Array(cols * rows)
  for (let r = 0; r < rows; r++) {
    const y = maxY - ((r + 0.5) / rows) * (maxY - minY)
    for (let c = 0; c < cols; c++) {
      const x = minX + ((c + 0.5) / cols) * (maxX - minX)
      const p = { x, y }
      const i = r * cols + c
      water[i] = isWater(p, terrain) ? 1 : 0
      heights[i] = terrainElevationFt(p, terrain)
    }
  }
  return { heights, water, cols, rows }
}

// ---------------------------------------------------------------------------
// Aircraft
// ---------------------------------------------------------------------------

export type AircraftCategory = 'light' | 'medium' | 'heavy'

export interface AircraftPerformance {
  /** Maximum turn rate, deg/s (3 °/s is a "standard rate" turn). */
  turnRateDegS: number
  climbFpm: number
  descentFpm: number
  /** Speed change rate, kt per second. */
  accelKtS: number
  minSpeedKt: number
  maxSpeedKt: number
}

export const PERFORMANCE: Record<AircraftCategory, AircraftPerformance> = {
  light: { turnRateDegS: 3, climbFpm: 700, descentFpm: 700, accelKtS: 1.5, minSpeedKt: 60, maxSpeedKt: 170 },
  medium: { turnRateDegS: 3, climbFpm: 2000, descentFpm: 1800, accelKtS: 2, minSpeedKt: 120, maxSpeedKt: 480 },
  heavy: { turnRateDegS: 3, climbFpm: 1800, descentFpm: 1800, accelKtS: 1.5, minSpeedKt: 130, maxSpeedKt: 500 },
}

export type AutopilotMode =
  | { kind: 'heading' }
  | { kind: 'orbit'; center: Vec2; radiusNm: number; clockwise: boolean }
  | { kind: 'direct'; to: Vec2; thenHeading?: number }
  | { kind: 'route'; waypoints: Vec2[]; index: number; loop: boolean }

export interface Aircraft {
  id: string
  callsign: string
  category: AircraftCategory
  pos: Vec2
  altitudeFt: number
  /** True heading = true track (no wind). */
  headingDeg: number
  /** Ground speed, kt. */
  speedKt: number
  /** Current vertical speed, ft/min (derived while climbing/descending). */
  verticalSpeedFpm: number
  targetHeadingDeg: number
  targetAltitudeFt: number
  targetSpeedKt: number
  mode: AutopilotMode
  /** When true the aircraft is being dragged and does not move by itself. */
  held?: boolean
}

export interface AircraftInit {
  id: string
  callsign?: string
  category?: AircraftCategory
  pos: Vec2
  altitudeFt: number
  headingDeg: number
  speedKt: number
}

export function createAircraft(init: AircraftInit): Aircraft {
  const heading = normalize360(init.headingDeg)
  return {
    id: init.id,
    callsign: init.callsign ?? init.id,
    category: init.category ?? 'medium',
    pos: { ...init.pos },
    altitudeFt: init.altitudeFt,
    headingDeg: heading,
    speedKt: init.speedKt,
    verticalSpeedFpm: 0,
    targetHeadingDeg: heading,
    targetAltitudeFt: init.altitudeFt,
    targetSpeedKt: init.speedKt,
    mode: { kind: 'heading' },
  }
}

/** Turn radius (NM) at a given speed and turn rate: r = v / ω. */
export function turnRadiusNm(speedKt: number, turnRateDegS: number): number {
  const omega = (turnRateDegS * Math.PI) / 180 // rad/s
  return ktToNmPerS(speedKt) / omega
}

/**
 * Heading the autopilot wants right now. Pure function of aircraft state.
 * Orbit: fly the tangent and steer in or out in proportion to the radius error.
 */
export function commandedHeading(ac: Aircraft): number {
  const m = ac.mode
  switch (m.kind) {
    case 'heading':
      return ac.targetHeadingDeg
    case 'direct':
      return bearingDeg(ac.pos, m.to)
    case 'route': {
      const wp = m.waypoints[m.index]
      return wp ? bearingDeg(ac.pos, wp) : ac.targetHeadingDeg
    }
    case 'orbit': {
      const d = distanceNm(ac.pos, m.center)
      const fromCenter = bearingDeg(m.center, ac.pos)
      // Proportional correction: 12° of intercept per NM of radius error, max 60°.
      const correction = clamp((d - m.radiusNm) * 12, -60, 60)
      return m.clockwise
        ? normalize360(fromCenter + 90 + correction)
        : normalize360(fromCenter - 90 - correction)
    }
  }
}

/**
 * Advance one aircraft by `dt` simulated seconds. Returns a new object.
 * Turn rate, climb rate and acceleration are limited by the performance table.
 */
export function stepAircraft(ac: Aircraft, dt: number, perf: AircraftPerformance = PERFORMANCE[ac.category]): Aircraft {
  if (dt <= 0 || ac.held) return ac

  let mode = ac.mode
  let targetHeading = ac.targetHeadingDeg

  // Waypoint sequencing happens before steering.
  if (mode.kind === 'direct' && distanceNm(ac.pos, mode.to) < Math.max(0.15, ktToNmPerS(ac.speedKt) * dt * 1.5)) {
    targetHeading = mode.thenHeading ?? ac.headingDeg
    mode = { kind: 'heading' }
  } else if (mode.kind === 'route') {
    const wp = mode.waypoints[mode.index]
    if (wp && distanceNm(ac.pos, wp) < Math.max(0.3, ktToNmPerS(ac.speedKt) * dt * 1.5)) {
      const next = mode.index + 1
      if (next < mode.waypoints.length) mode = { ...mode, index: next }
      else if (mode.loop) mode = { ...mode, index: 0 }
      else {
        targetHeading = ac.headingDeg
        mode = { kind: 'heading' }
      }
    }
  }

  const probe: Aircraft = { ...ac, mode, targetHeadingDeg: targetHeading }
  const wanted = commandedHeading(probe)

  // Turn toward the wanted heading the short way, limited by the turn rate.
  const diff = angleDiff(ac.headingDeg, wanted)
  const maxTurn = perf.turnRateDegS * dt
  const turn = clamp(diff, -maxTurn, maxTurn)
  const newHeading = normalize360(ac.headingDeg + turn)

  // Speed.
  const targetSpeed = clamp(ac.targetSpeedKt, perf.minSpeedKt, perf.maxSpeedKt)
  const maxDv = perf.accelKtS * dt
  const newSpeed = ac.speedKt + clamp(targetSpeed - ac.speedKt, -maxDv, maxDv)

  // Altitude.
  const dAlt = ac.targetAltitudeFt - ac.altitudeFt
  const maxClimb = (perf.climbFpm / 60) * dt
  const maxDescent = (perf.descentFpm / 60) * dt
  const altChange = clamp(dAlt, -maxDescent, maxClimb)
  const newAlt = ac.altitudeFt + altChange
  const vs = (altChange / dt) * 60

  // Move along the average heading and speed over the step (midpoint rule).
  const midHeading = normalize360(ac.headingDeg + turn / 2)
  const dist = ktToNmPerS((ac.speedKt + newSpeed) / 2) * dt
  const u = bearingVector(midHeading)

  return {
    ...ac,
    mode,
    targetHeadingDeg: mode.kind === 'heading' ? targetHeading : ac.targetHeadingDeg,
    headingDeg: newHeading,
    speedKt: newSpeed,
    altitudeFt: newAlt,
    verticalSpeedFpm: vs,
    pos: { x: ac.pos.x + u.x * dist, y: ac.pos.y + u.y * dist },
  }
}

/**
 * Step with sub-steps so that turns and orbits stay smooth at high clock
 * speeds. Each sub-step is at most `maxSubStepS`.
 */
export function stepAircraftFine(ac: Aircraft, dt: number, maxSubStepS = 0.25): Aircraft {
  if (!(dt > 0)) return ac
  // Infinity would mean infinitely many sub-steps.
  if (!Number.isFinite(dt)) throw new RangeError(`stepAircraftFine: dt must be finite (got ${dt})`)
  positiveStep(maxSubStepS, 'maxSubStepS')
  const n = Math.max(1, Math.ceil(dt / maxSubStepS))
  let a = ac
  for (let i = 0; i < n; i++) a = stepAircraft(a, dt / n)
  return a
}

/** Aircraft velocity vector, NM per second. */
export function velocityNmPerS(ac: Aircraft): Vec2 {
  const u = bearingVector(ac.headingDeg)
  const v = ktToNmPerS(ac.speedKt)
  return { x: u.x * v, y: u.y * v }
}

/**
 * Radial speed of an aircraft relative to a point: positive when moving away,
 * kt. Used for Doppler and DME groundspeed effects.
 */
export function radialSpeedKt(ac: Aircraft, from: Vec2): number {
  const d = distanceNm(from, ac.pos)
  if (d < 1e-9) return 0
  const brg = bearingDeg(from, ac.pos)
  const u = bearingVector(brg)
  const h = bearingVector(ac.headingDeg)
  return ac.speedKt * (u.x * h.x + u.y * h.y)
}
