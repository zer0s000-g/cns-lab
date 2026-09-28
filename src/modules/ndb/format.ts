import { TIME_OF_DAY_HOUR, type TimeOfDay } from './engine'

/** "5° East", "12° West", "0°". */
export function formatVariation(v: number) {
  if (Math.abs(v) < 0.05) return '0°'
  return `${Math.abs(v).toFixed(0)}° ${v > 0 ? 'East' : 'West'}`
}

/** The named time of day for an hour set by the controls (anything else counts as day). */
export function timeOfDayFromHour(h: number): TimeOfDay {
  const entry = (Object.entries(TIME_OF_DAY_HOUR) as [TimeOfDay, number][]).find(([, v]) => v === h)
  return entry ? entry[0] : 'day'
}
