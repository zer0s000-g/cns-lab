/**
 * Primary surveillance radar physics.
 *
 * Timing:      R = c·t / 2,   R_unambiguous = c / (2·PRF)
 * Radar equation (simplified, relative form):
 *   SNR ∝ P · G² · σ / R⁴,   with antenna gain G ∝ 1 / beam width
 *   plus non-coherent integration of n pulses per scan (gain ≈ n^0.8).
 * Detection probability is a smooth function of SNR.
 *
 * The absolute calibration is a teaching choice: with the default settings
 * a 2 m² target is detected with 90% probability at 60 NM, which is typical
 * of a modern S-band approach radar.
 */

import { bearingDeg, distanceNm, sweepCovers, angleDiff, type Vec2 } from './geometry'
import { earthDropFt, lineOfSight, radioLineOfSightNm, slantRangeNm, type TerrainFn } from './propagation'
import { FT_PER_NM, LIGHT_NM_PER_US } from './units'
import { valueNoise } from './random'

export interface RadarParams {
  /** Time for one antenna revolution (the update interval), s. */
  rotationPeriodS: number
  /** Pulse repetition frequency, pulses per second. */
  prfHz: number
  /** Horizontal (azimuth) beam width, degrees. */
  beamWidthDeg: number
  /** Peak transmitter power, kW. */
  peakPowerKw: number
  /** Transmitted pulse length, µs. */
  pulseWidthUs: number
}

export const DEFAULT_RADAR: RadarParams = {
  rotationPeriodS: 4.8,
  prfHz: 1000,
  beamWidthDeg: 1.4,
  peakPowerKw: 25,
  pulseWidthUs: 1,
}

/** Radar cross section by aircraft size, m². */
// TODO(expert-review): representative RCS values for light / medium / heavy aircraft at S-band.
export const RCS_M2 = { light: 1, medium: 10, heavy: 40 } as const

// Calibration of the relative radar equation.
const REF = {
  params: DEFAULT_RADAR,
  rcsM2: 2,
  rangeNm: 60,
}
/** Detection-probability curve: 50% at 10 dB, width 1.2 dB. */
// TODO(expert-review): simplified detection model (logistic curve instead of Marcum/Swerling statistics).
const PD50_DB = 10
const PD_WIDTH_DB = 1.2
/** Non-coherent integration exponent (gain ≈ n^0.8). */
const INTEGRATION_EXP = 0.8

export function detectionProbability(snrDb: number): number {
  return 1 / (1 + Math.exp(-(snrDb - PD50_DB) / PD_WIDTH_DB))
}

/** SNR (dB) at which the detection probability equals pd. */
export function snrForPd(pd: number): number {
  const p = Math.min(Math.max(pd, 1e-6), 1 - 1e-6)
  return PD50_DB + PD_WIDTH_DB * Math.log(p / (1 - p))
}

const SNR_REF_DB = snrForPd(0.9)

/** Pulses that hit a target during one pass of the beam. */
export function hitsPerScan(p: RadarParams): number {
  return (p.prfHz * p.rotationPeriodS * p.beamWidthDeg) / 360
}

/** Integrated signal-to-noise ratio for a target, dB. */
export function radarSnrDb(p: RadarParams, rangeNm: number, rcsM2: number): number {
  const r = Math.max(rangeNm, 0.05)
  return (
    SNR_REF_DB +
    10 * Math.log10(p.peakPowerKw / REF.params.peakPowerKw) +
    20 * Math.log10(REF.params.beamWidthDeg / p.beamWidthDeg) +
    10 * Math.log10(rcsM2 / REF.rcsM2) -
    40 * Math.log10(r / REF.rangeNm) +
    10 * INTEGRATION_EXP * Math.log10(hitsPerScan(p) / hitsPerScan(REF.params))
  )
}

/**
 * Range at which a target of `rcsM2` is detected with probability `pd`
 * (ignoring the horizon and terrain), NM. Grows with the 4th root of power.
 */
export function maxDetectionRangeNm(p: RadarParams, rcsM2: number, pd = 0.9): number {
  const atRef = radarSnrDb(p, REF.rangeNm, rcsM2)
  return REF.rangeNm * 10 ** ((atRef - snrForPd(pd)) / 40)
}

/** Maximum unambiguous range, NM:  c / (2·PRF). */
export function maxUnambiguousRangeNm(prfHz: number): number {
  const priUs = 1e6 / prfHz
  return (priUs * LIGHT_NM_PER_US) / 2
}

/** Pulse repetition interval, µs. */
export const pulseIntervalUs = (prfHz: number) => 1e6 / prfHz

/**
 * Where an echo appears on the screen. Echoes from beyond the unambiguous range
 * arrive after the next pulse has left, so the radar measures time from the
 * wrong pulse: the "second-trace" echo shows at R mod R_unambiguous.
 */
export function apparentRange(trueRangeNm: number, prfHz: number): { rangeNm: number; trace: number } {
  const ru = maxUnambiguousRangeNm(prfHz)
  const trace = Math.floor(trueRangeNm / ru) + 1
  return { rangeNm: trueRangeNm - (trace - 1) * ru, trace }
}

/** Range resolution: two targets closer than c·τ/2 in range merge into one blip, NM. */
export function rangeResolutionNm(pulseWidthUs: number): number {
  return (pulseWidthUs * LIGHT_NM_PER_US) / 2
}

/** Azimuth resolution at a range: the beam's width across, NM. */
export function azimuthResolutionNm(rangeNm: number, beamWidthDeg: number): number {
  return rangeNm * ((beamWidthDeg * Math.PI) / 180)
}

/**
 * MTI (moving target indication) keeps echoes that change from pulse to
 * pulse. Echoes with little radial speed (ground, buildings, and aircraft
 * flying tangentially) are cancelled. Returns an amplitude factor 0..1.
 */
// TODO(expert-review): MTI notch shape and width (20 kt) are illustrative.
export function mtiGain(radialSpeedKt: number, notchKt = 20): number {
  return 1 - Math.exp(-((radialSpeedKt / notchKt) ** 2))
}

/** Residual strength left by MTI on perfectly stationary clutter (finite improvement factor). */
export const MTI_RESIDUE = 0.03

/** Upper edge of the elevation coverage: above it is the "cone of silence". */
// TODO(expert-review): elevation coverage limit of a typical approach radar (about 40°).
export const MAX_ELEVATION_DEG = 40

export function elevationAngleDeg(groundNm: number, targetAltFt: number, radarHeightFt: number): number {
  return (Math.atan2((targetAltFt - radarHeightFt) / FT_PER_NM, Math.max(groundNm, 1e-6)) * 180) / Math.PI
}

export interface RadarSite {
  pos: Vec2
  /** Antenna height above mean sea level, ft. */
  heightFt: number
}

export type DetectionReason = 'ok' | 'weak' | 'horizon' | 'terrain' | 'cone' | 'mti'

export interface DetectionResult {
  /** Whether this scan paints the target. */
  detected: boolean
  reason: DetectionReason
  snrDb: number
  pd: number
  trueRangeNm: number
  apparentRangeNm: number
  trace: number
  azimuthDeg: number
}

/**
 * Evaluate one pass of the beam over a target. `roll` is a uniform random
 * number in [0, 1) that decides detection against the probability.
 */
export function evaluateTarget(
  site: RadarSite,
  params: RadarParams,
  target: { pos: Vec2; altitudeFt: number; rcsM2: number; radialSpeedKt: number },
  env: { terrain: TerrainFn; mti: boolean },
  roll: number,
): DetectionResult {
  const ground = distanceNm(site.pos, target.pos)
  const range = slantRangeNm(ground, target.altitudeFt, site.heightFt)
  const az = bearingDeg(site.pos, target.pos)
  const app = apparentRange(range, params.prfHz)
  const base = { trueRangeNm: range, apparentRangeNm: app.rangeNm, trace: app.trace, azimuthDeg: az }

  if (elevationAngleDeg(ground, target.altitudeFt, site.heightFt) > MAX_ELEVATION_DEG) {
    return { ...base, detected: false, reason: 'cone', snrDb: -Infinity, pd: 0 }
  }
  if (ground > radioLineOfSightNm(site.heightFt, target.altitudeFt)) {
    return { ...base, detected: false, reason: 'horizon', snrDb: -Infinity, pd: 0 }
  }
  const los = lineOfSight(site.pos, site.heightFt, target.pos, target.altitudeFt, env.terrain, 0.5)
  if (!los.visible) {
    return { ...base, detected: false, reason: 'terrain', snrDb: -Infinity, pd: 0 }
  }
  let snr = radarSnrDb(params, range, target.rcsM2)
  let reason: DetectionReason = 'ok'
  if (env.mti) {
    const g = mtiGain(target.radialSpeedKt)
    snr += 20 * Math.log10(Math.max(g, 1e-4))
    if (g < 0.5) reason = 'mti'
  }
  const pd = detectionProbability(snr)
  const detected = roll < pd
  if (!detected && reason === 'ok') reason = 'weak'
  return { ...base, detected, reason: detected ? 'ok' : reason, snrDb: snr, pd }
}

// ---------------------------------------------------------------------------
// Clutter, weather and other unwanted echoes
// ---------------------------------------------------------------------------

export interface ClutterCell {
  pos: Vec2
  rangeNm: number
  azDeg: number
  /** Display strength 0..1 before MTI. */
  strength: number
}

/**
 * Ground clutter map: echoes from the ground near the radar and from hill
 * faces that the radar can see. Deterministic for a given seed.
 */
export function buildGroundClutter(
  site: RadarSite,
  terrainElevation: TerrainFn,
  maxRangeNm: number,
  opts: { azStepDeg?: number; rangeStepNm?: number; seed?: number; isWater?: (p: Vec2) => boolean } = {},
): ClutterCell[] {
  const azStep = opts.azStepDeg ?? 1
  const rStep = opts.rangeStepNm ?? 0.5
  const seed = opts.seed ?? 7
  const cells: ClutterCell[] = []
  for (let az = 0; az < 360; az += azStep) {
    const rad = (az * Math.PI) / 180
    const sin = Math.sin(rad)
    const cos = Math.cos(rad)
    // Track the steepest elevation angle seen so far along this azimuth: ground
    // behind a higher ridge is in shadow and returns nothing.
    let maxSlope = -Infinity
    for (let r = rStep; r <= maxRangeNm; r += rStep) {
      const p = { x: site.pos.x + sin * r, y: site.pos.y + cos * r }
      if (opts.isWater?.(p)) continue
      const h = terrainElevation(p)
      // Height relative to the radar, including the effective Earth's curvature.
      const drop = earthDropFt(r)
      const slope = (h - drop - site.heightFt) / r
      const lit = slope >= maxSlope
      if (slope > maxSlope) maxSlope = slope
      if (!lit) continue
      const n = valueNoise(p.x * 1.3, p.y * 1.3, seed)
      let s = 0
      // Near the radar: buildings, trees and ground scatter strongly.
      if (r < 12) s = 0.95 * Math.exp(-r / 5) * (0.35 + 0.9 * n)
      // Hill faces the radar can see (higher terrain returns more).
      const relief = Math.max(0, h - 400)
      if (relief > 0) s = Math.max(s, Math.min(1, 0.25 + relief / 6000) * (0.55 + 0.6 * n))
      if (s > 0.14) cells.push({ pos: p, rangeNm: r, azDeg: az, strength: Math.min(1, s) })
    }
  }
  return cells
}

export interface Storm {
  center: Vec2
  radiusNm: number
  /** Peak reflectivity, 0..1 display strength. */
  intensity: number
}

/** Rain reflectivity at a point (0..1), with patchy cells inside the storm. */
export function rainReflectivity(p: Vec2, storm: Storm, seed = 3): number {
  const d = distanceNm(p, storm.center)
  if (d > storm.radiusNm * 1.6) return 0
  const core = Math.exp(-(d * d) / (2 * (storm.radiusNm * 0.6) ** 2))
  const cells = valueNoise((p.x - storm.center.x) * 0.35, (p.y - storm.center.y) * 0.35, seed)
  return Math.max(0, storm.intensity * core * (0.35 + 0.9 * cells) - 0.08)
}

/** Radial component (kt, positive away from the radar) of a wind blowing TOWARD `windToDeg`. */
export function radialWindKt(site: Vec2, p: Vec2, windSpeedKt: number, windToDeg: number): number {
  const brg = bearingDeg(site, p)
  return windSpeedKt * Math.cos((angleDiff(brg, windToDeg) * Math.PI) / 180)
}

/** Is the direction `azDeg` inside the beam centred on `antennaAzDeg`? */
export function inBeam(azDeg: number, antennaAzDeg: number, beamWidthDeg: number): boolean {
  return Math.abs(angleDiff(antennaAzDeg, azDeg)) <= beamWidthDeg / 2
}

/** Convenience re-export for antenna scheduling. */
export { sweepCovers }
