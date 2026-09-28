import { useCallback } from 'react'
import { Canvas2D, type DrawFn } from '@/components/sim/Canvas2D'
import { alongTrackNm, crossTrackNm, toRad } from '@/core/geometry'
import { CONE } from '@/core/vor'
import { FT_PER_NM } from '@/core/units'
import { useSampled } from '@/hooks/useSampled'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { withAlpha } from '@/lib/color'
import { STATION } from './engine'
import { useDvor } from './state'

const SPAN_NM = 12
const TOP_FT = 30000

/**
 * Side view along the aircraft's track: height against distance past the
 * station. The cone is drawn where the aircraft's track cuts through it (if
 * the track passes to one side of the station, the slice is narrower).
 */
export function SideView() {
  const { engine } = useDvor()

  const draw: DrawFn = useCallback(
    (ctx, { width, height, tokens: t }) => {
      const a = engine.aircraft
      const r = engine.last
      ctx.fillStyle = t['sim-sky']
      ctx.fillRect(0, 0, width, height)
      const padL = 44
      const padR = 12
      const padT = 12
      const padB = 24
      const w = width - padL - padR
      const h = height - padT - padB
      const x0 = padL + w / 2
      const xOf = (nm: number) => x0 + (nm / SPAN_NM) * (w / 2)
      const yOf = (ft: number) => padT + h - (ft / TOP_FT) * h
      const ground = yOf(0)

      // Along-track position relative to the station: negative before it, positive after.
      const along = alongTrackNm(a.pos, STATION.pos, a.headingDeg)
      const cross = Math.abs(crossTrackNm(STATION.pos, a.pos, a.headingDeg))
      const stationTopFt = STATION.elevationFt + STATION.antennaFt

      // Cone slices for the swing limit (dashed) and the flag limit (filled).
      const slice = (elevDeg: number) => {
        const pts: { x: number; y: number }[] = []
        for (let ft = 0; ft <= TOP_FT; ft += 250) {
          const rNm = Math.max(0, ft - stationTopFt) / FT_PER_NM / Math.tan(toRad(elevDeg))
          const half = rNm > cross ? Math.sqrt(rNm * rNm - cross * cross) : NaN
          pts.push({ x: half, y: ft })
        }
        return pts
      }
      const drawSlice = (elevDeg: number, fill: boolean) => {
        const pts = slice(elevDeg).filter((p) => Number.isFinite(p.x))
        if (pts.length < 2) return
        ctx.beginPath()
        pts.forEach((p, i) => (i === 0 ? ctx.moveTo(xOf(p.x), yOf(p.y)) : ctx.lineTo(xOf(p.x), yOf(p.y))))
        for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(xOf(-pts[i].x), yOf(pts[i].y))
        ctx.closePath()
        if (fill) {
          ctx.fillStyle = withAlpha(t['sim-warning'], 0.22)
          ctx.fill()
          ctx.strokeStyle = t['sim-warning']
          ctx.lineWidth = 1.5
          ctx.stroke()
        } else {
          ctx.strokeStyle = withAlpha(t['sim-warning'], 0.8)
          ctx.setLineDash([4, 4])
          ctx.lineWidth = 1.2
          ctx.stroke()
          ctx.setLineDash([])
        }
      }
      ctx.save()
      ctx.beginPath()
      ctx.rect(padL, padT, w, h)
      ctx.clip()
      drawSlice(CONE.swingElevationDeg, false)
      drawSlice(CONE.flagElevationDeg, true)
      ctx.restore()

      // Grid and axes.
      ctx.strokeStyle = t['sim-grid']
      ctx.lineWidth = 1
      ctx.fillStyle = t['sim-muted']
      ctx.font = `500 10px ${t.fontMono}`
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      for (let ft = 0; ft <= TOP_FT; ft += 10000) {
        ctx.beginPath()
        ctx.moveTo(padL, yOf(ft))
        ctx.lineTo(padL + w, yOf(ft))
        ctx.stroke()
        ctx.fillText(ft === 0 ? '0' : `${ft / 1000}k ft`, padL - 4, yOf(ft))
      }
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      for (let nm = -SPAN_NM + 4; nm <= SPAN_NM - 4; nm += 4) ctx.fillText(nm === 0 ? 'station' : `${nm > 0 ? '+' : ''}${nm} NM`, xOf(nm), ground + 5)

      // Ground and station.
      ctx.strokeStyle = t['sim-ink']
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(padL, ground)
      ctx.lineTo(padL + w, ground)
      ctx.stroke()
      ctx.fillStyle = t['sim-signal']
      ctx.beginPath()
      ctx.moveTo(x0, ground - 12)
      ctx.lineTo(x0 + 6, ground)
      ctx.lineTo(x0 - 6, ground)
      ctx.closePath()
      ctx.fill()

      // Labels.
      // Legend low on the left, where the cone is narrow.
      ctx.font = `600 10px ${t.fontSans}`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'bottom'
      halo(ctx, t, `Cone of confusion: above ${CONE.flagElevationDeg}°`, padL + 6, ground - 20, t['sim-warning'])
      halo(ctx, t, `- - needle swings: above ${CONE.swingElevationDeg}°`, padL + 6, ground - 6, t['sim-warning'])

      // Aircraft.
      if (Math.abs(along) <= SPAN_NM * 1.05) {
        const ax = xOf(along)
        const ay = yOf(a.altitudeFt)
        ctx.fillStyle = r.cone === 'cone' ? t['sim-alert'] : t['sim-ink']
        ctx.beginPath()
        ctx.moveTo(ax + 11, ay)
        ctx.lineTo(ax - 9, ay - 5)
        ctx.lineTo(ax - 7, ay)
        ctx.lineTo(ax - 9, ay + 4)
        ctx.closePath()
        ctx.fill()
        ctx.font = `600 10px ${t.fontSans}`
        ctx.textAlign = along > SPAN_NM * 0.5 ? 'right' : 'left'
        ctx.textBaseline = 'bottom'
        ctx.fillStyle = t['sim-ink']
        ctx.fillText(`${Math.round(r.elevationDeg)}° up from the station`, ax + (along > SPAN_NM * 0.5 ? -8 : 8), ay - 6)
      } else {
        ctx.fillStyle = t['sim-muted']
        ctx.font = `500 11px ${t.fontSans}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(along < 0 ? '← aircraft still approaching, more than 12 NM out' : 'aircraft more than 12 NM past the station →', x0, padT + h * 0.55)
      }
      if (cross > 0.3) {
        ctx.font = `500 10px ${t.fontSans}`
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        halo(ctx, t, `track passes ${cross.toFixed(1)} NM to the side`, padL + 6, padT + 4, t['sim-muted'])
      }
    },
    [engine],
  )

  const label = useSampled(() => {
    const r = engine.last
    const state = r.cone === 'cone' ? 'inside the cone of confusion: the flag shows OFF' : r.cone === 'swing' ? 'close to the cone: the needle swings' : 'clear of the cone'
    return `Side view: the aircraft is ${Math.round(engine.aircraft.altitudeFt)} feet high, ${r.distanceNm.toFixed(1)} nautical miles from the station, ${Math.round(r.elevationDeg)} degrees up as seen from the station, ${state}.`
  }, 500)

  return <Canvas2D draw={draw} label={label} className="h-56 w-full rounded-lg border" />
}

function halo(ctx: CanvasRenderingContext2D, t: ThemeTokens, text: string, x: number, y: number, color: string) {
  ctx.lineWidth = 3
  ctx.strokeStyle = withAlpha(t['sim-sky'], 0.9)
  ctx.strokeText(text, x, y)
  ctx.fillStyle = color
  ctx.fillText(text, x, y)
}
