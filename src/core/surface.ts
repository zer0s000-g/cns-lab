/**
 * Airport surface surveillance: runway geometry, movement along taxi routes,
 * Surface Movement Radar (SMR) returns from extended targets, reflections
 * (multipath ghosts), visibility (fog) and runway incursion alerting.
 *
 * Frame used here: METRES, x east, y north, origin at the airport reference
 * point (the same origin as the NM world frame, so a point in metres is simply
 * the world point × 1852). Speeds are given in kt at the edges and converted
 * with ktToMs; times in seconds; angles in degrees true.
 */

import { angleDiff, bearingDeg, normalize360, type Vec2 } from './geometry'
import { azimuthResolutionNm, detectionProbability, rangeResolutionNm } from './radar'
import { METRES_PER_FT, metresToNm, nmToMetres } from './units'
import { LAB_AIRPORT } from './world'

// ---------------------------------------------------------------------------
// Runway geometry
// ---------------------------------------------------------------------------

export interface RunwayGeometry {
  /** x of the landing threshold (runway 09, west end), m. */
  thresholdX: number
  /** x of the far (east) end, m. */
  endX: number
  /** y of the centreline, m. */
  centreY: number
  halfWidthM: number
  /** Distance of the runway-holding positions (stop bars) from the centreline, m. */
  holdingDistM: number
  /** Landing direction, degrees true. */
  headingDeg: number
}

/**
 * Runway 09/27 of the CNS Lab airport in metres: 3,000 m × 45 m, centred on the
 * origin, running east–west. Holding positions 90 m from the centreline.
 */
// TODO(expert-review): runway-holding position distance for a code 4 precision approach runway (Annex 14 Table 3-2, 90 m used here).
export function labRunway(): RunwayGeometry {
  const r = LAB_AIRPORT.runways[0]
  return {
    thresholdX: nmToMetres(r.threshold.x),
    endX: nmToMetres(r.end.x),
    centreY: nmToMetres(r.threshold.y),
    halfWidthM: (r.widthFt * METRES_PER_FT) / 2,
    holdingDistM: 90,
    headingDeg: r.headingTrue,
  }
}

/** True on the paved runway itself. */
export function onRunway(p: Vec2, rwy: RunwayGeometry): boolean {
  return p.x >= rwy.thresholdX && p.x <= rwy.endX && Math.abs(p.y - rwy.centreY) <= rwy.halfWidthM
}

/**
 * The runway protected area used for incursion alerting: everything inside the
 * runway-holding positions (stop bars) along the runway, plus `endMarginM`
 * beyond each end.
 */
// TODO(expert-review): exact extent of the protected area used by A-SMGCS runway incursion monitoring.
export function inRunwayProtectedArea(p: Vec2, rwy: RunwayGeometry, endMarginM = 60): boolean {
  return Math.abs(p.y - rwy.centreY) < rwy.holdingDistM && p.x >= rwy.thresholdX - endMarginM && p.x <= rwy.endX + endMarginM
}

/** Distance of a point on the extended centreline before the threshold, m (negative once past it). */
export function distanceToThresholdM(p: Vec2, rwy: RunwayGeometry): number {
  return rwy.thresholdX - p.x
}

/** Height of a 3° glide path above the threshold elevation at a distance before the threshold, m (15 m crossing height). */
// TODO(expert-review): 3° glide path with a 15 m (50 ft) threshold crossing height.
export function glidePathHeightM(distBeforeThresholdM: number, slopeDeg = 3, crossingM = 15): number {
  return crossingM + Math.max(0, distBeforeThresholdM) * Math.tan((slopeDeg * Math.PI) / 180)
}

// ---------------------------------------------------------------------------
// Paths and kinematics
// ---------------------------------------------------------------------------

export interface Path {
  points: Vec2[]
  /** Cumulative length at each point, m. */
  cum: number[]
  length: number
}

export function makePath(points: Vec2[]): Path {
  const cum = [0]
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y))
  return { points: points.map((p) => ({ ...p })), cum, length: cum[cum.length - 1] }
}

/** Position and direction of travel (degrees true) a distance s along a path. */
export function pointAt(path: Path, s: number): { pos: Vec2; trackDeg: number } {
  const n = path.points.length
  if (n === 1) return { pos: { ...path.points[0] }, trackDeg: 0 }
  const d = Math.max(0, Math.min(path.length, s))
  let i = 1
  while (i < n - 1 && path.cum[i] < d) i++
  const a = path.points[i - 1]
  const b = path.points[i]
  const seg = path.cum[i] - path.cum[i - 1]
  const t = seg > 0 ? (d - path.cum[i - 1]) / seg : 0
  return { pos: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, trackDeg: bearingDeg(a, b) }
}

/** Distance along the path of the point nearest to p. */
export function closestAlong(path: Path, p: Vec2): number {
  let best = 0
  let bd = Infinity
  for (let i = 1; i < path.points.length; i++) {
    const a = path.points[i - 1]
    const b = path.points[i]
    const abx = b.x - a.x
    const aby = b.y - a.y
    const len2 = abx * abx + aby * aby
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2)) : 0
    const d = Math.hypot(a.x + abx * t - p.x, a.y + aby * t - p.y)
    if (d < bd) {
      bd = d
      best = path.cum[i - 1] + t * Math.sqrt(len2)
    }
  }
  return best
}

/** Distance needed to slow from v to 0 at a constant deceleration, m. */
export function brakingDistanceM(vMs: number, decelMs2: number): number {
  return (vMs * vMs) / (2 * decelMs2)
}

/** Highest speed from which a stop is still possible within `distM` (m/s). */
export function stopSpeedLimitMs(distM: number, decelMs2: number): number {
  return Math.sqrt(2 * decelMs2 * Math.max(0, distM))
}

/** Change speed toward a target with separate acceleration and deceleration limits. */
export function approachSpeed(v: number, target: number, dt: number, accel: number, decel: number): number {
  if (target > v) return Math.min(target, v + accel * dt)
  return Math.max(target, v - decel * dt)
}

/**
 * Speed limit for a bend coming up: tight turns are taken slowly on the ground.
 * Returns kt for the sharpest vertex within `lookM` metres ahead.
 */
// TODO(expert-review): typical taxi speeds (straight 15–25 kt, 90° turns about 10 kt).
export function turnSpeedLimitKt(path: Path, s: number, lookM = 60, straightKt = 20): number {
  let limit = straightKt
  for (let i = 1; i < path.points.length - 1; i++) {
    const along = path.cum[i] - s
    if (along < -5 || along > lookM) continue
    const inB = bearingDeg(path.points[i - 1], path.points[i])
    const outB = bearingDeg(path.points[i], path.points[i + 1])
    const turn = Math.abs(angleDiff(inB, outB))
    if (turn > 60) limit = Math.min(limit, 10)
    else if (turn > 25) limit = Math.min(limit, 14)
  }
  return limit
}

// ---------------------------------------------------------------------------
// Surface movement radar (SMR)
// ---------------------------------------------------------------------------

export interface SmrParams {
  /** One antenna turn, s (60 rpm = 1 s). */
  rotationPeriodS: number
  /** Horizontal beam width, degrees. */
  beamWidthDeg: number
  /** Pulse length, µs (20 ns = 0.02 µs). */
  pulseWidthUs: number
  /** Carrier frequency, GHz (X-band). */
  frequencyGHz: number
  /** Instrumented range, m. */
  maxRangeM: number
}

// TODO(expert-review): representative SMR parameters (X-band about 9 GHz, 60 rpm, 0.35° beam, 20 ns pulse; some SMRs use Ku-band).
export const DEFAULT_SMR: SmrParams = {
  rotationPeriodS: 1,
  beamWidthDeg: 0.35,
  pulseWidthUs: 0.02,
  frequencyGHz: 9.2,
  maxRangeM: 4000,
}

/** Two targets closer than this in range merge, m (c·τ/2). 20 ns → 3 m. */
export function smrRangeResolutionM(p: SmrParams): number {
  return nmToMetres(rangeResolutionNm(p.pulseWidthUs))
}

/** Width of the beam across at a range, m. 0.35° at 1 km → 6 m. */
export function smrAzimuthResolutionM(p: SmrParams, rangeM: number): number {
  return nmToMetres(azimuthResolutionNm(metresToNm(rangeM), p.beamWidthDeg))
}

export type SurfaceShape = 'medium' | 'heavy' | 'car' | 'van'

export interface ScatterPoint {
  /** Body frame: +x right wing, +y nose, m. */
  x: number
  y: number
  /** Radar cross section of this point, dBsm. */
  rcsDb: number
}

/** Length and span (or width) of each shape, m. */
export const SHAPE_SIZE: Record<SurfaceShape, { length: number; span: number }> = {
  medium: { length: 38, span: 34 },
  heavy: { length: 64, span: 61 },
  car: { length: 4.8, span: 1.9 },
  van: { length: 6, span: 2.3 },
}

// TODO(expert-review): scatterer layout and RCS per point are illustrative, chosen so the painted shape looks like the object.
function aircraftScatterers(scale: number): ScatterPoint[] {
  const pts: ScatterPoint[] = []
  // Fuselage, nose to tail.
  for (let y = -18; y <= 18; y += 2) pts.push({ x: 0, y, rcsDb: 8 })
  // Swept wings: root at y = +3, tip at y = -6.
  for (let k = 1; k <= 8; k++) {
    const x = 2 + (k / 8) * 15
    const y = 3 - (k / 8) * 9
    pts.push({ x, y, rcsDb: 5 }, { x: -x, y, rcsDb: 5 })
  }
  // Engines under the wings: bright.
  pts.push({ x: 6, y: 1.5, rcsDb: 14 }, { x: -6, y: 1.5, rcsDb: 14 })
  // Tailplane.
  for (let k = 1; k <= 3; k++) {
    const x = (k / 3) * 6
    pts.push({ x, y: -15 - k * 0.8, rcsDb: 5 }, { x: -x, y: -15 - k * 0.8, rcsDb: 5 })
  }
  // Fin (seen edge-on from the radar, still a strong corner reflector).
  pts.push({ x: 0, y: -17, rcsDb: 10 })
  return pts.map((p) => ({ x: p.x * scale, y: p.y * scale, rcsDb: p.rcsDb }))
}

function boxScatterers(length: number, width: number, rcsDb: number): ScatterPoint[] {
  const hx = width / 2
  const hy = length / 2
  return [
    { x: -hx, y: hy, rcsDb },
    { x: hx, y: hy, rcsDb },
    { x: -hx, y: -hy, rcsDb },
    { x: hx, y: -hy, rcsDb },
    { x: 0, y: 0, rcsDb: rcsDb + 2 },
  ]
}

const SCATTER: Record<SurfaceShape, ScatterPoint[]> = {
  medium: aircraftScatterers(1),
  heavy: aircraftScatterers(64 / 38),
  car: boxScatterers(4.8, 1.9, 3),
  van: boxScatterers(6, 2.3, 5),
}

/** Scatter points of a shape placed at `pos` with nose toward `headingDeg`, in world metres. */
export function scatterPointsWorld(shape: SurfaceShape, pos: Vec2, headingDeg: number): { pos: Vec2; rcsDb: number }[] {
  const h = (headingDeg * Math.PI) / 180
  const s = Math.sin(h)
  const c = Math.cos(h)
  // Nose (+y body) points along the heading; right wing (+x body) points 90° clockwise.
  return SCATTER[shape].map((p) => ({ pos: { x: pos.x + p.y * s + p.x * c, y: pos.y + p.y * c - p.x * s }, rcsDb: p.rcsDb }))
}

export interface RainState {
  /** Rain rate, mm/h (0 = dry). Heavy rain ≈ 25 mm/h. */
  rateMmH: number
  /** Circular polarisation switched on (suppresses rain echoes). */
  circularPolarisation: boolean
}

/**
 * Specific rain attenuation, dB/km, γ = k·Rᵅ (power law of ITU-R P.838 form).
 * Coefficients near 9 GHz, horizontal polarisation.
 */
// TODO(expert-review): P.838 coefficients at 9.2 GHz (k ≈ 0.0085, α ≈ 1.30 used here).
export function rainAttenuationDbPerKm(rateMmH: number): number {
  if (rateMmH <= 0) return 0
  return 0.0085 * rateMmH ** 1.3
}

/** Clear-air SNR of a 0 dBsm point at 1 km, dB (calibration of the teaching model). */
// TODO(expert-review): SMR sensitivity calibration and rain clutter levels are illustrative.
export const SMR_SNR_REF_DB = 30
/** Signal-to-rain-clutter ratio of a 0 dBsm point at 1 km in 25 mm/h rain, dB. */
export const SMR_SCR_REF_DB = 4
/** How much circular polarisation improves the signal-to-rain ratio, dB (and what it costs the target). */
export const CP_RAIN_REJECTION_DB = 15
export const CP_TARGET_LOSS_DB = 3

/**
 * Signal-to-noise-plus-clutter of one scatter point, dB.
 * Noise: signal ∝ σ/R⁴, and two-way rain attenuation.
 * Rain clutter fills the resolution cell, whose volume grows with R², so the
 * signal-to-rain ratio falls as 1/R² (20 dB per decade).
 */
export function smrPointSnrDb(rangeM: number, rcsDb: number, rain: RainState): number {
  const rKm = Math.max(rangeM, 20) / 1000
  const cp = rain.circularPolarisation ? CP_TARGET_LOSS_DB : 0
  const atten = 2 * rainAttenuationDbPerKm(rain.rateMmH) * rKm
  const snr = SMR_SNR_REF_DB + rcsDb - 40 * Math.log10(rKm) - atten - cp
  if (rain.rateMmH <= 0) return snr
  // Rain backscatter grows with rain rate (reflectivity ∝ R^1.6).
  const scr =
    SMR_SCR_REF_DB + rcsDb - 20 * Math.log10(rKm) - 16 * Math.log10(rain.rateMmH / 25) + (rain.circularPolarisation ? CP_RAIN_REJECTION_DB - CP_TARGET_LOSS_DB : 0)
  return -10 * Math.log10(10 ** (-snr / 10) + 10 ** (-scr / 10))
}

/** Probability that the SMR paints one scatter point on one turn. */
export function smrPointDetection(rangeM: number, rcsDb: number, rain: RainState): number {
  return detectionProbability(smrPointSnrDb(rangeM, rcsDb, rain))
}

/** Relative strength (0..1) of the rain echo painted at a range, for the display. */
export function rainClutterStrength(rangeM: number, rain: RainState): number {
  if (rain.rateMmH <= 0) return 0
  const s = Math.min(1, 0.6 * (500 / Math.max(rangeM, 100)) * (rain.rateMmH / 25) ** 0.8)
  return rain.circularPolarisation ? s * 10 ** (-CP_RAIN_REJECTION_DB / 20) : s
}

// ---------------------------------------------------------------------------
// Reflections: ghost targets
// ---------------------------------------------------------------------------

export interface Wall {
  a: Vec2
  b: Vec2
}

/** Mirror image of p across the (infinite) line through the wall. */
export function mirrorPoint(p: Vec2, w: Wall): Vec2 {
  const dx = w.b.x - w.a.x
  const dy = w.b.y - w.a.y
  const len2 = dx * dx + dy * dy
  const t = ((p.x - w.a.x) * dx + (p.y - w.a.y) * dy) / len2
  const fx = w.a.x + dx * t
  const fy = w.a.y + dy * t
  return { x: 2 * fx - p.x, y: 2 * fy - p.y }
}

/** Which side of the wall line a point is on (+1 / -1, 0 on the line). */
export function sideOf(p: Vec2, w: Wall): number {
  const c = (w.b.x - w.a.x) * (p.y - w.a.y) - (w.b.y - w.a.y) * (p.x - w.a.x)
  return c > 1e-9 ? 1 : c < -1e-9 ? -1 : 0
}

/**
 * Ghost of a target produced by a reflection off a wall (radar → wall → target
 * and back the same way). It appears at the target's mirror image behind the
 * wall: in the direction of the reflection point and at the longer, reflected
 * range. Returns null when the geometry gives no reflection (target on the
 * other side, or the reflection point would fall off the end of the wall).
 */
export function ghostPosition(target: Vec2, radar: Vec2, w: Wall): { ghost: Vec2; reflection: Vec2 } | null {
  const sr = sideOf(radar, w)
  const st = sideOf(target, w)
  if (sr === 0 || sr !== st) return null
  const g = mirrorPoint(target, w)
  // Reflection point: where the line radar → ghost crosses the wall.
  const dx = g.x - radar.x
  const dy = g.y - radar.y
  const wx = w.b.x - w.a.x
  const wy = w.b.y - w.a.y
  const den = dx * wy - dy * wx
  if (Math.abs(den) < 1e-9) return null
  const u = ((w.a.x - radar.x) * wy - (w.a.y - radar.y) * wx) / den
  const v = ((w.a.x - radar.x) * dy - (w.a.y - radar.y) * dx) / den
  if (u <= 0 || u >= 1 || v < 0 || v > 1) return null
  return { ghost: g, reflection: { x: radar.x + dx * u, y: radar.y + dy * u } }
}

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

/** Contrast threshold of the eye used to define meteorological visibility (5%). */
export const CONTRAST_THRESHOLD = 0.05

/**
 * Apparent contrast of an object at a distance in fog (Koschmieder):
 * C = exp(−σ·d) with σ = ln(1/0.05)/V ≈ 3/V, so C = 5% exactly at the visibility V.
 */
// TODO(expert-review): Koschmieder law with the 5% threshold for daytime objects; lights follow Allard's law instead.
export function fogContrast(distanceM: number, visibilityM: number): number {
  return Math.exp((-Math.log(1 / CONTRAST_THRESHOLD) * Math.max(0, distanceM)) / Math.max(visibilityM, 1))
}

/** Can an object at this distance still be made out? */
export function visibleInFog(distanceM: number, visibilityM: number): boolean {
  return fogContrast(distanceM, visibilityM) >= CONTRAST_THRESHOLD - 1e-12
}

// ---------------------------------------------------------------------------
// Runway incursion alerting (A-SMGCS safety net)
// ---------------------------------------------------------------------------

/** An aircraft using the runway (landing or taking off). */
export interface RunwayMovement {
  id: string
  kind: 'landing' | 'takeoff'
  /** Landing: metres still to fly before the threshold (negative once past it). */
  distanceToThresholdM?: number
  /** Landing: seconds to the threshold at the current speed. */
  timeToThresholdS?: number
  /** On the runway itself (landing roll, lined up, or take-off roll). */
  onRunway: boolean
}

export interface SurfaceTarget {
  id: string
  pos: Vec2
  onGround: boolean
  /** Label for messages (callsign, or "unknown"). */
  name: string
}

export interface IncursionResult {
  /** caution: something is on the runway without clearance; alert: and an aircraft is landing or taking off. */
  level: 'none' | 'caution' | 'alert'
  intruders: string[]
  /** The landing or departing aircraft the intrusion conflicts with. */
  against: string | null
}

/** Landing aircraft count once they are within 2 NM or 60 s of the threshold. */
// TODO(expert-review): alert timing of A-SMGCS runway incursion monitoring (2 NM / 60 s used here) and ICAO Doc 9830 terminology.
export const FINAL_ALERT_DISTANCE_M = nmToMetres(2)
export const FINAL_ALERT_TIME_S = 60

/** Is this movement one that makes the runway "active" right now? */
export function movementIsActive(m: RunwayMovement): boolean {
  if (m.onRunway) return true
  if (m.kind === 'landing') {
    const d = m.distanceToThresholdM ?? Infinity
    const t = m.timeToThresholdS ?? Infinity
    return d >= -1 && (d <= FINAL_ALERT_DISTANCE_M || t <= FINAL_ALERT_TIME_S)
  }
  return false
}

/**
 * Runway incursion monitoring: any ground target inside the runway protected
 * area that is not cleared to be there is an intruder. With an aircraft landing
 * (within 2 NM / 60 s, or on the runway) or taking off, it is an ALERT;
 * otherwise a CAUTION (e.g. a red stop bar crossed on a quiet runway).
 */
export function runwayIncursion(rwy: RunwayGeometry, movements: RunwayMovement[], targets: SurfaceTarget[], cleared: ReadonlySet<string>): IncursionResult {
  const movementIds = new Set(movements.map((m) => m.id))
  const intruders = targets.filter((t) => t.onGround && !cleared.has(t.id) && !movementIds.has(t.id) && inRunwayProtectedArea(t.pos, rwy)).map((t) => t.id)
  if (!intruders.length) return { level: 'none', intruders, against: null }
  const active = movements.filter(movementIsActive)
  if (!active.length) return { level: 'caution', intruders, against: null }
  // The most urgent movement: one on the runway, else the landing nearest the threshold.
  active.sort((a, b) => Number(b.onRunway) - Number(a.onRunway) || (a.distanceToThresholdM ?? 0) - (b.distanceToThresholdM ?? 0))
  return { level: 'alert', intruders, against: active[0].id }
}

// ---------------------------------------------------------------------------
// Line of sight on the airport (buildings block 1090 MHz signals)
// ---------------------------------------------------------------------------

export interface Box {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/** Does the segment a–b pass through the rectangle? (Liang–Barsky clipping) */
export function segmentHitsBox(a: Vec2, b: Vec2, box: Box): boolean {
  let t0 = 0
  let t1 = 1
  const dx = b.x - a.x
  const dy = b.y - a.y
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0
    const r = q / p
    if (p < 0) {
      if (r > t1) return false
      if (r > t0) t0 = r
    } else {
      if (r < t0) return false
      if (r < t1) t1 = r
    }
    return true
  }
  return clip(-dx, a.x - box.minX) && clip(dx, box.maxX - a.x) && clip(-dy, a.y - box.minY) && clip(dy, box.maxY - a.y) && t0 < t1
}

export function insideBox(p: Vec2, box: Box, marginM = 0): boolean {
  return p.x > box.minX - marginM && p.x < box.maxX + marginM && p.y > box.minY - marginM && p.y < box.maxY + marginM
}

/** Azimuth from the radar to a point, degrees true (re-exported for convenience). */
export function azimuthDeg(from: Vec2, to: Vec2): number {
  return normalize360(bearingDeg(from, to))
}
