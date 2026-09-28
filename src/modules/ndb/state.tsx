import { createContext, useContext, useState, type ReactNode } from 'react'
import { createStore, useStore, type StoreApi } from 'zustand'
import { useSimClock, type SimClock } from '@/hooks/useSimClock'
import { DEFAULT_ENV, DEFAULT_STATION, DEFAULT_VARIATION, NdbEngine, type Autopilot, type NdbEnv, type Preset } from './engine'

export interface NdbState {
  env: NdbEnv
  variationDeg: number
  autopilot: Autopilot
  orbitRadiusNm: number
  freqKhz: number
  ratedCoverageNm: number
  mapRangeNm: number
  /** Morse ident audio playing. */
  listening: boolean
  setEnv: <K extends keyof NdbEnv>(k: K, v: NdbEnv[K]) => void
  setVariation: (v: number) => void
  setAutopilot: (m: Autopilot) => void
  setOrbitRadius: (r: number) => void
  setFreq: (khz: number) => void
  setCoverage: (nm: number) => void
  setMapRange: (nm: number) => void
  setListening: (v: boolean) => void
  place: (p: Preset) => void
  resetAll: () => void
}

export function createNdbStore(engine: NdbEngine) {
  return createStore<NdbState>()((set, get) => ({
    env: { ...DEFAULT_ENV },
    variationDeg: DEFAULT_VARIATION,
    autopilot: 'heading',
    orbitRadiusNm: 5,
    freqKhz: DEFAULT_STATION.freqKhz,
    ratedCoverageNm: DEFAULT_STATION.ratedCoverageNm,
    mapRangeNm: 50,
    listening: false,
    setEnv: (k, v) => {
      const env = { ...get().env, [k]: v }
      if (k === 'storm' && v && !engine.stormIsNear()) engine.placeStormNearAircraft()
      if (k === 'storm' && !v) engine.flashes = []
      engine.env = env
      engine.update()
      set({ env })
    },
    setVariation: (variationDeg) => {
      engine.variationDeg = variationDeg
      engine.update()
      set({ variationDeg })
    },
    setAutopilot: (autopilot) => {
      engine.setAutopilot(autopilot)
      set({ autopilot })
    },
    setOrbitRadius: (orbitRadiusNm) => {
      engine.setOrbitRadius(orbitRadiusNm)
      set({ orbitRadiusNm })
    },
    setFreq: (freqKhz) => {
      engine.station = { ...engine.station, freqKhz }
      engine.update()
      set({ freqKhz })
    },
    setCoverage: (ratedCoverageNm) => {
      engine.station = { ...engine.station, ratedCoverageNm }
      engine.update()
      set({ ratedCoverageNm })
    },
    setMapRange: (mapRangeNm) => set({ mapRangeNm }),
    setListening: (listening) => set({ listening }),
    place: (p) => {
      engine.place(p)
      set({ autopilot: engine.autopilot })
    },
    resetAll: () => {
      engine.reset()
      set({
        env: { ...DEFAULT_ENV },
        variationDeg: DEFAULT_VARIATION,
        autopilot: 'heading',
        orbitRadiusNm: 5,
        freqKhz: DEFAULT_STATION.freqKhz,
        ratedCoverageNm: DEFAULT_STATION.ratedCoverageNm,
        mapRangeNm: 50,
      })
    },
  }))
}

interface NdbContextValue {
  engine: NdbEngine
  clock: SimClock
  store: StoreApi<NdbState>
}

const Ctx = createContext<NdbContextValue | null>(null)

export function NdbProvider({ children }: { children: ReactNode }) {
  const clock = useSimClock()
  const [value] = useState(() => {
    const engine = new NdbEngine()
    return { engine, clock, store: createNdbStore(engine) }
  })
  return <Ctx.Provider value={{ ...value, clock }}>{children}</Ctx.Provider>
}

export function useNdb() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useNdb must be used inside NdbProvider')
  return v
}

export function useNdbState<T>(selector: (s: NdbState) => T): T {
  return useStore(useNdb().store, selector)
}
