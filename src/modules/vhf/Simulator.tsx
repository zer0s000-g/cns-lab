import { useEffect, useRef } from 'react'
import { Link } from 'react-router'
import { ArrowRight } from 'lucide-react'
import {
  AudioCaption,
  ClockControls,
  ControlChoice,
  ControlGroup,
  ControlSlider,
  ControlSwitch,
  ControlsPanel,
  Readout,
  ReadoutGrid,
} from '@/components/sim/Controls'
import { Term } from '@/components/Term'
import { radioLineOfSightNm } from '@/core/propagation'
import { RECEIVER_NOISE_DBM } from '@/core/vhf'
import { useClock, useSimulationLoop } from '@/hooks/useSimClock'
import { useSampled } from '@/hooks/useSampled'
import { FrequencyStrips } from './FrequencyStrip'
import { CockpitRadio, VccsPanel } from './Panels'
import { MAX_ALT_FT, MAX_DIST_NM, MIN_ALT_FT, MIN_DIST_NM, VhfSideView } from './SideView'
import { RadioTimeline } from './Timeline'
import { OUTCOME_TEXT, RX_TEXT, WHO_LABEL, freqText, mhzText } from './labels'
import { SITE, adjacentMHz } from './engine'
import { useVhf, useVhfState } from './state'
import { VhfAudioDirector } from './vhfAudio'

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
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-4">
        <figure className="flex min-w-0 flex-col gap-2">
          <figcaption className="flex flex-wrap items-baseline justify-between gap-x-2">
            <span className="text-sm font-semibold">Side view: the radio site, your aircraft and the curve of the Earth</span>
            <span className="text-xs text-muted-foreground">Drag your aircraft, or use the sliders</span>
          </figcaption>
          <VhfSideView />
          <p className="text-xs text-muted-foreground">
            Radio waves at <Term id="vhf">VHF</Term> travel in straight lines. The hatched area is below the{' '}
            <Term id="radio-horizon">radio horizon</Term>: an aircraft there has no <Term id="line-of-sight">line of sight</Term> to the antenna.
          </p>
        </figure>
        <figure className="flex min-w-0 flex-col gap-2">
          <figcaption className="flex flex-wrap items-baseline justify-between gap-x-2">
            <span className="text-sm font-semibold">Who is transmitting</span>
            <span className="text-xs text-muted-foreground">Last 36 seconds. Hatched red: two carriers at once</span>
          </figcaption>
          <RadioTimeline />
          <AudioCaption className="min-h-8" />
        </figure>
        <div className="grid gap-4 md:grid-cols-2">
          <CockpitRadio />
          <VccsPanel />
        </div>
        <LiveReadouts />
        <RadioLog />
        <FrequencyStrips />
      </div>
      <VhfControls />
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
    <ReadoutGrid>
      <Readout label="Range at your altitude" value={r.range.toFixed(0)} unit="NM" hint="Line of sight to the 100 ft antenna" />
      <Readout
        label="Contact lost below"
        value={Math.round(r.floor).toLocaleString('en-US')}
        unit="ft"
        tone={r.contact ? 'default' : 'alert'}
        hint={r.contact ? `At ${r.dist} NM. You are above it` : `At ${r.dist} NM. You are below it: no contact`}
      />
      <Readout
        label="Signal at your radio"
        value={Number.isFinite(r.level) ? r.level.toFixed(0) : '—'}
        unit={Number.isFinite(r.level) ? 'dBm' : undefined}
        hint={Number.isFinite(r.level) ? <><Term id="signal-to-noise">{r.snr.toFixed(0)} dB above the noise</Term></> : 'Blocked: no line of sight'}
      />
      <Readout
        label="Your receiver"
        value={r.ptt ? 'Transmitting' : RX_TEXT[r.state].split(':')[0]}
        tone={r.state === 'blocked' || r.state === 'garbled' ? 'alert' : r.state === 'clear' ? 'ok' : 'muted'}
        hint={`Squelch set at ${r.squelch} dBm`}
      />
    </ReadoutGrid>
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
    <section aria-label="Radio log" className="flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-4">
      <h3 className="text-sm font-semibold">Radio log</h3>
      <p className="-mt-1 text-xs text-muted-foreground">Everything said on the radio, and whether you and the controller heard it. A written record of the audio.</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing yet. The controller will call in a moment, or press Hold to talk.</p>
      ) : (
        <ol className="flex flex-col divide-y">
          {rows.map((r) => (
            <li key={r.id} className="flex min-h-10 flex-col gap-0.5 py-1.5 sm:flex-row sm:items-baseline sm:gap-3">
              <span className="w-28 shrink-0 text-xs font-semibold">
                {r.who}
                {r.live && <span className="ml-1 font-normal text-primary">· on air</span>}
              </span>
              <span className="min-w-0 flex-1 text-sm">{r.text}</span>
              <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">{r.freq}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {[r.ctl && `controller: ${OUTCOME_TEXT[r.ctl]}`, r.you && `you: ${OUTCOME_TEXT[r.you]}`].filter(Boolean).join(' · ')}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
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
    <ControlsPanel className="h-fit xl:sticky xl:top-20">
      <ControlGroup title="Time">
        <ClockControls clock={clock} onReset={resetAll} />
        <p className="text-xs text-muted-foreground">{running ? 'Radio traffic runs in real time.' : 'Paused. Press Play to hear the radio traffic.'}</p>
      </ControlGroup>

      <ControlGroup title="Your aircraft">
        <ControlSlider
          label="Distance from the radio site"
          value={params.distanceNm}
          min={MIN_DIST_NM}
          max={MAX_DIST_NM}
          step={1}
          onChange={(v) => setParam('distanceNm', v)}
          format={(v) => `${v} NM`}
        />
        <ControlSlider
          label={<Term id="altitude">Altitude</Term>}
          value={params.altitudeFt}
          min={MIN_ALT_FT}
          max={MAX_ALT_FT}
          step={100}
          onChange={(v) => setParam('altitudeFt', v)}
          format={(v) => `${v.toLocaleString('en-US')} ft`}
          hint="Arrow keys on the side view move the aircraft too."
        />
      </ControlGroup>

      <ControlGroup title="Channels">
        <ControlChoice
          label={<Term id="channel-spacing">Channel spacing</Term>}
          value={params.spacing}
          onChange={(v) => setParam('spacing', v)}
          options={[
            { value: '25', label: '25 kHz' },
            { value: '8.33', label: '8.33 kHz' },
          ]}
          hint={params.spacing === '25' ? '760 channels in the band' : 'Three times as many channels, closer together'}
        />
        <ControlChoice
          label="Listen at"
          value={listenAt}
          onChange={setListenAt}
          options={[
            { value: 'cockpit', label: 'Your cockpit' },
            { value: 'controller', label: 'The controller' },
          ]}
          hint="Hear the frequency from the ground, too."
        />
      </ControlGroup>

      <ControlGroup title="When things go wrong">
        <ControlSwitch label={<Term id="stuck-microphone">Stuck microphone (CNS303)</Term>} checked={failures.stuckMic} onChange={(v) => setFailure('stuckMic', v)} />
        <ControlSwitch label="Mountain between" checked={failures.mountain} onChange={(v) => setFailure('mountain', v)} />
        <ControlSwitch label="Main transmitter fails" checked={failures.txFailure} onChange={(v) => setFailure('txFailure', v)} />
        <ControlSwitch
          label={<Term id="adjacent-channel-interference">Interference from the next channel</Term>}
          checked={failures.interference}
          onChange={(v) => setFailure('interference', v)}
          hint={failures.interference ? `CNS707 is 1 NM away on ${mhzText(adjacentMHz(params.spacing))} MHz` : undefined}
        />
      </ControlGroup>

      <p className="text-xs text-muted-foreground">
        Over the ocean, far beyond any VHF antenna, aircraft use a different kind of radio.{' '}
        <Link to="/modules/hf" className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline">
          See how HF bounces off the sky <ArrowRight className="size-3" aria-hidden />
        </Link>
      </p>
    </ControlsPanel>
  )
}
