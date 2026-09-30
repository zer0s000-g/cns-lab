// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { audio } from '@/lib/audio'
import * as radioAudio from '@/modules/vhf/radioAudio'
import { VhfEngine } from '@/modules/vhf/engine'
import { VhfAudioDirector } from '@/modules/vhf/vhfAudio'
import { HfEngine } from '@/modules/hf/engine'
import { HfAudioDirector } from '@/modules/hf/hfAudio'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Run the VHF engine with CNS303's microphone stuck and CNS101 talking over it; count squeals. */
function squealsOverBlockedFrequency(engine: VhfEngine, director: VhfAudioDirector, seconds: number) {
  const squeal = vi.spyOn(audio, 'heterodyne')
  squeal.mockClear()
  engine.pressTalk()
  for (let t = 0; t < seconds; t += 0.1) {
    engine.step(0.1)
    director.update(engine, 'controller', true)
  }
  engine.releaseTalk()
  return squeal.mock.calls.length
}

describe('audio directors', () => {
  it('VHF: the squeal of a blocked frequency still plays after Reset', () => {
    const engine = new VhfEngine()
    engine.setFailure('stuckMic', true)
    const director = new VhfAudioDirector()
    const before = squealsOverBlockedFrequency(engine, director, 20)
    expect(before).toBeGreaterThan(0)
    engine.reset()
    const after = squealsOverBlockedFrequency(engine, director, 20)
    expect(after).toBeGreaterThan(0)
  })

  it('HF: a message waiting for the SELCAL chime is not spoken after leaving the module', () => {
    vi.useFakeTimers()
    const speak = vi.spyOn(radioAudio, 'speak').mockImplementation(() => true)
    const director = new HfAudioDirector()
    director.playHf(new HfEngine(), 1.3)
    director.dispose()
    vi.advanceTimersByTime(5000)
    expect(speak).not.toHaveBeenCalled()
  })
})
