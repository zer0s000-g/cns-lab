/**
 * Curves (hyperbolas) and the signal front for one MLAT fix, in map units (NM).
 */

import { C_M_PER_US, hyperbolaSegments, timeDifferenceNs, type Bounds, type Segment } from '@/core/mlat'
import { METRES_PER_FT, METRES_PER_NM } from '@/core/units'
import type { MlatFix, ReceiverId } from './engine'

export interface CurveSet {
  seq: number
  pairs: { a: ReceiverId; b: ReceiverId; segs: Segment[]; biased: boolean; readyUs: number }[]
}

/** The curves of every receiver pair for one fix, from the MEASURED time differences. Segments in NM. */
export function curvesForFix(fix: MlatFix, bounds: Bounds, cols: number): CurveSet['pairs'] {
  const hM = fix.reportedAltFt * METRES_PER_FT
  const bm = { minX: bounds.minX * METRES_PER_NM, maxX: bounds.maxX * METRES_PER_NM, minY: bounds.minY * METRES_PER_NM, maxY: bounds.maxY * METRES_PER_NM }
  const out: CurveSet['pairs'] = []
  for (let i = 0; i < fix.stamps.length; i++)
    for (let j = i + 1; j < fix.stamps.length; j++) {
      const si = fix.stamps[i]
      const sj = fix.stamps[j]
      const segs = hyperbolaSegments(si.enu, sj.enu, timeDifferenceNs(si.stampUs, sj.stampUs), hM, bm, cols, cols).map(
        ([p, q]) => [{ x: p.x / METRES_PER_NM, y: p.y / METRES_PER_NM }, { x: q.x / METRES_PER_NM, y: q.y / METRES_PER_NM }] as Segment,
      )
      out.push({ a: si.id, b: sj.id, segs, biased: si.clockErrorNs !== 0 || sj.clockErrorNs !== 0, readyUs: Math.max(si.travelUs, sj.travelUs) })
    }
  return out
}

/** Where the signal front is at signal time tUs: horizontal radius on the ground, NM. */
export function wavefrontRadiusNm(fix: MlatFix, tUs: number): number {
  const meanRxZ = fix.stamps.length ? fix.stamps.reduce((s, x) => s + x.enu.z, 0) / fix.stamps.length : 0
  const h = fix.trueEnu.z - meanRxZ
  const r = C_M_PER_US * tUs
  return Math.sqrt(Math.max(0, r * r - h * h)) / METRES_PER_NM
}
