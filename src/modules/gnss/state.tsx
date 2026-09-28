import { createContext, useContext, useState, type ReactNode } from 'react'
import { useStore, type StoreApi } from 'zustand'
import { useSimClock, type SimClock } from '@/hooks/useSimClock'
import { GnssEngine } from './engine'
import { GNSS_SPEEDS, createGnssStore, type GnssState } from './store'

interface GnssContextValue {
  engine: GnssEngine
  clock: SimClock
  store: StoreApi<GnssState>
}

const Ctx = createContext<GnssContextValue | null>(null)

export function GnssProvider({ children }: { children: ReactNode }) {
  const clock = useSimClock({ speeds: GNSS_SPEEDS, speed: 60 })
  const [value] = useState(() => {
    const engine = new GnssEngine()
    return { engine, store: createGnssStore(engine) }
  })
  return <Ctx.Provider value={{ ...value, clock }}>{children}</Ctx.Provider>
}

export function useGnss() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useGnss must be used inside GnssProvider')
  return v
}

export function useGnssState<T>(selector: (s: GnssState) => T): T {
  return useStore(useGnss().store, selector)
}
