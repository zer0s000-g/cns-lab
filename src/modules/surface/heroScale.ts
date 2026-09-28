/**
 * Scale of the surface diorama (the airport miniature), kept free of three.js
 * so the page can build its honesty labels without loading the 3D chunk.
 *
 * The airport has its own scale (not the 60 NM table): 1 scene unit = 250 m.
 * Map metres: x east, y north. Scene: east = +x, north = -z, up = +y.
 */

import type { Vec2 } from '@/core/geometry'

/** Scene units per metre, horizontally. */
export const SU = 1 / 250
/** Heights (buildings, the tower, aircraft altitude) are stretched this much. */
export const HEIGHT_X = 3
/** Scene units per metre of height. */
export const VU = SU * HEIGHT_X
/** Aircraft and vehicles are drawn this many times larger than life so they can be seen. */
export const AIRCRAFT_X = 2
export const VEHICLE_X = 6
/** The tower and its radar are drawn this many times wider than life. */
export const TOWER_X = 4

/** The part of the airport modelled on the table, m. */
export const BOUNDS = { minX: -2300, maxX: 2500, minY: -800, maxY: 1000 }
export const TABLE_W_KM = (BOUNDS.maxX - BOUNDS.minX) / 1000
export const TABLE_H_KM = (BOUNDS.maxY - BOUNDS.minY) / 1000

/** Airport point (m) and height (m) to scene units. */
export const toA = (p: Vec2, hM = 0): [number, number, number] => [p.x * SU, hM * VU, -p.y * SU]
