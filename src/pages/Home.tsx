import { Link } from 'react-router'
import { ArrowRight, BookOpen, CircleCheck, RadioReceiver, Route, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ModuleCard } from '@/components/ModuleCard'
import { PILLAR_ICON } from '@/components/PillarBadge'
import { SimLabel } from '@/components/sim/Controls'
import { LEARNING_PATH, MODULE_BY_ID, PILLARS, isModuleReady, modulesByPillar } from '@/modules/registry'
import { useProgress } from '@/stores/progress'
import { cn } from '@/lib/utils'
import { CnsIllustration } from './home/CnsIllustration'

export default function Home() {
  const progress = useProgress((s) => s.modules)
  const done = Object.values(progress).filter((p) => p.completed).length
  const firstUndone = LEARNING_PATH.find((id) => !progress[id]?.completed) ?? LEARNING_PATH[0]
  const next = MODULE_BY_ID.get(firstUndone)!

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-14 px-4 py-8 md:px-6 md:py-12">
      <section className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] lg:items-center" aria-labelledby="hero-title">
        <div className="flex flex-col gap-5">
          <p className="text-xs font-semibold tracking-wide text-primary uppercase">Communication · Navigation · Surveillance</p>
          <h1 id="hero-title" className="text-3xl font-semibold tracking-tight md:text-4xl">
            How the sky stays safe
          </h1>
          <p className="text-[15px] leading-relaxed text-muted-foreground md:text-base">
            Every day, around a hundred thousand flights cross the sky safely. Explore the invisible radio systems that
            make it possible.
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            CNS Lab is a hands-on laboratory. Drag aircraft, turn knobs, switch failures on and off, and watch the radio
            signals, timing and cockpit instruments respond. No aviation background needed.
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
                <RadioReceiver aria-hidden /> Frequency chart
              </Link>
            </Button>
          </div>
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldAlert className="size-4 shrink-0" aria-hidden />
            For educational use only, not for operational use.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">The CNS map</h2>
            <SimLabel icon="none">Not to scale</SimLabel>
          </div>
          <CnsIllustration />
        </div>
      </section>

      <LearningPath />

      <section aria-labelledby="modules-title" className="flex flex-col gap-8">
        <div className="flex flex-col gap-1">
          <h2 id="modules-title" className="text-xl font-semibold tracking-tight">
            All modules
          </h2>
          <p className="text-sm text-muted-foreground">
            Grouped the way air navigation service providers organise their equipment.{' '}
            <span className="tabular-nums">{done}</span> of <span className="tabular-nums">{PILLARS.reduce((n, p) => n + modulesByPillar(p.id).length, 0)}</span> completed.
          </p>
        </div>
        {PILLARS.map((p) => {
          const Icon = PILLAR_ICON[p.id]
          return (
            <div key={p.id} className="flex flex-col gap-3" role="group" aria-labelledby={`pillar-${p.id}`}>
              <div className="flex flex-col gap-0.5">
                <h3 id={`pillar-${p.id}`} className="flex items-center gap-2 text-base font-semibold">
                  <Icon className="size-5 text-primary" aria-hidden />
                  {p.name}
                </h3>
                <p className="text-sm text-muted-foreground">{p.question}</p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {modulesByPillar(p.id).map((m) => (
                  <ModuleCard key={m.id} m={m} />
                ))}
              </div>
            </div>
          )
        })}
      </section>
    </div>
  )
}

function LearningPath() {
  const progress = useProgress((s) => s.modules)
  return (
    <section aria-labelledby="path-title" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="path-title" className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <Route className="size-5 text-primary" aria-hidden /> Start here
        </h2>
        <p className="text-sm text-muted-foreground">
          A suggested path: each step builds on the one before, from radar to the whole airspace.
        </p>
      </div>
      <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {LEARNING_PATH.map((id, i) => {
          const m = MODULE_BY_ID.get(id)!
          const complete = progress[id]?.completed
          const ready = isModuleReady(id)
          return (
            <li key={id}>
              <Link
                to={m.path}
                className={cn(
                  'flex h-full items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:border-primary',
                  complete && 'border-success/40',
                )}
              >
                <span
                  className={cn(
                    'grid size-8 shrink-0 place-items-center rounded-full border font-mono text-xs font-semibold tabular-nums',
                    complete ? 'border-success bg-success/10 text-success' : 'border-border text-muted-foreground',
                  )}
                  aria-hidden
                >
                  {complete ? <CircleCheck className="size-4" /> : i + 1}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">{m.short}</span>
                  <span className="text-xs text-muted-foreground">
                    {complete ? 'Completed' : ready ? `About ${m.minutes} min` : 'Coming soon'}
                  </span>
                </span>
                <span className="sr-only">
                  Step {i + 1}: {m.name}. {complete ? 'Completed.' : ''}
                </span>
              </Link>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
