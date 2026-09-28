/**
 * Primary radar scenario engine. Orchestrates the pure physics in
 * src/core/radar.ts: a rotating antenna paints targets, clutter, rain,
 * birds and a wind farm as the beam passes over them.
 */

import { angleDiff, bearingDeg, distanceNm, normalize360, sweepCovers, type Vec2 } from '@/core/geometry'
import {
  apparentRange,
  buildGroundClutter,
  DEFAULT_RADAR,
  evaluateTarget,
  inBeam,
  mtiGain,
  MTI_RESIDUE,
  radarSnrDb,
  radialWindKt,
  rainReflectivity,
  rangeResolutionNm,
  RCS_M2,
  detectionProbability,
  type ClutterCell,
  type DetectionResult,
  type RadarParams,
  type RadarSite,
  type Storm,
} from '@/core/radar'
import { slantRangeNm } from '@/core/propagation'
import { mulberry32, gaussian } from '@/core/random'
import { createAircraft, isWater, radialSpeedKt, stepAircraftFine, terrainFn, type Aircraft } from '@/core/world'
import type { ScopePaint } from '@/instruments'

export interface PsrEnv {
  groundClutter: boolean
  rain: boolean
  birds: boolean
  windFarm: boolean
  mti: boolean
  smallFar: boolean
}

export const DEFAULT_ENV: PsrEnv = {
  groundClutter: true,
  rain: false,
  birds: false,
  windFarm: false,
  mti: false,
  smallFar: false,
}

export interface PsrAircraft extends Aircraft {
  rcsM2: number
}

/** What happened the last time the beam passed an aircraft. */
export interface LastLook extends DetectionResult {
  timeS: number
}

export interface EchoAlongBeam {
  rangeNm: number
  /** 0..1 display strength. */
  strength: number
  kind: ScopePaint['kind']
  label: string
  id?: string
}

const SITE: RadarSite = { pos: { x: 0, y: 0 }, heightFt: 90 }
/**
 * Wind blowing TOWARD 140° at 18 kt: the shower south-east of the radar drifts
 * mostly away from it, so its drops have radial speed and MTI only partly removes them.
 */
export const WIND = { speedKt: 18, toDeg: 140 }
export const STORM_START: Storm = { center: { x: 16, y: -24 }, radiusNm: 9, intensity: 1 }
export const WIND_FARM_CENTER: Vec2 = { x: 24, y: -6 }
const CLUTTER_RANGE_NM = 90

const LIGHT_NEAR = [
  { x: 12, y: -10 },
  { x: 19, y: -3 },
  { x: 12, y: 5 },
  { x: 5, y: -3 },
]
const LIGHT_FAR = [
  { x: 46, y: -32 },
  { x: 58, y: -22 },
  { x: 52, y: -12 },
  { x: 42, y: -22 },
]

function route(ac: Aircraft, waypoints: Vec2[], index = 0): Aircraft {
  return { ...ac, mode: { kind: 'route', waypoints, index, loop: true } }
}

export function createScenario(env: PsrEnv = DEFAULT_ENV): PsrAircraft[] {
  const mk = (a: Parameters<typeof createAircraft>[0], rcs: number): PsrAircraft => ({ ...createAircraft(a), rcsM2: rcs })
  return [
    { ...route(mk({ id: 'CNS101', pos: { x: 10, y: 30 }, altitudeFt: 12000, headingDeg: 90, speedKt: 280 }, RCS_M2.medium), [{ x: 36, y: 30 }, { x: 36, y: 8 }, { x: 10, y: 8 }, { x: 10, y: 30 }]), rcsM2: RCS_M2.medium },
    { ...route(mk({ id: 'CNS202', category: 'heavy', pos: { x: -45, y: -42 }, altitudeFt: 35000, headingDeg: 90, speedKt: 460 }, RCS_M2.heavy), [{ x: 48, y: -42 }, { x: 48, y: 44 }, { x: -45, y: 44 }, { x: -45, y: -42 }]), rcsM2: RCS_M2.heavy },
    { ...route(mk({ id: 'CNS303', pos: { x: 4, y: -44 }, altitudeFt: 8000, headingDeg: 350, speedKt: 250 }, RCS_M2.medium), [{ x: 0, y: -14 }, { x: -12, y: -6 }, { x: -22, y: -26 }, { x: 4, y: -44 }]), rcsM2: RCS_M2.medium },
    {
      ...route(mk({ id: 'CNS404', category: 'light', pos: env.smallFar ? LIGHT_FAR[0] : LIGHT_NEAR[0], altitudeFt: env.smallFar ? 4500 : 2500, headingDeg: 45, speedKt: 110 }, RCS_M2.light), env.smallFar ? LIGHT_FAR.slice(1).concat(LIGHT_FAR[0]) : LIGHT_NEAR.slice(1).concat(LIGHT_NEAR[0])),
      rcsM2: RCS_M2.light,
    },
    { ...route(mk({ id: 'CNS505', pos: { x: -30, y: -36 }, altitudeFt: 6000, headingDeg: 300, speedKt: 240 }, RCS_M2.medium), [{ x: -44, y: -6 }, { x: -26, y: 14 }, { x: -12, y: -18 }, { x: -30, y: -36 }]), rcsM2: RCS_M2.medium },
  ]
}

interface Bird {
  pos: Vec2
  headingDeg: number
}

export class PsrEngine {
  readonly site = SITE
  params: RadarParams = { ...DEFAULT_RADAR }
  env: PsrEnv = { ...DEFAULT_ENV }
  timeS = 0
  antennaAz = 0
  aircraft: PsrAircraft[]
  storm: Storm = { ...STORM_START, center: { ...STORM_START.center } }
  birds: Bird[]
  readonly turbines: Vec2[]
  readonly clutter: ClutterCell[]
  private clutterByAz: ClutterCell[][]
  private stormOffsets: Vec2[]
  private rand: () => number
  private pending: ScopePaint[] = []
  lastLook = new Map<string, LastLook>()
  readonly terrain = terrainFn()

  constructor(seed = 42) {
    this.rand = mulberry32(seed)
    this.aircraft = createScenario(this.env)
    this.clutter = buildGroundClutter(SITE, this.terrain, CLUTTER_RANGE_NM, { isWater: (p) => isWater(p) })
    this.clutterByAz = Array.from({ length: 360 }, () => [])
    for (const c of this.clutter) this.clutterByAz[Math.floor(normalize360(c.azDeg)) % 360].push(c)
    this.stormOffsets = []
    for (let x = -15; x <= 15; x += 1) for (let y = -15; y <= 15; y += 1) if (x * x + y * y <= 15 * 15) this.stormOffsets.push({ x, y })
    this.birds = Array.from({ length: 14 }, (_, i) => ({
      pos: { x: 6 + (this.rand() - 0.5) * 1.5, y: 9 + (this.rand() - 0.5) * 1.5 },
      headingDeg: 200 + i * 3,
    }))
    this.turbines = []
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) this.turbines.push({ x: WIND_FARM_CENTER.x + i * 0.8, y: WIND_FARM_CENTER.y + j * 0.8 })
  }

  reset() {
    this.timeS = 0
    this.antennaAz = 0
    this.aircraft = createScenario(this.env)
    this.storm = { ...STORM_START, center: { ...STORM_START.center } }
    this.pending = []
    this.lastLook.clear()
  }

  /** Beam half-width used to decide what the antenna is looking at. */
  get beamWidthDeg() {
    return this.params.beamWidthDeg
  }

  /** Degrees the antenna turns per second. */
  get degPerSecond() {
    return 360 / this.params.rotationPeriodS
  }

  /** Seconds until the antenna points at `azDeg`. */
  timeToAzimuth(azDeg: number): number {
    return normalize360(azDeg - this.antennaAz) / this.degPerSecond
  }

  /** Advance the world by dt seconds and paint everything the beam sweeps over. */
  step(dt: number) {
    if (dt <= 0) return
    this.timeS += dt
    this.aircraft = this.aircraft.map((a) => ({ ...stepAircraftFine(a, dt), rcsM2: a.rcsM2 }))
    // Rain drifts with the wind (kt → NM/s).
    const drift = (WIND.speedKt / 3600) * dt
    this.storm.center = {
      x: this.storm.center.x + Math.sin((WIND.toDeg * Math.PI) / 180) * drift,
      y: this.storm.center.y + Math.cos((WIND.toDeg * Math.PI) / 180) * drift,
    }
    // A new shower forms where the first one started once it has drifted far away.
    if (distanceNm(this.site.pos, this.storm.center) > 70) this.storm.center = { ...STORM_START.center }
    for (const b of this.birds) {
      b.headingDeg = normalize360(b.headingDeg + (this.rand() - 0.5) * 20 * dt)
      const d = (25 / 3600) * dt
      b.pos = { x: b.pos.x + Math.sin((b.headingDeg * Math.PI) / 180) * d, y: b.pos.y + Math.cos((b.headingDeg * Math.PI) / 180) * d }
    }

    const span = this.degPerSecond * dt
    const from = this.antennaAz
    this.sweep(from, span)
    this.antennaAz = normalize360(from + span)
  }

  /**
   * Turn the antenna to point exactly at `azDeg`, moving the world forward by
   * the time that takes (used before a slow-motion pulse replay).
   */
  advanceToAzimuth(azDeg: number) {
    const t = this.timeToAzimuth(azDeg)
    // Step in small pieces so aircraft move smoothly and everything is painted.
    let left = t
    while (left > 1e-9) {
      const d = Math.min(0.05, left)
      this.step(d)
      left -= d
    }
    this.antennaAz = normalize360(azDeg)
  }

  /** Paints collected since the last call. */
  takePaints(): ScopePaint[] {
    const p = this.pending
    this.pending = []
    return p
  }

  private paintAt(trueRangeNm: number, azDeg: number, strength: number, kind: ScopePaint['kind'], widthDeg: number, depthNm: number) {
    const app = apparentRange(trueRangeNm, this.params.prfHz)
    const a = (azDeg * Math.PI) / 180
    this.pending.push({
      x: this.site.pos.x + Math.sin(a) * app.rangeNm,
      y: this.site.pos.y + Math.cos(a) * app.rangeNm,
      strength: Math.max(0, Math.min(1, strength)),
      kind,
      widthDeg,
      depthNm,
    })
  }

  private sweep(from: number, span: number) {
    const bw = this.params.beamWidthDeg
    const depth = Math.max(rangeResolutionNm(this.params.pulseWidthUs), 0.12)
    const env = { terrain: this.terrain, mti: this.env.mti }

    // Aircraft.
    for (const a of this.aircraft) {
      const az = bearingDeg(this.site.pos, a.pos)
      if (!sweepCovers(az, from, span)) continue
      const res = evaluateTarget(
        this.site,
        this.params,
        { pos: a.pos, altitudeFt: a.altitudeFt, rcsM2: a.rcsM2, radialSpeedKt: radialSpeedKt(a, this.site.pos) },
        env,
        this.rand(),
      )
      this.lastLook.set(a.id, { ...res, timeS: this.timeS })
      if (res.detected) {
        // Small measurement noise: a fraction of a beam width in azimuth, a few hundred metres in range.
        const azMeas = az + gaussian(this.rand) * bw * 0.08
        const rNoise = gaussian(this.rand) * 0.04
        const strength = 0.65 + 0.35 * Math.min(1, (res.snrDb - 8) / 20)
        this.paintAt(res.trueRangeNm + rNoise, azMeas, strength, 'target', bw, depth)
      }
    }

    // Ground clutter (stationary: MTI cancels it almost completely).
    if (this.env.groundClutter) {
      const start = Math.floor(from)
      const end = Math.floor(from + span)
      for (let k = start; k <= end; k++) {
        for (const c of this.clutterByAz[((k % 360) + 360) % 360]) {
          if (!sweepCovers(c.azDeg, from, span)) continue
          let s = c.strength * (0.75 + 0.5 * this.rand())
          if (this.env.mti) s *= MTI_RESIDUE
          if (s > 0.05) this.paintAt(c.rangeNm, c.azDeg, s, 'clutter', Math.max(bw, 1), 0.5)
        }
      }
    }

    // Rain (drifts with the wind, so MTI only partly removes it).
    if (this.env.rain) {
      for (const o of this.stormOffsets) {
        const p = { x: this.storm.center.x + o.x, y: this.storm.center.y + o.y }
        const az = bearingDeg(this.site.pos, p)
        if (!sweepCovers(az, from, span)) continue
        let s = rainReflectivity(p, this.storm)
        if (s <= 0) continue
        if (this.env.mti) s *= mtiGain(radialWindKt(this.site.pos, p, WIND.speedKt, WIND.toDeg))
        const r = distanceNm(this.site.pos, p)
        const cellWidth = Math.max(bw, (1.05 / Math.max(r, 1)) * (180 / Math.PI))
        if (s > 0.03) this.paintAt(r, az, s, 'weather', cellWidth, 1.05)
      }
    }

    // Birds: small, slow, but moving, so they get through MTI.
    if (this.env.birds) {
      for (const b of this.birds) {
        const az = bearingDeg(this.site.pos, b.pos)
        if (!sweepCovers(az, from, span)) continue
        const r = slantRangeNm(distanceNm(this.site.pos, b.pos), 800, this.site.heightFt)
        let snr = radarSnrDb(this.params, r, 0.02)
        if (this.env.mti) snr += 20 * Math.log10(Math.max(mtiGain(25 * Math.cos(((angleDiff(az, b.headingDeg)) * Math.PI) / 180)), 1e-3))
        if (this.rand() < detectionProbability(snr)) this.paintAt(r, az, 0.55, 'false', bw, depth)
      }
    }

    // Wind farm: towers are still (MTI removes them) but the blades move fast (MTI cannot).
    if (this.env.windFarm) {
      for (const tb of this.turbines) {
        const az = bearingDeg(this.site.pos, tb)
        if (!sweepCovers(az, from, span)) continue
        const r = distanceNm(this.site.pos, tb)
        const bladeFlash = this.rand() < 0.7
        if (bladeFlash) this.paintAt(r, az, 0.85, 'false', bw, depth)
        else if (!this.env.mti) this.paintAt(r, az, 0.6, 'clutter', bw, depth)
      }
    }
  }

  /**
   * Every echo a single pulse fired now along `azDeg` would produce, with its
   * TRUE range (for the slow-motion pulse view).
   */
  echoesAlong(azDeg: number): EchoAlongBeam[] {
    const out: EchoAlongBeam[] = []
    const bw = this.params.beamWidthDeg
    for (const a of this.aircraft) {
      const az = bearingDeg(this.site.pos, a.pos)
      if (!inBeam(az, azDeg, bw)) continue
      const res = evaluateTarget(
        this.site,
        this.params,
        { pos: a.pos, altitudeFt: a.altitudeFt, rcsM2: a.rcsM2, radialSpeedKt: radialSpeedKt(a, this.site.pos) },
        { terrain: this.terrain, mti: false },
        0,
      )
      if (res.reason === 'terrain' || res.reason === 'horizon' || res.reason === 'cone') continue
      out.push({ rangeNm: res.trueRangeNm, strength: Math.max(0.25, Math.min(1, (res.snrDb + 5) / 35)), kind: 'target', label: a.callsign, id: a.id })
    }
    if (this.env.groundClutter) {
      for (const c of this.clutterByAz[Math.floor(normalize360(azDeg)) % 360]) {
        out.push({ rangeNm: c.rangeNm, strength: c.strength * 0.8, kind: 'clutter', label: c.rangeNm < 12 ? 'Ground and buildings' : 'Hillside' })
      }
    }
    if (this.env.rain) {
      for (let r = 1; r < CLUTTER_RANGE_NM; r += 1) {
        const a = (azDeg * Math.PI) / 180
        const p = { x: Math.sin(a) * r, y: Math.cos(a) * r }
        const s = rainReflectivity(p, this.storm)
        if (s > 0.05) out.push({ rangeNm: r, strength: s * 0.6, kind: 'weather', label: 'Rain' })
      }
    }
    return out.sort((x, y) => x.rangeNm - y.rangeNm)
  }

  /** The aircraft nearest to a map point (within 3 NM). */
  nearestAircraft(p: Vec2): PsrAircraft | null {
    let best: PsrAircraft | null = null
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

  setAircraft(id: string, patch: Partial<PsrAircraft>) {
    this.aircraft = this.aircraft.map((a) => (a.id === id ? { ...a, ...patch } : a))
  }

  getAircraft(id: string | null | undefined): PsrAircraft | undefined {
    return this.aircraft.find((a) => a.id === id)
  }

  /** Swap the light aircraft between its near and far routes. */
  applySmallFar(far: boolean) {
    const id = 'CNS404'
    const wps = far ? LIGHT_FAR : LIGHT_NEAR
    this.setAircraft(id, {
      pos: { ...wps[0] },
      altitudeFt: far ? 4500 : 2500,
      targetAltitudeFt: far ? 4500 : 2500,
      mode: { kind: 'route', waypoints: wps.slice(1).concat(wps[0]), index: 0, loop: true },
    })
  }
}
