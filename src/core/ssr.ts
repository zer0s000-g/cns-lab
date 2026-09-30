/**
 * Secondary surveillance radar (SSR): Mode A/C and Mode S signals.
 *
 * Signal formats follow ICAO Annex 10, Volume IV (Surveillance Radar and
 * Collision Avoidance Systems). Times are microseconds (µs). Distances are
 * nautical miles, levels are dBm, angles degrees.
 *
 *   Uplink   (ground → aircraft, the "question")  1030 MHz
 *   Downlink (aircraft → ground, the "answer")    1090 MHz
 *
 * Mode A/C reply (times from the leading edge of F1):
 *   F1 C1 A1 C2 A2 C4 A4 X B1 D1 B2 D2 B4 D4 F2  (SPI)
 *   0  1.45 ...                  18.85      20.3  24.65
 */

import { normalize180 } from './geometry'
import { freeSpacePathLossDbNm, rangeFromRoundTripNm, roundTripTimeUs } from './propagation'

export const SSR_UPLINK_MHZ = 1030
export const SSR_DOWNLINK_MHZ = 1090

// ---------------------------------------------------------------------------
// Interrogation (uplink): P1, P2, P3
// ---------------------------------------------------------------------------

export type ModeAC = 'A' | 'C'

/** Width of the P1, P2 and P3 interrogation pulses, µs. */
export const INTERROGATION_PULSE_US = 0.8
/** P2 follows P1 by 2 µs. It is sent from the control (omnidirectional) antenna. */
export const P1_P2_US = 2
/** P1 → P3 spacing selects the question: Mode A (identity) 8 µs, Mode C (altitude) 21 µs. */
export const P1_P3_US: Record<ModeAC, number> = { A: 8, C: 21 }

export interface InterrogationPulse {
  name: 'P1' | 'P2' | 'P3'
  /** Leading edge, µs after P1. */
  tUs: number
  widthUs: number
  /** P2 comes from the control antenna, P1 and P3 from the rotating directional antenna. */
  antenna: 'directional' | 'control'
}

export function interrogationPulses(mode: ModeAC): InterrogationPulse[] {
  return [
    { name: 'P1', tUs: 0, widthUs: INTERROGATION_PULSE_US, antenna: 'directional' },
    { name: 'P2', tUs: P1_P2_US, widthUs: INTERROGATION_PULSE_US, antenna: 'control' },
    { name: 'P3', tUs: P1_P3_US[mode], widthUs: INTERROGATION_PULSE_US, antenna: 'directional' },
  ]
}

// ---------------------------------------------------------------------------
// Reply (downlink): framing pulses, 12 code pulses, SPI
// ---------------------------------------------------------------------------

/** Width of each reply pulse, µs. */
export const REPLY_PULSE_US = 0.45
/** F1 to F2 spacing, µs. */
export const F1_F2_US = 20.3
/** Spacing of the information pulse positions, µs. */
export const REPLY_SLOT_US = 1.45
/** The SPI ("ident") pulse follows F2 by 4.35 µs. */
export const SPI_AFTER_F2_US = 4.35
/** Delay inside the transponder from the leading edge of P3 to the leading edge of F1, µs. */
export const TRANSPONDER_DELAY_US = 3
/** How long the SPI pulse is added after the pilot presses IDENT, s. */
// TODO(expert-review): SPI duration after IDENT (about 18 s, 15–30 s in Annex 10).
export const SPI_DURATION_S = 18
/** Length of one reply from the start of F1 to the end of F2, µs (20.75). */
export const REPLY_LENGTH_US = F1_F2_US + REPLY_PULSE_US

/** Information pulse positions in the order they are sent after F1. X is never transmitted. */
export const REPLY_SLOTS = ['C1', 'A1', 'C2', 'A2', 'C4', 'A4', 'X', 'B1', 'D1', 'B2', 'D2', 'B4', 'D4'] as const
export type ReplySlot = (typeof REPLY_SLOTS)[number]
export type CodePulse = Exclude<ReplySlot, 'X'>
export const CODE_PULSES = REPLY_SLOTS.filter((s): s is CodePulse => s !== 'X')
/** Which pulses are present in a reply. */
export type CodeBits = Record<CodePulse, boolean>

/** Leading edge of an information pulse, µs after F1. */
export function slotTimeUs(slot: ReplySlot): number {
  return REPLY_SLOT_US * (REPLY_SLOTS.indexOf(slot) + 1)
}

export function emptyBits(): CodeBits {
  const b = {} as CodeBits
  for (const p of CODE_PULSES) b[p] = false
  return b
}

export interface ReplyPulse {
  name: ReplySlot | 'F1' | 'F2' | 'SPI'
  /** Leading edge, µs after F1. */
  tUs: number
}

/** Pulses actually transmitted in a Mode A/C reply (framing, code pulses that are 1, SPI). */
export function replyPulseTrain(bits: CodeBits, spi = false): ReplyPulse[] {
  const out: ReplyPulse[] = [{ name: 'F1', tUs: 0 }]
  for (const slot of CODE_PULSES) if (bits[slot]) out.push({ name: slot, tUs: slotTimeUs(slot) })
  out.push({ name: 'F2', tUs: F1_F2_US })
  if (spi) out.push({ name: 'SPI', tUs: F1_F2_US + SPI_AFTER_F2_US })
  return out.sort((a, b) => a.tUs - b.tUs)
}

/** Length of a reply on the air, µs (longer when the SPI pulse is added). */
export function replyDurationUs(spi: boolean): number {
  return spi ? F1_F2_US + SPI_AFTER_F2_US + REPLY_PULSE_US : REPLY_LENGTH_US
}

// ---------------------------------------------------------------------------
// Squawk codes (Mode A identity)
// ---------------------------------------------------------------------------

/** 4 octal digits give 8⁴ = 4096 codes. */
export const SQUAWK_CODE_COUNT = 4096

export function isValidSquawk(code: string): boolean {
  return /^[0-7]{4}$/.test(code)
}

export type ParsedSquawk = { ok: true; code: string } | { ok: false; error: string }

/** Validate what a learner typed. Digits 8 and 9 do not exist on a transponder. */
export function parseSquawk(input: string): ParsedSquawk {
  const s = input.trim()
  if (/[89]/.test(s)) return { ok: false, error: 'Each digit goes from 0 to 7. There is no 8 or 9 on a transponder.' }
  if (!/^\d*$/.test(s)) return { ok: false, error: 'Use digits only.' }
  if (s.length !== 4) return { ok: false, error: 'A squawk code has exactly four digits.' }
  return { ok: true, code: s }
}

const DIGIT_PULSES: Record<'A' | 'B' | 'C' | 'D', [CodePulse, CodePulse, CodePulse]> = {
  // [weight 4, weight 2, weight 1]
  A: ['A4', 'A2', 'A1'],
  B: ['B4', 'B2', 'B1'],
  C: ['C4', 'C2', 'C1'],
  D: ['D4', 'D2', 'D1'],
}

/** The three pulses (weights 4, 2, 1) that carry one squawk digit. */
export function digitPulses(digit: 'A' | 'B' | 'C' | 'D'): [CodePulse, CodePulse, CodePulse] {
  return DIGIT_PULSES[digit]
}

/** Squawk ABCD → reply pulses. Digit A = 4·A4 + 2·A2 + 1·A1, and the same for B, C and D. */
export function squawkToBits(code: string): CodeBits {
  if (!isValidSquawk(code)) throw new Error(`Invalid squawk ${code}`)
  const bits = emptyBits()
  ;(['A', 'B', 'C', 'D'] as const).forEach((d, i) => {
    const v = Number(code[i])
    const [p4, p2, p1] = DIGIT_PULSES[d]
    bits[p4] = (v & 4) !== 0
    bits[p2] = (v & 2) !== 0
    bits[p1] = (v & 1) !== 0
  })
  return bits
}

export function bitsToSquawk(bits: CodeBits): string {
  return (['A', 'B', 'C', 'D'] as const)
    .map((d) => {
      const [p4, p2, p1] = DIGIT_PULSES[d]
      return String((bits[p4] ? 4 : 0) + (bits[p2] ? 2 : 0) + (bits[p1] ? 1 : 0))
    })
    .join('')
}

export type SpecialCodeKind = 'hijack' | 'radio' | 'emergency'

export interface SpecialCodeInfo {
  code: string
  kind: SpecialCodeKind
  /** Text tag on the controller's label (never colour alone). */
  tag: string
  meaning: string
}

export const SPECIAL_CODES: Record<string, SpecialCodeInfo> = {
  '7500': { code: '7500', kind: 'hijack', tag: 'HIJACK', meaning: 'Unlawful interference (hijack)' },
  '7600': { code: '7600', kind: 'radio', tag: 'RADIO FAIL', meaning: 'Radio communication failure' },
  '7700': { code: '7700', kind: 'emergency', tag: 'EMERGENCY', meaning: 'Emergency' },
}

/** Conspicuity code for VFR flights in ICAO/European airspace (the US uses 1200). */
export const VFR_CODE = '7000'
/** Code used when ATC has not assigned one. */
export const NO_CODE_ASSIGNED = '2000'

export function specialCode(code: string): SpecialCodeInfo | null {
  return SPECIAL_CODES[code] ?? null
}

// ---------------------------------------------------------------------------
// Mode C altitude: Gillham (Gray) code in 100 ft steps
// ---------------------------------------------------------------------------

export const MODE_C_MIN_FT = -1200
export const MODE_C_MAX_FT = 126700

/** Binary-reflected Gray code. Neighbouring numbers differ in exactly one bit. */
export function grayEncode(n: number): number {
  return (n ^ (n >>> 1)) >>> 0
}

export function grayDecode(g: number): number {
  let n = 0
  for (let v = g >>> 0; v; v >>>= 1) n ^= v
  return n
}

/** The pressure altitude a Mode C reply reports: the nearest 100 ft, or null outside the code's range. */
export function modeCReportedFt(altitudeFt: number): number | null {
  if (!Number.isFinite(altitudeFt)) return null
  const a = Math.round(altitudeFt / 100) * 100
  if (a < MODE_C_MIN_FT || a > MODE_C_MAX_FT) return null
  return a + 0 // avoid -0
}

/** The 500 ft group, most significant first, and the 100 ft group. */
const G500: CodePulse[] = ['D1', 'D2', 'D4', 'A1', 'A2', 'A4', 'B1', 'B2', 'B4']
const G100: CodePulse[] = ['C1', 'C2', 'C4']

/**
 * Encode a pressure altitude (ft) as Mode C pulses. The 500 ft group is the
 * Gray code of the 500 ft count; the 100 ft group is a 5-step reflected code
 * so that every 100 ft change flips exactly one pulse.
 */
export function encodeGillham(altitudeFt: number): CodeBits | null {
  const alt = modeCReportedFt(altitudeFt)
  if (alt == null) return null
  const k = (alt + 1300) / 100 - 1
  const f = Math.floor(k / 5)
  const h = (k % 5) + 1
  let hp = f % 2 === 1 ? 6 - h : h
  if (hp === 5) hp = 7
  const g500 = grayEncode(f)
  const g100 = grayEncode(hp)
  const bits = emptyBits()
  G500.forEach((p, i) => (bits[p] = ((g500 >> (8 - i)) & 1) === 1))
  G100.forEach((p, i) => (bits[p] = ((g100 >> (2 - i)) & 1) === 1))
  return bits
}

/** Decode Mode C pulses back to pressure altitude (ft), or null for an illegal code. */
export function decodeGillham(bits: CodeBits): number | null {
  let g500 = 0
  for (const p of G500) g500 = (g500 << 1) | (bits[p] ? 1 : 0)
  let g100 = 0
  for (const p of G100) g100 = (g100 << 1) | (bits[p] ? 1 : 0)
  const f = grayDecode(g500)
  let h = grayDecode(g100)
  if (h === 0 || h === 5 || h === 6) return null
  if (h === 7) h = 5
  if (f % 2 === 1) h = 6 - h
  const alt = f * 500 + h * 100 - 1300
  if (alt < MODE_C_MIN_FT || alt > MODE_C_MAX_FT) return null
  return alt
}

/** Pulses that differ between two replies. */
export function changedPulses(a: CodeBits, b: CodeBits): CodePulse[] {
  return CODE_PULSES.filter((p) => a[p] !== b[p])
}

/** Flight level shown on a label: three digits, hundreds of feet ("120" for 12,000 ft). */
export function formatFlightLevel(altitudeFt: number): string {
  const fl = Math.round(altitudeFt / 100)
  return fl < 0 ? `-${String(-fl).padStart(2, '0')}` : String(fl).padStart(3, '0')
}

// ---------------------------------------------------------------------------
// Timing, range and garbling
// ---------------------------------------------------------------------------

/** When F1 of the reply reaches the radar, µs after P3 left the antenna. */
export function replyArrivalUs(slantNm: number): number {
  return roundTripTimeUs(slantNm) + TRANSPONDER_DELAY_US
}

/** Range from the time between P3 leaving and F1 arriving: R = c·(t − 3 µs)/2. */
export function rangeFromReplyUs(tUs: number): number {
  return rangeFromRoundTripNm(tUs - TRANSPONDER_DELAY_US)
}

/**
 * Two Mode A/C replies overlap on the air when their slant ranges differ by
 * less than c × 20.75 µs / 2 (≈ 1.68 NM), provided both aircraft are in the
 * main beam at the same time.
 */
export const GARBLE_RANGE_NM = rangeFromRoundTripNm(REPLY_LENGTH_US)

export function repliesOverlap(slantANm: number, slantBNm: number): boolean {
  return Math.abs(slantANm - slantBNm) < GARBLE_RANGE_NM
}

/** Interval of time [start, end) a reply occupies at the radar, µs. */
export function replyWindowUs(f1Us: number, spi: boolean): [number, number] {
  return [f1Us, f1Us + replyDurationUs(spi)]
}

// ---------------------------------------------------------------------------
// Decoding a stream of received pulses (with garble detection)
// ---------------------------------------------------------------------------

export interface DecodedReply {
  /** Leading edge of the F1 framing pulse, µs. */
  f1Us: number
  bits: CodeBits
  spi: boolean
  /** A pulse was found in the X position, which a transponder never sends. */
  xPulse: boolean
  /** Another reply overlapped this one in time, so the pulses may be mixed up. */
  garbled: boolean
}

/**
 * Find replies in a list of received pulse leading edges (µs). A reply is a
 * pair of pulses exactly 20.3 µs apart (the brackets); the code pulses are read
 * at their slots. Overlapping brackets are marked garbled. The pair formed by
 * the C2 pulse and the SPI pulse of one reply (also 20.3 µs apart) is ignored.
 */
export function decodeReplyPulses(pulseTimesUs: number[], toleranceUs = 0.1): DecodedReply[] {
  const sorted = [...pulseTimesUs].sort((a, b) => a - b)
  // Pulses closer than the tolerance are the same pulse on the air.
  const p: number[] = []
  for (const t of sorted) if (!p.length || t - p[p.length - 1] > toleranceUs) p.push(t)
  const has = (t: number) => {
    // Binary search for any pulse within tolerance of t.
    let lo = 0
    let hi = p.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (p[mid] < t - toleranceUs) lo = mid + 1
      else if (p[mid] > t + toleranceUs) hi = mid - 1
      else return true
    }
    return false
  }
  const brackets: { f1: number; f2: number }[] = []
  for (let i = 0; i < p.length; i++) {
    for (let j = i + 1; j < p.length; j++) {
      const d = p[j] - p[i]
      if (d > F1_F2_US + toleranceUs) break
      if (Math.abs(d - F1_F2_US) <= toleranceUs) brackets.push({ f1: p[i], f2: p[j] })
    }
  }
  const replies = brackets.map(({ f1, f2 }) => {
    const bits = emptyBits()
    for (const slot of CODE_PULSES) bits[slot] = has(f1 + slotTimeUs(slot))
    return { f1Us: f1, f2Us: f2, bits, spi: has(f2 + SPI_AFTER_F2_US), xPulse: has(f1 + slotTimeUs('X')), garbled: false }
  })
  // Drop phantoms: taking brackets in time order, a bracket whose F1 is already
  // a pulse of an accepted reply (a code pulse, F2 or SPI) is made of borrowed
  // pulses. This also removes the C2 + SPI pair of a single reply.
  const same = (a: number, b: number) => Math.abs(a - b) <= toleranceUs
  const real: typeof replies = []
  for (const b of replies) {
    const explained = real.some((a) => replyPulseTimes(a.f1Us, a.bits, a.spi).some((t) => same(t, b.f1Us)))
    if (!explained) real.push(b)
  }
  for (const a of real) {
    const [a0, a1] = replyWindowUs(a.f1Us, a.spi)
    for (const b of real) {
      if (a === b) continue
      const [b0, b1] = replyWindowUs(b.f1Us, b.spi)
      if (a0 < b1 && b0 < a1) a.garbled = true
    }
  }
  return real.map(({ f1Us, bits, spi, xPulse, garbled }) => ({ f1Us, bits, spi, xPulse, garbled }))
}

/** Leading edges of every pulse in a reply that starts (F1) at `f1Us`. */
export function replyPulseTimes(f1Us: number, bits: CodeBits, spi: boolean): number[] {
  return replyPulseTrain(bits, spi).map((q) => f1Us + q.tUs)
}

// ---------------------------------------------------------------------------
// Antenna patterns and side-lobe suppression
// ---------------------------------------------------------------------------

/** Azimuth 3 dB beam width of a typical SSR antenna, degrees. */
// TODO(expert-review): typical SSR (LVA) 3 dB beam width, about 2.4°.
export const SSR_BEAM_WIDTH_DEG = 2.4

// TODO(expert-review): side-lobe levels (−22 dB beside the main beam, −30 dB behind) and lobe spacing are teaching choices.
export const SIDE_LOBE_NEAR_DB = -22
export const SIDE_LOBE_FAR_DB = -30
const SIDE_LOBE_SPACING = 1.3

/**
 * Directional antenna pattern: gain in dB relative to the main-beam peak at an
 * angle `offDeg` from where the antenna points. The main lobe is the usual
 * parabolic-in-dB approximation (−3 dB at half the beam width). Side lobes
 * ripple under an envelope that falls away from the main beam.
 */
export function ssrPatternDb(offDeg: number, beamWidthDeg = SSR_BEAM_WIDTH_DEG): number {
  const d = Math.abs(normalize180(offDeg))
  const main = 10 ** (-1.2 * (d / beamWidthDeg) ** 2)
  const envDb = SIDE_LOBE_NEAR_DB + (SIDE_LOBE_FAR_DB - SIDE_LOBE_NEAR_DB) * Math.min(1, d / 90)
  const lobe = 10 ** (envDb / 10) * Math.sin((Math.PI * d) / (SIDE_LOBE_SPACING * beamWidthDeg)) ** 2
  return 10 * Math.log10(Math.max(main + lobe, 1e-6))
}

/** Control antenna (sends P2): the same strength in every direction, below the main beam and above every side lobe. */
// TODO(expert-review): control (omni) antenna level relative to the main-beam peak (−15 dB here).
export const CONTROL_LEVEL_DB = -15

export function ssrControlPatternDb(_offDeg: number): number {
  return CONTROL_LEVEL_DB
}

/** A transponder must reply when P1 is at least 9 dB above P2 and must not when P2 ≥ P1. */
export const SLS_REPLY_MARGIN_DB = 9

export type SlsDecision = 'reply' | 'maybe' | 'suppress'

/** Side-lobe suppression rule applied by the transponder to the received P1 and P2 levels. */
export function slsDecision(p1Dbm: number, p2Dbm: number): SlsDecision {
  const diff = p1Dbm - p2Dbm
  if (diff >= SLS_REPLY_MARGIN_DB) return 'reply'
  if (diff <= 0) return 'suppress'
  return 'maybe'
}

/**
 * Transponder minimum triggering level: weaker interrogations are ignored.
 */
// TODO(expert-review): MTL −74 dBm (Annex 10 gives −74 ± 3 dBm for Mode S and about −73 ± 4 dBm for Mode A/C transponders).
export const TRANSPONDER_MTL_DBM = -74

/**
 * Teaching calibration of the interrogator: the main-beam peak just reaches
 * the transponder MTL at 300 NM in free space (real SSRs are limited by the
 * radio horizon well before that).
 */
// TODO(expert-review): interrogator effective radiated power (here set so the main beam reaches MTL at 300 NM).
export const MAIN_BEAM_MTL_RANGE_NM = 300
export const INTERROGATOR_ERP_DBM = TRANSPONDER_MTL_DBM + freeSpacePathLossDbNm(MAIN_BEAM_MTL_RANGE_NM, SSR_UPLINK_MHZ)

/** Transponder peak transmitter power, dBm (Annex 10 allows about 21–27 dBW). */
// TODO(expert-review): transponder power 54 dBm (24 dBW), ground antenna gain 27 dBi and receiver threshold −80 dBm.
export const TRANSPONDER_POWER_DBM = 54
export const GROUND_ANTENNA_GAIN_DBI = 27
export const GROUND_RECEIVER_MTL_DBM = -80

/** P1 level (dBm) at a transponder `slantNm` away, `offDeg` off the antenna direction. */
export function uplinkP1Dbm(slantNm: number, offDeg: number, beamWidthDeg = SSR_BEAM_WIDTH_DEG): number {
  return INTERROGATOR_ERP_DBM + ssrPatternDb(offDeg, beamWidthDeg) - freeSpacePathLossDbNm(Math.max(slantNm, 0.05), SSR_UPLINK_MHZ)
}

/** P2 level (dBm) from the control antenna. */
export function uplinkP2Dbm(slantNm: number, offDeg = 0): number {
  return INTERROGATOR_ERP_DBM + ssrControlPatternDb(offDeg) - freeSpacePathLossDbNm(Math.max(slantNm, 0.05), SSR_UPLINK_MHZ)
}

/** Reply level received at the radar (dBm) through the directional antenna. */
export function downlinkDbm(slantNm: number, offDeg: number, beamWidthDeg = SSR_BEAM_WIDTH_DEG): number {
  return (
    TRANSPONDER_POWER_DBM +
    GROUND_ANTENNA_GAIN_DBI +
    ssrPatternDb(offDeg, beamWidthDeg) -
    freeSpacePathLossDbNm(Math.max(slantNm, 0.05), SSR_DOWNLINK_MHZ)
  )
}

/**
 * Does the transponder answer? `p2Dbm` is null when no P2 is sent (control
 * antenna off). Between 0 and 9 dB the rule allows either; we reply with a
 * probability rising linearly across that band (`roll` is uniform in [0, 1)).
 */
export function transponderReplies(p1Dbm: number, p2Dbm: number | null, roll: number): boolean {
  if (p1Dbm < TRANSPONDER_MTL_DBM) return false
  if (p2Dbm == null) return true
  const d = slsDecision(p1Dbm, p2Dbm)
  if (d === 'reply') return true
  if (d === 'suppress') return false
  return roll < (p1Dbm - p2Dbm) / SLS_REPLY_MARGIN_DB
}

/** Half-width of the angle around the beam where P1 is at least 9 dB above P2 (always a reply), degrees. */
export function slsReplyHalfAngleDeg(beamWidthDeg = SSR_BEAM_WIDTH_DEG): number {
  // Main lobe in dB: −12 (d/θ)² ≥ CONTROL + 9  ⇒  d = θ·√((−CONTROL − 9) / 12)
  return beamWidthDeg * Math.sqrt((-CONTROL_LEVEL_DB - SLS_REPLY_MARGIN_DB) / 12)
}

/** Monopulse SSR measurement accuracy (1σ). */
// TODO(expert-review): monopulse SSR accuracy (azimuth about 0.07°, range about 25 m, 1σ).
export const MONOPULSE_SIGMA_AZ_DEG = 0.07
export const SSR_SIGMA_RANGE_NM = 25 / 1852

// ---------------------------------------------------------------------------
// Mode S
// ---------------------------------------------------------------------------

/** 24-bit aircraft addresses: 2²⁴ = 16,777,216. */
export const MODE_S_ADDRESS_COUNT = 2 ** 24
/** Reply preamble: four 0.5 µs pulses at 0, 1, 3.5 and 4.5 µs; data starts at 8 µs. */
export const MODE_S_PREAMBLE_US = 8
export const MODE_S_PREAMBLE_PULSES_US = [0, 1, 3.5, 4.5] as const
export const MODE_S_PULSE_US = 0.5
/** Data rate 1 Mbit/s with pulse position modulation: 1 µs per bit. */
export const MODE_S_BIT_US = 1
export const MODE_S_SHORT_BITS = 56
export const MODE_S_LONG_BITS = 112
/** Uplink: P1 and P2 (0.8 µs, 2 µs apart), then the long P6 pulse starting 3.5 µs after P1. */
export const MODE_S_P6_START_US = 3.5
/** The sync phase reversal inside P6, 1.25 µs after its start: the transponder's timing mark. */
export const MODE_S_SPR_AFTER_P6_US = 1.25
export const MODE_S_P6_SHORT_US = 16.25
export const MODE_S_P6_LONG_US = 30.25
/** The reply starts 128 µs after the sync phase reversal. */
export const MODE_S_TURNAROUND_US = 128
/** After acquisition the transponder stops answering all-calls from this radar for a while ("lockout"). */
// TODO(expert-review): lockout timer (about 18 s after the last lockout command).
export const MODE_S_LOCKOUT_S = 18

/** Reply length on the air, µs. */
export function modeSReplyUs(bits: number): number {
  return MODE_S_PREAMBLE_US + bits * MODE_S_BIT_US
}

/**
 * Pulse leading edges of a Mode S reply (µs from the first preamble pulse).
 * Pulse position modulation: a 1 has its pulse in the first half of the bit
 * period, a 0 in the second half.
 */
export function ppmPulseTimesUs(bits: number[]): number[] {
  const out: number[] = [...MODE_S_PREAMBLE_PULSES_US]
  bits.forEach((b, i) => out.push(MODE_S_PREAMBLE_US + i * MODE_S_BIT_US + (b ? 0 : MODE_S_BIT_US / 2)))
  return out
}

/** Read bits back from PPM pulse times. */
export function ppmDecode(pulseTimesUs: number[], nBits: number, toleranceUs = 0.1): number[] {
  const bits: number[] = []
  for (let i = 0; i < nBits; i++) {
    const t = MODE_S_PREAMBLE_US + i * MODE_S_BIT_US
    const first = pulseTimesUs.some((p) => Math.abs(p - t) <= toleranceUs)
    bits.push(first ? 1 : 0)
  }
  return bits
}

export function numberToBits(v: number, n: number): number[] {
  const out: number[] = []
  for (let i = n - 1; i >= 0; i--) out.push(Math.floor(v / 2 ** i) % 2)
  return out
}

export function bitsToNumber(bits: number[]): number {
  let v = 0
  for (const b of bits) v = v * 2 + (b ? 1 : 0)
  return v
}

export function bitsToHex(bits: number[]): string {
  let s = ''
  for (let i = 0; i < bits.length; i += 4) s += bitsToNumber(bits.slice(i, i + 4)).toString(16)
  return s.toUpperCase()
}

export function hexToBits(hex: string): number[] {
  const out: number[] = []
  for (const ch of hex) out.push(...numberToBits(parseInt(ch, 16), 4))
  return out
}

/** Mode S address as six hexadecimal digits, e.g. "8A1C2F". */
export function formatIcaoAddress(address: number): string {
  return (address >>> 0).toString(16).toUpperCase().padStart(6, '0')
}

/** Mode S CRC generator polynomial (25 bits): 1111 1111 1111 1010 0000 0100 1. */
const CRC_GENERATOR = hexToBits('1FFF409').slice(3) // 25 bits

/** Remainder of the whole message (data and the 24-bit parity field). 0 means no error. */
export function modeSCrcRemainder(bits: number[]): number {
  const m = bits.slice()
  const n = m.length
  for (let i = 0; i < n - 24; i++) {
    if (!m[i]) continue
    for (let j = 0; j < CRC_GENERATOR.length; j++) m[i + j] ^= CRC_GENERATOR[j]
  }
  return bitsToNumber(m.slice(n - 24))
}

/** The 24-bit parity of the data part of a message (the last 24 bits are ignored). */
export function modeSParity(bits: number[]): number {
  const m = bits.slice(0, bits.length - 24).concat(new Array(24).fill(0))
  return modeSCrcRemainder(m)
}

/** Replace the last 24 bits with `value` (parity, or parity XOR address). */
function withLast24(bits: number[], value: number): number[] {
  return bits.slice(0, bits.length - 24).concat(numberToBits(value >>> 0, 24))
}

/** 13-bit identity field (C1 A1 C2 A2 C4 A4 X B1 D1 B2 D2 B4 D4) used in DF5 and DF21. */
export function identityField(code: string): number[] {
  const b = squawkToBits(code)
  return REPLY_SLOTS.map((s) => (s === 'X' ? 0 : b[s] ? 1 : 0))
}

export function identityFromField(field: number[]): string {
  const bits = emptyBits()
  REPLY_SLOTS.forEach((s, i) => {
    if (s !== 'X') bits[s] = field[i] === 1
  })
  return bitsToSquawk(bits)
}

/**
 * 13-bit altitude field of DF4/DF20 in 25 ft steps: N = (alt + 1000) / 25 in
 * 11 bits with the M bit (0 = feet) and the Q bit (1 = 25 ft steps) inserted.
 */
export function altitudeField25(altitudeFt: number): number[] {
  const n = Math.max(0, Math.min(2047, Math.round((altitudeFt + 1000) / 25)))
  const b = numberToBits(n, 11)
  return [...b.slice(0, 6), 0, b[6], 1, ...b.slice(7)]
}

export function altitudeFromField25(field: number[]): number | null {
  if (field[6] !== 0 || field[8] !== 1) return null
  const n = bitsToNumber([...field.slice(0, 6), field[7], ...field.slice(9)])
  return n * 25 - 1000
}

/** Flight status (FS) field: alert (code change or emergency) and SPI flags, airborne. */
export function flightStatus(alert: boolean, spi: boolean): number {
  if (spi) return alert ? 4 : 5
  return alert ? 2 : 0
}

/** DF5: surveillance identity reply (56 bits). AP = parity XOR address. */
export function buildDf5(address: number, code: string, fs = 0): number[] {
  const bits = [...numberToBits(5, 5), ...numberToBits(fs, 3), ...numberToBits(0, 5), ...numberToBits(0, 6), ...identityField(code), ...new Array(24).fill(0)]
  return withLast24(bits, modeSParity(bits) ^ address)
}

/** DF4: surveillance altitude reply (56 bits). */
export function buildDf4(address: number, altitudeFt: number, fs = 0): number[] {
  const bits = [...numberToBits(4, 5), ...numberToBits(fs, 3), ...numberToBits(0, 5), ...numberToBits(0, 6), ...altitudeField25(altitudeFt), ...new Array(24).fill(0)]
  return withLast24(bits, modeSParity(bits) ^ address)
}

/** DF11: all-call reply announcing the aircraft's address (56 bits). PI = parity (interrogator code 0). */
export function buildDf11(address: number, capability = 5): number[] {
  const bits = [...numberToBits(11, 5), ...numberToBits(capability, 3), ...numberToBits(address, 24), ...new Array(24).fill(0)]
  return withLast24(bits, modeSParity(bits))
}

/** Address hidden in the AP field of a DF4/DF5/DF20/DF21 reply (AP XOR parity). */
export function addressFromAp(bits: number[]): number {
  return (bitsToNumber(bits.slice(bits.length - 24)) ^ modeSParity(bits)) >>> 0
}

export interface DecodedSurveillanceReply {
  df: number
  fs: number
  address: number
  code?: string
  altitudeFt?: number | null
}

/** Decode a DF4 or DF5 reply. */
export function decodeSurveillanceReply(bits: number[]): DecodedSurveillanceReply {
  const df = bitsToNumber(bits.slice(0, 5))
  const fs = bitsToNumber(bits.slice(5, 8))
  const field = bits.slice(19, 32)
  const address = addressFromAp(bits)
  if (df === 5) return { df, fs, address, code: identityFromField(field) }
  return { df, fs, address, altitudeFt: altitudeFromField25(field) }
}

/** Mode S reply types used by the simulator. */
export const MODE_S_FORMATS = {
  DF4: 'Altitude reply',
  DF5: 'Identity reply',
  DF11: 'All-call reply (address)',
  DF20: 'Comm-B altitude reply (with a data register)',
  DF21: 'Comm-B identity reply (with a data register)',
} as const

/** Enhanced Surveillance registers (BDS) read from the aircraft by Comm-B. */
export const BDS_REGISTERS = {
  '2,0': 'Aircraft identification (callsign)',
  '4,0': 'Selected vertical intention (altitude set on the autopilot)',
  '5,0': 'Track and turn report (true track, ground speed, roll)',
  '6,0': 'Heading and speed report (magnetic heading, airspeed, vertical rate)',
} as const
