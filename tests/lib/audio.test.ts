// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function freshAudio() {
  vi.resetModules()
  return (await import('@/lib/audio')).audio
}

const SEGMENTS = [{ startS: 0, durationS: 0.1 }]

describe('audio engine failures', () => {
  it('an AudioContext the browser refuses leaves the app silent instead of throwing', async () => {
    const ctor = vi.fn(() => {
      throw new DOMException('not allowed', 'NotSupportedError')
    })
    vi.stubGlobal('AudioContext', ctor)
    const audio = await freshAudio()
    expect(() => audio.keyed(SEGMENTS, 1020)).not.toThrow()
    expect(() => audio.tone(440, 0.2)).not.toThrow()
    expect(audio.ensure()).toBeNull()
    // It does not keep trying (and failing) on every frame.
    expect(ctor).toHaveBeenCalledTimes(1)
  })

  it('a sound node that throws while being built does not reach the caller', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    class FakeCtx {
      state = 'running'
      currentTime = 0
      destination = {}
      createGain() {
        return { gain: { value: 0 }, connect: (n: unknown) => n }
      }
      createOscillator(): never {
        throw new TypeError('The provided float value is non-finite.')
      }
      resume() {
        return Promise.resolve()
      }
    }
    vi.stubGlobal('AudioContext', FakeCtx)
    const audio = await freshAudio()
    const h = audio.tone(Number.NaN, 0.2)
    expect(typeof h.stop).toBe('function')
    audio.tone(Number.NaN, 0.2)
    expect(err).toHaveBeenCalledTimes(1)
  })
})
