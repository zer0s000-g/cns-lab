// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sanitizeModules } from '@/stores/progress'
import { sanitizePrefs } from '@/stores/prefs'

// The stores hydrate from localStorage when first imported: each test loads fresh copies.
async function freshStores() {
  vi.resetModules()
  const progress = await import('@/stores/progress')
  const prefs = await import('@/stores/prefs')
  return { useProgress: progress.useProgress, usePrefs: prefs.usePrefs }
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('saved progress', () => {
  it('drops malformed entries instead of crashing', () => {
    expect(sanitizeModules(null)).toEqual({})
    expect(sanitizeModules([1, 2])).toEqual({})
    expect(
      sanitizeModules({
        psr: { completed: true, bestScore: 4, total: 5, updatedAt: 10 },
        ssr: null,
        ads: { completed: 'yes', bestScore: 4, total: 5 },
        dme: { completed: true, bestScore: NaN, total: 5 },
        ils: { completed: true, bestScore: 9, total: 5 },
      }),
    ).toEqual({ psr: { completed: true, bestScore: 4, total: 5, updatedAt: 10 }, ils: { completed: true, bestScore: 5, total: 5, updatedAt: 0 } })
  })

  it('a stored { modules: null } hydrates to empty progress, and quizzes can still be recorded', async () => {
    localStorage.setItem('cnslab.progress', JSON.stringify({ state: { modules: null }, version: 0 }))
    const { useProgress } = await freshStores()
    expect(useProgress.getState().modules).toEqual({})
    useProgress.getState().recordQuiz('psr', 3, 5)
    expect(useProgress.getState().modules.psr.bestScore).toBe(3)
  })

  it('corrupted JSON leaves the defaults', async () => {
    localStorage.setItem('cnslab.progress', '{not json')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { useProgress } = await freshStores()
    expect(useProgress.getState().modules).toEqual({})
  })

  it('a full disk does not throw from the setter; the result stays in memory', async () => {
    const { useProgress, usePrefs } = await freshStores()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    expect(() => useProgress.getState().recordQuiz('psr', 3, 5)).not.toThrow()
    expect(useProgress.getState().modules.psr.bestScore).toBe(3)
    expect(() => usePrefs.getState().setTheme('light')).not.toThrow()
    expect(usePrefs.getState().theme).toBe('light')
  })

  it('blocked storage (getItem throws) still starts with defaults', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    const { useProgress, usePrefs } = await freshStores()
    expect(useProgress.getState().modules).toEqual({})
    expect(usePrefs.getState().theme).toBe('dark')
  })
})

describe('saved preferences', () => {
  it('keep only values of the right type', () => {
    expect(sanitizePrefs({ theme: 'blue', soundOn: 'false', reducedMotionOverride: 'yes', captionsOn: false })).toEqual({ captionsOn: false })
    expect(sanitizePrefs({ theme: 'light', soundOn: false, reducedMotionOverride: null })).toEqual({ theme: 'light', soundOn: false, reducedMotionOverride: null })
    expect(sanitizePrefs('junk')).toEqual({})
  })

  it('a stored soundOn "false" string does not turn sound on; a bad theme keeps the default', async () => {
    localStorage.setItem('cnslab.prefs', JSON.stringify({ state: { theme: 'blue', soundOn: 'false' }, version: 1 }))
    const { usePrefs } = await freshStores()
    expect(usePrefs.getState().theme).toBe('dark')
    expect(usePrefs.getState().soundOn).toBe(true)
  })

  it('the v0 → v1 migration still resets the theme to dark and keeps valid fields', async () => {
    localStorage.setItem('cnslab.prefs', JSON.stringify({ state: { theme: 'light', soundOn: false }, version: 0 }))
    const { usePrefs } = await freshStores()
    expect(usePrefs.getState().theme).toBe('dark')
    expect(usePrefs.getState().soundOn).toBe(false)
  })
})
