// @vitest-environment jsdom
import { Component, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { MAX_FAILED_FRAMES, useAnimationFrame } from '@/hooks/useAnimationFrame'

// A hand-driven requestAnimationFrame: flush() runs the frames queued so far.
let queue = new Map<number, FrameRequestCallback>()
let nextId = 1
let now = 0
function flush(frames = 1) {
  for (let i = 0; i < frames; i++) {
    const due = [...queue.values()]
    queue = new Map()
    now += 16
    act(() => due.forEach((cb) => cb(now)))
  }
}

beforeEach(() => {
  queue = new Map()
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => (queue.set(nextId, cb), nextId++))
  vi.stubGlobal('cancelAnimationFrame', (id: number) => queue.delete(id))
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

class Boundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state = { error: null as unknown }
  static getDerivedStateFromError(error: unknown) {
    return { error }
  }
  render() {
    return this.state.error ? <p>caught: {String((this.state.error as Error).message)}</p> : this.props.children
  }
}

function Loop({ cb }: { cb: () => void }) {
  useAnimationFrame(cb)
  return <p>running</p>
}

describe('useAnimationFrame', () => {
  it('keeps running after a frame that throws once', () => {
    let calls = 0
    const cb = () => {
      calls++
      if (calls === 3) throw new Error('one-off')
    }
    render(<Boundary><Loop cb={cb} /></Boundary>)
    flush(11) // first frame only primes the timer
    expect(calls).toBe(10)
    expect(screen.getByText('running')).toBeTruthy()
    expect(console.error).toHaveBeenCalledTimes(1)
  })

  it('hands an error that repeats every frame to the error boundary instead of freezing silently', () => {
    let calls = 0
    const cb = () => {
      calls++
      throw new Error('broken step')
    }
    render(<Boundary><Loop cb={cb} /></Boundary>)
    flush(MAX_FAILED_FRAMES + 5)
    expect(calls).toBe(MAX_FAILED_FRAMES)
    expect(screen.getByText('caught: broken step')).toBeTruthy()
    expect(queue.size).toBe(0)
  })
})
