import { createContext, useContext, useState, type ReactNode } from 'react'
import { createStore, useStore, type StoreApi } from 'zustand'
import { useSimClock, type SimClock } from '@/hooks/useSimClock'
import { DEFAULT_ENV, DEFAULT_FREQ_MHZ, DEFAULT_VARIATION, DvorEngine, type Autopilot, type Preset, type VorEnv } from './engine'

export interface DvorState {
  env: VorEnv
  variationDeg: number
  freqMHz: number
  obsDeg: number
  autopilot: Autopilot
  orbitRadiusNm: number
  mapRangeNm: number
  listening: boolean
  /** The aircraft was set up to fly high over the station (cone of confusion). */
  overfly: boolean
  setEnv: <K extends keyof VorEnv>(k: K, v: VorEnv[K]) => void
  setVariation: (v: number) => void
  setFreq: (mhz: number) => void
  setObs: (deg: number) => void
  setAutopilot: (m: Autopilot) => void
  setOrbitRadius: (r: number) => void
  setMapRange: (nm: number) => void
  setListening: (v: boolean) => void
  place: (p: Preset) => void
  resetAll: () => void
}

export function createDvorStore(engine: DvorEngine) {
  return createStore<DvorState>()((set, get) => ({
    env: { ...DEFAULT_ENV },
    variationDeg: DEFAULT_VARIATION,
    freqMHz: DEFAULT_FREQ_MHZ,
    obsDeg: engine.obsDeg,
    autopilot: 'heading',
    orbitRadiusNm: engine.orbitRadiusNm,
    mapRangeNm: 25,
    listening: false,
    overfly: false,
    setEnv: (k, v) => {
      const env = { ...get().env, [k]: v }
      engine.env = env
      if (k === 'building' || k === 'buildingDistanceM' || k === 'type') engine.errorTrail = []
      engine.update()
      set({ env })
    },
    setVariation: (variationDeg) => {
      engine.variationDeg = variationDeg
      engine.update()
      set({ variationDeg })
    },
    setFreq: (freqMHz) => {
      engine.freqMHz = freqMHz
      engine.errorTrail = []
      engine.update()
      set({ freqMHz })
    },
    setObs: (deg) => {
      engine.setObs(deg)
      set({ obsDeg: engine.obsDeg })
    },
    setAutopilot: (autopilot) => {
      engine.setAutopilot(autopilot)
      set({ autopilot })
    },
    setOrbitRadius: (orbitRadiusNm) => {
      engine.setOrbitRadius(orbitRadiusNm)
      set({ orbitRadiusNm })
    },
    setMapRange: (mapRangeNm) => set({ mapRangeNm }),
    setListening: (listening) => set({ listening }),
    place: (p) => {
      engine.place(p)
      set({ autopilot: engine.autopilot, obsDeg: engine.obsDeg, orbitRadiusNm: engine.orbitRadiusNm, overfly: p === 'overfly' })
    },
    resetAll: () => {
      engine.reset()
      set({
        env: { ...DEFAULT_ENV },
        variationDeg: DEFAULT_VARIATION,
        freqMHz: DEFAULT_FREQ_MHZ,
        obsDeg: engine.obsDeg,
        autopilot: 'heading',
        orbitRadiusNm: engine.orbitRadiusNm,
        mapRangeNm: 25,
        overfly: false,
      })
    },
  }))
}

interface DvorContextValue {
  engine: DvorEngine
  clock: SimClock
  store: StoreApi<DvorState>
}

const Ctx = createContext<DvorContextValue | null>(null)

export function DvorProvider({ children }: { children: ReactNode }) {
  const clock = useSimClock()
  const [value] = useState(() => {
    const engine = new DvorEngine()
    return { engine, clock, store: createDvorStore(engine) }
  })
  return <Ctx.Provider value={{ ...value, clock }}>{children}</Ctx.Provider>
}

export function useDvor() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useDvor must be used inside DvorProvider')
  return v
}

export function useDvorState<T>(selector: (s: DvorState) => T): T {
  return useStore(useDvor().store, selector)
}
