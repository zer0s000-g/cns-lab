/**
 * Multilateration (MLAT, and Wide Area Multilateration, WAM).
 *
 * An aircraft's transponder transmits a reply or an ADS-B squitter on
 * 1090 MHz. Every ground receiver time-stamps the moment it arrives:
 *
 *   tᵢ = t₀ + |p − rᵢ| / c
 *
 * The emission time t₀ is unknown, but it cancels in time DIFFERENCES:
 *
 *   Δtᵢⱼ = tᵢ − tⱼ = (|p − rᵢ| − |p − rⱼ|) / c
 *
 * Each pair of receivers therefore fixes the difference of two distances, which
 * is a hyperbola in 2D (a hyperboloid sheet in 3D). The aircraft is where the
 * curves meet. N receivers give N − 1 independent differences.
 *
 * Frame used here: local east-north-up METRES (x east, y north, z up, origin at
 * the airport reference point) because the physics is naturally in metres
 * (1 ns of timing ≈ 0.3 m). Times are µs, like every other radio timing in
 * CNS Lab; time differences are also offered in ns. Use worldToEnuM /
 * enuMToWorld to convert from the NM / ft world frame.
 */

import { dist3, type Vec2, type Vec3 } from './geometry'
import { METRES_PER_FT, METRES_PER_NM, SPEED_OF_LIGHT_MS } from './units'

/** Speed of light, metres per microsecond (≈ 299.79). */
export const C_M_PER_US = SPEED_OF_LIGHT_MS / 1e6
/** Speed of light, metres per nanosecond (≈ 0.2998): 1 ns of timing error ≈ 0.3 m. */
export const C_M_PER_NS = SPEED_OF_LIGHT_MS / 1e9

// ---------------------------------------------------------------------------
// Frames and timing
// ---------------------------------------------------------------------------

/** World map point (NM) and height (ft above mean sea level) to local ENU metres. */
export function worldToEnuM(p: Vec2, heightFt: number): Vec3 {
  return { x: p.x * METRES_PER_NM, y: p.y * METRES_PER_NM, z: heightFt * METRES_PER_FT }
}

/** Local ENU metres back to a world map point (NM) and height (ft). */
export function enuMToWorld(v: Vec3): { pos: Vec2; heightFt: number } {
  return { pos: { x: v.x / METRES_PER_NM, y: v.y / METRES_PER_NM }, heightFt: v.z / METRES_PER_FT }
}

/** One-way signal travel time between two points, µs. */
export function travelTimeUsBetween(a: Vec3, b: Vec3): number {
  return dist3(a, b) / C_M_PER_US
}

/**
 * Time (µs) at which a receiver's clock stamps a signal sent at `emitTimeUs`.
 * `clockErrorNs` is a fixed bias of that receiver's clock (positive = stamps late);
 * `noiseNs` is this reply's random time-stamping error.
 */
export function arrivalTimeUs(emitter: Vec3, receiver: Vec3, emitTimeUs: number, clockErrorNs = 0, noiseNs = 0): number {
  return emitTimeUs + travelTimeUsBetween(emitter, receiver) + (clockErrorNs + noiseNs) / 1000
}

/** Difference of the distances from p to receivers i and j, m (positive: farther from i). */
export function rangeDifferenceM(p: Vec3, ri: Vec3, rj: Vec3): number {
  return dist3(p, ri) - dist3(p, rj)
}

/** Time difference of arrival tᵢ − tⱼ, in nanoseconds, from two times in µs. */
export function timeDifferenceNs(tiUs: number, tjUs: number): number {
  return (tiUs - tjUs) * 1000
}

/** A time difference (ns) as a difference of distances (m). */
export function tdoaToRangeDifferenceM(dtNs: number): number {
  return dtNs * C_M_PER_NS
}

/**
 * How far a point is from the hyperbola of a MEASURED time difference, in metres
 * of range difference. Zero on the curve; the sign tells which side.
 */
export function hyperbolaResidualM(p: Vec3, ri: Vec3, rj: Vec3, measuredDtNs: number): number {
  return rangeDifferenceM(p, ri, rj) - tdoaToRangeDifferenceM(measuredDtNs)
}

// ---------------------------------------------------------------------------
// Small linear algebra (n ≤ 3)
// ---------------------------------------------------------------------------

/** Inverse of a small square matrix (Gauss–Jordan with partial pivoting). Null if singular. */
export function invertSmall(m: number[][]): number[][] | null {
  const n = m.length
  const a = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))])
  let scale = 0
  for (const row of m) for (const v of row) scale = Math.max(scale, Math.abs(v))
  if (!(scale > 0)) return null
  for (let c = 0; c < n; c++) {
    let piv = c
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[piv][c])) piv = r
    if (Math.abs(a[piv][c]) < scale * 1e-13) return null
    ;[a[c], a[piv]] = [a[piv], a[c]]
    const d = a[c][c]
    for (let k = 0; k < 2 * n; k++) a[c][k] /= d
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = a[r][c]
      if (f === 0) continue
      for (let k = 0; k < 2 * n; k++) a[r][k] -= f * a[c][k]
    }
  }
  return a.map((row) => row.slice(n))
}

// ---------------------------------------------------------------------------
// TDOA equations: Jacobian, weights and geometry (DOP)
// ---------------------------------------------------------------------------

/**
 * Differences are all taken against receiver 0. Each arrival time has the same
 * independent noise, so the N − 1 differences share receiver 0's noise and are
 * correlated: covariance ∝ (I + 11ᵀ). Its inverse (the least-squares weight)
 * is W = I − 11ᵀ / N. With this weighting the TDOA solution is identical to
 * solving the arrival times with t₀ as an extra unknown.
 */
function weightedNormal(J: number[][], e: number[] | null, nReceivers: number) {
  const m = J.length
  const dims = J[0]?.length ?? 0
  const colSum = Array.from({ length: dims }, (_, k) => J.reduce((s, row) => s + row[k], 0))
  const JtWJ = Array.from({ length: dims }, (_, a) =>
    Array.from({ length: dims }, (_, b) => {
      let s = 0
      for (let i = 0; i < m; i++) s += J[i][a] * J[i][b]
      return s - (colSum[a] * colSum[b]) / nReceivers
    }),
  )
  let JtWe: number[] | null = null
  let cost = 0
  if (e) {
    const eSum = e.reduce((s, v) => s + v, 0)
    JtWe = Array.from({ length: dims }, (_, a) => {
      let s = 0
      for (let i = 0; i < m; i++) s += J[i][a] * e[i]
      return s - (colSum[a] * eSum) / nReceivers
    })
    cost = e.reduce((s, v) => s + v * v, 0) - (eSum * eSum) / nReceivers
  }
  return { JtWJ, JtWe, cost }
}

/** Unit vector from receiver r toward point p (derivative of |p − r| with respect to p). */
function unitFrom(r: Vec3, p: Vec3): Vec3 {
  const dx = p.x - r.x
  const dy = p.y - r.y
  const dz = p.z - r.z
  const d = Math.hypot(dx, dy, dz) || 1e-9
  return { x: dx / d, y: dy / d, z: dz / d }
}

/** Jacobian rows ∂(|p − rᵢ| − |p − r₀|)/∂p for i = 1..N−1, over x, y (and z when dims = 3). */
export function tdoaJacobian(receivers: Vec3[], p: Vec3, dims: 2 | 3): number[][] {
  const u0 = unitFrom(receivers[0], p)
  const rows: number[][] = []
  for (let i = 1; i < receivers.length; i++) {
    const u = unitFrom(receivers[i], p)
    rows.push(dims === 3 ? [u.x - u0.x, u.y - u0.y, u.z - u0.z] : [u.x - u0.x, u.y - u0.y])
  }
  return rows
}

export interface Dop {
  /** Horizontal dilution of precision: horizontal RMS error / (c × timing noise). */
  hdop: number
  /** Vertical DOP (only when height is solved, otherwise NaN). */
  vdop: number
  /** Position DOP over all solved coordinates. */
  gdop: number
  /** Unit covariance of the solved coordinates, (JᵀWJ)⁻¹ in m² per (m of range noise)². */
  cov: number[][]
}

/**
 * Geometry factor of a receiver network at a point:
 * σ_position ≈ DOP × c × σ_timing. `heightKnown` means the height comes from the
 * aircraft's altitude report and only x, y are solved (N ≥ 3); otherwise x, y, z
 * are solved (N ≥ 4). Returns null when the geometry cannot give a position.
 */
export function mlatDop(receivers: Vec3[], p: Vec3, heightKnown: boolean): Dop | null {
  const dims: 2 | 3 = heightKnown ? 2 : 3
  if (receivers.length - 1 < dims) return null
  const J = tdoaJacobian(receivers, p, dims)
  const { JtWJ } = weightedNormal(J, null, receivers.length)
  const cov = invertSmall(JtWJ)
  if (!cov) return null
  const hVar = cov[0][0] + cov[1][1]
  const vVar = dims === 3 ? cov[2][2] : NaN
  if (!(hVar >= 0) || !Number.isFinite(hVar)) return null
  return {
    hdop: Math.sqrt(hVar),
    vdop: dims === 3 ? Math.sqrt(Math.max(0, vVar)) : NaN,
    gdop: Math.sqrt(hVar + (dims === 3 ? Math.max(0, vVar) : 0)),
    cov,
  }
}

/** Expected RMS error (m) for a DOP value and a receiver timing noise (ns, 1σ per receiver). */
export function expectedErrorM(dop: number, timingNoiseNs: number): number {
  return dop * C_M_PER_NS * timingNoiseNs
}

export interface Ellipse {
  /** Semi-axes, m. */
  semiMajorM: number
  semiMinorM: number
  /** True bearing of the major axis, degrees [0, 180). */
  majorBearingDeg: number
}

/**
 * Error ellipse of a horizontal covariance (m²). `k` scales the 1σ ellipse:
 * k = 2.448 contains 95% of 2D Gaussian errors.
 */
export function errorEllipse(cov: number[][], k = 1): Ellipse {
  const a = cov[0][0]
  const b = cov[0][1]
  const d = cov[1][1]
  const tr = a + d
  const det = a * d - b * b
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det))
  const l1 = tr / 2 + disc
  const l2 = Math.max(0, tr / 2 - disc)
  // Eigenvector of l1 in (east, north).
  let vx = b
  let vy = l1 - a
  if (Math.abs(vx) < 1e-12 && Math.abs(vy) < 1e-12) {
    vx = a >= d ? 1 : 0
    vy = a >= d ? 0 : 1
  }
  let brg = (Math.atan2(vx, vy) * 180) / Math.PI
  brg = ((brg % 180) + 180) % 180
  return { semiMajorM: k * Math.sqrt(l1), semiMinorM: k * Math.sqrt(l2), majorBearingDeg: brg }
}

/** Scale that turns a 1σ 2D error ellipse into the ellipse holding 95% of errors (√χ²₂(0.95)). */
export const ELLIPSE_95 = Math.sqrt(-2 * Math.log(0.05))

// ---------------------------------------------------------------------------
// Solver
// ---------------------------------------------------------------------------

export interface GaussNewtonResult {
  position: Vec3
  /** Weighted sum of squared range-difference residuals, m². */
  cost: number
  converged: boolean
  iterations: number
}

/**
 * Damped Gauss–Newton (Levenberg–Marquardt) on the TDOA equations
 * (|p − rᵢ| − |p − r₀|) − dᵢ = 0, with dᵢ = c·(tᵢ − t₀) the MEASURED range differences.
 * With `heightM` set, z is held at that height and only x, y move.
 */
export function gaussNewtonTdoa(
  receivers: Vec3[],
  rangeDiffsM: number[],
  start: Vec3,
  heightM: number | null,
  maxIter = 40,
): GaussNewtonResult {
  const dims: 2 | 3 = heightM == null ? 3 : 2
  const n = receivers.length
  let p: Vec3 = { ...start, z: heightM ?? start.z }
  const evalAt = (q: Vec3) => {
    const d0 = dist3(q, receivers[0])
    const e = rangeDiffsM.map((d, k) => dist3(q, receivers[k + 1]) - d0 - d)
    return e
  }
  let e = evalAt(p)
  let { cost } = weightedNormal(tdoaJacobian(receivers, p, dims), e, n)
  let lambda = 1e-3
  let iterations = 0
  let converged = false
  for (; iterations < maxIter; iterations++) {
    const J = tdoaJacobian(receivers, p, dims)
    const nm = weightedNormal(J, e, n)
    const g = nm.JtWe!
    let accepted = false
    for (let tries = 0; tries < 12; tries++) {
      const A = nm.JtWJ.map((row, i) => row.map((v, j) => (i === j ? v * (1 + lambda) + 1e-12 : v)))
      const inv = invertSmall(A)
      if (!inv) {
        lambda *= 10
        continue
      }
      const step = inv.map((row) => -row.reduce((s, v, k) => s + v * g[k], 0))
      const q: Vec3 = { x: p.x + step[0], y: p.y + step[1], z: dims === 3 ? p.z + step[2] : p.z }
      const eq = evalAt(q)
      const cq = weightedNormal(J, eq, n).cost
      const stepLen = Math.hypot(...step)
      if (cq <= cost || stepLen < 1e-6) {
        p = q
        e = eq
        const improvement = cost - cq
        cost = Math.min(cost, cq)
        lambda = Math.max(lambda / 3, 1e-9)
        accepted = true
        if (stepLen < 1e-4 || (improvement >= 0 && improvement < 1e-12 * (1 + cost))) converged = true
        break
      }
      lambda *= 4
    }
    if (!accepted) {
      // No step reduces the cost: we are at a (possibly local) minimum.
      converged = true
      break
    }
    if (converged) break
    if (Math.hypot(p.x, p.y, p.z) > 5e6) break // ran away far outside any network
  }
  return { position: p, cost: Math.max(0, cost), converged, iterations }
}

export type MlatStatus = 'ok' | 'ambiguous' | 'too-few' | 'no-solution'

export interface MlatSolution {
  status: MlatStatus
  /** Chosen position (null when there is none). */
  position: Vec3 | null
  /** All distinct positions that fit the measurements equally well (two when ambiguous). */
  candidates: Vec3[]
  /** RMS disagreement per receiver after the fit, m. Near 0 when there are no spare receivers. */
  residualRmsM: number
  /** Spare measurements beyond the minimum (N − 1 − unknowns). 0 = no cross-check possible. */
  redundancy: number
  dims: 2 | 3
  receiversUsed: number
}

export interface MlatSolveOptions {
  /** Emitter height (m) from its altitude report; when given only x, y are solved. */
  heightM?: number | null
  /** Extra start points tried first (e.g. the previous fix). */
  starts?: Vec3[]
  /** When two positions fit, prefer the one nearest to this point (track continuity). */
  prefer?: Vec3
  /** Expected range-difference noise (m); used to decide when two fits are equally good. */
  noiseM?: number
  /** Fewer start points (faster, used for maps). */
  quick?: boolean
}

/** Minimum number of receivers for a position: 3 with a known height, 4 without. */
export function minReceivers(heightKnown: boolean): number {
  return heightKnown ? 3 : 4
}

/** Start points spread over and around the receiver network. */
function startPoints(receivers: Vec3[], z: number, quick: boolean): Vec3[] {
  const cx = receivers.reduce((s, r) => s + r.x, 0) / receivers.length
  const cy = receivers.reduce((s, r) => s + r.y, 0) / receivers.length
  let rad = 0
  for (const r of receivers) rad = Math.max(rad, Math.hypot(r.x - cx, r.y - cy))
  rad = Math.max(rad, 1000)
  const out: Vec3[] = [{ x: cx, y: cy, z }]
  const rings = quick ? [0.7, 2.5] : [0.5, 1.2, 2.5, 5]
  const n = quick ? 6 : 8
  for (const k of rings) {
    for (let i = 0; i < n; i++) {
      const a = ((i + (k > 1 ? 0.5 : 0)) / n) * Math.PI * 2
      out.push({ x: cx + Math.sin(a) * rad * k, y: cy + Math.cos(a) * rad * k, z })
    }
  }
  return out
}

/**
 * Solve for the emitter position from arrival times (µs) at the receivers.
 * Tries many start points so that it can report when two positions fit
 * ("ambiguous"), which happens when the curves cross twice (typically with
 * only the minimum number of receivers).
 */
export function solveTdoa(receivers: Vec3[], timesUs: number[], opts: MlatSolveOptions = {}): MlatSolution {
  const heightM = opts.heightM ?? null
  const dims: 2 | 3 = heightM == null ? 3 : 2
  const n = receivers.length
  const base = { dims, receiversUsed: n, redundancy: Math.max(0, n - 1 - dims) }
  if (n < minReceivers(heightM != null) || timesUs.length !== n) {
    return { ...base, status: 'too-few', position: null, candidates: [], residualRmsM: NaN }
  }
  const d = timesUs.slice(1).map((t) => (t - timesUs[0]) * C_M_PER_US)
  const zStart = heightM ?? Math.max(3000, ...receivers.map((r) => r.z + 1000))
  const starts = [...(opts.starts ?? []).map((s) => ({ ...s, z: heightM ?? s.z })), ...startPoints(receivers, zStart, Boolean(opts.quick))]
  const noiseM = Math.max(opts.noiseM ?? 3, 0.1)
  const found: GaussNewtonResult[] = []
  for (const s of starts) {
    const r = gaussNewtonTdoa(receivers, d, s, heightM, opts.quick ? 30 : 40)
    if (!r.converged) continue
    // Below the ground is not a real solution (the mirror image under a flat network).
    if (dims === 3 && r.position.z < Math.min(...receivers.map((q) => q.z)) - 200) continue
    found.push(r)
  }
  if (!found.length) return { ...base, status: 'no-solution', position: null, candidates: [], residualRmsM: NaN }
  found.sort((a, b) => a.cost - b.cost)
  const bestRms = Math.sqrt(found[0].cost / n)
  // Fits that explain the measurements (almost) as well as the best one.
  const tolRms = bestRms + 3 * noiseM + 0.5
  const mergeM = Math.max(100, 30 * noiseM)
  const candidates: GaussNewtonResult[] = []
  for (const r of found) {
    if (Math.sqrt(r.cost / n) > tolRms) continue
    if (candidates.some((c) => dist3(c.position, r.position) < mergeM)) continue
    candidates.push(r)
  }
  // A measurement set with no consistent solution at all.
  const worstPlausible = Math.max(1000, 200 * noiseM)
  if (bestRms > worstPlausible) {
    return { ...base, status: 'no-solution', position: null, candidates: [], residualRmsM: bestRms }
  }
  let chosen = candidates[0]
  if (candidates.length > 1 && opts.prefer) {
    const pref = opts.prefer
    chosen = candidates.reduce((a, b) => (dist3(a.position, pref) <= dist3(b.position, pref) ? a : b))
  }
  return {
    ...base,
    status: candidates.length > 1 ? 'ambiguous' : 'ok',
    position: chosen.position,
    candidates: candidates.map((c) => c.position),
    residualRmsM: Math.sqrt(chosen.cost / n),
  }
}

// ---------------------------------------------------------------------------
// Drawing the curves: contour of the measured-TDOA function
// ---------------------------------------------------------------------------

export interface Bounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export type Segment = [Vec2, Vec2]

/**
 * Line segments approximating f(x, y) = 0 on a regular grid (marching squares
 * with linear interpolation). f must be continuous.
 */
export function contourSegments(f: (x: number, y: number) => number, b: Bounds, cols: number, rows: number): Segment[] {
  const dx = (b.maxX - b.minX) / cols
  const dy = (b.maxY - b.minY) / rows
  const v = new Float64Array((cols + 1) * (rows + 1))
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) v[j * (cols + 1) + i] = f(b.minX + i * dx, b.minY + j * dy)
  const segs: Segment[] = []
  const at = (i: number, j: number) => v[j * (cols + 1) + i]
  const lerpPt = (x0: number, y0: number, f0: number, x1: number, y1: number, f1: number): Vec2 => {
    const t = f0 === f1 ? 0.5 : f0 / (f0 - f1)
    return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x0 = b.minX + i * dx
      const y0 = b.minY + j * dy
      const x1 = x0 + dx
      const y1 = y0 + dy
      const f00 = at(i, j)
      const f10 = at(i + 1, j)
      const f11 = at(i + 1, j + 1)
      const f01 = at(i, j + 1)
      const s00 = f00 > 0
      const s10 = f10 > 0
      const s11 = f11 > 0
      const s01 = f01 > 0
      if (s00 === s10 && s10 === s11 && s11 === s01) continue
      // Crossing points on the four edges (bottom, right, top, left).
      const pts: Vec2[] = []
      if (s00 !== s10) pts.push(lerpPt(x0, y0, f00, x1, y0, f10))
      if (s10 !== s11) pts.push(lerpPt(x1, y0, f10, x1, y1, f11))
      if (s11 !== s01) pts.push(lerpPt(x1, y1, f11, x0, y1, f01))
      if (s01 !== s00) pts.push(lerpPt(x0, y1, f01, x0, y0, f00))
      if (pts.length === 2) segs.push([pts[0], pts[1]])
      else if (pts.length === 4) {
        // Saddle: decide the pairing with the value at the cell centre.
        const centre = f(x0 + dx / 2, y0 + dy / 2) > 0
        if (centre === s00) {
          segs.push([pts[0], pts[1]], [pts[2], pts[3]])
        } else {
          segs.push([pts[0], pts[3]], [pts[1], pts[2]])
        }
      }
    }
  }
  return segs
}

/**
 * The curve of all points (at height `heightM`) whose distance difference to
 * receivers i and j matches the MEASURED time difference tᵢ − tⱼ (ns).
 * A timing error at either receiver therefore moves the curve.
 */
export function hyperbolaSegments(ri: Vec3, rj: Vec3, measuredDtNs: number, heightM: number, b: Bounds, cols = 120, rows = 120): Segment[] {
  const target = tdoaToRangeDifferenceM(measuredDtNs)
  // No curve exists when the measured difference exceeds the receiver spacing.
  if (Math.abs(target) >= dist3(ri, rj)) return []
  return contourSegments(
    (x, y) => {
      const p = { x, y, z: heightM }
      return dist3(p, ri) - dist3(p, rj) - target
    },
    b,
    cols,
    rows,
  )
}

/** Receivers lying (nearly) on one straight line: the geometry that ruins MLAT. */
export function isNearlyCollinear(receivers: Vec3[], toleranceM = 1): boolean {
  if (receivers.length < 3) return true
  // Largest distance of any receiver from the line through the two farthest apart.
  let a = 0
  let b = 1
  let best = -1
  for (let i = 0; i < receivers.length; i++)
    for (let j = i + 1; j < receivers.length; j++) {
      const d = Math.hypot(receivers[i].x - receivers[j].x, receivers[i].y - receivers[j].y)
      if (d > best) {
        best = d
        a = i
        b = j
      }
    }
  const ax = receivers[a].x
  const ay = receivers[a].y
  const ux = (receivers[b].x - ax) / best
  const uy = (receivers[b].y - ay) / best
  return receivers.every((r) => Math.abs((r.x - ax) * uy - (r.y - ay) * ux) <= toleranceM)
}
