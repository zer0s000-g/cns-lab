import { useState, type ReactNode } from 'react'
import { Eye, EyeOff, Wand2 } from 'lucide-react'
import { scrollToSection } from '@/components/module/scroll'
import { HudButton } from '@/hud/Controls'
import { cn } from '@/lib/utils'

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

/**
 * "Try this" as a filmstrip: numbered frames along the top, the chosen
 * experiment below with its set-up button and a revealable answer.
 */
export function TryThis({ experiments, onSetup }: { experiments: Experiment[]; onSetup?: (id: string) => void }) {
  const [sel, setSel] = useState(0)
  const [shown, setShown] = useState<Record<string, boolean>>({})
  const e = experiments[sel]
  return (
    <div className="flex flex-col gap-4">
      <ol className="grid auto-cols-[minmax(128px,1fr)] grid-flow-col gap-2 overflow-x-auto pb-1" aria-label="Experiments">
        {experiments.map((x, i) => (
          <li key={x.id} className="min-w-0">
            <button
              type="button"
              onClick={() => setSel(i)}
              aria-current={i === sel ? 'true' : undefined}
              className={cn(
                'group flex h-full w-full flex-col gap-2 rounded-[4px] border p-2.5 text-left transition-colors',
                i === sel ? 'border-signal/70 bg-signal/[0.06] shadow-[0_0_24px_-8px_var(--signal)]' : 'border-hud-line hover:border-foreground/30',
              )}
            >
              <span className="hud-label flex items-center justify-between">
                <span className={cn(i === sel && 'text-signal')}>EXP {String(i + 1).padStart(2, '0')}</span>
                {shown[x.id] && <span className="text-success">seen</span>}
              </span>
              <span className="line-clamp-3 text-[12.5px] leading-snug text-foreground/90">{x.question}</span>
            </button>
          </li>
        ))}
      </ol>
      <article className="grid gap-4 border-t border-hud-line pt-4 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]" aria-live="polite">
        <div className="flex flex-col gap-3">
          <h3 className="hud-title text-[14px] leading-snug text-foreground">{e.question}</h3>
          <div className="prose-lab text-foreground/85">{e.action}</div>
          <div className="flex flex-wrap gap-2">
            {e.setup && (
              <HudButton
                variant="solid"
                onClick={() => {
                  e.setup?.()
                  onSetup?.(e.id)
                  scrollToSection('simulator')
                }}
              >
                <Wand2 aria-hidden /> {e.setupLabel ?? 'Set it up for me'}
              </HudButton>
            )}
            <HudButton onClick={() => setShown((s) => ({ ...s, [e.id]: !s[e.id] }))} aria-label={shown[e.id] ? 'Hide what you should notice' : 'Show what you should notice'}>
              {shown[e.id] ? <EyeOff aria-hidden /> : <Eye aria-hidden />} {shown[e.id] ? 'Hide' : 'What you should notice'}
            </HudButton>
          </div>
        </div>
        <div
          className={cn(
            'prose-lab rounded-[4px] border-l-2 px-4 py-3 text-foreground/90 transition-opacity',
            shown[e.id] ? 'border-signal bg-signal/[0.05]' : 'border-hud-line border-dashed',
          )}
        >
          {shown[e.id] ? e.notice : <p className="hud-label">Make a guess first, then reveal what you should notice.</p>}
        </div>
      </article>
    </div>
  )
}
