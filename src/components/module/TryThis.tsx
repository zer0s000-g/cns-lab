import { useState, type ReactNode } from 'react'
import { Eye, FlaskConical, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { scrollToSection } from '@/components/module/scroll'

export interface Experiment {
  id: string
  /** The question the experiment answers. */
  question: string
  /** What the learner should do. */
  action: ReactNode
  /** Revealed on demand. */
  notice: ReactNode
  /** Optional one-click setup of the simulator for this experiment. */
  setup?: () => void
  setupLabel?: string
}

/** "Try this": guided experiments with a revealable "What you should notice". */
export function TryThis({ experiments }: { experiments: Experiment[] }) {
  return (
    <ol className="grid gap-3 md:grid-cols-2">
      {experiments.map((e, i) => (
        <ExperimentCard key={e.id} e={e} n={i + 1} />
      ))}
    </ol>
  )
}

function ExperimentCard({ e, n }: { e: Experiment; n: number }) {
  const [shown, setShown] = useState(false)
  return (
    <li className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="flex items-start gap-3">
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground">
          <FlaskConical className="size-4" aria-hidden />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-xs font-medium text-muted-foreground">Experiment {n}</p>
          <h3 className="text-sm font-semibold">{e.question}</h3>
        </div>
      </div>
      <div className="prose-lab text-sm">{e.action}</div>
      <div className="mt-auto flex flex-wrap gap-2">
        {e.setup && (
          <Button
            size="sm"
            onClick={() => {
              e.setup?.()
              scrollToSection('simulator')
            }}
          >
            <Wand2 aria-hidden />
            {e.setupLabel ?? 'Set it up for me'}
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => setShown((v) => !v)} aria-expanded={shown}>
          <Eye aria-hidden />
          {shown ? 'Hide' : 'What you should notice'}
        </Button>
      </div>
      {shown && <div className="prose-lab rounded-md border-l-2 border-primary bg-muted/60 px-3 py-2 text-sm">{e.notice}</div>}
    </li>
  )
}
