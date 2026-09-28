import { useEffect } from 'react'
import { Link } from 'react-router'
import { ArrowRight, Navigation, Volume2, VolumeX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  AudioCaption,
  ClockControls,
  ClockSpeedLabel,
  ControlChoice,
  ControlGroup,
  ControlSlider,
  ControlSwitch,
  ControlsPanel,
  Readout,
  ReadoutGrid,
  SimLabel,
} from '@/components/sim/Controls'
import { Term } from '@/components/Term'
import { magneticToTrue, normalize180, trueToMagnetic } from '@/core/geometry'
import { morseTimeline, toMorse } from '@/core/morse'
import { bearingSum, NDB_BAND_KHZ, NDB_IDENT, type BearingSum } from '@/core/ndb'
import { useClock, useSimulationLoop } from '@/hooks/useSimClock'
import { useSampled } from '@/hooks/useSampled'
import { ADF } from '@/instruments'
import { fmt3 } from '@/instruments/draw'
import { audio, caption } from '@/lib/audio'
import { AntennaPattern } from './AntennaPattern'
import { TIME_OF_DAY_HOUR, type Autopilot, type Preset, type TimeOfDay } from './engine'
import { formatVariation, timeOfDayFromHour } from './format'
import { NdbMap } from './NdbMap'
import { useNdb, useNdbState } from './state'

export function NdbSimulator() {
  const { engine, clock, store } = useNdb()

  useSimulationLoop(clock, (dt) => {
    engine.step(dt)
    // The homing autopilot hands back to heading hold overhead: keep the controls in step.
    if (store.getState().autopilot !== engine.autopilot) store.setState({ autopilot: engine.autopilot })
  })
  useIdentAudio()

  const range = useNdbState((s) => s.mapRangeNm)
  const snap = useAdfSnapshot()

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="grid gap-4 md:grid-cols-2">
          <figure className="flex min-w-0 flex-col gap-2">
            <figcaption className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold">Seen from above</span>
              <span className="text-xs text-muted-foreground">Drag the aircraft to move it</span>
            </figcaption>
            <div className="relative">
              <NdbMap />
              <div className="pointer-events-none absolute top-2 left-2 flex max-w-[calc(100%-3rem)] flex-wrap gap-1.5">
                <ClockSpeedLabel clock={clock} />
                <SimLabel>Radio waves drawn slowed down</SimLabel>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Map with <Term id="true-north">true north</Term> up, {range} NM around the beacon. Solid blue arrow: where the ADF
              needle points. Dashed line: where the beacon really is.
            </p>
            <FormulaCard snap={snap} />
          </figure>
          <Cockpit />
        </div>
        <LiveReadouts snap={snap} />
      </div>
      <NdbControls />
    </div>
  )
}

function Cockpit() {
  const { engine } = useNdb()
  const status = useSampled(
    () => ({
      passage: engine.timeS - engine.lastPassageS < 8,
      ambiguous: engine.last.ambiguous,
      sense: engine.env.sense,
    }),
    200,
  )
  const readAdf = () => ({
    headingDeg: trueToMagnetic(engine.aircraft.headingDeg, engine.variationDeg),
    relativeBearingDeg: engine.last.relative,
  })
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">In the cockpit</span>
        <span className="text-xs text-muted-foreground">Both needles point at the beacon</span>
      </figcaption>
      <div className="rounded-lg border bg-card p-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex min-w-0 flex-col items-center gap-1">
            <ADF mode="adf" size={188} read={readAdf} />
            <p className="text-center text-xs text-muted-foreground">
              <Term id="adf">ADF</Term>: fixed card, needle = <Term id="relative-bearing">relative bearing</Term>
            </p>
          </div>
          <div className="flex min-w-0 flex-col items-center gap-1">
            <ADF mode="rmi" size={188} read={readAdf} />
            <p className="text-center text-xs text-muted-foreground">
              <Term id="rmi">RMI</Term>: card turns with the magnetic heading
            </p>
          </div>
        </div>
        {(status.passage || !status.sense) && (
          <div className="mt-2 flex flex-wrap gap-1.5" aria-live="polite">
            {status.passage && <SimLabel icon="none">Station passage: the needles swung to the tail</SimLabel>}
            {!status.sense && <SimLabel icon="none" className="border-warning/60">Sense antenna failed: the needle may point the wrong way</SimLabel>}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium text-muted-foreground">
          Inside the ADF: <Term id="loop-antenna">loop</Term> and <Term id="sense-antenna">sense</Term> antenna patterns
        </p>
        <AntennaPattern />
      </div>
    </figure>
  )
}

/** One snapshot of the ADF for every text readout, so the numbers always agree with each other. */
interface AdfSnapshot {
  dist: number
  margin: number
  signal: boolean
  trueBrg: number
  sum: BearingSum | null
  hdgMag: number
  err: number | null
  cause: string
}

function useAdfSnapshot(): AdfSnapshot {
  const { engine } = useNdb()
  return useSampled(() => {
    const ind = engine.last
    const e = ind.errors
    const causes: [string, number][] = [
      ['night effect', e.night],
      ['lightning', e.storm],
      ['coast', e.coastal],
      ['mountains', e.mountain],
      ['weak signal', e.noise],
    ]
    const main = causes.reduce((best, c) => (Math.abs(c[1]) > Math.abs(best[1]) ? c : best), ['', 0] as [string, number])
    const hdgMag = trueToMagnetic(engine.aircraft.headingDeg, engine.variationDeg)
    return {
      dist: ind.truth.distanceNm,
      margin: ind.marginDb,
      signal: ind.signal,
      trueBrg: ind.truth.bearingTrue,
      // Rounded parts of "bearing = heading + relative": every readout uses these, so they add up.
      sum: ind.relative == null ? null : bearingSum(hdgMag, ind.relative),
      hdgMag,
      err: ind.relative == null ? null : ind.ambiguous ? 180 : e.total,
      cause: ind.ambiguous ? 'wrong way round' : Math.abs(main[1]) >= 1 ? main[0] : '',
    }
  }, 250)
}

/** Live "magnetic bearing = magnetic heading + relative bearing", always adding up. */
function FormulaCard({ snap }: { snap: AdfSnapshot }) {
  const v = snap.sum
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5">
      <p className="text-xs text-muted-foreground">Magnetic bearing to the beacon = magnetic heading + relative bearing</p>
      {v ? (
        <p className="font-mono text-base font-medium tabular-nums" aria-live="off">
          <span className="text-primary">{fmt3(v.bearing)}°</span> = {fmt3(v.heading)}° + {fmt3(v.relative)}°
          {v.wrapped && <span className="text-muted-foreground"> − 360°</span>}
        </p>
      ) : (
        <p className="font-mono text-base text-muted-foreground">No signal: the needles are parked</p>
      )}
    </div>
  )
}

function LiveReadouts({ snap: r }: { snap: AdfSnapshot }) {
  const quality = !r.signal ? 'None' : r.margin > 25 ? 'Strong' : r.margin > 10 ? 'Good' : 'Weak'
  const errAbs = r.err == null ? null : Math.abs(r.err)
  const sum = r.sum
  return (
    <ReadoutGrid>
      <Readout label="Distance to beacon" value={r.dist.toFixed(1)} unit="NM" />
      <Readout
        label="Signal"
        value={quality}
        tone={!r.signal ? 'alert' : quality === 'Weak' ? 'warning' : 'ok'}
        hint={r.signal ? `${r.margin.toFixed(0)} dB above the minimum` : 'Too far: needle parked'}
      />
      <Readout label="Needle (relative bearing)" value={sum ? `${fmt3(sum.relative)}°` : '—'} hint="Clockwise from the nose" />
      <Readout label="Magnetic heading" value={`${fmt3(sum ? sum.heading : r.hdgMag)}°`} />
      <Readout label="To beacon (magnetic)" value={sum ? `${fmt3(sum.bearing)}°` : '—'} hint="RMI needle head" />
      <Readout label="From beacon (magnetic)" value={sum ? `${fmt3((sum.bearing + 180) % 360)}°` : '—'} hint="RMI needle tail" />
      <Readout label="True bearing on the map" value={`${fmt3(r.trueBrg)}°`} hint="Where the beacon really is" />
      <Readout
        label="Needle error"
        value={errAbs == null ? '—' : `${errAbs >= 0.5 && r.err! < 0 ? '−' : errAbs >= 0.5 ? '+' : ''}${errAbs.toFixed(errAbs < 10 ? 1 : 0)}°`}
        tone={errAbs == null ? 'muted' : errAbs >= 5 ? 'warning' : 'ok'}
        hint={r.cause ? `Mostly: ${r.cause}` : 'Needle on the beacon'}
      />
    </ReadoutGrid>
  )
}

function useIdentAudio() {
  const { engine } = useNdb()
  const listening = useNdbState((s) => s.listening)
  const signal = useSampled(() => engine.last.signal, 300)
  useEffect(() => {
    if (!listening) return
    const ident = engine.station.ident
    if (!signal) {
      caption(`No ${ident} signal here: nothing to hear`, 4)
      return
    }
    const { segments } = morseTimeline(ident, NDB_IDENT.wpm)
    const h = audio.keyed(segments, NDB_IDENT.toneHz, { loopPeriodS: NDB_IDENT.repeatS })
    const text = `Morse ident ${ident}: ${toMorse(ident)} (${NDB_IDENT.toneHz} Hz tone)`
    caption(text, 5)
    const id = window.setInterval(() => caption(text, 5), NDB_IDENT.repeatS * 1000)
    return () => {
      h.stop()
      window.clearInterval(id)
    }
  }, [listening, signal, engine])
}

const PRESETS: { id: Preset; label: string }[] = [
  { id: 'near', label: '20 NM out' },
  { id: 'far', label: 'Far away' },
  { id: 'behind', label: 'Beacon behind' },
  { id: 'coast', label: 'Along the coast' },
  { id: 'mountains', label: 'By the mountains' },
]

function NdbControls() {
  const { engine, clock } = useNdb()
  const s = useNdbState((x) => x)
  const running = useClock(clock, (c) => c.running)
  const ac = useSampled(
    () => ({
      heading: Math.round(trueToMagnetic(engine.aircraft.mode.kind === 'heading' ? engine.aircraft.targetHeadingDeg : engine.aircraft.headingDeg, engine.variationDeg)) % 360,
      speed: Math.round(engine.aircraft.targetSpeedKt),
      alt: Math.round(engine.aircraft.targetAltitudeFt),
      canTurn: engine.last.relative != null && Math.abs(normalize180(engine.last.relative)) > 0.5,
    }),
    200,
  )
  const ident = engine.station.ident

  return (
    <ControlsPanel className="h-fit xl:sticky xl:top-20">
      <ControlGroup title="Time">
        <ClockControls clock={clock} onReset={s.resetAll} />
        {!running && <p className="text-xs text-muted-foreground">Paused. Press Play to let the aircraft fly.</p>}
      </ControlGroup>

      <ControlGroup title="The beacon">
        <ControlSlider
          label={<Term id="frequency">Frequency</Term>}
          value={s.freqKhz}
          min={NDB_BAND_KHZ.min}
          max={NDB_BAND_KHZ.usualMax}
          onChange={s.setFreq}
          format={(v) => `${v} kHz`}
          hint="Most beacons use 190–535 kHz. The band goes up to 1750 kHz."
        />
        <ControlSlider
          label={<Term id="rated-coverage">Rated coverage</Term>}
          value={s.ratedCoverageNm}
          min={15}
          max={100}
          step={5}
          onChange={s.setCoverage}
          format={(v) => `${v} NM`}
          hint="How far the beacon is guaranteed to be strong enough"
        />
        <div className="flex flex-col gap-2">
          <Button variant={s.listening ? 'default' : 'outline'} size="sm" onClick={() => s.setListening(!s.listening)} aria-pressed={s.listening} className="w-fit">
            {s.listening ? <VolumeX aria-hidden /> : <Volume2 aria-hidden />}
            {s.listening ? 'Stop the ident' : 'Listen to the ident'}
          </Button>
          <p className="text-xs text-muted-foreground">
            <Term id="morse-ident">Morse ident</Term> <span className="font-mono font-medium text-foreground">{ident}</span>{' '}
            <span className="font-mono">{toMorse(ident)}</span>, about every {NDB_IDENT.repeatS} s
          </p>
          <AudioCaption />
        </div>
      </ControlGroup>

      <ControlGroup title="Fly the aircraft">
        <ControlChoice<Autopilot>
          label="Autopilot"
          value={s.autopilot}
          onChange={s.setAutopilot}
          options={[
            { value: 'heading', label: 'Hold heading' },
            { value: 'home', label: 'Home' },
            { value: 'orbit', label: 'Circle' },
          ]}
          hint={
            s.autopilot === 'home'
              ? 'Keeps the needle on the nose until overhead'
              : s.autopilot === 'orbit'
                ? 'Flies a clockwise circle around the beacon'
                : undefined
          }
        />
        {s.autopilot === 'orbit' && (
          <ControlSlider label="Circle radius" value={s.orbitRadiusNm} min={2} max={20} onChange={s.setOrbitRadius} format={(v) => `${v} NM`} />
        )}
        <ControlSlider
          label={<Term id="heading">Magnetic heading</Term>}
          value={ac.heading}
          min={0}
          max={359}
          onChange={(v) => engine.setHeading(magneticToTrue(v, engine.variationDeg))}
          format={(v) => `${fmt3(v)}°`}
          hint={s.autopilot !== 'heading' ? 'Move this to take control' : undefined}
        />
        <Button variant="outline" size="sm" className="w-fit" onClick={() => engine.turnToNeedle()} disabled={!ac.canTurn}>
          <Navigation aria-hidden /> Turn until the needle is on the nose
        </Button>
        <ControlSlider label="Speed" value={ac.speed} min={120} max={300} step={5} onChange={(v) => engine.setAircraft({ targetSpeedKt: v })} format={(v) => `${v} kt`} />
        <ControlSlider
          label="Altitude"
          value={ac.alt}
          min={1000}
          max={15000}
          step={500}
          onChange={(v) => engine.setAircraft({ targetAltitudeFt: v })}
          format={(v) => `${v.toLocaleString('en-US')} ft`}
        />
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Put the aircraft</span>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <Button key={p.id} variant="outline" size="sm" onClick={() => s.place(p.id)}>
                {p.label}
              </Button>
            ))}
          </div>
        </div>
      </ControlGroup>

      <ControlGroup title="Map and compass">
        <ControlChoice
          label="Map range"
          value={String(s.mapRangeNm)}
          onChange={(v) => s.setMapRange(Number(v))}
          options={[
            { value: '10', label: '10 NM' },
            { value: '25', label: '25 NM' },
            { value: '50', label: '50 NM' },
            { value: '100', label: '100 NM' },
          ]}
        />
        <ControlSlider
          label={<Term id="magnetic-variation">Magnetic variation</Term>}
          value={s.variationDeg}
          min={-20}
          max={20}
          onChange={s.setVariation}
          format={formatVariation}
          hint="The map uses true north; the RMI uses magnetic north. Try 15° East to see them differ."
        />
      </ControlGroup>

      <ControlGroup title="When things go wrong">
        <ControlChoice<TimeOfDay>
          label="Time of day"
          value={timeOfDayFromHour(s.env.hour)}
          onChange={(v) => s.setEnv('hour', TIME_OF_DAY_HOUR[v])}
          options={[
            { value: 'day', label: 'Day' },
            { value: 'dusk', label: 'Dusk' },
            { value: 'night', label: 'Night' },
            { value: 'dawn', label: 'Dawn' },
          ]}
          hint="At night, waves bounce back from the sky and mix with the ground wave"
        />
        <ControlSwitch label="Thunderstorm nearby" checked={s.env.storm} onChange={(v) => s.setEnv('storm', v)} />
        <ControlSwitch label={<Term id="coastal-refraction">Coastal refraction</Term>} checked={s.env.coastal} onChange={(v) => s.setEnv('coastal', v)} hint="Matters when the signal crosses the coast" />
        <ControlSwitch label={<Term id="mountain-effect">Mountain reflections</Term>} checked={s.env.mountain} onChange={(v) => s.setEnv('mountain', v)} hint="Matters near high terrain" />
        <ControlSwitch label="Sense antenna failed" checked={!s.env.sense} onChange={(v) => s.setEnv('sense', !v)} />
      </ControlGroup>

      <p className="text-xs text-muted-foreground">
        An NDB tells you the direction to one point.{' '}
        <Link to="/modules/dvor" className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline">
          A VOR gives you a whole compass rose of tracks <ArrowRight className="size-3" aria-hidden />
        </Link>
      </p>
    </ControlsPanel>
  )
}
