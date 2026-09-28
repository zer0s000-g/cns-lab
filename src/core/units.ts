/**
 * Physical constants and unit conversions used by every simulation.
 *
 * Internal units across CNS Lab:
 *   horizontal distance  nautical miles (NM)
 *   height / altitude    feet (ft)
 *   speed                knots (kt = NM per hour)
 *   time                 seconds (s); microseconds (µs) for radio timing
 *   angles               degrees, true north, clockwise, unless a name says "mag"
 */

/** Speed of light in vacuum, m/s (exact by definition of the metre). */
export const SPEED_OF_LIGHT_MS = 299_792_458

/** One international nautical mile in metres (exact). */
export const METRES_PER_NM = 1852

/** One international foot in metres (exact). */
export const METRES_PER_FT = 0.3048

/** Feet in one nautical mile (≈ 6076.12). */
export const FT_PER_NM = METRES_PER_NM / METRES_PER_FT

/** Mean Earth radius, metres (IUGG mean radius). */
export const EARTH_RADIUS_M = 6_371_000

/** Mean Earth radius in nautical miles (≈ 3440.1). */
export const EARTH_RADIUS_NM = EARTH_RADIUS_M / METRES_PER_NM

/** Speed of light in NM per microsecond (≈ 0.16188). */
export const LIGHT_NM_PER_US = SPEED_OF_LIGHT_MS / METRES_PER_NM / 1e6

/** Round-trip time for a radio signal over one nautical mile, µs (≈ 12.36). */
export const ROUND_TRIP_US_PER_NM = 2 / LIGHT_NM_PER_US

export const nmToMetres = (nm: number) => nm * METRES_PER_NM
export const metresToNm = (m: number) => m / METRES_PER_NM
export const ftToMetres = (ft: number) => ft * METRES_PER_FT
export const metresToFt = (m: number) => m / METRES_PER_FT
export const nmToFt = (nm: number) => nm * FT_PER_NM
export const ftToNm = (ft: number) => ft / FT_PER_NM
export const nmToKm = (nm: number) => (nm * METRES_PER_NM) / 1000
export const kmToNm = (km: number) => (km * 1000) / METRES_PER_NM

/** Knots to nautical miles per second. */
export const ktToNmPerS = (kt: number) => kt / 3600
/** Knots to metres per second. */
export const ktToMs = (kt: number) => (kt * METRES_PER_NM) / 3600

/** Flight level (hundreds of feet, standard pressure) to feet. */
export const flightLevelToFt = (fl: number) => fl * 100
/** Feet to flight level, rounded to the nearest whole level as a display would. */
export const ftToFlightLevel = (ft: number) => Math.round(ft / 100)

/** Watts to dBW and back. */
export const wattsToDbw = (w: number) => 10 * Math.log10(w)
export const dbwToWatts = (dbw: number) => 10 ** (dbw / 10)

/** Radio wavelength in metres for a frequency in hertz. */
export const wavelengthM = (freqHz: number) => SPEED_OF_LIGHT_MS / freqHz

/** Clamp a number into [min, max]. */
export const clamp = (v: number, min: number, max: number) =>
  v < min ? min : v > max ? max : v

/** Linear interpolation. */
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
