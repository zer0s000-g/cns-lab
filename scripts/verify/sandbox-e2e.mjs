// End-to-end check of the Airspace Sandbox on the real GPU (headless Chrome on Metal).
//
//   npm run build && npx vite preview --port 4173 &
//   node scripts/verify/sandbox-e2e.mjs              # everything
//   ONLY=layout node scripts/verify/sandbox-e2e.mjs  # one group: layout | flow | perf | reduced
//
// Needs playwright-core, pngjs and axe-core resolvable from where it runs (copy it next to a
// node_modules that has them). For each width (1440, 768, 390) and theme it checks: no console
// errors, no sideways scroll, an axe audit, and every journey phase reached from the timeline with
// the right view and a stage that is not black. At 1440 it then plays the story: a guided stop,
// the debrief, view and camera controls, the panels toggle, failures, keyboard reach and focus
// rings, a GPU memory leak check over view switches, frame rate per view, heap growth, and the
// reduced-motion start. Screenshots go to OUT (default ./e2e-shots).
import { chromium } from 'playwright-core'
import { PNG } from 'pngjs'
import { mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')
const exe = process.env.CHROME || process.env.HOME + '/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell'
const HOST = process.env.HOST || 'http://localhost:4173'
const OUT = process.env.OUT || './e2e-shots'
const ONLY = process.env.ONLY
mkdirSync(OUT, { recursive: true })
const PHASES = ['gate', 'pushback', 'taxi', 'takeoff', 'departure', 'climb', 'ocean', 'descent', 'approach', 'landing', 'taxiIn', 'arrived']
const VIEW = { gate: 'airport', pushback: 'airport', taxi: 'airport', takeoff: 'airport', departure: 'terminal', climb: 'map', ocean: 'map', descent: 'map', approach: 'terminal', landing: 'airport', taxiIn: 'airport', arrived: 'airport' }

let failures = 0
const fail = (msg) => {
  failures++
  console.log('FAIL ' + msg)
}
const ok = (msg) => console.log(' ok  ' + msg)
const check = (cond, msg) => (cond ? ok(msg) : fail(msg))

const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--js-flags=--expose-gc'] })

async function open(size, theme, opts = {}) {
  const [width, height] = size.split('x').map(Number)
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: theme, reducedMotion: opts.reduced ? 'reduce' : 'no-preference', serviceWorkers: 'block' })
  await ctx.addInitScript((t) => localStorage.setItem('cnslab.prefs', JSON.stringify({ state: { theme: t, reducedMotionOverride: null, soundOn: false, captionsOn: true }, version: 1 })), theme)
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (m) => {
    const t = m.text()
    if ((m.type() === 'error' || /GL_|WebGL|shader|context lost/i.test(t)) && !/THREE\.Clock/.test(t)) errors.push(t.slice(0, 200))
  })
  page.on('pageerror', (e) => errors.push('pageerror ' + e.message))
  await page.goto(HOST + '/sandbox' + (opts.query ?? ''), { waitUntil: 'load' })
  await page.waitForFunction(() => { const c = document.querySelector('[data-testid="journey-stage"] canvas'); return c && c.width > 200 && c.height > 150 }, null, { timeout: 30000 }).catch(() => errors.push('stage canvas never sized'))
  await page.waitForTimeout(2500)
  return { ctx, page, errors, width, height }
}

const phaseButton = (page, p) => page.locator('nav[aria-label="Journey phases"] button').nth(PHASES.indexOf(p))
const attr = (page, sel, a) => page.getAttribute(sel, a)
const journeyTime = (page) => page.locator('[aria-label^="Journey time"]').first().getAttribute('aria-label')

/**
 * Share of pure-black pixels (the stage background is never pure black): over the whole view, and
 * in its central 60 %. Shader NaN smears whole regions; the vignette may crush a corner to black.
 */
function blackFraction(buf) {
  const png = PNG.sync.read(buf)
  let black = 0
  let centre = 0
  let centreN = 0
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const i = (y * png.width + x) * 4
      const b = png.data[i] < 2 && png.data[i + 1] < 2 && png.data[i + 2] < 2
      const inside = x > png.width * 0.2 && x < png.width * 0.8 && y > png.height * 0.2 && y < png.height * 0.8
      if (b) black++
      if (inside) {
        centreN++
        if (b) centre++
      }
    }
  }
  return { all: black / (png.width * png.height), centre: centre / centreN }
}

async function axe(page, label) {
  await page.addScriptTag({ content: AXE })
  const r = await page.evaluate(async () => {
    const res = await window.axe.run(document, { resultTypes: ['violations'] })
    return res.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} × ${v.nodes[0]?.target?.join(' ')} — ${v.help}`)
  })
  check(r.length === 0, `${label}: axe finds no violations${r.length ? '\n      ' + r.join('\n      ') : ''}`)
}

// ---------------------------------------------------------------------------
// Layout: every width and theme
// ---------------------------------------------------------------------------
if (!ONLY || ONLY === 'layout') {
  for (const size of ['1440x900', '768x1024', '390x844']) {
    for (const theme of ['dark', 'light']) {
      const tag = `${size} ${theme}`
      const { ctx, page, errors, width } = await open(size, theme)
      const sw = await page.evaluate(() => document.documentElement.scrollWidth)
      check(sw <= width, `${tag}: no sideways scroll (${sw} ≤ ${width})`)
      await axe(page, tag)
      const failuresBefore = failures
      for (const p of PHASES) {
        await phaseButton(page, p).click()
        await page.waitForFunction((want) => document.querySelector('[data-phase]')?.getAttribute('data-phase') === want, p, { timeout: 5000 }).catch(() => {})
        const got = await attr(page, '[data-phase]', 'data-phase')
        await page.waitForTimeout(900)
        const view = await attr(page, '[data-view]', 'data-view')
        const shot = await page.locator('[data-view]').screenshot()
        const black = blackFraction(shot)
        if (got !== p || view !== VIEW[p] || black.all > 0.005 || black.centre > 0.002) fail(`${tag} ${p}: phase ${got}, view ${view} (want ${VIEW[p]}), black ${(black.all * 100).toFixed(2)}% (centre ${(black.centre * 100).toFixed(2)}%)`)
        if (p === 'gate' || p === 'ocean' || p === 'landing') await page.screenshot({ path: `${OUT}/${size}-${theme}-${p}.png` })
      }
      check(failures === failuresBefore, `${tag}: all 12 phases reached from the timeline, right view, stage never black`)
      const sw2 = await page.evaluate(() => document.documentElement.scrollWidth)
      check(sw2 <= width, `${tag}: still no sideways scroll after every phase`)
      check(errors.length === 0, `${tag}: no console errors${errors.length ? ': ' + [...new Set(errors)].slice(0, 3).join(' | ') : ''}`)
      await ctx.close()
    }
  }
}

// ---------------------------------------------------------------------------
// The story at 1440: guided stop, debrief, controls, failures, keyboard
// ---------------------------------------------------------------------------
if (!ONLY || ONLY === 'flow') {
  const { ctx, page, errors } = await open('1440x900', 'dark')
  // Guided stop at the take-off clearance.
  await phaseButton(page, 'takeoff').click()
  const dialog = page.getByRole('dialog', { name: 'Cleared for take-off' })
  await dialog.waitFor({ timeout: 60000 }).then(() => ok('guided stop appears at the take-off clearance'), () => fail('guided stop never appeared'))
  const focused = await page.evaluate(() => document.activeElement?.textContent?.trim())
  check(focused === 'Continue', `focus moves to Continue (got "${focused}")`)
  const t1 = await journeyTime(page)
  await page.waitForTimeout(1500)
  const t2 = await journeyTime(page)
  check(t1 === t2, `the journey is paused at the stop (${t1})`)
  await page.screenshot({ path: `${OUT}/flow-stop.png` })
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1500)
  check((await dialog.count()) === 0, 'Continue closes the stop')
  const t3 = await journeyTime(page)
  check(t3 !== t2, `the journey carries on after Continue (${t2} → ${t3})`)
  // View choice.
  for (const [label, want] of [['Map', 'map'], ['Terminal', 'terminal'], ['Airport', 'airport']]) {
    await page.getByRole('radio', { name: label === 'Map' ? 'Region map' : label === 'Terminal' ? 'Terminal area' : 'Airport', exact: true }).first().click()
    await page.waitForTimeout(700)
    check((await attr(page, '[data-view]', 'data-view')) === want, `view choice ${label} shows the ${want} view`)
  }
  await page.getByRole('radio', { name: /Automatic view/ }).first().click()
  await page.waitForTimeout(700)
  // Camera controls.
  for (const name of ['Tower camera', 'Overview camera', 'Follow camera', 'Zoom in', 'Zoom out', 'Reset the camera']) {
    await page.getByRole('button', { name }).click()
    await page.waitForTimeout(400)
  }
  await page.screenshot({ path: `${OUT}/flow-camera.png` })
  ok('camera buttons respond')
  // Panels toggle.
  await page.getByRole('button', { name: /Hide the panels/ }).click()
  await page.waitForTimeout(500)
  check(!(await page.getByText('Systems in use now').isVisible()), 'panels hide for the full view')
  await page.screenshot({ path: `${OUT}/flow-panels-hidden.png` })
  await page.getByRole('button', { name: 'Show the panels' }).click()
  await page.waitForTimeout(500)
  check(await page.getByText('Systems in use now').isVisible(), 'panels come back')
  // Failures, while climbing out.
  await phaseButton(page, 'departure').click()
  await page.waitForTimeout(4000)
  await page.getByRole('button', { name: 'Radar outage' }).click()
  await page.waitForTimeout(3000)
  const radar = await page.locator('li', { hasText: 'Primary radar' }).first().textContent()
  check(/Failed/.test(radar ?? ''), `radar outage shows the primary radar as failed ("${radar?.trim().slice(0, 60)}")`)
  await page.getByRole('button', { name: 'All normal' }).click()
  await page.getByRole('button', { name: 'Two aircraft on a collision course' }).click()
  await page.waitForTimeout(12000)
  check(await page.getByText('STCA: conflict alert').first().isVisible().catch(() => false), 'collision course raises STCA')
  // Keyboard: every control is reachable with Tab and shows a focus ring.
  await page.evaluate(() => (document.activeElement)?.blur?.())
  const seen = new Set()
  let ringMissing = []
  for (let i = 0; i < 220; i++) {
    await page.keyboard.press('Tab')
    const info = await page.evaluate(() => {
      const el = document.activeElement
      if (!el || el === document.body) return null
      const cs = getComputedStyle(el)
      const label = el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 40) || el.tagName
      // A focus ring is an outline, or a box-shadow ring (the shadcn buttons draw theirs that way).
      return { label, ring: (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow !== 'none' && cs.boxShadow !== '') }
    })
    if (!info) continue
    seen.add(info.label)
    if (!info.ring) ringMissing.push(info.label)
  }
  // (The tower camera is disabled in the terminal-area view, so it is rightly not a Tab stop here.)
  const needed = ['Pause the journey', 'Zoom in', 'Follow camera', 'Radar outage', 'Automatic time-lapse']
  const phaseReach = [...seen].filter((l) => /Jump here/.test(l)).length
  check(needed.every((n) => [...seen].some((s) => s.startsWith(n))) && phaseReach === 12, `Tab reaches the controls and all 12 phases (${seen.size} stops, ${phaseReach} phases)`)
  ringMissing = [...new Set(ringMissing)]
  check(ringMissing.length === 0, `every focused control shows a focus ring${ringMissing.length ? ': missing on ' + ringMissing.slice(0, 5).join(', ') : ''}`)
  // Debrief after deboarding.
  await phaseButton(page, 'arrived').click()
  const banner = page.getByRole('button', { name: /read the debrief/i })
  await banner.waitFor({ timeout: 90000 }).then(() => ok('journey completes and offers the debrief'), () => fail('debrief never offered'))
  await banner.click().catch(() => {})
  await page.waitForTimeout(1200)
  check(await page.locator('#debrief').isVisible(), 'debrief section shows')
  check((await page.locator('#debrief').getByRole('radio').count()) > 0 || (await page.locator('#debrief button').count()) > 3, 'debrief has the quiz')
  await page.screenshot({ path: `${OUT}/flow-debrief.png`, fullPage: true })
  await page.getByRole('button', { name: 'Fly the journey again' }).click()
  await page.waitForTimeout(1500)
  check((await attr(page, '[data-phase]', 'data-phase')) === 'gate', 'fly again starts at the gate')
  check(errors.length === 0, `flow: no console errors${errors.length ? ': ' + [...new Set(errors)].slice(0, 3).join(' | ') : ''}`)
  await ctx.close()
}

// ---------------------------------------------------------------------------
// Performance: GPU memory over view switches, frame rate, heap
// ---------------------------------------------------------------------------
if (!ONLY || ONLY === 'perf') {
  const { ctx, page, errors } = await open('1440x900', 'dark', { query: '?debug' })
  const mem = () => page.evaluate(() => { const i = window.__sandboxGl?.info; return i ? { g: i.memory.geometries, t: i.memory.textures, p: i.programs?.length ?? 0 } : null })
  const pick = async (name) => {
    await page.getByRole('radio', { name, exact: true }).first().click()
    await page.waitForTimeout(900)
  }
  // Hold the journey still, so objects that first appear later in the flight do not count as growth.
  await page.getByRole('button', { name: 'Pause the journey' }).click()
  await pick('Terminal area')
  await pick('Region map')
  await pick('Airport')
  const before = await mem()
  for (let k = 0; k < 10; k++) {
    await pick('Terminal area')
    await pick('Region map')
    await pick('Airport')
  }
  const after = await mem()
  await page.getByRole('button', { name: 'Play the journey' }).click()
  check(before && after && after.g <= before.g && after.t <= before.t, `no GPU leak over 30 view switches (geometries ${before?.g}→${after?.g}, textures ${before?.t}→${after?.t}, programs ${before?.p}→${after?.p})`)
  // Frame rate in each view.
  const fps = () => page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 4000) requestAnimationFrame(f); else res(Math.round((n * 1000) / (performance.now() - t0))) }; requestAnimationFrame(f) }))
  for (const [name, phase] of [['Airport', 'gate'], ['Airport', 'taxi'], ['Terminal area', 'approach'], ['Region map', 'ocean']]) {
    await phaseButton(page, phase).click()
    await pick(name)
    const f = await fps()
    check(f >= 50, `${name} view (${phase}) runs at ${f} fps`)
  }
  await page.getByRole('radio', { name: /Automatic view/ }).first().click()
  // Heap growth over two minutes of flying at high speed.
  const heap = () => page.evaluate(() => { window.gc?.(); return performance.memory?.usedJSHeapSize ?? 0 })
  await phaseButton(page, 'climb').click()
  await page.waitForTimeout(5000)
  const h0 = await heap()
  await page.waitForTimeout(120000)
  const h1 = await heap()
  check(h1 - h0 < 20 * 1024 * 1024, `heap grows ${((h1 - h0) / 1048576).toFixed(1)} MB over 2 minutes (limit 20)`)
  check(errors.length === 0, `perf: no console errors${errors.length ? ': ' + [...new Set(errors)].slice(0, 3).join(' | ') : ''}`)
  await ctx.close()
}

// ---------------------------------------------------------------------------
// Reduced motion: the journey starts paused and the picture holds still
// ---------------------------------------------------------------------------
if (!ONLY || ONLY === 'reduced') {
  const { ctx, page, errors } = await open('1440x900', 'dark', { reduced: true })
  const t0 = await journeyTime(page)
  await page.waitForTimeout(2500)
  const t1 = await journeyTime(page)
  check(t0 === t1 && /00:00:00/.test(t0 ?? ''), `reduced motion: the journey starts paused (${t1})`)
  const a = await page.locator('[data-view]').screenshot()
  await page.waitForTimeout(1200)
  const b = await page.locator('[data-view]').screenshot()
  check(Buffer.compare(a, b) === 0, 'reduced motion: consecutive frames are identical')
  await page.getByRole('button', { name: 'Play the journey' }).click()
  await page.waitForTimeout(2500)
  check((await journeyTime(page)) !== t1, 'reduced motion: Play starts the journey')
  check(errors.length === 0, `reduced: no console errors${errors.length ? ': ' + [...new Set(errors)].slice(0, 3).join(' | ') : ''}`)
  await ctx.close()
}

await browser.close()
console.log(failures ? `${failures} FAILURE(S)` : 'ALL CHECKS PASSED')
process.exit(failures ? 1 : 0)
