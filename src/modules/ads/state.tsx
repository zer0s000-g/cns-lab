import { createContext, useContext, useState, type ReactNode } from 'react'
import { createStore, useStore, type StoreApi } from 'zustand'
import { useSimClock, type SimClock } from '@/hooks/useSimClock'
import { AdsbEngine, DEFAULT_ADS_ENV, type AdsEnv } from './engine'
import { AdscEngine, CLEARED_FL, DEFAULT_CONTRACT, type ContractSettings } from './oceanEngine'

export type Scenario = 'airport' | 'ocean'
export type AtcShow = 'both' | 'radar' | 'adsb'
export type CdtiUp = 'track' | 'north'

/** Clock speeds for the ocean crossing (time-lapse, labelled "Sped up"). */
export const OCEAN_SPEEDS = [1, 10, 30, 60] as const

export interface AdsState {
  scenario: Scenario
  env: AdsEnv
  radarPeriodS: number
  selectedId: string | null
  mapRangeNm: number
  atcShow: AtcShow
  crossCheck: boolean
  compareZoomNm: number
  adsbIn: boolean
  cdtiUp: CdtiUp
  cdtiRangeNm: number
  contract: ContractSettings
  spaceAdsb: boolean
  offsetRight: boolean
  oceanFl: number
  setScenario: (s: Scenario) => void
  setEnv: <K extends keyof AdsEnv>(k: K, v: AdsEnv[K]) => void
  setRadarPeriod: (s: number) => void
  select: (id: string | null) => void
  set: (patch: Partial<Pick<AdsState, 'mapRangeNm' | 'atcShow' | 'crossCheck' | 'compareZoomNm' | 'adsbIn' | 'cdtiUp' | 'cdtiRangeNm'>>) => void
  setContract: (patch: Partial<ContractSettings>) => void
  setSpaceAdsb: (v: boolean) => void
  setOffset: (v: boolean) => void
  setOceanFl: (fl: number) => void
  restartCrossing: () => void
  resetAirport: () => void
}

export function createAdsStore(engine: AdsbEngine, ocean: AdscEngine) {
  return createStore<AdsState>()((set, get) => ({
    scenario: 'airport',
    env: { ...DEFAULT_ADS_ENV },
    radarPeriodS: 4.8,
    selectedId: 'CNS101',
    mapRangeNm: 60,
    atcShow: 'both',
    crossCheck: false,
    compareZoomNm: 5,
    adsbIn: true,
    cdtiUp: 'track',
    cdtiRangeNm: 40,
    contract: { ...DEFAULT_CONTRACT },
    spaceAdsb: false,
    offsetRight: false,
    oceanFl: CLEARED_FL,
    setScenario: (scenario) => set({ scenario }),
    setEnv: (k, v) => {
      const env = { ...get().env, [k]: v }
      engine.env = env
      set({ env })
    },
    setRadarPeriod: (radarPeriodS) => {
      engine.radarPeriodS = radarPeriodS
      set({ radarPeriodS })
    },
    select: (selectedId) => {
      engine.ownId = selectedId
      set({ selectedId })
    },
    set: (patch) => set(patch),
    setContract: (patch) => {
      const contract = { ...get().contract, ...patch }
      ocean.opts = { ...ocean.opts, contract }
      set({ contract })
    },
    setSpaceAdsb: (spaceAdsb) => {
      ocean.opts = { ...ocean.opts, spaceAdsb }
      set({ spaceAdsb })
    },
    setOffset: (offsetRight) => {
      ocean.applyOffset(offsetRight)
      set({ offsetRight })
    },
    setOceanFl: (oceanFl) => {
      ocean.setTargetAltitude(oceanFl * 100)
      set({ oceanFl })
    },
    restartCrossing: () => {
      ocean.reset()
      ocean.setTargetAltitude(CLEARED_FL * 100)
      set({ oceanFl: CLEARED_FL })
    },
    resetAirport: () => {
      const env = { ...DEFAULT_ADS_ENV }
      engine.env = env
      engine.radarPeriodS = 4.8
      engine.reset()
      engine.ownId = 'CNS101'
      set({ env, radarPeriodS: 4.8, selectedId: 'CNS101', crossCheck: false, atcShow: 'both', adsbIn: true })
    },
  }))
}

interface AdsContextValue {
  engine: AdsbEngine
  ocean: AdscEngine
  clock: SimClock
  oceanClock: SimClock
  store: StoreApi<AdsState>
}

const Ctx = createContext<AdsContextValue | null>(null)

export function AdsProvider({ children }: { children: ReactNode }) {
  const clock = useSimClock()
  const oceanClock = useSimClock({ speeds: OCEAN_SPEEDS, speed: 30 })
  const [value] = useState(() => {
    const engine = new AdsbEngine()
    const ocean = new AdscEngine()
    return { engine, ocean, store: createAdsStore(engine, ocean) }
  })
  return <Ctx.Provider value={{ ...value, clock, oceanClock }}>{children}</Ctx.Provider>
}

export function useAds() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAds must be used inside AdsProvider')
  return v
}

export function useAdsState<T>(selector: (s: AdsState) => T): T {
  return useStore(useAds().store, selector)
}
