import { lazy, Suspense, useEffect, useRef } from 'react'
import { PlaneLanding, RotateCcw } from 'lucide-react'
import { Kbd } from '@/components/ui/kbd'
import { AudioCaption, ClockControls, ClockSpeedLabel, ControlSwitch, Readout, ReadoutGrid, SimLabel } from '@/components/sim/Controls'
import { ChapterHead } from '@/components/module/ModuleLayout'
import { Term } from '@/components/Term'
import { ILS_CATEGORIES, LOC_IDENT_TONE_HZ } from '@/core/ils'
import { MARKER_TONE_HZ, markerKeying, morseTimeline, toMorse, type MarkerKind } from '@/core/morse'
import { useClock, useSimulationLoop } from '@/hooks/useSimClock'
import { useSampled } from '@/hooks/useSampled'
import { Dial, HudButton, LeverSwitch, Segmented } from '@/hud/Controls'
import { HudPanel } from '@/hud/HudFrame'
import { audio, caption, type SoundHandle } from '@/lib/audio'
import { cn } from '@/lib/utils'
import { Cockpit } from './Cockpit'
import { CLEAR_VISIBILITY_M, type Weather } from './engine'
import { SideView } from './SideView'
import { TopView } from './TopView'
import { useIls, useIlsState } from './state'

// The pilot's-eye view needs three.js: load it after the page, like the stage.
const Approach3D = lazy(() => import('./Approach3D').then((m) => ({ default: m.Approach3D })))

const MARKER_TEXT: Record<MarkerKind, string> = {
  outer: 'Outer marker: 400 Hz, two dashes a second, blue light',
  middle: 'Middle marker: 1300 Hz, dots and dashes, amber light',
  inner: 'Inner marker: 3000 Hz, six dots a second, white light',
}

function userHasInteracted(): boolean {
  const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation
  return ua ? ua.hasBeenActive : true
}

export function IlsSimulator() {
  const { engine, clock, store } = useIls()
  const markerSound = useRef<{ kind: MarkerKind | null; handle: SoundHandle | null }>({ kind: null, handle: null })

  useSimulationLoop(clock, (dt) => {
    const s = store.getState()
    engine.step(dt)
    for (const ev of engine.takeEvents()) {
      if (ev.kind === 'marker' && ev.marker) caption(MARKER_TEXT[ev.marker], 4)
      else if (ev.kind === 'minimums') caption(ev.continue ? `Minimums, ${ev.dhFt} ft: lights in sight, continue` : `Minimums, ${ev.dhFt} ft: nothing in sight, go around`, 5)
      else if (ev.kind === 'ident' && s.identSound) {
        caption(`Localizer ident ${engine.site.ident.split('').join(' ')} (${toMorse(engine.site.ident)}), ${LOC_IDENT_TONE_HZ} Hz`, 6)
        if (userHasInteracted()) audio.keyed(morseTimeline(engine.site.ident, 7).segments, LOC_IDENT_TONE_HZ, { gain: 0.08 })
      } else if (ev.kind === 'loc-off') caption('Localizer switched off by its monitor: flag, ident stops', 5)
      else if (ev.kind === 'touchdown') caption(ev.td.onRunway ? 'Touchdown' : 'The aircraft touched the ground off the runway', 4)
    }
    // Marker tone follows the beam the aircraft is in (state, not events, so a reset also stops it).
    const want = s.markerSound && clock.getState().running ? engine.receiver.marker : null
    const cur = markerSound.current
    if (want !== cur.kind) {
      cur.handle?.stop()
      cur.handle = null
      cur.kind = want
      if (want && userHasInteracted()) {
        const k = markerKeying(want)
        cur.handle = audio.keyed(k.segments, MARKER_TONE_HZ[want], { loopPeriodS: k.periodS, gain: 0.07 })
      }
    }
  })
  useEffect(() => () => markerSound.current.handle?.stop(), [])

  return (
    <div className="flex flex-col gap-4">
      <div className="hud-panel rounded-md px-5 py-4 md:w-fit md:max-w-[520px]">
        <ChapterHead
          n={2}
          title="Simulator"
          lead="The table behind shows the beams the aircraft is flying in. The console shows what the pilot sees and hears."
        />
      </div>
      <div className="grid gap-4 md:grid-cols-[minmax(0,420px)_1fr_minmax(0,340px)]">
        <div className="flex min-w-0 flex-col gap-4">
          <HudPanel index="WIN" title="The approach" bodyClassName="p-3">
            <ApproachFigure />
          </HudPanel>
          <Cockpit />
        </div>
        <div aria-hidden className="hidden md:block" />
        <IlsControls />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <HudPanel index="LOC" title="Seen from above: the localizer" className="min-w-0" actions={<span className="hud-label hidden text-[9.5px] sm:inline">Left and right</span>} bodyClassName="p-3">
          <TopView />
        </HudPanel>
        <HudPanel index="GS" title="Seen from the side: the glideslope" className="min-w-0" actions={<span className="hud-label hidden text-[9.5px] sm:inline">Up and down</span>} bodyClassName="p-3">
          <SideView />
        </HudPanel>
      </div>
      <HudPanel index="TLM" title="Approach telemetry" bodyClassName="flex flex-col gap-4 p-4">
        <LiveReadouts />
        <LobeLegend />
      </HudPanel>
    </div>
  )
}

function ApproachFigure() {
  const { engine, clock } = useIls()
  const store = useIls().store
  const view = useIlsState((s) => s.view)
  const weather = useIlsState((s) => s.weather)
  const thickFog = useIlsState((s) => s.thickFog)
  const hud = useSampled(
    () => {
      const e = engine
      const recentMin = e.minimums && e.timeS - e.minimums.atS < 6 ? e.minimums : null
      return {
        h: Math.max(0, Math.round(e.heightAboveRunwayFt)),
        lights: e.visual.approachLights,
        runway: e.visual.runway,
        minimums: recentMin ? recentMin.continue : null,
        dh: recentMin?.dhFt ?? null,
        phase: e.phase,
        td: e.touchdown,
        msg: e.message,
      }
    },
    150,
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  )
  const vis = weather === 'clear' ? CLEAR_VISIBILITY_M : engine.visibilityM
  const cat = weather === 'clear' ? null : ILS_CATEGORIES[weather]
  const label = `Approach view from the ${view === 'cockpit' ? 'cockpit' : 'outside, behind the aircraft'}. ${cat ? `${cat.label} fog, about ${Math.round(vis)} metres visibility.` : 'Clear day.'} Height ${hud.h} feet. ${hud.lights || hud.runway ? 'Lights in sight.' : 'Nothing in sight yet.'} Focus here and use the arrow keys: left and right to steer, up and down to climb or descend.`

  const onKey = (e: React.KeyboardEvent) => {
    const s = store.getState()
    const big = e.shiftKey ? 5 : 1
    if (e.key === 'ArrowLeft') s.steer(-big)
    else if (e.key === 'ArrowRight') s.steer(big)
    else if (e.key === 'ArrowUp') s.nudgeVs(100 * big)
    else if (e.key === 'ArrowDown') s.nudgeVs(-100 * big)
    else return
    e.preventDefault()
  }

  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="sr-only">The approach</span>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          Click the view, then <Kbd>←</Kbd> <Kbd>→</Kbd> steer · <Kbd>↑</Kbd> <Kbd>↓</Kbd> climb or descend
        </span>
      </figcaption>
      <div
        tabIndex={0}
        role="group"
        aria-label="Approach view. Arrow keys fly the aircraft."
        onKeyDown={onKey}
        className="relative rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <Suspense fallback={<div role="img" aria-label={label} className="aspect-video w-full rounded-[3px] bg-stage-bg" />}>
          <Approach3D className="aspect-video w-full" label={label} />
        </Suspense>
        <div className="pointer-events-none absolute top-2 left-2 flex flex-wrap gap-1.5">
          <SimLabel icon="none">
            {cat ? `${cat.label} fog · RVR ${cat.fogRvrM} m${thickFog ? ' · worse than allowed' : ''}` : 'Clear day'}
          </SimLabel>
          {view === 'cockpit' && <SimLabel icon="none">Zoomed-in view</SimLabel>}
          <ClockSpeedLabel clock={clock} />
        </div>
        <div className="pointer-events-none absolute top-2 right-2 rounded-md border border-instrument-bezel bg-instrument-face/90 px-2 py-1 font-mono text-sm font-semibold text-scope-trace tabular-nums">
          {hud.h.toLocaleString('en-US')} ft
        </div>
        <div className="pointer-events-none absolute inset-x-0 top-12 flex justify-center px-2">
          {hud.minimums !== null ? (
            <span className={cn('rounded-md px-3 py-1.5 text-sm font-semibold', hud.minimums ? 'border bg-background/95 text-foreground' : 'border border-destructive bg-background/95 text-destructive')}>
              MINIMUMS {hud.dh} ft · {hud.minimums ? 'lights in sight: continue' : 'nothing in sight: go around'}
            </span>
          ) : hud.td ? (
            <span className={cn('rounded-md px-3 py-1.5 text-center text-sm font-semibold', hud.td.onRunway ? 'border bg-background/95 text-foreground' : 'border border-destructive bg-background/95 text-destructive')}>
              {hud.td.onRunway
                ? `Landed ${Math.round(hud.td.pastThresholdM)} m past the threshold, ${Math.abs(hud.td.lateralM).toFixed(0)} m ${hud.td.lateralM > 0 ? 'right' : 'left'} of the centreline`
                : hud.td.pastThresholdM < 0
                  ? `Touched the ground ${Math.round(-hud.td.pastThresholdM)} m before the runway`
                  : `Touched down ${Math.abs(hud.td.lateralM).toFixed(0)} m ${hud.td.lateralM > 0 ? 'right' : 'left'} of the centreline: off the runway`}
            </span>
          ) : hud.msg ? (
            <span className="rounded-md bg-background/95 px-3 py-1.5 text-sm font-medium">{hud.msg}</span>
          ) : null}
        </div>
        <div className="pointer-events-none absolute bottom-2 left-2 flex flex-wrap gap-1.5">
          <SimLabel icon="none">{hud.lights ? 'Approach lights in sight' : 'Approach lights: not in sight'}</SimLabel>
          <SimLabel icon="none">{hud.runway ? 'Runway in sight' : 'Runway: not in sight'}</SimLabel>
        </div>
      </div>
    </figure>
  )
}

/** Key for the top and side views: colour, pattern and words for each tone, and the lines. */
function LobeLegend() {
  return (
    <div className="flex flex-col gap-2 text-xs text-muted-foreground">
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        <span className="inline-flex items-center gap-2">
          <Swatch tone="90" />
          <span>
            <span className="font-semibold text-foreground">90 Hz louder</span>: pilot's left, or above the path. Needle says fly right, or fly down.
          </span>
        </span>
        <span className="inline-flex items-center gap-2">
          <Swatch tone="150" />
          <span>
            <span className="font-semibold text-foreground">150 Hz louder</span>: pilot's right, or below the path. Needle says fly left, or fly up.
          </span>
        </span>
      </div>
      <p>
        Stronger tint = bigger difference. Solid line: both tones equal, the path to fly. Thin dashed lines: full-scale needle. Orange dashed lines: false
        glide paths, or a course bent by reflections.
      </p>
    </div>
  )
}

function Swatch({ tone }: { tone: '90' | '150' }) {
  return (
    <svg viewBox="0 0 16 16" className="size-4 shrink-0" aria-hidden>
      <defs>
        <pattern id={`legend-${tone}`} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform={tone === '90' ? 'rotate(45)' : undefined}>
          {tone === '90' ? <line x1="0" y1="0" x2="0" y2="4" className="stroke-lobe-90" strokeWidth="1.6" /> : <circle cx="2" cy="2" r="0.9" className="fill-lobe-150" />}
        </pattern>
      </defs>
      <rect x="0.5" y="0.5" width="15" height="15" className={tone === '90' ? 'fill-lobe-90 stroke-lobe-90' : 'fill-lobe-150 stroke-lobe-150'} fillOpacity="0.3" />
      <rect x="0.5" y="0.5" width="15" height="15" fill={`url(#legend-${tone})`} />
    </svg>
  )
}

function LiveReadouts() {
  const { engine } = useIls()
  const v = useSampled(() => {
    const e = engine
    return {
      d: e.distanceToThresholdNm,
      h: e.heightAboveRunwayFt,
      path: e.onPathHeightFt,
      lat: e.lateralOffsetM,
      vs: e.pilot.vsFpm,
      gs: e.aircraft.speedKt,
      hdg: e.aircraft.headingDeg,
      phase: e.phase,
    }
  }, 200)
  const dev = v.h - v.path
  return (
    <ReadoutGrid className="h-fit lg:grid-cols-3">
      <Readout label="To the runway" value={v.d > 0 ? v.d.toFixed(1) : '0.0'} unit="NM" hint={v.phase === 'approach' ? 'To the threshold' : v.phase === 'go-around' ? 'Going around' : 'On the ground'} />
      <Readout label="Height" value={Math.round(Math.max(0, v.h)).toLocaleString('en-US')} unit="ft" hint={v.d > 0 ? `Glide path here: ${Math.round(v.path).toLocaleString('en-US')} ft` : undefined} />
      <Readout
        label="Off the glide path"
        value={v.d > 0 ? `${Math.abs(Math.round(dev))}` : '—'}
        unit={v.d > 0 ? 'ft' : undefined}
        tone={v.d > 0 && Math.abs(dev) > 150 ? 'warning' : 'default'}
        hint={v.d > 0 ? (Math.abs(dev) < 5 ? 'On the path' : dev > 0 ? 'Above the path' : 'Below the path') : undefined}
      />
      <Readout
        label="Off the centreline"
        value={Math.abs(v.lat).toFixed(0)}
        unit="m"
        tone={Math.abs(v.lat) > 22 ? 'warning' : 'default'}
        hint={Math.abs(v.lat) < 1 ? 'On the centreline' : v.lat > 0 ? 'Right of it' : 'Left of it'}
      />
      <Readout label="Vertical speed" value={`${v.vs > 0 ? '+' : ''}${Math.round(v.vs / 10) * 10}`} unit="ft/min" hint="About −740 on a 3° path" />
      <Readout label="Groundspeed" value={Math.round(v.gs)} unit="kt" />
      <Readout label="Heading" value={String(Math.round(v.hdg) % 360).padStart(3, '0')} unit="°" hint="Runway 09 is 090°" />
    </ReadoutGrid>
  )
}

const WEATHER_OPTIONS: { value: Weather; label: string; ariaLabel: string }[] = [
  { value: 'clear', label: 'Clear', ariaLabel: 'Clear day' },
  { value: 'I', label: 'I', ariaLabel: 'Category one fog' },
  { value: 'II', label: 'II', ariaLabel: 'Category two fog' },
  { value: 'IIIA', label: 'IIIA', ariaLabel: 'Category three A fog' },
  { value: 'IIIB', label: 'IIIB', ariaLabel: 'Category three B fog' },
]

function IlsControls() {
  const { engine, clock } = useIls()
  const st = useIlsState((s) => s)
  const running = useClock(clock, (s) => s.running)
  const pilot = useSampled(() => ({ hdg: Math.round(engine.pilot.targetHeadingDeg) % 360, vs: Math.round(engine.pilot.selectedVsFpm / 100) * 100 }), 200)
  const cat = st.weather === 'clear' ? null : ILS_CATEGORIES[st.weather]

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <HudPanel index="CLK" title="Time" bodyClassName="p-3">
        <ClockControls clock={clock} onReset={st.resetAll} />
        {!running && <p className="mt-2 text-xs text-muted-foreground">Paused. Press Play to fly.</p>}
      </HudPanel>

      <HudPanel index="FLY" title="Fly the approach" bodyClassName="flex flex-col gap-4 p-4">
        <LeverSwitch
          tone="signal"
          label={<Term id="autoland">Autopilot follows the needles</Term>}
          checked={st.guidance}
          onChange={st.setGuidance}
          hint="Moving a control below hands the aircraft to you"
        />
        <div className="grid grid-cols-2 gap-x-2 gap-y-2">
          <Dial
            label="Steer: heading"
            value={pilot.hdg}
            min={0}
            max={359}
            onChange={(v) => st.setTargetHeading(v)}
            format={(v) => `${String(Math.round(v)).padStart(3, '0')}°`}
          />
          <Dial
            label="Climb or descend"
            value={pilot.vs}
            min={-1800}
            max={1500}
            step={100}
            onChange={(v) => st.setSelectedVs(v)}
            format={(v) => `${v > 0 ? '+' : ''}${v} ft/min`}
          />
          <p className="text-center text-[11px] leading-4 text-muted-foreground">Turns at up to 3° per second</p>
          <p className="text-center text-[11px] leading-4 text-muted-foreground">About −740 ft/min follows a 3° path at 140 kt</p>
        </div>
        <div className="flex flex-col gap-2">
          <HudButton onClick={() => st.resetApproach(10)}>
            <RotateCcw aria-hidden /> Stable approach from 10 NM
          </HudButton>
          <HudButton onClick={() => st.resetApproach(4)}>
            <PlaneLanding aria-hidden /> Stable approach from 4 NM
          </HudButton>
        </div>
      </HudPanel>

      <HudPanel index="WX" title="Weather and minimums" bodyClassName="flex flex-col gap-3 p-4">
        <Segmented label={<Term id="ils-category">Approach category</Term>} value={st.weather} onChange={st.setWeather} options={WEATHER_OPTIONS} />
        <p className="text-[11.5px] leading-4 text-muted-foreground">
          {cat
            ? `${cat.label}: decision height ${cat.dhFt === null ? 'none' : `${cat.dhFt} ft`}, RVR at least ${cat.minRvrM} m. Fog here: ${cat.fogRvrM} m.`
            : 'Clear day. Minimums shown for CAT I (200 ft).'}
        </p>
        <ControlSwitch
          label="Fog worse than the minimums allow"
          checked={st.thickFog}
          onChange={st.setThickFog}
          disabled={st.weather === 'clear'}
          hint="At the decision height nothing is in sight: go around"
        />
      </HudPanel>

      <HudPanel index="VIEW" title="Views and sound" bodyClassName="flex flex-col gap-2 p-4">
        <Segmented
          label="Approach view"
          value={st.view}
          onChange={st.setView}
          options={[
            { value: 'cockpit', label: 'Cockpit' },
            { value: 'outside', label: 'Outside' },
          ]}
        />
        <LeverSwitch tone="signal" label="Show the ideal path (dots)" checked={st.showPath} onChange={st.setShowPath} />
        <LeverSwitch tone="signal" label={<Term id="marker-beacon">Marker beacon tones</Term>} checked={st.markerSound} onChange={st.setMarkerSound} />
        <LeverSwitch tone="signal" label="Localizer Morse ident" checked={st.identSound} onChange={st.setIdentSound} hint="ICNS at 1020 Hz" />
        <AudioCaption />
      </HudPanel>

      <HudPanel index="FLT" title="Problems" bodyClassName="px-4 py-2">
        <LeverSwitch label={<Term id="critical-area">Truck in the critical area</Term>} checked={st.failures.truck} onChange={(v) => st.setFailure('truck', v)} />
        <LeverSwitch label={<Term id="ils-monitor">Localizer fault (monitor switches it off)</Term>} checked={st.failures.locFault} onChange={(v) => st.setFailure('locFault', v)} />
      </HudPanel>
    </div>
  )
}
