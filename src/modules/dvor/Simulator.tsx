import { useEffect } from 'react'
import { Link } from 'react-router'
import { ArrowRight, Volume2, VolumeX } from 'lucide-react'
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
import { magneticToTrue, trueToMagnetic } from '@/core/geometry'
import { morseTimeline, toMorse } from '@/core/morse'
import { CDI_FULL_SCALE_DEG, isVorChannel, MONITOR, VOR_BAND_MHZ, VOR_IDENT, type VorType } from '@/core/vor'
import { useClock, useSimulationLoop } from '@/hooks/useSimClock'
import { useSampled } from '@/hooks/useSampled'
import { CDI } from '@/instruments'
import { fmt3 } from '@/instruments/draw'
import { audio, caption } from '@/lib/audio'
import { ErrorChart } from './ErrorChart'
import { SIGNAL_SLOWDOWN, STATION, type Autopilot, type Preset } from './engine'
import { SideView } from './SideView'
import { SignalView } from './SignalView'
import { Station3D } from './Station3D'
import { useDvor, useDvorState } from './state'
import { VorMap } from './VorMap'

function formatVariation(v: number) {
  if (Math.abs(v) < 0.05) return '0°'
  return `${Math.abs(v).toFixed(0)}° ${v > 0 ? 'East' : 'West'}`
}

export function DvorSimulator() {
  const { engine, clock, store } = useDvor()
  useSimulationLoop(clock, (dt) => {
    engine.step(dt)
    if (store.getState().autopilot !== engine.autopilot) store.setState({ autopilot: engine.autopilot })
  })
  useIdentAudio()
  const type = useDvorState((s) => s.env.type)
  const range = useDvorState((s) => s.mapRangeNm)
  const speed = useClock(clock, (c) => c.speed)
  const running = useClock(clock, (c) => c.running)
  const turnS = ((1 / 30) * SIGNAL_SLOWDOWN) / speed

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
              <VorMap />
              <div className="pointer-events-none absolute top-2 left-2 flex max-w-[calc(100%-3rem)] flex-wrap gap-1.5">
                <ClockSpeedLabel clock={clock} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Map with <Term id="true-north">true north</Term> up, {range} NM around the station. The compass rose is the
              station's: it is aligned to <Term id="magnetic-north">magnetic north</Term>. Solid blue line: the{' '}
              <Term id="radial">radial</Term> the receiver measures.
            </p>
          </figure>
          <figure className="flex min-w-0 flex-col gap-2">
            <figcaption className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold">The station</span>
              <span className="text-xs text-muted-foreground">{type === 'dvor' ? 'Doppler VOR (DVOR)' : 'Conventional VOR (CVOR)'}</span>
            </figcaption>
            <div className="relative">
              <Station3D type={type} className="aspect-square w-full" />
              <div className="pointer-events-none absolute top-2 left-2 flex max-w-[calc(100%-1rem)] flex-wrap gap-1.5">
                {running ? (
                  <SimLabel>Slowed down so you can see it: one turn in {turnS.toFixed(turnS < 10 ? 1 : 0)} s, not 1/30 s</SimLabel>
                ) : (
                  <SimLabel icon="none">Paused</SimLabel>
                )}
                {type === 'cvor' && <SimLabel icon="none">Pattern shape exaggerated</SimLabel>}
                <SimLabel icon="none">Distances not to scale</SimLabel>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {type === 'dvor' ? (
                <>
                  The glowing ball jumps around the ring of 48 antennas counter-clockwise (<Term id="commutation">switching</Term>
                  ). When it moves straight toward you, the <Term id="doppler-effect">Doppler effect</Term> raises the frequency
                  most. Blue bar: toward the aircraft. Triangle: magnetic north.
                </>
              ) : (
                <>
                  The blue shape is the radiation pattern, turning clockwise. When its bulge points at you, the signal is
                  strongest: that is the variable 30 Hz <Term id="am">AM</Term>. Blue bar: toward the aircraft. Triangle:
                  magnetic north.
                </>
              )}
            </p>
          </figure>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <figure className="flex min-w-0 flex-col gap-2">
            <figcaption className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold">What the receiver hears</span>
              <span className="text-xs text-muted-foreground">
                <Term id="reference-signal">REF</Term> and <Term id="variable-signal">VAR</Term>
              </span>
            </figcaption>
            <SignalView />
          </figure>
          <CdiPanel />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <figure className="flex min-w-0 flex-col gap-2">
            <figcaption className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold">Side view</span>
              <span className="text-xs text-muted-foreground">
                <Term id="cone-of-confusion">Cone of confusion</Term>
              </span>
            </figcaption>
            <div className="relative">
              <SideView />
              <div className="pointer-events-none absolute top-2 right-2">
                <SimLabel icon="none">Heights stretched</SimLabel>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Along the aircraft's track. Climb and fly over the station to see the cone.</p>
          </figure>
          <figure className="flex min-w-0 flex-col gap-2">
            <figcaption className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold">Course error around the station</span>
              <span className="text-xs text-muted-foreground">
                <Term id="scalloping">Scalloping</Term> from a building
              </span>
            </figcaption>
            <ErrorChart />
            <p className="text-xs text-muted-foreground">
              Across: the radial. Up and down: how far the reflection can push the needle. Dots: what the needle did as you flew.
            </p>
          </figure>
        </div>
        <LiveReadouts />
      </div>
      <DvorControls />
    </div>
  )
}

function CdiPanel() {
  const { engine } = useDvor()
  const obs = useDvorState((s) => s.obsDeg)
  const setObs = useDvorState((s) => s.setObs)
  const hint = useSampled(() => {
    const c = engine.last.cdi
    if (!engine.last.received) return 'No signal: warning flag. Do not use.'
    if (!engine.last.usable) return 'Over the station: warning flag, the needle cannot be trusted.'
    if (c.toFrom === 'OFF') return 'Abeam the course: the TO/FROM flag cannot decide.'
    const side = Math.abs(c.deviationDeg) < 0.5 ? 'Centred: you are on the course.' : `The course is to your ${c.deviationDeg > 0 ? 'right' : 'left'}: fly ${c.deviationDeg > 0 ? 'right' : 'left'}.`
    return `${c.toFrom === 'TO' ? 'TO: flying this course takes you toward the station.' : 'FROM: flying this course takes you away from the station.'} ${side}`
  }, 250)
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">In the cockpit</span>
        <span className="text-xs text-muted-foreground">
          <Term id="cdi">CDI</Term> with <Term id="obs">OBS</Term> knob
        </span>
      </figcaption>
      <div className="flex flex-col items-center gap-2 rounded-lg border bg-card p-3">
        <CDI
          title="VOR"
          size={220}
          read={() => ({ courseDeg: engine.obsDeg, lateral: engine.last.cdi.lateral, toFrom: engine.last.cdi.toFrom })}
          onCourseChange={setObs}
        />
        <p className="text-center text-xs text-muted-foreground" aria-live="polite">
          {hint}
        </p>
        <p className="sr-only">Selected course {fmt3(obs)}.</p>
      </div>
    </figure>
  )
}

function LiveReadouts() {
  const { engine } = useDvor()
  const r = useSampled(() => {
    const x = engine.last
    return {
      radial: x.radialMeasured,
      geo: x.radialGeometric,
      usable: x.usable,
      received: x.received,
      radiating: x.radiating,
      dist: x.distanceNm,
      alt: engine.aircraft.altitudeFt,
      elev: x.elevationDeg,
      cone: x.cone,
      toFrom: x.cdi.toFrom,
      dev: x.cdi.deviationDeg,
      site: x.siteErrorDeg,
      building: engine.env.building,
      status: engine.status,
      monitor: engine.monitorShiftDeg,
      ident: x.identAudible,
      identRemoved: engine.env.identRemoved,
      obs: engine.obsDeg,
    }
  }, 250)
  const dots = Math.min(5, Math.abs(r.dev) / (CDI_FULL_SCALE_DEG / 5))
  return (
    <ReadoutGrid>
      <Readout
        label="Radial (FROM the station)"
        value={r.radial == null || !r.usable ? '—' : `${fmt3(r.radial)}°`}
        hint={r.radial == null ? 'No signal' : r.usable ? 'Magnetic' : 'Unusable over the station'}
        tone={r.received && !r.usable ? 'warning' : 'default'}
      />
      <Readout
        label="Phase difference"
        value={r.radial == null ? '—' : `${fmt3(r.radial)}°`}
        hint={r.received && !r.usable ? 'Garbled over the station' : 'AM lags FM by this much'}
        tone={r.received && !r.usable ? 'warning' : 'default'}
      />
      <Readout label="Selected course (OBS)" value={`${fmt3(r.obs)}°`} />
      <Readout
        label="Needle"
        value={r.toFrom === 'OFF' ? 'OFF' : `${r.toFrom} ${dots < 0.05 ? 'centred' : `${dots.toFixed(1)} ${r.dev > 0 ? 'R' : 'L'}`}`}
        tone={r.toFrom === 'OFF' ? 'alert' : 'default'}
        hint={r.toFrom === 'OFF' ? 'Warning flag' : 'Dots: 2° each'}
      />
      <Readout label="Distance" value={r.dist.toFixed(1)} unit="NM" hint={`${Math.round(r.alt).toLocaleString('en-US')} ft`} />
      <Readout
        label="Angle up from the station"
        value={r.elev.toFixed(0)}
        unit="°"
        tone={r.cone === 'cone' ? 'alert' : r.cone === 'swing' ? 'warning' : 'default'}
        hint={r.cone === 'cone' ? 'Inside the cone' : r.cone === 'swing' ? 'Needle swinging' : 'Clear of the cone'}
      />
      <Readout
        label="Station"
        value={r.status === 'alarm' ? 'OFF AIR' : r.status === 'standby' ? 'Standby TX' : 'Normal'}
        tone={r.status === 'alarm' ? 'alert' : r.status === 'standby' ? 'warning' : 'ok'}
        hint={`Monitor: ${r.monitor.toFixed(2)}° (alarm at ${MONITOR.bearingAlarmDeg}°)`}
      />
      <Readout
        label="Ident"
        value={r.ident ? STATION.ident : 'None'}
        tone={r.ident ? 'ok' : 'alert'}
        hint={r.ident ? toMorse(STATION.ident) : r.identRemoved && r.received ? 'Maintenance: do not use' : 'No signal'}
      />
      {r.building && (
        <Readout
          label="Reflection error now"
          value={r.received ? `${r.site >= 0 ? '+' : '−'}${Math.abs(r.site).toFixed(1)}°` : '—'}
          tone={Math.abs(r.site) >= 2 ? 'warning' : 'ok'}
          hint={r.received ? `Correct radial ${fmt3(r.geo)}°` : undefined}
        />
      )}
    </ReadoutGrid>
  )
}

function useIdentAudio() {
  const { engine } = useDvor()
  const listening = useDvorState((s) => s.listening)
  const audible = useSampled(() => engine.last.identAudible, 250)
  const removed = useSampled(() => engine.env.identRemoved && engine.last.received, 250)
  useEffect(() => {
    if (!listening) return
    const ident = STATION.ident
    if (!audible) {
      const text = removed ? 'No ident heard: the station is being worked on. Do not use it.' : 'Nothing heard: no signal from the station.'
      caption(text, 6)
      const id = window.setInterval(() => caption(text, 6), 6000)
      return () => window.clearInterval(id)
    }
    const { segments } = morseTimeline(ident, VOR_IDENT.wpm)
    const h = audio.keyed(segments, VOR_IDENT.toneHz, { loopPeriodS: VOR_IDENT.repeatS })
    const text = `Morse ident ${ident}: ${toMorse(ident)} (${VOR_IDENT.toneHz} Hz tone)`
    caption(text, 5)
    const id = window.setInterval(() => caption(text, 5), VOR_IDENT.repeatS * 1000)
    return () => {
      h.stop()
      window.clearInterval(id)
    }
  }, [listening, audible, removed])
}

const PRESETS: { id: Preset; label: string }[] = [
  { id: 'west', label: 'Inbound from the west' },
  { id: 'circle', label: 'Circle at 5 NM' },
  { id: 'overfly', label: 'High over the station' },
]

function DvorControls() {
  const { engine, clock } = useDvor()
  const s = useDvorState((x) => x)
  const running = useClock(clock, (c) => c.running)
  const ac = useSampled(
    () => ({
      heading: Math.round(trueToMagnetic(engine.aircraft.mode.kind === 'heading' ? engine.aircraft.targetHeadingDeg : engine.aircraft.headingDeg, engine.variationDeg)) % 360,
      speed: Math.round(engine.aircraft.targetSpeedKt),
      alt: Math.round(engine.aircraft.targetAltitudeFt),
    }),
    200,
  )
  const validChannel = isVorChannel(s.freqMHz)

  return (
    <ControlsPanel className="h-fit xl:sticky xl:top-20">
      <ControlGroup title="Time">
        <ClockControls clock={clock} onReset={s.resetAll} />
        {!running && <p className="text-xs text-muted-foreground">Paused. Press Play to let the aircraft fly.</p>}
      </ControlGroup>

      <ControlGroup title="The station">
        <ControlChoice<VorType>
          label="Type"
          value={s.env.type}
          onChange={(v) => s.setEnv('type', v)}
          options={[
            { value: 'cvor', label: 'Conventional (CVOR)' },
            { value: 'dvor', label: 'Doppler (DVOR)' },
          ]}
          hint={
            s.env.type === 'cvor'
              ? 'REF: 30 Hz FM on a 9960 Hz subcarrier. VAR: 30 Hz AM from a turning pattern.'
              : 'REF: 30 Hz AM from the centre antenna. VAR: 30 Hz FM from the Doppler ring.'
          }
        />
        <ControlSlider
          label={<Term id="frequency">Frequency</Term>}
          value={s.freqMHz}
          min={VOR_BAND_MHZ.min}
          max={VOR_BAND_MHZ.max}
          step={0.05}
          onChange={(v) => s.setFreq(Math.round(v * 20) / 20)}
          format={(v) => `${v.toFixed(2)} MHz`}
          hint={validChannel ? 'VOR band: 108.00–117.95 MHz' : 'Below 112 MHz the odd tenths belong to ILS localizers, not VORs'}
        />
        <div className="flex flex-col gap-2">
          <Button variant={s.listening ? 'default' : 'outline'} size="sm" onClick={() => s.setListening(!s.listening)} aria-pressed={s.listening} className="w-fit">
            {s.listening ? <VolumeX aria-hidden /> : <Volume2 aria-hidden />}
            {s.listening ? 'Stop the ident' : 'Listen to the ident'}
          </Button>
          <p className="text-xs text-muted-foreground">
            <Term id="morse-ident">Morse ident</Term> <span className="font-mono font-medium text-foreground">{STATION.ident}</span>{' '}
            <span className="font-mono">{toMorse(STATION.ident)}</span>, about every {VOR_IDENT.repeatS} s
          </p>
          <AudioCaption />
        </div>
        <ControlSlider
          label={<Term id="magnetic-variation">Magnetic variation</Term>}
          value={s.variationDeg}
          min={-20}
          max={20}
          onChange={s.setVariation}
          format={formatVariation}
          hint="The station is aligned to magnetic north, so radials are magnetic. The map uses true north."
        />
      </ControlGroup>

      <ControlGroup title="Fly the aircraft">
        <ControlChoice<Autopilot>
          label="Autopilot"
          value={s.autopilot}
          onChange={s.setAutopilot}
          options={[
            { value: 'heading', label: 'Heading' },
            { value: 'track', label: 'Course' },
            { value: 'orbit', label: 'Circle' },
            { value: 'direct', label: 'To VOR' },
          ]}
          hint={
            s.autopilot === 'track'
              ? 'Follows the needle on the OBS course'
              : s.autopilot === 'orbit'
                ? 'Flies a clockwise circle around the station'
                : s.autopilot === 'direct'
                  ? 'Straight to the station, then straight on'
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
        <ControlSlider label="Speed" value={ac.speed} min={120} max={450} step={10} onChange={(v) => engine.setAircraft({ targetSpeedKt: v })} format={(v) => `${v} kt`} />
        <ControlSlider
          label="Altitude"
          value={ac.alt}
          min={1000}
          max={35000}
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
        <ControlChoice
          label="Map range"
          value={String(s.mapRangeNm)}
          onChange={(v) => s.setMapRange(Number(v))}
          options={[
            { value: '10', label: '10 NM' },
            { value: '25', label: '25 NM' },
            { value: '50', label: '50 NM' },
          ]}
        />
      </ControlGroup>

      <ControlGroup title="When things go wrong">
        <ControlSwitch label="Building near the station" checked={s.env.building} onChange={(v) => s.setEnv('building', v)} hint="Its reflection bends the course" />
        {s.env.building && (
          <ControlSlider
            label="Building distance"
            value={s.env.buildingDistanceM}
            min={100}
            max={800}
            step={10}
            onChange={(v) => s.setEnv('buildingDistanceM', v)}
            format={(v) => `${v} m`}
          />
        )}
        <ControlSwitch label="Transmitter fault" checked={s.env.fault} onChange={(v) => s.setEnv('fault', v)} hint="The bearing starts to drift; watch the monitor" />
        <ControlSwitch label="Standby transmitter fitted" checked={s.env.standby} onChange={(v) => s.setEnv('standby', v)} hint={`Takes over about ${MONITOR.changeoverS} s after an alarm`} />
        <ControlSwitch label="Ident removed (maintenance)" checked={s.env.identRemoved} onChange={(v) => s.setEnv('identRemoved', v)} />
      </ControlGroup>

      <p className="text-xs text-muted-foreground">
        A VOR gives direction, not distance.{' '}
        <Link to="/modules/dme" className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline">
          DME adds the distance <ArrowRight className="size-3" aria-hidden />
        </Link>
      </p>
    </ControlsPanel>
  )
}
