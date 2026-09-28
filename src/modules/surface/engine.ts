/**
 * Surface movement scenario engine: aircraft land, taxi, park, push back and
 * take off; vehicles drive their roads. Three sensors watch them:
 *   - SMR, a fast-turning X-band radar that paints every object's shape,
 *   - airport MLAT (receivers time the transponder signals),
 *   - ADS-B (equipped objects broadcast their own GNSS position),
 * and a simple tracker fuses them into labelled tracks that feed the runway
 * incursion safety net. All physics comes from src/core (surface, mlat, radar).
 *
 * Units: metres, m/s (kt only at the edges), seconds, degrees true.
 */

import { angleDiff, bearingDeg, normalize360, sweepCovers, type Vec2 } from '@/core/geometry'
import { arrivalTimeUs, solveTdoa } from '@/core/mlat'
import { gaussian, mulberry32 } from '@/core/random'
import {
  approachSpeed,
  brakingDistanceM,
  closestAlong,
  DEFAULT_SMR,
  glidePathHeightM,
  ghostPosition,
  inRunwayProtectedArea,
  insideBox,
  makePath,
  onRunway,
  pointAt,
  rainClutterStrength,
  runwayIncursion,
  scatterPointsWorld,
  segmentHitsBox,
  smrPointDetection,
  smrRangeResolutionM,
  stopSpeedLimitMs,
  turnSpeedLimitKt,
  type IncursionResult,
  type Path,
  type RainState,
  type RunwayMovement,
  type SurfaceShape,
  type SurfaceTarget,
} from '@/core/surface'
import { ktToMs, metresToNm } from '@/core/units'
import type { ScopePaint } from '@/instruments'
import {
  arrivalPath,
  backtrackPath,
  BUILDINGS,
  cargoInPath,
  cargoOutPath,
  FAILING_RECEIVER,
  lineupPath,
  MLAT_RANGE_M,
  MLAT_RECEIVERS,
  pushbackEastPath,
  pushbackWestPath,
  RWY,
  serviceRoadPath,
  SMR_SITE,
  SOUTH_ROAD_X,
  SOUTH_ROAD_Y,
  southRoadPath,
  STANDS,
  STOP_BAR_Y,
  takeoffPath,
  TAXILANE_Y,
  taxiOutPath,
  TERMINAL_FACE,
  toRunwayPath,
  TOUCHDOWN_X,
  turnoffAlong,
  SERVICE_ROAD_X,
  SERVICE_ROAD_Y,
} from './layout'

export type Phase =
  | 'final'
  | 'goaround'
  | 'rollout'
  | 'taxi-in'
  | 'parked'
  | 'pushback'
  | 'taxi-out'
  | 'holding'
  | 'lineup'
  | 'lined'
  | 'takeoff'
  | 'rejected'
  | 'backtrack'
  | 'climb'
  | 'cargo-away'
  | 'cargo-in'
  | 'cargo-parked'
  | 'cargo-pushback'
  | 'cargo-out'
  | 'static'
  | 'patrol'
  | 'to-runway'
  | 'held'
  | 'return'

export interface SurfaceObject {
  id: string
  callsign: string
  kind: 'aircraft' | 'vehicle'
  shape: SurfaceShape
  pos: Vec2
  headingDeg: number
  speedMs: number
  /** Height above the airport, m (0 on the ground). */
  altitudeM: number
  transponder: boolean
  adsb: boolean
  phase: Phase
  path: Path | null
  s: number
  /** Moving tail first (pushback). */
  reverse: boolean
  waitUntil: number
  stand?: string
  /** Direction along a patrol road. */
  eastbound?: boolean
  /** Short description for the truth map. */
  note?: string
}

export interface SurfaceEnv {
  heavyRain: boolean
  circularPol: boolean
  /** VAN2 has no transponder: only the SMR can see it. */
  noTransponder: boolean
  /** Reflections off the terminal face make ghost targets. */
  reflections: boolean
  /** One airport MLAT receiver has failed. */
  mlatFailure: boolean
}

export interface SurfaceLayers {
  smr: boolean
  mlat: boolean
  adsb: boolean
  /** Show fused, labelled tracks instead of the raw sensor symbols. */
  fused: boolean
}

export const DEFAULT_ENV: SurfaceEnv = { heavyRain: false, circularPol: false, noTransponder: false, reflections: false, mlatFailure: false }
export const DEFAULT_LAYERS: SurfaceLayers = { smr: true, mlat: true, adsb: true, fused: true }

/** A new arrival every 200 s (traffic compressed so something is always happening). */
export const ARRIVAL_PERIOD_S = 200
/** Turnaround at the stand, shortened from the real 30–60 min. */
export const TURNAROUND_S = 90
/** Arrivals appear 3.5 NM out on a 3° final. */
export const FINAL_START_M = 6482
// TODO(expert-review): representative speeds and decelerations (approach 140 kt, touchdown 130 kt, braking 1.7 m/s², rotation 150 kt).
export const APPROACH_KT = 140
export const TOUCHDOWN_KT = 130
export const ROLLOUT_DECEL = 1.7
export const MAX_BRAKE = 3.5
export const TAKEOFF_ACCEL = 2.0
export const ROTATE_KT = 150
export const TAXI_KT = 18
export const VEHICLE_KT = 25
export const APRON_VEHICLE_KT = 12
/** Airport MLAT receiver time-stamping noise, ns. */
// TODO(expert-review): airport MLAT timing noise (5 ns rms ≈ 1.5 m per receiver used here).
export const SURFACE_MLAT_NOISE_NS = 5
/** ADS-B (GNSS) position noise, m. */
export const SURFACE_ADSB_NOISE_M = 3
/** Reflection loss at the terminal glass face, dB. */
// TODO(expert-review): reflection loss of a large glass facade at X-band (6 dB used here).
export const REFLECTION_LOSS_DB = 6
export const HEAVY_RAIN_MMH = 25
/** The SMR sees the surface and very low aircraft only. */
export const SMR_MAX_HEIGHT_M = 60

/** A vacating aircraft counts as vacated this far past the holding line (covers sensor lag). */
export const VACATED_MARGIN_M = 60

/** From 1 NM out, a landing aircraft goes around if anything is inside the runway protected area. */
export const GO_AROUND_CHECK_M = 1852

const MAX_PENDING_PAINTS = 8000
const MLAT_INTERVAL_S = 1
const ADSB_INTERVAL_S = 0.5

export interface SmrPlot {
  key: string
  objectId: string
  ghost: boolean
  pos: Vec2
  points: number
  timeS: number
}

export interface SensorPlot {
  objectId: string
  pos: Vec2
  callsign: string
  timeS: number
  receivers?: number
}

export type Source = 'smr' | 'mlat' | 'adsb'

export interface FusedTrack {
  key: string
  objectId: string
  ghost: boolean
  identity: string | null
  pos: Vec2
  last: Partial<Record<Source, number>>
  lastPos: Partial<Record<Source, Vec2>>
  lastUpdateS: number
}

interface Accum {
  sx: number
  sy: number
  n: number
  objectId: string
  ghost: boolean
}

export class SurfaceEngine {
  timeS = 0
  env: SurfaceEnv = { ...DEFAULT_ENV }
  layers: SurfaceLayers = { ...DEFAULT_LAYERS }
  objects: SurfaceObject[] = []
  smr = { ...DEFAULT_SMR }
  smrAz = 0
  /** Stop bar lit (red) at each connector. */
  stopBars: Record<string, boolean> = { A1: true, A2: true, A3: true, A4: true, A5: true }
  /** Aircraft cleared onto the runway. */
  cleared = new Set<string>()
  alert: IncursionResult = { level: 'none', intruders: [], against: null }
  /** Short log of notable events (go-arounds, rejected take-offs). */
  events: { timeS: number; text: string }[] = []
  smrPlots = new Map<string, SmrPlot>()
  mlatPlots = new Map<string, SensorPlot>()
  adsbPlots = new Map<string, SensorPlot>()
  tracks = new Map<string, FusedTrack>()
  nextArrivalS = 0
  private flightNo = 100
  private pending: ScopePaint[] = []
  private acc = new Map<string, Accum>()
  private nextMlatS = 0
  private nextAdsbS = 0
  private rand: () => number
  private sensorsOn = true

  constructor(seed = 5, warmUpS = 805) {
    this.rand = mulberry32(seed)
    this.init(warmUpS)
  }

  private init(warmUpS: number) {
    this.timeS = 0
    this.objects = [
      this.vehicle('OPS1', 'car', { x: -1100, y: SOUTH_ROAD_Y }, true, 'Airport operations car'),
      this.vehicle('VAN2', 'van', { x: -200, y: SERVICE_ROAD_Y }, false, 'Maintenance van'),
      {
        ...this.aircraft('CNS440', 'medium', STANDS.S1, 0),
        phase: 'static',
        stand: 'S1',
        transponder: false,
        adsb: false,
        note: 'Parked, transponder off',
      },
      { ...this.aircraft('CNS330', 'heavy', { x: 2300, y: 182.5 }, 270), phase: 'cargo-away', waitUntil: 20, adsb: false, note: 'Cargo, no ADS-B' },
    ]
    this.nextArrivalS = 0
    this.flightNo = 100
    this.cleared.clear()
    this.events = []
    this.stopBars = { A1: true, A2: true, A3: true, A4: true, A5: true }
    // Run the traffic forward (without sensors) so the airport starts busy.
    this.sensorsOn = false
    const dt = 0.25
    for (let t = 0; t < warmUpS; t += dt) this.step(dt)
    this.sensorsOn = true
    this.events = []
    this.nextMlatS = this.timeS
    this.nextAdsbS = this.timeS
    this.applyEquipment()
  }

  reset(warmUpS = 805) {
    this.smrPlots.clear()
    this.mlatPlots.clear()
    this.adsbPlots.clear()
    this.tracks.clear()
    this.acc.clear()
    this.pending = []
    this.smrAz = 0
    this.init(warmUpS)
  }

  private aircraft(id: string, shape: SurfaceShape, pos: Vec2, headingDeg: number): SurfaceObject {
    return { id, callsign: id, kind: 'aircraft', shape, pos: { ...pos }, headingDeg, speedMs: 0, altitudeM: 0, transponder: true, adsb: true, phase: 'static', path: null, s: 0, reverse: false, waitUntil: 0 }
  }

  private vehicle(id: string, shape: SurfaceShape, pos: Vec2, eastbound: boolean, note: string): SurfaceObject {
    const road = id === 'OPS1' ? southRoadPath(eastbound) : serviceRoadPath(eastbound)
    return {
      id,
      callsign: id,
      kind: 'vehicle',
      shape,
      pos: { ...pos },
      headingDeg: eastbound ? 90 : 270,
      speedMs: 0,
      altitudeM: 0,
      transponder: true,
      adsb: true,
      phase: 'patrol',
      path: road,
      s: closestAlong(road, pos),
      reverse: false,
      waitUntil: 0,
      eastbound,
      note,
    }
  }

  /** Apply the equipment switches (VAN2's transponder). */
  applyEquipment() {
    const van = this.get('VAN2')
    if (van) {
      const had = van.transponder
      van.transponder = !this.env.noTransponder
      van.adsb = !this.env.noTransponder
      van.note = this.env.noTransponder ? 'Maintenance van, no transponder' : 'Maintenance van'
      // A van that never had a transponder was never identified: start its track afresh.
      if (had && !van.transponder) {
        this.tracks.delete('VAN2')
        this.mlatPlots.delete('VAN2')
        this.adsbPlots.delete('VAN2')
      }
    }
  }

  get(id: string | null | undefined): SurfaceObject | undefined {
    return this.objects.find((o) => o.id === id)
  }

  get rain(): RainState {
    return { rateMmH: this.env.heavyRain ? HEAVY_RAIN_MMH : 0, circularPolarisation: this.env.circularPol }
  }

  /** Receivers that are working. */
  workingReceivers() {
    return MLAT_RECEIVERS.filter((r) => !(this.env.mlatFailure && r.id === FAILING_RECEIVER))
  }

  /** Receivers that can hear a transmitter at this point (range and buildings). */
  receiversHearing(p: Vec2) {
    return this.workingReceivers().filter((r) => Math.hypot(r.pos.x - p.x, r.pos.y - p.y) <= MLAT_RANGE_M && !BUILDINGS.some((b) => segmentHitsBox(r.pos, p, b.box)))
  }

  // -------------------------------------------------------------------------
  // Traffic
  // -------------------------------------------------------------------------

  /** Aircraft landing (on final or rolling out) or using the runway for take-off. */
  movements(): RunwayMovement[] {
    const out: RunwayMovement[] = []
    for (const o of this.objects) {
      if (o.phase === 'final') {
        const d = RWY.thresholdX - o.pos.x
        out.push({ id: o.id, kind: 'landing', distanceToThresholdM: d, timeToThresholdS: d / Math.max(o.speedMs, 1), onRunway: false })
      } else if (o.phase === 'rollout' || (o.phase === 'taxi-in' && o.pos.y < STOP_BAR_Y + VACATED_MARGIN_M)) {
        // A landing aircraft stays "the landing aircraft" until it is well clear of the holding line.
        out.push({ id: o.id, kind: 'landing', distanceToThresholdM: RWY.thresholdX - o.pos.x, onRunway: onRunway(o.pos, RWY) })
      } else if (['lineup', 'lined', 'takeoff', 'rejected', 'backtrack'].includes(o.phase) || (o.phase === 'climb' && o.altitudeM < 5)) {
        out.push({ id: o.id, kind: 'takeoff', onRunway: onRunway(o.pos, RWY) })
      }
    }
    return out
  }

  /** Something on the ground inside the runway protected area, other than `exceptId` and cleared aircraft. */
  runwayBlocked(exceptId: string): SurfaceObject | null {
    for (const o of this.objects) {
      if (o.id === exceptId || o.altitudeM > 5) continue
      if (o.phase === 'final' || o.phase === 'goaround' || o.phase === 'climb') continue
      if (inRunwayProtectedArea(o.pos, RWY)) return o
    }
    return null
  }

  /** Seconds until the next arrival (flying or scheduled) crosses the threshold. */
  nextThresholdS(): number {
    let t = this.nextArrivalS + FINAL_START_M / ktToMs(APPROACH_KT) - this.timeS
    for (const o of this.objects) {
      if (o.phase === 'final') t = Math.min(t, (RWY.thresholdX - o.pos.x) / Math.max(o.speedMs, 1))
      if (o.phase === 'rollout') t = Math.min(t, 0)
    }
    return t
  }

  private spawnArrival() {
    this.flightNo += 10
    const n = this.flightNo
    const standId = (n / 10) % 2 === 0 ? 'S3' : 'S4'
    const o = this.aircraft(`CNS${n}`, 'medium', { x: RWY.thresholdX - FINAL_START_M, y: 0 }, 90)
    o.phase = 'final'
    o.speedMs = ktToMs(APPROACH_KT)
    o.altitudeM = glidePathHeightM(FINAL_START_M)
    o.stand = standId
    this.objects.push(o)
  }

  private log(text: string) {
    this.events.push({ timeS: this.timeS, text })
    if (this.events.length > 6) this.events.shift()
  }

  /** Distance along the object's path to the nearest thing in the way, m (Infinity if clear). */
  obstacleAhead(o: SurfaceObject): number {
    if (!o.path) return Infinity
    const look = brakingDistanceM(o.speedMs, o.kind === 'vehicle' ? 3 : 1.5) + 80
    const end = Math.min(o.path.length, o.s + look)
    let best = Infinity
    for (const other of this.objects) {
      if (other === o || other.altitudeM > 5) continue
      if (other.phase === 'cargo-away') continue
      // Aircraft give way only to aircraft and to vehicles that have stopped on their path; vehicles give way to everything.
      const relevant = o.kind === 'vehicle' || other.kind === 'aircraft' || other.phase === 'held' || other.phase === 'to-runway'
      if (!relevant) continue
      const clearance = o.kind === 'aircraft' && other.kind === 'aircraft' ? 45 : o.kind === 'aircraft' ? 30 : 14
      // Quick reject.
      if (Math.hypot(other.pos.x - o.pos.x, other.pos.y - o.pos.y) > look + clearance + 40) continue
      for (let s = o.s + 4; s <= end; s += 6) {
        const p = pointAt(o.path, s).pos
        if (Math.hypot(p.x - other.pos.x, p.y - other.pos.y) < clearance) {
          best = Math.min(best, s - o.s)
          break
        }
      }
    }
    return best
  }

  /**
   * Move along the current path. Target speed respects the cruise speed, bends,
   * the end of the path (when stopping there) and anything in the way.
   */
  private follow(o: SurfaceObject, dt: number, cruiseKt: number, accel: number, decel: number, stopAtEnd: boolean) {
    if (!o.path) return
    let target = ktToMs(Math.min(cruiseKt, turnSpeedLimitKt(o.path, o.s, 60, cruiseKt)))
    if (stopAtEnd) target = Math.min(target, stopSpeedLimitMs(o.path.length - o.s, decel * 0.8))
    const obs = this.obstacleAhead(o)
    if (Number.isFinite(obs)) target = Math.min(target, stopSpeedLimitMs(obs - 8, MAX_BRAKE * 0.7))
    o.speedMs = approachSpeed(o.speedMs, target, dt, accel, Math.max(decel, Number.isFinite(obs) ? MAX_BRAKE : decel))
    o.s = Math.min(o.path.length, o.s + o.speedMs * dt)
    this.placeOnPath(o, dt)
  }

  private placeOnPath(o: SurfaceObject, dt: number) {
    if (!o.path) return
    const at = pointAt(o.path, o.s)
    o.pos = at.pos
    const want = o.reverse ? normalize360(at.trackDeg + 180) : at.trackDeg
    // Heading follows the track smoothly (ground turns, pushback swing).
    const maxTurn = (o.kind === 'vehicle' ? 60 : 25) * dt
    const d = angleDiff(o.headingDeg, want)
    o.headingDeg = normalize360(o.headingDeg + Math.max(-maxTurn, Math.min(maxTurn, d)))
  }

  private atEnd(o: SurfaceObject) {
    return !!o.path && o.s >= o.path.length - 0.5 && o.speedMs < 0.3
  }

  /** May this aircraft push back now? (no arrival heading for the apron, taxilane clear nearby) */
  private pushbackClear(o: SurfaceObject): boolean {
    for (const a of this.objects) {
      if (a === o || a.kind !== 'aircraft') continue
      if (a.phase === 'rollout' || a.phase === 'taxi-in') return false
      if ((a.phase === 'taxi-out' || a.phase === 'pushback') && Math.abs(a.pos.y - TAXILANE_Y) < 40 && Math.abs(a.pos.x - o.pos.x) < 260) return false
    }
    return true
  }

  /** Line-up clearance: runway clear and enough time before the next arrival reaches the threshold. */
  private lineupClear(o: SurfaceObject): boolean {
    return !this.runwayBlocked(o.id) && this.nextThresholdS() >= 100
  }

  private stepObject(o: SurfaceObject, dt: number) {
    switch (o.phase) {
      case 'final': {
        const d = RWY.thresholdX - o.pos.x
        o.speedMs = approachSpeed(o.speedMs, ktToMs(d < 1500 ? TOUCHDOWN_KT : APPROACH_KT), dt, 0.5, 0.35)
        o.pos = { x: o.pos.x + o.speedMs * dt, y: 0 }
        o.headingDeg = 90
        const dd = RWY.thresholdX - o.pos.x
        // Flare over the last 300 m to touchdown.
        o.altitudeM = dd >= 0 ? glidePathHeightM(dd) : Math.max(0, 15 * (1 - -dd / (TOUCHDOWN_X - RWY.thresholdX)))
        // Inside 1 NM the aircraft goes around if the runway is not clear (until touchdown).
        const blocker = dd <= GO_AROUND_CHECK_M ? this.runwayBlocked(o.id) : null
        if (blocker) {
          o.phase = 'goaround'
          this.log(`${o.callsign} went around: ${blocker.callsign} was inside the runway protected area.`)
          break
        }
        if (o.pos.x >= TOUCHDOWN_X) {
          o.phase = 'rollout'
          o.altitudeM = 0
          o.path = arrivalPath(STANDS[o.stand ?? 'S3'])
          o.s = 0
        }
        break
      }
      case 'goaround':
      case 'climb': {
        const vTarget = ktToMs(o.phase === 'goaround' ? 160 : 170)
        o.speedMs = approachSpeed(o.speedMs, vTarget, dt, 1.5, 1)
        o.pos = { x: o.pos.x + o.speedMs * dt, y: 0 }
        o.headingDeg = 90
        // About a 7–10% climb gradient.
        o.altitudeM += o.speedMs * (o.phase === 'goaround' ? 0.07 : 0.1) * dt
        if (o.pos.x > 7000) o.phase = 'static' // removed below
        break
      }
      case 'rollout': {
        const sTurn = turnoffAlong(o.path!)
        const vTurn = ktToMs(15)
        let target = o.s < sTurn ? Math.sqrt(vTurn * vTurn + 2 * ROLLOUT_DECEL * (sTurn - o.s)) : vTurn
        const obs = this.obstacleAhead(o)
        if (Number.isFinite(obs)) target = Math.min(target, stopSpeedLimitMs(obs - 10, MAX_BRAKE * 0.95))
        o.speedMs = approachSpeed(o.speedMs, target, dt, 1, MAX_BRAKE)
        o.s = Math.min(o.path!.length, o.s + o.speedMs * dt)
        this.placeOnPath(o, dt)
        if (o.s > sTurn + 45) o.phase = 'taxi-in'
        break
      }
      case 'taxi-in':
        this.follow(o, dt, 16, 0.8, 1.2, true)
        if (this.atEnd(o)) {
          o.phase = 'parked'
          o.waitUntil = this.timeS + TURNAROUND_S
          o.speedMs = 0
        }
        break
      case 'parked':
        if (this.timeS >= o.waitUntil && this.pushbackClear(o)) {
          o.phase = 'pushback'
          o.path = pushbackWestPath(STANDS[o.stand ?? 'S3'])
          o.s = 0
          o.reverse = true
          // Turnaround done: the aircraft now flies as the next flight number.
          o.callsign = o.id.replace(/0$/, '1')
        }
        break
      case 'pushback':
        this.follow(o, dt, 3, 0.3, 0.5, true)
        if (this.atEnd(o)) {
          o.phase = 'taxi-out'
          o.reverse = false
          o.path = taxiOutPath(o.pos)
          o.s = 0
        }
        break
      case 'taxi-out':
        this.follow(o, dt, TAXI_KT, 0.8, 1.2, true)
        if (this.atEnd(o)) {
          o.phase = 'holding'
          o.speedMs = 0
        }
        break
      case 'holding':
        if (this.lineupClear(o)) {
          this.cleared.add(o.id)
          o.phase = 'lineup'
          o.path = lineupPath()
          o.s = 0
        }
        break
      case 'lineup':
        this.follow(o, dt, 8, 0.6, 1, true)
        if (this.atEnd(o)) {
          o.phase = 'lined'
          o.waitUntil = this.timeS + 6
        }
        break
      case 'lined':
        if (this.timeS >= o.waitUntil && !this.runwayBlocked(o.id) && this.nextThresholdS() >= 60) {
          o.phase = 'takeoff'
          o.path = takeoffPath(o.pos)
          o.s = 0
        }
        break
      case 'takeoff': {
        const vr = ktToMs(ROTATE_KT)
        const obs = this.obstacleAhead(o)
        const toVr = (vr * vr - o.speedMs * o.speedMs) / (2 * TAKEOFF_ACCEL)
        if (Number.isFinite(obs) && obs < toVr + 150) {
          o.phase = 'rejected'
          this.log(`${o.callsign} rejected its take-off: something was on the runway ahead.`)
          break
        }
        o.speedMs += TAKEOFF_ACCEL * dt
        o.s = Math.min(o.path!.length, o.s + o.speedMs * dt)
        this.placeOnPath(o, dt)
        if (o.speedMs >= vr) {
          o.phase = 'climb'
          o.path = null
          this.cleared.delete(o.id)
        }
        break
      }
      case 'rejected': {
        const obs = this.obstacleAhead(o)
        const target = Number.isFinite(obs) ? Math.min(0, stopSpeedLimitMs(obs - 10, MAX_BRAKE)) : 0
        o.speedMs = approachSpeed(o.speedMs, target, dt, 0, MAX_BRAKE)
        o.s = Math.min(o.path!.length, o.s + o.speedMs * dt)
        this.placeOnPath(o, dt)
        if (o.speedMs <= 0.01 && !Number.isFinite(this.obstacleAhead(o))) {
          o.phase = 'backtrack'
          o.path = backtrackPath(o.pos)
          o.s = 0
        }
        break
      }
      case 'backtrack':
        this.follow(o, dt, 15, 0.6, 1, true)
        if (this.atEnd(o)) {
          o.phase = 'lined'
          o.waitUntil = this.timeS + 10
        }
        break
      case 'cargo-away':
        if (this.timeS >= o.waitUntil) {
          o.phase = 'cargo-in'
          o.path = cargoInPath()
          o.s = 0
          o.speedMs = ktToMs(12)
        }
        break
      case 'cargo-in':
        this.follow(o, dt, 16, 0.6, 1, true)
        if (this.atEnd(o)) {
          o.phase = 'cargo-parked'
          o.waitUntil = this.timeS + 120
        }
        break
      case 'cargo-parked':
        if (this.timeS >= o.waitUntil && this.pushbackClear(o)) {
          o.phase = 'cargo-pushback'
          o.path = pushbackEastPath(STANDS.S6)
          o.s = 0
          o.reverse = true
        }
        break
      case 'cargo-pushback':
        this.follow(o, dt, 3, 0.3, 0.5, true)
        if (this.atEnd(o)) {
          o.phase = 'cargo-out'
          o.reverse = false
          o.path = cargoOutPath(o.pos)
          o.s = 0
        }
        break
      case 'cargo-out':
        this.follow(o, dt, 16, 0.6, 1, true)
        if (this.atEnd(o) || o.s >= o.path!.length - 1) {
          o.phase = 'cargo-away'
          o.waitUntil = this.timeS + 60
          o.speedMs = 0
          o.headingDeg = 270
        }
        break
      case 'patrol': {
        const cruise = o.id === 'OPS1' ? VEHICLE_KT : APRON_VEHICLE_KT
        this.follow(o, dt, cruise, 1.5, 2.5, true)
        if (this.atEnd(o)) {
          // U-turn at the end of the road.
          o.eastbound = !o.eastbound
          o.path = o.id === 'OPS1' ? southRoadPath(o.eastbound) : serviceRoadPath(o.eastbound)
          o.s = 0
        }
        break
      }
      case 'to-runway':
        this.follow(o, dt, VEHICLE_KT, 1.5, 2.5, true)
        if (this.atEnd(o)) {
          o.phase = 'held'
          o.speedMs = 0
        }
        break
      case 'return':
        this.follow(o, dt, VEHICLE_KT, 1.5, 2.5, true)
        if (this.atEnd(o)) this.resumePatrol(o)
        break
      case 'held':
      case 'static':
        o.speedMs = 0
        break
    }
  }

  private resumePatrol(o: SurfaceObject) {
    const road = o.id === 'OPS1' ? southRoadPath(o.eastbound ?? true) : serviceRoadPath(o.eastbound ?? true)
    o.phase = 'patrol'
    o.path = road
    o.s = closestAlong(road, o.pos)
  }

  // -------------------------------------------------------------------------
  // Learner actions
  // -------------------------------------------------------------------------

  /** A vehicle dragged by the learner stops where it is dropped (never inside a building). */
  dragVehicle(id: string, pos: Vec2) {
    const o = this.get(id)
    if (!o || o.kind !== 'vehicle') return
    if (BUILDINGS.some((b) => insideBox(pos, b.box, 4))) return
    o.phase = 'held'
    o.path = null
    o.speedMs = 0
    o.pos = { x: Math.max(-1950, Math.min(1950, pos.x)), y: Math.max(-600, Math.min(1000, pos.y)) }
  }

  /** Drive a vehicle from its road onto the runway centreline (keyboard alternative to dragging). */
  driveOntoRunway(id: string, x?: number) {
    const o = this.get(id)
    if (!o || o.kind !== 'vehicle') return
    const entry = x ?? Math.max(-1100, Math.min(1300, o.pos.x))
    o.phase = 'to-runway'
    o.path = pathAround(toRunwayPath({ ...o.pos }, entry).points)
    o.s = 0
  }

  /** Send every vehicle back to its road. */
  sendVehiclesBack() {
    for (const o of this.objects) {
      if (o.kind !== 'vehicle' || o.phase === 'patrol') continue
      const roadY = o.id === 'OPS1' ? SOUTH_ROAD_Y : SERVICE_ROAD_Y
      const [a, b] = o.id === 'OPS1' ? SOUTH_ROAD_X : SERVICE_ROAD_X
      const target = { x: Math.max(a, Math.min(b, o.pos.x)), y: roadY }
      o.phase = 'return'
      o.path = pathBetween(o.pos, target)
      o.s = 0
    }
  }

  /** Put a vehicle back on its road at a given x, driving (used by "Set it up"). */
  placeOnRoad(id: string, x: number) {
    const o = this.get(id)
    if (!o || o.kind !== 'vehicle') return
    const roadY = o.id === 'OPS1' ? SOUTH_ROAD_Y : SERVICE_ROAD_Y
    const [a, b] = o.id === 'OPS1' ? SOUTH_ROAD_X : SERVICE_ROAD_X
    o.pos = { x: Math.max(a, Math.min(b, x)), y: roadY }
    o.speedMs = 0
    this.resumePatrol(o)
    o.headingDeg = o.eastbound ? 90 : 270
  }

  /** Bring the next arrival forward so it is on final now (the "set it up" jump). */
  arrivalNow() {
    if (this.objects.some((o) => o.phase === 'final')) return
    this.nextArrivalS = this.timeS
  }

  // -------------------------------------------------------------------------
  // Main step
  // -------------------------------------------------------------------------

  step(dt: number) {
    if (dt <= 0) return
    this.timeS += dt
    if (this.timeS >= this.nextArrivalS) {
      this.spawnArrival()
      this.nextArrivalS += ARRIVAL_PERIOD_S
      if (this.nextArrivalS < this.timeS) this.nextArrivalS = this.timeS + ARRIVAL_PERIOD_S
    }
    for (const o of this.objects) this.stepObject(o, dt)
    // Aircraft that have left the airport disappear.
    this.objects = this.objects.filter((o) => !(o.kind === 'aircraft' && o.phase === 'static' && o.pos.x > 6900))
    for (const id of [...this.cleared]) if (!this.get(id)) this.cleared.delete(id)
    // Stop bars: switched off only for an aircraft cleared to line up at A1.
    this.stopBars.A1 = !this.objects.some((o) => o.phase === 'lineup' && this.cleared.has(o.id))
    if (!this.sensorsOn) return
    this.sweepSmr(dt)
    while (this.timeS >= this.nextMlatS) {
      this.runMlat()
      this.nextMlatS += MLAT_INTERVAL_S
    }
    while (this.timeS >= this.nextAdsbS) {
      this.runAdsb()
      this.nextAdsbS += ADSB_INTERVAL_S
    }
    this.pruneTracks()
    this.alert = runwayIncursion(RWY, this.movements(), this.surveillanceTargets(), this.cleared)
  }

  // -------------------------------------------------------------------------
  // Sensors
  // -------------------------------------------------------------------------

  /** Objects the SMR can illuminate (on the surface or very low). */
  private smrVisible(o: SurfaceObject) {
    return o.phase !== 'cargo-away' && o.altitudeM <= SMR_MAX_HEIGHT_M && Math.hypot(o.pos.x - SMR_SITE.x, o.pos.y - SMR_SITE.y) <= this.smr.maxRangeM
  }

  private paint(p: Vec2, strength: number, kind: ScopePaint['kind']) {
    // Nobody is reading the paints (display scrolled away): keep only the latest few turns.
    if (this.pending.length > MAX_PENDING_PAINTS) this.pending.splice(0, this.pending.length - MAX_PENDING_PAINTS / 2)
    this.pending.push({
      x: metresToNm(p.x - SMR_SITE.x),
      y: metresToNm(p.y - SMR_SITE.y),
      strength,
      kind,
      widthDeg: this.smr.beamWidthDeg,
      depthNm: metresToNm(smrRangeResolutionM(this.smr)),
    })
  }

  private addToPlot(key: string, objectId: string, ghost: boolean, p: Vec2) {
    const a = this.acc.get(key) ?? { sx: 0, sy: 0, n: 0, objectId, ghost }
    a.sx += p.x
    a.sy += p.y
    a.n++
    this.acc.set(key, a)
  }

  private sweepSmr(dt: number) {
    const span = (360 * dt) / this.smr.rotationPeriodS
    const from = this.smrAz
    const rain = this.rain
    for (const o of this.objects) {
      if (!this.smrVisible(o)) continue
      for (const sp of scatterPointsWorld(o.shape, o.pos, o.headingDeg)) {
        const az = bearingDeg(SMR_SITE, sp.pos)
        if (sweepCovers(az, from, span)) {
          const r = Math.hypot(sp.pos.x - SMR_SITE.x, sp.pos.y - SMR_SITE.y)
          if (this.rand() < smrPointDetection(r, sp.rcsDb, rain)) {
            this.paint(sp.pos, 0.95, 'target')
            this.addToPlot(o.id, o.id, false, sp.pos)
          }
        }
        if (this.env.reflections) {
          const g = ghostPosition(sp.pos, SMR_SITE, TERMINAL_FACE)
          if (!g) continue
          const gaz = bearingDeg(SMR_SITE, g.ghost)
          if (!sweepCovers(gaz, from, span)) continue
          const gr = Math.hypot(g.ghost.x - SMR_SITE.x, g.ghost.y - SMR_SITE.y)
          if (this.rand() < smrPointDetection(gr, sp.rcsDb - REFLECTION_LOSS_DB, rain)) {
            this.paint(g.ghost, 0.8, 'false')
            this.addToPlot(`ghost:${o.id}`, o.id, true, g.ghost)
          }
        }
      }
    }
    // Rain echoes fill the whole coverage.
    if (rain.rateMmH > 0) {
      const n = Math.floor(span * 2.2 + this.rand())
      for (let k = 0; k < n; k++) {
        const az = from + this.rand() * span
        const r = 60 + this.rand() * 2600
        const s = rainClutterStrength(r, rain) * (0.4 + 0.6 * this.rand())
        if (s < 0.04) continue
        const a = (az * Math.PI) / 180
        this.paint({ x: SMR_SITE.x + Math.sin(a) * r, y: SMR_SITE.y + Math.cos(a) * r }, s, 'weather')
      }
    }
    const next = from + span
    if (next >= 360) this.finishRotation()
    this.smrAz = normalize360(next)
  }

  /** One turn complete: every object painted this turn becomes one SMR plot (its centroid). */
  private finishRotation() {
    for (const [key, a] of this.acc) {
      const plot: SmrPlot = { key, objectId: a.objectId, ghost: a.ghost, pos: { x: a.sx / a.n, y: a.sy / a.n }, points: a.n, timeS: this.timeS }
      this.smrPlots.set(key, plot)
      if (this.layers.smr) this.update(key, a.objectId, a.ghost, 'smr', plot.pos, null)
    }
    this.acc.clear()
    for (const [k, p] of this.smrPlots) if (this.timeS - p.timeS > 3) this.smrPlots.delete(k)
  }

  /** Height of the transponder antenna above the airport, m. */
  private antennaHeight(o: SurfaceObject) {
    return o.altitudeM + (o.kind === 'aircraft' ? 5 : 2)
  }

  private runMlat() {
    for (const o of this.objects) {
      if (!o.transponder || o.phase === 'cargo-away') continue
      const rx = this.receiversHearing(o.pos)
      if (rx.length < 3) continue
      const h = this.antennaHeight(o)
      const p = { x: o.pos.x, y: o.pos.y, z: h }
      const enu = rx.map((r) => ({ x: r.pos.x, y: r.pos.y, z: r.heightM }))
      const t = enu.map((r) => arrivalTimeUs(p, r, 100, 0, gaussian(this.rand) * SURFACE_MLAT_NOISE_NS))
      const prev = this.mlatPlots.get(o.id)
      const prefer = prev ? { x: prev.pos.x, y: prev.pos.y, z: h } : undefined
      const sol = solveTdoa(enu, t, { heightM: h, starts: prefer ? [prefer] : [], prefer, noiseM: 1.5, quick: true })
      // With two possible positions and no track to choose between them, there is no plot.
      if (!sol.position || (sol.status === 'ambiguous' && !prefer)) continue
      const plot: SensorPlot = { objectId: o.id, pos: { x: sol.position.x, y: sol.position.y }, callsign: o.callsign, timeS: this.timeS, receivers: rx.length }
      this.mlatPlots.set(o.id, plot)
      if (this.layers.mlat) this.update(o.id, o.id, false, 'mlat', plot.pos, o.callsign)
    }
    for (const [k, p] of this.mlatPlots) if (this.timeS - p.timeS > 3 || !this.get(k)) this.mlatPlots.delete(k)
  }

  private runAdsb() {
    for (const o of this.objects) {
      if (!o.adsb || !o.transponder || o.phase === 'cargo-away') continue
      const pos = { x: o.pos.x + gaussian(this.rand) * SURFACE_ADSB_NOISE_M, y: o.pos.y + gaussian(this.rand) * SURFACE_ADSB_NOISE_M }
      const plot: SensorPlot = { objectId: o.id, pos, callsign: o.callsign, timeS: this.timeS }
      this.adsbPlots.set(o.id, plot)
      if (this.layers.adsb) this.update(o.id, o.id, false, 'adsb', pos, o.callsign)
    }
    for (const [k, p] of this.adsbPlots) if (this.timeS - p.timeS > 3 || !this.get(k)) this.adsbPlots.delete(k)
  }

  /** Paints collected since the last call (for the display). */
  takePaints(): ScopePaint[] {
    const p = this.pending
    this.pending = []
    return p
  }

  // -------------------------------------------------------------------------
  // Tracker (fusion)
  // -------------------------------------------------------------------------

  private update(key: string, objectId: string, ghost: boolean, src: Source, pos: Vec2, identity: string | null) {
    let tr = this.tracks.get(key)
    if (!tr) {
      tr = { key, objectId, ghost, identity: null, pos: { ...pos }, last: {}, lastPos: {}, lastUpdateS: this.timeS }
      this.tracks.set(key, tr)
    }
    tr.last[src] = this.timeS
    tr.lastPos[src] = { ...pos }
    tr.lastUpdateS = this.timeS
    // Identity comes from the transponder (MLAT decodes Mode S, ADS-B carries the callsign) and is kept.
    if (identity) tr.identity = identity
    tr.pos = this.bestPosition(tr)
  }

  /** The most accurate fresh source wins: ADS-B, then MLAT, then SMR. */
  private bestPosition(tr: FusedTrack): Vec2 {
    const fresh = (s: Source, maxAge: number) => tr.last[s] !== undefined && this.timeS - (tr.last[s] as number) <= maxAge
    if (fresh('adsb', 1.2)) return tr.lastPos.adsb!
    if (fresh('mlat', 1.6)) return tr.lastPos.mlat!
    return tr.lastPos.smr ?? tr.lastPos.mlat ?? tr.lastPos.adsb ?? tr.pos
  }

  /** Sources that updated this track recently. */
  trackSources(tr: FusedTrack): Source[] {
    const maxAge: Record<Source, number> = { smr: 2.5, mlat: 2.5, adsb: 1.6 }
    return (['smr', 'mlat', 'adsb'] as Source[]).filter((s) => tr.last[s] !== undefined && this.timeS - (tr.last[s] as number) <= maxAge[s] && this.layers[s])
  }

  /** Seconds since the track last had any data. */
  trackAge(tr: FusedTrack) {
    return this.timeS - tr.lastUpdateS
  }

  private pruneTracks() {
    for (const [k, tr] of this.tracks) {
      if (this.timeS - tr.lastUpdateS > 4 || !this.get(tr.objectId)) this.tracks.delete(k)
    }
  }

  /** What the A-SMGCS "sees" on the ground: its fused tracks. */
  surveillanceTargets(): SurfaceTarget[] {
    const out: SurfaceTarget[] = []
    for (const tr of this.tracks.values()) {
      if (!this.trackSources(tr).length) continue
      const o = this.get(tr.objectId)
      const onGround = tr.ghost ? true : (o?.altitudeM ?? 0) < 5
      out.push({ id: tr.ghost ? tr.key : tr.objectId, pos: tr.pos, onGround, name: tr.identity ?? 'an unidentified target' })
    }
    return out
  }

  /** Clear the tracker when the layers in use change (tracks rebuild within a second). */
  setLayers(layers: SurfaceLayers) {
    const changed = layers.smr !== this.layers.smr || layers.mlat !== this.layers.mlat || layers.adsb !== this.layers.adsb
    this.layers = layers
    if (changed) {
      for (const tr of this.tracks.values()) {
        for (const s of ['smr', 'mlat', 'adsb'] as Source[]) {
          if (!layers[s]) {
            delete tr.last[s]
            delete tr.lastPos[s]
          }
        }
        if (!Object.keys(tr.last).length) this.tracks.delete(tr.key)
        else tr.lastUpdateS = Math.max(...(Object.values(tr.last) as number[]))
      }
    }
  }

  /** Name to show for a surveillance target id. */
  nameOf(id: string): string {
    const tr = this.tracks.get(id) ?? [...this.tracks.values()].find((t) => t.objectId === id && !t.ghost)
    return tr?.identity ?? 'an unidentified target'
  }
}

/**
 * A drivable route from a to b: straight, unless a building is in the way, in
 * which case it goes round the building's corners (15 m clear of the walls).
 */
export function pathAround(points: Vec2[]): Path {
  const pts = points.map((p) => ({ ...p }))
  for (let guard = 0; guard < 8; guard++) {
    let fixed = false
    for (let i = 0; i < pts.length - 1 && !fixed; i++) {
      const a = pts[i]
      const b = pts[i + 1]
      const hit = BUILDINGS.find((bd) => segmentHitsBox(a, b, bd.box))
      if (!hit) continue
      const m = 15
      const bx = hit.box
      const corners: Vec2[] = [
        { x: bx.minX - m, y: bx.minY - m },
        { x: bx.maxX + m, y: bx.minY - m },
        { x: bx.maxX + m, y: bx.maxY + m },
        { x: bx.minX - m, y: bx.maxY + m },
      ]
      const nearest = (p: Vec2) => corners.reduce((bi, c, k) => (Math.hypot(c.x - p.x, c.y - p.y) < Math.hypot(corners[bi].x - p.x, corners[bi].y - p.y) ? k : bi), 0)
      const ia = nearest(a)
      const ib = nearest(b)
      // Walk round the box both ways and keep the shorter way.
      const walk = (dir: 1 | -1) => {
        const out: Vec2[] = [corners[ia]]
        let k = ia
        while (k !== ib) {
          k = (k + dir + 4) % 4
          out.push(corners[k])
        }
        return out
      }
      const len = (w: Vec2[]) => w.reduce((s, c, k) => s + Math.hypot(c.x - (k ? w[k - 1] : a).x, c.y - (k ? w[k - 1] : a).y), 0) + Math.hypot(b.x - w[w.length - 1].x, b.y - w[w.length - 1].y)
      const cw = walk(1)
      const ccw = walk(-1)
      pts.splice(i + 1, 0, ...(len(cw) <= len(ccw) ? cw : ccw))
      fixed = true
    }
    if (!fixed) break
  }
  return makePath(pts)
}

function pathBetween(a: Vec2, b: Vec2): Path {
  return pathAround([a, b])
}

/** Plain-language phase for labels on the truth map. */
export function phaseText(o: SurfaceObject): string {
  switch (o.phase) {
    case 'final':
      return 'on final'
    case 'goaround':
      return 'going around'
    case 'rollout':
      return 'landing'
    case 'taxi-in':
    case 'cargo-in':
      return 'taxiing in'
    case 'parked':
    case 'cargo-parked':
    case 'static':
      return 'parked'
    case 'pushback':
    case 'cargo-pushback':
      return 'pushing back'
    case 'taxi-out':
    case 'cargo-out':
      return 'taxiing out'
    case 'holding':
      return 'holding at A1'
    case 'lineup':
    case 'lined':
      return 'lined up'
    case 'takeoff':
      return 'taking off'
    case 'rejected':
      return 'rejected take-off'
    case 'backtrack':
      return 'backtracking'
    case 'climb':
      return 'airborne'
    case 'patrol':
    case 'return':
      return 'driving'
    case 'to-runway':
      return 'driving onto the runway'
    case 'held':
      return 'stopped'
    case 'cargo-away':
      return 'at the cargo area'
  }
}
