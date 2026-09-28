import { Link } from 'react-router'
import { PILLARS, isModuleReady, modulesByPillar } from '@/modules/registry'
import { cn } from '@/lib/utils'

/** Compact CNS index: every system grouped by pillar, the current one marked. */
export function CnsMap({ current }: { current: string }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4" role="list" aria-label="CNS map">
      {PILLARS.map((p) => {
        const mods = modulesByPillar(p.id)
        const here = mods.some((m) => m.id === current)
        return (
          <div key={p.id} role="listitem" className="flex flex-col gap-1.5">
            <p className={cn('hud-label border-b border-hud-line pb-1', here && 'text-signal')}>{p.name}</p>
            <ul className="flex flex-col gap-0.5">
              {mods.map((m) => {
                const isCurrent = m.id === current
                const ready = isModuleReady(m.id)
                const text = (
                  <span className={cn('flex items-center gap-1.5 text-[12.5px] leading-6', isCurrent ? 'text-foreground' : ready ? 'text-foreground/65 hover:text-foreground' : 'text-muted-foreground/50')}>
                    <span aria-hidden className={cn('inline-block size-1.5 rounded-full', isCurrent ? 'bg-signal shadow-[0_0_8px_var(--signal)]' : 'bg-foreground/20')} />
                    {m.short}
                  </span>
                )
                return (
                  <li key={m.id}>
                    {isCurrent ? (
                      <span aria-current="page" aria-label={`${m.short} (you are here)`}>
                        {text}
                      </span>
                    ) : ready ? (
                      <Link to={m.path}>{text}</Link>
                    ) : (
                      <span title="Coming soon">{text}</span>
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
