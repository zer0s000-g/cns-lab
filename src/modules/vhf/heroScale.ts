/**
 * Scale of the VHF hero: one slice of the Earth along the radio path, from
 * the radio site out to 270 NM. Kept free of three.js so the page can build
 * its honesty labels without loading the 3D chunk.
 *
 * The slice uses the same frame as the 2D side view (sideViewPoint: the 4/3
 * effective Earth via earthDropFt), then scales the two axes separately. That
 * map is affine, so straight radio rays stay straight and the tangent ray at
 * the radio horizon still just grazes the sea.
 */

import { sideViewPoint } from '@/core/vhf'
import { FT_PER_NM } from '@/core/units'

export const HERO_D_MIN = -12
export const HERO_D_MAX = 270
export const HERO_CENTER_NM = (HERO_D_MIN + HERO_D_MAX) / 2
export const HERO_TOP_FT = 44000
/** Scene length of the slice, units. */
export const HERO_LEN_U = 20
/** Units per NM along the path. */
export const KX = HERO_LEN_U / (HERO_D_MAX - HERO_D_MIN)
/** Heights (and the Earth's drop) are stretched this many times relative to distances. */
export const HERO_HEIGHT_X = 10
/** Units per ft. */
export const KY = (HERO_HEIGHT_X * KX) / FT_PER_NM
/** Half-width of the slice across the path, units (the physics is one line: z = 0). */
export const SLAB_HALF_W = 2

/** Scene point [x, y] for distance `d` NM from the radio site and height `h` ft above sea level. */
export function heroXY(d: number, h: number): [number, number] {
  const p = sideViewPoint(d, h, HERO_CENTER_NM)
  return [(p.x - HERO_CENTER_NM) * KX, p.y * KY]
}
