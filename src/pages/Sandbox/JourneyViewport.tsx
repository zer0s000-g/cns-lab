/**
 * The view of the journey: the 3D stage (airport or terminal area) or the 2D
 * region map, chosen automatically from the controller in charge (or by the
 * learner). A short fade covers every switch. Camera controls, honesty labels
 * and a keyboard path for everything the pointer can do.
 */
import { Suspense, lazy, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Binoculars, Crosshair, LocateFixed, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useClock } from '@/hooks/useSimClock'
import { useSampled } from '@/hooks/useSampled'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useReducedMotion } from '@/stores/prefs'
import { StageBoundary } from '@/stage/StageBoundary'
import { StagePoster, useWhenIdle } from '@/stage/LazyStage'
import { HEIGHT_EXAGGERATION, TABLE_RADIUS_NM } from '@/stage/scale'
import { cn } from '@/lib/utils'
import { resolveView, VIEW_LABEL, type CameraMode, type WorldView } from './director'
import { PHASE_LABEL } from './journey'
import { RegionMap, COVERAGE_CHOICES } from './RegionMap'
import type { LookOffsets } from './stage/JourneyCamera'
import { useSandbox, useSandboxState } from './state'
import type { SystemId } from './systems'

const JourneyStage = lazy(() => import('./stage/JourneyStage'))

const FADE_MS = 180

function describe(view: WorldView, phase: string, alt: number, kt: number): string {
  const where = view === 'airport' ? 'the airport, drawn at true scale, with its terminal, tower, runway lights, people and vehicles' : view === 'terminal' ? 'the terminal area as a table model with its radars and radio sites' : 'the region map'
  return `${VIEW_LABEL[view]} view: ${where}. CNS700 is in the ${phase} phase at ${alt.toLocaleString('en-US')} ft and ${kt} kt.`
}

export function JourneyViewport({ className, sideInset = 0 }: { className?: string; sideInset?: number }) {
  const { engine, store, clock } = useSandbox()
  const viewChoice = useSandboxState((s) => s.viewChoice)
  const cameraMode = useSandboxState((s) => s.cameraMode)
  const setCameraMode = useSandboxState((s) => s.setCameraMode)
  const zoomBy = useSandboxState((s) => s.zoomBy)
  const resetCamera = useSandboxState((s) => s.resetCamera)
  const setShownView = useSandboxState((s) => s.setShownView)
  const coverage = useSandboxState((s) => s.coverage)
  const setCoverage = useSandboxState((s) => s.setCoverage)
  const coverageAlt = useSandboxState((s) => s.coverageAltFt)
  const setCoverageAlt = useSandboxState((s) => s.setCoverageAlt)
  const speed = useClock(clock, (s) => s.speed)
  const reduced = useReducedMotion()
  const idle = useWhenIdle()
  const fine = useMediaQuery('(pointer: fine)')
  const info = useSampled(
    () => {
      const p = engine.journeyPose()
      return { phase: engine.phase, alt: Math.round((p?.altitudeFt ?? 0) / 10) * 10, kt: Math.round(p?.speedKt ?? 0) }
    },
    500,
    (a, b) => a.phase === b.phase && a.alt === b.alt && a.kt === b.kt,
  )
  const want = resolveView(viewChoice, info.phase)
  const [shown, setShown] = useState<WorldView>(want)
  const [fading, setFading] = useState(false)
  const [world, setWorld] = useState<WorldView>(want === 'map' ? 'terminal' : want)
  // Switch views behind a short fade (instant under reduced motion).
  useEffect(() => {
    if (want === shown) return
    if (reduced) {
      setShown(want)
      return
    }
    setFading(true)
    const id = window.setTimeout(() => {
      setShown(want)
      setFading(false)
    }, FADE_MS)
    return () => window.clearTimeout(id)
  }, [want, shown, reduced])
  useEffect(() => {
    setShownView(shown)
    if (shown !== 'map') setWorld(shown)
  }, [shown, setShownView])
  // Tower view only exists at the airport.
  useEffect(() => {
    if (shown === 'terminal' && cameraMode === 'tower') setCameraMode('follow')
  }, [shown, cameraMode, setCameraMode])

  const look = useRef<LookOffsets>({ yaw: 0, pitch: 0, reset: 0 })
  const onKey = (e: KeyboardEvent) => {
    const k = e.key
    if (k === 'ArrowLeft' || k === 'ArrowRight') look.current.yaw += k === 'ArrowLeft' ? 12 : -12
    else if (k === 'ArrowUp' || k === 'ArrowDown') look.current.pitch = Math.max(-15, Math.min(45, look.current.pitch + (k === 'ArrowUp' ? 5 : -5)))
    else if (k === '+' || k === '=') zoomBy(1.25)
    else if (k === '-' || k === '_') zoomBy(0.8)
    else if (k === '0') {
      look.current = { yaw: 0, pitch: 0, reset: look.current.reset + 1 }
      resetCamera()
    } else return
    e.preventDefault()
  }

  const label = describe(shown, PHASE_LABEL[info.phase].toLowerCase(), info.alt, info.kt)
  const honesty =
    shown === 'airport'
      ? 'Airport at true scale · boarding and deboarding shortened'
      : shown === 'terminal'
        ? `Table ${TABLE_RADIUS_NM * 2} NM across · heights ×${Math.round(HEIGHT_EXAGGERATION * 10) / 10} · aircraft and masts larger than life`
        : 'Region map · to scale · maximum ranges shown dashed'
  const modes: { id: CameraMode; label: string; icon: typeof Crosshair; disabled?: boolean }[] = [
    { id: 'follow', label: 'Follow', icon: Crosshair },
    { id: 'tower', label: 'Tower', icon: Binoculars, disabled: shown !== 'airport' },
    { id: 'overview', label: 'Overview', icon: LocateFixed },
  ]

  return (
    <div className={cn('dark absolute inset-0 overflow-hidden bg-stage-bg text-foreground', className)} data-view={shown}>
      <div
        tabIndex={0}
        role="group"
        aria-label={`${label} Keyboard: arrow keys look around, plus and minus zoom, 0 resets the camera.`}
        onKeyDown={onKey}
        className="absolute inset-0 outline-offset-[-3px]"
      >
        {idle ? (
          <StageBoundary fallback={<StagePoster className="absolute inset-0" label={label} message="3D view unavailable on this device" />}>
            <Suspense fallback={<StagePoster className="absolute inset-0" label={label} />}>
              <JourneyStage engine={engine} store={store} world={world} paused={shown === 'map'} reduced={reduced} look={look} label={label} className="absolute inset-0" />
            </Suspense>
          </StageBoundary>
        ) : (
          <StagePoster className="absolute inset-0" label={label} />
        )}
        <div className={cn('absolute inset-0 z-20', shown === 'map' ? 'block' : 'hidden')}>
          <RegionMap className="absolute inset-0" />
        </div>
      </div>
      {/* Scrims under the HUD text at the top and bottom, so it stays legible over a busy scene. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-20 h-28 bg-linear-to-b from-stage-bg/85 to-transparent md:h-32" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-32 bg-linear-to-t from-stage-bg/80 to-transparent lg:h-56" />
      <div aria-hidden className={cn('pointer-events-none absolute inset-0 z-20 bg-stage-bg transition-opacity', fading ? 'opacity-100 duration-150' : 'opacity-0 duration-300')} />

      {/* Honesty labels and camera controls, above the timeline on large screens. */}
      <div
        className="pointer-events-none absolute inset-x-3 bottom-3 z-30 flex flex-wrap items-end justify-between gap-2 md:inset-x-4 lg:bottom-[100px]"
        style={sideInset ? { left: sideInset + 4, right: sideInset + 4 } : undefined}
      >
        <p className="hud-label w-full text-[9.5px] leading-4 text-foreground/70 sm:w-auto sm:max-w-[60%]">
          {honesty} · time ×{speed}
          {fine && shown !== 'map' ? ' · drag to look around' : ''}
        </p>
        {shown !== 'map' ? (
          <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-1" role="group" aria-label="Camera">
            {modes.map((m) => (
              <button
                key={m.id}
                type="button"
                disabled={m.disabled}
                onClick={() => setCameraMode(m.id)}
                aria-pressed={cameraMode === m.id}
                aria-label={`${m.label} camera`}
                className={cn(
                  'hud-panel inline-grid size-10 place-items-center rounded-[4px] text-foreground/80 transition-colors hover:text-foreground disabled:opacity-35 [&_svg]:size-4',
                  cameraMode === m.id && 'border-signal/70 text-signal',
                )}
              >
                <m.icon aria-hidden />
              </button>
            ))}
            <span className="mx-1 h-6 w-px bg-hud-line" aria-hidden />
            <button type="button" onClick={() => zoomBy(1.25)} aria-label="Zoom in" className="hud-panel inline-grid size-10 place-items-center rounded-[4px] text-foreground/80 hover:text-foreground [&_svg]:size-4">
              <ZoomIn aria-hidden />
            </button>
            <button type="button" onClick={() => zoomBy(0.8)} aria-label="Zoom out" className="hud-panel inline-grid size-10 place-items-center rounded-[4px] text-foreground/80 hover:text-foreground [&_svg]:size-4">
              <ZoomOut aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => {
                look.current = { yaw: 0, pitch: 0, reset: look.current.reset + 1 }
                resetCamera()
              }}
              aria-label="Reset the camera"
              className="hud-panel inline-grid size-10 place-items-center rounded-[4px] text-foreground/80 hover:text-foreground [&_svg]:size-4"
            >
              <RotateCcw aria-hidden />
            </button>
          </div>
        ) : (
          <div className="hud-panel pointer-events-auto flex items-end gap-2 rounded-[4px] p-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="sb-cov" className="hud-label">
                Coverage
              </Label>
              <Select value={coverage ?? 'none'} onValueChange={(v) => setCoverage(v === 'none' ? null : (v as SystemId))}>
                <SelectTrigger id="sb-cov" className="h-10 w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {COVERAGE_CHOICES.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.short}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {coverage && (
              <div className="flex flex-col gap-1">
                <Label htmlFor="sb-cov-alt" className="hud-label">
                  At
                </Label>
                <Select value={String(coverageAlt)} onValueChange={(v) => setCoverageAlt(Number(v))}>
                  <SelectTrigger id="sb-cov-alt" className="h-10 w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5000">5,000 ft</SelectItem>
                    <SelectItem value="10000">10,000 ft</SelectItem>
                    <SelectItem value="35000">FL350</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
