import { useCallback, useRef } from 'react'
import { Canvas2D, type DrawFn } from '@/components/sim/Canvas2D'
import { SimLabel } from '@/components/sim/Controls'
import { drawAircraftIcon, haloText } from '@/components/sim/mapDraw'
import { C_M_PER_NS, contourSegments, ELLIPSE_95, errorEllipse, tdoaToRangeDifferenceM, timeDifferenceNs, type Segment } from '@/core/mlat'
import { dist3, toRad, type Vec2 } from '@/core/geometry'
import { METRES_PER_FT, METRES_PER_NM } from '@/core/units'
import { useSampled } from '@/hooks/useSampled'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { drawTrackSymbol } from '@/instruments'
import { withAlpha } from '@/lib/color'
import { formatM } from './accuracy'
import type { MlatFix, ReceiverId } from './engine'
import { useMlat, useMlatState } from './state'

/** Half-widths of the close-up window, m. */
const LEVELS = [50, 100, 250, 500, 1000, 2500, 5000]

interface LocalCurve {
  a: ReceiverId
  b: ReceiverId
  segs: Segment[]
  biased: boolean
  readyUs: number
}

/** Curves of every receiver pair near the true position, as offsets from it (east, north, m). */
function localCurves(fix: MlatFix, halfM: number): LocalCurve[] {
  const c = fix.trueEnu
  const hM = fix.heightM ?? fix.reportedAltFt * METRES_PER_FT
  const b = { minX: -halfM * 1.25, maxX: halfM * 1.25, minY: -halfM * 1.25, maxY: halfM * 1.25 }
  const out: LocalCurve[] = []
  for (let i = 0; i < fix.stamps.length; i++)
    for (let j = i + 1; j < fix.stamps.length; j++) {
      const si = fix.stamps[i]
      const sj = fix.stamps[j]
      const target = tdoaToRangeDifferenceM(timeDifferenceNs(si.stampUs, sj.stampUs))
      const segs = contourSegments(
        (dx, dy) => {
          const p = { x: c.x + dx, y: c.y + dy, z: hM }
          return dist3(p, si.enu) - dist3(p, sj.enu) - target
        },
        b,
        36,
        36,
      )
      out.push({ a: si.id, b: sj.id, segs, biased: si.clockErrorNs !== 0 || sj.clockErrorNs !== 0, readyUs: Math.max(si.travelUs, sj.travelUs) })
    }
  return out
}

function niceStep(raw: number): number {
  const p = 10 ** Math.floor(Math.log10(raw))
  const m = raw / p
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p
}

/** Arrow on the window edge pointing at something outside it. */
function edgeArrow(ctx: CanvasRenderingContext2D, from: Vec2, dir: Vec2, halfPx: number, text: string, color: string, t: ThemeTokens, row: number) {
  const len = Math.hypot(dir.x, dir.y) || 1
  const ux = dir.x / len
  const uy = dir.y / len
  const k = (halfPx - 18) / Math.max(Math.abs(ux), Math.abs(uy))
  const x = from.x + ux * k
  const y = from.y - uy * k
  ctx.save()
  ctx.fillStyle = color
  ctx.translate(x, y)
  ctx.rotate(Math.atan2(-uy, ux))
  ctx.beginPath()
  ctx.moveTo(9, 0)
  ctx.lineTo(-4, -6)
  ctx.lineTo(-4, 6)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
  const alignRight = x > from.x
  haloText(ctx, text, x + (alignRight ? -14 : 14), y + (y > from.y ? -12 : 16) + row * 13, t, {
    color,
    align: alignRight ? 'right' : 'left',
    font: `600 10px ${t.fontSans}`,
  })
}

export function CloseUp() {
  const { engine, replayRef } = useMlat()
  const selectedId = useMlatState((s) => s.selectedId)
  const level = useRef(2)
  const cache = useRef<{ key: string; curves: LocalCurve[] } | null>(null)

  const draw: DrawFn = useCallback(
    (ctx, { width, height, tokens: t }) => {
      ctx.fillStyle = t['sim-bg']
      ctx.fillRect(0, 0, width, height)
      const rp = replayRef.current
      const fix = rp?.fix ?? (selectedId ? engine.fixes.get(selectedId) : undefined)
      if (!fix) {
        ctx.fillStyle = t['sim-muted']
        ctx.font = `500 13px ${t.fontSans}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('Waiting for the aircraft to transmit…', width / 2, height / 2)
        return
      }
      const sigmaM = C_M_PER_NS * engine.params.timingNoiseNs
      const cov2 = fix.dop ? [[fix.dop.cov[0][0], fix.dop.cov[0][1]], [fix.dop.cov[1][0], fix.dop.cov[1][1]]].map((r) => r.map((v) => v * sigmaM * sigmaM)) : null
      const ell = cov2 ? errorEllipse(cov2, ELLIPSE_95) : null
      const pos = fix.solution.position
      const errM = pos ? Math.hypot(pos.x - fix.trueEnu.x, pos.y - fix.trueEnu.y) : 0
      // Zoom with hysteresis: grow at once when needed, shrink only when things fit comfortably.
      const need = Math.max(ell?.semiMajorM ?? 0, errM < 6000 ? errM : 0, 12) * 1.3
      let L = level.current
      while (L < LEVELS.length - 1 && LEVELS[L] < need) L++
      while (L > 0 && LEVELS[L - 1] > need * 1.5) L--
      level.current = L
      const W = LEVELS[L]
      const half = Math.min(width, height) / 2
      const s = half / W
      const cx = width / 2
      const cy = height / 2
      const toS = (p: Vec2) => ({ x: cx + p.x * s, y: cy - p.y * s })

      // Grid.
      const step = niceStep(W / 2.5)
      ctx.strokeStyle = t['sim-grid']
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let v = -Math.ceil((width / 2 / s) / step) * step; v <= width / 2 / s; v += step) {
        ctx.moveTo(cx + v * s, 0)
        ctx.lineTo(cx + v * s, height)
      }
      for (let v = -Math.ceil((height / 2 / s) / step) * step; v <= height / 2 / s; v += step) {
        ctx.moveTo(0, cy - v * s)
        ctx.lineTo(width, cy - v * s)
      }
      ctx.stroke()

      // Curves.
      const key = `${fix.seq}:${W}`
      if (!cache.current || cache.current.key !== key) cache.current = { key, curves: localCurves(fix, W) }
      const shown = cache.current.curves.filter((c) => !rp || rp.tUs >= c.readyUs)
      ctx.save()
      for (const c of shown) {
        ctx.strokeStyle = withAlpha(t['sim-signal-2'], 0.9)
        ctx.lineWidth = c.biased ? 2 : 1.5
        ctx.setLineDash(c.biased ? [6, 4] : [])
        ctx.beginPath()
        for (const [a, b] of c.segs) {
          const sa = toS(a)
          const sb = toS(b)
          ctx.moveTo(sa.x, sa.y)
          ctx.lineTo(sb.x, sb.y)
        }
        ctx.stroke()
      }
      ctx.setLineDash([])
      ctx.restore()
      // Pair labels where each curve leaves the window (only when there are few curves).
      if (shown.length <= 6) {
        const used: Vec2[] = []
        for (const c of shown) {
          let best: Vec2 | null = null
          let bd = -1
          for (const [a] of c.segs) {
            if (Math.abs(a.x) > W * 0.92 || Math.abs(a.y) > W * 0.92) continue
            const d = Math.max(Math.abs(a.x), Math.abs(a.y))
            if (d > bd && !used.some((u) => Math.hypot(u.x - a.x, u.y - a.y) < W * 0.18)) {
              bd = d
              best = a
            }
          }
          if (best) {
            used.push(best)
            const sp = toS(best)
            haloText(ctx, `${c.a}–${c.b}`, sp.x + 4, sp.y - 4, t, { color: t['sim-signal-2'], font: `600 10px ${t.fontSans}` })
          }
        }
      }

      // 95% ellipse of the timing noise, around the truth.
      if (ell && ell.semiMajorM * s > 1.5) {
        ctx.save()
        ctx.translate(cx, cy)
        ctx.rotate(toRad(ell.majorBearingDeg))
        ctx.strokeStyle = withAlpha(t['sim-ink'], 0.7)
        ctx.lineWidth = 1.2
        ctx.setLineDash([3, 3])
        ctx.beginPath()
        // Major axis along the bearing: north-up screen, so the ellipse's "y" is the major axis.
        ctx.ellipse(0, 0, Math.max(1, ell.semiMinorM * s), Math.max(1, ell.semiMajorM * s), 0, 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
      }

      // Scatter of recent fixes (offsets from the truth at the time).
      if (!rp) {
        const list = engine.scatter.get(fix.aircraftId) ?? []
        list.forEach((p, i) => {
          const sp = toS(p)
          ctx.fillStyle = withAlpha(t['sim-signal'], 0.25 + 0.6 * ((i + 1) / list.length))
          ctx.beginPath()
          ctx.arc(sp.x, sp.y, 2.2, 0, Math.PI * 2)
          ctx.fill()
        })
      }

      // Truth.
      const a = engine.getAircraft(fix.aircraftId)
      drawAircraftIcon(ctx, { x: cx, y: cy }, a?.headingDeg ?? 0, t, { size: 11 })

      // MLAT fix and the other candidate(s).
      let row = 0
      const complete = !rp || rp.tUs >= Math.max(...fix.stamps.map((x) => x.travelUs))
      if (complete && pos) {
        const off = { x: pos.x - fix.trueEnu.x, y: pos.y - fix.trueEnu.y }
        if (Math.max(Math.abs(off.x), Math.abs(off.y)) < W * 0.95) {
          const sp = toS(off)
          drawTrackSymbol(ctx, 'mlat', sp.x, sp.y, t['sim-signal'])
          haloText(ctx, `MLAT ${formatM(errM)} off`, sp.x + 9, sp.y + 14, t, { color: t['sim-signal'], font: `600 10px ${t.fontSans}` })
        } else edgeArrow(ctx, { x: cx, y: cy }, off, half, `MLAT fix ${formatM(errM)} away`, t['sim-signal'], t, row++)
        for (const cnd of fix.solution.candidates) {
          if (dist3(cnd, pos) < 1) continue
          const o = { x: cnd.x - fix.trueEnu.x, y: cnd.y - fix.trueEnu.y }
          const d = Math.hypot(o.x, o.y)
          if (Math.max(Math.abs(o.x), Math.abs(o.y)) < W * 0.95) {
            const sp = toS(o)
            drawTrackSymbol(ctx, 'mlat', sp.x, sp.y, t['sim-warning'])
          } else edgeArrow(ctx, { x: cx, y: cy }, o, half, `Other possible position ${formatM(d)} away`, t['sim-warning'], t, row++)
        }
      }
      // ADS-B report.
      if (!rp) {
        const o = { x: (fix.adsbPos.x - fix.truePos.x) * METRES_PER_NM, y: (fix.adsbPos.y - fix.truePos.y) * METRES_PER_NM }
        const d = Math.hypot(o.x, o.y)
        if (Math.max(Math.abs(o.x), Math.abs(o.y)) < W * 0.95) {
          const sp = toS(o)
          drawTrackSymbol(ctx, 'adsb', sp.x, sp.y, t['sim-ink'])
        } else edgeArrow(ctx, { x: cx, y: cy }, o, half, `ADS-B report ${formatM(d)} away`, t['sim-alert'], t, row++)
      }

      // Scale bar (metres).
      const barM = niceStep(W / 2)
      const px = barM * s
      const x0 = 12
      const y0 = height - 14
      ctx.strokeStyle = t['sim-ink']
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(x0, y0 - 4)
      ctx.lineTo(x0, y0)
      ctx.lineTo(x0 + px, y0)
      ctx.lineTo(x0 + px, y0 - 4)
      ctx.stroke()
      ctx.fillStyle = t['sim-ink']
      ctx.font = `600 10px ${t.fontSans}`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'bottom'
      ctx.fillText(formatM(barM), x0 + 4, y0 - 4)
    },
    [engine, replayRef, selectedId],
  )

  const info = useSampled(() => {
    const f = selectedId ? engine.fixes.get(selectedId) : undefined
    return { half: LEVELS[level.current], id: f ? engine.getAircraft(f.aircraftId)?.callsign ?? f.aircraftId : null, err: f?.errorM ?? NaN, status: f?.solution.status ?? null }
  }, 400)

  const label = info.id
    ? `Close-up of ${info.half * 2} metres around ${info.id}. The true position is in the middle. ${info.status === 'ok' ? `The MLAT fix is ${formatM(info.err)} away.` : info.status === 'ambiguous' ? 'Two positions fit the times.' : 'There is no MLAT fix.'}`
    : 'Close-up view, waiting for a signal.'

  return (
    <div className="relative">
      <Canvas2D draw={draw} label={label} className="aspect-square w-full rounded-lg border bg-sim-bg" />
      <div className="pointer-events-none absolute top-2 left-2">
        <SimLabel icon="none">Zoomed in: {formatM(info.half * 2)} across</SimLabel>
      </div>
    </div>
  )
}
