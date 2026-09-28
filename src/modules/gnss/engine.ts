/**
 * GNSS scenario engine. One receiver above the CNS Lab airport, the GPS
 * constellation moving on its orbits, one SBAS geostationary satellite and a
 * GBAS ground station at the airport. Every view (3D orbit view, sky plot,
 * ground view, signal bars) reads the SAME satellite states from here.
 *
 * Units: metres and seconds (GNSS geometry is Earth-sized); ft only for the
 * receiver height setting, km for the jammer distance setting.
 */

import {
  azimuthElevation,
  dist3,
  ecefToEnu,
  enuToEcef,
  geodeticToEcef,
  normalize360,
  type LatLon,
  type Vec3,
} from '@/core/geometry'
import {
  ELEVATION_MASK_DEG,
  GNSS_SIGNAL_DBM,
  GPS_CONSTELLATION,
  GPS_L1_HZ,
  angleBetweenDeg,
  canTrack,
  computeDop,
  errorBudget,
  faultVisibility,
  geostationaryEcef,
  horizontal95M,
  jammedCn0DbHz,
  nominalCn0DbHz,
  predictedSigmaM,
  raimCheck,
  rangeErrors,
  rms,
  satelliteEci,
  eciToEcef,
  smoothNoise,
  solvePosition,
  solvePositionFixedClock,
  vertical95M,
  type Augmentation,
  type Dop,
  type GpsSlot,
  type Measurement,
  type RaimResult,
  type SkyDirection,
} from '@/core/gnss'
import { freeSpacePathLossDb, radioLineOfSightNm } from '@/core/propagation'
import { LAB_AIRPORT } from '@/core/world'
import { METRES_PER_NM, SPEED_OF_LIGHT_MS, ftToMetres, nmToMetres } from '@/core/units'

// ---------------------------------------------------------------------------
// Scenario constants
// ---------------------------------------------------------------------------

export type ReceiverSite = 'ground' | 'low' | 'cruise'

/** Receiver positions, all straight above the airport reference point. Heights above mean sea level. */
export const SITES: Record<ReceiverSite, { label: string; short: string; heightFt: number; aglFt: number }> = {
  ground: { label: 'On the runway', short: 'Runway', heightFt: LAB_AIRPORT.elevationFt + 10, aglFt: 10 },
  low: { label: 'Aircraft at 3,000 ft over the airport', short: '3,000 ft', heightFt: 3000, aglFt: 3000 - LAB_AIRPORT.elevationFt },
  cruise: { label: 'Aircraft at 35,000 ft over the airport', short: '35,000 ft', heightFt: 35000, aglFt: 35000 - LAB_AIRPORT.elevationFt },
}

/** The receiver's clock is fast by this much (a typical quartz clock can be off by up to a millisecond). */
export const TRUE_CLOCK_BIAS_S = 0.35e-3
export const TRUE_CLOCK_BIAS_M = TRUE_CLOCK_BIAS_S * SPEED_OF_LIGHT_MS

/** Range of the "clock guess" slider, ns either side of the true clock error. */
export const CLOCK_GUESS_RANGE_NS = 1000

/** Buildings next to the receiver on the ground: everything below 15°, and a hangar to the south-west up to 40°. */
export const BUILDINGS = { minElDeg: 15, fromAzDeg: 200, toAzDeg: 330, sectorElDeg: 40 }

/** A faulty satellite clock: its range error ramps up at this rate until it reaches the maximum. */
// TODO(expert-review): fault size and ramp are illustrative (real clock faults range from slow ramps to sudden jumps).
export const FAULT_RAMP_M_PER_S = 4
export const FAULT_MAX_M = 200

/** SBAS / GBAS warn "do not use this satellite" this long after a fault starts, s. */
// TODO(expert-review): SBAS time-to-alert for approach operations is about 6 s; GBAS is shorter.
export const MONITOR_TIME_TO_ALERT_S = 6

/** The SBAS geostationary satellite's longitude (illustrative: the CNS Lab airport is fictional). */
// TODO(expert-review): the SBAS service area over the fictional airport is illustrative.
export const SBAS_GEO_LON_DEG = 110.5

/** GBAS corrections are used on approach and landing, not in cruise. */
// TODO(expert-review): GBAS approach service volume (about 23 NM, up to about 10,000 ft) simplified to this height limit.
export const GBAS_MAX_HEIGHT_FT = 10000

/** Jammer: 10 W on a 30 ft mast, due south of the airport. */
// TODO(expert-review): jammer power, antenna gains and the line-of-sight cut-off are illustrative.
export const JAMMER = { powerDbm: 40, mastFt: 30, bearingDeg: 180 }

/** Spoofer: the false position drifts away at this speed (towards the north-east) up to a maximum. */
export const SPOOF = { driftMs: 8, bearingDeg: 45, maxM: 20_000, cn0DbHz: 50 }

/** DME/DME cross-check: its own error (1σ) and the disagreement that raises an alert. */
// TODO(expert-review): DME/DME accuracy and the cross-check threshold depend on the FMS; illustrative values.
export const DME_DME_SIGMA_M = 150
export const CROSS_CHECK_LIMIT_M = 0.5 * METRES_PER_NM

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GnssEnv {
  faultySat: boolean
  raim: boolean
  ionoStorm: boolean
  blocked: boolean
  jamming: boolean
  spoofing: boolean
}

export const DEFAULT_ENV: GnssEnv = {
  faultySat: false,
  raim: true,
  ionoStorm: false,
  blocked: false,
  jamming: false,
  spoofing: false,
}

export type SelectMode = 'all' | 'manual'
export type ClockMode = 'solve' | 'guess'

export interface GnssSettings {
  site: ReceiverSite
  selectMode: SelectMode
  /** Satellites the learner picked (manual mode). */
  selected: string[]
  clockMode: ClockMode
  /** How wrong the receiver's clock guess is, ns (0 = exactly right). */
  clockGuessNs: number
  sbas: boolean
  gbas: boolean
  /** Distance from the airport to the jammer, km. */
  jammerKm: number
}

export const DEFAULT_SETTINGS: GnssSettings = {
  site: 'ground',
  selectMode: 'all',
  selected: [],
  clockMode: 'solve',
  clockGuessNs: 0,
  sbas: false,
  gbas: false,
  jammerKm: 10,
}

/**
 * below: under the horizon · low: above the horizon but under the 5° mask ·
 * blocked: hidden by buildings · lost: drowned out by a jammer · ok: tracked.
 */
export type SatStatus = 'below' | 'low' | 'blocked' | 'lost' | 'ok'

export interface SatView {
  id: string
  slot: GpsSlot
  eci: Vec3
  ecef: Vec3
  azDeg: number
  elDeg: number
  rangeM: number
  status: SatStatus
  /** Carrier-to-noise density, dB-Hz (0 below the horizon). */
  cn0DbHz: number
  /** Part of the set the receiver is asked to use. */
  selected: boolean
  /** Used in the position shown. */
  used: boolean
  /** Left out by RAIM. */
  excluded: boolean
  /** "Do not use" message from SBAS / GBAS. */
  flagged: boolean
  faulty: boolean
}

export interface RangeLine {
  id: string
  /** Centre of the sphere's slice in the local plane (ENU east, north), m. */
  cE: number
  cN: number
  /** Radius of the slice, m. */
  r: number
  azDeg: number
}

export type FixKind = 'none' | 'three' | 'fix'

export interface GnssResult {
  kind: FixKind
  /** Why there is no position (kind 'none'). */
  reason: string
  nTracked: number
  nCandidates: number
  usedIds: string[]
  augmentation: Augmentation
  /** Predicted one-sigma ranging error (RMS over the satellites used), m. */
  sigmaM: number
  dop: Dop | null
  h95M: number
  v95M: number
  /** Solution relative to the TRUE receiver position (ENU), m. */
  enu: Vec3 | null
  /** Receiver clock bias the solution uses (solved or guessed), m of range. */
  clockBiasM: number | null
  hErrM: number
  vErrM: number
  /** RMS of the residuals: how far the spheres are from meeting at the answer, m. */
  misfitM: number
  residuals: { id: string; m: number }[]
  raim: RaimResult | null
  /** 3 satellites: one answer for each assumed clock error. */
  curve: { guessNs: number; enu: Vec3 }[] | null
  lines: RangeLine[]
  dmeDme: Vec3 | null
  crossCheckM: number | null
  faultBiasM: number
  spoofOffsetM: number
  jsDb: number | null
}

export interface GeoView {
  ecef: Vec3
  azDeg: number
  elDeg: number
  tracked: boolean
}

/** Presets avoid satellites lower than this when enough others are available, degrees. */
export const PRESET_MIN_EL_DEG = 10

export type PresetKind = 'spread3' | 'clustered4' | 'spread4' | 'five' | 'six'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isBlockedByBuildings(azDeg: number, elDeg: number): boolean {
  if (elDeg < BUILDINGS.minElDeg) return true
  const a = normalize360(azDeg)
  return a >= BUILDINGS.fromAzDeg && a <= BUILDINGS.toAzDeg && elDeg < BUILDINGS.sectorElDeg
}

function combinations<T>(items: T[], k: number): T[][] {
  const out: T[][] = []
  const pick = (start: number, acc: T[]) => {
    if (acc.length === k) {
      out.push(acc.slice())
      return
    }
    for (let i = start; i <= items.length - (k - acc.length); i++) {
      acc.push(items[i])
      pick(i + 1, acc)
      acc.pop()
    }
  }
  pick(0, [])
  return out
}

const dirOf = (s: { azDeg: number; elDeg: number }): SkyDirection => ({ azDeg: s.azDeg, elDeg: s.elDeg })

/** PDOP of a set of satellites (Infinity if singular or fewer than 4). */
export function pdopOf(sats: { azDeg: number; elDeg: number }[]): number {
  return computeDop(sats.map(dirOf))?.pdop ?? Infinity
}

/** Largest angle between any two satellites of a set, degrees. */
export function clusterSizeDeg(sats: { azDeg: number; elDeg: number }[]): number {
  let m = 0
  for (let i = 0; i < sats.length; i++) for (let j = i + 1; j < sats.length; j++) m = Math.max(m, angleBetweenDeg(dirOf(sats[i]), dirOf(sats[j])))
  return m
}

/**
 * How clearly RAIM could single out satellite `f` in `set`: the smallest
 * visibility of f's error among all groups that leave one OTHER satellite out.
 */
export function exclusionMargin(set: SatView[], f: SatView): number {
  let m = Infinity
  for (const k of set) {
    if (k === f) continue
    const sub = set.filter((x) => x !== k)
    m = Math.min(m, faultVisibility(sub.map(dirOf), sub.indexOf(f)))
  }
  return Number.isFinite(m) ? m : 0
}

/** |det| of three unit vectors: how well 3 satellites pin down a position (0 = all in a line). */
function tripleVolume(sats: { azDeg: number; elDeg: number }[]): number {
  const u = sats.map((s) => {
    const az = (s.azDeg * Math.PI) / 180
    const el = (s.elDeg * Math.PI) / 180
    return [Math.cos(el) * Math.sin(az), Math.cos(el) * Math.cos(az), Math.sin(el)]
  })
  const [a, b, c] = u
  return Math.abs(a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]))
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class GnssEngine {
  timeS = 0
  settings: GnssSettings = { ...DEFAULT_SETTINGS }
  env: GnssEnv = { ...DEFAULT_ENV }
  readonly seed: number
  sats: SatView[] = []
  geo: GeoView
  result: GnssResult
  /** Recent fixes (ENU east/north offsets from the truth, m), newest last. */
  trail: { e: number; n: number }[] = []
  faultyId: string | null = null
  faultStartS = 0
  spoofStartS = 0
  private lastEpoch = -1
  private dirty = true

  constructor(seed = 11) {
    this.seed = seed
    this.geo = { ecef: geostationaryEcef(SBAS_GEO_LON_DEG), azDeg: 0, elDeg: 0, tracked: false }
    this.result = this.emptyResult('Starting')
    this.update(true)
  }

  // --- receiver -----------------------------------------------------------

  get receiverGeo(): LatLon {
    return LAB_AIRPORT.ref
  }

  get receiverHeightM(): number {
    return ftToMetres(SITES[this.settings.site].heightFt)
  }

  get receiverEcef(): Vec3 {
    return geodeticToEcef(this.receiverGeo, this.receiverHeightM)
  }

  /** Jammer-to-signal ratio at the receiver, dB (null when the jammer is off or below the radio horizon). */
  jammerToSignalDb(): number | null {
    if (!this.env.jamming) return null
    const site = SITES[this.settings.site]
    const groundM = this.settings.jammerKm * 1000
    const losM = nmToMetres(radioLineOfSightNm(JAMMER.mastFt, site.aglFt))
    if (groundM > losM) return null
    const dh = ftToMetres(site.aglFt - JAMMER.mastFt)
    const d = Math.hypot(groundM, dh)
    const j = JAMMER.powerDbm - freeSpacePathLossDb(d, GPS_L1_HZ)
    return j - GNSS_SIGNAL_DBM
  }

  /** Corrections in use right now. */
  get augmentation(): Augmentation {
    if (this.settings.gbas && this.gbasInRange) return 'gbas'
    if (this.settings.sbas && this.geo.tracked) return 'sbas'
    return 'none'
  }

  get gbasInRange(): boolean {
    return SITES[this.settings.site].heightFt <= GBAS_MAX_HEIGHT_FT
  }

  get faultBiasM(): number {
    if (!this.env.faultySat || !this.faultyId) return 0
    return Math.min(FAULT_MAX_M, Math.max(0, this.timeS - this.faultStartS) * FAULT_RAMP_M_PER_S)
  }

  get spoofOffsetM(): number {
    if (!this.env.spoofing) return 0
    return Math.min(SPOOF.maxM, Math.max(0, this.timeS - this.spoofStartS) * SPOOF.driftMs)
  }

  // --- control ------------------------------------------------------------

  /** Something the learner changed: recompute now and start a fresh trail of fixes. */
  markDirty(clearTrail = true) {
    this.dirty = true
    if (clearTrail) this.trail = []
  }

  reset() {
    this.timeS = 0
    this.settings = { ...DEFAULT_SETTINGS }
    this.env = { ...DEFAULT_ENV }
    this.faultyId = null
    this.lastEpoch = -1
    this.trail = []
    this.dirty = true
    this.update(true)
  }

  /** Advance the world by dt seconds (0 while paused: only recompute if something changed). */
  step(dt: number) {
    if (dt > 0) this.timeS += dt
    this.update(dt > 0)
  }

  update(force = false) {
    if (!force && !this.dirty) return
    this.dirty = false
    this.computeSatellites()
    this.computeFix()
    const epoch = Math.floor(this.timeS)
    if (epoch !== this.lastEpoch) {
      this.lastEpoch = epoch
      if (this.result.kind === 'fix' && this.result.enu) {
        this.trail.push({ e: this.result.enu.x, n: this.result.enu.y })
        if (this.trail.length > 150) this.trail.shift()
      }
    }
  }

  /**
   * The fault starts now. It is put on a satellite in use whose error RAIM can
   * see clearly (and, with 5 in use, could still single out once a sixth
   * satellite is added), so the lesson shows detection and exclusion.
   */
  startFault() {
    this.faultStartS = this.timeS
    this.computeSatellites()
    const tracked = this.sats.filter((s) => s.status === 'ok')
    const pool = tracked.filter((s) => s.selected)
    const cands = pool.length ? pool : tracked
    if (!cands.length) {
      this.faultyId = this.sats.filter((s) => s.elDeg > 0).sort((a, b) => b.elDeg - a.elDeg)[0]?.id ?? null
      this.markDirty()
      return
    }
    const extras = this.presetPool().filter((s) => !cands.includes(s))
    let best = cands[0]
    let bestScore = -Infinity
    for (const f of cands) {
      let score: number
      if (cands.length >= 6) score = exclusionMargin(cands, f)
      else if (cands.length === 5) {
        const six = extras.reduce((m, x) => Math.max(m, exclusionMargin([...cands, x], f)), 0)
        score = Math.min(faultVisibility(cands.map(dirOf), cands.indexOf(f)), extras.length ? six : 1)
      } else score = f.elDeg / 90
      if (score > bestScore) {
        bestScore = score
        best = f
      }
    }
    this.faultyId = best.id
    this.markDirty()
  }

  startSpoof() {
    this.spoofStartS = this.timeS
    this.markDirty()
  }

  /** Satellites the presets choose from: tracked, and not about to set when enough others are available. */
  private presetPool(): SatView[] {
    const tracked = this.sats.filter((s) => s.status === 'ok')
    const high = tracked.filter((s) => s.elDeg >= PRESET_MIN_EL_DEG)
    return high.length >= 6 ? high : tracked
  }

  /** Satellite set for a "Try this" preset, from the satellites the receiver can track right now. */
  presetSelection(kind: PresetKind): string[] {
    this.computeSatellites()
    const ok = this.presetPool()
    if (ok.length <= 3) return ok.map((s) => s.id)
    const faulty = this.env.faultySat ? ok.find((s) => s.id === this.faultyId) : undefined
    const ids = (set: SatView[]) => set.map((s) => s.id)
    const bestSpread4 = () => {
      let best: SatView[] = ok.slice(0, 4)
      let bp = Infinity
      for (const c of combinations(ok, 4)) {
        const p = pdopOf(c)
        if (p < bp) {
          bp = p
          best = c
        }
      }
      return best
    }
    const addBest = (set: SatView[]): SatView[] => {
      let bestS: SatView | null = null
      let bp = Infinity
      for (const s of ok) {
        if (set.includes(s)) continue
        const p = pdopOf([...set, s])
        if (p < bp) {
          bp = p
          bestS = s
        }
      }
      return bestS ? [...set, bestS] : set
    }
    switch (kind) {
      case 'spread3': {
        let best = ok.slice(0, 3)
        let bv = -1
        for (const c of combinations(ok, 3)) {
          const v = tripleVolume(c)
          if (v > bv) {
            bv = v
            best = c
          }
        }
        return ids(best)
      }
      case 'clustered4': {
        // The tightest group of 4 whose geometry is poor (PDOP 8 to 30, HDOP at least 4) but still
        // solvable, now and for the next 10 minutes (near-degenerate groups can blow up within minutes).
        let best: SatView[] | null = null
        let bc = Infinity
        let fallback: SatView[] = ok.slice(0, 4)
        let fh = 0
        for (const c of combinations(ok, 4)) {
          const d = computeDop(c.map(dirOf))
          if (!d || d.pdop > 30) continue
          const later = [300, 600].map((dt) => computeDop(this.directionsAt(c, dt)))
          if (later.some((x) => !x || x.pdop > 30)) continue
          const all = [d, ...later.map((x) => x!)]
          const hMin = Math.min(...all.map((x) => x.hdop))
          const pMin = Math.min(...all.map((x) => x.pdop))
          if (hMin > fh) {
            fh = hMin
            fallback = c
          }
          if (hMin < 4 || pMin < 8) continue
          const size = clusterSizeDeg(c)
          if (size < bc) {
            bc = size
            best = c
          }
        }
        return ids(best ?? fallback)
      }
      case 'spread4':
        return ids(bestSpread4())
      case 'five': {
        if (!faulty) return ids(addBest(bestSpread4()))
        // Include the faulty satellite, where its error stands out clearly and the geometry is good.
        let best: SatView[] | null = null
        let score = -Infinity
        for (const c of combinations(ok.filter((s) => s !== faulty), 4)) {
          const set = [faulty, ...c]
          const p = pdopOf(set)
          if (!(p <= 6)) continue
          const v = faultVisibility(set.map(dirOf), 0)
          const sc = v - 0.02 * p
          if (sc > score) {
            score = sc
            best = set
          }
        }
        return ids(best ?? addBest(bestSpread4()))
      }
      case 'six': {
        const current = ok.filter((s) => this.settings.selectMode === 'manual' && this.settings.selected.includes(s.id))
        const base =
          current.length === 5
            ? current
            : faulty
              ? this.presetSelection('five')
                  .map((id) => ok.find((s) => s.id === id))
                  .filter((s): s is SatView => Boolean(s))
              : addBest(bestSpread4())
        if (!faulty || !base.includes(faulty)) return ids(addBest(base))
        // Add the satellite that best lets RAIM tell WHICH one is faulty: the faulty
        // satellite's error must stand out in every group of 5 that still contains it.
        let bestSet = addBest(base)
        let bestScore = -Infinity
        for (const s of ok) {
          if (base.includes(s)) continue
          const set = [...base, s]
          const p = pdopOf(set)
          if (!Number.isFinite(p)) continue
          const score = exclusionMargin(set, faulty) - 0.01 * p
          if (score > bestScore) {
            bestScore = score
            bestSet = set
          }
        }
        return ids(bestSet)
      }
    }
  }

  /** Sky directions of some satellites `dt` seconds from now. */
  directionsAt(set: SatView[], dt: number): SkyDirection[] {
    const rx = this.receiverEcef
    const geo = this.receiverGeo
    return set.map((s) => {
      const ae = azimuthElevation(eciToEcef(satelliteEci(s.slot, this.timeS + dt), this.timeS + dt), rx, geo)
      return { azDeg: ae.azimuthDeg, elDeg: ae.elevationDeg }
    })
  }

  // --- simulation -----------------------------------------------------------

  private computeSatellites() {
    const t = this.timeS
    const rx = this.receiverEcef
    const geo = this.receiverGeo
    const onGround = this.settings.site === 'ground'
    const js = this.jammerToSignalDb()
    const selected = new Set(this.settings.selected)
    const all = this.settings.selectMode === 'all'
    this.sats = GPS_CONSTELLATION.map((slot) => {
      const eci = satelliteEci(slot, t)
      const ecef = eciToEcef(eci, t)
      const ae = azimuthElevation(ecef, rx, geo)
      let status: SatStatus
      let cn0 = 0
      if (ae.elevationDeg < 0) status = 'below'
      else if (ae.elevationDeg < ELEVATION_MASK_DEG) {
        status = 'low'
        cn0 = nominalCn0DbHz(ae.elevationDeg)
      } else if (this.env.spoofing && js === null) {
        // The spoofer's own transmitter supplies a fake signal for every satellite, all equally strong.
        status = 'ok'
        cn0 = SPOOF.cn0DbHz
      } else if (this.env.blocked && onGround && isBlockedByBuildings(ae.azimuthDeg, ae.elevationDeg)) {
        status = 'blocked'
        cn0 = 0
      } else {
        cn0 = nominalCn0DbHz(ae.elevationDeg)
        if (js !== null) cn0 = jammedCn0DbHz(cn0, js)
        status = canTrack(cn0) ? 'ok' : 'lost'
      }
      return {
        id: slot.id,
        slot,
        eci,
        ecef,
        azDeg: ae.azimuthDeg,
        elDeg: ae.elevationDeg,
        rangeM: ae.rangeM,
        status,
        cn0DbHz: Math.max(0, cn0),
        selected: status === 'ok' && (all || selected.has(slot.id)),
        used: false,
        excluded: false,
        flagged: false,
        faulty: this.env.faultySat && slot.id === this.faultyId,
      }
    })
    const g = azimuthElevation(this.geo.ecef, rx, geo)
    const geoCn0 = js !== null ? jammedCn0DbHz(nominalCn0DbHz(g.elevationDeg), js) : nominalCn0DbHz(g.elevationDeg)
    this.geo = { ...this.geo, azDeg: g.azimuthDeg, elDeg: g.elevationDeg, tracked: g.elevationDeg >= ELEVATION_MASK_DEG && canTrack(geoCn0) }
  }

  private emptyResult(reason: string): GnssResult {
    return {
      kind: 'none',
      reason,
      nTracked: 0,
      nCandidates: 0,
      usedIds: [],
      augmentation: 'none',
      sigmaM: 0,
      dop: null,
      h95M: 0,
      v95M: 0,
      enu: null,
      clockBiasM: null,
      hErrM: NaN,
      vErrM: NaN,
      misfitM: 0,
      residuals: [],
      raim: null,
      curve: null,
      lines: [],
      dmeDme: null,
      crossCheckM: null,
      faultBiasM: this.faultBiasM,
      spoofOffsetM: this.spoofOffsetM,
      jsDb: this.jammerToSignalDb(),
    }
  }

  private computeFix() {
    const t = this.timeS
    const rx = this.receiverEcef
    const geo = this.receiverGeo
    const aug = this.augmentation
    const budget = errorBudget(aug, this.env.ionoStorm)
    const tracked = this.sats.filter((s) => s.status === 'ok')
    const faultBias = this.faultBiasM
    const spoofOff = this.spoofOffsetM
    const spoofing = this.env.spoofing && tracked.length > 0 && this.jammerToSignalDb() === null
    const target = spoofing
      ? enuToEcef(
          { x: spoofOff * Math.sin((SPOOF.bearingDeg * Math.PI) / 180), y: spoofOff * Math.cos((SPOOF.bearingDeg * Math.PI) / 180), z: 0 },
          rx,
          geo,
        )
      : rx

    // SBAS and GBAS monitor the satellites and broadcast "do not use" for a faulty one.
    const monitored = aug !== 'none' && this.env.faultySat && !spoofing && t - this.faultStartS >= MONITOR_TIME_TO_ALERT_S
    for (const s of this.sats) if (s.faulty && s.selected && monitored) s.flagged = true
    const cands = this.sats.filter((s) => s.selected && !s.flagged)

    const res = this.emptyResult('')
    res.nTracked = tracked.length
    res.nCandidates = cands.length
    res.augmentation = aug
    res.faultBiasM = faultBias
    res.spoofOffsetM = spoofing ? spoofOff : 0

    if (cands.length === 0) {
      res.reason = this.env.jamming && res.jsDb !== null
        ? 'Jammed: every satellite signal is drowned out.'
        : tracked.length === 0
          ? 'No satellites can be received.'
          : 'No satellites chosen. Pick some on the sky plot.'
      this.result = res
      return
    }

    const meas: Measurement[] = cands.map((s) => {
      const err = spoofing
        ? { totalM: rangeErrors(budget, s.slot.key, s.elDeg, t, this.seed).noiseM }
        : rangeErrors(budget, s.slot.key, s.elDeg, t, this.seed)
      const fault = s.faulty && !spoofing ? faultBias : 0
      return { id: s.id, sat: s.ecef, pseudorangeM: dist3(s.ecef, target) + TRUE_CLOCK_BIAS_M + err.totalM + fault }
    })
    const sigmaOf = (set: SatView[]) => rms(set.map((s) => predictedSigmaM(budget, s.elDeg)))

    if (cands.length < 3) {
      res.reason = `Only ${cands.length} satellite${cands.length === 1 ? '' : 's'}: far too few to work out a position.`
      this.markUsed(cands)
      this.result = res
      return
    }

    const guessM = TRUE_CLOCK_BIAS_M + this.settings.clockGuessNs * 1e-9 * SPEED_OF_LIGHT_MS
    let fix: ReturnType<typeof solvePosition> = null
    let usedSats = cands
    let usedMeas = meas

    if (cands.length === 3) {
      // Under-determined: one answer for every assumed clock error.
      const curve: { guessNs: number; enu: Vec3 }[] = []
      const solveAt = (ns: number, init: Vec3) =>
        solvePositionFixedClock(meas, TRUE_CLOCK_BIAS_M + ns * 1e-9 * SPEED_OF_LIGHT_MS, { initial: init })
      const mid = solveAt(0, rx)
      if (mid) {
        const up: { guessNs: number; enu: Vec3 }[] = []
        const down: { guessNs: number; enu: Vec3 }[] = []
        let prev = mid.pos
        for (let ns = 50; ns <= CLOCK_GUESS_RANGE_NS; ns += 50) {
          const f = solveAt(ns, prev)
          if (!f) break
          prev = f.pos
          up.push({ guessNs: ns, enu: ecefToEnu(f.pos, rx, geo) })
        }
        prev = mid.pos
        for (let ns = -50; ns >= -CLOCK_GUESS_RANGE_NS; ns -= 50) {
          const f = solveAt(ns, prev)
          if (!f) break
          prev = f.pos
          down.push({ guessNs: ns, enu: ecefToEnu(f.pos, rx, geo) })
        }
        curve.push(...down.reverse(), { guessNs: 0, enu: ecefToEnu(mid.pos, rx, geo) }, ...up)
      }
      res.curve = curve
      res.kind = 'three'
      if (this.settings.clockMode === 'guess') fix = solvePositionFixedClock(meas, guessM, { initial: mid?.pos ?? rx })
      res.reason = 'Three satellites give a whole line of possible answers, one for each clock error.'
    } else if (this.settings.clockMode === 'guess') {
      fix = solvePositionFixedClock(meas, guessM, { initial: rx })
      res.kind = fix ? 'fix' : 'none'
    } else {
      const sigma = sigmaOf(cands)
      if (this.env.raim) {
        const r = raimCheck(meas, sigma, { initial: rx })
        res.raim = r
        fix = r.fix
        if (r.status === 'fault-excluded' && r.excludedIndex !== undefined) {
          const ex = cands[r.excludedIndex]
          ex.excluded = true
          usedSats = cands.filter((s) => s !== ex)
          usedMeas = meas.filter((_, k) => k !== r.excludedIndex)
        }
      } else {
        fix = solvePosition(meas, { initial: rx })
      }
      res.kind = fix ? 'fix' : 'none'
    }

    this.markUsed(usedSats)
    res.usedIds = usedSats.map((s) => s.id)
    res.sigmaM = sigmaOf(usedSats)
    res.dop = computeDop(usedSats.map(dirOf))
    if (res.dop) {
      res.h95M = horizontal95M(res.dop.hdop, res.sigmaM)
      res.v95M = vertical95M(res.dop.vdop, res.sigmaM)
    }

    if (!fix) {
      if (res.kind !== 'three') {
        res.kind = 'none'
        res.reason = 'The satellites are lined up so badly that no position can be worked out.'
      }
      this.result = res
      return
    }

    const enu = ecefToEnu(fix.pos, rx, geo)
    res.enu = enu
    res.clockBiasM = fix.clockBiasM
    res.hErrM = Math.hypot(enu.x, enu.y)
    res.vErrM = enu.z
    const resid = fix.residuals
    res.residuals = usedMeas.map((m, k) => ({ id: m.id, m: resid[k] }))
    res.misfitM = rms(resid)
    res.lines = usedSats.map((s, k) => {
      const se = ecefToEnu(s.ecef, rx, geo)
      const R = usedMeas[k].pseudorangeM - fix.clockBiasM
      const dz = se.z - enu.z
      return { id: s.id, cE: se.x, cN: se.y, r: Math.sqrt(Math.max(0, R * R - dz * dz)), azDeg: s.azDeg }
    })

    if (spoofing) {
      const dme = {
        x: DME_DME_SIGMA_M * smoothNoise(t, 901, this.seed, 60),
        y: DME_DME_SIGMA_M * smoothNoise(t, 902, this.seed, 60),
        z: 0,
      }
      res.dmeDme = dme
      res.crossCheckM = Math.hypot(enu.x - dme.x, enu.y - dme.y)
    }
    this.result = res
  }

  private markUsed(set: SatView[]) {
    for (const s of set) s.used = true
  }

  // --- queries --------------------------------------------------------------

  getSat(id: string | null | undefined): SatView | undefined {
    return this.sats.find((s) => s.id === id)
  }

  /** Satellite nearest a sky position (for clicks on the sky plot). */
  nearestSat(azDeg: number, elDeg: number, maxDeg = 8): SatView | null {
    let best: SatView | null = null
    let bd = maxDeg
    for (const s of this.sats) {
      if (s.elDeg < 0) continue
      const d = angleBetweenDeg({ azDeg, elDeg }, dirOf(s))
      if (d < bd) {
        bd = d
        best = s
      }
    }
    return best
  }
}
