import { useCallback } from 'react'
import { MapCanvas, type MapAircraft } from '@/components/sim/MapCanvas'
import { drawRangeRing, drawStation, haloText } from '@/components/sim/mapDraw'
import { destinationPoint, distanceNm, toRad, worldToScreen, type MapView } from '@/core/geometry'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { withAlpha } from '@/lib/color'
import { useNdb, useNdbState } from './state'

/** Top-down map (true north up) centred on the beacon. */
export function NdbMap() {
  const { engine } = useNdb()
  const range = useNdbState((s) => s.mapRangeNm)

  const drawOverlay = useCallback(
    (ctx: CanvasRenderingContext2D, view: MapView, { tokens: t }: { tokens: ThemeTokens }) => {
      const e = engine
      const st = e.station
      const sp = worldToScreen(st.pos, view)
      const ind = e.last

      // Radio waves spreading out in every direction (drawn slowed down).
      const spacing = range / 4
      const phase = ((e.timeS * spacing) / 1.6) % spacing
      for (let r = phase; r < range * 1.5; r += spacing) {
        const alpha = 0.4 * Math.max(0, 1 - r / (st.ratedCoverageNm * 1.7))
        if (alpha < 0.02) continue
        ctx.strokeStyle = withAlpha(t['sim-signal'], alpha)
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.arc(sp.x, sp.y, r * view.pxPerNm, 0, Math.PI * 2)
        ctx.stroke()
      }
      drawRangeRing(ctx, st.pos, st.ratedCoverageNm, view, t['sim-muted'], {
        label: `Rated coverage ${st.ratedCoverageNm} NM`,
        labelBearingDeg: 150,
        dash: [4, 4],
      })

      // Thunderstorm cell and recent lightning.
      if (e.env.storm) {
        const c = worldToScreen(e.storm.center, view)
        const rr = e.storm.radiusNm * view.pxPerNm
        ctx.fillStyle = withAlpha(t['sim-warning'], 0.14)
        ctx.strokeStyle = t['sim-warning']
        ctx.lineWidth = 1.5
        ctx.setLineDash([5, 4])
        ctx.beginPath()
        ctx.arc(c.x, c.y, rr, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        ctx.setLineDash([])
        haloText(ctx, 'Thunderstorm', c.x, c.y - rr - 6, t, { align: 'center', color: t['sim-warning'] })
        const ac = worldToScreen(e.aircraft.pos, view)
        for (const f of e.flashes) {
          const age = e.timeS - f.timeS
          if (age < 0 || age > 0.35) continue
          const fp = worldToScreen(f.pos, view)
          drawBolt(ctx, fp.x, fp.y, t['sim-warning'])
          ctx.strokeStyle = withAlpha(t['sim-warning'], 0.7)
          ctx.setLineDash([2, 3])
          ctx.beginPath()
          ctx.moveTo(ac.x, ac.y)
          ctx.lineTo(fp.x, fp.y)
          ctx.stroke()
          ctx.setLineDash([])
        }
      }

      // Where the signal crosses the coast.
      if (e.env.coastal) {
        for (const c of ind.crossings) {
          const p = worldToScreen(c.point, view)
          ctx.strokeStyle = t['sim-warning']
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.arc(p.x, p.y, 5, 0, Math.PI * 2)
          ctx.stroke()
          haloText(ctx, `crosses the coast at ${c.angleDeg.toFixed(0)}°`, p.x + 8, p.y - 6, t, { font: `600 10px ${t.fontSans}` })
        }
      }

      // Reflections from the mountains.
      if (e.env.mountain) {
        const ac = worldToScreen(e.aircraft.pos, view)
        let labelled = false
        for (const r of ind.reflectors) {
          if (r.ratio < 0.02) continue
          const h = worldToScreen(r.hill.center, view)
          ctx.strokeStyle = withAlpha(t['sim-warning'], Math.min(0.9, 0.3 + r.ratio * 4))
          ctx.lineWidth = 1.2
          ctx.setLineDash([3, 3])
          ctx.beginPath()
          ctx.moveTo(sp.x, sp.y)
          ctx.lineTo(h.x, h.y)
          ctx.lineTo(ac.x, ac.y)
          ctx.stroke()
          ctx.setLineDash([])
          ctx.beginPath()
          ctx.arc(h.x, h.y, 8, 0, Math.PI * 2)
          ctx.stroke()
          if (!labelled) {
            haloText(ctx, 'reflection', h.x + 10, h.y + 14, t, { font: `600 10px ${t.fontSans}`, color: t['sim-warning'] })
            labelled = true
          }
        }
      }

      // Recent track.
      ctx.fillStyle = withAlpha(t['sim-ink'], 0.45)
      for (const p of e.trail) {
        const q = worldToScreen(p, view)
        ctx.fillRect(q.x - 1, q.y - 1, 2, 2)
      }

      // Where the beacon really is (dashed) and where the needle points (solid).
      const a = e.aircraft
      const ac = worldToScreen(a.pos, view)
      ctx.strokeStyle = t['sim-muted']
      ctx.lineWidth = 1.5
      ctx.setLineDash([5, 4])
      ctx.beginPath()
      ctx.moveTo(ac.x, ac.y)
      ctx.lineTo(sp.x, sp.y)
      ctx.stroke()
      ctx.setLineDash([])
      if (ind.bearingTrue != null) {
        const len = Math.min(distanceNm(a.pos, st.pos), range * 1.2)
        const end = worldToScreen(destinationPoint(a.pos, ind.bearingTrue, len), view)
        ctx.strokeStyle = t['sim-signal']
        ctx.lineWidth = 2.5
        ctx.beginPath()
        ctx.moveTo(ac.x, ac.y)
        ctx.lineTo(end.x, end.y)
        ctx.stroke()
        const ang = toRad(ind.bearingTrue - 90)
        ctx.fillStyle = t['sim-signal']
        ctx.beginPath()
        ctx.moveTo(end.x, end.y)
        ctx.lineTo(end.x - Math.cos(ang - 0.4) * 10, end.y - Math.sin(ang - 0.4) * 10)
        ctx.lineTo(end.x - Math.cos(ang + 0.4) * 10, end.y - Math.sin(ang + 0.4) * 10)
        ctx.closePath()
        ctx.fill()
      }

      drawStation(ctx, sp, 'ndb', t, { label: `${st.ident} NDB ${st.freqKhz} kHz` })
    },
    [engine, range],
  )

  const aircraft = useCallback((): MapAircraft[] => {
    const a = engine.aircraft
    return [{ id: a.id, pos: a.pos, headingDeg: a.headingDeg, label: [a.callsign, `${Math.round(a.altitudeFt).toLocaleString('en-US')} ft`] }]
  }, [engine])

  const endDrag = () => {
    const a = engine.aircraft
    engine.setAircraft({ held: false })
    if (engine.autopilot === 'heading') engine.setHeading(a.headingDeg)
    else if (engine.autopilot === 'orbit') engine.setAutopilot('orbit')
  }

  return (
    <MapCanvas
      rangeNm={range}
      center={engine.station.pos}
      className="aspect-square"
      drawOverlay={drawOverlay}
      aircraft={aircraft}
      selectedId={engine.aircraft.id}
      onDragStart={() => engine.setAircraft({ held: true })}
      onDrag={(_, pos) => engine.setAircraft({ pos })}
      onDragEnd={endDrag}
      onNudge={(_, d) => {
        const a = engine.aircraft
        engine.setAircraft({ pos: { x: a.pos.x + d.x, y: a.pos.y + d.y } })
        endDrag()
      }}
      label={`Map, true north up, ${range} nautical miles around the ${engine.station.ident} beacon. Drag the aircraft, or focus the map and use the arrow keys to move it.`}
    />
  )
}

/** A small zig-zag lightning bolt. */
function drawBolt(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 2.5
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(x + 4, y - 12)
  ctx.lineTo(x - 2, y - 2)
  ctx.lineTo(x + 3, y - 1)
  ctx.lineTo(x - 4, y + 11)
  ctx.stroke()
  ctx.restore()
}
