/**
 * MLAT / WAM scenario engine. Aircraft fly around a network of ground
 * receivers. Once per second each aircraft's transponder sends a 1090 MHz
 * signal; every receiver in use time-stamps it (with a little noise, and a
 * clock error if one is set), and the pure solver in src/core/mlat.ts turns
 * the time differences into a position.
 */

import { bearingVector, distanceNm, type Vec2, type Vec3 } from '@/core/geometry'
import {
  arrivalTimeUs,
  C_M_PER_NS,
  enuMToWorld,
  expectedErrorM,
  isNearlyCollinear,
  mlatDop,
  solveTdoa,
  travelTimeUsBetween,
  worldToEnuM,
  type Dop,
  type MlatSolution,
} from '@/core/mlat'
import { gaussian, mulberry32 } from '@/core/random'
import { METRES_PER_FT, METRES_PER_NM } from '@/core/units'
import { createAircraft, stepAircraftFine, terrainElevationFt, type Aircraft } from '@/core/world'

export type ReceiverId = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6'

export interface MlatReceiver {
  id: ReceiverId
  name: string
  /** Map position, NM. */
  pos: Vec2
  /** Antenna mast above the ground, ft. */
  mastFt: number
  /** Switched on by the learner (added to the network). */
  inUse: boolean
}

export interface MlatEnv {
  /** Receiver R3 has failed and stops sending time stamps. */
  receiverFailed: boolean
  /** All receivers moved into a straight line. */
  badGeometry: boolean
  /** CNS303 flies far outside the receiver network. */
  outside: boolean
  /** CNS101 broadcasts a false ADS-B position. */
  spoof: boolean
}

export interface MlatParams {
  /** Use the aircraft's reported pressure altitude (solve x, y only). */
  useAltitude: boolean
  /** Random time-stamping error of every receiver, ns (1σ). */
  timingNoiseNs: number
  /** Fixed clock error of receiver R2, ns. */
  clockErrorNs: number
}

export const FAILED_RECEIVER: ReceiverId = 'R3'
export const CLOCK_RECEIVER: ReceiverId = 'R2'
export const SPOOFED_AIRCRAFT = 'CNS101'
export const OUTSIDE_AIRCRAFT = 'CNS303'

/** One fix per second per aircraft. */
// TODO(expert-review): typical WAM update interval (about 1 s) and receiver time-stamping noise (15 ns rms used here).
export const EMIT_INTERVAL_S = 1
/** Timing error the "clock error" failure switches on, ns (≈ 90 m of range). */
export const FAILURE_CLOCK_ERROR_NS = 300
/** How far off the spoofed ADS-B position is. */
export const SPOOF_OFFSET = { distanceNm: 6, bearingDeg: 45 }
/** Mode S reports pressure altitude in 25 ft steps. */
export const ALTITUDE_STEP_FT = 25
/** GNSS position noise of a genuine ADS-B report, m (1σ). */
// TODO(expert-review): representative ADS-B position accuracy (NACp 9–10 is better than 30 m / 10 m, 95%).
const ADSB_NOISE_M = 5

export const DEFAULT_ENV: MlatEnv = { receiverFailed: false, badGeometry: false, outside: false, spoof: false }
export const DEFAULT_PARAMS: MlatParams = { useAltitude: true, timingNoiseNs: 15, clockErrorNs: 0 }

export const DEFAULT_RECEIVERS: MlatReceiver[] = [
  { id: 'R1', name: 'Airport', pos: { x: 1.2, y: 1.2 }, mastFt: 60, inUse: true },
  { id: 'R2', name: 'Mount Sentinel', pos: { x: -18, y: 8 }, mastFt: 40, inUse: true },
  { id: 'R3', name: 'Coast road', pos: { x: 17, y: 9 }, mastFt: 60, inUse: true },
  { id: 'R4', name: 'South farm', pos: { x: 5, y: -18 }, mastFt: 40, inUse: true },
  { id: 'R5', name: 'West road', pos: { x: -20, y: -10 }, mastFt: 40, inUse: true },
  { id: 'R6', name: 'Harbour', pos: { x: 32, y: -14 }, mastFt: 60, inUse: false },
]

/** Receivers along one straight east–west road: the "bad geometry" layout. */
export const LINE_POSITIONS: Record<ReceiverId, Vec2> = {
  R1: { x: 0, y: -3 },
  R2: { x: -24, y: -3 },
  R3: { x: 24, y: -3 },
  R4: { x: 12, y: -3 },
  R5: { x: -12, y: -3 },
  R6: { x: 32, y: -3 },
}

const INSIDE_ROUTE_303: Vec2[] = [
  { x: 4, y: -7 },
  { x: -7, y: -3 },
  { x: -5, y: 5 },
  { x: 6, y: 3 },
]
const OUTSIDE_ROUTE_303: Vec2[] = [
  { x: 37, y: -32 },
  { x: 42, y: -20 },
  { x: 40, y: -42 },
]

export function createScenario(env: MlatEnv = DEFAULT_ENV): Aircraft[] {
  const route = (a: Aircraft, waypoints: Vec2[]): Aircraft => ({ ...a, mode: { kind: 'route', waypoints, index: 0, loop: true } })
  const r303 = env.outside ? OUTSIDE_ROUTE_303 : INSIDE_ROUTE_303
  return [
    route(createAircraft({ id: 'CNS101', pos: { x: -10, y: 8 }, altitudeFt: 9000, headingDeg: 90, speedKt: 250 }), [
      { x: 10, y: 8 },
      { x: 10, y: -10 },
      { x: -10, y: -10 },
      { x: -10, y: 8 },
    ]),
    route(createAircraft({ id: 'CNS202', category: 'heavy', pos: { x: -42, y: 36 }, altitudeFt: 24000, headingDeg: 135, speedKt: 440 }), [
      { x: 40, y: -30 },
      { x: 34, y: 40 },
      { x: -42, y: 36 },
    ]),
    route(createAircraft({ id: 'CNS303', category: 'light', pos: r303[r303.length - 1], altitudeFt: 4500, headingDeg: 0, speedKt: 130 }), r303),
  ]
}

export interface ReceiverStamp {
  id: ReceiverId
  name: string
  enu: Vec3
  /** Physical travel time from the aircraft, µs. */
  travelUs: number
  /** What the receiver's clock stamped, µs after the (unknown) emission moment. */
  stampUs: number
  clockErrorNs: number
  noiseNs: number
}

export interface MlatFix {
  seq: number
  aircraftId: string
  timeS: number
  /** Truth at the moment of transmission. */
  truePos: Vec2
  trueEnu: Vec3
  altitudeFt: number
  /** Altitude in the Mode S reply (25 ft steps). */
  reportedAltFt: number
  /** Height used by the solver (m), or null when it solved height too. */
  heightM: number | null
  stamps: ReceiverStamp[]
  solution: MlatSolution
  /** Chosen MLAT position, NM (null when there is none). */
  fixPos: Vec2 | null
  /** Every position that fits (two when ambiguous), NM. */
  candidatePos: Vec2[]
  /** Horizontal distance between the fix and the truth, m. */
  errorM: number
  /** Height error in 3D mode, m. */
  heightErrorM: number
  /** Geometry at the true position, for the receivers used. */
  dop: Dop | null
  /** Expected horizontal RMS error from the geometry and the timing noise, m. */
  expectedErrorM: number
  /** Where the aircraft's own ADS-B message says it is, NM. */
  adsbPos: Vec2
  /** Distance between the ADS-B report and the MLAT fix, m (NaN without a fix). */
  adsbMismatchM: number
}

/** ADS-B and MLAT disagreeing by more than this flags the report as suspect. */
// TODO(expert-review): real ADS-B validation thresholds depend on the system; this is illustrative.
export function mismatchThresholdM(expectedM: number) {
  return Math.max(500, 5 * (Number.isFinite(expectedM) ? expectedM : 0))
}

/**
 * Largest per-receiver disagreement (m) that timing noise alone explains. After the
 * fit, the squared residuals of N receivers with r spare measurements add up to
 * about r·σ², so the RMS per receiver is σ·√(r/N); three times that is a clear sign
 * that one receiver is wrong.
 */
export function disagreementLimitM(timingNoiseNs: number, redundancy: number, receivers: number): number {
  if (redundancy <= 0 || receivers <= 0) return Infinity
  return 3 * C_M_PER_NS * timingNoiseNs * Math.sqrt(redundancy / receivers) + 1
}

export class MlatEngine {
  timeS = 0
  receivers: MlatReceiver[] = DEFAULT_RECEIVERS.map((r) => ({ ...r, pos: { ...r.pos } }))
  env: MlatEnv = { ...DEFAULT_ENV }
  params: MlatParams = { ...DEFAULT_PARAMS }
  aircraft: Aircraft[]
  /** Latest fix per aircraft. */
  fixes = new Map<string, MlatFix>()
  /** Recent fix errors (east, north, m) per aircraft, for the close-up scatter. */
  scatter = new Map<string, Vec2[]>()
  private savedPositions: Record<string, Vec2> | null = null
  private nextEmit = new Map<string, number>()
  private rand: () => number
  private seq = 0

  constructor(seed = 11) {
    this.rand = mulberry32(seed)
    this.aircraft = createScenario(this.env)
    this.scheduleAll()
  }

  private scheduleAll() {
    this.nextEmit.clear()
    this.aircraft.forEach((a, i) => this.nextEmit.set(a.id, this.timeS + 0.1 + (i * EMIT_INTERVAL_S) / this.aircraft.length))
  }

  reset() {
    this.timeS = 0
    this.receivers = DEFAULT_RECEIVERS.map((r) => ({ ...r, pos: { ...r.pos } }))
    this.env = { ...DEFAULT_ENV }
    this.params = { ...DEFAULT_PARAMS }
    this.savedPositions = null
    this.aircraft = createScenario(this.env)
    this.fixes.clear()
    this.scatter.clear()
    this.scheduleAll()
  }

  /** Receivers whose time stamps reach the processor. */
  usedReceivers(): MlatReceiver[] {
    return this.receivers.filter((r) => r.inUse && !(this.env.receiverFailed && r.id === FAILED_RECEIVER))
  }

  isFailed(r: MlatReceiver) {
    return this.env.receiverFailed && r.id === FAILED_RECEIVER
  }

  /** Antenna position in ENU metres (ground height from the terrain plus the mast). */
  receiverEnu(r: MlatReceiver): Vec3 {
    return worldToEnuM(r.pos, terrainElevationFt(r.pos) + r.mastFt)
  }

  usedEnu(): Vec3[] {
    return this.usedReceivers().map((r) => this.receiverEnu(r))
  }

  /** Receivers in use lie on one line (within 2% of the network size). */
  get collinear(): boolean {
    const rx = this.usedEnu()
    if (rx.length < 3) return false
    let span = 0
    for (const a of rx) for (const b of rx) span = Math.max(span, Math.hypot(a.x - b.x, a.y - b.y))
    return isNearlyCollinear(rx, Math.max(200, span * 0.02))
  }

  /** Expected horizontal accuracy at a map point and altitude with the current network. */
  expectedAt(pos: Vec2, altitudeFt: number): { dop: Dop; errorM: number } | null {
    const dop = mlatDop(this.usedEnu(), worldToEnuM(pos, altitudeFt), this.params.useAltitude)
    return dop ? { dop, errorM: expectedErrorM(dop.hdop, this.params.timingNoiseNs) } : null
  }

  step(dt: number) {
    if (dt <= 0) return
    this.timeS += dt
    this.aircraft = this.aircraft.map((a) => stepAircraftFine(a, dt))
    for (const a of this.aircraft) {
      let due = this.nextEmit.get(a.id) ?? this.timeS
      while (due <= this.timeS) {
        this.emit(a)
        due += EMIT_INTERVAL_S
      }
      this.nextEmit.set(a.id, due)
    }
  }

  /** Make an aircraft transmit right now (used by the slow-motion view). */
  emitNow(id: string): MlatFix | null {
    const a = this.getAircraft(id)
    if (!a) return null
    this.nextEmit.set(id, this.timeS + EMIT_INTERVAL_S)
    return this.emit(a)
  }

  private emit(a: Aircraft): MlatFix {
    const used = this.usedReceivers()
    const trueEnu = worldToEnuM(a.pos, a.altitudeFt)
    // The emission moment on the receivers' common (GNSS) time scale. The solver never sees it.
    const emitUs = 1000 + (this.timeS % 10) * 1e6
    const stamps: ReceiverStamp[] = used.map((r) => {
      const enu = this.receiverEnu(r)
      const clockErrorNs = r.id === CLOCK_RECEIVER ? this.params.clockErrorNs : 0
      const noiseNs = gaussian(this.rand) * this.params.timingNoiseNs
      const t = arrivalTimeUs(trueEnu, enu, emitUs, clockErrorNs, noiseNs)
      return { id: r.id, name: r.name, enu, travelUs: travelTimeUsBetween(trueEnu, enu), stampUs: t - emitUs, clockErrorNs, noiseNs }
    })
    const reportedAltFt = Math.round(a.altitudeFt / ALTITUDE_STEP_FT) * ALTITUDE_STEP_FT
    const heightM = this.params.useAltitude ? reportedAltFt * METRES_PER_FT : null
    const prev = this.fixes.get(a.id)
    const prevPos = prev?.solution.position ?? undefined
    const rx = stamps.map((s) => s.enu)
    const solution = solveTdoa(
      rx,
      stamps.map((s) => s.stampUs + emitUs),
      // Track continuity: when two positions fit, keep the one next to the previous fix.
      { heightM, starts: prevPos ? [prevPos] : [], prefer: prevPos, noiseM: Math.max(1, C_M_PER_NS * this.params.timingNoiseNs) },
    )
    const dop = mlatDop(rx, trueEnu, this.params.useAltitude)
    const expected = dop ? expectedErrorM(dop.hdop, this.params.timingNoiseNs) : NaN
    const fixPos = solution.position ? enuMToWorld(solution.position).pos : null
    const errorM = solution.position ? Math.hypot(solution.position.x - trueEnu.x, solution.position.y - trueEnu.y) : NaN
    const heightErrorM = solution.position && heightM == null ? solution.position.z - trueEnu.z : NaN
    const adsbPos = this.adsbPosition(a)
    const fix: MlatFix = {
      seq: ++this.seq,
      aircraftId: a.id,
      timeS: this.timeS,
      truePos: { ...a.pos },
      trueEnu,
      altitudeFt: a.altitudeFt,
      reportedAltFt,
      heightM,
      stamps,
      solution,
      fixPos,
      candidatePos: solution.candidates.map((c) => enuMToWorld(c).pos),
      errorM,
      heightErrorM,
      dop,
      expectedErrorM: expected,
      adsbPos,
      adsbMismatchM: fixPos ? distanceNm(fixPos, adsbPos) * METRES_PER_NM : NaN,
    }
    this.fixes.set(a.id, fix)
    if (solution.position) {
      const list = this.scatter.get(a.id) ?? []
      list.push({ x: solution.position.x - trueEnu.x, y: solution.position.y - trueEnu.y })
      if (list.length > 40) list.shift()
      this.scatter.set(a.id, list)
    }
    return fix
  }

  /** Position in the aircraft's own ADS-B broadcast (GNSS), or the false one when spoofed. */
  adsbPosition(a: Aircraft): Vec2 {
    const nE = (gaussian(this.rand) * ADSB_NOISE_M) / METRES_PER_NM
    const nN = (gaussian(this.rand) * ADSB_NOISE_M) / METRES_PER_NM
    if (this.env.spoof && a.id === SPOOFED_AIRCRAFT) {
      const u = bearingVector(SPOOF_OFFSET.bearingDeg)
      return { x: a.pos.x + u.x * SPOOF_OFFSET.distanceNm + nE, y: a.pos.y + u.y * SPOOF_OFFSET.distanceNm + nN }
    }
    return { x: a.pos.x + nE, y: a.pos.y + nN }
  }

  /** Forget the scatter of old fixes (after the network or the settings change). */
  clearHistory() {
    this.scatter.clear()
  }

  setReceiver(id: ReceiverId, patch: Partial<MlatReceiver>) {
    this.receivers = this.receivers.map((r) => (r.id === id ? { ...r, ...patch, pos: patch.pos ? { ...patch.pos } : r.pos } : r))
    this.clearHistory()
  }

  /** Move every receiver into a straight line, or put them back where they were. */
  applyBadGeometry(on: boolean) {
    if (on) {
      if (!this.savedPositions) this.savedPositions = Object.fromEntries(this.receivers.map((r) => [r.id, { ...r.pos }]))
      this.receivers = this.receivers.map((r) => ({ ...r, pos: { ...LINE_POSITIONS[r.id] } }))
    } else if (this.savedPositions) {
      const saved = this.savedPositions
      this.receivers = this.receivers.map((r) => ({ ...r, pos: { ...(saved[r.id] ?? r.pos) } }))
      this.savedPositions = null
    }
    this.clearHistory()
  }

  /** The learner moved a receiver by hand: the line layout (if any) is now theirs. */
  forgetSavedLayout() {
    this.savedPositions = null
  }

  /** Put CNS303 on a route far outside the network, or back inside. */
  applyOutside(on: boolean) {
    const wps = on ? OUTSIDE_ROUTE_303 : INSIDE_ROUTE_303
    const start = wps[wps.length - 1]
    this.setAircraft(OUTSIDE_AIRCRAFT, { pos: { ...start }, mode: { kind: 'route', waypoints: wps, index: 0, loop: true }, held: false })
    this.fixes.delete(OUTSIDE_AIRCRAFT)
    this.scatter.delete(OUTSIDE_AIRCRAFT)
  }

  getAircraft(id: string | null | undefined): Aircraft | undefined {
    return this.aircraft.find((a) => a.id === id)
  }

  setAircraft(id: string, patch: Partial<Aircraft>) {
    this.aircraft = this.aircraft.map((a) => (a.id === id ? { ...a, ...patch } : a))
    if (patch.pos) this.scatter.delete(id)
  }
}

/** Plain-language status of a fix. */
export function statusText(s: MlatSolution['status']): string {
  switch (s) {
    case 'ok':
      return 'Position found'
    case 'ambiguous':
      return 'Two possible positions'
    case 'too-few':
      return 'Not enough receivers'
    case 'no-solution':
      return 'No position fits'
  }
}
