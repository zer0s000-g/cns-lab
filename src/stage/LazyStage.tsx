import { Suspense, lazy, type ComponentProps } from 'react'
import { cn } from '@/lib/utils'
import { StageBoundary } from './StageBoundary'
import type { Stage as StageComponent } from './Stage'

/**
 * The 3D stage, loaded on demand. three.js, drei and postprocessing live in
 * their own chunk, so a page's text, controls and layout appear before the
 * 3D engine has downloaded. The poster holds the same box, so nothing shifts.
 */
const StageImpl = lazy(() => import('./Stage').then((m) => ({ default: m.Stage })))

export type StageProps = ComponentProps<typeof StageComponent>

export function LazyStage(props: StageProps) {
  return (
    <StageBoundary fallback={<StagePoster className={props.className} label={props.label} message="3D view unavailable on this device" />}>
      <Suspense fallback={<StagePoster className={props.className} label={props.label} />}>
        <StageImpl {...props} />
      </Suspense>
    </StageBoundary>
  )
}

/** Placeholder with the stage's size and backdrop while the 3D chunk loads. */
export function StagePoster({ className, label, message }: { className?: string; label: string; message?: string }) {
  return (
    <div role="img" aria-label={label} className={cn('relative overflow-hidden bg-stage-bg', className)}>
      <div
        aria-hidden
        className="absolute inset-0 opacity-40 [background-image:linear-gradient(var(--hud-line)_1px,transparent_1px),linear-gradient(90deg,var(--hud-line)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:radial-gradient(ellipse_at_60%_60%,black,transparent_70%)]"
      />
      <p className="hud-label absolute bottom-1/2 left-1/2 flex -translate-x-1/2 items-center gap-2 text-foreground/50">
        {!message && <span aria-hidden className="block size-1.5 animate-pulse rounded-full bg-signal motion-reduce:animate-none" />}
        {message ?? 'Loading 3D stage'}
      </p>
    </div>
  )
}
