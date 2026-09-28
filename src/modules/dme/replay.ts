/**
 * One question and answer, frozen for the slow-motion view. The world does
 * not move while it plays.
 */

import { DME_CODES, dmeTiming, type DmeMode, type DmePulseCode, type DmeTiming } from '@/core/dme'
import { distanceNm } from '@/core/geometry'
import type { DmeEngine, InterrogationRecord } from './engine'

/** Real seconds the replay should take. */
export const REPLAY_REAL_S = 9
/** Width of one drawn pulse, µs (real DME pulses are about 3.5 µs wide). */
export const PULSE_US = 3.5

export interface DmeReplay {
  slantNm: number
  mode: DmeMode
  code: DmePulseCode
  timing: DmeTiming
  /** The station answered this question. */
  replied: boolean
  reason: 'ok' | 'blocked' | 'ignored'
  /** Where a hill stops the question, NM from the aircraft (blocked only). */
  blockNm: number | null
  /** What the cockpit DME shows. */
  shownNm: number | null
  lockedOnTwin: boolean
  /** Signal time at the end of the replay, µs. */
  totalUs: number
  tUs: number
}

/** Build a replay for the question just sent. The world is frozen while it plays. */
export function buildReplay(engine: DmeEngine, rec: InterrogationRecord): DmeReplay {
  const slantNm = engine.ownSlantNm
  const mode = engine.env.mode
  const code = DME_CODES[mode]
  const timing = dmeTiming(slantNm, mode)
  const blocked = !engine.heard
  let blockNm: number | null = null
  if (blocked) {
    // lineOfSight measures from the station; the replay path starts at the aircraft.
    const fromStation = distanceNm(engine.station.pos, engine.los.worstPoint)
    const ground = Math.max(engine.ownGroundNm, 1e-6)
    blockNm = Math.max(0.05, slantNm * (1 - fromStation / ground))
  }
  return {
    slantNm,
    mode,
    code,
    timing,
    replied: rec.ownUs !== null,
    reason: blocked ? 'blocked' : rec.ownUs === null ? 'ignored' : 'ok',
    blockNm,
    shownNm: engine.reading().distanceNm,
    lockedOnTwin: engine.lockedOnTwin,
    totalUs: timing.totalUs + code.replySpacingUs + 2 * PULSE_US + 6,
    tUs: 0,
  }
}

