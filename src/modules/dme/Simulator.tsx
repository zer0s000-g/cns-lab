import { useRef } from 'react'
import { Navigation, RotateCw, Route } from 'lucide-react'
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
import { realToSignalUs, slowMotionFor } from '@/core/clock'
import { DME_IDENT_INTERVAL_S, DME_IDENT_TONE_HZ, DME_TRANSPONDER, dmeFrequencies, formatDmeChannel, maxAcceptedInterrogationPps, vhfPairedFrequencyMHz } from '@/core/dme'
import { bearingDeg, normalize360 } from '@/core/geometry'
import { morseTimeline, toMorse } from '@/core/morse'
import { FT_PER_NM } from '@/core/units'
import { useClock, useSimulationLoop } from '@/hooks/useSimClock'
import { useSampled } from '@/hooks/useSampled'
import { DMEReadout } from '@/instruments'
import { audio, caption } from '@/lib/audio'
import { MAX_TRAFFIC } from './engine'
import { PulseView } from './PulseView'
import { REPLAY_REAL_S, type DmeReplay } from './replay'
import { ReplySorter } from './ReplySorter'
import { SideView } from './SideView'
import { TopView } from './TopView'
import { useDme, useDmeState } from './state'

function userHasInteracted(): boolean {
  const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation
  return ua ? ua.hasBeenActive : true
}

export function DmeSimulator() {
  const { engine, clock, store } = useDme()
  const replayRef = useRef<DmeReplay | null>(null)

  useSimulationLoop(clock, (dt, realDt) => {
    const s = store.getState()
    if (s.replay.phase === 'replay') {
      if (clock.getState().running) {
        // The learner pressed Play: leave the frozen replay and go back to live.
        replayRef.current = null
        s.setReplay({ phase: 'idle' })
      } else if (replayRef.current) {
        const rp = replayRef.current
        rp.tUs = Math.min(rp.totalUs, rp.tUs + realToSignalUs(realDt, slowMotionFor(rp.totalUs, REPLAY_REAL_S)))
        return
      }
    }
    engine.step(dt)
    for (const ev of engine.takeEvents()) {
      if (ev === 'ident' && s.identSound) {
        const id = engine.station.ident
        caption(`DME ident: ${id.split('').join(' ')} (${toMorse(id)}) in Morse, ${DME_IDENT_TONE_HZ} Hz`, 5)
        if (userHasInteracted()) audio.keyed(morseTimeline(id, 7).segments, DME_IDENT_TONE_HZ, { gain: 0.12 })
      }
    }
  })

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="grid gap-4 md:grid-cols-2">
          <figure className="flex min-w-0 flex-col gap-2">
            <figcaption className="flex flex-wrap items-baseline justify-between gap-x-2">
              <span className="text-sm font-semibold">Seen from above</span>
              <span className="text-xs text-muted-foreground">Drag CNS101 to move it</span>
            </figcaption>
            <div className="relative">
              <TopView />
              <div className="pointer-events-none absolute top-2 left-2 flex flex-wrap gap-1.5">
                <ClockSpeedLabel clock={clock} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Dots are other aircraft using the station: filled ones get answers, hollow crossed ones do not.
            </p>
          </figure>
          <figure className="flex min-w-0 flex-col gap-2">
            <figcaption className="flex flex-wrap items-baseline justify-between gap-x-2">
              <span className="text-sm font-semibold">Seen from the side</span>
              <span className="text-xs text-muted-foreground">Slant range vs ground distance</span>
            </figcaption>
            <div className="relative">
              <SideView />
              <div className="pointer-events-none absolute top-2 left-2">
                <SimLabel icon="none">Heights exaggerated, not to scale</SimLabel>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              The DME measures the straight diagonal line, the <Term id="slant-range">slant range</Term>. The ground curves away with distance.
            </p>
          </figure>
        </div>
        <LiveReadouts />
        <PulseView replayRef={replayRef} />
        <ReplySorter />
      </div>
      <DmeControls />
    </div>
  )
}

function LiveReadouts() {
  const { engine } = useDme()
  const v = useSampled(() => {
    const e = engine
    const r = e.reading()
    return {
      shown: r.distanceNm,
      status: r.status,
      slant: e.ownSlantNm,
      ground: e.ownGroundNm,
      heightFt: e.ownHeightFt,
      dmeGs: r.groundSpeedKt,
      trueGs: e.own.speedKt,
      eff: e.ownEfficiency,
      heard: e.heard,
      replies: e.load.replyPps,
      squitter: e.load.squitterPps,
      answered: e.load.answeredCount,
      users: e.traffic.length + 1 + (e.twin ? 1 : 0),
      overloaded: e.load.overloaded,
      twin: e.lockedOnTwin,
    }
  }, 250)
  const gsDiff = v.dmeGs !== null ? Math.abs(v.dmeGs - v.trueGs) : 0
  return (
    <ReadoutGrid>
      <Readout
        label="DME shows"
        value={v.shown === null ? '—' : v.shown.toFixed(1)}
        unit={v.shown === null ? undefined : 'NM'}
        tone={v.status === 'LOCK' ? (v.twin ? 'warning' : 'ok') : v.status === 'MEMORY' ? 'warning' : 'muted'}
        hint={v.twin ? 'Locked onto another aircraft' : v.status === 'LOCK' ? 'Locked on its own answers' : v.status === 'MEMORY' ? 'No answers: holding the last value' : 'Searching for its answers'}
      />
      <Readout label="Slant range (true)" value={v.slant.toFixed(1)} unit="NM" hint="Straight line to the antenna" />
      <Readout label="Ground distance" value={v.ground.toFixed(1)} unit="NM" hint="Over the ground, what a map shows" />
      <Readout label="Height above station" value={Math.round(v.heightFt).toLocaleString('en-US')} unit="ft" hint={`= ${(v.heightFt / FT_PER_NM).toFixed(2)} NM`} />
      <Readout
        label="DME groundspeed"
        value={v.dmeGs === null ? '—' : Math.round(v.dmeGs)}
        unit={v.dmeGs === null ? undefined : 'kt'}
        tone={v.dmeGs !== null && gsDiff > 40 ? 'warning' : 'default'}
        hint="How fast the distance changes"
      />
      <Readout label="True groundspeed" value={Math.round(v.trueGs)} unit="kt" hint="How fast CNS101 really flies" />
      <Readout
        label="Our answers"
        value={v.heard ? `${Math.round(v.eff * 100)}%` : '0%'}
        tone={!v.heard || v.eff < 0.5 ? 'alert' : v.eff < 0.8 ? 'warning' : 'default'}
        hint={v.heard ? 'Share of questions answered' : 'The station cannot hear us'}
      />
      <Readout
        label="Station sends"
        value={Math.round(v.replies + v.squitter).toLocaleString('en-US')}
        unit="pairs/s"
        tone={v.overloaded ? 'warning' : 'default'}
        hint={v.overloaded ? `Overloaded: answering ${v.answered} of ${v.users} aircraft` : v.squitter > 1 ? `${Math.round(v.squitter)} of them random squitter` : `Answering ${v.answered} of ${v.users} aircraft`}
      />
    </ReadoutGrid>
  )
}

function DmeControls() {
  const { engine, clock } = useDme()
  const env = useDmeState((s) => s.env)
  const range = useDmeState((s) => s.mapRangeNm)
  const showShadow = useDmeState((s) => s.showShadow)
  const identSound = useDmeState((s) => s.identSound)
  const { setEnv, setMapRange, setShowShadow, setIdentSound, resetAll } = useDmeState((s) => s)
  const running = useClock(clock, (s) => s.running)
  const own = useSampled(() => {
    const a = engine.own
    return { heading: Math.round(a.mode.kind === 'heading' ? a.targetHeadingDeg : a.headingDeg), speed: Math.round(a.targetSpeedKt), alt: Math.round(a.targetAltitudeFt), mode: a.mode.kind }
  }, 200)
  const f = dmeFrequencies(engine.station.channel, env.mode)
  const capacityPps = Math.round(maxAcceptedInterrogationPps())

  return (
    <ControlsPanel className="h-fit xl:sticky xl:top-20">
      <ControlGroup title="Time">
        <ClockControls clock={clock} onReset={resetAll} />
        {!running && <p className="text-xs text-muted-foreground">Paused. Press Play to let the aircraft fly and the DME keep asking.</p>}
      </ControlGroup>

      <ControlGroup title="In the cockpit">
        <DMEReadout read={() => engine.reading()} />
        <AudioCaption />
        <ControlSwitch label="Hear the Morse ident" checked={identSound} onChange={setIdentSound} hint={`About every ${DME_IDENT_INTERVAL_S} s, a ${DME_IDENT_TONE_HZ} Hz tone spells ${engine.station.ident}`} />
      </ControlGroup>

      <ControlGroup title="Fly CNS101">
        <ControlSlider
          label="Altitude"
          value={own.alt}
          min={1000}
          max={40000}
          step={500}
          onChange={(v) => engine.setOwn({ targetAltitudeFt: v })}
          format={(v) => `${v.toLocaleString('en-US')} ft`}
          hint="Climbs and descends at a normal rate"
        />
        <ControlSlider
          label="Heading"
          value={own.heading}
          min={0}
          max={359}
          onChange={(v) => engine.setOwn({ mode: { kind: 'heading' }, targetHeadingDeg: normalize360(v) })}
          format={(v) => `${String(v).padStart(3, '0')}°`}
          hint={own.mode !== 'heading' ? 'Following a route. Move this to take control.' : undefined}
        />
        <ControlSlider label="Speed" value={own.speed} min={120} max={480} step={10} onChange={(v) => engine.setOwn({ targetSpeedKt: v })} format={(v) => `${v} kt`} />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 xl:grid-cols-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => engine.setOwn({ mode: { kind: 'direct', to: { ...engine.station.pos }, thenHeading: bearingDeg(engine.own.pos, engine.station.pos) } })}
          >
            <Navigation aria-hidden /> Fly straight over the station
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => engine.setOwn({ mode: { kind: 'orbit', center: { ...engine.station.pos }, radiusNm: Math.max(2, engine.ownGroundNm), clockwise: true } })}
          >
            <RotateCw aria-hidden /> Circle the station here
          </Button>
          <Button variant="outline" size="sm" onClick={() => engine.placeDefault()}>
            <Route aria-hidden /> Back to the starting route
          </Button>
        </div>
      </ControlGroup>

      <ControlGroup title="The station">
        <ControlChoice
          label={<Term id="dme-channel">Channel</Term>}
          value={env.mode}
          onChange={(v) => setEnv('mode', v)}
          options={[
            { value: 'X', label: `${formatDmeChannel(engine.station.channel, 'X')} · 50 µs` },
            { value: 'Y', label: `${formatDmeChannel(engine.station.channel, 'Y')} · 56 µs` },
          ]}
          hint={`Paired with VOR ${vhfPairedFrequencyMHz(engine.station.channel, env.mode)?.toFixed(2)} MHz. Asks on ${f.interrogationMHz} MHz, answers on ${f.replyMHz} MHz.`}
        />
        <ControlSlider
          label="Other aircraft asking this station"
          value={env.trafficCount}
          min={0}
          max={MAX_TRAFFIC}
          step={1}
          onChange={(v) => setEnv('trafficCount', v)}
          format={(v) => `${v}`}
          hint={`Designed for about ${DME_TRANSPONDER.designAircraft}. It can accept about ${capacityPps.toLocaleString('en-US')} questions per second.`}
        />
        <ControlSwitch
          label={<Term id="dme-jitter">Random spacing (jitter)</Term>}
          checked={!env.noJitter}
          onChange={(v) => setEnv('noJitter', !v)}
          hint="Off: CNS101 and CNS202 ask in step"
        />
      </ControlGroup>

      <ControlGroup title="Map">
        <ControlChoice
          label="Map range"
          value={String(range)}
          onChange={(v) => setMapRange(Number(v))}
          options={[
            { value: '25', label: '25 NM' },
            { value: '50', label: '50 NM' },
            { value: '100', label: '100 NM' },
          ]}
        />
        <ControlSwitch
          label="Show where the station cannot hear CNS101"
          checked={showShadow}
          onChange={setShowShadow}
          hint="Shaded: hidden by hills or the curve of the Earth at this altitude"
        />
      </ControlGroup>
    </ControlsPanel>
  )
}
