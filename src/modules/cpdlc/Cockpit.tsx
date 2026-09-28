import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatLevel, MESSAGE_ELEMENTS, responseOptions } from '@/core/cpdlc'
import { useSampled } from '@/hooks/useSampled'
import { audio, caption } from '@/lib/audio'
import { cn } from '@/lib/utils'
import { LEVELS, OTHER, OWN } from './engine'
import { levelText } from './format'
import { useCpdlc, useCpdlcState } from './state'

/** Buttons on the dark cockpit screen use the instrument tokens. */
const keyClass =
  'h-9 border-instrument-bezel bg-instrument-bezel/40 font-mono text-xs font-semibold tracking-wide text-instrument-marking hover:bg-instrument-bezel hover:text-instrument-marking pointer-coarse:h-10 dark:bg-instrument-bezel/40 dark:hover:bg-instrument-bezel'

/**
 * The pilot's data-link display, like the small screen next to the throttles:
 * connection status, the current ATC message and the reply keys, logon and requests.
 */
export function Cockpit() {
  const { engine } = useCpdlc()
  const touch = useCpdlcState((s) => s.touch)
  useCpdlcState((s) => s.version)
  const wrong = useCpdlcState((s) => s.env.wrongAircraft)
  const [flightId, setFlightId] = useState(OWN.flightId)
  const [reqLevel, setReqLevel] = useState(370)
  const [note, setNote] = useState<string | null>(null)

  const s = useSampled(
    () => {
      const e = engine
      const m = e.cockpitMessage()
      const queued = e.entries.filter((x) => x.dir === 'up' && x.status === 'received' && !x.handled).length
      const lastDown = e.entries.find((x) => x.dir === 'down' && x.aircraft === 'CNS123')
      return {
        utc: e.utc(),
        active: e.link.active,
        inactive: e.link.inactive,
        nda: e.link.nda,
        logonState: e.logonState,
        logonNote: e.logonNote,
        logonTarget: e.logonTarget,
        logonName: e.logonName,
        level: e.levelFl,
        cleared: e.clearedFl,
        lost: e.env.lost,
        msg: m
          ? { id: m.id, from: m.from, t: e.utc(m.receivedS ?? m.sentS), min: m.min, text: m.text, resp: m.resp, void: m.void, standby: e.entries.some((x) => x.dir === 'down' && x.mrn === m.min && x.elements[0] === 'DM2') }
          : null,
        more: Math.max(0, queued - 1),
        lastDown: lastDown ? { text: lastDown.text, t: e.utc(lastDown.sentS), status: lastDown.status } : null,
        other: e.otherLog.slice(0, 3).map((l) => `${e.utc(l.timeS)}  ${l.text}`),
        otherState: e.otherLogonState,
      }
    },
    150,
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  )

  // Chime and caption when a new ATC message appears.
  const heard = useRef(0)
  useEffect(() => {
    const id = window.setInterval(() => {
      const c = engine.chimes
      if (c.length > heard.current) {
        const last = c[c.length - 1]
        heard.current = c.length
        audio.tone(1175, 0.12, { gain: 0.08 })
        audio.tone(1568, 0.16, { gain: 0.08, delayS: 0.15 })
        caption(`Chime: new ATC message on the data link display, “${last.text}”`, 4)
      } else if (c.length < heard.current) heard.current = c.length
    }, 150)
    return () => window.clearInterval(id)
  }, [engine])

  const reply = (dm: 'DM0' | 'DM1' | 'DM2' | 'DM3' | 'DM4' | 'DM5') => {
    if (!s.msg) return
    const r = engine.pilotRespond(s.msg.id, dm)
    setNote(r.ok ? null : (r.reason ?? null))
    touch()
  }

  const connected = s.active != null
  const statusLine = s.lost ? 'DATA LINK LOST' : connected ? `ACT ATC ${s.active}` : 'NO ATC CONNECTION'

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div
        className="flex min-w-0 flex-col gap-3 rounded-lg border-2 border-instrument-bezel bg-instrument-face p-3 text-instrument-marking"
        role="group"
        aria-label="Cockpit data link display of CNS123"
      >
        {/* Status bar */}
        <div className="flex items-center justify-between gap-2 font-mono text-[11px] font-semibold tracking-wide">
          <span className={cn(connected && !s.lost ? 'text-instrument-accent' : 'text-instrument-flag')} role="status">
            {statusLine}
          </span>
          <span className="text-instrument-dim tabular-nums">{s.utc}Z</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-instrument-dim">
          <span>
            {s.nda ? `NEXT ATC ${s.nda}${s.inactive ? ' (READY)' : ''}` : 'NEXT ATC ----'}
          </span>
          <span className="tabular-nums">
            CNS123 {levelText(s.level, s.cleared)}
          </span>
        </div>

        {/* Message screen */}
        <div className="flex min-h-40 flex-col gap-2 rounded-md bg-scope-bg p-3" aria-live="polite">
          {s.msg ? (
            <>
              <div className="flex items-baseline justify-between gap-2 font-mono text-[11px] text-scope-dim">
                <span>
                  FROM {s.msg.from} · MIN {s.msg.min}
                </span>
                <span className="tabular-nums">{s.msg.t}</span>
              </div>
              <p className="font-mono text-lg leading-7 font-semibold break-words text-scope-text">{s.msg.text}</p>
              {s.msg.void ? (
                <p className="font-mono text-xs text-scope-warning">ATC HAS ALREADY GIVEN THIS BY VOICE. NO REPLY.</p>
              ) : s.msg.standby ? (
                <p className="font-mono text-xs text-scope-warning">STANDBY SENT. A FINAL ANSWER IS STILL NEEDED.</p>
              ) : null}
              <div className="mt-auto flex flex-wrap gap-2">
                {s.msg.void || responseOptions(s.msg.resp).length === 0 ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className={keyClass}
                    onClick={() => {
                      engine.pilotDismiss(s.msg!.id)
                      touch()
                    }}
                  >
                    OK
                  </Button>
                ) : (
                  responseOptions(s.msg.resp).map((dm) => (
                    <Button
                      key={dm}
                      size="sm"
                      variant="outline"
                      className={cn(keyClass, 'min-w-20')}
                      onClick={() => reply(dm as 'DM0')}
                      disabled={dm === 'DM2' && s.msg!.standby}
                      aria-label={`Reply ${MESSAGE_ELEMENTS[dm].template} (${dm})`}
                    >
                      {MESSAGE_ELEMENTS[dm].template}
                    </Button>
                  ))
                )}
              </div>
              {s.more > 0 && <p className="font-mono text-[11px] text-scope-dim">+{s.more} MORE MESSAGE{s.more === 1 ? '' : 'S'} WAITING</p>}
            </>
          ) : (
            <p className="m-auto font-mono text-xs text-scope-dim">{connected ? 'NO NEW MESSAGES' : 'LOG ON TO RECEIVE ATC MESSAGES'}</p>
          )}
        </div>
        {note && <p className="font-mono text-[11px] text-instrument-flag">{note.toUpperCase()}</p>}
        {s.lastDown && (
          <p className="font-mono text-[11px] text-instrument-dim">
            LAST SENT {s.lastDown.text} {s.lastDown.t} {s.lastDown.status === 'sending' ? '(SENDING)' : s.lastDown.status === 'lost' ? '(LOST)' : '(DELIVERED)'}
          </p>
        )}

        {/* Logon or request */}
        {!connected ? (
          <div className="flex flex-col gap-2 rounded-md border border-instrument-bezel p-2.5">
            <span className="font-mono text-[11px] font-semibold tracking-wide text-instrument-dim">
              {s.logonName.toUpperCase()} TO {s.logonTarget}
            </span>
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 font-mono text-xs">
              <Label htmlFor="cpdlc-flightid" className="font-mono text-[11px] text-instrument-dim">
                FLT ID
              </Label>
              <Input
                id="cpdlc-flightid"
                value={flightId}
                maxLength={8}
                onChange={(ev) => setFlightId(ev.target.value.toUpperCase())}
                className="h-8 border-instrument-bezel bg-scope-bg font-mono text-xs text-scope-text"
              />
              <span className="text-[11px] text-instrument-dim">REG</span>
              <span>{OWN.registration}</span>
              <span className="text-[11px] text-instrument-dim">ADDRESS</span>
              <span>{OWN.address}</span>
            </div>
            <Button
              size="sm"
              variant="outline"
              className={cn(keyClass, 'self-start')}
              disabled={s.logonState === 'sent'}
              onClick={() => {
                engine.pilotLogon(flightId)
                touch()
              }}
            >
              SEND LOGON
            </Button>
            <p className="font-mono text-[11px] text-instrument-dim">
              {s.logonState === 'sent'
                ? 'LOGON SENT. WAITING FOR THE CENTRE…'
                : s.logonState === 'accepted'
                  ? 'LOGON ACCEPTED. CONNECTING…'
                  : s.logonState === 'rejected'
                    ? `LOGON REJECTED. ${s.logonNote.toUpperCase()}`
                    : s.logonNote
                      ? s.logonNote.toUpperCase()
                      : 'NOT LOGGED ON'}
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-2 rounded-md border border-instrument-bezel p-2.5">
            <div className="flex flex-col gap-1">
              <Label htmlFor="cpdlc-req" className="font-mono text-[11px] text-instrument-dim">
                REQUEST (DM6)
              </Label>
              <Select value={String(reqLevel)} onValueChange={(v) => setReqLevel(Number(v))}>
                <SelectTrigger id="cpdlc-req" className="h-8 w-28 border-instrument-bezel bg-scope-bg font-mono text-xs text-scope-text">
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
            <Button
              size="sm"
              variant="outline"
              className={keyClass}
              onClick={() => {
                const r = engine.pilotRequest(reqLevel)
                setNote(r.ok ? null : (r.reason ?? null))
                touch()
              }}
            >
              SEND REQUEST
            </Button>
          </div>
        )}
      </div>

      {wrong && (
        <div className="flex flex-col gap-1.5 rounded-lg border-2 border-instrument-bezel bg-instrument-face p-3 font-mono text-instrument-marking" role="group" aria-label="Nearby aircraft CNS132 data link unit">
          <span className="text-[11px] font-semibold tracking-wide text-instrument-dim">
            NEARBY {OTHER.flightId} · ADDRESS {OTHER.address} · {s.otherState === 'rejected' ? 'LOGON REJECTED' : s.otherState === 'sent' ? 'LOGON SENT' : 'NOT CONNECTED'}
          </span>
          {s.other.length === 0 ? (
            <span className="text-[11px] text-instrument-dim">Listening…</span>
          ) : (
            s.other.map((l, k) => (
              <span key={k} className="text-[11px] leading-4 text-scope-text">
                {l}
              </span>
            ))
          )}
        </div>
      )}
    </div>
  )
}
