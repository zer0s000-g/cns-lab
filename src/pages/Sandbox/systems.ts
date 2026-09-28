/**
 * The CNS systems placed on the Airspace Sandbox map. Positions are in the
 * shared world frame (NM from the airport, x east, y north).
 */

import type { Vec2 } from '@/core/geometry'
import { DEFAULT_RADAR, type RadarParams } from '@/core/radar'
import { terrainElevationFt } from '@/core/world'
import type { IlsGeometry } from '@/core/coverage'
import type { StationKind } from '@/components/sim/mapDraw'
import type { Pillar } from '@/modules/registry'

export type SystemId =
  | 'radarApp'
  | 'radarEnr'
  | 'adsb'
  | 'sbadsb'
  | 'mlat'
  | 'adsc'
  | 'gnss'
  | 'vordme'
  | 'ils'
  | 'vhf'
  | 'cpdlc'
  | 'satcom'
  | 'hf'

export interface SystemDef {
  id: SystemId
  name: string
  short: string
  pillar: Exclude<Pillar, 'integration'>
  moduleId: string
  /** Plain one-line description. */
  desc: string
  /** Coverage can be drawn on the map. */
  coverage: boolean
}

export const SYSTEMS: SystemDef[] = [
  { id: 'radarApp', name: 'Approach radar (PSR + SSR)', short: 'Approach radar', pillar: 'surveillance', moduleId: 'psr', desc: 'S-band primary radar with a secondary radar on top, at the airport. Turns every 4.8 s.', coverage: true },
  { id: 'radarEnr', name: 'En-route radar (PSR + SSR)', short: 'En-route radar', pillar: 'surveillance', moduleId: 'ssr', desc: 'Long-range L-band radar on the West Hills. Turns every 12 s.', coverage: true },
  { id: 'adsb', name: 'ADS-B ground stations', short: 'ADS-B', pillar: 'surveillance', moduleId: 'ads', desc: 'Receivers at the airport and on the coast listening to aircraft broadcasts.', coverage: true },
  { id: 'sbadsb', name: 'Space-based ADS-B', short: 'Space ADS-B', pillar: 'surveillance', moduleId: 'ads', desc: 'ADS-B receivers carried on satellites: hears aircraft over the ocean too.', coverage: false },
  { id: 'mlat', name: 'Wide area multilateration', short: 'WAM', pillar: 'surveillance', moduleId: 'mlat', desc: 'Five receivers around the terminal area timing every transponder signal.', coverage: true },
  { id: 'adsc', name: 'ADS-C (oceanic contracts)', short: 'ADS-C', pillar: 'surveillance', moduleId: 'ads', desc: 'Position reports sent by the aircraft to the oceanic centre every few minutes via satellite.', coverage: false },
  { id: 'gnss', name: 'GNSS', short: 'GNSS', pillar: 'navigation', moduleId: 'gnss', desc: 'Satellite navigation used by aircraft for position, and by ADS-B for what it broadcasts.', coverage: false },
  { id: 'vordme', name: 'VOR/DME', short: 'VOR/DME', pillar: 'navigation', moduleId: 'dvor', desc: 'Ground beacon giving direction (VOR) and distance (DME) near the airport.', coverage: true },
  { id: 'ils', name: 'ILS runway 09', short: 'ILS', pillar: 'navigation', moduleId: 'ils', desc: 'Localizer and glideslope beams guiding aircraft down to runway 09.', coverage: true },
  { id: 'vhf', name: 'VHF radio sites', short: 'VHF', pillar: 'communication', moduleId: 'vhf', desc: 'Voice radio from the airport and from a mountain-top site.', coverage: true },
  { id: 'cpdlc', name: 'CPDLC data link', short: 'CPDLC', pillar: 'communication', moduleId: 'cpdlc', desc: 'Text messages between controller and pilot, over VHF data link or satellite.', coverage: false },
  { id: 'satcom', name: 'SATCOM (geostationary)', short: 'SATCOM', pillar: 'communication', moduleId: 'satcom', desc: 'Voice and data through a geostationary satellite, far out over the ocean too.', coverage: false },
  { id: 'hf', name: 'HF radio', short: 'HF', pillar: 'communication', moduleId: 'hf', desc: 'Long-range radio bouncing off the ionosphere: reaches the ocean, but noisy.', coverage: false },
]

export const SYSTEM_BY_ID = new Map(SYSTEMS.map((s) => [s.id, s]))

export interface SiteDef {
  id: string
  system: SystemId
  pos: Vec2
  heightFt: number
  kind: StationKind
  label: string
}

// ---------------------------------------------------------------------------
// Ground sites (antenna height = terrain under the site + mast)
// ---------------------------------------------------------------------------

/** A ground site whose antenna sits `mastFt` above the terrain at `pos`. */
export function siteAt(pos: Vec2, mastFt: number) {
  return { pos, heightFt: terrainElevationFt(pos) + mastFt }
}

export const APPROACH_RADAR_SITE = siteAt({ x: 0.4, y: 0.6 }, 70)
export const ENROUTE_RADAR_SITE = siteAt({ x: -32, y: -14 }, 100)

/** Approach radar: S-band, 4.8 s. */
export const APPROACH_RADAR: RadarParams = { ...DEFAULT_RADAR }
/** En-route radar: L-band, bigger and more powerful, 12 s per turn. */
// TODO(expert-review): representative en-route PSR parameters (power, beam width, rotation).
export const ENROUTE_RADAR: RadarParams = { rotationPeriodS: 12, prfHz: 360, beamWidthDeg: 1.2, peakPowerKw: 600, pulseWidthUs: 2 }
/** Secondary radar maximum instrumented range, NM. */
export const SSR_RANGE_APP_NM = 120
export const SSR_RANGE_ENR_NM = 250

export const ADSB_SITES = [
  { id: 'adsb-1', ...siteAt({ x: 0.2, y: -0.8 }, 90), label: 'ADS-B' },
  { id: 'adsb-2', ...siteAt({ x: 38, y: 28 }, 150), label: 'ADS-B (coast)' },
]
export const ADSB_RANGE_NM = 250

export const MLAT_SITES = [
  { id: 'wam-1', ...siteAt({ x: 0, y: 3 }, 80) },
  { id: 'wam-2', ...siteAt({ x: 16, y: 14 }, 80) },
  { id: 'wam-3', ...siteAt({ x: -14, y: 12 }, 80) },
  { id: 'wam-4', ...siteAt({ x: -12, y: -16 }, 80) },
  { id: 'wam-5', ...siteAt({ x: 18, y: -13 }, 80) },
]
export const MLAT_RANGE_NM = 90

export const VORDME_SITE = siteAt({ x: 8, y: -5 }, 30)
/** VOR/DME usable range, NM (high-altitude service volume; line of sight also applies). */
// TODO(expert-review): VOR/DME service volumes (terminal / low / high) simplified to one radius.
export const VORDME_RANGE_NM = 130

export const VHF_SITES = [
  { id: 'vhf-1', ...siteAt({ x: -0.6, y: 0.9 }, 120), label: 'VHF (tower)' },
  { id: 'vhf-2', ...siteAt({ x: -22, y: 34 }, 60), label: 'VHF (mountain)' },
]
export const VHF_RANGE_NM = 200

/** Oceanic airspace begins east of this line (x, NM). */
export const OCEANIC_BOUNDARY_X = 100

/** Geostationary SATCOM satellite longitude (degrees East). */
// TODO(expert-review): example satellite longitude for the lab's fictional location.
export const GEO_SAT_LON = 143.5

/** ILS for runway 09 (threshold at x = -0.81 NM, far end at +0.81 NM). */
export const ILS09: IlsGeometry = {
  locAntenna: { x: 0.81 + 0.16, y: 0 },
  gsAntenna: { x: -0.81 + 0.16, y: 0.07 },
  courseDeg: 90,
  elevationFt: 30,
}

export const ALL_SITES: SiteDef[] = [
  { id: 'radar-app', system: 'radarApp', ...APPROACH_RADAR_SITE, kind: 'radar', label: 'Approach radar' },
  { id: 'radar-enr', system: 'radarEnr', ...ENROUTE_RADAR_SITE, kind: 'radar', label: 'En-route radar' },
  ...ADSB_SITES.map((s) => ({ ...s, system: 'adsb' as const, kind: 'antenna' as const })),
  ...MLAT_SITES.map((s, i) => ({ ...s, system: 'mlat' as const, kind: 'receiver' as const, label: i === 0 ? 'WAM receivers' : '' })),
  { id: 'vordme', system: 'vordme', ...VORDME_SITE, kind: 'vor', label: 'VOR/DME' },
  ...VHF_SITES.map((s) => ({ ...s, system: 'vhf' as const, kind: 'tower' as const })),
]
