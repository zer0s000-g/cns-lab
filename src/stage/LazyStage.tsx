import { Suspense, useEffect, useState, type ComponentProps, type ReactNode } from 'react'
import { RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { isChunkLoadError, lazyRetry } from '@/lib/lazyRetry'
import { cn } from '@/lib/utils'
import { StageBoundary, type StageFailure } from './StageBoundary'
import type { Stage as StageComponent } from './Stage'

/**
 * The 3D stage, loaded on demand. three.js, drei and postprocessing live in
 * their own chunk, so a page's text, controls and layout appear before the
 * 3D engine has downloaded. The poster holds the same box, so nothing shifts.
 */
const StageImpl = lazyRetry(() => import('./Stage').then((m) => ({ default: m.Stage })))

export type StageProps = ComponentProps<typeof StageComponent>

/**
 * Resolves once the page has loaded and the browser is idle, so the 3D chunk
 * (about 280 kB) never competes with the text, fonts and simulator code the
 * page needs first.
 */
export function useWhenIdle() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    let idle = 0
    const go = () => {
      const ric = window.requestIdleCallback
      if (ric) idle = ric(() => !cancelled && setReady(true), { timeout: 1500 })
      else idle = window.setTimeout(() => !cancelled && setReady(true), 200)
    }
    if (document.readyState === 'complete') go()
    else window.addEventListener('load', go, { once: true })
    return () => {
      cancelled = true
      window.removeEventListener('load', go)
      if (window.cancelIdleCallback) window.cancelIdleCallback(idle)
      else window.clearTimeout(idle)
    }
  }, [])
  return ready
}

export function LazyStage(props: StageProps) {
  const ready = useWhenIdle()
  if (!ready) return <StagePoster className={props.className} label={props.label} />
  return (
    <StageBoundary fallback={(f) => <StageFailurePoster {...f} className={props.className} label={props.label} />}>
      <Suspense fallback={<StagePoster className={props.className} label={props.label} />}>
        <StageImpl {...props} />
      </Suspense>
    </StageBoundary>
  )
}

/**
 * What a failed stage shows. A download that failed can be tried again; if that fails
 * too (Chromium remembers a failed module download until the page reloads) the button
 * reloads the page. Anything else (no WebGL, a shader the GPU rejects) is a limit of
 * this device.
 */
export function StageFailurePoster({ error, retry, attempts, className, label }: StageFailure & { className?: string; label: string }) {
  const download = isChunkLoadError(error)
  const reload = attempts >= 2
  return (
    <StagePoster
      className={className}
      label={label}
      message={download ? '3D view could not be downloaded' : '3D view unavailable on this device'}
      action={
        download ? (
          <Button size="sm" variant="outline" onClick={reload ? () => window.location.reload() : retry}>
            <RotateCw aria-hidden /> {reload ? 'Reload page' : 'Try again'}
          </Button>
        ) : undefined
      }
    />
  )
}

/** Placeholder with the stage's size and backdrop while the 3D chunk loads. */
export function StagePoster({ className, label, message, action }: { className?: string; label: string; message?: string; action?: ReactNode }) {
  return (
    <div className={cn('relative overflow-hidden bg-stage-bg', className)}>
      <div role="img" aria-label={label} className="absolute inset-0">
        <div
          aria-hidden
          className="absolute inset-0 opacity-40 [background-image:linear-gradient(var(--hud-line)_1px,transparent_1px),linear-gradient(90deg,var(--hud-line)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:radial-gradient(ellipse_at_60%_60%,black,transparent_70%)]"
        />
        <p className={cn('hud-label absolute bottom-1/2 left-1/2 flex -translate-x-1/2 items-center gap-2', message ? 'text-foreground/85' : 'text-foreground/50')}>
          {!message && <span aria-hidden className="block size-1.5 animate-pulse rounded-full bg-signal motion-reduce:animate-none" />}
          {message ?? 'Loading 3D stage'}
        </p>
      </div>
      {action && <div className="absolute top-1/2 left-1/2 mt-4 -translate-x-1/2">{action}</div>}
    </div>
  )
}
