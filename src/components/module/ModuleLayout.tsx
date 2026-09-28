import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowRight, Clock, Lightbulb } from 'lucide-react'
import { PillarBadge } from '@/components/PillarBadge'
import { CnsMap } from '@/components/module/CnsMap'
import { FailureList, type FailureItem } from '@/components/module/FailureList'
import { GoDeeper } from '@/components/module/GoDeeper'
import { Quiz, type QuizQuestion } from '@/components/module/Quiz'
import { Stepper, type Step } from '@/components/module/Stepper'
import { TryThis, type Experiment } from '@/components/module/TryThis'
import { MODULE_BY_ID, isModuleReady } from '@/modules/registry'
import { audio } from '@/lib/audio'
import { cn } from '@/lib/utils'

export const SECTIONS = [
  { id: 'idea', n: 1, title: 'The simple idea' },
  { id: 'simulator', n: 2, title: 'Simulator' },
  { id: 'how', n: 3, title: 'How it works' },
  { id: 'try', n: 4, title: 'Try this' },
  { id: 'wrong', n: 5, title: 'When things go wrong' },
  { id: 'deeper', n: 6, title: 'Go deeper' },
  { id: 'quiz', n: 7, title: 'Quick quiz' },
] as const

export interface IdeaContent {
  /** Everyday analogy, shown first. */
  analogy: ReactNode
  /** What the system does, in plain words. */
  what: ReactNode
  /** Where it is used. */
  where: ReactNode
}

export interface ModuleLayoutProps {
  moduleId: string
  idea: IdeaContent
  simulator: ReactNode
  howItWorks: Step[]
  tryThis: Experiment[]
  failures: FailureItem[]
  /** Extra content under the failure cards (optional). */
  failuresNote?: ReactNode
  goDeeper: ReactNode
  quiz: QuizQuestion[]
  /** Module to suggest next. */
  nextId?: string
}

export function Section({ id, n, title, children, className, lead }: { id: string; n: number; title: string; children: ReactNode; className?: string; lead?: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn('scroll-mt-20', className)}>
      <div className="mb-4 flex flex-col gap-1">
        <h2 id={`${id}-title`} className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
          <span className="grid size-6 place-items-center rounded-md border font-mono text-xs text-muted-foreground tabular-nums">{n}</span>
          {title}
        </h2>
        {lead && <p className="text-sm text-muted-foreground">{lead}</p>}
      </div>
      {children}
    </section>
  )
}

/** The standard 7-section module page. */
export function ModuleLayout(props: ModuleLayoutProps) {
  const meta = MODULE_BY_ID.get(props.moduleId)
  const active = useActiveSection()
  useEffect(() => () => audio.stopAll(), [])
  if (!meta) throw new Error(`Unknown module ${props.moduleId}`)
  const next = props.nextId ? MODULE_BY_ID.get(props.nextId) : undefined

  return (
    <div className="mx-auto flex max-w-[1440px] gap-8 px-4 py-6 md:px-6 md:py-8">
      <div className="flex min-w-0 flex-1 flex-col gap-12">
        <header className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <PillarBadge pillar={meta.pillar} />
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="size-3.5" aria-hidden /> About {meta.minutes} minutes
            </span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{meta.name}</h1>
          <p className="max-w-3xl text-[15px] leading-relaxed text-muted-foreground">{meta.summary}</p>
        </header>

        <Section id="idea" n={1} title="The simple idea">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <div className="flex flex-col gap-4">
              <div className="rounded-lg border border-primary/30 bg-accent/60 p-4 md:p-5">
                <p className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-wide text-accent-foreground uppercase">
                  <Lightbulb className="size-4" aria-hidden /> Think of it like this
                </p>
                <div className="prose-lab">{props.idea.analogy}</div>
              </div>
              <div className="prose-lab">{props.idea.what}</div>
            </div>
            <div className="flex flex-col gap-4">
              <div className="rounded-lg border bg-card p-4">
                <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Where it is used</p>
                <div className="prose-lab text-sm">{props.idea.where}</div>
              </div>
            </div>
          </div>
          <div className="mt-4">
            <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Where this fits in CNS</p>
            <CnsMap current={meta.id} />
          </div>
        </Section>

        <Section id="simulator" n={2} title="Simulator" lead="Change things and watch what happens. Everything here responds live.">
          {props.simulator}
        </Section>

        <Section id="how" n={3} title="How it works" lead="One step at a time.">
          <Stepper steps={props.howItWorks} />
        </Section>

        <Section id="try" n={4} title="Try this" lead="Guided experiments. Make a guess before you reveal the answer.">
          <TryThis experiments={props.tryThis} />
        </Section>

        <Section id="wrong" n={5} title="When things go wrong" lead="Each switch here is connected to the simulator above.">
          <FailureList items={props.failures} />
          {props.failuresNote && <div className="prose-lab mt-4 text-sm">{props.failuresNote}</div>}
        </Section>

        <Section id="deeper" n={6} title="Go deeper">
          <GoDeeper>{props.goDeeper}</GoDeeper>
        </Section>

        <Section id="quiz" n={7} title="Quick quiz" lead="Five questions. No pressure: every answer comes with an explanation.">
          <Quiz moduleId={meta.id} questions={props.quiz} />
        </Section>

        {next && (
          <Link
            to={next.path}
            className="group flex items-center justify-between gap-4 rounded-lg border bg-card p-4 hover:border-primary"
          >
            <span className="flex flex-col">
              <span className="text-xs text-muted-foreground">Next on the learning path</span>
              <span className="text-sm font-semibold">{next.name}</span>
              {!isModuleReady(next.id) && <span className="text-xs text-muted-foreground">Coming soon</span>}
            </span>
            <ArrowRight className="size-5 text-primary transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
        )}
      </div>

      <nav aria-label="On this page" className="sticky top-20 hidden h-fit w-48 shrink-0 min-[1440px]:block">
        <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">On this page</p>
        <ol className="flex flex-col gap-0.5 border-l">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className={cn(
                  '-ml-px flex h-8 items-center border-l-2 border-transparent pl-3 text-sm text-muted-foreground hover:text-foreground',
                  active === s.id && 'border-primary font-medium text-foreground',
                )}
              >
                {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
    </div>
  )
}

function useActiveSection(): string {
  const [active, setActive] = useState<string>('idea')
  useEffect(() => {
    const els = SECTIONS.map((s) => document.getElementById(s.id)).filter((e): e is HTMLElement => Boolean(e))
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (vis[0]) setActive(vis[0].target.id)
      },
      { rootMargin: '-80px 0px -60% 0px' },
    )
    els.forEach((e) => io.observe(e))
    return () => io.disconnect()
  }, [])
  return active
}
