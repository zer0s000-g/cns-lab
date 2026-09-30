import { useEffect, useRef, useState } from 'react'

/** Frames in a row that may fail before the error is handed to the nearest error boundary. */
export const MAX_FAILED_FRAMES = 30

/**
 * Calls `cb(realDtSeconds, nowMs)` on every animation frame while `active`.
 * requestAnimationFrame already pauses in background tabs; the simulation
 * clock clamps the first frame after a pause, so nothing jumps.
 *
 * A frame that throws does not stop the loop (a one-off glitch, e.g. a canvas
 * briefly resized to nothing, recovers on the next frame). If it keeps throwing
 * for MAX_FAILED_FRAMES frames the error is rethrown during render, so the
 * page's error boundary shows it instead of the simulation silently freezing.
 */
export function useAnimationFrame(cb: (realDtS: number, nowMs: number) => void, active = true) {
  const cbRef = useRef(cb)
  cbRef.current = cb
  const [failure, setFailure] = useState<{ error: unknown } | null>(null)
  if (failure) throw failure.error
  useEffect(() => {
    if (!active) return
    let raf = 0
    let last = performance.now()
    let failed = 0
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      const dt = (now - last) / 1000
      last = now
      try {
        cbRef.current(dt, now)
        failed = 0
      } catch (error) {
        if (failed === 0) console.error(error)
        if (++failed >= MAX_FAILED_FRAMES) {
          cancelAnimationFrame(raf)
          setFailure({ error })
        }
      }
    }
    raf = requestAnimationFrame((now) => {
      last = now
      raf = requestAnimationFrame(loop)
    })
    const onVis = () => {
      // Reset the frame timer when the tab becomes visible again.
      if (document.visibilityState === 'visible') last = performance.now()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [active])
}
