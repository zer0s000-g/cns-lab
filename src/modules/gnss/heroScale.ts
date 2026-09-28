/**
 * Scale of the GNSS hero, kept free of three.js so the page can build its
 * honesty labels without loading the 3D chunk.
 */

/** One Earth radius (6,378 km) in scene units. The Earth and the orbits are to scale with each other. */
export const R_U = 1.5
/** Radius of the sky dome drawn over the receiver, scene units (a drawing aid, not a distance). */
export const SKY_DOME_U = 0.85
/** Floor of the studio under the desk-globe stand. */
export const STAND_FLOOR_Y = -7.4
/** Earth radius used for the scale label, km. */
export const EARTH_RADIUS_KM_LABEL = 6378
