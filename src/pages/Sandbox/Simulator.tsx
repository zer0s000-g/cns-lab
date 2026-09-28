import { Link } from 'react-router'
import { ArrowUpRight, Plane, RadioTower, RotateCcw, Swords } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ClockControls, ClockSpeedLabel, ControlChoice, ControlGroup, ControlSwitch, ControlsPanel, SimLabel } from '@/components/sim/Controls'
import { PILLAR_ICON } from '@/components/PillarBadge'
import { useSimulationLoop } from '@/hooks/useSimClock'
import { useSampled } from '@/hooks/useSampled'
import { MODULE_BY_ID, pillarName } from '@/modules/registry'
import { cn } from '@/lib/utils'
import { AirspaceMap } from './AirspaceMap'
import { ControllerDisplay } from './ControllerDisplay'
import { AlertsPanel, SCENARIO_TEXT, SourcesPanel } from './Panels'
import { Timeline } from './Timeline'
import type { ScenarioId } from './engine'
import { SYSTEMS, type SystemId } from './systems'
import { VIEWS, useSandbox, useSandboxState, type ViewId } from './state'

const SCENARIOS: { id: ScenarioId; label: string }[] = [
  { id: 'normal', label: 'All normal' },
  { id: 'radarOutage', label: 'Radar outage' },
  { id: 'gnssJam', label: 'GNSS jamming' },
  { id: 'vhfFail', label: 'VHF failure' },
  { id: 'mountain', label: 'Mountain terrain' },
]

export function SandboxSimulator() {
  const { engine, clock } = useSandbox()
  useSimulationLoop(clock, (dt) => engine.step(dt))
  const scenario = useSandboxState((s) => s.scenario)
  const setScenario = useSandboxState((s) => s.setScenario)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold">What goes wrong?</p>
          <ToggleGroup
            type="single"
            variant="outline"
            spacing={0}
            value={scenario}
            onValueChange={(v) => v && setScenario(v as ScenarioId)}
            aria-label="Choose a scenario"
            className="flex-wrap"
          >
            {SCENARIOS.map((s) => (
              <ToggleGroupItem key={s.id} value={s.id} className="px-3 text-xs">
                {s.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <ScenarioExplainer />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <figure className="flex min-w-0 flex-col gap-2">
              <figcaption className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold">The airspace and its systems</span>
                <span className="text-xs text-muted-foreground">Click a station to learn about it</span>
              </figcaption>
              <div className="relative">
                <AirspaceMap />
                <div className="pointer-events-none absolute top-2 left-2 flex flex-wrap gap-1.5">
                  <ClockSpeedLabel clock={clock} />
                  <CoverageLabel />
                </div>
              </div>
            </figure>
            <figure className="flex min-w-0 flex-col gap-2">
              <figcaption className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold">The controller’s screen</span>
                <span className="text-xs text-muted-foreground">Fused tracks. Click one to see its sources</span>
              </figcaption>
              <ControllerDisplay />
              <SymbolLegend />
            </figure>
          </div>
          <section className="flex flex-col gap-2" aria-labelledby="timeline-title">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 id="timeline-title" className="text-sm font-semibold">
                CNS700’s journey: which systems it can use
              </h3>
              <span className="text-xs text-muted-foreground">Bars show availability with the current failures. The red line is now.</span>
            </div>
            <Timeline />
          </section>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <section className="rounded-lg border bg-card p-4" aria-labelledby="sources-title">
              <h3 id="sources-title" className="mb-3 text-sm font-semibold">
                Sources of the selected track
              </h3>
              <SourcesPanel />
            </section>
            <section className="flex flex-col gap-3 rounded-lg border bg-card p-4" aria-labelledby="alerts-title">
              <h3 id="alerts-title" className="text-sm font-semibold">
                Safety nets
              </h3>
              <AlertsPanel />
              <EventLog />
            </section>
          </div>
        </div>
        <SandboxControls />
      </div>
    </div>
  )
}

function ScenarioExplainer() {
  const scenario = useSandboxState((s) => s.scenario)
  const vhfStandby = useSandboxState((s) => s.vhfStandby)
  const selectVhfStandby = useSandboxState((s) => s.selectVhfStandby)
  if (scenario === 'normal')
    return (
      <p className="text-sm text-muted-foreground">
        Everything works. Pick a failure above and watch what stops, what carries on, and what the controller and pilot do.
      </p>
    )
  const t = SCENARIO_TEXT[scenario]
  return (
    <div className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
      <div>
        <p className="text-xs font-semibold text-destructive uppercase">What fails</p>
        <p className="mt-1">{t.fails}</p>
      </div>
      <div>
        <p className="text-xs font-semibold text-success uppercase">What still works</p>
        <p className="mt-1">{t.works}</p>
      </div>
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase">The controller</p>
        <p className="mt-1">{t.controller}</p>
        {scenario === 'vhfFail' && (
          <Button size="sm" className="mt-2" onClick={selectVhfStandby} disabled={vhfStandby}>
            <RadioTower aria-hidden /> {vhfStandby ? 'Standby transmitters in use' : 'Switch to standby transmitters'}
          </Button>
        )}
      </div>
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase">The pilot</p>
        <p className="mt-1">{t.pilot}</p>
      </div>
    </div>
  )
}

function CoverageLabel() {
  const coverage = useSandboxState((s) => s.coverage)
  const alt = useSandboxState((s) => s.coverageAltFt)
  if (!coverage) return null
  const sys = SYSTEMS.find((s) => s.id === coverage)
  return (
    <SimLabel icon="none">
      Shaded: {sys?.short} coverage at {alt.toLocaleString('en-US')} ft
    </SimLabel>
  )
}

function SymbolLegend() {
  const items = [
    ['■ with dot', 'primary + secondary radar'],
    ['◆ filled', 'several sources fused'],
    ['◇', 'ADS-B / ADS-C only'],
    ['△', 'WAM only'],
    ['●', 'primary radar only'],
    ['◌ dashed', 'coasting: no fresh data'],
  ]
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Track symbols">
      {items.map(([s, d]) => (
        <li key={d}>
          <span className="font-mono text-foreground">{s}</span> {d}
        </li>
      ))}
    </ul>
  )
}

function EventLog() {
  const { engine } = useSandbox()
  const log = useSampled(() => engine.log.slice(0, 6).map((l) => `${formatTime(l.timeS)}  ${l.text}`), 500, (a, b) => a.join('|') === b.join('|'))
  if (!log.length) return null
  return (
    <div>
      <p className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Log</p>
      <ol className="flex flex-col gap-1 font-mono text-xs text-muted-foreground" aria-live="polite">
        {log.map((l, i) => (
          <li key={`${i}-${l}`} className={cn(i === 0 && 'text-foreground')}>
            {l}
          </li>
        ))}
      </ol>
    </div>
  )
}

function formatTime(s: number) {
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

function SandboxControls() {
  const { engine, clock, store } = useSandbox()
  const view = useSandboxState((s) => s.view)
  const follow = useSandboxState((s) => s.followJourney)
  const coverage = useSandboxState((s) => s.coverage)
  const coverageAlt = useSandboxState((s) => s.coverageAltFt)
  const systems = useSandboxState((s) => s.systems)
  const { setView, setFollow, setCoverage, setCoverageAlt, setSystem, resetAll, select } = store.getState()

  return (
    <ControlsPanel className="h-fit xl:sticky xl:top-20">
      <ControlGroup title="Time" description="The whole journey takes about two hours: speed it up.">
        <ClockControls clock={clock} onReset={resetAll} />
      </ControlGroup>

      <ControlGroup title="View">
        <ControlChoice
          label="Show"
          value={view}
          onChange={(v) => setView(v as ViewId)}
          options={(Object.keys(VIEWS) as ViewId[]).map((k) => ({ value: k, label: VIEWS[k].label }))}
        />
        <ControlSwitch label="Follow CNS700" checked={follow} onChange={setFollow} />
        <div className="flex flex-col gap-2">
          <Label htmlFor="sb-cov">Coverage overlay</Label>
          <Select value={coverage ?? 'none'} onValueChange={(v) => setCoverage(v === 'none' ? null : (v as SystemId))}>
            <SelectTrigger id="sb-cov" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {SYSTEMS.filter((s) => s.coverage).map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.short}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {coverage && (
          <ControlChoice
            label="At altitude"
            value={String(coverageAlt)}
            onChange={(v) => setCoverageAlt(Number(v))}
            options={[
              { value: '1500', label: '1,500 ft' },
              { value: '5000', label: '5,000 ft' },
              { value: '10000', label: '10,000 ft' },
              { value: '35000', label: 'FL350' },
            ]}
          />
        )}
      </ControlGroup>

      <ControlGroup title="Traffic">
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              engine.spawnConflict()
              select('CNS9A')
              setView('terminal')
            }}
          >
            <Swords aria-hidden /> Two aircraft on a collision course
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              engine.reset()
              select('CNS700')
            }}
          >
            <RotateCcw aria-hidden /> Restart the journey
          </Button>
        </div>
      </ControlGroup>

      <ControlGroup title="Systems" description="Switch systems off one by one and watch the controller’s screen.">
        {(['surveillance', 'navigation', 'communication'] as const).map((p) => {
          const Icon = PILLAR_ICON[p]
          return (
            <div key={p} className="flex flex-col gap-2">
              <p className="flex items-center gap-1.5 text-xs font-semibold">
                <Icon className="size-3.5" aria-hidden /> {pillarName(p)}
              </p>
              {SYSTEMS.filter((s) => s.pillar === p).map((s) => (
                <ControlSwitch
                  key={s.id}
                  label={
                    <span className="inline-flex items-center gap-1">
                      {s.short}
                      <Link to={MODULE_BY_ID.get(s.moduleId)!.path} className="text-muted-foreground hover:text-primary" aria-label={`Open the ${s.short} module`}>
                        <ArrowUpRight className="size-3.5" aria-hidden />
                      </Link>
                    </span>
                  }
                  hint={s.desc}
                  checked={systems[s.id]}
                  onChange={(v) => setSystem(s.id, v)}
                />
              ))}
            </div>
          )
        })}
      </ControlGroup>

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Plane className="size-4" aria-hidden /> Aircraft positions come from one shared simulation; each system only sees what its physics allows.
      </p>
    </ControlsPanel>
  )
}
