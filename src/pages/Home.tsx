import { useEffect, useState } from 'react'
import { lazyRetry } from '@/lib/lazyRetry'
import { Link, useNavigate } from 'react-router'
import { ArrowRight, ArrowUpRight, BookOpen, Check, RadioReceiver, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/hud/Controls'
import { CornerBrackets } from '@/hud/HudFrame'
import { LEARNING_PATH, MODULE_BY_ID, PILLARS, isModuleReady, modulesByPillar, pillarName } from '@/modules/registry'
import { useProgress } from '@/stores/progress'
import { cn } from '@/lib/utils'
import { LazyStage } from '@/stage/LazyStage'
import type { Shot } from '@/stage/types'
import { AIRPORT_ZOOM, WORLD_SITES, WORLD_TIME_SCALE, type WorldFilter } from './home/worldSites'

// three.js and the scene load after the page text (see LazyStage).
const WorldScene = lazyRetry(() => import('./home/World3D'))

const SHOT_START: Shot = { position: [2, 34, 26], target: [0, 0, 0], fov: 30 }
const SHOT_HERO: Shot = { position: [12, 10, 17], target: [-4.6, 1.2, 0.6], fov: 36 }
const SHOT_HERO_MOBILE: Shot = { position: [13, 15, 20], target: [0, 1.6, 0], fov: 42 }

const SITE_DESC = new Map([...WORLD_SITES.map((s) => [s.id, s.desc] as const), ['gnss', 'Satellites broadcast the exact time; a receiver measures the delays and works out where it is.'] as const])

export default function Home() {
  const progress = useProgress((s) => s.modules)
  const done = Object.values(progress).filter((p) => p.completed).length
  const firstUndone = LEARNING_PATH.find((id) => !progress[id]?.completed) ?? LEARNING_PATH[0]
  const next = MODULE_BY_ID.get(firstUndone)!
  const navigate = useNavigate()
  const [filter, setFilter] = useState<WorldFilter>('all')
  const [hover, setHover] = useState<string | null>(null)
  const [shot, setShot] = useState<Shot>(SHOT_START)
  const mobile = useIsMobile()
  // Fly in once the scene is up.
  useEffect(() => {
    const id = window.setTimeout(() => setShot(mobile ? SHOT_HERO_MOBILE : SHOT_HERO), 350)
    return () => window.clearTimeout(id)
  }, [mobile])
  const hovered = hover ? MODULE_BY_ID.get(hover) : undefined
  const total = PILLARS.reduce((n, p) => n + modulesByPillar(p.id).length, 0)

  return (
    <div className="flex flex-col">
      <section aria-labelledby="hero-title" className="relative md:h-[calc(100svh-3.5rem)] md:min-h-[640px]">
        <div className="relative h-[52svh] md:absolute md:inset-0 md:h-auto">
          <LazyStage
            interactive
            className="dark absolute inset-0"
            shot={shot}
            label="A tabletop model of an airspace with an airport, radars, radio beacons, satellites and aircraft. Each system is labelled and links to its module."
          >
            {(t) => <WorldScene t={t} filter={filter} hover={hover} onHover={setHover} onOpen={(id) => navigate(MODULE_BY_ID.get(id)!.path)} />}
          </LazyStage>
          <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 z-10 hidden w-[62%] bg-linear-to-r from-background from-30% via-background/80 to-transparent md:block" />
          <div className="dark pointer-events-none absolute inset-0 z-10 text-foreground">
            <CornerBrackets inset={14} />
            <p className="hud-label absolute right-5 bottom-4 left-5 text-[8.5px] text-foreground/60 md:right-10 md:bottom-8 md:left-auto md:text-right md:text-[10px]">
              Not to scale · airport drawn {AIRPORT_ZOOM}× larger · time ×{WORLD_TIME_SCALE}
            </p>
            {hovered && (
              <div className="hud-panel absolute right-10 bottom-16 hidden w-[320px] rounded-md p-4 md:block" role="status">
                <p className="hud-label mb-1.5 text-signal">
                  {pillarName(hovered.pillar)} // {hovered.short}
                </p>
                <p className="hud-title text-[13px] leading-5">{hovered.name}</p>
                <p className="mt-2 text-[13px] leading-5 text-foreground/75">{SITE_DESC.get(hovered.id) ?? hovered.summary}</p>
                <p className="hud-label mt-3 flex items-center gap-1 text-foreground/60">
                  Click to open <ArrowUpRight className="size-3" aria-hidden />
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="relative z-10 mx-auto flex h-full max-w-[1440px] flex-col justify-center gap-6 px-4 py-8 md:pointer-events-none md:px-10 md:py-16 [&>*]:pointer-events-auto">
          <div className="flex max-w-[560px] flex-col gap-5">
            <p className="hud-label flex items-center gap-2 text-foreground/80">
              <span aria-hidden className="block size-1.5 rounded-full bg-signal shadow-[0_0_8px_var(--signal)]" />
              Communication · Navigation · Surveillance
            </p>
            <h1 id="hero-title" className="hud-title text-[34px] leading-[1.08] text-foreground md:text-[56px]">
              How the sky stays safe
            </h1>
            <p className="max-w-[46ch] text-[15px] leading-7 text-foreground/80 md:text-[16px]">
              Around a hundred thousand flights cross the sky every day. Explore the invisible radio systems that keep
              them apart, find their way and land in fog.
            </p>
            <p className="max-w-[52ch] text-[13.5px] leading-6 text-muted-foreground">
              A hands-on laboratory: drag aircraft, turn knobs, switch failures on and off, and watch the signals,
              timing and cockpit instruments respond. No aviation background needed.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="lg">
                <Link to={next.path}>
                  {done === 0 ? 'Start with primary radar' : `Continue: ${next.short}`} <ArrowRight aria-hidden />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link to="/glossary">
                  <BookOpen aria-hidden /> Glossary
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link to="/frequencies">
                  <RadioReceiver aria-hidden /> Frequencies
                </Link>
              </Button>
            </div>
            <p className="hud-label flex items-center gap-2 text-foreground/70">
              <ShieldAlert className="size-3.5 shrink-0" aria-hidden />
              For educational use only, not for operational use.
            </p>
          </div>
          <div className="flex max-w-[560px] flex-col gap-2 md:mt-6">
            <Segmented
              label="Show on the map"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'communication', label: <Short short="Comm" long="Communication" />, ariaLabel: 'Communication' },
                { value: 'navigation', label: <Short short="Nav" long="Navigation" />, ariaLabel: 'Navigation' },
                { value: 'surveillance', label: <Short short="Surv" long="Surveillance" />, ariaLabel: 'Surveillance' },
              ]}
            />
            <p className="text-[12px] text-muted-foreground">
              {filter === 'all' ? 'Hover a label on the map to see what it does; click to open it.' : PILLARS.find((p) => p.id === filter)?.question}
            </p>
          </div>
        </div>
      </section>

      <LearningPath />

      <ModuleIndex done={done} total={total} />
    </div>
  )
}

function Short({ short, long }: { short: string; long: string }) {
  return (
    <>
      <span className="sm:hidden">{short}</span>
      <span className="hidden sm:inline">{long}</span>
    </>
  )
}

function useIsMobile() {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches)
  useEffect(() => {
    const q = window.matchMedia('(max-width: 767px)')
    const on = () => setM(q.matches)
    q.addEventListener('change', on)
    return () => q.removeEventListener('change', on)
  }, [])
  return m
}

function SectionHead({ index, title, sub, id }: { index: string; title: string; sub?: string; id: string }) {
  return (
    <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between md:gap-10">
      <div className="flex flex-col gap-2">
        <p className="hud-label flex items-center gap-3">
          <span className="text-signal">{index}</span>
          <span aria-hidden className="block h-px w-8 bg-hud-line" />
        </p>
        <h2 id={id} className="hud-title text-[22px] text-foreground md:text-[28px]">
          {title}
        </h2>
      </div>
      {sub && <p className="max-w-[52ch] text-[13.5px] leading-6 text-muted-foreground">{sub}</p>}
    </div>
  )
}

function LearningPath() {
  const progress = useProgress((s) => s.modules)
  const lastDone = LEARNING_PATH.reduce((acc, id, i) => (progress[id]?.completed ? i : acc), -1)
  const fill = LEARNING_PATH.length > 1 ? Math.max(0, lastDone) / (LEARNING_PATH.length - 1) : 0
  return (
    <section aria-labelledby="path-title" className="border-t border-hud-line">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-10 px-4 py-16 md:px-10 md:py-24">
        <SectionHead index="01" id="path-title" title="Start here" sub="A suggested path. Each step builds on the one before, from one radar to the whole airspace." />
        <div className="relative">
          <div aria-hidden className="absolute top-[15px] right-0 left-0 hidden h-px bg-hud-line lg:block" />
          <div aria-hidden className="absolute top-[15px] left-0 hidden h-px bg-signal shadow-[0_0_8px_var(--signal)] lg:block" style={{ width: `${fill * 100}%` }} />
          <ol className="relative grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-5 lg:grid-cols-10">
            {LEARNING_PATH.map((id, i) => {
              const m = MODULE_BY_ID.get(id)!
              const complete = progress[id]?.completed
              const ready = isModuleReady(id)
              return (
                <li key={id}>
                  <Link to={m.path} className="group flex flex-col gap-3 outline-none">
                    <span
                      aria-hidden
                      className={cn(
                        'grid size-[31px] place-items-center rounded-full border bg-background font-mono text-[11px] transition-colors',
                        complete ? 'border-signal text-signal shadow-[0_0_12px_-2px_var(--signal)]' : 'border-hud-line text-muted-foreground group-hover:border-foreground/50 group-hover:text-foreground',
                        'group-focus-visible:ring-3 group-focus-visible:ring-ring/50',
                      )}
                    >
                      {complete ? <Check className="size-3.5" /> : String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="flex flex-col gap-1">
                      <span className="text-[13.5px] leading-5 text-foreground group-hover:text-signal">{m.short}</span>
                      <span className="hud-label text-[9.5px]">{complete ? 'Done' : ready ? `${m.minutes} min` : 'Soon'}</span>
                    </span>
                    <span className="sr-only">
                      Step {i + 1}: {m.name}. {complete ? 'Completed.' : ''}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ol>
        </div>
      </div>
    </section>
  )
}

function ModuleIndex({ done, total }: { done: number; total: number }) {
  const progress = useProgress((s) => s.modules)
  let n = 0
  return (
    <section aria-labelledby="modules-title" className="border-t border-hud-line">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-12 px-4 py-16 md:px-10 md:py-24">
        <SectionHead
          index="02"
          id="modules-title"
          title="All systems"
          sub={`Grouped the way air navigation service providers organise their equipment. ${done} of ${total} completed.`}
        />
        <div className="flex flex-col gap-14">
          {PILLARS.map((p) => (
            <div key={p.id} role="group" aria-labelledby={`pillar-${p.id}`} className="grid gap-4 lg:grid-cols-[260px_1fr] lg:gap-10">
              <div className="flex flex-col gap-1.5 lg:sticky lg:top-20 lg:self-start">
                <h3 id={`pillar-${p.id}`} className="hud-title text-[14px] text-foreground">
                  {p.name}
                </h3>
                <p className="text-[13px] leading-5 text-muted-foreground">{p.question}</p>
              </div>
              <ul className="flex flex-col border-t border-hud-line">
                {modulesByPillar(p.id).map((m) => {
                  n += 1
                  const ready = isModuleReady(m.id)
                  const complete = progress[m.id]?.completed
                  return (
                    <li key={m.id} className="border-b border-hud-line">
                      <Link
                        to={m.path}
                        className="group grid grid-cols-[36px_1fr_auto] items-baseline gap-x-4 gap-y-1 py-4 outline-none focus-visible:bg-signal/[0.05] md:grid-cols-[48px_minmax(0,1.1fr)_minmax(0,1.4fr)_90px_24px] md:py-5"
                      >
                        <span className="hud-value text-[11px] text-muted-foreground group-hover:text-signal">{String(n).padStart(2, '0')}</span>
                        <span className="text-[16px] leading-6 text-foreground transition-colors group-hover:text-signal md:text-[18px]">{m.name}</span>
                        <ArrowRight className="size-4 self-center text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-signal md:hidden" aria-hidden />
                        <span className="col-span-2 col-start-2 text-[13px] leading-5 text-muted-foreground md:col-span-1 md:col-start-auto">{m.summary}</span>
                        <span className={cn('hud-label col-start-2 md:col-start-auto md:text-right', complete && 'text-signal')}>
                          {complete ? 'Done' : ready ? `${m.minutes} min` : 'Coming soon'}
                        </span>
                        <ArrowRight className="hidden size-4 self-center justify-self-end text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-signal md:block" aria-hidden />
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
