/**
 * Distance Measuring Equipment (DME/N): channels, pulse timing, slant range,
 * groundspeed from range rate, interrogation jitter and reply recognition,
 * and the ground transponder's capacity.
 *
 * The aircraft (interrogator) sends a pulse pair. The ground transponder
 * waits a fixed reply delay and answers with another pulse pair. The
 * aircraft measures the total time and removes the delay:
 *
 *   distance = (round-trip time − reply delay) × c / 2
 *
 * The result is always the SLANT range (straight line to the antenna), never
 * the distance over the ground.
 *
 * Units: NM, ft, kt, seconds; µs for radio timing; pulse rates in pulse pairs
 * per second (pps). No randomness except through a generator passed in.
 */

import { rangeFromRoundTripNm, roundTripTimeUs, travelTimeUs } from './propagation'
import { FT_PER_NM } from './units'
import { positiveStep } from './guard'

// ---------------------------------------------------------------------------
// Channels and frequencies
// ---------------------------------------------------------------------------

export type DmeMode = 'X' | 'Y'

/** Lowest and highest DME frequency (reply frequencies span the whole band), MHz. */
export const DME_BAND_MHZ = { min: 962, max: 1213 } as const

/** Channels per mode (1 to 126), so 252 channels in all. */
export const DME_CHANNELS_PER_MODE = 126

/** Interrogation and reply frequencies of one channel are always 63 MHz apart. */
export const DME_TX_RX_SPACING_MHZ = 63

/** Pulse-pair code of each mode (ICAO Annex 10, Vol I, DME/N). */
export interface DmePulseCode {
  /** Spacing between the two pulses the aircraft sends, µs. */
  interrogationSpacingUs: number
  /** Spacing between the two pulses the ground station sends back, µs. */
  replySpacingUs: number
  /** Fixed wait between receiving the question and answering, µs. */
  replyDelayUs: number
}

// TODO(expert-review): confirm that for DME/N both X and Y reply delays are measured
// between the FIRST pulses of the interrogation and reply pairs (as modelled here).
export const DME_CODES: Record<DmeMode, DmePulseCode> = {
  X: { interrogationSpacingUs: 12, replySpacingUs: 12, replyDelayUs: 50 },
  Y: { interrogationSpacingUs: 36, replySpacingUs: 30, replyDelayUs: 56 },
}

/** Reply delay of a mode, µs. */
export const dmeReplyDelayUs = (mode: DmeMode) => DME_CODES[mode].replyDelayUs

function assertChannel(channel: number) {
  if (!Number.isInteger(channel) || channel < 1 || channel > DME_CHANNELS_PER_MODE) {
    throw new RangeError(`DME channel must be an integer from 1 to ${DME_CHANNELS_PER_MODE}`)
  }
}

/**
 * Interrogation (air-to-ground) and reply (ground-to-air) frequencies of a
 * channel, MHz (ICAO Annex 10, Vol I, DME channelling table).
 * Interrogation: 1025–1150 MHz. Reply: 63 MHz below or above it.
 */
export function dmeFrequencies(channel: number, mode: DmeMode): { interrogationMHz: number; replyMHz: number } {
  assertChannel(channel)
  const interrogationMHz = 1024 + channel
  const low = channel <= 63
  // X: channels 1–63 reply 63 MHz lower, 64–126 higher. Y: the other way round.
  const below = mode === 'X' ? low : !low
  return { interrogationMHz, replyMHz: interrogationMHz + (below ? -DME_TX_RX_SPACING_MHZ : DME_TX_RX_SPACING_MHZ) }
}

/**
 * The VOR or ILS localizer frequency a DME channel is paired with, MHz, or
 * null for channels that are not paired with a VHF frequency (1–16 and 60–69).
 * X channels sit on whole tenths, Y channels 50 kHz higher.
 */
export function vhfPairedFrequencyMHz(channel: number, mode: DmeMode): number | null {
  assertChannel(channel)
  const y = mode === 'Y' ? 0.05 : 0
  let f: number
  if (channel >= 17 && channel <= 59) f = 108.0 + (channel - 17) * 0.1 + y
  else if (channel >= 70 && channel <= 126) f = 112.3 + (channel - 70) * 0.1 + y
  else return null
  return Math.round(f * 100) / 100
}

/** The DME channel paired with a VOR or ILS frequency (MHz), or null if none. */
export function dmeChannelForVhf(mhz: number): { channel: number; mode: DmeMode } | null {
  const hundredths = Math.round(mhz * 100)
  const mode: DmeMode = hundredths % 10 === 5 ? 'Y' : 'X'
  if (hundredths % 5 !== 0) return null
  const tenths = Math.round((hundredths - (mode === 'Y' ? 5 : 0)) / 10)
  let channel: number
  if (tenths >= 1080 && tenths <= 1122) channel = 17 + (tenths - 1080)
  else if (tenths >= 1123 && tenths <= 1179) channel = 70 + (tenths - 1123)
  else return null
  return { channel, mode }
}

export const formatDmeChannel = (channel: number, mode: DmeMode) => `CH ${channel}${mode}`

// ---------------------------------------------------------------------------
// Timing and distance
// ---------------------------------------------------------------------------

export interface DmeTiming {
  /** Trip of the question from the aircraft to the station, µs. */
  outboundUs: number
  /** The station's fixed wait, µs. */
  delayUs: number
  /** Trip of the answer back to the aircraft, µs. */
  returnUs: number
  /** Everything together: what the aircraft's stopwatch measures, µs. */
  totalUs: number
}

/** The three parts of one question-and-answer at a slant range. */
export function dmeTiming(slantNm: number, mode: DmeMode): DmeTiming {
  const leg = travelTimeUs(Math.max(0, slantNm))
  const delayUs = dmeReplyDelayUs(mode)
  return { outboundUs: leg, delayUs, returnUs: leg, totalUs: roundTripTimeUs(Math.max(0, slantNm)) + delayUs }
}

/** Distance the avionics compute from a measured total time: (t − delay) × c / 2, NM. */
export function dmeDistanceFromTimingNm(totalUs: number, mode: DmeMode): number {
  return rangeFromRoundTripNm(Math.max(0, totalUs - dmeReplyDelayUs(mode)))
}

/**
 * Smallest reading a DME can show at a height above the station: directly
 * overhead the slant range equals the height. 6,000 ft ≈ 1 NM.
 */
export function minimumDmeReadingNm(heightAboveStationFt: number): number {
  return Math.abs(heightAboveStationFt) / FT_PER_NM
}

// ---------------------------------------------------------------------------
// Groundspeed and time to station
// ---------------------------------------------------------------------------

/**
 * DME "groundspeed" is really the rate of change of the slant range, found by
 * differencing successive distance measurements and smoothing them.
 */
export interface RangeRateFilter {
  lastTimeS: number | null
  lastDistanceNm: number | null
  /** Smoothed range rate, kt. Positive = distance growing (moving away). */
  rateKt: number | null
}

export const createRangeRateFilter = (): RangeRateFilter => ({ lastTimeS: null, lastDistanceNm: null, rateKt: null })

/** Default smoothing time constant of the DME groundspeed, s. */
// TODO(expert-review): typical smoothing time of DME groundspeed computation in avionics.
export const DME_GS_SMOOTHING_S = 2

/**
 * Add one distance measurement at `timeS`. Returns a new filter state.
 * The first measurement only primes the filter; the second gives a raw rate;
 * later ones are smoothed exponentially with time constant `tauS`. A raw rate
 * more than `maxStepKt` away from the current one is treated as a stray
 * measurement and ignored (no aircraft changes its range rate that fast).
 */
export function updateRangeRateFilter(f: RangeRateFilter, timeS: number, distanceNm: number, tauS = DME_GS_SMOOTHING_S, maxStepKt = Infinity): RangeRateFilter {
  if (f.lastTimeS === null || f.lastDistanceNm === null) return { lastTimeS: timeS, lastDistanceNm: distanceNm, rateKt: null }
  const dt = timeS - f.lastTimeS
  if (!(dt > 1e-6)) return { ...f, lastDistanceNm: distanceNm }
  const raw = ((distanceNm - f.lastDistanceNm) / dt) * 3600
  if (f.rateKt !== null && Math.abs(raw - f.rateKt) > maxStepKt) return f
  const rateKt = f.rateKt === null || tauS <= 0 ? raw : f.rateKt + (raw - f.rateKt) * (1 - Math.exp(-dt / tauS))
  return { lastTimeS: timeS, lastDistanceNm: distanceNm, rateKt }
}

/** Below this closure rate (kt) the DME does not show a time to station. */
export const MIN_CLOSURE_FOR_TTS_KT = 10

/** Minutes to the station at the current closure rate, or null when not closing. */
export function timeToStationMin(distanceNm: number, rangeRateKt: number | null): number | null {
  if (rangeRateKt === null) return null
  const closure = -rangeRateKt
  if (closure < MIN_CLOSURE_FOR_TTS_KT) return null
  return (distanceNm / closure) * 60
}

/**
 * Exact rate of change of the slant range (kt) for an aircraft at ground
 * distance `groundNm` moving with ground speed `speedKt` at `angleOffRadialDeg`
 * from straight away from the station, at constant height `heightFt` above it.
 * d/dt √(g² + h²) = (g / slant) · v · cos(angle).
 */
export function slantRangeRateKt(groundNm: number, heightFt: number, speedKt: number, angleOffRadialDeg: number): number {
  const h = heightFt / FT_PER_NM
  const slant = Math.hypot(groundNm, h)
  if (slant < 1e-9) return 0
  return (groundNm / slant) * speedKt * Math.cos((angleOffRadialDeg * Math.PI) / 180)
}

// ---------------------------------------------------------------------------
// Interrogations, jitter and reply recognition
// ---------------------------------------------------------------------------

// TODO(expert-review): interrogation rates of typical DME/N avionics (search and track).
/** Pulse pairs per second an interrogator sends while searching for its replies. */
export const DME_SEARCH_RATE_PPS = 150
/** Pulse pairs per second while tracking (at most about 30). */
export const DME_TRACK_RATE_PPS = 30

/** How far each interval between interrogations is randomly stretched or shrunk (±50%). */
export const DME_JITTER_FRACTION = 0.5

/**
 * Time to the next interrogation, s. With jitter the interval is spread
 * uniformly ±jitterFraction around the mean; without it every interval is equal.
 */
export function nextInterrogationIntervalS(ratePps: number, rand: (() => number) | null, jitterFraction = DME_JITTER_FRACTION): number {
  const mean = 1 / Math.max(ratePps, 1e-6)
  if (!rand) return mean
  return mean * (1 + jitterFraction * (2 * rand() - 1))
}

/** Poisson-distributed count with mean `lambda` (Knuth for small means, normal approximation above 30). */
export function poissonSample(rand: () => number, lambda: number): number {
  if (!(lambda > 0)) return 0
  if (lambda > 30) {
    // Box–Muller normal approximation.
    let u = 0
    while (u <= 1e-12) u = rand()
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
    return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * z))
  }
  const limit = Math.exp(-lambda)
  let k = 0
  let p = rand()
  while (p > limit) {
    k++
    p *= rand()
  }
  return k
}

/**
 * Replies the aircraft hears in its listening window that are NOT answers
 * to its own question: replies to other aircraft and random "squitter"
 * pairs. They are not synchronised with our question, so their delays are
 * spread uniformly over the window. Returns delays in µs, unsorted.
 */
export function randomReplyDelaysUs(rand: () => number, ratePps: number, windowUs: number): number[] {
  const n = poissonSample(rand, ratePps * windowUs * 1e-6)
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(rand() * windowUs)
  return out
}

/** Count of delays in each bin of width `binUs` from 0 to `maxUs` over many interrogations. */
export function replyHistogram(rows: readonly (readonly number[])[], binUs: number, maxUs: number): number[] {
  positiveStep(binUs, 'binUs')
  positiveStep(maxUs, 'maxUs')
  const n = Math.max(1, Math.ceil(maxUs / binUs))
  const bins = new Array<number>(n).fill(0)
  for (const row of rows) {
    for (const d of row) {
      if (d < 0 || d >= maxUs) continue
      bins[Math.min(n - 1, Math.floor(d / binUs))]++
    }
  }
  return bins
}

/**
 * Reply recognition during search. The avionics look for a delay at which
 * replies keep appearing after (almost) every one of their own jittered
 * questions. Searching starts at zero delay and moves outward, so the FIRST
 * consistent delay wins. A row counts once per window, however many replies
 * fall into it. Returns the mean delay of the matching replies, or null.
 */
export function findConsistentDelayUs(
  rows: readonly (readonly number[])[],
  opts: { windowUs?: number; minFraction?: number; minDelayUs?: number; maxDelayUs?: number } = {},
): number | null {
  const windowUs = opts.windowUs ?? 4
  const minFraction = opts.minFraction ?? 0.5
  const minDelay = opts.minDelayUs ?? 0
  const maxDelay = opts.maxDelayUs ?? Infinity
  if (rows.length === 0) return null
  const need = Math.max(2, Math.ceil(minFraction * rows.length))
  // Candidate centres: every delay seen, in increasing order.
  const all: { d: number; row: number }[] = []
  rows.forEach((row, i) => row.forEach((d) => d >= minDelay && d <= maxDelay && all.push({ d, row: i })))
  all.sort((a, b) => a.d - b.d)
  let lo = 0
  const rowCount = new Map<number, number>()
  let distinct = 0
  for (let hi = 0; hi < all.length; hi++) {
    const c = rowCount.get(all[hi].row) ?? 0
    if (c === 0) distinct++
    rowCount.set(all[hi].row, c + 1)
    while (all[hi].d - all[lo].d > windowUs) {
      const r = all[lo].row
      const k = rowCount.get(r)! - 1
      rowCount.set(r, k)
      if (k === 0) distinct--
      lo++
    }
    if (distinct >= need) {
      let sum = 0
      for (let k = lo; k <= hi; k++) sum += all[k].d
      return sum / (hi - lo + 1)
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// The ground transponder: capacity, dead time, squitter, overload control
// ---------------------------------------------------------------------------

export interface DmeTransponderConfig {
  /** Most reply pulse pairs per second the transmitter can send. */
  maxReplyPps: number
  /** After each reply the receiver is blanked for this long, µs. */
  deadTimeUs: number
  /** Random squitter pairs keep the total transmission at least this high, pps. */
  minTransmissionPps: number
  /** Number of aircraft the station is designed to serve. */
  designAircraft: number
}

// TODO(expert-review): transponder capacity (≈100 aircraft), maximum reply rate
// (≈2,700 pps), dead time (≈60 µs) and minimum transmission rate (≈700 pps).
export const DME_TRANSPONDER: DmeTransponderConfig = {
  maxReplyPps: 2700,
  deadTimeUs: 60,
  minTransmissionPps: 700,
  designAircraft: 100,
}

/**
 * Accepted interrogation rate at which the replies reach the transmitter's
 * limit, given the dead time: Q = A / (1 + A·τ) = Qmax  ⇒  A = Qmax / (1 − Qmax·τ).
 */
export function maxAcceptedInterrogationPps(cfg: DmeTransponderConfig = DME_TRANSPONDER): number {
  const tau = cfg.deadTimeUs * 1e-6
  return cfg.maxReplyPps / (1 - cfg.maxReplyPps * tau)
}

/**
 * Fraction of accepted interrogations that get a reply because the receiver
 * is not blanked by the dead time after an earlier reply or squitter pair.
 * Non-paralysable dead time: busy fraction = transmissions × τ.
 */
export function deadTimeEfficiency(acceptedPps: number, cfg: DmeTransponderConfig = DME_TRANSPONDER): { efficiency: number; replyPps: number; squitterPps: number } {
  const tau = cfg.deadTimeUs * 1e-6
  const a = Math.max(0, acceptedPps)
  const fill = cfg.minTransmissionPps / (1 - cfg.minTransmissionPps * tau)
  if (a >= fill) {
    const efficiency = 1 / (1 + a * tau)
    return { efficiency, replyPps: a * efficiency, squitterPps: 0 }
  }
  // Squitter tops the transmissions up to the minimum rate; the busy time is fixed.
  const efficiency = 1 - cfg.minTransmissionPps * tau
  const replyPps = a * efficiency
  return { efficiency, replyPps, squitterPps: cfg.minTransmissionPps - replyPps }
}

export interface DmeInterrogator {
  id: string
  /** Slant range from the station, NM (a closer aircraft's question arrives stronger). */
  rangeNm: number
  /** Interrogation rate, pps. */
  ratePps: number
  /** False when the station cannot hear it (terrain or beyond the radio horizon). */
  heard?: boolean
}

export interface DmeStationLoad {
  /** Everything the station hears, pps. */
  offeredPps: number
  /** Interrogations the station accepts after its sensitivity is reduced, pps. */
  acceptedPps: number
  replyPps: number
  squitterPps: number
  /** Replies plus squitter, pps. */
  transmissionPps: number
  deadTimeEfficiency: number
  /** More asking than the station can answer: it has lowered its receiver sensitivity. */
  overloaded: boolean
  /** Only aircraft closer than this are fully answered, NM (Infinity when not overloaded). */
  cutoffNm: number
  /** Share of each aircraft's questions that get an answer, 0..1. */
  efficiency: Map<string, number>
  /** Aircraft that get at least half of their answers. */
  answeredCount: number
  heardCount: number
}

/**
 * Station load and reply efficiency. When more interrogations arrive than
 * the transmitter can answer, the station automatically lowers its receiver
 * sensitivity so it keeps answering the strongest (closest) aircraft: the
 * farthest ones lose their replies first.
 */
export function stationLoad(interrogators: readonly DmeInterrogator[], cfg: DmeTransponderConfig = DME_TRANSPONDER): DmeStationLoad {
  const heard = interrogators.filter((q) => q.heard !== false).slice().sort((a, b) => a.rangeNm - b.rangeNm)
  const offeredPps = heard.reduce((s, q) => s + q.ratePps, 0)
  const aMax = maxAcceptedInterrogationPps(cfg)
  const accept = new Map<string, number>()
  let cum = 0
  let cutoffNm = Infinity
  for (const q of heard) {
    const room = aMax - cum
    const f = q.ratePps <= 0 ? 1 : Math.max(0, Math.min(1, room / q.ratePps))
    if (f < 1 && cutoffNm === Infinity) cutoffNm = q.rangeNm
    accept.set(q.id, f)
    cum += q.ratePps * f
  }
  const acceptedPps = Math.min(offeredPps, aMax)
  const dt = deadTimeEfficiency(acceptedPps, cfg)
  const efficiency = new Map<string, number>()
  let answeredCount = 0
  for (const q of interrogators) {
    const e = q.heard === false ? 0 : (accept.get(q.id) ?? 0) * dt.efficiency
    efficiency.set(q.id, e)
    if (e >= 0.5) answeredCount++
  }
  return {
    offeredPps,
    acceptedPps,
    replyPps: dt.replyPps,
    squitterPps: dt.squitterPps,
    transmissionPps: dt.replyPps + dt.squitterPps,
    deadTimeEfficiency: dt.efficiency,
    overloaded: offeredPps > aMax,
    cutoffNm,
    efficiency,
    answeredCount,
    heardCount: heard.length,
  }
}

// ---------------------------------------------------------------------------
// Identification
// ---------------------------------------------------------------------------

/** DME identification tone, Hz. */
export const DME_IDENT_TONE_HZ = 1350

// TODO(expert-review): DME ident repetition when associated with a VOR (one ident period in four, about every 30–40 s).
/** Seconds between DME identifications in this simulator. */
export const DME_IDENT_INTERVAL_S = 30
