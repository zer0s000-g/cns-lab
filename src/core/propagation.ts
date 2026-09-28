/**
 * Radio propagation: line of sight, Earth bulge, terrain blocking,
 * free-space path loss, slant range and signal timing.
 *
 * Earth model: VHF and higher bend slightly downward in the standard
 * atmosphere, which is modelled with an "effective Earth" that is about 4/3
 * the real radius. We derive that effective radius from the aviation rule of
 * thumb  range_NM = 1.23 * (sqrt(h_tx_ft) + sqrt(h_rx_ft))  so that the
 * horizon formula and the terrain check below agree exactly.
 */

import { distanceNm, type Vec2 } from './geometry'
import {
  EARTH_RADIUS_M,
  FT_PER_NM,
  LIGHT_NM_PER_US,
  METRES_PER_FT,
  METRES_PER_NM,
  SPEED_OF_LIGHT_MS,
} from './units'

/** Rule-of-thumb constant: NM of radio horizon per sqrt(ft) of antenna height. */
export const RADIO_HORIZON_K = 1.23

/**
 * Effective Earth radius (ft) implied by the 1.23 rule:
 * horizon d = sqrt(2 R h)  ⇒  R = (1.23 · FT_PER_NM)² / 2   (≈ 8,512 km).
 */
export const EFFECTIVE_EARTH_RADIUS_FT = (RADIO_HORIZON_K * FT_PER_NM) ** 2 / 2

/** The implied k-factor relative to the real Earth (≈ 1.336, i.e. about 4/3). */
export const EFFECTIVE_K_FACTOR = (EFFECTIVE_EARTH_RADIUS_FT * METRES_PER_FT) / EARTH_RADIUS_M

/** Distance to the radio horizon for one antenna, NM. Heights in ft above the surface. */
export function radioHorizonNm(heightFt: number): number {
  return RADIO_HORIZON_K * Math.sqrt(Math.max(0, heightFt))
}

/** Maximum radio line-of-sight range between two antennas over a smooth Earth, NM. */
export function radioLineOfSightNm(hTxFt: number, hRxFt: number): number {
  return radioHorizonNm(hTxFt) + radioHorizonNm(hRxFt)
}

/**
 * Minimum height (ft) a receiver needs to be in line of sight of a
 * transmitter `rangeNm` away over a smooth Earth. Inverse of radioLineOfSightNm.
 */
export function minHeightForLineOfSightFt(hTxFt: number, rangeNm: number): number {
  const remaining = rangeNm - radioHorizonNm(hTxFt)
  if (remaining <= 0) return 0
  return (remaining / RADIO_HORIZON_K) ** 2
}

/**
 * How far the effective Earth's surface drops below a flat tangent plane at
 * distance `dNm` from the tangent point, ft.  drop = d² / (2R) = (d / 1.23)².
 */
export function earthDropFt(dNm: number): number {
  return (dNm / RADIO_HORIZON_K) ** 2
}

/**
 * Earth bulge at distance `sNm` along a path of total length `totalNm`: how much
 * a straight ray between two points on the surface sits "lower" relative to
 * the curved ground than a straight interpolation of heights would suggest.
 * bulge = s (D - s) / (2R), ft.
 */
export function earthBulgeFt(sNm: number, totalNm: number): number {
  return (sNm * (totalNm - sNm)) / RADIO_HORIZON_K ** 2
}

/**
 * Height above mean sea level of the straight radio ray at distance `sNm`
 * from the transmitter, on a path of length `totalNm` between a transmitter at
 * `hTxFt` and a receiver at `hRxFt` (both above mean sea level).
 */
export function rayHeightFt(sNm: number, totalNm: number, hTxFt: number, hRxFt: number): number {
  if (totalNm <= 0) return hTxFt
  const t = sNm / totalNm
  return hTxFt + (hRxFt - hTxFt) * t - earthBulgeFt(sNm, totalNm)
}

/** Terrain elevation function: ft above mean sea level at a map point. */
export type TerrainFn = (p: Vec2) => number

export interface LineOfSightResult {
  /** True when the ray clears the Earth and the terrain everywhere. */
  visible: boolean
  /** Smallest clearance of the ray above the ground along the path, ft (negative if blocked). */
  minClearanceFt: number
  /** Where the smallest clearance occurs (map point). */
  worstPoint: Vec2
  /** Distance from the transmitter to the worst point, NM. */
  worstDistanceNm: number
}

/**
 * Terrain-aware line-of-sight check between a transmitter and a receiver.
 * Heights are above mean sea level. Samples the path every `stepNm`.
 */
export function lineOfSight(
  tx: Vec2,
  hTxFt: number,
  rx: Vec2,
  hRxFt: number,
  terrain: TerrainFn = () => 0,
  stepNm = 0.25,
): LineOfSightResult {
  const total = distanceNm(tx, rx)
  if (total < 1e-9) {
    return { visible: true, minClearanceFt: Infinity, worstPoint: tx, worstDistanceNm: 0 }
  }
  const n = Math.max(8, Math.ceil(total / stepNm))
  let minClear = Infinity
  let worst = tx
  let worstS = 0
  // Skip the two end points: the antennas themselves sit on the terrain.
  for (let i = 1; i < n; i++) {
    const t = i / n
    const s = total * t
    const p = { x: tx.x + (rx.x - tx.x) * t, y: tx.y + (rx.y - tx.y) * t }
    const clear = rayHeightFt(s, total, hTxFt, hRxFt) - Math.max(0, terrain(p))
    if (clear < minClear) {
      minClear = clear
      worst = p
      worstS = s
    }
  }
  return { visible: minClear > 0, minClearanceFt: minClear, worstPoint: worst, worstDistanceNm: worstS }
}

/**
 * Free-space path loss, dB:  FSPL = 20·log10(4π d f / c).
 * Distance in metres, frequency in hertz.
 */
export function freeSpacePathLossDb(distanceM: number, freqHz: number): number {
  if (distanceM <= 0) return 0
  return 20 * Math.log10((4 * Math.PI * distanceM * freqHz) / SPEED_OF_LIGHT_MS)
}

/** Convenience: FSPL for a distance in NM and a frequency in MHz. */
export function freeSpacePathLossDbNm(distanceNmValue: number, freqMHz: number): number {
  return freeSpacePathLossDb(distanceNmValue * METRES_PER_NM, freqMHz * 1e6)
}

/**
 * Friis link budget: received power (dBm) = transmit power + antenna gains - path loss.
 */
export function receivedPowerDbm(
  txPowerDbm: number,
  txGainDbi: number,
  rxGainDbi: number,
  distanceM: number,
  freqHz: number,
): number {
  return txPowerDbm + txGainDbi + rxGainDbi - freeSpacePathLossDb(distanceM, freqHz)
}

/**
 * Slant range: the true straight-line distance from a ground station to an
 * aircraft, NM. Heights in ft (station elevation defaults to sea level).
 */
export function slantRangeNm(groundDistanceNm: number, altitudeFt: number, stationElevationFt = 0): number {
  const dh = (altitudeFt - stationElevationFt) / FT_PER_NM
  return Math.hypot(groundDistanceNm, dh)
}

/** Ground distance from a slant range and height difference, NM (0 inside the "cone"). */
export function groundDistanceFromSlantNm(slantNm: number, heightDiffFt: number): number {
  const dh = heightDiffFt / FT_PER_NM
  return Math.sqrt(Math.max(0, slantNm * slantNm - dh * dh))
}

/** One-way travel time of a radio signal over `distanceNm`, µs. */
export function travelTimeUs(distanceNmValue: number): number {
  return distanceNmValue / LIGHT_NM_PER_US
}

/** Round-trip travel time over `distanceNm` (there and back), µs. */
export function roundTripTimeUs(distanceNmValue: number): number {
  return (2 * distanceNmValue) / LIGHT_NM_PER_US
}

/** Distance (NM) implied by a measured round-trip echo time (µs): R = c·t/2. */
export function rangeFromRoundTripNm(roundTripUs: number): number {
  return (roundTripUs * LIGHT_NM_PER_US) / 2
}

/** One-way travel time in seconds over a distance in metres (for satellites). */
export function travelTimeS(distanceM: number): number {
  return distanceM / SPEED_OF_LIGHT_MS
}
