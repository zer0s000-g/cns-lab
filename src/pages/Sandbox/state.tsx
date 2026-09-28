import { createContext, useContext, useState, type ReactNode } from 'react'
import { createStore, useStore, type StoreApi } from 'zustand'
import { useSimClock, type SimClock } from '@/hooks/useSimClock'
import { ALL_SYSTEMS_ON, SandboxEngine, type ScenarioId } from './engine'
import type { SystemId } from './systems'

export type ViewId = 'terminal' | 'region' | 'ocean'

export const VIEWS: Record<ViewId, { label: string; center: { x: number; y: number }; rangeNm: number }> = {
  terminal: { label: 'Terminal', center: { x: 0, y: 0 }, rangeNm: 45 },
  region: { label: 'Region', center: { x: 30, y: 0 }, rangeNm: 150 },
  ocean: { label: 'Ocean', center: { x: 190, y: 0 }, rangeNm: 215 },
}

/** Time-lapse steps: the whole journey takes about two hours. */
export const SANDBOX_SPEEDS = [1, 4, 16, 60] as const

export interface SandboxState {
  systems: Record<SystemId, boolean>
  scenario: ScenarioId
  view: ViewId
  followJourney: boolean
  coverage: SystemId | null
  coverageAltFt: number
  selectedId: string | null
  vhfStandby: boolean
  setSystem: (id: SystemId, on: boolean) => void
  setScenario: (id: ScenarioId) => void
  setView: (v: ViewId) => void
  setFollow: (v: boolean) => void
  setCoverage: (id: SystemId | null) => void
  setCoverageAlt: (ft: number) => void
  select: (id: string | null) => void
  selectVhfStandby: () => void
  resetAll: () => void
}

export function createSandboxStore(engine: SandboxEngine) {
  return createStore<SandboxState>()((set) => ({
    systems: { ...ALL_SYSTEMS_ON },
    scenario: 'normal',
    view: 'terminal',
    followJourney: false,
    coverage: null,
    coverageAltFt: 10000,
    selectedId: 'CNS700',
    vhfStandby: false,
    setSystem: (id, on) => {
      engine.systems = { ...engine.systems, [id]: on }
      set({ systems: { ...engine.systems } })
    },
    setScenario: (id) => {
      engine.setScenario(id)
      set({ scenario: id, vhfStandby: false, ...(id === 'mountain' ? { selectedId: 'CNS9M', view: 'terminal' as ViewId, coverage: 'radarApp' as SystemId, coverageAltFt: 5000 } : {}) })
    },
    setView: (view) => set({ view }),
    setFollow: (followJourney) => set({ followJourney }),
    setCoverage: (coverage) => set({ coverage }),
    setCoverageAlt: (coverageAltFt) => set({ coverageAltFt }),
    select: (selectedId) => set({ selectedId }),
    selectVhfStandby: () => {
      engine.selectVhfStandby()
      set({ vhfStandby: engine.vhfStandby })
    },
    resetAll: () => {
      engine.systems = { ...ALL_SYSTEMS_ON }
      engine.scenario = 'normal'
      engine.reset()
      set({ systems: { ...ALL_SYSTEMS_ON }, scenario: 'normal', vhfStandby: false, selectedId: 'CNS700', coverage: null })
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
  const clock = useSimClock({ speeds: SANDBOX_SPEEDS, speed: 16 })
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
