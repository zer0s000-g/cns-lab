#!/usr/bin/env node
// Static-hosting helpers after `vite build`:
//  - dist/404.html (copy of index.html) so GitHub Pages serves the single-page app on deep links.
import { copyFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const dist = join(import.meta.dirname, '..', 'dist')
if (existsSync(join(dist, 'index.html'))) {
  copyFileSync(join(dist, 'index.html'), join(dist, '404.html'))
  console.log('postbuild: wrote dist/404.html for single-page-app fallback')
}
