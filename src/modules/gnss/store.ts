import { createStore } from 'zustand'
import { DEFAULT_ENV, DEFAULT_SETTINGS, GnssEngine, type GnssEnv, type GnssSettings, type PresetKind } from './engine'

/** Time-lapse steps: satellites take about 6 hours to cross the sky in real time. */
export const GNSS_SPEEDS = [1, 60, 600] as const

export interface GnssView {
  /** Translucent distance spheres in the orbit view. */
  showSpheres: boolean
  /** Slices of the distance spheres on the ground view. */
  showLines: boolean
  /** Rotate the orbit view with the Earth so the receiver stays in front. */
  followEarth: boolean
  /** Bumped by "Look at the receiver". */
  recenter: number
}

export const DEFAULT_VIEW: GnssView = { showSpheres: false, showLines: true, followEarth: true, recenter: 0 }

export interface GnssState {
  settings: GnssSettings
  env: GnssEnv
  view: GnssView
  setSetting: <K extends keyof GnssSettings>(k: K, v: GnssSettings[K]) => void
  setEnv: <K extends keyof GnssEnv>(k: K, v: GnssEnv[K]) => void
  setView: <K extends keyof GnssView>(k: K, v: GnssView[K]) => void
  /** Add or remove one satellite from the learner's own selection (switches to "choose myself"). */
  toggleSatellite: (id: string) => void
  applyPreset: (kind: PresetKind) => void
  resetAll: () => void
}

export function createGnssStore(engine: GnssEngine) {
  return createStore<GnssState>()((set, get) => {
    const pushSettings = (settings: GnssSettings) => {
      engine.settings = settings
      engine.markDirty()
      set({ settings })
    }
    return {
      settings: { ...DEFAULT_SETTINGS },
      env: { ...DEFAULT_ENV },
      view: { ...DEFAULT_VIEW },
      setSetting: (k, v) => pushSettings({ ...get().settings, [k]: v }),
      setEnv: (k, v) => {
        const prev = get().env
        const env = { ...prev, [k]: v }
        engine.env = env
        if (k === 'faultySat' && v && !prev.faultySat) engine.startFault()
        if (k === 'spoofing' && v && !prev.spoofing) engine.startSpoof()
        engine.markDirty()
        set({ env })
      },
      setView: (k, v) => set({ view: { ...get().view, [k]: v } }),
      toggleSatellite: (id) => {
        const s = get().settings
        const base = s.selectMode === 'all' ? engine.sats.filter((x) => x.selected).map((x) => x.id) : s.selected
        const selected = base.includes(id) ? base.filter((x) => x !== id) : [...base, id]
        pushSettings({ ...s, selectMode: 'manual', selected })
      },
      applyPreset: (kind) => {
        const selected = engine.presetSelection(kind)
        pushSettings({ ...get().settings, selectMode: 'manual', selected })
      },
      resetAll: () => {
        engine.reset()
        set({ settings: { ...engine.settings }, env: { ...engine.env }, view: { ...DEFAULT_VIEW } })
      },
    }
  })
}

