import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowRight } from 'lucide-react'
import { CnsMap } from '@/components/module/CnsMap'
import { FailureList, type FailureItem } from '@/components/module/FailureList'
import { GoDeeper } from '@/components/module/GoDeeper'
import { Quiz, type QuizQuestion } from '@/components/module/Quiz'
import { Stepper, type Step } from '@/components/module/Stepper'
import { TryThis, type Experiment } from '@/components/module/TryThis'
import { scrollToSection } from '@/components/module/scroll'
import { ChapterScrubber } from '@/hud/ChapterScrubber'
import { CornerBrackets, TitleBlock } from '@/hud/HudFrame'
import { MissionClock } from '@/hud/MissionClock'
import { LazyStage } from '@/stage/LazyStage'
import type { Quality, Shot } from '@/stage/types'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { MODULE_BY_ID, isModuleReady, pillarName } from '@/modules/registry'
import { audio } from '@/lib/audio'
import { cn } from '@/lib/utils'

export const SECTIONS = [
  { id: 'idea', n: 1, title: 'The simple idea', short: 'Idea' },
  { id: 'simulator', n: 2, title: 'Simulator', short: 'Simulator' },
  { id: 'how', n: 3, title: 'How it works', short: 'How' },
  { id: 'try', n: 4, title: 'Try this', short: 'Try' },
  { id: 'wrong', n: 5, title: 'When things go wrong', short: 'Failures' },
  { id: 'deeper', n: 6, title: 'Go deeper', short: 'Spec' },
  { id: 'quiz', n: 7, title: 'Quick quiz', short: 'Quiz' },
] as const

export type ChapterId = (typeof SECTIONS)[number]['id']

export interface IdeaContent {
  /** Everyday analogy, shown first. */
  analogy: ReactNode
  /** What the system does, in plain words. */
  what: ReactNode
  /** Where it is used. */
  where: ReactNode
}

/** A module's 3D hero: the scene, one camera shot per chapter, and HUD extras. */
export interface StageSpec {
  scene: (t: ThemeTokens, quality: Quality) => ReactNode
  shots: Record<ChapterId, Shot>
  /** Optional shots for each "How it works" step (falls back to shots.how). */
  howShots?: Shot[]
  /** Kicker above the title, e.g. "S-band · 2.8 GHz". */
  kicker?: string
  /** Honesty labels shown on the stage, e.g. "Heights ×3.6". */
  labels?: string[]
  /** Telemetry column at the right edge of the stage. */
  telemetry?: ReactNode
  clock: { getTimeS: () => number; running: boolean; sub?: string }
  /** Accessible description of the scene. */
  label: string
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
  /** 3D hero. When given, the page becomes a scroll-driven stage. */
  stage?: StageSpec
}

/** Chapter heading used inside every chapter panel. */
export function ChapterHead({ n, title, lead }: { n: number; title: string; lead?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-col gap-2">
      <p className="hud-label flex items-center gap-2">
        <span className="text-signal">{String(n).padStart(2, '0')}</span>
        <span className="h-px w-6 bg-hud-line" aria-hidden />
        {SECTIONS[n - 1].short}
      </p>
      <h2 id={`${SECTIONS[n - 1].id}-title`} className="hud-title text-[19px] leading-tight text-foreground md:text-[22px]">
        {title}
      </h2>
      {lead && <p className="text-[13.5px] leading-6 text-muted-foreground">{lead}</p>}
    </header>
  )
}

export function Section({ id, n, title, children, className, lead }: { id: string; n: number; title: string; children: ReactNode; className?: string; lead?: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn('scroll-mt-20', className)}>
      <ChapterHead n={n} title={title} lead={lead} />
      {children}
    </section>
  )
}

/** The standard 7-chapter module page. */
export function ModuleLayout(props: ModuleLayoutProps) {
  const meta = MODULE_BY_ID.get(props.moduleId)
  const active = useActiveChapter()
  const [howStep, setHowStep] = useState(0)
  useEffect(() => () => audio.stopAll(), [])
  if (!meta) throw new Error(`Unknown module ${props.moduleId}`)
  const next = props.nextId ? MODULE_BY_ID.get(props.nextId) : undefined
  const st = props.stage
  const shot = st ? (active === 'how' ? (st.howShots?.[howStep] ?? st.shots.how) : st.shots[active]) : undefined

  const chapters = {
    idea: (
      <IdeaChapter meta={meta} idea={props.idea} cinematic={Boolean(st)} />
    ),
    how: <Stepper steps={props.howItWorks} onStepChange={setHowStep} showVisual={!st} />,
    try: <TryThis experiments={props.tryThis} />,
    wrong: (
      <>
        <FailureList items={props.failures} />
        {props.failuresNote && <div className="prose-lab mt-4 text-[13.5px] text-foreground/80">{props.failuresNote}</div>}
      </>
    ),
    deeper: <GoDeeper>{props.goDeeper}</GoDeeper>,
    quiz: (
      <>
        <Quiz moduleId={meta.id} questions={props.quiz} />
        {next && <NextLink next={next} />}
      </>
    ),
  }

  const leads: Partial<Record<ChapterId, string>> = {
    how: 'One step at a time.',
    try: 'Guided experiments. Make a guess before you reveal the answer.',
    wrong: 'Each lever is connected to the simulator.',
    quiz: 'Five questions. Every answer comes with an explanation.',
  }

  const scrubber = (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-4 pb-3 md:px-8">
      <div className="pointer-events-auto mx-auto max-w-[1440px] rounded-md border border-hud-line bg-background/80 px-3 pt-2.5 pb-1 backdrop-blur-md">
        <ChapterScrubber
          chapters={SECTIONS.map((s) => ({ id: s.id, label: s.short }))}
          active={active}
          onSelect={(id) => scrollToSection(id)}
        />
      </div>
    </div>
  )

  if (!st) {
    // Flat layout for modules without a 3D hero yet: same chrome, content in flow.
    return (
      <div className="relative pb-28">
        <header className="relative mx-auto max-w-[1440px] px-4 pt-10 pb-8 md:px-8 md:pt-14">
          <CornerBrackets inset={0} />
          <div className="px-4 py-6 md:px-8">
            <TitleBlock kicker={`${pillarName(meta.pillar)} · about ${meta.minutes} min`} title={meta.name} sub={meta.summary} />
          </div>
        </header>
        <div className="mx-auto flex max-w-[1440px] flex-col gap-16 px-4 md:px-8">
          <Section id="idea" n={1} title="The simple idea">
            {chapters.idea}
          </Section>
          <Section id="simulator" n={2} title="Simulator" lead="Change things and watch what happens. Everything responds live.">
            {props.simulator}
          </Section>
          {(['how', 'try', 'wrong', 'deeper', 'quiz'] as const).map((id) => {
            const s = SECTIONS.find((x) => x.id === id)!
            return (
              <Section key={id} id={id} n={s.n} title={s.title} lead={leads[id]}>
                <div className="hud-panel rounded-md p-5 md:p-7">{chapters[id]}</div>
              </Section>
            )
          })}
        </div>
        {scrubber}
      </div>
    )
  }

  const stageH = 'h-[42svh] md:h-[calc(100svh-3.5rem)]'
  return (
    <div className="relative pb-24">
      {/* The stage stays put while the chapters scroll over it. */}
      <div className={cn('sticky top-14 z-20 md:z-0', stageH)}>
        {/* The stage is a night scene in both themes, so its chrome always uses the dark tokens. */}
        <LazyStage className="dark absolute inset-0" shot={shot!} label={st.label}>
          {(t, q) => st.scene(t, q)}
        </LazyStage>
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-y-0 left-0 z-10 hidden w-[64%] bg-linear-to-r from-background from-35% via-background/80 to-transparent transition-opacity duration-700 md:block',
            active === 'idea' ? 'opacity-100' : 'opacity-0',
          )}
        />
        <div className="dark pointer-events-none absolute inset-0 z-10 text-foreground">
          <CornerBrackets inset={14} />
          <div className={cn('absolute top-8 left-10 hidden max-w-[60%] transition-opacity duration-500 md:block', active === 'idea' ? 'opacity-0' : 'opacity-100')}>
            <p className="hud-label mb-1 text-foreground/80">
              {pillarName(meta.pillar)} // {meta.short}
            </p>
            <p className="hud-title text-[12px] text-foreground/90 md:text-[14px]">{meta.name}</p>
          </div>
          <MissionClock className="absolute top-6 right-7 md:top-8 md:right-10" getTimeS={st.clock.getTimeS} running={st.clock.running} sub={st.clock.sub} />
          <div className="absolute top-[6.4rem] right-10 hidden w-[300px] flex-col items-end gap-4 md:flex">
            {st.labels && st.labels.length > 0 && (
              <div className="flex flex-col items-end gap-1 text-right">
                {st.labels.map((l) => (
                  <span key={l} className="hud-label text-[9.5px] leading-4 text-foreground/55">
                    {l}
                  </span>
                ))}
              </div>
            )}
            {st.telemetry && active !== 'simulator' && <div className="hidden w-56 lg:block">{st.telemetry}</div>}
          </div>
          {st.labels && st.labels.length > 0 && (
            <p className="hud-label absolute right-5 bottom-4 left-5 text-[8.5px] leading-3.5 text-foreground/60 md:hidden">{st.labels.join(' · ')}</p>
          )}
        </div>
      </div>

      <div className="relative z-10 md:-mt-[calc(100svh-3.5rem)]">
        <Chapter id="idea" className="md:items-end md:pb-40">
          <div className="w-full max-w-[560px]">{chapters.idea}</div>
        </Chapter>
        <Chapter id="simulator" wide>
          {props.simulator}
        </Chapter>
        {(['how', 'try', 'wrong', 'deeper', 'quiz'] as const).map((id) => {
          const s = SECTIONS.find((x) => x.id === id)!
          return (
            <Chapter key={id} id={id}>
              <div className={cn('hud-panel w-full rounded-md p-5 md:p-7', id === 'deeper' ? 'max-w-[760px] bg-background/90' : id === 'try' ? 'max-w-[760px]' : 'max-w-[600px]')}>
                <ChapterHead n={s.n} title={s.title} lead={leads[id]} />
                {chapters[id]}
              </div>
            </Chapter>
          )
        })}
      </div>
      {scrubber}
    </div>
  )
}

function Chapter({ id, children, wide, className }: { id: ChapterId; children: ReactNode; wide?: boolean; className?: string }) {
  return (
    <section
      id={id}
      data-chapter={id}
      aria-labelledby={`${id}-title`}
      className={cn(
        'pointer-events-none flex scroll-mt-14 px-4 py-10 md:min-h-[calc(100svh-3.5rem)] md:px-10 md:py-24 [&>*]:pointer-events-auto',
        wide ? 'md:items-stretch' : 'md:items-center',
        className,
      )}
    >
      {wide ? <div className="mx-auto w-full max-w-[1440px]">{children}</div> : children}
    </section>
  )
}

function IdeaChapter({ meta, idea, cinematic }: { meta: NonNullable<ReturnType<typeof MODULE_BY_ID.get>>; idea: IdeaContent; cinematic: boolean }) {
  return (
    <div className={cn('flex flex-col gap-6', cinematic && 'md:gap-7')}>
      {cinematic && (
        <div className="flex flex-col gap-3">
          <TitleBlock kicker={`${pillarName(meta.pillar)} · about ${meta.minutes} min`} title={meta.name} />
          <p className="max-w-[46ch] text-[15px] leading-7 text-foreground/80">{meta.summary}</p>
        </div>
      )}
      {cinematic && <ChapterHead n={1} title="The simple idea" />}
      <figure className="border-l-2 border-brass pl-5">
        <p className="hud-label mb-2 text-brass">Think of it like this</p>
        <blockquote className="text-[17px] leading-8 font-light text-foreground md:text-[18px]">{idea.analogy}</blockquote>
      </figure>
      <div className={cn('grid gap-6', !cinematic && 'lg:grid-cols-2')}>
        <div className="prose-lab text-foreground/85">{idea.what}</div>
        <div>
          <p className="hud-label mb-2">Where it is used</p>
          <div className="prose-lab text-[14px] text-foreground/80">{idea.where}</div>
        </div>
      </div>
      <div>
        <p className="hud-label mb-2">Where this fits in CNS</p>
        <CnsMap current={meta.id} />
      </div>
    </div>
  )
}

function NextLink({ next }: { next: NonNullable<ReturnType<typeof MODULE_BY_ID.get>> }) {
  return (
    <Link to={next.path} className="group mt-8 flex items-center justify-between gap-4 border-t border-hud-line pt-5">
      <span className="flex flex-col gap-1">
        <span className="hud-label">Next on the learning path</span>
        <span className="hud-title text-[13px] text-foreground">{next.name}</span>
        {!isModuleReady(next.id) && <span className="hud-label">Coming soon</span>}
      </span>
      <ArrowRight className="size-5 text-signal transition-transform group-hover:translate-x-1" aria-hidden />
    </Link>
  )
}

/** The chapter that crosses the middle of the viewport is the active one. */
function useActiveChapter(): ChapterId {
  const [active, setActive] = useState<ChapterId>('idea')
  const raf = useRef(0)
  useEffect(() => {
    const update = () => {
      raf.current = 0
      const mid = window.innerHeight * 0.5
      let current: ChapterId = 'idea'
      for (const s of SECTIONS) {
        const el = document.getElementById(s.id)
        if (el && el.getBoundingClientRect().top <= mid) current = s.id
      }
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = 'quiz'
      setActive(current)
    }
    const onScroll = () => {
      if (!raf.current) raf.current = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      cancelAnimationFrame(raf.current)
    }
  }, [])
  return active
}
