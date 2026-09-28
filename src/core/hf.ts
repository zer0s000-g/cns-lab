/**
 * HF radio: the ionosphere, sky-wave ray paths (secant law on a curved
 * Earth), skip zones, the maximum usable frequency (MUF), absorption, noise
 * and SELCAL.
 *
 * Model ("mirror" model): each ionospheric layer acts like a mirror at its
 * virtual height. A wave leaving the ground at elevation β meets a layer at
 * virtual height h with incidence angle i, where (spherical Earth, radius R)
 *     sin i = R·cos β / (R + h).
 * It is reflected when f ≤ f_c / cos i (the secant law), otherwise it passes
 * through to the next layer or escapes into space. One hop covers a ground
 * distance 2·R·φ with φ = π/2 − β − i. The D layer does not reflect HF; it
 * absorbs, more at lower frequencies (∝ 1/f²) and on oblique paths (∝ sec i).
 *
 * Units: ground distances NM, aircraft altitude ft (as everywhere in CNS Lab).
 * Ionospheric heights are given in km (that is how they are always quoted) and
 * converted to NM for the geometry, so R and h always share one unit.
 * Tropospheric bending is ignored for the sky wave: the true Earth radius is used.
 */

import { freeSpacePathLossDbNm, radioLineOfSightNm } from './propagation'
import { clamp, EARTH_RADIUS_NM, ftToNm, kmToNm } from './units'

const R = EARTH_RADIUS_NM
const HALF_PI = Math.PI / 2
const DEG = Math.PI / 180

// ---------------------------------------------------------------------------
// Bands, channels and SELCAL
// ---------------------------------------------------------------------------

/** HF aeronautical (R) voice lies between about 2.85 and 22 MHz, single sideband (USB, J3E). */
export const HF_AERO_RANGE_MHZ = { min: 2.85, max: 22 } as const

// TODO(expert-review): aeronautical mobile (R) HF sub-bands (ITU Radio Regulations Appendix 27), kHz.
export const HF_R_BANDS_KHZ: readonly (readonly [number, number])[] = [
  [2850, 3025],
  [3400, 3500],
  [4650, 4700],
  [5480, 5680],
  [6525, 6685],
  [8815, 8965],
  [10005, 10100],
  [11275, 11400],
  [13260, 13360],
  [17900, 17970],
  [21924, 22000],
]

// TODO(expert-review): example channel frequencies, one inside each (R) band.
/** Example HF channels, MHz, one in each aeronautical band (lowest first). */
export const HF_CHANNELS_MHZ: readonly number[] = [2.899, 3.476, 4.675, 5.616, 6.622, 8.864, 10.051, 11.336, 13.306, 17.946, 21.964]

/** SELCAL letters: 16 tones, the letters I, N and O are not used. */
export const SELCAL_LETTERS = 'ABCDEFGHJKLMPQRS'

// TODO(expert-review): SELCAL tone frequencies (ICAO Annex 10 Vol III); the newer 32-tone set is not modelled.
export const SELCAL_TONES_HZ: Readonly<Record<string, number>> = {
  A: 312.6,
  B: 346.7,
  C: 384.6,
  D: 426.6,
  E: 473.2,
  F: 524.8,
  G: 582.1,
  H: 645.7,
  J: 716.1,
  K: 794.3,
  L: 881.0,
  M: 977.2,
  P: 1083.9,
  Q: 1202.3,
  R: 1333.5,
  S: 1479.1,
}

// TODO(expert-review): SELCAL pulse length 1.0 ± 0.25 s and gap 0.2 ± 0.1 s.
/** Each tone pair lasts about 1 s; the gap between the pairs is about 0.2 s. */
export const SELCAL_PULSE_S = 1.0
export const SELCAL_GAP_S = 0.2
export const SELCAL_TOTAL_S = 2 * SELCAL_PULSE_S + SELCAL_GAP_S

/**
 * A SELCAL code is two pairs of letters, e.g. "AB-CD". Each pair is two
 * different tones sent together, written in alphabetical order.
 * TODO(expert-review): further code-assignment rules (for example no letter repeated in a code).
 */
export function isValidSelcalCode(code: string): boolean {
  const m = /^([A-Z])([A-Z])-([A-Z])([A-Z])$/.exec(code)
  if (!m) return false
  const [, a, b, c, d] = m
  if (![a, b, c, d].every((x) => SELCAL_LETTERS.includes(x))) return false
  return a < b && c < d
}

/** The two tone pairs (Hz) for a SELCAL code, or null for an invalid code. */
export function selcalPairs(code: string): [[number, number], [number, number]] | null {
  if (!isValidSelcalCode(code)) return null
  const t = (ch: string) => SELCAL_TONES_HZ[ch]
  return [
    [t(code[0]), t(code[1])],
    [t(code[3]), t(code[4])],
  ]
}

/** Which pair (0 or 1) is on the air `tS` seconds after a call started, or null during the gap / after it. */
export function selcalPairAt(tS: number): 0 | 1 | null {
  if (tS >= 0 && tS < SELCAL_PULSE_S) return 0
  const t2 = tS - SELCAL_PULSE_S - SELCAL_GAP_S
  if (t2 >= 0 && t2 < SELCAL_PULSE_S) return 1
  return null
}

// TODO(expert-review): signal-to-noise ratio a SELCAL decoder needs.
export const SELCAL_MIN_SNR_DB = 6

/** A decoder rings only for its own code, and only if the tones arrive above the noise. */
export function selcalDecodes(calledCode: string, ownCode: string, snrDb: number): boolean {
  return isValidSelcalCode(calledCode) && calledCode === ownCode && snrDb >= SELCAL_MIN_SNR_DB
}

// ---------------------------------------------------------------------------
// Sun and ionosphere
// ---------------------------------------------------------------------------

/**
 * Cosine of the Sun's zenith angle at local time `hour`, for a place on the
 * equator at the equinox (sunrise 06:00, sunset 18:00). Negative at night.
 */
export function solarCosZenith(hour: number): number {
  return Math.cos((15 * (hour - 12)) * DEG)
}

export const isDaytime = (hour: number) => solarCosZenith(hour) > 0

// TODO(expert-review): F2 build-up and decay time constant.
/** Hours the F2 ionisation takes to follow the Sun (it builds up after sunrise and decays slowly after sunset). */
export const F2_TIME_CONSTANT_H = 3

let f2Table: Float64Array | null = null
const F2_STEPS_PER_HOUR = 20

/**
 * F2 ionisation relative to its daily peak, 0..1. Solves
 * dn/dt = (sunlight − n)/τ for a periodic day, so it lags the Sun: highest in
 * the afternoon, slowly falling through the night, lowest just before dawn.
 */
export function f2Ionisation(hour: number): number {
  if (!f2Table) {
    const n = 24 * F2_STEPS_PER_HOUR
    const dt = 1 / F2_STEPS_PER_HOUR
    const k = Math.exp(-dt / F2_TIME_CONSTANT_H)
    let x = 0
    // Run five days so the start-up transient dies away, keep the last one.
    const out = new Float64Array(n)
    for (let day = 0; day < 5; day++) {
      for (let i = 0; i < n; i++) {
        const p = Math.max(0, solarCosZenith(i * dt))
        x = p + (x - p) * k
        if (day === 4) out[i] = x
      }
    }
    let peak = 0
    for (const v of out) peak = Math.max(peak, v)
    for (let i = 0; i < n; i++) out[i] /= peak
    f2Table = out
  }
  const h = (((hour % 24) + 24) % 24) * F2_STEPS_PER_HOUR
  const i0 = Math.floor(h)
  const i1 = (i0 + 1) % f2Table.length
  const t = h - i0
  return f2Table[i0 % f2Table.length] * (1 - t) + f2Table[i1] * t
}

export type LayerId = 'E' | 'F1' | 'F2' | 'F'

export interface ReflectingLayer {
  id: LayerId
  /** Virtual height, km. */
  heightKm: number
  /** Critical frequency (highest frequency reflected straight up), MHz. */
  foMHz: number
}

export interface Ionosphere {
  hour: number
  cosZenith: number
  day: boolean
  flare: boolean
  /** D-layer absorption for one vertical pass at 10 MHz, dB. */
  dAbsorptionDb: number
  /** Reflecting layers, lowest first. */
  layers: ReflectingLayer[]
}

// TODO(expert-review): every number below is a typical mid-latitude/equatorial teaching value; the real
// ionosphere varies with the solar cycle, season, latitude and from day to day.
export const D_LAYER_KM = { bottom: 60, top: 90, absorb: 75 } as const
export const E_LAYER_KM = 110
export const F1_LAYER_KM = 200
/** F2 virtual height by day, and of the single F layer at night, km. */
export const F2_DAY_KM = 330
export const F_NIGHT_KM = 300
/** foF2 at the afternoon peak and before dawn, MHz. */
export const FOF2_DAY_MHZ = 10
export const FOF2_NIGHT_MHZ = 4
/** Residual E-layer critical frequency at night, MHz. */
export const FOE_NIGHT_MHZ = 0.4
/** Smoothed sunspot number used in the E and F1 formulas (moderate solar activity). */
export const SUNSPOT_NUMBER = 100
/** D-layer absorption for one vertical pass at 10 MHz with the Sun overhead, dB. */
export const D_NOON_DB = 1.5
/** Small absorption that remains at night, dB. */
export const D_NIGHT_DB = 0.05
/** A solar flare multiplies the daytime D-layer absorption by about this much. */
export const FLARE_FACTOR = 20

/** Critical frequency of the E layer, MHz: foE ≈ 0.9·[(180 + 1.44·R₁₂)·cos χ]^¼ by day. */
export function foEMHz(cosZenith: number): number {
  if (cosZenith <= 0) return FOE_NIGHT_MHZ
  return Math.max(FOE_NIGHT_MHZ, 0.9 * ((180 + 1.44 * SUNSPOT_NUMBER) * cosZenith) ** 0.25)
}

/** The ionosphere at local time `hour` (one ionosphere for the whole path). */
export function ionosphereAt(hour: number, opts: { flare?: boolean } = {}): Ionosphere {
  const cz = solarCosZenith(hour)
  const day = cz > 0
  const sun = Math.max(0, cz)
  const n = f2Ionisation(hour)
  const foF2 = FOF2_NIGHT_MHZ + (FOF2_DAY_MHZ - FOF2_NIGHT_MHZ) * n
  const hF2 = F_NIGHT_KM + (F2_DAY_KM - F_NIGHT_KM) * n
  const layers: ReflectingLayer[] = [{ id: 'E', heightKm: E_LAYER_KM, foMHz: foEMHz(cz) }]
  // The F1 layer only forms when the Sun is well up; otherwise F1 and F2 merge into one F layer.
  const foF1 = (4.3 + 0.01 * SUNSPOT_NUMBER) * sun ** 0.2
  const hasF1 = sun > 0.15 && foF1 < 0.9 * foF2
  if (hasF1) layers.push({ id: 'F1', heightKm: F1_LAYER_KM, foMHz: foF1 })
  layers.push({ id: hasF1 ? 'F2' : 'F', heightKm: hF2, foMHz: foF2 })
  const flare = Boolean(opts.flare) && day
  const dayPart = D_NOON_DB * sun ** 0.75
  return {
    hour: ((hour % 24) + 24) % 24,
    cosZenith: cz,
    day,
    flare,
    dAbsorptionDb: D_NIGHT_DB + dayPart * (flare ? FLARE_FACTOR : 1),
    layers,
  }
}

/** The highest (F) layer: its critical frequency is foF2. */
export const topLayer = (iono: Ionosphere) => iono.layers[iono.layers.length - 1]

// ---------------------------------------------------------------------------
// Geometry (spherical Earth, straight rays between the ground and a layer)
// ---------------------------------------------------------------------------

/** Incidence angle (from the vertical) at height `hNm` of a ray leaving the ground at elevation `elevRad`. */
export function incidenceRad(elevRad: number, hNm: number): number {
  return Math.asin(clamp((R * Math.cos(elevRad)) / (R + hNm), -1, 1))
}

/** Central angle (radians) from the launch point to where the rising ray reaches height `hNm`: π/2 − β − i. */
export function centralAngleRad(elevRad: number, hNm: number): number {
  if (hNm <= 0) return 0
  return HALF_PI - elevRad - incidenceRad(elevRad, hNm)
}

/** Ground distance of one hop off a layer at virtual height `hNm`, NM: 2·R·φ. */
export function hopDistanceNm(elevRad: number, hNm: number): number {
  return 2 * R * centralAngleRad(elevRad, hNm)
}

/** Straight-line length from the ground to height `hNm` along a ray at elevation `elevRad`, NM. */
export function slantToHeightNm(elevRad: number, hNm: number): number {
  const s = Math.sin(elevRad)
  return -R * s + Math.sqrt(R * R * s * s + 2 * R * hNm + hNm * hNm)
}

/** Elevation angle (radians) whose one hop off height `hNm` covers `hopNm`, or null if no ray above the horizon does. */
export function elevationForHopRad(hopNm: number, hNm: number): number | null {
  const phi = hopNm / (2 * R)
  if (phi <= 0) return HALF_PI
  const b = Math.atan2(Math.cos(phi) - R / (R + hNm), Math.sin(phi))
  return b >= 0 ? b : null
}

/** Secant law: a layer with critical frequency `foMHz` reflects `fMHz` at incidence `incRad` when f ≤ fo / cos i. */
export function reflects(fMHz: number, foMHz: number, incRad: number): boolean {
  return fMHz <= foMHz / Math.cos(incRad) + 1e-12
}

/** Highest frequency a layer reflects at incidence `incRad`: fo · sec i. */
export function mufAtIncidenceMHz(foMHz: number, incRad: number): number {
  return foMHz / Math.cos(incRad)
}

/** The first layer (from the bottom) that reflects a ray, or null when it escapes into space. */
export function reflectingLayer(iono: Ionosphere, fMHz: number, elevRad: number): ReflectingLayer | null {
  for (const L of iono.layers) {
    if (reflects(fMHz, L.foMHz, incidenceRad(elevRad, kmToNm(L.heightKm)))) return L
  }
  return null
}

/** D-layer absorption for one pass (up or down) of a ray at elevation `elevRad`, dB: A·(10/f)²·sec i. */
export function dPassAbsorptionDb(iono: Ionosphere, fMHz: number, elevRad: number): number {
  const i = incidenceRad(elevRad, kmToNm(D_LAYER_KM.absorb))
  return (iono.dAbsorptionDb * (10 / fMHz) ** 2) / Math.cos(i)
}

// TODO(expert-review): threshold used to call a ray "absorbed".
/** A ray that has lost this much in the D layer (99.9 % of its power) is treated as absorbed. */
export const ABSORBED_DB = 30

// TODO(expert-review): lowest useful take-off angle of an HF antenna.
export const MIN_ELEVATION_DEG = 2

/** Elevation angles of the ray fan drawn in the side view, degrees. */
export function fanElevationsDeg(stepDeg = 3): number[] {
  const out: number[] = []
  for (let e = MIN_ELEVATION_DEG; e < 89; e += stepDeg) out.push(e)
  return out
}

// ---------------------------------------------------------------------------
// Ray tracing (for drawing) and reception (for listening)
// ---------------------------------------------------------------------------

export type RayFate = 'reflected' | 'absorbed' | 'escaped'

/** A point in the side view: distance along the ground from the station (NM) and height (NM). */
export interface RayPoint {
  dNm: number
  hNm: number
}

export interface RaySegment {
  from: RayPoint
  to: RayPoint
}

export interface Landing {
  dNm: number
  hops: number
  absorptionDb: number
  pathNm: number
}

export interface TracedRay {
  elevationDeg: number
  fate: RayFate
  layer: LayerId | null
  incidenceDeg: number | null
  hopNm: number | null
  segments: RaySegment[]
  landings: Landing[]
  /** Where an absorbed ray died (in the D layer). */
  absorbedAt: RayPoint | null
}

const MAX_TRACE_HOPS = 40

/** Height (km) an escaping ray is drawn up to. */
export const SPACE_KM = 600

/**
 * Follow one ray from the station (distance 0) until it is absorbed, escapes
 * or passes `maxNm`. Rays are straight between the ground and the layer.
 */
export function traceRay(iono: Ionosphere, fMHz: number, elevDeg: number, maxNm: number): TracedRay {
  const beta = elevDeg * DEG
  const hD = kmToNm(D_LAYER_KM.absorb)
  const phiD = centralAngleRad(beta, hD)
  const aPass = dPassAbsorptionDb(iono, fMHz, beta)
  const L = reflectingLayer(iono, fMHz, beta)
  const segments: RaySegment[] = []
  const landings: Landing[] = []
  const ground = (d: number): RayPoint => ({ dNm: d, hNm: 0 })

  if (!L) {
    // Escapes: one pass through the D layer on the way out.
    if (aPass >= ABSORBED_DB) {
      const at = { dNm: R * phiD, hNm: hD }
      segments.push({ from: ground(0), to: at })
      return { elevationDeg: elevDeg, fate: 'absorbed', layer: null, incidenceDeg: null, hopNm: null, segments, landings, absorbedAt: at }
    }
    const hS = kmToNm(SPACE_KM)
    segments.push({ from: ground(0), to: { dNm: R * centralAngleRad(beta, hS), hNm: hS } })
    return { elevationDeg: elevDeg, fate: 'escaped', layer: null, incidenceDeg: null, hopNm: null, segments, landings, absorbedAt: null }
  }

  const hL = kmToNm(L.heightKm)
  const hop = hopDistanceNm(beta, hL)
  const slant = slantToHeightNm(beta, hL)
  let start = 0
  let absorption = 0
  let hops = 0
  while (start < maxNm && hop > 1e-9 && hops < MAX_TRACE_HOPS) {
    absorption += aPass
    if (absorption >= ABSORBED_DB) {
      const at = { dNm: start + R * phiD, hNm: hD }
      segments.push({ from: ground(start), to: at })
      return { elevationDeg: elevDeg, fate: 'absorbed', layer: L.id, incidenceDeg: incidenceRad(beta, hL) / DEG, hopNm: hop, segments, landings, absorbedAt: at }
    }
    const top = { dNm: start + hop / 2, hNm: hL }
    segments.push({ from: ground(start), to: top })
    absorption += aPass
    if (absorption >= ABSORBED_DB) {
      const at = { dNm: start + hop - R * phiD, hNm: hD }
      segments.push({ from: top, to: at })
      return { elevationDeg: elevDeg, fate: 'absorbed', layer: L.id, incidenceDeg: incidenceRad(beta, hL) / DEG, hopNm: hop, segments, landings, absorbedAt: at }
    }
    segments.push({ from: top, to: ground(start + hop) })
    hops += 1
    start += hop
    landings.push({ dNm: start, hops, absorptionDb: absorption, pathNm: 2 * hops * slant })
  }
  return { elevationDeg: elevDeg, fate: 'reflected', layer: L.id, incidenceDeg: incidenceRad(beta, hL) / DEG, hopNm: hop, segments, landings, absorbedAt: null }
}

// TODO(expert-review): HF ground-station transmitter power, antenna gains and sea-reflection loss.
export const HF_GROUND_TX = { powerW: 1000, antennaGainDbi: 0 } as const
export const HF_AIRCRAFT_RX_GAIN_DBI = -5
export const GROUND_BOUNCE_LOSS_DB = 2
/** Height of the ground station antenna, ft (for the direct wave to a high aircraft). */
export const HF_STATION_ANTENNA_FT = 100
/** SSB voice receiver bandwidth, Hz. */
export const HF_BANDWIDTH_HZ = 3000
/** Below this SNR, HF voice is unreadable; above CLEAR it is clear. */
export const HF_USABLE_SNR_DB = 10
export const HF_CLEAR_SNR_DB = 20

/**
 * Ground-wave range, NM. The ground wave hugs the surface and dies out much
 * faster at higher frequencies (a few tens to a few hundred km over the sea).
 * TODO(expert-review): illustrative sea-path values; over land the range is much shorter.
 */
export function groundWaveRangeNm(fMHz: number): number {
  return kmToNm(250 * (3 / fMHz) ** 0.7)
}

/**
 * Noise at the receiver in the SSB bandwidth, dBm. Background (man-made and
 * galactic) noise falls with frequency (ITU-R P.372 rural man-made curve,
 * Fa = 67.2 − 27.7·log f); nearby thunderstorms add static that is much
 * stronger at the low end of HF.
 * TODO(expert-review): noise curves are illustrative (ITU-R P.372 has full maps by season and time).
 */
export function hfNoiseDbm(fMHz: number, opts: { storm?: boolean } = {}): number {
  const lg = Math.log10(fMHz)
  const faBase = 67.2 - 27.7 * lg
  let fa = faBase
  if (opts.storm) {
    const faStorm = 95 - 45 * lg
    fa = 10 * Math.log10(10 ** (faBase / 10) + 10 ** (faStorm / 10))
  }
  return -174 + 10 * Math.log10(HF_BANDWIDTH_HZ) + fa
}

const dbm = (w: number) => 10 * Math.log10(w) + 30

/** Received level (dBm) from the ground station over a path of `pathNm` with extra losses. */
export function hfLevelDbm(pathNm: number, fMHz: number, extraLossDb: number): number {
  return dbm(HF_GROUND_TX.powerW) + HF_GROUND_TX.antennaGainDbi + HF_AIRCRAFT_RX_GAIN_DBI - freeSpacePathLossDbNm(Math.max(pathNm, 0.1), fMHz) - extraLossDb
}

export type ReceptionMode = 'ground' | 'direct' | 'sky'
export type NoSignalReason = 'skip' | 'absorbed' | 'escapes' | 'gap'

export interface Reception {
  mode: ReceptionMode | null
  /** Reflecting layer and number of hops for a sky wave. */
  layer: LayerId | null
  hops: number
  elevationDeg: number | null
  levelDbm: number
  noiseDbm: number
  snrDb: number
  /** Why nothing arrives (when mode is null). */
  reason: NoSignalReason | null
  /** D-layer loss on the path used, dB. */
  absorptionDb: number
  /** For a sky wave: reached on the descending leg of hop `hops`, or on the rising leg after `hops` ground bounces. */
  leg: 'down' | 'up' | null
}

function bisect(f: (x: number) => number, lo: number, hi: number, iters = 48): number {
  let a = lo
  let b = hi
  for (let k = 0; k < iters; k++) {
    const m = (a + b) / 2
    if (f(a) * f(m) <= 0) b = m
    else a = m
  }
  return (a + b) / 2
}

/**
 * Elevation (radians) of the ray that, after `hops` reflections off height
 * `hNm`, crosses altitude `aNm` at ground distance `dNm`. `leg` 'down' is
 * the descending leg of hop `hops`; 'up' is the rising leg just after the
 * `hops`-th ground bounce. Null when no ray between the minimum elevation
 * and the vertical does it.
 */
export function elevationToReachRad(dNm: number, aNm: number, hNm: number, hops: number, leg: 'down' | 'up'): number | null {
  if (aNm <= 1e-9 && leg === 'down') {
    const b = elevationForHopRad(dNm / hops, hNm)
    return b !== null && b >= MIN_ELEVATION_DEG * DEG ? b : null
  }
  const g = (b: number) => R * (2 * hops * centralAngleRad(b, hNm) + (leg === 'down' ? -1 : 1) * centralAngleRad(b, aNm)) - dNm
  const lo = MIN_ELEVATION_DEG * DEG
  const hi = HALF_PI - 1e-6
  if (g(lo) < 0 || g(hi) > 0) return null
  return bisect(g, lo, hi)
}

const MAX_HOPS = 8

/** Cache for values that are the same for every receiver distance (one frequency, one ionosphere). */
export interface ReceptionContext {
  firstLandingNm?: number
}

/**
 * What a receiver at ground distance `dNm` and altitude `altFt` receives from
 * the ground station: ground wave, direct wave (line of sight, like VHF) or
 * the strongest sky-wave mode. Built on exactly the same rules as traceRay,
 * so a receiver hears a sky wave only where a drawn ray arrives.
 */
export function receptionAt(
  iono: Ionosphere,
  fMHz: number,
  dNm: number,
  altFt: number,
  opts: { storm?: boolean } = {},
  ctx: ReceptionContext = {},
): Reception {
  const noiseDbm = hfNoiseDbm(fMHz, opts)
  const a = ftToNm(Math.max(0, altFt))
  let best: Reception | null = null
  const consider = (r: Reception) => {
    if (!best || r.levelDbm > best.levelDbm) best = r
  }
  const base = { noiseDbm, reason: null, absorptionDb: 0, leg: null } as const

  if (dNm <= groundWaveRangeNm(fMHz)) {
    const lvl = hfLevelDbm(dNm, fMHz, 0)
    consider({ ...base, mode: 'ground', layer: null, hops: 0, elevationDeg: null, levelDbm: lvl, snrDb: lvl - noiseDbm })
  }
  if (altFt > 0 && dNm <= radioLineOfSightNm(HF_STATION_ANTENNA_FT, altFt)) {
    const lvl = hfLevelDbm(Math.hypot(dNm, a), fMHz, 0)
    consider({ ...base, mode: 'direct', layer: null, hops: 0, elevationDeg: null, levelDbm: lvl, snrDb: lvl - noiseDbm })
  }

  let sawAbsorbed = false
  let candidates = 0
  let escaping = 0
  const legs: ('down' | 'up')[] = a > 1e-9 ? ['down', 'up'] : ['down']
  for (const L of iono.layers) {
    const hL = kmToNm(L.heightKm)
    for (let n = 1; n <= MAX_HOPS; n++) {
      for (const leg of legs) {
        const b = elevationToReachRad(dNm, a, hL, n, leg)
        if (b === null) continue
        candidates++
        const refl = reflectingLayer(iono, fMHz, b)
        if (!refl) escaping++
        if (!refl || refl.id !== L.id) continue
        const passes = 2 * n
        const absorption = passes * dPassAbsorptionDb(iono, fMHz, b)
        if (absorption >= ABSORBED_DB) {
          sawAbsorbed = true
          continue
        }
        const s = slantToHeightNm(b, hL)
        const sa = slantToHeightNm(b, a)
        const path = leg === 'down' ? 2 * n * s - sa : 2 * n * s + sa
        const bounces = leg === 'down' ? n - 1 : n
        const lvl = hfLevelDbm(path, fMHz, absorption + bounces * GROUND_BOUNCE_LOSS_DB)
        consider({ mode: 'sky', layer: L.id, hops: n, elevationDeg: b / DEG, levelDbm: lvl, noiseDbm, snrDb: lvl - noiseDbm, reason: null, absorptionDb: absorption, leg })
      }
    }
  }
  if (best) return best
  let reason: NoSignalReason = 'gap'
  if (sawAbsorbed) reason = 'absorbed'
  else {
    if (ctx.firstLandingNm === undefined) ctx.firstLandingNm = firstLandingNm(iono, fMHz)
    const first = ctx.firstLandingNm
    if (Number.isFinite(first) && dNm < first) reason = 'skip'
    else if (candidates > 0 && escaping === candidates) reason = 'escapes'
  }
  return { mode: null, layer: null, hops: 0, elevationDeg: null, levelDbm: -Infinity, noiseDbm, snrDb: -Infinity, reason, absorptionDb: 0, leg: null }
}

/**
 * Shortest ground distance at which a sky wave comes back down (the end of
 * the skip zone), NM: the hop of the steepest ray that is still reflected and
 * not absorbed on its first hop. 0 when even a vertical ray is reflected
 * (f below foF2); Infinity when no ray returns at all.
 */
export function firstLandingNm(iono: Ionosphere, fMHz: number): number {
  const lo = MIN_ELEVATION_DEG * DEG
  const hi = HALF_PI
  // State of a ray: the layer that brings it back, or null if it escapes or is absorbed.
  const state = (b: number): ReflectingLayer | null => {
    const L = reflectingLayer(iono, fMHz, b)
    return L && 2 * dPassAbsorptionDb(iono, fMHz, b) < ABSORBED_DB ? L : null
  }
  const hopOf = (b: number, L: ReflectingLayer) => hopDistanceNm(b, kmToNm(L.heightKm))
  let best = Infinity
  const N = 360
  let prevB = lo
  let prev = state(lo)
  if (prev) best = hopOf(lo, prev)
  for (let k = 1; k <= N; k++) {
    const b = lo + ((hi - lo) * k) / N
    const cur = state(b)
    if (cur?.id !== prev?.id) {
      // Refine the edge between prevB and b; within one layer the hop shrinks as the ray gets steeper,
      // so the shortest hop of each stretch is at its steep end.
      let x0 = prevB
      let x1 = b
      for (let it = 0; it < 44; it++) {
        const m = (x0 + x1) / 2
        if (state(m)?.id === prev?.id) x0 = m
        else x1 = m
      }
      if (prev) best = Math.min(best, hopOf(x0, prev))
      if (cur) best = Math.min(best, hopOf(x1, cur))
    }
    if (cur) best = Math.min(best, hopOf(b, cur))
    prevB = b
    prev = cur
  }
  return best < 1e-6 ? 0 : best
}

export interface PathMuf {
  mufMHz: number
  layer: LayerId
  hops: number
  elevationDeg: number
}

/**
 * Maximum usable frequency from the station to a receiver at `dNm`, `altFt`:
 * for each layer, the lowest-order mode (fewest hops) that reaches the
 * receiver gives fo·sec i; lower layers must let that frequency through.
 * Null when no mode reaches (distance too short for the geometry is never the
 * case: steep rays always exist).
 */
export function pathMuf(iono: Ionosphere, dNm: number, altFt = 0): PathMuf | null {
  const a = ftToNm(Math.max(0, altFt))
  let best: PathMuf | null = null
  iono.layers.forEach((L, idx) => {
    const hL = kmToNm(L.heightKm)
    for (let n = 1; n <= MAX_HOPS; n++) {
      const b = elevationToReachRad(dNm, a, hL, n, 'down')
      if (b === null) continue
      const muf = mufAtIncidenceMHz(L.foMHz, incidenceRad(b, hL))
      // Screened if a lower layer would already reflect this frequency at this angle.
      const screened = iono.layers.slice(0, idx).some((lower) => reflects(muf, lower.foMHz, incidenceRad(b, kmToNm(lower.heightKm))))
      if (!screened && (!best || muf > best.mufMHz)) best = { mufMHz: muf, layer: L.id, hops: n, elevationDeg: b / DEG }
      break
    }
  })
  return best
}

// TODO(expert-review): 0.85 × MUF as the optimum working frequency (FOT/OWF).
export const OWF_FACTOR = 0.85
export const owfMHz = (mufMHz: number) => OWF_FACTOR * mufMHz

export type HfQuality = 'clear' | 'noisy' | 'unreadable' | 'none'

export function hfQuality(r: Reception): HfQuality {
  if (!r.mode) return 'none'
  if (r.snrDb >= HF_CLEAR_SNR_DB) return 'clear'
  if (r.snrDb >= HF_USABLE_SNR_DB) return 'noisy'
  return 'unreadable'
}

/**
 * Suggested channel: the highest listed channel at or below the optimum
 * working frequency (0.85 × MUF) that is actually readable at the receiver.
 */
export function suggestChannel(iono: Ionosphere, dNm: number, altFt: number, opts: { storm?: boolean } = {}): { mHz: number; index: number } | null {
  const m = pathMuf(iono, dNm, altFt)
  const limit = m ? owfMHz(m.mufMHz) : Infinity
  for (let i = HF_CHANNELS_MHZ.length - 1; i >= 0; i--) {
    const f = HF_CHANNELS_MHZ[i]
    if (f > limit) continue
    const r = receptionAt(iono, f, dNm, altFt, opts)
    if (r.mode && r.snrDb >= HF_USABLE_SNR_DB) return { mHz: f, index: i }
  }
  return null
}

export type BandKind = 'ground' | 'sky' | 'weak' | 'skip' | 'absorbed' | 'none'

export interface BandSegment {
  kind: BandKind
  fromNm: number
  toNm: number
}

/**
 * Coverage along the ground (receiver at sea level), sampled every `stepNm`:
 * where the ground wave or a sky wave is heard, where it is too weak, and the
 * skip zone. Uses receptionAt, so it agrees with the ray paths and the
 * aircraft's own reception.
 */
export function groundCoverage(iono: Ionosphere, fMHz: number, maxNm: number, stepNm: number, opts: { storm?: boolean } = {}): BandSegment[] {
  const out: BandSegment[] = []
  const ctx: ReceptionContext = {}
  for (let d = stepNm / 2; d < maxNm; d += stepNm) {
    const r = receptionAt(iono, fMHz, d, 0, opts, ctx)
    let kind: BandKind
    if (r.mode === 'ground') kind = 'ground'
    else if (r.mode === 'sky') kind = r.snrDb >= HF_USABLE_SNR_DB ? 'sky' : 'weak'
    else if (r.reason === 'skip') kind = 'skip'
    else if (r.reason === 'absorbed') kind = 'absorbed'
    else kind = 'none'
    const from = d - stepNm / 2
    const to = Math.min(maxNm, d + stepNm / 2)
    const last = out[out.length - 1]
    if (last && last.kind === kind) last.toNm = to
    else out.push({ kind, fromNm: from, toNm: to })
  }
  return out
}

/** The skip zone along the ground (from the end of the ground wave to the first sky-wave landing), or null. */
export function skipZoneNm(iono: Ionosphere, fMHz: number): { fromNm: number; toNm: number } | null {
  const from = groundWaveRangeNm(fMHz)
  const to = firstLandingNm(iono, fMHz)
  if (!Number.isFinite(to) || to <= from) return null
  return { fromNm: from, toNm: to }
}

// ---------------------------------------------------------------------------
// Side view on the true (curved) Earth
// ---------------------------------------------------------------------------

/**
 * Where to draw a point at ground distance `dNm` and height `hNm` in a flat
 * frame centred on `centerNm` (NM on both axes). Exact circle geometry, so a
 * straight ray stays straight on screen (after any scaling of the axes).
 */
export function hfSidePoint(dNm: number, hNm: number, centerNm: number): { x: number; y: number } {
  const psi = (dNm - centerNm) / R
  return { x: (R + hNm) * Math.sin(psi), y: (R + hNm) * Math.cos(psi) - R }
}

// ---------------------------------------------------------------------------
// Fading (for audio and meters only)
// ---------------------------------------------------------------------------

/** Slow sky-wave fading, dB (deterministic sum of slow waves, roughly ±6 dB). TODO(expert-review): fading depth and rate. */
export function skyFadingDb(tS: number, seed = 0): number {
  const s = seed * 1.618
  return 3.2 * Math.sin(tS * 0.9 + s) + 2 * Math.sin(tS * 2.3 + 1.7 * s) + 1.2 * Math.sin(tS * 5.1 + 0.4 + s)
}
