import { useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { HudButton } from '@/hud/Controls'
import { cn } from '@/lib/utils'

export interface Step {
  title: string
  body: ReactNode
  /** Illustration for the step. Receives whether the step is the one showing. */
  visual?: ReactNode | ((active: boolean) => ReactNode)
}

/**
 * "How it works": numbered steps with Back / Next. `onStepChange` lets a 3D
 * stage move its camera with the story; `showVisual` hides the flat
 * illustration when the stage itself is the illustration.
 */
export function Stepper({ steps, onStepChange, showVisual = true }: { steps: Step[]; onStepChange?: (i: number) => void; showVisual?: boolean }) {
  const [i, setIRaw] = useState(0)
  const setI = (n: number) => {
    setIRaw(n)
    onStepChange?.(n)
  }
  const step = steps[i]
  const visual = showVisual ? (typeof step.visual === 'function' ? step.visual(true) : step.visual) : null
  return (
    <div className="flex flex-col">
      <ol className="flex flex-wrap gap-x-1 gap-y-1 border-b border-hud-line pb-3" aria-label="Steps">
        {steps.map((s, k) => (
          <li key={s.title}>
            <button
              type="button"
              onClick={() => setI(k)}
              aria-current={k === i ? 'step' : undefined}
              className={cn(
                'hud-label flex min-h-8 items-center gap-1.5 rounded-sm px-1.5 transition-colors hover:text-foreground pointer-coarse:min-h-10',
                k === i ? 'text-signal' : k < i ? 'text-foreground/70' : 'text-muted-foreground/60',
              )}
            >
              <span className={cn('hud-value', k === i && 'underline decoration-signal underline-offset-4')}>{String(k + 1).padStart(2, '0')}</span>
              <span className="sr-only">{s.title}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className={cn('grid gap-5 pt-4', visual && 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]')}>
        <div className="flex min-w-0 flex-col gap-3" aria-live="polite">
          <p className="hud-label">
            Step {i + 1} / {steps.length}
          </p>
          <h3 className="hud-title text-[15px] leading-snug text-foreground">{step.title}</h3>
          <div className="prose-lab text-foreground/85">{step.body}</div>
        </div>
        {visual && <div className="min-w-0 opacity-90">{visual}</div>}
      </div>
      <div className="mt-5 flex items-center justify-between gap-3 border-t border-hud-line pt-3">
        <HudButton onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0}>
          <ArrowLeft aria-hidden /> Back
        </HudButton>
        <HudButton variant="solid" onClick={() => setI(Math.min(steps.length - 1, i + 1))} disabled={i === steps.length - 1}>
          Next <ArrowRight aria-hidden />
        </HudButton>
      </div>
    </div>
  )
}
