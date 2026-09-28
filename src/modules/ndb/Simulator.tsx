import { useEffect, type ComponentProps } from 'react'
import { Link } from 'react-router'
import { ArrowRight, Navigation, Volume2, VolumeX } from 'lucide-react'
import { AudioCaption, ClockControls, ClockSpeedLabel, ControlSlider, SimLabel } from '@/components/sim/Controls'
import { ChapterHead } from '@/components/module/ModuleLayout'
import { Term } from '@/components/Term'
import { magneticToTrue, normalize180, trueToMagnetic } from '@/core/geometry'
import { morseTimeline, toMorse } from '@/core/morse'
import { bearingSum, NDB_BAND_KHZ, NDB_IDENT, type BearingSum } from '@/core/ndb'
import { useClock, useSimulationLoop } from '@/hooks/useSimClock'
import { useSampled } from '@/hooks/useSampled'
import { Dial, HudButton, LeverSwitch, Segmented } from '@/hud/Controls'
import { HudPanel } from '@/hud/HudFrame'
import { TelemetryRow } from '@/hud/Telemetry'
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
    <div className="flex flex-col gap-4">
      <div className="hud-panel rounded-md px-5 py-4 md:w-fit md:max-w-[520px]">
        <ChapterHead
          n={2}
          title="Simulator"
          lead="The table behind shows where the beacon really is. The instruments show only what the ADF works out."
        />
      </div>
      <div className="grid gap-4 md:grid-cols-[minmax(0,420px)_1fr_minmax(0,340px)]">
        <div className="flex min-w-0 flex-col gap-4">
          <HudPanel index="MAP" title="Seen from above" bodyClassName="p-3">
            <div className="relative">
              <NdbMap />
              <div className="pointer-events-none absolute top-2 left-2 flex max-w-[calc(100%-3rem)] flex-wrap gap-1.5">
                <ClockSpeedLabel clock={clock} />
                <SimLabel>Radio waves drawn slowed down</SimLabel>
              </div>
            </div>
            <p className="mt-2.5 text-[11.5px] leading-5 text-muted-foreground">
              Map with <Term id="true-north">true north</Term> up, {range} NM around the beacon. Solid arrow: where the ADF
              needle points. Dashed line: where the beacon really is. Drag the aircraft to move it.
            </p>
            <FormulaCard snap={snap} />
          </HudPanel>
          <Cockpit />
        </div>
        <div aria-hidden className="hidden md:block" />
        <NdbControls />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <HudPanel index="LOOP" title="Inside the ADF" bodyClassName="p-3">
          <p className="mb-2 text-[11.5px] leading-5 text-muted-foreground">
            The <Term id="loop-antenna">loop</Term> and <Term id="sense-antenna">sense</Term> antenna patterns, nose up
          </p>
          <AntennaPattern />
        </HudPanel>
        <LiveReadouts snap={snap} />
      </div>
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
    <HudPanel index="ADF" title="In the cockpit" bodyClassName="p-3">
      <p className="mb-2 text-[11.5px] leading-4 text-muted-foreground">Both needles point at the beacon.</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex min-w-0 flex-col items-center gap-1.5">
          <ADF mode="adf" size={176} read={readAdf} />
          <p className="text-center text-[11.5px] leading-4 text-muted-foreground">
            <Term id="adf">ADF</Term>: fixed card, needle = <Term id="relative-bearing">relative bearing</Term>
          </p>
        </div>
        <div className="flex min-w-0 flex-col items-center gap-1.5">
          <ADF mode="rmi" size={176} read={readAdf} />
          <p className="text-center text-[11.5px] leading-4 text-muted-foreground">
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
    </HudPanel>
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
    <div className="mt-3 border-t border-hud-line pt-2.5">
      <p className="hud-label leading-4">Magnetic bearing to the beacon = magnetic heading + relative bearing</p>
      {v ? (
        <p className="hud-value mt-1 text-[15px] text-foreground" aria-live="off">
          <span className="text-signal">{fmt3(v.bearing)}°</span> = {fmt3(v.heading)}° + {fmt3(v.relative)}°
          {v.wrapped && <span className="text-muted-foreground"> − 360°</span>}
        </p>
      ) : (
        <p className="hud-value mt-1 text-[15px] text-muted-foreground">No signal: the needles are parked</p>
      )}
    </div>
  )
}

function LiveReadouts({ snap: r }: { snap: AdfSnapshot }) {
  const quality = !r.signal ? 'None' : r.margin > 25 ? 'Strong' : r.margin > 10 ? 'Good' : 'Weak'
  const errAbs = r.err == null ? null : Math.abs(r.err)
  const sum = r.sum
  const errText =
    errAbs == null ? '—' : `${errAbs >= 0.5 && r.err! < 0 ? '−' : errAbs >= 0.5 ? '+' : ''}${errAbs.toFixed(errAbs < 10 ? 1 : 0)}°`
  return (
    <HudPanel index="TLM" title="ADF telemetry" bodyClassName="px-4 py-2">
      <div className="grid gap-x-6 sm:grid-cols-2 [&>*]:border-b [&>*]:border-hud-line">
        <Row label="Distance to beacon" value={r.dist.toFixed(1)} unit="NM" />
        <Row
          label="Signal"
          value={quality}
          tone={!r.signal ? 'alert' : quality === 'Weak' ? 'brass' : 'ok'}
          hint={r.signal ? `${r.margin.toFixed(0)} dB above the minimum` : 'Too far: needle parked'}
        />
        <Row label="Needle (relative bearing)" value={sum ? `${fmt3(sum.relative)}°` : '—'} tone="signal" hint="Clockwise from the nose" />
        <Row label="Magnetic heading" value={`${fmt3(sum ? sum.heading : r.hdgMag)}°`} />
        <Row label="To beacon (magnetic)" value={sum ? `${fmt3(sum.bearing)}°` : '—'} hint="RMI needle head" />
        <Row label="From beacon (magnetic)" value={sum ? `${fmt3((sum.bearing + 180) % 360)}°` : '—'} hint="RMI needle tail" />
        <Row label="True bearing on the map" value={`${fmt3(r.trueBrg)}°`} hint="Where the beacon really is" />
        <Row
          label="Needle error"
          value={errText}
          tone={errAbs == null ? 'muted' : errAbs >= 5 ? 'brass' : 'ok'}
          hint={r.cause ? `Mostly: ${r.cause}` : 'Needle on the beacon'}
        />
      </div>
    </HudPanel>
  )
}

/** A telemetry row with a short plain-language hint under it. */
function Row({ hint, ...props }: ComponentProps<typeof TelemetryRow> & { hint?: string }) {
  return (
    <div className="py-0.5">
      <TelemetryRow {...props} className="pb-0.5" />
      {hint && <p className="pb-1.5 text-[11px] leading-4 text-muted-foreground">{hint}</p>}
    </div>
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
    <div className="flex min-w-0 flex-col gap-4">
      <HudPanel index="CLK" title="Time" bodyClassName="p-3">
        <ClockControls clock={clock} onReset={s.resetAll} />
        {!running && <p className="mt-2 text-xs text-muted-foreground">Paused. Press Play to let the aircraft fly.</p>}
      </HudPanel>

      <HudPanel index="TX" title="The beacon" bodyClassName="flex flex-col gap-4 p-4">
        <div className="grid grid-cols-2 gap-x-2 gap-y-5">
          <Dial
            label={<Term id="frequency">Frequency</Term>}
            value={s.freqKhz}
            min={NDB_BAND_KHZ.min}
            max={NDB_BAND_KHZ.usualMax}
            onChange={s.setFreq}
            format={(v) => `${v} kHz`}
          />
          <Dial
            label={<Term id="rated-coverage">Rated coverage</Term>}
            value={s.ratedCoverageNm}
            min={15}
            max={100}
            step={5}
            onChange={s.setCoverage}
            format={(v) => `${v} NM`}
          />
        </div>
        <p className="text-[11.5px] leading-4 text-muted-foreground">
          Most beacons use 190–535 kHz. The band goes up to 1750 kHz. Rated coverage is how far the beacon is guaranteed to
          be strong enough.
        </p>
        <div className="flex flex-col gap-2">
          <HudButton active={s.listening} onClick={() => s.setListening(!s.listening)} className="w-fit">
            {s.listening ? <VolumeX aria-hidden /> : <Volume2 aria-hidden />}
            {s.listening ? 'Stop the ident' : 'Listen to the ident'}
          </HudButton>
          <p className="text-xs text-muted-foreground">
            <Term id="morse-ident">Morse ident</Term> <span className="hud-value text-foreground">{ident}</span>{' '}
            <span className="hud-value">{toMorse(ident)}</span>, about every {NDB_IDENT.repeatS} s
          </p>
          <AudioCaption />
        </div>
      </HudPanel>

      <HudPanel index="ACF" title="Fly the aircraft" bodyClassName="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-1.5">
          <Segmented<Autopilot>
            label="Autopilot"
            value={s.autopilot}
            onChange={s.setAutopilot}
            options={[
              { value: 'heading', label: 'Hold heading' },
              { value: 'home', label: 'Home' },
              { value: 'orbit', label: 'Circle' },
            ]}
          />
          {s.autopilot !== 'heading' && (
            <p className="text-[11.5px] leading-4 text-muted-foreground">
              {s.autopilot === 'home' ? 'Keeps the needle on the nose until overhead' : 'Flies a clockwise circle around the beacon'}
            </p>
          )}
        </div>
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
        <HudButton className="w-fit" onClick={() => engine.turnToNeedle()} disabled={!ac.canTurn}>
          <Navigation aria-hidden /> Turn until the needle is on the nose
        </HudButton>
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
          <span className="hud-label">Put the aircraft</span>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <HudButton key={p.id} onClick={() => s.place(p.id)}>
                {p.label}
              </HudButton>
            ))}
          </div>
        </div>
      </HudPanel>

      <HudPanel index="NAV" title="Map and compass" bodyClassName="flex flex-col gap-4 p-4">
        <Segmented
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
        <div className="flex items-center gap-4">
          <Dial
            label={<Term id="magnetic-variation">Magnetic variation</Term>}
            value={s.variationDeg}
            min={-20}
            max={20}
            onChange={s.setVariation}
            format={formatVariation}
            className="shrink-0"
          />
          <p className="text-[11.5px] leading-4 text-muted-foreground">
            The map uses true north; the RMI uses magnetic north. Try 15° East to see them differ.
          </p>
        </div>
      </HudPanel>

      <HudPanel index="ENV" title="When things go wrong" bodyClassName="flex flex-col gap-2 px-4 py-3">
        <div className="flex flex-col gap-1.5 pb-1">
          <Segmented<TimeOfDay>
            label="Time of day"
            value={timeOfDayFromHour(s.env.hour)}
            onChange={(v) => s.setEnv('hour', TIME_OF_DAY_HOUR[v])}
            options={[
              { value: 'day', label: 'Day' },
              { value: 'dusk', label: 'Dusk' },
              { value: 'night', label: 'Night' },
              { value: 'dawn', label: 'Dawn' },
            ]}
          />
          <p className="text-[11.5px] leading-4 text-muted-foreground">At night, waves bounce back from the sky and mix with the ground wave</p>
        </div>
        <div className="flex flex-col">
          <LeverSwitch label="Thunderstorm nearby" checked={s.env.storm} onChange={(v) => s.setEnv('storm', v)} />
          <LeverSwitch
            label={<Term id="coastal-refraction">Coastal refraction</Term>}
            checked={s.env.coastal}
            onChange={(v) => s.setEnv('coastal', v)}
            hint="Matters when the signal crosses the coast"
          />
          <LeverSwitch
            label={<Term id="mountain-effect">Mountain reflections</Term>}
            checked={s.env.mountain}
            onChange={(v) => s.setEnv('mountain', v)}
            hint="Matters near high terrain"
          />
          <LeverSwitch label="Sense antenna failed" checked={!s.env.sense} onChange={(v) => s.setEnv('sense', !v)} />
        </div>
      </HudPanel>

      <p className="text-xs text-muted-foreground">
        An NDB tells you the direction to one point.{' '}
        <Link to="/modules/dvor" className="inline-flex items-center gap-0.5 font-medium text-signal hover:underline">
          A VOR gives you a whole compass rose of tracks <ArrowRight className="size-3" aria-hidden />
        </Link>
      </p>
    </div>
  )
}
