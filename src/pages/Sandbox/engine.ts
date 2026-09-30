/**
 * Airspace Sandbox engine: aircraft, every CNS system, surveillance data
 * fusion and safety nets, driven by one clock. Uses the pure functions in
 * src/core (radar, propagation, coverage, fusion, safety nets, world).
 *
 * CNS700 flies its gate-to-gate journey in fixed ticks (phases.ts), so the
 * live flight is exactly the precomputed one; everything else moves with the
 * frame's time step.
 */

import { angleDiff, bearingDeg, crossTrackNm, destinationPoint, distanceNm, localToLatLon, normalize360, sweepCovers, type Vec2 } from '@/core/geometry'
import { evaluateTarget, maxDetectionRangeNm, type RadarParams } from '@/core/radar'
import { geoElevationDeg, ilsCoverage, siteSees, tdoaHdop } from '@/core/coverage'
import {
  activeSources,
  createTrack,
  predictTrack,
  trackPosition,
  trackStatus,
  trackVelocity,
  updateTrack,
  type Measurement,
  type SourceKind,
  type Track,
} from '@/core/fusion'
import { msaw, stca, STCA_ENROUTE, STCA_TMA, MSAW_DEFAULT, type PredictState } from '@/core/safetyNets'
import { gaussian, mulberry32 } from '@/core/random'
import { METRES_PER_NM } from '@/core/units'
import { LAB_AIRPORT, radialSpeedKt, stepAircraftFine, terrainFn } from '@/core/world'
import {
  ADSB_RANGE_NM,
  ADSB_SITES,
  APPROACH_RADAR,
  APPROACH_RADAR_SITE,
  ENROUTE_RADAR,
  ENROUTE_RADAR_SITE,
  GEO_SAT_LON,
  ILS09,
  MLAT_RANGE_NM,
  MLAT_SITES,
  OCEANIC_BOUNDARY_X,
  SSR_RANGE_APP_NM,
  SSR_RANGE_ENR_NM,
  VHF_RANGE_NM,
  VHF_SITES,
  VORDME_RANGE_NM,
  VORDME_SITE,
  type SystemId,
} from './systems'
import { glidePathAltitudeFt, GS_ANGLE_DEG, INTERCEPT, THRESHOLD, TICK_S, type FlightPhase } from './journey'
import { mk, type Equipment, type SbAircraft } from './aircraft'
import {
  createJourneyAircraft,
  flightPhase,
  getJourneyIndex,
  isOnGround,
  JOURNEY_ID,
  journeyAt,
  journeyEvents,
  lerpPose,
  stepJourneyTick,
  transponderOn,
  type JourneyEventKind,
  type JourneyPose,
} from './phases'
import { commMedium, controllingUnit, RADIO_SCRIPT, type AtcUnit, type Channel, type Medium } from './atc'

export type { Equipment, JourneyState, SbAircraft } from './aircraft'
export { createJourneyAircraft } from './phases'

export type ScenarioId = 'normal' | 'radarOutage' | 'gnssJam' | 'vhfFail' | 'mountain'

export interface Availability {
  psr: boolean
  ssr: boolean
  adsb: boolean
  mlat: boolean
  adsc: boolean
  gnss: boolean
  vordme: boolean
  ils: boolean
  vhf: boolean
  cpdlc: boolean
  satcom: boolean
  hf: boolean
}

export type AlertKind = 'STCA' | 'MSAW'
export interface Alert {
  kind: AlertKind
  ids: string[]
  text: string
  timeToS: number | null
}

export interface EventLogItem {
  timeS: number
  text: string
}

/** One line of radio or data-link traffic with CNS700. */
export interface RadioMessage {
  id: number
  timeS: number
  unit: AtcUnit
  from: 'atc' | 'pilot' | 'note'
  text: string
  medium: Medium
  status: 'sent' | 'fallback' | 'blocked'
  /** Shown as context after a jump, not sent live. */
  earlier?: boolean
}

/** An ADS-C position report from CNS700 as received by the oceanic centre. */
export interface AdscReport {
  /** When the aircraft made the report, s. */
  madeS: number
  /** When it reached the centre, s. */
  receivedS: number
  pos: Vec2
  altitudeFt: number
}

interface PendingLine {
  dueTick: number
  unit: AtcUnit
  from: RadioMessage['from']
  channel: Channel
  text: string
}

export const JAMMER = { pos: { x: 10, y: -10 }, radiusNm: 90 }
/** Satellite and ground processing delay of an ADS-C report, s (illustrative). */
// TODO(expert-review): end-to-end ADS-C report latency over SATCOM.
export const ADSC_LATENCY_S = 25

/** CNS9B's cleared level when the controller resolves the staged conflict (2,000 ft above the traffic). */
export const CONFLICT_RESOLUTION_FT = 11000

export const ALL_SYSTEMS_ON: Record<SystemId, boolean> = {
  radarApp: true,
  radarEnr: true,
  adsb: true,
  sbadsb: false,
  mlat: true,
  adsc: true,
  gnss: true,
  vordme: true,
  ils: true,
  vhf: true,
  cpdlc: true,
  satcom: true,
  hf: true,
}

const terrain = terrainFn()

const route = (a: SbAircraft, wps: Vec2[]): SbAircraft => ({ ...a, mode: { kind: 'route', waypoints: wps, index: 0, loop: true } })

export function createTraffic(): SbAircraft[] {
  const full: Equipment = { transponder: 'modeS', adsb: true, fans: true }
  return [
    route(mk('CNS811', { x: -60, y: 140 }, 37000, 180, 470, full, '2231', 'heavy'), [{ x: -60, y: -140 }, { x: -66, y: 140 }]),
    route(mk('CNS822', { x: 90, y: 40 }, 24000, 270, 420, { transponder: 'modeS', adsb: true, fans: false }, '3342'), [{ x: -110, y: 44 }, { x: 90, y: 40 }]),
    route(mk('CNS833', { x: 6, y: 34 }, 6000, 90, 230, { transponder: 'modeS', adsb: true, fans: false }, '5113'), [
      { x: 18, y: 34 },
      { x: 18, y: 28 },
      { x: 6, y: 28 },
      { x: 6, y: 34 },
    ]),
    route(mk('CNS844', { x: 20, y: -14 }, 3500, 0, 110, { transponder: 'modeC', adsb: false, fans: false }, '7000', 'light'), [
      { x: 26, y: -8 },
      { x: 20, y: -2 },
      { x: 14, y: -8 },
      { x: 20, y: -14 },
    ]),
    route(mk('UNK1', { x: -8, y: -22 }, 2500, 90, 95, { transponder: 'none', adsb: false, fans: false }, '', 'light'), [
      { x: -2, y: -22 },
      { x: -2, y: -28 },
      { x: -8, y: -28 },
      { x: -8, y: -22 },
    ]),
    route(mk('CNS855', { x: 150, y: 60 }, 36000, 90, 480, full, '2000', 'heavy'), [{ x: 330, y: 60 }, { x: 150, y: 58 }]),
  ]
}

export class SandboxEngine {
  timeS = 0
  aircraft: SbAircraft[] = []
  tracks = new Map<string, Track>()
  history = new Map<string, Vec2[]>()
  systems: Record<SystemId, boolean> = { ...ALL_SYSTEMS_ON }
  scenario: ScenarioId = 'normal'
  /** VHF standby transmitter selected after a main transmitter failure. */
  vhfStandby = false
  adscIntervalS = 14 * 60
  alerts: Alert[] = []
  log: EventLogItem[] = []
  appAz = 0
  enrAz = 180
  /** Radio and data-link traffic with CNS700, newest first. */
  radio: RadioMessage[] = []
  /** CNS700's ADS-C reports as received, newest first. */
  adscLog: AdscReport[] = []
  /** Engine time at which CNS700's journey began (elapsed = timeS − journeyStartS). */
  journeyStartS = 0
  /** Increases on every reset, restart and jump (guided stops are remembered per run). */
  runId = 0
  /** Journey events of the most recent step, in order (for the page to react to). */
  lastEvents: JourneyEventKind[] = []
  private jumpEvents: JourneyEventKind[] = []
  /** CNS700 one tick ago, for smooth drawing between ticks. */
  private journeyPrev: SbAircraft | null = null
  private rand: () => number
  private readonly seed: number
  private pendingAdsc: Measurement[] = []
  private pendingRadio: PendingLine[] = []
  private nextSafetyS = 0
  private nextHistoryS = 0
  private radioId = 0

  constructor(seed = 11) {
    this.seed = seed
    this.rand = mulberry32(seed)
    this.reset()
  }

  /** Everything back to the start: world time 0, CNS700 at the gate, the same random sequence. */
  reset() {
    this.rand = mulberry32(this.seed)
    this.timeS = 0
    this.aircraft = [createJourneyAircraft(), ...createTraffic()]
    this.tracks.clear()
    this.history.clear()
    this.alerts = []
    this.log = []
    this.pendingAdsc = []
    this.pendingRadio = []
    this.radio = []
    this.adscLog = []
    this.vhfStandby = false
    this.nextSafetyS = 0
    this.nextHistoryS = 0
    this.appAz = 0
    this.enrAz = 180
    this.journeyStartS = 0
    this.journeyPrev = null
    this.lastEvents = []
    this.jumpEvents = []
    this.runId++
  }

  // -------------------------------------------------------------------------
  // CNS700's journey
  // -------------------------------------------------------------------------

  /** Journey ticks elapsed so far. */
  get journeyTick(): number {
    return this.journeyAircraft?.journey?.tick ?? 0
  }

  get journeyElapsedS(): number {
    return this.journeyTick * TICK_S
  }

  get phase(): FlightPhase {
    const a = this.journeyAircraft
    return a ? flightPhase(a) : 'gate'
  }

  get unit(): AtcUnit {
    return controllingUnit(this.phase)
  }

  /** CNS700 drawn between its last two ticks, so it moves smoothly at any clock speed. */
  journeyPose(): JourneyPose | null {
    const cur = this.journeyAircraft
    if (!cur) return null
    const prev = this.journeyPrev ?? cur
    const into = (this.timeS - this.journeyStartS - cur.journey!.tick * TICK_S) / TICK_S
    // Drawn one tick behind the truth: interpolate from the previous tick to the current one.
    return lerpPose(prev, cur, into)
  }

  /** Journey time of the drawn pose, s (one tick behind the truth, like journeyPose). */
  journeyDisplayElapsedS(): number {
    return Math.max(0, this.timeS - this.journeyStartS - TICK_S)
  }

  /** CNS700's turn rate over the last tick, degrees per second (+ = turning right). */
  journeyTurnRateDegS(): number {
    const cur = this.journeyAircraft
    const prev = this.journeyPrev
    if (!cur || !prev) return 0
    return angleDiff(prev.headingDeg, cur.headingDeg) / TICK_S
  }

  /** Put CNS700 at a point of its journey without touching the rest of the world. */
  jumpToTick(tick: number) {
    const a = journeyAt(tick)
    this.replaceJourneyAircraft(a)
    this.journeyStartS = this.timeS - a.journey!.tick * TICK_S
    this.restoreRadioAt(a.journey!.tick)
    // Events on the very tick the jump landed on will not fire again (stepping starts at the
    // next tick); the driver shows their guided stop, e.g. ocean entry when jumping to Ocean.
    this.jumpEvents = getJourneyIndex().events.filter((e) => e.tick === a.journey!.tick).map((e) => e.kind)
  }

  /** The journey events at the tick of the last jump, once. */
  takeJumpEvents(): JourneyEventKind[] {
    const e = this.jumpEvents
    this.jumpEvents = []
    return e
  }

  jumpToPhase(p: FlightPhase) {
    this.jumpToTick(getJourneyIndex().phaseStartTick[p])
  }

  /** A new journey from the gate (world time carries on). */
  restartJourney() {
    this.replaceJourneyAircraft(createJourneyAircraft())
    this.journeyStartS = this.timeS
    this.radio = []
  }

  private replaceJourneyAircraft(a: SbAircraft) {
    const keep = this.aircraft.filter((x) => !x.journey)
    this.aircraft = [{ ...a, nextAdsbS: this.timeS, nextMlatS: this.timeS, nextAdscS: this.timeS }, ...keep]
    this.journeyPrev = null
    this.tracks.delete(JOURNEY_ID)
    this.history.delete(JOURNEY_ID)
    this.pendingAdsc = this.pendingAdsc.filter((m) => m.targetId !== JOURNEY_ID)
    this.pendingRadio = []
    this.adscLog = []
    this.alerts = this.alerts.filter((al) => !al.ids.includes(JOURNEY_ID))
    this.lastEvents = []
    this.jumpEvents = []
    this.runId++
  }

  /**
   * After a jump: the last few scripted lines before that point are shown as context,
   * and the rest of any exchange already under way is queued so it still plays.
   */
  private restoreRadioAt(tick: number) {
    const out: RadioMessage[] = []
    for (const e of getJourneyIndex().events) {
      if (e.tick > tick) break
      for (const line of RADIO_SCRIPT[e.kind] ?? []) {
        const dueTick = e.tick + Math.round(line.delayS / TICK_S)
        if (dueTick > tick) {
          this.pendingRadio.push({ dueTick, unit: line.unit, from: line.from, channel: line.channel, text: line.text })
          continue
        }
        out.push({ id: ++this.radioId, timeS: this.timeS, unit: line.unit, from: line.from, text: line.text, medium: line.channel === 'note' ? 'none' : line.channel === 'datalink' ? 'cpdlcSat' : line.channel === 'hf' ? 'hf' : 'vhf', status: 'sent', earlier: true })
      }
    }
    this.radio = out.slice(-6).reverse()
  }

  /** React to journey events: radio script, surveillance changes, log. */
  private onJourneyEvents(events: JourneyEventKind[], tick: number) {
    for (const kind of events) {
      for (const line of RADIO_SCRIPT[kind] ?? []) {
        this.pendingRadio.push({ dueTick: tick + Math.round(line.delayS / TICK_S), unit: line.unit, from: line.from, channel: line.channel, text: line.text })
      }
      if (kind === 'onBlocks') {
        // Transponder to standby: the track simply ends (no "track lost" alarm).
        this.tracks.delete(JOURNEY_ID)
        this.history.delete(JOURNEY_ID)
      }
      if (kind === 'touchdown') this.addLog('CNS700 has landed on runway 09.')
      if (kind === 'complete') this.addLog('CNS700 is back at stand S3. The journey is complete.')
    }
  }

  /** Send the radio lines that are due, over whatever link works right now. */
  private deliverRadio(tick: number) {
    if (!this.pendingRadio.length) return
    const ja = this.journeyAircraft
    const av = ja ? this.availabilityFor(ja) : null
    const due = this.pendingRadio.filter((l) => l.dueTick <= tick)
    if (!due.length) return
    this.pendingRadio = this.pendingRadio.filter((l) => l.dueTick > tick)
    for (const l of due) {
      const d = av ? commMedium(l.channel, l.unit, av) : { medium: 'none' as const, status: 'blocked' as const }
      this.radio = [{ id: ++this.radioId, timeS: this.timeS, unit: l.unit, from: l.from, text: l.text, medium: d.medium, status: d.status }, ...this.radio].slice(0, 40)
    }
  }

  addLog(text: string) {
    this.log = [{ timeS: this.timeS, text }, ...this.log].slice(0, 30)
  }

  get journeyAircraft(): SbAircraft | undefined {
    return this.aircraft.find((a) => a.journey)
  }

  // -------------------------------------------------------------------------
  // What works where
  // -------------------------------------------------------------------------

  /** Whether a system is switched on and not knocked out by the current scenario. */
  systemUp(id: SystemId): boolean {
    if (!this.systems[id]) return false
    if (this.scenario === 'radarOutage' && (id === 'radarApp' || id === 'radarEnr')) return false
    if (this.scenario === 'vhfFail' && id === 'vhf' && !this.vhfStandby) return false
    return true
  }

  gnssJammedAt(p: Vec2): boolean {
    return this.scenario === 'gnssJam' && distanceNm(p, JAMMER.pos) <= JAMMER.radiusNm
  }

  /** Which systems can serve an aircraft at this position, altitude and equipment. */
  availability(pos: Vec2, altFt: number, equip: Equipment, rcsM2: number): Availability {
    const inTerminalOrLand = pos.x < OCEANIC_BOUNDARY_X
    const psrIn = (site: typeof APPROACH_RADAR_SITE, p: RadarParams) =>
      siteSees(site, pos, altFt, terrain) && distanceNm(site.pos, pos) <= maxDetectionRangeNm(p, rcsM2, 0.5)
    const psr = (this.systemUp('radarApp') && psrIn(APPROACH_RADAR_SITE, APPROACH_RADAR)) || (this.systemUp('radarEnr') && psrIn(ENROUTE_RADAR_SITE, ENROUTE_RADAR))
    const hasXpdr = equip.transponder !== 'none'
    const ssr =
      hasXpdr &&
      ((this.systemUp('radarApp') && siteSees(APPROACH_RADAR_SITE, pos, altFt, terrain, SSR_RANGE_APP_NM)) ||
        (this.systemUp('radarEnr') && siteSees(ENROUTE_RADAR_SITE, pos, altFt, terrain, SSR_RANGE_ENR_NM)))
    const gnss = this.systemUp('gnss') && !this.gnssJammedAt(pos)
    const adsbGround = this.systemUp('adsb') && ADSB_SITES.some((s) => siteSees(s, pos, altFt, terrain, ADSB_RANGE_NM))
    const adsb = equip.adsb && gnss && (adsbGround || this.systemUp('sbadsb'))
    const mlatRx = hasXpdr && this.systemUp('mlat') ? MLAT_SITES.filter((s) => siteSees(s, pos, altFt, terrain, MLAT_RANGE_NM)).length : 0
    const mlat = mlatRx >= 4 || (mlatRx >= 3 && hasXpdr)
    const latLon = localToLatLon(pos, LAB_AIRPORT.ref)
    const satcom = this.systemUp('satcom') && geoElevationDeg(latLon, GEO_SAT_LON) > 5
    const vhf = this.systemUp('vhf') && VHF_SITES.some((s) => siteSees(s, pos, altFt, terrain, VHF_RANGE_NM))
    const cpdlc = this.systemUp('cpdlc') && equip.fans && (vhf || satcom)
    const adsc = this.systemUp('adsc') && equip.fans && satcom && !inTerminalOrLand && gnss
    const vordme = this.systemUp('vordme') && siteSees(VORDME_SITE, pos, altFt, terrain, VORDME_RANGE_NM)
    const ils = this.systemUp('ils') && ilsCoverage(ILS09, pos, altFt).localizer
    const hf = this.systemUp('hf')
    return { psr, ssr, adsb, mlat, adsc, gnss, vordme, ils, vhf, cpdlc, satcom, hf }
  }

  /** Coverage of one system at a point and altitude (what the map overlay draws). */
  coverageAt(id: SystemId, pos: Vec2, altFt: number): boolean {
    if (!this.systemUp(id)) return false
    switch (id) {
      case 'radarApp':
        return siteSees(APPROACH_RADAR_SITE, pos, altFt, terrain, SSR_RANGE_APP_NM)
      case 'radarEnr':
        return siteSees(ENROUTE_RADAR_SITE, pos, altFt, terrain, SSR_RANGE_ENR_NM)
      case 'adsb':
        return !this.gnssJammedAt(pos) && ADSB_SITES.some((s) => siteSees(s, pos, altFt, terrain, ADSB_RANGE_NM))
      case 'mlat':
        return MLAT_SITES.filter((s) => siteSees(s, pos, altFt, terrain, MLAT_RANGE_NM)).length >= 3
      case 'vordme':
        return siteSees(VORDME_SITE, pos, altFt, terrain, VORDME_RANGE_NM)
      case 'ils':
        return ilsCoverage(ILS09, pos, altFt).localizer
      case 'vhf':
        return VHF_SITES.some((s) => siteSees(s, pos, altFt, terrain, VHF_RANGE_NM))
      default:
        return true
    }
  }

  availabilityFor(a: SbAircraft): Availability {
    return this.availability(a.pos, a.altitudeFt, a.equip, a.rcsM2)
  }

  // -------------------------------------------------------------------------
  // Scenarios and traffic
  // -------------------------------------------------------------------------

  setScenario(id: ScenarioId) {
    if (this.scenario === id) return
    this.aircraft = this.aircraft.filter((a) => a.scenario !== 'mountain')
    this.scenario = id
    this.vhfStandby = false
    const text: Record<ScenarioId, string> = {
      normal: 'All systems normal.',
      radarOutage: 'Radar outage: the approach and en-route radars have failed.',
      gnssJam: 'GNSS jamming near the airport: satellite signals are drowned out.',
      vhfFail: 'VHF failure: the main VHF transmitters have stopped.',
      mountain: 'Mountain terrain: an aircraft is descending toward the North Range.',
    }
    this.addLog(text[id])
    if (id === 'mountain') this.spawnMountainAircraft()
  }

  /**
   * Break-it "Restore everything": every system back on, no scenario, no staged conflict.
   * CNS700's journey and the clock carry on where they are.
   */
  restoreAllSystems() {
    this.systems = { ...ALL_SYSTEMS_ON }
    this.setScenario('normal')
    this.vhfStandby = false
    this.aircraft = this.aircraft.filter((a) => !a.scenario)
    const ids = new Set(this.aircraft.map((a) => a.id))
    this.alerts = this.alerts.filter((al) => al.ids.every((id) => ids.has(id)))
    for (const id of [...this.tracks.keys()]) if (!ids.has(id)) this.tracks.delete(id)
    this.addLog('All systems restored.')
  }

  selectVhfStandby() {
    if (this.scenario === 'vhfFail' && !this.vhfStandby) {
      this.vhfStandby = true
      this.addLog('Controller switched to the standby VHF transmitters. Voice contact restored.')
    }
  }

  spawnConflict() {
    this.aircraft = this.aircraft.filter((a) => a.scenario !== 'stca')
    const meet = { x: 2, y: 14 }
    const a = mk('CNS9A', destinationPoint(meet, 290, 12), 9000, 110, 250, { transponder: 'modeS', adsb: true, fans: false }, '6501')
    const b = mk('CNS9B', destinationPoint(meet, 70, 12), 9000, 250, 250, { transponder: 'modeS', adsb: true, fans: false }, '6502')
    this.aircraft.push({ ...a, scenario: 'stca' }, { ...b, scenario: 'stca' })
    this.addLog('Two aircraft at 9,000 ft are on converging tracks north of the airport.')
  }

  /** Controller instruction resolving the conflict: CNS9B climbs to FL110, 2,000 ft above the traffic. Given once. */
  resolveConflict() {
    const b = this.aircraft.find((x) => x.id === 'CNS9B')
    if (!b || b.targetAltitudeFt === CONFLICT_RESOLUTION_FT) return
    this.setAircraft('CNS9B', { targetAltitudeFt: CONFLICT_RESOLUTION_FT })
    this.addLog('Controller: "CNS9B, climb immediately to flight level 110, traffic ahead."')
  }

  spawnMountainAircraft() {
    this.aircraft = this.aircraft.filter((a) => a.scenario !== 'mountain')
    const m = mk('CNS9M', { x: -14, y: 14 }, 7000, 305, 220, { transponder: 'modeS', adsb: true, fans: false }, '6503')
    this.aircraft.push({ ...m, targetAltitudeFt: 5000, scenario: 'mountain' })
  }

  /** Controller instruction after an MSAW alert. */
  resolveTerrain() {
    const m = this.aircraft.find((x) => x.id === 'CNS9M')
    if (!m || m.targetAltitudeFt === 12000) return
    this.setAircraft('CNS9M', { targetAltitudeFt: 12000, mode: { kind: 'heading' }, targetHeadingDeg: 90 })
    this.addLog('Controller: "CNS9M, terrain alert, climb immediately to 12,000 ft, turn right heading 090."')
  }

  setAircraft(id: string, patch: Partial<SbAircraft>) {
    this.aircraft = this.aircraft.map((a) => (a.id === id ? { ...a, ...patch } : a))
  }

  getAircraft(id: string | null | undefined) {
    return this.aircraft.find((a) => a.id === id)
  }

  // -------------------------------------------------------------------------
  // Step
  // -------------------------------------------------------------------------

  /**
   * Advance the world by dt seconds. `haltOn` may stop the step exactly at a
   * journey event (a guided stop): the world then stands at that moment and
   * the event is returned.
   */
  step(dt: number, haltOn?: (e: JourneyEventKind) => boolean): { halted: JourneyEventKind | null } {
    this.lastEvents = []
    if (!(dt > 0)) return { halted: null }
    // Split big steps so radar sweeps and message timing stay accurate.
    const n = Math.max(1, Math.ceil(dt / 0.5))
    for (let i = 0; i < n; i++) {
      const halted = this.stepOnce(dt / n, haltOn)
      if (halted) return { halted }
    }
    return { halted: null }
  }

  /** Advance CNS700 by whole ticks up to the engine time t1 (or to a halting event). Returns the new t1. */
  private advanceJourney(t1: number, haltOn?: (e: JourneyEventKind) => boolean): { t1: number; halted: JourneyEventKind | null } {
    let ja = this.journeyAircraft
    if (!ja?.journey) return { t1, halted: null }
    let halted: JourneyEventKind | null = null
    const target = t1 - this.journeyStartS + 1e-9
    let prev = this.journeyPrev ?? ja
    while ((ja.journey!.tick + 1) * TICK_S <= target) {
      const next = stepJourneyTick(ja)
      const events = journeyEvents(ja, next)
      prev = ja
      ja = next
      if (events.length) {
        this.lastEvents.push(...events)
        this.onJourneyEvents(events, next.journey!.tick)
      }
      const hit = haltOn ? events.find(haltOn) : undefined
      if (hit) {
        halted = hit
        t1 = this.journeyStartS + next.journey!.tick * TICK_S
        break
      }
    }
    this.journeyPrev = prev
    const cur = ja
    this.aircraft = this.aircraft.map((a) => (a.journey ? { ...cur, nextAdsbS: a.nextAdsbS, nextMlatS: a.nextMlatS, nextAdscS: a.nextAdscS } : a))
    this.deliverRadio(cur.journey!.tick)
    return { t1, halted }
  }

  private stepOnce(dtIn: number, haltOn?: (e: JourneyEventKind) => boolean): JourneyEventKind | null {
    const t0 = this.timeS
    // 1. CNS700 in whole journey ticks; a guided stop may shorten this step.
    const { t1, halted } = this.advanceJourney(t0 + dtIn, haltOn)
    const dt = Math.max(0, t1 - t0)
    this.timeS = t1
    const measurements: Measurement[] = []

    // 2. The other aircraft.
    if (dt > 0) this.aircraft = this.aircraft.map((a) => (a.journey ? a : (stepAircraftFine(a, dt) as SbAircraft)))
    // Scenario aircraft that have flown far away are removed.
    this.aircraft = this.aircraft.filter((a) => !a.scenario || distanceNm(a.pos, { x: 0, y: 0 }) < 90)
    this.applyTaws()

    // 3. Radars: rotating antennas paint what they sweep (not the aircraft on the airport surface).
    const appSpan = (360 / APPROACH_RADAR.rotationPeriodS) * dt
    const enrSpan = (360 / ENROUTE_RADAR.rotationPeriodS) * dt
    for (const a of this.aircraft) {
      if (a.journey && isOnGround(a)) continue
      if (this.systemUp('radarApp') && sweepCovers(bearingDeg(APPROACH_RADAR_SITE.pos, a.pos), this.appAz, appSpan)) {
        measurements.push(...this.radarPlots(a, APPROACH_RADAR_SITE, APPROACH_RADAR, SSR_RANGE_APP_NM))
      }
      if (this.systemUp('radarEnr') && sweepCovers(bearingDeg(ENROUTE_RADAR_SITE.pos, a.pos), this.enrAz, enrSpan)) {
        measurements.push(...this.radarPlots(a, ENROUTE_RADAR_SITE, ENROUTE_RADAR, SSR_RANGE_ENR_NM))
      }
    }
    this.appAz = normalize360(this.appAz + appSpan)
    this.enrAz = normalize360(this.enrAz + enrSpan)

    // 4. ADS-B, WAM and ADS-C (CNS700's transponder is on standby at the gate).
    this.aircraft = this.aircraft.map((a) => {
      if (a.journey && !transponderOn(a)) return a
      let next = a
      const due = this.timeS >= a.nextAdsbS || this.timeS >= a.nextMlatS || this.timeS >= a.nextAdscS
      if (!due) return a
      const av = this.availabilityFor(a)
      if (this.timeS >= a.nextAdsbS) {
        next = { ...next, nextAdsbS: this.timeS + 0.4 + this.rand() * 0.2 }
        if (av.adsb) {
          const err = 5 / METRES_PER_NM
          measurements.push({
            source: 'adsb',
            targetId: a.id,
            timeS: this.timeS,
            x: a.pos.x + gaussian(this.rand) * err,
            y: a.pos.y + gaussian(this.rand) * err,
            sigmaNm: 10 / METRES_PER_NM,
            altitudeFt: a.altitudeFt,
            callsign: a.callsign,
            code: a.equip.transponder !== 'none' ? a.code : undefined,
          })
        }
      }
      if (this.timeS >= a.nextMlatS) {
        next = { ...next, nextMlatS: this.timeS + 1 }
        if (av.mlat) {
          const rx = MLAT_SITES.filter((s) => siteSees(s, a.pos, a.altitudeFt, terrain, MLAT_RANGE_NM)).map((s) => s.pos)
          // σ_position ≈ HDOP × c × σ_timing (σ_timing ≈ 20 ns → 6 m of range difference).
          // TODO(expert-review): WAM timing accuracy used for the error model.
          const sigmaM = Math.min(2000, tdoaHdop(rx, a.pos) * 6)
          const s = sigmaM / METRES_PER_NM
          measurements.push({
            source: 'mlat',
            targetId: a.id,
            timeS: this.timeS,
            x: a.pos.x + gaussian(this.rand) * s,
            y: a.pos.y + gaussian(this.rand) * s,
            sigmaNm: Math.max(s, 5 / METRES_PER_NM),
            altitudeFt: a.altitudeFt,
            code: a.code || undefined,
            callsign: a.equip.transponder === 'modeS' ? a.callsign : undefined,
          })
        }
      }
      if (av.adsc && this.timeS >= a.nextAdscS) {
        next = { ...next, nextAdscS: this.timeS + this.adscIntervalS }
        // The report is made now and arrives at the oceanic centre after the satellite delay.
        this.pendingAdsc.push({ source: 'adsc', targetId: a.id, timeS: this.timeS, x: a.pos.x, y: a.pos.y, sigmaNm: 0.05, altitudeFt: a.altitudeFt, callsign: a.callsign })
      } else if (!av.adsc && a.nextAdscS < this.timeS) {
        // No contract while outside oceanic airspace or without a link: first report as soon as possible.
        next = { ...next, nextAdscS: this.timeS }
      }
      return next
    })
    // Deliver ADS-C reports whose latency has elapsed.
    const due = this.pendingAdsc.filter((m) => this.timeS - m.timeS >= ADSC_LATENCY_S)
    this.pendingAdsc = this.pendingAdsc.filter((m) => this.timeS - m.timeS < ADSC_LATENCY_S)
    measurements.push(...due)
    for (const m of due) {
      if (m.targetId === JOURNEY_ID) this.adscLog = [{ madeS: m.timeS, receivedS: this.timeS, pos: { x: m.x, y: m.y }, altitudeFt: m.altitudeFt ?? 0 }, ...this.adscLog].slice(0, 12)
    }

    // 5. Fusion.
    measurements.sort((x, y) => x.timeS - y.timeS)
    for (const m of measurements) {
      const t = this.tracks.get(m.targetId)
      this.tracks.set(m.targetId, t ? updateTrack(t, m) : createTrack(m))
    }
    for (const [id, t] of this.tracks) {
      const status = trackStatus(t, this.timeS)
      if (status === 'drop' || !this.aircraft.some((a) => a.id === id)) {
        this.tracks.delete(id)
        this.history.delete(id)
        if (status === 'drop') this.addLog(`Track ${t.callsign ?? t.code ?? id} lost: no surveillance data for a minute.`)
      }
    }
    if (this.timeS >= this.nextHistoryS) {
      this.nextHistoryS = this.timeS + 4
      for (const [id, t] of this.tracks) {
        const p = trackPosition(predictTrack(t, this.timeS))
        this.history.set(id, [...(this.history.get(id) ?? []), p].slice(-6))
      }
    }

    // 6. Safety nets once per second.
    if (this.timeS >= this.nextSafetyS || t0 === 0) {
      this.nextSafetyS = this.timeS + 1
      this.runSafetyNets()
    }
    return halted
  }

  private radarPlots(a: SbAircraft, site: typeof APPROACH_RADAR_SITE, params: RadarParams, ssrRangeNm: number): Measurement[] {
    const out: Measurement[] = []
    const range = distanceNm(site.pos, a.pos)
    // Radar accuracy: range ~0.03 NM, azimuth ~0.08° (→ cross-range error grows with distance).
    const azSigmaNm = range * ((0.08 * Math.PI) / 180)
    const sigma = Math.hypot(0.03, azSigmaNm)
    const noisy = () => ({ x: a.pos.x + gaussian(this.rand) * sigma, y: a.pos.y + gaussian(this.rand) * sigma })
    const res = evaluateTarget(site, params, { pos: a.pos, altitudeFt: a.altitudeFt, rcsM2: a.rcsM2, radialSpeedKt: radialSpeedKt(a, site.pos) }, { terrain, mti: true }, this.rand())
    if (res.detected && res.trace === 1) out.push({ source: 'psr', targetId: a.id, timeS: this.timeS, ...noisy(), sigmaNm: sigma })
    if (a.equip.transponder !== 'none' && siteSees(site, a.pos, a.altitudeFt, terrain, ssrRangeNm) && this.rand() < 0.98) {
      out.push({
        source: 'ssr',
        targetId: a.id,
        timeS: this.timeS,
        ...noisy(),
        sigmaNm: sigma,
        code: a.code,
        altitudeFt: Math.round(a.altitudeFt / 100) * 100,
        callsign: a.equip.transponder === 'modeS' ? a.callsign : undefined,
      })
    }
    return out
  }

  /** Onboard terrain awareness (TAWS): pilots pull up if terrain is close ahead. */
  private applyTaws() {
    this.aircraft = this.aircraft.map((a) => {
      if (a.journey || a.speedKt <= 0) return a
      const v = { x: (Math.sin((a.headingDeg * Math.PI) / 180) * a.speedKt) / 3600, y: (Math.cos((a.headingDeg * Math.PI) / 180) * a.speedKt) / 3600 }
      const r = msaw({ id: a.id, pos: a.pos, vel: v, altitudeFt: a.altitudeFt, verticalSpeedFpm: a.verticalSpeedFpm }, terrain, { clearanceFt: 500, lookaheadS: 30, stepS: 2 })
      if (r.alert && !a.taws) {
        this.addLog(`${a.callsign} cockpit: "TERRAIN, PULL UP". The crew climbs at full power.`)
        return { ...a, taws: true, targetAltitudeFt: Math.max(a.targetAltitudeFt, 13000), mode: { kind: 'heading' }, targetHeadingDeg: normalize360(a.headingDeg + 120) }
      }
      if (a.taws && !r.alert && a.altitudeFt > 11000) return { ...a, taws: false }
      return a
    })
  }

  /** Track state predicted to now, for safety nets and display. */
  trackState(t: Track): PredictState | null {
    if (t.altitudeFt === undefined) return null
    const p = predictTrack(t, this.timeS)
    const a = this.getAircraft(t.id)
    return {
      id: t.id,
      pos: trackPosition(p),
      vel: trackVelocity(p),
      altitudeFt: t.altitudeFt,
      // Vertical rate comes from successive altitude reports; the truth is used as a stand-in.
      verticalSpeedFpm: a?.verticalSpeedFpm ?? 0,
    }
  }

  private runSafetyNets() {
    const states = [...this.tracks.values()]
      .filter((t) => trackStatus(t, this.timeS) !== 'drop')
      .map((t) => this.trackState(t))
      .filter((s): s is PredictState => s !== null)
    const alerts: Alert[] = []
    for (let i = 0; i < states.length; i++) {
      for (let k = i + 1; k < states.length; k++) {
        const a = states[i]
        const b = states[k]
        const terminal = distanceNm(a.pos, { x: 0, y: 0 }) < 40 && distanceNm(b.pos, { x: 0, y: 0 }) < 40
        // Aircraft on the ground are excluded.
        if (a.altitudeFt < 200 || b.altitudeFt < 200) continue
        const r = stca(a, b, terminal ? STCA_TMA : STCA_ENROUTE)
        if (r.alert) {
          alerts.push({
            kind: 'STCA',
            ids: [a.id, b.id],
            text: `${this.name(a.id)} and ${this.name(b.id)}: ${r.minHorizontalNm.toFixed(1)} NM and ${Math.round(r.verticalAtTcpaFt)} ft apart in ${Math.round(r.tcpaS)} s`,
            timeToS: r.timeToViolationS,
          })
        }
      }
    }
    for (const s of states) {
      if (s.altitudeFt < 200) continue
      const r = msaw(s, terrain, MSAW_DEFAULT, (pos, alt) => this.inApproachFunnel(pos, alt) || this.inRunwayInhibitArea(pos, alt))
      if (r.alert) {
        alerts.push({
          kind: 'MSAW',
          ids: [s.id],
          text: `${this.name(s.id)}: ${Math.round(Math.max(0, r.minClearanceFt))} ft above terrain predicted ${r.timeToViolationS === 0 ? 'now' : `in ${Math.round(r.timeToViolationS ?? 0)} s`}`,
          timeToS: r.timeToViolationS,
        })
      }
    }
    const before = new Set(this.alerts.map((x) => `${x.kind}:${x.ids.join('+')}`))
    for (const al of alerts) if (!before.has(`${al.kind}:${al.ids.join('+')}`)) this.addLog(`${al.kind} alert: ${al.text}.`)
    this.alerts = alerts
  }

  /**
   * Around the runway, departing and landing aircraft are low by design, so MSAW
   * is inhibited inside a small cylinder (radius 5 NM, up to 2,500 ft).
   */
  // TODO(expert-review): MSAW inhibit volumes are defined per airport; this cylinder is illustrative.
  inRunwayInhibitArea(pos: Vec2, altFt: number): boolean {
    return distanceNm(pos, { x: 0, y: 0 }) < 5 && altFt < LAB_AIRPORT.elevationFt + 2500
  }

  /** Aircraft established on the ILS final are meant to be low: MSAW is inhibited there. */
  inApproachFunnel(pos: Vec2, altFt: number): boolean {
    const cov = ilsCoverage(ILS09, pos, altFt)
    if (!cov.localizer) return false
    const along = THRESHOLD.x - pos.x
    if (along < -1 || along > 15) return false
    const gs = glidePathAltitudeFt(pos.x)
    return Math.abs(crossTrackNm(pos, THRESHOLD, ILS09.courseDeg)) < 1.5 && altFt > gs - 600
  }

  name(id: string): string {
    const t = this.tracks.get(id)
    return t?.callsign ?? (t?.code ? `code ${t.code}` : id)
  }

  /** Sources currently feeding a track. */
  sources(id: string): SourceKind[] {
    const t = this.tracks.get(id)
    return t ? activeSources(t, this.timeS) : []
  }
}

export const GLIDE_ANGLE = GS_ANGLE_DEG
export { INTERCEPT }
