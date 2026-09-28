import { useSampled } from '@/hooks/useSampled'
import { cn } from '@/lib/utils'

export interface DmeReading {
  /** Slant range, NM, or null when there is no lock. */
  distanceNm: number | null
  /** Rate of change of the slant range, kt (only a true groundspeed when flying straight to or from the station). */
  groundSpeedKt: number | null
  /** Minutes to the station at the current closure rate, or null. */
  timeToStationMin: number | null
  channel?: string
  ident?: string
  /** SEARCH while looking for replies, MEMORY while coasting on the last value. */
  status?: 'LOCK' | 'SEARCH' | 'MEMORY' | 'OFF'
}

const dashes = (n: number) => '-'.repeat(n)

/** Classic three-window DME display: distance, groundspeed, time to station. */
export function DMEReadout({ read, className, compact }: { read: () => DmeReading; className?: string; compact?: boolean }) {
  const r = useSampled(read, 200)
  const off = r.status === 'OFF'
  const dist = r.distanceNm == null || off ? `${dashes(3)}.${dashes(1)}` : r.distanceNm < 100 ? r.distanceNm.toFixed(1) : Math.round(r.distanceNm).toString()
  const gs = r.groundSpeedKt == null || off ? dashes(3) : Math.round(Math.abs(r.groundSpeedKt)).toString()
  const tts =
    r.timeToStationMin == null || off || !Number.isFinite(r.timeToStationMin) || r.timeToStationMin > 99
      ? dashes(2)
      : Math.round(r.timeToStationMin).toString()
  const status = r.status ?? 'LOCK'
  const spoken =
    off || r.distanceNm == null
      ? `DME: ${status === 'SEARCH' ? 'searching, no distance yet' : 'no reading'}.`
      : `DME: ${r.distanceNm.toFixed(1)} nautical miles, ${gs} knots${tts !== '--' ? `, ${tts} minutes` : ''}${status === 'MEMORY' ? ', memory mode' : ''}.`

  return (
    <div
      role="img"
      aria-label={spoken}
      className={cn('flex flex-col gap-2 rounded-lg border-2 border-instrument-bezel bg-instrument-face p-3 text-instrument-marking', className)}
    >
      <div className="flex items-center justify-between text-[11px] font-semibold tracking-wide text-instrument-dim">
        <span>DME{r.channel ? ` · ${r.channel}` : ''}</span>
        <span className={cn(status !== 'LOCK' && !off && 'text-scope-warning')}>
          {r.ident && status === 'LOCK' ? r.ident : status === 'LOCK' ? '' : status}
        </span>
      </div>
      <div className={cn('grid gap-2', compact ? 'grid-cols-3' : 'grid-cols-3')}>
        <Window value={dist} unit="NM" wide />
        <Window value={gs} unit="KT" />
        <Window value={tts} unit="MIN" />
      </div>
    </div>
  )
}

function Window({ value, unit, wide }: { value: string; unit: string; wide?: boolean }) {
  return (
    <div className={cn('flex flex-col items-end rounded-md bg-scope-bg px-2 py-1.5', wide && 'col-span-1')}>
      <span className="font-mono text-xl leading-7 font-semibold text-scope-trace tabular-nums">{value}</span>
      <span className="text-[10px] font-semibold tracking-wider text-instrument-dim">{unit}</span>
    </div>
  )
}
