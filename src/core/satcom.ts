/**
 * Satellite communication physics for CNS Lab: circular orbits (GEO and an
 * Iridium-style LEO constellation), look angles and coverage, signal travel
 * time, inter-satellite routing, antenna blockage by the airframe and rain
 * attenuation by frequency band.
 *
 * Earth model: SATCOM geometry uses ONE spherical Earth of mean radius
 * EARTH_RADIUS_M, the same sphere the great-circle helpers in geometry.ts use
 * and the same sphere the 3D globe draws. On a sphere geocentric and geodetic
 * latitude are equal, so `ecefToEnu`/`azimuthElevation` from geometry.ts give
 * exact local look angles for these positions. The coverage edge drawn on the
 * globe and the elevation used for the link therefore agree exactly.
 *
 * Frames:
 *   ECEF (metres): x toward 0°N 0°E, y toward 0°N 90°E, z toward the North Pole.
 *   three.js (Earth radii): x = ECEF x, y = ECEF z (north pole up), z = −ECEF y.
 */

import {
  azimuthElevation,
  DEG,
  destinationLatLon,
  dist3,
  greatCircleDistanceNm,
  initialBearingDeg,
  interpolateGreatCircle,
  normalize180,
  normalize360,
  toDeg,
  toRad,
  WGS84_A_M,
  type LatLon,
  type Vec3,
} from './geometry'
import { travelTimeS } from './propagation'
import { EARTH_RADIUS_M, EARTH_RADIUS_NM, clamp, ftToMetres, ktToMs } from './units'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Earth's gravitational parameter GM, m³/s² (WGS-84). */
export const MU_EARTH_M3S2 = 3.986004418e14

/** Earth's rotation rate relative to the stars, rad/s (WGS-84). */
export const EARTH_ROTATION_RAD_S = 7.292115e-5

/** One sidereal day: one turn of the Earth relative to the stars (≈ 23 h 56 min 4 s). */
export const SIDEREAL_DAY_S = (2 * Math.PI) / EARTH_ROTATION_RAD_S

/** Standard gravity, m/s². */
export const G0_MS2 = 9.80665

/** Radius of the geostationary orbit, m (Kepler's third law for a one-sidereal-day period ≈ 42,164 km). */
export const GEO_RADIUS_M = Math.cbrt(MU_EARTH_M3S2 / EARTH_ROTATION_RAD_S ** 2)

/** Height of the geostationary orbit above the equator, km (≈ 35,786). */
export const GEO_ALTITUDE_KM = (GEO_RADIUS_M - WGS84_A_M) / 1000

/** Iridium-style LEO constellation. */
export const LEO = {
  // TODO(expert-review): Iridium orbit height quoted as ~780 km (some sources 781 km).
  altitudeM: 780_000,
  planes: 6,
  perPlane: 11,
  inclinationDeg: 86.4,
  // TODO(expert-review): plane spacing 31.6° with a 22° "seam" between the first and last planes.
  planeSpacingDeg: 31.6,
  /** Minimum elevation for a usable link. TODO(expert-review): Iridium design mask 8.2°. */
  maskDeg: 8.2,
  /**
   * Cross-plane inter-satellite links are switched off near the poles, where the
   * planes cross. TODO(expert-review): exact latitude.
   */
  crossPlaneMaxLatDeg: 60,
} as const

/** Radius of the LEO orbit on the CNS Lab sphere, m. */
export const LEO_RADIUS_M = EARTH_RADIUS_M + LEO.altitudeM

/** Minimum elevation for a usable GEO link. TODO(expert-review): 5° is typical; some systems use 10°. */
export const GEO_MASK_DEG = 5

/**
 * The aircraft antenna on top of the fuselage cannot see a satellite that sits
 * less than this far above its own (tilted) horizon: the wings and fuselage get
 * in the way. TODO(expert-review): real antenna patterns and shadowing vary by type.
 */
export const AIRFRAME_MASK_DEG = 5

/** Aeronautical safety SATCOM uses L-band between aircraft and satellite. TODO(expert-review): 1.6 GHz used as a representative value. */
export const L_BAND_GHZ = 1.6
/** Representative passenger-connectivity bands (not used for safety services). */
export const KU_BAND_GHZ = 12
export const KA_BAND_GHZ = 20

// ---------------------------------------------------------------------------
// Positions and frames
// ---------------------------------------------------------------------------

/** Latitude/longitude and height above the CNS Lab sphere to ECEF metres. */
export function sphericalToEcef(p: LatLon, heightM = 0): Vec3 {
  const r = EARTH_RADIUS_M + heightM
  const f = toRad(p.lat)
  const l = toRad(p.lon)
  return { x: r * Math.cos(f) * Math.cos(l), y: r * Math.cos(f) * Math.sin(l), z: r * Math.sin(f) }
}

/** ECEF metres back to latitude/longitude and height above the CNS Lab sphere. */
export function ecefToSpherical(v: Vec3): LatLon & { heightM: number } {
  const r = Math.hypot(v.x, v.y, v.z)
  return { lat: toDeg(Math.asin(clamp(v.z / r, -1, 1))), lon: toDeg(Math.atan2(v.y, v.x)), heightM: r - EARTH_RADIUS_M }
}

/** Point on the ground directly below a satellite. */
export function subSatellitePoint(v: Vec3): LatLon {
  const s = ecefToSpherical(v)
  return { lat: s.lat, lon: s.lon }
}

/** ECEF metres to three.js coordinates in Earth radii (north pole = +y). */
export function ecefToThree(v: Vec3): [number, number, number] {
  return [v.x / EARTH_RADIUS_M, v.z / EARTH_RADIUS_M, -v.y / EARTH_RADIUS_M]
}

/** Azimuth (true), elevation and range of a satellite seen from a point on or above the sphere. */
export function lookAngles(sat: Vec3, observer: LatLon, observerHeightM = 0) {
  return azimuthElevation(sat, sphericalToEcef(observer, observerHeightM), observer)
}

// ---------------------------------------------------------------------------
// Orbits
// ---------------------------------------------------------------------------

/** Period of a circular orbit of radius r (from the Earth's centre), s. */
export function orbitalPeriodS(radiusM: number): number {
  return 2 * Math.PI * Math.sqrt(radiusM ** 3 / MU_EARTH_M3S2)
}

/** Orbital speed on a circular orbit, m/s. */
export function orbitalSpeedMs(radiusM: number): number {
  return Math.sqrt(MU_EARTH_M3S2 / radiusM)
}

/** A geostationary satellite: fixed above the equator at a longitude. */
export function geoPositionEcef(lonDeg: number, radiusM = GEO_RADIUS_M): Vec3 {
  const l = toRad(lonDeg)
  return { x: radiusM * Math.cos(l), y: radiusM * Math.sin(l), z: 0 }
}

export interface CircularOrbit {
  radiusM: number
  inclinationDeg: number
  /** Longitude of the ascending node at t = 0 (ECEF), degrees. */
  raanDeg: number
  /** Angle travelled from the ascending node at t = 0 (argument of latitude), degrees. */
  argLatDeg: number
}

/**
 * ECEF position of a satellite on a circular orbit at time t (s). The orbit is
 * fixed relative to the stars; the Earth turns under it at EARTH_ROTATION_RAD_S.
 */
export function circularOrbitEcef(o: CircularOrbit, tS: number): Vec3 {
  const n = (2 * Math.PI) / orbitalPeriodS(o.radiusM)
  const u = toRad(o.argLatDeg) + n * tS
  const O = toRad(o.raanDeg)
  const i = toRad(o.inclinationDeg)
  const r = o.radiusM
  // Inertial frame aligned with ECEF at t = 0.
  const x = r * (Math.cos(O) * Math.cos(u) - Math.sin(O) * Math.sin(u) * Math.cos(i))
  const y = r * (Math.sin(O) * Math.cos(u) + Math.cos(O) * Math.sin(u) * Math.cos(i))
  const z = r * Math.sin(u) * Math.sin(i)
  // The Earth has turned east by θ: rotate the inertial vector by −θ.
  const th = EARTH_ROTATION_RAD_S * tS
  return { x: x * Math.cos(th) + y * Math.sin(th), y: -x * Math.sin(th) + y * Math.cos(th), z }
}

/**
 * The whole orbit circle at time t, in ECEF (the circle is fixed relative to the
 * stars, so seen from the turning Earth it drifts west). Closed: first point = last.
 */
export function orbitTrackEcef(o: CircularOrbit, tS: number, n = 96): Vec3[] {
  const turnDeg = (360 * tS) / orbitalPeriodS(o.radiusM)
  const out: Vec3[] = []
  for (let k = 0; k <= n; k++) out.push(circularOrbitEcef({ ...o, argLatDeg: (k / n) * 360 - turnDeg }, tS))
  return out
}

export interface LeoSatellite extends CircularOrbit {
  id: string
  plane: number
  slot: number
}

/**
 * Iridium-style constellation: `planes` near-polar planes spaced `planeSpacingDeg`
 * apart in node longitude, `perPlane` satellites evenly spaced in each, and
 * neighbouring planes offset by half a slot so their coverage interleaves.
 */
export function buildLeoConstellation(p: { planes: number; perPlane: number; inclinationDeg: number; planeSpacingDeg: number; radiusM: number } = { ...LEO, radiusM: LEO_RADIUS_M }): LeoSatellite[] {
  const out: LeoSatellite[] = []
  const slotDeg = 360 / p.perPlane
  for (let k = 0; k < p.planes; k++) {
    for (let j = 0; j < p.perPlane; j++) {
      out.push({
        id: `L${k + 1}-${String(j + 1).padStart(2, '0')}`,
        plane: k,
        slot: j,
        radiusM: p.radiusM,
        inclinationDeg: p.inclinationDeg,
        raanDeg: k * p.planeSpacingDeg,
        argLatDeg: j * slotDeg + (k % 2) * (slotDeg / 2),
      })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Coverage and range
// ---------------------------------------------------------------------------

/**
 * Elevation of a satellite seen from the ground at an Earth-centre angle `centralDeg`
 * from the point below it:  tan E = (cos c − R/r) / sin c.
 */
export function elevationAtCentralAngleDeg(centralDeg: number, satRadiusM: number, observerRadiusM = EARTH_RADIUS_M): number {
  const c = toRad(centralDeg)
  if (Math.abs(c) < 1e-12) return 90
  return toDeg(Math.atan2(Math.cos(c) - observerRadiusM / satRadiusM, Math.sin(c)))
}

/**
 * Half-angle (Earth-centre angle) of a satellite's coverage for a minimum
 * elevation:  λ = arccos(R cos E / r) − E. With a 0° mask a GEO satellite
 * reaches about 81° from the point below it.
 */
export function coverageHalfAngleDeg(satRadiusM: number, maskDeg: number, observerRadiusM = EARTH_RADIUS_M): number {
  const E = toRad(maskDeg)
  return toDeg(Math.acos(clamp((observerRadiusM * Math.cos(E)) / satRadiusM, -1, 1)) - E)
}

/** Straight-line distance from a ground observer to a satellite at elevation E, m. */
export function slantRangeM(elevationDeg: number, satRadiusM: number, observerRadiusM = EARTH_RADIUS_M): number {
  const E = toRad(elevationDeg)
  return Math.sqrt(satRadiusM ** 2 - (observerRadiusM * Math.cos(E)) ** 2) - observerRadiusM * Math.sin(E)
}

/** Highest latitude a GEO satellite can serve (observer on its meridian) for an elevation mask. */
export function geoMaxLatitudeDeg(maskDeg: number): number {
  return coverageHalfAngleDeg(GEO_RADIUS_M, maskDeg)
}

/** Points on the ground at the edge of a coverage circle (for drawing and tests). */
export function footprintRing(center: LatLon, halfAngleDeg: number, n = 72): LatLon[] {
  const d = toRad(halfAngleDeg) * EARTH_RADIUS_NM
  const out: LatLon[] = []
  for (let k = 0; k < n; k++) out.push(destinationLatLon(center, (k * 360) / n, d))
  return out
}

/**
 * Time a satellite on a pass straight overhead stays above the mask, s: it
 * sweeps twice the coverage half-angle, relative to the turning Earth
 * (ignored here: a simplification of a few percent for near-polar orbits).
 */
export function maxPassDurationS(satRadiusM: number, maskDeg: number): number {
  return ((2 * coverageHalfAngleDeg(satRadiusM, maskDeg)) / 360) * orbitalPeriodS(satRadiusM)
}

// ---------------------------------------------------------------------------
// Signal travel time
// ---------------------------------------------------------------------------

/** One-way propagation time along a chain of points, s (distance / speed of light). */
export function pathDelayS(points: Vec3[]): number {
  return travelTimeS(pathLengthM(points))
}

export function pathLengthM(points: Vec3[]): number {
  let d = 0
  for (let k = 1; k < points.length; k++) d += dist3(points[k - 1], points[k])
  return d
}

/** Does the straight line between two points clear the Earth (with a margin above the surface)? */
export function clearsEarth(a: Vec3, b: Vec3, marginM = 80_000): boolean {
  // Closest approach of segment ab to the Earth's centre.
  const abx = b.x - a.x
  const aby = b.y - a.y
  const abz = b.z - a.z
  const len2 = abx * abx + aby * aby + abz * abz
  const t = len2 > 0 ? clamp(-(a.x * abx + a.y * aby + a.z * abz) / len2, 0, 1) : 0
  const px = a.x + abx * t
  const py = a.y + aby * t
  const pz = a.z + abz * t
  return Math.hypot(px, py, pz) > EARTH_RADIUS_M + marginM
}

// ---------------------------------------------------------------------------
// Inter-satellite links (LEO)
// ---------------------------------------------------------------------------

export interface IslLink {
  a: number
  b: number
  distanceM: number
}

/**
 * Inter-satellite links: each satellite links to the one ahead and behind in its
 * own plane, and to the nearest satellite in each neighbouring plane. There is
 * no cross-plane link across the "seam" between the first and last planes
 * (their satellites travel in opposite directions there) and none near the poles.
 */
export function islLinks(sats: LeoSatellite[], pos: Vec3[], opts: { planes: number; perPlane: number; crossPlaneMaxLatDeg: number } = LEO): IslLink[] {
  const links: IslLink[] = []
  const idx = (plane: number, slot: number) => plane * opts.perPlane + (((slot % opts.perPlane) + opts.perPlane) % opts.perPlane)
  const latOf = (v: Vec3) => Math.abs(ecefToSpherical(v).lat)
  for (let i = 0; i < sats.length; i++) {
    const s = sats[i]
    // In-plane: link to the next satellite (each pair once).
    const nxt = idx(s.plane, s.slot + 1)
    links.push({ a: i, b: nxt, distanceM: dist3(pos[i], pos[nxt]) })
    // Cross-plane: to the nearest satellite in the next plane (each plane pair once, no seam).
    if (s.plane + 1 < opts.planes && latOf(pos[i]) <= opts.crossPlaneMaxLatDeg) {
      let best = -1
      let bd = Infinity
      for (let j = 0; j < opts.perPlane; j++) {
        const q = idx(s.plane + 1, j)
        const d = dist3(pos[i], pos[q])
        if (d < bd) {
          bd = d
          best = q
        }
      }
      if (best >= 0 && latOf(pos[best]) <= opts.crossPlaneMaxLatDeg && clearsEarth(pos[i], pos[best])) links.push({ a: i, b: best, distanceM: bd })
    }
  }
  return links
}

/** Shortest route through the link graph (Dijkstra on distance). Returns satellite indices, or null. */
export function shortestIslRoute(n: number, links: IslLink[], from: number, to: number): { path: number[]; distanceM: number } | null {
  const valid = (k: number) => Number.isInteger(k) && k >= 0 && k < n
  if (!valid(from) || !valid(to) || links.some((l) => !valid(l.a) || !valid(l.b))) return null
  if (from === to) return { path: [from], distanceM: 0 }
  const adj: { to: number; d: number }[][] = Array.from({ length: n }, () => [])
  for (const l of links) {
    adj[l.a].push({ to: l.b, d: l.distanceM })
    adj[l.b].push({ to: l.a, d: l.distanceM })
  }
  const dist = new Array<number>(n).fill(Infinity)
  const prev = new Array<number>(n).fill(-1)
  const done = new Array<boolean>(n).fill(false)
  dist[from] = 0
  for (let it = 0; it < n; it++) {
    let u = -1
    for (let k = 0; k < n; k++) if (!done[k] && (u < 0 || dist[k] < dist[u])) u = k
    if (u < 0 || dist[u] === Infinity) break
    if (u === to) break
    done[u] = true
    for (const e of adj[u]) {
      const nd = dist[u] + e.d
      if (nd < dist[e.to]) {
        dist[e.to] = nd
        prev[e.to] = u
      }
    }
  }
  if (dist[to] === Infinity) return null
  const path: number[] = []
  for (let v = to; v >= 0; v = prev[v]) path.unshift(v)
  return { path, distanceM: dist[to] }
}

// ---------------------------------------------------------------------------
// Aircraft antenna and banking
// ---------------------------------------------------------------------------

/**
 * Elevation of a direction above the aircraft's own "roof plane" (the horizon of
 * the antenna on top of the fuselage). Bank is positive with the RIGHT wing down.
 * Pitch is taken as zero. In level flight this equals the ordinary elevation.
 */
export function antennaElevationDeg(azimuthDeg: number, elevationDeg: number, headingDeg: number, bankDeg: number): number {
  const rel = toRad(azimuthDeg - headingDeg)
  const e = toRad(elevationDeg)
  const phi = toRad(bankDeg)
  // Components in the level aircraft frame: right, up.
  const right = Math.cos(e) * Math.sin(rel)
  const up = Math.sin(e)
  // The roof normal tilts toward the lower (right) wing when banking right.
  return toDeg(Math.asin(clamp(right * Math.sin(phi) + up * Math.cos(phi), -1, 1)))
}

/** True when the airframe hides the direction from the top-mounted antenna. */
export function blockedByAirframe(azimuthDeg: number, elevationDeg: number, headingDeg: number, bankDeg: number, maskDeg = AIRFRAME_MASK_DEG): boolean {
  return antennaElevationDeg(azimuthDeg, elevationDeg, headingDeg, bankDeg) < maskDeg
}

/**
 * Lowest elevation the antenna can see at a relative azimuth (from the nose,
 * clockwise) for a given bank. Directions below this are hidden by the airframe.
 * Solves cos e·sin(α)·sin φ + sin e·cos φ = sin(mask) for e.
 */
export function airframeHorizonElevationDeg(relAzimuthDeg: number, bankDeg: number, maskDeg = AIRFRAME_MASK_DEG): number {
  const A = Math.sin(toRad(relAzimuthDeg)) * Math.sin(toRad(bankDeg))
  const B = Math.cos(toRad(bankDeg))
  const C = Math.sin(toRad(maskDeg))
  const K = Math.hypot(A, B)
  const delta = Math.atan2(B, A)
  if (C / K >= 1) return 90
  // A cos e + B sin e = K cos(e − δ) ≥ C  ⇔  e ≥ δ − acos(C/K) (the lower boundary).
  return clamp(toDeg(delta - Math.acos(C / K)), -90, 90)
}

/** Rate of turn for a coordinated turn: ω = g·tan(bank)/V, degrees per second. */
export function turnRateDegS(bankDeg: number, tasKt: number): number {
  if (tasKt <= 0) return 0
  return toDeg((G0_MS2 * Math.tan(toRad(bankDeg))) / ktToMs(tasKt))
}

// ---------------------------------------------------------------------------
// Rain attenuation
// ---------------------------------------------------------------------------

/**
 * Rain specific-attenuation coefficients γ = k·R^α (dB/km, R in mm/h),
 * horizontal polarisation, after ITU-R P.838-3.
 * TODO(expert-review): check the coefficient values against the current P.838 table.
 */
const RAIN_COEFF: { f: number; k: number; a: number }[] = [
  { f: 1, k: 0.0000259, a: 0.9691 },
  { f: 1.5, k: 0.0000443, a: 1.0185 },
  { f: 2, k: 0.0000847, a: 1.0664 },
  { f: 4, k: 0.0001071, a: 1.6009 },
  { f: 6, k: 0.0007056, a: 1.59 },
  { f: 8, k: 0.004115, a: 1.3905 },
  { f: 10, k: 0.01217, a: 1.2571 },
  { f: 12, k: 0.02386, a: 1.1825 },
  { f: 15, k: 0.04481, a: 1.1233 },
  { f: 20, k: 0.09164, a: 1.0568 },
  { f: 25, k: 0.1571, a: 0.9991 },
  { f: 30, k: 0.2403, a: 0.9485 },
]

/** Rain attenuation per kilometre of path, dB/km. Interpolated in log frequency. */
export function rainSpecificAttenuationDbPerKm(freqGHz: number, rainMmH: number): number {
  if (rainMmH <= 0) return 0
  const f = clamp(freqGHz, RAIN_COEFF[0].f, RAIN_COEFF[RAIN_COEFF.length - 1].f)
  let i = 0
  while (i < RAIN_COEFF.length - 2 && RAIN_COEFF[i + 1].f < f) i++
  const lo = RAIN_COEFF[i]
  const hi = RAIN_COEFF[i + 1]
  const t = (Math.log(f) - Math.log(lo.f)) / (Math.log(hi.f) - Math.log(lo.f))
  const k = Math.exp(Math.log(lo.k) + t * (Math.log(hi.k) - Math.log(lo.k)))
  const a = lo.a + t * (hi.a - lo.a)
  return k * rainMmH ** a
}

/**
 * Length of the radio path inside the rain, km: from the aircraft up to the top
 * of the rain, along the slant toward the satellite. Zero when the aircraft
 * flies above the rain. Elevations below 5° are treated as 5°.
 */
export function rainPathKm(elevationDeg: number, aircraftHeightKm: number, rainHeightKm: number): number {
  const h = rainHeightKm - Math.max(0, aircraftHeightKm)
  if (h <= 0) return 0
  return h / Math.sin(toRad(Math.max(5, elevationDeg)))
}

/** Total rain attenuation on the aircraft–satellite path, dB. */
export function rainAttenuationDb(freqGHz: number, rainMmH: number, elevationDeg: number, aircraftHeightKm: number, rainHeightKm: number): number {
  return rainSpecificAttenuationDbPerKm(freqGHz, rainMmH) * rainPathKm(elevationDeg, aircraftHeightKm, rainHeightKm)
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export interface Waypoint {
  name: string
  pos: LatLon
}

export interface FlightRoute {
  id: string
  name: string
  waypoints: Waypoint[]
  cruiseAltitudeFt: number
  groundSpeedKt: number
  /** Distance used to climb to cruise and to descend at the end, NM. */
  climbNm: number
  descentNm: number
}

/** Length of a route made of great-circle legs, NM. */
export function routeLengthNm(r: FlightRoute): number {
  let d = 0
  for (let k = 1; k < r.waypoints.length; k++) d += greatCircleDistanceNm(r.waypoints[k - 1].pos, r.waypoints[k].pos)
  return d
}

export interface RoutePoint {
  pos: LatLon
  /** True course along the great circle at this point. */
  courseDeg: number
  altitudeFt: number
  leg: number
}

/** Position, course and altitude a distance along a route (great-circle legs, simple climb and descent). */
export function routePointAt(r: FlightRoute, distanceNm: number): RoutePoint {
  if (r.waypoints.length === 0) throw new RangeError('routePointAt: the route has no waypoints')
  const total = routeLengthNm(r)
  const s = clamp(distanceNm, 0, total)
  let acc = 0
  let pos = r.waypoints[0].pos
  let course = 0
  let leg = 0
  for (let k = 1; k < r.waypoints.length; k++) {
    const a = r.waypoints[k - 1].pos
    const b = r.waypoints[k].pos
    const len = greatCircleDistanceNm(a, b)
    if (s <= acc + len || k === r.waypoints.length - 1) {
      const t = len > 0 ? clamp((s - acc) / len, 0, 1) : 0
      pos = interpolateGreatCircle(a, b, t)
      leg = k - 1
      // Course toward the leg end; at the very end use the course arriving there.
      if (t < 1 - 1e-6) course = initialBearingDeg(pos, b)
      else course = normalize360(initialBearingDeg(b, a) + 180)
      break
    }
    acc += len
  }
  const up = clamp(s / Math.max(r.climbNm, 1e-6), 0, 1)
  const down = clamp((total - s) / Math.max(r.descentNm, 1e-6), 0, 1)
  return { pos, courseDeg: course, altitudeFt: r.cruiseAltitudeFt * Math.min(up, down), leg }
}

/** Aircraft height in metres for a route point. */
export const routeHeightM = (p: RoutePoint) => ftToMetres(p.altitudeFt)

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Signed longitude difference b − a in (−180, 180]. */
export const lonDiffDeg = (a: number, b: number) => normalize180(b - a)

/** Central (Earth-centre) angle between two ground points, degrees. */
export function centralAngleDeg(a: LatLon, b: LatLon): number {
  return greatCircleDistanceNm(a, b) / EARTH_RADIUS_NM / DEG
}
