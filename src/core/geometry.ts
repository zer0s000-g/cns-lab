/**
 * Geometry for CNS Lab: bearings, distances, magnetic variation and
 * coordinate conversions.
 *
 * Local map frame ("world" frame): origin at the airport reference point,
 * x = east (NM), y = north (NM). Bearings are degrees clockwise from true
 * north. Screen frames flip y (screen y grows downward).
 */

import { EARTH_RADIUS_NM } from './units'

export interface Vec2 {
  x: number
  y: number
}

export interface LatLon {
  lat: number
  lon: number
}

export const DEG = Math.PI / 180
export const toRad = (deg: number) => deg * DEG
export const toDeg = (rad: number) => rad / DEG

/** Normalise an angle to [0, 360). */
export function normalize360(deg: number): number {
  const r = deg % 360
  const v = r < 0 ? r + 360 : r
  // Avoid returning 360 because of floating point (e.g. -1e-15 + 360), and -0.
  return v >= 360 ? 0 : v + 0
}

/** Normalise an angle to (-180, 180]. */
export function normalize180(deg: number): number {
  const v = normalize360(deg)
  return v > 180 ? v - 360 : v
}

/** Signed smallest rotation from angle `from` to angle `to`, in (-180, 180]. */
export function angleDiff(from: number, to: number): number {
  return normalize180(to - from)
}

export const vec = (x: number, y: number): Vec2 => ({ x, y })
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y })
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y })
export const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k })
export const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y
export const length = (a: Vec2) => Math.hypot(a.x, a.y)

/** Straight-line distance between two map points, NM. */
export function distanceNm(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

/** True bearing from `from` to `to`, degrees in [0, 360). */
export function bearingDeg(from: Vec2, to: Vec2): number {
  const dx = to.x - from.x
  const dy = to.y - from.y
  if (dx === 0 && dy === 0) return 0
  return normalize360(toDeg(Math.atan2(dx, dy)))
}

/** Unit vector pointing along a true bearing (x east, y north). */
export function bearingVector(bearing: number): Vec2 {
  return { x: Math.sin(toRad(bearing)), y: Math.cos(toRad(bearing)) }
}

/** Point reached by moving `distNm` along `bearing` from `from`. */
export function destinationPoint(from: Vec2, bearing: number, distNm: number): Vec2 {
  const u = bearingVector(bearing)
  return { x: from.x + u.x * distNm, y: from.y + u.y * distNm }
}

/**
 * Magnetic variation convention: positive = East, negative = West.
 * "East is least": magnetic = true - east variation.
 */
export function trueToMagnetic(trueDeg: number, variationDeg: number): number {
  return normalize360(trueDeg - variationDeg)
}

export function magneticToTrue(magDeg: number, variationDeg: number): number {
  return normalize360(magDeg + variationDeg)
}

/**
 * Relative bearing: the angle from the aircraft's nose to a station,
 * measured clockwise. Both inputs must use the same reference (both true
 * or both magnetic).
 */
export function relativeBearing(bearingToStation: number, heading: number): number {
  return normalize360(bearingToStation - heading)
}

/** Magnetic bearing to a station = magnetic heading + relative bearing. */
export function magneticBearingFromRelative(headingMag: number, relBearing: number): number {
  return normalize360(headingMag + relBearing)
}

/**
 * True when a clockwise sweep from `fromDeg` through `spanDeg` degrees passes
 * over `targetDeg` (start inclusive, end exclusive). A span of 360° or more
 * covers everything. Used by rotating antennas to decide what they illuminated
 * during one frame.
 */
export function sweepCovers(targetDeg: number, fromDeg: number, spanDeg: number): boolean {
  if (spanDeg >= 360) return true
  if (spanDeg <= 0) return false
  return normalize360(targetDeg - fromDeg) < spanDeg
}

/** Reciprocal of a bearing (the direction pointing back). */
export const reciprocal = (bearing: number) => normalize360(bearing + 180)

/**
 * Signed cross-track distance of point p from the infinite line through `origin`
 * with direction `courseDeg`. Positive means p is to the RIGHT of the line when
 * looking along the course.
 */
export function crossTrackNm(p: Vec2, origin: Vec2, courseDeg: number): number {
  const d = sub(p, origin)
  // Right-hand normal of the course direction (sinC, cosC) is (cosC, -sinC).
  const c = toRad(courseDeg)
  return d.x * Math.cos(c) - d.y * Math.sin(c)
}

/** Signed along-track distance of p along the course from origin. */
export function alongTrackNm(p: Vec2, origin: Vec2, courseDeg: number): number {
  const d = sub(p, origin)
  const c = toRad(courseDeg)
  return d.x * Math.sin(c) + d.y * Math.cos(c)
}

/** Distance from point p to segment ab. */
export function distanceToSegmentNm(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a)
  const len2 = dot(ab, ab)
  if (len2 === 0) return distanceNm(p, a)
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / len2))
  return distanceNm(p, { x: a.x + ab.x * t, y: a.y + ab.y * t })
}

// ---------------------------------------------------------------------------
// Latitude / longitude
// ---------------------------------------------------------------------------

/**
 * Local tangent-plane conversion around a reference point (equirectangular).
 * Accurate to well under 0.1% within ~100 NM of the reference outside polar
 * regions, which is all the local maps use.
 */
export function latLonToLocal(p: LatLon, ref: LatLon): Vec2 {
  const cosLat = Math.cos(toRad(ref.lat))
  return {
    x: normalize180(p.lon - ref.lon) * 60 * cosLat,
    y: (p.lat - ref.lat) * 60,
  }
}

export function localToLatLon(v: Vec2, ref: LatLon): LatLon {
  const cosLat = Math.cos(toRad(ref.lat))
  return {
    lat: ref.lat + v.y / 60,
    lon: normalize180(ref.lon + v.x / (60 * cosLat)),
  }
}

/** Great-circle distance (haversine) on a spherical Earth, NM. */
export function greatCircleDistanceNm(a: LatLon, b: LatLon): number {
  const f1 = toRad(a.lat)
  const f2 = toRad(b.lat)
  const df = f2 - f1
  const dl = toRad(b.lon - a.lon)
  const h = Math.sin(df / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Initial true course of the great circle from a to b. */
export function initialBearingDeg(a: LatLon, b: LatLon): number {
  const f1 = toRad(a.lat)
  const f2 = toRad(b.lat)
  const dl = toRad(b.lon - a.lon)
  const y = Math.sin(dl) * Math.cos(f2)
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl)
  return normalize360(toDeg(Math.atan2(y, x)))
}

/** Point reached from `a` along a great circle with initial course `bearing`. */
export function destinationLatLon(a: LatLon, bearing: number, distNm: number): LatLon {
  const d = distNm / EARTH_RADIUS_NM
  const f1 = toRad(a.lat)
  const l1 = toRad(a.lon)
  const th = toRad(bearing)
  const f2 = Math.asin(Math.sin(f1) * Math.cos(d) + Math.cos(f1) * Math.sin(d) * Math.cos(th))
  const l2 =
    l1 + Math.atan2(Math.sin(th) * Math.sin(d) * Math.cos(f1), Math.cos(d) - Math.sin(f1) * Math.sin(f2))
  return { lat: toDeg(f2), lon: normalize180(toDeg(l2)) }
}

/** Point a fraction `t` (0..1) of the way along the great circle from a to b. */
export function interpolateGreatCircle(a: LatLon, b: LatLon, t: number): LatLon {
  const f1 = toRad(a.lat)
  const l1 = toRad(a.lon)
  const f2 = toRad(b.lat)
  const l2 = toRad(b.lon)
  const d = greatCircleDistanceNm(a, b) / EARTH_RADIUS_NM
  if (d < 1e-12) return { ...a }
  const A = Math.sin((1 - t) * d) / Math.sin(d)
  const B = Math.sin(t * d) / Math.sin(d)
  const x = A * Math.cos(f1) * Math.cos(l1) + B * Math.cos(f2) * Math.cos(l2)
  const y = A * Math.cos(f1) * Math.sin(l1) + B * Math.cos(f2) * Math.sin(l2)
  const z = A * Math.sin(f1) + B * Math.sin(f2)
  return { lat: toDeg(Math.atan2(z, Math.hypot(x, y))), lon: toDeg(Math.atan2(y, x)) }
}

// ---------------------------------------------------------------------------
// Earth-centred coordinates (used by GNSS and SATCOM)
// ---------------------------------------------------------------------------

export interface Vec3 {
  x: number
  y: number
  z: number
}

/** WGS-84 ellipsoid constants. */
export const WGS84_A_M = 6_378_137
export const WGS84_F = 1 / 298.257223563
export const WGS84_E2 = WGS84_F * (2 - WGS84_F)

/** Geodetic latitude/longitude/height (m) to Earth-centred Earth-fixed metres. */
export function geodeticToEcef(p: LatLon, heightM = 0): Vec3 {
  const f = toRad(p.lat)
  const l = toRad(p.lon)
  const sinF = Math.sin(f)
  const n = WGS84_A_M / Math.sqrt(1 - WGS84_E2 * sinF * sinF)
  return {
    x: (n + heightM) * Math.cos(f) * Math.cos(l),
    y: (n + heightM) * Math.cos(f) * Math.sin(l),
    z: (n * (1 - WGS84_E2) + heightM) * sinF,
  }
}

/** ECEF metres to geodetic (Bowring's iterative method, converges in a few steps). */
export function ecefToGeodetic(v: Vec3): LatLon & { heightM: number } {
  const lon = Math.atan2(v.y, v.x)
  const p = Math.hypot(v.x, v.y)
  let lat = Math.atan2(v.z, p * (1 - WGS84_E2))
  let h = 0
  for (let i = 0; i < 8; i++) {
    const sinF = Math.sin(lat)
    const n = WGS84_A_M / Math.sqrt(1 - WGS84_E2 * sinF * sinF)
    h = p / Math.cos(lat) - n
    lat = Math.atan2(v.z, p * (1 - (WGS84_E2 * n) / (n + h)))
  }
  return { lat: toDeg(lat), lon: toDeg(lon), heightM: h }
}

/** Vector from `origin` to `target` (ECEF) expressed in local East-North-Up metres. */
export function ecefToEnu(target: Vec3, origin: Vec3, originGeo: LatLon): Vec3 {
  const f = toRad(originGeo.lat)
  const l = toRad(originGeo.lon)
  const dx = target.x - origin.x
  const dy = target.y - origin.y
  const dz = target.z - origin.z
  return {
    x: -Math.sin(l) * dx + Math.cos(l) * dy,
    y: -Math.sin(f) * Math.cos(l) * dx - Math.sin(f) * Math.sin(l) * dy + Math.cos(f) * dz,
    z: Math.cos(f) * Math.cos(l) * dx + Math.cos(f) * Math.sin(l) * dy + Math.sin(f) * dz,
  }
}

/** Local East-North-Up offset (m) back to ECEF. */
export function enuToEcef(enu: Vec3, origin: Vec3, originGeo: LatLon): Vec3 {
  const f = toRad(originGeo.lat)
  const l = toRad(originGeo.lon)
  return {
    x: origin.x - Math.sin(l) * enu.x - Math.sin(f) * Math.cos(l) * enu.y + Math.cos(f) * Math.cos(l) * enu.z,
    y: origin.y + Math.cos(l) * enu.x - Math.sin(f) * Math.sin(l) * enu.y + Math.cos(f) * Math.sin(l) * enu.z,
    z: origin.z + Math.cos(f) * enu.y + Math.sin(f) * enu.z,
  }
}

/** Azimuth (deg true) and elevation (deg) of `target` seen from `origin`. */
export function azimuthElevation(
  target: Vec3,
  origin: Vec3,
  originGeo: LatLon,
): { azimuthDeg: number; elevationDeg: number; rangeM: number } {
  const e = ecefToEnu(target, origin, originGeo)
  const horiz = Math.hypot(e.x, e.y)
  return {
    azimuthDeg: normalize360(toDeg(Math.atan2(e.x, e.y))),
    elevationDeg: toDeg(Math.atan2(e.z, horiz)),
    rangeM: Math.hypot(e.x, e.y, e.z),
  }
}

export const vec3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z })
export const sub3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
export const add3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
export const scale3 = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k })
export const dot3 = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z
export const norm3 = (a: Vec3) => Math.hypot(a.x, a.y, a.z)
export const dist3 = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

// ---------------------------------------------------------------------------
// Screen and 3D conventions
// ---------------------------------------------------------------------------

/**
 * Canvas arc angle (radians, measured clockwise from the +x axis because the
 * canvas y axis points down) for a compass bearing.
 */
export function bearingToCanvasAngle(bearing: number): number {
  return toRad(bearing - 90)
}

export interface MapView {
  /** World point shown at the centre of the canvas (NM). */
  center: Vec2
  /** Pixels per nautical mile. */
  pxPerNm: number
  /** Canvas size in CSS pixels. */
  width: number
  height: number
}

/** World (NM, y north) to screen (px, y down). */
export function worldToScreen(p: Vec2, view: MapView): Vec2 {
  return {
    x: view.width / 2 + (p.x - view.center.x) * view.pxPerNm,
    y: view.height / 2 - (p.y - view.center.y) * view.pxPerNm,
  }
}

/** Screen (px) to world (NM). Exact inverse of worldToScreen. */
export function screenToWorld(s: Vec2, view: MapView): Vec2 {
  return {
    x: view.center.x + (s.x - view.width / 2) / view.pxPerNm,
    y: view.center.y - (s.y - view.height / 2) / view.pxPerNm,
  }
}

/**
 * three.js uses y up and -z forward. We map east → +x, up → +y, north → -z.
 */
export function worldToThree(p: Vec2, upUnits = 0): [number, number, number] {
  return [p.x, upUnits, -p.y]
}

/**
 * Rotation about three.js +y (counter-clockwise seen from above) that points
 * an object's local -z axis ("north") along a compass bearing (clockwise).
 */
export function bearingToThreeRotationY(bearing: number): number {
  return -toRad(bearing)
}
