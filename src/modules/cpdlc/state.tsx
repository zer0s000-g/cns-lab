import { createContext, useContext, useState, type ReactNode } from 'react'
import { createStore, useStore, type StoreApi } from 'zustand'
import type { DataLinkPath, RcpType } from '@/core/cpdlc'
import { useSimClock, type SimClock } from '@/hooks/useSimClock'
import { CpdlcEngine, DEFAULT_ENV, type CpdlcEnv, type Standard } from './engine'

/** Messages take seconds to minutes (and RCP timers run to 240 s), so faster speeds are offered. Labelled "Sped up". */
export const CPDLC_SPEEDS = [1, 2, 4, 8, 16] as const

export interface CpdlcState {
  standard: Standard
  path: DataLinkPath
  rcp: RcpType
  env: CpdlcEnv
  challengeN: number
  /** Bumped after actions that change what the panels show immediately. */
  version: number
  setStandard: (s: Standard) => void
  setPath: (p: DataLinkPath) => void
  setRcp: (r: RcpType) => void
  setEnv: <K extends keyof CpdlcEnv>(k: K, v: CpdlcEnv[K]) => void
  setChallengeN: (n: number) => void
  touch: () => void
  resetAll: () => void
}

export function createCpdlcStore(engine: CpdlcEngine) {
  return createStore<CpdlcState>()((set, get) => ({
    standard: engine.standard,
    path: engine.path,
    rcp: engine.rcp,
    env: { ...engine.env },
    challengeN: 10,
    version: 0,
    setStandard: (standard) => {
      engine.setStandard(standard)
      set({ standard, path: engine.path, env: { ...engine.env }, version: get().version + 1 })
    },
    setPath: (p) => {
      engine.setPath(p)
      set({ path: engine.path })
    },
    setRcp: (rcp) => {
      engine.rcp = rcp
      set({ rcp })
    },
    setEnv: (k, v) => {
      engine.setEnv(k, v)
      set({ env: { ...engine.env }, version: get().version + 1 })
    },
    setChallengeN: (challengeN) => set({ challengeN }),
    touch: () => set({ version: get().version + 1 }),
    resetAll: () => {
      engine.reset()
      set({ path: engine.path, env: { ...DEFAULT_ENV }, version: get().version + 1 })
    },
  }))
}

interface CpdlcContextValue {
  engine: CpdlcEngine
  clock: SimClock
  store: StoreApi<CpdlcState>
}

const Ctx = createContext<CpdlcContextValue | null>(null)

export function CpdlcProvider({ children }: { children: ReactNode }) {
  const clock = useSimClock({ speeds: CPDLC_SPEEDS, speed: 1 })
  const [value] = useState(() => {
    const engine = new CpdlcEngine()
    return { engine, clock, store: createCpdlcStore(engine) }
  })
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useCpdlc() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useCpdlc must be used inside CpdlcProvider')
  return v
}

export function useCpdlcState<T>(selector: (s: CpdlcState) => T): T {
  return useStore(useCpdlc().store, selector)
}
