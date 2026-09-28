import { useRef, type ReactNode, type Ref } from 'react'
import {
  ClockControls,
  ClockSpeedLabel,
  ControlChoice,
  ControlGroup,
  ControlSlider,
  ControlSwitch,
  ControlsPanel,
  SimLabel,
} from '@/components/sim/Controls'
import { Term } from '@/components/Term'
import { realToSignalUs, slowMotionFor, type SlowMotion } from '@/core/clock'
import { useClock, useSimulationLoop } from '@/hooks/useSimClock'
import { useSampled } from '@/hooks/useSampled'
import { GEO_SATS, RAIN_HEIGHT_KM, ROUTES } from './engine'
import { fmtLat, fmtLon, STATE_TEXT } from './format'
import { Globe3D, type GlobeLabels } from './Globe3D'
import { LatencyMeter, REPLAY_REAL_S } from './LatencyMeter'
import { LinkPanel, RainPanel } from './LinkPanel'
import { SkyPlot } from './SkyPlot'
import { useSatcom, useSatcomState } from './state'
import { cn } from '@/lib/utils'

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
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-4">
        <GlobeFigure />
        <div className="grid gap-4 md:grid-cols-2">
          <figure className="flex min-w-0 flex-col gap-2">
            <figcaption className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold">What the aircraft’s antenna sees</span>
              <span className="text-xs text-muted-foreground">Nose at the top</span>
            </figcaption>
            <SkyPlot className="aspect-square w-full rounded-lg border" />
            <p className="text-xs text-muted-foreground">
              A <Term id="sky-plot">sky plot</Term>: the centre is straight up, the rim is the horizon. Satellites inside the dashed ring (the{' '}
              <Term id="elevation-mask">elevation mask</Term>) are usable. A cross means the satellite is hidden by the aircraft’s own body.
            </p>
          </figure>
          <div className="flex min-w-0 flex-col gap-4">
            <LinkPanel />
            <RainPanel />
          </div>
        </div>
        <LatencyMeter />
      </div>
      <SatcomControls />
    </div>
  )
}

function GlobeFigure() {
  const { engine, clock } = useSatcom()
  const constellation = useSatcomState((s) => s.constellation)
  const running = useClock(clock, (s) => s.running)
  const aircraft = useRef<HTMLDivElement>(null)
  const sat = useRef<HTMLDivElement>(null)
  const station = useRef<HTMLDivElement>(null)
  const pole = useRef<HTMLDivElement>(null)
  const labels: GlobeLabels = { aircraft, sat, station, pole }
  const info = useSampled(() => {
    const e = engine
    const s = e.link.sat ?? e.link.target
    return {
      state: e.link.state,
      sat: s != null ? (e.constellation === 'geo' ? GEO_SATS[s].id : e.leoSats[s].id) : null,
      station: e.constellation === 'geo' ? (s != null ? GEO_SATS[s].station.name : '') : 'Gateway',
      lat: e.routePoint.pos.lat,
      lon: e.routePoint.pos.lon,
      replay: e.replay != null && !e.replay.done,
      arrived: e.arrived,
    }
  }, 200)
  const label = `3D Earth with ${constellation === 'geo' ? 'four geostationary satellites above the equator' : 'a constellation of 66 low-orbit satellites'}. The aircraft is at ${fmtLat(info.lat)} ${fmtLon(info.lon)}. Link: ${STATE_TEXT[info.state]}${info.sat ? ` through ${info.sat}` : ''}. Drag to turn the globe; scroll or pinch to zoom.`
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">The Earth, the satellites and the flight</span>
        <span className="text-xs text-muted-foreground">Drag to turn the globe, scroll or pinch to zoom</span>
      </figcaption>
      <div className="relative">
        <Globe3D className="aspect-square w-full sm:aspect-[16/10]" labels={labels} label={label} />
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
          <Tag ref={aircraft} tone="primary" place="left">
            Aircraft
          </Tag>
          <Tag ref={sat} tone="primary">
            {info.sat ?? ''}
          </Tag>
          <Tag ref={station} place="right">
            {info.station}
          </Tag>
          <Tag ref={pole}>North Pole</Tag>
        </div>
        <div className="pointer-events-none absolute top-2 left-2 flex max-w-[calc(100%-1rem)] flex-wrap gap-1.5">
          {info.replay ? <SimLabel>Slowed down: the message is travelling</SimLabel> : <ClockSpeedLabel clock={clock} />}
          <SimLabel icon="none">Satellites and aircraft drawn larger than life</SimLabel>
        </div>
        <div className="pointer-events-none absolute bottom-2 left-2 flex flex-wrap gap-1.5">
          <SimLabel icon="none">Simplified coastlines</SimLabel>
          {info.arrived && !running && <SimLabel icon="none">Arrived. Move the flight slider or reset to fly again.</SimLabel>}
        </div>
      </div>
    </figure>
  )
}

function Tag({ ref, children, tone, place = 'right' }: { ref: Ref<HTMLDivElement>; children: ReactNode; tone?: 'primary'; place?: 'right' | 'left' | 'below' }) {
  return (
    <div ref={ref} className="absolute top-0 left-0" style={{ visibility: 'hidden' }}>
      <span
        className={cn(
          'absolute inline-block rounded border bg-background/90 px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap',
          place === 'right' && 'left-2.5 -translate-y-1/2',
          place === 'left' && 'right-2.5 -translate-y-1/2',
          place === 'below' && 'top-2.5 -translate-x-1/2',
          tone === 'primary' ? 'border-primary/50 text-foreground' : 'border-border text-muted-foreground',
        )}
      >
        {children}
      </span>
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

  return (
    <ControlsPanel className="h-fit xl:sticky xl:top-20">
      <ControlGroup title="Time">
        <ClockControls clock={clock} onReset={resetAll} />
        <p className="text-xs text-muted-foreground">
          {!running ? 'Paused. Press Play to fly.' : speed === 1 ? 'Real time.' : `Sped up: 1 second on screen is ${speed >= 60 ? `${speed / 60} minute${speed === 60 ? '' : 's'}` : `${speed} seconds`} of flight.`}
          {note && speed === 1 ? ` ${note}` : ''}
        </p>
      </ControlGroup>

      <ControlGroup title="Satellites">
        <ControlChoice
          label="Constellation"
          value={constellation}
          onChange={setConstellation}
          options={[
            { value: 'geo', label: 'GEO (high, fixed)' },
            { value: 'leo', label: 'LEO (low, moving)' },
          ]}
          hint={
            constellation === 'geo' ? (
              <>
                Four <Term id="geostationary-orbit">geostationary</Term> satellites, 35,786 km above the equator.
              </>
            ) : (
              <>
                66 <Term id="low-earth-orbit">low-orbit</Term> satellites, about 780 km up, in 6 near-polar rings.
              </>
            )
          }
        />
        <ControlSwitch label={<Term id="coverage-footprint">Coverage footprints</Term>} checked={showFootprints} onChange={setShowFootprints} />
      </ControlGroup>

      <ControlGroup title="The flight">
        <ControlChoice
          label="Route"
          value={routeId}
          onChange={setRoute}
          options={[
            { value: 'atlantic', label: 'Across the Atlantic' },
            { value: 'polar', label: 'Over the North Pole' },
          ]}
          hint={ROUTES[routeId].name}
        />
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
      </ControlGroup>

      <ControlGroup title="View">
        <ControlChoice
          label="Camera"
          value={view}
          onChange={setView}
          options={[
            { value: 'near', label: 'Close to Earth' },
            { value: 'orbit', label: 'Whole GEO orbit' },
          ]}
        />
        <ControlSwitch label="Follow the aircraft" checked={follow} onChange={setFollow} hint="Dragging the globe turns this off." />
      </ControlGroup>

      <ControlGroup title="Things that go wrong">
        <ControlSwitch label="Polar route" hint="Fly where GEO cannot reach" checked={routeId === 'polar'} onChange={(v) => setRoute(v ? 'polar' : 'atlantic')} />
        <ControlSwitch
          label="Steep turn (45° bank)"
          hint={turning === 'waiting' ? 'Waiting until the aircraft is airborne' : turning === 'level' ? 'The antenna on the roof tilts with the aircraft' : env.steepTurn ? 'Turning right' : 'Finishing the turn, then wings level'}
          checked={env.steepTurn}
          onChange={(v) => setEnv('steepTurn', v)}
        />
        <ControlSwitch
          label={<Term id="satellite-handover">Slow satellite handover</Term>}
          hint="Switching satellites takes much longer"
          checked={env.handoverTrouble}
          onChange={(v) => setEnv('handoverTrouble', v)}
        />
        <ControlSwitch label="Heavy rain" hint={`Rain below ${RAIN_HEIGHT_KM} km, all along the route`} checked={env.heavyRain} onChange={(v) => setEnv('heavyRain', v)} />
      </ControlGroup>
    </ControlsPanel>
  )
}
