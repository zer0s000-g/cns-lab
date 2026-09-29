import { Link } from 'react-router'
import { PILLAR_ICON } from '@/components/PillarBadge'
import { HudPanel } from '@/hud/HudFrame'
import { useSampled } from '@/hooks/useSampled'
import { MODULE_BY_ID, pillarName } from '@/modules/registry'
import { cn } from '@/lib/utils'
import { isOnGround, transponderOn } from '../phases'
import { STATE_LABEL, systemsNow, type SysRow, type SysState } from '../systemsNow'
import { useSandbox } from '../state'

const TONE: Record<SysState, string> = {
  inUse: 'border-signal/60 text-signal',
  standby: 'border-hud-line text-muted-foreground',
  failed: 'border-destructive/60 text-destructive',
  unavailable: 'border-hud-line text-muted-foreground/80',
}

function Row({ r }: { r: SysRow }) {
  const mod = MODULE_BY_ID.get(r.moduleId)
  return (
    <li className="flex items-start gap-2.5 py-1.5">
      <span aria-hidden className={cn('mt-1.5 inline-block size-2 shrink-0 rounded-full', r.state === 'inUse' ? 'bg-signal shadow-[0_0_8px_var(--signal)]' : r.state === 'failed' ? 'bg-destructive' : 'border border-foreground/40')} />
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline justify-between gap-2">
          {mod ? (
            <Link to={mod.path} className={cn('text-[13px] underline-offset-4 hover:underline', r.state === 'inUse' ? 'text-foreground' : 'text-foreground/75')}>
              {r.name}
            </Link>
          ) : (
            <span className="text-[13px]">{r.name}</span>
          )}
          <span className={cn('hud-label shrink-0 rounded-[3px] border px-1 text-[9px]', TONE[r.state])}>{STATE_LABEL[r.state]}</span>
        </p>
        <p className="text-[11.5px] leading-4 text-muted-foreground">{r.note}</p>
      </div>
    </li>
  )
}

/** Which systems serve CNS700 right now, grouped by pillar, each linking to its module. */
export function SystemsPanel({ className }: { className?: string }) {
  const { engine } = useSandbox()
  const rows = useSampled(
    () => {
      const a = engine.journeyAircraft
      if (!a) return []
      return systemsNow({
        phase: engine.phase,
        av: engine.availabilityFor(a),
        sources: engine.sources(a.id),
        up: (id) => engine.systemUp(id),
        transponderOn: transponderOn(a),
        onGround: isOnGround(a),
        onIls: a.journey?.phase === 'final',
      })
    },
    400,
    (x, y) => JSON.stringify(x) === JSON.stringify(y),
  )
  const inUse = rows.filter((r) => r.state === 'inUse').length
  return (
    <HudPanel index="CNS" title="Systems in use now" actions={<span className="hud-label text-signal">{inUse} active</span>} className={className} bodyClassName="flex flex-col gap-3 px-4 py-3">
      {(['communication', 'navigation', 'surveillance'] as const).map((p) => {
        const Icon = PILLAR_ICON[p]
        return (
          <section key={p} aria-label={pillarName(p)}>
            <p className="hud-label flex items-center gap-1.5 border-b border-hud-line pb-1">
              <Icon className="size-3.5" aria-hidden /> {pillarName(p)}
            </p>
            <ul>
              {rows
                .filter((r) => r.pillar === p)
                .map((r) => (
                  <Row key={r.id} r={r} />
                ))}
            </ul>
          </section>
        )
      })}
    </HudPanel>
  )
}
