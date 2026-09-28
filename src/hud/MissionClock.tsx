import { useSampled } from '@/hooks/useSampled'
import { cn } from '@/lib/utils'

export function formatMissionTime(s: number): string {
  const t = Math.max(0, Math.floor(s))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const sec = t % 60
  return `T+${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

/** Top-right mission clock showing simulation time, with a small status strip. */
export function MissionClock({ getTimeS, sub, running, className }: { getTimeS: () => number; sub?: string; running: boolean; className?: string }) {
  const t = useSampled(getTimeS, 250)
  return (
    <div className={cn('flex flex-col items-end gap-1', className)} aria-label={`Simulation time ${formatMissionTime(t)}`}>
      <span className="hud-value text-[18px] leading-none text-foreground md:text-[20px]">{formatMissionTime(t)}</span>
      <span className="hud-label flex items-center gap-1.5">
        {sub}
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            aria-hidden
            className={cn('inline-block h-[3px] w-3', i === Math.floor(t) % 4 && running ? 'bg-signal' : 'bg-foreground/20')}
          />
        ))}
      </span>
    </div>
  )
}
