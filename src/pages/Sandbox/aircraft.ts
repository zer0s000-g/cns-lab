/**
 * Aircraft of the Airspace Sandbox: the shared world aircraft (core/world)
 * plus equipment, the journey state of CNS700 and the surveillance timers.
 */

import type { Vec2 } from '@/core/geometry'
import { RCS_M2 } from '@/core/radar'
import { createAircraft, type Aircraft } from '@/core/world'
import type { GroundState } from './ground'
import type { JourneyPhase } from './journey'

export interface Equipment {
  transponder: 'none' | 'modeC' | 'modeS'
  adsb: boolean
  /** FANS 1/A: CPDLC and ADS-C over satellite. */
  fans: boolean
}

export interface JourneyState {
  phase: JourneyPhase
  /** Leg of the flight plan being flown (airborne phases). */
  legIndex: number
  /** Fixed ticks since the journey began; boarding starts at tick 0. */
  tick: number
  /** Tick at which the current phase began. */
  phaseTick: number
  /** Ground movement (null while airborne). */
  ground: GroundState | null
  /** Tick until which the aircraft waits where it is (-1 when not waiting). */
  holdUntilTick: number
}

export interface SbAircraft extends Aircraft {
  equip: Equipment
  code: string
  rcsM2: number
  journey?: JourneyState
  /** Onboard terrain warning (TAWS) currently commanding a pull-up. */
  taws?: boolean
  /** Scenario aircraft are removed when their scenario ends. */
  scenario?: 'stca' | 'mountain'
  nextAdsbS: number
  nextMlatS: number
  nextAdscS: number
}

export function mk(
  id: string,
  pos: Vec2,
  altitudeFt: number,
  headingDeg: number,
  speedKt: number,
  equip: Equipment,
  code: string,
  category: Aircraft['category'] = 'medium',
): SbAircraft {
  const a = createAircraft({ id, pos, altitudeFt, headingDeg, speedKt, category })
  return { ...a, equip, code, rcsM2: RCS_M2[category], nextAdsbS: 0, nextMlatS: 0, nextAdscS: 0 }
}
