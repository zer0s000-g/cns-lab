import { useEffect, useRef } from 'react'

/**
 * Calls `cb(realDtSeconds, nowMs)` on every animation frame while `active`.
 * requestAnimationFrame already pauses in background tabs; the simulation
 * clock clamps the first frame after a pause, so nothing jumps.
 */
export function useAnimationFrame(cb: (realDtS: number, nowMs: number) => void, active = true) {
  const cbRef = useRef(cb)
  cbRef.current = cb
  useEffect(() => {
    if (!active) return
    let raf = 0
    let last = performance.now()
    const loop = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      cbRef.current(dt, now)
      raf = requestAnimationFrame(loop)
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
