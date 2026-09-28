/**
 * ADS-B (1090 MHz Extended Squitter) and ADS-C.
 *
 * ADS-B Out: the aircraft works out its own position with GNSS and broadcasts
 * it in 112-bit DF17 messages on 1090 MHz. Position is packed with CPR
 * (Compact Position Reporting, 17 bits for latitude and 17 for longitude).
 * Message layouts follow RTCA DO-260B / ICAO Doc 9871.
 *
 * ADS-C: point-to-point reports to one ATC centre under a "contract"
 * (periodic, event or demand), usually over satellite data link (FANS 1/A).
 *
 * Units: NM, ft, kt, ft/min, seconds, degrees TRUE.
 */

import { bearingDeg, crossTrackNm, normalize360, toDeg, toRad, type LatLon, type Vec2 } from './geometry'
import { EARTH_RADIUS_M, SPEED_OF_LIGHT_MS } from './units'
import { bitsToHex, bitsToNumber, hexToBits, modeSCrcRemainder, modeSParity, MONOPULSE_SIGMA_AZ_DEG, numberToBits, SSR_SIGMA_RANGE_NM } from './ssr'

export const ES_FREQ_MHZ = 1090
/** Universal Access Transceiver: a second ADS-B link used only in the United States. */
export const UAT_FREQ_MHZ = 978
export const ES_BITS = 112
export const ES_DF = 17

// ---------------------------------------------------------------------------
// Broadcast rates
// ---------------------------------------------------------------------------

// TODO(expert-review): DO-260B nominal airborne rates — position and velocity each 0.4–0.6 s (about twice a second), identification 4.8–5.2 s.
export const POSITION_INTERVAL_S: readonly [number, number] = [0.4, 0.6]
export const VELOCITY_INTERVAL_S: readonly [number, number] = [0.4, 0.6]
export const IDENT_INTERVAL_S: readonly [number, number] = [4.8, 5.2]

/** Random interval inside [min, max] from a uniform roll in [0, 1). Randomising avoids repeated collisions. */
export function broadcastIntervalS(range: readonly [number, number], roll: number): number {
  return range[0] + (range[1] - range[0]) * roll
}

// ---------------------------------------------------------------------------
// Quality indicators
// ---------------------------------------------------------------------------

export interface QualityLevel {
  value: number
  /** Bound in metres, or null for "unknown". */
  boundM: number | null
  text: string
}

const NM = 1852

/** NACp: Navigation Accuracy Category for position — 95% of position errors are inside this bound (EPU). */
// TODO(expert-review): NACp bounds (DO-260B Table 2-70).
export const NACP_TABLE: QualityLevel[] = [
  { value: 11, boundM: 3, text: 'better than 3 m' },
  { value: 10, boundM: 10, text: 'better than 10 m' },
  { value: 9, boundM: 30, text: 'better than 30 m' },
  { value: 8, boundM: 0.05 * NM, text: 'better than 0.05 NM (93 m)' },
  { value: 7, boundM: 0.1 * NM, text: 'better than 0.1 NM (185 m)' },
  { value: 6, boundM: 0.3 * NM, text: 'better than 0.3 NM (556 m)' },
  { value: 5, boundM: 0.5 * NM, text: 'better than 0.5 NM' },
  { value: 4, boundM: 1 * NM, text: 'better than 1 NM' },
  { value: 3, boundM: 2 * NM, text: 'better than 2 NM' },
  { value: 2, boundM: 4 * NM, text: 'better than 4 NM' },
  { value: 1, boundM: 10 * NM, text: 'better than 10 NM' },
  { value: 0, boundM: null, text: 'unknown' },
]

/** NIC: Navigation Integrity Category — the containment radius the position is guaranteed to be inside. */
// TODO(expert-review): NIC containment radii (DO-260B Table 2-14; NIC 6 has several radii depending on supplements).
export const NIC_TABLE: QualityLevel[] = [
  { value: 11, boundM: 7.5, text: 'within 7.5 m' },
  { value: 10, boundM: 25, text: 'within 25 m' },
  { value: 9, boundM: 75, text: 'within 75 m' },
  { value: 8, boundM: 0.1 * NM, text: 'within 0.1 NM' },
  { value: 7, boundM: 0.2 * NM, text: 'within 0.2 NM' },
  { value: 6, boundM: 0.6 * NM, text: 'within 0.6 NM' },
  { value: 5, boundM: 1 * NM, text: 'within 1 NM' },
  { value: 4, boundM: 2 * NM, text: 'within 2 NM' },
  { value: 3, boundM: 4 * NM, text: 'within 4 NM' },
  { value: 2, boundM: 8 * NM, text: 'within 8 NM' },
  { value: 1, boundM: 20 * NM, text: 'within 20 NM' },
  { value: 0, boundM: null, text: 'unknown' },
]

export function nacpInfo(n: number): QualityLevel {
  return NACP_TABLE.find((q) => q.value === n) ?? NACP_TABLE[NACP_TABLE.length - 1]
}

export function nicInfo(n: number): QualityLevel {
  return NIC_TABLE.find((q) => q.value === n) ?? NIC_TABLE[NIC_TABLE.length - 1]
}

/** Best (highest) NACp whose bound still contains a 95% error of `epuM` metres. */
export function nacpForEpuM(epuM: number): number {
  for (const q of NACP_TABLE) if (q.boundM != null && epuM < q.boundM) return q.value
  return 0
}

/** For a 2D Gaussian error with standard deviation σ per axis, 95% of errors are inside 2.448 σ. */
export const EPU95_PER_SIGMA = Math.sqrt(-2 * Math.log(0.05))

/** Standard deviation per axis (NM) of a position error whose 95% bound is `epuM` metres. */
export function sigmaNmForEpuM(epuM: number): number {
  return epuM / NM / EPU95_PER_SIGMA
}

// ---------------------------------------------------------------------------
// Callsign (6-bit character set) and altitude
// ---------------------------------------------------------------------------

const CHARSET = '#ABCDEFGHIJKLMNOPQRSTUVWXYZ##### ###############0123456789######'

/** 8 characters × 6 bits. Letters, digits and spaces only. */
export function encodeCallsign(callsign: string): number[] {
  const s = callsign.toUpperCase().padEnd(8, ' ').slice(0, 8)
  const bits: number[] = []
  for (const ch of s) {
    const i = ch === '#' ? -1 : CHARSET.indexOf(ch)
    if (i < 0) throw new Error(`Character "${ch}" cannot be sent in a callsign`)
    bits.push(...numberToBits(i, 6))
  }
  return bits
}

export function decodeCallsign(bits: number[]): string {
  let s = ''
  for (let i = 0; i < 48; i += 6) s += CHARSET[bitsToNumber(bits.slice(i, i + 6))]
  return s.replace(/[ #]+$/, '')
}

/** 12-bit altitude field (Q = 1, 25 ft steps): N = (alt + 1000) / 25, Q bit inserted as the 8th bit. */
export function encodeAltitude12(altitudeFt: number): number {
  const n = Math.max(0, Math.min(2047, Math.round((altitudeFt + 1000) / 25)))
  return ((n >> 4) << 5) | (1 << 4) | (n & 0xf)
}

export function decodeAltitude12(v: number): number | null {
  if (((v >> 4) & 1) !== 1) return null // Gillham-coded altitudes are not used here
  const n = ((v >> 5) << 4) | (v & 0xf)
  return n * 25 - 1000
}

// ---------------------------------------------------------------------------
// CPR: Compact Position Reporting (airborne, 17 bits)
// ---------------------------------------------------------------------------

export const CPR_NZ = 15
const CPR_SCALE = 2 ** 17

const mod = (a: number, b: number) => a - b * Math.floor(a / b)

/** Number of longitude zones at a latitude. */
export function cprNL(latDeg: number): number {
  const a = Math.abs(latDeg)
  if (a === 0) return 59
  if (a === 87) return 2
  if (a > 87) return 1
  const x = 1 - (1 - Math.cos(Math.PI / (2 * CPR_NZ))) / Math.cos((Math.PI / 180) * a) ** 2
  return Math.floor((2 * Math.PI) / Math.acos(x))
}

export interface CprPosition {
  /** Encoded latitude, 0 … 2¹⁷ − 1. */
  yz: number
  /** Encoded longitude, 0 … 2¹⁷ − 1. */
  xz: number
  odd: boolean
}

/** Encode a position into an even (odd = false) or odd CPR frame. */
export function cprEncode(p: LatLon, odd: boolean): CprPosition {
  const i = odd ? 1 : 0
  const dlat = 360 / (4 * CPR_NZ - i)
  const yz = Math.floor((CPR_SCALE * mod(p.lat, dlat)) / dlat + 0.5)
  const rlat = dlat * (yz / CPR_SCALE + Math.floor(p.lat / dlat))
  const nl = cprNL(rlat)
  const dlon = 360 / Math.max(nl - i, 1)
  const xz = Math.floor((CPR_SCALE * mod(p.lon, dlon)) / dlon + 0.5)
  return { yz: mod(yz, CPR_SCALE), xz: mod(xz, CPR_SCALE), odd }
}

const wrapLon = (lon: number) => (lon >= 180 ? lon - 360 : lon < -180 ? lon + 360 : lon)

/**
 * Globally unambiguous decode from one even and one odd frame (received
 * within about 10 s of each other). `newest` says which one is more recent;
 * its position is returned. Null if the two lie in different longitude zones.
 */
export function cprDecodeGlobal(even: CprPosition, odd: CprPosition, newest: 'even' | 'odd'): LatLon | null {
  const lat0 = even.yz / CPR_SCALE
  const lat1 = odd.yz / CPR_SCALE
  const lon0 = even.xz / CPR_SCALE
  const lon1 = odd.xz / CPR_SCALE
  const dlat0 = 360 / 60
  const dlat1 = 360 / 59
  const j = Math.floor(59 * lat0 - 60 * lat1 + 0.5)
  let rlat0 = dlat0 * (mod(j, 60) + lat0)
  let rlat1 = dlat1 * (mod(j, 59) + lat1)
  if (rlat0 >= 270) rlat0 -= 360
  if (rlat1 >= 270) rlat1 -= 360
  if (cprNL(rlat0) !== cprNL(rlat1)) return null
  const lat = newest === 'even' ? rlat0 : rlat1
  const nl = cprNL(lat)
  const ni = Math.max(newest === 'even' ? nl : nl - 1, 1)
  const m = Math.floor(lon0 * (nl - 1) - lon1 * nl + 0.5)
  const lon = (360 / ni) * (mod(m, ni) + (newest === 'even' ? lon0 : lon1))
  return { lat, lon: wrapLon(lon) }
}

/** Decode one frame using a reference position within about 180 NM (e.g. the receiver or the last track position). */
export function cprDecodeLocal(ref: LatLon, cpr: CprPosition): LatLon {
  const i = cpr.odd ? 1 : 0
  const dlat = 360 / (4 * CPR_NZ - i)
  const yzf = cpr.yz / CPR_SCALE
  const j = Math.floor(ref.lat / dlat) + Math.floor(0.5 + mod(ref.lat, dlat) / dlat - yzf)
  const lat = dlat * (j + yzf)
  const dlon = 360 / Math.max(cprNL(lat) - i, 1)
  const xzf = cpr.xz / CPR_SCALE
  const m = Math.floor(ref.lon / dlon) + Math.floor(0.5 + mod(ref.lon, dlon) / dlon - xzf)
  return { lat, lon: wrapLon(dlon * (m + xzf)) }
}

// ---------------------------------------------------------------------------
// Message fields (ME, 56 bits) and the DF17 frame
// ---------------------------------------------------------------------------

export type EmitterCategory = 'light' | 'medium' | 'heavy'
/** Category set A (type code 4): 1 light, 3 large, 5 heavy. */
const CATEGORY_CODE: Record<EmitterCategory, number> = { light: 1, medium: 3, heavy: 5 }

export function identificationMe(callsign: string, category: EmitterCategory): number[] {
  return [...numberToBits(4, 5), ...numberToBits(CATEGORY_CODE[category], 3), ...encodeCallsign(callsign)]
}

/** Airborne position type code (9–18) for a NIC value; also the NIC supplement-B bit. */
// TODO(expert-review): NIC ↔ type code mapping; NIC supplement-A (sent in operational status) is assumed equal to supplement-B.
export function positionTypeCode(nic: number): { tc: number; nicB: 0 | 1 } {
  switch (nic) {
    case 11:
      return { tc: 9, nicB: 0 }
    case 10:
      return { tc: 10, nicB: 0 }
    case 9:
      return { tc: 11, nicB: 1 }
    case 8:
      return { tc: 11, nicB: 0 }
    case 7:
      return { tc: 12, nicB: 0 }
    case 6:
      return { tc: 13, nicB: 0 }
    case 5:
      return { tc: 14, nicB: 0 }
    case 4:
      return { tc: 15, nicB: 0 }
    case 3:
      return { tc: 16, nicB: 1 }
    case 2:
      return { tc: 16, nicB: 0 }
    case 1:
      return { tc: 17, nicB: 0 }
    default:
      return { tc: 18, nicB: 0 }
  }
}

export function nicFromTypeCode(tc: number, nicB: number): number {
  const table: Record<number, number> = { 9: 11, 10: 10, 12: 7, 13: 6, 14: 5, 15: 4, 17: 1, 18: 0 }
  if (tc === 11) return nicB ? 9 : 8
  if (tc === 16) return nicB ? 3 : 2
  return table[tc] ?? 0
}

export interface PositionFields {
  nic: number
  altitudeFt: number
  pos: LatLon
  odd: boolean
}

export function airbornePositionMe(f: PositionFields): number[] {
  const { tc, nicB } = positionTypeCode(f.nic)
  const cpr = cprEncode(f.pos, f.odd)
  return [
    ...numberToBits(tc, 5),
    ...numberToBits(0, 2), // surveillance status
    nicB,
    ...numberToBits(encodeAltitude12(f.altitudeFt), 12),
    0, // time flag
    f.odd ? 1 : 0,
    ...numberToBits(cpr.yz, 17),
    ...numberToBits(cpr.xz, 17),
  ]
}

/** Type code 0: no position available (e.g. GNSS lost). Barometric altitude is still sent. */
export function noPositionMe(altitudeFt: number): number[] {
  return [...numberToBits(0, 5), 0, 0, 0, ...numberToBits(encodeAltitude12(altitudeFt), 12), ...new Array(36).fill(0)]
}

export interface VelocityFields {
  /** East component, kt (negative = west). */
  eastKt: number
  /** North component, kt (negative = south). */
  northKt: number
  verticalRateFpm: number
}

/** Airborne velocity, subtype 1 (ground speed as east and north components). */
export function velocityMe(f: VelocityFields): number[] {
  const comp = (v: number) => Math.min(1023, Math.round(Math.abs(v)) + 1)
  const vr = Math.min(511, Math.round(Math.abs(f.verticalRateFpm) / 64) + 1)
  return [
    ...numberToBits(19, 5),
    ...numberToBits(1, 3),
    0, // intent change
    0, // reserved (IFR capability in older versions)
    ...numberToBits(1, 3), // NACv
    f.eastKt < 0 ? 1 : 0,
    ...numberToBits(comp(f.eastKt), 10),
    f.northKt < 0 ? 1 : 0,
    ...numberToBits(comp(f.northKt), 10),
    1, // vertical rate source: barometric
    f.verticalRateFpm < 0 ? 1 : 0,
    ...numberToBits(vr, 9),
    0,
    0,
    ...numberToBits(0, 8), // GNSS − baro difference (not modelled)
  ]
}

/** DF17 extended squitter: DF (5) CA (3) AA (24) ME (56) PI (24) = 112 bits. */
export function df17(address: number, me: number[], capability = 5): number[] {
  if (me.length !== 56) throw new Error('ME field must be 56 bits')
  const bits = [...numberToBits(ES_DF, 5), ...numberToBits(capability, 3), ...numberToBits(address >>> 0, 24), ...me, ...new Array(24).fill(0)]
  return bits.slice(0, 88).concat(numberToBits(modeSParity(bits), 24))
}

export type EsKind = 'identification' | 'position' | 'no-position' | 'velocity' | 'other'

export interface DecodedEs {
  df: number
  address: number
  tc: number
  crcOk: boolean
  kind: EsKind
  callsign?: string
  category?: number
  altitudeFt?: number | null
  cpr?: CprPosition
  nic?: number
  eastKt?: number
  northKt?: number
  groundSpeedKt?: number
  trackDeg?: number
  verticalRateFpm?: number
}

/** Decode a DF17 message (bits or hex). */
export function decodeEs(input: number[] | string): DecodedEs {
  const bits = typeof input === 'string' ? hexToBits(input) : input
  const df = bitsToNumber(bits.slice(0, 5))
  const address = bitsToNumber(bits.slice(8, 32))
  const me = bits.slice(32, 88)
  const tc = bitsToNumber(me.slice(0, 5))
  const base = { df, address, tc, crcOk: modeSCrcRemainder(bits) === 0 }
  if (tc >= 1 && tc <= 4) {
    return { ...base, kind: 'identification', category: bitsToNumber(me.slice(5, 8)), callsign: decodeCallsign(me.slice(8, 56)) }
  }
  if (tc === 0) return { ...base, kind: 'no-position', altitudeFt: decodeAltitude12(bitsToNumber(me.slice(8, 20))), nic: 0 }
  if (tc >= 9 && tc <= 18) {
    return {
      ...base,
      kind: 'position',
      nic: nicFromTypeCode(tc, me[7]),
      altitudeFt: decodeAltitude12(bitsToNumber(me.slice(8, 20))),
      cpr: { odd: me[21] === 1, yz: bitsToNumber(me.slice(22, 39)), xz: bitsToNumber(me.slice(39, 56)) },
    }
  }
  if (tc === 19) {
    const sEw = me[13]
    const vEw = bitsToNumber(me.slice(14, 24))
    const sNs = me[24]
    const vNs = bitsToNumber(me.slice(25, 35))
    const sVr = me[36]
    const vr = bitsToNumber(me.slice(37, 46))
    const eastKt = (sEw ? -1 : 1) * (vEw - 1)
    const northKt = (sNs ? -1 : 1) * (vNs - 1)
    return {
      ...base,
      kind: 'velocity',
      eastKt,
      northKt,
      groundSpeedKt: Math.hypot(eastKt, northKt),
      trackDeg: normalize360(toDeg(Math.atan2(eastKt, northKt))),
      verticalRateFpm: (sVr ? -1 : 1) * (vr - 1) * 64,
    }
  }
  return { ...base, kind: 'other' }
}

export { bitsToHex }

// ---------------------------------------------------------------------------
// Velocity helpers
// ---------------------------------------------------------------------------

/** East and north components (kt) of a ground speed along a TRUE track. */
export function velocityComponents(speedKt: number, trackDeg: number): { eastKt: number; northKt: number } {
  return { eastKt: speedKt * Math.sin(toRad(trackDeg)), northKt: speedKt * Math.cos(toRad(trackDeg)) }
}

// ---------------------------------------------------------------------------
// Position errors: GNSS and radar
// ---------------------------------------------------------------------------

/**
 * One step of a first-order Gauss–Markov error (NM per axis): GNSS errors
 * wander slowly instead of jumping independently at every fix.
 */
export function gaussMarkovStep(e: Vec2, dt: number, sigmaNm: number, tauS: number, gauss: () => number): Vec2 {
  if (dt <= 0) return e
  const a = Math.exp(-dt / tauS)
  const b = sigmaNm * Math.sqrt(1 - a * a)
  return { x: e.x * a + b * gauss(), y: e.y * a + b * gauss() }
}

export interface RadarAccuracy {
  /** Azimuth error, 1σ, degrees. */
  sigmaAzDeg: number
  /** Range error, 1σ, NM. */
  sigmaRangeNm: number
}

/** Typical monopulse secondary radar accuracy (1σ), from ssr.ts. */
export const MSSR_ACCURACY: RadarAccuracy = { sigmaAzDeg: MONOPULSE_SIGMA_AZ_DEG, sigmaRangeNm: SSR_SIGMA_RANGE_NM }

/** Sideways (cross-range) error of a radar plot, 1σ, NM: it grows in proportion to range. */
export function crossRangeSigmaNm(rangeNm: number, sigmaAzDeg: number): number {
  return rangeNm * toRad(sigmaAzDeg)
}

/** A radar plot: the true position measured in range and azimuth from the site, with errors. */
export function radarMeasure(site: Vec2, target: Vec2, acc: RadarAccuracy, gauss: () => number): Vec2 {
  const r = Math.hypot(target.x - site.x, target.y - site.y)
  const az = bearingDeg(site, target)
  const rm = Math.max(0, r + gauss() * acc.sigmaRangeNm)
  const am = toRad(az + gauss() * acc.sigmaAzDeg)
  return { x: site.x + Math.sin(am) * rm, y: site.y + Math.cos(am) * rm }
}

// ---------------------------------------------------------------------------
// GNSS jamming
// ---------------------------------------------------------------------------

export interface Jammer {
  pos: Vec2
  heightFt: number
  /** Inside this ground distance receivers start to lose accuracy, NM. */
  degradeRadiusNm: number
  /** Inside this ground distance GNSS is lost completely, NM. */
  denyRadiusNm: number
}

/** Jamming strength 0 (none) … 1 (GNSS lost) at a ground distance from the jammer. */
// TODO(expert-review): jamming footprint model (two radii, linear in between) is illustrative; real effects depend on power, antenna and receiver.
export function jammingLevel(distanceNm: number, lineOfSight: boolean, j: Jammer): number {
  if (!lineOfSight || distanceNm >= j.degradeRadiusNm) return 0
  if (distanceNm <= j.denyRadiusNm) return 1
  return (j.degradeRadiusNm - distanceNm) / (j.degradeRadiusNm - j.denyRadiusNm)
}

export interface GnssQuality {
  nacp: number
  nic: number
  lost: boolean
}

/** Position quality reported under a given jamming level. Quality falls as jamming rises, then the fix is lost. */
export function qualityUnderJamming(base: { nacp: number; nic: number }, level: number): GnssQuality {
  if (level >= 1) return { nacp: 0, nic: 0, lost: true }
  if (level <= 0) return { ...base, lost: false }
  return {
    nacp: Math.max(Math.min(base.nacp, 5), Math.round(base.nacp - level * (base.nacp - 5))),
    nic: Math.max(Math.min(base.nic, 4), Math.round(base.nic - level * (base.nic - 4))),
    lost: false,
  }
}

// ---------------------------------------------------------------------------
// ADS-B In (cockpit traffic display)
// ---------------------------------------------------------------------------

/** Relative altitude tag in hundreds of feet, as on traffic displays: +05 is 500 ft above. */
export function relativeAltitudeTag(ownFt: number, otherFt: number): string {
  const h = Math.round((otherFt - ownFt) / 100)
  if (h === 0) return '00'
  return `${h > 0 ? '+' : '−'}${String(Math.abs(h)).padStart(2, '0')}`
}

/**
 * Position of `p` relative to own ship on a display that is rotated so that
 * `upDeg` (a TRUE direction: own track for track-up, 0 for north-up) points up.
 * Result: x right, y up, NM.
 */
export function displayOffset(own: Vec2, upDeg: number, p: Vec2): Vec2 {
  const dx = p.x - own.x
  const dy = p.y - own.y
  const a = toRad(upDeg)
  return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) }
}

// ---------------------------------------------------------------------------
// Space-based ADS-B
// ---------------------------------------------------------------------------

/** Extra delay for ADS-B heard by satellites and relayed to the ground. */
// TODO(expert-review): space-based ADS-B end-to-end latency (about 1–2 s).
export const SPACE_ADSB_LATENCY_S = 1.5

// ---------------------------------------------------------------------------
// ADS-C
// ---------------------------------------------------------------------------

export type AdscReportKind = 'periodic' | 'event' | 'demand'
export type AdscEventKind = 'altitude-range' | 'lateral-deviation' | 'vertical-rate' | 'waypoint-change'

export const ADSC_EVENT_TEXT: Record<AdscEventKind, string> = {
  'altitude-range': 'Left the agreed altitude band',
  'lateral-deviation': 'Drifted off the cleared route',
  'vertical-rate': 'Climbing or descending faster than the limit',
  'waypoint-change': 'Passed a waypoint (next waypoint changed)',
}

export interface AdscEventContract {
  altitudeRange: { floorFt: number; ceilingFt: number } | null
  lateralDeviationNm: number | null
  /** Magnitude of vertical rate that triggers a report, ft/min. */
  verticalRateFpm: number | null
  waypointChange: boolean
}

export interface AdscSample {
  altitudeFt: number
  /** Signed distance from the cleared route (positive right), NM. */
  crossTrackNm: number
  verticalRateFpm: number
  /** Index of the next waypoint on the route. */
  nextWaypoint: number
}

/** Periodic interval the learner can choose, minutes. */
// TODO(expert-review): oceanic periodic contract intervals (commonly 14–27 min in some regions).
export const ADSC_PERIODIC_MIN: readonly [number, number] = [5, 30]
export const ADSC_DEFAULT_PERIODIC_MIN = 14

/**
 * Events that fire between two samples. Each event fires on the edge where
 * the limit is crossed, so a steady deviation sends one report, not a stream.
 */
// TODO(expert-review): re-arming of event contracts after they trigger (FANS 1/A behaviour differs by event).
export function adscEventsTriggered(prev: AdscSample, now: AdscSample, c: AdscEventContract): AdscEventKind[] {
  const out: AdscEventKind[] = []
  if (c.altitudeRange) {
    const inside = (a: number) => a >= c.altitudeRange!.floorFt && a <= c.altitudeRange!.ceilingFt
    if (inside(prev.altitudeFt) && !inside(now.altitudeFt)) out.push('altitude-range')
  }
  if (c.lateralDeviationNm != null) {
    if (Math.abs(prev.crossTrackNm) <= c.lateralDeviationNm && Math.abs(now.crossTrackNm) > c.lateralDeviationNm) out.push('lateral-deviation')
  }
  if (c.verticalRateFpm != null) {
    if (Math.abs(prev.verticalRateFpm) <= c.verticalRateFpm && Math.abs(now.verticalRateFpm) > c.verticalRateFpm) out.push('vertical-rate')
  }
  if (c.waypointChange && prev.nextWaypoint !== now.nextWaypoint) out.push('waypoint-change')
  return out
}

/** Delivery time of an ADS-C report over SATCOM and the ground network, s. */
// TODO(expert-review): ADS-C delivery time (RSP 180 expects 95% of reports within 90 s); 20–80 s here.
export const ADSC_LATENCY_S: readonly [number, number] = [20, 80]

export function adscLatencyS(roll: number): number {
  return ADSC_LATENCY_S[0] + (ADSC_LATENCY_S[1] - ADSC_LATENCY_S[0]) * roll
}

/** Geostationary orbit altitude above the equator, km. */
export const GEO_ALTITUDE_KM = 35_786

/** Distance from a place on Earth to a geostationary satellite seen at `elevationDeg`, km. */
export function geoSlantRangeKm(elevationDeg: number): number {
  const re = EARTH_RADIUS_M / 1000
  const rs = re + GEO_ALTITUDE_KM
  const e = toRad(elevationDeg)
  return Math.sqrt(rs * rs - (re * Math.cos(e)) ** 2) - re * Math.sin(e)
}

/** Radio travel time aircraft → satellite → ground station, s (about a quarter of a second). */
export function geoHopDelayS(elevationUpDeg: number, elevationDownDeg: number): number {
  return ((geoSlantRangeKm(elevationUpDeg) + geoSlantRangeKm(elevationDownDeg)) * 1000) / SPEED_OF_LIGHT_MS
}

/** Signed cross-track distance (NM, positive right) of p from the leg a → b. */
export function crossTrackFromLegNm(p: Vec2, a: Vec2, b: Vec2): number {
  return crossTrackNm(p, a, bearingDeg(a, b))
}
