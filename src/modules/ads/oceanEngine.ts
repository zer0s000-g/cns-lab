/**
 * Ocean-crossing scenario: an airliner leaves the coverage of the coastal
 * ADS-B receivers and continues with ADS-C reports sent to the oceanic
 * centre through a geostationary satellite. Optional space-based ADS-B
 * (receivers on satellites) covers the whole ocean.
 *
 * The map is flat (x east, y north, NM) around a fictional ocean; latitude and
 * longitude in the messages come from the same local conversion as everywhere.
 */

import {
  ADSC_DEFAULT_PERIODIC_MIN,
  adscEventsTriggered,
  adscLatencyS,
  crossTrackFromLegNm,
  geoHopDelayS,
  SPACE_ADSB_LATENCY_S,
  type AdscEventContract,
  type AdscEventKind,
  type AdscReportKind,
  type AdscSample,
} from '@/core/ads'
import { distanceNm, localToLatLon, type LatLon, type Vec2 } from '@/core/geometry'
import { mulberry32 } from '@/core/random'
import { stepAircraftFine } from '@/core/world'
import { AdsbTracker, broadcasts, makeTransmitter, radioSees, type AdsAircraft, type AdsbMessage, type GroundReceiver } from './engine'

/** Fictional reference point for latitude/longitude in the messages. */
export const OCEAN_REF: LatLon = { lat: -8, lon: 80 }

/** West coast: land where x is less than this. */
export const coastWest = (y: number) => -650 + 25 * Math.sin(y / 70) + 12 * Math.sin(y / 23)
/** East coast: land where x is greater than this. */
export const coastEast = (y: number) => 650 + 20 * Math.sin(y / 60 + 1) + 10 * Math.sin(y / 19)

const flat = () => 0

export const OCEAN_RECEIVERS: GroundReceiver[] = [
  { id: 'west', name: 'West coast ADS-B', pos: { x: -668, y: 0 }, heightFt: 120 },
  { id: 'east', name: 'East coast ADS-B', pos: { x: 676, y: -14 }, heightFt: 120 },
]
export const OCEANIC_CENTRE: Vec2 = { x: -668, y: 92 }
export const GROUND_EARTH_STATION: Vec2 = { x: -672, y: 168 }
/** Where the satellite is drawn (not to scale: it is 35,786 km up). */
export const SATELLITE_DRAWN: Vec2 = { x: 0, y: 330 }
/** Elevation angles of the satellite seen from the aircraft and the ground station, for the radio delay. */
// TODO(expert-review): representative elevation angles (40° from the aircraft, 30° from the ground station).
const ELEV_AIRCRAFT_DEG = 40
const ELEV_GES_DEG = 30

export interface OceanWaypoint {
  name: string
  pos: Vec2
}

export const OCEAN_ROUTE: OceanWaypoint[] = [
  { name: 'NUSAS', pos: { x: -450, y: 30 } },
  { name: 'LAUTA', pos: { x: -200, y: 52 } },
  { name: 'OMBAK', pos: { x: 50, y: 45 } },
  { name: 'KARAN', pos: { x: 300, y: 20 } },
  { name: 'PULAU', pos: { x: 550, y: -4 } },
  { name: 'TIMUR', pos: { x: 740, y: -14 } },
]
export const OCEAN_START: Vec2 = { x: -700, y: 8 }
export const CLEARED_FL = 350

export interface ContractSettings {
  periodicMin: number
  altitudeEvent: boolean
  /** Half-width of the altitude band around the cleared level, ft. */
  altitudeBandFt: number
  lateralEvent: boolean
  lateralNm: number
  verticalRateEvent: boolean
  verticalRateFpm: number
  waypointEvent: boolean
}

// TODO(expert-review): example event thresholds (±300 ft band, 5 NM lateral deviation, 1,500 ft/min vertical rate).
export const DEFAULT_CONTRACT: ContractSettings = {
  periodicMin: ADSC_DEFAULT_PERIODIC_MIN,
  altitudeEvent: false,
  altitudeBandFt: 300,
  lateralEvent: false,
  lateralNm: 5,
  verticalRateEvent: false,
  verticalRateFpm: 1500,
  waypointEvent: true,
}

export function eventContract(c: ContractSettings): AdscEventContract {
  return {
    altitudeRange: c.altitudeEvent ? { floorFt: CLEARED_FL * 100 - c.altitudeBandFt, ceilingFt: CLEARED_FL * 100 + c.altitudeBandFt } : null,
    lateralDeviationNm: c.lateralEvent ? c.lateralNm : null,
    verticalRateFpm: c.verticalRateEvent ? c.verticalRateFpm : null,
    waypointChange: c.waypointEvent,
  }
}

export interface AdscReport {
  seq: number
  kind: AdscReportKind
  event?: AdscEventKind
  sentS: number
  receivedS: number
  pos: Vec2
  latLon: LatLon
  altitudeFt: number
  groundSpeedKt: number
  trackDeg: number
  verticalRateFpm: number
  /** Predicted route group: next waypoint and when the aircraft expects to pass it. */
  nextWaypoint: string | null
  etaS: number | null
}

export interface OceanOptions {
  contract: ContractSettings
  spaceAdsb: boolean
  offsetRight: boolean
}

/** Waypoints shifted 10 NM to the right of the route (a lateral offset). */
// TODO(expert-review): 10 NM right offset is an example value.
export const OFFSET_NM = 10
function offsetRoute(right: boolean): Vec2[] {
  if (!right) return OCEAN_ROUTE.map((w) => w.pos)
  return OCEAN_ROUTE.map((w, i) => {
    const from = i === 0 ? OCEAN_START : OCEAN_ROUTE[i - 1].pos
    const dx = w.pos.x - from.x
    const dy = w.pos.y - from.y
    const len = Math.hypot(dx, dy) || 1
    // Right-hand normal of the leg direction (dx, dy) is (dy, −dx).
    return { x: w.pos.x + (dy / len) * OFFSET_NM, y: w.pos.y - (dx / len) * OFFSET_NM }
  })
}

export class AdscEngine {
  readonly ref = OCEAN_REF
  readonly receivers = OCEAN_RECEIVERS
  opts: OceanOptions = { contract: { ...DEFAULT_CONTRACT }, spaceAdsb: false, offsetRight: false }
  timeS = 0
  aircraft: AdsAircraft
  /** The oceanic centre's ADS-B picture (from coastal or space-based receivers). */
  atc = new AdsbTracker(OCEAN_REF)
  /** Reports on their way (sent but not yet delivered). */
  inTransit: AdscReport[] = []
  /** Reports the centre has received, oldest first. */
  received: AdscReport[] = []
  arrived = false
  private rand: () => number
  private seq = 0
  private nextPeriodicS: number
  private lastPeriodicS = -Infinity
  private prevSample: AdscSample
  private pendingSpace: { m: AdsbMessage; at: number }[] = []

  constructor(seed = 21) {
    this.rand = mulberry32(seed)
    this.aircraft = this.freshAircraft()
    this.nextPeriodicS = 0
    this.prevSample = this.sample()
  }

  private freshAircraft(): AdsAircraft {
    const a = makeTransmitter({ id: 'CNS808', category: 'heavy', pos: OCEAN_START, altitudeFt: CLEARED_FL * 100, headingDeg: 80, speedKt: 480 }, 0x8a0808, this.rand)
    return { ...a, targetSpeedKt: 480, mode: { kind: 'route', waypoints: offsetRoute(false), index: 0, loop: false } }
  }

  /** Start the crossing again from the west coast. */
  reset() {
    this.timeS = 0
    this.aircraft = this.freshAircraft()
    if (this.opts.offsetRight) this.applyOffset(true)
    this.atc.clear()
    this.inTransit = []
    this.received = []
    this.pendingSpace = []
    this.arrived = false
    this.nextPeriodicS = 0
    this.lastPeriodicS = -Infinity
    this.prevSample = this.sample()
  }

  /** Move the aircraft to a point on its route (keeps reports already received). */
  placeAt(p: Vec2, nextIndex: number) {
    this.aircraft = { ...this.aircraft, pos: { ...p }, mode: { kind: 'route', waypoints: offsetRoute(this.opts.offsetRight), index: nextIndex, loop: false } }
    this.prevSample = this.sample()
  }

  applyOffset(on: boolean) {
    this.opts = { ...this.opts, offsetRight: on }
    const m = this.aircraft.mode
    const index = m.kind === 'route' ? m.index : this.nextWaypointIndex()
    this.aircraft = { ...this.aircraft, mode: { kind: 'route', waypoints: offsetRoute(on), index, loop: false } }
  }

  setTargetAltitude(ft: number) {
    this.aircraft = { ...this.aircraft, targetAltitudeFt: ft }
  }

  nextWaypointIndex(): number {
    const m = this.aircraft.mode
    return m.kind === 'route' ? m.index : OCEAN_ROUTE.length
  }

  /** Distance from the cleared (not offset) route, positive right, NM. */
  crossTrackNm(): number {
    const i = Math.min(this.nextWaypointIndex(), OCEAN_ROUTE.length - 1)
    const from = i === 0 ? OCEAN_START : OCEAN_ROUTE[i - 1].pos
    return crossTrackFromLegNm(this.aircraft.pos, from, OCEAN_ROUTE[i].pos)
  }

  sample(): AdscSample {
    const a = this.aircraft
    return { altitudeFt: a.altitudeFt, crossTrackNm: this.crossTrackNm(), verticalRateFpm: a.verticalSpeedFpm, nextWaypoint: this.nextWaypointIndex() }
  }

  /** Which receivers hear ADS-B from the aircraft right now. */
  adsbHeardBy(): string[] {
    const a = this.aircraft
    return this.receivers.filter((r) => radioSees(r.pos, r.heightFt, a.pos, a.altitudeFt, flat)).map((r) => r.id)
  }

  /** Radio travel time of a report through the satellite, s. */
  radioHopS(): number {
    return geoHopDelayS(ELEV_AIRCRAFT_DEG, ELEV_GES_DEG)
  }

  /** Send an ADS-C report now (periodic, event or demand). */
  sendReport(kind: AdscReportKind, event?: AdscEventKind, atS = this.timeS) {
    const a = this.aircraft
    const i = this.nextWaypointIndex()
    const wp = OCEAN_ROUTE[i]
    const eta = wp ? atS + distanceNm(a.pos, this.routeTarget()) / (Math.max(a.speedKt, 1) / 3600) : null
    const latency = this.radioHopS() + adscLatencyS(this.rand())
    this.inTransit.push({
      seq: ++this.seq,
      kind,
      event,
      sentS: atS,
      receivedS: atS + latency,
      pos: { ...a.pos },
      latLon: localToLatLon(a.pos, this.ref),
      altitudeFt: a.altitudeFt,
      groundSpeedKt: a.speedKt,
      trackDeg: a.headingDeg,
      verticalRateFpm: a.verticalSpeedFpm,
      nextWaypoint: wp?.name ?? null,
      etaS: eta,
    })
  }

  private routeTarget(): Vec2 {
    const m = this.aircraft.mode
    if (m.kind === 'route' && m.waypoints[m.index]) return m.waypoints[m.index]
    return this.aircraft.pos
  }

  /** The last report the centre has, if any. */
  lastReport(): AdscReport | undefined {
    return this.received[this.received.length - 1]
  }

  step(dt: number) {
    if (dt <= 0) return
    const t0 = this.timeS
    const t1 = t0 + dt
    const prev = this.aircraft
    if (!this.arrived) {
      const moved = stepAircraftFine(this.aircraft, dt)
      this.aircraft = { ...this.aircraft, ...moved }
      // Past the last waypoint: the crossing is over.
      if (this.aircraft.mode.kind !== 'route' || distanceNm(this.aircraft.pos, OCEAN_ROUTE[OCEAN_ROUTE.length - 1].pos) < 3) {
        this.arrived = true
        this.aircraft = { ...this.aircraft, held: true }
      }
    }

    // ADS-B broadcasts: heard by the coastal receivers in line of sight, or by satellites.
    const { messages, next } = broadcasts(prev, this.aircraft, t0, dt, this.ref, this.rand)
    this.aircraft = { ...this.aircraft, ...next }
    const heardBy = this.adsbHeardBy()
    for (const m0 of messages) {
      const m: AdsbMessage = { ...m0, seq: 0, from: this.aircraft.id, txPos: this.aircraft.pos, txAltFt: this.aircraft.altitudeFt, heardBy }
      if (heardBy.length) this.atc.ingest(m, m.timeS)
      else if (this.opts.spaceAdsb) this.pendingSpace.push({ m, at: m.timeS + SPACE_ADSB_LATENCY_S })
    }
    const due = this.pendingSpace.filter((p) => p.at <= t1)
    this.pendingSpace = this.pendingSpace.filter((p) => p.at > t1)
    for (const p of due) this.atc.ingest(p.m, p.at)
    this.atc.prune(t1)

    // ADS-C: periodic contract.
    const periodS = this.opts.contract.periodicMin * 60
    // A changed interval applies from the last periodic report.
    if (Number.isFinite(this.lastPeriodicS)) this.nextPeriodicS = Math.max(t0, this.lastPeriodicS + periodS)
    while (this.nextPeriodicS <= t1) {
      const at = Math.max(t0, this.nextPeriodicS)
      this.sendReport('periodic', undefined, at)
      this.lastPeriodicS = at
      this.nextPeriodicS = at + periodS
    }
    this.timeS = t1
    // ADS-C: event contract (checked on the new state).
    const now = this.sample()
    for (const ev of adscEventsTriggered(this.prevSample, now, eventContract(this.opts.contract))) this.sendReport('event', ev, t1)
    this.prevSample = now

    // Deliveries.
    const arrived = this.inTransit.filter((r) => r.receivedS <= t1).sort((a, b) => a.receivedS - b.receivedS)
    this.inTransit = this.inTransit.filter((r) => r.receivedS > t1)
    this.received.push(...arrived)
    if (this.received.length > 200) this.received.splice(0, this.received.length - 200)
  }

  /** Is the centre seeing the aircraft on ADS-B right now? */
  adsbLive(): boolean {
    const tr = this.atc.tracks.get(this.aircraft.address)
    return Boolean(tr && tr.pos && this.timeS - tr.posS < 3 + (this.opts.spaceAdsb ? SPACE_ADSB_LATENCY_S : 0))
  }
}

/** World time → "hh:mm:ss" UTC, with the scenario starting at 10:00:00. */
export function utc(timeS: number): string {
  const s = Math.floor(36000 + timeS)
  const hh = Math.floor(s / 3600) % 24
  const mm = Math.floor(s / 60) % 60
  const ss = s % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}
