import { useCallback, useEffect, useRef } from 'react'
import { MapCanvas, type MapAircraft } from '@/components/sim/MapCanvas'
import { drawRangeRing, drawStation, haloText } from '@/components/sim/mapDraw'
import { distanceNm, worldToScreen, type MapView } from '@/core/geometry'
import { lineOfSight } from '@/core/propagation'
import { useSampled } from '@/hooks/useSampled'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { withAlpha } from '@/lib/color'
import { useDme, useDmeState } from './state'

/** Map of the station, our aircraft and the other aircraft using the station. */
export function TopView() {
  const { engine } = useDme()
  const range = useDmeState((s) => s.mapRangeNm)
  const showShadow = useDmeState((s) => s.showShadow)
  const shadow = useShadow(showShadow, range)

  const drawOverlay = useCallback(
    (ctx: CanvasRenderingContext2D, view: MapView, { tokens: t }: { tokens: ThemeTokens }) => {
      const e = engine
      const st = e.station.pos
      if (showShadow && shadow.current.canvas && shadow.current.range === range) ctx.drawImage(shadow.current.canvas, 0, 0, view.width, view.height)
      // Range rings.
      const step = range <= 25 ? 5 : range <= 50 ? 10 : 25
      // Label every ring when there is room, otherwise every other one.
      const every = step * view.pxPerNm >= 40 ? 1 : 2
      for (let r = step, i = 1; r <= range * 1.4; r += step, i++) {
        drawRangeRing(ctx, st, r, view, withAlpha(t['sim-grid-strong'], 0.9), { dash: [2, 4], width: 1 })
        const s = worldToScreen({ x: st.x + r, y: st.y }, view)
        if (i % every === 0 && s.x < view.width - 30) haloText(ctx, `${r} NM`, s.x + 3, s.y - 4, t, { color: t['sim-muted'], font: `500 10px ${t.fontSans}` })
      }
      // Station overload: only the closest aircraft are answered.
      if (e.load.overloaded && Number.isFinite(e.load.cutoffNm)) {
        drawRangeRing(ctx, st, e.load.cutoffNm, view, t['sim-warning'], { width: 2, dash: [8, 4] })
        const s = worldToScreen({ x: st.x + e.load.cutoffNm * 0.7071, y: st.y - e.load.cutoffNm * 0.7071 }, view)
        haloText(ctx, `Answering only within about ${e.load.cutoffNm.toFixed(0)} NM`, s.x - 4, s.y + 14, t, { color: t['sim-warning'], align: 'center' })
      }
      // Other aircraft: filled = answered, hollow with a cross = not answered.
      for (const a of e.traffic) {
        const s = worldToScreen(a.pos, view)
        if (s.x < -4 || s.y < -4 || s.x > view.width + 4 || s.y > view.height + 4) continue
        const ok = e.isAnswered(a.id)
        ctx.beginPath()
        ctx.arc(s.x, s.y, 3, 0, Math.PI * 2)
        if (ok) {
          ctx.fillStyle = withAlpha(t['sim-ink'], 0.7)
          ctx.fill()
        } else {
          ctx.strokeStyle = t['sim-muted']
          ctx.lineWidth = 1.2
          ctx.stroke()
          ctx.beginPath()
          ctx.moveTo(s.x - 2, s.y - 2)
          ctx.lineTo(s.x + 2, s.y + 2)
          ctx.moveTo(s.x + 2, s.y - 2)
          ctx.lineTo(s.x - 2, s.y + 2)
          ctx.stroke()
        }
      }
      // The radio path to our aircraft.
      const sa = worldToScreen(st, view)
      const sb = worldToScreen(e.own.pos, view)
      ctx.save()
      ctx.strokeStyle = e.heard ? withAlpha(t['sim-signal'], 0.8) : t['sim-alert']
      ctx.lineWidth = 1.5
      ctx.setLineDash(e.heard ? [] : [5, 4])
      ctx.beginPath()
      ctx.moveTo(sa.x, sa.y)
      ctx.lineTo(sb.x, sb.y)
      ctx.stroke()
      ctx.restore()
      if (!e.heard) {
        const w = worldToScreen(e.los.worstPoint, view)
        ctx.fillStyle = t['sim-alert']
        ctx.beginPath()
        ctx.arc(w.x, w.y, 4, 0, Math.PI * 2)
        ctx.fill()
        haloText(ctx, 'Blocked', w.x + 7, w.y - 6, t, { color: t['sim-alert'] })
      }
      // Circle of the distance the DME shows, drawn as if it were a distance over the ground.
      const r = e.reading()
      // Shown when it differs visibly from where the aircraft really is (overhead, or a wrong lock).
      if (r.distanceNm !== null && Math.abs(r.distanceNm - e.ownGroundNm) > Math.max(0.08, 0.02 * e.ownGroundNm)) {
        drawRangeRing(ctx, st, r.distanceNm, view, t['primary'], { width: 1.5, dash: [6, 4] })
        const s = worldToScreen({ x: st.x + r.distanceNm * 0.7071, y: st.y + r.distanceNm * 0.7071 }, view)
        haloText(ctx, `DME reads ${r.distanceNm.toFixed(1)} NM`, s.x + 5, s.y - 4, t, { color: t['primary'] })
      }
      drawStation(ctx, sa, 'dme', t, { label: `${e.station.ident} DME` })
    },
    [engine, showShadow, shadow, range],
  )

  const aircraft = useCallback((): MapAircraft[] => {
    const e = engine
    const r = e.reading()
    const list: MapAircraft[] = [
      {
        id: e.own.id,
        pos: e.own.pos,
        headingDeg: e.own.headingDeg,
        label: [e.own.callsign, `${Math.round(e.own.altitudeFt).toLocaleString('en-US')} ft`, r.distanceNm === null ? 'DME: no reading' : `DME ${r.distanceNm.toFixed(1)} NM`],
        style: e.heard ? 'normal' : 'dim',
      },
    ]
    if (e.twin) list.push({ id: e.twin.id, pos: e.twin.pos, headingDeg: e.twin.headingDeg, label: [e.twin.callsign, 'no jitter'], style: 'alert', draggable: false })
    return list
  }, [engine])

  const describe = useSampled(() => {
    const e = engine
    const r = e.reading()
    return `Map around the ${e.station.ident} DME, ${range} nautical miles each way. CNS101 is ${e.ownGroundNm.toFixed(1)} nautical miles from the station over the ground at ${Math.round(e.own.altitudeFt)} feet. The DME ${r.distanceNm === null ? 'shows no distance' : `reads ${r.distanceNm.toFixed(1)} nautical miles`}. ${e.traffic.length} other aircraft use the station${e.load.overloaded ? `; it is overloaded and answers only aircraft within about ${e.load.cutoffNm.toFixed(0)} nautical miles` : ''}. Select CNS101 and use the arrow keys to move it.`
  }, 1000)

  return (
    <MapCanvas
      rangeNm={range}
      center={engine.station.pos}
      className="aspect-[4/3]"
      drawOverlay={drawOverlay}
      aircraft={aircraft}
      selectedId={engine.own.id}
      onDragStart={(id) => id === engine.own.id && engine.setOwn({ held: true })}
      onDrag={(id, pos) => id === engine.own.id && engine.setOwn({ pos })}
      onDragEnd={(id) => {
        if (id !== engine.own.id) return
        engine.setOwn({ held: false, mode: { kind: 'heading' }, targetHeadingDeg: engine.own.headingDeg })
        engine.resetAvionics()
      }}
      onNudge={(id, d) => {
        if (id !== engine.own.id) return
        const a = engine.own
        engine.setOwn({ pos: { x: a.pos.x + d.x, y: a.pos.y + d.y }, mode: { kind: 'heading' }, targetHeadingDeg: a.headingDeg })
        engine.resetAvionics()
      }}
      label={describe}
    />
  )
}

/** Where the station cannot hear an aircraft at CNS101's altitude (computed off the animation loop). */
function useShadow(enabled: boolean, range: number) {
  const { engine } = useDme()
  const alt = useSampled(() => Math.round(engine.own.altitudeFt / 500) * 500, 500)
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
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--sim-shadow-zone').trim()
      const st = engine.station
      for (let r = 0; r < n; r++) {
        for (let k = 0; k < n; k++) {
          const p = { x: st.pos.x - range + ((k + 0.5) / n) * 2 * range, y: st.pos.y + range - ((r + 0.5) / n) * 2 * range }
          if (distanceNm(st.pos, p) < 0.5) continue
          if (!lineOfSight(st.pos, st.heightFt, p, alt, engine.terrain, Math.max(0.5, range / 60)).visible) ctx.fillRect(k, r, 1, 1)
        }
      }
      ref.current = { canvas: c, range, alt }
    }, 60)
    return () => window.clearTimeout(id)
  }, [enabled, range, alt, engine])
  return ref
}
