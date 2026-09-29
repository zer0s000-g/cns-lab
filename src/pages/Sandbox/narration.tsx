/**
 * The words of the journey: what is happening in each phase, in plain
 * language, and what the guided stops explain. Jargon links to the glossary.
 */

import type { ReactNode } from 'react'
import { Term } from '@/components/Term'
import { ktToMs } from '@/core/units'
import type { FlightPhase } from './journey'
import type { JourneyEventKind } from './phases'
import { ROTATE_KT, TAKEOFF_ACCEL } from './ground'

export interface PhaseStory {
  /** One-line summary for the timeline and the screen reader. */
  summary: string
  body: ReactNode
  /** Communication, navigation and surveillance at work, in a few words each. */
  c: string
  n: string
  s: string
}

export const STORY: Record<FlightPhase, PhaseStory> = {
  gate: {
    summary: 'Passengers board while the crew get their route clearance.',
    body: (
      <>
        Passengers walk out to the aircraft and climb the stairs. Before any engine starts, the crew call clearance delivery and
        read back their <Term id="atc-clearance">clearance</Term>: the route, the first altitude and the{' '}
        <Term id="squawk">squawk</Term> code the radar will see.
      </>
    ),
    c: 'VHF voice with Clearance delivery',
    n: 'GNSS gives the aircraft its position on the stand',
    s: 'Transponder on standby: not on the radar yet',
  },
  pushback: {
    summary: 'A tug pushes the aircraft back; its transponder comes on.',
    body: (
      <>
        A tug <Term id="pushback">pushes</Term> the aircraft backwards out of the stand while a wing walker checks the wing tips.
        Ground control approves it. The crew switch the <Term id="transponder">transponder</Term> on, so ADS-B and multilateration
        now see the aircraft on the airport surface.
      </>
    ),
    c: 'VHF voice with Ground',
    n: 'GNSS',
    s: 'Surface movement radar, multilateration and ADS-B',
  },
  taxi: {
    summary: 'Taxiing to runway 09, stopping at the red stop bar.',
    body: (
      <>
        CNS700 taxis along taxiway A to <Term id="holding-point">holding point</Term> A1. A red{' '}
        <Term id="stop-bar">stop bar</Term> keeps it off the runway until the tower clears it. Ground control watches every aircraft
        and vehicle on the <Term id="a-smgcs">surface movement</Term> display.
      </>
    ),
    c: 'VHF voice with Ground, then Tower',
    n: 'GNSS',
    s: 'Surface movement radar, multilateration and ADS-B',
  },
  takeoff: {
    summary: 'Cleared for take-off: full power, lift-off at 150 kt.',
    body: (
      <>
        Only the tower may clear an aircraft onto the runway. After “cleared for take-off” the engines go to full power, the
        aircraft lifts off at 150 kt and climbs. Passing 2,000 ft the tower <Term id="handover">hands it over</Term> to departure
        radar.
      </>
    ),
    c: 'VHF voice with Tower',
    n: 'GNSS and the runway heading',
    s: 'Approach radar (primary and secondary), ADS-B, multilateration',
  },
  departure: {
    summary: 'Departure radar identifies the flight and clears it to climb.',
    body: (
      <>
        The departure controller sees CNS700 on the radar screen and clears it to climb out of the busy{' '}
        <Term id="tma">terminal area</Term>. Several systems watch it at once and the tracker{' '}
        <Term id="data-fusion">merges</Term> them into one label.
      </>
    ),
    c: 'VHF voice with Departure',
    n: 'GNSS, with VOR/DME as a back-up',
    s: 'Approach and en-route radar, ADS-B, multilateration',
  },
  climb: {
    summary: 'Area control takes over and the flight climbs to FL350.',
    body: (
      <>
        Beyond 40 NM the flight belongs to area control, who look after the airways between airports with long-range radar.
        CNS700 climbs to <Term id="flight-level">flight level</Term> 350 (35,000 ft).
      </>
    ),
    c: 'VHF voice with Area control, CPDLC for text',
    n: 'GNSS, VOR/DME',
    s: 'En-route radar and ADS-B',
  },
  ocean: {
    summary: 'No radar, no VHF: position reports by satellite.',
    body: (
      <>
        Past the <Term id="oceanic-airspace">oceanic</Term> boundary the ground stations are out of reach. The aircraft reports
        its own position by satellite every 14 minutes (<Term id="ads-c">ADS-C</Term>) and messages go by{' '}
        <Term id="cpdlc">CPDLC</Term>. The controller’s picture is minutes old, so aircraft are kept much further apart:{' '}
        <Term id="procedural-separation">procedural separation</Term>.
      </>
    ),
    c: 'CPDLC over SATCOM, HF voice as a back-up',
    n: 'GNSS and inertial navigation',
    s: 'ADS-C reports by satellite only',
  },
  descent: {
    summary: 'Back in radar cover; area control clears the descent.',
    body: (
      <>
        Back within reach of the coast, area control picks CNS700 up on radar again and clears it down. The oceanic controller
        handed it over with a CPDLC “CONTACT” message.
      </>
    ),
    c: 'VHF voice with Area control',
    n: 'GNSS, VOR/DME',
    s: 'En-route radar and ADS-B',
  },
  approach: {
    summary: 'Approach radar lines CNS700 up for the ILS.',
    body: (
      <>
        Approach control uses radar to line up arrivals: descend, turn, slow down. The last turn crosses the runway’s extended
        centreline at 30°, and the crew are cleared for the <Term id="ils">ILS</Term> approach.
      </>
    ),
    c: 'VHF voice with Approach',
    n: 'GNSS and VOR/DME, then the ILS localizer',
    s: 'Approach radar, ADS-B, multilateration',
  },
  landing: {
    summary: 'The tower clears CNS700 to land; the ILS guides it down.',
    body: (
      <>
        At 8 NM the tower takes over and clears CNS700 to land. The <Term id="localizer">localizer</Term> keeps it on the
        centreline and the <Term id="glideslope">glideslope</Term> on a 3° slope. The <Term id="papi">PAPI</Term> lights show two
        white and two red when it is on the right path.
      </>
    ),
    c: 'VHF voice with Tower',
    n: 'ILS localizer and glideslope, PAPI lights',
    s: 'Approach radar, ADS-B, multilateration, then surface radar',
  },
  taxiIn: {
    summary: 'Leaving the runway at A3 and taxiing to stand S3.',
    body: (
      <>
        The aircraft leaves the runway at A3 and taxis to stand S3 on the <Term id="apron">apron</Term>. A{' '}
        <Term id="marshaller">marshaller</Term> with lit wands guides it onto the stand.
      </>
    ),
    c: 'VHF voice with Ground',
    n: 'GNSS',
    s: 'Surface movement radar, multilateration and ADS-B',
  },
  arrived: {
    summary: 'On blocks: engines off, passengers walk to the terminal.',
    body: (
      <>
        Engines off, transponder to standby: CNS700 leaves the controllers’ screens. The passengers walk back to the terminal. One
        flight, handed between seven controllers and many systems, is complete.
      </>
    ),
    c: 'Radio quiet',
    n: 'Parked',
    s: 'Surface movement radar only',
  },
}

const TAKEOFF_ROLL_S = Math.round(ktToMs(ROTATE_KT) / TAKEOFF_ACCEL)

export const STOP_STORY: Partial<Record<JourneyEventKind, { title: string; body: ReactNode }>> = {
  takeoffClearance: {
    title: 'Cleared for take-off',
    body: (
      <>
        The tower controller has checked that the runway is empty and that no aircraft is about to land. Only now may CNS700
        take off. Watch it accelerate: about {TAKEOFF_ROLL_S} seconds from standstill to 150 kt.
      </>
    ),
  },
  oceanEntry: {
    title: 'Leaving radar and VHF behind',
    body: (
      <>
        CNS700 has crossed into oceanic airspace. From here the controller knows where it is only from reports sent by satellite
        every 14 minutes, each arriving about 25 seconds late. On the map, the controller’s picture jumps forward with each
        report.
      </>
    ),
  },
  locCapture: {
    title: 'On the localizer',
    body: (
      <>
        The ILS localizer beam now steers CNS700 onto the runway centreline, even in cloud. Soon the glideslope beam starts
        guiding it down a 3° slope to the touchdown point.
      </>
    ),
  },
  touchdown: {
    title: 'Touchdown',
    body: (
      <>
        Wheels on the runway at about 140 kt. The crew brake to about 15 kt to leave the runway at A3, so it is free for the next
        aircraft.
      </>
    ),
  },
}
