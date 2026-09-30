import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MODULES } from '@/modules/registry'

const root = join(import.meta.dirname, '../..')
const catalog = JSON.parse(readFileSync(join(root, 'src/modules/catalog.json'), 'utf8')) as { id: string; path: string; pillar: string }[]

describe('module catalog', () => {
  it('has unique ids and paths, and a page for every module', () => {
    expect(new Set(catalog.map((m) => m.id)).size).toBe(catalog.length)
    expect(new Set(catalog.map((m) => m.path)).size).toBe(catalog.length)
    for (const m of catalog) {
      const page = m.id === 'sandbox' ? 'src/pages/Sandbox/index.tsx' : `src/modules/${m.id}/index.tsx`
      expect(existsSync(join(root, page)), page).toBe(true)
      expect(m.path).toBe(m.id === 'sandbox' ? '/sandbox' : `/modules/${m.id}`)
      expect(['communication', 'navigation', 'surveillance', 'integration']).toContain(m.pillar)
    }
  })

  it('is what the app registry shows, each module with its own icon', () => {
    expect(MODULES.map((m) => m.id)).toEqual(catalog.map((m) => m.id))
    const src = readFileSync(join(root, 'src/modules/registry.ts'), 'utf8')
    for (const m of catalog) expect(src, `icon for ${m.id}`).toMatch(new RegExp(`^  ${m.id}: \\w+,$`, 'm'))
  })
})
