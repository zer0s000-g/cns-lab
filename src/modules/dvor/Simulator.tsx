import { useEffect, type ComponentProps } from 'react'
import { Link } from 'react-router'
import { ArrowRight, Volume2, VolumeX } from 'lucide-react'
import { AudioCaption, ClockControls, ClockSpeedLabel, ControlSlider, SimLabel } from '@/components/sim/Controls'
import { ChapterHead } from '@/components/module/ModuleLayout'
import { Term } from '@/components/Term'
import { magneticToTrue, trueToMagnetic } from '@/core/geometry'
import { morseTimeline, toMorse } from '@/core/morse'
import { CDI_FULL_SCALE_DEG, isVorChannel, MONITOR, VOR_BAND_MHZ, VOR_IDENT, type VorType } from '@/core/vor'
import { useClock, useSimulationLoop } from '@/hooks/useSimClock'
import { useSampled } from '@/hooks/useSampled'
import { Dial, HudButton, LeverSwitch, Segmented } from '@/hud/Controls'
import { HudPanel } from '@/hud/HudFrame'
import { TelemetryRow } from '@/hud/Telemetry'
import { CDI } from '@/instruments'
import { fmt3 } from '@/instruments/draw'
import { audio, caption } from '@/lib/audio'
import { ErrorChart } from './ErrorChart'
import { SIGNAL_SLOWDOWN, STATION, type Autopilot, type Preset } from './engine'
import { SideView } from './SideView'
import { SignalView } from './SignalView'
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
    <div className="flex flex-col gap-4">
      <div className="hud-panel rounded-md px-5 py-4 md:w-fit md:max-w-[520px]">
        <ChapterHead
          n={2}
          title="Simulator"
          lead="The table behind shows the station, the aircraft and the radial it is on. The CDI shows only what the receiver works out."
        />
      </div>
      <div className="grid gap-4 md:grid-cols-[minmax(0,420px)_1fr_minmax(0,340px)]">
        <div className="flex min-w-0 flex-col gap-4">
          <HudPanel index="MAP" title="Seen from above" bodyClassName="p-3">
            <div className="relative">
              <VorMap />
              <div className="pointer-events-none absolute top-2 left-2 flex max-w-[calc(100%-3rem)] flex-wrap gap-1.5">
                <ClockSpeedLabel clock={clock} />
              </div>
            </div>
            <p className="mt-2.5 text-[11.5px] leading-5 text-muted-foreground">
              Map with <Term id="true-north">true north</Term> up, {range} NM around the station. The compass rose is the
              station's: it is aligned to <Term id="magnetic-north">magnetic north</Term>. Solid line: the{' '}
              <Term id="radial">radial</Term> the receiver measures. Drag the aircraft to move it.
            </p>
          </HudPanel>
          <HudPanel index="STN" title="The station" actions={<span className="hud-label">{type === 'dvor' ? 'Doppler VOR' : 'Conventional VOR'}</span>} bodyClassName="p-3">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {running ? (
                <SimLabel>Slowed down so you can see it: one turn in {turnS.toFixed(turnS < 10 ? 1 : 0)} s, not 1/30 s</SimLabel>
              ) : (
                <SimLabel icon="none">Paused</SimLabel>
              )}
              {type === 'cvor' && <SimLabel icon="none">Pattern shape exaggerated</SimLabel>}
              <SimLabel icon="none">Distances not to scale</SimLabel>
            </div>
            <p className="text-[11.5px] leading-5 text-muted-foreground">
              {type === 'dvor' ? (
                <>
                  On the table behind, the glowing light jumps around the ring of 48 antennas counter-clockwise (
                  <Term id="commutation">switching</Term>). When it moves straight toward you, the{' '}
                  <Term id="doppler-effect">Doppler effect</Term> raises the frequency most. Cyan line: the radial toward
                  the aircraft. Brass triangle: magnetic north.
                </>
              ) : (
                <>
                  On the table behind, the glowing shape is the radiation pattern, turning clockwise. When its bulge points
                  at you, the signal is strongest: that is the variable 30 Hz <Term id="am">AM</Term>. Cyan line: the radial
                  toward the aircraft. Brass triangle: magnetic north.
                </>
              )}
            </p>
          </HudPanel>
          <CdiPanel />
        </div>
        <div aria-hidden className="hidden md:block" />
        <DvorControls />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <HudPanel
          index="SIG"
          className="min-w-0"
          title="What the receiver hears"
          actions={
            <span className="hud-label">
              <Term id="reference-signal">REF</Term> and <Term id="variable-signal">VAR</Term>
            </span>
          }
          bodyClassName="p-3"
        >
          <SignalView />
        </HudPanel>
        <HudPanel index="ALT" className="min-w-0" title="Side view" actions={<span className="hud-label"><Term id="cone-of-confusion">Cone</Term></span>} bodyClassName="p-3">
          <div className="relative">
            <SideView />
            <div className="pointer-events-none absolute top-2 right-2">
              <SimLabel icon="none">Heights stretched</SimLabel>
            </div>
          </div>
          <p className="mt-2.5 text-[11.5px] leading-5 text-muted-foreground">
            Along the aircraft's track. Climb and fly over the station to see the{' '}
            <Term id="cone-of-confusion">cone of confusion</Term>.
          </p>
        </HudPanel>
        <HudPanel index="ERR" className="min-w-0" title="Course error around the station" bodyClassName="p-3">
          <ErrorChart />
          <p className="mt-2.5 text-[11.5px] leading-5 text-muted-foreground">
            <Term id="scalloping">Scalloping</Term> from a building. Across: the radial. Up and down: how far the reflection can
            push the needle. Dots: what the needle did as you flew.
          </p>
        </HudPanel>
      </div>
      <LiveReadouts />
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
    <HudPanel
      index="CDI"
      title="In the cockpit"
      actions={
        <span className="hud-label">
          <Term id="cdi">CDI</Term> · <Term id="obs">OBS</Term>
        </span>
      }
      bodyClassName="flex flex-col items-center gap-2 p-3"
    >
      <CDI
        title="VOR"
        size={220}
        read={() => ({ courseDeg: engine.obsDeg, lateral: engine.last.cdi.lateral, toFrom: engine.last.cdi.toFrom })}
        onCourseChange={setObs}
      />
      <p className="text-center text-[11.5px] leading-5 text-muted-foreground" aria-live="polite">
        {hint}
      </p>
      <p className="sr-only">Selected course {fmt3(obs)}.</p>
    </HudPanel>
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
    <HudPanel index="TLM" title="Receiver telemetry" bodyClassName="px-4 py-2">
      <div className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3 [&>*]:border-b [&>*]:border-hud-line">
        <Row
          label="Radial (FROM the station)"
          value={r.radial == null || !r.usable ? '—' : `${fmt3(r.radial)}°`}
          hint={r.radial == null ? 'No signal' : r.usable ? 'Magnetic' : 'Unusable over the station'}
          tone={r.received && !r.usable ? 'brass' : 'signal'}
        />
        <Row
          label="Phase difference"
          value={r.radial == null ? '—' : `${fmt3(r.radial)}°`}
          hint={r.received && !r.usable ? 'Garbled over the station' : 'AM lags FM by this much'}
          tone={r.received && !r.usable ? 'brass' : 'default'}
        />
        <Row label="Selected course (OBS)" value={`${fmt3(r.obs)}°`} tone="brass" />
        <Row
          label="Needle"
          value={r.toFrom === 'OFF' ? 'OFF' : `${r.toFrom} ${dots < 0.05 ? 'centred' : `${dots.toFixed(1)} ${r.dev > 0 ? 'R' : 'L'}`}`}
          tone={r.toFrom === 'OFF' ? 'alert' : 'default'}
          hint={r.toFrom === 'OFF' ? 'Warning flag' : 'Dots: 2° each'}
        />
        <Row label="Distance" value={r.dist.toFixed(1)} unit="NM" hint={`${Math.round(r.alt).toLocaleString('en-US')} ft`} />
        <Row
          label="Angle up from the station"
          value={r.elev.toFixed(0)}
          unit="°"
          tone={r.cone === 'cone' ? 'alert' : r.cone === 'swing' ? 'brass' : 'default'}
          hint={r.cone === 'cone' ? 'Inside the cone' : r.cone === 'swing' ? 'Needle swinging' : 'Clear of the cone'}
        />
        <Row
          label="Station"
          value={r.status === 'alarm' ? 'OFF AIR' : r.status === 'standby' ? 'Standby TX' : 'Normal'}
          tone={r.status === 'alarm' ? 'alert' : r.status === 'standby' ? 'brass' : 'ok'}
          hint={`Monitor: ${r.monitor.toFixed(2)}° (alarm at ${MONITOR.bearingAlarmDeg}°)`}
        />
        <Row
          label="Ident"
          value={r.ident ? STATION.ident : 'None'}
          tone={r.ident ? 'ok' : 'alert'}
          hint={r.ident ? toMorse(STATION.ident) : r.identRemoved && r.received ? 'Maintenance: do not use' : 'No signal'}
        />
        {r.building && (
          <Row
            label="Reflection error now"
            value={r.received ? `${r.site >= 0 ? '+' : '−'}${Math.abs(r.site).toFixed(1)}°` : '—'}
            tone={Math.abs(r.site) >= 2 ? 'brass' : 'ok'}
            hint={r.received ? `Correct radial ${fmt3(r.geo)}°` : undefined}
          />
        )}
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
    <div className="flex min-w-0 flex-col gap-4">
      <HudPanel index="CLK" title="Time" bodyClassName="p-3">
        <ClockControls clock={clock} onReset={s.resetAll} />
        {!running && <p className="mt-2 text-xs text-muted-foreground">Paused. Press Play to let the aircraft fly.</p>}
      </HudPanel>

      <HudPanel index="TX" title="The station" bodyClassName="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-1.5">
          <Segmented<VorType>
            label="Type"
            value={s.env.type}
            onChange={(v) => s.setEnv('type', v)}
            options={[
              { value: 'cvor', label: 'Conventional', ariaLabel: 'Conventional (CVOR)' },
              { value: 'dvor', label: 'Doppler', ariaLabel: 'Doppler (DVOR)' },
            ]}
          />
          <p className="text-[11.5px] leading-4 text-muted-foreground">
            {s.env.type === 'cvor'
              ? 'REF: 30 Hz FM on a 9960 Hz subcarrier. VAR: 30 Hz AM from a turning pattern.'
              : 'REF: 30 Hz AM from the centre antenna. VAR: 30 Hz FM from the Doppler ring.'}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-x-2 gap-y-5">
          <Dial
            label={<Term id="frequency">Frequency</Term>}
            value={s.freqMHz}
            min={VOR_BAND_MHZ.min}
            max={VOR_BAND_MHZ.max}
            step={0.05}
            onChange={(v) => s.setFreq(Math.round(v * 20) / 20)}
            format={(v) => `${v.toFixed(2)} MHz`}
          />
          <Dial
            label={<Term id="magnetic-variation">Variation</Term>}
            value={s.variationDeg}
            min={-20}
            max={20}
            onChange={s.setVariation}
            format={formatVariation}
          />
        </div>
        <p className={validChannel ? 'text-[11.5px] leading-4 text-muted-foreground' : 'text-[11.5px] leading-4 text-brass'}>
          {validChannel ? 'VOR band: 108.00–117.95 MHz' : 'Below 112 MHz the odd tenths belong to ILS localizers, not VORs'}. The
          station is aligned to magnetic north, so radials are magnetic. The map uses true north.
        </p>
        <div className="flex flex-col gap-2">
          <HudButton active={s.listening} onClick={() => s.setListening(!s.listening)} className="w-fit">
            {s.listening ? <VolumeX aria-hidden /> : <Volume2 aria-hidden />}
            {s.listening ? 'Stop the ident' : 'Listen to the ident'}
          </HudButton>
          <p className="text-xs text-muted-foreground">
            <Term id="morse-ident">Morse ident</Term> <span className="hud-value text-foreground">{STATION.ident}</span>{' '}
            <span className="hud-value">{toMorse(STATION.ident)}</span>, about every {VOR_IDENT.repeatS} s
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
              { value: 'heading', label: 'Heading' },
              { value: 'track', label: 'Course' },
              { value: 'orbit', label: 'Circle' },
              { value: 'direct', label: 'To VOR' },
            ]}
          />
          {s.autopilot !== 'heading' && (
            <p className="text-[11.5px] leading-4 text-muted-foreground">
              {s.autopilot === 'track'
                ? 'Follows the needle on the OBS course'
                : s.autopilot === 'orbit'
                  ? 'Flies a clockwise circle around the station'
                  : 'Straight to the station, then straight on'}
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
          <span className="hud-label">Put the aircraft</span>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <HudButton key={p.id} onClick={() => s.place(p.id)}>
                {p.label}
              </HudButton>
            ))}
          </div>
        </div>
        <Segmented
          label="Map range"
          value={String(s.mapRangeNm)}
          onChange={(v) => s.setMapRange(Number(v))}
          options={[
            { value: '10', label: '10 NM' },
            { value: '25', label: '25 NM' },
            { value: '50', label: '50 NM' },
          ]}
        />
      </HudPanel>

      <HudPanel index="ENV" title="When things go wrong" bodyClassName="flex flex-col px-4 py-3">
        <LeverSwitch label="Building near the station" checked={s.env.building} onChange={(v) => s.setEnv('building', v)} hint="Its reflection bends the course" />
        {s.env.building && (
          <div className="py-2">
            <ControlSlider
              label="Building distance"
              value={s.env.buildingDistanceM}
              min={100}
              max={800}
              step={10}
              onChange={(v) => s.setEnv('buildingDistanceM', v)}
              format={(v) => `${v} m`}
            />
          </div>
        )}
        <LeverSwitch label="Transmitter fault" checked={s.env.fault} onChange={(v) => s.setEnv('fault', v)} hint="The bearing starts to drift; watch the monitor" />
        <LeverSwitch
          label="Standby transmitter fitted"
          tone="signal"
          checked={s.env.standby}
          onChange={(v) => s.setEnv('standby', v)}
          hint={`Takes over about ${MONITOR.changeoverS} s after an alarm`}
        />
        <LeverSwitch label="Ident removed (maintenance)" checked={s.env.identRemoved} onChange={(v) => s.setEnv('identRemoved', v)} />
      </HudPanel>

      <p className="text-xs text-muted-foreground">
        A VOR gives direction, not distance.{' '}
        <Link to="/modules/dme" className="inline-flex items-center gap-0.5 font-medium text-signal hover:underline">
          DME adds the distance <ArrowRight className="size-3" aria-hidden />
        </Link>
      </p>
    </div>
  )
}
