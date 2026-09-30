// @vitest-environment jsdom
import { Component, Suspense, type ReactNode } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { isChunkLoadError, lazyRetry, resetFailedLazies } from '@/lib/lazyRetry'
import { StageBoundary } from '@/stage/StageBoundary'
import { StageFailurePoster } from '@/stage/LazyStage'
import { Canvas2D, MIN_DRAW_PX } from '@/components/sim/Canvas2D'

let observed: ((entries: unknown[]) => void)[] = []
beforeAll(() => {
  // jsdom lacks these browser APIs.
  globalThis.ResizeObserver ??= class {
    constructor(cb: (entries: unknown[]) => void) {
      observed.push(cb)
    }
    observe() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  HTMLCanvasElement.prototype.getContext = function () {
    return { setTransform() {}, clearRect() {} } as unknown as CanvasRenderingContext2D
  } as unknown as typeof HTMLCanvasElement.prototype.getContext
})
afterEach(() => {
  cleanup()
  observed = []
  vi.restoreAllMocks()
})

// Like RouteError: once the error is shown, failed lazy pages may download again.
class Boundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state = { error: null as unknown }
  static getDerivedStateFromError(error: unknown) {
    return { error }
  }
  componentDidCatch() {
    resetFailedLazies()
  }
  render() {
    return this.state.error ? <p>failed</p> : this.props.children
  }
}

const chunkError = () => new TypeError('Failed to fetch dynamically imported module: https://x/assets/psr-1.js')

describe('lazy pages and stages after a failed download', () => {
  it('download again when mounted again, instead of failing forever', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let calls = 0
    const Page = lazyRetry(async () => {
      calls++
      if (calls === 1) throw chunkError()
      return { default: () => <p>page loaded</p> }
    })
    const ui = () => (
      <Boundary>
        <Suspense fallback={<p>loading</p>}>
          <Page />
        </Suspense>
      </Boundary>
    )
    const first = render(ui())
    expect(await screen.findByText('failed')).toBeTruthy()
    first.unmount()
    render(ui())
    expect(await screen.findByText('page loaded')).toBeTruthy()
    expect(calls).toBe(2)
  })

  it('a download that keeps failing shows the error once and does not retry in a loop', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let calls = 0
    const Page = lazyRetry(async () => {
      calls++
      throw chunkError()
    })
    render(
      <Boundary>
        <Suspense fallback={<p>loading</p>}>
          <Page />
        </Suspense>
      </Boundary>,
    )
    expect(await screen.findByText('failed')).toBeTruthy()
    await new Promise((r) => setTimeout(r, 50))
    expect(calls).toBe(1)
  })

  it('the 3D stage offers "Try again" for a failed download and loads on retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let calls = 0
    const Scene = lazyRetry(async () => {
      calls++
      if (calls === 1) throw chunkError()
      return { default: () => <p>scene loaded</p> }
    })
    render(
      <StageBoundary fallback={(f) => <StageFailurePoster {...f} label="Stage" />}>
        <Suspense fallback={<p>loading</p>}>
          <Scene />
        </Suspense>
      </StageBoundary>,
    )
    expect(await screen.findByText('3D view could not be downloaded')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByText('scene loaded')).toBeTruthy()
  })

  it('a device problem (no WebGL) is not blamed on the download and has no retry', () => {
    render(<StageFailurePoster error={new Error('Error creating WebGL context.')} retry={() => {}} attempts={1} label="Stage" />)
    expect(screen.getByText('3D view unavailable on this device')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('when "Try again" fails too, the button reloads the page instead', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const Scene = lazyRetry(async (): Promise<{ default: () => ReactNode }> => {
      throw chunkError()
    })
    render(
      <StageBoundary fallback={(f) => <StageFailurePoster {...f} label="Stage" />}>
        <Suspense fallback={<p>loading</p>}>
          <Scene />
        </Suspense>
      </StageBoundary>,
    )
    fireEvent.click(await screen.findByRole('button', { name: /try again/i }))
    expect(await screen.findByRole('button', { name: /reload page/i })).toBeTruthy()
  })

  it('recognises CSS preload and Firefox/Safari network failures as download errors', () => {
    expect(isChunkLoadError(new Error('Unable to preload CSS for /assets/psr.css'))).toBe(true)
    expect(isChunkLoadError(new TypeError('NetworkError when attempting to fetch resource.'))).toBe(true)
    expect(isChunkLoadError(new TypeError('Load failed'))).toBe(true)
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'x')"))).toBe(false)
  })
})

describe('Canvas2D', () => {
  const sized = (w: number, h: number) =>
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0, toJSON() {} })

  it('does not draw into a hidden or squeezed container', () => {
    sized(0, 0)
    const draw = vi.fn()
    render(<Canvas2D draw={draw} animate={false} label="scope" />)
    expect(draw).not.toHaveBeenCalled()
    sized(MIN_DRAW_PX - 1, 200)
    act(() => observed.forEach((cb) => cb([])))
    expect(draw).not.toHaveBeenCalled()
    sized(200, 200)
    act(() => observed.forEach((cb) => cb([])))
    expect(draw).toHaveBeenCalled()
  })

  it('a draw that throws (e.g. a negative arc radius) does not take the page down', () => {
    sized(200, 200)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const draw = () => {
      throw new DOMException('The radius provided (-3) is negative.', 'IndexSizeError')
    }
    expect(() => render(<Canvas2D draw={draw} animate={false} label="scope" />)).not.toThrow()
    act(() => observed.forEach((cb) => cb([])))
    expect(screen.getByRole('img', { name: 'scope' })).toBeTruthy()
    expect(err).toHaveBeenCalledTimes(1) // reported once, not every frame
  })
})
