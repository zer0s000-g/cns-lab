/**
 * Surveillance data fusion (multi-sensor tracking), simplified.
 *
 * Each aircraft track holds a constant-velocity Kalman filter per axis
 * (x east, y north; NM and NM/s). Measurements from radar, ADS-B, MLAT or
 * ADS-C update the track, weighted by their accuracy. When no data arrives the
 * track "coasts" on its predicted position and is finally dropped.
 */

export type SourceKind = 'psr' | 'ssr' | 'adsb' | 'mlat' | 'adsc'

export const SOURCE_LABEL: Record<SourceKind, string> = {
  psr: 'Primary radar',
  ssr: 'Secondary radar',
  adsb: 'ADS-B',
  mlat: 'MLAT / WAM',
  adsc: 'ADS-C',
}

/** A position measurement from one surveillance source. */
export interface Measurement {
  source: SourceKind
  /** Target the measurement belongs to (correlation is assumed solved). */
  targetId: string
  /** Time the position is valid for, s. */
  timeS: number
  x: number
  y: number
  /** One-sigma position error, NM. */
  sigmaNm: number
  altitudeFt?: number
  callsign?: string
  code?: string
}

interface Axis {
  p: number
  v: number
  /** Covariance [[pp, pv], [pv, vv]] */
  pp: number
  pv: number
  vv: number
}

export interface Track {
  id: string
  timeS: number
  ax: Axis
  ay: Axis
  altitudeFt?: number
  altitudeTimeS?: number
  callsign?: string
  code?: string
  /** Last time each source contributed. */
  lastBySource: Partial<Record<SourceKind, number>>
  lastUpdateS: number
  updates: number
}

/** Process noise: random acceleration spectral density, NM²/s³ (≈ manoeuvres of ~1 m/s²). */
// TODO(expert-review): tracker tuning is illustrative, not an operational tracker.
export const PROCESS_NOISE = 4e-7

function newAxis(p: number, sigma: number): Axis {
  return { p, v: 0, pp: sigma * sigma, pv: 0, vv: 0.08 ** 2 }
}

function predictAxis(a: Axis, dt: number, q = PROCESS_NOISE): Axis {
  if (dt <= 0) return a
  // x' = F x, P' = F P Fᵀ + Q  (F = [[1, dt], [0, 1]], white-acceleration Q)
  const pp = a.pp + 2 * dt * a.pv + dt * dt * a.vv + (q * dt ** 3) / 3
  const pv = a.pv + dt * a.vv + (q * dt ** 2) / 2
  const vv = a.vv + q * dt
  return { p: a.p + a.v * dt, v: a.v, pp, pv, vv }
}

function updateAxis(a: Axis, z: number, r: number): Axis {
  // A measurement that is not a number is ignored: one NaN would poison the track for good.
  if (!Number.isFinite(z) || !Number.isFinite(r)) return a
  const s = a.pp + r
  // No uncertainty on either side (sigma 0): take the measurement as it is.
  if (!(s > 0)) return { ...a, p: z }
  const kp = a.pp / s
  const kv = a.pv / s
  const y = z - a.p
  return {
    p: a.p + kp * y,
    v: a.v + kv * y,
    pp: (1 - kp) * a.pp,
    pv: (1 - kp) * a.pv,
    vv: a.vv - kv * a.pv,
  }
}

export function createTrack(m: Measurement): Track {
  return {
    id: m.targetId,
    timeS: m.timeS,
    ax: newAxis(m.x, m.sigmaNm),
    ay: newAxis(m.y, m.sigmaNm),
    altitudeFt: m.altitudeFt,
    altitudeTimeS: m.altitudeFt !== undefined ? m.timeS : undefined,
    callsign: m.callsign,
    code: m.code,
    lastBySource: { [m.source]: m.timeS },
    lastUpdateS: m.timeS,
    updates: 1,
  }
}

/** Predict a track to time t (no measurement). */
export function predictTrack(t: Track, timeS: number): Track {
  const dt = timeS - t.timeS
  if (dt <= 0) return t
  return { ...t, timeS, ax: predictAxis(t.ax, dt), ay: predictAxis(t.ay, dt) }
}

/**
 * Update a track with a measurement. Measurements older than the track time
 * (e.g. a delayed ADS-C report) only refresh identity/altitude and the source
 * list; they do not pull the position backwards.
 */
export function updateTrack(t: Track, m: Measurement): Track {
  const base: Track = {
    ...t,
    altitudeFt: m.altitudeFt ?? t.altitudeFt,
    altitudeTimeS: m.altitudeFt !== undefined ? m.timeS : t.altitudeTimeS,
    callsign: m.callsign ?? t.callsign,
    code: m.code ?? t.code,
    lastBySource: { ...t.lastBySource, [m.source]: Math.max(t.lastBySource[m.source] ?? -Infinity, m.timeS) },
  }
  if (m.timeS < t.timeS - 1e-9) return base
  const p = predictTrack(base, m.timeS)
  const r = m.sigmaNm * m.sigmaNm
  return {
    ...p,
    ax: updateAxis(p.ax, m.x, r),
    ay: updateAxis(p.ay, m.y, r),
    lastUpdateS: m.timeS,
    updates: t.updates + 1,
  }
}

export const trackPosition = (t: Track) => ({ x: t.ax.p, y: t.ay.p })
export const trackVelocity = (t: Track) => ({ x: t.ax.v, y: t.ay.v })
/** Ground speed of a track, kt. */
export const trackSpeedKt = (t: Track) => Math.hypot(t.ax.v, t.ay.v) * 3600
/** One-sigma horizontal position uncertainty, NM. */
export const trackSigmaNm = (t: Track) => Math.sqrt((t.ax.pp + t.ay.pp) / 2)

/** Sources that contributed within `windowS` seconds before `nowS`. */
export function activeSources(t: Track, nowS: number, windowS: Partial<Record<SourceKind, number>> = DEFAULT_SOURCE_WINDOW): SourceKind[] {
  return (Object.keys(t.lastBySource) as SourceKind[]).filter((s) => nowS - (t.lastBySource[s] ?? -Infinity) <= (windowS[s] ?? 15))
}

/** How long each source may be silent before it no longer counts as "contributing", s. */
export const DEFAULT_SOURCE_WINDOW: Record<SourceKind, number> = {
  psr: 15,
  ssr: 15,
  adsb: 5,
  mlat: 5,
  adsc: 20 * 60,
}

export type TrackStatus = 'live' | 'coast' | 'drop'

/**
 * Track status: live while any source contributes, coasting on prediction for a
 * while after the last update, dropped after `dropS`. Tracks kept alive only by
 * ADS-C (oceanic, procedural) use the long ADS-C window.
 */
export function trackStatus(t: Track, nowS: number, opts: { coastS?: number; dropS?: number } = {}): TrackStatus {
  const sources = activeSources(t, nowS)
  if (sources.length > 0) return 'live'
  const silent = nowS - t.lastUpdateS
  if (silent <= (opts.dropS ?? 60)) return 'coast'
  return 'drop'
}
