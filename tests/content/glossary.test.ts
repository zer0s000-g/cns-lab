import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '../../src')

interface Entry {
  id: string
  term: string
  definition: string
}

function loadGlossary(): Entry[] {
  const dir = join(root, 'content/glossary')
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .flatMap((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Entry[])
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(tsx|mdx)$/.test(name)) out.push(p)
  }
  return out
}

describe('glossary', () => {
  const entries = loadGlossary()

  it('has unique ids across all files', () => {
    const seen = new Map<string, number>()
    for (const e of entries) seen.set(e.id, (seen.get(e.id) ?? 0) + 1)
    const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id)
    expect(dupes).toEqual([])
  })

  it('every entry has a term and a plain definition', () => {
    for (const e of entries) {
      expect(e.id).toMatch(/^[a-z0-9-]+$/)
      expect(e.term.length).toBeGreaterThan(0)
      expect(e.definition.length).toBeGreaterThan(10)
    }
  })

  it('every <Term id="..."> used in the source exists in the glossary', () => {
    const ids = new Set(entries.map((e) => e.id))
    const missing: string[] = []
    for (const file of walk(root)) {
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(/<Term\s+id=["']([^"']+)["']/g)) {
        if (!ids.has(m[1])) missing.push(`${file.replace(root, 'src')}: ${m[1]}`)
      }
    }
    expect(missing).toEqual([])
  })
})
