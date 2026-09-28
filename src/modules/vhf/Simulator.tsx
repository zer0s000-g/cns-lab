import { useEffect, useRef, type ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowRight } from 'lucide-react'
import { AudioCaption, ClockControls } from '@/components/sim/Controls'
import { ChapterHead } from '@/components/module/ModuleLayout'
import { Term } from '@/components/Term'
import { radioLineOfSightNm } from '@/core/propagation'
import { RECEIVER_NOISE_DBM } from '@/core/vhf'
import { useClock, useSimulationLoop } from '@/hooks/useSimClock'
import { useSampled } from '@/hooks/useSampled'
import { Dial, LeverSwitch, Segmented } from '@/hud/Controls'
import { HudPanel } from '@/hud/HudFrame'
import { TelemetryRow } from '@/hud/Telemetry'
import { FrequencyStrips } from './FrequencyStrip'
import { CockpitRadio, VccsPanel } from './Panels'
import { MAX_ALT_FT, MAX_DIST_NM, MIN_ALT_FT, MIN_DIST_NM, VhfSideView } from './SideView'
import { RadioTimeline } from './Timeline'
import { OUTCOME_TEXT, RX_TEXT, WHO_LABEL, freqText, mhzText } from './labels'
import { SITE, adjacentMHz } from './engine'
import { useVhf, useVhfState } from './state'
import { VhfAudioDirector } from './vhfAudio'

/**
 * The Simulator chapter: a console laid over the 3D stage. Left, your radio
 * and what it measures; right, the control deck; the Earth slice shows
 * through in between. Below, the side view, the timeline, the controller's
 * voice switch, the radio log and the frequency strips.
 */
export function VhfSimulator() {
  const { engine, clock, store } = useVhf()
  const director = useRef<VhfAudioDirector | null>(null)
  if (!director.current) director.current = new VhfAudioDirector()

  useSimulationLoop(clock, (dt) => {
    engine.step(dt)
    const s = store.getState()
    s.sync()
    director.current!.update(engine, s.listenAt, clock.getState().running)
  })
  useEffect(() => () => director.current?.dispose(), [])

  return (
    <div className="flex flex-col gap-4">
      <div className="hud-panel rounded-md px-5 py-4 md:w-fit md:max-w-[520px]">
        <ChapterHead
          n={2}
          title="Simulator"
          lead="You fly CNS101. The slice of Earth behind shows why the radio reaches you or not: straight rays, a curved sea."
        />
      </div>
      <div className="grid gap-4 md:grid-cols-[minmax(0,420px)_1fr_minmax(0,340px)]">
        <div className="flex min-w-0 flex-col gap-4">
          <CockpitRadio />
          <LiveReadouts />
        </div>
        <div aria-hidden className="hidden md:block" />
        <VhfControls />
      </div>

      <HudPanel
        index="LOS"
        title="Side view: the radio site, your aircraft and the curve of the Earth"
        actions={<span className="hud-label hidden shrink-0 sm:inline">Drag your aircraft, or use the dials</span>}
        bodyClassName="p-3"
      >
        <VhfSideView />
        <p className="mt-2.5 text-[11.5px] leading-5 text-muted-foreground">
          Radio waves at <Term id="vhf">VHF</Term> travel in straight lines. The hatched area is below the{' '}
          <Term id="radio-horizon">radio horizon</Term>: an aircraft there has no <Term id="line-of-sight">line of sight</Term> to the antenna.
          <span className="sm:hidden"> Drag your aircraft, or use the dials.</span>
        </p>
      </HudPanel>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <HudPanel
          index="TX"
          title="Who is transmitting"
          actions={<span className="hud-label hidden shrink-0 sm:inline">Last 36 s</span>}
          bodyClassName="flex flex-col gap-2 p-3"
        >
          <p className="text-[11.5px] leading-4 text-muted-foreground">Last 36 seconds. Hatched red: two carriers at once.</p>
          <RadioTimeline />
          <AudioCaption className="min-h-8" />
        </HudPanel>
        <VccsPanel />
      </div>

      <RadioLog />
      <HudPanel index="RF" title="Frequencies" bodyClassName="p-4">
        <FrequencyStrips />
      </HudPanel>
    </div>
  )
}

/** A telemetry row with a short explanation under it. */
function Row({ hint, ...row }: Parameters<typeof TelemetryRow>[0] & { hint: ReactNode }) {
  return (
    <div className="flex flex-col pb-1.5">
      <TelemetryRow {...row} />
      <p className="text-[11.5px] leading-4 text-muted-foreground">{hint}</p>
    </div>
  )
}

function LiveReadouts() {
  const { engine } = useVhf()
  const r = useSampled(() => {
    const p = engine.params
    const v = engine.learnerView()
    const lvl = engine.levelAt('controller', 'CNS101', p.com1)
    return {
      range: radioLineOfSightNm(SITE.antennaFt, p.altitudeFt),
      floor: engine.contactFloorFt(),
      level: lvl,
      snr: lvl - RECEIVER_NOISE_DBM,
      contact: engine.learnerInContact(),
      state: v.rx.state,
      ptt: engine.pttActive,
      dist: p.distanceNm,
      squelch: p.squelchDbm,
    }
  }, 150)
  return (
    <HudPanel index="TLM" title="Radio telemetry" bodyClassName="px-4 py-2">
      <div className="flex flex-col divide-y divide-hud-line">
        <Row label="Range at your altitude" value={r.range.toFixed(0)} unit="NM" tone="signal" hint="Line of sight to the 100 ft antenna" />
        <Row
          label="Contact lost below"
          value={Math.round(r.floor).toLocaleString('en-US')}
          unit="ft"
          tone={r.contact ? 'default' : 'alert'}
          hint={r.contact ? `At ${r.dist} NM. You are above it` : `At ${r.dist} NM. You are below it: no contact`}
        />
        <Row
          label="Signal at your radio"
          value={Number.isFinite(r.level) ? r.level.toFixed(0) : '—'}
          unit={Number.isFinite(r.level) ? 'dBm' : undefined}
          hint={
            Number.isFinite(r.level) ? (
              <>
                <Term id="signal-to-noise">{r.snr.toFixed(0)} dB above the noise</Term>
              </>
            ) : (
              'Blocked: no line of sight'
            )
          }
        />
        <Row
          label="Your receiver"
          value={r.ptt ? 'Transmitting' : RX_TEXT[r.state].split(':')[0]}
          tone={r.state === 'blocked' || r.state === 'garbled' ? 'alert' : r.state === 'clear' ? 'ok' : 'muted'}
          hint={`Squelch set at ${r.squelch} dBm`}
        />
      </div>
    </HudPanel>
  )
}

/** Transcript of the radio traffic: what was said, and who heard it. */
function RadioLog() {
  const { engine } = useVhf()
  const rows = useSampled(
    () =>
      engine.transmissions
        .slice(-7)
        .reverse()
        .map((x) => ({
          id: x.id,
          at: x.start,
          who: WHO_LABEL[x.who],
          freq: x.freqs.map((f) => freqText(f, adjacentMHz(engine.params.spacing))).join(' + '),
          text: x.radiated ? x.text : `${x.text} (not on the air: transmitter failed)`,
          ctl: x.who === 'controller' || x.who === 'CNS707' ? null : x.outcome.ground ?? null,
          you: x.who === 'CNS101' ? null : x.outcome.CNS101 ?? null,
          live: x.end === null || x.end > engine.timeS,
        })),
    300,
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  )
  return (
    <HudPanel index="LOG" title="Radio log" bodyClassName="flex min-w-0 flex-col gap-2 p-4">
      <section aria-label="Radio log" className="flex min-w-0 flex-col gap-2">
        <p className="text-[11.5px] leading-4 text-muted-foreground">Everything said on the radio, and whether you and the controller heard it. A written record of the audio.</p>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing yet. The controller will call in a moment, or press Hold to talk.</p>
        ) : (
          <ol className="flex flex-col divide-y divide-hud-line">
            {rows.map((r) => (
              <li key={r.id} className="flex min-h-10 flex-col gap-0.5 py-1.5 sm:flex-row sm:items-baseline sm:gap-3">
                <span className="hud-label w-44 shrink-0 text-foreground">
                  {r.who}
                  {r.live && <span className="ml-1 text-signal">· on air</span>}
                </span>
                <span className="min-w-0 flex-1 text-sm">{r.text}</span>
                <span className="hud-value shrink-0 text-xs text-muted-foreground">{r.freq}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {[r.ctl && `controller: ${OUTCOME_TEXT[r.ctl]}`, r.you && `you: ${OUTCOME_TEXT[r.you]}`].filter(Boolean).join(' · ')}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </HudPanel>
  )
}

function VhfControls() {
  const { clock } = useVhf()
  const params = useVhfState((s) => s.params)
  const failures = useVhfState((s) => s.failures)
  const listenAt = useVhfState((s) => s.listenAt)
  const { setParam, setFailure, setListenAt, resetAll } = useVhfState((s) => s)
  const running = useClock(clock, (s) => s.running)
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <HudPanel index="CLK" title="Time" bodyClassName="p-3">
        <ClockControls clock={clock} onReset={resetAll} />
        <p className="mt-2 text-xs text-muted-foreground">{running ? 'Radio traffic runs in real time.' : 'Paused. Press Play to hear the radio traffic.'}</p>
      </HudPanel>

      <HudPanel index="ACF" title="Your aircraft" bodyClassName="p-4">
        <div className="grid grid-cols-2 gap-x-2 gap-y-5">
          <Dial
            label="Distance from the radio site"
            value={params.distanceNm}
            min={MIN_DIST_NM}
            max={MAX_DIST_NM}
            step={1}
            onChange={(v) => setParam('distanceNm', v)}
            format={(v) => `${v} NM`}
          />
          <Dial
            label={<Term id="altitude">Altitude</Term>}
            value={params.altitudeFt}
            min={MIN_ALT_FT}
            max={MAX_ALT_FT}
            step={100}
            onChange={(v) => setParam('altitudeFt', v)}
            format={(v) => `${v.toLocaleString('en-US')} ft`}
          />
        </div>
        <p className="mt-4 text-[11.5px] leading-4 text-muted-foreground">Arrow keys on the side view move the aircraft too.</p>
      </HudPanel>

      <HudPanel index="CH" title="Channels" bodyClassName="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-1.5">
          <Segmented
            label={<Term id="channel-spacing">Channel spacing</Term>}
            value={params.spacing}
            onChange={(v) => setParam('spacing', v)}
            options={[
              { value: '25', label: '25 kHz' },
              { value: '8.33', label: '8.33 kHz' },
            ]}
          />
          <p className="text-[11.5px] leading-4 text-muted-foreground">{params.spacing === '25' ? '760 channels in the band' : 'Three times as many channels, closer together'}</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Segmented
            label="Listen at"
            value={listenAt}
            onChange={setListenAt}
            options={[
              { value: 'cockpit', label: 'Your cockpit' },
              { value: 'controller', label: 'The controller' },
            ]}
          />
          <p className="text-[11.5px] leading-4 text-muted-foreground">Hear the frequency from the ground, too.</p>
        </div>
      </HudPanel>

      <HudPanel index="ENV" title="When things go wrong" bodyClassName="px-4 py-2">
        <LeverSwitch label={<Term id="stuck-microphone">Stuck microphone (CNS303)</Term>} checked={failures.stuckMic} onChange={(v) => setFailure('stuckMic', v)} />
        <LeverSwitch label="Mountain between" checked={failures.mountain} onChange={(v) => setFailure('mountain', v)} />
        <LeverSwitch label="Main transmitter fails" checked={failures.txFailure} onChange={(v) => setFailure('txFailure', v)} />
        <LeverSwitch
          label={<Term id="adjacent-channel-interference">Interference from the next channel</Term>}
          checked={failures.interference}
          onChange={(v) => setFailure('interference', v)}
          hint={failures.interference ? `CNS707 is 1 NM away on ${mhzText(adjacentMHz(params.spacing))} MHz` : undefined}
        />
      </HudPanel>

      <p className="hud-panel rounded-md px-4 py-3 text-xs text-muted-foreground">
        Over the ocean, far beyond any VHF antenna, aircraft use a different kind of radio.{' '}
        <Link to="/modules/hf" className="inline-flex items-center gap-0.5 font-medium text-signal hover:underline">
          See how HF bounces off the sky <ArrowRight className="size-3" aria-hidden />
        </Link>
      </p>
    </div>
  )
}
