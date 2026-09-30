/**
 * The accuracy map: expected MLAT error over the whole map, computed from the
 * same geometry (DOP) and the same solver the live fixes use, so the map and
 * the fixes always agree.
 */

import { formatLength } from '@/lib/format'
import type { Bounds } from '@/core/mlat'
import { arrivalTimeUs, expectedErrorM, mlatDop, solveTdoa, worldToEnuM } from '@/core/mlat'
import type { Vec3 } from '@/core/geometry'

/** Error thresholds (m) that separate the bands of the accuracy map. */
export const BANDS_M = [10, 30, 100, 300, 1000] as const

/** Band index 0 (better than 10 m) … 5 (worse than 1 km); -1 = no position. */
export function bandOf(errorM: number): number {
  if (!Number.isFinite(errorM)) return -1
  let b = 0
  while (b < BANDS_M.length && errorM >= BANDS_M[b]) b++
  return b
}

export function bandLabel(b: number): string {
  if (b < 0) return 'no position'
  if (b === 0) return `better than ${BANDS_M[0]} m`
  if (b === BANDS_M.length) return `worse than ${formatM(BANDS_M[BANDS_M.length - 1])}`
  return `${formatM(BANDS_M[b - 1])} to ${formatM(BANDS_M[b])}`
}

export function formatM(m: number): string {
  return formatLength(m, { tens: true })
}

/** Centre of grid cell (i, j), NM. Row 0 is the SOUTH edge. */
export function cellCentre(b: Bounds, cols: number, rows: number, i: number, j: number) {
  return { x: b.minX + ((i + 0.5) / cols) * (b.maxX - b.minX), y: b.minY + ((j + 0.5) / rows) * (b.maxY - b.minY) }
}

/**
 * Expected horizontal RMS error (m) at each cell centre (NaN where no position
 * can be computed). Bounds in NM, height in ft.
 */
export function accuracyGrid(rx: Vec3[], heightFt: number, useAltitude: boolean, timingNoiseNs: number, b: Bounds, cols: number, rows: number): Float32Array {
  const out = new Float32Array(cols * rows)
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const dop = mlatDop(rx, worldToEnuM(cellCentre(b, cols, rows, i, j), heightFt), useAltitude)
      out[j * cols + i] = dop ? expectedErrorM(dop.hdop, timingNoiseNs) : NaN
    }
  return out
}

/**
 * Ambiguity only needs checking with the minimum number of receivers (the
 * curves can cross twice) or when the receivers are in a line (mirror image).
 */
export function needsAmbiguityCheck(nReceivers: number, useAltitude: boolean, collinear: boolean): boolean {
  const unknowns = useAltitude ? 2 : 3
  if (nReceivers - 1 < unknowns) return false
  return nReceivers - 1 === unknowns || collinear
}

/** Does the solver find two positions for an aircraft at this point? (noiseless times) */
export function ambiguousAt(rx: Vec3[], p: Vec3, useAltitude: boolean, noiseM: number): boolean {
  const t = rx.map((r) => arrivalTimeUs(p, r, 500))
  return solveTdoa(rx, t, { heightM: useAltitude ? p.z : null, noiseM, quick: true }).status === 'ambiguous'
}

/** One row of the ambiguity grid (1 = two positions fit). Split by rows so the page stays responsive. */
export function ambiguityRow(rx: Vec3[], heightFt: number, useAltitude: boolean, noiseM: number, b: Bounds, cols: number, rows: number, j: number): Uint8Array {
  const out = new Uint8Array(cols)
  for (let i = 0; i < cols; i++) out[i] = ambiguousAt(rx, worldToEnuM(cellCentre(b, cols, rows, i, j), heightFt), useAltitude, noiseM) ? 1 : 0
  return out
}
