import type { HfQuality, NoSignalReason, Reception } from '@/core/hf'
import { nmToKm } from '@/core/units'

export const REASON_TEXT: Record<NoSignalReason, string> = {
  skip: 'skip zone: nothing arrives',
  absorbed: 'absorbed by the D layer',
  escapes: 'waves escape into space',
  gap: 'no ray comes down here',
}

export const QUALITY_TEXT: Record<HfQuality, string> = {
  clear: 'Clear',
  noisy: 'Noisy but readable',
  unreadable: 'Too weak to understand',
  none: 'Nothing heard',
}

/** "14:30" from a decimal hour. */
export function formatHour(hour: number): string {
  const h = ((hour % 24) + 24) % 24
  const total = Math.round(h * 60) % (24 * 60)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

export const kmText = (nm: number) => `${(Math.round(nmToKm(nm) / 10) * 10).toLocaleString('en-US')} km`

export const nmText = (nm: number) => `${Math.round(nm).toLocaleString('en-US')} NM`

/** "1 hop off the F2 layer", "direct wave", ... */
export function modeText(r: Reception): string {
  if (r.mode === 'direct') return 'direct wave (line of sight)'
  if (r.mode === 'ground') return 'ground wave'
  if (r.mode === 'sky') return `${r.hops} hop${r.hops > 1 ? 's' : ''} off the ${r.layer} layer`
  return REASON_TEXT[r.reason ?? 'gap']
}
