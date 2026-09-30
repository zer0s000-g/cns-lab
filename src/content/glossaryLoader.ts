import { useEffect, useState } from 'react'
import type { GlossaryEntry } from './glossary'

/*
 * The glossary (about 300 definitions, 20 kB compressed) is not part of any page's
 * first load: every <Term> already shows its word, and the definitions arrive a
 * moment after the page renders, long before anyone opens one.
 */
type Lookup = (id: string) => GlossaryEntry | undefined

let lookup: Lookup | null = null
let pending: Promise<Lookup> | null = null
const listeners = new Set<() => void>()

export function loadGlossary(): Promise<Lookup> {
  if (lookup) return Promise.resolve(lookup)
  pending ??= import('./glossary').then(
    (m) => {
      lookup = m.getTerm
      listeners.forEach((l) => l())
      return m.getTerm
    },
    (error: unknown) => {
      pending = null // offline or a failed download: the next Term to open tries again
      throw error
    },
  )
  return pending
}

/** The entry for `id`: undefined while the glossary loads, null if there is no such term. */
export function useGlossaryEntry(id: string): GlossaryEntry | null | undefined {
  const [, force] = useState(0)
  useEffect(() => {
    if (lookup) return
    const l = () => force((n) => n + 1)
    listeners.add(l)
    loadGlossary().catch(() => {})
    return () => {
      listeners.delete(l)
    }
  }, [])
  return lookup ? (lookup(id) ?? null) : undefined
}
