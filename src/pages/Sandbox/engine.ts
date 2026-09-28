/**
 * Airspace Sandbox engine: aircraft, every CNS system, surveillance data
 * fusion and safety nets, driven by one clock. Uses the pure functions in
 * src/core (radar, propagation, coverage, fusion, safety nets, world).
 */

import { bearingDeg, crossTrackNm, distanceNm, localToLatLon, normalize360, sweepCovers, destinationPoint, type Vec2 } from '@/core/geometry'
import { evaluateTarget, maxDetectionRangeNm, RCS_M2, type RadarParams } from '@/core/radar'
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
import { createAircraft, LAB_AIRPORT, radialSpeedKt, stepAircraftFine, terrainFn, type Aircraft } from '@/core/world'
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
import { GS_ANGLE_DEG, INTERCEPT, JOURNEY, JOURNEY_START, THRESHOLD, glidePathAltitudeFt, type Stage } from './journey'

export type ScenarioId = 'normal' | 'radarOutage' | 'gnssJam' | 'vhfFail' | 'mountain'

export interface Equipment {
  transponder: 'none' | 'modeC' | 'modeS'
  adsb: boolean
  /** FANS 1/A: CPDLC and ADS-C over satellite. */
  fans: boolean
}

export interface JourneyState {
  legIndex: number
  phase: 'plan' | 'final' | 'rollout' | 'landed'
  startS: number
  landedAtS?: number
}

export interface SbAircraft extends Aircraft {
  equip: Equipment
  code: string
  rcsM2: number
  journey?: JourneyState
  /** Onboard terrain warning (TAWS) currently commanding a pull-up. */
  taws?: boolean
  /** Scenario aircraft are removed when their scenario ends. */
  scenario?: 'stca' | 'mountain'
  nextAdsbS: number
  nextMlatS: number
  nextAdscS: number
}

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

export const JAMMER = { pos: { x: 10, y: -10 }, radiusNm: 90 }
/** Satellite and ground processing delay of an ADS-C report, s (illustrative). */
// TODO(expert-review): end-to-end ADS-C report latency over SATCOM.
export const ADSC_LATENCY_S = 25

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

function mk(
  id: string,
  pos: Vec2,
  altitudeFt: number,
  headingDeg: number,
  speedKt: number,
  equip: Equipment,
  code: string,
  category: Aircraft['category'] = 'medium',
): SbAircraft {
  const a = createAircraft({ id, pos, altitudeFt, headingDeg, speedKt, category })
  return { ...a, equip, code, rcsM2: RCS_M2[category], nextAdsbS: 0, nextMlatS: 0, nextAdscS: 0 }
}

const route = (a: SbAircraft, wps: Vec2[]): SbAircraft => ({ ...a, mode: { kind: 'route', waypoints: wps, index: 0, loop: true } })

export function createJourneyAircraft(startS = 0): SbAircraft {
  const a = mk('CNS700', JOURNEY_START.pos, JOURNEY_START.altitudeFt, JOURNEY_START.headingDeg, JOURNEY_START.speedKt, { transponder: 'modeS', adsb: true, fans: true }, '4521')
  return { ...a, journey: { legIndex: 0, phase: 'plan', startS } }
}

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

/** Stage of the journey aircraft for the timeline. */
export function journeyStage(a: SbAircraft): Stage {
  const j = a.journey
  if (!j) return 'En-route'
  if (j.phase === 'landed') return 'Landed'
  if (j.phase === 'rollout') return 'Landing'
  if (j.phase === 'final') return a.pos.x > THRESHOLD.x - 2 ? 'Landing' : 'Approach'
  const leg = JOURNEY[j.legIndex]
  if (leg.stage === 'Climb' && a.pos.x > OCEANIC_BOUNDARY_X) return 'Ocean'
  if (leg.stage === 'Climb' && a.altitudeFt > 23000 && a.pos.x > 50) return 'En-route'
  if (leg.stage === 'Return' && a.pos.x > OCEANIC_BOUNDARY_X) return 'Ocean'
  return leg.stage
}

/**
 * Advance the journey aircraft one step: fly the legs, capture the localizer
 * and glideslope, land and roll out. Deterministic.
 */
export function stepJourney(a: SbAircraft, dt: number): SbAircraft {
  const j = a.journey!
  if (j.phase === 'landed') return a
  if (j.phase === 'rollout') {
    const v = Math.max(0, a.speedKt - 3 * dt) // about 3 kt per second of braking
    const d = ((a.speedKt + v) / 2 / 3600) * dt
    const next = { ...a, pos: { x: a.pos.x + d, y: 0 }, speedKt: v, targetSpeedKt: v, altitudeFt: LAB_AIRPORT.elevationFt, verticalSpeedFpm: 0 }
    return v < 25 ? { ...next, speedKt: 0, journey: { ...j, phase: 'landed' } } : next
  }
  if (j.phase === 'plan') {
    const leg = JOURNEY[j.legIndex]
    const reach = Math.max(1, (a.speedKt / 3600) * dt * 2)
    if (distanceNm(a.pos, leg.to) < reach) {
      const idx = j.legIndex + 1
      if (idx >= JOURNEY.length) return stepJourney({ ...a, journey: { ...j, phase: 'final' } }, dt)
      return stepJourney({ ...a, journey: { ...j, legIndex: idx } }, 0)
    }
    if (dt <= 0) return a
    const flown = stepAircraftFine({ ...a, mode: { kind: 'direct', to: leg.to }, targetAltitudeFt: leg.altitudeFt, targetSpeedKt: leg.speedKt }, dt) as SbAircraft
    return { ...flown, mode: { kind: 'heading' }, targetHeadingDeg: flown.headingDeg }
  }
  // Final approach: localizer capture (steer onto the centreline) and glideslope.
  if (dt <= 0) return a
  const xt = crossTrackNm(a.pos, THRESHOLD, ILS09.courseDeg) // + = right of course (south)
  const heading = normalize360(ILS09.courseDeg - Math.max(-30, Math.min(30, xt * 25)))
  // Stay at 3,000 ft until the glide path comes down to meet us, then follow it to the
  // touchdown point (where the 3° path meets the runway, ~950 ft past the threshold).
  const targetAlt = Math.min(3000, glidePathAltitudeFt(a.pos.x))
  const beforeThreshold = a.pos.x < THRESHOLD.x
  const toGo = THRESHOLD.x - a.pos.x
  const speed = toGo > 5 ? 160 : 140
  const flown = stepAircraftFine({ ...a, mode: { kind: 'heading' }, targetHeadingDeg: heading, targetAltitudeFt: targetAlt, targetSpeedKt: speed }, dt) as SbAircraft
  if (!beforeThreshold && flown.altitudeFt <= LAB_AIRPORT.elevationFt + 5) {
    return { ...flown, altitudeFt: LAB_AIRPORT.elevationFt, headingDeg: 90, journey: { ...j, phase: 'rollout' } }
  }
  return flown
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
  private rand: () => number
  private pendingAdsc: Measurement[] = []
  private nextSafetyS = 0
  private nextHistoryS = 0

  constructor(seed = 11) {
    this.rand = mulberry32(seed)
    this.reset()
  }

  reset() {
    this.timeS = 0
    this.aircraft = [createJourneyAircraft(0), ...createTraffic()]
    this.tracks.clear()
    this.history.clear()
    this.alerts = []
    this.log = []
    this.pendingAdsc = []
    this.vhfStandby = false
    this.nextSafetyS = 0
    this.nextHistoryS = 0
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

  /** Controller instruction resolving the conflict: CNS9B climbs 2,000 ft. */
  resolveConflict() {
    const b = this.aircraft.find((x) => x.id === 'CNS9B')
    if (!b) return
    this.setAircraft('CNS9B', { targetAltitudeFt: b.altitudeFt + 2000 })
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
    if (!m) return
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

  step(dt: number) {
    if (dt <= 0) return
    // Split big steps so radar sweeps and message timing stay accurate.
    const n = Math.max(1, Math.ceil(dt / 0.5))
    for (let i = 0; i < n; i++) this.stepOnce(dt / n)
  }

  private stepOnce(dt: number) {
    const t0 = this.timeS
    this.timeS += dt
    const measurements: Measurement[] = []

    // 1. Aircraft.
    this.aircraft = this.aircraft.map((a) => {
      if (a.journey) {
        const j = stepJourney(a, dt)
        if (j.journey?.phase === 'landed' && a.journey.phase !== 'landed') {
          this.addLog('CNS700 has landed on runway 09. The journey starts again shortly.')
          return { ...j, journey: { ...j.journey, landedAtS: this.timeS } }
        }
        return j
      }
      return { ...(stepAircraftFine(a, dt) as SbAircraft) }
    })
    // Scenario aircraft that have flown far away are removed.
    this.aircraft = this.aircraft.filter((a) => !a.scenario || distanceNm(a.pos, { x: 0, y: 0 }) < 90)
    const ja = this.journeyAircraft
    if (ja?.journey?.phase === 'landed' && ja.journey.landedAtS !== undefined && this.timeS - ja.journey.landedAtS > 60) {
      this.aircraft = this.aircraft.map((a) => (a.journey ? createJourneyAircraft(this.timeS) : a))
      this.tracks.delete('CNS700')
      this.history.delete('CNS700')
    }
    this.applyTaws()

    // 2. Radars: rotating antennas paint what they sweep.
    const appSpan = (360 / APPROACH_RADAR.rotationPeriodS) * dt
    const enrSpan = (360 / ENROUTE_RADAR.rotationPeriodS) * dt
    for (const a of this.aircraft) {
      if (a.journey?.phase === 'landed') continue
      if (this.systemUp('radarApp') && sweepCovers(bearingDeg(APPROACH_RADAR_SITE.pos, a.pos), this.appAz, appSpan)) {
        measurements.push(...this.radarPlots(a, APPROACH_RADAR_SITE, APPROACH_RADAR, SSR_RANGE_APP_NM))
      }
      if (this.systemUp('radarEnr') && sweepCovers(bearingDeg(ENROUTE_RADAR_SITE.pos, a.pos), this.enrAz, enrSpan)) {
        measurements.push(...this.radarPlots(a, ENROUTE_RADAR_SITE, ENROUTE_RADAR, SSR_RANGE_ENR_NM))
      }
    }
    this.appAz = normalize360(this.appAz + appSpan)
    this.enrAz = normalize360(this.enrAz + enrSpan)

    // 3. ADS-B, WAM and ADS-C.
    this.aircraft = this.aircraft.map((a) => {
      if (a.journey?.phase === 'landed') return a
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

    // 4. Fusion.
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

    // 5. Safety nets once per second.
    if (this.timeS >= this.nextSafetyS || t0 === 0) {
      this.nextSafetyS = this.timeS + 1
      this.runSafetyNets()
    }
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

/** Planned journey sampled every `dtS` seconds (deterministic, for the timeline). */
export function simulateJourney(dtS = 10, maxS = 3 * 3600): { t: number; pos: Vec2; altitudeFt: number; stage: Stage }[] {
  let a = createJourneyAircraft(0)
  const out: { t: number; pos: Vec2; altitudeFt: number; stage: Stage }[] = []
  for (let t = 0; t <= maxS; t += dtS) {
    out.push({ t, pos: a.pos, altitudeFt: a.altitudeFt, stage: journeyStage(a) })
    if (a.journey?.phase === 'landed') break
    // Fly in 1 s pieces for fidelity.
    for (let k = 0; k < dtS; k++) a = stepJourney(a, 1)
  }
  return out
}

export const GLIDE_ANGLE = GS_ANGLE_DEG
export { INTERCEPT }
