#!/usr/bin/env node
// Static-hosting helpers after `vite build`:
//  - One HTML file per route (dist/modules/psr.html, dist/glossary.html, ...). Each one
//    carries that page's title and description, and <link rel="modulepreload"> hints for
//    the route's code, so the browser fetches it in parallel with the main bundle instead
//    of discovering it later. Deep links are also served with a normal 200 status.
//  - dist/404.html (copy of index.html) as the single-page-app fallback for unknown paths.
//  - Stamps a build id into dist/sw.js so every deploy installs a fresh service worker cache.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const root = join(import.meta.dirname, '..')
// DIST_DIR lets the tests run this on a throwaway build folder.
const dist = process.env.DIST_DIR || join(root, 'dist')
const indexHtml = readFileSync(join(dist, 'index.html'), 'utf8')
writeFileSync(join(dist, '404.html'), indexHtml)
console.log('postbuild: wrote dist/404.html for single-page-app fallback')

// Base path as built (e.g. "/" locally, "/cns-lab/" on GitHub Pages).
const entrySrc = indexHtml.match(/<script type="module"[^>]*src="([^"]+)"/)[1]
const base = entrySrc.slice(0, entrySrc.indexOf('assets/'))
const site = (indexHtml.match(/<meta property="og:url" content="([^"]+)"/) || [])[1] || ''

const manifestPath = join(dist, '.vite', 'manifest.json')
if (!existsSync(manifestPath)) {
  // Without the manifest every page would silently lose its preload hints. It is deleted at the
  // end of this script, so running postbuild twice needs a fresh `vite build` in between.
  console.error('postbuild: dist/.vite/manifest.json is missing. Run `vite build` (with build.manifest) first.')
  process.exit(1)
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

/** Static-import closure of a manifest entry: every JS file the route needs before it can render. */
function closure(key, seen = new Set()) {
  const e = manifest[key]
  if (!e || seen.has(key)) return seen
  seen.add(key)
  for (const k of e.imports ?? []) closure(k, seen)
  return seen
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

// Module pages, from the same catalog the app's registry uses.
const catalog = JSON.parse(readFileSync(process.env.CATALOG || join(root, 'src/modules/catalog.json'), 'utf8'))
const routes = catalog.map((m) => ({
  path: m.path,
  title: `${m.name} · CNS Lab`,
  description: `${m.summary} An interactive simulation in CNS Lab. For educational use only.`,
  entry: m.id === 'sandbox' ? 'src/pages/Sandbox/index.tsx' : `src/modules/${m.id}/index.tsx`,
  extra: m.id === 'sandbox' ? ['src/pages/SandboxRoute.tsx'] : [],
}))
routes.push(
  { path: '/glossary', title: 'Glossary · CNS Lab', description: 'Every technical word used in CNS Lab, explained in plain language.', entry: 'src/pages/Glossary.tsx', extra: [] },
  { path: '/frequencies', title: 'Frequency chart · CNS Lab', description: 'Where every air traffic management radio system lives in the radio spectrum.', entry: 'src/pages/Frequencies.tsx', extra: [] },
)
const missing = routes.flatMap((r) => [r.entry, ...r.extra]).filter((k) => !manifest[k])
if (missing.length) {
  console.error(`postbuild: not in the Vite manifest (renamed or not a dynamic entry?): ${missing.join(', ')}`)
  process.exit(1)
}

let written = 0
for (const r of routes) {
  const keys = new Set()
  for (const k of [r.entry, ...r.extra]) closure(k, keys)
  const files = [...keys].map((k) => manifest[k].file).filter((f) => !indexHtml.includes(f))
  const preload = files.map((f) => `    <link rel="modulepreload" crossorigin href="${base}${f}">`).join('\n')
  // Replacement functions, not strings: a "$" in a title or summary must stay a "$".
  const html = indexHtml
    .replace(/<title>[^<]*<\/title>/, () => `<title>${esc(r.title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*"/, (_, a) => `${a}${esc(r.description)}"`)
    .replace(/(<meta property="og:title" content=")[^"]*"/, (_, a) => `${a}${esc(r.title)}"`)
    .replace(/(<meta property="og:description" content=")[^"]*"/, (_, a) => `${a}${esc(r.description)}"`)
    .replace(/(<meta property="og:url" content=")[^"]*"/, (_, a) => `${a}${esc(site + r.path.replace(/^\//, ''))}"`)
    .replace('</head>', () => `${preload}\n  </head>`)
  const out = join(dist, `${r.path.replace(/^\//, '')}.html`)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, html)
  written++
}
if (written !== catalog.length + 2) {
  console.error(`postbuild: wrote ${written} route pages, expected ${catalog.length + 2}`)
  process.exit(1)
}
console.log(`postbuild: wrote ${written} route pages with preload hints`)
rmSync(join(dist, '.vite'), { recursive: true, force: true })

const sw = join(dist, 'sw.js')
if (existsSync(sw)) {
  const id = process.env.GITHUB_SHA?.slice(0, 12) || Date.now().toString(36)
  // The entry JS and CSS, so the offline shell can start even if the first visit was cut short.
  const shellAssets = [...indexHtml.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)]
    .map((m) => m[1])
    .filter((u) => u.startsWith(base + 'assets/'))
    .map((u) => './' + u.slice(base.length))
  const src = readFileSync(sw, 'utf8')
  if (!src.includes('__BUILD_ID__') || !src.includes('/* __SHELL_ASSETS__ */')) {
    console.error('postbuild: dist/sw.js is missing its __BUILD_ID__ or __SHELL_ASSETS__ placeholder')
    process.exit(1)
  }
  writeFileSync(sw, src.replace('__BUILD_ID__', id).replace('/* __SHELL_ASSETS__ */', shellAssets.map((u) => JSON.stringify(u)).join(', ')))
  console.log(`postbuild: stamped service worker build ${id} with ${shellAssets.length} shell assets`)
}
