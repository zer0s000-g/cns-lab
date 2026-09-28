/**
 * VHF / UHF air-ground voice radio: channels, the link budget between a
 * transmitter and a receiver, squelch, simplex collisions ("blocked"
 * transmissions) and adjacent-channel interference.
 *
 * Geometry follows src/core/propagation.ts: heights in ft above mean sea level,
 * distances in NM along the path, the 4/3 "effective Earth" behind the
 * 1.23·(√h₁+√h₂) rule. Signal levels are in dBm (decibels relative to 1 mW).
 */

import {
  earthBulgeFt,
  earthDropFt,
  freeSpacePathLossDbNm,
  lineOfSight,
  minHeightForLineOfSightFt,
  rayHeightFt,
  slantRangeNm,
  type LineOfSightResult,
} from './propagation'

// ---------------------------------------------------------------------------
// Bands and channels
// ---------------------------------------------------------------------------

/** Aeronautical VHF voice band (ICAO Annex 10 Vol V), MHz. Double-sideband AM. */
export const VHF_COM_BAND = { minMHz: 118.0, maxMHz: 136.975 } as const
/** UHF band used by military aviation voice radio, MHz. */
export const UHF_MIL_BAND = { minMHz: 225, maxMHz: 400 } as const
/** VHF emergency (guard) frequency, MHz. */
export const VHF_GUARD_MHZ = 121.5
/** UHF military emergency (guard) frequency, MHz. */
export const UHF_GUARD_MHZ = 243.0

export type ChannelSpacing = '25' | '8.33'

/** Channel spacing in kHz. 8.33 kHz is exactly one third of 25 kHz. */
export const SPACING_KHZ: Record<ChannelSpacing, number> = { '25': 25, '8.33': 25 / 3 }

/** Number of 25 kHz blocks in the band: 118.000 ... 136.975 MHz inclusive (760). */
export const BLOCKS_25KHZ = Math.round((VHF_COM_BAND.maxMHz - VHF_COM_BAND.minMHz) / 0.025) + 1

/** Number of voice channels in the VHF band: 760 at 25 kHz, three times as many at 8.33 kHz. */
export function channelCount(spacing: ChannelSpacing): number {
  return spacing === '25' ? BLOCKS_25KHZ : BLOCKS_25KHZ * 3
}

/** Centre frequency (MHz) of channel `index` (0 = 118.000 MHz). */
export function channelFrequencyMHz(index: number, spacing: ChannelSpacing): number {
  if (spacing === '25') return VHF_COM_BAND.minMHz + index * 0.025
  const block = Math.floor(index / 3)
  return VHF_COM_BAND.minMHz + block * 0.025 + (index - block * 3) * (0.025 / 3)
}

/** Index of the channel nearest to `freqMHz`. */
export function nearestChannelIndex(freqMHz: number, spacing: ChannelSpacing): number {
  const step = SPACING_KHZ[spacing] / 1000
  const i = Math.round((freqMHz - VHF_COM_BAND.minMHz) / step)
  return Math.max(0, Math.min(channelCount(spacing) - 1, i))
}

/**
 * The name a pilot dials for a channel. With 25 kHz spacing it is the
 * frequency itself. In the 8.33 kHz scheme each 25 kHz block holds three
 * channels named .xx5, .x10 and .x15 above the block start, so the 8.33 kHz
 * channel on 118.0000 MHz is dialled "118.005" and "118.000" always means the
 * 25 kHz channel.
 * TODO(expert-review): confirm the 8.33 kHz channel-naming table (ICAO Annex 10 Vol V).
 */
export function channelName(index: number, spacing: ChannelSpacing): string {
  if (spacing === '25') return channelFrequencyMHz(index, '25').toFixed(3)
  const block = Math.floor(index / 3)
  const sub = index - block * 3
  return (VHF_COM_BAND.minMHz + block * 0.025 + (sub + 1) * 0.005).toFixed(3)
}

export function isInVhfComBand(freqMHz: number): boolean {
  return freqMHz >= VHF_COM_BAND.minMHz - 1e-9 && freqMHz <= VHF_COM_BAND.maxMHz + 1e-9
}

// ---------------------------------------------------------------------------
// Link budget
// ---------------------------------------------------------------------------

/** One end of a radio link. */
export interface RadioEnd {
  /** Transmitter power, W (only used when this end transmits). */
  powerW: number
  antennaGainDbi: number
  /** Cable and connector losses, dB. */
  cableLossDb: number
}

// TODO(expert-review): typical ground and airborne VHF transmitter powers, antenna gains and feeder losses.
/** A ground radio site transmitter, about 25 W into a mast antenna. */
export const GROUND_RADIO: RadioEnd = { powerW: 25, antennaGainDbi: 2, cableLossDb: 3 }
/** A typical airliner VHF radio, about 25 W into a small blade antenna. */
export const AIRCRAFT_RADIO: RadioEnd = { powerW: 25, antennaGainDbi: 0, cableLossDb: 3 }

/** Watts to dBm. */
export const wattsToDbm = (w: number) => 10 * Math.log10(w) + 30

/**
 * Received carrier level (dBm) over a clear line-of-sight path of `slantNm`:
 * transmit power + antenna gains - feeder losses - free-space path loss.
 */
export function linkLevelDbm(tx: RadioEnd, rx: RadioEnd, slantNm: number, freqMHz: number): number {
  const d = Math.max(slantNm, 0.01)
  return wattsToDbm(tx.powerW) + tx.antennaGainDbi - tx.cableLossDb + rx.antennaGainDbi - rx.cableLossDb - freeSpacePathLossDbNm(d, freqMHz)
}

/** Terrain profile along the path: ground height (ft above sea level) at distance `dNm` from the ground station. */
export type PathProfile = (dNm: number) => number

export const flatSea: PathProfile = () => 0

export interface PathLink {
  /** Line-of-sight result (the ray clears the Earth and the terrain). */
  los: LineOfSightResult
  slantNm: number
  /** Received level, dBm, or -Infinity when the path is blocked. */
  levelDbm: number
}

/**
 * A radio link between two points on the same straight path (the side view):
 * positions are distances from the ground station, NM; heights ft above sea level.
 * Uses propagation.lineOfSight, so the result agrees with the 1.23·(√h₁+√h₂) rule.
 */
export function pathLink(
  aNm: number,
  aHeightFt: number,
  bNm: number,
  bHeightFt: number,
  profile: PathProfile,
  freqMHz: number,
  tx: RadioEnd,
  rx: RadioEnd,
): PathLink {
  const los = lineOfSight({ x: aNm, y: 0 }, aHeightFt, { x: bNm, y: 0 }, bHeightFt, (p) => profile(p.x), LOS_STEP_NM)
  const slantNm = slantRangeNm(Math.abs(bNm - aNm), bHeightFt, aHeightFt)
  return { los, slantNm, levelDbm: los.visible ? linkLevelDbm(tx, rx, slantNm, freqMHz) : -Infinity }
}

/** Sampling step used for every line-of-sight check in the VHF module. */
export const LOS_STEP_NM = 0.25

/**
 * Lowest aircraft height (ft above sea level) at which an aircraft `dNm` from a
 * ground antenna at `hTxFt` still has line of sight to it. Over a smooth
 * Earth this is exactly propagation.minHeightForLineOfSightFt. Terrain can
 * only raise it: for a point s along the path with ground height H(s), the
 * straight ray clears it when
 *   h ≥ hTx + (H(s) + bulge(s) - hTx) · d / s.
 * The terrain is sampled at the same points as propagation.lineOfSight.
 */
export function minAltitudeForContactFt(hTxFt: number, dNm: number, profile: PathProfile = flatSea): number {
  let h = minHeightForLineOfSightFt(hTxFt, dNm)
  if (dNm <= 0) return h
  const n = Math.max(8, Math.ceil(dNm / LOS_STEP_NM))
  for (let i = 1; i < n; i++) {
    const s = (dNm * i) / n
    const ground = Math.max(0, profile(s))
    if (ground <= 0) continue
    h = Math.max(h, hTxFt + ((ground + earthBulgeFt(s, dNm) - hTxFt) * dNm) / s)
  }
  return h
}

/**
 * First point (NM from the transmitter) where the straight ray to a receiver
 * `dNm` away runs into the Earth or the terrain, or null when the path is
 * clear. Same sampling as propagation.lineOfSight.
 */
export function firstObstructionNm(hTxFt: number, dNm: number, hRxFt: number, profile: PathProfile = flatSea): number | null {
  const n = Math.max(8, Math.ceil(dNm / LOS_STEP_NM))
  for (let i = 1; i < n; i++) {
    const s = (dNm * i) / n
    if (rayHeightFt(s, dNm, hTxFt, hRxFt) - Math.max(0, profile(s)) <= 0) return s
  }
  return null
}

// ---------------------------------------------------------------------------
// Side view on the effective Earth
// ---------------------------------------------------------------------------

/**
 * Where to draw a point (distance `dNm` along the path, height `hFt` above sea
 * level) in a flat "side view" frame whose tangent point is at `centerNm`.
 * The Earth's surface is drawn `earthDropFt(d - centre)` below the tangent line,
 * so the straight radio ray of propagation.rayHeightFt is a straight line in
 * this frame, and the tangent from an antenna touches the surface exactly at
 * its radio horizon. x is in NM, y in ft.
 */
export function sideViewPoint(dNm: number, hFt: number, centerNm: number): { x: number; y: number } {
  return { x: dNm, y: hFt - earthDropFt(dNm - centerNm) }
}

// ---------------------------------------------------------------------------
// Receiver: noise, squelch, collisions and interference
// ---------------------------------------------------------------------------

// TODO(expert-review): effective receiver noise floor (thermal + external noise) for a 25 kHz AM receiver.
/** Noise at the receiver input, dBm. */
export const RECEIVER_NOISE_DBM = -120
/** Noise peaks this far above the average noise open a squelch set too low, dB. */
export const NOISE_PEAK_DB = 3
/** A carrier this far above the noise is audible (and beats with others), dB. */
export const AUDIBLE_SNR_DB = 6
/** Below this signal-to-noise (or signal-to-interference) ratio speech is unreadable, dB. */
export const READABLE_DB = 10
/** At or above this ratio speech is clear, dB. */
export const CLEAR_DB = 20

// TODO(expert-review): adjacent-channel rejection of typical 25 kHz and 8.33 kHz airborne receivers.
/**
 * How much the receiver's filter weakens a transmitter one channel away, dB.
 * With 8.33 kHz spacing the neighbour is three times closer in frequency, so
 * less of it can be filtered out. Illustrative values.
 */
export const ADJACENT_REJECTION_DB: Record<ChannelSpacing, number> = { '25': 70, '8.33': 50 }

/** Level of a transmitter one channel away after the receiver's filter, dBm. */
export function adjacentLeakDbm(levelDbm: number, spacing: ChannelSpacing): number {
  return levelDbm - ADJACENT_REJECTION_DB[spacing]
}

/** True when noise alone opens a squelch set at `squelchDbm`. */
export function squelchOpenedByNoise(squelchDbm: number, noiseDbm = RECEIVER_NOISE_DBM): boolean {
  return squelchDbm <= noiseDbm + NOISE_PEAK_DB
}

export interface Carrier {
  id: string
  levelDbm: number
}

export type RxState =
  /** Squelch closed: silence. */
  | 'muted'
  /** Squelch open but nobody talking: hiss. */
  | 'hiss'
  /** One station, clear. */
  | 'clear'
  /** One station, readable with noise or interference. */
  | 'noisy'
  /** One station, too weak or too disturbed to understand. */
  | 'garbled'
  /** Two or more stations at once: heterodyne squeal, nothing gets through. */
  | 'blocked'
  /** Only a neighbouring channel leaking in. */
  | 'bleed'

export interface RxResult {
  state: RxState
  open: boolean
  /** Audible carriers on the channel, strongest first. */
  heard: Carrier[]
  /** Signal-to-noise of the strongest carrier, dB (−∞ when none). */
  snrDb: number
  /** Signal-to-interference of the strongest carrier, dB (+∞ when no interference). */
  sirDb: number
  /** Share of noise in the audio, 0..1 (1 = pure hiss). */
  hiss: number
}

/** Share of hiss in the audio for a given signal-to-noise ratio (AM with automatic gain control). */
export function hissFraction(snrDb: number): number {
  if (!Number.isFinite(snrDb)) return snrDb > 0 ? 0 : 1
  return 1 / (1 + 10 ** (snrDb / 20))
}

/**
 * What a receiver outputs. `carriers` are transmitters on the tuned channel;
 * `interferenceDbm` is what leaks in from other channels (after filtering).
 * The squelch opens when any carrier, the interference or the noise peaks
 * reach the threshold. Two audible carriers at once beat into a squeal: AM
 * has no "capture" effect, so neither message gets through.
 */
export function receiverOutput(
  carriers: Carrier[],
  squelchDbm: number,
  opts: { noiseDbm?: number; interferenceDbm?: number } = {},
): RxResult {
  const noise = opts.noiseDbm ?? RECEIVER_NOISE_DBM
  const interf = opts.interferenceDbm ?? -Infinity
  const heard = carriers.filter((c) => c.levelDbm >= noise + AUDIBLE_SNR_DB).sort((a, b) => b.levelDbm - a.levelDbm)
  const strongest = carriers.reduce((m, c) => Math.max(m, c.levelDbm), -Infinity)
  const open = strongest >= squelchDbm || interf >= squelchDbm || squelchOpenedByNoise(squelchDbm, noise)
  const top = heard[0]
  const snrDb = top ? top.levelDbm - noise : -Infinity
  const sirDb = top ? top.levelDbm - interf : Infinity
  if (!open) return { state: 'muted', open, heard, snrDb, sirDb, hiss: 0 }
  if (heard.length >= 2) return { state: 'blocked', open, heard, snrDb, sirDb, hiss: 0.2 }
  if (!top) {
    const bleeding = interf >= noise + AUDIBLE_SNR_DB
    return { state: bleeding ? 'bleed' : 'hiss', open, heard, snrDb, sirDb, hiss: bleeding ? 0.5 : 1 }
  }
  const quality = Math.min(snrDb, sirDb)
  const state: RxState = quality >= CLEAR_DB ? 'clear' : quality >= READABLE_DB ? 'noisy' : 'garbled'
  return { state, open, heard, snrDb, sirDb, hiss: hissFraction(snrDb) }
}

/** Readability on the 1–5 scale radio operators use, from signal-to-noise/interference (dB). */
export function readability(qualityDb: number): 1 | 2 | 3 | 4 | 5 {
  // TODO(expert-review): mapping from SNR to the readability scale is illustrative.
  if (qualityDb >= 30) return 5
  if (qualityDb >= CLEAR_DB) return 4
  if (qualityDb >= 15) return 3
  if (qualityDb >= READABLE_DB) return 2
  return 1
}

export interface TimeSpan {
  start: number
  end: number
}

/** Seconds during which two transmissions on the same channel overlap (0 when they do not). */
export function overlapS(a: TimeSpan, b: TimeSpan): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start))
}
