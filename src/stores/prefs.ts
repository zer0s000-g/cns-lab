import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { isRecord, safeStorage } from './storage'

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

const THEMES: readonly ThemeChoice[] = ['light', 'dark', 'system']

/** Saved preferences, keeping only fields of the right type ("false" as a string is not false). */
export function sanitizePrefs(raw: unknown): Partial<Pick<PrefsState, 'theme' | 'reducedMotionOverride' | 'soundOn' | 'captionsOn'>> {
  if (!isRecord(raw)) return {}
  const out: Partial<Pick<PrefsState, 'theme' | 'reducedMotionOverride' | 'soundOn' | 'captionsOn'>> = {}
  if (THEMES.includes(raw.theme as ThemeChoice)) out.theme = raw.theme as ThemeChoice
  if (typeof raw.reducedMotionOverride === 'boolean' || raw.reducedMotionOverride === null) out.reducedMotionOverride = raw.reducedMotionOverride
  if (typeof raw.soundOn === 'boolean') out.soundOn = raw.soundOn
  if (typeof raw.captionsOn === 'boolean') out.captionsOn = raw.captionsOn
  return out
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
      storage: safeStorage,
      // v1: the Flight Deck redesign is dark-first; earlier saved "system"/"light" choices reset to dark.
      version: 1,
      migrate: (persisted) => ({ ...(isRecord(persisted) ? persisted : {}), theme: 'dark' }) as PrefsState,
      partialize: (s) => ({ theme: s.theme, reducedMotionOverride: s.reducedMotionOverride, soundOn: s.soundOn, captionsOn: s.captionsOn }),
      merge: (persisted, current) => ({ ...current, ...sanitizePrefs(persisted) }),
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
