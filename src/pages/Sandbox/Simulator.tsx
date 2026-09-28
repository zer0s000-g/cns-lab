import { Link } from 'react-router'
import { ArrowUpRight, Plane, RadioTower, RotateCcw, Swords } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ClockControls, ClockSpeedLabel, SimLabel } from '@/components/sim/Controls'
import { ChapterHead } from '@/components/module/ModuleLayout'
import { LeverSwitch, Segmented } from '@/hud/Controls'
import { HudPanel } from '@/hud/HudFrame'
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
      <div className="hud-panel flex flex-col gap-4 rounded-md px-5 py-4">
        <ChapterHead n={2} title="Simulator" lead="One shared world: every system sees only what its physics allows. Break things and watch the controller’s picture." />
        <Segmented
          label="What goes wrong?"
          value={scenario}
          onChange={(v) => setScenario(v)}
          options={SCENARIOS.map((x) => ({ value: x.id, label: x.label }))}
        />
        <ScenarioExplainer />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <HudPanel index="MAP" title="The airspace and its systems" actions={<span className="hud-label hidden text-[9.5px] lg:inline">Click a station</span>} bodyClassName="p-3">
              <div className="relative">
                <AirspaceMap />
                <div className="pointer-events-none absolute top-2 left-2 flex flex-wrap gap-1.5">
                  <ClockSpeedLabel clock={clock} />
                  <CoverageLabel />
                </div>
              </div>
            </HudPanel>
            <HudPanel index="ATC" title="The controller’s screen" actions={<span className="hud-label hidden text-[9.5px] lg:inline">Click a track</span>} bodyClassName="flex flex-col gap-2.5 p-3">
              <ControllerDisplay />
              <SymbolLegend />
            </HudPanel>
          </div>
          <HudPanel index="JNY" title="CNS700’s journey: which systems it can use" bodyClassName="flex flex-col gap-2 p-3">
            <p className="text-[12px] text-muted-foreground">Bars show availability with the current failures. The red line is now.</p>
            <Timeline />
          </HudPanel>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <HudPanel index="SRC" title="Sources of the selected track" bodyClassName="p-4">
              <SourcesPanel />
            </HudPanel>
            <HudPanel index="NET" title="Safety nets" bodyClassName="flex flex-col gap-3 p-4">
              <AlertsPanel />
              <EventLog />
            </HudPanel>
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
    <div className="grid gap-4 text-[13.5px] leading-6 text-foreground/85 md:grid-cols-2 xl:grid-cols-4">
      <div>
        <p className="hud-label text-destructive">What fails</p>
        <p className="mt-1">{t.fails}</p>
      </div>
      <div>
        <p className="hud-label text-success">What still works</p>
        <p className="mt-1">{t.works}</p>
      </div>
      <div>
        <p className="hud-label">The controller</p>
        <p className="mt-1">{t.controller}</p>
        {scenario === 'vhfFail' && (
          <Button size="sm" className="mt-2" onClick={selectVhfStandby} disabled={vhfStandby}>
            <RadioTower aria-hidden /> {vhfStandby ? 'Standby transmitters in use' : 'Switch to standby transmitters'}
          </Button>
        )}
      </div>
      <div>
        <p className="hud-label">The pilot</p>
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
      <p className="hud-label mb-1.5">Log</p>
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
    <div className="flex min-w-0 flex-col gap-4">
      <HudPanel index="CLK" title="Time" bodyClassName="flex flex-col gap-2 p-3">
        <ClockControls clock={clock} onReset={resetAll} />
        <p className="text-[12px] text-muted-foreground">The whole journey takes about two hours: speed it up.</p>
      </HudPanel>

      <HudPanel index="VEW" title="View" bodyClassName="flex flex-col gap-4 p-4">
        <Segmented label="Show" value={view} onChange={(v) => setView(v)} options={(Object.keys(VIEWS) as ViewId[]).map((k) => ({ value: k, label: VIEWS[k].label }))} />
        <LeverSwitch label="Follow CNS700" tone="signal" checked={follow} onChange={setFollow} />
        <div className="flex flex-col gap-2">
          <Label htmlFor="sb-cov" className="hud-label">
            Coverage overlay
          </Label>
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
          <Segmented
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
      </HudPanel>

      <HudPanel index="TFC" title="Traffic" bodyClassName="flex flex-wrap gap-2 p-4">
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
      </HudPanel>

      <HudPanel index="SYS" title="Systems" bodyClassName="flex flex-col gap-4 px-4 py-3">
        <p className="text-[12px] text-muted-foreground">Switch systems off one by one and watch the controller’s screen.</p>
        {(['surveillance', 'navigation', 'communication'] as const).map((p) => {
          const Icon = PILLAR_ICON[p]
          return (
            <div key={p} className="flex flex-col">
              <p className="hud-label mb-1 flex items-center gap-1.5 border-b border-hud-line pb-1.5">
                <Icon className="size-3.5" aria-hidden /> {pillarName(p)}
              </p>
              {SYSTEMS.filter((s) => s.pillar === p).map((s) => (
                <LeverSwitch
                  key={s.id}
                  tone="signal"
                  label={
                    <span className="inline-flex items-center gap-1">
                      {s.short}
                      <Link to={MODULE_BY_ID.get(s.moduleId)!.path} className="text-muted-foreground hover:text-signal" aria-label={`Open the ${s.short} module`}>
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
      </HudPanel>

      <p className="flex items-center gap-2 px-1 text-[12px] text-muted-foreground">
        <Plane className="size-4 shrink-0" aria-hidden /> Aircraft positions come from one shared simulation; each system only sees what its physics allows.
      </p>
    </div>
  )
}
