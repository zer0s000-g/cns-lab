import { useSampled } from '@/hooks/useSampled'
import { papi, papiAngleDeg } from '../aircraftState'
import { controllingUnit, type AtcUnit } from '../atc'
import type { SandboxEngine } from '../engine'
import type { FlightPhase, JourneyPhase } from '../journey'
import { isOnGround, transponderOn } from '../phases'
import { useSandbox } from '../state'

export interface JourneyReadout {
  phase: FlightPhase
  journeyPhase: JourneyPhase
  unit: AtcUnit
  altitudeFt: number
  speedKt: number
  headingDeg: number
  vsFpm: number
  elapsedS: number
  onGround: boolean
  transponder: boolean
  runId: number
  /** Distance from the airport, NM. */
  distNm: number
  /** PAPI as seen from the cockpit on the final approach (white = true), or null. */
  papi: boolean[] | null
}

export function readJourney(engine: SandboxEngine): JourneyReadout {
  const a = engine.journeyAircraft
  const pose = engine.journeyPose()
  const phase = engine.phase
  const j = a?.journey
  return {
    phase,
    journeyPhase: j?.phase ?? 'boarding',
    unit: controllingUnit(phase),
    altitudeFt: Math.round(pose?.altitudeFt ?? 0),
    speedKt: Math.round(pose?.speedKt ?? 0),
    headingDeg: Math.round(pose?.headingDeg ?? 0) % 360,
    vsFpm: Math.round((a?.verticalSpeedFpm ?? 0) / 50) * 50,
    elapsedS: Math.floor(engine.journeyElapsedS),
    onGround: a ? isOnGround(a) : true,
    transponder: a ? transponderOn(a) : false,
    runId: engine.runId,
    distNm: pose ? Math.round(Math.hypot(pose.pos.x, pose.pos.y)) : 0,
    papi: j?.phase === 'final' && pose ? papi(papiAngleDeg(pose.posM, pose.altitudeFt)) : null,
  }
}

const same = (a: JourneyReadout, b: JourneyReadout) => JSON.stringify(a) === JSON.stringify(b)

/** CNS700's readouts, sampled a few times a second. */
export function useJourney(intervalMs = 200): JourneyReadout {
  const { engine } = useSandbox()
  return useSampled(() => readJourney(engine), intervalMs, same)
}

/** Just the flight phase (cheap to subscribe to). */
export function usePhase(): FlightPhase {
  const { engine } = useSandbox()
  return useSampled(() => engine.phase, 150)
}

export function formatElapsed(s: number): string {
  const t = Math.max(0, Math.floor(s))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const sec = t % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}
