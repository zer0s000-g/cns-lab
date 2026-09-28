import { useMemo } from 'react'
import { Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { SimLabel } from '@/components/sim/Controls'
import { Term } from '@/components/Term'
import { averageChallenge, type ChallengeResult, type SegmentKind } from '@/core/cpdlc'
import { mulberry32 } from '@/core/random'
import { useSampled } from '@/hooks/useSampled'
import { cn } from '@/lib/utils'
import { useCpdlc, useCpdlcState } from './state'

const FILL: Record<SegmentKind, string> = {
  busy: 'fill-muted-foreground/30',
  say: 'fill-chart-1',
  blocked: 'fill-warning',
  readback: 'fill-chart-2',
  correct: 'fill-destructive',
  compose: 'fill-chart-5',
  uplink: 'fill-chart-1',
  pilot: 'fill-chart-2',
  downlink: 'fill-chart-3',
}

const LEGEND: { kind: SegmentKind; text: string }[] = [
  { kind: 'say', text: 'Controller speaks / message travels up' },
  { kind: 'readback', text: 'Pilot reads back / pilot reads and replies' },
  { kind: 'downlink', text: 'Reply travels down' },
  { kind: 'compose', text: 'Controller types the message' },
  { kind: 'busy', text: 'Frequency busy with other calls' },
  { kind: 'blocked', text: 'Blocked: said again' },
  { kind: 'correct', text: 'Wrong readback corrected' },
]

function Lane({ r, x, y0, rowH, playS }: { r: ChallengeResult; x: (s: number) => number; y0: number; rowH: number; playS: number }) {
  return (
    <g>
      {r.exchanges.map((ex, i) => (
        <g key={i}>
          {ex.segments.map((sg, k) => (
            <rect key={k} x={x(sg.fromS)} y={y0 + i * rowH + 1} width={Math.max(0.8, x(sg.toS) - x(sg.fromS))} height={rowH - 2} className={FILL[sg.kind]} rx="1" />
          ))}
          {ex.misheard && playS >= ex.endS && (
            <text x={x(ex.endS) + 4} y={y0 + i * rowH + rowH - 2} className="fill-destructive text-[9px] font-bold">
              misheard
            </text>
          )}
        </g>
      ))}
    </g>
  )
}

/** Ten aircraft on one busy frequency: clearances by voice and by CPDLC, side by side. */
export function Challenge() {
  const { engine } = useCpdlc()
  const n = useCpdlcState((s) => s.challengeN)
  const setN = useCpdlcState((s) => s.setChallengeN)
  const path = useCpdlcState((s) => s.path)
  const touch = useCpdlcState((s) => s.touch)
  useCpdlcState((s) => s.version)
  const st = useSampled(
    () => ({ elapsed: engine.challengeElapsedS(), done: engine.challenge?.done ?? false, has: engine.challenge != null, history: engine.challengeHistory.map((h) => ({ ...h })) }),
    100,
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  )
  const c = engine.challenge
  const avg = useMemo(() => averageChallenge(n, 200, mulberry32, path), [n, path])

  const W = 800
  const padL = 70
  const padR = 64
  const rowH = 11
  const lanes = c ? c.n : n
  const laneH = lanes * rowH
  const top = 18
  const gap = 34
  const H = top + laneH + gap + laneH + 28
  const T = c ? Math.ceil(Math.max(c.voice.totalS, c.cpdlc.totalS) / 30) * 30 : 150
  const x = (s: number) => padL + (s / T) * (W - padL - padR)
  const play = Math.min(st.elapsed, T)
  const doneCount = (r: ChallengeResult) => r.exchanges.filter((e) => e.endS <= st.elapsed).length

  return (
    <div className="flex min-w-0 flex-col gap-4 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-sm font-semibold">Challenge: voice or datalink on a busy frequency?</h3>
          <p className="text-xs text-muted-foreground">
            The controller must give every aircraft a new level. On voice the calls queue on one frequency, a{' '}
            <Term id="blocked-transmission">blocked transmission</Term> must be said again and a <Term id="readback-error">readback</Term> can go wrong. By
            CPDLC the messages go out one after another and run side by side.
          </p>
        </div>
        <SimLabel icon="none">Illustrative model</SimLabel>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup type="single" variant="outline" size="sm" spacing={0} value={String(n)} onValueChange={(v) => v && setN(Number(v))} aria-label="Number of clearances">
          <ToggleGroupItem value="5" className="px-3 text-xs">
            5 aircraft
          </ToggleGroupItem>
          <ToggleGroupItem value="10" className="px-3 text-xs">
            10 aircraft
          </ToggleGroupItem>
        </ToggleGroup>
        <Button
          size="sm"
          onClick={() => {
            engine.startChallenge(n)
            touch()
          }}
        >
          <Play aria-hidden /> {st.has ? 'Run again' : 'Run both'}
        </Button>
        <span className="text-xs text-muted-foreground">CPDLC uses the path chosen in the controls ({path === 'vhf' ? 'VHF data link' : path === 'satcom' ? 'SATCOM' : 'HF data link'}).</span>
      </div>

      {c ? (
        <figure className="flex flex-col gap-2">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full rounded-md border bg-sim-bg"
            role="img"
            aria-label={`Timeline after ${Math.round(st.elapsed)} seconds: voice has finished ${doneCount(c.voice)} of ${c.n} clearances, CPDLC ${doneCount(c.cpdlc)} of ${c.n}.`}
          >
            <defs>
              <clipPath id="cpdlc-play">
                <rect x="0" y="0" width={x(play)} height={H} />
              </clipPath>
            </defs>
            {/* Time grid */}
            {Array.from({ length: Math.floor(T / 30) + 1 }, (_, k) => k * 30).map((s) => (
              <g key={s}>
                <line x1={x(s)} y1={top - 4} x2={x(s)} y2={H - 22} className="stroke-sim-grid" />
                <text x={x(s)} y={H - 8} textAnchor="middle" className="fill-sim-muted font-mono text-[10px]">
                  {s} s
                </text>
              </g>
            ))}
            <text x="8" y={top + laneH / 2 + 4} className="fill-sim-ink text-[12px] font-semibold">
              Voice
            </text>
            <text x="8" y={top + laneH + gap + laneH / 2 + 4} className="fill-sim-ink text-[12px] font-semibold">
              CPDLC
            </text>
            <g clipPath="url(#cpdlc-play)">
              <Lane r={c.voice} x={x} y0={top} rowH={rowH} playS={st.elapsed} />
              <Lane r={c.cpdlc} x={x} y0={top + laneH + gap} rowH={rowH} playS={st.elapsed} />
            </g>
            {/* Finish marks */}
            {[
              { r: c.voice, y: top },
              { r: c.cpdlc, y: top + laneH + gap },
            ].map(({ r, y }) =>
              st.elapsed >= r.totalS ? (
                <g key={r.method}>
                  <line x1={x(r.totalS)} y1={y - 3} x2={x(r.totalS)} y2={y + laneH + 3} className="stroke-sim-ink" strokeWidth="2" />
                  <text x={x(r.totalS) + 4} y={y + 8} className="fill-sim-ink font-mono text-[10px] font-semibold">
                    {Math.round(r.totalS)} s
                  </text>
                </g>
              ) : null,
            )}
            <line x1={x(play)} y1={top - 6} x2={x(play)} y2={H - 22} className="stroke-sim-warning" strokeWidth="1.5" />
          </svg>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            {LEGEND.map((l) => (
              <li key={l.kind} className="inline-flex items-center gap-1.5">
                <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden>
                  <rect width="10" height="10" rx="2" className={FILL[l.kind]} />
                </svg>
                {l.text}
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Voice: done" value={`${doneCount(c.voice)} of ${c.n}`} />
            <Stat label="CPDLC: done" value={`${doneCount(c.cpdlc)} of ${c.n}`} />
            <Stat
              label="Voice: misheard / corrected"
              value={`${c.voice.exchanges.filter((e) => e.misheard && e.endS <= st.elapsed).length} / ${c.voice.exchanges.filter((e) => e.corrected && e.endS <= st.elapsed).length}`}
              tone={c.voice.exchanges.some((e) => e.misheard && e.endS <= st.elapsed) ? 'alert' : undefined}
            />
            <Stat label="CPDLC: misheard" value="0" />
          </div>
        </figure>
      ) : (
        <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">Press “Run both” to watch the two methods side by side on the simulator clock.</p>
      )}

      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium text-muted-foreground">Results</p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Run</TableHead>
              <TableHead className="text-right">Voice: all done</TableHead>
              <TableHead className="text-right">Misheard</TableHead>
              <TableHead className="text-right">CPDLC: all done</TableHead>
              <TableHead className="text-right">Misheard</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {st.history.map((h, k) => (
              <TableRow key={k}>
                <TableCell>
                  {h.n} aircraft, {h.path === 'vhf' ? 'VHF' : h.path === 'satcom' ? 'SATCOM' : 'HF'}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">{Math.round(h.voiceS)} s</TableCell>
                <TableCell className={cn('text-right font-mono tabular-nums', h.voiceMisheard > 0 && 'text-destructive')}>{h.voiceMisheard}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{Math.round(h.cpdlcS)} s</TableCell>
                <TableCell className="text-right font-mono tabular-nums">0</TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-muted/50">
              <TableCell className="font-medium">Average of 200 runs ({n} aircraft)</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{Math.round(avg.voiceTotalS)} s</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{avg.voiceMisheardPerRun.toFixed(2)}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{Math.round(avg.cpdlcTotalS)} s</TableCell>
              <TableCell className="text-right font-mono tabular-nums">0</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <p className="text-xs text-muted-foreground">
          One exchange on average: voice about {Math.round(avg.voiceOneS)} s, CPDLC about {Math.round(avg.cpdlcOneS)} s from Send to the reply. On voice the
          frequency is busy the whole time; with CPDLC it stays free for urgent calls.
        </p>
      </div>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'alert' }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-md border px-3 py-2">
      <span className="truncate text-xs text-muted-foreground">{label}</span>
      <span className={cn('font-mono text-sm font-semibold tabular-nums', tone === 'alert' && 'text-destructive')}>{value}</span>
    </div>
  )
}
