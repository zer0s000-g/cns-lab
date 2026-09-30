import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

// scripts/postbuild.mjs and scripts/budget.mjs, run on a small fake build in a temp folder.
const root = join(import.meta.dirname, '../..')
const REAL_CATALOG = JSON.parse(readFileSync(join(root, 'src/modules/catalog.json'), 'utf8')) as { id: string; name: string; path: string; summary: string }[]
let dir = ''
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }))

const INDEX = `<!doctype html><html><head><title>CNS Lab</title>
<meta name="description" content="x"><meta property="og:title" content="x"><meta property="og:description" content="x"><meta property="og:url" content="https://site.test/cns-lab/">
<script type="module" crossorigin src="/cns-lab/assets/index-a.js"></script><link rel="stylesheet" crossorigin href="/cns-lab/assets/index-b.css">
</head><body></body></html>`

function fakeBuild(catalog = REAL_CATALOG, opts: { manifest?: boolean; bigChunk?: number } = {}) {
  dir = mkdtempSync(join(tmpdir(), 'cnslab-build-'))
  mkdirSync(join(dir, 'assets'))
  writeFileSync(join(dir, 'index.html'), INDEX)
  writeFileSync(join(dir, 'assets/index-a.js'), 'console.log(1)')
  writeFileSync(join(dir, 'assets/index-b.css'), 'body{}')
  writeFileSync(join(dir, 'sw.js'), "const BUILD = '__BUILD_ID__'\nconst SHELL_ASSETS = [/* __SHELL_ASSETS__ */]\n")
  const manifest: Record<string, { file: string; imports?: string[] }> = {}
  const entries = [...catalog.map((m) => (m.id === 'sandbox' ? 'src/pages/Sandbox/index.tsx' : `src/modules/${m.id}/index.tsx`)), 'src/pages/SandboxRoute.tsx', 'src/pages/Glossary.tsx', 'src/pages/Frequencies.tsx']
  for (const [i, k] of entries.entries()) {
    manifest[k] = { file: `assets/chunk${i}.js`, imports: ['_shared.js'] }
    writeFileSync(join(dir, `assets/chunk${i}.js`), i === 0 && opts.bigChunk ? randomText(opts.bigChunk) : `export default ${i}`)
  }
  manifest['_shared.js'] = { file: 'assets/shared.js' }
  writeFileSync(join(dir, 'assets/shared.js'), 'export const s = 1')
  if (opts.manifest !== false) {
    mkdirSync(join(dir, '.vite'))
    writeFileSync(join(dir, '.vite/manifest.json'), JSON.stringify(manifest))
  }
  const catalogPath = join(dir, 'catalog.json')
  writeFileSync(catalogPath, JSON.stringify(catalog))
  return catalogPath
}

// Incompressible text so gzip cannot shrink it below the budget.
const randomText = (bytes: number) => randomBytes(bytes).toString('base64')

const run = (script: string, env: Record<string, string>) =>
  spawnSync(process.execPath, [join(root, 'scripts', script)], { env: { ...process.env, ...env }, encoding: 'utf8' })

describe('postbuild', () => {
  it('writes one page per catalog module plus glossary and frequencies, with preload hints and a stamped service worker', () => {
    const catalog = fakeBuild()
    const r = run('postbuild.mjs', { DIST_DIR: dir, CATALOG: catalog })
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout).toContain(`wrote ${REAL_CATALOG.length + 2} route pages`)
    const psr = readFileSync(join(dir, 'modules/psr.html'), 'utf8')
    expect(psr).toContain('<title>Primary Surveillance Radar · CNS Lab</title>')
    expect(psr).toContain('<link rel="modulepreload" crossorigin href="/cns-lab/assets/shared.js">')
    const sw = readFileSync(join(dir, 'sw.js'), 'utf8')
    expect(sw).not.toContain('__BUILD_ID__')
    expect(sw).toContain('"./assets/index-a.js", "./assets/index-b.css"')
  })

  it('fails when the Vite manifest is missing instead of silently dropping the preloads', () => {
    const catalog = fakeBuild(REAL_CATALOG, { manifest: false })
    const r = run('postbuild.mjs', { DIST_DIR: dir, CATALOG: catalog })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('manifest.json is missing')
  })

  it('fails when a module has no entry in the manifest', () => {
    const catalog = fakeBuild()
    const extra = [...REAL_CATALOG, { id: 'aftn', name: 'AFTN', short: 'AFTN', pillar: 'communication', phase: 7, minutes: 10, path: '/modules/aftn', summary: 'x' }]
    writeFileSync(catalog, JSON.stringify(extra))
    const r = run('postbuild.mjs', { DIST_DIR: dir, CATALOG: catalog })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('src/modules/aftn/index.tsx')
  })

  it('keeps a "$" in a title or summary as written', () => {
    const cat = REAL_CATALOG.map((m) => (m.id === 'psr' ? { ...m, name: 'Radar $1 & $&', summary: 'Costs $1 or $& per message.' } : m))
    const catalog = fakeBuild(cat)
    expect(run('postbuild.mjs', { DIST_DIR: dir, CATALOG: catalog }).status).toBe(0)
    const psr = readFileSync(join(dir, 'modules/psr.html'), 'utf8')
    expect(psr).toContain('<title>Radar $1 &amp; $&amp; · CNS Lab</title>')
    expect(psr).toContain('<meta name="description" content="Costs $1 or $&amp; per message.')
  })
})

describe('budget', () => {
  it('passes a small build and checks every page', () => {
    const catalog = fakeBuild()
    expect(run('postbuild.mjs', { DIST_DIR: dir, CATALOG: catalog }).status).toBe(0)
    const r = run('budget.mjs', { DIST_DIR: dir })
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout).toContain(`(${REAL_CATALOG.length + 3} pages checked)`)
  })

  it('fails when one deep-link page is over, even if the home page is small', () => {
    const catalog = fakeBuild(REAL_CATALOG, { bigChunk: 400 * 1024 })
    expect(run('postbuild.mjs', { DIST_DIR: dir, CATALOG: catalog }).status).toBe(0)
    const r = run('budget.mjs', { DIST_DIR: dir })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('OVER on modules/psr.html')
  })

  it('fails clearly when there is no build', () => {
    dir = mkdtempSync(join(tmpdir(), 'cnslab-build-'))
    const r = run('budget.mjs', { DIST_DIR: dir })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('Run the build first')
  })
})
