import { Link } from 'react-router'
import { ArrowRight, BookOpen, RadioReceiver } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ModuleCard } from '@/components/ModuleCard'
import { PILLAR_ICON } from '@/components/PillarBadge'
import { PILLARS, modulesByPillar } from '@/modules/registry'

/** Placeholder home page (Phase 0): planned modules grouped by pillar. */
export default function Home() {
  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-12 px-4 py-8 md:px-6 md:py-12">
      <section className="flex max-w-3xl flex-col gap-4">
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">CNS Lab</h1>
        <p className="text-[15px] leading-relaxed text-muted-foreground md:text-base">
          Every day, around a hundred thousand flights cross the sky safely. Explore the invisible radio systems that
          make it possible: how aircraft talk, find their way, and are seen by controllers.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link to="/modules/psr">
              Start with primary radar <ArrowRight aria-hidden />
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/glossary">
              <BookOpen aria-hidden /> Glossary
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/frequencies">
              <RadioReceiver aria-hidden /> Frequency chart
            </Link>
          </Button>
        </div>
      </section>

      {PILLARS.map((p) => {
        const Icon = PILLAR_ICON[p.id]
        return (
          <section key={p.id} aria-labelledby={`pillar-${p.id}`} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2 id={`pillar-${p.id}`} className="flex items-center gap-2 text-lg font-semibold tracking-tight">
                <Icon className="size-5 text-primary" aria-hidden />
                {p.name}
              </h2>
              <p className="text-sm text-muted-foreground">{p.question}</p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {modulesByPillar(p.id).map((m) => (
                <ModuleCard key={m.id} m={m} />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
