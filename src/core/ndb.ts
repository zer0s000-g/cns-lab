/**
 * NDB (non-directional beacon) and ADF (automatic direction finder) physics.
 *
 * Conventions (see geometry.ts): bearings are degrees clockwise from TRUE
 * north internally. A relative bearing is measured clockwise from the
 * aircraft's nose. Magnetic values appear only at the display edge
 * (variation East positive, "East is least").
 *
 * The error models below are teaching models: each has a physical mechanism
 * (interfering waves, refraction at a coastline, reflections from terrain,
 * lightning as a radio source) and plausible magnitudes, but none of them is a
 * certified propagation model.
 */

import {
  angleDiff,
  bearingDeg,
  bearingVector,
  distanceNm,
  magneticBearingFromRelative,
  normalize180,
  normalize360,
  reciprocal,
  relativeBearing,
  toDeg,
  toRad,
  trueToMagnetic,
  type Vec2,
} from './geometry'
import { clamp, FT_PER_NM, METRES_PER_NM, wavelengthM } from './units'
import { valueNoise } from './random'
import type { Hill } from './world'

// ---------------------------------------------------------------------------
// Band, ident and coverage
// ---------------------------------------------------------------------------

/** NDB frequency band (kHz). Most aeronautical NDBs sit between 190 and 535 kHz. */
export const NDB_BAND_KHZ = { min: 190, max: 1750, usualMax: 535 } as const

export function isNdbFrequencyKhz(khz: number): boolean {
  return khz >= NDB_BAND_KHZ.min && khz <= NDB_BAND_KHZ.max
}

/**
 * Morse identification of an NDB: two or three letters on an audio tone.
 * TODO(expert-review): tone (400 or 1020 Hz), keying speed (about 7 words per
 * minute) and repetition interval (the simulator repeats it every 10 s).
 */
export const NDB_IDENT = { toneHz: 400, altToneHz: 1020, wpm: 7, repeatS: 10 } as const

/** TODO(expert-review): typical rated coverage (locator about 15 NM, en-route beacons 50 to 100+ NM). */
export const NDB_TYPICAL_COVERAGE_NM = { locator: 15, enRoute: 100 } as const

// ---------------------------------------------------------------------------
// Bearing geometry
// ---------------------------------------------------------------------------

export interface AdfTruth {
  /** True bearing from the aircraft to the station. */
  bearingTrue: number
  /** Relative bearing of the station, clockwise from the nose. */
  relative: number
  distanceNm: number
}

/** Where the station really is, seen from the aircraft. */
export function adfTruth(aircraftPos: Vec2, headingTrue: number, stationPos: Vec2): AdfTruth {
  const bearingTrue = bearingDeg(aircraftPos, stationPos)
  return { bearingTrue, relative: relativeBearing(bearingTrue, headingTrue), distanceNm: distanceNm(aircraftPos, stationPos) }
}

export interface RmiValues {
  headingMag: number
  /** Magnetic bearing TO the station (RMI needle head). */
  bearingToMag: number
  /** Magnetic bearing FROM the station (RMI needle tail). */
  bearingFromMag: number
}

/**
 * RMI values from a true heading and a relative bearing. The relative
 * bearing is the same whether you think in true or magnetic, so the magnetic
 * bearing is simply magnetic heading + relative bearing.
 */
export function rmiValues(headingTrue: number, relativeDeg: number, variationDeg: number): RmiValues {
  const headingMag = trueToMagnetic(headingTrue, variationDeg)
  const bearingToMag = magneticBearingFromRelative(headingMag, relativeDeg)
  return { headingMag, bearingToMag, bearingFromMag: reciprocal(bearingToMag) }
}

export interface BearingSum {
  heading: number
  relative: number
  /** heading + relative before wrapping. */
  sum: number
  /** The magnetic bearing, 0..359. */
  bearing: number
  /** True when 360 had to be subtracted. */
  wrapped: boolean
}

/**
 * Whole-degree parts of "magnetic bearing = magnetic heading + relative
 * bearing", rounded first so that the displayed numbers always add up.
 */
export function bearingSum(headingMag: number, relativeDeg: number): BearingSum {
  const heading = Math.round(normalize360(headingMag)) % 360
  const relative = Math.round(normalize360(relativeDeg)) % 360
  const sum = heading + relative
  return { heading, relative, sum, bearing: sum % 360, wrapped: sum >= 360 }
}

// ---------------------------------------------------------------------------
// Loop and sense antennas
// ---------------------------------------------------------------------------

/**
 * Loop antenna voltage (signed) for a wave arriving from `arrivalDeg` when the
 * loop's strongest direction (its axis) is `axisDeg`. The pattern is a
 * figure-of-eight: two equal lobes, and two nulls at right angles to the axis.
 */
export function loopResponse(arrivalDeg: number, axisDeg: number): number {
  return Math.cos(toRad(arrivalDeg - axisDeg))
}

/** The sense antenna is a plain vertical wire: the same response from every direction. */
export const SENSE_RESPONSE = 1

/**
 * Loop plus sense, scaled to 0..1: a heart-shaped (cardioid) pattern. It is
 * strongest along the loop axis and has only ONE null, directly opposite.
 */
export function cardioidResponse(arrivalDeg: number, axisDeg: number): number {
  return (SENSE_RESPONSE + loopResponse(arrivalDeg, axisDeg)) / 2
}

/**
 * The loop alone cannot tell the two lobes apart: a station at `relDeg`
 * gives exactly the same loop signal as one at `relDeg + 180`.
 */
export function loopCandidates(relDeg: number): [number, number] {
  return [normalize360(relDeg), normalize360(relDeg + 180)]
}

/** The sense antenna picks the candidate for which loop and sense add up (the cardioid maximum). */
export function resolveWithSense(candidates: readonly number[], arrivalDeg: number): number {
  let best = candidates[0]
  for (const c of candidates) if (cardioidResponse(arrivalDeg, c) > cardioidResponse(arrivalDeg, best)) best = c
  return best
}

/**
 * Loop only (sense antenna failed). The receiver has two equally good answers
 * and no way to choose. Teaching model: it shows the one ahead of the wings,
 * so a station behind the aircraft is shown exactly 180° wrong.
 */
export function loopOnlyIndication(relDeg: number): number {
  const [a, b] = loopCandidates(relDeg)
  return Math.abs(normalize180(a)) <= 90 ? a : b
}

// ---------------------------------------------------------------------------
// Signal strength and noise
// ---------------------------------------------------------------------------

/** TODO(expert-review): teaching calibration of the ADF signal margin. */
export const ADF_MARGIN_AT_RATED_DB = 10
/** Extra ground-wave loss, dB per rated-coverage distance travelled beyond it. */
export const GROUND_LOSS_DB_PER_COVERAGE = 4
/** Needle wander (degrees, one sigma) when the signal is just at the usable limit. */
export const NOISE_WANDER_AT_0DB = 4

/**
 * How far the received ground wave is above the weakest usable signal, dB.
 * Field strength falls as 1/distance (spreading) plus a little extra loss
 * into the ground. Calibrated to ADF_MARGIN_AT_RATED_DB at the rated coverage.
 */
export function groundWaveMarginDb(distance: number, ratedCoverageNm: number): number {
  const d = Math.max(distance, 0.3)
  const r = Math.max(ratedCoverageNm, 1)
  return ADF_MARGIN_AT_RATED_DB + 20 * Math.log10(r / d) - (GROUND_LOSS_DB_PER_COVERAGE * (d - r)) / r
}

/**
 * Elevation angle of the aircraft seen from the beacon, degrees (0 = on the
 * horizon, 90 = straight overhead).
 */
export function elevationDeg(groundNm: number, heightAboveStationFt: number): number {
  return toDeg(Math.atan2(Math.max(0, heightAboveStationFt) / FT_PER_NM, Math.max(groundNm, 0)))
}

/**
 * A vertical mast radiates almost nothing straight up: its field falls as
 * cos(elevation). Returns the change in signal, dB (0 on the horizon).
 */
export function verticalMastGainDb(elevation: number): number {
  return 20 * Math.log10(Math.max(Math.cos(toRad(clamp(elevation, 0, 90))), 1e-3))
}

/** Below 0 dB of margin the ADF has no usable signal. */
export const hasUsableSignal = (marginDb: number) => marginDb >= 0

/** One-sigma needle wander caused by noise, degrees. */
export function noiseWanderDeg(marginDb: number): number {
  return Math.min(20, NOISE_WANDER_AT_0DB * 10 ** (-marginDb / 20))
}

/** Smooth deterministic noise in [-1, 1] that changes on a time scale of about 1/rate seconds. */
export function smoothNoise(tS: number, rate: number, channel: number, seed = 0): number {
  return 2 * valueNoise(tS * rate, Math.round(channel), seed) - 1
}

// ---------------------------------------------------------------------------
// Two waves at once
// ---------------------------------------------------------------------------

/**
 * Error (degrees, clockwise positive) of a direction finder when the wanted
 * wave (amplitude 1) and a second wave add up. The second wave has relative
 * amplitude `ratio`, arrives `offsetDeg` away from the wanted direction and
 * differs in radio phase by `phaseRad`. Only its in-phase part pulls the
 * reading, so the error swings back and forth as the phase changes.
 */
export function twoWaveErrorDeg(ratio: number, offsetDeg: number, phaseRad: number): number {
  const k = ratio * Math.cos(phaseRad)
  const o = toRad(offsetDeg)
  return toDeg(Math.atan2(k * Math.sin(o), 1 + k * Math.cos(o)))
}

/**
 * Error when a second wave from about the same direction but with a
 * different polarisation (a sky wave) mixes into the loop signal. Never
 * larger than asin(ratio) for ratio < 1.
 */
export function polarisationErrorDeg(ratio: number, phaseRad: number): number {
  return toDeg(Math.atan2(ratio * Math.sin(phaseRad), 1 + ratio * Math.cos(phaseRad)))
}

// ---------------------------------------------------------------------------
// Night effect (sky waves)
// ---------------------------------------------------------------------------

/** A tropical site: sunrise and sunset close to 06:00 and 18:00 all year. */
export const SUNRISE_H = 6
export const SUNSET_H = 18
const TWILIGHT_WIDTH_H = 0.4
const TWILIGHT_SIGMA_H = 0.8

const logistic = (x: number) => 1 / (1 + Math.exp(-x))

/** 1 in full daylight, 0 at night, 0.5 exactly at sunrise and sunset. */
export function dayFactor(hour: number): number {
  const h = ((hour % 24) + 24) % 24
  return logistic((h - SUNRISE_H) / TWILIGHT_WIDTH_H) * logistic((SUNSET_H - h) / TWILIGHT_WIDTH_H)
}

/** 0 by day (the lowest ionosphere layer soaks up sky waves), 1 at night. */
export const nightFactor = (hour: number) => 1 - dayFactor(hour)

/** How unsettled the ionosphere is: peaks around sunrise and sunset, 0 at noon and midnight. */
export function twilightFactor(hour: number): number {
  const h = ((hour % 24) + 24) % 24
  let best = 0
  for (const peak of [SUNRISE_H, SUNSET_H]) {
    let d = Math.abs(h - peak)
    d = Math.min(d, 24 - d)
    best = Math.max(best, Math.exp(-(d * d) / (2 * TWILIGHT_SIGMA_H * TWILIGHT_SIGMA_H)))
  }
  return best
}

/** TODO(expert-review): sky-wave strength model and the reflecting layer height. */
export const SKY_WAVE = {
  nightStrength: 0.6,
  twilightStrength: 0.7,
  /** Below this ground distance the ground wave dominates completely. */
  groundOnlyNm: 8,
  rangeScaleNm: 140,
  maxRatio: 0.45,
  layerHeightKm: 100,
} as const

/** Sky-wave to ground-wave strength ratio at the aircraft. Grows with distance; strongest around dusk and dawn. */
export function skyWaveRatio(distance: number, hour: number): number {
  const s = SKY_WAVE.nightStrength * nightFactor(hour) + SKY_WAVE.twilightStrength * twilightFactor(hour)
  const range = clamp((distance - SKY_WAVE.groundOnlyNm) / SKY_WAVE.rangeScaleNm, 0, 1)
  return Math.min(SKY_WAVE.maxRatio, s * range)
}

/** Extra distance travelled by a wave reflected once from a layer `layerHeightKm` up (flat-Earth mirror), metres. */
export function skyWavePathDifferenceM(distance: number, layerHeightKm: number = SKY_WAVE.layerHeightKm): number {
  const d = distance * METRES_PER_NM
  const h2 = 2 * layerHeightKm * 1000
  return Math.hypot(d, h2) - d
}

/**
 * Night-effect needle error, degrees. The radio phase between sky wave and
 * ground wave changes as the aircraft moves (the path difference changes)
 * and as the ionosphere drifts (faster around sunrise and sunset).
 */
export function nightEffectErrorDeg(distance: number, hour: number, freqKhz: number, timeS: number, seed = 0): number {
  const ratio = skyWaveRatio(distance, hour)
  if (ratio <= 1e-6) return 0
  const lambda = wavelengthM(freqKhz * 1000)
  const pathPhase = (2 * Math.PI * skyWavePathDifferenceM(distance)) / lambda
  const tw = twilightFactor(hour)
  const drift = 2 * Math.PI * 3 * valueNoise(timeS * (0.04 + 0.12 * tw), 1, seed)
  return polarisationErrorDeg(ratio, pathPhase + drift)
}

// ---------------------------------------------------------------------------
// Thunderstorms (lightning is a powerful LF/MF transmitter)
// ---------------------------------------------------------------------------

export interface LightningFlash {
  timeS: number
  pos: Vec2
  /** Intrinsic strength, about 0.5..1.5. */
  strength: number
}

/** TODO(expert-review): lightning pull calibration (flash rate, needle recovery time, strength). */
export const LIGHTNING = { ratePerS: 0.5, decayS: 0.7, k: 0.4, maxRatio: 0.7, memoryS: 6 } as const

/** How hard a flash pulls the needle right now (relative to the beacon's own signal). */
export function flashPull(flash: LightningFlash, nowS: number, aircraftPos: Vec2, stationPos: Vec2): number {
  const age = nowS - flash.timeS
  if (age < 0 || age > LIGHTNING.memoryS) return 0
  const dStation = Math.max(distanceNm(aircraftPos, stationPos), 1)
  const dFlash = Math.max(distanceNm(aircraftPos, flash.pos), 1)
  const ratio = Math.min(LIGHTNING.maxRatio, (LIGHTNING.k * flash.strength * dStation) / dFlash)
  return ratio * Math.exp(-age / LIGHTNING.decayS)
}

/**
 * Error (degrees) when recent lightning flashes add to the beacon's signal
 * arriving from `wantedBearingTrue`: the needle points at the vector sum.
 */
export function lightningErrorDeg(
  wantedBearingTrue: number,
  flashes: readonly LightningFlash[],
  nowS: number,
  aircraftPos: Vec2,
  stationPos: Vec2,
): number {
  const u = bearingVector(wantedBearingTrue)
  let x = u.x
  let y = u.y
  for (const f of flashes) {
    const w = flashPull(f, nowS, aircraftPos, stationPos)
    if (w <= 0) continue
    const v = bearingVector(bearingDeg(aircraftPos, f.pos))
    x += w * v.x
    y += w * v.y
  }
  if (Math.hypot(x, y) < 1e-9) return 0
  return angleDiff(wantedBearingTrue, bearingDeg({ x: 0, y: 0 }, { x, y }))
}

// ---------------------------------------------------------------------------
// Coastal refraction
// ---------------------------------------------------------------------------

/**
 * A ground wave travels slightly faster over sea water than over land, so it
 * bends where it crosses the coast, like light entering water. For a small
 * speed difference the bend is about bendFactor × cot(angle to the coast).
 * TODO(expert-review): effective bend factor and cap.
 */
export const COASTAL = { bendFactor: 0.03, maxBendDeg: 8, maxErrorDeg: 10, minAngleDeg: 1 } as const

/** Bend (degrees) of a wave crossing the coast at `angleToCoastDeg` (0 = along the coast, 90 = straight across). */
export function coastalBendDeg(angleToCoastDeg: number): number {
  const a = clamp(Math.abs(angleToCoastDeg), COASTAL.minAngleDeg, 90)
  return Math.min(COASTAL.maxBendDeg, toDeg(COASTAL.bendFactor / Math.tan(toRad(a))))
}

export interface CoastCrossing {
  point: Vec2
  /** Distance from the station to the crossing, NM. */
  fromStationNm: number
  /** Angle between the signal path and the coastline, 0..90°. */
  angleDeg: number
  /** True when the wave goes from land out to sea. */
  toSea: boolean
  /** Signed bend of the wave at the crossing, degrees, clockwise positive. */
  bendDeg: number
}

/** Every point where the straight path from the station to the aircraft crosses the coastline. */
export function findCoastCrossings(station: Vec2, aircraft: Vec2, coastX: (y: number) => number, samples = 256): CoastCrossing[] {
  const total = distanceNm(station, aircraft)
  if (total < 1e-6) return []
  const at = (t: number): Vec2 => ({ x: station.x + (aircraft.x - station.x) * t, y: station.y + (aircraft.y - station.y) * t })
  const sea = (t: number) => {
    const p = at(t)
    return p.x - coastX(p.y)
  }
  const u = { x: (aircraft.x - station.x) / total, y: (aircraft.y - station.y) / total }
  const out: CoastCrossing[] = []
  let t0 = 0
  let f0 = sea(0)
  for (let i = 1; i <= samples; i++) {
    const t1 = i / samples
    const f1 = sea(t1)
    if ((f0 <= 0 && f1 > 0) || (f0 > 0 && f1 <= 0)) {
      // Bisection for the exact crossing.
      let a = t0
      let b = t1
      let fa = f0
      for (let k = 0; k < 40; k++) {
        const m = (a + b) / 2
        const fm = sea(m)
        if ((fa <= 0) === (fm <= 0)) {
          a = m
          fa = fm
        } else b = m
      }
      const tc = (a + b) / 2
      const p = at(tc)
      // Coastline direction at the crossing (pointing north along the coast).
      const h = 0.01
      const dxdy = (coastX(p.y + h) - coastX(p.y - h)) / (2 * h)
      const len = Math.hypot(dxdy, 1)
      let tx = dxdy / len
      let ty = 1 / len
      const along = u.x * tx + u.y * ty
      if (along < 0) {
        tx = -tx
        ty = -ty
      }
      const angleDeg = toDeg(Math.acos(clamp(Math.abs(along), 0, 1)))
      const toSea = f0 <= 0
      // Rotation from the path toward the coastline, in bearing sense (clockwise positive).
      const crossZ = u.x * ty - u.y * tx
      const towardCoast = crossZ > 0 ? -1 : 1
      const bend = coastalBendDeg(angleDeg)
      // Land to sea (into faster ground): bends toward the coastline. Sea to land: away from it.
      out.push({ point: p, fromStationNm: tc * total, angleDeg, toSea, bendDeg: (toSea ? towardCoast : -towardCoast) * bend })
    }
    t0 = t1
    f0 = f1
  }
  return out
}

/**
 * ADF error from coastal refraction, degrees (clockwise positive). A bend δ
 * at a distance s from the station changes the direction the wave arrives
 * from by δ × s / D (D = station to aircraft), so a beacon right on the coast
 * suffers almost nothing.
 */
export function coastalRefractionErrorDeg(
  station: Vec2,
  aircraft: Vec2,
  coastX: (y: number) => number,
): { errorDeg: number; crossings: CoastCrossing[] } {
  const crossings = findCoastCrossings(station, aircraft, coastX)
  const total = distanceNm(station, aircraft)
  let err = 0
  for (const c of crossings) err += (c.bendDeg * c.fromStationNm) / Math.max(total, 1e-6)
  return { errorDeg: clamp(err, -COASTAL.maxErrorDeg, COASTAL.maxErrorDeg), crossings }
}

// ---------------------------------------------------------------------------
// Mountain effect (reflections from high terrain)
// ---------------------------------------------------------------------------

/** TODO(expert-review): mountain reflection strength, reach and altitude dependence. */
export const MOUNTAIN = { minPeakFt: 3000, reflection: 0.4, rangeNm: 15, maxErrorDeg: 30, refPeakFt: 9000 } as const

export interface MountainReflector {
  hill: Hill
  /** Relative amplitude of the reflected wave at the aircraft. */
  ratio: number
}

/**
 * Each high hill reflects part of the beacon's wave toward the aircraft.
 * The reflected wave arrives from the hill's direction; its radio phase
 * depends on the extra path length, which changes quickly as the aircraft
 * moves, so the needle is erratic near mountains. Weaker well above the peaks.
 */
export function mountainReflectionErrorDeg(
  station: Vec2,
  aircraft: Vec2,
  altitudeFt: number,
  hills: readonly Hill[],
  freqKhz: number,
): { errorDeg: number; reflectors: MountainReflector[] } {
  const direct = bearingDeg(aircraft, station)
  const lambda = wavelengthM(freqKhz * 1000)
  const d0 = distanceNm(station, aircraft)
  const u = bearingVector(direct)
  let x = u.x
  let y = u.y
  const reflectors: MountainReflector[] = []
  for (const hill of hills) {
    if (hill.peakFt < MOUNTAIN.minPeakFt) continue
    const dH = distanceNm(aircraft, hill.center)
    const alt = clamp((hill.peakFt + 4000 - altitudeFt) / 6000, 0, 1)
    const ratio = MOUNTAIN.reflection * (hill.peakFt / MOUNTAIN.refPeakFt) * Math.exp(-dH / MOUNTAIN.rangeNm) * alt
    if (ratio < 0.005) continue
    reflectors.push({ hill, ratio })
    const extraM = (distanceNm(station, hill.center) + dH - d0) * METRES_PER_NM
    const k = ratio * Math.cos((2 * Math.PI * extraM) / lambda)
    const v = bearingVector(bearingDeg(aircraft, hill.center))
    x += k * v.x
    y += k * v.y
  }
  if (Math.hypot(x, y) < 1e-9) return { errorDeg: 0, reflectors }
  const err = angleDiff(direct, bearingDeg({ x: 0, y: 0 }, { x, y }))
  return { errorDeg: clamp(err, -MOUNTAIN.maxErrorDeg, MOUNTAIN.maxErrorDeg), reflectors }
}
