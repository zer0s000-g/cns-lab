import { useEffect, useRef } from 'react'
import { useSampled } from '@/hooks/useSampled'
import { useReducedMotion } from '@/stores/prefs'
import { cn } from '@/lib/utils'
import { PHASE_UNIT, UNITS } from '../atc'
import { FLIGHT_PHASES, PHASE_LABEL, PHASE_SHORT, type FlightPhase } from '../journey'
import { peekJourneyIndex } from '../phases'
import { STORY } from '../narration'
import { useSandbox, useSandboxState } from '../state'

/** How far CNS700 is through its current phase, 0..1 (0 until the journey index is ready). */
function progressIn(phase: FlightPhase, tick: number): number {
  const idx = peekJourneyIndex()
  if (!idx) return 0
  const i = FLIGHT_PHASES.indexOf(phase)
  const start = idx.phaseStartTick[phase]
  const end = i + 1 < FLIGHT_PHASES.length ? idx.phaseStartTick[FLIGHT_PHASES[i + 1]] : idx.totalTicks
  return Math.max(0, Math.min(1, (tick - start) / Math.max(1, end - start)))
}

/** The twelve phases of the flight. Click one to jump there. */
export function JourneyTimeline({ className }: { className?: string }) {
  const { engine, clock, store } = useSandbox()
  const jumpTo = useSandboxState((s) => s.jumpTo)
  const reduced = useReducedMotion()
  const now = useSampled(
    () => ({ phase: engine.phase, p: Math.round(progressIn(engine.phase, engine.journeyTick) * 40) / 40 }),
    250,
    (a, b) => a.phase === b.phase && a.p === b.p,
  )
  const list = useRef<HTMLOListElement>(null)
  const current = FLIGHT_PHASES.indexOf(now.phase)
  // Keep the current phase in view when the strip scrolls sideways (small screens), without scrolling the page.
  useEffect(() => {
    const ol = list.current
    const li = ol?.children[current] as HTMLElement | undefined
    if (!ol || !li || ol.scrollWidth <= ol.clientWidth) return
    ol.scrollTo({ left: li.offsetLeft - ol.clientWidth / 2 + li.clientWidth / 2, behavior: reduced ? 'auto' : 'smooth' })
  }, [current, reduced])
  return (
    <nav aria-label="Journey phases" className={cn('hud-panel rounded-md px-2 py-1.5', className)}>
      <ol ref={list} className="flex snap-x gap-1 overflow-x-auto [scrollbar-width:none] lg:grid lg:grid-cols-12 lg:overflow-visible">
        {FLIGHT_PHASES.map((p, i) => {
          const done = i < current
          const here = i === current
          const fill = done ? 1 : here ? now.p : 0
          return (
            <li key={p} className="min-w-[84px] shrink-0 snap-start lg:min-w-0">
              <button
                type="button"
                onClick={() => {
                  // Jumping away from a guided stop carries on playing.
                  const wasStopped = store.getState().activeStop !== null
                  jumpTo(p)
                  if (wasStopped) clock.getState().play()
                }}
                aria-current={here ? 'step' : undefined}
                aria-label={`${String(i + 1).padStart(2, '0')} ${PHASE_LABEL[p]}${here ? ' (now)' : ''}. ${STORY[p].summary} Jump here.`}
                className={cn(
                  'group flex min-h-11 w-full flex-col justify-center gap-1 rounded-[3px] px-1.5 py-1 text-left transition-colors hover:bg-foreground/5',
                  here && 'bg-foreground/[0.07]',
                )}
              >
                {/* The current phase is marked by its tint and glowing bar; its text stays at full contrast in both themes. */}
                <span className={cn('hud-label flex items-baseline gap-1 text-[9.5px] leading-3', here ? 'font-semibold text-foreground' : done ? 'text-foreground/80' : 'text-muted-foreground')}>
                  <span className={here ? 'text-foreground' : 'text-muted-foreground'}>{String(i + 1).padStart(2, '0')}</span>
                  <span className="truncate">{PHASE_SHORT[p]}</span>
                </span>
                <span className="relative block h-[3px] w-full overflow-hidden rounded-full bg-foreground/15" aria-hidden>
                  <span className={cn('absolute inset-y-0 left-0 rounded-full', here ? 'bg-signal shadow-[0_0_8px_var(--signal)]' : 'bg-signal/60')} style={{ width: `${fill * 100}%` }} />
                </span>
                <span className="hud-label truncate text-[8.5px] leading-3 text-muted-foreground">{UNITS[PHASE_UNIT[p]].short}</span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
