import { useCallback, useRef } from 'react'
import { Canvas2D, type DrawFn } from '@/components/sim/Canvas2D'
import { SimLabel } from '@/components/sim/Controls'
import { haloText } from '@/components/sim/mapDraw'
import { toRad } from '@/core/geometry'
import { distanceToThresholdNm, glidePathAngles, GS_COVERAGE, GS_FULL_SCALE_DDM, GS_MODEL_AMPLITUDE, ILS_CATEGORIES, markerHalfAngleDeg, MARKER_DISTANCE_NM, onPathHeightFt } from '@/core/ils'
import { FT_PER_NM } from '@/core/units'
import { useSampled } from '@/hooks/useSampled'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { withAlpha } from '@/lib/color'
import { drawToneSwatch, paintField } from './lobes'
import { useIls } from './state'

const NICE_FT = [1000, 2000, 3000, 4000, 5000, 6000, 8000, 10000, 12000]

/** Seen from the side along the centreline: the glideslope lobes, heights exaggerated. */
export function SideView() {
  const { engine } = useIls()
  const scale = useRef({ farNm: 11, topFt: 4000, exaggeration: 10 })
  const fieldRef = useRef<{ key: string; canvas: HTMLCanvasElement | null }>({ key: '', canvas: null })

  const draw: DrawFn = useCallback(
    (ctx, { width, height, dpr, tokens: t }) => {
      const e = engine
      const s = e.site
      const d = e.distanceToThresholdNm
      const h = e.heightAboveRunwayFt
      const sc = scale.current
      const wantFar = Math.max(d + 1, 3)
      if (wantFar > sc.farNm || wantFar < sc.farNm - 4) sc.farNm = Math.min(30, Math.ceil(wantFar))
      const wantTop = Math.max(h * 1.3, 1000)
      if (wantTop > sc.topFt || wantTop < sc.topFt * 0.4) sc.topFt = NICE_FT.find((v) => v >= wantTop) ?? 12000
      const nearNm = -1.9
      const padL = 44
      const padR = 10
      const padT = 12
      const padB = 26
      const w = width - padL - padR
      const hh = height - padT - padB
      const xOf = (nm: number) => padL + ((sc.farNm - nm) / (sc.farNm - nearNm)) * w
      const yOf = (ft: number) => padT + hh - (ft / sc.topFt) * hh
      const nmOf = (sx: number) => sc.farNm - ((sx - padL) / w) * (sc.farNm - nearNm)
      const ftOf = (sy: number) => ((padT + hh - sy) / hh) * sc.topFt
      const exaggeration = hh / sc.topFt / (w / ((sc.farNm - nearNm) * FT_PER_NM))

      ctx.fillStyle = t['sim-sky']
      ctx.fillRect(0, 0, width, height)
      const key = `${width}x${height}:${dpr}:${sc.farNm}:${sc.topFt}:${t.isDark}`
      if (fieldRef.current.key !== key) {
        fieldRef.current = {
          key,
          canvas: paintField(width, height, dpr, t, 5, (sx, sy) => {
            if (sx < padL || sy > padT + hh) return null
            const nm = nmOf(sx)
            if (nm < -((s.gpipFt - 1) / FT_PER_NM)) return null
            const p = { x: s.threshold.x - nm, y: 0 }
            const ddm = e.gsDdmAt(p, s.elevationFt + ftOf(sy))
            const fade = nm > GS_COVERAGE.rangeNm ? 0.35 : 1
            return { ddm, fade }
          }, GS_FULL_SCALE_DDM),
        }
      }
      if (fieldRef.current.canvas) ctx.drawImage(fieldRef.current.canvas, 0, 0, width, height)

      // Height grid.
      ctx.font = `500 10px ${t.fontMono}`
      ctx.fillStyle = t['sim-muted']
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      const step = sc.topFt <= 2000 ? 500 : sc.topFt <= 5000 ? 1000 : 2000
      ctx.strokeStyle = withAlpha(t['sim-grid-strong'], 0.6)
      ctx.lineWidth = 1
      for (let f = 0; f <= sc.topFt; f += step) {
        ctx.beginPath()
        ctx.moveTo(padL, yOf(f))
        ctx.lineTo(padL + w, yOf(f))
        ctx.stroke()
        ctx.fillText(f === 0 ? '0 ft' : f >= 1000 ? `${f / 1000}k` : `${f}`, padL - 4, yOf(f))
      }
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      const nmStep = sc.farNm > 16 ? 5 : sc.farNm > 6 ? 2 : 1
      for (let nm = 0; nm <= sc.farNm; nm += nmStep) ctx.fillText(`${nm}`, xOf(nm), padT + hh + 4)
      ctx.textAlign = 'right'
      ctx.fillText('NM to the runway', padL + w, padT + hh + 14)

      // Glide paths: the real one and the false ones above it.
      const gx = xOf(-s.gpipFt / FT_PER_NM)
      const gy = yOf(0)
      for (const gp of glidePathAngles(s.pathDeg)) {
        const tanA = Math.tan(toRad(gp.angleDeg))
        const endNm = Math.min(sc.farNm, (sc.topFt / tanA - s.gpipFt) / FT_PER_NM)
        const ex = xOf(endNm)
        const ey = yOf((endNm * FT_PER_NM + s.gpipFt) * tanA)
        ctx.save()
        ctx.strokeStyle = gp.sensing === 'true' ? t['sim-ink'] : t['sim-warning']
        ctx.lineWidth = gp.sensing === 'true' ? 2 : 1.5
        if (gp.sensing !== 'true') ctx.setLineDash([6, 4])
        ctx.beginPath()
        ctx.moveTo(gx, gy)
        ctx.lineTo(ex, ey)
        ctx.stroke()
        ctx.restore()
        // Labels at different heights so they never sit on top of each other.
        const frac = gp.sensing === 'true' ? 0.3 : gp.sensing === 'reversed' ? 0.8 : 0.55
        const lh = sc.topFt * frac
        const lnm = (lh / tanA - s.gpipFt) / FT_PER_NM
        const txt = gp.sensing === 'true' ? `Glide path ${gp.angleDeg}°` : gp.sensing === 'reversed' ? `False path ${gp.angleDeg}° (reversed)` : `False path ${gp.angleDeg}°`
        if (lnm < sc.farNm - 0.3 && lnm > 0) haloText(ctx, txt, xOf(lnm) + 6, yOf(lh), t, { color: gp.sensing === 'true' ? t['sim-ink'] : t['sim-warning'], font: `600 10px ${t.fontSans}`, baseline: 'middle' })
      }
      // Full-scale needle edges of the real path.
      const delta = Math.asin(GS_FULL_SCALE_DDM / GS_MODEL_AMPLITUDE) / Math.PI
      for (const k of [1 - delta, 1 + delta]) {
        const tanA = Math.tan(toRad(s.pathDeg * k))
        const endNm = Math.min(sc.farNm, (sc.topFt / tanA - s.gpipFt) / FT_PER_NM)
        ctx.save()
        ctx.strokeStyle = withAlpha(t['sim-ink'], 0.4)
        ctx.setLineDash([3, 4])
        ctx.beginPath()
        ctx.moveTo(gx, gy)
        ctx.lineTo(xOf(endNm), yOf((endNm * FT_PER_NM + s.gpipFt) * tanA))
        ctx.stroke()
        ctx.restore()
      }
      // Glideslope coverage limit.
      if (sc.farNm > GS_COVERAGE.rangeNm) {
        const cx = xOf(GS_COVERAGE.rangeNm)
        ctx.save()
        ctx.strokeStyle = t['sim-muted']
        ctx.setLineDash([2, 3])
        ctx.beginPath()
        ctx.moveTo(cx, padT)
        ctx.lineTo(cx, padT + hh)
        ctx.stroke()
        ctx.restore()
        ctx.save()
        ctx.translate(cx - 4, padT + hh - 6)
        ctx.rotate(-Math.PI / 2)
        haloText(ctx, 'Glideslope coverage ends', 0, 0, t, { color: t['sim-muted'], font: `500 10px ${t.fontSans}` })
        ctx.restore()
      }

      // Markers: beams pointing straight up, widening with height.
      const lit = e.receiver.marker
      for (const [k, letter, tok] of [
        ['outer', 'O', 'marker-outer'],
        ['middle', 'M', 'marker-middle'],
        ['inner', 'I', 'marker-inner'],
      ] as const) {
        const mnm = MARKER_DISTANCE_NM[k]
        if (mnm > sc.farNm) continue
        const tanA = Math.tan(toRad(markerHalfAngleDeg(s, k)))
        // Draw each beam up to a little above the glide path at the marker, the part that matters.
        const topH = Math.min(sc.topFt, onPathHeightFt(s, mnm) * 1.6)
        const spread = (topH * tanA) / FT_PER_NM
        ctx.fillStyle = withAlpha(t[tok === 'marker-inner' ? 'sim-neutral' : tok], lit === k ? 0.45 : 0.14)
        ctx.beginPath()
        ctx.moveTo(xOf(mnm), yOf(0))
        ctx.lineTo(xOf(mnm + spread), yOf(topH))
        ctx.lineTo(xOf(mnm - spread), yOf(topH))
        ctx.closePath()
        ctx.fill()
        ctx.strokeStyle = withAlpha(t['sim-ink'], 0.35)
        ctx.lineWidth = 1
        ctx.stroke()
        haloText(ctx, letter, xOf(mnm), yOf(0) - 6, t, { align: 'center', font: `700 10px ${t.fontSans}` })
      }

      // Decision height.
      const dh = e.dhFt
      if (dh !== null && dh < sc.topFt) {
        const x0 = xOf(Math.min(sc.farNm, 2.2))
        ctx.save()
        ctx.strokeStyle = t['sim-alert']
        ctx.setLineDash([5, 4])
        ctx.beginPath()
        ctx.moveTo(x0, yOf(dh))
        ctx.lineTo(xOf(nearNm), yOf(dh))
        ctx.stroke()
        ctx.restore()
        const cat = e.weather === 'clear' ? ILS_CATEGORIES.I.label : ILS_CATEGORIES[e.weather].label
        haloText(ctx, `Minimums ${dh} ft (${cat})`, x0 - 4, yOf(dh), t, { color: t['sim-alert'], font: `600 10px ${t.fontSans}`, align: 'right', baseline: 'middle' })
      }

      // Ground and runway.
      ctx.fillStyle = t['sim-terrain']
      ctx.fillRect(padL, yOf(0), w, 3)
      ctx.fillStyle = t['sim-ink']
      ctx.fillRect(xOf(0), yOf(0) - 1, xOf(-s.runway.lengthFt / FT_PER_NM) - xOf(0), 5)
      ctx.fillStyle = t['sim-signal']
      const mastX = xOf(-1000 / FT_PER_NM)
      ctx.fillRect(mastX - 1.5, yOf(0) - 14, 3, 14)

      // Trail and aircraft.
      ctx.strokeStyle = withAlpha(t['primary'], 0.65)
      ctx.lineWidth = 1.5
      ctx.beginPath()
      e.trail.forEach((p, i) => {
        const q = { x: xOf(distanceToThresholdNm(s, p.pos)), y: yOf(p.heightFt) }
        if (i === 0) ctx.moveTo(q.x, q.y)
        else ctx.lineTo(q.x, q.y)
      })
      ctx.stroke()
      drawSidePlane(ctx, xOf(d), yOf(Math.max(0, h)), t)

      drawToneSwatch(ctx, padL + 6, padT + 6, 12, '90', t)
      haloText(ctx, '90 Hz louder', padL + 23, padT + 12, t, { font: `600 11px ${t.fontSans}`, baseline: 'middle' })
      // Inside the 150 Hz region on the left, clear of the minimums line.
      const farPathFt = (sc.farNm * FT_PER_NM + s.gpipFt) * Math.tan(toRad(s.pathDeg))
      const ly150 = yOf(Math.min(sc.topFt * 0.9, Math.max((dh ?? 0) + sc.topFt * 0.12, farPathFt * 0.45)))
      drawToneSwatch(ctx, padL + 6, ly150 - 6, 12, '150', t)
      haloText(ctx, '150 Hz louder', padL + 23, ly150, t, { font: `600 11px ${t.fontSans}`, baseline: 'middle' })
      sc.exaggeration = exaggeration
    },
    [engine],
  )

  const label = useSampled(() => {
    const e = engine
    const dev = e.heightAboveRunwayFt - e.onPathHeightFt
    return `Side view of the glideslope, heights exaggerated. CNS101 is ${e.distanceToThresholdNm.toFixed(1)} nautical miles out at ${Math.round(e.heightAboveRunwayFt)} feet, ${Math.abs(Math.round(dev))} feet ${dev > 0 ? 'above' : 'below'} the glide path.`
  }, 1000)

  const ex = useSampled(() => Math.round(scale.current.exaggeration), 500)
  return (
    <div className="relative">
      <Canvas2D draw={draw} label={label} className="aspect-[4/3] w-full rounded-lg border bg-sim-sky" />
      <div className="pointer-events-none absolute top-2 right-2">
        <SimLabel icon="none">Heights exaggerated ×{ex}</SimLabel>
      </div>
    </div>
  )
}

function drawSidePlane(ctx: CanvasRenderingContext2D, x: number, y: number, t: ThemeTokens) {
  ctx.save()
  ctx.translate(x, y)
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
