import { Link } from 'react-router'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
import { SPEED_OF_LIGHT_MS } from '@/core/units'
import { useClock, useSimulationLoop } from '@/hooks/useSimClock'
import { CLOCK_GUESS_RANGE_NS, SITES, type ClockMode, type PresetKind, type ReceiverSite, type SelectMode } from './engine'
import { GroundView } from './GroundView'
import { OrbitView } from './OrbitView'
import { LiveReadouts, OtherAids, PositionCheck, SignalBars, SignalSpectrum } from './Panels'
import { SatelliteChips, SkyLegend, SkyPlot } from './SkyPlot'
import { useGnss, useGnssState } from './state'

export function GnssSimulator() {
  const { engine, clock } = useGnss()
  useSimulationLoop(clock, (dt) => engine.step(dt))

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-4">
        {/* Two independent columns on wider screens (no row gaps); one column in a sensible order on phones. */}
        <div className="flex flex-col gap-4 md:grid md:grid-cols-2 md:items-start">
          <div className="contents md:flex md:min-w-0 md:flex-col md:gap-4">
            <figure className="order-1 flex min-w-0 flex-col gap-2 md:order-none">
              <figcaption className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold">Orbit view</span>
                <span className="text-xs text-muted-foreground">Drag to turn, scroll or pinch to zoom</span>
              </figcaption>
              <div className="relative">
                <OrbitView className="aspect-square w-full" />
                <div className="pointer-events-none absolute top-2 left-2 z-10 flex flex-wrap gap-1.5">
                  <ClockSpeedLabel clock={clock} />
                  <SimLabel icon="none">Satellites drawn larger than life</SimLabel>
                </div>
              </div>
              <OrbitLegend />
              <p className="text-xs text-muted-foreground">
                Each ring is one of the six orbits, 20,200 km up. A satellite goes round in 11 h 58 min while the Earth turns underneath. The
                flat disc at the receiver is its horizon: only satellites above it can be received.
              </p>
            </figure>
            <figure className="order-3 flex min-w-0 flex-col gap-2 md:order-none">
              <figcaption className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold">Ground view</span>
                <span className="text-xs text-muted-foreground">Where the receiver thinks it is, in metres</span>
              </figcaption>
              <div className="relative">
                <GroundView />
                <div className="pointer-events-none absolute top-2 left-2 flex flex-wrap gap-1.5">
                  <SimLabel icon="none">Receiver held still for the lesson</SimLabel>
                </div>
              </div>
              <GroundLegend />
              <p className="text-xs text-muted-foreground">
                Each thin line is a slice of one satellite's distance sphere, cut at the height of the answer; the sphere is about 40,000 km
                across, so close up it looks straight. Dots are the last few minutes of answers. The height strip has its own scale.
              </p>
            </figure>
            <div className="order-6 md:order-none">
              <OtherAids />
            </div>
          </div>
          <div className="contents md:flex md:min-w-0 md:flex-col md:gap-4">
            <figure className="order-2 flex min-w-0 flex-col gap-2 md:order-none">
              <figcaption className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold">
                  <Term id="sky-plot">Sky plot</Term>
                </span>
                <span className="text-xs text-muted-foreground">Click a satellite to use it or not</span>
              </figcaption>
              <div className="relative">
                <SkyPlot />
                <div className="pointer-events-none absolute top-2 left-2">
                  <SimLabel icon="none">Looking up: overhead in the middle, horizon at the edge</SimLabel>
                </div>
              </div>
              <SkyLegend />
              <SatelliteChips />
            </figure>
            <div className="order-4 md:order-none">
              <PositionCheck />
            </div>
            <div className="order-5 flex flex-col gap-5 rounded-lg border bg-card p-4 md:order-none">
              <SignalBars />
              <SignalSpectrum />
            </div>
          </div>
        </div>
        <LiveReadouts />
      </div>
      <GnssControls />
    </div>
  )
}

function OrbitLegend() {
  const items = [
    { cls: 'bg-sim-signal size-2.5', label: 'Used' },
    { cls: 'bg-sim-ink size-2', label: 'Received, not used' },
    { cls: 'bg-sim-muted size-2 opacity-60', label: 'Below the horizon or not received' },
    { cls: 'bg-sim-alert size-2.5', label: 'Faulty' },
  ]
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span className={`inline-block rounded-full ${i.cls}`} aria-hidden />
          {i.label}
        </li>
      ))}
    </ul>
  )
}

function GroundLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <li className="flex items-center gap-1.5">
        <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
          <path d="M6 1.5 L11 10 L1 10 Z" className="fill-sim-bg stroke-sim-signal" strokeWidth="1.5" />
        </svg>
        True position
      </li>
      <li className="flex items-center gap-1.5">
        <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
          <path d="M1 6 H11 M6 1 V11" className="stroke-primary" strokeWidth="1.8" />
        </svg>
        GNSS answer
      </li>
      <li className="flex items-center gap-1.5">
        <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
          <circle cx="6" cy="6" r="5" className="fill-primary/10 stroke-primary" strokeWidth="1.2" strokeDasharray="2.5 1.5" />
        </svg>
        95% circle
      </li>
      <li className="flex items-center gap-1.5">
        <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
          <path d="M1 10 L11 2" className="stroke-sim-signal-2" strokeWidth="1.5" />
        </svg>
        Distance line
      </li>
    </ul>
  )
}

const PRESETS: { kind: PresetKind; label: string; aria: string }[] = [
  { kind: 'spread3', label: '3 spread out', aria: 'Use 3 satellites spread across the sky' },
  { kind: 'clustered4', label: '4 bunched', aria: 'Use 4 satellites bunched together' },
  { kind: 'spread4', label: '4 spread out', aria: 'Use 4 satellites spread across the sky' },
  { kind: 'five', label: '5', aria: 'Use 5 satellites' },
  { kind: 'six', label: '6', aria: 'Use 6 satellites (adds one to a group of 5)' },
]

function formatGuess(ns: number) {
  const m = ns * 1e-9 * SPEED_OF_LIGHT_MS
  return `${ns >= 0 ? '+' : '−'}${Math.abs(ns)} ns (${Math.abs(m).toFixed(0)} m)`
}

function GnssControls() {
  const { engine, clock } = useGnss()
  const settings = useGnssState((s) => s.settings)
  const env = useGnssState((s) => s.env)
  const view = useGnssState((s) => s.view)
  const setSetting = useGnssState((s) => s.setSetting)
  const setEnv = useGnssState((s) => s.setEnv)
  const setView = useGnssState((s) => s.setView)
  const applyPreset = useGnssState((s) => s.applyPreset)
  const resetAll = useGnssState((s) => s.resetAll)
  const running = useClock(clock, (s) => s.running)
  const speed = useClock(clock, (s) => s.speed)

  const setMode = (m: SelectMode) => {
    if (m === 'manual' && settings.selectMode === 'all') {
      setSetting('selected', engine.sats.filter((s) => s.selected).map((s) => s.id))
    }
    setSetting('selectMode', m)
  }

  return (
    <ControlsPanel className="h-fit xl:sticky xl:top-20">
      <ControlGroup title="Time">
        <ClockControls
          clock={clock}
          onReset={() => {
            resetAll()
            clock.getState().reset()
          }}
        />
        <p className="text-xs text-muted-foreground">
          {!running
            ? 'Paused. Press Play to let the satellites move.'
            : speed > 1
              ? `Sped up ${speed}× so you can see the satellites move: in real time one takes about 6 hours to cross the sky.`
              : 'Real time: the satellites creep across the sky, a few degrees every ten minutes. Speed up to watch them move.'}
        </p>
      </ControlGroup>

      <ControlGroup title="Receiver">
        <ControlChoice<ReceiverSite>
          label="Where is the receiver?"
          value={settings.site}
          onChange={(v) => setSetting('site', v)}
          options={(Object.keys(SITES) as ReceiverSite[]).map((k) => ({ value: k, label: SITES[k].short, ariaLabel: SITES[k].label }))}
        />
      </ControlGroup>

      <ControlGroup title="Satellites">
        <ControlChoice<SelectMode>
          label="Which satellites does it use?"
          value={settings.selectMode}
          onChange={setMode}
          options={[
            { value: 'all', label: 'All it can receive' },
            { value: 'manual', label: 'I choose' },
          ]}
        />
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Quick picks</span>
          <div className="grid grid-cols-3 gap-1.5">
            {PRESETS.map((p) => (
              <Button key={p.kind} size="sm" variant="outline" onClick={() => applyPreset(p.kind)} aria-label={p.aria} className="px-1.5 text-xs">
                {p.label}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Or click satellites on the sky plot, or use the list under it.</p>
        </div>
      </ControlGroup>

      <ControlGroup title="Receiver clock">
        <ControlChoice<ClockMode>
          label={
            <>
              The <Term id="receiver-clock-error">clock error</Term>
            </>
          }
          value={settings.clockMode}
          onChange={(v) => setSetting('clockMode', v)}
          options={[
            { value: 'solve', label: 'Receiver works it out' },
            { value: 'guess', label: 'I guess it' },
          ]}
          hint={settings.clockMode === 'solve' ? 'Needs 4 satellites: 3 for the position, 1 for the clock.' : undefined}
        />
        {settings.clockMode === 'guess' && (
          <ControlSlider
            label="My guess is off by"
            value={settings.clockGuessNs}
            min={-CLOCK_GUESS_RANGE_NS}
            max={CLOCK_GUESS_RANGE_NS}
            step={10}
            onChange={(v) => setSetting('clockGuessNs', v)}
            format={formatGuess}
            hint="0 is exactly right. Light travels about 30 cm in one nanosecond."
          />
        )}
      </ControlGroup>

      <ControlGroup title="Corrections">
        <ControlSwitch
          label={
            <span>
              <Term id="sbas">SBAS</Term> (from a satellite)
            </span>
          }
          checked={settings.sbas}
          onChange={(v) => setSetting('sbas', v)}
          hint="A geostationary satellite sends corrections for a whole region"
        />
        <ControlSwitch
          label={
            <span>
              <Term id="gbas">GBAS</Term> (from the airport)
            </span>
          }
          checked={settings.gbas}
          onChange={(v) => setSetting('gbas', v)}
          hint="A ground station at the airport sends corrections for landing"
        />
      </ControlGroup>

      <ControlGroup title="Show">
        <ControlSwitch label="Distance spheres in the orbit view" checked={view.showSpheres} onChange={(v) => setView('showSpheres', v)} hint="Up to 6 satellites" />
        <ControlSwitch label="Distance lines in the ground view" checked={view.showLines} onChange={(v) => setView('showLines', v)} />
        <ControlSwitch label="Orbit view turns with the Earth" checked={view.followEarth} onChange={(v) => setView('followEarth', v)} hint="Keeps the receiver in front of you" />
      </ControlGroup>

      <ControlGroup title="When things go wrong">
        <ControlSwitch label="A satellite develops a fault" checked={env.faultySat} onChange={(v) => setEnv('faultySat', v)} hint="Its clock drifts, adding a growing error" />
        <ControlSwitch
          label={
            <span>
              <Term id="raim">RAIM</Term> integrity check
            </span>
          }
          checked={env.raim}
          onChange={(v) => setEnv('raim', v)}
          hint="The receiver checks the satellites against each other"
        />
        <ControlSwitch
          label={
            <span>
              <Term id="ionosphere">Ionospheric</Term> storm
            </span>
          }
          checked={env.ionoStorm}
          onChange={(v) => setEnv('ionoStorm', v)}
          hint="The upper atmosphere delays the signals much more"
        />
        <ControlSwitch label="Buildings block part of the sky" checked={env.blocked} onChange={(v) => setEnv('blocked', v)} hint="Only on the ground: a hangar and nearby buildings" />
        <ControlSwitch
          label={
            <>
              <Term id="jamming">Jamming</Term>
            </>
          }
          checked={env.jamming}
          onChange={(v) => setEnv('jamming', v)}
          hint="A 10 W jammer south of the airport"
        />
        {env.jamming && (
          <ControlSlider
            label="Jammer distance"
            value={Math.log10(settings.jammerKm)}
            min={0}
            max={Math.log10(300)}
            step={0.01}
            onChange={(v) => setSetting('jammerKm', Math.round(10 ** v))}
            format={(v) => `${Math.round(10 ** v)} km`}
            hint="On the ground the hills and the curve of the Earth soon hide it; in the air it reaches much further."
          />
        )}
        <ControlSwitch
          label={
            <>
              <Term id="spoofing">Spoofing</Term>
            </>
          }
          checked={env.spoofing}
          onChange={(v) => setEnv('spoofing', v)}
          hint="Fake satellite signals pull the answer away"
        />
      </ControlGroup>

      <p className="text-xs text-muted-foreground">
        GNSS is the backbone of modern navigation, but ground aids stay as a backup.{' '}
        <Link to="/modules/dme" className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline">
          See how DME measures distance <ArrowRight className="size-3" aria-hidden />
        </Link>
      </p>
    </ControlsPanel>
  )
}
