/**
 * Shared number formatting for readouts and text. Two rules everywhere:
 * - A value that is not a number shows as "—", never "NaN" or "Infinity".
 * - Round first, then choose the unit, so a value near a boundary never shows as
 *   "1000 m", "60 s" or "360°": it moves up to the next unit instead.
 */

export const NO_VALUE = '—'

/** toFixed without a "-0" / "-0.0". */
export function fixed(v: number, digits: number): string {
  const s = v.toFixed(digits)
  return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s
}

/**
 * A length for text: "3.1 m", "42 m", "1.0 km", "12 km". `digits` is the precision below
 * 10 m; `tens` rounds 100–999 m to the nearest 10 m (for estimates).
 */
export function formatLength(m: number, { digits = 1, tens = false }: { digits?: number; tens?: boolean } = {}): string {
  if (!Number.isFinite(m)) return NO_VALUE
  const a = Math.abs(m)
  if (a >= 9950) return `${fixed(m / 1000, 0)} km`
  if (a >= (tens ? 995 : 999.5)) return `${fixed(m / 1000, 1)} km`
  if (tens && a >= 99.5) return `${fixed(Math.round(m / 10) * 10, 0)} m`
  if (a >= 10 - 0.5 * 10 ** -digits) return `${fixed(m, 0)} m`
  return `${fixed(m, digits)} m`
}

/** A duration for text: "4.2 s", "59 s", "1 min 00 s", "2 h 05 min". Negative counts as 0. */
export function formatDuration(s: number): string {
  if (!Number.isFinite(s)) return NO_VALUE
  const v = Math.max(0, s)
  if (v < 9.95) return `${fixed(v, 1)} s`
  const total = Math.round(v)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = total % 60
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`
  if (m > 0) return `${m} min ${String(sec).padStart(2, '0')} s`
  return `${sec} s`
}

/** A timer as m:ss ("4:07"), whole seconds rounded down. */
export function formatClock(s: number): string {
  if (!Number.isFinite(s)) return NO_VALUE
  const v = Math.max(0, Math.floor(s))
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`
}

/** A heading or bearing as three digits, 000–359 ("359.6" reads "000", never "360"). */
export function formatHeading(deg: number): string {
  if (!Number.isFinite(deg)) return NO_VALUE
  return String(Math.round(((deg % 360) + 360) % 360) % 360).padStart(3, '0')
}

/** Whole degrees 0–359 for a numeric readout or a dial value. */
export function wholeDegrees(deg: number): number {
  return Number.isFinite(deg) ? Math.round(((deg % 360) + 360) % 360) % 360 : 0
}
