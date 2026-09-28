// Real-GPU render test for the 3D stages. Software rendering (swiftshader) hides
// GPU-specific shader bugs: NaN from zero-width smoothstep or pow() of a negative
// base renders fine there but smears black/flicker on Metal and other drivers.
// This drives headless Chrome on the machine's real GPU, visits every route and
// chapter, grabs a burst of frames, and flags pure-black pixels (the stage
// background is never pure black) and frame-to-frame brightness jumps.
//
//   npm run build && npx vite preview --port 4173 &
//   node scripts/verify/gpu-render.mjs            # all routes, dark
//   THEME=light node scripts/verify/gpu-render.mjs / /modules/psr
//
// Needs playwright-core and pngjs on the path (npx -p playwright-core -p pngjs node ...)
// and a Chromium with GPU access (CHROME env var overrides the executable). Small
// black fractions (< 0.5 %) with no jump are usually dark UI (scopes, quiz rows):
// look at the saved PNG (OUT=dir) before treating them as failures.
import { chromium } from 'playwright-core'
import { PNG } from 'pngjs'
const exe = process.env.CHROME || process.env.HOME + '/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell'
const HOST = process.env.HOST || 'http://localhost:4173'
const OUT = process.env.OUT
const [w, h] = (process.env.SIZE || '1440x900').split('x').map(Number)
const theme = process.env.THEME || 'dark'
const modules = ['psr', 'ssr', 'ads', 'mlat', 'surface', 'ndb', 'dvor', 'dme', 'ils', 'gnss', 'vhf', 'hf', 'cpdlc', 'satcom']
const routes = process.argv.slice(2).length ? process.argv.slice(2) : ['/', '/sandbox', ...modules.map((m) => '/modules/' + m)]
const chapters = ['idea', 'simulator', 'how', 'try', 'wrong', 'deeper', 'quiz']
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, colorScheme: theme, serviceWorkers: 'block' })
await ctx.addInitScript((t) => localStorage.setItem('cnslab.prefs', JSON.stringify({ state: { theme: t, reducedMotionOverride: null, soundOn: false, captionsOn: true }, version: 1 })), theme)
function stats(buf) {
  const png = PNG.sync.read(buf)
  let black = 0, sum = 0
  const n = png.width * png.height
  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2]
    if (r < 2 && g < 2 && b < 2) black++
    sum += 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  return { black: black / n, lum: sum / n }
}
let problems = 0
for (const r of routes) {
  const page = await ctx.newPage()
  const warn = []
  page.on('console', (m) => { const t = m.text(); if ((m.type() === 'error' || /GL_|WebGL|shader|context lost/i.test(t)) && !/THREE.Clock/.test(t)) warn.push(t.slice(0, 160)) })
  page.on('pageerror', (e) => warn.push('pageerror ' + e.message))
  await page.goto(HOST + r, { waitUntil: 'load' })
  // The stage loads after idle; wait until its canvas has been sized.
  await page.waitForFunction(() => { const c = document.querySelector('canvas'); return c && c.width > 300 && c.height > 150 }, null, { timeout: 20000 }).catch(() => warn.push('stage canvas never sized'))
  await page.waitForTimeout(2500)
  const list = r === '/' ? ['top'] : chapters
  for (const c of list) {
    if (c !== 'top') {
      await page.evaluate((id) => { const el = document.getElementById(id); if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 56) }, c)
      await page.waitForTimeout(1600)
    }
    const frames = []
    for (let k = 0; k < 6; k++) {
      // The stage area only (the sticky stage fills the viewport under the header on desktop).
      const buf = await page.screenshot({ clip: { x: 0, y: 56, width: w, height: Math.min(h - 56, 700) }, scale: 'css' })
      frames.push(stats(buf))
      if (k === 0 && OUT) await page.screenshot({ path: `${OUT}/${r.replace(/\W+/g, '_')}-${c}.png`, scale: 'css' })
      await page.waitForTimeout(180)
    }
    const maxBlack = Math.max(...frames.map((f) => f.black))
    const lums = frames.map((f) => f.lum)
    const jump = Math.max(...lums.slice(1).map((l, i) => Math.abs(l - lums[i])))
    const bad = maxBlack > 0.002 || jump > 6
    if (bad) problems++
    console.log(`${bad ? 'FAIL' : ' ok '} ${r.padEnd(16)} ${c.padEnd(9)} black ${(maxBlack * 100).toFixed(2)}%  lum ${lums.map((l) => l.toFixed(0)).join(',')}  jump ${jump.toFixed(1)}`)
  }
  if (warn.length) { problems++; console.log(`WARN ${r}: ${[...new Set(warn)].slice(0, 4).join(' | ')}`) }
  await page.close()
}
console.log(problems ? `${problems} problem(s)` : 'ALL CLEAN')
await browser.close()
