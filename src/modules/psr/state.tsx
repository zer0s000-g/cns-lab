import { createContext, useContext, useState, type ReactNode } from 'react'
import { createStore, useStore, type StoreApi } from 'zustand'
import { DEFAULT_RADAR, type RadarParams } from '@/core/radar'
import { useSimClock, type SimClock } from '@/hooks/useSimClock'
import { DEFAULT_ENV, PsrEngine, type EchoAlongBeam, type PsrEnv } from './engine'

export type PulsePhase = 'idle' | 'armed' | 'replay'

export interface PulseState {
  phase: PulsePhase
  targetId?: string
  azDeg?: number
  echoes?: EchoAlongBeam[]
  /** Signal time elapsed in the replay, µs. */
  tUs?: number
  /** PRF at the moment the pulse was fired. */
  prfHz?: number
  /** Whether the world clock was running before the replay froze it. */
  resume?: boolean
}

export interface PsrState {
  params: RadarParams
  env: PsrEnv
  scopeRangeNm: number
  selectedId: string | null
  showCoverage: boolean
  pulse: PulseState
  setParam: <K extends keyof RadarParams>(k: K, v: RadarParams[K]) => void
  setEnv: <K extends keyof PsrEnv>(k: K, v: PsrEnv[K]) => void
  setScopeRange: (r: number) => void
  select: (id: string | null) => void
  setShowCoverage: (v: boolean) => void
  setPulse: (p: PulseState) => void
  resetAll: () => void
}

export function createPsrStore(engine: PsrEngine) {
  return createStore<PsrState>()((set, get) => ({
    params: { ...DEFAULT_RADAR },
    env: { ...DEFAULT_ENV },
    scopeRangeNm: 60,
    selectedId: 'CNS101',
    showCoverage: false,
    pulse: { phase: 'idle' },
    setParam: (k, v) => {
      const params = { ...get().params, [k]: v }
      engine.params = params
      set({ params })
    },
    setEnv: (k, v) => {
      const env = { ...get().env, [k]: v }
      if (k === 'smallFar') engine.applySmallFar(Boolean(v))
      engine.env = env
      set({ env })
    },
    setScopeRange: (scopeRangeNm) => set({ scopeRangeNm }),
    select: (selectedId) => set({ selectedId }),
    setShowCoverage: (showCoverage) => set({ showCoverage }),
    setPulse: (pulse) => set({ pulse }),
    resetAll: () => {
      engine.params = { ...DEFAULT_RADAR }
      engine.env = { ...DEFAULT_ENV }
      engine.reset()
      set({ params: { ...DEFAULT_RADAR }, env: { ...DEFAULT_ENV }, scopeRangeNm: 60, selectedId: 'CNS101', pulse: { phase: 'idle' } })
    },
  }))
}

interface PsrContextValue {
  engine: PsrEngine
  clock: SimClock
  store: StoreApi<PsrState>
}

const Ctx = createContext<PsrContextValue | null>(null)

export function PsrProvider({ children }: { children: ReactNode }) {
  const clock = useSimClock()
  const [value] = useState(() => {
    const engine = new PsrEngine()
    return { engine, clock, store: createPsrStore(engine) }
  })
  return <Ctx.Provider value={{ ...value, clock }}>{children}</Ctx.Provider>
}

export function usePsr() {
  const v = useContext(Ctx)
  if (!v) throw new Error('usePsr must be used inside PsrProvider')
  return v
}

export function usePsrState<T>(selector: (s: PsrState) => T): T {
  return useStore(usePsr().store, selector)
}
