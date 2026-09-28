import type { LinkState } from './engine'

export const STATE_TEXT: Record<LinkState, string> = {
  connected: 'Connected',
  handover: 'Switching satellites',
  blocked: 'Blocked by the aircraft’s body',
  'no-satellite': 'No satellite in view',
}

/** "2 h 05 min", "3 min 20 s", "4.2 s". */
export function formatDuration(s: number): string {
  if (!Number.isFinite(s)) return '—'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`
  if (m > 0) return `${m} min ${String(sec).padStart(2, '0')} s`
  return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`
}

/** Milliseconds with sensible precision. */
export const formatMs = (s: number) => {
  const ms = s * 1000
  return ms >= 100 ? `${Math.round(ms)} ms` : `${ms.toFixed(1)} ms`
}

export const fmtLat = (v: number) => `${Math.abs(v).toFixed(1)}°${v >= 0 ? 'N' : 'S'}`
export const fmtLon = (v: number) => `${Math.abs(v).toFixed(1)}°${v >= 0 ? 'E' : 'W'}`
