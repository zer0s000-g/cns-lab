/**
 * Scale of the ILS diorama (a runway close-up with the last few miles of the
 * approach), kept free of three.js so the page can build its honesty labels
 * without loading the 3D chunk.
 *
 * Engine positions are in NM (x east, y north) and heights in ft above the
 * runway. Scene: east = +x, north = -z, up = +y.
 */

import type { Vec2 } from '@/core/geometry'
import { METRES_PER_FT, METRES_PER_NM } from '@/core/units'

/** Scene units per metre, along the runway (east–west). */
export const SU = 1 / 500
/** Sideways (north–south) distances are stretched this much, like the top view. */
export const LAT_X = 3
/** Heights are stretched this much, like the side view. */
export const HEIGHT_X = 4
/** Aircraft and antennas are drawn this many times larger than life. */
export const MODEL_X = 6

/** The part of the airport and approach modelled on the table, m (x east, y north, from the airport reference point). */
export const BOUNDS_M = { minX: -11000, maxX: 2600, minY: -700, maxY: 700 }
export const TABLE_LENGTH_KM = (BOUNDS_M.maxX - BOUNDS_M.minX) / 1000

/** Engine point (NM) and height above the runway (ft) to scene units. */
export const toI = (p: Vec2, hFt = 0): [number, number, number] => [
  p.x * METRES_PER_NM * SU,
  hFt * METRES_PER_FT * SU * HEIGHT_X,
  -p.y * METRES_PER_NM * SU * LAT_X,
]

/** A true bearing as it looks on the sideways-stretched table, degrees. */
export function stretchedBearingDeg(bearingDeg: number): number {
  const r = (bearingDeg * Math.PI) / 180
  return (Math.atan2(Math.sin(r), Math.cos(r) * LAT_X) * 180) / Math.PI
}
