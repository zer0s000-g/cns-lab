#!/usr/bin/env node
// Performance budget for the first page load (see design.md §7 and the UI skill):
// everything index.html loads up front, gzip-compressed. Fails the build when over.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const BUDGET_KB = { js: 250, css: 50 }
const dist = join(import.meta.dirname, '..', 'dist')
const html = readFileSync(join(dist, 'index.html'), 'utf8')
const refs = [...html.matchAll(/(?:src|href)="([^"]+\.(js|css))"/g)].map((m) => ({ path: m[1], kind: m[2] }))
const base = (process.env.BASE_PATH || '/').replace(/\/?$/, '/')
const totals = { js: 0, css: 0 }
const rows = []
for (const r of refs) {
  const rel = r.path.startsWith(base) ? r.path.slice(base.length) : r.path.replace(/^\//, '')
  const kb = gzipSync(readFileSync(join(dist, rel))).length / 1024
  totals[r.kind] += kb
  rows.push(`  ${kb.toFixed(1).padStart(7)} kB  ${rel}`)
}
console.log(`budget: first load ${totals.js.toFixed(1)} kB JS (limit ${BUDGET_KB.js}), ${totals.css.toFixed(1)} kB CSS (limit ${BUDGET_KB.css}), gzip`)
console.log(rows.join('\n'))
const over = Object.keys(BUDGET_KB).filter((k) => totals[k] > BUDGET_KB[k])
if (over.length) {
  console.error(`budget: OVER for ${over.join(', ')}. Split, lazy-load or trim before shipping.`)
  process.exit(1)
}
