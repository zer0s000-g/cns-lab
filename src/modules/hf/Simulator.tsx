import { useEffect, useRef } from 'react'
import { Link } from 'react-router'
import { ArrowRight, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AudioCaption, ClockControls, ControlGroup, ControlSlider, ControlSwitch, ControlsPanel, Readout, ReadoutGrid } from '@/components/sim/Controls'
import { Term } from '@/components/Term'
import { HF_CHANNELS_MHZ, OWF_FACTOR, hfQuality, owfMHz, topLayer } from '@/core/hf'
import { useClock, useSimulationLoop } from '@/hooks/useSimClock'
import { useSampled } from '@/hooks/useSampled'
import { HfAudioDirector } from './hfAudio'
import { formatHour, kmText, modeText, nmText, QUALITY_TEXT } from './labels'
import { ComparePanel, SelcalPanel } from './Panels'
import { HfSideView } from './SideView'
import { TIMELAPSE_H_PER_S } from './engine'
import { useHf, useHfState } from './state'

export function HfSimulator() {
  const { engine, clock, store } = useHf()
  const director = useRef<HfAudioDirector | null>(null)
  if (!director.current) director.current = new HfAudioDirector()

  useSimulationLoop(clock, (dt) => {
    engine.step(dt)
    store.getState().sync()
    director.current!.update(engine, clock.getState().running)
  })
  useEffect(() => () => director.current?.dispose(), [])

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-4">
        <figure className="flex min-w-0 flex-col gap-2">
          <figcaption className="flex flex-wrap items-baseline justify-between gap-x-2">
            <span className="text-sm font-semibold">Side view: waves from the HF station and the ionosphere</span>
            <span className="text-xs text-muted-foreground">One ray every 3° of elevation</span>
          </figcaption>
          <HfSideView />
          <Legend />
          <AudioCaption className="min-h-8" />
        </figure>
        <LiveReadouts />
        <div className="grid gap-4 md:grid-cols-2">
          <SelcalPanel />
          <ComparePanel director={director} />
        </div>
      </div>
      <HfControls />
    </div>
  )
}

function Swatch({ kind }: { kind: 'reflected' | 'absorbed' | 'escaped' | 'path' }) {
  return (
    <svg width="28" height="10" viewBox="0 0 28 10" aria-hidden className="shrink-0">
      {kind === 'reflected' && <line x1="1" y1="5" x2="27" y2="5" className="stroke-sim-signal" strokeWidth="1.5" />}
      {kind === 'path' && <line x1="1" y1="5" x2="27" y2="5" className="stroke-primary" strokeWidth="3" />}
      {kind === 'escaped' && <line x1="1" y1="5" x2="27" y2="5" className="stroke-sim-signal-2" strokeWidth="1.5" strokeDasharray="7 5" />}
      {kind === 'absorbed' && (
        <>
          <line x1="1" y1="5" x2="20" y2="5" className="stroke-sim-muted" strokeWidth="1.5" strokeDasharray="1.5 3" />
          <path d="M 20 2 l 6 6 M 26 2 l -6 6" className="stroke-sim-muted" strokeWidth="1.5" />
        </>
      )}
    </svg>
  )
}

function BandSwatch({ kind }: { kind: 'heard' | 'weak' | 'skip' | 'absorbed' }) {
  return (
    <svg width="24" height="10" viewBox="0 0 24 10" aria-hidden className="shrink-0">
      <defs>
        <pattern id={`hf-hatch-${kind}`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="5" className={kind === 'skip' ? 'stroke-sim-warning' : 'stroke-sim-muted'} strokeWidth="1.5" />
        </pattern>
      </defs>
      <rect x="0.5" y="0.5" width="23" height="9" className={kind === 'heard' ? 'fill-sim-signal' : kind === 'weak' ? 'fill-sim-signal opacity-40' : 'fill-none stroke-sim-grid-strong'} />
      {(kind === 'skip' || kind === 'absorbed') && <rect x="0.5" y="0.5" width="23" height="9" fill={`url(#hf-hatch-${kind})`} />}
    </svg>
  )
}

function LayerLine() {
  const { engine } = useHf()
  const text = useSampled(() => {
    const io = engine.iono()
    const parts = [io.flare ? 'D 60–90 km: flare, absorbs almost everything' : io.day ? 'D 60–90 km: absorbs by day' : 'D: almost gone at night']
    for (const L of io.layers) {
      const name = L.id === 'F' ? 'F (F1 and F2 merged at night)' : L.id
      parts.push(`${name} ${Math.round(L.heightKm)} km, returns up to ${L.foMHz.toFixed(1)} MHz straight up${L.id === 'E' && !io.day ? ' (weak at night)' : ''}`)
    }
    return parts.join(' · ')
  }, 300)
  return (
    <p className="text-xs text-muted-foreground">
      <span className="font-medium text-foreground">Layers now: </span>
      {text}
    </p>
  )
}

function Legend() {
  const item = 'inline-flex items-center gap-1.5'
  return (
    <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
      <LayerLine />
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <span className={item}>
          <Swatch kind="reflected" /> reflected, comes back down
        </span>
        <span className={item}>
          <Swatch kind="absorbed" /> absorbed in the D layer
        </span>
        <span className={item}>
          <Swatch kind="escaped" /> escapes into space
        </span>
        <span className={item}>
          <Swatch kind="path" /> the path that reaches CNS101
        </span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <span>At sea level:</span>
        <span className={item}>
          <BandSwatch kind="heard" /> heard
        </span>
        <span className={item}>
          <BandSwatch kind="weak" /> too weak (under the noise)
        </span>
        <span className={item}>
          <BandSwatch kind="skip" /> <Term id="skip-zone">skip zone</Term>
        </span>
        <span className={item}>
          <BandSwatch kind="absorbed" /> absorbed
        </span>
      </div>
    </div>
  )
}

function LiveReadouts() {
  const { engine } = useHf()
  const r = useSampled(
    () => {
      const io = engine.iono()
      const rx = engine.reception()
      const muf = engine.muf()
      const sug = engine.suggestion()
      const skip = engine.skipZone()
      return {
        fo: topLayer(io).foMHz,
        top: topLayer(io).id,
        muf: muf?.mufMHz ?? null,
        mufMode: muf ? `${muf.hops} hop${muf.hops > 1 ? 's' : ''} off ${muf.layer}` : '',
        owf: muf ? owfMHz(muf.mufMHz) : null,
        sug: sug?.mHz ?? null,
        q: hfQuality(rx),
        snr: rx.snrDb,
        mode: modeText(rx),
        skip,
        returns: Number.isFinite(engine.firstLanding()),
        noise: engine.noiseDbm(),
        storm: engine.failures.storm,
        freq: engine.freqMHz,
        dist: engine.params.distanceNm,
      }
    },
    200,
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  )
  return (
    <ReadoutGrid>
      <Readout label={<Term id="critical-frequency">Critical frequency</Term>} value={r.fo.toFixed(1)} unit="MHz" hint={`Highest sent straight up that the ${r.top} layer returns`} />
      <Readout label={<Term id="muf">Highest usable (MUF)</Term>} value={r.muf ? r.muf.toFixed(1) : '—'} unit={r.muf ? 'MHz' : undefined} hint={r.muf ? `To CNS101, ${r.mufMode}` : 'No path'} />
      <Readout
        label={<Term id="owf">Suggested frequency</Term>}
        value={r.sug ? r.sug.toFixed(3) : 'none'}
        unit={r.sug ? 'MHz' : undefined}
        tone={r.sug ? 'default' : 'alert'}
        hint={r.owf ? `${OWF_FACTOR} × MUF ≈ ${r.owf.toFixed(1)} MHz` : 'No frequency works now'}
      />
      <Readout
        label="At CNS101"
        value={QUALITY_TEXT[r.q]}
        tone={r.q === 'clear' ? 'ok' : r.q === 'noisy' ? 'warning' : 'alert'}
        hint={`${r.mode}${Number.isFinite(r.snr) ? ` · ${r.snr.toFixed(0)} dB above noise` : ''}`}
      />
      <Readout
        label="Skip zone at sea level"
        value={r.skip ? `${Math.round(r.skip.fromNm)}–${Math.round(r.skip.toNm).toLocaleString('en-US')}` : r.returns ? 'none' : 'no sky wave'}
        unit={r.skip ? 'NM' : undefined}
        hint={r.skip ? `${kmText(r.skip.fromNm)} to ${kmText(r.skip.toNm)}` : r.returns ? 'Waves come back down close to the station' : 'Every ray escapes or is absorbed'}
      />
      <Readout label="Noise in the receiver" value={r.noise.toFixed(0)} unit="dBm" hint={r.storm ? 'With thunderstorm static' : 'Background: less at higher frequency'} />
      <Readout label="Frequency" value={r.freq.toFixed(3)} unit="MHz" hint="Upper sideband voice" />
      <Readout label="CNS101 distance" value={nmText(r.dist)} hint={kmText(r.dist)} />
    </ReadoutGrid>
  )
}

function HfControls() {
  const { engine, clock } = useHf()
  const params = useHfState((s) => s.params)
  const failures = useHfState((s) => s.failures)
  const { setParam, setFailure, resetAll } = useHfState((s) => s)
  const running = useClock(clock, (s) => s.running)
  const sug = useSampled(() => engine.suggestion(), 250, (a, b) => a?.index === b?.index)
  const wrong = useSampled(() => engine.wrongFrequency(), 250)
  return (
    <ControlsPanel className="h-fit xl:sticky xl:top-20">
      <ControlGroup title="Time">
        <ClockControls clock={clock} onReset={resetAll} />
        {!running && <p className="text-xs text-muted-foreground">Paused. Press Play for SELCAL and the time-lapse.</p>}
        <ControlSlider
          label="Time of day"
          value={params.hour}
          min={0}
          max={23.75}
          step={0.25}
          onChange={(v) => setParam('hour', v)}
          format={(v) => `${formatHour(v)} · ${v >= 6 && v < 18 ? 'day' : 'night'}`}
          hint="Local time on the path. The Sun rises at 06:00 and sets at 18:00."
        />
        <ControlSwitch
          label="Let the day go by"
          checked={params.timelapse}
          onChange={(v) => {
            setParam('timelapse', v)
            if (v) clock.getState().play()
          }}
          hint={`Time-lapse: 1 hour every ${Math.round(1 / TIMELAPSE_H_PER_S)} seconds`}
        />
      </ControlGroup>

      <ControlGroup title="Radio">
        <ControlSlider
          label={<Term id="frequency">Frequency</Term>}
          value={params.channelIndex}
          min={0}
          max={HF_CHANNELS_MHZ.length - 1}
          step={1}
          onChange={(v) => setParam('channelIndex', v)}
          format={(v) => `${HF_CHANNELS_MHZ[v].toFixed(3)} MHz`}
          hint="One example channel in each aeronautical HF band."
        />
        <Button variant="outline" size="sm" disabled={!sug || sug.index === params.channelIndex} onClick={() => sug && setParam('channelIndex', sug.index)}>
          <Wand2 aria-hidden /> {sug ? `Use the suggested ${sug.mHz.toFixed(3)} MHz` : 'No frequency works now'}
        </Button>
      </ControlGroup>

      <ControlGroup title="Your aircraft">
        <ControlSlider
          label="Distance from the HF station"
          value={params.distanceNm}
          min={50}
          max={2500}
          step={10}
          onChange={(v) => setParam('distanceNm', v)}
          format={(v) => `${v.toLocaleString('en-US')} NM`}
          hint={`${kmText(params.distanceNm)}. CNS101 cruises at 35,000 ft.`}
        />
      </ControlGroup>

      <ControlGroup title="When things go wrong">
        <ControlSwitch label={<Term id="solar-flare">Solar flare</Term>} checked={failures.flare} onChange={(v) => setFailure('flare', v)} hint={failures.flare && !engine.day ? 'Night: the flare has no effect here' : undefined} />
        <ControlSwitch
          label="Wrong frequency for the time of day"
          checked={wrong}
          onChange={(v) => {
            if (v) setParam('channelIndex', engine.wrongChannelIndex())
            else if (sug) setParam('channelIndex', sug.index)
          }}
          disabled={!wrong && !sug}
        />
        <ControlSwitch label={<Term id="atmospheric-noise">Thunderstorm static</Term>} checked={failures.storm} onChange={(v) => setFailure('storm', v)} />
      </ControlGroup>

      <p className="text-xs text-muted-foreground">
        HF voice is being replaced by text messages and satellites over many oceans.{' '}
        <Link to="/modules/cpdlc" className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline">
          See how CPDLC works <ArrowRight className="size-3" aria-hidden />
        </Link>
      </p>
    </ControlsPanel>
  )
}
