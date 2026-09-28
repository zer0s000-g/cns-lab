/**
 * Coverage predicates used by the Airspace Sandbox: can a given ground system
 * serve an aircraft at a given position and altitude? All based on the same
 * line-of-sight model as every module (propagation.ts).
 */

import { angleDiff, bearingDeg, distanceNm, toDeg, toRad, type LatLon, type Vec2 } from './geometry'
import { lineOfSight, radioLineOfSightNm, type TerrainFn } from './propagation'
import { EARTH_RADIUS_M } from './units'

export interface GroundSite {
  pos: Vec2
  /** Antenna height above mean sea level, ft. */
  heightFt: number
}

/** Radio line of sight from a ground site to an aircraft, including terrain. */
export function siteSees(site: GroundSite, target: Vec2, altitudeFt: number, terrain: TerrainFn, maxRangeNm = Infinity): boolean {
  const d = distanceNm(site.pos, target)
  if (d > maxRangeNm) return false
  if (d > radioLineOfSightNm(site.heightFt, altitudeFt)) return false
  return lineOfSight(site.pos, site.heightFt, target, altitudeFt, terrain, Math.max(0.5, d / 120)).visible
}

// ---------------------------------------------------------------------------
// ILS coverage (ICAO Annex 10 nominal volumes)
// ---------------------------------------------------------------------------

export interface IlsGeometry {
  /** Localizer antenna position (beyond the stop end). */
  locAntenna: Vec2
  /** Glide path antenna position (beside the runway, near the threshold). */
  gsAntenna: Vec2
  /** Final approach course (direction aircraft fly toward the runway), degrees true. */
  courseDeg: number
  elevationFt: number
}

/**
 * Localizer coverage: ±10° of the course to 25 NM and ±35° to 17 NM from the
 * antenna, on the approach side. Glide path: ±8° to 10 NM.
 */
// TODO(expert-review): nominal ILS coverage volumes (heights and angles) simplified to a 2D sector plus a height floor/ceiling.
export function ilsCoverage(geo: IlsGeometry, p: Vec2, altitudeFt: number): { localizer: boolean; glidePath: boolean } {
  // Bearing from the antenna toward the aircraft, compared with the reciprocal of the course
  // (the approach side).
  const approachSide = (geo.courseDeg + 180) % 360
  const locOff = Math.abs(angleDiff(approachSide, bearingDeg(geo.locAntenna, p)))
  const locDist = distanceNm(geo.locAntenna, p)
  const agl = altitudeFt - geo.elevationFt
  const locHeightOk = agl > 0 && agl < 7000 // up to about 7,000 ft above the antenna
  const localizer = locHeightOk && ((locOff <= 10 && locDist <= 25) || (locOff <= 35 && locDist <= 17))
  const gsOff = Math.abs(angleDiff(approachSide, bearingDeg(geo.gsAntenna, p)))
  const gsDist = distanceNm(geo.gsAntenna, p)
  const glidePath = agl > 0 && gsOff <= 8 && gsDist <= 10
  return { localizer, glidePath }
}

// ---------------------------------------------------------------------------
// Multilateration availability
// ---------------------------------------------------------------------------

/**
 * Wide area multilateration needs the same transponder signal at several
 * receivers: 3 with a known (reported) altitude, 4 for a full 3D fix.
 */
export function mlatReceiversInView(receivers: GroundSite[], target: Vec2, altitudeFt: number, terrain: TerrainFn, maxRangeNm = 80): number {
  return receivers.filter((r) => siteSees(r, target, altitudeFt, terrain, maxRangeNm)).length
}

/** Horizontal dilution of precision for TDOA from the receivers' bearings (2D, altitude known). */
export function tdoaHdop(receivers: Vec2[], target: Vec2): number {
  // Jacobian rows: gradient of (|p - r_i| - |p - r_0|) with respect to p.
  if (receivers.length < 3) return Infinity
  const unit = (r: Vec2) => {
    const d = Math.max(distanceNm(r, target), 1e-6)
    return { x: (target.x - r.x) / d, y: (target.y - r.y) / d }
  }
  const u0 = unit(receivers[0])
  let a = 0
  let b = 0
  let c = 0
  for (let i = 1; i < receivers.length; i++) {
    const ui = unit(receivers[i])
    const gx = ui.x - u0.x
    const gy = ui.y - u0.y
    a += gx * gx
    b += gx * gy
    c += gy * gy
  }
  const det = a * c - b * b
  if (det < 1e-12) return Infinity
  // (HᵀH)⁻¹ = 1/det [[c, -b], [-b, a]]
  return Math.sqrt((c + a) / det)
}

// ---------------------------------------------------------------------------
// Geostationary satellite visibility
// ---------------------------------------------------------------------------

/** Geostationary orbit radius from the Earth's centre, m (35,786 km altitude). */
export const GEO_RADIUS_M = 42_164_000

/**
 * Elevation angle (deg) of a geostationary satellite at longitude `satLonDeg`
 * seen from a point on the Earth. Negative means below the horizon.
 */
export function geoElevationDeg(p: LatLon, satLonDeg: number): number {
  const lat = toRad(p.lat)
  const dLon = toRad(satLonDeg - p.lon)
  const cosGamma = Math.cos(lat) * Math.cos(dLon) // central angle to the sub-satellite point
  const ratio = EARTH_RADIUS_M / GEO_RADIUS_M
  const num = cosGamma - ratio
  const den = Math.sqrt(Math.max(0, 1 - cosGamma * cosGamma))
  return toDeg(Math.atan2(num, den))
}

/** One-way slant distance to a geostationary satellite, m. */
export function geoSlantRangeM(p: LatLon, satLonDeg: number): number {
  const lat = toRad(p.lat)
  const dLon = toRad(satLonDeg - p.lon)
  const cosGamma = Math.cos(lat) * Math.cos(dLon)
  return Math.sqrt(EARTH_RADIUS_M ** 2 + GEO_RADIUS_M ** 2 - 2 * EARTH_RADIUS_M * GEO_RADIUS_M * cosGamma)
}
