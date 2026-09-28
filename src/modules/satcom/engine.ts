/**
 * SATCOM scenario engine. One world, one clock: an aircraft flies a
 * great-circle route while a GEO fleet or an Iridium-style LEO constellation
 * turns with the Earth. Every view (3D globe, sky plot, link status, latency
 * meter) reads the satellite positions and the link computed here.
 */

import { angleDiff, normalize360, type LatLon, type Vec3 } from '@/core/geometry'
import {
  AIRFRAME_MASK_DEG,
  antennaElevationDeg,
  buildLeoConstellation,
  circularOrbitEcef,
  GEO_MASK_DEG,
  geoPositionEcef,
  islLinks,
  KA_BAND_GHZ,
  KU_BAND_GHZ,
  L_BAND_GHZ,
  LEO,
  lookAngles,
  pathDelayS,
  rainAttenuationDb,
  routeLengthNm,
  routePointAt,
  shortestIslRoute,
  sphericalToEcef,
  turnRateDegS,
  type FlightRoute,
  type LeoSatellite,
  type RoutePoint,
} from '@/core/satcom'
import { travelTimeS } from '@/core/propagation'
import { clamp, ftToMetres, ktToNmPerS } from '@/core/units'

export type Constellation = 'geo' | 'leo'
export type RouteId = 'atlantic' | 'polar'
export type LinkState = 'connected' | 'handover' | 'blocked' | 'no-satellite'
export type Service = 'voice' | 'cpdlc' | 'adsc' | 'adsb'

export interface SatcomEnv {
  steepTurn: boolean
  handoverTrouble: boolean
  heavyRain: boolean
}

export const DEFAULT_ENV: SatcomEnv = { steepTurn: false, handoverTrouble: false, heavyRain: false }

export interface GroundStation {
  name: string
  pos: LatLon
}

export interface GeoSatellite {
  id: string
  name: string
  lonDeg: number
  station: GroundStation
}

/**
 * Four GEO satellites at longitudes similar to Inmarsat's fleet, each with a
 * ground station in its view.
 * TODO(expert-review): positions are illustrative; the real fleet and ground stations change over time.
 */
export const GEO_SATS: GeoSatellite[] = [
  { id: 'GEO-1', name: 'GEO-1 (98°W)', lonDeg: -98, station: { name: 'Ground station, North America', pos: { lat: 45.5, lon: -73.6 } } },
  { id: 'GEO-2', name: 'GEO-2 (15.5°W)', lonDeg: -15.5, station: { name: 'Ground station, Europe', pos: { lat: 53.3, lon: 7.1 } } },
  { id: 'GEO-3', name: 'GEO-3 (64°E)', lonDeg: 64, station: { name: 'Ground station, Southern Europe', pos: { lat: 42.0, lon: 13.6 } } },
  { id: 'GEO-4', name: 'GEO-4 (143.5°E)', lonDeg: 143.5, station: { name: 'Ground station, Australia', pos: { lat: -31.8, lon: 115.9 } } },
]

/** Where the LEO constellation hands traffic to the ground. TODO(expert-review): illustrative single gateway. */
export const LEO_GATEWAY: GroundStation = { name: 'Gateway, Arizona (USA)', pos: { lat: 33.4, lon: -111.9 } }

const LONDON = { name: 'London (EGLL)', pos: { lat: 51.47, lon: -0.45 } }
const NEW_YORK = { name: 'New York (KJFK)', pos: { lat: 40.64, lon: -73.78 } }
const BEIJING = { name: 'Beijing (ZBAA)', pos: { lat: 40.08, lon: 116.58 } }
const NORTH_POLE = { name: 'North Pole', pos: { lat: 90, lon: 0 } }

export const ROUTES: Record<RouteId, FlightRoute> = {
  atlantic: {
    id: 'atlantic',
    name: 'London to New York (across the Atlantic)',
    waypoints: [LONDON, NEW_YORK],
    cruiseAltitudeFt: 35000,
    groundSpeedKt: 480,
    climbNm: 150,
    descentNm: 150,
  },
  polar: {
    id: 'polar',
    name: 'New York to Beijing over the North Pole',
    waypoints: [NEW_YORK, NORTH_POLE, BEIJING],
    cruiseAltitudeFt: 35000,
    groundSpeedKt: 480,
    climbNm: 150,
    descentNm: 150,
  },
}

/** Bank angle of the "steep turn" failure, degrees (right wing down). */
export const STEEP_BANK_DEG = 45
/** The steep turn waits until the aircraft is at least this high, ft. */
export const MIN_TURN_ALTITUDE_FT = 1000
/** Roll rate into and out of the turn, deg/s. TODO(expert-review): typical airliner roll rates are a few degrees per second. */
export const ROLL_RATE_DEG_S = 5

/**
 * How long a switch to another satellite interrupts the link, s: normally brief,
 * with "satellite handover" trouble switched on much longer.
 * TODO(expert-review): illustrative values; real behaviour depends on the system and service.
 */
export const HANDOVER_GAP_S: Record<Constellation, { normal: number; trouble: number }> = {
  geo: { normal: 4, trouble: 90 },
  leo: { normal: 0.5, trouble: 20 },
}

/** GEO: switch to another satellite when it is this much higher than the current one. TODO(expert-review). */
export const GEO_HANDOVER_MARGIN_DEG = 5

/** Heavy rain used by the failure, mm/h, and the height of the rain layer, km. TODO(expert-review): illustrative. */
export const HEAVY_RAIN_MM_H = 25
export const RAIN_HEIGHT_KM = 5
/** Link margin in clear sky, dB, the same for every band so only the rain differs. TODO(expert-review): illustrative. */
export const CLEAR_SKY_MARGIN_DB = 6

/**
 * Time spent on the ground and in queues (ground network, processing, codecs),
 * s. NOT propagation. TODO(expert-review): illustrative only, varies widely by system.
 */
export const PROCESSING_S: Record<Service, number> = { voice: 0.25, cpdlc: 3, adsc: 3, adsb: 1 }

export const SERVICE_NAME: Record<Service, string> = {
  voice: 'Voice call (SATVOICE)',
  cpdlc: 'CPDLC message',
  adsc: 'ADS-C position report',
  adsb: 'Space-based ADS-B',
}

export interface SatLook {
  azimuthDeg: number
  elevationDeg: number
  /** Elevation above the antenna's own tilted horizon. */
  antennaElevationDeg: number
  rangeM: number
  /** Above the elevation mask (ignoring the airframe). */
  visible: boolean
  /** Visible and not hidden by the airframe or faded by rain. */
  usable: boolean
}

export interface LinkStatus {
  state: LinkState
  /** Satellite in use (index into the current constellation), or null. */
  sat: number | null
  /** While handing over: the satellite being switched to. */
  target: number | null
  handoverEndsS: number | null
}

export interface LinkEvent {
  timeS: number
  kind: 'handover' | 'lost' | 'regained'
  text: string
}

export interface HistorySegment {
  fromNm: number
  toNm: number
  state: LinkState
  /** Satellite in use while connected. */
  sat: number | null
}

export interface PathLeg {
  from: Vec3
  to: Vec3
  kind: 'up' | 'isl' | 'down'
  label: string
  distanceM: number
  delayS: number
}

export interface MessagePath {
  legs: PathLeg[]
  propagationS: number
  satName: string
  stationName: string
  islHops: number
}

export interface Replay {
  service: Service
  constellation: Constellation
  path: MessagePath
  processingS: number
  queueS: number
  /** Signal time elapsed in the slow-motion replay, s. */
  tS: number
  done: boolean
  /** Set by the simulator once it has frozen the world clock for the replay. */
  frozen: boolean
  /** Whether the world clock was running before the replay froze it. */
  resume: boolean
}

export interface SendResult {
  n: number
  service: Service
  constellation: Constellation
  satName: string
  propagationS: number
  processingS: number
  queueS: number
  islHops: number
}

export interface Pending {
  service: Service
  queuedAtS: number
}

export interface BandFade {
  band: 'L' | 'Ku' | 'Ka'
  freqGHz: number
  attenuationDb: number
  marginDb: number
  status: 'ok' | 'fading' | 'lost'
}

/** GEO satellites do not move relative to the Earth: their ECEF positions are constant. */
const GEO_POS: Vec3[] = GEO_SATS.map((g) => geoPositionEcef(g.lonDeg))

export class SatcomEngine {
  timeS = 0
  constellation: Constellation = 'geo'
  routeId: RouteId = 'atlantic'
  env: SatcomEnv = { ...DEFAULT_ENV }
  /** Distance flown along the route, NM. */
  distanceNm = 0
  headingDeg = 0
  bankDeg = 0
  turnPhase: 'level' | 'turning' | 'rolling-out' = 'level'
  arrived = false

  readonly leoSats: LeoSatellite[] = buildLeoConstellation()
  /** Current ECEF positions (m) of the satellites of the selected constellation. */
  satPos: Vec3[] = []
  looks: SatLook[] = []
  link: LinkStatus = { state: 'no-satellite', sat: null, target: null, handoverEndsS: null }
  events: LinkEvent[] = []
  history: HistorySegment[] = []
  handovers = 0
  /** Live path for the selected service (drawn on the globe). */
  livePath: MessagePath | null = null
  service: Service = 'voice'
  pending: Pending | null = null
  replay: Replay | null = null
  results: SendResult[] = []

  private point!: RoutePoint

  constructor(opts: { constellation?: Constellation; routeId?: RouteId } = {}) {
    this.constellation = opts.constellation ?? 'geo'
    this.routeId = opts.routeId ?? 'atlantic'
    this.restartFlight()
  }

  get route(): FlightRoute {
    return ROUTES[this.routeId]
  }

  get routeLengthNm(): number {
    return routeLengthNm(this.route)
  }

  get maskDeg(): number {
    return this.constellation === 'geo' ? GEO_MASK_DEG : LEO.maskDeg
  }

  get routePoint(): RoutePoint {
    return this.point
  }

  get aircraftHeightM(): number {
    return ftToMetres(this.point.altitudeFt)
  }

  get aircraftEcef(): Vec3 {
    return sphericalToEcef(this.point.pos, this.aircraftHeightM)
  }

  satName(i: number | null): string {
    if (i == null) return '—'
    return this.constellation === 'geo' ? GEO_SATS[i].name : `Satellite ${this.leoSats[i].id}`
  }

  satCount(): number {
    return this.constellation === 'geo' ? GEO_SATS.length : this.leoSats.length
  }

  /** Put the aircraft back at the start of the route (world time keeps running). */
  restartFlight() {
    this.setDistance(0)
  }

  /** Jump the aircraft along its route (an explicit learner action). */
  setDistance(nm: number) {
    this.distanceNm = clamp(nm, 0, this.routeLengthNm)
    this.arrived = this.distanceNm >= this.routeLengthNm - 1e-6
    this.point = routePointAt(this.route, this.distanceNm)
    this.headingDeg = this.point.courseDeg
    this.bankDeg = 0
    this.turnPhase = 'level'
    this.history = []
    this.pending = null
    this.updateSatellites()
    this.acquire()
  }

  setConstellation(c: Constellation) {
    if (c === this.constellation) return
    this.constellation = c
    this.events = []
    this.handovers = 0
    this.history = []
    this.pending = null
    this.replay = null
    this.updateSatellites()
    this.acquire()
  }

  setRoute(id: RouteId) {
    if (id === this.routeId) return
    this.routeId = id
    this.events = []
    this.handovers = 0
    this.setDistance(0)
  }

  reset() {
    this.timeS = 0
    this.env = { ...DEFAULT_ENV }
    this.events = []
    this.handovers = 0
    this.results = []
    this.replay = null
    this.setDistance(0)
  }

  // -------------------------------------------------------------------------
  // Stepping
  // -------------------------------------------------------------------------

  /** Advance the world by dt seconds (0 while paused: nothing moves, no timer runs). */
  step(dt: number) {
    if (!(dt > 0)) return
    let left = dt
    while (left > 1e-9) {
      let h = Math.min(left, this.turnPhase === 'level' && !this.env.steepTurn ? 5 : 0.5)
      // End a handover exactly on time, whatever the frame length.
      if (this.link.state === 'handover' && this.link.handoverEndsS != null && this.link.handoverEndsS > this.timeS) h = Math.min(h, this.link.handoverEndsS - this.timeS)
      this.subStep(h)
      left -= h
    }
    this.livePath = this.computePath(this.service)
    // A queued message leaves as soon as there is a link.
    if (this.pending && !this.replay) {
      const path = this.computePath(this.pending.service)
      if (path) this.startReplay(this.pending.service, path, this.timeS - this.pending.queuedAtS)
    }
  }

  private subStep(h: number) {
    this.timeS += h
    this.flyAircraft(h)
    this.updateSatellites()
    this.updateLink()
    this.recordHistory()
  }

  /** The steep turn is only flown in the air (it waits until the aircraft has climbed away). */
  get canTurn(): boolean {
    return !this.arrived && this.point.altitudeFt >= MIN_TURN_ALTITUDE_FT
  }

  private flyAircraft(h: number) {
    const course = routePointAt(this.route, this.distanceNm).courseDeg
    const wantTurn = this.env.steepTurn && this.canTurn
    if (wantTurn && this.turnPhase !== 'turning') this.turnPhase = 'turning'
    if (this.turnPhase === 'level') {
      if (!this.arrived) {
        this.distanceNm = Math.min(this.routeLengthNm, this.distanceNm + ktToNmPerS(this.route.groundSpeedKt) * h)
        if (this.distanceNm >= this.routeLengthNm - 1e-6) this.arrived = true
      }
      this.point = routePointAt(this.route, this.distanceNm)
      this.headingDeg = this.point.courseDeg
      return
    }
    // In the turn the aircraft circles within a few miles of its route position:
    // on a globe that is no visible movement, so route progress pauses.
    const target = this.turnPhase === 'turning' ? STEEP_BANK_DEG : 0
    const dBank = ROLL_RATE_DEG_S * h
    this.bankDeg = this.bankDeg < target ? Math.min(target, this.bankDeg + dBank) : Math.max(target, this.bankDeg - dBank)
    this.headingDeg = normalize360(this.headingDeg + turnRateDegS(this.bankDeg, this.route.groundSpeedKt) * h)
    if (this.turnPhase === 'turning' && !wantTurn) {
      // Finish the turn: roll out so the wings are level when back on the route course.
      const lead = (turnRateDegS(STEEP_BANK_DEG, this.route.groundSpeedKt) * (this.bankDeg / ROLL_RATE_DEG_S)) / 2
      const remaining = normalize360(course - this.headingDeg)
      if (remaining <= Math.max(lead, 0.5) || this.bankDeg <= 0) this.turnPhase = 'rolling-out'
    }
    if (this.turnPhase === 'rolling-out' && this.bankDeg <= 0) {
      this.bankDeg = 0
      this.turnPhase = 'level'
      this.headingDeg = course
    }
    this.point = { ...routePointAt(this.route, this.distanceNm) }
  }

  private updateSatellites() {
    this.satPos = this.constellation === 'geo' ? GEO_POS : this.leoSats.map((s) => circularOrbitEcef(s, this.timeS))
    const pos = this.point.pos
    const hM = this.aircraftHeightM
    const mask = this.maskDeg
    const lFade = this.env.heavyRain
    this.looks = this.satPos.map((p) => {
      const la = lookAngles(p, pos, hM)
      const antEl = antennaElevationDeg(la.azimuthDeg, la.elevationDeg, this.headingDeg, this.bankDeg)
      const visible = la.elevationDeg >= mask
      const lMargin = CLEAR_SKY_MARGIN_DB - (lFade ? rainAttenuationDb(L_BAND_GHZ, HEAVY_RAIN_MM_H, la.elevationDeg, hM / 1000, RAIN_HEIGHT_KM) : 0)
      return {
        azimuthDeg: la.azimuthDeg,
        elevationDeg: la.elevationDeg,
        antennaElevationDeg: antEl,
        rangeM: la.rangeM,
        visible,
        usable: visible && antEl >= AIRFRAME_MASK_DEG && lMargin >= 0,
      }
    })
  }

  /** Best usable satellite (highest elevation), or null. */
  private bestUsable(): number | null {
    let best: number | null = null
    for (let i = 0; i < this.looks.length; i++) {
      if (!this.looks[i].usable) continue
      if (best == null || this.looks[i].elevationDeg > this.looks[best].elevationDeg) best = i
    }
    return best
  }

  private gapS(): number {
    const g = HANDOVER_GAP_S[this.constellation]
    return this.env.handoverTrouble ? g.trouble : g.normal
  }

  /** Pick a satellite immediately (start of a flight or after a jump). */
  private acquire() {
    const best = this.bestUsable()
    this.link = best == null ? { state: this.noLinkState(), sat: null, target: null, handoverEndsS: null } : { state: 'connected', sat: best, target: null, handoverEndsS: null }
    this.livePath = this.computePath(this.service)
    this.recordHistory()
  }

  private noLinkState(): LinkState {
    return this.looks.some((l) => l.visible) ? 'blocked' : 'no-satellite'
  }

  private log(kind: LinkEvent['kind'], text: string) {
    this.events.unshift({ timeS: this.timeS, kind, text })
    if (this.events.length > 8) this.events.length = 8
  }

  private updateLink() {
    const L = this.link
    const looks = this.looks
    if (L.state === 'handover' && L.target != null) {
      if (looks[L.target].usable) {
        if (L.handoverEndsS != null && this.timeS >= L.handoverEndsS - 1e-9) {
          this.link = { state: 'connected', sat: L.target, target: null, handoverEndsS: null }
        }
        return
      }
      // The satellite we were switching to went away: look again.
      this.link = { state: this.noLinkState(), sat: null, target: null, handoverEndsS: null }
    }
    const cur = this.link.sat
    const best = this.bestUsable()
    if (cur != null && looks[cur].usable) {
      const better = this.constellation === 'geo' && best != null && best !== cur && looks[best].elevationDeg > looks[cur].elevationDeg + GEO_HANDOVER_MARGIN_DEG
      if (!better) {
        this.link.state = 'connected'
        return
      }
    }
    if (best == null) {
      if (cur != null) {
        const why = looks[cur].visible ? 'the aircraft’s own body is in the way' : `${this.satName(cur)} went below ${this.maskDeg}° elevation`
        this.log('lost', `Link lost: ${why}.`)
      }
      this.link = { state: this.noLinkState(), sat: null, target: null, handoverEndsS: null }
      return
    }
    // Switch to `best`.
    const gap = this.gapS()
    if (cur != null) {
      const reason = !looks[cur].visible ? `${this.satName(cur)} set below ${this.maskDeg}°` : !looks[cur].usable ? `${this.satName(cur)} hidden by the airframe` : `${this.satName(best)} is higher in the sky`
      this.handovers++
      this.log('handover', `Handover to ${this.satName(best)}: ${reason}.`)
    } else if (this.history.length > 0) {
      this.log('regained', `Link regained through ${this.satName(best)}.`)
    }
    this.link = gap > 0 ? { state: 'handover', sat: null, target: best, handoverEndsS: this.timeS + gap } : { state: 'connected', sat: best, target: null, handoverEndsS: null }
  }

  private recordHistory() {
    const d = this.distanceNm
    const s = this.link.state
    const sat = s === 'connected' ? this.link.sat : null
    const last = this.history[this.history.length - 1]
    if (last && last.state === s && last.sat === sat) {
      last.toNm = Math.max(last.toNm, d)
      return
    }
    if (last) last.toNm = Math.max(last.toNm, d)
    this.history.push({ fromNm: d, toNm: d, state: s, sat })
    if (this.history.length > 400) this.history.shift()
  }

  // -------------------------------------------------------------------------
  // Messages and latency
  // -------------------------------------------------------------------------

  /** Why a service cannot be used at all with this constellation (null if it can). */
  serviceUnavailable(service: Service): string | null {
    if (service === 'adsb' && this.constellation === 'geo') return 'Space-based ADS-B uses receivers carried on low-orbit satellites. Switch to LEO.'
    return null
  }

  /** The path a message would take right now, or null when there is no link for it. */
  computePath(service: Service): MessagePath | null {
    if (this.serviceUnavailable(service)) return null
    const ac = this.aircraftEcef
    let sat: number | null
    if (service === 'adsb') {
      // ADS-B uses the aircraft's normal transponder broadcast, not its SATCOM
      // antenna: any satellite above the mask hears it; no handover is needed.
      sat = null
      for (let i = 0; i < this.looks.length; i++) if (this.looks[i].visible && (sat == null || this.looks[i].elevationDeg > this.looks[sat].elevationDeg)) sat = i
    } else {
      sat = this.link.state === 'connected' ? this.link.sat : null
    }
    if (sat == null) return null
    const legs: PathLeg[] = []
    const leg = (from: Vec3, to: Vec3, kind: PathLeg['kind'], label: string) => {
      const d = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z)
      legs.push({ from, to, kind, label, distanceM: d, delayS: travelTimeS(d) })
    }
    if (this.constellation === 'geo') {
      const g = GEO_SATS[sat]
      const st = sphericalToEcef(g.station.pos, 0)
      leg(ac, this.satPos[sat], 'up', service === 'adsb' ? 'Aircraft to satellite' : 'Aircraft to satellite (L-band)')
      leg(this.satPos[sat], st, 'down', 'Satellite to ground station')
      return { legs, propagationS: pathDelayS([ac, this.satPos[sat], st]), satName: g.name, stationName: g.station.name, islHops: 0 }
    }
    // LEO: up to the serving satellite, across inter-satellite links, down at the gateway.
    const gw = sphericalToEcef(LEO_GATEWAY.pos, 0)
    let gSat = -1
    let gEl = -90
    for (let i = 0; i < this.satPos.length; i++) {
      const e = lookAngles(this.satPos[i], LEO_GATEWAY.pos, 0).elevationDeg
      if (e > gEl) {
        gEl = e
        gSat = i
      }
    }
    if (gSat < 0 || gEl < LEO.maskDeg) return null
    const route = shortestIslRoute(this.satPos.length, islLinks(this.leoSats, this.satPos), sat, gSat)
    if (!route) return null
    leg(ac, this.satPos[sat], 'up', service === 'adsb' ? 'Aircraft to satellite (1090 MHz)' : 'Aircraft to satellite (L-band)')
    for (let k = 1; k < route.path.length; k++) leg(this.satPos[route.path[k - 1]], this.satPos[route.path[k]], 'isl', 'Satellite to satellite')
    leg(this.satPos[gSat], gw, 'down', 'Satellite to gateway')
    const pts = [ac, ...route.path.map((i) => this.satPos[i]), gw]
    return { legs, propagationS: pathDelayS(pts), satName: `Satellite ${this.leoSats[sat].id}`, stationName: LEO_GATEWAY.name, islHops: route.path.length - 1 }
  }

  /**
   * Send a message. If there is a link, a slow-motion replay starts (the caller
   * freezes the world); otherwise the message waits in a queue.
   */
  send(service: Service): 'replay' | 'queued' | 'unavailable' {
    if (this.serviceUnavailable(service)) return 'unavailable'
    const path = this.computePath(service)
    if (path) {
      this.startReplay(service, path, 0)
      return 'replay'
    }
    this.pending = { service, queuedAtS: this.timeS }
    this.replay = null
    return 'queued'
  }

  cancelPending() {
    this.pending = null
  }

  private startReplay(service: Service, path: MessagePath, queueS: number) {
    this.pending = null
    this.replay = { service, constellation: this.constellation, path, processingS: PROCESSING_S[service], queueS, tS: 0, done: false, frozen: false, resume: false }
  }

  /** Advance the slow-motion replay by signal time (s). Returns true when it has just finished. */
  advanceReplay(signalDtS: number): boolean {
    const r = this.replay
    if (!r || r.done) return false
    r.tS = Math.min(r.path.propagationS, r.tS + signalDtS)
    if (r.tS >= r.path.propagationS) {
      r.done = true
      this.results.unshift({
        n: (this.results[0]?.n ?? 0) + 1,
        service: r.service,
        constellation: r.constellation,
        satName: r.path.satName,
        propagationS: r.path.propagationS,
        processingS: r.processingS,
        queueS: r.queueS,
        islHops: r.path.islHops,
      })
      if (this.results.length > 6) this.results.length = 6
      return true
    }
    return false
  }

  /** Where the message is along its path at replay time tS (ECEF), or null. */
  replayPosition(): Vec3 | null {
    const r = this.replay
    if (!r || r.done) return null
    let t = r.tS
    for (const l of r.path.legs) {
      if (t <= l.delayS) {
        const f = l.delayS > 0 ? t / l.delayS : 1
        return { x: l.from.x + (l.to.x - l.from.x) * f, y: l.from.y + (l.to.y - l.from.y) * f, z: l.from.z + (l.to.z - l.from.z) * f }
      }
      t -= l.delayS
    }
    const last = r.path.legs[r.path.legs.length - 1]
    return last ? last.to : null
  }

  // -------------------------------------------------------------------------
  // Readouts
  // -------------------------------------------------------------------------

  /** Rain fade on the current path for the safety L-band and two passenger bands. */
  bandFades(): BandFade[] {
    const sat = this.link.sat ?? this.link.target ?? this.bestVisible()
    const el = sat != null ? this.looks[sat].elevationDeg : 30
    const hKm = this.aircraftHeightM / 1000
    return (
      [
        ['L', L_BAND_GHZ],
        ['Ku', KU_BAND_GHZ],
        ['Ka', KA_BAND_GHZ],
      ] as const
    ).map(([band, f]) => {
      const a = this.env.heavyRain ? rainAttenuationDb(f, HEAVY_RAIN_MM_H, el, hKm, RAIN_HEIGHT_KM) : 0
      const m = CLEAR_SKY_MARGIN_DB - a
      return { band, freqGHz: f, attenuationDb: a, marginDb: m, status: m >= 3 ? 'ok' : m >= 0 ? 'fading' : 'lost' }
    })
  }

  bestVisible(): number | null {
    let best: number | null = null
    for (let i = 0; i < this.looks.length; i++) if (this.looks[i].visible && (best == null || this.looks[i].elevationDeg > this.looks[best].elevationDeg)) best = i
    return best
  }

  /**
   * Seconds until the satellite in use drops below the mask, looking ahead up to
   * `horizonS` (LEO only; GEO satellites do not move in the sky).
   */
  timeUntilSetS(horizonS = 1800, stepS = 10): number | null {
    const i = this.link.sat
    if (i == null || this.constellation === 'geo') return null
    const s = this.leoSats[i]
    for (let dt = stepS; dt <= horizonS; dt += stepS) {
      const p = circularOrbitEcef(s, this.timeS + dt)
      if (lookAngles(p, this.point.pos, this.aircraftHeightM).elevationDeg < LEO.maskDeg) return dt
    }
    return null
  }

  /** Relative azimuth of a satellite from the nose, degrees (for the sky plot). */
  relativeAzimuthDeg(i: number): number {
    return normalize360(this.looks[i].azimuthDeg - this.headingDeg)
  }

  /** Signed heading error from the route course while turning, degrees. */
  headingOffRouteDeg(): number {
    return angleDiff(this.point.courseDeg, this.headingDeg)
  }
}
