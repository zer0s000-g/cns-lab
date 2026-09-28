/**
 * DME scenario engine. One aircraft (CNS101) carries the DME interrogator;
 * up to 200 other aircraft use the same ground station. The engine runs the
 * avionics (jittered interrogations, search, tracking gate, memory), the
 * ground transponder (reply delay, dead time, squitter, overload control)
 * and line of sight, all from the pure functions in src/core/dme.ts.
 */

import {
  createRangeRateFilter,
  DME_IDENT_INTERVAL_S,
  DME_SEARCH_RATE_PPS,
  DME_TRACK_RATE_PPS,
  dmeDistanceFromTimingNm,
  dmeReplyDelayUs,
  dmeTiming,
  findConsistentDelayUs,
  nextInterrogationIntervalS,
  randomReplyDelaysUs,
  stationLoad,
  timeToStationMin,
  updateRangeRateFilter,
  type DmeMode,
  type DmeStationLoad,
  type RangeRateFilter,
} from '@/core/dme'
import { bearingDeg, destinationPoint, distanceNm, type Vec2 } from '@/core/geometry'
import { lineOfSight, radioLineOfSightNm, roundTripTimeUs, slantRangeNm, type LineOfSightResult } from '@/core/propagation'
import { mulberry32 } from '@/core/random'
import { FT_PER_NM, LIGHT_NM_PER_US } from '@/core/units'
import { createAircraft, radialSpeedKt, stepAircraftFine, terrainFn, type Aircraft } from '@/core/world'
import type { DmeReading } from '@/instruments'

export interface DmeStation {
  pos: Vec2
  /** Antenna height above mean sea level, ft. */
  heightFt: number
  ident: string
  channel: number
  /** Paired VOR frequency, MHz. */
  vorMHz: number
}

/** The airport's VOR/DME, beside the runway. CH 90X is paired with VOR 114.30 MHz. */
export const STATION: DmeStation = { pos: { x: 0, y: 0.6 }, heightFt: 55, ident: 'CNS', channel: 90, vorMHz: 114.3 }

export interface DmeEnv {
  /** Other aircraft interrogating the same station. */
  trafficCount: number
  /** Failure demo: interrogators without jitter, and a second aircraft in step with ours. */
  noJitter: boolean
  mode: DmeMode
}

export const DEFAULT_ENV: DmeEnv = { trafficCount: 12, noJitter: false, mode: 'X' }
export const MAX_TRAFFIC = 200

export type AvionicsMode = 'search' | 'track' | 'memory'

/** One question from our aircraft and every reply heard after it. */
export interface InterrogationRecord {
  timeS: number
  /** Every reply delay heard in the listening window, µs (sorted). */
  delaysUs: number[]
  /** The true answer to this question (µs), or null if the station did not answer us. */
  ownUs: number | null
  /** The in-step twin's answer (µs), or null. */
  twinUs: number | null
  /** Where the tracking gate was, µs (null while searching). */
  gateUs: number | null
  /** A reply was found inside the gate. */
  hit: boolean
}

export interface TrafficAircraft extends Aircraft {
  ratePps: number
}

/** Rows kept for the "which answer is mine?" view. */
export const HISTORY_ROWS = 64
/** Questions the search looks at before deciding. */
export const SEARCH_ROWS = 30
/** Half-width of the tracking gate, µs. */
export const GATE_HALF_US = 3
/** Tracking loop gains (share of the position and rate error corrected per reply). */
const GATE_ALPHA = 0.4
const GATE_BETA = 0.05
/** A tracked reply further than this from where it was expected is not used as a measurement, µs. */
const TRUST_US = 1
/** Raw groundspeed jumps larger than this are stray measurements, kt. */
const GS_MAX_STEP_KT = 150
/** Questions over which the tracker counts hits. */
const TRACK_WINDOW = 20
// TODO(expert-review): memory (coast) time of DME avionics after replies are lost (typically several seconds).
export const MEMORY_S = 8
/** Longest distance the interrogator listens for, NM. */
export const MAX_RANGE_NM = 200

export const DEFAULT_OWN = {
  id: 'CNS101',
  pos: { x: -21, y: -21 },
  altitudeFt: 10000,
  headingDeg: 45,
  speedKt: 280,
}

function defaultRoute(): Aircraft['mode'] {
  return { kind: 'route', waypoints: [{ ...STATION.pos }, { x: 24, y: 24 }, { x: -21, y: -21 }], index: 0, loop: true }
}

export class DmeEngine {
  readonly station = STATION
  readonly terrain = terrainFn()
  env: DmeEnv = { ...DEFAULT_ENV }
  timeS = 0
  own: Aircraft
  traffic: TrafficAircraft[] = []
  twin: Aircraft | null = null
  /** Constant offset between the twin's questions and ours when neither is jittered, µs. */
  twinOffsetUs = 0
  mode: AvionicsMode = 'search'
  gateUs: number | null = null
  private gateRateUsPerS = 0
  private lastGateTimeS = 0
  private hits: boolean[] = []
  private searchRows: number[][] = []
  private memoryStartS = 0
  private consecutiveHits = 0
  nextInterrogationS = 0
  measuredNm: number | null = null
  rangeRate: RangeRateFilter = createRangeRateFilter()
  history: InterrogationRecord[] = []
  /** Every question sent since the last reset (for rates in the UI). */
  interrogations = 0
  load: DmeStationLoad
  los: LineOfSightResult
  identNextS = 4
  /** Events for the UI (sound and captions). */
  events: 'ident'[] = []
  private rand: () => number
  private readonly pool: TrafficAircraft[]
  private loadAgeS = Infinity
  private prevSlantNm = 0

  constructor(seed = 7) {
    this.rand = mulberry32(seed)
    this.own = this.makeOwn()
    this.pool = makeTrafficPool(mulberry32(seed * 31 + 1))
    this.traffic = this.pool.slice(0, this.env.trafficCount)
    this.los = this.computeLos()
    this.load = this.computeLoad()
    this.prevSlantNm = this.ownSlantNm
  }

  private makeOwn(): Aircraft {
    return { ...createAircraft({ ...DEFAULT_OWN, callsign: 'CNS101' }), mode: defaultRoute() }
  }

  reset() {
    this.timeS = 0
    this.own = this.makeOwn()
    this.env = { ...DEFAULT_ENV }
    this.traffic = this.pool.slice(0, this.env.trafficCount).map((a) => ({ ...a }))
    this.twin = null
    this.history = []
    this.interrogations = 0
    this.identNextS = 4
    this.events = []
    this.resetAvionics()
  }

  /** Start searching again (as when the pilot tunes the station). */
  resetAvionics() {
    this.mode = 'search'
    this.gateUs = null
    this.gateRateUsPerS = 0
    this.hits = []
    this.searchRows = []
    this.consecutiveHits = 0
    this.measuredNm = null
    this.rangeRate = createRangeRateFilter()
    this.nextInterrogationS = this.timeS
    this.los = this.computeLos()
    this.loadAgeS = Infinity
    this.load = this.computeLoad()
    this.prevSlantNm = this.ownSlantNm
  }

  setEnv(next: DmeEnv) {
    const prev = this.env
    this.env = { ...next, trafficCount: Math.max(0, Math.min(MAX_TRAFFIC, Math.round(next.trafficCount))) }
    if (prev.trafficCount !== this.env.trafficCount) {
      const kept = new Map(this.traffic.map((a) => [a.id, a]))
      this.traffic = this.pool.slice(0, this.env.trafficCount).map((a) => kept.get(a.id) ?? { ...a })
      this.loadAgeS = Infinity
    }
    if (prev.noJitter !== this.env.noJitter) {
      if (this.env.noJitter) this.addTwin()
      else this.twin = null
      this.resetAvionics()
    }
    if (prev.mode !== this.env.mode) this.resetAvionics()
  }

  /** Put a second aircraft in step with ours, placed so its answers land before ours. */
  private addTwin() {
    const pos = destinationPoint(this.station.pos, 300, 12)
    this.twin = {
      ...createAircraft({ id: 'CNS202', callsign: 'CNS202', pos, altitudeFt: 9000, headingDeg: 30, speedKt: 260 }),
      mode: { kind: 'orbit', center: { ...this.station.pos }, radiusNm: 12, clockwise: true },
    }
    const falseNm = Math.max(0.5, this.ownSlantNm * 0.55)
    this.twinOffsetUs = roundTripTimeUs(falseNm) - roundTripTimeUs(this.slantOf(this.twin))
  }

  // ---- geometry --------------------------------------------------------

  slantOf(a: Aircraft): number {
    return slantRangeNm(distanceNm(this.station.pos, a.pos), a.altitudeFt, this.station.heightFt)
  }
  get ownGroundNm() {
    return distanceNm(this.station.pos, this.own.pos)
  }
  get ownHeightFt() {
    return this.own.altitudeFt - this.station.heightFt
  }
  get ownSlantNm() {
    return this.slantOf(this.own)
  }
  /** Exact rate of change of the slant range, kt (positive = moving away). */
  get trueRangeRateKt() {
    const g = this.ownGroundNm
    const s = this.ownSlantNm
    return s > 1e-9 ? radialSpeedKt(this.own, this.station.pos) * (g / s) : 0
  }
  /** Delay at which the twin's in-step answers arrive after each of our questions, µs. */
  get twinDelayUs(): number | null {
    if (!this.twin || !this.env.noJitter) return null
    return this.twinOffsetUs + roundTripTimeUs(this.slantOf(this.twin)) + dmeReplyDelayUs(this.env.mode)
  }
  /** True when the tracking gate sits on the twin's answers instead of ours. */
  get lockedOnTwin(): boolean {
    const t = this.twinDelayUs
    if (t === null || this.gateUs === null || this.mode === 'search') return false
    const own = dmeTiming(this.ownSlantNm, this.env.mode).totalUs
    return Math.abs(this.gateUs - t) < Math.abs(this.gateUs - own)
  }
  get ownRatePps() {
    return this.mode === 'search' ? DME_SEARCH_RATE_PPS : DME_TRACK_RATE_PPS
  }
  get ownEfficiency() {
    return this.load.efficiency.get(this.own.id) ?? 0
  }
  get heard() {
    return this.los.visible
  }

  private computeLos(): LineOfSightResult {
    return lineOfSight(this.station.pos, this.station.heightFt, this.own.pos, this.own.altitudeFt, this.terrain, 0.25)
  }

  private computeLoad(): DmeStationLoad {
    const q = this.traffic.map((a) => ({
      id: a.id,
      rangeNm: this.slantOf(a),
      ratePps: a.ratePps,
      heard: distanceNm(this.station.pos, a.pos) <= radioLineOfSightNm(this.station.heightFt, a.altitudeFt),
    }))
    q.push({ id: this.own.id, rangeNm: this.ownSlantNm, ratePps: this.ownRatePps, heard: this.heard })
    // The twin runs exactly in step with us, so it asks at our rate.
    if (this.twin) q.push({ id: this.twin.id, rangeNm: this.slantOf(this.twin), ratePps: this.ownRatePps, heard: true })
    return stationLoad(q)
  }

  /** Answers per interrogation window that are NOT our own or the twin's in-step answers, pps. */
  private randomReplyPps(): number {
    const own = this.ownEfficiency * this.ownRatePps
    const twin = this.twin && this.env.noJitter ? (this.load.efficiency.get(this.twin.id) ?? 0) * this.ownRatePps : 0
    return Math.max(0, this.load.transmissionPps - own - twin)
  }

  // ---- stepping ---------------------------------------------------------

  step(dt: number) {
    if (dt <= 0) return
    const t0 = this.timeS
    const s0 = this.prevSlantNm
    this.timeS += dt
    this.own = stepAircraftFine(this.own, dt)
    this.traffic = this.traffic.map((a) => ({ ...stepAircraftFine(a, dt, 1), ratePps: a.ratePps }))
    if (this.twin) this.twin = stepAircraftFine(this.twin, dt)
    this.los = this.computeLos()
    this.loadAgeS += dt
    if (this.loadAgeS >= 0.25) {
      this.load = this.computeLoad()
      this.loadAgeS = 0
    }
    const s1 = this.ownSlantNm
    this.prevSlantNm = s1

    // Every question sent during this frame, at its own (jittered) time.
    let guard = 0
    while (this.nextInterrogationS <= this.timeS && guard++ < 2000) {
      const tq = Math.max(this.nextInterrogationS, t0)
      const f = dt > 0 ? (tq - t0) / dt : 1
      this.interrogate(tq, s0 + (s1 - s0) * f)
    }
    if (this.nextInterrogationS < this.timeS) this.nextInterrogationS = this.timeS

    if (this.mode === 'memory' && this.timeS - this.memoryStartS > MEMORY_S) this.startSearch()

    if (this.timeS >= this.identNextS) {
      this.identNextS += DME_IDENT_INTERVAL_S
      if (this.heard) this.events.push('ident')
    }
  }

  private startSearch() {
    this.mode = 'search'
    this.gateUs = null
    this.searchRows = []
    this.hits = []
    this.consecutiveHits = 0
    this.measuredNm = null
    this.rangeRate = createRangeRateFilter()
    this.loadAgeS = Infinity
  }

  /** Events since the last call (and clear them). */
  takeEvents(): 'ident'[] {
    const ev = this.events
    this.events = []
    return ev
  }

  /** Send one question now (used before a slow-motion replay). Returns the record. */
  interrogateNow(): InterrogationRecord {
    return this.interrogate(this.timeS, this.ownSlantNm)
  }

  private interrogate(tS: number, slantNm: number): InterrogationRecord {
    const mode = this.env.mode
    const delay = dmeReplyDelayUs(mode)
    const windowUs = roundTripTimeUs(MAX_RANGE_NM) + delay
    const delays: number[] = []
    let ownUs: number | null = null
    let twinUs: number | null = null
    if (this.heard) {
      if (this.rand() < this.ownEfficiency) {
        ownUs = dmeTiming(slantNm, mode).totalUs
        delays.push(ownUs)
      }
      const td = this.twinDelayUs
      if (td !== null && this.twin && this.rand() < (this.load.efficiency.get(this.twin.id) ?? 0) && td > 0 && td < windowUs) {
        twinUs = td
        delays.push(td)
      }
      for (const d of randomReplyDelaysUs(this.rand, this.randomReplyPps(), windowUs)) if (d >= delay) delays.push(d)
    }
    delays.sort((a, b) => a - b)
    this.interrogations++

    // ---- the avionics: search, track or coast ----
    let hit = false
    const gateBefore = this.gateUs
    if (this.mode === 'search') {
      this.searchRows.push(delays)
      if (this.searchRows.length > SEARCH_ROWS) this.searchRows.shift()
      if (this.searchRows.length >= SEARCH_ROWS) {
        const found = findConsistentDelayUs(this.searchRows, { windowUs: 2 * GATE_HALF_US, minFraction: 0.5, minDelayUs: delay })
        if (found !== null) {
          this.mode = 'track'
          this.gateUs = found
          this.gateRateUsPerS = 0
          this.lastGateTimeS = tS
          this.hits = []
          // The search estimate averages several questions, so it is only used for the distance;
          // the groundspeed starts from the first tracked replies.
          this.measuredNm = dmeDistanceFromTimingNm(found, mode)
          this.rangeRate = createRangeRateFilter()
        }
      }
    } else {
      const predicted = (this.gateUs ?? 0) + this.gateRateUsPerS * (tS - this.lastGateTimeS)
      let best: number | null = null
      for (const d of delays) if (Math.abs(d - predicted) <= GATE_HALF_US && (best === null || Math.abs(d - predicted) < Math.abs(best - predicted))) best = d
      hit = best !== null
      const dtG = tS - this.lastGateTimeS
      let residual = Infinity
      if (best !== null) {
        // Alpha-beta tracking loop: move part of the way toward the reply, so one stray
        // reply that happens to land in the gate cannot drag the distance far.
        residual = best - predicted
        this.gateUs = predicted + GATE_ALPHA * residual
        if (dtG > 1e-6) this.gateRateUsPerS += (GATE_BETA * residual) / dtG
      } else {
        this.gateUs = predicted
      }
      this.lastGateTimeS = tS
      this.hits.push(hit)
      if (this.hits.length > TRACK_WINDOW) this.hits.shift()
      this.consecutiveHits = hit ? this.consecutiveHits + 1 : 0
      if (this.mode === 'track') {
        const ratio = this.hits.filter(Boolean).length / this.hits.length
        // Only trust a reply that arrives where expected while answers keep coming; a lone
        // stray reply landing in the gate after our own answers stopped is not a measurement.
        if (hit && ratio >= 0.5 && Math.abs(residual) <= TRUST_US) this.measure(tS)
        if (this.hits.length >= 10 && ratio < 0.25) {
          this.mode = 'memory'
          this.memoryStartS = tS
        }
      } else if (this.consecutiveHits >= 3) {
        this.mode = 'track'
        if (Math.abs(residual) <= TRUST_US) this.measure(tS)
      }
    }

    const rec: InterrogationRecord = { timeS: tS, delaysUs: delays, ownUs, twinUs, gateUs: gateBefore, hit }
    this.history.push(rec)
    if (this.history.length > HISTORY_ROWS) this.history.shift()
    const jitter = this.env.noJitter ? null : this.rand
    this.nextInterrogationS = tS + nextInterrogationIntervalS(this.ownRatePps, jitter)
    return rec
  }

  private measure(tS: number) {
    if (this.gateUs === null) return
    this.measuredNm = dmeDistanceFromTimingNm(this.gateUs, this.env.mode)
    this.rangeRate = updateRangeRateFilter(this.rangeRate, tS, this.measuredNm, undefined, this.rangeRate.rateKt === null ? Infinity : GS_MAX_STEP_KT)
  }

  /** What the cockpit DME shows. */
  reading(): DmeReading {
    const status = this.mode === 'search' ? 'SEARCH' : this.mode === 'memory' ? 'MEMORY' : 'LOCK'
    const d = this.mode === 'search' ? null : this.measuredNm
    const rate = this.mode === 'search' ? null : this.rangeRate.rateKt
    return {
      distanceNm: d,
      groundSpeedKt: rate === null ? null : Math.abs(rate),
      timeToStationMin: d === null ? null : timeToStationMin(d, rate),
      channel: `${this.station.channel}${this.env.mode}`,
      ident: this.station.ident,
      status,
    }
  }

  // ---- learner actions and scenario setups -------------------------------

  setOwn(patch: Partial<Aircraft>) {
    this.own = { ...this.own, ...patch }
    this.los = this.computeLos()
  }

  /** Move our aircraft somewhere new and let the DME search again. */
  placeOwn(p: { pos: Vec2; altitudeFt: number; headingDeg: number; speedKt: number; mode?: Aircraft['mode'] }) {
    this.own = {
      ...this.own,
      pos: { ...p.pos },
      altitudeFt: p.altitudeFt,
      targetAltitudeFt: p.altitudeFt,
      headingDeg: p.headingDeg,
      targetHeadingDeg: p.headingDeg,
      speedKt: p.speedKt,
      targetSpeedKt: p.speedKt,
      verticalSpeedFpm: 0,
      held: false,
      mode: p.mode ?? { kind: 'heading' },
    }
    this.resetAvionics()
  }

  /**
   * Continue as if the DME had already been tracking its own answers for a
   * while (used by "Set it up for me" buttons so they start with a lock).
   */
  assumeLocked() {
    if (!this.heard || this.ownEfficiency <= 0) return
    const t = dmeTiming(this.ownSlantNm, this.env.mode).totalUs
    this.mode = 'track'
    this.gateUs = t
    this.gateRateUsPerS = (2 * this.trueRangeRateKt) / 3600 / LIGHT_NM_PER_US
    this.lastGateTimeS = this.timeS
    this.hits = Array.from({ length: TRACK_WINDOW }, () => true)
    this.consecutiveHits = TRACK_WINDOW
    this.measuredNm = dmeDistanceFromTimingNm(t, this.env.mode)
    this.rangeRate = { lastTimeS: this.timeS, lastDistanceNm: this.measuredNm, rateKt: this.trueRangeRateKt }
    this.nextInterrogationS = this.timeS
  }

  placeDefault() {
    this.own = this.makeOwn()
    this.resetAvionics()
  }

  /** Low behind Mount Sentinel: the hill blocks the station. Flies south, out of the shadow. */
  placeBehindHill() {
    this.placeOwn({ pos: { x: -24, y: 10.5 }, altitudeFt: 2500, headingDeg: 180, speedKt: 220 })
  }

  /** A few miles out, heading straight over the station at `altitudeFt`. */
  placeOverhead(altitudeFt = 6000, distanceOut = 5, speedKt = 200) {
    const pos = destinationPoint(this.station.pos, 270, distanceOut)
    this.placeOwn({ pos, altitudeFt, headingDeg: 90, speedKt, mode: { kind: 'direct', to: { ...this.station.pos }, thenHeading: 90 } })
  }

  /** Circle the station at `radiusNm`. */
  placeOrbit(radiusNm = 10, altitudeFt = 8000, speedKt = 250) {
    const pos = destinationPoint(this.station.pos, 180, radiusNm)
    this.placeOwn({ pos, altitudeFt, headingDeg: 90, speedKt, mode: { kind: 'orbit', center: { ...this.station.pos }, radiusNm, clockwise: false } })
  }

  /** Far out and high, flying toward the station. */
  placeFar(distanceOut = 80, altitudeFt = 25000, speedKt = 320) {
    const pos = destinationPoint(this.station.pos, 250, distanceOut)
    this.placeOwn({ pos, altitudeFt, headingDeg: bearingDeg(pos, this.station.pos), speedKt, mode: { kind: 'direct', to: { ...this.station.pos } } })
  }

  /** Straight in from `distanceOut` NM at a constant altitude. */
  placeInbound(distanceOut = 30, altitudeFt = 10000, speedKt = 280) {
    const pos = destinationPoint(this.station.pos, 225, distanceOut)
    this.placeOwn({ pos, altitudeFt, headingDeg: 45, speedKt, mode: { kind: 'direct', to: { ...this.station.pos }, thenHeading: 45 } })
  }

  /** Traffic aircraft that currently get at least half of their answers. */
  isAnswered(id: string) {
    return (this.load.efficiency.get(id) ?? 0) >= 0.5
  }

  /** Height above the station as a distance, NM. */
  get ownHeightNm() {
    return this.ownHeightFt / FT_PER_NM
  }
}

/** 200 aircraft spread around the station, flying circles so the load stays steady. */
function makeTrafficPool(rand: () => number): TrafficAircraft[] {
  const out: TrafficAircraft[] = []
  for (let i = 0; i < MAX_TRAFFIC; i++) {
    const r = 3 + 87 * rand()
    const brg = 360 * rand()
    const alt = Math.round((6000 + 33000 * rand()) / 1000) * 1000
    const speed = Math.round(240 + 200 * rand())
    const cw = rand() < 0.5
    const pos = destinationPoint(STATION.pos, brg, r)
    const a = createAircraft({ id: `T${String(i + 1).padStart(3, '0')}`, pos, altitudeFt: alt, headingDeg: brg + (cw ? 90 : -90), speedKt: speed })
    // TODO(expert-review): mix of interrogation rates in traffic (about 1 aircraft in 20 searching at 150 pps, the rest tracking at about 25 pps).
    out.push({ ...a, mode: { kind: 'orbit', center: { ...STATION.pos }, radiusNm: r, clockwise: cw }, ratePps: i % 20 === 0 ? DME_SEARCH_RATE_PPS : 25 })
  }
  return out
}
