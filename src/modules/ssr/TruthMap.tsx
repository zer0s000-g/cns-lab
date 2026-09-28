import { useCallback } from 'react'
import { MapCanvas, type MapAircraft } from '@/components/sim/MapCanvas'
import { drawBeamWedge, drawStation, haloText } from '@/components/sim/mapDraw'
import { toRad, worldToScreen, type MapView } from '@/core/geometry'
import { GARBLE_RANGE_NM, MAIN_BEAM_MTL_RANGE_NM, SIDE_LOBE_FAR_DB, SIDE_LOBE_NEAR_DB, specialCode, ssrPatternDb } from '@/core/ssr'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { withAlpha } from '@/lib/color'
import { OTHER_RADAR } from './engine'
import { useSsr, useSsrState } from './state'

/**
 * Farthest distance (NM) at which the antenna, pointing `offDeg` away, can still
 * trigger a transponder (free space, one-way loss ∝ R²). Side lobes use their
 * envelope (the lobe peaks) so the outline is smooth.
 */
export function sideLobeReachNm(offDeg: number): number {
  const d = Math.abs(((offDeg % 360) + 540) % 360 - 180)
  const envDb = SIDE_LOBE_NEAR_DB + (SIDE_LOBE_FAR_DB - SIDE_LOBE_NEAR_DB) * Math.min(1, d / 90)
  const db = Math.max(ssrPatternDb(d), envDb)
  return MAIN_BEAM_MTL_RANGE_NM * 10 ** (db / 20)
}

/** God's-eye view of the real situation. Aircraft can be dragged. */
export function SsrTruthMap() {
  const { engine } = useSsr()
  const range = useSsrState((s) => s.scopeRangeNm)
  const selectedId = useSsrState((s) => s.selectedId)
  const select = useSsrState((s) => s.select)

  const drawOverlay = useCallback(
    (ctx: CanvasRenderingContext2D, view: MapView, { tokens: t }: { tokens: ThemeTokens }) => {
      const e = engine
      const c = worldToScreen(e.site.pos, view)
      // Without P2, the side lobes can trigger transponders close to the radar: outline where they reach.
      if (e.env.noP2) {
        ctx.save()
        ctx.beginPath()
        for (let d = -180; d <= 180; d += 1) {
          const r = Math.min(sideLobeReachNm(d), range * 3) * view.pxPerNm
          const a = toRad(e.antennaAz + d - 90)
          const x = c.x + Math.cos(a) * r
          const y = c.y + Math.sin(a) * r
          if (d === -180) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.closePath()
        ctx.fillStyle = withAlpha(t['sim-warning'], 0.1)
        ctx.fill()
        ctx.strokeStyle = withAlpha(t['sim-warning'], 0.85)
        ctx.setLineDash([4, 3])
        ctx.lineWidth = 1.3
        ctx.stroke()
        ctx.restore()
        const back = sideLobeReachNm(180) * view.pxPerNm
        const la = toRad(e.antennaAz + 180 - 90)
        haloText(ctx, 'Side lobes can trigger replies inside the dashed line', c.x + Math.cos(la) * back, c.y + Math.sin(la) * back + (Math.sin(la) >= 0 ? 16 : -8), t, {
          font: `600 10px ${t.fontSans}`,
          align: 'center',
          color: t['sim-warning'],
        })
      }

      // Garble zone around the lead aircraft of the in-trail pair.
      if (e.env.garblePair && e.params.mode === 'ac') {
        const g = e.geometry('CNS303')
        if (g) {
          ctx.save()
          ctx.fillStyle = withAlpha(t['sim-warning'], 0.14)
          ctx.strokeStyle = withAlpha(t['sim-warning'], 0.8)
          ctx.setLineDash([3, 3])
          const r0 = Math.max(0, g.ground - GARBLE_RANGE_NM) * view.pxPerNm
          const r1 = (g.ground + GARBLE_RANGE_NM) * view.pxPerNm
          const a0 = toRad(g.az - 3 - 90)
          const a1 = toRad(g.az + 3 - 90)
          ctx.beginPath()
          ctx.arc(c.x, c.y, r1, a0, a1)
          ctx.arc(c.x, c.y, r0, a1, a0, true)
          ctx.closePath()
          ctx.fill()
          ctx.stroke()
          ctx.restore()
          const m = worldToScreen({ x: Math.sin(toRad(g.az + 4)) * g.ground, y: Math.cos(toRad(g.az + 4)) * g.ground }, view)
          haloText(ctx, `Replies overlap within ±${GARBLE_RANGE_NM.toFixed(2)} NM`, m.x + 6, m.y, t, { font: `500 10px ${t.fontSans}`, color: t['sim-warning'] })
        }
      }

      // Main beam.
      drawBeamWedge(ctx, e.site.pos, e.antennaAz, e.beamWidthDeg, range * 1.5, view, withAlpha(t['sim-signal'], 0.2), withAlpha(t['sim-signal'], 0.75))

      if (e.env.fruit) {
        const s = worldToScreen(OTHER_RADAR, view)
        drawStation(ctx, s, 'radar', t, { label: 'Another radar' })
        haloText(ctx, 'its replies reach us too (FRUIT)', s.x, s.y + 32, t, { font: `500 10px ${t.fontSans}`, align: 'center', color: t['sim-muted'] })
      }
      drawStation(ctx, c, 'radar', t, { label: 'SSR + primary radar' })
    },
    [engine, range],
  )

  const aircraft = useCallback((): MapAircraft[] => {
    return engine.aircraft.map((a) => {
      const x = engine.transponder(a.id)
      const special = specialCode(x.squawk)
      const lines = [a.callsign, `${Math.round(a.altitudeFt).toLocaleString('en-US')} ft`]
      lines.push(x.on ? `squawk ${x.squawk}${special ? ` ${special.tag}` : ''}` : 'transponder OFF')
      return {
        id: a.id,
        pos: a.pos,
        headingDeg: a.headingDeg,
        label: lines,
        style: !x.on ? 'dim' : special && special.kind !== 'radio' ? 'alert' : 'normal',
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
      label={`Map of the real situation around the secondary radar, ${range} nautical miles in every direction, with ${engine.aircraft.length} aircraft. Select an aircraft and use the arrow keys to move it.`}
    />
  )
}
