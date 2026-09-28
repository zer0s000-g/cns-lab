import { Link } from 'react-router'
import { Clock3, MapPin, MessageSquareText, Phone, Radar, Send, X } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { SimLabel } from '@/components/sim/Controls'
import { Term } from '@/components/Term'
import { slowMotionFor, slowMotionLabel } from '@/core/clock'
import { useSampled } from '@/hooks/useSampled'
import { cn } from '@/lib/utils'
import { SERVICE_NAME, type Service } from './engine'
import { formatDuration, formatMs, STATE_TEXT } from './format'
import { useSatcom, useSatcomState } from './state'

/** Real seconds the slow-motion trip of one message should take on screen. */
export const REPLAY_REAL_S = 5

const SEND_LABEL: Record<Service, string> = {
  voice: 'Send a voice call',
  cpdlc: 'Send a CPDLC message',
  adsc: 'Send an ADS-C report',
  adsb: 'Send an ADS-B broadcast',
}

const SERVICES: { id: Service; short: string; icon: typeof Phone }[] = [
  { id: 'voice', short: 'Voice', icon: Phone },
  { id: 'cpdlc', short: 'CPDLC', icon: MessageSquareText },
  { id: 'adsc', short: 'ADS-C', icon: MapPin },
  { id: 'adsb', short: 'ADS-B', icon: Radar },
]

function ServiceText({ id }: { id: Service }) {
  if (id === 'voice')
    return (
      <>
        Pilot and controller talk through the satellite, like a phone call (<Term id="satvoice">SATVOICE</Term>). What matters is the wait
        between a question and its answer.
      </>
    )
  if (id === 'cpdlc')
    return (
      <>
        A text clearance or request, sent as data. See the{' '}
        <Link to="/modules/cpdlc" className="font-medium text-primary underline underline-offset-2">
          CPDLC module
        </Link>
        .
      </>
    )
  if (id === 'adsc')
    return (
      <>
        An automatic position report the aircraft sends to the oceanic centre every few minutes, as agreed in a contract (<Term id="ads-c">ADS-C</Term>).
      </>
    )
  return (
    <>
      <Term id="space-based-ads-b">Space-based ADS-B</Term>: receivers on low-orbit satellites pick up the aircraft’s normal ADS-B broadcast, even in the
      middle of the ocean. It uses the aircraft’s transponder, not its SATCOM antenna.
    </>
  )
}

/** Send one message and watch its trip add up, leg by leg. */
export function LatencyMeter() {
  const { engine } = useSatcom()
  const service = useSatcomState((s) => s.service)
  const setService = useSatcomState((s) => s.setService)
  const send = useSatcomState((s) => s.send)
  const cancelPending = useSatcomState((s) => s.cancelPending)
  const st = useSampled(
    () => {
      const r = engine.replay
      return {
        replay: r
          ? {
              t: r.tS,
              total: r.path.propagationS,
              done: r.done,
              legs: r.path.legs.map((l) => ({ label: l.label, km: l.distanceM / 1000, s: l.delayS, kind: l.kind })),
              processing: r.processingS,
              queue: r.queueS,
              service: r.service,
              system: r.constellation,
              sat: r.path.satName,
              station: r.path.stationName,
            }
          : null,
        pending: engine.pending ? { service: engine.pending.service, waited: engine.timeS - engine.pending.queuedAtS } : null,
        unavailable: engine.serviceUnavailable(service),
        linkState: engine.link.state,
        results: engine.results.map((x) => ({ ...x })),
      }
    },
    50,
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  )
  const r = st.replay
  const playing = r != null && !r.done
  const slow = r ? slowMotionLabel(slowMotionFor(r.total * 1e6, REPLAY_REAL_S)) : ''

  // Merge consecutive inter-satellite hops into one bar segment.
  const segs: { label: string; km: number; s: number; kind: string; start: number; hops: number }[] = []
  if (r) {
    let start = 0
    for (const l of r.legs) {
      const last = segs[segs.length - 1]
      if (l.kind === 'isl' && last && last.kind === 'isl') {
        last.km += l.km
        last.s += l.s
        last.hops++
      } else segs.push({ ...l, start, hops: l.kind === 'isl' ? 1 : 0 })
      start += l.s
    }
    let acc = 0
    for (const sg of segs) {
      sg.start = acc
      acc += sg.s
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4 rounded-lg border bg-card p-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">Latency meter</h3>
        <p className="text-xs text-muted-foreground">Send a message and watch the delay add up. Time freezes while the message travels.</p>
      </div>
      <div className="flex flex-col gap-2">
        <span id="satcom-service" className="text-xs font-medium text-muted-foreground">
          What travels over the satellite link
        </span>
        <ToggleGroup
          type="single"
          variant="outline"
          spacing={0}
          value={service}
          onValueChange={(v) => v && setService(v as Service)}
          aria-labelledby="satcom-service"
          className="w-full"
        >
          {SERVICES.map((sv) => (
            <ToggleGroupItem key={sv.id} value={sv.id} aria-label={SERVICE_NAME[sv.id]} className="flex-1 gap-1.5 px-2 text-xs">
              <sv.icon className="size-3.5" aria-hidden />
              {sv.short}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="text-sm text-muted-foreground">
          <ServiceText id={service} />
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={send} disabled={Boolean(st.unavailable) || playing || st.pending != null}>
          <Send aria-hidden /> {SEND_LABEL[service]}
        </Button>
        {st.pending && (
          <Button size="sm" variant="outline" onClick={cancelPending}>
            <X aria-hidden /> Cancel
          </Button>
        )}
        {st.unavailable && <span className="text-xs text-warning">{st.unavailable}</span>}
      </div>

      {st.pending && (
        <Alert>
          <Clock3 aria-hidden />
          <AlertTitle>Waiting for a link: {STATE_TEXT[st.linkState].toLowerCase()}</AlertTitle>
          <AlertDescription>
            The message waits in a queue until a satellite is usable again. Waited so far: {formatDuration(st.pending.waited)} of flight time. Over the pole
            without LEO, a real crew would use HF radio instead.
          </AlertDescription>
        </Alert>
      )}

      {r ? (
        <div className="flex flex-col gap-3" aria-live="polite">
          {playing && (
            <div className="flex">
              <SimLabel>Slowed down so you can see it · {slow}</SimLabel>
            </div>
          )}
          <div className="relative">
            <div className="flex h-9 w-full overflow-hidden rounded-md border bg-muted" role="img" aria-label={`Trip through space: ${formatMs(r.total)} one way.`}>
              {segs.map((sg, k) => {
                const fill = Math.max(0, Math.min(1, (r.t - sg.start) / Math.max(sg.s, 1e-12)))
                return (
                  <div key={k} className="relative h-full border-r border-background last:border-r-0" style={{ width: `${(sg.s / r.total) * 100}%` }}>
                    <div
                      className={cn('absolute inset-y-0 left-0', sg.kind === 'up' ? 'bg-chart-1' : sg.kind === 'isl' ? 'bg-chart-4' : 'bg-chart-3')}
                      style={{ width: `${fill * 100}%` }}
                    />
                  </div>
                )
              })}
            </div>
          </div>
          <ul className="grid gap-1.5 text-xs sm:grid-cols-3">
            {segs.map((sg, k) => (
              <li key={k} className="flex items-start gap-2">
                <span className={cn('mt-0.5 inline-block size-2.5 shrink-0 rounded-sm', sg.kind === 'up' ? 'bg-chart-1' : sg.kind === 'isl' ? 'bg-chart-4' : 'bg-chart-3')} aria-hidden />
                <span className="min-w-0">
                  <span className="font-medium">
                    {sg.kind === 'isl' ? `Satellite to satellite (${sg.hops} hop${sg.hops === 1 ? '' : 's'})` : sg.label}
                  </span>
                  <span className="block font-mono text-muted-foreground tabular-nums">
                    {Math.round(sg.km).toLocaleString('en-US')} km · {formatMs(sg.s)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Stat label="Trip through space, one way" value={formatMs(Math.min(r.t, r.total))} strong />
            {r.service === 'voice' ? (
              <Stat label="Question and answer (there and back)" value={r.done ? formatMs(2 * r.total) : '…'} strong />
            ) : (
              <Stat label="Via" value={r.sat} />
            )}
            <Stat label="Ground network and processing" value={`+${formatMs(r.processing)}`} note="Illustrative" />
            <Stat label="Waited for a link" value={r.queue > 0 ? formatDuration(r.queue) : 'No wait'} />
          </div>
          {r.done && (
            <p className="text-xs text-muted-foreground">
              {r.system === 'geo' ? 'GEO' : 'LEO'}: {SERVICE_NAME[r.service]} through {r.sat} to {r.station}. The trip through space is distance ÷ speed of
              light; the ground part is an illustrative estimate, shown separately.
            </p>
          )}
        </div>
      ) : (
        !st.pending && (
          <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
            No message sent yet. Choose what to send and press Send.
          </p>
        )
      )}

      {st.results.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground">Your messages (newest first)</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>System</TableHead>
                <TableHead>Message</TableHead>
                <TableHead className="text-right">Through space</TableHead>
                <TableHead className="text-right">There and back</TableHead>
                <TableHead className="text-right">+ ground (illustr.)</TableHead>
                <TableHead className="text-right">Queue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {st.results.map((x) => (
                <TableRow key={x.n}>
                  <TableCell className="font-medium">{x.constellation === 'geo' ? 'GEO' : `LEO (${x.islHops} hop${x.islHops === 1 ? '' : 's'})`}</TableCell>
                  <TableCell>{SERVICE_NAME[x.service]}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatMs(x.propagationS)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatMs(2 * x.propagationS)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatMs(x.processingS)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{x.queueS > 0 ? formatDuration(x.queueS) : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, note, strong }: { label: string; value: string; note?: string; strong?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-md border px-3 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn('font-mono tabular-nums', strong ? 'text-base font-semibold' : 'text-sm')}>{value}</span>
      {note && <span className="text-[11px] text-warning">{note}</span>}
    </div>
  )
}
