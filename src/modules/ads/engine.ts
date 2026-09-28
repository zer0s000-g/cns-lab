/**
 * ADS-B scenario engine (near the airport). Each aircraft works out its own
 * position with GNSS and broadcasts real 112-bit DF17 messages about twice a
 * second. Ground receivers (and the selected aircraft's ADS-B In receiver)
 * hear them only in radio line of sight and decode the CPR positions back.
 * A Mode S radar on the airport measures the same aircraft independently.
 *
 * Uses only pure functions from src/core.
 */

import {
  airbornePositionMe,
  broadcastIntervalS,
  cprDecodeGlobal,
  cprDecodeLocal,
  decodeEs,
  df17,
  gaussMarkovStep,
  IDENT_INTERVAL_S,
  identificationMe,
  jammingLevel,
  MSSR_ACCURACY,
  nacpInfo,
  noPositionMe,
  POSITION_INTERVAL_S,
  qualityUnderJamming,
  radarMeasure,
  sigmaNmForEpuM,
  VELOCITY_INTERVAL_S,
  velocityComponents,
  velocityMe,
  type CprPosition,
  type DecodedEs,
  type EmitterCategory,
  type Jammer,
} from '@/core/ads'
import { bearingDeg, distanceNm, latLonToLocal, localToLatLon, normalize360, sweepCovers, type LatLon, type Vec2 } from '@/core/geometry'
import { lineOfSight, radioLineOfSightNm, type TerrainFn } from '@/core/propagation'
import { gaussian, mulberry32 } from '@/core/random'
import { bitsToHex } from '@/core/ssr'
import { createAircraft, LAB_AIRPORT, stepAircraftFine, terrainElevationFt, terrainFn, type Aircraft } from '@/core/world'

// ---------------------------------------------------------------------------
// Messages and trackers
// ---------------------------------------------------------------------------

export type AdsbKind = 'position' | 'no-position' | 'velocity' | 'identification'

export interface AdsbMessage {
  seq: number
  timeS: number
  kind: AdsbKind
  /** Which transmitter sent it (aircraft id, or the spoofer). */
  from: string
  /** Where the radio transmitter really is (for a spoofer this is NOT the position in the message). */
  txPos: Vec2
  txAltFt: number
  hex: string
  decoded: DecodedEs
  /** NACp is sent in a separate status message; it is carried here for the display. */
  nacp: number
  /** Ground receivers that heard it. */
  heardBy: string[]
}

export interface AdsbTrack {
  address: number
  callsign?: string
  pos?: Vec2
  latLon?: LatLon
  /** When the position was last updated, s. */
  posS: number
  /** Last message of any kind, s. */
  lastS: number
  altFt?: number | null
  gsKt?: number
  trackDeg?: number
  vrFpm?: number
  nic: number
  nacp: number
  noPosition: boolean
  even?: { cpr: CprPosition; t: number }
  odd?: { cpr: CprPosition; t: number }
  history: { t: number; p: Vec2 }[]
}

// TODO(expert-review): ADS-B track coast (3 s) and drop (15 s) times, and the 10 s even/odd pairing window.
export const ADSB_COAST_S = 3
export const ADSB_DROP_S = 15
const CPR_PAIR_S = 10

/** Turns received messages into tracks, as a ground station (or an ADS-B In receiver) does. */
export class AdsbTracker {
  tracks = new Map<number, AdsbTrack>()
  readonly ref: LatLon
  constructor(ref: LatLon) {
    this.ref = ref
  }

  clear() {
    this.tracks.clear()
  }

  ingest(m: AdsbMessage, t: number) {
    const d = m.decoded
    if (!d.crcOk || d.df !== 17) return
    let tr = this.tracks.get(d.address)
    if (!tr) {
      tr = { address: d.address, posS: -Infinity, lastS: t, nic: 0, nacp: 0, noPosition: false, history: [] }
      this.tracks.set(d.address, tr)
    }
    tr.lastS = t
    switch (d.kind) {
      case 'identification':
        tr.callsign = d.callsign
        return
      case 'velocity':
        tr.gsKt = d.groundSpeedKt
        tr.trackDeg = d.trackDeg
        tr.vrFpm = d.verticalRateFpm
        return
      case 'no-position':
        tr.altFt = d.altitudeFt
        tr.nic = 0
        tr.nacp = 0
        tr.noPosition = true
        return
      case 'position': {
        const cpr = d.cpr!
        tr.altFt = d.altitudeFt
        tr.nic = d.nic ?? 0
        tr.nacp = m.nacp
        tr.noPosition = false
        if (cpr.odd) tr.odd = { cpr, t }
        else tr.even = { cpr, t }
        let ll: LatLon | null = null
        if (tr.latLon && t - tr.posS < CPR_PAIR_S) ll = cprDecodeLocal(tr.latLon, cpr)
        else if (tr.even && tr.odd && Math.abs(tr.even.t - tr.odd.t) < CPR_PAIR_S) ll = cprDecodeGlobal(tr.even.cpr, tr.odd.cpr, cpr.odd ? 'odd' : 'even')
        if (!ll) return
        tr.latLon = ll
        tr.pos = latLonToLocal(ll, this.ref)
        tr.posS = t
        tr.history.push({ t, p: tr.pos })
        if (tr.history.length > 240) tr.history.splice(0, tr.history.length - 240)
      }
    }
  }

  /** Forget tracks that have been silent too long. */
  prune(t: number) {
    for (const [k, tr] of this.tracks) if (t - tr.lastS > ADSB_DROP_S) this.tracks.delete(k)
  }
}

export type AdsbTrackState = 'live' | 'coast' | 'no-position'

export function trackState(tr: AdsbTrack, t: number): AdsbTrackState {
  if (!tr.pos) return 'no-position'
  if (tr.noPosition && t - tr.posS > ADSB_COAST_S) return 'no-position'
  return t - tr.posS > ADSB_COAST_S ? 'coast' : 'live'
}

// ---------------------------------------------------------------------------
// Aircraft with an ADS-B Out transmitter
// ---------------------------------------------------------------------------

export interface GnssState {
  nacp: number
  nic: number
  lost: boolean
  /** Position error being broadcast right now, NM (x east, y north). */
  err: Vec2
  /** When the receiver will have a fix again after jamming ends, s. */
  reacquireAtS: number | null
}

export interface AdsAircraft extends Aircraft {
  address: number
  emitter: EmitterCategory
  gnss: GnssState
  nextPosS: number
  nextVelS: number
  nextIdS: number
  odd: boolean
}

export interface GroundReceiver {
  id: string
  name: string
  pos: Vec2
  heightFt: number
}

export function makeTransmitter(init: Parameters<typeof createAircraft>[0], address: number, rand: () => number): AdsAircraft {
  const a = createAircraft(init)
  return {
    ...a,
    address,
    emitter: a.category,
    gnss: { nacp: 10, nic: 8, lost: false, err: { x: 0, y: 0 }, reacquireAtS: null },
    nextPosS: rand() * 0.5,
    nextVelS: rand() * 0.5,
    nextIdS: rand() * 5,
    odd: rand() < 0.5,
  }
}

/** Base GNSS quality of a healthy ADS-B installation. */
// TODO(expert-review): typical NACp 10 / NIC 8 for GNSS with SBAS; "low quality" NACp 6 / NIC 5.
export const GOOD_GNSS = { nacp: 10, nic: 8 }
export const POOR_GNSS = { nacp: 6, nic: 5 }
/** Real errors are usually well inside the NACp bound: we use 60% of it as the 95% error. */
// TODO(expert-review): actual GNSS error relative to the NACp bound, and the error correlation time (20 s good, 2 s poor).
const ERROR_FRACTION_OF_BOUND = 0.6
/** After jamming stops, a receiver needs a while to get a fix again. */
// TODO(expert-review): GNSS reacquisition time after jamming (20 s here).
export const REACQUIRE_S = 20

/** Update an aircraft's GNSS state for this step. */
export function updateGnss(g: GnssState, base: { nacp: number; nic: number }, jam: number, t: number, dt: number, gauss: () => number): GnssState {
  const q = qualityUnderJamming(base, jam)
  let lost = g.lost
  let reacquireAtS = g.reacquireAtS
  if (q.lost) {
    lost = true
    reacquireAtS = null
  } else if (lost) {
    if (reacquireAtS == null) reacquireAtS = t + REACQUIRE_S
    if (t >= reacquireAtS) {
      lost = false
      reacquireAtS = null
    }
  }
  if (lost) return { nacp: 0, nic: 0, lost: true, err: { x: 0, y: 0 }, reacquireAtS }
  const bound = nacpInfo(q.nacp).boundM ?? 1852
  const sigma = sigmaNmForEpuM(bound * ERROR_FRACTION_OF_BOUND)
  const tau = q.nacp >= 9 ? 20 : 2
  return { nacp: q.nacp, nic: q.nic, lost: false, err: gaussMarkovStep(g.err, dt, sigma, tau, gauss), reacquireAtS }
}

/**
 * The DF17 messages an aircraft broadcasts between t0 and t0 + dt. Positions
 * are interpolated inside the step so each message carries the position at
 * its own time.
 */
export function broadcasts(
  prev: AdsAircraft,
  cur: AdsAircraft,
  t0: number,
  dt: number,
  ref: LatLon,
  rand: () => number,
): { messages: Omit<AdsbMessage, 'seq' | 'heardBy' | 'txPos' | 'txAltFt' | 'from'>[]; next: Pick<AdsAircraft, 'nextPosS' | 'nextVelS' | 'nextIdS' | 'odd'> } {
  const out: Omit<AdsbMessage, 'seq' | 'heardBy' | 'txPos' | 'txAltFt' | 'from'>[] = []
  let { nextPosS, nextVelS, nextIdS, odd } = cur
  const t1 = t0 + dt
  const at = (t: number): Vec2 => {
    const f = dt > 0 ? (t - t0) / dt : 1
    return { x: prev.pos.x + (cur.pos.x - prev.pos.x) * f, y: prev.pos.y + (cur.pos.y - prev.pos.y) * f }
  }
  const g = cur.gnss
  const push = (t: number, kind: AdsbKind, me: number[]) => {
    const bits = df17(cur.address, me)
    out.push({ timeS: t, kind, hex: bitsToHex(bits), decoded: decodeEs(bits), nacp: g.nacp })
  }
  while (nextPosS <= t1) {
    const t = Math.max(nextPosS, t0)
    if (g.lost) push(t, 'no-position', noPositionMe(cur.altitudeFt))
    else {
      const p = at(t)
      const reported = localToLatLon({ x: p.x + g.err.x, y: p.y + g.err.y }, ref)
      push(t, 'position', airbornePositionMe({ nic: g.nic, altitudeFt: cur.altitudeFt, pos: reported, odd }))
      odd = !odd
    }
    nextPosS = t + broadcastIntervalS(POSITION_INTERVAL_S, rand())
  }
  while (nextVelS <= t1) {
    const t = Math.max(nextVelS, t0)
    // Velocity comes from GNSS too: none while the fix is lost.
    if (!g.lost) push(t, 'velocity', velocityMe({ ...velocityComponents(cur.speedKt, cur.headingDeg), verticalRateFpm: cur.verticalSpeedFpm }))
    nextVelS = t + broadcastIntervalS(VELOCITY_INTERVAL_S, rand())
  }
  while (nextIdS <= t1) {
    const t = Math.max(nextIdS, t0)
    push(t, 'identification', identificationMe(cur.callsign, cur.emitter))
    nextIdS = t + broadcastIntervalS(IDENT_INTERVAL_S, rand())
  }
  out.sort((a, b) => a.timeS - b.timeS)
  return { messages: out, next: { nextPosS, nextVelS, nextIdS, odd } }
}

/** Radio line of sight between two points (heights above mean sea level), including terrain. */
export function radioSees(a: Vec2, ha: number, b: Vec2, hb: number, terrain: TerrainFn, maxNm = Infinity): boolean {
  const d = distanceNm(a, b)
  if (d > maxNm || d > radioLineOfSightNm(ha, hb)) return false
  return lineOfSight(a, ha, b, hb, terrain, Math.max(0.5, d / 100)).visible
}

// ---------------------------------------------------------------------------
// The airport scenario
// ---------------------------------------------------------------------------

export interface AdsEnv {
  /** A GNSS jammer on the ground south-west of the airport. */
  jamming: boolean
  /** A spoofer on the ground broadcasting a fake aircraft. */
  ghost: boolean
  /** CNS404 flies without ADS-B Out. */
  noAdsb: boolean
  /** CNS101's GNSS gives a poor position (low NACp). */
  lowQuality: boolean
}

export const DEFAULT_ADS_ENV: AdsEnv = { jamming: false, ghost: false, noAdsb: false, lowQuality: false }

const terrain = terrainFn()
const onGround = (p: Vec2, mastFt: number) => terrainElevationFt(p) + mastFt

export const RECEIVERS: GroundReceiver[] = [
  { id: 'airport', name: 'Airport receiver', pos: { x: 0, y: 0 }, heightFt: onGround({ x: 0, y: 0 }, 100) },
  { id: 'ridge', name: 'South Ridge receiver', pos: { x: 6, y: -34 }, heightFt: onGround({ x: 6, y: -34 }, 50) },
  { id: 'coast', name: 'North Coast receiver', pos: { x: 36, y: 26 }, heightFt: onGround({ x: 36, y: 26 }, 50) },
]

export const RADAR_SITE = { pos: { x: 0, y: 0 }, heightFt: 90 }
/** The comparison radar (Mode S secondary radar) sees this far. */
// TODO(expert-review): 200 NM instrumented range for the comparison radar.
export const RADAR_RANGE_NM = 200

// TODO(expert-review): jammer footprint (lost within 13 NM, degraded to 28 NM) is illustrative; real jammers can reach much further.
export const JAMMER: Jammer = { pos: { x: -20, y: -24 }, heightFt: onGround({ x: -20, y: -24 }, 30), degradeRadiusNm: 28, denyRadiusNm: 13 }
export const SPOOFER = { pos: { x: 10, y: 8 }, heightFt: onGround({ x: 10, y: 8 }, 30) }
export const GHOST_ID = 'CNS777'
/** Air-to-air ADS-B In range used for the cockpit display. */
// TODO(expert-review): practical air-to-air 1090ES reception range (about 100 NM here).
export const AIR_RX_RANGE_NM = 100

export const LOW_QUALITY_ID = 'CNS101'
export const NO_ADSB_ID = 'CNS404'

const ADDRESSES: Record<string, number> = {
  CNS101: 0x8a01a1,
  CNS202: 0x8a02b2,
  CNS303: 0x8a03c3,
  CNS404: 0x8a04d4,
  CNS505: 0x8a05e5,
  CNS777: 0x8a7777,
}

function route(a: AdsAircraft, waypoints: Vec2[]): AdsAircraft {
  return { ...a, mode: { kind: 'route', waypoints, index: 0, loop: true } }
}

export function createAirportScenario(rand: () => number): AdsAircraft[] {
  const mk = (i: Parameters<typeof createAircraft>[0]) => makeTransmitter(i, ADDRESSES[i.id], rand)
  return [
    route(mk({ id: 'CNS101', pos: { x: 10, y: 30 }, altitudeFt: 12000, headingDeg: 90, speedKt: 280 }), [{ x: 36, y: 30 }, { x: 36, y: 8 }, { x: 10, y: 8 }, { x: 10, y: 30 }]),
    route(mk({ id: 'CNS202', category: 'heavy', pos: { x: -45, y: -42 }, altitudeFt: 35000, headingDeg: 90, speedKt: 460 }), [{ x: 48, y: -42 }, { x: 48, y: 44 }, { x: -45, y: 44 }, { x: -45, y: -42 }]),
    route(mk({ id: 'CNS303', pos: { x: 4, y: -44 }, altitudeFt: 8000, headingDeg: 350, speedKt: 250 }), [{ x: 0, y: -14 }, { x: -12, y: -6 }, { x: -22, y: -26 }, { x: 4, y: -44 }]),
    route(mk({ id: 'CNS404', category: 'light', pos: { x: 12, y: -10 }, altitudeFt: 2500, headingDeg: 45, speedKt: 110 }), [{ x: 19, y: -3 }, { x: 12, y: 5 }, { x: 5, y: -3 }, { x: 12, y: -10 }]),
    route(mk({ id: 'CNS505', pos: { x: -30, y: -36 }, altitudeFt: 6000, headingDeg: 300, speedKt: 240 }), [{ x: -44, y: -6 }, { x: -26, y: 14 }, { x: -12, y: -18 }, { x: -30, y: -36 }]),
  ]
}

function createGhost(rand: () => number): AdsAircraft {
  const g = makeTransmitter({ id: GHOST_ID, pos: { x: 27, y: -14 }, altitudeFt: 18000, headingDeg: 90, speedKt: 300 }, ADDRESSES[GHOST_ID], rand)
  return { ...g, mode: { kind: 'orbit', center: { x: 27, y: -20 }, radiusNm: 6, clockwise: true } }
}

export interface RadarPlot {
  t: number
  pos: Vec2
  address: number
  callsign: string
  altFt: number
}

export interface Ring {
  t: number
  pos: Vec2
  from: string
}

export type CrossCheck = 'confirmed' | 'unconfirmed' | 'no-coverage'

export class AdsbEngine {
  readonly ref = LAB_AIRPORT.ref
  readonly receivers = RECEIVERS
  readonly terrain = terrain
  env: AdsEnv = { ...DEFAULT_ADS_ENV }
  radarPeriodS = 4.8
  timeS = 0
  radarAz = 0
  aircraft: AdsAircraft[]
  ghost: AdsAircraft
  /** Ground network: every receiver feeds one tracker. */
  atc = new AdsbTracker(LAB_AIRPORT.ref)
  /** ADS-B In on board the own-ship aircraft. */
  air = new AdsbTracker(LAB_AIRPORT.ref)
  ownId: string | null = 'CNS101'
  radarPlots = new Map<number, RadarPlot[]>()
  /** Recent messages per transmitter, newest last. */
  messages = new Map<string, AdsbMessage[]>()
  rings: Ring[] = []
  truth = new Map<string, { t: number; p: Vec2 }[]>()
  private rand: () => number
  private gauss: () => number
  private seq = 0
  private losCache = new Map<string, { t: number; v: boolean }>()
  private trailNext = 0

  constructor(seed = 11) {
    this.rand = mulberry32(seed)
    this.gauss = () => gaussian(this.rand)
    this.aircraft = createAirportScenario(this.rand)
    this.ghost = createGhost(this.rand)
  }

  reset() {
    this.timeS = 0
    this.radarAz = 0
    this.aircraft = createAirportScenario(this.rand)
    this.ghost = createGhost(this.rand)
    this.atc.clear()
    this.air.clear()
    this.radarPlots.clear()
    this.messages.clear()
    this.rings = []
    this.truth.clear()
    this.losCache.clear()
    this.trailNext = 0
  }

  getAircraft(id: string | null | undefined): AdsAircraft | undefined {
    return this.aircraft.find((a) => a.id === id)
  }

  setAircraft(id: string, patch: Partial<AdsAircraft>) {
    this.aircraft = this.aircraft.map((a) => (a.id === id ? { ...a, ...patch } : a))
    this.losCache.clear()
  }

  /** Does this aircraft have a working ADS-B Out transmitter? */
  hasAdsbOut(id: string): boolean {
    return !(this.env.noAdsb && id === NO_ADSB_ID)
  }

  baseQuality(id: string) {
    return this.env.lowQuality && id === LOW_QUALITY_ID ? POOR_GNSS : GOOD_GNSS
  }

  /** Line of sight with a small cache (terrain checks are not free). */
  private sees(key: string, a: Vec2, ha: number, b: Vec2, hb: number, maxNm = Infinity): boolean {
    const c = this.losCache.get(key)
    if (c && this.timeS - c.t < 0.5) return c.v
    const v = radioSees(a, ha, b, hb, this.terrain, maxNm)
    this.losCache.set(key, { t: this.timeS, v })
    return v
  }

  jamLevel(a: Aircraft): number {
    if (!this.env.jamming) return 0
    const d = distanceNm(JAMMER.pos, a.pos)
    if (d >= JAMMER.degradeRadiusNm) return 0
    return jammingLevel(d, this.sees(`jam:${a.id}`, JAMMER.pos, JAMMER.heightFt, a.pos, a.altitudeFt), JAMMER)
  }

  /** Receivers that hear a transmitter at `p`, `alt`. */
  groundHears(key: string, p: Vec2, alt: number): string[] {
    return this.receivers.filter((r) => this.sees(`${key}>${r.id}`, r.pos, r.heightFt, p, alt)).map((r) => r.id)
  }

  radarSees(a: Aircraft): boolean {
    return this.sees(`radar:${a.id}`, RADAR_SITE.pos, RADAR_SITE.heightFt, a.pos, a.altitudeFt, RADAR_RANGE_NM)
  }

  step(dt: number) {
    if (dt <= 0) return
    const t0 = this.timeS
    const t1 = t0 + dt
    const prev = new Map(this.aircraft.map((a) => [a.id, a]))
    const prevGhost = this.ghost
    this.aircraft = this.aircraft.map((a) => {
      const moved = stepAircraftFine(a, dt)
      return { ...a, ...moved, gnss: updateGnss(a.gnss, this.baseQuality(a.id), this.jamLevel(moved), t1, dt, this.gauss) }
    })
    if (this.env.ghost) this.ghost = { ...this.ghost, ...stepAircraftFine(this.ghost, dt) }

    // Broadcasts.
    const own = this.getAircraft(this.ownId)
    const ownGnss = own?.gnss
    if (own && this.airOwnKey !== own.id) {
      this.air.clear()
      this.airOwnKey = own.id
    }
    const txs: { a: AdsAircraft; p: AdsAircraft; txPos: () => Vec2; txAlt: number; from: string }[] = []
    for (const a of this.aircraft) if (this.hasAdsbOut(a.id)) txs.push({ a, p: prev.get(a.id) ?? a, txPos: () => a.pos, txAlt: a.altitudeFt, from: a.id })
    if (this.env.ghost) txs.push({ a: this.ghost, p: prevGhost, txPos: () => SPOOFER.pos, txAlt: SPOOFER.heightFt, from: 'spoofer' })
    const all: AdsbMessage[] = []
    for (const tx of txs) {
      const { messages, next } = broadcasts(tx.p, tx.a, t0, dt, this.ref, this.rand)
      if (tx.a === this.ghost) this.ghost = { ...this.ghost, ...next }
      else this.aircraft = this.aircraft.map((x) => (x.id === tx.a.id ? { ...x, ...next } : x))
      const pos = tx.txPos()
      const heardBy = messages.length ? this.groundHears(tx.from, pos, tx.txAlt) : []
      for (const m of messages) all.push({ ...m, seq: ++this.seq, from: tx.from, txPos: pos, txAltFt: tx.txAlt, heardBy })
    }
    all.sort((a, b) => a.timeS - b.timeS)
    for (const m of all) {
      const list = this.messages.get(m.from) ?? []
      list.push(m)
      if (list.length > 16) list.splice(0, list.length - 16)
      this.messages.set(m.from, list)
      if (m.kind === 'position' || m.kind === 'no-position') this.rings.push({ t: m.timeS, pos: m.txPos, from: m.from })
      if (m.heardBy.length) this.atc.ingest(m, m.timeS)
      // ADS-B In on the own ship.
      if (own && m.from !== own.id && ownGnss && this.sees(`air:${m.from}>${own.id}`, m.txPos, m.txAltFt, own.pos, own.altitudeFt, AIR_RX_RANGE_NM)) this.air.ingest(m, m.timeS)
    }
    this.rings = this.rings.filter((r) => t1 - r.t < 1.6)
    this.atc.prune(t1)
    this.air.prune(t1)

    // The radar: one plot per antenna turn for every aircraft it can see.
    const span = (360 / this.radarPeriodS) * dt
    for (const a of this.aircraft) {
      const az = bearingDeg(RADAR_SITE.pos, a.pos)
      if (!sweepCovers(az, this.radarAz, span) || !this.radarSees(a)) continue
      const list = this.radarPlots.get(a.address) ?? []
      list.push({ t: t0 + normalize360(az - this.radarAz) / (360 / this.radarPeriodS), pos: radarMeasure(RADAR_SITE.pos, a.pos, MSSR_ACCURACY, this.gauss), address: a.address, callsign: a.callsign, altFt: Math.round(a.altitudeFt / 25) * 25 })
      if (list.length > 30) list.splice(0, list.length - 30)
      this.radarPlots.set(a.address, list)
    }
    this.radarAz = normalize360(this.radarAz + span)
    for (const [k, list] of this.radarPlots) if (!list.length || t1 - list[list.length - 1].t > 2.2 * this.radarPeriodS) this.radarPlots.delete(k)

    // Truth trail every 0.5 s (for the comparison views).
    if (t1 >= this.trailNext) {
      for (const a of this.aircraft) {
        const tr = this.truth.get(a.id) ?? []
        tr.push({ t: t1, p: a.pos })
        if (tr.length > 300) tr.splice(0, tr.length - 300)
        this.truth.set(a.id, tr)
      }
      this.trailNext = t1 + 0.5
    }
    this.timeS = t1
  }

  private airOwnKey: string | null = null

  /** Latest radar plot for an address. */
  lastRadar(address: number): RadarPlot | undefined {
    const l = this.radarPlots.get(address)
    return l?.[l.length - 1]
  }

  /**
   * Is an ADS-B track backed up by the radar? A real aircraft in radar cover
   * has a radar plot with the same address close by; a spoofed one does not.
   */
  crossCheck(tr: AdsbTrack): CrossCheck {
    if (!tr.pos || tr.altFt == null) return 'no-coverage'
    if (!radioSees(RADAR_SITE.pos, RADAR_SITE.heightFt, tr.pos, tr.altFt, this.terrain, RADAR_RANGE_NM)) return 'no-coverage'
    const r = this.lastRadar(tr.address)
    const fresh = r && this.timeS - r.t <= 1.5 * this.radarPeriodS
    if (fresh && distanceNm(r.pos, tr.pos) < 1.5) return 'confirmed'
    // Give a new track one full turn of the antenna before judging it.
    const firstSeen = tr.history[0]?.t ?? this.timeS
    return this.timeS - firstSeen < 1.5 * this.radarPeriodS ? 'confirmed' : 'unconfirmed'
  }

  /** The aircraft (or the ghost) behind an address. */
  byAddress(address: number): AdsAircraft | undefined {
    if (address === this.ghost.address) return this.ghost
    return this.aircraft.find((a) => a.address === address)
  }

  nearestAircraft(p: Vec2): AdsAircraft | null {
    let best: AdsAircraft | null = null
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
