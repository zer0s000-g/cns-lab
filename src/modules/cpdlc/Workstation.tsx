import { useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, Mic, Send, TriangleAlert, X } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Term } from '@/components/Term'
import { formatElement, formatLevel, messageResponseAttr, RCP } from '@/core/cpdlc'
import { useSampled } from '@/hooks/useSampled'
import { cn } from '@/lib/utils'
import { CENTRE, LEVELS, NEXT_CENTRE, type GroundConn } from './engine'
import { levelText, mmss } from './format'
import { useCpdlc, useCpdlcState } from './state'

type Choice = 'UM20' | 'UM23' | 'UM117' | 'UM120' | 'UM160' | 'TRANSFER' | 'UM0' | 'UM1'

const CHOICES: { id: Choice; label: string }[] = [
  { id: 'UM20', label: 'UM20 CLIMB TO' },
  { id: 'UM23', label: 'UM23 DESCEND TO' },
  { id: 'UM117', label: 'UM117 CONTACT' },
  { id: 'UM120', label: 'UM120 MONITOR' },
  { id: 'UM160', label: 'UM160 NEXT DATA AUTHORITY' },
  { id: 'TRANSFER', label: 'UM117 CONTACT + UM161 END SERVICE' },
]

function elementsFor(choice: Choice, level: number) {
  const unit = { unit: NEXT_CENTRE.id, frequency: NEXT_CENTRE.frequency }
  switch (choice) {
    case 'UM20':
    case 'UM23':
      return [{ id: choice, values: { level } }]
    case 'UM117':
    case 'UM120':
      return [{ id: choice, values: unit }]
    case 'UM160':
      return [{ id: 'UM160', values: { unit: NEXT_CENTRE.id } }]
    case 'TRANSFER':
      return [{ id: 'UM117', values: unit }, { id: 'UM161' }]
    default:
      return [{ id: choice }]
  }
}

const CONN_TEXT: Record<GroundConn, string> = {
  none: 'Not logged on',
  requested: 'Connecting…',
  inactive: 'Connecting…',
  active: 'CPDLC connected',
  transferred: 'Transferred to XHBR',
}

/** The controller's side: traffic, composer, open dialogues with RCP timers, and the message log. */
export function Workstation() {
  const { engine } = useCpdlc()
  const touch = useCpdlcState((s) => s.touch)
  const rcp = useCpdlcState((s) => s.rcp)
  useCpdlcState((s) => s.version)
  const [target, setTarget] = useState<'CNS123' | 'CNS132'>('CNS123')
  const [choice, setChoice] = useState<Choice>('UM20')
  const [level, setLevel] = useState(370)
  const [replyTo, setReplyTo] = useState<number | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)

  const s = useSampled(
    () => {
      const e = engine
      return {
        now: e.timeS,
        xlab: e.xlab,
        level: e.levelFl,
        cleared: e.clearedFl,
        cannot: e.cannotSend(target),
        open: e.openUplinks().map((x) => ({ id: x.id, min: x.min, text: x.text, elapsed: x.elapsedS, state: x.rcpState, standby: x.standby, needsVoice: x.needsVoice, status: x.status })),
        requests: e.openRequests().map((x) => ({ id: x.id, min: x.min, text: x.text, level: x.values.level ?? 370 })),
        alerts: e.alerts.slice(0, 2).map((a) => ({ ...a })),
        log: e.entries.slice(0, 14).map((x) => ({ id: x.id, dir: x.dir, min: x.min, mrn: x.mrn, text: x.text, status: x.status, aircraft: x.aircraft, t: e.utc(x.sentS), closedBy: x.closedBy, open: x.open })),
      }
    },
    200,
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  )

  const reply = replyTo != null ? s.requests.find((r) => r.id === replyTo) : undefined
  const effectiveChoice: Choice = reply ? (choice === 'UM0' || choice === 'UM1' || choice === 'UM20' || choice === 'UM23' ? choice : 'UM20') : choice === 'UM0' || choice === 'UM1' ? 'UM20' : choice
  const els = elementsFor(effectiveChoice, level)
  const preview = els.map((x) => formatElement(x.id, x.values)).join(' · ')
  const attr = messageResponseAttr(els.map((x) => x.id))

  const doSend = () => {
    const r = engine.sendUplink(target, els, reply ? reply.min : null)
    setRefusal(r.ok ? null : (r.reason ?? 'Not sent.'))
    if (r.ok) setReplyTo(null)
    touch()
  }

  const traffic = [
    { id: 'CNS123' as const, level: levelText(s.level, s.cleared), conn: CONN_TEXT[s.xlab], ok: s.xlab === 'active' },
    { id: 'CNS132' as const, level: 'FL360', conn: 'Voice only (no logon)', ok: false },
  ]

  return (
    <div className="flex min-w-0 flex-col gap-4 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-semibold">
            {CENTRE.id} · {CENTRE.name}
          </span>
          <span className="text-xs text-muted-foreground">You are the controller</span>
        </div>
        <Badge variant="secondary">
          <Term id="rcp">RCP {rcp}</Term>
        </Badge>
      </div>

      {/* Traffic */}
      <div role="radiogroup" aria-label="Aircraft to send to" className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Traffic</span>
        {traffic.map((a) => (
          <button
            key={a.id}
            type="button"
            role="radio"
            aria-checked={target === a.id}
            onClick={() => {
              setTarget(a.id)
              setRefusal(null)
            }}
            className={cn(
              'flex min-h-10 items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-muted/60',
              target === a.id && 'border-primary bg-accent/60',
            )}
          >
            <span className="flex min-w-0 flex-col">
              <span className="font-mono font-semibold tabular-nums">{a.id}</span>
              <span className="font-mono text-xs text-muted-foreground tabular-nums">{a.level}</span>
            </span>
            <Badge variant={a.ok ? 'default' : 'outline'} className="shrink-0">
              {a.conn}
            </Badge>
          </button>
        ))}
      </div>

      {/* Alerts */}
      {s.alerts.map((a) => (
        <Alert key={a.id} variant={a.tone === 'alert' ? 'destructive' : 'default'} className={cn(a.tone === 'warning' && 'border-warning/60')}>
          <TriangleAlert aria-hidden className={cn(a.tone === 'warning' && 'text-warning')} />
          <AlertTitle className="pr-6">{a.title}</AlertTitle>
          <AlertDescription>
            <p>{a.text}</p>
            {(a.offerLevel != null || a.entry != null) && (
              <div className="mt-2 flex flex-wrap gap-2">
                {a.offerLevel != null && s.cannot == null && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      engine.sendUplink('CNS123', [{ id: a.offerLevel! > s.cleared ? 'UM20' : 'UM23', values: { level: a.offerLevel! } }])
                      engine.dismissAlert(a.id)
                      touch()
                    }}
                  >
                    <Send aria-hidden /> Offer {formatLevel(a.offerLevel)} instead
                  </Button>
                )}
                {a.entry != null && s.open.some((o) => o.id === a.entry) && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      engine.giveByVoice(a.entry!)
                      touch()
                    }}
                  >
                    <Mic aria-hidden /> Give it by voice
                  </Button>
                )}
              </div>
            )}
          </AlertDescription>
          <button
            type="button"
            className="absolute top-2 right-2 rounded-sm p-1 text-muted-foreground hover:text-foreground"
            aria-label="Dismiss alert"
            onClick={() => {
              engine.dismissAlert(a.id)
              touch()
            }}
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </Alert>
      ))}

      {/* Composer */}
      <div className="flex flex-col gap-2 rounded-md border p-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">New uplink to {target}</span>
        </div>
        {s.requests.length > 0 && target === 'CNS123' && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cpdlc-reply" className="text-xs">
              Reply to a pilot request
            </Label>
            <Select
              value={replyTo != null ? String(replyTo) : 'none'}
              onValueChange={(v) => {
                const id = v === 'none' ? null : Number(v)
                setReplyTo(id)
                const r = s.requests.find((x) => x.id === id)
                if (r) {
                  setLevel(r.level)
                  setChoice(r.level >= s.cleared ? 'UM20' : 'UM23')
                }
              }}
            >
              <SelectTrigger id="cpdlc-reply" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">New message (not a reply)</SelectItem>
                {s.requests.map((r) => (
                  <SelectItem key={r.id} value={String(r.id)}>
                    Reply to MIN {r.min}: {r.text}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="cpdlc-element" className="text-xs">
              <Term id="message-element">Message element</Term>
            </Label>
            <Select value={effectiveChoice} onValueChange={(v) => setChoice(v as Choice)}>
              <SelectTrigger id="cpdlc-element" className="w-full min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(reply
                  ? [
                      { id: 'UM20' as Choice, label: 'UM20 CLIMB TO' },
                      { id: 'UM23' as Choice, label: 'UM23 DESCEND TO' },
                      { id: 'UM0' as Choice, label: 'UM0 UNABLE' },
                      { id: 'UM1' as Choice, label: 'UM1 STANDBY' },
                    ]
                  : CHOICES
                ).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {(effectiveChoice === 'UM20' || effectiveChoice === 'UM23') && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cpdlc-level" className="text-xs">
                Level
              </Label>
              <Select value={String(level)} onValueChange={(v) => setLevel(Number(v))}>
                <SelectTrigger id="cpdlc-level" className="w-24 font-mono">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEVELS.map((l) => (
                    <SelectItem key={l} value={String(l)} className="font-mono">
                      {formatLevel(l)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted px-2.5 py-2">
          <span className="min-w-0 font-mono text-xs font-semibold break-words">{preview}</span>
          <span className="font-mono text-[11px] text-muted-foreground">
            {attr === 'N' ? 'no reply needed' : attr === 'W/U' ? 'needs WILCO / UNABLE' : `reply ${attr}`}
            {reply ? ` · MRN ${reply.min}` : ''}
          </span>
        </div>
        <Button size="sm" onClick={doSend} disabled={s.cannot != null} className="self-start">
          <Send aria-hidden /> Send to {target}
        </Button>
        {(s.cannot || refusal) && <p className="text-xs text-warning">{s.cannot ?? refusal}</p>}
      </div>

      {/* Open dialogues */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Waiting for an answer</span>
        {s.open.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">Nothing open. Sent clearances appear here with a timer.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {s.open.map((o) => {
              const et = RCP[rcp].expirationS
              const pct = Math.min(100, (o.elapsed / et) * 100)
              const tone = o.needsVoice || o.state === 'expired' ? 'alert' : o.state === 'late' ? 'warning' : 'ok'
              return (
                <li key={o.id} className="flex flex-col gap-1.5 rounded-md border px-3 py-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 font-mono text-xs">
                      <span className="text-muted-foreground">MIN {o.min} </span>
                      {o.text}
                    </span>
                    <span className={cn('shrink-0 font-mono text-xs font-semibold tabular-nums', tone === 'alert' ? 'text-destructive' : tone === 'warning' ? 'text-warning' : 'text-foreground')}>
                      {o.needsVoice ? 'use voice' : mmss(o.elapsed)}
                    </span>
                  </div>
                  <div className="relative h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <div
                      className={cn('absolute inset-y-0 left-0 rounded-full', tone === 'alert' ? 'bg-destructive' : tone === 'warning' ? 'bg-warning' : 'bg-primary')}
                      style={{ width: `${pct}%` }}
                    />
                    <div className="absolute inset-y-0 w-px bg-foreground/60" style={{ left: `${(RCP[rcp].tt95S / et) * 100}%` }} />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] text-muted-foreground">
                      {o.needsVoice
                        ? 'Connection lost: this must go by voice'
                        : o.status === 'sending'
                          ? 'On its way to the aircraft'
                          : o.standby
                            ? 'STANDBY received: waiting for the final answer'
                            : o.state === 'expired'
                              ? `Over ${et} s: RCP ${rcp} exceeded`
                              : o.state === 'late'
                                ? `Past ${RCP[rcp].tt95S} s: slower than 95 % should be`
                                : 'Delivered, waiting for the pilot'}
                    </span>
                    {(o.needsVoice || o.state !== 'ok') && (
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => {
                          engine.giveByVoice(o.id)
                          touch()
                        }}
                      >
                        <Mic aria-hidden /> Give it by voice
                      </Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Log */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Message log</span>
        <ScrollArea className="h-36 rounded-md border">
          {s.log.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">No messages yet. The aircraft must log on first.</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {s.log.map((l) => (
                <li key={l.id} className="flex items-start gap-2 px-2.5 py-1.5 font-mono text-[11px] leading-4">
                  {l.dir === 'up' ? <ArrowUpRight className="mt-0.5 size-3 shrink-0 text-primary" aria-label="uplink" /> : <ArrowDownLeft className="mt-0.5 size-3 shrink-0 text-success" aria-label="downlink" />}
                  <span className="shrink-0 text-muted-foreground tabular-nums">{l.t}</span>
                  <span className="min-w-0 flex-1">
                    <span className="text-muted-foreground">
                      {l.min != null ? `MIN ${l.min}` : ''}
                      {l.mrn != null ? ` MRN ${l.mrn}` : ''}{' '}
                    </span>
                    {l.text}
                  </span>
                  <span
                    className={cn(
                      'shrink-0',
                      l.status === 'lost' || l.status === 'rejected' ? 'text-destructive' : l.status === 'sending' ? 'text-warning' : 'text-muted-foreground',
                    )}
                  >
                    {l.closedBy === 'voice' ? 'by voice' : l.status === 'sending' ? 'sending' : l.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </div>
    </div>
  )
}
