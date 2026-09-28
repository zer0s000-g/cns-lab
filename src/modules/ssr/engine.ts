/**
 * Secondary radar scenario engine. The rotating antenna (co-mounted with a
 * primary radar) sends interrogations; every transponder that hears P1 well
 * enough, and passes the side-lobe test, answers. Replies are decoded from
 * their pulses, so overlapping replies really garble, FRUIT really appears at
 * random ranges and side lobes really produce false plots when P2 is missing.
 *
 * Uses only pure functions from src/core (ssr.ts, radar.ts, propagation.ts, world.ts).
 */

import { angleDiff, bearingDeg, distanceNm, normalize360, sweepCovers, type Vec2 } from '@/core/geometry'
import { lineOfSight, radioLineOfSightNm, slantRangeNm } from '@/core/propagation'
import { DEFAULT_RADAR, evaluateTarget, RCS_M2, type RadarSite } from '@/core/radar'
import { gaussian, mulberry32 } from '@/core/random'
import {
  bitsToSquawk,
  decodeGillham,
  decodeReplyPulses,
  downlinkDbm,
  encodeGillham,
  GROUND_RECEIVER_MTL_DBM,
  MODE_S_LOCKOUT_S,
  modeSReplyUs,
  MONOPULSE_SIGMA_AZ_DEG,
  P1_P3_US,
  rangeFromReplyUs,
  replyArrivalUs,
  replyPulseTimes,
  slsDecision,
  slsReplyHalfAngleDeg,
  specialCode,
  SPI_DURATION_S,
  squawkToBits,
  SSR_BEAM_WIDTH_DEG,
  SSR_SIGMA_RANGE_NM,
  TRANSPONDER_MTL_DBM,
  transponderReplies,
  uplinkP1Dbm,
  uplinkP2Dbm,
  type CodeBits,
  type ModeAC,
  type SlsDecision,
} from '@/core/ssr'
import { rangeFromRoundTripNm } from '@/core/propagation'
import { createAircraft, radialSpeedKt, stepAircraftFine, terrainFn, type Aircraft } from '@/core/world'
import type { ScopePaint } from '@/instruments'

export type InterrogationMode = 'ac' | 's'

export interface SsrParams {
  /** Time for one antenna turn (the update interval), s. */
  rotationPeriodS: number
  /** Interrogations per second. */
  prfHz: number
  mode: InterrogationMode
}

// TODO(expert-review): interrogation rate 250 per second (real SSRs use roughly 100–450).
export const DEFAULT_SSR_PARAMS: SsrParams = { rotationPeriodS: 4.8, prfHz: 250, mode: 'ac' }

export interface SsrEnv {
  /** Two aircraft flying in trail, 1 NM apart on the same bearing. */
  garblePair: boolean
  /** Replies triggered by another radar arrive at random times. */
  fruit: boolean
  /** Keep only replies that repeat at the same range on consecutive interrogations. */
  defruiter: boolean
  /** The control antenna is off: no P2, so side lobes are not suppressed. */
  noP2: boolean
}

export const DEFAULT_SSR_ENV: SsrEnv = { garblePair: false, fruit: false, defruiter: true, noP2: false }

export interface Transponder {
  squawk: string
  on: boolean
  /** World time the pilot pressed IDENT, or null. */
  identAtS: number | null
}

export interface SsrAircraft extends Aircraft {
  rcsM2: number
  /** 24-bit Mode S address (fictional). */
  address: number
}

export const SITE: RadarSite = { pos: { x: 0, y: 0 }, heightFt: 90 }
/** Another radar station whose interrogations cause FRUIT on our screen. */
export const OTHER_RADAR: Vec2 = { x: 34, y: 38 }

// TODO(expert-review): FRUIT rate heard through the main beam (busy airspace can reach thousands per second).
export const FRUIT_PER_S = 450
/** Replies are listened for out to this range, NM. */
export const LISTEN_RANGE_NM = 120
/** Range tolerance for the defruiter and for grouping replies into one target, NM. */
const DEFRUIT_TOL_NM = 0.15
const RUN_TOL_NM = 0.3
/** A target needs at least this many replies in one pass of the beam. */
// TODO(expert-review): plot extractor needs 5 replies in one pass (real extractors use similar thresholds).
const MIN_HITS = 5
/** A run of replies ends after this many interrogations with no reply. */
const RUN_GAP = 3
/** A run longer than this is cut into pieces (side-lobe ring-around). */
const MAX_RUN_DEG = 8

export const DEFAULT_SQUAWKS: Record<string, string> = {
  CNS101: '4521',
  CNS202: '3346',
  CNS303: '5237',
  CNS404: '7000',
  CNS505: '2143',
  CNS606: '6012',
}

const ADDRESSES: Record<string, number> = {
  CNS101: 0x8a01a1,
  CNS202: 0x8a02b2,
  CNS303: 0x8a03c3,
  CNS404: 0x8a04d4,
  CNS505: 0x8a05e5,
  CNS606: 0x8a06f6,
}

export function defaultTransponders(): Record<string, Transponder> {
  const out: Record<string, Transponder> = {}
  for (const [id, squawk] of Object.entries(DEFAULT_SQUAWKS)) out[id] = { squawk, on: true, identAtS: null }
  return out
}

/** Racetrack along the 225° radial for the garble pair (x east, y north). */
const u225 = { x: -Math.SQRT1_2, y: -Math.SQRT1_2 }
const n135 = { x: Math.SQRT1_2, y: -Math.SQRT1_2 }
const at = (r: number, off: number): Vec2 => ({ x: u225.x * r + n135.x * off, y: u225.y * r + n135.y * off })
export const GARBLE_ROUTE: Vec2[] = [at(14, 0), at(14, 3), at(36, 3), at(36, 0)]
const CNS303_ROUTE: Vec2[] = [{ x: 0, y: -14 }, { x: -12, y: -6 }, { x: -22, y: -26 }, { x: 4, y: -44 }]
/** CNS404, a light aircraft flying a wide circuit 6–7 NM around the airport. */
const LIGHT_ROUTE: Vec2[] = [{ x: 6, y: -4 }, { x: -6, y: -4 }, { x: -6, y: 4 }, { x: 6, y: 4 }]

function mk(init: Parameters<typeof createAircraft>[0], rcs: number, route?: Vec2[]): SsrAircraft {
  const a = createAircraft(init)
  return {
    ...a,
    rcsM2: rcs,
    address: ADDRESSES[init.id],
    mode: route ? { kind: 'route', waypoints: route, index: 0, loop: true } : a.mode,
  }
}

export function createScenario(): SsrAircraft[] {
  return [
    mk({ id: 'CNS101', pos: { x: 10, y: 30 }, altitudeFt: 12000, headingDeg: 90, speedKt: 280 }, RCS_M2.medium, [{ x: 36, y: 30 }, { x: 36, y: 8 }, { x: 10, y: 8 }, { x: 10, y: 30 }]),
    mk({ id: 'CNS202', category: 'heavy', pos: { x: -45, y: -42 }, altitudeFt: 35000, headingDeg: 90, speedKt: 460 }, RCS_M2.heavy, [{ x: 48, y: -42 }, { x: 48, y: 44 }, { x: -45, y: 44 }, { x: -45, y: -42 }]),
    mk({ id: 'CNS303', pos: { x: 4, y: -44 }, altitudeFt: 8000, headingDeg: 350, speedKt: 250 }, RCS_M2.medium, CNS303_ROUTE),
    mk({ id: 'CNS404', category: 'light', pos: { x: 6, y: 3 }, altitudeFt: 2500, headingDeg: 180, speedKt: 110 }, RCS_M2.light, LIGHT_ROUTE),
    mk({ id: 'CNS505', pos: { x: -30, y: -36 }, altitudeFt: 6000, headingDeg: 300, speedKt: 240 }, RCS_M2.medium, [{ x: -44, y: -6 }, { x: -26, y: 14 }, { x: -12, y: -18 }, { x: -30, y: -36 }]),
  ]
}

function garblePair(): [Partial<SsrAircraft>, SsrAircraft] {
  const route = { kind: 'route' as const, waypoints: GARBLE_ROUTE, index: 0, loop: true }
  const lead: Partial<SsrAircraft> = {
    pos: at(30, 0),
    headingDeg: 45,
    targetHeadingDeg: 45,
    altitudeFt: 8000,
    targetAltitudeFt: 8000,
    speedKt: 250,
    targetSpeedKt: 250,
    mode: route,
  }
  const trail = mk({ id: 'CNS606', pos: at(31, 0), altitudeFt: 9000, headingDeg: 45, speedKt: 250 }, RCS_M2.medium)
  return [lead, { ...trail, mode: route }]
}

// ---------------------------------------------------------------------------
// Plots and tracks
// ---------------------------------------------------------------------------

export interface ModeSData {
  address: number
  callsign: string
  /** BDS 4,0: altitude set on the autopilot, ft. */
  selectedAltFt: number
  /** BDS 5,0: true track and ground speed. */
  trackDeg: number
  groundSpeedKt: number
  /** BDS 6,0: vertical rate, ft/min. */
  verticalRateFpm: number
}

export interface Plot {
  timeS: number
  azDeg: number
  /** Measured slant range, NM (screens show slant range). */
  rangeNm: number
  pos: Vec2
  /** Mode A code, null when missing or garbled. */
  code: string | null
  /** Mode C altitude, null when missing or garbled. */
  altFt: number | null
  garbled: boolean
  spi: boolean
  hits: number
  /** A primary echo was found at the same place. */
  primary: boolean
  /** Secondary data present (false for a primary-only plot). */
  secondary: boolean
  modeS?: ModeSData
  /** Truth: which aircraft produced most of the replies (for the UI only). */
  sourceId?: string
}

export interface DisplayTrack {
  id: string
  key?: string
  pos: Vec2
  lastS: number
  history: Vec2[]
  vel: Vec2 | null
  plot: Plot
}

interface Run {
  rangeNm: number
  n: number
  firstK: number
  lastK: number
  azs: number[]
  codes: Map<string, number>
  alts: Map<number, number>
  aReplies: number
  cReplies: number
  garbled: number
  spi: boolean
  sources: Map<string, number>
}

interface PendingPrimary {
  timeS: number
  pos: Vec2
  sourceId: string
}

/** Per-aircraft statistics for the readouts (truth side). */
export interface ReplyStats {
  replies: number
  garbled: number
  suppressed: number
  sideLobeReplies: number
}

/** One aircraft's view of a single interrogation (for the slow-motion replay). */
export interface InterrogationHeard {
  id: string
  callsign: string
  slantNm: number
  offDeg: number
  p1Dbm: number
  p2Dbm: number | null
  decision: SlsDecision | 'too-weak' | 'no-p2' | 'off' | 'hidden'
  replies: boolean
  bits?: CodeBits
  spi: boolean
  /** Reply F1 arrival at the radar, µs after P3 left. */
  arrivalUs?: number
}

const emptyStats = (): ReplyStats => ({ replies: 0, garbled: 0, suppressed: 0, sideLobeReplies: 0 })

export class SsrEngine {
  readonly site = SITE
  params: SsrParams = { ...DEFAULT_SSR_PARAMS }
  env: SsrEnv = { ...DEFAULT_SSR_ENV }
  xpdr: Record<string, Transponder> = defaultTransponders()
  timeS = 0
  antennaAz = 0
  aircraft: SsrAircraft[] = createScenario()
  readonly terrain = terrainFn()
  /** Every interrogation so far; even = Mode A, odd = Mode C (A/C interlace). */
  interrogations = 0
  tracks = new Map<string, DisplayTrack>()
  /** Latest reply statistics per aircraft for the pass that just finished. */
  lastPass = new Map<string, ReplyStats>()
  private pass = new Map<string, ReplyStats>()
  private rand: () => number
  private nextInterrogationS = 0
  private pending: ScopePaint[] = []
  private runs: Run[] = []
  private recent: number[][] = []
  private primaries: PendingPrimary[] = []
  private trackCounter = 0
  private geo = new Map<string, { az: number; ground: number; slant: number; visible: boolean }>()
  private geoTime = -Infinity
  private modeS = new Map<string, { acquired: boolean; lastS: number }>()

  constructor(seed = 7) {
    this.rand = mulberry32(seed)
  }

  reset() {
    this.timeS = 0
    this.antennaAz = 0
    this.aircraft = createScenario()
    this.interrogations = 0
    this.nextInterrogationS = 0
    this.tracks.clear()
    this.lastPass.clear()
    this.pass.clear()
    this.pending = []
    this.runs = []
    this.recent = []
    this.primaries = []
    this.geoTime = -Infinity
    this.modeS.clear()
    if (this.env.garblePair) this.applyGarblePair(true)
  }

  get degPerSecond() {
    return 360 / this.params.rotationPeriodS
  }

  get beamWidthDeg() {
    return SSR_BEAM_WIDTH_DEG
  }

  getAircraft(id: string | null | undefined): SsrAircraft | undefined {
    return this.aircraft.find((a) => a.id === id)
  }

  setAircraft(id: string, patch: Partial<SsrAircraft>) {
    this.aircraft = this.aircraft.map((a) => (a.id === id ? { ...a, ...patch } : a))
    this.geoTime = -Infinity
  }

  transponder(id: string): Transponder {
    return this.xpdr[id] ?? { squawk: '2000', on: true, identAtS: null }
  }

  /** Is the SPI (ident) pulse being sent right now? */
  spiActive(id: string): boolean {
    const t = this.transponder(id)
    return t.identAtS != null && this.timeS >= t.identAtS && this.timeS - t.identAtS < SPI_DURATION_S
  }

  /** Put CNS303 and a new CNS606 in trail 1 NM apart on the 225° radial, or restore CNS303. */
  applyGarblePair(on: boolean) {
    this.aircraft = this.aircraft.filter((a) => a.id !== 'CNS606')
    if (on) {
      const [lead, trail] = garblePair()
      this.setAircraft('CNS303', lead)
      this.aircraft.push(trail)
    } else {
      this.setAircraft('CNS303', {
        pos: { x: 4, y: -44 },
        headingDeg: 350,
        targetHeadingDeg: 350,
        altitudeFt: 8000,
        targetAltitudeFt: 8000,
        speedKt: 250,
        targetSpeedKt: 250,
        mode: { kind: 'route', waypoints: CNS303_ROUTE, index: 0, loop: true },
      })
    }
    this.geoTime = -Infinity
  }

  /** Clear the screen state (after a change of interrogation mode). */
  clearDisplay() {
    this.tracks.clear()
    this.runs = []
    this.recent = []
    this.primaries = []
    this.modeS.clear()
  }

  takePaints(): ScopePaint[] {
    const p = this.pending
    this.pending = []
    return p
  }

  timeToAzimuth(azDeg: number): number {
    return normalize360(azDeg - this.antennaAz) / this.degPerSecond
  }

  /** Turn the antenna to `azDeg`, running the world for the time that takes. */
  advanceToAzimuth(azDeg: number) {
    let left = this.timeToAzimuth(azDeg)
    while (left > 1e-9) {
      const d = Math.min(0.02, left)
      this.step(d)
      left -= d
    }
    this.antennaAz = normalize360(azDeg)
  }

  /** Geometry of each aircraft seen from the radar (cached for a fraction of a second). */
  geometry(id: string) {
    this.refreshGeometry()
    return this.geo.get(id)
  }

  private refreshGeometry(force = false) {
    if (!force && this.timeS - this.geoTime < 0.2 && this.geo.size === this.aircraft.length) return
    this.geoTime = this.timeS
    this.geo.clear()
    for (const a of this.aircraft) {
      const ground = distanceNm(this.site.pos, a.pos)
      const slant = slantRangeNm(ground, a.altitudeFt, this.site.heightFt)
      const visible =
        ground <= radioLineOfSightNm(this.site.heightFt, a.altitudeFt) &&
        lineOfSight(this.site.pos, this.site.heightFt, a.pos, a.altitudeFt, this.terrain, 0.5).visible
      this.geo.set(a.id, { az: bearingDeg(this.site.pos, a.pos), ground, slant, visible })
    }
  }

  // -------------------------------------------------------------------------
  // Stepping
  // -------------------------------------------------------------------------

  step(dt: number) {
    if (dt <= 0) return
    const t0 = this.timeS
    this.aircraft = this.aircraft.map((a) => ({ ...stepAircraftFine(a, dt), rcsM2: a.rcsM2, address: a.address }))
    this.refreshGeometry(true)
    const from = this.antennaAz
    const span = this.degPerSecond * dt

    // Pass bookkeeping: snapshot each aircraft's statistics when the antenna points directly away.
    for (const a of this.aircraft) {
      const g = this.geo.get(a.id)!
      if (sweepCovers(g.az + 180, from, span)) {
        this.lastPass.set(a.id, this.pass.get(a.id) ?? emptyStats())
        this.pass.set(a.id, emptyStats())
      }
    }

    // Primary radar on the same turning antenna: one look per turn.
    const psr = { ...DEFAULT_RADAR, rotationPeriodS: this.params.rotationPeriodS }
    for (const a of this.aircraft) {
      const g = this.geo.get(a.id)!
      if (!sweepCovers(g.az, from, span)) continue
      const res = evaluateTarget(
        this.site,
        psr,
        { pos: a.pos, altitudeFt: a.altitudeFt, rcsM2: a.rcsM2, radialSpeedKt: radialSpeedKt(a, this.site.pos) },
        { terrain: this.terrain, mti: false },
        this.rand(),
      )
      if (res.detected && res.trace === 1) {
        const az = g.az + gaussian(this.rand) * psr.beamWidthDeg * 0.08
        const r = res.trueRangeNm + gaussian(this.rand) * 0.04
        this.primaries.push({ timeS: t0 + normalize360(g.az - from) / this.degPerSecond, pos: polar(this.site.pos, az, r), sourceId: a.id })
      }
    }

    if (this.params.mode === 'ac') {
      const pri = 1 / this.params.prfHz
      if (this.nextInterrogationS < t0) this.nextInterrogationS = t0
      while (this.nextInterrogationS <= t0 + dt) {
        const t = this.nextInterrogationS
        const az = normalize360(from + this.degPerSecond * (t - t0))
        this.interrogateAC(az)
        this.nextInterrogationS += pri
      }
    } else {
      for (const a of this.aircraft) {
        const g = this.geo.get(a.id)!
        if (sweepCovers(g.az, from, span)) this.rollCall(a, t0 + normalize360(g.az - from) / this.degPerSecond)
      }
    }

    this.timeS = t0 + dt
    this.antennaAz = normalize360(from + span)
    this.closeRuns(this.interrogations, false)
    // Primary echoes that no secondary plot claimed become primary-only plots.
    const keep: PendingPrimary[] = []
    for (const p of this.primaries) {
      if (this.timeS - p.timeS < 0.3) keep.push(p)
      else this.addPlot(primaryPlot(p, this.site.pos))
    }
    this.primaries = keep
    // Tracks that have not been updated for two turns disappear.
    for (const [id, tr] of this.tracks) if (this.timeS - tr.lastS > 2.2 * this.params.rotationPeriodS) this.tracks.delete(id)
  }

  // -------------------------------------------------------------------------
  // Mode A/C
  // -------------------------------------------------------------------------

  /** What every aircraft hears from one interrogation sent toward `azDeg`. */
  hearInterrogation(azDeg: number, mode: ModeAC, roll: () => number = this.rand): InterrogationHeard[] {
    this.refreshGeometry()
    const out: InterrogationHeard[] = []
    for (const a of this.aircraft) {
      const g = this.geo.get(a.id)!
      const x = this.transponder(a.id)
      const off = angleDiff(azDeg, g.az)
      const p1 = uplinkP1Dbm(g.slant, off)
      const p2 = this.env.noP2 ? null : uplinkP2Dbm(g.slant, off)
      const spi = this.spiActive(a.id)
      const base = { id: a.id, callsign: a.callsign, slantNm: g.slant, offDeg: off, p1Dbm: p1, p2Dbm: p2, spi }
      if (!x.on) {
        out.push({ ...base, decision: 'off', replies: false })
        continue
      }
      if (!g.visible) {
        out.push({ ...base, decision: 'hidden', replies: false })
        continue
      }
      const decision: InterrogationHeard['decision'] = p1 < TRANSPONDER_MTL_DBM ? 'too-weak' : p2 == null ? 'no-p2' : slsDecision(p1, p2)
      const heard: InterrogationHeard = { ...base, decision, replies: transponderReplies(p1, p2, roll()) }
      if (heard.replies) {
        heard.bits = mode === 'A' ? squawkToBits(x.squawk) : (encodeGillham(a.altitudeFt) ?? undefined)
        heard.arrivalUs = replyArrivalUs(g.slant)
        // The reply must also be strong enough when it gets back to the radar.
        if (!heard.bits || downlinkDbm(g.slant, off) < GROUND_RECEIVER_MTL_DBM) {
          heard.replies = false
          heard.decision = 'too-weak'
        }
      }
      out.push(heard)
    }
    return out
  }

  private interrogateAC(azDeg: number) {
    const mode: ModeAC = this.interrogations % 2 === 0 ? 'A' : 'C'
    const k = this.interrogations++
    const heard = this.hearInterrogation(azDeg, mode)
    const pulses: number[] = []
    const sources: { f1: number; id: string }[] = []
    const window = slsReplyHalfAngleDeg() * 1.6
    for (const h of heard) {
      const st = this.pass.get(h.id) ?? emptyStats()
      this.pass.set(h.id, st)
      if (h.decision === 'suppress' || (h.decision === 'maybe' && !h.replies)) {
        if (h.p1Dbm >= TRANSPONDER_MTL_DBM) st.suppressed++
      }
      if (!h.replies || !h.bits || h.arrivalUs == null) continue
      st.replies++
      if (Math.abs(h.offDeg) > window) st.sideLobeReplies++
      pulses.push(...replyPulseTimes(h.arrivalUs, h.bits, h.spi))
      sources.push({ f1: h.arrivalUs, id: h.id })
    }
    // FRUIT: replies to someone else's interrogations, arriving at random times.
    if (this.env.fruit) {
      const n = poisson(FRUIT_PER_S / this.params.prfHz, this.rand)
      for (let i = 0; i < n; i++) {
        const tUs = replyArrivalUs(this.rand() * LISTEN_RANGE_NM)
        const code = randomSquawk(this.rand)
        pulses.push(...replyPulseTimes(tUs, squawkToBits(code), false))
        sources.push({ f1: tUs, id: 'fruit' })
      }
    }
    const decoded = decodeReplyPulses(pulses)
    const ranges: number[] = []
    for (const d of decoded) {
      const rangeNm = rangeFromReplyUs(d.f1Us)
      if (rangeNm < 0 || rangeNm > LISTEN_RANGE_NM) continue
      ranges.push(rangeNm)
      const src = sources.find((s) => Math.abs(s.f1 - d.f1Us) < 0.1)?.id
      if (d.garbled && src && src !== 'fruit') {
        const st = this.pass.get(src)
        if (st) st.garbled++
      }
      // Defruiter: the same range must have replied on one of the last two interrogations.
      if (this.env.defruiter && !this.recent.some((rs) => rs.some((r) => Math.abs(r - rangeNm) < DEFRUIT_TOL_NM))) continue
      this.pending.push({ ...polar({ x: 0, y: 0 }, azDeg, rangeNm), strength: 0.55, kind: src === 'fruit' || !src ? 'false' : 'target', widthDeg: 0.35, depthNm: 0.2 })
      this.addToRun(k, azDeg, rangeNm, mode, d.bits, d.garbled, d.spi, src)
    }
    this.recent.unshift(ranges)
    if (this.recent.length > 2) this.recent.length = 2
    this.closeRuns(k, false)
  }

  private addToRun(k: number, az: number, rangeNm: number, mode: ModeAC, bits: CodeBits, garbled: boolean, spi: boolean, src?: string) {
    let run = this.runs.find((r) => Math.abs(r.rangeNm - rangeNm) < RUN_TOL_NM && k - r.lastK <= RUN_GAP)
    if (run && Math.abs(angleDiff(run.azs[0], az)) > MAX_RUN_DEG) {
      this.finishRun(run)
      this.runs = this.runs.filter((r) => r !== run)
      run = undefined
    }
    if (!run) {
      run = { rangeNm, n: 0, firstK: k, lastK: k, azs: [], codes: new Map(), alts: new Map(), aReplies: 0, cReplies: 0, garbled: 0, spi: false, sources: new Map() }
      this.runs.push(run)
    }
    run.rangeNm = (run.rangeNm * run.n + rangeNm) / (run.n + 1)
    run.n++
    run.lastK = k
    run.azs.push(az)
    if (spi) run.spi = true
    if (src) run.sources.set(src, (run.sources.get(src) ?? 0) + 1)
    if (garbled) run.garbled++
    if (mode === 'A') {
      run.aReplies++
      if (!garbled) inc(run.codes, bitsToSquawk(bits))
    } else {
      run.cReplies++
      const alt = garbled ? null : decodeGillham(bits)
      if (alt != null) inc(run.alts, alt)
    }
  }

  private closeRuns(k: number, all: boolean) {
    const open: Run[] = []
    for (const r of this.runs) {
      if (all || k - r.lastK > RUN_GAP) this.finishRun(r)
      else open.push(r)
    }
    this.runs = open
  }

  private finishRun(r: Run) {
    if (r.n < MIN_HITS) return
    const ref = r.azs[0]
    const az = normalize360(ref + r.azs.reduce((s, a) => s + angleDiff(ref, a), 0) / r.azs.length)
    const code = validated(r.codes)
    const altFt = validated(r.alts)
    const garbled = (r.aReplies > 0 && code == null) || (r.cReplies > 0 && altFt == null)
    let sourceId: string | undefined
    let best = 0
    for (const [id, n] of r.sources) if (n > best && id !== 'fruit') [sourceId, best] = [id, n]
    const pos = polar(this.site.pos, az, r.rangeNm)
    const plot: Plot = {
      timeS: this.timeS,
      azDeg: az,
      rangeNm: r.rangeNm,
      pos,
      code: code ?? null,
      altFt: altFt ?? null,
      garbled,
      spi: r.spi,
      hits: r.n,
      primary: this.claimPrimary(pos),
      secondary: true,
      sourceId,
    }
    this.addPlot(plot)
  }

  // -------------------------------------------------------------------------
  // Mode S
  // -------------------------------------------------------------------------

  /** Mode S: the beam reached this aircraft. Acquire it with an all-call, then ask it by address. */
  private rollCall(a: SsrAircraft, timeS: number) {
    const x = this.transponder(a.id)
    const g = this.geo.get(a.id)!
    let st = this.modeS.get(a.id)
    if (st && timeS - st.lastS > MODE_S_LOCKOUT_S) {
      // Not heard for longer than the lockout: the address is forgotten and must be acquired again.
      this.modeS.delete(a.id)
      st = undefined
    }
    if (!x.on || !g.visible || uplinkP1Dbm(g.slant, 0) < TRANSPONDER_MTL_DBM) return
    if (!st?.acquired) {
      // All-call: unacquired aircraft in the beam at similar range answer at the same time (64 µs DF11).
      const overlapNm = rangeFromRoundTripNm(modeSReplyUs(56))
      const half = slsReplyHalfAngleDeg()
      const rivals = this.aircraft.filter((b) => {
        if (b.id === a.id || !this.transponder(b.id).on || this.modeS.get(b.id)?.acquired) return false
        const gb = this.geo.get(b.id)!
        return gb.visible && Math.abs(angleDiff(g.az, gb.az)) < 2 * half && Math.abs(gb.slant - g.slant) < overlapNm
      })
      let ok = rivals.length === 0
      // Stochastic acknowledgement: each replies to about half of the next all-calls until one gets through alone.
      // TODO(expert-review): all-call acquisition with stochastic replies (probability 0.5, 3 all-calls per beam pass).
      for (let i = 0; !ok && i < 3; i++) {
        const mine = this.rand() < 0.5
        const others = rivals.some(() => this.rand() < 0.5)
        ok = mine && !others
      }
      if (!ok) return
    }
    this.modeS.set(a.id, { acquired: true, lastS: timeS })
    const pass = this.pass.get(a.id) ?? emptyStats()
    pass.replies += 2
    this.pass.set(a.id, pass)
    const az = g.az + gaussian(this.rand) * MONOPULSE_SIGMA_AZ_DEG
    const r = g.slant + gaussian(this.rand) * SSR_SIGMA_RANGE_NM
    const pos = polar(this.site.pos, az, r)
    for (let i = 0; i < 2; i++) this.pending.push({ ...polar({ x: 0, y: 0 }, az + (i - 0.5) * 0.2, r), strength: 0.6, kind: 'target', widthDeg: 0.35, depthNm: 0.2 })
    const plot: Plot = {
      timeS,
      azDeg: az,
      rangeNm: r,
      pos,
      code: x.squawk,
      altFt: Math.round(a.altitudeFt / 25) * 25,
      garbled: false,
      spi: this.spiActive(a.id),
      hits: 2,
      primary: this.claimPrimary(pos),
      secondary: true,
      modeS: {
        address: a.address,
        callsign: a.callsign,
        selectedAltFt: Math.round(a.targetAltitudeFt / 100) * 100,
        trackDeg: a.headingDeg,
        groundSpeedKt: a.speedKt,
        verticalRateFpm: a.verticalSpeedFpm,
      },
      sourceId: a.id,
    }
    this.addPlot(plot)
  }

  /** Is this aircraft acquired by Mode S (its address is known)? */
  isAcquired(id: string): boolean {
    const s = this.modeS.get(id)
    return Boolean(s?.acquired && this.timeS - s.lastS <= MODE_S_LOCKOUT_S)
  }

  // -------------------------------------------------------------------------
  // Plot combination and tracks
  // -------------------------------------------------------------------------

  private claimPrimary(pos: Vec2): boolean {
    let best = -1
    let bd = 1
    this.primaries.forEach((p, i) => {
      const d = distanceNm(p.pos, pos)
      if (d < bd) {
        bd = d
        best = i
      }
    })
    if (best < 0) return false
    this.primaries.splice(best, 1)
    return true
  }

  private addPlot(plot: Plot) {
    const key = plot.modeS ? `S${plot.modeS.address}` : undefined
    let track: DisplayTrack | undefined
    if (key) track = [...this.tracks.values()].find((t) => t.key === key)
    if (!track) {
      let bd = 1.2
      for (const t of this.tracks.values()) {
        if (key && t.key && t.key !== key) continue
        // One plot per track per turn.
        if (plot.timeS - t.lastS < 0.5 * this.params.rotationPeriodS) continue
        const dtS = plot.timeS - t.lastS
        const pred = t.vel ? { x: t.pos.x + t.vel.x * dtS, y: t.pos.y + t.vel.y * dtS } : t.pos
        const d = distanceNm(pred, plot.pos)
        if (d < bd) {
          bd = d
          track = t
        }
      }
    }
    if (!track) {
      const id = `T${++this.trackCounter}`
      track = { id, key, pos: plot.pos, lastS: plot.timeS, history: [], vel: null, plot }
      this.tracks.set(id, track)
      return
    }
    const dtS = plot.timeS - track.lastS
    if (dtS > 0.5) track.vel = { x: (plot.pos.x - track.pos.x) / dtS, y: (plot.pos.y - track.pos.y) / dtS }
    track.history = [...track.history, track.pos].slice(-5)
    track.pos = plot.pos
    track.lastS = plot.timeS
    track.plot = plot
    if (key) track.key = key
  }

  /** The display track nearest to where an aircraft really is (for the UI selection highlight). */
  trackFor(id: string | null | undefined): DisplayTrack | undefined {
    const a = this.getAircraft(id)
    if (!a) return undefined
    const g = this.geometry(a.id)!
    const p = polar(this.site.pos, g.az, g.slant)
    let best: DisplayTrack | undefined
    let bd = 1.5
    for (const t of this.tracks.values()) {
      if (t.plot.sourceId && t.plot.sourceId !== id) continue
      const d = distanceNm(t.pos, p)
      if (d < bd) {
        bd = d
        best = t
      }
    }
    return best
  }

  /** The aircraft nearest a map point (within 3 NM). */
  nearestAircraft(p: Vec2): SsrAircraft | null {
    let best: SsrAircraft | null = null
    let bd = 3
    for (const a of this.aircraft) {
      const d = distanceNm(a.pos, p)
      if (d < bd) {
        bd = d
        best = a
      }
    }
    return best
  }
}

function polar(origin: Vec2, azDeg: number, r: number): Vec2 {
  const a = (azDeg * Math.PI) / 180
  return { x: origin.x + Math.sin(a) * r, y: origin.y + Math.cos(a) * r }
}

function inc<K>(m: Map<K, number>, k: K) {
  m.set(k, (m.get(k) ?? 0) + 1)
}

/** The most frequent value, if it was seen at least twice (code validation). */
function validated<K>(m: Map<K, number>): K | undefined {
  let best: K | undefined
  let n = 1
  for (const [k, c] of m) if (c > n) [best, n] = [k, c]
  return best
}

function primaryPlot(p: PendingPrimary, site: Vec2): Plot {
  return {
    timeS: p.timeS,
    azDeg: bearingDeg(site, p.pos),
    rangeNm: distanceNm(site, p.pos),
    pos: p.pos,
    code: null,
    altFt: null,
    garbled: false,
    spi: false,
    hits: 1,
    primary: true,
    secondary: false,
    sourceId: p.sourceId,
  }
}

function poisson(lambda: number, rand: () => number): number {
  const L = Math.exp(-lambda)
  let k = 0
  let p = 1
  do {
    k++
    p *= rand()
  } while (p > L)
  return k - 1
}

function randomSquawk(rand: () => number): string {
  let s = ''
  for (let i = 0; i < 4; i++) s += String(Math.floor(rand() * 8))
  return s
}

/** Label lines for a display track, as a controller's screen would show them. */
export function trackLabel(plot: Plot): string[] {
  if (!plot.secondary) return []
  const lines: string[] = []
  const special = plot.code ? specialCode(plot.code) : null
  if (plot.modeS) lines.push(plot.modeS.callsign)
  else lines.push(plot.code ?? '????')
  const fl = plot.altFt != null ? String(Math.round(plot.altFt / 100)).padStart(3, '0') : '---'
  let trend = ''
  if (plot.modeS) trend = plot.modeS.verticalRateFpm > 300 ? ' ↑' : plot.modeS.verticalRateFpm < -300 ? ' ↓' : ''
  lines.push(`${fl}${trend}${plot.spi ? ' ID' : ''}`)
  if (plot.garbled) lines.push('GARBLED')
  if (special) lines.push(special.tag)
  return lines
}

export function trackEmphasis(plot: Plot): 'normal' | 'warning' | 'alert' | 'dim' {
  const special = plot.code ? specialCode(plot.code) : null
  if (special?.kind === 'emergency' || special?.kind === 'hijack') return 'alert'
  if (special?.kind === 'radio' || plot.garbled) return 'warning'
  if (!plot.secondary) return 'dim'
  return 'normal'
}

/** Which squawk code and Mode C bits an aircraft is sending right now (for the reply builder). */
export function currentReplyBits(e: SsrEngine, id: string): { a: CodeBits | null; c: CodeBits | null; spi: boolean } {
  const ac = e.getAircraft(id)
  const x = e.transponder(id)
  if (!ac) return { a: null, c: null, spi: false }
  return { a: squawkToBits(x.squawk), c: encodeGillham(ac.altitudeFt), spi: e.spiActive(id) }
}

export { P1_P3_US }
