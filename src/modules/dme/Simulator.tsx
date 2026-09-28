import { type ComponentProps } from 'react'
import { Navigation, RotateCw, Route } from 'lucide-react'
import { AudioCaption, ClockControls, ClockSpeedLabel, ControlSlider, SimLabel } from '@/components/sim/Controls'
import { ChapterHead } from '@/components/module/ModuleLayout'
import { Term } from '@/components/Term'
import { realToSignalUs, slowMotionFor } from '@/core/clock'
import { DME_IDENT_INTERVAL_S, DME_IDENT_TONE_HZ, DME_TRANSPONDER, dmeFrequencies, formatDmeChannel, maxAcceptedInterrogationPps, vhfPairedFrequencyMHz } from '@/core/dme'
import { bearingDeg, normalize360 } from '@/core/geometry'
import { morseTimeline, toMorse } from '@/core/morse'
import { FT_PER_NM } from '@/core/units'
import { useClock, useSimulationLoop } from '@/hooks/useSimClock'
import { useSampled } from '@/hooks/useSampled'
import { Dial, HudButton, LeverSwitch, Segmented } from '@/hud/Controls'
import { HudPanel } from '@/hud/HudFrame'
import { TelemetryRow } from '@/hud/Telemetry'
import { DMEReadout } from '@/instruments'
import { audio, caption } from '@/lib/audio'
import { MAX_TRAFFIC } from './engine'
import { PulseView } from './PulseView'
import { REPLAY_REAL_S } from './replay'
import { ReplySorter } from './ReplySorter'
import { SideView } from './SideView'
import { TopView } from './TopView'
import { useDme, useDmeState } from './state'

function userHasInteracted(): boolean {
  const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation
  return ua ? ua.hasBeenActive : true
}

export function DmeSimulator() {
  const { engine, clock, store, replayRef } = useDme()

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
    <div className="flex flex-col gap-4">
      <div className="hud-panel rounded-md px-5 py-4 md:w-fit md:max-w-[520px]">
        <ChapterHead
          n={2}
          title="Simulator"
          lead="The table behind shows the slant range the DME measures. Ask one question in slow motion to watch the pulses fly."
        />
      </div>
      <div className="grid gap-4 md:grid-cols-[minmax(0,420px)_1fr_minmax(0,340px)]">
        <div className="flex min-w-0 flex-col gap-4">
          <HudPanel index="MAP" title="Seen from above" bodyClassName="p-3">
            <div className="relative">
              <TopView />
              <div className="pointer-events-none absolute top-2 left-2 flex flex-wrap gap-1.5">
                <ClockSpeedLabel clock={clock} />
              </div>
            </div>
            <p className="mt-2.5 text-[11.5px] leading-5 text-muted-foreground">
              Dots are other aircraft using the station: filled ones get answers, hollow crossed ones do not. Drag CNS101 to move it.
            </p>
          </HudPanel>
          <HudPanel index="ALT" title="Seen from the side" bodyClassName="p-3">
            <div className="relative">
              <SideView />
              <div className="pointer-events-none absolute top-2 left-2">
                <SimLabel icon="none">Heights exaggerated, not to scale</SimLabel>
              </div>
            </div>
            <p className="mt-2.5 text-[11.5px] leading-5 text-muted-foreground">
              Slant range vs ground distance. The DME measures the straight diagonal line, the <Term id="slant-range">slant range</Term>. The ground curves away with distance.
            </p>
          </HudPanel>
        </div>
        <div aria-hidden className="hidden md:block" />
        <DmeControls />
      </div>
      <PulseView replayRef={replayRef} />
      <LiveReadouts />
      <ReplySorter />
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
    <HudPanel index="TLM" title="DME telemetry" bodyClassName="px-4 py-2">
      <div className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-4 [&>*]:border-b [&>*]:border-hud-line">
        <Row
          label="DME shows"
          value={v.shown === null ? '—' : v.shown.toFixed(1)}
          unit={v.shown === null ? undefined : 'NM'}
          tone={v.status === 'LOCK' ? (v.twin ? 'brass' : 'ok') : v.status === 'MEMORY' ? 'brass' : 'muted'}
          hint={v.twin ? 'Locked onto another aircraft' : v.status === 'LOCK' ? 'Locked on its own answers' : v.status === 'MEMORY' ? 'No answers: holding the last value' : 'Searching for its answers'}
        />
        <Row label="Slant range (true)" value={v.slant.toFixed(1)} unit="NM" tone="signal" hint="Straight line to the antenna" />
        <Row label="Ground distance" value={v.ground.toFixed(1)} unit="NM" hint="Over the ground, what a map shows" />
        <Row label="Height above station" value={Math.round(v.heightFt).toLocaleString('en-US')} unit="ft" hint={`= ${(v.heightFt / FT_PER_NM).toFixed(2)} NM`} />
        <Row
          label="DME groundspeed"
          value={v.dmeGs === null ? '—' : Math.round(v.dmeGs)}
          unit={v.dmeGs === null ? undefined : 'kt'}
          tone={v.dmeGs !== null && gsDiff > 40 ? 'brass' : 'default'}
          hint="How fast the distance changes"
        />
        <Row label="True groundspeed" value={Math.round(v.trueGs)} unit="kt" hint="How fast CNS101 really flies" />
        <Row
          label="Our answers"
          value={v.heard ? `${Math.round(v.eff * 100)}%` : '0%'}
          tone={!v.heard || v.eff < 0.5 ? 'alert' : v.eff < 0.8 ? 'brass' : 'default'}
          hint={v.heard ? 'Share of questions answered' : 'The station cannot hear us'}
        />
        <Row
          label="Station sends"
          value={Math.round(v.replies + v.squitter).toLocaleString('en-US')}
          unit="pairs/s"
          tone={v.overloaded ? 'brass' : 'default'}
          hint={v.overloaded ? `Overloaded: answering ${v.answered} of ${v.users} aircraft` : v.squitter > 1 ? `${Math.round(v.squitter)} of them random squitter` : `Answering ${v.answered} of ${v.users} aircraft`}
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
    <div className="flex min-w-0 flex-col gap-4">
      <HudPanel index="CLK" title="Time" bodyClassName="p-3">
        <ClockControls clock={clock} onReset={resetAll} />
        {!running && <p className="mt-2 text-xs text-muted-foreground">Paused. Press Play to let the aircraft fly and the DME keep asking.</p>}
      </HudPanel>

      <HudPanel index="DME" title="In the cockpit" bodyClassName="flex flex-col gap-3 p-3">
        <DMEReadout read={() => engine.reading()} />
        <AudioCaption />
        <LeverSwitch
          label="Hear the Morse ident"
          tone="signal"
          checked={identSound}
          onChange={setIdentSound}
          hint={`About every ${DME_IDENT_INTERVAL_S} s, a ${DME_IDENT_TONE_HZ} Hz tone spells ${engine.station.ident}`}
        />
      </HudPanel>

      <HudPanel index="ACF" title="Fly CNS101" bodyClassName="flex flex-col gap-4 p-4">
        <div className="grid grid-cols-2 gap-x-2 gap-y-5">
          <Dial
            label="Altitude"
            value={own.alt}
            min={1000}
            max={40000}
            step={500}
            onChange={(v) => engine.setOwn({ targetAltitudeFt: v })}
            format={(v) => `${v.toLocaleString('en-US')} ft`}
          />
          <Dial label="Speed" value={own.speed} min={120} max={480} step={10} onChange={(v) => engine.setOwn({ targetSpeedKt: v })} format={(v) => `${v} kt`} />
        </div>
        <p className="text-[11.5px] leading-4 text-muted-foreground">Climbs and descends at a normal rate.</p>
        <ControlSlider
          label="Heading"
          value={own.heading}
          min={0}
          max={359}
          onChange={(v) => engine.setOwn({ mode: { kind: 'heading' }, targetHeadingDeg: normalize360(v) })}
          format={(v) => `${String(v).padStart(3, '0')}°`}
          hint={own.mode !== 'heading' ? 'Following a route. Move this to take control.' : undefined}
        />
        <div className="flex flex-col gap-2">
          <HudButton
            className="justify-start"
            onClick={() => engine.setOwn({ mode: { kind: 'direct', to: { ...engine.station.pos }, thenHeading: bearingDeg(engine.own.pos, engine.station.pos) } })}
          >
            <Navigation aria-hidden /> Fly straight over the station
          </HudButton>
          <HudButton
            className="justify-start"
            onClick={() => engine.setOwn({ mode: { kind: 'orbit', center: { ...engine.station.pos }, radiusNm: Math.max(2, engine.ownGroundNm), clockwise: true } })}
          >
            <RotateCw aria-hidden /> Circle the station here
          </HudButton>
          <HudButton className="justify-start" onClick={() => engine.placeDefault()}>
            <Route aria-hidden /> Back to the starting route
          </HudButton>
        </div>
      </HudPanel>

      <HudPanel index="TX" title="The station" bodyClassName="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-1.5">
          <Segmented
            label={<Term id="dme-channel">Channel</Term>}
            value={env.mode}
            onChange={(v) => setEnv('mode', v)}
            options={[
              { value: 'X', label: `${formatDmeChannel(engine.station.channel, 'X')} · 50 µs` },
              { value: 'Y', label: `${formatDmeChannel(engine.station.channel, 'Y')} · 56 µs` },
            ]}
          />
          <p className="text-[11.5px] leading-4 text-muted-foreground">
            Paired with VOR {vhfPairedFrequencyMHz(engine.station.channel, env.mode)?.toFixed(2)} MHz. Asks on {f.interrogationMHz} MHz, answers on {f.replyMHz} MHz.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Dial
            label="Other aircraft"
            value={env.trafficCount}
            min={0}
            max={MAX_TRAFFIC}
            step={1}
            onChange={(v) => setEnv('trafficCount', v)}
            format={(v) => `${v}`}
            className="shrink-0"
          />
          <p className="text-[11.5px] leading-4 text-muted-foreground">
            Other aircraft asking this station. Designed for about {DME_TRANSPONDER.designAircraft}. It can accept about {capacityPps.toLocaleString('en-US')} questions per
            second.
          </p>
        </div>
        <LeverSwitch
          label={<Term id="dme-jitter">Random spacing (jitter)</Term>}
          tone="signal"
          checked={!env.noJitter}
          onChange={(v) => setEnv('noJitter', !v)}
          hint="Off: CNS101 and CNS202 ask in step"
        />
      </HudPanel>

      <HudPanel index="NAV" title="Map" bodyClassName="flex flex-col gap-3 p-4">
        <Segmented
          label="Map range"
          value={String(range)}
          onChange={(v) => setMapRange(Number(v))}
          options={[
            { value: '25', label: '25 NM' },
            { value: '50', label: '50 NM' },
            { value: '100', label: '100 NM' },
          ]}
        />
        <LeverSwitch
          label="Show where the station cannot hear CNS101"
          tone="signal"
          checked={showShadow}
          onChange={setShowShadow}
          hint="Shaded: hidden by hills or the curve of the Earth at this altitude"
        />
      </HudPanel>
    </div>
  )
}
