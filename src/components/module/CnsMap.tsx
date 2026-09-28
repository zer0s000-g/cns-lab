import { Link } from 'react-router'
import { MapPin } from 'lucide-react'
import { PILLAR_ICON } from '@/components/PillarBadge'
import { PILLARS, isModuleReady, modulesByPillar } from '@/modules/registry'
import { cn } from '@/lib/utils'

/** Small CNS map: every system grouped by pillar, with the current one highlighted. */
export function CnsMap({ current }: { current: string }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" role="list" aria-label="CNS map">
      {PILLARS.map((p) => {
        const mods = modulesByPillar(p.id)
        const here = mods.some((m) => m.id === current)
        const Icon = PILLAR_ICON[p.id]
        return (
          <div
            key={p.id}
            role="listitem"
            className={cn('flex flex-col gap-2 rounded-lg border p-3', here ? 'border-primary bg-accent/50' : 'bg-card')}
          >
            <p className="flex items-center gap-1.5 text-xs font-semibold">
              <Icon className="size-3.5" aria-hidden />
              {p.name}
              {here && <span className="ml-auto text-[11px] font-medium text-accent-foreground">This pillar</span>}
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {mods.map((m) => {
                const isCurrent = m.id === current
                const ready = isModuleReady(m.id)
                const chip = (
                  <span
                    className={cn(
                      'inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs',
                      isCurrent ? 'border-primary bg-primary font-semibold text-primary-foreground' : 'bg-background',
                      !ready && !isCurrent && 'border-dashed text-muted-foreground',
                    )}
                  >
                    {isCurrent && <MapPin className="size-3" aria-hidden />}
                    {m.short}
                  </span>
                )
                return (
                  <li key={m.id}>
                    {isCurrent ? (
                      <span aria-current="page" aria-label={`${m.short} (you are here)`}>
                        {chip}
                      </span>
                    ) : ready ? (
                      <Link to={m.path} className="rounded-md hover:opacity-80">
                        {chip}
                      </Link>
                    ) : (
                      <span title="Coming soon">{chip}</span>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
    </div>
  )
}
