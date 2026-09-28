/**
 * Scale of the HF hero: one slice of the round Earth along the path, from
 * the HF station out to 2,700 NM (about 5,000 km). Kept free of three.js so
 * the page can build its honesty labels without loading the 3D chunk.
 *
 * The slice uses the same exact circle geometry as the 2D side view
 * (hfSidePoint), then stretches heights with an affine map. An affine map
 * keeps straight rays straight, so every ray drawn in 3D is the engine's ray.
 */

import { hfSidePoint } from '@/core/hf'
import { EARTH_RADIUS_NM } from '@/core/units'
import { VIEW_MAX_NM } from './engine'

export const HERO_D_MIN = -70
export const HERO_D_MAX = VIEW_MAX_NM
export const HERO_CENTER_NM = (HERO_D_MIN + HERO_D_MAX) / 2
/** Half-length of the slice in scene units. */
export const HERO_HALF_U = 10
/** Units per NM along the ground (the chord of the arc fills the table). */
export const KX = HERO_HALF_U / (EARTH_RADIUS_NM * Math.sin((HERO_D_MAX - HERO_CENTER_NM) / EARTH_RADIUS_NM))
/** Heights and the Earth's curve are stretched this many times relative to distances. */
export const HERO_HEIGHT_X = 2.5
/** Units per NM of height. */
export const KY = HERO_HEIGHT_X * KX
/** Half-width of the slice across the path, units (the physics is one line: z = 0). */
export const SLAB_HALF_W = 2.2

/** Scene point [x, y] for ground distance `d` NM from the station and height `h` NM above the sea. */
export function heroXY(d: number, h: number): [number, number] {
  const p = hfSidePoint(d, h, HERO_CENTER_NM)
  return [p.x * KX, p.y * KY]
}
