import { formatLevel } from '@/core/cpdlc'

/** "3:07" for a timer. */
export function mmss(s: number): string {
  const v = Math.max(0, Math.floor(s))
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`
}

/** Current level with the cleared level when climbing or descending: "FL353 ↑ FL370". */
export function levelText(level: number, cleared: number): string {
  const now = formatLevel(Math.round(level))
  if (Math.abs(level - cleared) < 0.05) return now
  return `${now} ${cleared > level ? '↑' : '↓'} ${formatLevel(cleared)}`
}
