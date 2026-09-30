import { formatLevel } from '@/core/cpdlc'

/** "3:07" for a timer. */
export { formatClock as mmss } from '@/lib/format'

/** Current level with the cleared level when climbing or descending: "FL353 ↑ FL370". */
export function levelText(level: number, cleared: number): string {
  const now = formatLevel(Math.round(level))
  if (Math.abs(level - cleared) < 0.05) return now
  return `${now} ${cleared > level ? '↑' : '↓'} ${formatLevel(cleared)}`
}
