import { useCallback } from 'react'
import { MapCanvas, type MapAircraft } from '@/components/sim/MapCanvas'
import { drawRangeRing, drawStation, haloText } from '@/components/sim/mapDraw'
import { distanceNm, worldToScreen, type MapView, type Vec2 } from '@/core/geometry'
import { radioLineOfSightNm } from '@/core/propagation'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useSampled } from '@/hooks/useSampled'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { withAlpha } from '@/lib/color'
import { coastEast, coastWest, GROUND_EARTH_STATION, OCEAN_ROUTE, OCEAN_START, OCEANIC_CENTRE, SATELLITE_DRAWN, utc, type AdscReport } from './oceanEngine'
import { useAds } from './state'

const CENTER: Vec2 = { x: 0, y: 60 }

/** Where a report in transit is drawn: up to the satellite, down to the ground station, then along the ground network. */
function transitPoint(r: AdscReport, t: number): Vec2 {
  const f = Math.min(1, Math.max(0, (t - r.sentS) / (r.receivedS - r.sentS)))
  const lerp = (a: Vec2, b: Vec2, k: number) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k })
  if (f < 0.12) return lerp(r.pos, SATELLITE_DRAWN, f / 0.12)
  if (f < 0.24) return lerp(SATELLITE_DRAWN, GROUND_EARTH_STATION, (f - 0.12) / 0.12)
  return lerp(GROUND_EARTH_STATION, OCEANIC_CENTRE, (f - 0.24) / 0.76)
}

export function OceanMap() {
  const { ocean } = useAds()
  const wide = useMediaQuery('(min-width: 768px)')
  const range = wide ? 410 : 820

  const drawOverlay = useCallback(
    (ctx: CanvasRenderingContext2D, view: MapView, { tokens: t }: { tokens: ThemeTokens }) => {
      const e = ocean
      const narrow = view.width < 520
      // Sea and land.
      ctx.fillStyle = t['sim-water']
      ctx.fillRect(0, 0, view.width, view.height)
      const top = CENTER.y + view.height / 2 / view.pxPerNm
      const bottom = CENTER.y - view.height / 2 / view.pxPerNm
      const far = view.width / view.pxPerNm
      for (const side of ['w', 'e'] as const) {
        ctx.beginPath()
        const edgeX = side === 'w' ? CENTER.x - far : CENTER.x + far
        let first = true
        for (let y = bottom - 10; y <= top + 10; y += 5) {
          const s = worldToScreen({ x: side === 'w' ? coastWest(y) : coastEast(y), y }, view)
          if (first) ctx.moveTo(s.x, s.y)
          else ctx.lineTo(s.x, s.y)
          first = false
        }
        const a = worldToScreen({ x: edgeX, y: top + 10 }, view)
        const b = worldToScreen({ x: edgeX, y: bottom - 10 }, view)
        ctx.lineTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.closePath()
        ctx.fillStyle = t['sim-land']
        ctx.fill()
        ctx.strokeStyle = withAlpha(t['sim-signal'], 0.45)
        ctx.lineWidth = 1.2
        ctx.stroke()
      }
      if (!narrow) {
        haloText(ctx, 'West coast', worldToScreen({ x: -720, y: -150 }, view).x, worldToScreen({ x: 0, y: -150 }, view).y, t, { color: t['sim-muted'], font: `600 11px ${t.fontSans}`, align: 'center' })
        haloText(ctx, 'East coast', worldToScreen({ x: 720, y: -150 }, view).x, worldToScreen({ x: 0, y: -150 }, view).y, t, { color: t['sim-muted'], font: `600 11px ${t.fontSans}`, align: 'center' })
      }

      // ADS-B coverage of the coastal receivers at the aircraft's altitude.
      const alt = e.aircraft.altitudeFt
      if (!e.opts.spaceAdsb) {
        e.receivers.forEach((r, i) =>
          drawRangeRing(ctx, r.pos, radioLineOfSightNm(r.heightFt, alt), view, withAlpha(t['sim-signal'], 0.7), {
            dash: [6, 5],
            label: i === 0 ? `ADS-B coverage at FL${Math.round(alt / 100)}` : undefined,
            labelBearingDeg: 60,
          }),
        )
      } else {
        haloText(ctx, 'Space-based ADS-B: satellites hear the aircraft everywhere', view.width / 2, 36, t, { align: 'center', color: t['sim-signal'], font: `600 11px ${t.fontSans}` })
      }

      // Cleared route with waypoints.
      ctx.save()
      ctx.strokeStyle = withAlpha(t['sim-ink'], 0.45)
      ctx.setLineDash([6, 5])
      ctx.lineWidth = 1.2
      ctx.beginPath()
      const s0 = worldToScreen(OCEAN_START, view)
      ctx.moveTo(s0.x, s0.y)
      for (const w of OCEAN_ROUTE) {
        const s = worldToScreen(w.pos, view)
        ctx.lineTo(s.x, s.y)
      }
      ctx.stroke()
      ctx.restore()
      for (const w of OCEAN_ROUTE) {
        const s = worldToScreen(w.pos, view)
        ctx.fillStyle = t['sim-ink']
        ctx.beginPath()
        ctx.moveTo(s.x, s.y - 5)
        ctx.lineTo(s.x + 4.5, s.y + 3)
        ctx.lineTo(s.x - 4.5, s.y + 3)
        ctx.closePath()
        ctx.fill()
        haloText(ctx, w.name, s.x, s.y + 16, t, { align: 'center', font: `600 10px ${t.fontSans}` })
      }

      // Stations and the satellite.
      // On a narrow screen the west-coast stations sit a few pixels apart: keep only the centre's label.
      e.receivers.forEach((r) => drawStation(ctx, worldToScreen(r.pos, view), 'receiver', t, { label: narrow ? undefined : 'ADS-B', size: narrow ? 5 : 7 }))
      drawStation(ctx, worldToScreen(OCEANIC_CENTRE, view), 'tower', t, { label: narrow ? 'Centre' : 'Oceanic centre', size: narrow ? 5 : 7 })
      drawStation(ctx, worldToScreen(GROUND_EARTH_STATION, view), 'antenna', t, { label: narrow ? undefined : 'Satellite ground station', size: narrow ? 5 : 7 })
      const sat = worldToScreen(SATELLITE_DRAWN, view)
      ctx.save()
      ctx.translate(sat.x, sat.y)
      ctx.fillStyle = t['sim-signal']
      ctx.fillRect(-4, -4, 8, 8)
      ctx.fillStyle = withAlpha(t['sim-signal'], 0.6)
      ctx.fillRect(-18, -2.5, 11, 5)
      ctx.fillRect(7, -2.5, 11, 5)
      ctx.restore()
      haloText(ctx, 'Geostationary satellite', sat.x, sat.y - 10, t, { align: 'center', font: `600 10px ${t.fontSans}` })
      haloText(ctx, '(drawn close; really 35,786 km up)', sat.x, sat.y + 18, t, { align: 'center', font: `500 10px ${t.fontSans}`, color: t['sim-muted'] })

      // Reports on their way.
      for (const r of e.inTransit) {
        const p = worldToScreen(transitPoint(r, e.timeS), view)
        ctx.fillStyle = t['sim-warning']
        ctx.strokeStyle = t['sim-bg']
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
      }

      // Reports the centre has received: what the controller knows.
      const recent = e.received.slice(-12)
      recent.forEach((r, i) => {
        const s = worldToScreen(r.pos, view)
        const last = i === recent.length - 1
        ctx.strokeStyle = last ? t['sim-ink'] : withAlpha(t['sim-ink'], 0.55)
        ctx.lineWidth = last ? 2 : 1.3
        const k = last ? 5.5 : 4
        ctx.strokeRect(s.x - k, s.y - k, k * 2, k * 2)
        if (last || (!narrow && i % 2 === recent.length % 2)) haloText(ctx, utc(r.sentS).slice(0, 5), s.x, s.y - 9, t, { align: 'center', font: `600 9.5px ${t.fontMono}`, color: last ? t['sim-ink'] : t['sim-muted'] })
      })
      // Gap between the controller's latest knowledge and reality.
      const last = e.lastReport()
      if (last && !e.adsbLive()) {
        const a = worldToScreen(last.pos, view)
        const b = worldToScreen(e.aircraft.pos, view)
        ctx.save()
        ctx.strokeStyle = t['sim-warning']
        ctx.setLineDash([3, 3])
        ctx.lineWidth = 1.4
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
        ctx.restore()
        haloText(ctx, `${distanceNm(last.pos, e.aircraft.pos).toFixed(0)} NM since the last report`, (a.x + b.x) / 2, (a.y + b.y) / 2 + 22, t, {
          align: 'center',
          color: t['sim-warning'],
          font: `600 10px ${t.fontSans}`,
        })
      }
      // The centre's ADS-B track, if it has one right now.
      const tr = e.atc.tracks.get(e.aircraft.address)
      if (tr?.pos && e.adsbLive()) {
        const s = worldToScreen(tr.pos, view)
        ctx.strokeStyle = t['sim-signal']
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(s.x, s.y - 8)
        ctx.lineTo(s.x + 8, s.y)
        ctx.lineTo(s.x, s.y + 8)
        ctx.lineTo(s.x - 8, s.y)
        ctx.closePath()
        ctx.stroke()
      }
    },
    [ocean],
  )

  const label = useSampled(
    () =>
      `Ocean map: ${ocean.aircraft.callsign} crossing from the west coast to the east coast at flight level ${Math.round(ocean.aircraft.altitudeFt / 100)}. ${
        ocean.adsbLive() ? 'The oceanic centre sees it on ADS-B.' : 'The oceanic centre only has ADS-C reports.'
      } ${ocean.received.length} reports received.`,
    1000,
  )

  const aircraft = useCallback((): MapAircraft[] => {
    const a = ocean.aircraft
    return [{ id: a.id, pos: a.pos, headingDeg: a.headingDeg, label: [a.callsign, `FL${Math.round(a.altitudeFt / 100)}`], draggable: false }]
  }, [ocean])

  return (
    <MapCanvas
      rangeNm={range}
      center={CENTER}
      showTerrain={false}
      className="aspect-square md:aspect-[2/1]"
      drawOverlay={drawOverlay}
      aircraft={aircraft}
      selectedId={null}
      label={label}
    />
  )
}
