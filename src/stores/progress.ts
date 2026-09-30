import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { isRecord, safeStorage } from './storage'

export interface ModuleProgress {
  completed: boolean
  bestScore: number
  total: number
  updatedAt: number
}

interface ProgressState {
  modules: Record<string, ModuleProgress>
  recordQuiz: (moduleId: string, score: number, total: number) => void
  reset: (moduleId?: string) => void
}

/**
 * Saved progress, checked field by field: anything malformed (edited by hand, written
 * by an older version, cut short by a full disk) is dropped instead of crashing Home.
 */
export function sanitizeModules(raw: unknown): Record<string, ModuleProgress> {
  const out: Record<string, ModuleProgress> = {}
  if (!isRecord(raw)) return out
  for (const [id, v] of Object.entries(raw)) {
    if (!isRecord(v)) continue
    const { completed, bestScore, total, updatedAt } = v
    if (typeof completed !== 'boolean') continue
    if (typeof bestScore !== 'number' || typeof total !== 'number' || !Number.isFinite(bestScore) || !Number.isFinite(total)) continue
    if (total < 0 || bestScore < 0) continue
    out[id] = { completed, bestScore: Math.min(bestScore, total), total, updatedAt: typeof updatedAt === 'number' && Number.isFinite(updatedAt) ? updatedAt : 0 }
  }
  return out
}

/** Quiz progress kept in localStorage. A module counts as completed once its quiz is finished. */
export const useProgress = create<ProgressState>()(
  persist(
    (set) => ({
      modules: {},
      recordQuiz: (moduleId, score, total) =>
        set((s) => {
          const prev = s.modules[moduleId]
          return {
            modules: {
              ...s.modules,
              [moduleId]: {
                completed: true,
                bestScore: Math.max(prev?.bestScore ?? 0, score),
                total,
                updatedAt: Date.now(),
              },
            },
          }
        }),
      reset: (moduleId) =>
        set((s) => {
          if (!moduleId) return { modules: {} }
          const next = { ...s.modules }
          delete next[moduleId]
          return { modules: next }
        }),
    }),
    {
      name: 'cnslab.progress',
      storage: safeStorage,
      version: 1,
      partialize: (s) => ({ modules: s.modules }),
      // v0 had the same shape; the merge below checks it.
      migrate: (persisted) => persisted as ProgressState,
      merge: (persisted, current) => ({ ...current, modules: sanitizeModules(isRecord(persisted) ? persisted.modules : undefined) }),
    },
  ),
)
