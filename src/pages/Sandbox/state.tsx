import { createContext, useContext, useState, type ReactNode } from 'react'
import { createStore, useStore, type StoreApi } from 'zustand'
import { useSimClock, type SimClock } from '@/hooks/useSimClock'
import { ALL_SYSTEMS_ON, SandboxEngine, type ScenarioId } from './engine'
import { SANDBOX_SPEEDS, type CameraMode, type ViewChoice, type WorldView } from './director'
import type { FlightPhase } from './journey'
import type { JourneyEventKind } from './phases'
import type { SystemId } from './systems'

export type PanelTab = 'now' | 'radio' | 'systems' | 'break'

export interface SandboxState {
  systems: Record<SystemId, boolean>
  scenario: ScenarioId
  vhfStandby: boolean
  /** Track selected on the controller's screen. */
  selectedId: string | null
  /** Coverage drawn on the region map. */
  coverage: SystemId | null
  coverageAltFt: number
  viewChoice: ViewChoice
  /** The view on screen right now (the automatic choice, or the learner's). */
  shownView: WorldView
  cameraMode: CameraMode
  /** Follow-camera zoom (1 = the phase's framing). */
  zoom: number
  /** Bumped to reset a dragged camera to its framing. */
  cameraResetKey: number
  /** Automatic time-lapse, or the speed the learner picked. */
  timeMode: 'auto' | 'manual'
  stopsEnabled: boolean
  /** The guided stop being shown (the clock is paused meanwhile). */
  activeStop: JourneyEventKind | null
  /** The journey is complete: show the debrief. */
  debrief: boolean
  scopeOpen: boolean
  tab: PanelTab
  /** Large screens: panels hidden to see the whole view. */
  panelsHidden: boolean
  /** Width covered by a side panel on each side of the view, px (the camera frames the space between). */
  sideInsetPx: number
  setSystem: (id: SystemId, on: boolean) => void
  setScenario: (id: ScenarioId) => void
  selectVhfStandby: () => void
  select: (id: string | null) => void
  setCoverage: (id: SystemId | null) => void
  setCoverageAlt: (ft: number) => void
  setViewChoice: (v: ViewChoice) => void
  setShownView: (v: WorldView) => void
  setCameraMode: (m: CameraMode) => void
  zoomBy: (k: number) => void
  resetCamera: () => void
  setTimeMode: (m: 'auto' | 'manual') => void
  setStopsEnabled: (on: boolean) => void
  showStop: (k: JourneyEventKind | null) => void
  setDebrief: (on: boolean) => void
  setScopeOpen: (on: boolean) => void
  setTab: (t: PanelTab) => void
  setPanelsHidden: (on: boolean) => void
  setSideInset: (px: number) => void
  jumpTo: (p: FlightPhase) => void
  flyAgain: () => void
  resetAll: () => void
}

export const MIN_ZOOM = 0.35
export const MAX_ZOOM = 3

export function createSandboxStore(engine: SandboxEngine) {
  return createStore<SandboxState>()((set) => ({
    systems: { ...ALL_SYSTEMS_ON },
    scenario: 'normal',
    vhfStandby: false,
    selectedId: 'CNS700',
    coverage: null,
    coverageAltFt: 10000,
    viewChoice: 'auto',
    shownView: 'airport',
    cameraMode: 'follow',
    zoom: 1,
    cameraResetKey: 0,
    timeMode: 'auto',
    stopsEnabled: true,
    activeStop: null,
    debrief: false,
    scopeOpen: true,
    tab: 'now',
    panelsHidden: false,
    sideInsetPx: 0,
    setSystem: (id, on) => {
      engine.systems = { ...engine.systems, [id]: on }
      set({ systems: { ...engine.systems } })
    },
    setScenario: (id) => {
      engine.setScenario(id)
      set({ scenario: id, vhfStandby: false, ...(id === 'mountain' ? { selectedId: 'CNS9M' } : {}) })
    },
    selectVhfStandby: () => {
      engine.selectVhfStandby()
      set({ vhfStandby: engine.vhfStandby })
    },
    select: (selectedId) => set({ selectedId }),
    setCoverage: (coverage) => set({ coverage }),
    setCoverageAlt: (coverageAltFt) => set({ coverageAltFt }),
    setViewChoice: (viewChoice) => set({ viewChoice }),
    setShownView: (shownView) => set({ shownView }),
    setCameraMode: (cameraMode) => set((s) => ({ cameraMode, cameraResetKey: s.cameraResetKey + 1 })),
    zoomBy: (k) => set((s) => ({ zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, s.zoom * k)) })),
    resetCamera: () => set((s) => ({ zoom: 1, cameraResetKey: s.cameraResetKey + 1 })),
    setTimeMode: (timeMode) => set({ timeMode }),
    setStopsEnabled: (stopsEnabled) => set({ stopsEnabled }),
    showStop: (activeStop) => set({ activeStop }),
    setDebrief: (debrief) => set({ debrief }),
    setScopeOpen: (scopeOpen) => set({ scopeOpen }),
    setTab: (tab) => set({ tab }),
    setPanelsHidden: (panelsHidden) => set({ panelsHidden }),
    setSideInset: (sideInsetPx) => set({ sideInsetPx }),
    jumpTo: (p) => {
      engine.jumpToPhase(p)
      set({ activeStop: null, debrief: false, selectedId: 'CNS700' })
    },
    flyAgain: () => {
      engine.restartJourney()
      set({ activeStop: null, debrief: false, selectedId: 'CNS700' })
    },
    resetAll: () => {
      engine.systems = { ...ALL_SYSTEMS_ON }
      engine.scenario = 'normal'
      engine.reset()
      set({ systems: { ...ALL_SYSTEMS_ON }, scenario: 'normal', vhfStandby: false, selectedId: 'CNS700', coverage: null, activeStop: null, debrief: false })
    },
  }))
}

interface Ctx {
  engine: SandboxEngine
  clock: SimClock
  store: StoreApi<SandboxState>
}

const SandboxCtx = createContext<Ctx | null>(null)

export function SandboxProvider({ children }: { children: ReactNode }) {
  const clock = useSimClock({ speeds: SANDBOX_SPEEDS, speed: 8 })
  const [value] = useState(() => {
    const engine = new SandboxEngine()
    return { engine, store: createSandboxStore(engine) }
  })
  return <SandboxCtx.Provider value={{ ...value, clock }}>{children}</SandboxCtx.Provider>
}

export function useSandbox() {
  const v = useContext(SandboxCtx)
  if (!v) throw new Error('useSandbox must be used inside SandboxProvider')
  return v
}

export function useSandboxState<T>(selector: (s: SandboxState) => T): T {
  return useStore(useSandbox().store, selector)
}
