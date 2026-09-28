import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { Search, SearchX } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-8 md:px-6 md:py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Glossary</h1>
        <p className="text-[15px] text-muted-foreground">
          Every technical word used in CNS Lab, in plain language. <span className="tabular-nums">{GLOSSARY.length}</span> terms.
        </p>
      </header>
      <div className="relative flex flex-col gap-2">
        <Label htmlFor="glossary-search">Search the glossary</Label>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input id="glossary-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="For example: radial, pulse, transponder" className="pl-9" />
        </div>
      </div>
      {filtered.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border bg-card p-6">
          <SearchX className="size-6 text-muted-foreground" aria-hidden />
          <p className="text-sm">No term matches “{q}”.</p>
          <Button variant="outline" size="sm" onClick={() => setQ('')}>
            Clear search
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {groups.map(([letter, entries]) => (
            <section key={letter} aria-labelledby={`letter-${letter}`}>
              <h2 id={`letter-${letter}`} className="mb-2 border-b pb-1 text-sm font-semibold text-muted-foreground">
                {letter}
              </h2>
              <dl className="flex flex-col">
                {entries.map((e) => {
                  const mod = e.module ? MODULE_BY_ID.get(e.module) : undefined
                  return (
                    <div
                      key={e.id}
                      id={e.id}
                      className={cn('scroll-mt-24 rounded-md px-3 py-3', target === e.id && 'bg-accent ring-1 ring-primary/40')}
                    >
                      <dt className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                        {e.term}
                        {mod && (
                          <Badge variant="outline" asChild>
                            <Link to={mod.path}>{mod.short}</Link>
                          </Badge>
                        )}
                      </dt>
                      <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">{e.definition}</dd>
                    </div>
                  )
                })}
              </dl>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
