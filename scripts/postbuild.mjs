#!/usr/bin/env node
// Static-hosting helpers after `vite build`:
//  - dist/404.html (copy of index.html) so GitHub Pages serves the single-page app on deep links.
//  - stamps a build id into dist/sw.js so every deploy installs a fresh service worker cache.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dist = join(import.meta.dirname, '..', 'dist')
if (existsSync(join(dist, 'index.html'))) {
  copyFileSync(join(dist, 'index.html'), join(dist, '404.html'))
  console.log('postbuild: wrote dist/404.html for single-page-app fallback')
}
const sw = join(dist, 'sw.js')
if (existsSync(sw)) {
  const id = process.env.GITHUB_SHA?.slice(0, 12) || Date.now().toString(36)
  writeFileSync(sw, readFileSync(sw, 'utf8').replace('__BUILD_ID__', id))
  console.log(`postbuild: stamped service worker build ${id}`)
}
