import { useEffect, useRef, useState } from 'react'

/**
 * Every design token that canvas and three.js code may use. Values are read
 * from the CSS variables in globals.css, so switching theme re-colours all
 * drawings without any colour living in component code.
 */
export const TOKEN_NAMES = [
  'background',
  'foreground',
  'card',
  'muted',
  'muted-foreground',
  'border',
  'primary',
  'primary-foreground',
  'destructive',
  'success',
  'warning',
  'ring',
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'sim-bg',
  'sim-land',
  'sim-water',
  'sim-terrain',
  'sim-terrain-high',
  'sim-grid',
  'sim-grid-strong',
  'sim-ink',
  'sim-muted',
  'sim-signal',
  'sim-signal-2',
  'sim-neutral',
  'sim-coverage',
  'sim-shadow-zone',
  'sim-warning',
  'sim-alert',
  'sim-ok',
  'sim-sky',
  'sim-fog',
  'scope-bg',
  'scope-grid',
  'scope-grid-strong',
  'scope-trace',
  'scope-trace-2',
  'scope-blip',
  'scope-text',
  'scope-dim',
  'scope-clutter',
  'scope-warning',
  'scope-alert',
  'instrument-face',
  'instrument-bezel',
  'instrument-marking',
  'instrument-dim',
  'instrument-needle',
  'instrument-accent',
  'instrument-flag',
  'lobe-90',
  'lobe-150',
  'marker-outer',
  'marker-middle',
  'marker-inner',
  'brass',
  'signal',
  'hud-line',
  'hud-panel',
  'stage-bg',
  'stage-floor',
  'stage-fog',
  'stage-line',
  'stage-metal',
  'stage-metal-dark',
  'stage-paint',
  'stage-terrain',
  'stage-terrain-high',
  'stage-water',
  'stage-signal',
  'stage-brass',
  'stage-alert',
  'stage-glass',
  'lamp-red',
  'lamp-green',
  'lamp-white',
  'lamp-blue',
  'lamp-amber',
] as const

export type TokenName = (typeof TOKEN_NAMES)[number]
export type ThemeTokens = Record<TokenName, string> & { isDark: boolean; fontSans: string; fontMono: string; fontDisplay: string }

export function readThemeTokens(): ThemeTokens {
  const out = {} as ThemeTokens
  if (typeof document === 'undefined') {
    for (const n of TOKEN_NAMES) out[n] = 'rgb(128, 128, 128)'
    out.isDark = false
    out.fontSans = 'sans-serif'
    out.fontDisplay = 'sans-serif'
    out.fontMono = 'monospace'
    return out
  }
  const cs = getComputedStyle(document.documentElement)
  for (const n of TOKEN_NAMES) out[n] = cs.getPropertyValue(`--${n}`).trim() || 'rgb(128, 128, 128)'
  out.isDark = document.documentElement.classList.contains('dark')
  out.fontSans = '"Inter Tight Variable", ui-sans-serif, system-ui, sans-serif'
  out.fontMono = '"JetBrains Mono Variable", ui-monospace, monospace'
  out.fontDisplay = '"Michroma", "Inter Tight Variable", sans-serif'
  return out
}

let cached: ThemeTokens | null = null
const listeners = new Set<() => void>()
let observer: MutationObserver | null = null

function ensureObserver() {
  if (observer || typeof document === 'undefined') return
  observer = new MutationObserver(() => {
    cached = readThemeTokens()
    listeners.forEach((l) => l())
  })
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
}

/** Current tokens (cached until the theme changes). Safe to call inside draw loops. */
export function getThemeTokens(): ThemeTokens {
  ensureObserver()
  if (!cached) cached = readThemeTokens()
  return cached
}

/** Subscribe to theme changes. */
export function onThemeChange(cb: () => void): () => void {
  ensureObserver()
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** React hook: tokens as state (re-renders when the theme changes). */
export function useThemeTokens(): ThemeTokens {
  const [tokens, setTokens] = useState<ThemeTokens>(() => getThemeTokens())
  useEffect(() => onThemeChange(() => setTokens(getThemeTokens())), [])
  return tokens
}

/** React hook: a ref that always holds the current tokens, without re-rendering. */
export function useThemeTokensRef() {
  const ref = useRef<ThemeTokens>(getThemeTokens())
  useEffect(
    () =>
      onThemeChange(() => {
        ref.current = getThemeTokens()
      }),
    [],
  )
  return ref
}
