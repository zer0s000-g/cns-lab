#!/usr/bin/env node
// Performance budget for the first page load (see design.md §7 and the UI skill): everything
// a page's HTML loads up front (scripts, modulepreload hints, stylesheets), gzip-compressed.
// Every route page counts, not just the home page: a deep link is a first load too.
// Fails the build when any page is over.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { gzipSync } from 'node:zlib'

const BUDGET_KB = { js: 250, css: 50 }
// DIST_DIR lets the tests run this on a throwaway build folder.
const dist = process.env.DIST_DIR || join(import.meta.dirname, '..', 'dist')
if (!existsSync(join(dist, 'index.html'))) {
  console.error('budget: dist/index.html not found. Run the build first.')
  process.exit(1)
}

const indexHtml = readFileSync(join(dist, 'index.html'), 'utf8')
// Base path as built (e.g. "/" locally, "/cns-lab/" on GitHub Pages), read from the entry script.
const entrySrc = (indexHtml.match(/<script type="module"[^>]*src="([^"]+)"/) || [])[1] || '/assets/'
const base = process.env.BASE_PATH ? process.env.BASE_PATH.replace(/\/?$/, '/') : entrySrc.slice(0, entrySrc.indexOf('assets/'))

const pages = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name !== 'assets') walk(p)
    } else if (name.endsWith('.html') && name !== '404.html') pages.push(p)
  }
}
walk(dist)

const sizeCache = new Map()
const gz = (rel) => {
  if (!sizeCache.has(rel)) {
    const file = join(dist, rel)
    if (!existsSync(file)) {
      console.error(`budget: ${rel} is referenced by a page but missing from dist`)
      process.exit(1)
    }
    sizeCache.set(rel, gzipSync(readFileSync(file)).length / 1024)
  }
  return sizeCache.get(rel)
}

const results = pages.map((page) => {
  const html = readFileSync(page, 'utf8')
  const refs = new Map()
  for (const m of html.matchAll(/(?:src|href)="([^"]+\.(js|css))"/g)) {
    if (!m[1].startsWith(base)) continue // external or not a build asset
    refs.set(m[1].slice(base.length), m[2])
  }
  const totals = { js: 0, css: 0 }
  for (const [rel, kind] of refs) totals[kind] += gz(rel)
  return { page: relative(dist, page), totals }
})
results.sort((a, b) => b.totals.js - a.totals.js)

const home = results.find((r) => r.page === 'index.html')
console.log(`budget: first load ${home.totals.js.toFixed(1)} kB JS (limit ${BUDGET_KB.js}), ${home.totals.css.toFixed(1)} kB CSS (limit ${BUDGET_KB.css}), gzip, home page`)
const worst = results[0]
console.log(`budget: heaviest page ${worst.page}: ${worst.totals.js.toFixed(1)} kB JS, ${worst.totals.css.toFixed(1)} kB CSS (${results.length} pages checked)`)
for (const r of results.slice(0, 5)) console.log(`  ${r.totals.js.toFixed(1).padStart(7)} kB JS  ${r.totals.css.toFixed(1).padStart(5)} kB CSS  ${r.page}`)

const over = results.filter((r) => r.totals.js > BUDGET_KB.js || r.totals.css > BUDGET_KB.css)
if (over.length) {
  for (const r of over) console.error(`budget: OVER on ${r.page}: ${r.totals.js.toFixed(1)} kB JS, ${r.totals.css.toFixed(1)} kB CSS`)
  console.error('budget: split, lazy-load or trim before shipping.')
  process.exit(1)
}
