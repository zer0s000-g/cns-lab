import { HudPanel } from '@/hud/HudFrame'
import { useSampled } from '@/hooks/useSampled'
import { cn } from '@/lib/utils'
import { MEDIUM_LABEL, UNITS } from '../atc'
import type { RadioMessage } from '../engine'
import { useSandbox } from '../state'
import { formatElapsed } from './useJourney'

function Line({ m, start }: { m: RadioMessage; start: number }) {
  const who = m.from === 'atc' ? UNITS[m.unit].callsign : m.from === 'pilot' ? 'CNS700' : 'Note'
  const datalink = m.medium === 'cpdlcSat' || m.medium === 'cpdlcVdl'
  return (
    <li className={cn('flex flex-col gap-0.5 border-l-2 py-1 pl-2.5', m.from === 'atc' ? 'border-signal/70' : m.from === 'pilot' ? 'border-brass/70' : 'border-hud-line', m.earlier && 'opacity-60')}>
      <p className="hud-label flex flex-wrap items-center gap-x-2 text-[9.5px]">
        <span className="text-foreground/80">{m.earlier ? 'Earlier' : `T+${formatElapsed(m.timeS - start)}`}</span>
        <span className={m.from === 'atc' ? 'text-signal' : m.from === 'pilot' ? 'text-brass' : ''}>{who}</span>
        {m.from !== 'note' && <span>{MEDIUM_LABEL[m.medium]}</span>}
      </p>
      <p className={cn('text-[13px] leading-5 text-foreground/90', datalink && 'hud-value text-[12px] tracking-wide', m.from === 'note' && 'text-muted-foreground italic')}>{m.text}</p>
      {m.status === 'blocked' && <p className="text-[12px] font-medium text-destructive">Not received: no working link for this message.</p>}
      {m.status === 'fallback' && <p className="text-[12px] text-warning">The usual link failed: sent by {MEDIUM_LABEL[m.medium]} instead.</p>}
    </li>
  )
}

/** Radio and data-link traffic with CNS700, newest first. Not announced live (it would flood at high speed). */
export function RadioLog({ className }: { className?: string }) {
  const { engine } = useSandbox()
  const data = useSampled(
    () => ({ lines: engine.radio.slice(0, 14), start: engine.journeyStartS }),
    300,
    (a, b) => a.start === b.start && a.lines.length === b.lines.length && a.lines[0]?.id === b.lines[0]?.id,
  )
  return (
    <HudPanel index="COM" title="Radio and data link" className={cn('flex min-h-0 flex-col', className)} bodyClassName="min-h-0 flex-1 overflow-y-auto px-4 py-3">
      {data.lines.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Quiet for now. The crew will call Clearance delivery shortly.</p>
      ) : (
        <ol className="flex flex-col gap-2" aria-label="Radio messages, newest first">
          {data.lines.map((m) => (
            <Line key={m.id} m={m} start={data.start} />
          ))}
        </ol>
      )}
    </HudPanel>
  )
}
