import { Link } from 'react-router'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PillarBadge, PILLAR_ICON } from '@/components/PillarBadge'
import { FREQUENCY_BANDS, formatHz } from '@/content/frequencies'
import { MODULE_BY_ID, pillarName } from '@/modules/registry'
import { cn } from '@/lib/utils'

const MIN = 100e3
const MAX = 20e9
const DECADES = [1e5, 1e6, 1e7, 1e8, 1e9, 1e10]
const ITU = [
  { from: 30e3, to: 300e3, label: 'LF' },
  { from: 300e3, to: 3e6, label: 'MF' },
  { from: 3e6, to: 30e6, label: 'HF' },
  { from: 30e6, to: 300e6, label: 'VHF' },
  { from: 300e6, to: 3e9, label: 'UHF' },
  { from: 3e9, to: 30e9, label: 'SHF' },
]

/** Position (0..100%) of a frequency on the log axis. */
const pos = (hz: number) => ((Math.log10(Math.max(MIN, Math.min(MAX, hz))) - Math.log10(MIN)) / (Math.log10(MAX) - Math.log10(MIN))) * 100

const PILLAR_BAR: Record<string, string> = {
  communication: 'bg-chart-4',
  navigation: 'bg-chart-3',
  surveillance: 'bg-chart-1',
}

/** Where every CNS system sits in the radio spectrum. */
export default function Frequencies() {
  const sorted = [...FREQUENCY_BANDS].sort((a, b) => a.fromHz - b.fromHz)
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-8 md:px-6 md:py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Frequency chart</h1>
        <p className="text-[15px] text-muted-foreground">
          Where every system in CNS Lab lives in the radio spectrum. Low frequencies (left) hug the ground and bend around
          the Earth; high frequencies (right) travel in straight lines and carry fine detail.
        </p>
      </header>

      <figure className="flex flex-col gap-3 rounded-lg border bg-card p-4">
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground" aria-hidden>
          {(['surveillance', 'navigation', 'communication'] as const).map((p) => {
            const Icon = PILLAR_ICON[p]
            return (
              <span key={p} className="inline-flex items-center gap-1.5">
                <span className={cn('inline-block h-2.5 w-5 rounded-sm', PILLAR_BAR[p])} />
                <Icon className="size-3.5" /> {pillarName(p)}
              </span>
            )
          })}
        </div>
        <div className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
          <div />
          <div className="relative h-7 border-b" aria-hidden>
            {ITU.map((b) => {
              const l = pos(b.from)
              const r = pos(b.to)
              if (r <= 0) return null
              return (
                <span
                  key={b.label}
                  className="absolute top-0 flex h-full items-center justify-center border-l text-[11px] font-semibold text-muted-foreground"
                  style={{ left: `${Math.max(0, l)}%`, width: `${r - Math.max(0, l)}%` }}
                >
                  {b.label}
                </span>
              )
            })}
          </div>
          {sorted.map((b) => {
            const m = b.moduleId ? MODULE_BY_ID.get(b.moduleId) : undefined
            const l = pos(b.fromHz)
            const w = Math.max(0.6, pos(b.toHz) - l)
            return (
              <div key={b.id} className="contents">
                <div className="flex min-h-8 items-center truncate py-1 text-xs font-medium" title={b.system}>
                  {m ? (
                    <Link to={m.path} className="truncate hover:text-primary hover:underline">
                      {b.system}
                    </Link>
                  ) : (
                    b.system
                  )}
                </div>
                <div className="relative min-h-8 border-l">
                  {DECADES.map((d) => (
                    <span key={d} className="absolute top-0 h-full border-l border-dashed border-border" style={{ left: `${pos(d)}%` }} aria-hidden />
                  ))}
                  <span
                    className={cn('absolute top-1/2 h-3 -translate-y-1/2 rounded-sm', PILLAR_BAR[b.pillar])}
                    style={{ left: `${l}%`, width: `max(4px, ${w}%)` }}
                    aria-label={`${b.system}: ${formatHz(b.fromHz)} to ${formatHz(b.toHz)}`}
                    role="img"
                  />
                </div>
              </div>
            )
          })}
          <div />
          <div className="relative mt-1 h-5" aria-hidden>
            {DECADES.map((d) => (
              <span key={d} className="absolute -translate-x-1/2 font-mono text-[10px] whitespace-nowrap text-muted-foreground tabular-nums" style={{ left: `${pos(d)}%` }}>
                {formatHz(d)}
              </span>
            ))}
          </div>
        </div>
        <figcaption className="text-xs text-muted-foreground">Logarithmic scale: each dashed line is ten times the frequency of the one before.</figcaption>
      </figure>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 bg-background">System</TableHead>
              <TableHead>Pillar</TableHead>
              <TableHead className="text-right">From</TableHead>
              <TableHead className="text-right">To</TableHead>
              <TableHead>Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((b) => {
              const m = b.moduleId ? MODULE_BY_ID.get(b.moduleId) : undefined
              return (
                <TableRow key={b.id}>
                  <TableCell className="sticky left-0 bg-background font-medium">
                    {m ? (
                      <Link to={m.path} className="text-primary hover:underline">
                        {b.system}
                      </Link>
                    ) : (
                      b.system
                    )}
                  </TableCell>
                  <TableCell>
                    <PillarBadge pillar={b.pillar} />
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatHz(b.fromHz)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatHz(b.toHz)}</TableCell>
                  <TableCell className="min-w-64 text-muted-foreground">{b.note}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
