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
const dist = join(root, 'dist')
const indexHtml = readFileSync(join(dist, 'index.html'), 'utf8')
writeFileSync(join(dist, '404.html'), indexHtml)
console.log('postbuild: wrote dist/404.html for single-page-app fallback')

// Base path as built (e.g. "/" locally, "/cns-lab/" on GitHub Pages).
const entrySrc = indexHtml.match(/<script type="module"[^>]*src="([^"]+)"/)[1]
const base = entrySrc.slice(0, entrySrc.indexOf('assets/'))
const site = (indexHtml.match(/<meta property="og:url" content="([^"]+)"/) || [])[1] || ''

const manifestPath = join(dist, '.vite', 'manifest.json')
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null

/** Static-import closure of a manifest entry: every JS file the route needs before it can render. */
function closure(key, seen = new Set()) {
  const e = manifest?.[key]
  if (!e || seen.has(key)) return seen
  seen.add(key)
  for (const k of e.imports ?? []) closure(k, seen)
  return seen
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

// Module pages, from the registry (id, name, path, summary).
const registry = readFileSync(join(root, 'src/modules/registry.ts'), 'utf8')
const routes = [...registry.matchAll(/\{ id: '([^']+)', name: '([^']+)',.*?path: '([^']+)', summary: '((?:[^'\\]|\\.)*)' \}/g)].map((m) => ({
  path: m[3],
  title: `${m[2]} · CNS Lab`,
  description: `${m[4].replace(/\\'/g, "'")} An interactive simulation in CNS Lab. For educational use only.`,
  entry: m[3] === '/sandbox' ? 'src/pages/Sandbox/index.tsx' : `src/modules/${m[1]}/index.tsx`,
  extra: m[3] === '/sandbox' ? ['src/pages/SandboxRoute.tsx'] : [],
}))
routes.push(
  { path: '/glossary', title: 'Glossary · CNS Lab', description: 'Every technical word used in CNS Lab, explained in plain language.', entry: 'src/pages/Glossary.tsx', extra: [] },
  { path: '/frequencies', title: 'Frequency chart · CNS Lab', description: 'Where every air traffic management radio system lives in the radio spectrum.', entry: 'src/pages/Frequencies.tsx', extra: [] },
)

let written = 0
for (const r of routes) {
  const keys = new Set()
  for (const k of [r.entry, ...r.extra]) closure(k, keys)
  const files = [...keys].map((k) => manifest[k].file).filter((f) => !indexHtml.includes(f))
  const preload = files.map((f) => `    <link rel="modulepreload" crossorigin href="${base}${f}">`).join('\n')
  const html = indexHtml
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(r.title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*"/, `$1${esc(r.description)}"`)
    .replace(/(<meta property="og:title" content=")[^"]*"/, `$1${esc(r.title)}"`)
    .replace(/(<meta property="og:description" content=")[^"]*"/, `$1${esc(r.description)}"`)
    .replace(/(<meta property="og:url" content=")[^"]*"/, `$1${esc(site + r.path.replace(/^\//, ''))}"`)
    .replace('</head>', `${preload}\n  </head>`)
  const out = join(dist, `${r.path.replace(/^\//, '')}.html`)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, html)
  written++
}
console.log(`postbuild: wrote ${written} route pages with preload hints`)
rmSync(join(dist, '.vite'), { recursive: true, force: true })

const sw = join(dist, 'sw.js')
if (existsSync(sw)) {
  const id = process.env.GITHUB_SHA?.slice(0, 12) || Date.now().toString(36)
  writeFileSync(sw, readFileSync(sw, 'utf8').replace('__BUILD_ID__', id))
  console.log(`postbuild: stamped service worker build ${id}`)
}
