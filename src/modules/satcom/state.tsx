import { createContext, useContext, useState, type ReactNode } from 'react'
import { createStore, useStore, type StoreApi } from 'zustand'
import { useSimClock, type SimClock } from '@/hooks/useSimClock'
import { DEFAULT_ENV, SatcomEngine, type Constellation, type RouteId, type SatcomEnv, type Service } from './engine'

/** Time-lapse speeds: an ocean crossing takes hours. Always labelled "Sped up" on the globe. */
export const SATCOM_SPEEDS = [1, 10, 60, 240, 960] as const
export const DEFAULT_SPEED = 60

export type GlobeView = 'near' | 'orbit'

export interface SatcomState {
  constellation: Constellation
  routeId: RouteId
  env: SatcomEnv
  service: Service
  view: GlobeView
  follow: boolean
  showFootprints: boolean
  /** Short note shown after an action changed the clock for the learner. */
  note: string | null
  setConstellation: (c: Constellation) => void
  setRoute: (r: RouteId) => void
  setEnv: <K extends keyof SatcomEnv>(k: K, v: SatcomEnv[K]) => void
  setService: (s: Service) => void
  setView: (v: GlobeView) => void
  setFollow: (v: boolean) => void
  setShowFootprints: (v: boolean) => void
  setDistance: (nm: number) => void
  send: () => void
  cancelPending: () => void
  resetAll: () => void
}

export function createSatcomStore(engine: SatcomEngine, clock: SimClock) {
  /** Stop a replay that is in progress (the world was frozen for it) and give the clock back. */
  const abortReplay = () => {
    const r = engine.replay
    if (r && !r.done) {
      engine.replay = null
      if (r.frozen && r.resume) clock.getState().play()
    }
  }
  return createStore<SatcomState>()((set, get) => ({
    constellation: engine.constellation,
    routeId: engine.routeId,
    env: { ...engine.env },
    service: engine.service,
    view: 'orbit',
    follow: true,
    showFootprints: true,
    note: null,
    setConstellation: (constellation) => {
      abortReplay()
      engine.setConstellation(constellation)
      set({ constellation, view: constellation === 'geo' ? 'orbit' : 'near' })
    },
    setRoute: (routeId) => {
      abortReplay()
      engine.setRoute(routeId)
      set({ routeId })
    },
    setEnv: (k, v) => {
      const env = { ...get().env, [k]: v }
      engine.env = env
      let note: string | null = get().note
      if (k === 'steepTurn' && v) {
        // A 45° turn takes about 2.6 minutes: show it in real time.
        clock.getState().setSpeed(1)
        clock.getState().play()
        note = 'Clock set to real time so you can watch the turn.'
      }
      set({ env, note })
    },
    setService: (service) => {
      engine.service = service
      engine.livePath = engine.computePath(service)
      set({ service })
    },
    setView: (view) => set({ view }),
    setFollow: (follow) => set({ follow }),
    setShowFootprints: (showFootprints) => set({ showFootprints }),
    setDistance: (nm) => {
      abortReplay()
      engine.setDistance(nm)
    },
    send: () => {
      engine.send(get().service)
    },
    cancelPending: () => engine.cancelPending(),
    resetAll: () => {
      abortReplay()
      engine.reset()
      engine.setConstellation('geo')
      engine.setRoute('atlantic')
      engine.service = 'voice'
      clock.getState().setSpeed(DEFAULT_SPEED)
      set({ constellation: 'geo', routeId: 'atlantic', env: { ...DEFAULT_ENV }, service: 'voice', view: 'orbit', follow: true, showFootprints: true, note: null })
    },
  }))
}

interface SatcomContextValue {
  engine: SatcomEngine
  clock: SimClock
  store: StoreApi<SatcomState>
}

const Ctx = createContext<SatcomContextValue | null>(null)

export function SatcomProvider({ children }: { children: ReactNode }) {
  const clock = useSimClock({ speeds: SATCOM_SPEEDS, speed: DEFAULT_SPEED })
  const [value] = useState(() => {
    const engine = new SatcomEngine()
    return { engine, clock, store: createSatcomStore(engine, clock) }
  })
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSatcom() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSatcom must be used inside SatcomProvider')
  return v
}

export function useSatcomState<T>(selector: (s: SatcomState) => T): T {
  return useStore(useSatcom().store, selector)
}
