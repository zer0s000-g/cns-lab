import { useCallback } from 'react'
import { Canvas2D, type DrawFn } from '@/components/sim/Canvas2D'
import { ReadoutGrid, Readout, SimLabel } from '@/components/sim/Controls'
import { crossRangeSigmaNm, MSSR_ACCURACY, nacpInfo } from '@/core/ads'
import { distanceNm, toRad, type Vec2 } from '@/core/geometry'
import { useSampled } from '@/hooks/useSampled'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { drawAircraftSymbol } from '@/instruments/draw'
import { withAlpha } from '@/lib/color'
import { RADAR_SITE, type AdsbEngine } from './engine'
import { useAds, useAdsState } from './state'

const HISTORY_S = 120

/**
 * Radar and ADS-B side by side, following the same aircraft at the same
 * scale. Both views are fed by the same aircraft truth.
 */
export function CompareView() {
  const { engine } = useAds()
  const selectedId = useAdsState((s) => s.selectedId)
  const zoom = useAdsState((s) => s.compareZoomNm)
  const radarPeriodS = useAdsState((s) => s.radarPeriodS)

  const drawRadar = useCallback<DrawFn>((ctx, i) => drawCompare(ctx, i.width, i.height, i.tokens, engine, selectedId, zoom, 'radar'), [engine, selectedId, zoom])
  const drawAdsb = useCallback<DrawFn>((ctx, i) => drawCompare(ctx, i.width, i.height, i.tokens, engine, selectedId, zoom, 'adsb'), [engine, selectedId, zoom])

  const stats = useSampled(() => {
    const a = engine.getAircraft(selectedId)
    if (!a) return null
    const r = engine.lastRadar(a.address)
    const tr = engine.atc.tracks.get(a.address)
    const range = distanceNm(RADAR_SITE.pos, a.pos)
    return {
      id: a.callsign,
      radarAge: r ? engine.timeS - r.t : null,
      radarBehind: r ? distanceNm(r.pos, a.pos) : null,
      adsbAge: tr?.pos ? engine.timeS - tr.posS : null,
      adsbBehind: tr?.pos ? distanceNm(tr.pos, a.pos) : null,
      sideways: 2 * crossRangeSigmaNm(range, MSSR_ACCURACY.sigmaAzDeg) * 1852,
      range,
      nacp: tr?.nacp ?? 0,
    }
  }, 200)

  return (
    <div className="hud-panel flex flex-col gap-3 rounded-md p-4">
      <div>
        <h3 className="text-sm font-semibold">Radar and ADS-B, side by side{stats ? `: ${stats.id}` : ''}</h3>
        <p className="text-xs text-muted-foreground">
          Both views follow the same aircraft at the same scale. The dashed line is where it really flew.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <figure className="flex min-w-0 flex-col gap-1.5">
          <figcaption className="flex items-baseline justify-between gap-2 text-xs">
            <span className="font-semibold">Radar</span>
            <span className="text-muted-foreground">one plot per antenna turn</span>
          </figcaption>
          <div className="relative">
            <Canvas2D draw={drawRadar} label={`Radar view following ${stats?.id ?? 'the aircraft'}: a new plot every ${radarPeriodS.toFixed(1)} seconds.`} className="aspect-[4/3] w-full rounded-md bg-scope-bg" />
            <div className="pointer-events-none absolute top-2 left-2">
              <SimLabel icon="none">New plot every {radarPeriodS.toFixed(1)} s</SimLabel>
            </div>
          </div>
        </figure>
        <figure className="flex min-w-0 flex-col gap-1.5">
          <figcaption className="flex items-baseline justify-between gap-2 text-xs">
            <span className="font-semibold">ADS-B</span>
            <span className="text-muted-foreground">the aircraft's own GNSS position</span>
          </figcaption>
          <div className="relative">
            <Canvas2D draw={drawAdsb} label={`ADS-B view following ${stats?.id ?? 'the aircraft'}: a new position about twice a second.`} className="aspect-[4/3] w-full rounded-md bg-scope-bg" />
            <div className="pointer-events-none absolute top-2 left-2">
              <SimLabel icon="none">New position about every 0.5 s</SimLabel>
            </div>
          </div>
        </figure>
      </div>
      {stats && (
        <ReadoutGrid className="lg:grid-cols-4">
          <Readout label="Radar: last plot" value={stats.radarAge != null ? stats.radarAge.toFixed(1) : '—'} unit="s ago" hint={stats.radarBehind != null ? `${stats.radarBehind.toFixed(2)} NM from the aircraft now` : 'Not seen by the radar'} />
          <Readout label="Radar: sideways error" value={`±${Math.round(stats.sideways)}`} unit="m" hint={`At ${stats.range.toFixed(0)} NM; grows with distance`} />
          <Readout
            label="ADS-B: last position"
            value={stats.adsbAge != null ? stats.adsbAge.toFixed(1) : '—'}
            unit="s ago"
            tone={stats.adsbAge == null || stats.adsbAge > 3 ? 'warning' : 'default'}
            hint={stats.adsbBehind != null ? `${stats.adsbBehind.toFixed(2)} NM from the aircraft now` : 'No ADS-B position'}
          />
          <Readout label="ADS-B: accuracy (NACp)" value={stats.nacp ? `${stats.nacp}` : '—'} hint={stats.nacp ? nacpInfo(stats.nacp).text : 'No position quality'} tone={stats.nacp && stats.nacp < 8 ? 'warning' : 'default'} />
        </ReadoutGrid>
      )}
    </div>
  )
}

function drawCompare(ctx: CanvasRenderingContext2D, width: number, height: number, t: ThemeTokens, e: AdsbEngine, selectedId: string | null, zoomNm: number, which: 'radar' | 'adsb') {
  ctx.fillStyle = t['scope-bg']
  ctx.fillRect(0, 0, width, height)
  const a = e.getAircraft(selectedId)
  if (!a) {
    ctx.fillStyle = t['scope-dim']
    ctx.font = `500 12px ${t.fontSans}`
    ctx.textAlign = 'center'
    ctx.fillText('Choose an aircraft', width / 2, height / 2)
    return
  }
  const px = Math.min(width, height) / 2 / zoomNm
  const c = a.pos
  const P = (p: Vec2) => ({ x: width / 2 + (p.x - c.x) * px, y: height / 2 - (p.y - c.y) * px })
  // 1 NM grid.
  ctx.strokeStyle = t['scope-grid']
  ctx.lineWidth = 1
  const step = zoomNm > 6 ? 2 : 1
  for (let gx = Math.floor((c.x - zoomNm * 2) / step) * step; gx <= c.x + zoomNm * 2; gx += step) {
    const s = P({ x: gx, y: 0 }).x
    ctx.beginPath()
    ctx.moveTo(s, 0)
    ctx.lineTo(s, height)
    ctx.stroke()
  }
  for (let gy = Math.floor((c.y - zoomNm * 2) / step) * step; gy <= c.y + zoomNm * 2; gy += step) {
    const s = P({ x: 0, y: gy }).y
    ctx.beginPath()
    ctx.moveTo(0, s)
    ctx.lineTo(width, s)
    ctx.stroke()
  }
  ctx.fillStyle = t['scope-dim']
  ctx.font = `500 10px ${t.fontSans}`
  ctx.textAlign = 'right'
  ctx.textBaseline = 'bottom'
  ctx.fillText(`grid ${step} NM`, width - 6, height - 4)

  // Where it really flew.
  const trail = (e.truth.get(a.id) ?? []).filter((q) => e.timeS - q.t <= HISTORY_S)
  ctx.strokeStyle = withAlpha(t['scope-text'], 0.45)
  ctx.setLineDash([4, 4])
  ctx.lineWidth = 1.2
  ctx.beginPath()
  trail.forEach((q, i) => {
    const s = P(q.p)
    if (i === 0) ctx.moveTo(s.x, s.y)
    else ctx.lineTo(s.x, s.y)
  })
  const now = P(a.pos)
  if (trail.length) ctx.lineTo(now.x, now.y)
  ctx.stroke()
  ctx.setLineDash([])

  const col = t['scope-trace']
  if (which === 'radar') {
    const plots = (e.radarPlots.get(a.address) ?? []).filter((q) => e.timeS - q.t <= HISTORY_S)
    ctx.strokeStyle = withAlpha(col, 0.8)
    ctx.lineWidth = 1.5
    ctx.beginPath()
    plots.forEach((q, i) => {
      const s = P(q.pos)
      if (i === 0) ctx.moveTo(s.x, s.y)
      else ctx.lineTo(s.x, s.y)
    })
    ctx.stroke()
    plots.forEach((q, i) => {
      const s = P(q.pos)
      const last = i === plots.length - 1
      const r = last ? 5 : 3.5
      ctx.strokeStyle = last ? t['scope-text'] : col
      ctx.lineWidth = last ? 2 : 1.4
      ctx.strokeRect(s.x - r, s.y - r, r * 2, r * 2)
    })
    const last = plots[plots.length - 1]
    if (last) {
      // ±2σ sideways error bar, perpendicular to the direction from the radar.
      const range = distanceNm(RADAR_SITE.pos, last.pos)
      const half = 2 * crossRangeSigmaNm(range, MSSR_ACCURACY.sigmaAzDeg)
      const brg = Math.atan2(last.pos.x - RADAR_SITE.pos.x, last.pos.y - RADAR_SITE.pos.y)
      const ux = Math.cos(brg)
      const uy = -Math.sin(brg)
      const a0 = P({ x: last.pos.x - ux * half, y: last.pos.y - uy * half })
      const a1 = P({ x: last.pos.x + ux * half, y: last.pos.y + uy * half })
      ctx.strokeStyle = t['scope-warning']
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(a0.x, a0.y)
      ctx.lineTo(a1.x, a1.y)
      ctx.stroke()
      const s = P(last.pos)
      ctx.fillStyle = t['scope-text']
      ctx.font = `600 10px ${t.fontSans}`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText(`${(e.timeS - last.t).toFixed(1)} s old`, s.x + 8, s.y + 6)
    } else {
      label(ctx, t, width, height, 'The radar cannot see it here')
    }
  } else {
    const tr = e.atc.tracks.get(a.address)
    const hist = (tr?.history ?? []).filter((q) => e.timeS - q.t <= HISTORY_S)
    ctx.strokeStyle = withAlpha(col, 0.8)
    ctx.lineWidth = 1.5
    ctx.beginPath()
    hist.forEach((q, i) => {
      const s = P(q.p)
      if (i === 0) ctx.moveTo(s.x, s.y)
      else ctx.lineTo(s.x, s.y)
    })
    ctx.stroke()
    ctx.fillStyle = col
    for (const q of hist.slice(-80)) {
      const s = P(q.p)
      ctx.beginPath()
      ctx.moveTo(s.x, s.y - 2.5)
      ctx.lineTo(s.x + 2.5, s.y)
      ctx.lineTo(s.x, s.y + 2.5)
      ctx.lineTo(s.x - 2.5, s.y)
      ctx.closePath()
      ctx.fill()
    }
    if (tr?.pos && hist.length) {
      const s = P(tr.pos)
      ctx.strokeStyle = t['scope-text']
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(s.x, s.y - 6)
      ctx.lineTo(s.x + 6, s.y)
      ctx.lineTo(s.x, s.y + 6)
      ctx.lineTo(s.x - 6, s.y)
      ctx.closePath()
      ctx.stroke()
      const bound = nacpInfo(tr.nacp).boundM
      if (bound != null) {
        const r = (bound / 1852) * px
        if (r > 3) {
          ctx.strokeStyle = t['scope-warning']
          ctx.setLineDash([3, 3])
          ctx.lineWidth = 1.4
          ctx.beginPath()
          ctx.arc(s.x, s.y, r, 0, Math.PI * 2)
          ctx.stroke()
          ctx.setLineDash([])
          ctx.fillStyle = t['scope-warning']
          ctx.font = `600 10px ${t.fontSans}`
          ctx.textAlign = 'left'
          ctx.textBaseline = 'bottom'
          ctx.fillText(`NACp ${tr.nacp}: within ${Math.round(bound)} m (95%)`, s.x + r * 0.72 + 4, s.y - r * 0.72)
        }
      }
    } else {
      label(ctx, t, width, height, tr && tr.noPosition ? 'ADS-B is sending no position (GNSS lost)' : 'No ADS-B position')
    }
  }
  // The aircraft itself (truth), drawn last so it stays visible.
  ctx.save()
  ctx.translate(now.x, now.y)
  ctx.rotate(toRad(a.headingDeg))
  ctx.globalAlpha = 0.85
  drawAircraftSymbol(ctx, 0, 0, 9, t['scope-dim'])
  ctx.restore()
}

function label(ctx: CanvasRenderingContext2D, t: ThemeTokens, width: number, height: number, text: string) {
  ctx.fillStyle = t['scope-warning']
  ctx.font = `600 12px ${t.fontSans}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.fillText(text, width / 2, height - 22)
}
