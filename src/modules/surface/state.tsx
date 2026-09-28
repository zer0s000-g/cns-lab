import { createContext, useContext, useState, type ReactNode } from 'react'
import { createStore, useStore, type StoreApi } from 'zustand'
import type { Vec2 } from '@/core/geometry'
import { useSimClock, type SimClock } from '@/hooks/useSimClock'
import { DEFAULT_ENV, DEFAULT_LAYERS, SurfaceEngine, type SurfaceEnv, type SurfaceLayers } from './engine'

export type ZoomId = 'airport' | 'west' | 'apron'
export type PresetId = 'smr' | 'mlat' | 'adsb' | 'fused'

/** What each zoom shows: centre (m) and half-width of the airport map (m); the display uses a circle of radius `scopeM`. */
export const ZOOMS: Record<ZoomId, { label: string; centre: Vec2; halfWidthM: number; scopeM: number }> = {
  airport: { label: 'Whole airport', centre: { x: 0, y: 200 }, halfWidthM: 1750, scopeM: 1720 },
  west: { label: 'West end (A1)', centre: { x: -1330, y: 70 }, halfWidthM: 430, scopeM: 330 },
  apron: { label: 'Apron', centre: { x: -120, y: 340 }, halfWidthM: 620, scopeM: 440 },
}

export const PRESETS: Record<PresetId, SurfaceLayers> = {
  smr: { smr: true, mlat: false, adsb: false, fused: false },
  mlat: { smr: true, mlat: true, adsb: false, fused: false },
  adsb: { smr: true, mlat: true, adsb: true, fused: false },
  fused: { smr: true, mlat: true, adsb: true, fused: true },
}

export function presetOf(l: SurfaceLayers): PresetId | '' {
  for (const [id, p] of Object.entries(PRESETS)) if (p.smr === l.smr && p.mlat === l.mlat && p.adsb === l.adsb && p.fused === l.fused) return id as PresetId
  return ''
}

export const DEFAULT_VISIBILITY_M = 10000

export interface SurfaceState {
  env: SurfaceEnv
  layers: SurfaceLayers
  visibilityM: number
  zoom: ZoomId
  selectedId: string | null
  setEnv: <K extends keyof SurfaceEnv>(k: K, v: SurfaceEnv[K]) => void
  setLayer: <K extends keyof SurfaceLayers>(k: K, v: boolean) => void
  setPreset: (p: PresetId) => void
  setVisibility: (v: number) => void
  setZoom: (z: ZoomId) => void
  select: (id: string | null) => void
  resetAll: () => void
}

export function createSurfaceStore(engine: SurfaceEngine) {
  return createStore<SurfaceState>()((set, get) => ({
    env: { ...DEFAULT_ENV },
    layers: { ...DEFAULT_LAYERS },
    visibilityM: DEFAULT_VISIBILITY_M,
    zoom: 'airport',
    selectedId: 'OPS1',
    setEnv: (k, v) => {
      const env = { ...get().env, [k]: v }
      engine.env = env
      if (k === 'noTransponder') engine.applyEquipment()
      set({ env })
    },
    setLayer: (k, v) => {
      const layers = { ...get().layers, [k]: v }
      engine.setLayers(layers)
      set({ layers })
    },
    setPreset: (p) => {
      const layers = { ...PRESETS[p] }
      engine.setLayers(layers)
      set({ layers })
    },
    setVisibility: (visibilityM) => set({ visibilityM }),
    setZoom: (zoom) => set({ zoom }),
    select: (selectedId) => set({ selectedId }),
    resetAll: () => {
      engine.env = { ...DEFAULT_ENV }
      engine.setLayers({ ...DEFAULT_LAYERS })
      engine.reset()
      set({ env: { ...DEFAULT_ENV }, layers: { ...DEFAULT_LAYERS }, visibilityM: DEFAULT_VISIBILITY_M, zoom: 'airport', selectedId: 'OPS1' })
    },
  }))
}

interface SurfaceContextValue {
  engine: SurfaceEngine
  clock: SimClock
  store: StoreApi<SurfaceState>
}

const Ctx = createContext<SurfaceContextValue | null>(null)

export function SurfaceProvider({ children }: { children: ReactNode }) {
  const clock = useSimClock()
  const [value] = useState(() => {
    const engine = new SurfaceEngine()
    return { engine, clock, store: createSurfaceStore(engine) }
  })
  return <Ctx.Provider value={{ ...value, clock }}>{children}</Ctx.Provider>
}

export function useSurface() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSurface must be used inside SurfaceProvider')
  return v
}

export function useSurfaceState<T>(selector: (s: SurfaceState) => T): T {
  return useStore(useSurface().store, selector)
}
