import { createContext, useContext, useState, type ReactNode } from 'react'
import { createStore, useStore, type StoreApi } from 'zustand'
import { useSimClock, type SimClock } from '@/hooks/useSimClock'
import { DEFAULT_FAILURES, DEFAULT_PARAMS, DEFAULT_VCCS, VhfEngine, clearOfTerrain, type VhfFailures, type VhfParams, type Vccs } from './engine'

export type ListenAt = 'cockpit' | 'controller'

export interface VhfState {
  params: VhfParams
  failures: VhfFailures
  vccs: Vccs
  listenAt: ListenAt
  setParam: <K extends keyof VhfParams>(k: K, v: VhfParams[K]) => void
  setFailure: <K extends keyof VhfFailures>(k: K, v: VhfFailures[K]) => void
  setVccs: (v: Vccs) => void
  setListenAt: (v: ListenAt) => void
  /** Copy engine-side changes (the controller retuned things) into the store. */
  sync: () => void
  resetAll: () => void
}

export function createVhfStore(engine: VhfEngine) {
  return createStore<VhfState>()((set, get) => ({
    params: engine.params,
    failures: { ...engine.failures },
    vccs: engine.vccs,
    listenAt: 'cockpit',
    setParam: (k, v) => {
      // The engine may have retuned things itself (e.g. back to 128.600), so start from its copy.
      const params = clearOfTerrain({ ...engine.params, [k]: v }, engine.failures.mountain)
      engine.params = params
      set({ params })
    },
    setFailure: (k, v) => {
      engine.setFailure(k, v)
      set({ failures: { ...engine.failures }, params: engine.params, vccs: engine.vccs })
    },
    setVccs: (vccs) => {
      engine.setVccs(vccs)
      set({ vccs })
    },
    setListenAt: (listenAt) => set({ listenAt }),
    sync: () => {
      const s = get()
      if (s.vccs !== engine.vccs || s.params !== engine.params) set({ vccs: engine.vccs, params: engine.params })
    },
    resetAll: () => {
      engine.params = { ...DEFAULT_PARAMS }
      engine.failures = { ...DEFAULT_FAILURES }
      engine.vccs = { ...DEFAULT_VCCS, rx: { ...DEFAULT_VCCS.rx }, tx: { ...DEFAULT_VCCS.tx } }
      engine.reset()
      set({ params: engine.params, failures: { ...engine.failures }, vccs: engine.vccs, listenAt: 'cockpit' })
    },
  }))
}

interface VhfContextValue {
  engine: VhfEngine
  clock: SimClock
  store: StoreApi<VhfState>
}

const Ctx = createContext<VhfContextValue | null>(null)

/** Radio traffic runs in real time (speech cannot be sped up), so the clock only plays or pauses. */
const REAL_TIME_ONLY = [1] as const

export function VhfProvider({ children }: { children: ReactNode }) {
  const clock = useSimClock({ speeds: REAL_TIME_ONLY })
  const [value] = useState(() => {
    const engine = new VhfEngine()
    return { engine, store: createVhfStore(engine) }
  })
  return <Ctx.Provider value={{ ...value, clock }}>{children}</Ctx.Provider>
}

export function useVhf() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useVhf must be used inside VhfProvider')
  return v
}

export function useVhfState<T>(selector: (s: VhfState) => T): T {
  return useStore(useVhf().store, selector)
}
