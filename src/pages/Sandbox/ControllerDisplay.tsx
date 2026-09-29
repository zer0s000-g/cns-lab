import { useCallback, useRef } from 'react'
import { Canvas2D, type DrawFn } from '@/components/sim/Canvas2D'
import { worldToScreen, type MapView, type Vec2 } from '@/core/geometry'
import { predictTrack, trackPosition, trackSpeedKt, trackStatus, trackVelocity } from '@/core/fusion'
import { DEFAULT_TERRAIN } from '@/core/world'
import { drawTrackSymbol, type TrackSymbol } from '@/instruments'
import { useSampled } from '@/hooks/useSampled'
import { withAlpha } from '@/lib/color'
import { OCEANIC_BOUNDARY_X } from './systems'
import { useSandbox, useSandboxState } from './state'
import type { SandboxEngine } from './engine'

export function symbolFor(sources: string[], status: string): TrackSymbol {
  if (status === 'coast') return 'coast'
  const set = new Set(sources)
  if (set.size === 2 && set.has('psr') && set.has('ssr')) return 'combined'
  if (set.size >= 2) return 'fused'
  if (set.has('psr')) return 'primary'
  if (set.has('ssr')) return 'secondary'
  if (set.has('mlat')) return 'mlat'
  return 'adsb'
}

/** What the controller sees: fused tracks with labels, history and alerts. */
export function ControllerDisplay({ rangeNm, center, className }: { rangeNm: number; center: Vec2; className?: string }) {
  const { engine } = useSandbox()
  const selectedId = useSandboxState((s) => s.selectedId)
  const select = useSandboxState((s) => s.select)
  const geom = useRef<MapView | null>(null)
  const sel = useRef(selectedId)
  sel.current = selectedId

  const draw: DrawFn = useCallback(
    (ctx, { width, height, tokens: t }) => {
      const v = { rangeNm }
      const mv: MapView = { center, pxPerNm: Math.min(width, height) / 2 / v.rangeNm, width, height }
      geom.current = mv
      ctx.fillStyle = t['scope-bg']
      ctx.fillRect(0, 0, width, height)
      // Map: coastline, runway, range rings, oceanic boundary.
      ctx.strokeStyle = t['scope-grid-strong']
      ctx.lineWidth = 1.2
      ctx.beginPath()
      const top = mv.center.y + height / 2 / mv.pxPerNm
      const bottom = mv.center.y - height / 2 / mv.pxPerNm
      for (let y = bottom, first = true; y <= top; y += (top - bottom) / 160) {
        const s = worldToScreen({ x: DEFAULT_TERRAIN.coastX(y), y }, mv)
        if (first) ctx.moveTo(s.x, s.y)
        else ctx.lineTo(s.x, s.y)
        first = false
      }
      ctx.stroke()
      const c = worldToScreen({ x: 0, y: 0 }, mv)
      const ringStep = v.rangeNm > 100 ? 50 : 10
      ctx.strokeStyle = t['scope-grid']
      ctx.font = `500 10px ${t.fontMono}`
      ctx.fillStyle = t['scope-dim']
      for (let r = ringStep; r <= v.rangeNm * 3; r += ringStep) {
        ctx.beginPath()
        ctx.arc(c.x, c.y, r * mv.pxPerNm, 0, Math.PI * 2)
        ctx.stroke()
        ctx.fillText(`${r}`, c.x + 3, c.y - r * mv.pxPerNm - 2)
      }
      const b0 = worldToScreen({ x: OCEANIC_BOUNDARY_X, y: top }, mv)
      const b1 = worldToScreen({ x: OCEANIC_BOUNDARY_X, y: bottom }, mv)
      ctx.setLineDash([8, 6])
      ctx.strokeStyle = t['scope-grid-strong']
      ctx.beginPath()
      ctx.moveTo(b0.x, b0.y)
      ctx.lineTo(b1.x, b1.y)
      ctx.stroke()
      ctx.setLineDash([])
      const r0 = worldToScreen({ x: -0.81, y: 0 }, mv)
      const r1 = worldToScreen({ x: 0.81, y: 0 }, mv)
      ctx.strokeStyle = t['scope-text']
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(r0.x, r0.y)
      ctx.lineTo(r1.x, r1.y)
      ctx.stroke()

      // Tracks. Selected and alerting tracks are labelled first; each label tries four
      // positions around its symbol and is placed where it does not overlap another label.
      const now = engine.timeS
      const placed: { x0: number; y0: number; x1: number; y1: number }[] = []
      const alertIds = new Map<string, string[]>()
      for (const al of engine.alerts) for (const id of al.ids) alertIds.set(id, [...(alertIds.get(id) ?? []), al.kind])
      const ordered = [...engine.tracks.entries()].sort(([a], [b]) => {
        const pa = a === sel.current || alertIds.has(a) ? 0 : 1
        const pb = b === sel.current || alertIds.has(b) ? 0 : 1
        return pa - pb
      })
      for (const [id, tr] of ordered) {
        const status = trackStatus(tr, now)
        if (status === 'drop') continue
        const p = predictTrack(tr, now)
        const pos = trackPosition(p)
        const s = worldToScreen(pos, mv)
        if (s.x < -60 || s.y < -60 || s.x > width + 60 || s.y > height + 60) continue
        const alerts = alertIds.get(id) ?? []
        const sources = engine.sources(id)
        const col = alerts.length ? t['scope-alert'] : status === 'coast' ? t['scope-dim'] : t['scope-text']
        // History and speed vector (60 s ahead).
        const hist = engine.history.get(id) ?? []
        hist.forEach((h, i) => {
          const hs = worldToScreen(h, mv)
          ctx.fillStyle = withAlpha(col, 0.2 + (0.5 * (i + 1)) / hist.length)
          ctx.beginPath()
          ctx.arc(hs.x, hs.y, 1.6, 0, Math.PI * 2)
          ctx.fill()
        })
        const vel = trackVelocity(p)
        const lead = worldToScreen({ x: pos.x + vel.x * 60, y: pos.y + vel.y * 60 }, mv)
        ctx.strokeStyle = withAlpha(col, 0.8)
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(s.x, s.y)
        ctx.lineTo(lead.x, lead.y)
        ctx.stroke()
        drawTrackSymbol(ctx, symbolFor(sources, status), s.x, s.y, col)
        if (id === sel.current || alerts.length) {
          ctx.strokeStyle = col
          ctx.lineWidth = 1.2
          ctx.strokeRect(s.x - 9, s.y - 9, 18, 18)
        }
        // Label: identity, flight level and trend, ground speed, alerts / source notes.
        const a = engine.getAircraft(id)
        const vs = a?.verticalSpeedFpm ?? 0
        const trend = vs > 300 ? '↑' : vs < -300 ? '↓' : ' '
        const ident = tr.callsign ?? (tr.code ? `A${tr.code}` : 'PSR')
        const fl = tr.altitudeFt !== undefined ? `${String(Math.round(tr.altitudeFt / 100)).padStart(3, '0')}${trend}` : 'no alt'
        const gs = String(Math.round(trackSpeedKt(p) / 10)).padStart(2, '0')
        const lines = [ident, `${fl} ${gs}`]
        if (alerts.length) lines.push(alerts.join(' '))
        else if (sources.length === 1 && sources[0] === 'adsc') lines.push('ADS-C')
        else if (status === 'coast') lines.push('COAST')
        ctx.font = `600 11px ${t.fontMono}`
        const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 4
        const bh = lines.length * 13
        const spots = [
          { x: s.x + 12, y: s.y - 12 - bh },
          { x: s.x - 12 - bw, y: s.y - 12 - bh },
          { x: s.x + 12, y: s.y + 12 },
          { x: s.x - 12 - bw, y: s.y + 12 },
        ]
        const inside = (p0: { x: number; y: number }) => p0.x >= 2 && p0.y >= 2 && p0.x + bw <= width - 2 && p0.y + bh <= height - 2
        const free = spots.find((p0) => inside(p0) && !placed.some((b) => !(p0.x + bw < b.x0 || p0.x > b.x1 || p0.y + bh < b.y0 || p0.y > b.y1)))
        if (!free && id !== sel.current && !alerts.length) continue
        const spot = free ?? spots[0]
        placed.push({ x0: spot.x, y0: spot.y, x1: spot.x + bw, y1: spot.y + bh })
        // Leader line from the symbol to the label.
        ctx.strokeStyle = withAlpha(col, 0.6)
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(s.x, s.y)
        ctx.lineTo(spot.x < s.x ? spot.x + bw : spot.x, spot.y < s.y ? spot.y + bh : spot.y)
        ctx.stroke()
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        lines.forEach((line, i) => {
          const y = spot.y + i * 13
          const w = ctx.measureText(line).width
          ctx.fillStyle = withAlpha(t['scope-bg'], 0.75)
          ctx.fillRect(spot.x - 1, y, w + 4, 13)
          ctx.fillStyle = i === 2 && alerts.length ? t['scope-alert'] : col
          ctx.fillText(line, spot.x + 1, y + 1)
        })
      }
      ctx.fillStyle = t['scope-dim']
      ctx.font = `600 10px ${t.fontSans}`
      ctx.textAlign = 'right'
      ctx.textBaseline = 'bottom'
      ctx.fillText(`${engine.tracks.size} tracks`, width - 8, height - 6)
    },
    [engine, rangeNm, center],
  )

  const label = useSampled(() => describe(engine), 1000)

  return (
    <Canvas2D
      draw={draw}
      label={label}
      className={className ?? 'aspect-square w-full rounded-lg bg-scope-bg'}
      onCanvasPointerDown={(e) => {
        const mv = geom.current
        if (!mv) return
        const rect = e.currentTarget.getBoundingClientRect()
        const x = e.clientX - rect.left
        const y = e.clientY - rect.top
        let best: { id: string; d: number } | null = null
        for (const [id, tr] of engine.tracks) {
          const s = worldToScreen(trackPosition(predictTrack(tr, engine.timeS)), mv)
          const d = Math.hypot(s.x - x, s.y - y)
          if (d < 22 && (!best || d < best.d)) best = { id, d }
        }
        if (best) select(best.id)
      }}
    />
  )
}

function describe(e: SandboxEngine): string {
  const n = e.tracks.size
  const alerts = e.alerts.map((a) => `${a.kind}: ${a.text}`).join('. ')
  return `Controller display with ${n} tracks.${alerts ? ` Alerts: ${alerts}.` : ' No alerts.'}`
}
