import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ThemeChoice = 'light' | 'dark' | 'system'

interface PrefsState {
  theme: ThemeChoice
  /** null = follow the operating system setting. */
  reducedMotionOverride: boolean | null
  soundOn: boolean
  captionsOn: boolean
  setTheme: (t: ThemeChoice) => void
  setReducedMotion: (v: boolean | null) => void
  setSoundOn: (v: boolean) => void
  setCaptionsOn: (v: boolean) => void
}

export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      theme: 'dark',
      reducedMotionOverride: null,
      soundOn: true,
      captionsOn: true,
      setTheme: (theme) => set({ theme }),
      setReducedMotion: (reducedMotionOverride) => set({ reducedMotionOverride }),
      setSoundOn: (soundOn) => set({ soundOn }),
      setCaptionsOn: (captionsOn) => set({ captionsOn }),
    }),
    {
      name: 'cnslab.prefs',
      // v1: the Flight Deck redesign is dark-first; earlier saved "system"/"light" choices reset to dark.
      version: 1,
      migrate: (persisted) => ({ ...(persisted as PrefsState), theme: 'dark' }),
    },
  ),
)

export function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function systemPrefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Apply the theme class to <html>. */
export function applyTheme(choice: ThemeChoice) {
  const dark = choice === 'dark' || (choice === 'system' && systemPrefersDark())
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
}

/** Effective reduced-motion setting. */
export function useReducedMotion(): boolean {
  const override = usePrefs((s) => s.reducedMotionOverride)
  return override ?? systemPrefersReducedMotion()
}
