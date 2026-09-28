/**
 * Glossary: merged from every JSON file in src/content/glossary.
 * Modules add their own file (e.g. glossary/psr.json); ids must be unique
 * across all files (checked by tests/content/glossary.test.ts).
 */

export interface GlossaryEntry {
  id: string
  term: string
  definition: string
  /** Optional module id that introduces the term. */
  module?: string
}

const files = import.meta.glob<GlossaryEntry[]>('./glossary/*.json', { eager: true, import: 'default' })

export const GLOSSARY: GlossaryEntry[] = Object.entries(files)
  .flatMap(([path, entries]) => {
    const source = path.replace(/^.*\/(.*)\.json$/, '$1')
    return entries.map((e) => ({ ...e, module: e.module ?? (source === 'core' ? undefined : source) }))
  })
  .sort((a, b) => a.term.localeCompare(b.term, 'en', { sensitivity: 'base' }))

const byId = new Map(GLOSSARY.map((e) => [e.id, e]))

export function getTerm(id: string): GlossaryEntry | undefined {
  return byId.get(id)
}
