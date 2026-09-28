import { useCallback, useRef } from 'react'
import { Canvas2D, type DrawFn } from '@/components/sim/Canvas2D'
import { ClockSpeedLabel, SimLabel } from '@/components/sim/Controls'
import { drawStation, haloText } from '@/components/sim/mapDraw'
import type { Vec2 } from '@/core/geometry'
import { inRunwayProtectedArea, movementIsActive, pointAt } from '@/core/surface'
import { METRES_PER_NM } from '@/core/units'
import { useSampled } from '@/hooks/useSampled'
import { mix, withAlpha } from '@/lib/color'
import { drawAirport, drawGreens, drawObjectShape, drawStopBars } from './draw'
import { ARRIVAL_PERIOD_S, phaseText, TURNAROUND_S, type SurfaceEngine, type SurfaceObject } from './engine'
import { FAILING_RECEIVER, MLAT_RECEIVERS, RWY, SMR_SITE } from './layout'
import { useSurface, useSurfaceState, ZOOMS } from './state'

interface View {
  cx: number
  cy: number
  centre: Vec2
  pxPerM: number
  width: number
  height: number
}

const toScreen = (v: View) => (p: Vec2): Vec2 => ({ x: v.cx + (p.x - v.centre.x) * v.pxPerM, y: v.cy - (p.y - v.centre.y) * v.pxPerM })
const toWorld = (v: View, s: Vec2): Vec2 => ({ x: v.centre.x + (s.x - v.cx) / v.pxPerM, y: v.centre.y - (s.y - v.cy) / v.pxPerM })

/** MLAT coverage gap: cells where fewer than three receivers hear a transmitter. */
function coverageGap(engine: SurfaceEngine) {
  const cols = 78
  const rows = 40
  const b = { minX: -1950, maxX: 1950, minY: -800, maxY: 1200 }
  const gap = new Uint8Array(cols * rows)
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const p = { x: b.minX + ((i + 0.5) / cols) * (b.maxX - b.minX), y: b.minY + ((j + 0.5) / rows) * (b.maxY - b.minY) }
      gap[j * cols + i] = engine.receiversHearing(p).length < 3 ? 1 : 0
    }
  return { cols, rows, b, gap }
}

/** Points every 15 m along the rest of an aircraft's route: the green centreline lights switched on ahead of it. */
function greensAhead(o: SurfaceObject): Vec2[] {
  if (!o.path) return []
  const pts: Vec2[] = []
  for (let s = o.s + 30; s < o.path.length && s < o.s + 520; s += 15) pts.push(pointAt(o.path, s).pos)
  return pts
}

function niceMetres(v: number): number {
  const steps = [10, 20, 50, 100, 200, 500, 1000, 2000]
  let best = steps[0]
  for (const s of steps) if (s <= v) best = s
  return best
}

export function AirportMap() {
  const { engine, clock } = useSurface()
  const zoom = useSurfaceState((s) => s.zoom)
  const selectedId = useSurfaceState((s) => s.selectedId)
  const select = useSurfaceState((s) => s.select)
  const view = useRef<View>({ cx: 0, cy: 0, centre: { x: 0, y: 0 }, pxPerM: 1, width: 1, height: 1 })
  const gapCache = useRef<ReturnType<typeof coverageGap> | null>(null)
  const dragging = useRef<string | null>(null)
  const enlarged = useRef(1)

  const draw: DrawFn = useCallback(
    (ctx, { width, height, tokens: t }) => {
      const z = ZOOMS[zoom]
      const pxPerM = width / 2 / z.halfWidthM
      // Narrow screens: fewer words on the map.
      const compact = width < 520
      const v: View = { cx: width / 2, cy: height / 2, centre: z.centre, pxPerM, width, height }
      view.current = v
      const toS = toScreen(v)
      const e = engine
      ctx.fillStyle = t['sim-land']
      ctx.fillRect(0, 0, width, height)
      drawAirport(ctx, toS, pxPerM, {
        grass: t['sim-land'],
        runway: mix(t['sim-neutral'], t['sim-ink'], 0.25),
        taxiway: mix(t['sim-neutral'], t['sim-land'], 0.45),
        marking: t['sim-bg'],
        guideLine: withAlpha(t['sim-warning'], 0.8),
        building: t['sim-terrain-high'],
        buildingEdge: withAlpha(t['sim-ink'], 0.5),
        road: withAlpha(t['sim-neutral'], 0.6),
        text: t['sim-ink'],
        muted: t['sim-muted'],
      }, { labels: true, font: `600 10px ${t.fontSans}`, compact })

      // Runway protected area (inside the holding positions).
      const alert = e.alert
      const pa = { a: toS({ x: RWY.thresholdX - 60, y: RWY.holdingDistM }), b: toS({ x: RWY.endX + 60, y: -RWY.holdingDistM }) }
      ctx.save()
      if (alert.level !== 'none') {
        ctx.fillStyle = withAlpha(alert.level === 'alert' ? t['sim-alert'] : t['sim-warning'], 0.12)
        ctx.fillRect(pa.a.x, pa.a.y, pa.b.x - pa.a.x, pa.b.y - pa.a.y)
      }
      ctx.strokeStyle = alert.level === 'alert' ? t['sim-alert'] : alert.level === 'caution' ? t['sim-warning'] : withAlpha(t['sim-muted'], 0.7)
      ctx.lineWidth = alert.level === 'none' ? 1 : 2
      ctx.setLineDash([6, 4])
      ctx.strokeRect(pa.a.x, pa.a.y, pa.b.x - pa.a.x, pa.b.y - pa.a.y)
      ctx.restore()

      // MLAT coverage gap.
      if (e.env.mlatFailure) {
        if (!gapCache.current) gapCache.current = coverageGap(e)
        const g = gapCache.current
        const cw = ((g.b.maxX - g.b.minX) / g.cols) * pxPerM
        const ch = ((g.b.maxY - g.b.minY) / g.rows) * pxPerM
        ctx.save()
        ctx.fillStyle = withAlpha(t['sim-warning'], 0.14)
        ctx.strokeStyle = withAlpha(t['sim-warning'], 0.55)
        ctx.lineWidth = 1
        let lx = 0
        let ly = 0
        let n = 0
        for (let j = 0; j < g.rows; j++)
          for (let i = 0; i < g.cols; i++) {
            if (!g.gap[j * g.cols + i]) continue
            const c = toS({ x: g.b.minX + (i / g.cols) * (g.b.maxX - g.b.minX), y: g.b.minY + ((j + 1) / g.rows) * (g.b.maxY - g.b.minY) })
            ctx.fillRect(c.x, c.y, cw + 0.5, ch + 0.5)
            // Hatching so the gap does not rely on colour.
            ctx.beginPath()
            ctx.moveTo(c.x, c.y + ch)
            ctx.lineTo(c.x + cw, c.y)
            ctx.stroke()
            if (Math.abs(g.b.minY + ((j + 0.5) / g.rows) * (g.b.maxY - g.b.minY)) < 200) {
              lx += c.x + cw / 2
              ly += c.y + ch / 2
              n++
            }
          }
        ctx.restore()
        if (n) haloText(ctx, 'No MLAT here', lx / n, ly / n - 14, t, { align: 'center', color: t['sim-warning'], font: `700 11px ${t.fontSans}` })
      } else gapCache.current = null

      // Heavy rain: diagonal streaks over the whole map.
      if (e.env.heavyRain) {
        ctx.save()
        ctx.strokeStyle = withAlpha(t['sim-signal-2'], 0.22)
        ctx.lineWidth = 1
        ctx.beginPath()
        for (let x = -height; x < width; x += 14) {
          ctx.moveTo(x, 0)
          ctx.lineTo(x + height * 0.35, height)
        }
        ctx.stroke()
        ctx.restore()
      }

      // Lights: stop bars (red) and the green route ahead of a departing aircraft.
      for (const o of e.objects) {
        if (o.phase === 'taxi-out' || (o.phase === 'lineup' && e.cleared.has(o.id))) drawGreens(ctx, toS, pxPerM, greensAhead(o), t['sim-ok'])
      }
      drawStopBars(ctx, toS, pxPerM, e.stopBars, t['sim-alert'], withAlpha(t['sim-muted'], 0.6))

      // Tower + SMR, MLAT receivers.
      drawStation(ctx, toS(SMR_SITE), 'radar', t, { label: compact ? 'SMR' : 'Tower and SMR', size: 6 })
      for (const r of MLAT_RECEIVERS) drawStation(ctx, toS(r.pos), 'receiver', t, { label: compact ? undefined : r.id, size: 5, failed: e.env.mlatFailure && r.id === FAILING_RECEIVER })

      // Objects.
      const intruders = new Set(alert.intruders)
      let maxEnlarge = 1
      for (const o of e.objects) {
        if (o.phase === 'cargo-away' || o.altitudeM > 400) continue
        const s = toS(o.pos)
        if (s.x < -60 || s.x > width + 60 || s.y < -60 || s.y > height + 60) continue
        const isIntruder = intruders.has(o.id)
        const fill = isIntruder ? t['sim-alert'] : o.kind === 'vehicle' ? t['sim-signal'] : t['sim-ink']
        const k = drawObjectShape(ctx, s, o.headingDeg, o.shape, pxPerM, fill, t['sim-bg'], o.kind === 'vehicle' ? 9 : 16)
        maxEnlarge = Math.max(maxEnlarge, k)
        if (o.id === selectedId) {
          ctx.strokeStyle = t['primary']
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.arc(s.x, s.y, Math.max(12, (o.kind === 'vehicle' ? 6 : 24) * pxPerM * k), 0, Math.PI * 2)
          ctx.stroke()
        }
        // Zoomed out, only the callsign (full details for the selected object and intruders).
        const full = pxPerM >= 0.3 || o.id === selectedId || isIntruder
        const lines = [o.callsign]
        if (full) {
          lines.push(o.altitudeM > 5 ? `${phaseText(o)} · ${Math.round(o.altitudeM / 0.3048)} ft` : `${phaseText(o)}${o.speedMs > 0.5 ? ` · ${Math.round(o.speedMs * 1.943844)} kt` : ''}`)
          if (!compact && o.note && (o.kind === 'vehicle' || !o.transponder || !o.adsb)) lines.push(o.note)
        }
        const lx = s.x + 10
        lines.forEach((ln, i) => haloText(ctx, ln, lx, s.y - 6 + i * 12, t, { color: i === 0 ? (isIntruder ? t['sim-alert'] : t['sim-ink']) : t['sim-muted'], font: i === 0 ? `700 11px ${t.fontSans}` : `500 10px ${t.fontSans}` }))
      }
      enlarged.current = maxEnlarge

      // Arrival still off the map to the west.
      const arr = e.objects.find((o) => o.phase === 'final' && toS(o.pos).x < 0)
      if (arr) {
        const y = toS({ x: 0, y: 0 }).y
        const d = RWY.thresholdX - arr.pos.x
        ctx.fillStyle = t['sim-ink']
        ctx.beginPath()
        ctx.moveTo(14, y)
        ctx.lineTo(4, y - 6)
        ctx.lineTo(4, y + 6)
        ctx.closePath()
        ctx.fill()
        const inAlert = e.movements().some((m) => m.id === arr.id && movementIsActive(m))
        haloText(ctx, compact ? `${arr.callsign} ${(d / METRES_PER_NM).toFixed(1)} NM` : `${arr.callsign} on final`, 6, y + 20, t, { font: `700 11px ${t.fontSans}`, color: inAlert ? t['sim-warning'] : t['sim-ink'] })
        if (!compact) haloText(ctx, `${(d / METRES_PER_NM).toFixed(1)} NM · ${Math.round(d / Math.max(arr.speedMs, 1))} s to the runway`, 6, y + 33, t, { font: `500 10px ${t.fontSans}`, color: t['sim-muted'] })
      }

      // Scale bar (metres) and north arrow.
      const m = niceMetres(90 / pxPerM)
      const px = m * pxPerM
      const x0 = 12
      const y0 = height - 12
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
      ctx.fillText(m >= 1000 ? `${m / 1000} km` : `${m} m`, x0 + 4, y0 - 4)
      const nx = width - 16
      const ny = 16
      ctx.beginPath()
      ctx.moveTo(nx, ny - 8)
      ctx.lineTo(nx + 5, ny + 5)
      ctx.lineTo(nx, ny + 2)
      ctx.lineTo(nx - 5, ny + 5)
      ctx.closePath()
      ctx.fill()
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText('N', nx, ny + 7)
    },
    [engine, zoom, selectedId],
  )

  const hit = (p: Vec2): SurfaceObject | null => {
    const toS = toScreen(view.current)
    let best: { o: SurfaceObject; d: number } | null = null
    for (const o of engine.objects) {
      if (o.phase === 'cargo-away') continue
      const s = toS(o.pos)
      const d = Math.hypot(s.x - p.x, s.y - p.y)
      if (d < 20 && (!best || d < best.d)) best = { o, d }
    }
    return best?.o ?? null
  }

  const info = useSampled(() => {
    const e = engine
    const inArea = e.objects.filter((o) => o.altitudeM < 5 && inRunwayProtectedArea(o.pos, RWY)).map((o) => o.callsign)
    return { big: enlarged.current > 1.2, inArea: inArea.join(', '), n: e.objects.filter((o) => o.phase !== 'cargo-away').length }
  }, 500)

  return (
    <div className="flex flex-col gap-2">
    <Canvas2D
      draw={draw}
      focusable
      label={`Map of the airport from above, ${ZOOMS[zoom].label.toLowerCase()}, with ${info.n} aircraft and vehicles.${info.inArea ? ` Inside the runway area: ${info.inArea}.` : ''} Drag a vehicle to move it, or select one and use the arrow keys.`}
      className="aspect-[12/5] w-full rounded-lg border bg-sim-land"
      canvasClassName="cursor-grab active:cursor-grabbing"
      onCanvasPointerDown={(ev) => {
        const r = ev.currentTarget.getBoundingClientRect()
        const p = { x: ev.clientX - r.left, y: ev.clientY - r.top }
        const o = hit(p)
        if (!o) return
        select(o.id)
        if (o.kind === 'vehicle') {
          dragging.current = o.id
          ev.currentTarget.setPointerCapture(ev.pointerId)
        }
      }}
      onCanvasPointerMove={(ev) => {
        if (!dragging.current) return
        const r = ev.currentTarget.getBoundingClientRect()
        engine.dragVehicle(dragging.current, toWorld(view.current, { x: ev.clientX - r.left, y: ev.clientY - r.top }))
      }}
      onCanvasPointerUp={() => {
        dragging.current = null
      }}
      onCanvasKeyDown={(ev) => {
        const o = engine.get(selectedId)
        if (!o || o.kind !== 'vehicle') return
        const step = ev.shiftKey ? 50 : 10
        const d = ev.key === 'ArrowUp' ? { x: 0, y: step } : ev.key === 'ArrowDown' ? { x: 0, y: -step } : ev.key === 'ArrowLeft' ? { x: -step, y: 0 } : ev.key === 'ArrowRight' ? { x: step, y: 0 } : null
        if (!d) return
        ev.preventDefault()
        engine.dragVehicle(o.id, { x: o.pos.x + d.x, y: o.pos.y + d.y })
      }}
    />
      <div className="flex flex-wrap gap-1.5">
        <ClockSpeedLabel clock={clock} />
        <SimLabel icon="none">
          Traffic compressed: a landing every {Math.round((ARRIVAL_PERIOD_S / 60) * 10) / 10} min, turnarounds {TURNAROUND_S} s
        </SimLabel>
        {info.big && <SimLabel icon="none">Aircraft and vehicles drawn larger than scale</SimLabel>}
      </div>
    </div>
  )
}
