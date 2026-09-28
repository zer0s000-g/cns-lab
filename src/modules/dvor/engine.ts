/**
 * VOR scenario engine: one station (CVOR or DVOR), one aircraft, a building
 * that can reflect the signal, and the station's monitor. Uses only pure
 * functions from src/core. TRUE degrees internally; radials are magnetic.
 */

import { bearingDeg, destinationPoint, distanceNm, magneticToTrue, normalize180, normalize360, toRad, trueToMagnetic, type Vec2 } from '@/core/geometry'
import { lineOfSight, radioLineOfSightNm } from '@/core/propagation'
import { valueNoise } from '@/core/random'
import {
  coneRadiusNm,
  coneState,
  coneSwingFactor,
  DVOR_RING,
  dvorModulationIndex,
  MONITOR,
  monitorShouldAlarm,
  reflectionAmplitude,
  reflectionPathDifferenceM,
  siteErrorDeg,
  vorCdi,
  vorElevationDeg,
  wavelengthAtMHz,
  type ConeState,
  type VorCdi,
  type VorType,
} from '@/core/vor'
import { createAircraft, stepAircraftFine, terrainElevationFt, terrainFn, type Aircraft } from '@/core/world'

export interface VorEnv {
  type: VorType
  building: boolean
  /** Distance of the building from the station, m. */
  buildingDistanceM: number
  /** A fault makes the main transmitter's bearing drift. */
  fault: boolean
  /** A second transmitter takes over after an alarm. */
  standby: boolean
  identRemoved: boolean
}

export const DEFAULT_ENV: VorEnv = { type: 'dvor', building: false, buildingDistanceM: 250, fault: false, standby: false, identRemoved: false }

export const STATION_POS: Vec2 = { x: 3, y: -2 }
export const STATION = {
  pos: STATION_POS,
  ident: 'CNS',
  elevationFt: terrainElevationFt(STATION_POS),
  /** Antenna height above the ground, ft. */
  antennaFt: 15,
  /** TODO(expert-review): typical service range of a high-altitude VOR (the simulator uses 130 NM). */
  maxRangeNm: 130,
} as const

/** True bearing of the building from the station. */
export const BUILDING_BEARING_TRUE = 60
/** Magnetic variation in this fictional area, degrees East (a scenario value). */
export const DEFAULT_VARIATION = 1
export const DEFAULT_FREQ_MHZ = 113.0
/** Bearing drift of a faulty transmitter, degrees per second. */
export const FAULT_DRIFT_DEG_PER_S = 0.25
/** The commutation / rotation is drawn this many times slower than reality. */
export const SIGNAL_SLOWDOWN = 120

export type Autopilot = 'heading' | 'track' | 'orbit' | 'direct'
export type StationStatus = 'normal' | 'alarm' | 'standby'
export type Preset = 'start' | 'west' | 'overfly' | 'circle' | 'building'

export interface VorReading {
  bearingFromStationTrue: number
  /** Geometric radial (magnetic), what a perfect station would give. */
  radialGeometric: number
  distanceNm: number
  heightAboveStationFt: number
  elevationDeg: number
  cone: ConeState
  /** Station radiating (not shut down by its monitor). */
  radiating: boolean
  /** In line of sight and within range. */
  inCoverage: boolean
  /** Signal received at all (carrier present). */
  received: boolean
  siteErrorDeg: number
  faultErrorDeg: number
  swingDeg: number
  /** The radial the receiver computes (= measured phase difference), or null with no signal. */
  radialMeasured: number | null
  /** Whether the needle and flag can be trusted (not in the cone, signal present). */
  usable: boolean
  cdi: VorCdi
  identAudible: boolean
}

export interface ErrorSample {
  radial: number
  error: number
}

function defaultAircraft(variation = DEFAULT_VARIATION): Aircraft {
  const pos = destinationPoint(STATION_POS, magneticToTrue(250, variation), 18)
  return createAircraft({ id: 'CNS101', pos, altitudeFt: 6000, headingDeg: magneticToTrue(45, variation), speedKt: 250 })
}

export class DvorEngine {
  env: VorEnv = { ...DEFAULT_ENV }
  variationDeg = DEFAULT_VARIATION
  freqMHz = DEFAULT_FREQ_MHZ
  obsDeg = 60
  aircraft: Aircraft = defaultAircraft()
  autopilot: Autopilot = 'heading'
  orbitRadiusNm = 6
  timeS = 0
  /** Slowed-down signal time for the commutation animation, s. */
  signalTimeS = 0
  status: StationStatus = 'normal'
  /** Accumulated bearing drift of the main transmitter, degrees. */
  faultDriftDeg = 0
  alarmAtS = -Infinity
  /** Recent aircraft positions (for the track on the map). */
  trail: Vec2[] = []
  /** Recent (radial, site error) samples for the course-error chart. */
  errorTrail: ErrorSample[] = []
  last!: VorReading
  private lastTrailS = -Infinity
  private readonly terrain = terrainFn()

  constructor() {
    this.update()
  }

  reset() {
    this.env = { ...DEFAULT_ENV }
    this.variationDeg = DEFAULT_VARIATION
    this.freqMHz = DEFAULT_FREQ_MHZ
    this.obsDeg = 60
    this.aircraft = defaultAircraft()
    this.autopilot = 'heading'
    this.orbitRadiusNm = 6
    this.timeS = 0
    this.signalTimeS = 0
    this.status = 'normal'
    this.faultDriftDeg = 0
    this.alarmAtS = -Infinity
    this.trail = []
    this.errorTrail = []
    this.lastTrailS = -Infinity
    this.update()
  }

  get buildingPos(): Vec2 {
    return destinationPoint(STATION.pos, BUILDING_BEARING_TRUE, this.env.buildingDistanceM / 1852)
  }

  get modulationIndex() {
    return dvorModulationIndex(DVOR_RING.radiusM, this.freqMHz)
  }

  /** Advance the world by dt (0 while paused) and recompute what the receiver sees. */
  step(dt: number) {
    if (dt > 0) {
      this.timeS += dt
      this.signalTimeS += dt / SIGNAL_SLOWDOWN
      if (this.autopilot === 'track') this.steerTrack()
      this.aircraft = stepAircraftFine(this.aircraft, dt)
      this.syncAutopilot()
      this.stepMonitor(dt)
      if (this.timeS - this.lastTrailS >= 2) {
        this.trail.push({ ...this.aircraft.pos })
        if (this.trail.length > 240) this.trail.shift()
        this.lastTrailS = this.timeS
      }
    }
    this.update()
    if (dt > 0 && this.env.building && this.last.received) {
      this.errorTrail.push({ radial: trueToMagnetic(this.last.bearingFromStationTrue, this.variationDeg), error: this.last.siteErrorDeg })
      if (this.errorTrail.length > 1500) this.errorTrail.shift()
    }
  }

  /** Bearing shift the monitor antenna sees: only the station's own faults, not far-away reflections. */
  get monitorShiftDeg(): number {
    return this.status === 'normal' ? this.faultDriftDeg : 0
  }

  private stepMonitor(dt: number) {
    if (!this.env.fault) {
      // Repaired: back to normal on the main transmitter.
      this.faultDriftDeg = 0
      this.status = 'normal'
      this.alarmAtS = -Infinity
      return
    }
    if (this.status === 'normal') {
      this.faultDriftDeg += FAULT_DRIFT_DEG_PER_S * dt
      if (monitorShouldAlarm(this.faultDriftDeg)) {
        this.status = 'alarm'
        this.alarmAtS = this.timeS
      }
    } else if (this.status === 'alarm' && this.env.standby && this.timeS - this.alarmAtS >= MONITOR.changeoverS) {
      this.status = 'standby'
    } else if (this.status === 'standby' && !this.env.standby) {
      this.status = 'alarm'
    }
  }

  update() {
    const a = this.aircraft
    const st = STATION
    const brg = bearingDeg(st.pos, a.pos)
    const dist = distanceNm(st.pos, a.pos)
    const hAbove = a.altitudeFt - (st.elevationFt + st.antennaFt)
    const elevationDeg = vorElevationDeg(dist, hAbove)
    const cone = coneState(elevationDeg)
    const radiating = this.status !== 'alarm'
    const stationMsl = st.elevationFt + st.antennaFt
    const inRange = dist <= Math.min(st.maxRangeNm, radioLineOfSightNm(st.antennaFt, Math.max(0, a.altitudeFt - st.elevationFt)) + 1)
    const inCoverage = inRange && (dist < 1 || lineOfSight(st.pos, stationMsl, a.pos, a.altitudeFt, this.terrain, 0.5).visible)
    const received = radiating && inCoverage

    let siteError = 0
    if (this.env.building && received) {
      const b = this.buildingPos
      const amp = reflectionAmplitude(this.env.buildingDistanceM)
      const phase = (2 * Math.PI * reflectionPathDifferenceM(st.pos, b, a.pos, hAbove)) / wavelengthAtMHz(this.freqMHz)
      siteError = siteErrorDeg(this.env.type, brg, BUILDING_BEARING_TRUE, amp, phase, this.modulationIndex)
    }
    const faultError = this.status === 'normal' ? this.faultDriftDeg : 0
    // Near and inside the cone the variable signal is garbled: the needle swings.
    const swingAmp = cone === 'cone' ? 120 : 30 * coneSwingFactor(elevationDeg)
    const swing = swingAmp > 0 ? swingAmp * (2 * valueNoise(this.timeS * 1.3, 3, 11) - 1) : 0
    const radialGeo = trueToMagnetic(brg, this.variationDeg)
    const radialMeasured = received ? normalize360(radialGeo + siteError + faultError + swing) : null
    const usable = received && cone !== 'cone'
    const cdi: VorCdi = usable ? vorCdi(this.obsDeg, radialMeasured!) : { toFrom: 'OFF', deviationDeg: 0, lateral: 0 }

    this.last = {
      bearingFromStationTrue: brg,
      radialGeometric: radialGeo,
      distanceNm: dist,
      heightAboveStationFt: hAbove,
      elevationDeg,
      cone,
      radiating,
      inCoverage,
      received,
      siteErrorDeg: siteError,
      faultErrorDeg: faultError,
      swingDeg: swing,
      radialMeasured,
      usable,
      cdi,
      identAudible: received && !this.env.identRemoved,
    }
  }

  /**
   * "Fly the OBS course": steer by the needle. Correction is proportional to
   * the distance off course (not the angle), so it stays calm near the station;
   * with the flag OFF (in the cone) it just holds the heading.
   */
  private steerTrack() {
    const r = this.last
    const a = this.aircraft
    if (!r.usable || r.cdi.toFrom === 'OFF') return
    const offNm = r.distanceNm * Math.sin(toRad(r.cdi.deviationDeg))
    const correction = Math.max(-40, Math.min(40, offNm * 25))
    this.aircraft = { ...a, mode: { kind: 'heading' }, targetHeadingDeg: magneticToTrue(this.obsDeg + correction, this.variationDeg) }
  }

  setAutopilot(mode: Autopilot) {
    this.autopilot = mode
    const a = this.aircraft
    if (mode === 'orbit') {
      this.aircraft = { ...a, mode: { kind: 'orbit', center: { ...STATION.pos }, radiusNm: this.orbitRadiusNm, clockwise: true } }
    } else if (mode === 'direct') {
      this.aircraft = { ...a, mode: { kind: 'direct', to: { ...STATION.pos }, thenHeading: bearingDeg(a.pos, STATION.pos) } }
    } else {
      this.aircraft = { ...a, mode: { kind: 'heading' }, targetHeadingDeg: a.mode.kind === 'heading' ? a.targetHeadingDeg : a.headingDeg }
    }
  }

  setOrbitRadius(r: number) {
    this.orbitRadiusNm = r
    if (this.autopilot === 'orbit') this.setAutopilot('orbit')
  }

  setHeading(headingTrue: number) {
    this.autopilot = 'heading'
    this.aircraft = { ...this.aircraft, mode: { kind: 'heading' }, targetHeadingDeg: normalize360(headingTrue) }
  }

  setAircraft(patch: Partial<Aircraft>) {
    this.aircraft = { ...this.aircraft, ...patch }
    if (patch.pos) this.trail = []
    this.update()
  }

  setObs(deg: number) {
    this.obsDeg = normalize360(Math.round(deg))
    this.update()
  }

  /** The "direct to station" autopilot hands back to heading hold after passing overhead. */
  syncAutopilot() {
    if (this.autopilot === 'direct' && this.aircraft.mode.kind === 'heading') this.autopilot = 'heading'
  }

  /** Aircraft on a magnetic radial at a distance, heading a magnetic course. */
  private putOnRadial(radial: number, distNm: number, headingMag: number, altitudeFt: number, speedKt = 250) {
    const pos = destinationPoint(STATION.pos, magneticToTrue(radial, this.variationDeg), distNm)
    const h = magneticToTrue(headingMag, this.variationDeg)
    this.aircraft = {
      ...this.aircraft,
      pos,
      headingDeg: h,
      targetHeadingDeg: h,
      altitudeFt,
      targetAltitudeFt: altitudeFt,
      speedKt,
      targetSpeedKt: speedKt,
      mode: { kind: 'heading' },
      held: false,
    }
    this.trail = []
    this.errorTrail = []
  }

  place(preset: Preset) {
    switch (preset) {
      case 'start':
        this.aircraft = defaultAircraft(this.variationDeg)
        this.autopilot = 'heading'
        this.trail = []
        break
      case 'west':
        // 12 NM out on radial 270, heading 090 toward the station.
        this.putOnRadial(270, 12, 90, 6000)
        this.obsDeg = 90
        this.setAutopilot('track')
        break
      case 'overfly':
        // High and inbound: the cone of confusion is wide up here.
        this.putOnRadial(270, 10, 90, 20000)
        this.obsDeg = 90
        this.setAutopilot('track')
        break
      case 'circle': {
        this.putOnRadial(180, 5, 270, 6000)
        this.orbitRadiusNm = 5
        this.setAutopilot('orbit')
        break
      }
      case 'building': {
        // Circling at 6 NM where the building's reflection matters most (at right angles to it).
        const radial = normalize180(trueToMagnetic(BUILDING_BEARING_TRUE + 90, this.variationDeg))
        this.putOnRadial(normalize360(radial - 20), 6, normalize360(radial - 20 + 90), 6000)
        this.orbitRadiusNm = 6
        this.setAutopilot('orbit')
        break
      }
    }
    this.update()
  }

  /** Ground distance at which the aircraft enters the cone at its current height, NM. */
  get coneRadiusHereNm(): number {
    return coneRadiusNm(this.last.heightAboveStationFt)
  }
}
