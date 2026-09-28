import { useCallback, useRef } from 'react'
import { Canvas2D, type DrawFn } from '@/components/sim/Canvas2D'
import { haloText } from '@/components/sim/mapDraw'
import { bearingDeg, destinationPoint } from '@/core/geometry'
import { earthDropFt } from '@/core/propagation'
import { FT_PER_NM } from '@/core/units'
import { useSampled } from '@/hooks/useSampled'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { withAlpha } from '@/lib/color'
import { useDme } from './state'

const NICE = [2, 5, 10, 20, 25, 50, 100, 150, 200, 250]

/**
 * Side view through the station and the aircraft. Heights are exaggerated;
 * the ground drops away with the curve of the Earth (effective radius used
 * for radio), so a straight radio path stays straight on screen.
 */
export function SideView() {
  const { engine } = useDme()
  const scale = useRef({ maxNm: 0, maxFt: 0 })

  const draw: DrawFn = useCallback(
    (ctx, { width, height, tokens: t }) => {
      const e = engine
      const g = e.ownGroundNm
      const alt = e.own.altitudeFt
      // Auto-scale with hysteresis so the axes do not flicker.
      const sc = scale.current
      const wantNm = Math.max(g * 1.4, 4)
      if (wantNm > sc.maxNm || wantNm < sc.maxNm * 0.45) sc.maxNm = NICE.find((n) => n >= wantNm) ?? 250
      const wantFt = Math.max(alt * 1.6, 6000)
      if (wantFt > sc.maxFt || wantFt < sc.maxFt * 0.45) sc.maxFt = Math.ceil(wantFt / 5000) * 5000
      const maxNm = sc.maxNm
      const dropMax = earthDropFt(maxNm)
      const minFt = -Math.min(dropMax, sc.maxFt * 0.8)
      const padL = 46
      const padR = 16
      const padT = 28
      const padB = 30
      const w = width - padL - padR
      const h = height - padT - padB
      const xOf = (nm: number) => padL + (nm / maxNm) * w
      const yOf = (ft: number) => padT + h - ((ft - minFt) / (sc.maxFt - minFt)) * h

      ctx.fillStyle = t['sim-sky']
      ctx.fillRect(0, 0, width, height)

      // Grid and height axis.
      ctx.strokeStyle = t['sim-grid']
      ctx.lineWidth = 1
      ctx.font = `500 10px ${t.fontMono}`
      ctx.fillStyle = t['sim-muted']
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      const ftStep = sc.maxFt <= 10000 ? 2000 : sc.maxFt <= 25000 ? 5000 : 10000
      for (let f = 0; f <= sc.maxFt; f += ftStep) {
        const y = yOf(f)
        ctx.beginPath()
        ctx.moveTo(padL, y)
        ctx.lineTo(padL + w, y)
        ctx.stroke()
        ctx.fillText(f === 0 ? '0 ft' : `${f / 1000}k`, padL - 4, y)
      }
      const nmStep = maxNm <= 5 ? 1 : maxNm <= 25 ? 5 : maxNm <= 100 ? 20 : 50
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      for (let d = 0; d <= maxNm + 1e-9; d += nmStep) ctx.fillText(`${d} NM`, xOf(d), padT + h + 6)

      // Ground: terrain along the bearing to the aircraft, dropping with the Earth's curve.
      const brg = g > 0.01 ? bearingDeg(e.station.pos, e.own.pos) : 90
      const N = 160
      ctx.beginPath()
      ctx.moveTo(xOf(0), yOf(minFt))
      for (let i = 0; i <= N; i++) {
        const d = (i / N) * maxNm
        const p = destinationPoint(e.station.pos, brg, d)
        ctx.lineTo(xOf(d), yOf(e.terrain(p) - earthDropFt(d)))
      }
      ctx.lineTo(xOf(maxNm), yOf(minFt))
      ctx.closePath()
      ctx.fillStyle = t['sim-land']
      ctx.fill()
      ctx.strokeStyle = t['sim-terrain-high']
      ctx.lineWidth = 1.5
      ctx.stroke()

      // Station mast.
      const sx = xOf(0)
      const sy = yOf(e.station.heightFt)
      ctx.strokeStyle = t['sim-signal']
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(sx, yOf(30))
      ctx.lineTo(sx, sy - 6)
      ctx.stroke()
      ctx.fillStyle = t['sim-signal']
      ctx.fillRect(sx - 5, sy - 10, 10, 6)
      haloText(ctx, 'DME', sx + 7, sy - 10, t, { font: `600 11px ${t.fontSans}` })

      // Aircraft (height above the flat plane through the station = altitude minus the Earth's drop).
      const ax = xOf(g)
      const ay = yOf(alt - earthDropFt(g))
      const groundY = yOf(e.terrain(e.own.pos) - earthDropFt(g))
      // Height bracket.
      ctx.strokeStyle = t['sim-muted']
      ctx.lineWidth = 1
      ctx.setLineDash([3, 3])
      ctx.beginPath()
      ctx.moveTo(ax, ay)
      ctx.lineTo(ax, groundY)
      ctx.stroke()
      ctx.setLineDash([])
      // Ground distance bracket along the bottom.
      const by = padT + h - 4
      ctx.strokeStyle = t['sim-ink']
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(sx, by - 4)
      ctx.lineTo(sx, by)
      ctx.lineTo(ax, by)
      ctx.lineTo(ax, by - 4)
      ctx.stroke()

      // Slant range: the straight radio path the DME measures.
      const blocked = !e.heard
      ctx.strokeStyle = blocked ? t['sim-alert'] : t['primary']
      ctx.lineWidth = 2.5
      ctx.setLineDash(blocked ? [6, 4] : [])
      ctx.beginPath()
      ctx.moveTo(sx, sy)
      ctx.lineTo(ax, ay)
      ctx.stroke()
      ctx.setLineDash([])
      if (blocked) {
        const wd = e.los.worstDistanceNm
        const wy = yOf(e.terrain(e.los.worstPoint) - earthDropFt(wd))
        ctx.fillStyle = t['sim-alert']
        ctx.beginPath()
        ctx.arc(xOf(wd), wy, 4.5, 0, Math.PI * 2)
        ctx.fill()
        haloText(ctx, 'Hill or horizon in the way', xOf(wd) + 6, wy - 8, t, { color: t['sim-alert'] })
      }
      drawSideAircraft(ctx, ax, ay, e.own.headingDeg, brg, t)

      // Key: the three distances, as a small legend instead of labels on the lines (they would collide).
      const slant = e.ownSlantNm
      const hNm = e.ownHeightFt / FT_PER_NM
      drawKey(ctx, padL + 6, 40, [
        { kind: 'slant', text: `Slant range ${slant.toFixed(1)} NM: what DME measures`, color: blocked ? t['sim-alert'] : t['primary'] },
        { kind: 'ground', text: `Ground distance ${g.toFixed(1)} NM`, color: t['sim-ink'] },
        { kind: 'height', text: `Height ${Math.round(e.ownHeightFt).toLocaleString('en-US')} ft = ${hNm.toFixed(2)} NM`, color: t['sim-muted'] },
      ], t)

      // To-scale inset: the real shape of the triangle.
      drawToScale(ctx, width - padR - 108, width < 560 ? 40 + 3 * 16 + 14 : padT + 4, 104, 58, g, hNm, t)
    },
    [engine],
  )

  const label = useSampled(() => {
    const e = engine
    return `Side view, heights exaggerated. CNS101 is ${e.ownGroundNm.toFixed(1)} nautical miles from the DME over the ground and ${Math.round(e.ownHeightFt)} feet above it, so the slant range the DME measures is ${e.ownSlantNm.toFixed(1)} nautical miles.${e.heard ? '' : ' A hill or the curve of the Earth blocks the radio path.'}`
  }, 1000)

  return <Canvas2D draw={draw} label={label} className="aspect-[4/3] w-full rounded-lg border bg-sim-sky" />
}

function drawKey(ctx: CanvasRenderingContext2D, x: number, y: number, rows: { kind: 'slant' | 'ground' | 'height'; text: string; color: string }[], t: ThemeTokens) {
  ctx.save()
  ctx.font = `600 11px ${t.fontSans}`
  const w = Math.max(...rows.map((r) => ctx.measureText(r.text).width)) + 34
  ctx.fillStyle = withAlpha(t['sim-bg'], 0.9)
  ctx.strokeStyle = t['sim-grid-strong']
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.roundRect(x, y, w, rows.length * 16 + 8, 6)
  ctx.fill()
  ctx.stroke()
  rows.forEach((r, i) => {
    const cy = y + 12 + i * 16
    ctx.strokeStyle = r.color
    ctx.lineWidth = r.kind === 'slant' ? 2.5 : 1.5
    ctx.setLineDash(r.kind === 'height' ? [3, 3] : [])
    ctx.beginPath()
    if (r.kind === 'ground') {
      ctx.moveTo(x + 8, cy - 3)
      ctx.lineTo(x + 8, cy + 1)
      ctx.lineTo(x + 24, cy + 1)
      ctx.lineTo(x + 24, cy - 3)
    } else if (r.kind === 'height') {
      ctx.moveTo(x + 16, cy - 5)
      ctx.lineTo(x + 16, cy + 5)
    } else {
      ctx.moveTo(x + 8, cy + 4)
      ctx.lineTo(x + 24, cy - 4)
    }
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = r.color
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(r.text, x + 30, cy)
  })
  ctx.restore()
}

function drawSideAircraft(ctx: CanvasRenderingContext2D, x: number, y: number, headingDeg: number, awayBrg: number, t: ThemeTokens) {
  // Nose points right when flying away from the station, left when flying toward it.
  const away = Math.cos(((headingDeg - awayBrg) * Math.PI) / 180) >= 0
  const s = away ? 1 : -1
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(s, 1)
  ctx.fillStyle = t['sim-ink']
  ctx.strokeStyle = t['sim-sky']
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(12, 0)
  ctx.lineTo(4, -2.5)
  ctx.lineTo(-9, -2.5)
  ctx.lineTo(-13, -9)
  ctx.lineTo(-16, -9)
  ctx.lineTo(-13, -1)
  ctx.lineTo(-13, 2.5)
  ctx.lineTo(4, 2.5)
  ctx.closePath()
  ctx.stroke()
  ctx.fill()
  ctx.restore()
}

/** Small true-scale drawing of ground distance, height and slant range. */
function drawToScale(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, groundNm: number, heightNm: number, t: ThemeTokens) {
  ctx.save()
  ctx.fillStyle = withAlpha(t['sim-bg'], 0.92)
  ctx.strokeStyle = t['sim-grid-strong']
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, 6)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = t['sim-muted']
  ctx.font = `600 9px ${t.fontSans}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText('True shape (to scale)', x + 6, y + 4)
  const k = Math.min((h - 24) / Math.max(heightNm, 1e-6), (w - 16) / Math.max(groundNm, 1e-6))
  const x0 = x + 8
  const y0 = y + h - 6
  const gx = x0 + groundNm * k
  const hy = y0 - heightNm * k
  ctx.strokeStyle = t['sim-ink']
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(x0, y0)
  ctx.lineTo(gx, y0)
  ctx.lineTo(gx, hy)
  ctx.stroke()
  ctx.strokeStyle = t['primary']
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(x0, y0)
  ctx.lineTo(gx, hy)
  ctx.stroke()
  ctx.restore()
}
