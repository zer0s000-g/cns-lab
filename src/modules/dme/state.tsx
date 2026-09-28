import { createContext, useContext, useState, type ReactNode } from 'react'
import { createStore, useStore, type StoreApi } from 'zustand'
import { useSimClock, type SimClock } from '@/hooks/useSimClock'
import { DEFAULT_ENV, DmeEngine, type DmeEnv } from './engine'

export interface ReplayState {
  phase: 'idle' | 'replay'
  /** Whether the world clock was running before the replay froze it. */
  resume?: boolean
}

export interface DmeState {
  env: DmeEnv
  mapRangeNm: number
  showShadow: boolean
  identSound: boolean
  revealOwn: boolean
  replay: ReplayState
  /** Incremented to ask the slow-motion view to fire a question (from "Try this"). */
  replayRequest: number
  requestReplay: () => void
  setEnv: <K extends keyof DmeEnv>(k: K, v: DmeEnv[K]) => void
  setMapRange: (v: number) => void
  setShowShadow: (v: boolean) => void
  setIdentSound: (v: boolean) => void
  setRevealOwn: (v: boolean) => void
  setReplay: (r: ReplayState) => void
  resetAll: () => void
}

export function createDmeStore(engine: DmeEngine) {
  return createStore<DmeState>()((set, get) => ({
    env: { ...DEFAULT_ENV },
    mapRangeNm: 50,
    showShadow: false,
    identSound: true,
    revealOwn: false,
    replay: { phase: 'idle' },
    replayRequest: 0,
    requestReplay: () => set({ replayRequest: get().replayRequest + 1 }),
    setEnv: (k, v) => {
      const env = { ...get().env, [k]: v }
      engine.setEnv(env)
      set({ env: { ...engine.env } })
    },
    setMapRange: (mapRangeNm) => set({ mapRangeNm }),
    setShowShadow: (showShadow) => set({ showShadow }),
    setIdentSound: (identSound) => set({ identSound }),
    setRevealOwn: (revealOwn) => set({ revealOwn }),
    setReplay: (replay) => set({ replay }),
    resetAll: () => {
      engine.reset()
      set({ env: { ...engine.env }, mapRangeNm: 50, showShadow: false, replay: { phase: 'idle' } })
    },
  }))
}

interface DmeContextValue {
  engine: DmeEngine
  clock: SimClock
  store: StoreApi<DmeState>
}

const Ctx = createContext<DmeContextValue | null>(null)

export function DmeProvider({ children }: { children: ReactNode }) {
  const clock = useSimClock()
  const [value] = useState(() => {
    const engine = new DmeEngine()
    return { engine, clock, store: createDmeStore(engine) }
  })
  return <Ctx.Provider value={{ ...value, clock }}>{children}</Ctx.Provider>
}

export function useDme() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useDme must be used inside DmeProvider')
  return v
}

export function useDmeState<T>(selector: (s: DmeState) => T): T {
  return useStore(useDme().store, selector)
}
