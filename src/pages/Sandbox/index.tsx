/**
 * Airspace Sandbox: one interactive page following CNS700 from the gate,
 * through take-off, a flight out over the ocean and back, to landing and the
 * gate again. The view follows the controller who owns the flight (airport,
 * terminal area, region map); panels explain what is happening, who is
 * talking, which systems are at work, and let the learner break things.
 */
import { useEffect, useRef, useState } from 'react'
import { useSimulationLoop } from '@/hooks/useSimClock'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useReducedMotion } from '@/stores/prefs'
import { cn } from '@/lib/utils'
import { PHASE_LABEL } from './journey'
import { getJourneyIndex } from './phases'
import { STOP_STORY, STORY } from './narration'
import { SandboxProvider, useSandbox, useSandboxState, type PanelTab } from './state'
import { driveFrame } from './drive'
import { JourneyViewport } from './JourneyViewport'
import { ControlsStrip, TopBar } from './cockpit/TopBar'
import { FlightCard, NowCard } from './cockpit/FlightPanels'
import { RadioLog } from './cockpit/RadioLog'
import { SystemsPanel } from './cockpit/SystemsPanel'
import { BreakPanel } from './cockpit/BreakPanel'
import { ScopeInset } from './cockpit/ScopeInset'
import { JourneyTimeline } from './cockpit/JourneyTimeline'
import { StopCard } from './cockpit/StopCard'
import { Debrief } from './cockpit/Debrief'
import { usePhase } from './cockpit/useJourney'

/** One simulation loop for the whole page: auto time-lapse, the engine step, guided stops, the end of the journey. */
function useJourneyDriver() {
  const { engine, clock, store } = useSandbox()
  // Build the journey index when the browser is idle (the timeline and jumps use it).
  useEffect(() => {
    // Safari has no requestIdleCallback.
    const ric = (window as { requestIdleCallback?: Window['requestIdleCallback'] }).requestIdleCallback
    if (ric) {
      const id = ric(() => getJourneyIndex(), { timeout: 2000 })
      return () => window.cancelIdleCallback(id)
    }
    const id = window.setTimeout(() => getJourneyIndex(), 300)
    return () => window.clearTimeout(id)
  }, [])
  useSimulationLoop(clock, (dt) => driveFrame({ engine, clock, store }, dt))
}

/** Screen-reader announcements: phase changes and guided stops only (never the fast-moving numbers). */
function Announcer() {
  const phase = usePhase()
  const stop = useSandboxState((s) => s.activeStop)
  const [msg, setMsg] = useState('')
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    setMsg(`${PHASE_LABEL[phase]}. ${STORY[phase].summary}`)
  }, [phase])
  useEffect(() => {
    if (stop && STOP_STORY[stop]) setMsg(`Paused: ${STOP_STORY[stop]!.title}. Press Continue to go on.`)
  }, [stop])
  return (
    <p className="sr-only" aria-live="polite" aria-atomic="true">
      {msg}
    </p>
  )
}

const TABS: { id: PanelTab; label: string }[] = [
  { id: 'now', label: 'Now' },
  { id: 'radio', label: 'Radio' },
  { id: 'systems', label: 'Systems' },
  { id: 'break', label: 'Break it' },
]

function MobileTabs() {
  const tab = useSandboxState((s) => s.tab)
  const setTab = useSandboxState((s) => s.setTab)
  return (
    <div role="tablist" aria-label="Panels" className="flex gap-1 md:hidden">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`tab-${t.id}`}
          aria-selected={tab === t.id}
          aria-controls={`panel-${t.id}`}
          onClick={() => setTab(t.id)}
          className={cn(
            'hud-value min-h-10 flex-1 rounded-[4px] border border-hud-line text-[11px] tracking-wider uppercase',
            tab === t.id ? 'border-signal/70 bg-foreground text-background' : 'text-muted-foreground',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

/** A panel group: always shown from 768 px up; below that, only when its tab is selected. */
function TabPanel({ id, children, className }: { id: PanelTab; children: React.ReactNode; className?: string }) {
  const tab = useSandboxState((s) => s.tab)
  return (
    <div id={`panel-${id}`} role="tabpanel" aria-labelledby={`tab-${id}`} className={cn('flex min-h-0 flex-col gap-3', tab !== id && 'max-md:hidden', className)}>
      {children}
    </div>
  )
}

/** Side panel width on large screens, px (narrower below 1440 px so the view keeps room). */
const COL = { lg: 300, wide: 340 }
const EDGE = 16
const GAP = 12

function JourneyPage() {
  useJourneyDriver()
  const phase = usePhase()
  const debrief = useSandboxState((s) => s.debrief)
  const hidden = useSandboxState((s) => s.panelsHidden)
  const setSideInset = useSandboxState((s) => s.setSideInset)
  const lg = useMediaQuery('(min-width: 1024px)')
  const wide = useMediaQuery('(min-width: 1440px)')
  const reduced = useReducedMotion()
  const col = wide ? COL.wide : COL.lg
  const inset = lg && !hidden ? col + EDGE + GAP : 0
  useEffect(() => setSideInset(inset), [inset, setSideInset])
  const openDebrief = () => document.getElementById('debrief')?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
  return (
    <div className="relative" data-phase={phase}>
      <h1 className="sr-only">Airspace Sandbox: the journey of CNS700, gate to gate</h1>
      <Announcer />
      <section aria-label="Journey simulator" className="relative lg:h-[calc(100svh-3.5rem)] lg:min-h-[680px]">
        {/* The view, with the phase line across its top. */}
        <div className="relative h-[56svh] min-h-[340px] md:h-[62svh] lg:absolute lg:inset-0 lg:h-auto lg:min-h-0">
          <JourneyViewport sideInset={inset} />
          <div className="dark pointer-events-none absolute inset-x-3 top-3 z-30 text-foreground md:inset-x-4 lg:right-4 lg:left-4">
            <TopBar />
          </div>
          <div className="dark pointer-events-none absolute inset-x-3 bottom-16 z-40 flex justify-center text-foreground md:bottom-20 lg:bottom-[120px]">
            <StopCard className="w-full max-w-[460px]" />
          </div>
          {debrief && (
            <div className="dark pointer-events-none absolute inset-x-3 top-20 z-40 flex justify-center text-foreground lg:top-24">
              <button type="button" onClick={openDebrief} className="hud-panel hud-value pointer-events-auto min-h-10 rounded-[4px] border-signal/60 px-4 text-[11px] tracking-wider text-signal uppercase">
                Journey complete · read the debrief
              </button>
            </div>
          )}
        </div>

        {/* Journey phases: under the view on small screens, across its foot on large ones. */}
        <div className={cn('px-3 pt-2 text-foreground md:px-4 lg:absolute lg:inset-x-4 lg:bottom-3 lg:z-30 lg:p-0', lg && 'dark')}>
          <JourneyTimeline />
        </div>

        {/* Time-lapse, view and guided stops: under the phases on phones and tablets, in the right column on large screens. */}
        <div className="px-3 pt-3 md:px-4 lg:hidden">
          <div className="hud-panel rounded-md p-3">
            <ControlsStrip className="md:grid md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] md:items-end md:gap-x-4" />
          </div>
        </div>

        {/* Panels: two columns over the view on large screens, a two-column page below it on tablets, tabs on phones. */}
        <div
          className={cn(
            // text-foreground re-reads the colour inside the dark scope (inherited text would keep the page's light-theme colour).
            'flex flex-col gap-3 px-3 pt-3 pb-8 text-foreground md:grid md:grid-cols-2 md:px-4 lg:pointer-events-none lg:absolute lg:inset-x-4 lg:top-[80px] lg:bottom-[100px] lg:z-30 lg:flex lg:flex-row lg:justify-between lg:p-0',
            lg && 'dark',
            lg && hidden && 'lg:hidden',
          )}
        >
          <h2 className="sr-only">Flight, radio, systems and failures</h2>
          <MobileTabs />
          <div className="flex min-h-0 flex-col gap-3 lg:pointer-events-auto lg:overflow-y-auto lg:pr-1 [scrollbar-width:thin]" style={lg ? { width: col } : undefined}>
            <TabPanel id="now" className="shrink-0">
              <FlightCard className="shrink-0" />
              <NowCard className="shrink-0" />
            </TabPanel>
            <TabPanel id="radio" className="lg:min-h-[240px] lg:flex-1">
              <RadioLog className="max-h-[420px] lg:max-h-none lg:min-h-[240px] lg:flex-1" />
            </TabPanel>
          </div>
          <div className="flex min-h-0 flex-col gap-3 lg:pointer-events-auto lg:overflow-y-auto lg:pl-1 [scrollbar-width:thin]" style={lg ? { width: col } : undefined}>
            <div className="hidden shrink-0 lg:block">
              <div className="hud-panel rounded-md p-3">
                <ControlsStrip />
              </div>
            </div>
            <TabPanel id="systems" className="shrink-0">
              <SystemsPanel className="shrink-0" />
              <ScopeInset className="shrink-0" />
            </TabPanel>
            <TabPanel id="break" className="shrink-0">
              <BreakPanel className="shrink-0" />
            </TabPanel>
          </div>
        </div>
      </section>
      {debrief && <Debrief />}
    </div>
  )
}

export default function Sandbox() {
  return (
    <SandboxProvider>
      <JourneyPage />
    </SandboxProvider>
  )
}
