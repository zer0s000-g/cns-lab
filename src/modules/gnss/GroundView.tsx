import { useCallback, useRef } from 'react'
import { Canvas2D, type DrawFn } from '@/components/sim/Canvas2D'
import { drawStation, haloText } from '@/components/sim/mapDraw'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { useSampled } from '@/hooks/useSampled'
import { withAlpha } from '@/lib/color'
import { CROSS_CHECK_LIMIT_M, type GnssEngine, type GnssResult } from './engine'
import { formatMetres } from './format'
import { useGnss, useGnssState } from './state'

/** Half-widths the ground view can show, m. */
const SCALES = [2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10_000, 20_000, 50_000]

/** Width of the height strip on the right, px. */
const STRIP = 58

/** Choose a view half-width from SCALES with hysteresis (grow at once, shrink after 1.5 s). */
function pickScale(sc: { half: number; shrinkSince: number }, want: number, now: number): number {
  const target = SCALES.find((s) => s >= want) ?? SCALES[SCALES.length - 1]
  if (target > sc.half) {
    sc.half = target
    sc.shrinkSince = 0
  } else if (target < sc.half) {
    if (!sc.shrinkSince) sc.shrinkSince = now
    else if (now - sc.shrinkSince > 1500) {
      sc.half = target
      sc.shrinkSince = 0
    }
  } else sc.shrinkSince = 0
  return sc.half
}

function niceStep(x: number): number {
  const p = 10 ** Math.floor(Math.log10(x))
  const f = x / p
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p
}

/** Everything the view must fit, m (horizontal, vertical). */
function neededExtent(e: GnssEngine): { h: number; v: number } {
  const r = e.result
  let h = 1.5
  let v = 1.5
  if (r.enu) {
    h = Math.max(h, Math.hypot(r.enu.x, r.enu.y) + r.h95M)
    v = Math.max(v, Math.abs(r.enu.z) + r.v95M)
  }
  for (const p of e.trail) h = Math.max(h, Math.abs(p.e), Math.abs(p.n))
  if (r.curve) {
    for (const c of r.curve) {
      h = Math.max(h, Math.abs(c.enu.x), Math.abs(c.enu.y))
      v = Math.max(v, Math.abs(c.enu.z))
    }
  }
  if (r.dmeDme) h = Math.max(h, Math.hypot(r.dmeDme.x, r.dmeDme.y) + 2 * 150)
  // Keep every distance line in view, so one that misses the others (a faulty satellite) is visible.
  for (const l of r.lines) h = Math.max(h, Math.min(20_000, Math.abs(Math.hypot(l.cE, l.cN) - l.r) * 1.15))
  return { h, v }
}

function describeGround(e: GnssEngine) {
  const r = e.result
  if (r.kind === 'none') return `Ground view: no GNSS position. ${r.reason}`
  if (r.kind === 'three' && !r.enu) return 'Ground view: with three satellites the possible answers form a line; the receiver cannot pick one.'
  const bits = [`Ground view: the GNSS position is ${formatMetres(r.hErrM)} from the true position, ${formatMetres(Math.abs(r.vErrM))} ${r.vErrM >= 0 ? 'too high' : 'too low'}.`]
  if (r.h95M > 0) bits.push(`The 95 percent circle has a radius of ${formatMetres(r.h95M)}.`)
  if (r.crossCheckM !== null) bits.push(`DME/DME cross-check differs by ${formatMetres(r.crossCheckM)}.`)
  return bits.join(' ')
}

/** Top-down view of the receiver's surroundings in metres, with a height strip. */
export function GroundView() {
  const { engine } = useGnss()
  const scaleRef = useRef({ h: { half: 10, shrinkSince: 0 }, v: { half: 10, shrinkSince: 0 } })
  const showLines = useGnssState((s) => s.view.showLines)
  const showLinesRef = useRef(showLines)
  showLinesRef.current = showLines

  const draw: DrawFn = useCallback(
    (ctx, { width, height, now, tokens: t }) => {
      const e = engine
      const r = e.result
      ctx.fillStyle = t['sim-land']
      ctx.fillRect(0, 0, width, height)
      const mainW = width - STRIP
      const cx = mainW / 2
      const cy = height / 2

      // Scales with hysteresis: grow at once, shrink only after the view has been too big for 1.5 s.
      // The map and the height strip each get their own scale (both labelled).
      const need = neededExtent(e)
      const half = pickScale(scaleRef.current.h, need.h * 1.12, now)
      const halfV = pickScale(scaleRef.current.v, need.v * 1.15, now)
      const pxPerM = Math.min(mainW, height) / 2 / half
      const pxPerMV = (height / 2 - 26) / halfV
      const X = (east: number) => cx + east * pxPerM
      const Y = (north: number) => cy - north * pxPerM

      // Grid.
      const step = niceStep(half / 2)
      ctx.strokeStyle = t['sim-grid']
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let k = -Math.ceil(mainW / 2 / pxPerM / step); k <= Math.ceil(mainW / 2 / pxPerM / step); k++) {
        const x = X(k * step)
        ctx.moveTo(x, 0)
        ctx.lineTo(x, height)
      }
      for (let k = -Math.ceil(height / 2 / pxPerM / step); k <= Math.ceil(height / 2 / pxPerM / step); k++) {
        const y = Y(k * step)
        ctx.moveTo(0, y)
        ctx.lineTo(mainW, y)
      }
      ctx.stroke()

      ctx.save()
      ctx.beginPath()
      ctx.rect(0, 0, mainW, height)
      ctx.clip()

      // Trail of recent fixes.
      ctx.fillStyle = withAlpha(t['sim-signal'], 0.35)
      for (const p of e.trail) {
        ctx.beginPath()
        ctx.arc(X(p.e), Y(p.n), 2, 0, Math.PI * 2)
        ctx.fill()
      }

      // Range lines: slices of each distance sphere at the answer's height.
      if (r.enu && showLinesRef.current) drawRangeLines(ctx, e, r, X, Y, half, mainW, height, t)

      // Three satellites: every clock error gives a different answer.
      if (r.curve && r.curve.length > 1) {
        ctx.strokeStyle = t['sim-warning']
        ctx.lineWidth = 2.5
        ctx.beginPath()
        r.curve.forEach((c, i) => (i === 0 ? ctx.moveTo(X(c.enu.x), Y(c.enu.y)) : ctx.lineTo(X(c.enu.x), Y(c.enu.y))))
        ctx.stroke()
        for (const c of r.curve) {
          if (c.guessNs % 250 !== 0) continue
          ctx.fillStyle = t['sim-warning']
          ctx.beginPath()
          ctx.arc(X(c.enu.x), Y(c.enu.y), c.guessNs === 0 ? 4 : 2.5, 0, Math.PI * 2)
          ctx.fill()
        }
        const first = r.curve[0]
        const last = r.curve[r.curve.length - 1]
        const font = `600 10px ${t.fontSans}`
        const endLabel = (c: typeof first, text: string) => {
          const x = X(c.enu.x)
          const y = Y(c.enu.y)
          ctx.font = font
          const w = ctx.measureText(text).width
          // Keep the label inside the map, beside the end of the line.
          const lx = Math.max(6, Math.min(mainW - w - 6, x >= cx ? x + 8 : x - 8 - w))
          const ly = Math.max(14, Math.min(height - 24, y + (y >= cy ? 14 : -6)))
          haloText(ctx, text, lx, ly, t, { font, color: t['sim-warning'] })
        }
        endLabel(first, `clock guess ${first.guessNs} ns`)
        endLabel(last, `clock guess +${last.guessNs} ns`)
      }

      // DME/DME cross-check position (shown while spoofing).
      if (r.dmeDme) {
        const d = r.dmeDme
        const s = { x: X(d.x), y: Y(d.y) }
        ctx.strokeStyle = t['sim-ink']
        ctx.lineWidth = 2
        ctx.strokeRect(s.x - 6, s.y - 6, 12, 12)
        haloText(ctx, 'DME/DME position', s.x + 10, s.y + 16, t, { font: `600 10px ${t.fontSans}` })
        if (r.enu) {
          ctx.setLineDash([4, 4])
          ctx.strokeStyle = r.crossCheckM !== null && r.crossCheckM > CROSS_CHECK_LIMIT_M ? t['sim-alert'] : t['sim-muted']
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.moveTo(s.x, s.y)
          ctx.lineTo(X(r.enu.x), Y(r.enu.y))
          ctx.stroke()
          ctx.setLineDash([])
        }
      }

      // True position. Its label goes above when the answer is below, and below otherwise, so the two labels never collide.
      drawStation(ctx, { x: cx, y: cy }, 'receiver', t, { size: 7 })
      const answerBelow = r.enu ? Y(r.enu.y) >= cy : true
      haloText(ctx, 'True position', cx, answerBelow ? cy - 12 : cy + 20, t, { align: 'center', font: `600 10px ${t.fontSans}` })

      // The answer and its 95% circle.
      if (r.enu) {
        const sx = X(r.enu.x)
        const sy = Y(r.enu.y)
        if (r.h95M > 0 && r.kind === 'fix') {
          const rad = r.h95M * pxPerM
          ctx.fillStyle = withAlpha(t['primary'], 0.08)
          ctx.strokeStyle = t['primary']
          ctx.lineWidth = 1.5
          ctx.setLineDash([6, 4])
          ctx.beginPath()
          ctx.arc(sx, sy, Math.max(0, rad), 0, Math.PI * 2)
          ctx.fill()
          ctx.stroke()
          ctx.setLineDash([])
          if (rad > 24) haloText(ctx, '95% circle', sx, sy + rad + 13, t, { align: 'center', font: `600 10px ${t.fontSans}`, color: t['primary'] })
        }
        // Error vector.
        if (Math.hypot(sx - cx, sy - cy) > 14) {
          ctx.strokeStyle = t['sim-muted']
          ctx.lineWidth = 1
          ctx.setLineDash([2, 3])
          ctx.beginPath()
          ctx.moveTo(cx, cy)
          ctx.lineTo(sx, sy)
          ctx.stroke()
          ctx.setLineDash([])
        }
        ctx.strokeStyle = t['sim-bg']
        ctx.lineWidth = 5
        crosshair(ctx, sx, sy)
        ctx.strokeStyle = r.kind === 'three' ? t['sim-warning'] : t['primary']
        ctx.lineWidth = 2.2
        crosshair(ctx, sx, sy)
        const tag = r.kind === 'three' ? 'One possible answer' : e.env.spoofing && r.spoofOffsetM > 0 ? 'GNSS position (fake)' : 'GNSS position'
        const lx = sx + Math.max(11, r.kind === 'fix' ? Math.min(r.h95M * pxPerM * 0.75, 90) : 0) + 4
        ctx.font = `600 11px ${t.fontSans}`
        const tw = ctx.measureText(tag).width
        const tx = lx + tw > mainW - 6 ? Math.max(6, sx - (lx - sx) - tw) : lx
        const ty = answerBelow ? sy + 18 : sy - 10
        haloText(ctx, tag, tx, Math.max(14, Math.min(height - 24, ty)), t, { color: r.kind === 'three' ? t['sim-warning'] : t['primary'] })
      }
      ctx.restore()

      // No position.
      if (r.kind === 'none') {
        ctx.fillStyle = withAlpha(t['sim-bg'], 0.85)
        ctx.fillRect(12, cy - 44, mainW - 24, 34)
        haloText(ctx, 'No GNSS position', cx, cy - 30, t, { align: 'center', font: `600 13px ${t.fontSans}`, color: t['sim-alert'] })
        wrapText(ctx, r.reason, cx, cy - 16, mainW - 32, t)
      } else if (r.kind === 'three' && !r.enu) {
        haloText(ctx, 'No single answer: the possible positions form a line', cx, 40, t, { align: 'center', font: `600 11px ${t.fontSans}`, color: t['sim-warning'] })
      }

      // Scale bar.
      const barPx = step * pxPerM
      const bx = 12
      const by = height - 14
      ctx.strokeStyle = t['sim-ink']
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(bx, by - 4)
      ctx.lineTo(bx, by)
      ctx.lineTo(bx + barPx, by)
      ctx.lineTo(bx + barPx, by - 4)
      ctx.stroke()
      haloText(ctx, formatMetres(step, 0), bx + barPx / 2, by - 6, t, { align: 'center', font: `600 10px ${t.fontMono}` })
      // North arrow.
      const nx = mainW - 18
      ctx.fillStyle = t['sim-ink']
      ctx.beginPath()
      ctx.moveTo(nx, 12)
      ctx.lineTo(nx + 5, 24)
      ctx.lineTo(nx - 5, 24)
      ctx.closePath()
      ctx.fill()
      haloText(ctx, 'N', nx, 36, t, { align: 'center', font: `600 10px ${t.fontSans}` })

      drawHeightStrip(ctx, r, mainW, height, pxPerMV, halfV, t)
    },
    [engine],
  )

  const label = useSampled(() => describeGround(engine), 1000)
  return <Canvas2D draw={draw} label={label} className="aspect-square w-full rounded-[3px] border border-hud-line" />
}

function crosshair(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.beginPath()
  ctx.moveTo(x - 8, y)
  ctx.lineTo(x + 8, y)
  ctx.moveTo(x, y - 8)
  ctx.lineTo(x, y + 8)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(x, y, 4.5, 0, Math.PI * 2)
  ctx.stroke()
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, t: ThemeTokens) {
  ctx.font = `500 11px ${t.fontSans}`
  const words = text.split(' ')
  let line = ''
  let yy = y
  for (const w of words) {
    const test = line ? `${line} ${w}` : w
    if (ctx.measureText(test).width > maxW && line) {
      haloText(ctx, line, x, yy, t, { align: 'center', font: `500 11px ${t.fontSans}`, color: t['sim-ink'] })
      line = w
      yy += 14
    } else line = test
  }
  if (line) haloText(ctx, line, x, yy, t, { align: 'center', font: `500 11px ${t.fontSans}`, color: t['sim-ink'] })
}

function drawRangeLines(
  ctx: CanvasRenderingContext2D,
  e: GnssEngine,
  r: GnssResult,
  X: (m: number) => number,
  Y: (m: number) => number,
  half: number,
  mainW: number,
  height: number,
  t: ThemeTokens,
) {
  const sol = r.enu!
  const faultyId = e.env.faultySat ? e.faultyId : null
  for (const l of r.lines) {
    if (!(l.r > 0)) continue
    // Points on the (huge) circle near the answer.
    const phi0 = Math.atan2(sol.y - l.cN, sol.x - l.cE)
    const span = (3 * half) / l.r
    const faulty = l.id === faultyId
    ctx.strokeStyle = faulty ? t['sim-alert'] : withAlpha(t['sim-signal-2'], 0.75)
    ctx.lineWidth = faulty ? 2 : 1.3
    ctx.beginPath()
    let labelPt: { x: number; y: number } | null = null
    for (let k = 0; k <= 32; k++) {
      const ph = phi0 - span + (2 * span * k) / 32
      const x = X(l.cE + l.r * Math.cos(ph))
      const y = Y(l.cN + l.r * Math.sin(ph))
      if (k === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
      if (x > 16 && x < mainW - 30 && y > 16 && y < height - 26) labelPt = { x, y }
    }
    ctx.stroke()
    if (labelPt) {
      haloText(ctx, faulty ? `${l.id} (faulty)` : l.id, labelPt.x + 3, labelPt.y - 3, t, {
        font: `600 10px ${t.fontMono}`,
        color: faulty ? t['sim-alert'] : t['sim-signal-2'],
      })
    }
  }
}

function drawHeightStrip(ctx: CanvasRenderingContext2D, r: GnssResult, mainW: number, height: number, pxPerM: number, half: number, t: ThemeTokens) {
  const x0 = mainW
  const cy = height / 2
  // Layout: bars on the left of the strip, marker and value next to them, scale ticks on the right.
  const xb = x0 + 11
  ctx.fillStyle = t['sim-bg']
  ctx.fillRect(x0, 0, STRIP, height)
  ctx.strokeStyle = t['sim-grid-strong']
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x0 + 0.5, 0)
  ctx.lineTo(x0 + 0.5, height)
  ctx.stroke()
  haloText(ctx, 'Height', x0 + STRIP / 2, 14, t, { align: 'center', font: `600 10px ${t.fontSans}` })
  const Yv = (u: number) => cy - u * pxPerM
  // Height scale: ticks at ± one step.
  const stepV = niceStep(half / 1.5)
  ctx.strokeStyle = t['sim-grid-strong']
  ctx.lineWidth = 1
  for (const u of [-stepV, stepV]) {
    const y = Yv(u)
    if (y < 24 || y > height - 6) continue
    ctx.beginPath()
    ctx.moveTo(x0 + 4, y)
    ctx.lineTo(x0 + STRIP - 2, y)
    ctx.stroke()
    haloText(ctx, `${u > 0 ? '+' : '−'}${formatMetres(Math.abs(u), 0)}`, x0 + STRIP - 3, u > 0 ? y - 3 : y + 10, t, {
      align: 'right',
      font: `500 9px ${t.fontMono}`,
      color: t['sim-muted'],
    })
  }
  // True height.
  ctx.strokeStyle = t['sim-ink']
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(x0 + 4, cy)
  ctx.lineTo(x0 + STRIP - 2, cy)
  ctx.stroke()
  haloText(ctx, 'true', x0 + STRIP - 3, cy + 11, t, { align: 'right', font: `500 9px ${t.fontSans}`, color: t['sim-muted'] })
  const clampY = (y: number) => Math.max(22, Math.min(height - 8, y))
  if (r.curve && r.curve.length > 1) {
    const us = r.curve.map((c) => c.enu.z)
    ctx.strokeStyle = t['sim-warning']
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.moveTo(xb, clampY(Yv(Math.max(...us))))
    ctx.lineTo(xb, clampY(Yv(Math.min(...us))))
    ctx.stroke()
  }
  if (r.enu) {
    const y = Yv(r.enu.z)
    if (r.v95M > 0 && r.kind === 'fix') {
      ctx.strokeStyle = withAlpha(t['primary'], 0.55)
      ctx.lineWidth = 6
      ctx.beginPath()
      ctx.moveTo(xb, clampY(y - r.v95M * pxPerM))
      ctx.lineTo(xb, clampY(y + r.v95M * pxPerM))
      ctx.stroke()
    }
    const yc = clampY(y)
    ctx.fillStyle = r.kind === 'three' ? t['sim-warning'] : t['primary']
    ctx.beginPath()
    ctx.moveTo(xb + 4, yc)
    ctx.lineTo(xb + 11, yc - 5)
    ctx.lineTo(xb + 11, yc + 5)
    ctx.closePath()
    ctx.fill()
    const txt = `${r.enu.z >= 0 ? '+' : '−'}${formatMetres(Math.abs(r.enu.z), Math.abs(r.enu.z) < 10 ? 1 : 0)}`
    haloText(ctx, txt, xb + 13, yc - 6, t, { font: `600 9px ${t.fontMono}` })
  }
}
