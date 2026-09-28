import { useCallback, useEffect, useRef } from 'react'
import { MapCanvas, type MapAircraft } from '@/components/sim/MapCanvas'
import { drawBeamWedge, drawRangeRing, drawStation, haloText } from '@/components/sim/mapDraw'
import { distanceNm, worldToScreen, type MapView } from '@/core/geometry'
import { useSampled } from '@/hooks/useSampled'
import { lineOfSight, radioLineOfSightNm } from '@/core/propagation'
import { elevationAngleDeg, maxDetectionRangeNm, maxUnambiguousRangeNm, MAX_ELEVATION_DEG, rainReflectivity, RCS_M2 } from '@/core/radar'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { withAlpha } from '@/lib/color'
import { usePsr, usePsrState } from './state'
import type { LastLook } from './engine'

export const REASON_TEXT: Record<LastLook['reason'], string> = {
  ok: 'seen',
  weak: 'echo too weak',
  horizon: 'below radar horizon',
  terrain: 'hidden by terrain',
  cone: 'overhead: cone of silence',
  mti: 'cancelled by MTI',
}

/** God's-eye view of the real situation. Aircraft can be dragged. */
export function TruthMap() {
  const { engine } = usePsr()
  const range = usePsrState((s) => s.scopeRangeNm)
  const selectedId = usePsrState((s) => s.selectedId)
  const select = usePsrState((s) => s.select)
  const showCoverage = usePsrState((s) => s.showCoverage)
  const coverage = useCoverage(showCoverage, range)

  const drawOverlay = useCallback(
    (ctx: CanvasRenderingContext2D, view: MapView, { tokens: t }: { tokens: ThemeTokens }) => {
      const e = engine
      if (showCoverage && coverage.current.canvas && coverage.current.range === range) {
        ctx.drawImage(coverage.current.canvas, 0, 0, view.width, view.height)
      }
      // Rain.
      if (e.env.rain) {
        for (let x = -14; x <= 14; x += 0.8) {
          for (let y = -14; y <= 14; y += 0.8) {
            const p = { x: e.storm.center.x + x, y: e.storm.center.y + y }
            const s = rainReflectivity(p, e.storm)
            if (s <= 0.05) continue
            const sp = worldToScreen(p, view)
            ctx.fillStyle = withAlpha(t['sim-signal-2'], 0.15 + 0.5 * s)
            ctx.fillRect(sp.x - 1, sp.y - 1, 2.2, 2.2)
          }
        }
        const c = worldToScreen(e.storm.center, view)
        haloText(ctx, 'Rain shower', c.x, c.y - e.storm.radiusNm * view.pxPerNm - 4, t, { align: 'center', color: t['sim-signal-2'] })
      }
      // Birds.
      if (e.env.birds) {
        ctx.strokeStyle = t['sim-ink']
        ctx.lineWidth = 1.2
        for (const b of e.birds) {
          const s = worldToScreen(b.pos, view)
          ctx.beginPath()
          ctx.moveTo(s.x - 3, s.y - 1.5)
          ctx.lineTo(s.x, s.y + 0.5)
          ctx.lineTo(s.x + 3, s.y - 1.5)
          ctx.stroke()
        }
        const s0 = worldToScreen(e.birds[0].pos, view)
        haloText(ctx, 'Birds', s0.x + 6, s0.y - 6, t, { font: `500 10px ${t.fontSans}` })
      }
      // Wind farm.
      if (e.env.windFarm) {
        const spin = e.timeS * 4
        for (const tb of e.turbines) {
          const s = worldToScreen(tb, view)
          ctx.strokeStyle = t['sim-ink']
          ctx.lineWidth = 1.2
          for (let k = 0; k < 3; k++) {
            const a = spin + (k * 2 * Math.PI) / 3
            ctx.beginPath()
            ctx.moveTo(s.x, s.y)
            ctx.lineTo(s.x + Math.cos(a) * 4, s.y + Math.sin(a) * 4)
            ctx.stroke()
          }
        }
        const s = worldToScreen(e.turbines[4], view)
        haloText(ctx, 'Wind farm', s.x + 8, s.y + 12, t, { font: `500 10px ${t.fontSans}` })
      }
      // Ranges.
      const ru = maxUnambiguousRangeNm(e.params.prfHz)
      if (ru < range * 0.92) {
        drawRangeRing(ctx, e.site.pos, ru, view, t['sim-warning'], { label: `Max unambiguous range ${ru.toFixed(0)} NM`, labelBearingDeg: 315 })
      }
      const det = maxDetectionRangeNm(e.params, RCS_M2.medium)
      if (det < range * 0.92) {
        drawRangeRing(ctx, e.site.pos, det, view, t['sim-muted'], { label: `Medium aircraft seen to ${det.toFixed(0)} NM`, labelBearingDeg: 225, dash: [2, 4] })
      }
      // Beam.
      drawBeamWedge(ctx, e.site.pos, e.antennaAz, Math.max(e.params.beamWidthDeg, 0.8), range * 1.5, view, withAlpha(t['sim-signal'], 0.18), withAlpha(t['sim-signal'], 0.7))
      drawStation(ctx, worldToScreen(e.site.pos, view), 'radar', t, { label: 'Radar' })
    },
    [engine, showCoverage, coverage, range],
  )

  const aircraft = useCallback((): MapAircraft[] => {
    return engine.aircraft.map((a) => {
      const look = engine.lastLook.get(a.id)
      const status = look && look.reason !== 'ok' ? REASON_TEXT[look.reason] : null
      return {
        id: a.id,
        pos: a.pos,
        headingDeg: a.headingDeg,
        label: [a.callsign, `${Math.round(a.altitudeFt).toLocaleString('en-US')} ft`, ...(status ? [`not seen: ${status}`] : [])],
        style: status ? 'dim' : 'normal',
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
      label={`Map of the real situation around the radar, ${range} nautical miles in every direction, with ${engine.aircraft.length} aircraft. Select an aircraft and use the arrow keys to move it.`}
    />
  )
}

/** Terrain shadow map for the selected aircraft's altitude (computed off the animation loop). */
function useCoverage(enabled: boolean, range: number) {
  const { engine } = usePsr()
  const selectedId = usePsrState((s) => s.selectedId)
  const alt = useSampled(() => {
    const a = engine.getAircraft(selectedId)
    return a ? Math.round(a.altitudeFt / 500) * 500 : 5000
  }, 500)
  const ref = useRef<{ canvas: HTMLCanvasElement | null; range: number; alt: number }>({ canvas: null, range: 0, alt: -1 })
  useEffect(() => {
    if (!enabled) return
    if (ref.current.range === range && ref.current.alt === alt && ref.current.canvas) return
    const id = window.setTimeout(() => {
      const n = 90
      const c = document.createElement('canvas')
      c.width = n
      c.height = n
      const ctx = c.getContext('2d')!
      const t = getComputedStyle(document.documentElement).getPropertyValue('--sim-shadow-zone').trim()
      ctx.fillStyle = t
      const site = engine.site
      const maxLos = radioLineOfSightNm(site.heightFt, alt)
      for (let r = 0; r < n; r++) {
        for (let k = 0; k < n; k++) {
          const p = { x: -range + ((k + 0.5) / n) * 2 * range, y: range - ((r + 0.5) / n) * 2 * range }
          const g = distanceNm(site.pos, p)
          const hidden =
            g > maxLos ||
            elevationAngleDeg(g, alt, site.heightFt) > MAX_ELEVATION_DEG ||
            !lineOfSight(site.pos, site.heightFt, p, alt, engine.terrain, 1).visible
          if (hidden) ctx.fillRect(k, r, 1, 1)
        }
      }
      ref.current = { canvas: c, range, alt }
    }, 60)
    return () => window.clearTimeout(id)
  }, [enabled, range, alt, engine])
  return ref
}
