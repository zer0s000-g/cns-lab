/**
 * Scale of the airport view (three.js-free, so labels and tests can use it):
 * true scale, 1 scene unit = 1 metre, on the airport surface frame
 * (x east, y north). Scene: east = +x, north = −z, up = +y.
 */

import type { Vec2 } from '@/core/geometry'
import { METRES_PER_FT } from '@/core/units'
import { LAB_AIRPORT } from '@/core/world'

/** Airport point (m) and height above the airport (m) to scene units. */
export const toJ = (p: Vec2, hM = 0): [number, number, number] => [p.x, hM, -p.y]

/** Height above the airport, m, for an altitude in ft (never below the ground). */
export const aglM = (altitudeFt: number) => Math.max(0, (altitudeFt - LAB_AIRPORT.elevationFt) * METRES_PER_FT)

/** The ground of the airport view extends this far from the airport, m. */
export const GROUND_RADIUS_M = 40000

/** Fog of the airport view: starts and ends, m. */
export const AIRPORT_FOG: [number, number] = [2500, 22000]
/** Fog of the terminal-area table (scene units), as on the other stages. */
export const TABLE_FOG: [number, number] = [26, 90]
