import type { Vec2 } from '@/core/geometry'
import { FT_PER_NM } from '@/core/units'

/**
 * Diorama table scale, kept free of three.js so pages can build their honesty
 * labels without loading the 3D chunk. The table is 60 NM in radius.
 */
export const TABLE_RADIUS_NM = 60
export const TABLE_RADIUS_U = 10
export const S = TABLE_RADIUS_U / TABLE_RADIUS_NM // units per NM
export const V = 1 / 10000 // units per ft
/** How much taller things look than they would at true scale. */
export const HEIGHT_EXAGGERATION = V / (S / FT_PER_NM)
const TABLE_TOP = 0
export const FLOOR_Y = -1.35

/** Map point (NM, x east / y north) and altitude (ft) to scene units (north = -z). */
export const toU = (p: Vec2, altFt = 0): [number, number, number] => [p.x * S, TABLE_TOP + altFt * V, -p.y * S]

/** The radar tower miniature's scale, and its reflector centre height above the table. */
export const RADAR_SCALE = 0.82
export const ANTENNA_Y = (0.12 + 1.1 + 0.18 + 0.42) * RADAR_SCALE // deck + pedestal + reflector centre
