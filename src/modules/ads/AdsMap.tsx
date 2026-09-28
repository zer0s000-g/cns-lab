import { useCallback } from 'react'
import { MapCanvas, type MapAircraft } from '@/components/sim/MapCanvas'
import { drawRangeRing, drawStation, haloText } from '@/components/sim/mapDraw'
import { worldToScreen, type MapView } from '@/core/geometry'
import { radioLineOfSightNm } from '@/core/propagation'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { withAlpha } from '@/lib/color'
import { JAMMER, RADAR_SITE, SPOOFER } from './engine'
import { useAds, useAdsState } from './state'

/** Visual speed of the broadcast rings on the map (NM per second of simulation time). Radio is really instant at this scale. */
const RING_NM_PER_S = 5

export function AdsMap() {
  const { engine } = useAds()
  const range = useAdsState((s) => s.mapRangeNm)
  const selectedId = useAdsState((s) => s.selectedId)
  const select = useAdsState((s) => s.select)

  const drawOverlay = useCallback(
    (ctx: CanvasRenderingContext2D, view: MapView, { tokens: t }: { tokens: ThemeTokens }) => {
      const e = engine
      const sel = e.getAircraft(selectedId) ?? e.aircraft[0]
      const alt = sel.altitudeFt
      // Receiver coverage at the selected aircraft's altitude (smooth Earth, same line-of-sight rule as everywhere).
      const covs = e.receivers.map((r) => radioLineOfSightNm(r.heightFt, alt))
      if (Math.min(...covs) > range * 1.1) {
        haloText(ctx, `Receiver coverage at ${Math.round(alt).toLocaleString('en-US')} ft: ${Math.round(Math.min(...covs))}–${Math.round(Math.max(...covs))} NM (try 250 NM)`, view.width - 8, view.height - 8, t, {
          align: 'right',
          font: `500 10px ${t.fontSans}`,
          color: t['sim-muted'],
        })
      }
      e.receivers.forEach((r, i) => {
        const cov = covs[i]
        drawRangeRing(ctx, r.pos, cov, view, withAlpha(t['sim-signal'], 0.55), {
          dash: [5, 5],
          label: i === 0 ? `Receiver coverage at ${Math.round(alt).toLocaleString('en-US')} ft` : undefined,
          labelBearingDeg: 330,
        })
      })
      if (e.env.jamming) {
        const c = worldToScreen(JAMMER.pos, view)
        ctx.save()
        ctx.fillStyle = withAlpha(t['sim-alert'], 0.12)
        ctx.beginPath()
        ctx.arc(c.x, c.y, JAMMER.denyRadiusNm * view.pxPerNm, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
        drawRangeRing(ctx, JAMMER.pos, JAMMER.denyRadiusNm, view, t['sim-alert'], { dash: [3, 3], label: 'GNSS lost', labelBearingDeg: 20 })
        drawRangeRing(ctx, JAMMER.pos, JAMMER.degradeRadiusNm, view, t['sim-warning'], { dash: [6, 4], label: 'GNSS degraded', labelBearingDeg: 70 })
        drawStation(ctx, c, 'beacon', t, { label: 'GNSS jammer' })
      }
      // Broadcast rings: each position message spreads from the transmitter.
      for (const ring of e.rings) {
        const age = e.timeS - ring.t
        if (age < 0) continue
        const s = worldToScreen(ring.pos, view)
        const r = Math.max(2, age * RING_NM_PER_S * view.pxPerNm)
        ctx.strokeStyle = withAlpha(ring.from === 'spoofer' ? t['sim-warning'] : t['sim-signal'], Math.max(0, 0.55 * (1 - age / 1.6)))
        ctx.lineWidth = 1.2
        ctx.beginPath()
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2)
        ctx.stroke()
      }
      e.receivers.forEach((r) => drawStation(ctx, worldToScreen(r.pos, view), 'receiver', t, { label: r.name.replace(' receiver', '') }))
      drawStation(ctx, worldToScreen(RADAR_SITE.pos, view), 'radar', t, { label: 'Radar', size: 6 })
      if (e.env.ghost) {
        const sp = worldToScreen(SPOOFER.pos, view)
        drawStation(ctx, sp, 'antenna', t, { label: 'Spoofer (on the ground)' })
        const g = worldToScreen(e.ghost.pos, view)
        ctx.save()
        ctx.setLineDash([3, 3])
        ctx.strokeStyle = t['sim-warning']
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.arc(g.x, g.y, 9, 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
        haloText(ctx, `${e.ghost.callsign} claims to be here`, g.x + 12, g.y - 2, t, { color: t['sim-warning'], font: `600 10px ${t.fontSans}` })
        haloText(ctx, 'nothing is there', g.x + 12, g.y + 10, t, { color: t['sim-muted'], font: `500 10px ${t.fontSans}` })
      }
    },
    [engine, selectedId, range],
  )

  const aircraft = useCallback((): MapAircraft[] => {
    return engine.aircraft.map((a) => {
      const status: string[] = []
      if (!engine.hasAdsbOut(a.id)) status.push('no ADS-B Out')
      else if (a.gnss.lost) status.push('GNSS lost')
      else if (a.gnss.nacp < 10) status.push(`NACp ${a.gnss.nacp}`)
      return {
        id: a.id,
        pos: a.pos,
        headingDeg: a.headingDeg,
        label: [a.callsign, `${Math.round(a.altitudeFt).toLocaleString('en-US')} ft`, ...status],
        style: status.length && (status[0] === 'GNSS lost' || status[0] === 'no ADS-B Out') ? 'dim' : 'normal',
      }
    })
  }, [engine])

  return (
    <MapCanvas
      rangeNm={range}
      className="aspect-square"
      drawOverlay={drawOverlay}
      aircraft={aircraft}
      selectedId={selectedId}
      onSelect={select}
      onDragStart={(id) => engine.setAircraft(id, { held: true })}
      onDrag={(id, pos) => engine.setAircraft(id, { pos })}
      onDragEnd={(id) => {
        const a = engine.getAircraft(id)
        if (a) engine.setAircraft(id, { held: false, mode: { kind: 'heading' }, targetHeadingDeg: a.headingDeg })
      }}
      onNudge={(id, d) => {
        const a = engine.getAircraft(id)
        if (a) engine.setAircraft(id, { pos: { x: a.pos.x + d.x, y: a.pos.y + d.y }, mode: { kind: 'heading' }, targetHeadingDeg: a.headingDeg })
      }}
      label={`Map of the real situation: ${engine.aircraft.length} aircraft broadcasting ADS-B, ${engine.receivers.length} ground receivers and a radar, ${range} nautical miles in every direction. Select an aircraft and use the arrow keys to move it.`}
    />
  )
}
