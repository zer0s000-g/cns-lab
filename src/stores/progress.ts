import { create } from 'zustand'
import { persist } from 'zustand/middleware'

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
    { name: 'cnslab.progress' },
  ),
)
