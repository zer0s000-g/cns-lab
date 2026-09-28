import { createContext, useContext, useState, type ReactNode } from 'react'
import { createStore, useStore, type StoreApi } from 'zustand'
import type { Vec2 } from '@/core/geometry'
import { useSimClock, type SimClock } from '@/hooks/useSimClock'
import {
  DEFAULT_ENV,
  DEFAULT_PARAMS,
  DEFAULT_RECEIVERS,
  MlatEngine,
  OUTSIDE_AIRCRAFT,
  type MlatEnv,
  type MlatFix,
  type MlatParams,
  type MlatReceiver,
  type ReceiverId,
} from './engine'

export interface ReplayState {
  phase: 'idle' | 'replay'
  fix?: MlatFix
  /** Signal time since the transmission, µs. */
  tUs?: number
  totalUs?: number
  /** Whether the world clock was running before the replay froze it. */
  resume?: boolean
}

export interface MlatState {
  receivers: MlatReceiver[]
  env: MlatEnv
  params: MlatParams
  selectedId: string | null
  showHeatmap: boolean
  showCurves: boolean
  replay: ReplayState
  /** Bumped whenever the network geometry or settings change (redraws the accuracy map). */
  geometryVersion: number
  setEnv: <K extends keyof MlatEnv>(k: K, v: MlatEnv[K]) => void
  setParam: <K extends keyof MlatParams>(k: K, v: MlatParams[K]) => void
  setReceiverInUse: (id: ReceiverId, v: boolean) => void
  moveReceiver: (id: ReceiverId, pos: Vec2) => void
  resetReceivers: () => void
  select: (id: string | null) => void
  setShowHeatmap: (v: boolean) => void
  setShowCurves: (v: boolean) => void
  setReplay: (r: ReplayState) => void
  resetAll: () => void
}

/** Receivers must stay on the map. */
const clampPos = (p: Vec2): Vec2 => ({ x: Math.max(-48, Math.min(48, p.x)), y: Math.max(-48, Math.min(48, p.y)) })

export function createMlatStore(engine: MlatEngine) {
  return createStore<MlatState>()((set, get) => {
    const syncReceivers = () => set({ receivers: engine.receivers.map((r) => ({ ...r })), geometryVersion: get().geometryVersion + 1 })
    return {
      receivers: engine.receivers.map((r) => ({ ...r })),
      env: { ...DEFAULT_ENV },
      params: { ...DEFAULT_PARAMS },
      selectedId: 'CNS101',
      showHeatmap: true,
      showCurves: true,
      replay: { phase: 'idle' },
      geometryVersion: 0,
      setEnv: (k, v) => {
        const env = { ...get().env, [k]: v }
        engine.env = env
        if (k === 'badGeometry') engine.applyBadGeometry(Boolean(v))
        if (k === 'outside') {
          engine.applyOutside(Boolean(v))
          if (v) set({ selectedId: OUTSIDE_AIRCRAFT })
        }
        if (k === 'receiverFailed') engine.clearHistory()
        set({ env })
        syncReceivers()
      },
      setParam: (k, v) => {
        const params = { ...get().params, [k]: v }
        engine.params = params
        engine.clearHistory()
        set({ params, geometryVersion: get().geometryVersion + 1 })
      },
      setReceiverInUse: (id, v) => {
        engine.setReceiver(id, { inUse: v })
        syncReceivers()
      },
      moveReceiver: (id, pos) => {
        engine.setReceiver(id, { pos: clampPos(pos) })
        // Moving a receiver by hand makes the layout the learner's own.
        if (get().env.badGeometry) {
          engine.forgetSavedLayout()
          const env = { ...get().env, badGeometry: false }
          engine.env = env
          set({ env })
        }
        syncReceivers()
      },
      resetReceivers: () => {
        const env = { ...get().env, badGeometry: false }
        engine.env = env
        engine.receivers = DEFAULT_RECEIVERS.map((r) => ({ ...r, pos: { ...r.pos } }))
        engine.forgetSavedLayout()
        engine.clearHistory()
        set({ env })
        syncReceivers()
      },
      select: (selectedId) => set({ selectedId }),
      setShowHeatmap: (showHeatmap) => set({ showHeatmap }),
      setShowCurves: (showCurves) => set({ showCurves }),
      setReplay: (replay) => set({ replay }),
      resetAll: () => {
        engine.reset()
        set({
          env: { ...DEFAULT_ENV },
          params: { ...DEFAULT_PARAMS },
          selectedId: 'CNS101',
          replay: { phase: 'idle' },
          showHeatmap: true,
          showCurves: true,
        })
        syncReceivers()
      },
    }
  })
}

/** Per-frame replay progress (kept out of React state so nothing re-renders at 60 fps). */
export interface ReplayProgress {
  fix: MlatFix
  tUs: number
  totalUs: number
}

interface MlatContextValue {
  engine: MlatEngine
  clock: SimClock
  store: StoreApi<MlatState>
  replayRef: { current: ReplayProgress | null }
}

const Ctx = createContext<MlatContextValue | null>(null)

export function MlatProvider({ children }: { children: ReactNode }) {
  const clock = useSimClock()
  const [value] = useState(() => {
    const engine = new MlatEngine()
    return { engine, clock, store: createMlatStore(engine), replayRef: { current: null as ReplayProgress | null } }
  })
  return <Ctx.Provider value={{ ...value, clock }}>{children}</Ctx.Provider>
}

export function useMlat() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useMlat must be used inside MlatProvider')
  return v
}

export function useMlatState<T>(selector: (s: MlatState) => T): T {
  return useStore(useMlat().store, selector)
}
