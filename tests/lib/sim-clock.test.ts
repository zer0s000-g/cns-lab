import { describe, expect, it } from 'vitest'
import { createSimClock } from '@/hooks/useSimClock'

describe('simulator clock store', () => {
  it('ticks, pauses and changes speed', () => {
    const c = createSimClock({ speeds: [1, 4, 16, 60], speed: 16 })
    expect(c.getState().tick(0.05)).toBeCloseTo(0.8)
    c.getState().pause()
    expect(c.getState().tick(0.05)).toBe(0)
    c.getState().play()
    c.getState().faster()
    expect(c.getState().speed).toBe(60)
    c.getState().faster()
    expect(c.getState().speed).toBe(60)
    c.getState().slower()
    expect(c.getState().speed).toBe(16)
    c.getState().reset()
    expect(c.getState().timeS).toBe(0)
  })
  it('can start paused (reduced motion)', () => {
    const c = createSimClock({ running: false })
    expect(c.getState().running).toBe(false)
    expect(c.getState().tick(0.05)).toBe(0)
  })
})
