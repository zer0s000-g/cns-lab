import { useCallback } from 'react'
import { MapCanvas, type MapAircraft } from '@/components/sim/MapCanvas'
import { drawStation, haloText } from '@/components/sim/mapDraw'
import { destinationPoint, magneticToTrue, toRad, worldToScreen, type MapView } from '@/core/geometry'
import { coneRadiusNm, CONE } from '@/core/vor'
import { fmt3 } from '@/instruments/draw'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { withAlpha } from '@/lib/color'
import { BUILDING_BEARING_TRUE, STATION } from './engine'
import { useDvor, useDvorState } from './state'

/** Top-down map (true north up) with the station's magnetic compass rose. */
export function VorMap() {
  const { engine } = useDvor()
  const range = useDvorState((s) => s.mapRangeNm)

  const drawOverlay = useCallback(
    (ctx: CanvasRenderingContext2D, view: MapView, { tokens: t }: { tokens: ThemeTokens }) => {
      const e = engine
      const st = STATION.pos
      const sp = worldToScreen(st, view)
      const r = e.last
      const variation = e.variationDeg
      const px = (nm: number) => nm * view.pxPerNm

      // Compass rose aligned to magnetic north: every 10° a tick, every 30° a radial line and label.
      const roseNm = range * 0.78
      ctx.save()
      for (let m = 0; m < 360; m += 10) {
        const a = toRad(magneticToTrue(m, variation) - 90)
        const major = m % 30 === 0
        ctx.strokeStyle = withAlpha(t['sim-ink'], major ? 0.14 : 0.25)
        ctx.lineWidth = 1
        ctx.beginPath()
        if (major) {
          ctx.moveTo(sp.x + Math.cos(a) * px(range * 0.06), sp.y + Math.sin(a) * px(range * 0.06))
          ctx.lineTo(sp.x + Math.cos(a) * px(roseNm), sp.y + Math.sin(a) * px(roseNm))
        } else {
          ctx.moveTo(sp.x + Math.cos(a) * px(roseNm * 0.97), sp.y + Math.sin(a) * px(roseNm * 0.97))
          ctx.lineTo(sp.x + Math.cos(a) * px(roseNm), sp.y + Math.sin(a) * px(roseNm))
        }
        ctx.stroke()
        if (major) {
          const lx = sp.x + Math.cos(a) * px(roseNm + range * 0.07)
          const ly = sp.y + Math.sin(a) * px(roseNm + range * 0.07)
          haloText(ctx, m === 0 ? '000 (mag N)' : fmt3(m), lx, ly + 4, t, { align: 'center', font: `600 10px ${t.fontMono}`, color: t['sim-muted'] })
        }
      }
      ctx.beginPath()
      ctx.strokeStyle = withAlpha(t['sim-ink'], 0.2)
      ctx.arc(sp.x, sp.y, px(roseNm), 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()

      // Selected course (OBS) through the station.
      const obsTrue = magneticToTrue(e.obsDeg, variation)
      const far = range * 1.6
      const a1 = worldToScreen(destinationPoint(st, obsTrue, far), view)
      const a2 = worldToScreen(destinationPoint(st, obsTrue + 180, far), view)
      ctx.strokeStyle = withAlpha(t['sim-signal'], 0.55)
      ctx.lineWidth = 2
      ctx.setLineDash([10, 5])
      ctx.beginPath()
      ctx.moveTo(a2.x, a2.y)
      ctx.lineTo(a1.x, a1.y)
      ctx.stroke()
      ctx.setLineDash([])
      const lab = worldToScreen(destinationPoint(st, obsTrue, range * 0.5), view)
      haloText(ctx, `OBS course ${fmt3(e.obsDeg)}`, lab.x + 6, lab.y - 6, t, { color: t['sim-signal'], font: `600 11px ${t.fontSans}` })

      // Cone of confusion at the aircraft's height.
      const h = Math.max(0, r.heightAboveStationFt)
      const cr = coneRadiusNm(h, CONE.flagElevationDeg)
      const sr = coneRadiusNm(h, CONE.swingElevationDeg)
      if (px(sr) > 3) {
        ctx.strokeStyle = withAlpha(t['sim-warning'], 0.7)
        ctx.lineWidth = 1.2
        ctx.setLineDash([3, 3])
        ctx.beginPath()
        ctx.arc(sp.x, sp.y, px(sr), 0, Math.PI * 2)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = withAlpha(t['sim-warning'], 0.16)
        ctx.strokeStyle = t['sim-warning']
        ctx.beginPath()
        ctx.arc(sp.x, sp.y, px(cr), 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        if (px(sr) > 18) {
          haloText(ctx, `cone at ${Math.round(e.aircraft.altitudeFt).toLocaleString('en-US')} ft`, sp.x, sp.y - px(sr) - 4, t, {
            align: 'center',
            color: t['sim-warning'],
            font: `600 10px ${t.fontSans}`,
          })
        }
      }

      // Building (drawn further out than it really is so it can be seen).
      if (e.env.building) {
        const shownNm = Math.max(e.env.buildingDistanceM / 1852, 16 / view.pxPerNm)
        const b = worldToScreen(destinationPoint(st, BUILDING_BEARING_TRUE, shownNm), view)
        ctx.fillStyle = t['sim-neutral']
        ctx.strokeStyle = t['sim-ink']
        ctx.lineWidth = 1.2
        ctx.fillRect(b.x - 5, b.y - 5, 10, 10)
        ctx.strokeRect(b.x - 5, b.y - 5, 10, 10)
        haloText(ctx, `building ${e.env.buildingDistanceM} m (not to scale)`, b.x + 9, b.y + 4, t, { font: `600 10px ${t.fontSans}` })
      }

      // Recent track.
      ctx.fillStyle = withAlpha(t['sim-ink'], 0.45)
      for (const p of e.trail) {
        const q = worldToScreen(p, view)
        ctx.fillRect(q.x - 1, q.y - 1, 2, 2)
      }

      // Measured radial (solid) versus the real direction (dashed).
      const ac = worldToScreen(e.aircraft.pos, view)
      ctx.strokeStyle = t['sim-muted']
      ctx.lineWidth = 1.2
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(sp.x, sp.y)
      ctx.lineTo(ac.x, ac.y)
      ctx.stroke()
      ctx.setLineDash([])
      if (r.radialMeasured != null && r.usable) {
        const end = worldToScreen(destinationPoint(st, magneticToTrue(r.radialMeasured, variation), Math.min(r.distanceNm, range * 1.3)), view)
        ctx.strokeStyle = t['sim-signal']
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(sp.x, sp.y)
        ctx.lineTo(end.x, end.y)
        ctx.stroke()
      }

      drawStation(ctx, sp, 'vor', t, { label: `${STATION.ident} ${e.env.type === 'dvor' ? 'DVOR' : 'CVOR'} ${e.freqMHz.toFixed(2)}`, failed: !r.radiating, size: 8 })
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
    else engine.setAutopilot(engine.autopilot)
  }

  return (
    <MapCanvas
      rangeNm={range}
      center={STATION.pos}
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
      label={`Map, true north up, ${range} nautical miles around the ${STATION.ident} VOR, with the station's magnetic compass rose and the selected course. Drag the aircraft, or focus the map and use the arrow keys to move it.`}
    />
  )
}
