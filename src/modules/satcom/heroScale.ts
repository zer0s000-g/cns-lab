/**
 * Scale of the SATCOM hero, kept free of three.js so the page can build its
 * honesty labels and camera shots without loading the 3D chunk.
 */

import { GEO_RADIUS_M, LEO_RADIUS_M } from '@/core/satcom'
import { EARTH_RADIUS_M } from '@/core/units'

/** One Earth radius in scene units. Orbits keep their true radius in Earth radii. */
export const R_U = 1.25
/** Radius of the geostationary ring in scene units (true scale: about 6.6 Earth radii). */
export const GEO_U = (GEO_RADIUS_M / EARTH_RADIUS_M) * R_U
/** Radius of the low orbit in scene units (true scale). */
export const LEO_U = (LEO_RADIUS_M / EARTH_RADIUS_M) * R_U
/** Floor of the studio under the globe stand. */
export const STAND_FLOOR_Y = -4.2
