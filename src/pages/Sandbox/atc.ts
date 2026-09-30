/**
 * Who talks to CNS700, and how. The flight is handed from one air traffic
 * control unit to the next as it moves; each unit owns a piece of airspace
 * (or of the airport surface) and has its own frequency. The radio script
 * follows ICAO phraseology (Doc 4444 and Doc 9432) in simplified form.
 *
 * The airport is fictional, and so are its frequencies (they lie in the real
 * aeronautical bands).
 */

import type { Availability } from './engine'
import type { JourneyEventKind } from './phases'
import type { FlightPhase } from './journey'

export type AtcUnit = 'delivery' | 'ground' | 'tower' | 'departure' | 'area' | 'oceanic' | 'approach'

export interface UnitInfo {
  name: string
  /** One word, for tight spaces. */
  short: string
  /** Radio callsign of the unit. */
  callsign: string
  /** VHF frequency, MHz (as written, e.g. "121.900"), or null for the oceanic unit. */
  vhfMHz: string | null
  /** HF frequency, kHz (oceanic only). */
  hfKHz?: number
  /** What this controller is responsible for, in plain words. */
  role: string
}

// TODO(expert-review): frequencies are made up for the fictional airport; check they follow 25 kHz channelling in the band.
export const UNITS: Record<AtcUnit, UnitInfo> = {
  delivery: { short: 'Delivery', name: 'Clearance delivery', callsign: 'CNS Lab Delivery', vhfMHz: '121.650', role: 'Reads the route clearance to the crew before engine start.' },
  ground: { short: 'Ground', name: 'Ground', callsign: 'CNS Lab Ground', vhfMHz: '121.900', role: 'Moves aircraft and vehicles on the apron and taxiways, but never onto the runway.' },
  tower: { short: 'Tower', name: 'Tower', callsign: 'CNS Lab Tower', vhfMHz: '118.100', role: 'Owns the runway: only the tower clears an aircraft to line up, take off or land.' },
  departure: { short: 'Departure', name: 'Departure', callsign: 'CNS Lab Departure', vhfMHz: '119.750', role: 'Radar controller who guides departing aircraft up and out of the terminal area.' },
  area: { short: 'Area', name: 'Area control', callsign: 'CNS Lab Control', vhfMHz: '125.300', role: 'Radar controller for the airways between terminal areas, at high level.' },
  oceanic: {
    short: 'Oceanic',
    name: 'Oceanic control',
    callsign: 'CNS Lab Oceanic',
    vhfMHz: null,
    hfKHz: 8864,
    role: 'Beyond radar and VHF range: keeps aircraft apart using position reports sent by satellite (procedural control).',
  },
  approach: { short: 'Approach', name: 'Approach', callsign: 'CNS Lab Approach', vhfMHz: '119.100', role: 'Radar controller who lines arriving aircraft up for the runway.' },
}

/** The unit in charge during each phase of the flight. */
export const PHASE_UNIT: Record<FlightPhase, AtcUnit> = {
  gate: 'delivery',
  pushback: 'ground',
  taxi: 'ground',
  takeoff: 'tower',
  departure: 'departure',
  climb: 'area',
  ocean: 'oceanic',
  descent: 'area',
  approach: 'approach',
  landing: 'tower',
  taxiIn: 'ground',
  arrived: 'ground',
}

// TODO(expert-review): control changes here at each flight-phase boundary, while the scripted
// radio hands over up to about 20 s earlier or later (e.g. the push-back request goes to Ground
// while the card still shows Delivery). Should "Controlled by" follow the transfer instruction,
// the check-in with the next unit, or the phase? Left phase-based until an ATC expert decides.
export const controllingUnit = (p: FlightPhase): AtcUnit => PHASE_UNIT[p]

/** A frequency as spoken on the radio: trailing zeros dropped ("121.900" → "121.9"). */
export function spokenFreq(unit: AtcUnit): string {
  const u = UNITS[unit]
  if (!u.vhfMHz) return `HF ${u.hfKHz}`
  return u.vhfMHz.replace(/0+$/, '').replace(/\.$/, '')
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

export type Medium = 'vhf' | 'cpdlcVdl' | 'cpdlcSat' | 'hf' | 'none'

export const MEDIUM_LABEL: Record<Medium, string> = {
  vhf: 'VHF voice',
  cpdlcVdl: 'CPDLC · VHF data link',
  cpdlcSat: 'CPDLC · SATCOM',
  hf: 'HF voice',
  none: 'No link',
}

/** How a scripted line would like to travel. */
export type Channel = 'voice' | 'datalink' | 'hf' | 'note'

export type Delivery = { medium: Medium; status: 'sent' | 'fallback' | 'blocked' }

/** Units that may send instructions by CPDLC when voice fails (not the airport units). */
const DATALINK_CAPABLE: readonly AtcUnit[] = ['departure', 'area', 'approach', 'oceanic']

/**
 * The link a message actually uses, given what works right now. When the
 * preferred link is down the message falls back (voice → CPDLC, CPDLC → HF)
 * or cannot be sent at all.
 */
export function commMedium(channel: Channel, unit: AtcUnit, av: Pick<Availability, 'vhf' | 'cpdlc' | 'satcom' | 'hf'>): Delivery {
  const datalink = (): Medium => (av.vhf ? 'cpdlcVdl' : 'cpdlcSat')
  switch (channel) {
    case 'note':
      return { medium: 'none', status: 'sent' }
    case 'voice':
      if (av.vhf) return { medium: 'vhf', status: 'sent' }
      if (DATALINK_CAPABLE.includes(unit) && av.cpdlc) return { medium: datalink(), status: 'fallback' }
      return { medium: 'none', status: 'blocked' }
    case 'datalink':
      if (av.cpdlc) return { medium: unit === 'oceanic' ? 'cpdlcSat' : datalink(), status: 'sent' }
      if (av.hf) return { medium: 'hf', status: 'fallback' }
      return { medium: 'none', status: 'blocked' }
    case 'hf':
      if (av.hf) return { medium: 'hf', status: 'sent' }
      if (av.cpdlc) return { medium: 'cpdlcSat', status: 'fallback' }
      return { medium: 'none', status: 'blocked' }
  }
}

// ---------------------------------------------------------------------------
// The radio script
// ---------------------------------------------------------------------------

export interface ScriptLine {
  /** Seconds after the event. */
  delayS: number
  unit: AtcUnit
  from: 'atc' | 'pilot' | 'note'
  channel: Channel
  text: string
}

const c = 'CNS700'
const atc = (unit: AtcUnit, text: string, delayS = 0, channel: Channel = 'voice'): ScriptLine => ({ delayS, unit, from: 'atc', channel, text })
const pilot = (unit: AtcUnit, text: string, delayS = 0, channel: Channel = 'voice'): ScriptLine => ({ delayS, unit, from: 'pilot', channel, text })
const note = (unit: AtcUnit, text: string, delayS = 0): ScriptLine => ({ delayS, unit, from: 'note', channel: 'note', text })

// TODO(expert-review): radiotelephony phrases follow ICAO Doc 9432 examples in simplified form.
export const RADIO_SCRIPT: Partial<Record<JourneyEventKind, ScriptLine[]>> = {
  clearance: [
    pilot('delivery', `CNS Lab Delivery, ${c}, stand S3, request clearance.`),
    atc('delivery', `${c}, cleared to XCNS, flight planned route, climb 10,000 feet, squawk 4521.`, 4),
    pilot('delivery', `Cleared to XCNS, flight planned route, climb 10,000 feet, squawk 4521, ${c}.`, 9),
  ],
  requestPush: [
    atc('delivery', `${c}, when ready, contact Ground ${spokenFreq('ground')}.`),
    pilot('ground', `CNS Lab Ground, ${c}, stand S3, request push-back and start-up.`, 8),
  ],
  pushback: [
    atc('ground', `${c}, push-back and start-up approved, facing west.`),
    pilot('ground', `Push-back and start-up approved, facing west, ${c}.`, 3),
    note('ground', 'Transponder on: ADS-B and multilateration now see the aircraft on the ground.', 4),
  ],
  taxi: [
    pilot('ground', `${c}, request taxi.`),
    atc('ground', `${c}, taxi to holding point A1, runway 09, via A.`, 3),
    pilot('ground', `Taxi to holding point A1, runway 09, via A, ${c}.`, 7),
  ],
  holdShort: [
    atc('ground', `${c}, contact Tower ${spokenFreq('tower')}.`),
    pilot('tower', `CNS Lab Tower, ${c}, holding point A1, ready for departure.`, 5),
  ],
  lineUp: [atc('tower', `${c}, runway 09, line up and wait.`), pilot('tower', `Lining up and waiting, runway 09, ${c}.`, 3)],
  takeoffClearance: [atc('tower', `${c}, wind calm, runway 09, cleared for take-off.`), pilot('tower', `Cleared for take-off, runway 09, ${c}.`, 3)],
  liftoff: [note('tower', 'Lift-off at 150 kt. Gear up.')],
  toDeparture: [
    atc('tower', `${c}, contact Departure ${spokenFreq('departure')}.`),
    pilot('departure', `CNS Lab Departure, ${c}, passing 2,000 feet, climbing 10,000 feet.`, 5),
    atc('departure', `${c}, identified. Climb flight level 240.`, 9),
    pilot('departure', `Climb flight level 240, ${c}.`, 12),
  ],
  toArea: [
    atc('departure', `${c}, contact CNS Lab Control ${spokenFreq('area')}.`),
    pilot('area', `CNS Lab Control, ${c}, climbing flight level 240.`, 6),
    atc('area', `${c}, identified. Climb flight level 350.`, 10),
    pilot('area', `Climb flight level 350, ${c}.`, 13),
  ],
  oceanEntry: [
    atc('area', `${c}, radar service terminated. Contact CNS Lab Oceanic by CPDLC, HF ${UNITS.oceanic.hfKHz} as backup.`),
    pilot('area', `Radar service terminated, CNS Lab Oceanic by CPDLC, ${c}.`, 5),
    note('oceanic', 'ADS-C contract set up: the aircraft now reports its position by satellite every 14 minutes.', 20),
    atc('oceanic', 'MAINTAIN FL350', 40, 'datalink'),
    pilot('oceanic', 'WILCO', 55, 'datalink'),
  ],
  oceanTurn: [atc('oceanic', `${c}, CNS Lab Oceanic, SELCAL check.`, 0, 'hf'), pilot('oceanic', `SELCAL okay, ${c}.`, 6, 'hf')],
  descentStart: [atc('oceanic', 'DESCEND TO FL280', 0, 'datalink'), pilot('oceanic', 'WILCO', 20, 'datalink')],
  oceanExit: [
    atc('oceanic', `CONTACT CNS LAB CONTROL ${UNITS.area.vhfMHz}`, 0, 'datalink'),
    pilot('oceanic', 'WILCO', 15, 'datalink'),
    pilot('area', `CNS Lab Control, ${c}, with you, descending.`, 30),
    atc('area', `${c}, identified. Descend flight level 120.`, 36),
    pilot('area', `Descend flight level 120, ${c}.`, 40),
  ],
  toApproach: [
    atc('area', `${c}, contact Approach ${spokenFreq('approach')}.`),
    pilot('approach', `CNS Lab Approach, ${c}, descending.`, 6),
    atc('approach', `${c}, identified. Descend 4,000 feet, expect ILS approach runway 09.`, 10),
    pilot('approach', `Descend 4,000 feet, expect ILS runway 09, ${c}.`, 14),
  ],
  interceptClearance: [
    atc('approach', `${c}, turn right heading 060, cleared ILS approach runway 09, report established.`),
    pilot('approach', `Right heading 060, cleared ILS runway 09, wilco, ${c}.`, 4),
  ],
  locCapture: [pilot('approach', `${c}, established on the localizer, runway 09.`)],
  gsCapture: [note('approach', 'Glide path captured: the aircraft now descends along the 3° beam.')],
  toTower: [
    atc('approach', `${c}, contact Tower ${spokenFreq('tower')}.`),
    pilot('tower', `CNS Lab Tower, ${c}, ILS runway 09, 8 miles.`, 5),
    atc('tower', `${c}, runway 09, wind calm, cleared to land.`, 9),
    pilot('tower', `Cleared to land, runway 09, ${c}.`, 12),
  ],
  touchdown: [note('tower', 'Touchdown. Reverse thrust and brakes.')],
  vacated: [
    atc('tower', `${c}, contact Ground ${spokenFreq('ground')}.`),
    pilot('ground', `CNS Lab Ground, ${c}, runway 09 vacated via A3.`, 4),
    atc('ground', `${c}, taxi to stand S3 via A.`, 7),
    pilot('ground', `Taxi to stand S3 via A, ${c}.`, 10),
  ],
  onBlocks: [note('ground', 'On blocks at stand S3. Engines off, transponder to standby.')],
  complete: [note('ground', 'All passengers are off. The flight is complete.')],
}

/** The oceanic unit only talks by CPDLC or HF. */
export const OCEANIC_CHANNELS: readonly Channel[] = ['datalink', 'hf', 'note']
