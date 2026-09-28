/**
 * VOR physics: conventional VOR (CVOR) and Doppler VOR (DVOR).
 *
 * The station sends two 30 Hz signals. The REFERENCE has the same phase in
 * every direction; the VARIABLE signal's phase depends on the direction from
 * the station. The station is aligned to magnetic north: on radial 000 the two
 * are in phase, and the phase difference equals the radial (magnetic bearing
 * FROM the station).
 *
 *   CVOR: reference = 30 Hz FM on a 9960 Hz subcarrier (±480 Hz),
 *         variable  = 30 Hz AM from a pattern turning CLOCKWISE 30 times a second.
 *         The AM lags the FM by the radial.
 *   DVOR: roles swapped. Reference = 30 Hz AM of the carrier (omnidirectional);
 *         variable = 30 Hz FM made by the Doppler effect of a sideband source
 *         switched around a ring of antennas COUNTER-clockwise. The FM now leads
 *         the AM by the radial.
 *   Either way the receiver measures how far the 30 Hz AM lags the 30 Hz FM,
 *   so the same receiver reads the same radial from both.
 *
 * Signal time t = 0 is a peak of the reference signal.
 * Bearings are TRUE unless the name says "mag" or "radial" (magnetic).
 */

import { bearingDeg, distanceNm, normalize180, normalize360, toDeg, toRad, trueToMagnetic, type Vec2 } from './geometry'
import { clamp, FT_PER_NM, METRES_PER_FT, METRES_PER_NM, SPEED_OF_LIGHT_MS } from './units'

// ---------------------------------------------------------------------------
// Band, channels, signal parameters
// ---------------------------------------------------------------------------

export const VOR_BAND_MHZ = { min: 108.0, max: 117.95 } as const

/**
 * True for a VOR channel: 50 kHz steps from 108.00 to 117.95 MHz. Below
 * 112 MHz VORs use only the even tenths (108.00, 108.05, 108.20, 108.25, …);
 * the odd tenths belong to ILS localizers.
 * TODO(expert-review): channel plan rule for 108–112 MHz shared with ILS.
 */
export function isVorChannel(mhz: number): boolean {
  if (mhz < VOR_BAND_MHZ.min - 1e-9 || mhz > VOR_BAND_MHZ.max + 1e-9) return false
  const k50 = Math.round(mhz * 20)
  if (Math.abs(k50 / 20 - mhz) > 1e-6) return false
  if (mhz < 112 - 1e-9) {
    const tenths = Math.floor(k50 / 2) % 10
    return tenths % 2 === 0
  }
  return true
}

/**
 * VOR signal structure (ICAO Annex 10 Volume I).
 * TODO(expert-review): modulation depths (30 Hz AM and 9960 Hz subcarrier about 30 %, ident up to about 10 %).
 */
export const VOR_SIGNAL = {
  refVarHz: 30,
  subcarrierHz: 9960,
  fmDeviationHz: 480,
  amDepth: 0.3,
  subcarrierDepth: 0.3,
  identDepth: 0.1,
} as const

/** TODO(expert-review): ident tone 1020 Hz, keyed at about 7 words per minute, repeated about every 10 s. */
export const VOR_IDENT = { toneHz: 1020, wpm: 7, repeatS: 10 } as const

/** TODO(expert-review): DVOR ring of about 48 antennas, about 13.5 m across. */
export const DVOR_RING = { antennas: 48, radiusM: 6.76, revPerS: 30 } as const

const OMEGA = 2 * Math.PI * VOR_SIGNAL.refVarHz

export const wavelengthAtMHz = (mhz: number) => SPEED_OF_LIGHT_MS / (mhz * 1e6)

// ---------------------------------------------------------------------------
// Radials and the two 30 Hz signals
// ---------------------------------------------------------------------------

/** The radial: magnetic bearing FROM the station to the aircraft. */
export function radialDeg(stationPos: Vec2, aircraftPos: Vec2, variationDeg: number): number {
  return trueToMagnetic(bearingDeg(stationPos, aircraftPos), variationDeg)
}

export type VorType = 'cvor' | 'dvor'

export interface ThirtyHz {
  /** 30 Hz recovered from the 9960 Hz FM subcarrier. */
  fm: number
  /** 30 Hz amplitude modulation of the carrier. */
  am: number
  ref: number
  variable: number
}

/**
 * The two 30 Hz signals a receiver on `radial` recovers at signal time t.
 * CVOR: REF = FM, VAR = AM lagging by the radial.
 * DVOR: REF = AM, VAR = FM leading by the radial.
 */
export function thirtyHz(type: VorType, tS: number, radial: number): ThirtyHz {
  const ref = Math.cos(OMEGA * tS)
  if (type === 'cvor') {
    const v = Math.cos(OMEGA * tS - toRad(radial))
    return { fm: ref, am: v, ref, variable: v }
  }
  const v = Math.cos(OMEGA * tS + toRad(radial))
  return { fm: v, am: ref, ref, variable: v }
}

/** Phase lag (degrees, 0..360) of a 30 Hz signal against cos(ωt), from one period of samples. */
export function phaseLagDeg(fn: (tS: number) => number, samples = 256): number {
  let c = 0
  let s = 0
  const T = 1 / VOR_SIGNAL.refVarHz
  for (let i = 0; i < samples; i++) {
    const t = (i / samples) * T
    const x = fn(t)
    c += x * Math.cos(OMEGA * t)
    s += x * Math.sin(OMEGA * t)
  }
  return normalize360(toDeg(Math.atan2(s, c)))
}

/**
 * What every VOR receiver computes: how far the 30 Hz AM lags the 30 Hz FM.
 * `fm` and `am` are the two recovered 30 Hz signals as functions of time.
 */
export function receiverPhaseDifferenceDeg(fm: (tS: number) => number, am: (tS: number) => number): number {
  return normalize360(phaseLagDeg(am) - phaseLagDeg(fm))
}

// ---------------------------------------------------------------------------
// How the variable signal is made
// ---------------------------------------------------------------------------

/** CVOR: true bearing of the rotating pattern's maximum at signal time t (clockwise, north-aligned at t = 0). */
export function cvorPatternBearingDeg(tS: number, variationDeg: number): number {
  return normalize360(variationDeg + 360 * VOR_SIGNAL.refVarHz * tS)
}

/** CVOR: carrier amplitude seen far away in true direction `azTrue`: 1 + m·cos(pattern − az). */
export function cvorAmplitude(tS: number, azTrue: number, variationDeg: number, depth: number = VOR_SIGNAL.amDepth): number {
  return 1 + depth * Math.cos(toRad(cvorPatternBearingDeg(tS, variationDeg) - azTrue))
}

/**
 * DVOR: true bearing (from the ring centre) of the antenna radiating the
 * sideband at signal time t. The switching runs COUNTER-clockwise; at t = 0 it
 * is at magnetic east, moving toward magnetic north, so an observer on radial
 * 000 sees the largest Doppler shift at t = 0 (in phase with the reference).
 */
export function dvorSourceBearingDeg(tS: number, variationDeg: number): number {
  return normalize360(variationDeg + 90 - 360 * DVOR_RING.revPerS * tS)
}

/** Peak Doppler shift of a source turning on a circle: speed / wavelength = 2π·r·f_rot / λ. */
export function dvorPeakDopplerHz(radiusM: number, revPerS: number, carrierMHz: number): number {
  return (2 * Math.PI * radiusM * revPerS) / wavelengthAtMHz(carrierMHz)
}

/** Speed of the simulated source around the ring, m/s. */
export const dvorRimSpeedMs = (radiusM: number, revPerS: number) => 2 * Math.PI * radiusM * revPerS

/**
 * Doppler shift (Hz) seen far away in true direction `azTrue`: the source's
 * speed toward the observer divided by the wavelength.
 */
export function dvorDopplerHz(tS: number, azTrue: number, variationDeg: number, peakHz: number): number {
  return peakHz * Math.sin(toRad(dvorSourceBearingDeg(tS, variationDeg) - azTrue))
}

/** Phase-modulation index of the DVOR sideband: 2π·r / λ (= peak deviation / 30 Hz). */
export function dvorModulationIndex(radiusM: number, carrierMHz: number): number {
  return (2 * Math.PI * radiusM) / wavelengthAtMHz(carrierMHz)
}

// ---------------------------------------------------------------------------
// The course deviation indicator
// ---------------------------------------------------------------------------

/** Full-scale deflection: ±10° (five dots of 2°). */
export const CDI_FULL_SCALE_DEG = 10
/** TODO(expert-review): width of the zone near abeam where the TO/FROM flag shows OFF. */
export const TO_FROM_AMBIGUITY_DEG = 4

export interface VorCdi {
  toFrom: 'TO' | 'FROM' | 'OFF'
  /** Angular deviation, degrees; positive = the course is to the right (fly right). */
  deviationDeg: number
  /** Needle position as a fraction of full scale; +1 = full right. */
  lateral: number
}

/**
 * CDI for a selected course (OBS) and the received radial. The answer does
 * not depend on the aircraft's heading, just like a real VOR indicator.
 *   d = normalize180(OBS − radial)
 *   |d| ≤ 90 → FROM, deviation = d;  else → TO, deviation = normalize180(180 − d)
 */
export function vorCdi(obsDeg: number, radial: number): VorCdi {
  const d = normalize180(obsDeg - radial)
  const from = Math.abs(d) <= 90
  const deviationDeg = from ? d : normalize180(180 - d)
  const ambiguous = Math.abs(Math.abs(d) - 90) < TO_FROM_AMBIGUITY_DEG
  return { toFrom: ambiguous ? 'OFF' : from ? 'FROM' : 'TO', deviationDeg, lateral: deviationDeg / CDI_FULL_SCALE_DEG }
}

// ---------------------------------------------------------------------------
// Cone of confusion
// ---------------------------------------------------------------------------

/**
 * Above the station the signal is unusable.
 * TODO(expert-review): Annex 10 guarantees coverage up to 40° elevation; the
 * needle is modelled as swinging from 40° and the flag shows OFF above 50°.
 */
export const CONE = { swingElevationDeg: 40, flagElevationDeg: 50 } as const

/** Elevation of the aircraft seen from the station, degrees. */
export function vorElevationDeg(groundNm: number, heightAboveStationFt: number): number {
  return toDeg(Math.atan2(Math.max(0, heightAboveStationFt) / FT_PER_NM, Math.max(0, groundNm)))
}

/** Radius (NM) of the cone at a height above the station: h / tan(elevation limit). */
export function coneRadiusNm(heightAboveStationFt: number, elevationDeg: number = CONE.flagElevationDeg): number {
  return Math.max(0, heightAboveStationFt) / FT_PER_NM / Math.tan(toRad(elevationDeg))
}

export type ConeState = 'clear' | 'swing' | 'cone'

export function coneState(elevationDeg: number): ConeState {
  if (elevationDeg > CONE.flagElevationDeg) return 'cone'
  if (elevationDeg > CONE.swingElevationDeg) return 'swing'
  return 'clear'
}

/** 0 below the swing elevation, rising to 1 at the flag elevation. */
export function coneSwingFactor(elevationDeg: number): number {
  const x = clamp((elevationDeg - CONE.swingElevationDeg) / (CONE.flagElevationDeg - CONE.swingElevationDeg), 0, 1)
  return x * x
}

// ---------------------------------------------------------------------------
// Site error from a reflecting building ("scalloping")
// ---------------------------------------------------------------------------

/** TODO(expert-review): reflection strength of a building versus its distance from the station. */
export const REFLECTION = { coefficientM: 30, max: 0.3 } as const

/** Relative amplitude of the reflection from a building `distanceM` from the station. */
export function reflectionAmplitude(distanceM: number): number {
  return clamp(REFLECTION.coefficientM / Math.max(distanceM, 1), 0, REFLECTION.max)
}

/**
 * Extra path length (m) of the reflected wave: station → building → aircraft
 * minus station → aircraft, in 3D (station and building on the ground).
 */
export function reflectionPathDifferenceM(station: Vec2, building: Vec2, aircraft: Vec2, heightAboveStationFt: number): number {
  const h = Math.max(0, heightAboveStationFt) * METRES_PER_FT
  const sb = distanceNm(station, building) * METRES_PER_NM
  const ba = Math.hypot(distanceNm(building, aircraft) * METRES_PER_NM, h)
  const sa = Math.hypot(distanceNm(station, aircraft) * METRES_PER_NM, h)
  return sb + ba - sa
}

/** Bessel function of the first kind, order 1 (trapezoid rule on its integral; accurate for |x| ≲ 60). */
export function besselJ1(x: number): number {
  const n = 128
  let s = 0
  for (let i = 0; i < n; i++) {
    const tau = (2 * Math.PI * i) / n
    s += Math.cos(tau - x * Math.sin(tau))
  }
  return s / n
}

/**
 * Bearing error (degrees) caused by one reflection.
 *   thetaTrue: direction of the aircraft from the station
 *   psiTrue:   direction of the reflector from the station
 *   amplitude: reflection strength relative to the direct signal
 *   rfPhaseRad: radio phase of the reflection (2π × path difference / λ)
 *   modIndex:  DVOR phase-modulation index 2πr/λ (ignored for CVOR)
 *
 * CVOR: the reflection carries the AM pattern of direction ψ, so the error is
 *   atan(k sin(ψ−θ) / (1 + k cos(ψ−θ))), k = a·cos φ   (a few degrees).
 * DVOR: the reflection's Doppler FM differs from the direct one; only the
 *   first-harmonic part 2a·J1(M)·cos φ survives, divided by the large index m,
 *   with M = 2m·sin((ψ−θ)/2). The wide ring averages the reflection out.
 */
export function siteErrorDeg(type: VorType, thetaTrue: number, psiTrue: number, amplitude: number, rfPhaseRad: number, modIndex: number): number {
  const sep = toRad(normalize180(psiTrue - thetaTrue))
  if (type === 'cvor') {
    const k = amplitude * Math.cos(rfPhaseRad)
    return toDeg(Math.atan2(k * Math.sin(sep), 1 + k * Math.cos(sep)))
  }
  const M = 2 * modIndex * Math.sin(sep / 2)
  const k = (2 * amplitude * besselJ1(M) * Math.cos(rfPhaseRad)) / modIndex
  const delta = sep / 2 + Math.PI / 2
  return toDeg(Math.atan2(k * Math.sin(delta), 1 + k * Math.cos(delta)))
}

/** Smallest and largest site error at an azimuth as the reflection phase goes all the way round. */
export function siteErrorEnvelopeDeg(type: VorType, thetaTrue: number, psiTrue: number, amplitude: number, modIndex: number): [number, number] {
  const a = siteErrorDeg(type, thetaTrue, psiTrue, amplitude, 0, modIndex)
  const b = siteErrorDeg(type, thetaTrue, psiTrue, amplitude, Math.PI, modIndex)
  return [Math.min(a, b), Math.max(a, b)]
}

// ---------------------------------------------------------------------------
// Monitoring
// ---------------------------------------------------------------------------

/**
 * The integral monitor removes the signal when the bearing at the monitor
 * antenna shifts by more than about 1°, or a modulation drops by about 15 %.
 * TODO(expert-review): alarm limits and the changeover delay to the standby transmitter.
 */
export const MONITOR = { bearingAlarmDeg: 1, modulationDropAlarm: 0.15, changeoverS: 3 } as const

export function monitorShouldAlarm(bearingShiftDeg: number, modulationDrop = 0): boolean {
  return Math.abs(bearingShiftDeg) > MONITOR.bearingAlarmDeg || modulationDrop > MONITOR.modulationDropAlarm
}
