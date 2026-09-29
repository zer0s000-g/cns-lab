import { useEffect, useId, useRef } from 'react'
import { Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import { STOP_STORY } from '../narration'
import { useSandbox, useSandboxState } from '../state'

const btn =
  'hud-value inline-flex min-h-10 items-center justify-center gap-1.5 rounded-[4px] border px-3 text-[11px] tracking-wider uppercase transition-colors outline-offset-2 [&_svg]:size-3.5'

/**
 * A guided stop: the journey is paused at a key moment with a short
 * explanation. Focus moves to Continue, and returns afterwards.
 */
export function StopCard({ className }: { className?: string }) {
  const { clock } = useSandbox()
  const stop = useSandboxState((s) => s.activeStop)
  const showStop = useSandboxState((s) => s.showStop)
  const setStops = useSandboxState((s) => s.setStopsEnabled)
  const cont = useRef<HTMLButtonElement>(null)
  const back = useRef<HTMLElement | null>(null)
  const id = useId()
  useEffect(() => {
    if (!stop) return
    back.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    cont.current?.focus({ preventScroll: true })
  }, [stop])
  if (!stop) return null
  const story = STOP_STORY[stop]
  if (!story) return null
  const resume = (keepStops: boolean) => {
    if (!keepStops) setStops(false)
    showStop(null)
    clock.getState().play()
    back.current?.focus({ preventScroll: true })
  }
  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby={`${id}-t`}
      aria-describedby={`${id}-b`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') resume(true)
      }}
      className={cn('hud-panel pointer-events-auto rounded-md border-signal/40 p-4 text-foreground md:p-5', className)}
    >
      <p className="hud-label flex items-center gap-2 text-brass">
        <span className="inline-block size-1.5 bg-brass" aria-hidden />
        Guided stop · paused
      </p>
      <h2 id={`${id}-t`} className="hud-title mt-2 text-[15px] md:text-[17px]">
        {story.title}
      </h2>
      <p id={`${id}-b`} className="mt-2 text-[13.5px] leading-6 text-foreground/90">
        {story.body}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button ref={cont} type="button" onClick={() => resume(true)} className={cn(btn, 'border-signal bg-signal text-primary-foreground hover:bg-signal/85')}>
          <Play aria-hidden /> Continue
        </button>
        <button type="button" onClick={() => resume(false)} className={cn(btn, 'border-hud-line text-foreground/85 hover:border-foreground/40 hover:text-foreground')}>
          Continue without stops
        </button>
      </div>
    </div>
  )
}
