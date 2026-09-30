/**
 * Input guards for the simulation core.
 *
 * The rule (docs/MODULE_AUTHORING.md, "Wrong inputs"): a value that is not a number never
 * turns into a plausible answer. Functions the UI calls with measured or user-driven
 * values return their "no answer" result (null, no detection, blocked, alert) for NaN
 * or Infinity; a step size of zero or less, which would loop forever, is a programming
 * error and throws.
 */

/** A finite step size > 0, or a RangeError naming the parameter. */
export function positiveStep(value: number, name: string): number {
  if (!(value > 0) || !Number.isFinite(value)) throw new RangeError(`${name} must be a finite number > 0 (got ${value})`)
  return value
}

/** True for a finite number (not NaN, not ±Infinity). */
export const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
