import { beforeAll, describe, expect, it } from 'vitest'
import { createSimClock } from '@/hooks/useSimClock'
import { SANDBOX_SPEEDS, STOP_SLOWDOWN_MAX } from '@/pages/Sandbox/director'
import { driveFrame, secondsToNextStop, type Driver } from '@/pages/Sandbox/drive'
import { SandboxEngine } from '@/pages/Sandbox/engine'
import { getJourneyIndex } from '@/pages/Sandbox/phases'
import { createSandboxStore } from '@/pages/Sandbox/state'

const FRAME_S = 1 / 60

function driver(): Driver {
  const engine = new SandboxEngine()
  return { engine, clock: createSimClock({ speeds: SANDBOX_SPEEDS, speed: 8, running: true }), store: createSandboxStore(engine) }
}

/** Run animation frames until `done` or `maxFrames`. Returns the frames run. */
function frames(d: Driver, done: () => boolean, maxFrames: number, onFrame?: () => void): number {
  let n = 0
  while (n < maxFrames && !done()) {
    const dt = d.clock.getState().tick(FRAME_S)
    driveFrame(d, dt)
    onFrame?.()
    n++
  }
  return n
}

beforeAll(() => {
  getJourneyIndex()
})

describe('the journey page, frame by frame', () => {
  it('pauses at the take-off clearance with the story shown, slowed right down beforehand', () => {
    const d = driver()
    d.store.getState().jumpTo('taxi')
    let fastest = 0
    frames(
      d,
      () => d.store.getState().activeStop !== null,
      20000,
      () => {
        const secs = secondsToNextStop(d.engine, true)
        if (secs !== null && secs < 20) fastest = Math.max(fastest, d.clock.getState().speed)
      },
    )
    expect(d.store.getState().activeStop).toBe('takeoffClearance')
    expect(d.clock.getState().running).toBe(false)
    expect(d.engine.phase).toBe('takeoff')
    expect(fastest).toBeLessThanOrEqual(STOP_SLOWDOWN_MAX)
    // While the stop is shown, time does not move.
    const t = d.engine.timeS
    frames(d, () => false, 120)
    expect(d.engine.timeS).toBe(t)
  })

  it('carries on after Continue and stops next at the ocean boundary', () => {
    const d = driver()
    d.store.getState().jumpTo('departure')
    frames(d, () => d.store.getState().activeStop !== null, 60000)
    expect(d.store.getState().activeStop).toBe('oceanEntry')
    d.store.getState().showStop(null)
    d.clock.getState().play()
    const t = d.engine.timeS
    frames(d, () => false, 60)
    expect(d.engine.timeS).toBeGreaterThan(t)
    expect(d.store.getState().activeStop).toBeNull()
  })

  it('never stops when guided stops are off', () => {
    const d = driver()
    d.store.getState().setStopsEnabled(false)
    d.store.getState().jumpTo('taxi')
    const lift = getJourneyIndex().events.find((e) => e.kind === 'liftoff')!.tick
    frames(d, () => d.engine.journeyTick > lift, 30000)
    expect(d.engine.journeyTick).toBeGreaterThan(lift)
    expect(d.store.getState().activeStop).toBeNull()
  })

  it('leaves the speed alone once the learner picks one', () => {
    const d = driver()
    d.store.getState().setTimeMode('manual')
    d.clock.getState().setSpeed(60)
    frames(d, () => false, 30)
    expect(d.clock.getState().speed).toBe(60)
    d.store.getState().setTimeMode('auto')
    frames(d, () => false, 2)
    expect(d.clock.getState().speed).toBe(8) // the gate's automatic speed
  })

  it('opens the debrief when the last passenger has left the aircraft', () => {
    const d = driver()
    d.store.getState().jumpTo('arrived')
    frames(d, () => d.store.getState().debrief, 20000)
    expect(d.store.getState().debrief).toBe(true)
    expect(d.engine.journeyAircraft!.journey!.phase).toBe('complete')
    d.store.getState().flyAgain()
    expect(d.store.getState().debrief).toBe(false)
    expect(d.engine.phase).toBe('gate')
  })
})
