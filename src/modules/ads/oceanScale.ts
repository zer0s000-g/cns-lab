import type { Vec2 } from '@/core/geometry'
import { FT_PER_NM } from '@/core/units'

/**
 * Scale of the ocean-crossing diorama (ADS-C), kept free of three.js so the
 * page can build its honesty labels without loading the 3D chunk. The ocean
 * map (about 1,480 NM from coast to coast) is squeezed onto a strip about half
 * as wide as the 60 NM terrain table, so the whole crossing fits between the
 * console panels.
 */
export const OCEAN_X0 = 20
export const OCEAN_Y0 = 80
/** Scene units per NM across the ocean. */
export const OS = 11 / 1480
/** Scene units per ft of altitude: FL350 sits 0.8 units above the sea. */
export const OV = 0.8 / 35000
/** How much taller heights look than they would at the ocean table's scale. */
export const OCEAN_HEIGHT_EXAGGERATION = OV / (OS / FT_PER_NM)
/** Width of the ocean table, NM (for the label). */
export const OCEAN_TABLE_NM = 1480

/** Ocean map point (NM, x east / y north) and altitude (ft) to scene units (north = -z). */
export const toOcean = (p: Vec2, altFt = 0): [number, number, number] => [(p.x - OCEAN_X0) * OS, altFt * OV, -(p.y - OCEAN_Y0) * OS]
