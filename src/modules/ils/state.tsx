import { createContext, useContext, useState, type ReactNode } from 'react'
import { createStore, useStore, type StoreApi } from 'zustand'
import { useSimClock, type SimClock } from '@/hooks/useSimClock'
import { IlsEngine, type IlsFailures, type Weather } from './engine'

export type ViewMode = 'cockpit' | 'outside'

export interface IlsState {
  weather: Weather
  thickFog: boolean
  guidance: boolean
  failures: IlsFailures
  view: ViewMode
  showPath: boolean
  markerSound: boolean
  identSound: boolean
  setWeather: (w: Weather) => void
  setThickFog: (v: boolean) => void
  setGuidance: (v: boolean) => void
  setFailure: <K extends keyof IlsFailures>(k: K, v: boolean) => void
  setView: (v: ViewMode) => void
  setShowPath: (v: boolean) => void
  setMarkerSound: (v: boolean) => void
  setIdentSound: (v: boolean) => void
  /** The learner steers: guidance switches off. */
  steer: (deltaDeg: number) => void
  setTargetHeading: (deg: number) => void
  setSelectedVs: (fpm: number) => void
  nudgeVs: (deltaFpm: number) => void
  resetApproach: (distNm?: number) => void
  resetAll: () => void
}

export function createIlsStore(engine: IlsEngine) {
  const takeControl = (set: (p: Partial<IlsState>) => void) => {
    engine.guidance = false
    set({ guidance: false })
  }
  return createStore<IlsState>()((set, get) => ({
    weather: engine.weather,
    thickFog: false,
    guidance: true,
    failures: { ...engine.failures },
    view: 'cockpit',
    showPath: true,
    markerSound: true,
    identSound: false,
    setWeather: (weather) => {
      engine.weather = weather
      const thickFog = weather === 'clear' ? false : get().thickFog
      engine.thickFog = thickFog
      set({ weather, thickFog })
    },
    setThickFog: (thickFog) => {
      engine.thickFog = thickFog
      set({ thickFog })
    },
    setGuidance: (guidance) => {
      engine.guidance = guidance
      set({ guidance })
    },
    setFailure: (k, v) => {
      const failures = { ...get().failures, [k]: v }
      engine.setFailures(failures)
      set({ failures })
    },
    setView: (view) => set({ view }),
    setShowPath: (showPath) => set({ showPath }),
    setMarkerSound: (markerSound) => set({ markerSound }),
    setIdentSound: (identSound) => set({ identSound }),
    steer: (d) => {
      takeControl(set)
      engine.steer(d)
    },
    setTargetHeading: (deg) => {
      takeControl(set)
      engine.setTargetHeading(deg)
    },
    setSelectedVs: (fpm) => {
      takeControl(set)
      engine.setSelectedVs(fpm)
    },
    nudgeVs: (d) => {
      takeControl(set)
      engine.setSelectedVs(Math.round((engine.pilot.selectedVsFpm + d) / 100) * 100)
    },
    resetApproach: (distNm = 10) => {
      engine.resetApproach(distNm)
      engine.guidance = true
      set({ guidance: true })
    },
    resetAll: () => {
      engine.weather = 'clear'
      engine.thickFog = false
      engine.setFailures({ truck: false, locFault: false })
      engine.resetTime()
      engine.resetApproach(10)
      engine.guidance = true
      set({ weather: 'clear', thickFog: false, guidance: true, failures: { truck: false, locFault: false }, view: 'cockpit', showPath: true })
    },
  }))
}

interface IlsContextValue {
  engine: IlsEngine
  clock: SimClock
  store: StoreApi<IlsState>
}

const Ctx = createContext<IlsContextValue | null>(null)

export function IlsProvider({ children }: { children: ReactNode }) {
  const clock = useSimClock()
  const [value] = useState(() => {
    const engine = new IlsEngine()
    return { engine, clock, store: createIlsStore(engine) }
  })
  return <Ctx.Provider value={{ ...value, clock }}>{children}</Ctx.Provider>
}

export function useIls() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useIls must be used inside IlsProvider')
  return v
}

export function useIlsState<T>(selector: (s: IlsState) => T): T {
  return useStore(useIls().store, selector)
}
