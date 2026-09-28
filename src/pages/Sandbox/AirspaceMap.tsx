import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ArrowRight, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MapCanvas, type MapAircraft } from '@/components/sim/MapCanvas'
import { drawRangeRing, drawStation, haloText } from '@/components/sim/mapDraw'
import { worldToScreen, type MapView, type Vec2 } from '@/core/geometry'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { getThemeTokens } from '@/hooks/useThemeTokens'
import { withAlpha } from '@/lib/color'
import { MODULE_BY_ID } from '@/modules/registry'
import { JAMMER } from './engine'
import { ALL_SITES, OCEANIC_BOUNDARY_X, SYSTEM_BY_ID, type SiteDef, type SystemId } from './systems'
import { JOURNEY, JOURNEY_START, THRESHOLD } from './journey'
import { VIEWS, useSandbox, useSandboxState } from './state'

/** Map of the region with every system, coverage overlays and the real aircraft. */
export function AirspaceMap() {
  const { engine } = useSandbox()
  const view = useSandboxState((s) => s.view)
  const follow = useSandboxState((s) => s.followJourney)
  const selectedId = useSandboxState((s) => s.selectedId)
  const select = useSandboxState((s) => s.select)
  const coverage = useSandboxState((s) => s.coverage)
  const coverageAlt = useSandboxState((s) => s.coverageAltFt)
  const systems = useSandboxState((s) => s.systems)
  const scenario = useSandboxState((s) => s.scenario)
  const [site, setSite] = useState<SiteDef | null>(null)
  const viewRef = useRef<MapView | null>(null)
  const v = VIEWS[view]
  const center = useFollowCenter(follow, v.center)
  const cov = useCoverageRaster(coverage, coverageAlt, view, center, `${JSON.stringify(systems)}|${scenario}`)

  const drawOverlay = useCallback(
    (ctx: CanvasRenderingContext2D, mv: MapView, { tokens: t }: { tokens: ThemeTokens }) => {
      viewRef.current = mv
      const c = cov.ref.current
      if (c.canvas && c.key === cov.key) {
        const tl = worldToScreen({ x: c.bounds.minX, y: c.bounds.maxY }, mv)
        const br = worldToScreen({ x: c.bounds.maxX, y: c.bounds.minY }, mv)
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(c.canvas, tl.x, tl.y, br.x - tl.x, br.y - tl.y)
        ctx.imageSmoothingEnabled = true
      }
      // Oceanic airspace boundary.
      const b0 = worldToScreen({ x: OCEANIC_BOUNDARY_X, y: mv.center.y + 400 }, mv)
      const b1 = worldToScreen({ x: OCEANIC_BOUNDARY_X, y: mv.center.y - 400 }, mv)
      ctx.strokeStyle = withAlpha(t['sim-ink'], 0.5)
      ctx.setLineDash([10, 6])
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(b0.x, b0.y)
      ctx.lineTo(b1.x, b1.y)
      ctx.stroke()
      ctx.setLineDash([])
      haloText(ctx, 'Oceanic airspace →', b0.x - 6, 44, t, { font: `600 11px ${t.fontSans}`, align: 'right' })
      // Planned route of CNS700.
      ctx.strokeStyle = withAlpha(t['sim-signal'], 0.45)
      ctx.lineWidth = 1.5
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      let p = worldToScreen(JOURNEY_START.pos, mv)
      ctx.moveTo(p.x, p.y)
      for (const l of JOURNEY) {
        p = worldToScreen(l.to, mv)
        ctx.lineTo(p.x, p.y)
      }
      p = worldToScreen(THRESHOLD, mv)
      ctx.lineTo(p.x, p.y)
      ctx.stroke()
      ctx.setLineDash([])
      // Runway.
      const r0 = worldToScreen({ x: -0.81, y: 0 }, mv)
      const r1 = worldToScreen({ x: 0.81, y: 0 }, mv)
      ctx.strokeStyle = t['sim-ink']
      ctx.lineWidth = Math.max(3, 0.08 * mv.pxPerNm)
      ctx.beginPath()
      ctx.moveTo(r0.x, r0.y)
      ctx.lineTo(r1.x, r1.y)
      ctx.stroke()
      // Jammer.
      if (engine.scenario === 'gnssJam') {
        drawRangeRing(ctx, JAMMER.pos, JAMMER.radiusNm, mv, t['sim-alert'], { label: 'GNSS jamming', dash: [3, 4], width: 2, labelBearingDeg: 20 })
        const j = worldToScreen(JAMMER.pos, mv)
        ctx.fillStyle = t['sim-alert']
        ctx.beginPath()
        ctx.arc(j.x, j.y, 4, 0, Math.PI * 2)
        ctx.fill()
      }
      // Stations, then their labels without overlaps (a label is skipped if it would collide).
      const boxes: { x0: number; y0: number; x1: number; y1: number }[] = []
      const visible = ALL_SITES.map((st) => ({ st, s: worldToScreen(st.pos, mv) })).filter(
        ({ s }) => s.x > -20 && s.y > -20 && s.x < mv.width + 20 && s.y < mv.height + 20,
      )
      for (const { st, s } of visible) {
        drawStation(ctx, s, st.kind, t, { failed: !engine.systemUp(st.system), size: 6 })
      }
      ctx.font = `600 11px ${t.fontSans}`
      for (const { st, s } of visible) {
        if (!st.label || mv.pxPerNm < 3) continue
        const w = ctx.measureText(st.label).width
        const x = Math.min(mv.width - 4 - w / 2, Math.max(4 + w / 2, s.x))
        const box = { x0: x - w / 2 - 2, y0: s.y + 9, x1: x + w / 2 + 2, y1: s.y + 23 }
        const hits = boxes.some((b) => !(box.x1 < b.x0 || box.x0 > b.x1 || box.y1 < b.y0 || box.y0 > b.y1))
        if (hits) continue
        boxes.push(box)
        haloText(ctx, st.label, x, s.y + 10, t, { align: 'center', baseline: 'top', color: engine.systemUp(st.system) ? t['sim-ink'] : t['sim-muted'] })
      }
    },
    [engine, cov.ref, cov.key],
  )

  const aircraft = useCallback((): MapAircraft[] => {
    const wide = VIEWS[view].rangeNm > 60
    return engine.aircraft
      .filter((a) => a.journey?.phase !== 'landed')
      .map((a) => {
        const tracked = engine.tracks.has(a.id)
        const alert = engine.alerts.some((al) => al.ids.includes(a.id))
        // In the wide views only label aircraft away from the crowded terminal area.
        const labelled = !wide || a.id === selectedId || alert || Boolean(a.journey) || Math.hypot(a.pos.x, a.pos.y) > 25
        return {
          id: a.id,
          pos: a.pos,
          headingDeg: a.headingDeg,
          label: labelled
            ? [a.callsign === 'UNK1' ? 'No transponder' : a.callsign, `${Math.round(a.altitudeFt / 100) * 100} ft`, ...(tracked ? [] : ['not on the controller’s screen'])]
            : undefined,
          style: alert ? 'alert' : tracked ? 'normal' : 'dim',
          draggable: false,
        }
      })
  }, [engine, view, selectedId])

  const onMapClick = (pos: Vec2) => {
    const mv = viewRef.current
    if (!mv) return
    let best: { s: SiteDef; d: number } | null = null
    for (const s of ALL_SITES) {
      const a = worldToScreen(s.pos, mv)
      const b = worldToScreen(pos, mv)
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      if (d < 16 && (!best || d < best.d)) best = { s, d }
    }
    setSite(best?.s ?? null)
  }

  const sys = site ? SYSTEM_BY_ID.get(site.system) : null
  const mod = sys ? MODULE_BY_ID.get(sys.moduleId) : null

  return (
    <div className="relative">
      <MapCanvas
        rangeNm={v.rangeNm}
        center={center}
        peakLabels={view === 'terminal'}
        className="aspect-square"
        drawOverlay={drawOverlay}
        aircraft={aircraft}
        selectedId={selectedId}
        onSelect={select}
        onMapClick={onMapClick}
        label={`Map of the region, ${v.label.toLowerCase()} view. ${engine.aircraft.length} aircraft. Click a ground station to learn about it.`}
      />
      {site && sys && (
        <div className="absolute right-2 bottom-2 left-2 flex items-start gap-3 rounded-md border bg-card p-3 sm:left-auto sm:w-72" role="dialog" aria-label={sys.name}>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{sys.name}</p>
            <p className="text-xs text-muted-foreground">{sys.desc}</p>
            <p className="mt-1 text-xs font-medium">{engine.systemUp(sys.id) ? 'Working' : 'Not working (switched off or failed)'}</p>
            {mod && (
              <Button asChild size="sm" variant="link" className="mt-1 h-auto p-0">
                <Link to={mod.path}>
                  Open the {mod.short} module <ArrowRight aria-hidden />
                </Link>
              </Button>
            )}
          </div>
          <Button size="icon-sm" variant="ghost" onClick={() => setSite(null)} aria-label="Close">
            <X aria-hidden />
          </Button>
        </div>
      )}
    </div>
  )
}

/** Follow CNS700 by snapping the map centre every few seconds (keeps the terrain cache useful). */
function useFollowCenter(follow: boolean, fallback: Vec2): Vec2 {
  const { engine } = useSandbox()
  const [c, setC] = useState(fallback)
  useEffect(() => {
    if (!follow) {
      setC(fallback)
      return
    }
    const upd = () => {
      const a = engine.journeyAircraft
      if (a) setC({ x: Math.round(a.pos.x / 10) * 10, y: Math.round(a.pos.y / 10) * 10 })
    }
    upd()
    const id = window.setInterval(upd, 1500)
    return () => window.clearInterval(id)
  }, [follow, fallback.x, fallback.y, engine])
  return c
}

interface CoverageRaster {
  canvas: HTMLCanvasElement | null
  key: string
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
}

/** Coverage of the chosen system at an altitude, computed in small chunks off the frame loop. */
function useCoverageRaster(system: SystemId | null, altFt: number, view: keyof typeof VIEWS, center: Vec2, depsKey: string) {
  const { engine } = useSandbox()
  const ref = useRef<CoverageRaster>({ canvas: null, key: '', bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 } })
  const key = system ? `${system}|${altFt}|${view}|${center.x},${center.y}|${depsKey}` : ''
  useEffect(() => {
    if (!system) {
      ref.current = { canvas: null, key: '', bounds: ref.current.bounds }
      return
    }
    const r = VIEWS[view].rangeNm * 1.05
    const bounds = { minX: center.x - r, maxX: center.x + r, minY: center.y - r, maxY: center.y + r }
    const n = 96
    const c = document.createElement('canvas')
    c.width = n
    c.height = n
    const ctx = c.getContext('2d')!
    ctx.fillStyle = getThemeTokens()['sim-coverage']
    let row = 0
    let cancelled = false
    let timer = 0
    const tick = () => {
      if (cancelled) return
      const until = Math.min(n, row + 6)
      for (; row < until; row++) {
        const y = bounds.maxY - ((row + 0.5) / n) * (bounds.maxY - bounds.minY)
        for (let k = 0; k < n; k++) {
          const x = bounds.minX + ((k + 0.5) / n) * (bounds.maxX - bounds.minX)
          if (engine.coverageAt(system, { x, y }, altFt)) ctx.fillRect(k, row, 1, 1)
        }
      }
      ref.current = { canvas: c, key, bounds }
      if (row < n) timer = window.setTimeout(tick, 0)
    }
    timer = window.setTimeout(tick, 30)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [system, altFt, view, center.x, center.y, key, engine])
  return { ref, key }
}
