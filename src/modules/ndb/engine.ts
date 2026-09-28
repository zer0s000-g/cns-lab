/**
 * NDB / ADF scenario engine. One beacon, one aircraft, and the errors that
 * make a real ADF needle misbehave. Uses only pure functions from src/core.
 *
 * Everything is TRUE degrees internally; magnetic values are made only for
 * display (RMI, formula readout) with the local magnetic variation.
 */

import { angleDiff, bearingDeg, destinationPoint, distanceNm, normalize180, normalize360, relativeBearing, type Vec2 } from '@/core/geometry'
import {
  adfTruth,
  coastalRefractionErrorDeg,
  elevationDeg,
  groundWaveMarginDb,
  hasUsableSignal,
  lightningErrorDeg,
  LIGHTNING,
  loopOnlyIndication,
  mountainReflectionErrorDeg,
  nightEffectErrorDeg,
  noiseWanderDeg,
  rmiValues,
  smoothNoise,
  verticalMastGainDb,
  type AdfTruth,
  type CoastCrossing,
  type LightningFlash,
  type MountainReflector,
  type RmiValues,
} from '@/core/ndb'
import { mulberry32 } from '@/core/random'
import { FT_PER_NM } from '@/core/units'
import { createAircraft, DEFAULT_TERRAIN, stepAircraftFine, terrainElevationFt, type Aircraft } from '@/core/world'

export type TimeOfDay = 'day' | 'dusk' | 'night' | 'dawn'
export const TIME_OF_DAY_HOUR: Record<TimeOfDay, number> = { day: 12, dusk: 18, night: 0, dawn: 6 }

export interface NdbEnv {
  /** Local time, hours (0..24). Sky waves appear at night. */
  hour: number
  storm: boolean
  coastal: boolean
  mountain: boolean
  /** Sense antenna working. When false the ADF has a 180° ambiguity. */
  sense: boolean
}

export const DEFAULT_ENV: NdbEnv = { hour: 12, storm: false, coastal: false, mountain: false, sense: true }

export interface NdbStation {
  pos: Vec2
  ident: string
  freqKhz: number
  /** Distance to which the beacon's signal is guaranteed strong enough, NM. */
  ratedCoverageNm: number
  /** Ground elevation at the mast, ft. */
  elevationFt: number
}

export const STATION_POS: Vec2 = { x: 20, y: 8 }
export const DEFAULT_STATION: NdbStation = {
  pos: STATION_POS,
  ident: 'LAB',
  freqKhz: 344,
  ratedCoverageNm: 60,
  elevationFt: terrainElevationFt(STATION_POS),
}

/** Magnetic variation in this fictional area, degrees East (a scenario value). */
export const DEFAULT_VARIATION = 1

export type Autopilot = 'heading' | 'home' | 'orbit'

export interface AdfIndication {
  truth: AdfTruth
  marginDb: number
  signal: boolean
  /** Needle: indicated relative bearing, null when there is no usable signal. */
  relative: number | null
  /** Indicated true bearing to the station (what the needle implies on the map). */
  bearingTrue: number | null
  /** Magnetic values from the NEEDLE (RMI and formula). */
  rmi: RmiValues | null
  errors: { night: number; storm: number; coastal: number; mountain: number; noise: number; total: number }
  /** The loop-only ADF is showing the wrong one of its two answers. */
  ambiguous: boolean
  crossings: CoastCrossing[]
  reflectors: MountainReflector[]
}

export interface StormCell {
  center: Vec2
  radiusNm: number
}

export type Preset = 'start' | 'near' | 'far' | 'coast' | 'mountains' | 'behind'

function defaultAircraft(): Aircraft {
  return createAircraft({ id: 'CNS101', pos: { x: -5, y: -12 }, altitudeFt: 4000, headingDeg: 70, speedKt: 200 })
}

export class NdbEngine {
  station: NdbStation = { ...DEFAULT_STATION, pos: { ...DEFAULT_STATION.pos } }
  env: NdbEnv = { ...DEFAULT_ENV }
  variationDeg = DEFAULT_VARIATION
  aircraft: Aircraft = defaultAircraft()
  autopilot: Autopilot = 'heading'
  orbitRadiusNm = 5
  timeS = 0
  storm: StormCell = { center: { x: 30, y: -6 }, radiusNm: 5 }
  flashes: LightningFlash[] = []
  /** World time of the last station passage (the needle swinging to the tail). */
  lastPassageS = -Infinity
  /** Recent aircraft positions, every 2 s of world time (the track on the map). */
  trail: Vec2[] = []
  private lastTrailS = -Infinity
  last!: AdfIndication
  private nextFlashS = 0
  private rand: () => number
  private readonly seed: number
  private wasAhead: boolean | null = null
  /** "Turn to the needle" in progress: keep correcting until the needle sits on the nose. */
  private capturing = false

  constructor(seed = 7) {
    this.seed = seed
    this.rand = mulberry32(seed)
    this.nextFlashS = this.drawFlashWait()
    this.update()
  }

  reset() {
    this.env = { ...DEFAULT_ENV }
    this.station = { ...DEFAULT_STATION, pos: { ...DEFAULT_STATION.pos } }
    this.variationDeg = DEFAULT_VARIATION
    this.aircraft = defaultAircraft()
    this.autopilot = 'heading'
    this.orbitRadiusNm = 5
    this.timeS = 0
    this.flashes = []
    this.lastPassageS = -Infinity
    this.trail = []
    this.lastTrailS = -Infinity
    this.wasAhead = null
    this.capturing = false
    this.rand = mulberry32(this.seed)
    this.nextFlashS = this.drawFlashWait()
    this.update()
  }

  /** Time of the next flash after `fromS` (exponential waiting time). */
  private drawFlashWait(fromS = this.timeS) {
    return fromS - Math.log(1 - this.rand()) / LIGHTNING.ratePerS
  }

  /** Advance the world by dt seconds (0 while paused) and recompute the needle. */
  step(dt: number) {
    if (dt > 0) {
      this.timeS += dt
      if (this.autopilot === 'home') this.steerHome()
      else if (this.capturing) this.steerCapture()
      this.aircraft = stepAircraftFine(this.aircraft, dt)
      if (this.timeS - this.lastTrailS >= 2) {
        this.trail.push({ ...this.aircraft.pos })
        if (this.trail.length > 240) this.trail.shift()
        this.lastTrailS = this.timeS
      }
      if (this.env.storm) this.makeFlashes()
      const keep = this.timeS - LIGHTNING.memoryS
      if (this.flashes.length && this.flashes[0].timeS < keep) this.flashes = this.flashes.filter((f) => f.timeS >= keep)
    }
    this.update()
  }

  /**
   * Lightning flashes arrive as a random (Poisson) process. The random draws
   * happen only at flash times, so the sequence does not depend on frame rate.
   */
  private makeFlashes() {
    // After the storm was switched off for a while, start afresh instead of catching up.
    if (this.nextFlashS < this.timeS - LIGHTNING.memoryS) this.nextFlashS = this.drawFlashWait(this.timeS)
    while (this.nextFlashS <= this.timeS) {
      const r = this.storm.radiusNm * Math.sqrt(this.rand())
      const a = this.rand() * 360
      this.flashes.push({ timeS: this.nextFlashS, pos: destinationPoint(this.storm.center, a, r), strength: 0.5 + this.rand() })
      this.nextFlashS = this.drawFlashWait(this.nextFlashS)
    }
  }

  /** Recompute the ADF indication from the current state. */
  update() {
    const a = this.aircraft
    const st = this.station
    const truth = adfTruth(a.pos, a.headingDeg, st.pos)
    const heightFt = a.altitudeFt - st.elevationFt
    const slant = Math.hypot(truth.distanceNm, Math.max(0, heightFt) / FT_PER_NM)
    // The mast radiates little straight up, so the signal dips right overhead.
    const marginDb = groundWaveMarginDb(slant, st.ratedCoverageNm) + verticalMastGainDb(elevationDeg(truth.distanceNm, heightFt))
    const signal = hasUsableSignal(marginDb)

    const night = nightEffectErrorDeg(truth.distanceNm, this.env.hour, st.freqKhz, this.timeS, this.seed)
    const coast = this.env.coastal ? coastalRefractionErrorDeg(st.pos, a.pos, DEFAULT_TERRAIN.coastX) : { errorDeg: 0, crossings: [] }
    const mtn = this.env.mountain
      ? mountainReflectionErrorDeg(st.pos, a.pos, a.altitudeFt, DEFAULT_TERRAIN.hills, st.freqKhz)
      : { errorDeg: 0, reflectors: [] }
    const noise = noiseWanderDeg(marginDb) * smoothNoise(this.timeS, 0.6, 5, this.seed)
    const pre = normalize360(truth.bearingTrue + night + coast.errorDeg + mtn.errorDeg + noise)
    const storm = this.env.storm ? lightningErrorDeg(pre, this.flashes, this.timeS, a.pos, st.pos) : 0
    const indicated = normalize360(pre + storm)

    let relative: number | null = null
    let ambiguous = false
    if (signal) {
      relative = relativeBearing(indicated, a.headingDeg)
      if (!this.env.sense) {
        const shown = loopOnlyIndication(relative)
        ambiguous = Math.abs(angleDiff(shown, relative)) > 90
        relative = shown
      }
    }
    const bearingTrue = relative == null ? null : normalize360(a.headingDeg + relative)
    this.last = {
      truth,
      marginDb,
      signal,
      relative,
      bearingTrue,
      rmi: relative == null ? null : rmiValues(a.headingDeg, relative, this.variationDeg),
      errors: {
        night,
        storm,
        coastal: coast.errorDeg,
        mountain: mtn.errorDeg,
        noise,
        total: bearingTrue == null ? 0 : angleDiff(truth.bearingTrue, bearingTrue),
      },
      ambiguous,
      crossings: coast.crossings,
      reflectors: mtn.reflectors,
    }

    // Station passage: the station goes from ahead of the wings to behind them, close by.
    const ahead = Math.abs(normalize180(truth.relative)) < 90
    if (this.wasAhead === true && !ahead && truth.distanceNm < 3) this.lastPassageS = this.timeS
    this.wasAhead = ahead
  }

  /** Home with the ADF: keep turning so the NEEDLE stays on the nose (errors and all). */
  private steerHome() {
    const ind = this.last
    const a = this.aircraft
    if (ind.relative == null) return
    const behind = Math.abs(normalize180(ind.relative)) > 90
    if (ind.truth.distanceNm < 0.4 || (behind && ind.truth.distanceNm < 2)) {
      // Overhead: stop homing and hold the heading, like a pilot would.
      this.autopilot = 'heading'
      this.aircraft = { ...a, mode: { kind: 'heading' }, targetHeadingDeg: a.headingDeg }
      return
    }
    this.aircraft = { ...a, mode: { kind: 'heading' }, targetHeadingDeg: normalize360(a.headingDeg + ind.relative) }
  }

  /** One-shot "put the needle on the nose": steer with the needle, then hold that heading. */
  private steerCapture() {
    const ind = this.last
    const a = this.aircraft
    if (ind.relative == null || a.mode.kind !== 'heading') {
      this.capturing = false
      return
    }
    const target = normalize360(a.headingDeg + ind.relative)
    if (Math.abs(normalize180(ind.relative)) < 0.3) {
      this.capturing = false
      this.aircraft = { ...a, targetHeadingDeg: a.headingDeg }
      return
    }
    this.aircraft = { ...a, targetHeadingDeg: target }
  }

  setAutopilot(mode: Autopilot) {
    this.capturing = false
    this.autopilot = mode
    const a = this.aircraft
    if (mode === 'orbit') {
      this.aircraft = { ...a, mode: { kind: 'orbit', center: { ...this.station.pos }, radiusNm: this.orbitRadiusNm, clockwise: true } }
    } else {
      this.aircraft = { ...a, mode: { kind: 'heading' }, targetHeadingDeg: a.mode.kind === 'heading' ? a.targetHeadingDeg : a.headingDeg }
    }
  }

  setOrbitRadius(r: number) {
    this.orbitRadiusNm = r
    if (this.autopilot === 'orbit') this.setAutopilot('orbit')
  }

  /** Turn until the needle is on the nose, then hold that heading (a pilot flying "needle on the nose"). */
  turnToNeedle() {
    const rel = this.last.relative
    if (rel == null) return
    this.autopilot = 'heading'
    const a = this.aircraft
    this.aircraft = { ...a, mode: { kind: 'heading' }, targetHeadingDeg: normalize360(a.headingDeg + rel) }
    this.capturing = true
  }

  /** The learner set a heading by hand: stop any automatic steering. */
  setHeading(headingTrue: number) {
    this.capturing = false
    this.autopilot = 'heading'
    this.aircraft = { ...this.aircraft, mode: { kind: 'heading' }, targetHeadingDeg: normalize360(headingTrue) }
  }

  setAircraft(patch: Partial<Aircraft>) {
    if (patch.pos || patch.mode) this.capturing = false
    if (patch.pos) this.trail = []
    this.aircraft = { ...this.aircraft, ...patch }
    this.wasAhead = null
    this.update()
  }

  /** Put a thunderstorm 16 NM from the aircraft, 55° to the right of the beacon. */
  placeStormNearAircraft() {
    const a = this.aircraft
    const toStation = bearingDeg(a.pos, this.station.pos)
    this.storm = { center: destinationPoint(a.pos, toStation + 55, 16), radiusNm: 5 }
    this.flashes = []
    this.nextFlashS = this.drawFlashWait()
  }

  /** Is the storm still close enough to matter? */
  stormIsNear(): boolean {
    return distanceNm(this.aircraft.pos, this.storm.center) < 35
  }

  /** "Set it up" positions used by the experiments and the controls. */
  place(preset: Preset) {
    const st = this.station.pos
    this.capturing = false
    const at = (pos: Vec2, headingDeg: number, altitudeFt: number, speedKt = 200) => {
      this.autopilot = 'heading'
      this.aircraft = {
        ...this.aircraft,
        pos,
        headingDeg,
        targetHeadingDeg: headingDeg,
        altitudeFt,
        targetAltitudeFt: altitudeFt,
        speedKt,
        targetSpeedKt: speedKt,
        mode: { kind: 'heading' },
        held: false,
      }
    }
    switch (preset) {
      case 'start':
        this.aircraft = defaultAircraft()
        this.autopilot = 'heading'
        break
      case 'near': {
        // 20 NM south-west, heading 60° to the right of the beacon.
        const p = destinationPoint(st, 225, 20)
        at(p, normalize360(bearingDeg(p, st) + 60), 4000)
        break
      }
      case 'far': {
        const p = destinationPoint(st, 250, 55)
        at(p, bearingDeg(p, st), 5000)
        break
      }
      case 'behind': {
        // 12 NM north-east of the beacon, flying away from it.
        const p = destinationPoint(st, 60, 12)
        at(p, 60, 4000)
        break
      }
      case 'coast':
        // Just off the coast, flying north: the path to the beacon crosses the coast at ever shallower angles.
        at({ x: 42, y: 46 }, 0, 3000)
        break
      case 'mountains':
        // South of the North Range, heading west-north-west past the peaks.
        at({ x: -4, y: 20 }, 290, 5500)
        break
    }
    this.wasAhead = null
    this.trail = []
    this.update()
  }
}
