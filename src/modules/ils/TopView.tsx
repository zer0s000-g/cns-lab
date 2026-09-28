import { useCallback, useRef } from 'react'
import { Canvas2D, type DrawFn } from '@/components/sim/Canvas2D'
import { SimLabel } from '@/components/sim/Controls'
import { drawAircraftIcon, haloText } from '@/components/sim/mapDraw'
import { toDeg, toRad, type Vec2 } from '@/core/geometry'
import { LOC_FULL_SCALE_DDM, localizerAzimuthDeg, localizerCoverageSeverity, localizerRangeNm } from '@/core/ils'
import { METRES_PER_FT, METRES_PER_NM } from '@/core/units'
import { useSampled } from '@/hooks/useSampled'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { withAlpha } from '@/lib/color'
import { TRUCK_POS, type IlsEngine } from './engine'
import { drawToneSwatch, paintField } from './lobes'
import { useIls } from './state'

const EXAGGERATIONS = [8, 4, 2, 1]

interface TopFrame {
  xMin: number
  xMax: number
  pxX: number
  ex: number
  padL: number
  midY: number
}

/** Choose the visible area: the runway, the aircraft, and a sideways stretch so the narrow course shows. */
function topFrame(e: IlsEngine, width: number, height: number, prev: { xMin: number; ex: number }): TopFrame {
  const padL = 8
  const w = width - 16
  const xMax = e.site.locAntenna.x + 0.35
  const a = e.aircraft.pos
  let xMin = prev.xMin
  const want = Math.min(e.site.threshold.x - 1.5, a.x - 1.2)
  if (want < xMin || want > xMin + 3) xMin = Math.floor(want)
  let pxX = w / (xMax - xMin)
  const half = height / 2 - 18
  const yNeed = Math.max(Math.abs(a.y), 0.05)
  let ex = EXAGGERATIONS.find((k) => yNeed * pxX * k <= half * 0.8) ?? 1
  if (yNeed * pxX * ex > half * 0.8) {
    pxX = (half * 0.8) / yNeed
    xMin = xMax - w / pxX
    ex = 1
  }
  prev.xMin = xMin
  prev.ex = ex
  return { xMin, xMax, pxX, ex, padL, midY: height / 2 }
}

/** Seen from above: the localizer lobes, with sideways distances stretched. */
export function TopView() {
  const { engine } = useIls()
  const frameRef = useRef({ xMin: -12, ex: 4 })
  const fieldRef = useRef<{ key: string; canvas: HTMLCanvasElement | null }>({ key: '', canvas: null })

  const draw: DrawFn = useCallback(
    (ctx, { width, height, dpr, tokens: t }) => {
      const e = engine
      const f = topFrame(e, width, height, frameRef.current)
      const toS = (p: Vec2) => ({ x: f.padL + (p.x - f.xMin) * f.pxX, y: f.midY - p.y * f.pxX * f.ex })
      const toW = (sx: number, sy: number): Vec2 => ({ x: f.xMin + (sx - f.padL) / f.pxX, y: (f.midY - sy) / (f.pxX * f.ex) })
      ctx.fillStyle = t['sim-bg']
      ctx.fillRect(0, 0, width, height)

      // The signal field (cached; repainted when the view or the signal changes).
      const on = !e.locOff
      const key = `${width}x${height}:${dpr}:${f.xMin.toFixed(2)}:${f.pxX.toFixed(3)}:${f.ex}:${e.failures.truck}:${e.faultShiftM.toFixed(1)}:${on}:${t.isDark}`
      if (fieldRef.current.key !== key) {
        fieldRef.current = {
          key,
          canvas: on
            ? paintField(width, height, dpr, t, 5, (sx, sy) => {
                const p = toW(sx, sy)
                if (p.x > e.site.locAntenna.x) return null
                const sev = localizerCoverageSeverity(localizerAzimuthDeg(e.site, p), localizerRangeNm(e.site, p), 0)
                return { ddm: e.locDdmAt(p), fade: sev >= 1 ? 0.25 : 1 - 0.6 * sev }
              }, LOC_FULL_SCALE_DDM)
            : null,
        }
      }
      if (fieldRef.current.canvas) ctx.drawImage(fieldRef.current.canvas, 0, 0, width, height)

      const s = e.site
      // Critical area (dashed box between the runway end and the antenna).
      const caA = toS({ x: s.locAntenna.x - 0.2, y: 0.05 })
      const caB = toS({ x: s.locAntenna.x, y: -0.05 })
      ctx.save()
      ctx.strokeStyle = e.failures.truck ? t['sim-warning'] : t['sim-muted']
      ctx.setLineDash([4, 3])
      ctx.lineWidth = 1.2
      ctx.strokeRect(caA.x, caA.y, caB.x - caA.x, caB.y - caA.y)
      ctx.restore()

      // Runway (width stretched like everything sideways).
      const hw = (s.runway.widthFt * METRES_PER_FT) / 2 / METRES_PER_NM
      const r0 = toS({ x: s.runway.threshold.x, y: hw })
      const r1 = toS({ x: s.runway.end.x, y: -hw })
      ctx.fillStyle = t['sim-ink']
      ctx.fillRect(r0.x, r0.y, r1.x - r0.x, Math.max(3, r1.y - r0.y))
      const crowded = toS(s.locAntenna).x - toS(s.gsAntenna).x < 110
      if (!crowded) haloText(ctx, 'Runway 09', (r0.x + r1.x) / 2, r1.y + 13, t, { align: 'center', font: `600 10px ${t.fontSans}` })

      // Course lines: centreline (true), course the receiver sees (DDM = 0) and the full-scale edges.
      const c0 = toS({ x: f.xMin, y: 0 })
      const c1 = toS({ x: s.locAntenna.x, y: 0 })
      ctx.save()
      ctx.strokeStyle = withAlpha(t['sim-ink'], 0.5)
      ctx.setLineDash([2, 4])
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(c0.x, c0.y)
      ctx.lineTo(c1.x, c1.y)
      ctx.stroke()
      ctx.restore()
      if (on) {
        const bent = e.failures.truck || Math.abs(e.faultShiftM) > 0.5
        for (const target of [0, LOC_FULL_SCALE_DDM, -LOC_FULL_SCALE_DDM]) {
          ctx.save()
          ctx.strokeStyle = target === 0 ? (bent ? t['sim-warning'] : t['sim-ink']) : withAlpha(t['sim-ink'], 0.45)
          ctx.lineWidth = target === 0 ? 2 : 1
          if (target !== 0) ctx.setLineDash([5, 4])
          ctx.beginPath()
          let started = false
          for (let sx = f.padL; sx <= c1.x; sx += 3) {
            const y = ddmContourY(e, toW(sx, 0).x, target)
            if (y === null) {
              started = false
              continue
            }
            const pt = toS({ x: toW(sx, 0).x, y })
            if (!started) ctx.moveTo(pt.x, pt.y)
            else ctx.lineTo(pt.x, pt.y)
            started = true
          }
          ctx.stroke()
          ctx.restore()
        }
        if (bent) {
          // Label the bent course between the outer and middle markers, above the line.
          const lw = s.threshold.x - 2.2
          const yc = ddmContourY(e, lw, 0)
          if (yc !== null && toS({ x: lw, y: 0 }).x > f.padL + 40) haloText(ctx, 'Course the needle shows', toS({ x: lw, y: yc }).x, toS({ x: lw, y: yc }).y - 7, t, { align: 'center', color: t['sim-warning'], font: `600 10px ${t.fontSans}` })
        }
      } else {
        haloText(ctx, 'Localizer switched off by its monitor: no signal', width / 2, f.midY - 30, t, { align: 'center', color: t['sim-alert'] })
      }

      // Antennas and markers.
      const la = toS(s.locAntenna)
      ctx.fillStyle = t['sim-signal']
      ctx.fillRect(la.x - 2, la.y - 16, 4, 32)
      haloText(ctx, 'Localizer', la.x + 4, la.y - 20, t, { align: 'right', font: `600 10px ${t.fontSans}` })
      const ga = toS(s.gsAntenna)
      ctx.beginPath()
      ctx.moveTo(ga.x, ga.y - 6)
      ctx.lineTo(ga.x + 5, ga.y + 4)
      ctx.lineTo(ga.x - 5, ga.y + 4)
      ctx.closePath()
      ctx.fill()
      if (crowded) haloText(ctx, 'Glideslope', ga.x - 8, ga.y - 2, t, { align: 'right', font: `600 10px ${t.fontSans}` })
      else haloText(ctx, 'Glideslope', ga.x, ga.y - 10, t, { align: 'center', font: `600 10px ${t.fontSans}` })
      const lit = e.receiver.marker
      for (const [k, letter, tok] of [
        ['outer', 'O', 'marker-outer'],
        ['middle', 'M', 'marker-middle'],
        ['inner', 'I', 'marker-inner'],
      ] as const) {
        const m = toS(s.markers[k])
        if (m.x < f.padL) continue
        ctx.beginPath()
        ctx.ellipse(m.x, m.y, 6, 9, 0, 0, Math.PI * 2)
        ctx.fillStyle = lit === k ? t[tok] : t['sim-bg']
        ctx.fill()
        ctx.strokeStyle = t['sim-ink']
        ctx.lineWidth = 1.2
        ctx.stroke()
        ctx.fillStyle = lit === k && k !== 'middle' ? t['scope-bg'] : t['sim-ink']
        ctx.font = `700 9px ${t.fontSans}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(letter, m.x, m.y + 0.5)
      }
      if (e.failures.truck) {
        const tp = toS(TRUCK_POS)
        ctx.fillStyle = t['sim-warning']
        ctx.fillRect(tp.x - 5, tp.y - 3, 10, 6)
        if (crowded) {
          ctx.strokeStyle = t['sim-warning']
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(tp.x - 4, tp.y + 3)
          ctx.lineTo(tp.x - 24, tp.y + 22)
          ctx.stroke()
          haloText(ctx, 'Truck', tp.x - 26, tp.y + 30, t, { align: 'right', color: t['sim-warning'], font: `600 10px ${t.fontSans}` })
        } else haloText(ctx, 'Truck', tp.x, tp.y + 16, t, { align: 'center', color: t['sim-warning'], font: `600 10px ${t.fontSans}` })
      }

      // Trail and aircraft.
      ctx.strokeStyle = withAlpha(t['primary'], 0.6)
      ctx.lineWidth = 1.5
      ctx.beginPath()
      e.trail.forEach((p, i) => {
        const q = toS(p.pos)
        if (i === 0) ctx.moveTo(q.x, q.y)
        else ctx.lineTo(q.x, q.y)
      })
      ctx.stroke()
      const a = e.aircraft
      // Heading as it appears with the sideways stretch.
      const hdgScreen = toDeg(Math.atan2(Math.sin(toRad(a.headingDeg)), Math.cos(toRad(a.headingDeg)) * f.ex))
      drawAircraftIcon(ctx, toS(a.pos), hdgScreen, t, { style: 'selected', label: ['CNS101'] })

      // Legend and orientation.
      drawLegend(ctx, width, height, t)
    },
    [engine],
  )

  const label = useSampled(() => {
    const e = engine
    const lat = e.lateralOffsetM
    return `Top view of the localizer. CNS101 is ${e.distanceToThresholdNm.toFixed(1)} nautical miles before the runway, ${Math.abs(lat).toFixed(0)} metres ${lat > 0 ? 'right' : 'left'} of the centreline, where the ${e.receiver.loc.ddm > 0 ? '90' : '150'} hertz tone is stronger.${e.locOff ? ' The localizer is switched off.' : ''}`
  }, 1000)

  const ex = useSampled(() => frameRef.current.ex, 400)
  return (
    <div className="relative">
      <Canvas2D draw={draw} label={label} className="aspect-[4/3] w-full rounded-lg border bg-sim-bg" />
      <div className="pointer-events-none absolute top-2 right-2">
        <SimLabel icon="none">{ex > 1 ? `Sideways stretched ×${ex}` : 'Drawn to scale'}</SimLabel>
      </div>
    </div>
  )
}

/** Lateral position (NM) on the column at world x where the localizer DDM equals `target`, or null. */
function ddmContourY(e: IlsEngine, x: number, target: number): number | null {
  const s = e.site
  const dist = s.locAntenna.x - x
  if (dist < 0.02) return null
  const span = Math.tan(toRad(s.halfSectorDeg * 2.2)) * dist
  const f = (y: number) => e.locDdmAt({ x, y }) - target
  // DDM grows toward the left (north, +y): bisection on [-span, +span].
  let lo = -span
  let hi = span
  if (f(lo) > 0 || f(hi) < 0) return null
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2
    if (f(mid) > 0) hi = mid
    else lo = mid
  }
  return (lo + hi) / 2
}

/** Short labels inside the two lobes (the full legend sits under the views). */
function drawLegend(ctx: CanvasRenderingContext2D, width: number, height: number, t: ThemeTokens) {
  const font = `600 11px ${t.fontSans}`
  drawToneSwatch(ctx, 10, 12, 12, '90', t)
  haloText(ctx, '90 Hz louder', 27, 18, t, { font, baseline: 'middle' })
  drawToneSwatch(ctx, 10, height - 24, 12, '150', t)
  haloText(ctx, '150 Hz louder', 27, height - 18, t, { font, baseline: 'middle' })
  haloText(ctx, 'N', width - 14, height - 12, t, { align: 'center', font: `700 10px ${t.fontSans}` })
  ctx.fillStyle = t['sim-ink']
  ctx.beginPath()
  ctx.moveTo(width - 14, height - 34)
  ctx.lineTo(width - 10, height - 24)
  ctx.lineTo(width - 18, height - 24)
  ctx.closePath()
  ctx.fill()
}
