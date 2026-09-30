import { Link } from 'react-router'
import { ArrowUpRight, ChevronDown, RadioTower, RotateCcw, Swords } from 'lucide-react'
import { PILLAR_ICON } from '@/components/PillarBadge'
import { Term } from '@/components/Term'
import { HudButton, LeverSwitch } from '@/hud/Controls'
import { HudPanel } from '@/hud/HudFrame'
import { MODULE_BY_ID, pillarName } from '@/modules/registry'
import { cn } from '@/lib/utils'
import { ALL_SYSTEMS_ON, type ScenarioId } from '../engine'
import { AlertsPanel, SCENARIO_TEXT } from '../Panels'
import { SYSTEMS } from '../systems'
import { useSandbox, useSandboxState } from '../state'

const SCENARIOS: { id: ScenarioId; label: string }[] = [
  { id: 'normal', label: 'All normal' },
  { id: 'radarOutage', label: 'Radar outage' },
  { id: 'gnssJam', label: 'GNSS jamming' },
  { id: 'vhfFail', label: 'VHF failure' },
  { id: 'mountain', label: 'Mountain terrain' },
]

/** Failures to try, what they break, what still works, and what people do about it. */
export function BreakPanel({ className }: { className?: string }) {
  const { engine } = useSandbox()
  const scenario = useSandboxState((s) => s.scenario)
  const setScenario = useSandboxState((s) => s.setScenario)
  const vhfStandby = useSandboxState((s) => s.vhfStandby)
  const selectVhfStandby = useSandboxState((s) => s.selectVhfStandby)
  const systems = useSandboxState((s) => s.systems)
  const setSystem = useSandboxState((s) => s.setSystem)
  const select = useSandboxState((s) => s.select)
  const resetAll = useSandboxState((s) => s.resetAll)
  const text = scenario === 'normal' ? null : SCENARIO_TEXT[scenario]
  // Space-based ADS-B is off in the normal set-up, so count changes from normal, not switches that are off.
  const changed = SYSTEMS.filter((s) => systems[s.id] !== ALL_SYSTEMS_ON[s.id]).length
  return (
    <HudPanel index="FAIL" title="Break something" className={className} bodyClassName="flex flex-col gap-3 px-4 py-3">
      <p className="text-[12.5px] leading-5 text-muted-foreground">
        Systems overlap on purpose. Break one and watch the others carry on: <Term id="graceful-degradation">graceful degradation</Term>.
      </p>
      <div role="group" aria-label="Failure scenario" className="grid grid-cols-2 gap-1.5">
        {SCENARIOS.map((s) => (
          <HudButton key={s.id} active={scenario === s.id} onClick={() => setScenario(s.id)} className={cn('min-h-10 justify-start text-left', s.id === 'normal' && 'col-span-2')}>
            {s.label}
          </HudButton>
        ))}
      </div>
      {text && (
        <div className="flex flex-col gap-2 text-[12.5px] leading-5" aria-live="polite">
          <p>
            <span className="hud-label mr-1.5 text-destructive">Fails</span>
            {text.fails}
          </p>
          <p>
            <span className="hud-label mr-1.5 text-success">Still works</span>
            {text.works}
          </p>
          <p>
            <span className="hud-label mr-1.5">Controller</span>
            {text.controller}
          </p>
          <p>
            <span className="hud-label mr-1.5">Pilot</span>
            {text.pilot}
          </p>
          {scenario === 'vhfFail' && (
            <HudButton variant={vhfStandby ? 'line' : 'solid'} onClick={selectVhfStandby} disabled={vhfStandby} className="min-h-10 self-start">
              <RadioTower aria-hidden /> {vhfStandby ? 'Standby transmitters in use' : 'Switch to the standby transmitters'}
            </HudButton>
          )}
        </div>
      )}
      <div className="flex flex-col gap-2 border-t border-hud-line pt-3">
        <p className="hud-label">Safety nets</p>
        <HudButton
          onClick={() => {
            engine.spawnConflict()
            select('CNS9A')
          }}
          className="min-h-10 self-start"
        >
          <Swords aria-hidden /> Two aircraft on a collision course
        </HudButton>
        <AlertsPanel />
      </div>
      <details className="group border-t border-hud-line pt-3">
        <summary className="hud-label flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 rounded-sm text-foreground/85">
          <span>
            Switch systems off one by one{changed ? <span className="ml-1.5 text-destructive">· {changed} changed</span> : null}
          </span>
          <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <p className="mt-2 text-[12px] leading-5 text-muted-foreground">When does CNS700 finally disappear from the controller’s screen?</p>
        {(['surveillance', 'navigation', 'communication'] as const).map((p) => {
          const Icon = PILLAR_ICON[p]
          return (
            <div key={p} className="mt-2 flex flex-col">
              <p className="hud-label mb-0.5 flex items-center gap-1.5">
                <Icon className="size-3.5" aria-hidden /> {pillarName(p)}
              </p>
              {SYSTEMS.filter((s) => s.pillar === p).map((s) => (
                <LeverSwitch
                  key={s.id}
                  tone="signal"
                  label={
                    <span className="inline-flex items-center gap-1">
                      {s.short}
                      <Link to={MODULE_BY_ID.get(s.moduleId)!.path} className="inline-grid min-h-6 min-w-6 place-items-center text-muted-foreground hover:text-signal" aria-label={`Open the ${s.short} module`}>
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
        <HudButton onClick={resetAll} className="mt-2 min-h-10">
          <RotateCcw aria-hidden /> Restore all systems
        </HudButton>
      </details>
      <p className="hud-label text-[9.5px] leading-4 text-muted-foreground/80">CNS700 keeps its planned path whatever you break; the panels show what would fail and what people would do.</p>
    </HudPanel>
  )
}
