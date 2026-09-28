/**
 * GNSS physics for CNS Lab: the GPS constellation, pseudoranges, the
 * least-squares position solution, satellite geometry (DOP), the ranging
 * error budget (with and without SBAS / GBAS corrections), RAIM fault
 * detection and exclusion, and a simple jamming model.
 *
 * Frames and units (all in SI, because GNSS geometry is Earth-sized):
 *   ECI   Earth-centred inertial, metres. Z = north pole, X = direction of
 *         the Earth-rotation angle zero point at t = 0.
 *   ECEF  Earth-centred Earth-fixed, metres (WGS-84 axes, from @/core/geometry).
 *   ENU   local East-North-Up, metres, around the receiver.
 * Angles are degrees unless a name says Rad. Time is seconds of simulator time.
 *
 * Pure functions only. Randomness comes from deterministic hashes of a seed
 * (see smoothNoise / epochGaussian), so every result is repeatable.
 */

import {
  DEG,
  WGS84_A_M,
  add3,
  dist3,
  norm3,
  normalize360,
  sub3,
  toDeg,
  type Vec3,
} from './geometry'
import { hash2 } from './random'
import { SPEED_OF_LIGHT_MS } from './units'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** WGS-84 Earth gravitational constant GM, m³/s². */
export const GM_EARTH = 3.986004418e14

/** Earth rotation rate used by GPS (IS-GPS-200 / WGS-84), rad/s. */
export const EARTH_ROTATION_RAD_S = 7.2921151467e-5

/** Nominal GPS orbit semi-major axis, m (altitude about 20,180 km). */
export const GPS_SEMI_MAJOR_AXIS_M = 26_559_700

/** Nominal GPS orbit inclination, degrees. */
export const GPS_INCLINATION_DEG = 55

/** Geostationary orbit radius, m (altitude about 35,786 km). */
export const GEO_RADIUS_M = 42_164_000

/** GPS carrier frequencies, Hz. */
export const GPS_L1_HZ = 1575.42e6
export const GPS_L2_HZ = 1227.6e6
export const GPS_L5_HZ = 1176.45e6

/** GPS L1 C/A code chipping rate, chips/s. */
export const GPS_CA_CHIP_RATE = 1.023e6

/** Elevation mask used for aviation receivers in this simulator, degrees. */
// TODO(expert-review): 5° is the usual airborne mask for RAIM/FDE predictions; confirm for the lesson.
export const ELEVATION_MASK_DEG = 5

/** Height of the thin-shell ionosphere model, m (as used by SBAS). */
export const IONO_SHELL_HEIGHT_M = 350_000

/** A typical received GPS L1 signal power at the antenna, dBm. */
// TODO(expert-review): IS-GPS-200 minimum is -128.5 dBm for L1 C/A; about -130 dBm is used as a round teaching value.
export const GNSS_SIGNAL_DBM = -130

/** Receiver loses lock below this carrier-to-noise density, dB-Hz. */
// TODO(expert-review): tracking threshold depends on the receiver; 28 dB-Hz is an illustrative value.
export const TRACKING_THRESHOLD_DBHZ = 28

/** Thermal noise density at room temperature, dBm/Hz. */
export const THERMAL_NOISE_DBM_HZ = -174

// ---------------------------------------------------------------------------
// Orbits
// ---------------------------------------------------------------------------

/** Orbital period for a circular orbit of radius `aM`, s (Kepler's third law). */
export function orbitalPeriodS(aM = GPS_SEMI_MAJOR_AXIS_M): number {
  return 2 * Math.PI * Math.sqrt(aM ** 3 / GM_EARTH)
}

/** Mean motion (angular speed along the orbit), rad/s. */
export function meanMotionRadS(aM = GPS_SEMI_MAJOR_AXIS_M): number {
  return Math.sqrt(GM_EARTH / aM ** 3)
}

export const GPS_PLANES = ['A', 'B', 'C', 'D', 'E', 'F'] as const
export type GpsPlane = (typeof GPS_PLANES)[number]

export interface GpsSlot {
  /** Label shown to the learner, e.g. "G07". */
  id: string
  plane: GpsPlane
  /** Slot within the plane, e.g. "A1". */
  slot: string
  /** Right ascension of the ascending node at t = 0, degrees. */
  raanDeg: number
  /** Argument of latitude (angle along the orbit from the ascending node) at t = 0, degrees. */
  argLatDeg: number
  /** Numeric key for deterministic noise. */
  key: number
}

/**
 * Baseline 24-slot constellation (plane RAAN and argument of latitude) plus
 * three extra satellites in the largest gaps, as flown today (there are about
 * 31 operational GPS satellites).
 */
// TODO(expert-review): slot values recalled from the GPS SPS Performance Standard (2008) Table 3.2-1;
// the three extra satellites are placed in gaps for teaching, not from an almanac.
const SLOT_TABLE: [string, number, number][] = [
  ['A1', 272.847, 268.126],
  ['A2', 272.847, 161.786],
  ['A3', 272.847, 11.676],
  ['A4', 272.847, 41.806],
  ['B1', 332.847, 80.956],
  ['B2', 332.847, 173.336],
  ['B3', 332.847, 309.976],
  ['B4', 332.847, 204.376],
  ['B5', 332.847, 15.466],
  ['C1', 32.847, 111.876],
  ['C2', 32.847, 11.796],
  ['C3', 32.847, 339.666],
  ['C4', 32.847, 241.556],
  ['D1', 92.847, 135.226],
  ['D2', 92.847, 265.446],
  ['D3', 92.847, 35.156],
  ['D4', 92.847, 167.356],
  ['D5', 92.847, 330.301],
  ['E1', 152.847, 197.046],
  ['E2', 152.847, 302.596],
  ['E3', 152.847, 66.066],
  ['E4', 152.847, 333.686],
  ['F1', 212.847, 238.886],
  ['F2', 212.847, 345.226],
  ['F3', 212.847, 105.206],
  ['F4', 212.847, 135.346],
  ['F5', 212.847, 45.216],
]

/** The simulated GPS constellation. Satellite numbers are made up for the lesson. */
export const GPS_CONSTELLATION: GpsSlot[] = SLOT_TABLE.map(([slot, raanDeg, argLatDeg], i) => ({
  id: `G${String(i + 1).padStart(2, '0')}`,
  plane: slot[0] as GpsPlane,
  slot,
  raanDeg,
  argLatDeg,
  key: i + 1,
}))

/**
 * Earth-rotation angle at t = 0, degrees: the angle from the ECI X axis to the
 * Greenwich meridian. Chosen so the lesson starts with a typical sky over the
 * CNS Lab airport; any value is physically valid.
 */
export const EPOCH_ROTATION_DEG = 20

/** Earth-rotation angle (ECI X axis to Greenwich), rad. */
export function earthRotationAngleRad(timeS: number, epochDeg = EPOCH_ROTATION_DEG): number {
  return epochDeg * DEG + EARTH_ROTATION_RAD_S * timeS
}

/**
 * Position of a satellite on a circular orbit in the ECI frame, m.
 * The orbit plane is tilted by `inclinationDeg` about the line of nodes.
 */
export function circularOrbitEci(
  raanDeg: number,
  argLatDeg: number,
  timeS: number,
  aM = GPS_SEMI_MAJOR_AXIS_M,
  inclinationDeg = GPS_INCLINATION_DEG,
): Vec3 {
  const u = argLatDeg * DEG + meanMotionRadS(aM) * timeS
  const O = raanDeg * DEG
  const i = inclinationDeg * DEG
  const cu = Math.cos(u)
  const su = Math.sin(u)
  const cO = Math.cos(O)
  const sO = Math.sin(O)
  return {
    x: aM * (cO * cu - sO * su * Math.cos(i)),
    y: aM * (sO * cu + cO * su * Math.cos(i)),
    z: aM * su * Math.sin(i),
  }
}

/** ECI → ECEF: rotate by minus the Earth-rotation angle about Z. */
export function eciToEcef(v: Vec3, timeS: number, epochDeg = EPOCH_ROTATION_DEG): Vec3 {
  const th = earthRotationAngleRad(timeS, epochDeg)
  const c = Math.cos(th)
  const s = Math.sin(th)
  return { x: c * v.x + s * v.y, y: -s * v.x + c * v.y, z: v.z }
}

/** ECEF → ECI: rotate by the Earth-rotation angle about Z. */
export function ecefToEci(v: Vec3, timeS: number, epochDeg = EPOCH_ROTATION_DEG): Vec3 {
  const th = earthRotationAngleRad(timeS, epochDeg)
  const c = Math.cos(th)
  const s = Math.sin(th)
  return { x: c * v.x - s * v.y, y: s * v.x + c * v.y, z: v.z }
}

export function satelliteEci(slot: GpsSlot, timeS: number): Vec3 {
  return circularOrbitEci(slot.raanDeg, slot.argLatDeg, timeS)
}

export function satelliteEcef(slot: GpsSlot, timeS: number, epochDeg = EPOCH_ROTATION_DEG): Vec3 {
  return eciToEcef(satelliteEci(slot, timeS), timeS, epochDeg)
}

/** A geostationary satellite sits still above the equator at `lonDeg` (ECEF). */
export function geostationaryEcef(lonDeg: number): Vec3 {
  return { x: GEO_RADIUS_M * Math.cos(lonDeg * DEG), y: GEO_RADIUS_M * Math.sin(lonDeg * DEG), z: 0 }
}

// ---------------------------------------------------------------------------
// Small linear algebra
// ---------------------------------------------------------------------------

/** Solve A·x = b for a small square system (Gauss-Jordan, partial pivoting). Null if singular. */
export function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  let scale = 0
  for (const row of A) for (const v of row) scale = Math.max(scale, Math.abs(v))
  if (scale === 0) return null
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    if (Math.abs(M[p][c]) < 1e-13 * scale) return null
    if (p !== c) [M[p], M[c]] = [M[c], M[p]]
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = M[r][c] / M[c][c]
      if (f === 0) continue
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  return M.map((row, i) => row[n] / row[i])
}

/** Inverse of a small square matrix, or null if singular. */
export function invertMatrix(A: number[][]): number[][] | null {
  const n = A.length
  const cols: number[][] = []
  for (let j = 0; j < n; j++) {
    const e = Array.from({ length: n }, (_, i) => (i === j ? 1 : 0))
    const x = solveLinear(A, e)
    if (!x) return null
    cols.push(x)
  }
  return Array.from({ length: n }, (_, i) => cols.map((c) => c[i]))
}

/** Normal matrix HᵀH and vector Hᵀy. */
function normalEquations(H: number[][], y: number[]): { N: number[][]; u: number[] } {
  const m = H[0].length
  const N = Array.from({ length: m }, () => new Array<number>(m).fill(0))
  const u = new Array<number>(m).fill(0)
  for (let r = 0; r < H.length; r++) {
    const h = H[r]
    for (let i = 0; i < m; i++) {
      u[i] += h[i] * y[r]
      for (let j = 0; j < m; j++) N[i][j] += h[i] * h[j]
    }
  }
  return { N, u }
}

// ---------------------------------------------------------------------------
// Position solution
// ---------------------------------------------------------------------------

export interface Measurement {
  id: string
  /** Satellite position, ECEF m. */
  sat: Vec3
  /** Measured pseudorange, m: geometric range + c·(receiver clock bias) + errors. */
  pseudorangeM: number
}

export interface Fix {
  /** Solved receiver position, ECEF m. */
  pos: Vec3
  /** Receiver clock bias times the speed of light, m. */
  clockBiasM: number
  /** Measured minus predicted pseudorange for each measurement, m (same order as the input). */
  residuals: number[]
  iterations: number
  converged: boolean
}

export interface SolveOptions {
  /** First guess of the position (default: the centre of the Earth, like a receiver with no idea). */
  initial?: Vec3
  initialClockM?: number
  maxIterations?: number
  /** Stop when the correction is smaller than this, m. */
  toleranceM?: number
}

/** Pseudorange for a satellite and a receiver: |s − r| + c·b. */
export function pseudorange(sat: Vec3, receiver: Vec3, clockBiasM: number): number {
  return dist3(sat, receiver) + clockBiasM
}

/**
 * Solve for position AND receiver clock bias (4 unknowns) by iterative least
 * squares (Gauss-Newton). Needs at least 4 measurements; with more, all are
 * used (unweighted). Returns null if the geometry is singular or it diverges.
 */
export function solvePosition(meas: Measurement[], opts: SolveOptions = {}): Fix | null {
  if (meas.length < 4) return null
  let x = { ...(opts.initial ?? { x: 0, y: 0, z: 0 }) }
  let cb = opts.initialClockM ?? 0
  const maxIter = opts.maxIterations ?? 20
  const tol = opts.toleranceM ?? 1e-4
  let converged = false
  let iterations = 0
  for (let it = 1; it <= maxIter; it++) {
    iterations = it
    const H: number[][] = []
    const y: number[] = []
    for (const m of meas) {
      const d = sub3(m.sat, x)
      const r = norm3(d)
      if (!(r > 0)) return null
      H.push([-d.x / r, -d.y / r, -d.z / r, 1])
      y.push(m.pseudorangeM - (r + cb))
    }
    const { N, u } = normalEquations(H, y)
    const dx = solveLinear(N, u)
    if (!dx || dx.some((v) => !Number.isFinite(v))) return null
    x = add3(x, { x: dx[0], y: dx[1], z: dx[2] })
    cb += dx[3]
    if (Math.hypot(dx[0], dx[1], dx[2], dx[3]) < tol) {
      converged = true
      break
    }
  }
  if (!Number.isFinite(x.x + x.y + x.z + cb)) return null
  return { pos: x, clockBiasM: cb, residuals: meas.map((m) => m.pseudorangeM - pseudorange(m.sat, x, cb)), iterations, converged }
}

/**
 * Solve for position only (3 unknowns), trusting a GIVEN receiver clock bias.
 * With exactly 3 satellites this always "works": every assumed clock bias
 * gives a (different) position where the three spheres meet. With 4 or more,
 * a wrong clock leaves residuals: the spheres do not meet at one point.
 */
export function solvePositionFixedClock(meas: Measurement[], clockBiasM: number, opts: SolveOptions = {}): Fix | null {
  if (meas.length < 3) return null
  let x = { ...(opts.initial ?? { x: 0, y: 0, z: 0 }) }
  const maxIter = opts.maxIterations ?? 25
  const tol = opts.toleranceM ?? 1e-4
  let converged = false
  let iterations = 0
  for (let it = 1; it <= maxIter; it++) {
    iterations = it
    const H: number[][] = []
    const y: number[] = []
    for (const m of meas) {
      const d = sub3(m.sat, x)
      const r = norm3(d)
      if (!(r > 0)) return null
      H.push([-d.x / r, -d.y / r, -d.z / r])
      y.push(m.pseudorangeM - clockBiasM - r)
    }
    const { N, u } = normalEquations(H, y)
    const dx = solveLinear(N, u)
    if (!dx || dx.some((v) => !Number.isFinite(v))) return null
    x = add3(x, { x: dx[0], y: dx[1], z: dx[2] })
    if (Math.hypot(dx[0], dx[1], dx[2]) < tol) {
      converged = true
      break
    }
  }
  return {
    pos: x,
    clockBiasM,
    residuals: meas.map((m) => m.pseudorangeM - pseudorange(m.sat, x, clockBiasM)),
    iterations,
    converged,
  }
}

/** Root-mean-square of a list of numbers (0 for an empty list). */
export function rms(v: number[]): number {
  if (v.length === 0) return 0
  return Math.sqrt(v.reduce((s, x) => s + x * x, 0) / v.length)
}

// ---------------------------------------------------------------------------
// Satellite geometry: DOP
// ---------------------------------------------------------------------------

export interface SkyDirection {
  azDeg: number
  elDeg: number
}

export interface Dop {
  gdop: number
  pdop: number
  hdop: number
  vdop: number
  tdop: number
}

/** Unit vector from the receiver to a satellite in local ENU. */
export function enuUnitVector(d: SkyDirection): Vec3 {
  const az = d.azDeg * DEG
  const el = d.elDeg * DEG
  return { x: Math.cos(el) * Math.sin(az), y: Math.cos(el) * Math.cos(az), z: Math.sin(el) }
}

/** Geometry matrix G in the local ENU frame. Rows: [−e_E, −e_N, −e_U, 1]. */
export function geometryMatrix(dirs: SkyDirection[]): number[][] {
  return dirs.map((d) => {
    const e = enuUnitVector(d)
    return [-e.x, -e.y, -e.z, 1]
  })
}

/**
 * Dilution of precision from Q = (GᵀG)⁻¹ in the local ENU frame. Null with
 * fewer than 4 satellites or a degenerate geometry.
 */
export function computeDop(dirs: SkyDirection[]): Dop | null {
  if (dirs.length < 4) return null
  const G = geometryMatrix(dirs)
  const { N } = normalEquations(G, new Array<number>(G.length).fill(0))
  const Q = invertMatrix(N)
  if (!Q) return null
  const [qe, qn, qu, qt] = [Q[0][0], Q[1][1], Q[2][2], Q[3][3]]
  if (!(qe > 0 && qn > 0 && qu > 0 && qt > 0)) return null
  return {
    gdop: Math.sqrt(qe + qn + qu + qt),
    pdop: Math.sqrt(qe + qn + qu),
    hdop: Math.sqrt(qe + qn),
    vdop: Math.sqrt(qu),
    tdop: Math.sqrt(qt),
  }
}

export type DopRating = 'ideal' | 'excellent' | 'good' | 'moderate' | 'fair' | 'poor'

/** Common plain-language rating of a DOP value. */
export function dopRating(dop: number): DopRating {
  if (!Number.isFinite(dop)) return 'poor'
  if (dop <= 1) return 'ideal'
  if (dop <= 2) return 'excellent'
  if (dop <= 5) return 'good'
  if (dop <= 10) return 'moderate'
  if (dop <= 20) return 'fair'
  return 'poor'
}

/** Angle between two sky directions, degrees. */
export function angleBetweenDeg(a: SkyDirection, b: SkyDirection): number {
  const u = enuUnitVector(a)
  const v = enuUnitVector(b)
  const c = Math.max(-1, Math.min(1, u.x * v.x + u.y * v.y + u.z * v.z))
  return toDeg(Math.acos(c))
}

// ---------------------------------------------------------------------------
// Atmosphere
// ---------------------------------------------------------------------------

/**
 * Ionospheric obliquity factor (thin shell at `shellHeightM`): how much longer
 * the path through the ionosphere is at elevation E than straight up.
 * F = 1 / √(1 − (R·cos E / (R + h))²). F = 1 overhead, about 3 near the horizon.
 */
export function ionoObliquity(elDeg: number, shellHeightM = IONO_SHELL_HEIGHT_M): number {
  const k = (WGS84_A_M * Math.cos(Math.max(0, elDeg) * DEG)) / (WGS84_A_M + shellHeightM)
  return 1 / Math.sqrt(1 - k * k)
}

/** Troposphere mapping function (as used by SBAS receivers): ≈ 1/sin E, finite at the horizon. */
export function tropoMapping(elDeg: number): number {
  const s = Math.sin(Math.max(0, elDeg) * DEG)
  return 1.001 / Math.sqrt(0.002001 + s * s)
}

// ---------------------------------------------------------------------------
// Deterministic noise
// ---------------------------------------------------------------------------

/**
 * Smooth, zero-mean, unit-variance noise that varies over about `periodS`
 * seconds. A sum of sinusoids with frequencies and phases hashed from
 * (key, seed): the same inputs always give the same value.
 */
export function smoothNoise(timeS: number, key: number, seed: number, periodS: number): number {
  const K = 4
  let v = 0
  for (let k = 0; k < K; k++) {
    const f = (0.55 + 0.9 * hash2(key, 2 * k + 1, seed)) / periodS
    const ph = 2 * Math.PI * hash2(key, 2 * k + 2, seed)
    v += Math.sin(2 * Math.PI * f * timeS + ph)
  }
  return v * Math.sqrt(2 / K)
}

/** Standard normal value that is fixed for one receiver epoch (one second). */
export function epochGaussian(epoch: number, key: number, seed: number): number {
  const u = Math.max(1e-12, hash2(epoch, 2 * key, seed))
  const v = hash2(epoch, 2 * key + 1, seed + 7919)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

// ---------------------------------------------------------------------------
// Ranging error budget
// ---------------------------------------------------------------------------

export type Augmentation = 'none' | 'sbas' | 'gbas'

/** One-sigma sizes of the pseudorange errors (m) for a correction mode. */
export interface ErrorBudget {
  augmentation: Augmentation
  /** Satellite clock and orbit error. */
  clockOrbitM: number
  /** Vertical ionosphere error left over after correction: a common part... */
  ionoVerticalBiasM: number
  /** ...plus a part that differs from satellite to satellite. */
  ionoVerticalSigmaM: number
  /** Troposphere error left over after the model, straight up. */
  tropoZenithM: number
  /** Airborne receiver noise and multipath: raw code or carrier-smoothed (augmented receivers). */
  receiver: 'raw' | 'smoothed'
  /** GBAS ground reference receiver noise. */
  groundM: number
}

/**
 * Illustrative error budgets.
 * Unaugmented: UERE about 4–7 m, the ionosphere is the biggest part (a GPS
 * receiver removes only about half of it with the broadcast model).
 * SBAS: corrections for satellite clock/orbit and a grid of ionosphere delays → about 1 m.
 * GBAS: a reference station at the airport measures the errors directly → a few decimetres.
 */
// TODO(expert-review): all budget values are teaching approximations, not a specification.
export function errorBudget(augmentation: Augmentation, ionoStorm = false): ErrorBudget {
  switch (augmentation) {
    case 'sbas':
      return {
        augmentation,
        clockOrbitM: 0.5,
        ionoVerticalBiasM: ionoStorm ? 0.8 : 0.1,
        ionoVerticalSigmaM: ionoStorm ? 1.5 : 0.35,
        tropoZenithM: 0.12,
        receiver: 'smoothed',
        groundM: 0,
      }
    case 'gbas':
      return {
        augmentation,
        clockOrbitM: 0.05,
        ionoVerticalBiasM: ionoStorm ? 0.15 : 0.02,
        ionoVerticalSigmaM: ionoStorm ? 0.35 : 0.05,
        tropoZenithM: 0.03,
        receiver: 'smoothed',
        groundM: 0.12,
      }
    default:
      return {
        augmentation: 'none',
        clockOrbitM: 2.0,
        ionoVerticalBiasM: ionoStorm ? 10 : 2.0,
        ionoVerticalSigmaM: ionoStorm ? 7 : 2.0,
        tropoZenithM: 0.12,
        receiver: 'raw',
        groundM: 0,
      }
  }
}

/**
 * Airborne receiver noise + multipath, 1σ, m. Multipath follows the
 * 0.13 + 0.53·e^(−E/10°) shape used for SBAS/GBAS airborne models;
 * raw (unsmoothed) code has more noise.
 */
// TODO(expert-review): multipath/noise model from memory of RTCA DO-229/DO-253 airborne models.
export function receiverNoiseSigmaM(elDeg: number, kind: 'raw' | 'smoothed'): number {
  const mp = 0.13 + 0.53 * Math.exp(-Math.max(0, elDeg) / 10)
  return kind === 'raw' ? Math.hypot(0.5, 1.5 * mp) : Math.hypot(0.15, mp)
}

/** Predicted one-sigma pseudorange error for a satellite at elevation `elDeg`, m. */
export function predictedSigmaM(b: ErrorBudget, elDeg: number): number {
  const F = ionoObliquity(elDeg)
  const iono = F * Math.hypot(b.ionoVerticalBiasM, b.ionoVerticalSigmaM)
  const tropo = b.tropoZenithM * tropoMapping(elDeg)
  return Math.sqrt(b.clockOrbitM ** 2 + iono ** 2 + tropo ** 2 + receiverNoiseSigmaM(elDeg, b.receiver) ** 2 + b.groundM ** 2)
}

export interface RangeErrors {
  clockOrbitM: number
  ionoM: number
  tropoM: number
  noiseM: number
  totalM: number
}

/**
 * The actual (simulated) pseudorange error for one satellite at one moment.
 * Slow parts (clock/orbit, ionosphere, troposphere) drift smoothly; receiver
 * noise changes every second. Fully deterministic for a given seed.
 */
export function rangeErrors(b: ErrorBudget, satKey: number, elDeg: number, timeS: number, seed: number): RangeErrors {
  const epoch = Math.floor(timeS)
  const clockOrbitM = b.clockOrbitM * smoothNoise(timeS, satKey * 16 + 1, seed, 900)
  const ionoV = b.ionoVerticalBiasM + b.ionoVerticalSigmaM * smoothNoise(timeS, satKey * 16 + 2, seed, 1800)
  const ionoM = ionoObliquity(elDeg) * ionoV
  // The troposphere error is common to all satellites (it is the air above the receiver).
  const tropoM = b.tropoZenithM * tropoMapping(elDeg) * smoothNoise(timeS, 7, seed, 3600)
  const n = receiverNoiseSigmaM(elDeg, b.receiver)
  const noiseM =
    n * (0.6 * smoothNoise(timeS, satKey * 16 + 3, seed, 25) + 0.8 * epochGaussian(epoch, satKey, seed)) +
    b.groundM * epochGaussian(epoch, satKey + 500, seed)
  return { clockOrbitM, ionoM, tropoM, noiseM, totalM: clockOrbitM + ionoM + tropoM + noiseM }
}

/**
 * Predicted 95% horizontal accuracy, m: about 2 × HDOP × σ (the "2 drms"
 * rule of thumb). Position error ≈ DOP × ranging error.
 */
export function horizontal95M(hdop: number, sigmaM: number): number {
  return 2 * hdop * sigmaM
}

export function vertical95M(vdop: number, sigmaM: number): number {
  return 2 * vdop * sigmaM
}

// ---------------------------------------------------------------------------
// RAIM: receiver autonomous integrity monitoring
// ---------------------------------------------------------------------------

/** Natural log of the gamma function (Lanczos approximation). */
export function lnGamma(z: number): number {
  const g = 7
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ]
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z)
  const x = z - 1
  let a = c[0]
  const t = x + g + 0.5
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i)
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a)
}

/** Regularized upper incomplete gamma function Q(a, x). */
export function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1
  const lnPre = -x + a * Math.log(x) - lnGamma(a)
  if (x < a + 1) {
    // Series for P, then Q = 1 − P.
    let sum = 1 / a
    let term = sum
    for (let n = 1; n < 500; n++) {
      term *= x / (a + n)
      sum += term
      if (Math.abs(term) < Math.abs(sum) * 1e-15) break
    }
    return Math.max(0, 1 - sum * Math.exp(lnPre))
  }
  // Continued fraction (modified Lentz).
  let b = x + 1 - a
  let c = 1 / 1e-300
  let d = 1 / b
  let h = d
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a)
    b += 2
    d = an * d + b
    if (Math.abs(d) < 1e-300) d = 1e-300
    c = b + an / c
    if (Math.abs(c) < 1e-300) c = 1e-300
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < 1e-15) break
  }
  return Math.exp(lnPre) * h
}

/** Chi-square survival function: probability that χ²(dof) exceeds x. */
export function chiSquareSurvival(x: number, dof: number): number {
  return gammaQ(dof / 2, x / 2)
}

/** The value x with P(χ²(dof) > x) = tailProbability. */
export function chiSquareThreshold(tailProbability: number, dof: number): number {
  let lo = 0
  let hi = 10
  while (chiSquareSurvival(hi, dof) > tailProbability) hi *= 2
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi)
    if (chiSquareSurvival(mid, dof) > tailProbability) lo = mid
    else hi = mid
    if (hi - lo < 1e-10 * hi) break
  }
  return 0.5 * (lo + hi)
}

/** Probability of a false alarm per check. */
// TODO(expert-review): illustrative value; certified RAIM/FDE uses a false-alert rate set by RTCA DO-229 / TSO-C129/C145.
export const RAIM_FALSE_ALARM_PROBABILITY = 1e-6

export type RaimStatus = 'unavailable' | 'ok' | 'fault-detected' | 'fault-excluded'

export interface RaimResult {
  status: RaimStatus
  /** Number of satellites checked. */
  n: number
  /** Spare measurements (n − 4). */
  redundancy: number
  /** RMS residual √(SSE / (n − 4)), m: how badly the measurements disagree. */
  disagreementM: number
  /** Alarm limit on the same scale, m. */
  limitM: number
  /** Index (in the input) of the satellite left out, when a fault was excluded. */
  excludedIndex?: number
  /** Detection happened but no single satellite could be blamed. */
  ambiguous?: boolean
  /** The fix to use: after exclusion if a satellite was left out, else the all-in-view fix. */
  fix: Fix | null
}

/** Sum of squared residuals. */
function sse(fix: Fix): number {
  return fix.residuals.reduce((s, r) => s + r * r, 0)
}

/**
 * Least-squares residual RAIM with fault detection and exclusion (FDE).
 * - 4 satellites: no spare measurement, no check possible.
 * - 5 satellites: one spare → a fault can be DETECTED but not located.
 * - 6 or more: each satellite is left out in turn; if exactly one subset
 *   passes the test, that satellite is the faulty one and is EXCLUDED.
 * `sigmaM` is the receiver's expected one-sigma ranging error.
 */
export function raimCheck(
  meas: Measurement[],
  sigmaM: number,
  opts: SolveOptions & { falseAlarmProbability?: number } = {},
): RaimResult {
  const n = meas.length
  const pfa = opts.falseAlarmProbability ?? RAIM_FALSE_ALARM_PROBABILITY
  const all = solvePosition(meas, opts)
  if (n < 5 || !all) return { status: 'unavailable', n, redundancy: Math.max(0, n - 4), disagreementM: 0, limitM: 0, fix: all }
  const dof = n - 4
  const thr = chiSquareThreshold(pfa, dof)
  const disagreementM = Math.sqrt(sse(all) / dof)
  const limitM = sigmaM * Math.sqrt(thr / dof)
  if (sse(all) / sigmaM ** 2 <= thr) return { status: 'ok', n, redundancy: dof, disagreementM, limitM, fix: all }
  if (n < 6) return { status: 'fault-detected', n, redundancy: dof, disagreementM, limitM, fix: all }
  const thrSub = chiSquareThreshold(pfa, dof - 1)
  const passing: { j: number; fix: Fix }[] = []
  for (let j = 0; j < n; j++) {
    const sub = meas.filter((_, k) => k !== j)
    const f = solvePosition(sub, { ...opts, initial: all.pos, initialClockM: all.clockBiasM })
    if (f && sse(f) / sigmaM ** 2 <= thrSub) passing.push({ j, fix: f })
  }
  if (passing.length === 1) {
    return { status: 'fault-excluded', n, redundancy: dof, disagreementM, limitM, excludedIndex: passing[0].j, fix: passing[0].fix }
  }
  return { status: 'fault-detected', n, redundancy: dof, disagreementM, limitM, ambiguous: passing.length > 1, fix: all }
}

/**
 * How visible a bias on measurement `index` is to the residual test:
 * the diagonal of S = I − H(HᵀH)⁻¹Hᵀ. A bias b raises the sum of squared
 * residuals by b²·S_jj. Near 0 means "this satellite's error hides in the
 * position"; near 1 means "it stands out".
 */
export function faultVisibility(dirs: SkyDirection[], index: number): number {
  if (dirs.length < 5) return 0
  const G = geometryMatrix(dirs)
  const { N } = normalEquations(G, new Array<number>(G.length).fill(0))
  const Q = invertMatrix(N)
  if (!Q) return 0
  const g = G[index]
  let p = 0
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) p += g[i] * Q[i][j] * g[j]
  return Math.max(0, 1 - p)
}

// ---------------------------------------------------------------------------
// Signal strength and jamming
// ---------------------------------------------------------------------------

/** Typical carrier-to-noise density of a clear GPS L1 signal at elevation `elDeg`, dB-Hz. */
// TODO(expert-review): illustrative curve (about 40 dB-Hz near the horizon, 48 dB-Hz overhead).
export function nominalCn0DbHz(elDeg: number): number {
  return 37 + 11 * Math.sqrt(Math.sin(Math.max(0, elDeg) * DEG))
}

/** Thermal noise power in a bandwidth, dBm (noise figure added). */
export function thermalNoiseDbm(bandwidthHz: number, noiseFigureDb = 0): number {
  return THERMAL_NOISE_DBM_HZ + 10 * Math.log10(bandwidthHz) + noiseFigureDb
}

/**
 * Effective C/N0 with a jammer: 1/(C/N0)eff = 1/(C/N0) + (J/S)/(Q·Rc).
 * `jsDb` is the jammer-to-signal power ratio, Q the spectral factor.
 */
// TODO(expert-review): Q = 1 (narrowband-like) is an illustrative choice.
export function jammedCn0DbHz(cn0DbHz: number, jsDb: number, q = 1, chipRate = GPS_CA_CHIP_RATE): number {
  const inv = 10 ** (-cn0DbHz / 10) + 10 ** (jsDb / 10) / (q * chipRate)
  return -10 * Math.log10(inv)
}

/** A satellite signal can be tracked when C/N0 is at or above the threshold. */
export function canTrack(cn0DbHz: number, threshold = TRACKING_THRESHOLD_DBHZ): boolean {
  return cn0DbHz >= threshold
}

/** Light-time for a range, s. */
export function travelTimeFromRangeS(rangeM: number): number {
  return rangeM / SPEED_OF_LIGHT_MS
}

/** Range equivalent of a clock error, m. */
export function clockErrorToRangeM(clockErrorS: number): number {
  return clockErrorS * SPEED_OF_LIGHT_MS
}

/** Azimuth (deg, [0,360)) of a horizontal ENU offset. */
export function enuAzimuthDeg(e: number, n: number): number {
  return normalize360(toDeg(Math.atan2(e, n)))
}
