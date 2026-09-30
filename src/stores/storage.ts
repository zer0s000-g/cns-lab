import { createJSONStorage, type StateStorage } from 'zustand/middleware'

/**
 * localStorage that never throws. It can be missing (blocked cookies, some private
 * modes) or full (the quota is shared by every site on the same origin, e.g. a
 * github.io account): then settings and progress simply are not saved, and the
 * app keeps working with what is in memory.
 */
const safeLocalStorage: StateStorage = {
  getItem: (name) => {
    try {
      return window.localStorage.getItem(name)
    } catch {
      return null
    }
  },
  setItem: (name, value) => {
    try {
      window.localStorage.setItem(name, value)
    } catch {
      /* not saved */
    }
  },
  removeItem: (name) => {
    try {
      window.localStorage.removeItem(name)
    } catch {
      /* nothing to remove */
    }
  },
}

export const safeStorage = createJSONStorage(() => safeLocalStorage)

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
