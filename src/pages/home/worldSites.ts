/**
 * What the home diorama shows and where, kept free of three.js so the home
 * page can render its text before the 3D chunk loads. Not to scale: sites are
 * spread out so each one can be seen, and the page says so.
 */
import type { Vec2 } from '@/core/geometry'
import type { Pillar } from '@/modules/registry'
import { ANTENNA_Y } from '@/stage/scale'

/** Home-page time runs this much faster than real time (labelled on the page). */
export const WORLD_TIME_SCALE = 20
/** The airport is drawn this much larger than life so the runway can be seen. */
export const AIRPORT_ZOOM = 10
/** The radar tower is shown smaller here than in the radar module, to sit with the other miniatures. */
export const HOME_RADAR_SCALE = 0.62
export const RUNWAY_HALF_NM = 0.81 * AIRPORT_ZOOM

export type WorldFilter = 'all' | Exclude<Pillar, 'integration'>

export interface WorldSite {
  id: string
  label: string
  desc: string
  /** Map point, NM (x east, y north). Not to scale: spread out to be seen. */
  pos: Vec2
  /** Label height above the site's ground, scene units. */
  labelY: number
  side?: 'left' | 'right'
}

export const WORLD_SITES: WorldSite[] = [
  { id: 'psr', label: 'Primary radar', desc: 'Bounces pulses off aircraft to find them, with no help from the aircraft.', pos: { x: -16, y: 20 }, labelY: ANTENNA_Y * HOME_RADAR_SCALE - 0.05, side: 'left' },
  { id: 'ssr', label: 'SSR / Mode S', desc: 'The bar on top of the radar asks each aircraft "who are you and how high?"', pos: { x: -16, y: 20 }, labelY: (ANTENNA_Y + 0.4) * HOME_RADAR_SCALE },
  { id: 'surface', label: 'Surface radar', desc: 'A fast, very sharp radar on the tower roof that sees everything on the ground.', pos: { x: 3, y: 3.2 }, labelY: 0.95 },
  { id: 'vhf', label: 'VHF radio', desc: 'Press to talk: the voice radio between pilots and controllers.', pos: { x: -3, y: 3.4 }, labelY: 1.15, side: 'left' },
  { id: 'cpdlc', label: 'CPDLC', desc: 'The control centre sends standard text messages to cockpits instead of speaking.', pos: { x: -20, y: -8 }, labelY: 0.55, side: 'left' },
  { id: 'ils', label: 'ILS', desc: 'Two radio beams at the runway guide aircraft left-right and up-down in fog.', pos: { x: RUNWAY_HALF_NM + 2.4, y: 0 }, labelY: 0.4 },
  { id: 'dvor', label: 'VOR', desc: 'Two signals ticking out of step tell an aircraft its direction from the station.', pos: { x: 24, y: -14 }, labelY: 0.5 },
  { id: 'dme', label: 'DME', desc: 'Answers the aircraft’s question so it can time the reply and work out its distance.', pos: { x: 24, y: -14 }, labelY: 0.95, side: 'left' },
  { id: 'ndb', label: 'NDB', desc: 'A simple beacon sending the same signal everywhere; the cockpit needle points at it.', pos: { x: -32, y: -12 }, labelY: 0.8 },
  { id: 'ads', label: 'ADS-B', desc: 'Listens to aircraft broadcasting their own satellite position twice a second.', pos: { x: 16, y: 20 }, labelY: 0.55 },
  { id: 'mlat', label: 'MLAT / WAM', desc: 'Receivers time the same signal; tiny differences pinpoint the aircraft.', pos: { x: 30, y: 8 }, labelY: 0.4 },
  { id: 'hf', label: 'HF radio', desc: 'Waves that bounce off the upper atmosphere to reach aircraft across oceans.', pos: { x: -24, y: -36 }, labelY: 0.95 },
  { id: 'satcom', label: 'SATCOM', desc: 'Aircraft over oceans and poles talk to ATC through communication satellites.', pos: { x: 12, y: -32 }, labelY: 0.55 },
  { id: 'sandbox', label: 'Airspace sandbox', desc: 'One flight, gate to gate: every system at work, and what happens when one fails.', pos: { x: -RUNWAY_HALF_NM, y: -3.5 }, labelY: 0.3, side: 'left' },
]

