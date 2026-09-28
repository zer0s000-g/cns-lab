/**
 * ILS scenario engine: one aircraft flying an approach to runway 09 of the
 * CNS Lab airport. The pilot (the learner) or a simple autopilot flies it
 * with heading and vertical-speed targets; the aircraft only moves through
 * stepAircraft (turn ≤ 3°/s, limited climb and descent). The receiver sees
 * the localizer and glideslope signals from src/core/ils.ts, including
 * multipath from a vehicle in the critical area, a course shift that the
 * monitor catches, and weak signals outside the coverage area.
 */

import {
  activeMarker,
  cdiLateral,
  cdiVertical,
  courseShiftDdm,
  coverageNoiseDdm,
  createIlsSite,
  distanceFromGpipFt,
  distanceToThresholdNm,
  flagProbability,
  glidePathDescentFpm,
  glideslopeAzimuthDeg,
  glideslopeCoverageSeverity,
  glideslopeDdm,
  glideslopeElevationDeg,
  glideslopeRangeNm,
  GS_MODEL_AMPLITUDE,
  GS_TONE_DEPTH,
  ILS_CATEGORIES,
  lateralOffsetNm,
  LOC_IDENT_INTERVAL_S,
  LOC_SHIFT_ALARM_M,
  LOC_TONE_DEPTH,
  localizerAzimuthDeg,
  localizerCoverageSeverity,
  localizerDdm,
  localizerElevationDeg,
  localizerRangeNm,
  MONITOR_DELAY_S,
  onPathHeightFt,
  toneDepths,
  vehicleMultipathDdm,
  visualReference,
  type IlsCategory,
  type IlsSite,
  type VisualReference,
} from '@/core/ils'
import { bearingVector, destinationPoint, normalize360, toRad, type Vec2 } from '@/core/geometry'
import type { MarkerKind } from '@/core/morse'
import { morseTimeline } from '@/core/morse'
import { gaussian, mulberry32 } from '@/core/random'
import { clamp, METRES_PER_FT, METRES_PER_NM } from '@/core/units'
import { createAircraft, LAB_AIRPORT, PERFORMANCE, stepAircraft, stepAircraftFine, terrainElevationFt, type Aircraft } from '@/core/world'

export type Weather = 'clear' | IlsCategory

/** Visibility used for a clear day, m. */
export const CLEAR_VISIBILITY_M = 10000
/** "Fog worse than the minimums" shows this fraction of the category's visibility. */
export const THICK_FOG_FACTOR = 0.35
/** Approach speed, kt. */
export const APPROACH_SPEED_KT = 140
/** How quickly the vertical speed can change, ft/min per second. */
export const VS_CHANGE_FPM_PER_S = 400
/** Course shift that the localizer fault grows to at the threshold, m. */
export const FAULT_SHIFT_M = 18
/** Seconds the fault takes to grow to its full size. */
export const FAULT_GROW_S = 3
/** This ILS is certified for CAT III, so its monitor must switch it off quickly. */
export const FACILITY_MONITOR_DELAY_S = MONITOR_DELAY_S.III

/** Where the parked vehicle sits in the localizer critical area (between the runway end and the antenna). */
export const TRUCK_POS: Vec2 = { x: 0.9, y: -0.025 }

export interface IlsFailures {
  /** A vehicle parked in the localizer critical area. */
  truck: boolean
  /** A transmitter fault shifts the course; the monitor switches the localizer off. */
  locFault: boolean
}

export interface ToneReading {
  /** DDM the receiver measures (true signal plus errors), positive = 90 Hz stronger. */
  ddm: number
  m90: number
  m150: number
  /** False = warning flag showing. */
  valid: boolean
  /** 0 inside the coverage area, up to 1 well outside it. */
  severity: number
}

export interface IlsReceiver {
  loc: ToneReading
  gs: ToneReading
  marker: MarkerKind | null
}

export type IlsPhase = 'approach' | 'go-around' | 'rollout' | 'stopped'

export interface Touchdown {
  /** Distance past the threshold, m (negative = short of it). */
  pastThresholdM: number
  /** Sideways offset from the centreline, m (positive = right). */
  lateralM: number
  vsFpm: number
  onRunway: boolean
}

export type IlsEvent =
  | { kind: 'marker'; marker: MarkerKind | null }
  | { kind: 'minimums'; dhFt: number; continue: boolean }
  | { kind: 'ident' }
  | { kind: 'go-around'; reason: string }
  | { kind: 'loc-off' }
  | { kind: 'touchdown'; td: Touchdown }

export interface TrailPoint {
  pos: Vec2
  heightFt: number
}

const MEDIUM = PERFORMANCE.medium

export class IlsEngine {
  readonly site: IlsSite = createIlsSite(LAB_AIRPORT.runways[0], LAB_AIRPORT.elevationFt)
  timeS = 0
  aircraft: Aircraft
  guidance = true
  weather: Weather = 'clear'
  /** Fog worse than the category allows: the pilot sees less than the minimum RVR. */
  thickFog = false
  failures: IlsFailures = { truck: false, locFault: false }
  /** Pilot targets: heading to steer, selected vertical speed and the vertical speed actually flown. */
  pilot = { targetHeadingDeg: 90, selectedVsFpm: 0, vsFpm: 0 }
  gsCaptured = true
  phase: IlsPhase = 'approach'
  touchdown: Touchdown | null = null
  minimums: { atS: number; continue: boolean; dhFt: number } | null = null
  message: string | null = null
  visual: VisualReference = { approachLights: false, runway: false, nearestM: Infinity }
  receiver: IlsReceiver
  fault = { startS: null as number | null, alarmS: null as number | null, shutdown: false }
  trail: TrailPoint[] = []
  events: IlsEvent[] = []
  /** When the aircraft entered (or left) the current marker beam; the keying starts here. */
  markerSinceS = 0
  identNextS = 2
  /** The ident is being keyed until this time (for the cockpit indicator). */
  identUntilS = -1
  private readonly identS = morseTimeline(this.site.ident, 7).totalS
  private rand = mulberry32(21)
  private hold = { locFlag: false, gsFlag: false, locNoise: 0, gsNoise: 0, flagUntil: 0, noiseUntil: 0 }
  private trailAgeS = 0

  constructor() {
    this.aircraft = createAircraft({ id: 'CNS101', callsign: 'CNS101', pos: { x: 0, y: 0 }, altitudeFt: 3000, headingDeg: 90, speedKt: APPROACH_SPEED_KT })
    this.receiver = this.computeReceiver()
    this.resetApproach(10)
  }

  // ---- geometry helpers ---------------------------------------------------

  get heightAglFt() {
    return this.aircraft.altitudeFt - terrainElevationFt(this.aircraft.pos)
  }
  /** Height above the runway threshold, ft. */
  get heightAboveRunwayFt() {
    return this.aircraft.altitudeFt - this.site.elevationFt
  }
  get distanceToThresholdNm() {
    return distanceToThresholdNm(this.site, this.aircraft.pos)
  }
  get lateralOffsetM() {
    return lateralOffsetNm(this.site, this.aircraft.pos) * METRES_PER_NM
  }
  /** Height of the glide path at the aircraft's distance, ft above the runway. */
  get onPathHeightFt() {
    return onPathHeightFt(this.site, this.distanceToThresholdNm)
  }
  get visibilityM() {
    const v = this.weather === 'clear' ? CLEAR_VISIBILITY_M : ILS_CATEGORIES[this.weather].fogRvrM
    return this.thickFog ? v * THICK_FOG_FACTOR : v
  }
  get dhFt(): number | null {
    return this.weather === 'clear' ? ILS_CATEGORIES.I.dhFt : ILS_CATEGORIES[this.weather].dhFt
  }
  get lateralNeedle() {
    return this.receiver.loc.valid ? cdiLateral(this.receiver.loc.ddm) : 0
  }
  get verticalNeedle() {
    return this.receiver.gs.valid ? cdiVertical(this.receiver.gs.ddm) : 0
  }
  /** Current course shift of the faulty localizer, m (positive = course moved right). */
  get faultShiftM() {
    if (!this.failures.locFault || this.fault.startS === null) return 0
    return FAULT_SHIFT_M * clamp((this.timeS - this.fault.startS) / FAULT_GROW_S, 0, 1)
  }
  get locOff() {
    return this.fault.shutdown
  }

  /** True localizer DDM at a point, including the vehicle and a course shift (for the views). */
  locDdmAt(p: Vec2): number {
    const az = localizerAzimuthDeg(this.site, p)
    let ddm = localizerDdm(az, this.site.halfSectorDeg)
    if (this.failures.truck && Math.abs(az) < 60) ddm += vehicleMultipathDdm(distanceToThresholdNm(this.site, p)) * (Math.abs(az) < 12 ? 1 : 0.4)
    ddm += courseShiftDdm(this.faultShiftM)
    return ddm
  }

  /** True glideslope DDM at a point and altitude (for the views). */
  gsDdmAt(p: Vec2, altitudeFt: number): number {
    return glideslopeDdm(glideslopeElevationDeg(this.site, p, altitudeFt), this.site.pathDeg)
  }

  // ---- receiver --------------------------------------------------------------

  private computeReceiver(): IlsReceiver {
    const a = this.aircraft
    const s = this.site
    const locSev = localizerCoverageSeverity(localizerAzimuthDeg(s, a.pos), localizerRangeNm(s, a.pos), localizerElevationDeg(s, a.pos, a.altitudeFt))
    const gsSev = glideslopeCoverageSeverity(glideslopeAzimuthDeg(s, a.pos), glideslopeRangeNm(s, a.pos))
    const h = this.hold
    // Weak-signal effects change a few times a second, not every frame.
    if (this.timeS >= h.flagUntil) {
      h.locFlag = this.rand() < flagProbability(locSev)
      h.gsFlag = this.rand() < flagProbability(gsSev)
      h.flagUntil = this.timeS + 0.6
    }
    if (this.timeS >= h.noiseUntil) {
      h.locNoise = gaussian(this.rand) * coverageNoiseDdm(locSev)
      h.gsNoise = gaussian(this.rand) * coverageNoiseDdm(gsSev)
      h.noiseUntil = this.timeS + 0.25
    }
    const locDdm = this.locDdmAt(a.pos) + h.locNoise
    const gsDdm = this.gsDdmAt(a.pos, a.altitudeFt) + h.gsNoise
    const lt = toneDepths(locDdm, LOC_TONE_DEPTH)
    const gt = toneDepths(gsDdm, GS_TONE_DEPTH)
    return {
      loc: { ddm: locDdm, m90: lt.m90, m150: lt.m150, valid: !this.fault.shutdown && !(locSev >= 1 || h.locFlag), severity: locSev },
      gs: { ddm: gsDdm, m90: gt.m90, m150: gt.m150, valid: !(gsSev >= 1 || h.gsFlag), severity: gsSev },
      marker: activeMarker(s, a.pos, this.heightAglFt),
    }
  }

  /** Events since the last call (and clear them). */
  takeEvents(): IlsEvent[] {
    const ev = this.events
    this.events = []
    return ev
  }

  // ---- stepping -----------------------------------------------------------

  step(dt: number) {
    if (dt <= 0) return
    this.timeS += dt
    this.updateFault()

    if (this.phase === 'stopped') {
      this.receiver = this.computeReceiver()
      return
    }
    const hBefore = this.heightAboveRunwayFt
    if (this.phase === 'rollout') this.rollout(dt)
    else this.fly(dt)

    const prevMarker = this.receiver.marker
    this.receiver = this.computeReceiver()
    if (this.receiver.marker !== prevMarker) {
      this.markerSinceS = this.timeS
      this.events.push({ kind: 'marker', marker: this.receiver.marker })
    }
    this.visual = visualReference(this.site, this.aircraft.pos, Math.max(0, this.heightAboveRunwayFt), this.visibilityM)

    // Decision height.
    const dh = this.dhFt
    const hNow = this.heightAboveRunwayFt
    if (this.phase === 'approach' && dh !== null && hBefore > dh && hNow <= dh && this.distanceToThresholdNm > -0.5 && !this.minimums) {
      const cont = this.visual.approachLights || this.visual.runway
      this.minimums = { atS: this.timeS, continue: cont, dhFt: dh }
      this.events.push({ kind: 'minimums', dhFt: dh, continue: cont })
      if (!cont && this.guidance) this.goAround('Minimums with nothing in sight')
    }

    // Ground contact.
    if ((this.phase === 'approach' || this.phase === 'go-around') && this.heightAglFt <= 0) this.touchDown()

    // Localizer ident.
    if (this.timeS >= this.identNextS) {
      this.identNextS = this.timeS + LOC_IDENT_INTERVAL_S
      if (this.receiver.loc.valid) {
        this.identUntilS = this.timeS + this.identS
        this.events.push({ kind: 'ident' })
      }
    }
    if (this.fault.shutdown) this.identUntilS = -1

    this.trailAgeS += dt
    if (this.trailAgeS >= 0.5) {
      this.trailAgeS = 0
      this.trail.push({ pos: { ...this.aircraft.pos }, heightFt: this.heightAboveRunwayFt })
      if (this.trail.length > 900) this.trail.shift()
    }
  }

  private updateFault() {
    const f = this.fault
    if (!this.failures.locFault) return
    if (f.startS === null) f.startS = this.timeS
    if (f.alarmS === null && this.faultShiftM > LOC_SHIFT_ALARM_M) f.alarmS = this.timeS
    if (!f.shutdown && f.alarmS !== null && this.timeS - f.alarmS >= FACILITY_MONITOR_DELAY_S) {
      f.shutdown = true
      this.events.push({ kind: 'loc-off' })
    }
  }

  private goAround(reason: string) {
    if (this.phase !== 'approach') return
    this.phase = 'go-around'
    this.message = `Go around: ${reason.toLowerCase()}.`
    this.events.push({ kind: 'go-around', reason })
  }

  /** The simple autopilot: follow the needles, exactly as a real one would (it cannot know the truth). */
  private guide() {
    const a = this.aircraft
    const rx = this.receiver
    const course = this.site.courseDeg
    if (this.phase === 'go-around') {
      this.pilot.targetHeadingDeg = course
      this.pilot.selectedVsFpm = this.heightAboveRunwayFt < 3000 ? 1500 : 0
      return
    }
    // Lateral: turn the needle into a cross-track estimate and steer toward the course the needle shows.
    if (rx.loc.valid) {
      const lateral = clamp(cdiLateral(rx.loc.ddm), -2.5, 2.5)
      const xtkNm = lateral * Math.tan(toRad(this.site.halfSectorDeg)) * localizerRangeNm(this.site, a.pos)
      this.pilot.targetHeadingDeg = normalize360(course + clamp(100 * xtkNm, -30, 30))
      this.message = null
    } else {
      this.pilot.targetHeadingDeg = a.headingDeg
      if (this.heightAboveRunwayFt < 1000 && this.distanceToThresholdNm < 6) {
        this.goAround('Localizer lost')
        return
      }
      this.message = 'Guidance: no localizer signal, holding heading.'
    }
    // Vertical.
    const h = this.heightAglFt
    if (h < 45 && this.distanceToThresholdNm < 0.3) {
      // Flare: round out just above the runway.
      this.pilot.selectedVsFpm = -(150 + (Math.max(h, 0) / 45) * 550)
      return
    }
    const nominal = -glidePathDescentFpm(a.speedKt, this.site.pathDeg)
    if (!rx.gs.valid) {
      if (this.gsCaptured && this.heightAboveRunwayFt < 1000) {
        this.goAround('Glideslope lost')
        return
      }
      this.gsCaptured = false
      this.pilot.selectedVsFpm = 0
      if (!this.message) this.message = 'Guidance: no glideslope signal, holding altitude.'
      return
    }
    const v = cdiVertical(rx.gs.ddm)
    if (!this.gsCaptured) {
      // Armed: hold altitude until the needle comes near the centre, then capture.
      if (Math.abs(v) < 0.8) this.gsCaptured = true
      else {
        this.pilot.selectedVsFpm = 0
        return
      }
    }
    const ddm = clamp(rx.gs.ddm, -GS_MODEL_AMPLITUDE, GS_MODEL_AMPLITUDE)
    const devDeg = (ddm / (GS_MODEL_AMPLITUDE * Math.PI)) * this.site.pathDeg
    const devFt = Math.tan(toRad(devDeg)) * distanceFromGpipFt(this.site, a.pos)
    this.pilot.selectedVsFpm = clamp(nominal + clamp(-5 * devFt, -600, 600), -MEDIUM.descentFpm, 1000)
  }

  private fly(dt: number) {
    if (this.guidance) this.guide()
    const p = this.pilot
    p.vsFpm += clamp(p.selectedVsFpm - p.vsFpm, -VS_CHANGE_FPM_PER_S * dt, VS_CHANGE_FPM_PER_S * dt)
    p.vsFpm = clamp(p.vsFpm, -MEDIUM.descentFpm, MEDIUM.climbFpm)
    const a = this.aircraft
    this.aircraft = stepAircraftFine(
      {
        ...a,
        mode: { kind: 'heading' },
        targetHeadingDeg: p.targetHeadingDeg,
        targetSpeedKt: APPROACH_SPEED_KT,
        targetAltitudeFt: a.altitudeFt + (p.vsFpm * dt) / 60,
      },
      dt,
    )
  }

  private rollout(dt: number) {
    const a = this.aircraft
    const ground = terrainElevationFt(a.pos)
    // Brakes: slow down at 4 kt per second, all the way to a stop.
    const next = stepAircraft(
      { ...a, altitudeFt: ground, targetAltitudeFt: ground, targetSpeedKt: 0, mode: { kind: 'heading' }, targetHeadingDeg: a.headingDeg },
      dt,
      { ...MEDIUM, minSpeedKt: 0, accelKtS: 4 },
    )
    this.aircraft = { ...next, altitudeFt: ground, verticalSpeedFpm: 0 }
    if (next.speedKt <= 0) this.phase = 'stopped'
  }

  private touchDown() {
    const a = this.aircraft
    const past = -this.distanceToThresholdNm * METRES_PER_NM
    const lateralM = this.lateralOffsetM
    const lengthM = this.site.runway.lengthFt * METRES_PER_FT
    const halfW = (this.site.runway.widthFt * METRES_PER_FT) / 2
    const onRunway = past >= 0 && past <= lengthM && Math.abs(lateralM) <= halfW
    const td: Touchdown = { pastThresholdM: past, lateralM, vsFpm: this.pilot.vsFpm, onRunway }
    this.touchdown = td
    this.aircraft = { ...a, altitudeFt: terrainElevationFt(a.pos), verticalSpeedFpm: 0 }
    this.pilot.vsFpm = 0
    this.pilot.selectedVsFpm = 0
    this.phase = onRunway ? 'rollout' : 'stopped'
    this.events.push({ kind: 'touchdown', td })
  }

  // ---- learner inputs and setups ---------------------------------------------

  /** Restart the scenario clock (with the page's reset button). */
  resetTime() {
    this.timeS = 0
    this.identNextS = 2
    this.identUntilS = -1
    this.markerSinceS = 0
    this.hold.flagUntil = 0
    this.hold.noiseUntil = 0
  }

  /** Steer: the learner takes control (the store switches guidance off). */
  steer(deltaDeg: number) {
    this.pilot.targetHeadingDeg = normalize360(this.pilot.targetHeadingDeg + deltaDeg)
  }
  setTargetHeading(deg: number) {
    this.pilot.targetHeadingDeg = normalize360(deg)
  }
  setSelectedVs(fpm: number) {
    this.pilot.selectedVsFpm = clamp(fpm, -MEDIUM.descentFpm, MEDIUM.climbFpm)
  }

  setFailures(f: IlsFailures) {
    if (f.locFault && !this.failures.locFault) this.fault = { startS: this.timeS, alarmS: null, shutdown: false }
    if (!f.locFault) this.fault = { startS: null, alarmS: null, shutdown: false }
    this.failures = { ...f }
  }

  /**
   * Put the aircraft on the approach `distNm` before the threshold, stabilised
   * on the glide path, unless offsets are given.
   */
  resetApproach(distNm = 10, opts: { lateralNm?: number; heightFt?: number; headingDeg?: number; vsFpm?: number } = {}) {
    const s = this.site
    const back = bearingVector(s.courseDeg + 180)
    const right = bearingVector(s.courseDeg + 90)
    const lat = opts.lateralNm ?? 0
    const pos = { x: s.threshold.x + back.x * distNm + right.x * lat, y: s.threshold.y + back.y * distNm + right.y * lat }
    const heightFt = opts.heightFt ?? onPathHeightFt(s, distNm)
    const heading = opts.headingDeg ?? s.courseDeg
    const onPath = opts.heightFt === undefined
    const vs = opts.vsFpm ?? (onPath ? -glidePathDescentFpm(APPROACH_SPEED_KT, s.pathDeg) : 0)
    this.place(pos, s.elevationFt + heightFt, heading, vs)
    this.gsCaptured = onPath
  }

  /** Put the aircraft anywhere (explicit setup). */
  place(pos: Vec2, altitudeFt: number, headingDeg: number, vsFpm = 0) {
    this.aircraft = {
      ...createAircraft({ id: 'CNS101', callsign: 'CNS101', pos, altitudeFt, headingDeg, speedKt: APPROACH_SPEED_KT }),
      verticalSpeedFpm: vsFpm,
    }
    this.pilot = { targetHeadingDeg: headingDeg, selectedVsFpm: vsFpm, vsFpm }
    this.phase = 'approach'
    this.touchdown = null
    this.minimums = null
    this.message = null
    this.trail = []
    this.trailAgeS = 0
    this.gsCaptured = true
    this.hold.flagUntil = 0
    this.hold.noiseUntil = 0
    this.receiver = this.computeReceiver()
    this.visual = visualReference(this.site, pos, Math.max(0, this.heightAboveRunwayFt), this.visibilityM)
  }

  /** 10 NM from the localizer, 45° off to the left (outside ±35°), heading 90° across the course to intercept it. */
  placeOutsideCoverage() {
    const pos = destinationPoint(this.site.locAntenna, this.site.courseDeg + 180 + 45, 10)
    this.place(pos, this.site.elevationFt + 3000, this.site.courseDeg + 90, 0)
    this.gsCaptured = false
  }

  /** Level at 3,500 ft, 6 NM out: far above the glide path, where the false paths are. */
  placeHigh() {
    this.resetApproach(6, { heightFt: 3500, vsFpm: 0 })
    this.gsCaptured = false
  }
}
