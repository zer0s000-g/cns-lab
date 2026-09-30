import { formatLength, NO_VALUE } from '@/lib/format'
import { METRES_PER_NM } from '@/core/units'

/** Metres for text: "3.1 m", "42 m", "1.2 km" (see formatLength). */
export function formatMetres(m: number, digits = 1): string {
  return formatLength(m, { digits })
}

/** Distance helper for text: metres below 1 NM, NM above. */
export function formatDistance(m: number): string {
  if (!Number.isFinite(m)) return NO_VALUE
  return m >= METRES_PER_NM ? `${(m / METRES_PER_NM).toFixed(1)} NM` : formatMetres(m, m < 10 ? 1 : 0)
}
