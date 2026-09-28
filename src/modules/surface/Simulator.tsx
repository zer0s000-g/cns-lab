import { Link } from 'react-router'
import { ArrowRight, Car, PlaneLanding, Undo2 } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ClockControls, Readout, ReadoutGrid, SimLabel } from '@/components/sim/Controls'
import { ChapterHead } from '@/components/module/ModuleLayout'
import { Term } from '@/components/Term'
import { DEFAULT_SMR, smrAzimuthResolutionM, smrRangeResolutionM, visibleInFog } from '@/core/surface'
import { METRES_PER_NM } from '@/core/units'
import { useClock, useSimulationLoop } from '@/hooks/useSimClock'
import { useSampled } from '@/hooks/useSampled'
import { Dial, HudButton, LeverSwitch, Segmented } from '@/hud/Controls'
import { HudPanel } from '@/hud/HudFrame'
import { AirportMap } from './AirportMap'
import { FAILING_RECEIVER, RWY, TOUCHDOWN_X, TOWER_POS } from './layout'
import { presetOf, useSurface, useSurfaceState, ZOOMS, type PresetId, type ZoomId } from './state'
import { SurfaceScope } from './SurfaceScope'
import { TowerView } from './TowerView'

/**
 * The Simulator chapter: a console laid over the airport diorama. Left, the
 * controller's display; right, the control deck; below, the airport map (drag
 * vehicles here) and the view from the tower window.
 */
export function SurfaceSimulator() {
  const { engine, clock, store } = useSurface()

  useSimulationLoop(clock, (dt) => {
    const s = store.getState()
    engine.env = s.env
    engine.step(dt)
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="hud-panel rounded-md px-5 py-4 md:w-fit md:max-w-[520px]">
        <ChapterHead
          n={2}
          title="Simulator"
          lead="The airport behind is what is really there. The display shows what the radar, MLAT and ADS-B can work out."
        />
      </div>
      <div className="grid gap-4 md:grid-cols-[minmax(0,420px)_1fr_minmax(0,340px)]">
        <div className="flex min-w-0 flex-col gap-4">
          <HudPanel
            index="SMR"
            title="Controller's display"
            bodyClassName="flex flex-col gap-2.5 p-3"
          >
            <div className="relative">
              <SurfaceScope />
              <div className="pointer-events-none absolute top-2 left-2">
                <SimLabel icon="none">Radar turns once a second</SimLabel>
              </div>
            </div>
            <ScopeLegend />
            <p className="text-[11.5px] leading-4 text-muted-foreground">Click a label to select it.</p>
          </HudPanel>
          <HudPanel index="TLM" title="Runway and traffic" bodyClassName="p-3">
            <LiveReadouts />
          </HudPanel>
        </div>
        <div aria-hidden className="hidden md:block" />
        <SurfaceControls />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <HudPanel
          index="MAP"
          title="What is really on the airport"
          actions={<span className="hud-label hidden text-[9.5px] sm:inline">Drag a vehicle to move it</span>}
          bodyClassName="flex flex-col gap-2.5 p-3"
        >
          <AirportMap />
          <MapLegend />
        </HudPanel>
        <HudPanel
          index="TWR"
          title="Out of the tower window"
          actions={<span className="hud-label hidden text-[9.5px] sm:inline">Fog fades it; the display stays clear</span>}
          bodyClassName="flex flex-col gap-2.5 p-3"
        >
          <TowerView />
          <p className="text-[11.5px] leading-5 text-muted-foreground">
            Objects lose contrast with distance in fog. At the <Term id="visibility">visibility</Term> distance they fade into
            the background. Radio waves pass through fog, so the display is unaffected.
          </p>
        </HudPanel>
      </div>
    </div>
  )
}

function MapLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <li className="flex items-center gap-1.5">
        <svg viewBox="0 0 24 8" className="h-2 w-6" aria-hidden>
          {[3, 9, 15, 21].map((x) => (
            <circle key={x} cx={x} cy="4" r="2" className="fill-sim-alert" />
          ))}
        </svg>
        <Term id="stop-bar">Stop bar</Term> (red lights: do not enter)
      </li>
      <li className="flex items-center gap-1.5">
        <svg viewBox="0 0 24 8" className="h-2 w-6" aria-hidden>
          {[3, 9, 15, 21].map((x) => (
            <circle key={x} cx={x} cy="4" r="2" className="fill-sim-ok" />
          ))}
        </svg>
        Green lights: route to follow
      </li>
      <li className="flex items-center gap-1.5">
        <svg viewBox="0 0 24 8" className="h-2 w-6" aria-hidden>
          <path d="M1 4 H23" className="stroke-sim-muted" strokeWidth="1.5" strokeDasharray="4 3" />
        </svg>
        <Term id="runway-protected-area">Runway protected area</Term>
      </li>
      <li className="flex items-center gap-1.5">
        <svg viewBox="0 0 14 14" className="size-3.5" aria-hidden>
          <path d="M7 1.5 L13 12 L1 12 Z" className="fill-sim-bg stroke-sim-signal" strokeWidth="1.8" />
        </svg>
        MLAT receiver
      </li>
      <li className="flex items-center gap-1.5">
        <svg viewBox="0 0 14 10" className="h-2.5 w-3.5" aria-hidden>
          <rect x="1" y="1" width="12" height="8" className="fill-sim-signal" />
        </svg>
        Vehicle
      </li>
    </ul>
  )
}

function ScopeSymbol({ kind }: { kind: 'video' | 'mlat' | 'adsb' | 'fused' | 'primary' | 'coast' }) {
  return (
    <svg viewBox="0 0 16 16" className="size-4 rounded-sm bg-scope-bg" aria-hidden>
      {kind === 'video' && <rect x="4" y="6" width="8" height="4" rx="1.5" className="fill-scope-blip" />}
      {kind === 'mlat' && <path d="M8 3 L13 12 L3 12 Z" className="fill-none stroke-scope-text" strokeWidth="1.5" />}
      {kind === 'adsb' && <path d="M8 2.5 L13.5 8 L8 13.5 L2.5 8 Z" className="fill-none stroke-scope-text" strokeWidth="1.5" />}
      {kind === 'fused' && <path d="M8 2.5 L13.5 8 L8 13.5 L2.5 8 Z" className="fill-scope-text" />}
      {kind === 'primary' && <circle cx="8" cy="8" r="3" className="fill-scope-text" />}
      {kind === 'coast' && <circle cx="8" cy="8" r="4.5" className="fill-none stroke-scope-text" strokeWidth="1.5" strokeDasharray="2 2" />}
    </svg>
  )
}

function ScopeLegend() {
  const layers = useSurfaceState((s) => s.layers)
  const items: { kind: Parameters<typeof ScopeSymbol>[0]['kind']; text: string; show: boolean }[] = [
    { kind: 'video', text: 'SMR echo (shape, no name)', show: layers.smr },
    { kind: 'mlat', text: 'MLAT position', show: !layers.fused && layers.mlat },
    { kind: 'adsb', text: 'ADS-B position', show: !layers.fused && layers.adsb },
    { kind: 'fused', text: 'Fused track with a name', show: layers.fused },
    { kind: 'primary', text: 'Track without a name', show: layers.fused },
    { kind: 'coast', text: 'No fresh data', show: layers.fused },
  ]
  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
      <ul className="flex flex-wrap gap-x-3 gap-y-1">
        {items
          .filter((i) => i.show)
          .map((i) => (
            <li key={i.kind} className="flex items-center gap-1.5">
              <ScopeSymbol kind={i.kind} />
              {i.text}
            </li>
          ))}
      </ul>
      {layers.fused && <p>Letters after the speed show which sensors see the target: S = SMR, M = MLAT, A = ADS-B.</p>}
    </div>
  )
}

function formatVis(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(m >= 9950 ? 0 : 1)} km` : `${Math.round(m / 10) * 10} m`
}

function LiveReadouts() {
  const { engine } = useSurface()
  const vis = useSurfaceState((s) => s.visibilityM)
  const r = useSampled(() => {
    const e = engine
    const a = e.alert
    const arr = e.objects.find((o) => o.phase === 'final')
    const landing = e.objects.find((o) => o.phase === 'rollout')
    const tdz = Math.hypot(TOUCHDOWN_X - TOWER_POS.x, TOWER_POS.y - RWY.centreY)
    const named = [...e.tracks.values()].filter((t) => e.trackSources(t).length && t.identity).length
    const unnamed = [...e.tracks.values()].filter((t) => e.trackSources(t).length && !t.identity).length
    return {
      level: a.level,
      who: a.intruders.map((id) => e.nameOf(id)).join(', '),
      next: arr ? `${arr.callsign} ${((RWY.thresholdX - arr.pos.x) / METRES_PER_NM).toFixed(1)} NM` : landing ? `${landing.callsign} landing` : '—',
      nextHint: arr ? `${Math.round((RWY.thresholdX - arr.pos.x) / Math.max(arr.speedMs, 1))} s to the runway` : `Next in ${Math.max(0, Math.round(e.nextArrivalS - e.timeS))} s`,
      tdzSeen: visibleInFog(tdz, vis),
      named,
      unnamed,
      event: e.events.length && e.timeS - e.events[e.events.length - 1].timeS < 40 ? e.events[e.events.length - 1].text : null,
    }
  }, 300, (x, y) => JSON.stringify(x) === JSON.stringify(y))
  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      <ReadoutGrid className="lg:grid-cols-2">
        <Readout
          label="Runway 09/27"
          value={r.level === 'alert' ? 'ALERT' : r.level === 'caution' ? 'Caution' : 'Clear'}
          tone={r.level === 'alert' ? 'alert' : r.level === 'caution' ? 'warning' : 'ok'}
          hint={r.level === 'none' ? 'Nothing inside the protected area' : `${r.who} inside the protected area`}
        />
        <Readout label="Next landing" value={r.next} hint={r.nextHint} />
        <Readout label="Visibility" value={formatVis(vis)} hint={r.tdzSeen ? 'Tower can see the touchdown zone' : 'Tower cannot see the runway'} tone={r.tdzSeen ? 'default' : 'warning'} />
        <Readout label="Targets on the display" value={`${r.named} named`} hint={`${r.unnamed} without a name`} />
      </ReadoutGrid>
      {r.event && <p className="rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-xs text-foreground">{r.event}</p>}
    </div>
  )
}

function SurfaceControls() {
  const { engine, clock } = useSurface()
  const env = useSurfaceState((s) => s.env)
  const layers = useSurfaceState((s) => s.layers)
  const vis = useSurfaceState((s) => s.visibilityM)
  const zoom = useSurfaceState((s) => s.zoom)
  const selectedId = useSurfaceState((s) => s.selectedId)
  const { setEnv, setLayer, setPreset, setVisibility, setZoom, select, resetAll } = useSurfaceState((s) => s)
  const running = useClock(clock, (s) => s.running)
  const vehicles = engine.objects.filter((o) => o.kind === 'vehicle')
  const vehicleId = vehicles.some((v) => v.id === selectedId) ? selectedId! : 'OPS1'
  const rangeRes = smrRangeResolutionM(DEFAULT_SMR)
  const azRes = smrAzimuthResolutionM(DEFAULT_SMR, 1000)
  const visHint = vis < 400 ? 'Thick fog: low visibility procedures' : vis < 1500 ? 'Fog' : vis < 5000 ? 'Mist' : 'Clear'
  const shortZoom: Record<ZoomId, string> = { airport: 'Airport', west: 'West A1', apron: 'Apron' }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <HudPanel index="CLK" title="Time" bodyClassName="p-3">
        <ClockControls clock={clock} onReset={resetAll} />
        {!running && <p className="mt-2 text-xs text-muted-foreground">Paused. Press Play to let the traffic move.</p>}
      </HudPanel>

      <HudPanel index="SUR" title="The controller's picture" bodyClassName="flex flex-col gap-3 p-4">
        <Segmented
          label="Show"
          value={presetOf(layers) as PresetId}
          onChange={(v) => setPreset(v)}
          options={[
            { value: 'smr', label: 'SMR only' },
            { value: 'mlat', label: '+ MLAT' },
            { value: 'adsb', label: '+ ADS-B' },
            { value: 'fused', label: 'Fused' },
          ]}
        />
        <div className="flex flex-col">
          <LeverSwitch tone="signal" label={<Term id="smr">Surface movement radar</Term>} checked={layers.smr} onChange={(v) => setLayer('smr', v)} hint="Sees every object's shape, never its name" />
          <LeverSwitch tone="signal" label={<Term id="multilateration">Multilateration</Term>} checked={layers.mlat} onChange={(v) => setLayer('mlat', v)} hint="Objects with a transponder, named" />
          <LeverSwitch tone="signal" label={<Term id="ads-b">ADS-B</Term>} checked={layers.adsb} onChange={(v) => setLayer('adsb', v)} hint="Objects that broadcast their own position" />
          <LeverSwitch tone="signal" label={<Term id="data-fusion">Fused tracks</Term>} checked={layers.fused} onChange={(v) => setLayer('fused', v)} hint="One labelled track per object" />
        </div>
        <Segmented
          label="Display area"
          value={zoom}
          onChange={(v) => setZoom(v as ZoomId)}
          options={(Object.keys(ZOOMS) as ZoomId[]).map((z) => ({ value: z, label: shortZoom[z], ariaLabel: ZOOMS[z].label }))}
        />
        <p className="text-[11.5px] leading-4 text-muted-foreground">
          The radar: X-band, 1 turn per second, detail about {rangeRes.toFixed(0)} m × {azRes.toFixed(0)} m at 1 km.
        </p>
      </HudPanel>

      <HudPanel index="WX" title="Weather" bodyClassName="flex flex-col gap-2 p-4">
        <div className="flex items-center gap-4">
          <Dial
            label="Visibility"
            value={Math.log10(vis)}
            min={Math.log10(50)}
            max={4}
            step={0.01}
            onChange={(v) => setVisibility(Math.round(10 ** v))}
            format={(v) => formatVis(10 ** v)}
          />
          <p className="flex-1 text-[12px] leading-5 text-muted-foreground">
            <span className={vis < 400 ? 'text-warning' : 'text-foreground'}>{visHint}.</span> Fog hides the runway from the tower
            window, not from the display.
          </p>
        </div>
        <LeverSwitch label="Heavy rain" checked={env.heavyRain} onChange={(v) => setEnv('heavyRain', v)} hint="X-band radar is weakened and cluttered by rain" />
        <LeverSwitch
          tone="signal"
          label={<Term id="circular-polarisation">Circular polarisation</Term>}
          checked={env.circularPol}
          onChange={(v) => setEnv('circularPol', v)}
          hint="Radar setting that suppresses rain echoes"
        />
      </HudPanel>

      <HudPanel index="FLT" title="Equipment faults" bodyClassName="px-4 py-2">
        <LeverSwitch label="VAN2 has no transponder" checked={env.noTransponder} onChange={(v) => setEnv('noTransponder', v)} />
        <LeverSwitch
          label={
            <span>
              Reflections off the terminal (<Term id="ghost-target">ghosts</Term>)
            </span>
          }
          checked={env.reflections}
          onChange={(v) => setEnv('reflections', v)}
        />
        <LeverSwitch label={`MLAT receiver ${FAILING_RECEIVER} failed`} checked={env.mlatFailure} onChange={(v) => setEnv('mlatFailure', v)} />
      </HudPanel>

      <HudPanel index="RWY" title="Runway incursion" bodyClassName="flex flex-col gap-3 p-4">
        <p className="text-[12px] leading-5 text-muted-foreground">
          Drag a vehicle onto the runway on the airport map, or use the buttons. Select a vehicle and use the arrow keys to nudge it.
        </p>
        <div className="flex flex-col gap-2">
          <Label htmlFor="surface-vehicle" className="hud-label">
            Vehicle
          </Label>
          <Select value={vehicleId} onValueChange={(v) => select(v)}>
            <SelectTrigger id="surface-vehicle" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {vehicles.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.callsign} · {v.note ?? 'vehicle'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <HudButton variant="solid" onClick={() => engine.driveOntoRunway(vehicleId)}>
            <Car aria-hidden /> Drive {vehicleId} onto the runway
          </HudButton>
          <HudButton onClick={() => engine.sendVehiclesBack()}>
            <Undo2 aria-hidden /> Send vehicles back
          </HudButton>
          <HudButton onClick={() => engine.arrivalNow()}>
            <PlaneLanding aria-hidden /> Bring the next arrival in now
          </HudButton>
        </div>
        <p className="text-[12px] text-muted-foreground">
          The fused picture uses multilateration from the previous module.{' '}
          <Link to="/modules/mlat" className="inline-flex items-center gap-0.5 text-signal hover:underline">
            How MLAT works <ArrowRight className="size-3" aria-hidden />
          </Link>
        </p>
      </HudPanel>
    </div>
  )
}
