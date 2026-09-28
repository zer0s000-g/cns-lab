import { createContext, useContext, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import { createStore, useStore, type StoreApi } from 'zustand'
import { useSimClock, type SimClock } from '@/hooks/useSimClock'
import type { SsrReplay } from './SlowMotion'
import { DEFAULT_SSR_ENV, DEFAULT_SSR_PARAMS, defaultTransponders, SsrEngine, type SsrEnv, type SsrParams, type Transponder } from './engine'

export type ReplayPhase = 'idle' | 'armed' | 'replay'
/** What the slow-motion interrogation asks: identity (Mode A / DF5) or altitude (Mode C / DF4). */
export type ReplayAsk = 'A' | 'C'

export interface ReplayState {
  phase: ReplayPhase
  targetId?: string
  ask: ReplayAsk
  /** Whether the world clock was running before the replay froze it. */
  resume?: boolean
}

export interface SsrState {
  params: SsrParams
  env: SsrEnv
  xpdr: Record<string, Transponder>
  scopeRangeNm: number
  selectedId: string | null
  replay: ReplayState
  setParam: <K extends keyof SsrParams>(k: K, v: SsrParams[K]) => void
  setEnv: <K extends keyof SsrEnv>(k: K, v: SsrEnv[K]) => void
  setXpdr: (id: string, patch: Partial<Transponder>) => void
  pressIdent: (id: string) => void
  setScopeRange: (r: number) => void
  select: (id: string | null) => void
  setReplay: (r: Partial<ReplayState>) => void
  resetAll: () => void
}

export function createSsrStore(engine: SsrEngine) {
  return createStore<SsrState>()((set, get) => ({
    params: { ...DEFAULT_SSR_PARAMS },
    env: { ...DEFAULT_SSR_ENV },
    xpdr: defaultTransponders(),
    scopeRangeNm: 60,
    selectedId: 'CNS101',
    replay: { phase: 'idle', ask: 'A' },
    setParam: (k, v) => {
      const prev = get().params
      const params = { ...prev, [k]: v }
      engine.params = params
      if (k === 'mode' && prev.mode !== v) engine.clearDisplay()
      set({ params })
    },
    setEnv: (k, v) => {
      const env = { ...get().env, [k]: v }
      engine.env = env
      if (k === 'garblePair') engine.applyGarblePair(Boolean(v))
      const selectedId = k === 'garblePair' && !v && get().selectedId === 'CNS606' ? 'CNS303' : get().selectedId
      set({ env, selectedId })
    },
    setXpdr: (id, patch) => {
      const xpdr = { ...get().xpdr, [id]: { ...(get().xpdr[id] ?? { squawk: '2000', on: true, identAtS: null }), ...patch } }
      engine.xpdr = xpdr
      set({ xpdr })
    },
    pressIdent: (id) => get().setXpdr(id, { identAtS: engine.timeS }),
    setScopeRange: (scopeRangeNm) => set({ scopeRangeNm }),
    select: (selectedId) => set({ selectedId }),
    setReplay: (r) => set({ replay: { ...get().replay, ...r } }),
    resetAll: () => {
      const env = { ...DEFAULT_SSR_ENV }
      engine.params = { ...DEFAULT_SSR_PARAMS }
      engine.env = env
      engine.xpdr = defaultTransponders()
      engine.reset()
      set({ params: { ...DEFAULT_SSR_PARAMS }, env, xpdr: engine.xpdr, scopeRangeNm: 60, selectedId: 'CNS101', replay: { phase: 'idle', ask: 'A' } })
    },
  }))
}

interface SsrContextValue {
  engine: SsrEngine
  clock: SimClock
  store: StoreApi<SsrState>
  /** The slow-motion interrogation replay, shared by the 2D slow-motion view and the 3D stage. */
  replayRef: MutableRefObject<SsrReplay | null>
}

const Ctx = createContext<SsrContextValue | null>(null)

export function SsrProvider({ children }: { children: ReactNode }) {
  const clock = useSimClock()
  const replayRef = useRef<SsrReplay | null>(null)
  const [value] = useState(() => {
    const engine = new SsrEngine()
    return { engine, store: createSsrStore(engine) }
  })
  return <Ctx.Provider value={{ ...value, clock, replayRef }}>{children}</Ctx.Provider>
}

export function useSsr() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSsr must be used inside SsrProvider')
  return v
}

export function useSsrState<T>(selector: (s: SsrState) => T): T {
  return useStore(useSsr().store, selector)
}
