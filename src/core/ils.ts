/**
 * Instrument Landing System: localizer, glideslope, marker beacons, approach
 * categories and what the pilot can see in fog.
 *
 * Localizer (left/right): two tones, 90 Hz and 150 Hz. Seen by a pilot
 * approaching the runway, 90 Hz predominates on the LEFT and 150 Hz on the
 * RIGHT. The receiver compares their depths of modulation:
 *   DDM = m90 − m150   (positive = 90 Hz stronger = aircraft left = fly right)
 * Each tone is 20% on the course line; DDM 0.155 is full-scale deflection.
 *
 * Glideslope (up/down): 90 Hz predominates ABOVE the path, 150 Hz BELOW.
 * Each tone is 40% on the path. DDM 0.0875 at 0.12θ above/below, 0.175 is
 * full scale.
 *
 * Conventions shared with the CDI instrument:
 *   lateral  = DDM_loc / 0.155       (+1 = needle right = fly right)
 *   vertical = −DDM_gs / 0.175       (+1 = needle up = fly up)
 *
 * Frame: world map (x east, y north, NM), heights in ft, angles in degrees
 * (true). The Earth is treated as flat within the ILS area.
 */

import { alongTrackNm, bearingVector, crossTrackNm, distanceNm, toDeg, toRad, type Vec2 } from './geometry'
import type { MarkerKind } from './morse'
import type { Runway } from './world'
import { FT_PER_NM, METRES_PER_FT, METRES_PER_NM, clamp } from './units'

// ---------------------------------------------------------------------------
// Signal-in-space constants (ICAO Annex 10, Vol I)
// ---------------------------------------------------------------------------

/** Depth of modulation of each localizer tone on the course line (20%). */
export const LOC_TONE_DEPTH = 0.2
/** Depth of modulation of each glideslope tone on the glide path (40%). */
export const GS_TONE_DEPTH = 0.4
/** Localizer DDM at full-scale needle deflection (the edge of the course sector). */
export const LOC_FULL_SCALE_DDM = 0.155
/** Localizer DDM that must be kept outside the course sector ("clearance"). */
export const LOC_CLEARANCE_DDM = 0.18
/** Half-width of the course sector at the threshold (DDM 0.155), m. About ±350 ft. */
export const LOC_HALF_WIDTH_AT_THRESHOLD_M = 107
/** Glideslope DDM at 0.12θ above or below the path. */
export const GS_HALF_SECTOR_DDM = 0.0875
/** Glideslope DDM at full-scale needle deflection. */
export const GS_FULL_SCALE_DDM = 0.175

/** Typical glide path angle, degrees. */
export const DEFAULT_PATH_DEG = 3
/** Typical threshold crossing height (the path's height over the threshold), ft. */
export const DEFAULT_TCH_FT = 50

// TODO(expert-review): shape of the localizer DDM outside the course sector. Modelled as a
// linear rise to 0.18, then a smooth rise to a plateau of 0.30 that holds out to ±90°.
/** Plateau DDM far from the course line in the teaching model. */
export const LOC_PLATEAU_DDM = 0.3

// TODO(expert-review): teaching model of a null-reference glideslope including false paths:
// DDM(e) = −A·sin(π·e/θ), held at −A below 0.5θ. Zero crossings at θ (true path),
// 2θ (false path, reversed sensing) and 3θ (false path, normal sensing).
/** Amplitude A chosen so that DDM(1.12θ) = +0.0875. */
export const GS_MODEL_AMPLITUDE = GS_HALF_SECTOR_DDM / Math.sin(0.12 * Math.PI)

// ---------------------------------------------------------------------------
// Frequencies
// ---------------------------------------------------------------------------

// TODO(expert-review): localizer / glideslope channel pairing table (Annex 10, Vol I, 3.1.6.1.1).
/** The 40 ILS channels: [localizer MHz, paired glideslope MHz]. */
export const ILS_CHANNEL_PAIRS: readonly (readonly [number, number])[] = [
  [108.1, 334.7], [108.15, 334.55], [108.3, 334.1], [108.35, 333.95],
  [108.5, 329.9], [108.55, 329.75], [108.7, 330.5], [108.75, 330.35],
  [108.9, 329.3], [108.95, 329.15], [109.1, 331.4], [109.15, 331.25],
  [109.3, 332.0], [109.35, 331.85], [109.5, 332.6], [109.55, 332.45],
  [109.7, 333.2], [109.75, 333.05], [109.9, 333.8], [109.95, 333.65],
  [110.1, 334.4], [110.15, 334.25], [110.3, 335.0], [110.35, 334.85],
  [110.5, 329.6], [110.55, 329.45], [110.7, 330.2], [110.75, 330.05],
  [110.9, 330.8], [110.95, 330.65], [111.1, 331.7], [111.15, 331.55],
  [111.3, 332.3], [111.35, 332.15], [111.5, 332.9], [111.55, 332.75],
  [111.7, 333.5], [111.75, 333.35], [111.9, 331.1], [111.95, 330.95],
]

export const LOC_BAND_MHZ = { min: 108.1, max: 111.95 } as const
export const GS_BAND_MHZ = { min: 329.15, max: 335.0 } as const
/** Marker beacons all transmit on 75 MHz. */
export const MARKER_FREQUENCY_MHZ = 75
/** Localizer identification tone, Hz. */
export const LOC_IDENT_TONE_HZ = 1020
// TODO(expert-review): ILS identification repetition (at least six times per minute).
export const LOC_IDENT_INTERVAL_S = 10

/** True for a localizer frequency: 108.10–111.95 MHz with an odd tenths digit. */
export function isLocalizerFrequency(mhz: number): boolean {
  const hundredths = Math.round(mhz * 100)
  if (hundredths < 10810 || hundredths > 11195) return false
  if (hundredths % 5 !== 0) return false
  const tenthsDigit = Math.floor(hundredths / 10) % 10
  return tenthsDigit % 2 === 1
}

/** Glideslope frequency paired with a localizer frequency, MHz, or null. */
export function glideslopeFrequencyFor(locMHz: number): number | null {
  const hit = ILS_CHANNEL_PAIRS.find(([l]) => Math.abs(l - locMHz) < 0.001)
  return hit ? hit[1] : null
}

// ---------------------------------------------------------------------------
// Site geometry
// ---------------------------------------------------------------------------

export type MarkerDistances = Record<MarkerKind, number>

// TODO(expert-review): marker positions. Outer 3.9 NM (typically 3.5–6 NM), middle 1,050 m,
// inner 300 m before the threshold.
export const MARKER_DISTANCE_NM: MarkerDistances = {
  outer: 3.9,
  middle: 1050 / METRES_PER_NM,
  inner: 300 / METRES_PER_NM,
}

// TODO(expert-review): marker coverage along the course at the glide-path height
// (outer 600 m, middle 300 m, inner 150 m). The beam is modelled as a cone opening upward.
export const MARKER_COVERAGE_M: Record<MarkerKind, number> = { outer: 600, middle: 300, inner: 150 }

export interface IlsSite {
  runway: Runway
  /** Runway elevation (threshold), ft above mean sea level. */
  elevationFt: number
  /** Final approach course, degrees true (the runway heading). */
  courseDeg: number
  threshold: Vec2
  /** Localizer antenna array beyond the stop end. */
  locAntenna: Vec2
  /** Where the glide path meets the runway surface (on the centreline). */
  gpip: Vec2
  /** Glideslope mast beside the runway. */
  gsAntenna: Vec2
  pathDeg: number
  tchFt: number
  /** Distance from the threshold to the glide path intercept point, ft. */
  gpipFt: number
  /** Localizer half course sector, degrees (DDM 0.155). */
  halfSectorDeg: number
  markers: Record<MarkerKind, Vec2>
  locMHz: number
  gsMHz: number
  ident: string
}

/** Point `d` NM along the course from `from` (negative d goes back toward the approach). */
function along(from: Vec2, courseDeg: number, d: number): Vec2 {
  const u = bearingVector(courseDeg)
  return { x: from.x + u.x * d, y: from.y + u.y * d }
}

/** Half course sector (degrees) for a localizer a given distance from the threshold. */
export function localizerHalfSectorDeg(locToThresholdNm: number, halfWidthM = LOC_HALF_WIDTH_AT_THRESHOLD_M): number {
  return toDeg(Math.atan(halfWidthM / (locToThresholdNm * METRES_PER_NM)))
}

/**
 * Build the ILS for a runway: localizer 1,000 ft past the stop end, glide
 * path meeting the runway TCH / tan(θ) past the threshold, glideslope mast
 * 1,000 ft past the threshold, 120 m to the LEFT of the centreline, markers
 * on the extended centreline.
 */
export function createIlsSite(
  runway: Runway,
  elevationFt: number,
  opts: { pathDeg?: number; tchFt?: number; locMHz?: number; ident?: string; locBeyondEndFt?: number } = {},
): IlsSite {
  const pathDeg = opts.pathDeg ?? DEFAULT_PATH_DEG
  const tchFt = opts.tchFt ?? DEFAULT_TCH_FT
  const course = runway.headingTrue
  const locBeyond = (opts.locBeyondEndFt ?? 1000) / FT_PER_NM
  const locAntenna = along(runway.end, course, locBeyond)
  const gpipFt = tchFt / Math.tan(toRad(pathDeg))
  const gpip = along(runway.threshold, course, gpipFt / FT_PER_NM)
  const mast = along(runway.threshold, course, 1000 / FT_PER_NM)
  const left = bearingVector(course - 90)
  const offsetNm = 120 / METRES_PER_NM
  const gsAntenna = { x: mast.x + left.x * offsetNm, y: mast.y + left.y * offsetNm }
  const locMHz = opts.locMHz ?? 110.3
  const locToThr = distanceNm(locAntenna, runway.threshold)
  return {
    runway,
    elevationFt,
    courseDeg: course,
    threshold: { ...runway.threshold },
    locAntenna,
    gpip,
    gsAntenna,
    pathDeg,
    tchFt,
    gpipFt,
    halfSectorDeg: localizerHalfSectorDeg(locToThr),
    markers: {
      outer: along(runway.threshold, course, -MARKER_DISTANCE_NM.outer),
      middle: along(runway.threshold, course, -MARKER_DISTANCE_NM.middle),
      inner: along(runway.threshold, course, -MARKER_DISTANCE_NM.inner),
    },
    locMHz,
    gsMHz: glideslopeFrequencyFor(locMHz) ?? NaN,
    ident: opts.ident ?? 'ICNS',
  }
}

/** Distance before the threshold along the approach, NM (negative once past it). */
export function distanceToThresholdNm(site: IlsSite, p: Vec2): number {
  return -alongTrackNm(p, site.threshold, site.courseDeg)
}

/** Sideways offset from the extended centreline, NM. Positive = RIGHT of it as seen by an approaching pilot. */
export function lateralOffsetNm(site: IlsSite, p: Vec2): number {
  return crossTrackNm(p, site.threshold, site.courseDeg)
}

/**
 * Angle of the aircraft seen from the localizer antenna, measured from the
 * extended centreline, degrees. Positive = RIGHT of the centreline for a
 * pilot on the approach. |angle| > 90 means behind the antenna (back course).
 */
export function localizerAzimuthDeg(site: IlsSite, p: Vec2): number {
  const u = -alongTrackNm(p, site.locAntenna, site.courseDeg)
  const r = crossTrackNm(p, site.locAntenna, site.courseDeg)
  if (Math.abs(u) < 1e-12 && Math.abs(r) < 1e-12) return 0
  return toDeg(Math.atan2(r, u))
}

export const localizerRangeNm = (site: IlsSite, p: Vec2) => distanceNm(site.locAntenna, p)

/** Elevation of the aircraft seen from the localizer antenna, degrees. */
export function localizerElevationDeg(site: IlsSite, p: Vec2, altitudeFt: number): number {
  const d = localizerRangeNm(site, p) * FT_PER_NM
  return toDeg(Math.atan2(altitudeFt - site.elevationFt, Math.max(d, 1)))
}

/**
 * Localizer DDM (true signal in space) at an azimuth angle (degrees,
 * positive right). Positive DDM = 90 Hz stronger = aircraft LEFT = fly right.
 * Linear inside the course sector (0.155 at the edge), linear up to 0.18,
 * then a smooth rise to a plateau, so it never falls below 0.18 outside.
 */
export function localizerDdm(azimuthDeg: number, halfSectorDeg: number): number {
  const a = Math.min(Math.abs(azimuthDeg), 90)
  const slope = LOC_FULL_SCALE_DDM / halfSectorDeg
  const a1 = LOC_CLEARANCE_DDM / slope
  let mag: number
  if (a <= a1) mag = slope * a
  else {
    const w = (LOC_PLATEAU_DDM - LOC_CLEARANCE_DDM) / slope
    mag = LOC_CLEARANCE_DDM + (LOC_PLATEAU_DDM - LOC_CLEARANCE_DDM) * (1 - Math.exp(-(a - a1) / w))
  }
  return azimuthDeg > 0 ? -mag : mag
}

/** Horizontal distance from the glide path intercept point, ft. */
export function distanceFromGpipFt(site: IlsSite, p: Vec2): number {
  return distanceNm(site.gpip, p) * FT_PER_NM
}

/**
 * Elevation angle of the aircraft above the glide path origin, degrees.
 * The glide path is the surface where this angle equals the path angle.
 */
export function glideslopeElevationDeg(site: IlsSite, p: Vec2, altitudeFt: number): number {
  return toDeg(Math.atan2(altitudeFt - site.elevationFt, Math.max(distanceFromGpipFt(site, p), 1)))
}

/** Angle of the aircraft from the centreline seen from the glide path origin, degrees (positive right). */
export function glideslopeAzimuthDeg(site: IlsSite, p: Vec2): number {
  const u = -alongTrackNm(p, site.gpip, site.courseDeg)
  const r = crossTrackNm(p, site.gpip, site.courseDeg)
  return toDeg(Math.atan2(r, u))
}

export const glideslopeRangeNm = (site: IlsSite, p: Vec2) => distanceNm(site.gsAntenna, p)

/**
 * Glideslope DDM (true signal in space) at an elevation angle. Positive = 90 Hz
 * stronger = ABOVE the path = fly down.
 */
export function glideslopeDdm(elevationDeg: number, pathDeg = DEFAULT_PATH_DEG): number {
  const x = elevationDeg / pathDeg
  if (x < 0.5) return -GS_MODEL_AMPLITUDE
  return -GS_MODEL_AMPLITUDE * Math.sin(Math.PI * x)
}

/** Elevation angles (degrees) of the glide paths in the model: the true one and the false ones above it. */
export function glidePathAngles(pathDeg = DEFAULT_PATH_DEG): { angleDeg: number; sensing: 'true' | 'reversed' | 'normal' }[] {
  return [
    { angleDeg: pathDeg, sensing: 'true' },
    { angleDeg: 2 * pathDeg, sensing: 'reversed' },
    { angleDeg: 3 * pathDeg, sensing: 'normal' },
  ]
}

/** Depth of modulation of each tone (fractions) for a DDM and the on-course depth of each tone. */
export function toneDepths(ddm: number, toneDepth: number): { m90: number; m150: number } {
  return { m90: toneDepth + ddm / 2, m150: toneDepth - ddm / 2 }
}

/** CDI lateral deviation from a localizer DDM (+1 = full right = fly right). */
export const cdiLateral = (locDdm: number) => locDdm / LOC_FULL_SCALE_DDM
/** CDI glideslope deviation from a glideslope DDM (+1 = full up = fly up). */
export const cdiVertical = (gsDdm: number) => -gsDdm / GS_FULL_SCALE_DDM

/** Height of the glide path above the runway at a distance before the threshold, ft. */
export function onPathHeightFt(site: IlsSite, distToThresholdNm: number): number {
  return (distToThresholdNm * FT_PER_NM + site.gpipFt) * Math.tan(toRad(site.pathDeg))
}

/** Localizer DDM equivalent of a course shift at the threshold (m, positive = course moved right). */
export function courseShiftDdm(shiftM: number): number {
  // A course moved right makes an aircraft on the old centreline appear left of it: 90 Hz stronger.
  return (shiftM / LOC_HALF_WIDTH_AT_THRESHOLD_M) * LOC_FULL_SCALE_DDM
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

// TODO(expert-review): coverage volumes. Localizer ±10° to 25 NM and ±35° to 17 NM, up to 7° elevation;
// glideslope ±8° in azimuth to 10 NM. The "fringe" beyond them (weak, unreliable signal) is a teaching model.
export const LOC_COVERAGE = { innerAzDeg: 10, innerRangeNm: 25, outerAzDeg: 35, outerRangeNm: 17, maxElevationDeg: 7 }
export const GS_COVERAGE = { azDeg: 8, rangeNm: 10 }

const ramp = (v: number) => clamp(v, 0, 1)

/**
 * How far outside the localizer coverage a point is: 0 inside, rising to 1
 * well outside (where the receiver shows its flag for sure).
 */
export function localizerCoverageSeverity(azimuthDeg: number, rangeNm: number, elevationDeg: number): number {
  const a = Math.abs(azimuthDeg)
  const c = LOC_COVERAGE
  const az = ramp((a - c.outerAzDeg) / 10)
  const rMax = a <= c.innerAzDeg ? c.innerRangeNm : c.outerRangeNm
  const r = ramp((rangeNm / rMax - 1) / 0.3)
  const el = ramp((elevationDeg - c.maxElevationDeg) / 3)
  return Math.max(az, r, el)
}

/** Glideslope coverage severity (0 inside, 1 well outside). */
export function glideslopeCoverageSeverity(azimuthDeg: number, rangeNm: number): number {
  const az = ramp((Math.abs(azimuthDeg) - GS_COVERAGE.azDeg) / 6)
  const r = ramp((rangeNm / GS_COVERAGE.rangeNm - 1) / 0.3)
  return Math.max(az, r)
}

/** Probability that the receiver shows its warning flag at a coverage severity. */
export function flagProbability(severity: number): number {
  const x = ramp((severity - 0.3) / 0.5)
  return x * x * (3 - 2 * x)
}

/** Standard deviation of the extra DDM noise from a weak signal at a coverage severity. */
export const coverageNoiseDdm = (severity: number) => 0.03 * ramp(severity)

// ---------------------------------------------------------------------------
// Critical area multipath and monitoring
// ---------------------------------------------------------------------------

// TODO(expert-review): teaching model of the course error caused by a vehicle in the localizer critical area:
// a steady course displacement that grows toward the runway plus "scalloping" bends further out.
/** Extra localizer DDM seen along the approach when a vehicle reflects the signal. */
export function vehicleMultipathDdm(distToThresholdNm: number): number {
  const d = Math.max(distToThresholdNm, -2)
  const bias = 0.045 * Math.exp(-Math.max(d, 0) / 3)
  const scallop = 0.03 * Math.sin((2 * Math.PI * d) / 0.9 + 0.7) + 0.008 * Math.sin((2 * Math.PI * d) / 0.45 + 2.1)
  return bias + scallop
}

// TODO(expert-review): localizer course-shift alarm limit for a CAT I facility (10.5 m at the threshold)
// and the time the monitor may take to switch off (CAT I 10 s, CAT II 5 s, CAT III 2 s).
export const LOC_SHIFT_ALARM_M = 10.5
export const MONITOR_DELAY_S = { I: 10, II: 5, III: 2 } as const

// ---------------------------------------------------------------------------
// Marker beacons
// ---------------------------------------------------------------------------

/** Half-angle of each marker's upward cone, chosen so the coverage matches at the glide-path height. */
export function markerHalfAngleDeg(site: IlsSite, kind: MarkerKind): number {
  const hM = onPathHeightFt(site, MARKER_DISTANCE_NM[kind]) * METRES_PER_FT
  return toDeg(Math.atan(MARKER_COVERAGE_M[kind] / 2 / hM))
}

/**
 * Is the aircraft inside a marker's beam? The beam points straight up and
 * widens with height; across the course it is twice as wide (a fan).
 */
export function insideMarker(site: IlsSite, kind: MarkerKind, p: Vec2, heightAboveGroundFt: number): boolean {
  if (heightAboveGroundFt <= 0) return false
  const m = site.markers[kind]
  const a = heightAboveGroundFt * METRES_PER_FT * Math.tan(toRad(markerHalfAngleDeg(site, kind)))
  const al = alongTrackNm(p, m, site.courseDeg) * METRES_PER_NM
  const cr = crossTrackNm(p, m, site.courseDeg) * METRES_PER_NM
  return (al / a) ** 2 + (cr / (2 * a)) ** 2 <= 1
}

/** The marker the aircraft is passing over, if any. */
export function activeMarker(site: IlsSite, p: Vec2, heightAboveGroundFt: number): MarkerKind | null {
  for (const k of ['outer', 'middle', 'inner'] as const) if (insideMarker(site, k, p, heightAboveGroundFt)) return k
  return null
}

// ---------------------------------------------------------------------------
// Categories and seeing the runway in fog
// ---------------------------------------------------------------------------

export type IlsCategory = 'I' | 'II' | 'IIIA' | 'IIIB'

export interface CategoryInfo {
  label: string
  /** Decision height, ft above the threshold, or null for none. */
  dhFt: number | null
  /** Lowest runway visual range allowed, m. */
  minRvrM: number
  /** RVR used for the fog in the simulator, m. */
  fogRvrM: number
}

// TODO(expert-review): category minima. CAT I DH ≥ 200 ft, RVR ≥ 550 m; CAT II DH 100 ft, RVR ≥ 300 m;
// CAT IIIA DH below 100 ft, RVR ≥ 175 m; CAT IIIB DH below 50 ft or none, RVR 50–175 m.
export const ILS_CATEGORIES: Record<IlsCategory, CategoryInfo> = {
  I: { label: 'CAT I', dhFt: 200, minRvrM: 550, fogRvrM: 550 },
  II: { label: 'CAT II', dhFt: 100, minRvrM: 300, fogRvrM: 300 },
  IIIA: { label: 'CAT IIIA', dhFt: 50, minRvrM: 175, fogRvrM: 200 },
  IIIB: { label: 'CAT IIIB', dhFt: null, minRvrM: 50, fogRvrM: 75 },
}

// TODO(expert-review): approach lighting length and cockpit cut-off angle used for the visual-reference model.
/** Length of the approach lights before the threshold, m. */
export const APPROACH_LIGHTS_M = 900
/** The pilot cannot see the ground closer than this angle below the horizon, degrees. */
export const COCKPIT_CUTOFF_DEG = 15

export interface VisualReference {
  approachLights: boolean
  runway: boolean
  /** Slant distance to the nearest visible light or runway point ahead, m (Infinity if none ahead). */
  nearestM: number
}

/**
 * What the pilot can see in uniform fog with visibility `visibilityM`:
 * the nearest approach light or runway point that is ahead and not hidden
 * under the nose, and whether it is within the visibility.
 */
export function visualReference(site: IlsSite, p: Vec2, heightAboveRunwayFt: number, visibilityM: number): VisualReference {
  const alongM = distanceToThresholdNm(site, p) * METRES_PER_NM
  const crossM = Math.abs(lateralOffsetNm(site, p)) * METRES_PER_NM
  const h = Math.max(0, heightAboveRunwayFt) * METRES_PER_FT
  // First ground point the pilot can see ahead (distance before the threshold, m).
  const firstVisible = alongM - h / Math.tan(toRad(COCKPIT_CUTOFF_DEG))
  const lengthM = site.runway.lengthFt * METRES_PER_FT
  const halfWidthM = (site.runway.widthFt * METRES_PER_FT) / 2
  const slant = (target: number, lateral: number) => Math.hypot(alongM - target, lateral, h)
  let lightsM = Infinity
  if (firstVisible >= 0) lightsM = slant(Math.min(APPROACH_LIGHTS_M, firstVisible), crossM)
  let runwayM = Infinity
  const rTarget = Math.min(0, firstVisible)
  if (rTarget >= -lengthM) runwayM = slant(rTarget, Math.max(0, crossM - halfWidthM))
  return { approachLights: lightsM <= visibilityM, runway: runwayM <= visibilityM, nearestM: Math.min(lightsM, runwayM) }
}

/** Nominal descent rate on the glide path at a ground speed, ft/min (positive number). */
export function glidePathDescentFpm(groundSpeedKt: number, pathDeg = DEFAULT_PATH_DEG): number {
  return ((groundSpeedKt * FT_PER_NM) / 60) * Math.tan(toRad(pathDeg))
}
