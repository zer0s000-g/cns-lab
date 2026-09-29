/**
 * One frame of the journey page: choose the automatic time-lapse speed, step
 * the engine (halting at a guided stop), and react to the end of the journey.
 * Kept apart from React so it can be tested frame by frame.
 */

import type { StoreApi } from 'zustand'
import type { SimClock } from '@/hooks/useSimClock'
import { autoSpeed, isStopEvent, STOP_EVENTS } from './director'
import type { SandboxEngine } from './engine'
import { TICK_S } from './journey'
import { nextEventTick, peekJourneyIndex } from './phases'
import { STOP_STORY } from './narration'
import type { SandboxState } from './state'

export interface Driver {
  engine: SandboxEngine
  clock: SimClock
  store: StoreApi<SandboxState>
}

/** Seconds of journey time to the next guided stop (null when stops are off, none is ahead, or the index is not built yet). */
export function secondsToNextStop(engine: SandboxEngine, stopsEnabled: boolean): number | null {
  if (!stopsEnabled || !peekJourneyIndex()) return null
  const next = nextEventTick(engine.journeyTick, STOP_EVENTS)
  return next === null ? null : (next - engine.journeyTick) * TICK_S
}

/** Run one frame. `dt` is the world time step the clock produced for this frame (0 while paused). */
export function driveFrame({ engine, clock, store }: Driver, dt: number) {
  const st = store.getState()
  if (st.timeMode === 'auto') {
    const want = autoSpeed(engine.phase, secondsToNextStop(engine, st.stopsEnabled))
    if (clock.getState().speed !== want) clock.getState().setSpeed(want)
  }
  if (!(dt > 0)) return
  const { halted } = engine.step(dt, st.stopsEnabled && st.activeStop === null ? isStopEvent : undefined)
  if (halted && STOP_STORY[halted]) {
    clock.getState().pause()
    st.showStop(halted)
  }
  if (engine.lastEvents.includes('complete')) st.setDebrief(true)
}
