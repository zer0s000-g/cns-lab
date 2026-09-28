import { useRef } from 'react'
import { ClockControls, ClockSpeedLabel, ControlSlider, SimLabel } from '@/components/sim/Controls'
import { ChapterHead } from '@/components/module/ModuleLayout'
import { Term } from '@/components/Term'
import { realToSignalUs, slowMotionFor, type SlowMotion } from '@/core/clock'
import { useClock, useSimulationLoop } from '@/hooks/useSimClock'
import { useSampled } from '@/hooks/useSampled'
import { LeverSwitch, Segmented } from '@/hud/Controls'
import { HudPanel } from '@/hud/HudFrame'
import { RAIN_HEIGHT_KM, ROUTES, type Constellation, type RouteId } from './engine'
import { LatencyMeter, REPLAY_REAL_S } from './LatencyMeter'
import { LinkPanel, RainPanel } from './LinkPanel'
import { SkyPlot } from './SkyPlot'
import { useSatcom, useSatcomState, type GlobeView } from './state'

/**
 * The Simulator chapter: a console laid over the 3D stage. Left, what the
 * aircraft's antenna sees and the link status; right, the control deck;
 * below, rain fade and the latency meter. The stage behind shows the Earth,
 * the satellites and the flight.
 */
export function SatcomSimulator() {
  const { engine, clock } = useSatcom()
  const slowRef = useRef<SlowMotion>(slowMotionFor(1, 1))
  const arrivedRef = useRef(false)

  useSimulationLoop(clock, (dt, realDt) => {
    const r = engine.replay
    if (r && !r.done) {
      const c = clock.getState()
      if (!r.frozen) {
        // A message is about to travel: freeze the world while it plays in slow motion.
        r.frozen = true
        r.resume = c.running
        c.pause()
        slowRef.current = slowMotionFor(r.path.propagationS * 1e6, REPLAY_REAL_S)
        return
      }
      if (c.running) {
        // The learner pressed Play: skip to the end and go back to live.
        engine.advanceReplay(Infinity)
        return
      }
      const finished = engine.advanceReplay(realToSignalUs(realDt, slowRef.current) / 1e6)
      if (finished && r.resume) c.play()
      return
    }
    engine.step(dt)
    if (engine.arrived && !arrivedRef.current) {
      arrivedRef.current = true
      clock.getState().pause()
    } else if (!engine.arrived) arrivedRef.current = false
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="hud-panel rounded-md px-5 py-4 md:w-fit md:max-w-[520px]">
        <ChapterHead
          n={2}
          title="Simulator"
          lead="The globe behind is the flight, the satellites and the link. The panels show what the aircraft's antenna sees and how long a message takes."
        />
      </div>
      <div className="grid gap-4 md:grid-cols-[minmax(0,420px)_1fr_minmax(0,340px)]">
        <div className="flex min-w-0 flex-col gap-4">
          <HudPanel index="ANT" title="What the aircraft’s antenna sees" bodyClassName="flex flex-col gap-2.5 p-3">
            <div className="relative">
              <SkyPlot className="aspect-square w-full rounded-[3px] border border-hud-line" />
              <div className="pointer-events-none absolute top-2 left-2">
                <SimLabel icon="none">Nose at the top</SimLabel>
              </div>
            </div>
            <p className="text-[11.5px] leading-5 text-muted-foreground">
              A <Term id="sky-plot">sky plot</Term>: the centre is straight up, the rim is the horizon. Satellites inside the dashed ring (the{' '}
              <Term id="elevation-mask">elevation mask</Term>) are usable. A cross means the satellite is hidden by the aircraft’s own body.
            </p>
          </HudPanel>
          <div className="hud-panel rounded-md p-4">
            <LinkPanel />
          </div>
        </div>
        <div aria-hidden className="hidden md:block" />
        <SatcomControls />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="hud-panel h-fit rounded-md p-4">
          <RainPanel />
        </div>
        <div className="hud-panel rounded-md p-4">
          <LatencyMeter />
        </div>
      </div>
    </div>
  )
}

function SatcomControls() {
  const { engine, clock } = useSatcom()
  const constellation = useSatcomState((s) => s.constellation)
  const routeId = useSatcomState((s) => s.routeId)
  const env = useSatcomState((s) => s.env)
  const view = useSatcomState((s) => s.view)
  const follow = useSatcomState((s) => s.follow)
  const showFootprints = useSatcomState((s) => s.showFootprints)
  const note = useSatcomState((s) => s.note)
  const { setConstellation, setRoute, setEnv, setView, setFollow, setShowFootprints, setDistance, resetAll } = useSatcomState((s) => s)
  const running = useClock(clock, (s) => s.running)
  const speed = useClock(clock, (s) => s.speed)
  const dist = useSampled(() => Math.round(engine.distanceNm / 10) * 10, 250)
  const total = Math.round(engine.routeLengthNm)
  const turning = useSampled(() => (engine.env.steepTurn && !engine.canTurn && engine.turnPhase === 'level' ? 'waiting' : engine.turnPhase), 250)
  const st = useSampled(() => ({ replay: engine.replay != null && !engine.replay.done, arrived: engine.arrived }), 200, (a, b) => a.replay === b.replay && a.arrived === b.arrived)

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <HudPanel index="CLK" title="Time" bodyClassName="flex flex-col gap-2 p-3">
        <ClockControls clock={clock} onReset={resetAll} />
        <div className="flex flex-wrap gap-1.5">
          {st.replay ? <SimLabel>Slowed down: the message is travelling</SimLabel> : <ClockSpeedLabel clock={clock} />}
        </div>
        <p className="text-xs text-muted-foreground">
          {!running ? 'Paused. Press Play to fly.' : speed === 1 ? 'Real time.' : `Sped up: 1 second on screen is ${speed >= 60 ? `${speed / 60} minute${speed === 60 ? '' : 's'}` : `${speed} seconds`} of flight.`}
          {note && speed === 1 ? ` ${note}` : ''}
        </p>
        {st.arrived && !running && <p className="text-xs text-muted-foreground">Arrived. Move the flight slider or reset to fly again.</p>}
      </HudPanel>

      <HudPanel index="SAT" title="Satellites" bodyClassName="flex flex-col gap-2 p-4">
        <Segmented<Constellation>
          label="Constellation"
          value={constellation}
          onChange={setConstellation}
          options={[
            { value: 'geo', label: 'GEO (high, fixed)' },
            { value: 'leo', label: 'LEO (low, moving)' },
          ]}
        />
        <p className="text-xs text-muted-foreground">
          {constellation === 'geo' ? (
            <>
              Four <Term id="geostationary-orbit">geostationary</Term> satellites, 35,786 km above the equator.
            </>
          ) : (
            <>
              66 <Term id="low-earth-orbit">low-orbit</Term> satellites, about 780 km up, in 6 near-polar rings.
            </>
          )}
        </p>
        <LeverSwitch label={<Term id="coverage-footprint">Coverage footprints</Term>} tone="signal" checked={showFootprints} onChange={setShowFootprints} />
      </HudPanel>

      <HudPanel index="FLT" title="The flight" bodyClassName="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-1.5">
          <Segmented<RouteId>
            label="Route"
            value={routeId}
            onChange={setRoute}
            options={[
              { value: 'atlantic', label: 'Across the Atlantic' },
              { value: 'polar', label: 'Over the North Pole' },
            ]}
          />
          <p className="text-xs text-muted-foreground">{ROUTES[routeId].name}</p>
        </div>
        <ControlSlider
          label="Flight progress"
          value={Math.min(dist, total)}
          min={0}
          max={total}
          step={10}
          onChange={setDistance}
          format={(v) => `${Math.round(v).toLocaleString('en-US')} of ${total.toLocaleString('en-US')} NM`}
          hint="Moves the aircraft along its route."
        />
      </HudPanel>

      <HudPanel index="CAM" title="View" bodyClassName="flex flex-col gap-2 p-4">
        <Segmented<GlobeView>
          label="Camera"
          value={view}
          onChange={setView}
          options={[
            { value: 'near', label: 'Close to Earth' },
            { value: 'orbit', label: 'Whole GEO orbit' },
          ]}
        />
        <LeverSwitch label="Follow the aircraft" tone="signal" checked={follow} onChange={setFollow} hint="Turns the globe so the aircraft stays in front of you." />
      </HudPanel>

      <HudPanel index="ERR" title="Things that go wrong" bodyClassName="px-4 py-2">
        <LeverSwitch label="Polar route" hint="Fly where GEO cannot reach" checked={routeId === 'polar'} onChange={(v) => setRoute(v ? 'polar' : 'atlantic')} />
        <LeverSwitch
          label="Steep turn (45° bank)"
          hint={
            turning === 'waiting'
              ? 'Waiting until the aircraft is airborne'
              : turning === 'level'
                ? 'The antenna on the roof tilts with the aircraft'
                : env.steepTurn
                  ? 'Turning right'
                  : 'Finishing the turn, then wings level'
          }
          checked={env.steepTurn}
          onChange={(v) => setEnv('steepTurn', v)}
        />
        <LeverSwitch
          label={<Term id="satellite-handover">Slow satellite handover</Term>}
          hint="Switching satellites takes much longer"
          checked={env.handoverTrouble}
          onChange={(v) => setEnv('handoverTrouble', v)}
        />
        <LeverSwitch label="Heavy rain" hint={`Rain below ${RAIN_HEIGHT_KM} km, all along the route`} checked={env.heavyRain} onChange={(v) => setEnv('heavyRain', v)} />
      </HudPanel>
    </div>
  )
}
