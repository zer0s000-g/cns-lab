import { METRES_PER_NM } from '@/core/units'

/** Metres for text: "3.1 m", "42 m", "1.2 km". */
export function formatMetres(m: number, digits = 1): string {
  const a = Math.abs(m)
  if (a >= 1000) return `${(m / 1000).toFixed(a >= 10_000 ? 0 : 1)} km`
  if (a >= 100) return `${Math.round(m)} m`
  if (a >= 10) return `${m.toFixed(0)} m`
  return `${m.toFixed(digits)} m`
}

/** Distance helper for text: metres below 1 NM, NM above. */
export function formatDistance(m: number): string {
  return m >= METRES_PER_NM ? `${(m / METRES_PER_NM).toFixed(1)} NM` : formatMetres(m, m < 10 ? 1 : 0)
}
