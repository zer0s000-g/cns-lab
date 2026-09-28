import { Link } from 'react-router'
import { ArrowRight, LocateFixed } from 'lucide-react'
import { ClockControls, ClockSpeedLabel, ControlSlider, SimLabel } from '@/components/sim/Controls'
import { ChapterHead } from '@/components/module/ModuleLayout'
import { Term } from '@/components/Term'
import { SPEED_OF_LIGHT_MS } from '@/core/units'
import { useClock, useSimulationLoop } from '@/hooks/useSimClock'
import { Dial, HudButton, LeverSwitch, Segmented } from '@/hud/Controls'
import { HudPanel } from '@/hud/HudFrame'
import { CLOCK_GUESS_RANGE_NS, SITES, type ClockMode, type PresetKind, type ReceiverSite, type SelectMode } from './engine'
import { GroundView } from './GroundView'
import { LiveReadouts, OtherAids, PositionCheck, SignalBars, SignalSpectrum } from './Panels'
import { SatelliteChips, SkyLegend, SkyPlot } from './SkyPlot'
import { useGnss, useGnssState } from './state'

/**
 * The Simulator chapter: a console laid over the 3D stage. Left, what the
 * receiver sees (sky plot) and works out (ground view); right, the control
 * deck; below, integrity, signals and readouts. The stage behind shows the
 * satellites where they really are.
 */
export function GnssSimulator() {
  const { engine, clock } = useGnss()
  useSimulationLoop(clock, (dt) => engine.step(dt))

  return (
    <div className="flex flex-col gap-4">
      <div className="hud-panel rounded-md px-5 py-4 md:w-fit md:max-w-[520px]">
        <ChapterHead
          n={2}
          title="Simulator"
          lead="The stage behind is where the satellites really are. The sky plot and the ground view show what the receiver hears and works out."
        />
      </div>
      <div className="grid gap-4 md:grid-cols-[minmax(0,420px)_1fr_minmax(0,340px)]">
        <div className="flex min-w-0 flex-col gap-4">
          <HudPanel index="SKY" title="Sky plot" bodyClassName="flex flex-col gap-2.5 p-3">
            <div className="relative">
              <SkyPlot />
              <div className="pointer-events-none absolute top-2 left-2">
                <SimLabel icon="none">Looking up: overhead in the middle, horizon at the edge</SimLabel>
              </div>
            </div>
            <p className="text-[11.5px] leading-5 text-muted-foreground">A <Term id="sky-plot">sky plot</Term>. Click a satellite to use it or not. The same sky is the dome over the receiver on the stage.</p>
            <SkyLegend />
            <SatelliteChips />
          </HudPanel>
          <HudPanel index="FIX" title="Ground view" bodyClassName="flex flex-col gap-2.5 p-3">
            <div className="relative">
              <GroundView />
              <div className="pointer-events-none absolute top-2 left-2 flex flex-wrap gap-1.5">
                <SimLabel icon="none">Receiver held still for the lesson</SimLabel>
              </div>
            </div>
            <GroundLegend />
            <p className="text-[11.5px] leading-5 text-muted-foreground">
              Where the receiver thinks it is, in metres. Each thin line is a slice of one satellite's distance sphere, cut at the height of the
              answer; the sphere is about 40,000 km across, so close up it looks straight. Dots are the last few minutes of answers. The height
              strip has its own scale.
            </p>
          </HudPanel>
        </div>
        <div aria-hidden className="hidden md:block" />
        <GnssControls />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <HudPanel index="INT" title="Position check">
          <PositionCheck />
        </HudPanel>
        <HudPanel index="SIG" title="Signals" bodyClassName="flex flex-col gap-5 p-4">
          <SignalBars />
          <SignalSpectrum />
        </HudPanel>
        <HudPanel index="AID" title="Backup aids" className="md:col-span-2 xl:col-span-1">
          <OtherAids />
        </HudPanel>
      </div>
      <HudPanel index="TLM" title="Receiver telemetry">
        <LiveReadouts />
      </HudPanel>
    </div>
  )
}

function StageLegend() {
  const items = [
    { cls: 'bg-signal size-2.5', label: 'Used' },
    { cls: 'bg-foreground/80 size-2', label: 'Received, not used' },
    { cls: 'bg-muted-foreground/60 size-2', label: 'Below the horizon or not received' },
    { cls: 'bg-destructive size-2.5', label: 'Faulty' },
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
    <div className="flex min-w-0 flex-col gap-4">
      <HudPanel index="CLK" title="Time" bodyClassName="flex flex-col gap-2 p-3">
        <ClockControls
          clock={clock}
          onReset={() => {
            resetAll()
            clock.getState().reset()
          }}
        />
        <div className="flex flex-wrap gap-1.5">
          <ClockSpeedLabel clock={clock} />
        </div>
        <p className="text-xs text-muted-foreground">
          {!running
            ? 'Paused. Press Play to let the satellites move.'
            : speed > 1
              ? `Sped up ${speed}× so you can see the satellites move: in real time one takes about 6 hours to cross the sky.`
              : 'Real time: the satellites creep across the sky, a few degrees every ten minutes. Speed up to watch them move.'}
        </p>
      </HudPanel>

      <HudPanel index="RX" title="Receiver and satellites" bodyClassName="flex flex-col gap-4 p-4">
        <Segmented<ReceiverSite>
          label="Where is the receiver?"
          value={settings.site}
          onChange={(v) => setSetting('site', v)}
          options={(Object.keys(SITES) as ReceiverSite[]).map((k) => ({ value: k, label: SITES[k].short, ariaLabel: SITES[k].label }))}
        />
        <Segmented<SelectMode>
          label="Which satellites does it use?"
          value={settings.selectMode}
          onChange={setMode}
          options={[
            { value: 'all', label: 'All it can receive' },
            { value: 'manual', label: 'I choose' },
          ]}
        />
        <div className="flex flex-col gap-2">
          <span className="hud-label">Quick picks</span>
          <div className="grid grid-cols-3 gap-1.5">
            {PRESETS.map((p) => (
              <HudButton key={p.kind} onClick={() => applyPreset(p.kind)} aria-label={p.aria} className="px-1.5">
                {p.label}
              </HudButton>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Or click satellites on the sky plot, or use the list under it.</p>
        </div>
      </HudPanel>

      <HudPanel index="RCK" title="Receiver clock" bodyClassName="flex flex-col gap-3 p-4">
        <Segmented<ClockMode>
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
        />
        {settings.clockMode === 'solve' && <p className="text-xs text-muted-foreground">Needs 4 satellites: 3 for the position, 1 for the clock.</p>}
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
      </HudPanel>

      <HudPanel index="AUG" title="Corrections" bodyClassName="px-4 py-2">
        <LeverSwitch
          label={
            <span>
              <Term id="sbas">SBAS</Term> (from a satellite)
            </span>
          }
          tone="signal"
          checked={settings.sbas}
          onChange={(v) => setSetting('sbas', v)}
          hint="A geostationary satellite sends corrections for a whole region"
        />
        <LeverSwitch
          label={
            <span>
              <Term id="gbas">GBAS</Term> (from the airport)
            </span>
          }
          tone="signal"
          checked={settings.gbas}
          onChange={(v) => setSetting('gbas', v)}
          hint="A ground station at the airport sends corrections for landing"
        />
      </HudPanel>

      <HudPanel index="STG" title="On the stage" bodyClassName="flex flex-col gap-3 p-4">
        <StageLegend />
        <p className="text-xs text-muted-foreground">
          Each ring is one of the six orbits, 20,200 km up. A satellite goes round in 11 h 58 min while the Earth turns underneath. The dome over
          the receiver is its sky: only satellites above its rim, the horizon, can be received.
        </p>
        <div>
          <LeverSwitch
            label="Distance spheres on the stage"
            tone="signal"
            checked={view.showSpheres}
            onChange={(v) => setView('showSpheres', v)}
            hint="Up to 6 satellites"
          />
          <LeverSwitch label="Distance lines in the ground view" tone="signal" checked={view.showLines} onChange={(v) => setView('showLines', v)} />
          <LeverSwitch
            label="Stage turns with the Earth"
            tone="signal"
            checked={view.followEarth}
            onChange={(v) => setView('followEarth', v)}
            hint="Keeps the receiver on top, in front of you"
          />
        </div>
        <HudButton onClick={() => setView('recenter', view.recenter + 1)} className="self-start">
          <LocateFixed aria-hidden /> Look at the receiver
        </HudButton>
      </HudPanel>

      <HudPanel index="ERR" title="When things go wrong" bodyClassName="px-4 py-2">
        <LeverSwitch label="A satellite develops a fault" checked={env.faultySat} onChange={(v) => setEnv('faultySat', v)} hint="Its clock drifts, adding a growing error" />
        <LeverSwitch
          label={
            <span>
              <Term id="raim">RAIM</Term> integrity check
            </span>
          }
          tone="signal"
          checked={env.raim}
          onChange={(v) => setEnv('raim', v)}
          hint="The receiver checks the satellites against each other"
        />
        <LeverSwitch
          label={
            <span>
              <Term id="ionosphere">Ionospheric</Term> storm
            </span>
          }
          checked={env.ionoStorm}
          onChange={(v) => setEnv('ionoStorm', v)}
          hint="The upper atmosphere delays the signals much more"
        />
        <LeverSwitch label="Buildings block part of the sky" checked={env.blocked} onChange={(v) => setEnv('blocked', v)} hint="Only on the ground: a hangar and nearby buildings" />
        <LeverSwitch
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
          <div className="flex flex-col items-center gap-1 py-3">
            <Dial
              label="Jammer distance"
              value={Math.log10(settings.jammerKm)}
              min={0}
              max={Math.log10(300)}
              step={0.01}
              onChange={(v) => setSetting('jammerKm', Math.round(10 ** v))}
              format={(v) => `${Math.round(10 ** v)} km`}
            />
            <p className="text-center text-[11.5px] leading-4 text-muted-foreground">
              On the ground the hills and the curve of the Earth soon hide it; in the air it reaches much further.
            </p>
          </div>
        )}
        <LeverSwitch
          label={
            <>
              <Term id="spoofing">Spoofing</Term>
            </>
          }
          checked={env.spoofing}
          onChange={(v) => setEnv('spoofing', v)}
          hint="Fake satellite signals pull the answer away"
        />
        <p className="py-2 text-xs text-muted-foreground">
          GNSS is the backbone of modern navigation, but ground aids stay as a backup.{' '}
          <Link to="/modules/dme" className="inline-flex items-center gap-0.5 font-medium text-signal hover:underline">
            See how DME measures distance <ArrowRight className="size-3" aria-hidden />
          </Link>
        </p>
      </HudPanel>
    </div>
  )
}
