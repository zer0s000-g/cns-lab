import { beforeAll, describe, expect, it } from 'vitest'
import { createSimClock } from '@/hooks/useSimClock'
import { SANDBOX_SPEEDS, STOP_SLOWDOWN_MAX } from '@/pages/Sandbox/director'
import { driveFrame, secondsToNextStop, type Driver } from '@/pages/Sandbox/drive'
import { ALL_SYSTEMS_ON, SandboxEngine } from '@/pages/Sandbox/engine'
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

describe('jumps, restore and repeated instructions', () => {
  it('jumping to Ocean still shows the ocean-entry stop', () => {
    const d = driver()
    d.store.getState().jumpTo('ocean')
    frames(d, () => d.store.getState().activeStop !== null, 5)
    expect(d.store.getState().activeStop).toBe('oceanEntry')
    expect(d.clock.getState().running).toBe(false)
    // Shown once: resuming does not show it again.
    d.store.getState().showStop(null)
    d.clock.getState().play()
    frames(d, () => false, 30)
    expect(d.store.getState().activeStop).not.toBe('oceanEntry')
  })

  it('"Restore all systems" keeps the journey where it is, and a guided stop stays on screen', () => {
    const d = driver()
    d.store.getState().jumpTo('climb')
    frames(d, () => d.store.getState().activeStop !== null, 40000)
    expect(d.store.getState().activeStop).toBe('oceanEntry')
    const tick = d.engine.journeyTick
    d.store.getState().setSystem('vhf', false)
    d.store.getState().setScenario('mountain')
    d.engine.spawnConflict()
    d.store.getState().resetAll()
    const s = d.store.getState()
    expect(d.engine.journeyTick).toBe(tick)
    expect(d.engine.phase).toBe('ocean')
    expect(s.activeStop).toBe('oceanEntry')
    expect(s.scenario).toBe('normal')
    expect(s.systems).toEqual(ALL_SYSTEMS_ON)
    expect(d.engine.aircraft.some((a) => a.scenario)).toBe(false)
    expect(s.selectedId).toBe('CNS700')
  })

  it('resolving the conflict twice climbs CNS9B to FL110 once', () => {
    const d = driver()
    d.engine.spawnConflict()
    d.engine.resolveConflict()
    const logs = d.engine.log.length
    d.engine.resolveConflict()
    d.engine.resolveConflict()
    expect(d.engine.getAircraft('CNS9B')!.targetAltitudeFt).toBe(11000)
    expect(d.engine.log.length).toBe(logs)
  })
})
