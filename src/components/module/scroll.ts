import { systemPrefersReducedMotion, usePrefs } from '@/stores/prefs'

/** Scroll a module section into view (instantly when reduced motion is on). */
export function scrollToSection(id: string) {
  const el = document.getElementById(id)
  if (!el) return
  const reduced = usePrefs.getState().reducedMotionOverride ?? systemPrefersReducedMotion()
  el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
}
