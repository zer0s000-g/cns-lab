import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { Search, SearchX } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/PageHeader'
import { GLOSSARY } from '@/content/glossary'
import { MODULE_BY_ID } from '@/modules/registry'
import { cn } from '@/lib/utils'

export default function Glossary() {
  const [q, setQ] = useState('')
  const { hash } = useLocation()
  const target = hash.replace('#', '')

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return GLOSSARY
    return GLOSSARY.filter((e) => e.term.toLowerCase().includes(s) || e.definition.toLowerCase().includes(s))
  }, [q])

  const groups = useMemo(() => {
    const m = new Map<string, typeof GLOSSARY>()
    for (const e of filtered) {
      const k = /^[a-z]/i.test(e.term) ? e.term[0].toUpperCase() : '#'
      m.set(k, [...(m.get(k) ?? []), e])
    }
    return [...m.entries()]
  }, [filtered])

  useEffect(() => {
    if (!target) return
    const el = document.getElementById(target)
    el?.scrollIntoView({ block: 'center' })
  }, [target])

  const letters = groups.map(([l]) => l)

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-8 px-4 py-10 md:px-10 md:py-16">
      <PageHeader
        kicker="Reference · plain language"
        title="Glossary"
        sub={
          <>
            Every technical word used in CNS Lab, in plain language. <span className="tabular-nums">{GLOSSARY.length}</span> terms.
          </>
        }
      />
      <div className="grid gap-8 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-12">
        <div className="flex flex-col gap-5 lg:sticky lg:top-20 lg:self-start">
          <div className="flex flex-col gap-2">
            <Label htmlFor="glossary-search" className="hud-label">
              Search the glossary
            </Label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input id="glossary-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="radial, pulse, transponder" className="pl-9" />
            </div>
            <p className="hud-label text-[9.5px]" aria-live="polite">
              {filtered.length} of {GLOSSARY.length} shown
            </p>
          </div>
          {letters.length > 1 && (
            <nav aria-label="Jump to letter" className="flex flex-wrap gap-1">
              {letters.map((l) => (
                <a
                  key={l}
                  href={`#letter-${l}`}
                  onClick={(ev) => {
                    ev.preventDefault()
                    document.getElementById(`letter-${l}`)?.scrollIntoView({ block: 'start' })
                  }}
                  className="hud-value grid size-8 place-items-center rounded-[3px] border border-hud-line text-[11px] text-muted-foreground transition-colors hover:border-signal/60 hover:text-signal focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  {l}
                </a>
              ))}
            </nav>
          )}
        </div>
        {filtered.length === 0 ? (
          <div className="hud-panel flex flex-col items-start gap-3 rounded-md p-6">
            <SearchX className="size-6 text-muted-foreground" aria-hidden />
            <p className="text-sm">No term matches “{q}”.</p>
            <Button variant="outline" size="sm" onClick={() => setQ('')}>
              Clear search
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-10">
            {groups.map(([letter, entries]) => (
              <section key={letter} aria-labelledby={`letter-${letter}`} className="scroll-mt-20" id={`section-${letter}`}>
                <h2 id={`letter-${letter}`} className="hud-title mb-1 scroll-mt-20 border-b border-hud-line pb-2 text-[18px] text-signal">
                  {letter}
                </h2>
                <dl className="flex flex-col">
                  {entries.map((e) => {
                    const mod = e.module ? MODULE_BY_ID.get(e.module) : undefined
                    return (
                      <div
                        key={e.id}
                        id={e.id}
                        className={cn(
                          'grid scroll-mt-24 gap-1 border-b border-hud-line px-1 py-4 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)] md:gap-6',
                          target === e.id && 'bg-signal/[0.06] ring-1 ring-signal/40',
                        )}
                      >
                        <dt className="flex flex-col gap-1.5">
                          <span className="text-[15px] leading-6 text-foreground">{e.term}</span>
                          {mod && (
                            <Link to={mod.path} className="hud-label w-fit text-[9.5px] text-foreground/60 hover:text-signal">
                              {mod.short} →
                            </Link>
                          )}
                        </dt>
                        <dd className="text-[14px] leading-6 text-muted-foreground">{e.definition}</dd>
                      </div>
                    )
                  })}
                </dl>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
