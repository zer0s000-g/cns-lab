import { useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface Step {
  title: string
  body: ReactNode
  /** Illustration for the step. Receives whether the step is the one showing. */
  visual?: ReactNode | ((active: boolean) => ReactNode)
}

/** "How it works": a step-by-step explanation with Back / Next buttons. */
export function Stepper({ steps }: { steps: Step[] }) {
  const [i, setI] = useState(0)
  const step = steps[i]
  const visual = typeof step.visual === 'function' ? step.visual(true) : step.visual
  return (
    <div className="rounded-lg border bg-card">
      <ol className="flex gap-1 overflow-x-auto border-b p-2" aria-label="Steps">
        {steps.map((s, k) => (
          <li key={s.title} className="shrink-0">
            <button
              type="button"
              onClick={() => setI(k)}
              aria-current={k === i ? 'step' : undefined}
              className={cn(
                'flex h-9 items-center gap-2 rounded-md px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted pointer-coarse:h-10',
                k === i && 'bg-accent text-accent-foreground',
              )}
            >
              <span
                className={cn(
                  'grid size-5 place-items-center rounded-full border font-mono text-[11px] tabular-nums',
                  k === i ? 'border-primary bg-primary text-primary-foreground' : k < i ? 'border-primary text-primary' : 'border-border',
                )}
              >
                {k + 1}
              </span>
              <span className="hidden sm:inline">{s.title}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className={cn('grid gap-6 p-4 md:p-6', visual && 'md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]')}>
        <div className="flex min-w-0 flex-col gap-3" aria-live="polite">
          <p className="text-xs font-medium text-muted-foreground tabular-nums">
            Step {i + 1} of {steps.length}
          </p>
          <h3 className="text-base font-semibold">{step.title}</h3>
          <div className="prose-lab">{step.body}</div>
        </div>
        {visual && <div className="min-w-0">{visual}</div>}
      </div>
      <div className="flex items-center justify-between border-t p-3">
        <Button variant="outline" size="sm" onClick={() => setI((v) => Math.max(0, v - 1))} disabled={i === 0}>
          <ArrowLeft aria-hidden /> Back
        </Button>
        <Button size="sm" onClick={() => setI((v) => Math.min(steps.length - 1, v + 1))} disabled={i === steps.length - 1}>
          Next <ArrowRight aria-hidden />
        </Button>
      </div>
    </div>
  )
}
