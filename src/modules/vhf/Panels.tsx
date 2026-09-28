import { useEffect, useRef, useState } from 'react'
import { ArrowRightLeft, MessageSquareText, Mic, Radio, Siren, TriangleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Toggle } from '@/components/ui/toggle'
import { ControlSlider } from '@/components/sim/Controls'
import { LeverSwitch, Segmented } from '@/hud/Controls'
import { HudPanel } from '@/hud/HudFrame'
import { Term } from '@/components/Term'
import { RECEIVER_NOISE_DBM, squelchOpenedByNoise } from '@/core/vhf'
import { useSampled } from '@/hooks/useSampled'
import { cn } from '@/lib/utils'
import { FREQ_LABEL, FREQ_MHZ, type ControllerFreq } from './engine'
import { OUTCOME_TEXT, RX_TEXT, WHO_LABEL } from './labels'
import { useVhf, useVhfState } from './state'

const FREQS: ControllerFreq[] = ['main', 'backup', 'guard']

/** Signal strength bar: noise floor at the left, strong signals at the right. */
function LevelBar({ levelDbm, squelchDbm }: { levelDbm: number; squelchDbm: number }) {
  const lo = -125
  const hi = -55
  const pct = (v: number) => `${Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100))}%`
  return (
    <div className="relative h-2.5 w-full rounded-full bg-muted" aria-hidden>
      <div className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: Number.isFinite(levelDbm) ? pct(levelDbm) : '0%' }} />
      <div className="absolute -inset-y-1 w-0.5 bg-foreground" style={{ left: pct(squelchDbm) }} title="Squelch threshold" />
      <div className="absolute -inset-y-1 w-px bg-muted-foreground" style={{ left: pct(RECEIVER_NOISE_DBM) }} />
    </div>
  )
}

/** The learner's radio: frequency, squelch, guard receiver and the talk button. */
export function CockpitRadio() {
  const { engine, clock } = useVhf()
  const params = useVhfState((s) => s.params)
  const setParam = useVhfState((s) => s.setParam)
  const [held, setHeld] = useState(false)
  const heldRef = useRef(false)

  const st = useSampled(() => {
    const v = engine.learnerView()
    const lvl = engine.levelAt('controller', 'CNS101', params.com1)
    const mine = [...engine.transmissions].reverse().find((x) => x.who === 'CNS101' && x.end !== null)
    const countdown = engine.countdownTo !== null ? Math.max(0, engine.countdownTo - engine.timeS) : null
    return {
      state: v.rx.state,
      who: v.tx ? WHO_LABEL[v.tx.who] : null,
      openMic: v.tx?.kind === 'open-mic',
      freq: v.freq,
      level: lvl,
      ptt: engine.pttActive,
      cpdlc: engine.cpdlc?.text ?? null,
      last: mine ? (mine.outcome.ground ?? 'not-heard') : null,
      countdown: countdown === null ? null : Math.round(countdown * 10) / 10,
      contact: engine.learnerInContact(),
    }
  }, 100)

  const down = () => {
    if (heldRef.current) return
    heldRef.current = true
    setHeld(true)
    clock.getState().play()
    engine.pressTalk()
  }
  const up = () => {
    if (!heldRef.current) return
    heldRef.current = false
    setHeld(false)
    engine.releaseTalk()
  }
  // Never leave the transmitter keyed if the button loses the pointer or the page hides.
  useEffect(() => {
    const onBlur = () => up()
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  })

  const tone = st.state === 'blocked' || st.state === 'garbled' || st.openMic ? 'text-destructive' : st.state === 'clear' || st.state === 'noisy' ? 'text-success' : 'text-muted-foreground'

  return (
    <HudPanel
      index="COM"
      title={
        <span className="inline-flex items-center gap-2">
          <Radio className="size-3.5 text-signal" aria-hidden /> Your radio
        </span>
      }
      actions={<Badge variant={st.contact ? 'secondary' : 'destructive'}>{st.contact ? 'In range' : 'Out of range'}</Badge>}
      bodyClassName="p-0"
    >
    <section aria-label="Your radio" className="flex min-w-0 flex-col gap-4 p-4">
      <p className="-mb-1 text-xs text-muted-foreground">You are the pilot of CNS101. Press and hold to talk, release to listen.</p>

      <div className="flex flex-col gap-1.5">
        <Segmented
          label="Radio 1 frequency"
          value={params.com1}
          onChange={(v) => setParam('com1', v)}
          options={FREQS.map((f) => ({ value: f, label: FREQ_MHZ[f].toFixed(3), ariaLabel: `${FREQ_MHZ[f].toFixed(3)} megahertz, ${FREQ_LABEL[f]}` }))}
        />
        <p className="text-[11.5px] leading-4 text-muted-foreground">{`${FREQ_LABEL[params.com1]}${params.com1 === 'guard' ? ': for emergencies only' : ''}`}</p>
      </div>
      <LeverSwitch
        label={
          <>
            Radio 2 listens to <Term id="guard-frequency">121.5 guard</Term>
          </>
        }
        tone="signal"
        checked={params.guardWatch}
        onChange={(v) => setParam('guardWatch', v)}
      />
      <ControlSlider
        label={<Term id="squelch">Squelch</Term>}
        value={params.squelchDbm}
        min={-125}
        max={-60}
        step={1}
        onChange={(v) => setParam('squelchDbm', v)}
        format={(v) => `${v} dBm`}
        hint={squelchOpenedByNoise(params.squelchDbm) ? 'Too low: the noise itself opens it, constant hiss.' : params.squelchDbm > -88 ? 'Very high: weak, distant stations are cut out.' : 'Opens only when a station is stronger than the line.'}
      />

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <span className="text-muted-foreground">Signal from the radio site</span>
          <span className="hud-value">{Number.isFinite(st.level) ? `${st.level.toFixed(0)} dBm` : 'none (no line of sight)'}</span>
        </div>
        <LevelBar levelDbm={st.level} squelchDbm={params.squelchDbm} />
        <p className="text-xs text-muted-foreground">Dark line: your squelch. Thin line: receiver noise.</p>
      </div>

      <div className="flex flex-col gap-2 rounded-[4px] border border-hud-line bg-background/40 p-3" aria-live="polite">
        <p className={cn('text-sm font-medium', tone)}>
          {st.ptt ? 'Transmitting: your receiver is muted' : st.openMic ? `Blocked by an open microphone (${st.who})` : RX_TEXT[st.state]}
          {!st.ptt && !st.openMic && st.who && (st.state === 'clear' || st.state === 'noisy') ? `: ${st.who}` : ''}
          {!st.ptt && st.freq === 'guard' && params.com1 !== 'guard' && st.state !== 'muted' && st.state !== 'hiss' ? ' (on 121.5)' : ''}
        </p>
        {st.last && <p className="text-xs text-muted-foreground">Your last call at the controller: {OUTCOME_TEXT[st.last]}</p>}
        {st.countdown !== null && (
          <p className="text-xs font-medium text-warning tabular-nums">{st.countdown > 0 ? `CNS202 starts talking in ${st.countdown.toFixed(1)} s. Press Talk at the same moment.` : 'CNS202 is waiting for a quiet frequency.'}</p>
        )}
      </div>

      <Button
        size="lg"
        variant={held ? 'default' : 'outline'}
        aria-pressed={held}
        className="h-14 w-full touch-none text-base select-none"
        onPointerDown={(e) => {
          try {
            e.currentTarget.setPointerCapture(e.pointerId)
          } catch {
            /* capture is only a convenience */
          }
          down()
        }}
        onPointerUp={up}
        onPointerCancel={up}
        onLostPointerCapture={up}
        onKeyDown={(e) => {
          if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
            e.preventDefault()
            down()
          }
        }}
        onKeyUp={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault()
            up()
          }
        }}
        onBlur={up}
      >
        <Mic aria-hidden /> {held ? 'Talking… release to listen' : 'Hold to talk'}
      </Button>
      <p className="-mt-2 text-xs text-muted-foreground">
        <Term id="press-to-talk">Press to talk</Term>: hold the button (or Space) while you speak.
      </p>

      {st.cpdlc && (
        <div className="flex items-start gap-2 rounded-[4px] border border-signal/50 bg-background/40 p-3 text-sm" role="status">
          <MessageSquareText className="mt-0.5 size-4 shrink-0 text-signal" aria-hidden />
          <div className="flex min-w-0 flex-col gap-1">
            <span className="hud-label text-signal">Text message from ATC (CPDLC)</span>
            <span className="hud-value text-sm">{st.cpdlc}</span>
            {params.com1 !== 'backup' && (
              <Button size="sm" className="w-fit" onClick={() => setParam('com1', 'backup')}>
                <ArrowRightLeft aria-hidden /> Tune radio 1 to 124.350
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
    </HudPanel>
  )
}

/** The controller's voice switch: receive and transmit keys per frequency, main/standby transmitter, emergency. */
export function VccsPanel() {
  const { engine } = useVhf()
  const vccs = useVhfState((s) => s.vccs)
  const failures = useVhfState((s) => s.failures)
  const setVccs = useVhfState((s) => s.setVccs)
  const busy = useSampled(() => {
    const out: Record<ControllerFreq, string> = { main: '', backup: '', guard: '' }
    for (const f of FREQS) {
      const r = engine.receive('ground', f)
      out[f] = r.rx.heard.length >= 2 ? 'Squeal' : r.rx.heard.length === 1 ? WHO_LABEL[r.carriers.find((c) => String(c.tx.id) === r.rx.heard[0].id)?.tx.who ?? 'CNS202'] : ''
    }
    return { ...out, sector: engine.sectorFreq, talking: engine.isTransmitting('controller') }
  }, 150)
  const mainFailed = failures.txFailure
  const onAirFailed = mainFailed && vccs.transmitter === 'main'

  const key = (f: ControllerFreq, kind: 'rx' | 'tx', on: boolean) => setVccs({ ...vccs, [kind]: { ...vccs[kind], [f]: on } })

  return (
    <HudPanel
      index="VCS"
      title={
        <>
          Controller's <Term id="vccs">voice switch (VCCS)</Term>
        </>
      }
      bodyClassName="p-0"
    >
    <section aria-label="Controller's voice switch" className="flex min-w-0 flex-col gap-4 p-4">
      <p className="-mb-1 text-xs text-muted-foreground">On the ground. The simulated controller uses it; you can press the keys too.</p>
      <div className="flex flex-col divide-y divide-hud-line rounded-[4px] border border-hud-line">
        {FREQS.map((f) => (
          <div key={f} className="flex min-h-12 items-center gap-2 px-3 py-2">
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="hud-value text-sm">{FREQ_MHZ[f].toFixed(3)}</span>
              <span className="truncate text-xs text-muted-foreground">
                {busy.sector === f ? 'In use: ' : ''}
                {FREQ_LABEL[f]}
              </span>
            </div>
            <span className={cn('w-14 text-right text-xs font-medium', busy[f] === 'Squeal' ? 'text-destructive' : 'text-foreground')} aria-live="off">
              {busy[f]}
            </span>
            <Toggle size="sm" variant="outline" pressed={vccs.rx[f]} onPressedChange={(v) => key(f, 'rx', v)} aria-label={`Receive on ${FREQ_MHZ[f].toFixed(3)}`} className="w-11 font-mono text-xs data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
              RX
            </Toggle>
            <Toggle size="sm" variant="outline" pressed={vccs.tx[f]} onPressedChange={(v) => key(f, 'tx', v)} aria-label={`Transmit on ${FREQ_MHZ[f].toFixed(3)}`} className="w-11 font-mono text-xs data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
              TX
            </Toggle>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-1.5">
        <Segmented
          label={<Term id="standby-transmitter">Transmitter</Term>}
          value={vccs.transmitter}
          onChange={(v) => setVccs({ ...vccs, transmitter: v })}
          options={[
            { value: 'main', label: <span className="inline-flex items-center gap-1">Main {mainFailed && <TriangleAlert className="size-3.5 text-destructive" aria-label="failed" />}</span> },
            { value: 'standby', label: 'Standby' },
          ]}
        />
        <p className={cn('text-[11.5px] leading-4', onAirFailed ? 'text-destructive' : 'text-muted-foreground')}>
          {onAirFailed ? 'MAIN TRANSMITTER FAILED: nothing the controller says goes on the air. Change to standby.' : mainFailed ? 'Main has failed; the standby transmitter is carrying the voice.' : 'Two transmitters at the site: a spare is always ready.'}
        </p>
      </div>
      {onAirFailed && (
        <p className="-mt-2 flex items-center gap-1.5 text-xs font-medium text-destructive" role="alert">
          <TriangleAlert className="size-3.5" aria-hidden /> Main transmitter alarm
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => engine.emergencyCall()}>
          <Siren aria-hidden /> Emergency call on 121.5
        </Button>
        <Button size="sm" variant="outline" disabled={busy.sector === 'backup'} onClick={() => engine.moveTrafficToBackup()}>
          <ArrowRightLeft aria-hidden /> Move traffic to 124.350
        </Button>
      </div>
      {busy.talking && <p className="-mt-2 text-xs text-muted-foreground">Controller is talking{onAirFailed ? ' into a failed transmitter' : ''}.</p>}
    </section>
    </HudPanel>
  )
}
