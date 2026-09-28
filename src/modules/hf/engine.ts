/**
 * HF radio scenario: an HF ground station on the coast ("Ocean Radio") and
 * aircraft over the ocean at cruise level. The learner picks a frequency and
 * the time of day; the ray fan, the skip zone, the reception at each aircraft
 * and SELCAL all come from the one ionosphere model in src/core/hf.ts.
 *
 * Distances NM from the ground station, altitudes ft. World time comes from
 * the simulator clock; the time of day can be advanced by a labelled time-lapse.
 */

import {
  HF_CHANNELS_MHZ,
  SELCAL_TOTAL_S,
  fanElevationsDeg,
  firstLandingNm,
  groundCoverage,
  hfNoiseDbm,
  ionosphereAt,
  isDaytime,
  pathMuf,
  receptionAt,
  selcalDecodes,
  selcalPairAt,
  skipZoneNm,
  suggestChannel,
  traceRay,
  type BandSegment,
  type Ionosphere,
  type PathMuf,
  type Reception,
  type TracedRay,
} from '@/core/hf'

export const CRUISE_FT = 35000
/** Farthest distance shown in the side view, NM (about 5,000 km). */
export const VIEW_MAX_NM = 2700
/** Time-lapse: hours of the day per second of simulator time. */
export const TIMELAPSE_H_PER_S = 1 / 4

export type AircraftId = 'CNS101' | 'CNS202' | 'CNS303'

export interface HfAircraft {
  id: AircraftId
  /** SELCAL code (fictional). */
  code: string
  distanceNm: number
}

export const OTHER_AIRCRAFT: Record<Exclude<AircraftId, 'CNS101'>, HfAircraft> = {
  CNS202: { id: 'CNS202', code: 'AF-GM', distanceNm: 900 },
  CNS303: { id: 'CNS303', code: 'CJ-LP', distanceNm: 1900 },
}
export const LEARNER_CODE = 'BH-DK'

export interface HfParams {
  /** Local time of day, hours. */
  hour: number
  channelIndex: number
  /** CNS101's distance from the ground station, NM. */
  distanceNm: number
  timelapse: boolean
  /** Keep the HF loudspeaker on (constant noise) instead of waiting for SELCAL. */
  listen: boolean
}

export interface HfFailures {
  flare: boolean
  storm: boolean
}

export const DEFAULT_PARAMS: HfParams = { hour: 13, channelIndex: 9, distanceNm: 1350, timelapse: false, listen: false }
export const DEFAULT_FAILURES: HfFailures = { flare: false, storm: false }

export interface SelcalCall {
  code: string
  target: AircraftId
  startS: number
}

export interface SelcalResult {
  atS: number
  /** The code sent was this aircraft's own. */
  forMe: boolean
  /** Tones received well enough to decode. */
  received: boolean
  /** The chime rang. */
  rang: boolean
  snrDb: number
}

export class HfEngine {
  timeS = 0
  params: HfParams = { ...DEFAULT_PARAMS }
  failures: HfFailures = { ...DEFAULT_FAILURES }
  selcal: SelcalCall | null = null
  /** The most recent call (kept after it has finished). */
  lastCall: SelcalCall | null = null
  results: Partial<Record<AircraftId, SelcalResult>> = {}
  /** Increments whenever a SELCAL decode finishes (for the audio director). */
  decodeSerial = 0

  private cache = new Map<string, unknown>()

  private memo<T>(key: string, f: () => T): T {
    if (this.cache.has(key)) return this.cache.get(key) as T
    const v = f()
    if (this.cache.size > 64) this.cache.clear()
    this.cache.set(key, v)
    return v
  }

  get freqMHz(): number {
    return HF_CHANNELS_MHZ[this.params.channelIndex]
  }

  /** Hour rounded for caching (1 minute). */
  private get hKey() {
    return Math.round(this.params.hour * 60) / 60
  }

  iono(): Ionosphere {
    return this.memo(`io|${this.hKey}|${this.failures.flare}`, () => ionosphereAt(this.hKey, { flare: this.failures.flare }))
  }

  get day(): boolean {
    return isDaytime(this.params.hour)
  }

  distanceOf(id: AircraftId): number {
    return id === 'CNS101' ? this.params.distanceNm : OTHER_AIRCRAFT[id].distanceNm
  }

  codeOf(id: AircraftId): string {
    return id === 'CNS101' ? LEARNER_CODE : OTHER_AIRCRAFT[id].code
  }

  reception(id: AircraftId = 'CNS101', freqMHz = this.freqMHz): Reception {
    const d = this.distanceOf(id)
    return this.memo(`rx|${this.hKey}|${this.failures.flare}|${this.failures.storm}|${freqMHz}|${d}`, () =>
      receptionAt(this.iono(), freqMHz, d, CRUISE_FT, { storm: this.failures.storm }),
    )
  }

  rays(): TracedRay[] {
    return this.memo(`rays|${this.hKey}|${this.failures.flare}|${this.freqMHz}`, () => fanElevationsDeg(3).map((e) => traceRay(this.iono(), this.freqMHz, e, VIEW_MAX_NM)))
  }

  coverage(): BandSegment[] {
    return this.memo(`cov|${this.hKey}|${this.failures.flare}|${this.failures.storm}|${this.freqMHz}`, () =>
      groundCoverage(this.iono(), this.freqMHz, VIEW_MAX_NM, 8, { storm: this.failures.storm }),
    )
  }

  /** Where the first sky wave comes down at sea level, NM (Infinity when none does). */
  firstLanding(): number {
    return this.memo(`first|${this.hKey}|${this.failures.flare}|${this.freqMHz}`, () => firstLandingNm(this.iono(), this.freqMHz))
  }

  skipZone() {
    return this.memo(`skip|${this.hKey}|${this.failures.flare}|${this.freqMHz}`, () => skipZoneNm(this.iono(), this.freqMHz))
  }

  muf(): PathMuf | null {
    return this.memo(`muf|${this.hKey}|${this.failures.flare}|${this.params.distanceNm}`, () => pathMuf(this.iono(), this.params.distanceNm, CRUISE_FT))
  }

  suggestion(): { mHz: number; index: number } | null {
    return this.memo(`sug|${this.hKey}|${this.failures.flare}|${this.failures.storm}|${this.params.distanceNm}`, () =>
      suggestChannel(this.iono(), this.params.distanceNm, CRUISE_FT, { storm: this.failures.storm }),
    )
  }

  noiseDbm(): number {
    return hfNoiseDbm(this.freqMHz, { storm: this.failures.storm })
  }

  /**
   * "Wrong frequency for the time of day": nothing reaches CNS101 because the
   * wave escapes (too high for the ionosphere now) or is absorbed (too low by
   * day), while another channel would work.
   */
  wrongFrequency(): boolean {
    const r = this.reception()
    if (r.mode) return false
    if (r.reason !== 'escapes' && r.reason !== 'absorbed') return false
    return this.suggestion() !== null
  }

  /** A channel that is wrong for this time of day: the top one at night (escapes), the bottom one by day (absorbed). */
  wrongChannelIndex(): number {
    return this.day ? 0 : HF_CHANNELS_MHZ.length - 1
  }

  sendSelcal(target: AircraftId) {
    this.selcal = { code: this.codeOf(target), target, startS: this.timeS }
    this.lastCall = this.selcal
    this.results = {}
  }

  /** Which tone pair is being sent now (0, 1) or null. */
  selcalPairNow(): 0 | 1 | null {
    if (!this.selcal) return null
    return selcalPairAt(this.timeS - this.selcal.startS)
  }

  step(dt: number) {
    if (dt <= 0) return
    this.timeS += dt
    if (this.params.timelapse) this.params = { ...this.params, hour: (this.params.hour + dt * TIMELAPSE_H_PER_S) % 24 }
    const c = this.selcal
    if (c && this.timeS - c.startS >= SELCAL_TOTAL_S) {
      for (const id of ['CNS101', 'CNS202', 'CNS303'] as const) {
        const r = this.reception(id)
        const own = this.codeOf(id)
        const received = r.mode !== null && selcalDecodes(own, own, r.snrDb)
        this.results[id] = { atS: this.timeS, forMe: own === c.code, received, rang: selcalDecodes(c.code, own, r.snrDb), snrDb: r.snrDb }
      }
      this.selcal = null
      this.decodeSerial++
    }
  }

  reset() {
    this.timeS = 0
    this.selcal = null
    this.lastCall = null
    this.results = {}
    this.cache.clear()
  }
}
