import { createContext, useContext, useState, type ReactNode } from 'react'
import { createStore, useStore, type StoreApi } from 'zustand'
import { useSimClock, type SimClock } from '@/hooks/useSimClock'
import { DEFAULT_FAILURES, DEFAULT_PARAMS, HfEngine, type AircraftId, type HfFailures, type HfParams } from './engine'

export interface HfState {
  params: HfParams
  failures: HfFailures
  selcalTarget: AircraftId
  setParam: <K extends keyof HfParams>(k: K, v: HfParams[K]) => void
  setFailure: <K extends keyof HfFailures>(k: K, v: HfFailures[K]) => void
  setSelcalTarget: (id: AircraftId) => void
  /** Copy engine-side changes (the time-lapse moves the hour) into the store. */
  sync: () => void
  resetAll: () => void
}

export function createHfStore(engine: HfEngine) {
  return createStore<HfState>()((set, get) => ({
    params: engine.params,
    failures: engine.failures,
    selcalTarget: 'CNS101',
    setParam: (k, v) => {
      const params = { ...engine.params, [k]: v }
      engine.params = params
      set({ params })
    },
    setFailure: (k, v) => {
      const failures = { ...engine.failures, [k]: v }
      engine.failures = failures
      set({ failures })
    },
    setSelcalTarget: (selcalTarget) => set({ selcalTarget }),
    sync: () => {
      const a = get().params
      const b = engine.params
      if (a === b) return
      // During a time-lapse only the hour moves: re-render a few times per simulated hour, not every frame.
      const onlyHour = a.channelIndex === b.channelIndex && a.distanceNm === b.distanceNm && a.timelapse === b.timelapse && a.listen === b.listen
      if (onlyHour && Math.abs(a.hour - b.hour) < 0.05) return
      set({ params: b })
    },
    resetAll: () => {
      engine.params = { ...DEFAULT_PARAMS }
      engine.failures = { ...DEFAULT_FAILURES }
      engine.reset()
      set({ params: engine.params, failures: engine.failures, selcalTarget: 'CNS101' })
    },
  }))
}

interface HfContextValue {
  engine: HfEngine
  clock: SimClock
  store: StoreApi<HfState>
}

const Ctx = createContext<HfContextValue | null>(null)

/**
 * SELCAL tones and voices play in real time, so the clock only plays or pauses.
 * The time of day has its own, labelled time-lapse.
 */
const REAL_TIME_ONLY = [1] as const

export function HfProvider({ children }: { children: ReactNode }) {
  const clock = useSimClock({ speeds: REAL_TIME_ONLY })
  const [value] = useState(() => {
    const engine = new HfEngine()
    return { engine, store: createHfStore(engine) }
  })
  return <Ctx.Provider value={{ ...value, clock }}>{children}</Ctx.Provider>
}

export function useHf() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useHf must be used inside HfProvider')
  return v
}

export function useHfState<T>(selector: (s: HfState) => T): T {
  return useStore(useHf().store, selector)
}
