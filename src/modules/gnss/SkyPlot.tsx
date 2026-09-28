import { useCallback, useRef } from 'react'
import { Canvas2D, type Canvas2DHandle, type DrawFn } from '@/components/sim/Canvas2D'
import { haloText } from '@/components/sim/mapDraw'
import { Toggle } from '@/components/ui/toggle'
import { Term } from '@/components/Term'
import { ELEVATION_MASK_DEG, satelliteEcef } from '@/core/gnss'
import { azimuthElevation, toRad } from '@/core/geometry'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { useSampled } from '@/hooks/useSampled'
import { withAlpha } from '@/lib/color'
import { BUILDINGS, type GnssEngine, type SatView } from './engine'
import { useGnss, useGnssState } from './state'

/** Satellite symbol radius on the sky plot, px. */
const SAT_R = 11

interface PlotGeom {
  cx: number
  cy: number
  R: number
}

function plotGeom(width: number, height: number): PlotGeom {
  return { cx: width / 2, cy: height / 2, R: Math.max(40, Math.min(width, height) / 2 - 26) }
}

/** Sky position → canvas. North up, east right (as on a map), zenith in the centre, horizon on the edge. */
function skyToCanvas(azDeg: number, elDeg: number, g: PlotGeom) {
  const r = (g.R * (90 - Math.max(0, elDeg))) / 90
  const a = toRad(azDeg)
  return { x: g.cx + r * Math.sin(a), y: g.cy - r * Math.cos(a) }
}

function describeSky(e: GnssEngine) {
  const vis = e.sats.filter((s) => s.elDeg >= ELEVATION_MASK_DEG)
  const used = e.sats.filter((s) => s.used).map((s) => `${s.id} at ${Math.round(s.elDeg)} degrees up, bearing ${Math.round(s.azDeg)}`)
  return `Sky plot seen from the receiver. ${vis.length} satellites are above the 5 degree mask. Used: ${used.length ? used.join('; ') : 'none'}.`
}

/** Polar plot of the sky: where each satellite is, and which ones the receiver uses. Click to choose. */
export function SkyPlot() {
  const { engine } = useGnss()
  const toggleSatellite = useGnssState((s) => s.toggleSatellite)
  const ref = useRef<Canvas2DHandle>(null)

  const draw: DrawFn = useCallback(
    (ctx, { width, height, tokens: t }) => {
      const e = engine
      const g = plotGeom(width, height)
      ctx.fillStyle = t['sim-bg']
      ctx.fillRect(0, 0, width, height)

      // Blocked sky (buildings next to the receiver on the ground).
      const onGround = e.settings.site === 'ground'
      if (e.env.blocked && onGround) drawBlocked(ctx, g, t)

      // Rings and cross.
      ctx.lineWidth = 1
      for (const el of [0, 30, 60]) {
        ctx.strokeStyle = el === 0 ? t['sim-grid-strong'] : t['sim-grid']
        ctx.beginPath()
        ctx.arc(g.cx, g.cy, (g.R * (90 - el)) / 90, 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.strokeStyle = t['sim-grid']
      ctx.beginPath()
      ctx.moveTo(g.cx - g.R, g.cy)
      ctx.lineTo(g.cx + g.R, g.cy)
      ctx.moveTo(g.cx, g.cy - g.R)
      ctx.lineTo(g.cx, g.cy + g.R)
      ctx.stroke()
      // Elevation mask.
      ctx.setLineDash([3, 4])
      ctx.strokeStyle = t['sim-muted']
      ctx.beginPath()
      ctx.arc(g.cx, g.cy, (g.R * (90 - ELEVATION_MASK_DEG)) / 90, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.font = `500 10px ${t.fontSans}`
      ctx.fillStyle = t['sim-muted']
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      for (const el of [30, 60]) ctx.fillText(`${el}°`, g.cx + 3, g.cy - (g.R * (90 - el)) / 90 + 7)
      // Cardinal points.
      ctx.font = `600 11px ${t.fontSans}`
      ctx.fillStyle = t['sim-ink']
      ctx.textAlign = 'center'
      ctx.fillText('N', g.cx, g.cy - g.R - 13)
      ctx.fillText('S', g.cx, g.cy + g.R + 13)
      ctx.fillText('E', g.cx + g.R + 13, g.cy)
      ctx.fillText('W', g.cx - g.R - 13, g.cy)

      // Paths over the next hour.
      const rx = e.receiverEcef
      const geo = e.receiverGeo
      ctx.strokeStyle = withAlpha(t['sim-muted'], 0.45)
      ctx.lineWidth = 1
      ctx.setLineDash([1.5, 3])
      for (const s of e.sats) {
        if (s.elDeg < -5) continue
        ctx.beginPath()
        let started = false
        for (let k = 0; k <= 6; k++) {
          const ae = azimuthElevation(satelliteEcef(s.slot, e.timeS + k * 600), rx, geo)
          if (ae.elevationDeg < 0) {
            started = false
            continue
          }
          const p = skyToCanvas(ae.azimuthDeg, ae.elevationDeg, g)
          if (!started) ctx.moveTo(p.x, p.y)
          else ctx.lineTo(p.x, p.y)
          started = true
        }
        ctx.stroke()
      }
      ctx.setLineDash([])

      // SBAS geostationary satellite (a diamond: it stays put in the sky).
      if (e.geo.elDeg > 0) {
        const p = skyToCanvas(e.geo.azDeg, e.geo.elDeg, g)
        const on = e.augmentation === 'sbas'
        ctx.beginPath()
        ctx.moveTo(p.x, p.y - 9)
        ctx.lineTo(p.x + 9, p.y)
        ctx.lineTo(p.x, p.y + 9)
        ctx.lineTo(p.x - 9, p.y)
        ctx.closePath()
        ctx.fillStyle = on ? t['sim-signal-2'] : t['sim-bg']
        ctx.fill()
        ctx.strokeStyle = t['sim-signal-2']
        ctx.lineWidth = 1.5
        ctx.stroke()
        haloText(ctx, on ? 'SBAS (in use)' : 'SBAS', p.x + 12, p.y + 4, t, { font: `600 10px ${t.fontSans}`, color: t['sim-signal-2'] })
      }

      // Satellites.
      for (const s of e.sats) {
        if (s.elDeg < 0) continue
        drawSat(ctx, s, skyToCanvas(s.azDeg, s.elDeg, g), t)
      }

      if (e.env.blocked && !onGround) {
        haloText(ctx, 'Nothing blocks the sky up here', g.cx, height - 6, t, { align: 'center', font: `500 10px ${t.fontSans}`, color: t['sim-muted'] })
      }
    },
    [engine],
  )

  const onPointerDown = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const h = ref.current
    if (!h) return
    const p = h.toLocal(ev)
    const { width, height } = h.size()
    const g = plotGeom(width, height)
    let best: SatView | null = null
    let bd = SAT_R + 6
    for (const s of engine.sats) {
      if (s.elDeg < ELEVATION_MASK_DEG) continue
      const q = skyToCanvas(s.azDeg, s.elDeg, g)
      const d = Math.hypot(q.x - p.x, q.y - p.y)
      if (d < bd) {
        bd = d
        best = s
      }
    }
    if (best) toggleSatellite(best.id)
  }

  const label = useSampled(() => describeSky(engine), 1000)

  return (
    <Canvas2D
      ref={ref}
      draw={draw}
      label={label}
      className="aspect-square w-full rounded-lg border"
      onCanvasPointerDown={onPointerDown}
    />
  )
}

function drawBlocked(ctx: CanvasRenderingContext2D, g: PlotGeom, t: ThemeTokens) {
  const rOf = (el: number) => (g.R * (90 - el)) / 90
  ctx.save()
  ctx.beginPath()
  // Ring from the horizon up to the building height all around...
  ctx.arc(g.cx, g.cy, rOf(0), 0, Math.PI * 2)
  ctx.arc(g.cx, g.cy, rOf(BUILDINGS.minElDeg), 0, Math.PI * 2, true)
  ctx.closePath()
  // ...plus the hangar sector.
  const a0 = toRad(BUILDINGS.fromAzDeg - 90)
  const a1 = toRad(BUILDINGS.toAzDeg - 90)
  ctx.moveTo(g.cx + rOf(BUILDINGS.minElDeg) * Math.cos(a0), g.cy + rOf(BUILDINGS.minElDeg) * Math.sin(a0))
  ctx.arc(g.cx, g.cy, rOf(BUILDINGS.minElDeg), a0, a1)
  ctx.arc(g.cx, g.cy, rOf(BUILDINGS.sectorElDeg), a1, a0, true)
  ctx.closePath()
  ctx.fillStyle = t['sim-shadow-zone']
  ctx.fill('evenodd')
  ctx.clip('evenodd')
  // Hatching so the blocked area is not shown by colour alone.
  ctx.strokeStyle = withAlpha(t['sim-ink'], 0.18)
  ctx.lineWidth = 1
  for (let x = -g.R * 2; x < g.R * 2; x += 7) {
    ctx.beginPath()
    ctx.moveTo(g.cx + x, g.cy - g.R)
    ctx.lineTo(g.cx + x + g.R * 2, g.cy + g.R)
    ctx.stroke()
  }
  ctx.restore()
  const mid = toRad((BUILDINGS.fromAzDeg + BUILDINGS.toAzDeg) / 2 - 90)
  const rm = (rOf(BUILDINGS.minElDeg) + rOf(BUILDINGS.sectorElDeg)) / 2
  haloText(ctx, 'Hangar', g.cx + rm * Math.cos(mid), g.cy + rm * Math.sin(mid), t, { align: 'center', font: `600 10px ${t.fontSans}` })
}

function drawSat(ctx: CanvasRenderingContext2D, s: SatView, p: { x: number; y: number }, t: ThemeTokens) {
  const available = s.status === 'ok'
  ctx.save()
  ctx.lineWidth = 1.6
  if (s.faulty) {
    ctx.strokeStyle = t['sim-alert']
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(p.x, p.y, SAT_R + 4, 0, Math.PI * 2)
    ctx.stroke()
    ctx.lineWidth = 1.6
  }
  ctx.beginPath()
  ctx.arc(p.x, p.y, SAT_R, 0, Math.PI * 2)
  if (s.used) {
    ctx.fillStyle = t['sim-signal']
    ctx.fill()
    ctx.strokeStyle = t['sim-signal']
    ctx.stroke()
  } else {
    ctx.fillStyle = t['sim-bg']
    ctx.fill()
    ctx.strokeStyle = available ? t['sim-signal'] : t['sim-muted']
    if (!available) ctx.setLineDash([2.5, 2.5])
    ctx.stroke()
    ctx.setLineDash([])
  }
  ctx.font = `600 9px ${t.fontMono}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = s.used ? t['sim-bg'] : available ? t['sim-ink'] : t['sim-muted']
  ctx.fillText(s.id, p.x, p.y + 0.5)
  // Left out (RAIM) or flagged "do not use" (SBAS/GBAS): a cross.
  if (s.excluded || s.flagged) {
    ctx.strokeStyle = t['sim-alert']
    ctx.lineWidth = 2.2
    const k = SAT_R + 2
    ctx.beginPath()
    ctx.moveTo(p.x - k, p.y - k)
    ctx.lineTo(p.x + k, p.y + k)
    ctx.moveTo(p.x + k, p.y - k)
    ctx.lineTo(p.x - k, p.y + k)
    ctx.stroke()
  }
  if (s.faulty) {
    haloText(ctx, s.excluded ? 'faulty, left out' : s.flagged ? 'do not use' : 'faulty', p.x, p.y - SAT_R - 7, t, {
      align: 'center',
      font: `600 10px ${t.fontSans}`,
      color: t['sim-alert'],
    })
  } else if (s.status === 'blocked' || s.status === 'lost') {
    haloText(ctx, s.status === 'blocked' ? 'blocked' : 'jammed', p.x, p.y + SAT_R + 11, t, { align: 'center', font: `500 9px ${t.fontSans}`, color: t['sim-muted'] })
  }
  ctx.restore()
}

/** Keyboard-friendly list of the satellites above the mask (same state as clicking the plot). */
export function SatelliteChips() {
  const { engine } = useGnss()
  const toggleSatellite = useGnssState((s) => s.toggleSatellite)
  const mode = useGnssState((s) => s.settings.selectMode)
  const selected = useGnssState((s) => s.settings.selected)
  const sats = useSampled(
    () =>
      engine.sats
        .filter((s) => s.elDeg >= ELEVATION_MASK_DEG)
        .sort((a, b) => b.elDeg - a.elDeg)
        .map((s) => ({ id: s.id, el: Math.round(s.elDeg), status: s.status, used: s.used })),
    400,
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  )
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Choose satellites">
      {sats.map((s) => {
        const on = mode === 'all' ? s.status === 'ok' : selected.includes(s.id)
        return (
          <Toggle
            key={s.id}
            size="sm"
            variant="outline"
            pressed={on}
            onPressedChange={() => toggleSatellite(s.id)}
            aria-label={`${s.id}, ${s.el} degrees up${s.status !== 'ok' ? `, cannot be received (${s.status === 'blocked' ? 'blocked' : s.status === 'lost' ? 'jammed' : 'too low'})` : ''}`}
            className="h-8 px-2 font-mono text-xs tabular-nums data-[state=on]:border-primary"
          >
            {s.id}
            <span className="text-muted-foreground">{s.el}°</span>
          </Toggle>
        )
      })}
    </div>
  )
}

/** Symbol key for the sky plot. */
export function SkyLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <li className="flex items-center gap-1.5">
        <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
          <circle cx="6" cy="6" r="5" className="fill-sim-signal stroke-sim-signal" />
        </svg>
        Used
      </li>
      <li className="flex items-center gap-1.5">
        <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
          <circle cx="6" cy="6" r="5" className="fill-sim-bg stroke-sim-signal" strokeWidth="1.5" />
        </svg>
        Received, not used
      </li>
      <li className="flex items-center gap-1.5">
        <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
          <circle cx="6" cy="6" r="5" className="fill-sim-bg stroke-sim-muted" strokeWidth="1.5" strokeDasharray="2 2" />
        </svg>
        Cannot be received
      </li>
      <li className="flex items-center gap-1.5">
        <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
          <path d="M1 1 L11 11 M11 1 L1 11" className="stroke-sim-alert" strokeWidth="2" />
        </svg>
        Left out (fault)
      </li>
      <li className="flex items-center gap-1.5">
        <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
          <path d="M6 0.5 L11.5 6 L6 11.5 L0.5 6 Z" className="fill-sim-bg stroke-sim-signal-2" strokeWidth="1.5" />
        </svg>
        SBAS satellite
      </li>
      <li className="flex items-center gap-1.5">
        <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
          <path d="M0 6 H12" className="stroke-sim-muted" strokeWidth="1.5" strokeDasharray="2 2" />
        </svg>
        <span>
          5° <Term id="elevation-mask">elevation mask</Term>
        </span>
      </li>
    </ul>
  )
}
