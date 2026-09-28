import { useCallback } from 'react'
import { TriangleAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import type { Vec2 } from '@/core/geometry'
import { metresToNm, METRES_PER_NM } from '@/core/units'
import { useSampled } from '@/hooks/useSampled'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { RadarScope, type ScopeFrame, type ScopeProjector, type ScopeTrack } from '@/instruments'
import { withAlpha } from '@/lib/color'
import { drawAirport, drawStopBars } from './draw'
import type { Source, SurfaceEngine } from './engine'
import { RWY, SMR_SITE } from './layout'
import { useSurface, useSurfaceState, ZOOMS, type ZoomId } from './state'

const LETTER: Record<Source, string> = { smr: 'S', mlat: 'M', adsb: 'A' }
const KT = 1.943844

/** NM relative to the SMR (what RadarScope expects) from airport metres. */
const rel = (p: Vec2) => ({ x: metresToNm(p.x - SMR_SITE.x), y: metresToNm(p.y - SMR_SITE.y) })

/** Labelled tracks for the display, from the fused tracker or the raw sensor plots. */
export function scopeTracks(engine: SurfaceEngine, selectedId: string | null, compact = false): ScopeTrack[] {
  const out: ScopeTrack[] = []
  const alert = new Set([...engine.alert.intruders, ...(engine.alert.against ? [engine.alert.against] : [])])
  const L = engine.layers
  const speed = (id: string) => Math.round((engine.get(id)?.speedMs ?? 0) * KT)
  if (L.fused) {
    for (const tr of engine.tracks.values()) {
      const src = engine.trackSources(tr)
      if (!src.length) continue
      const id = tr.ghost ? tr.key : tr.objectId
      const age = engine.trackAge(tr)
      out.push({
        id,
        ...rel(tr.pos),
        symbol: age > 1.6 ? 'coast' : tr.identity ? 'fused' : 'primary',
        label: compact && !alert.has(id) && tr.objectId !== selectedId ? [tr.identity ?? 'Unknown'] : [tr.identity ?? 'Unknown', `${speed(tr.objectId)} kt ${src.map((s) => LETTER[s]).join('')}`],
        emphasis: alert.has(id) ? 'alert' : !tr.ghost && tr.objectId === selectedId ? 'selected' : 'normal',
      })
    }
    return out
  }
  const shown = new Set<string>()
  if (L.mlat) {
    for (const p of engine.mlatPlots.values()) {
      if (engine.timeS - p.timeS > 1.5) continue
      shown.add(p.objectId)
      out.push({ id: p.objectId, ...rel(p.pos), symbol: 'mlat', label: [p.callsign], emphasis: alert.has(p.objectId) ? 'alert' : p.objectId === selectedId ? 'selected' : 'normal' })
    }
  }
  if (L.adsb) {
    for (const p of engine.adsbPlots.values()) {
      if (engine.timeS - p.timeS > 1) continue
      out.push({
        id: `adsb:${p.objectId}`,
        ...rel(p.pos),
        symbol: 'adsb',
        label: shown.has(p.objectId) ? undefined : [p.callsign],
        emphasis: alert.has(p.objectId) ? 'alert' : p.objectId === selectedId && !shown.has(p.objectId) ? 'selected' : 'normal',
      })
    }
  }
  return out
}

function niceMetres(v: number): number {
  const steps = [10, 20, 50, 100, 200, 500, 1000]
  let best = steps[0]
  for (const s of steps) if (s <= v) best = s
  return best
}

export function SurfaceScope() {
  const { engine } = useSurface()
  const zoom = useSurfaceState((s) => s.zoom)
  const selectedId = useSurfaceState((s) => s.selectedId)
  const select = useSurfaceState((s) => s.select)
  const z = ZOOMS[zoom]
  const centerNm = rel(z.centre)

  const underlay = useCallback(
    (ctx: CanvasRenderingContext2D, project: ScopeProjector, t: ThemeTokens, pxPerNm: number) => {
      const toS = (m: Vec2) => project(rel(m))
      const pxPerM = pxPerNm / METRES_PER_NM
      drawAirport(ctx, toS, pxPerM, {
        grass: null,
        runway: withAlpha(t['scope-grid-strong'], 0.55),
        taxiway: withAlpha(t['scope-grid'], 0.7),
        marking: withAlpha(t['scope-text'], 0.35),
        guideLine: withAlpha(t['scope-dim'], 0.35),
        building: withAlpha(t['scope-grid-strong'], 0.9),
        buildingEdge: t['scope-dim'],
        road: withAlpha(t['scope-grid'], 0.8),
        text: t['scope-dim'],
        muted: withAlpha(t['scope-dim'], 0.8),
      }, { labels: zoom !== 'airport', font: `600 10px ${t.fontSans}` })
      drawStopBars(ctx, toS, pxPerM, engine.stopBars, t['scope-alert'], withAlpha(t['scope-dim'], 0.5))
      // Runway protected area.
      const a = toS({ x: RWY.thresholdX - 60, y: RWY.holdingDistM })
      const b = toS({ x: RWY.endX + 60, y: -RWY.holdingDistM })
      ctx.save()
      ctx.setLineDash([5, 4])
      ctx.lineWidth = engine.alert.level === 'none' ? 1 : 2
      ctx.strokeStyle = engine.alert.level === 'alert' ? t['scope-alert'] : engine.alert.level === 'caution' ? t['scope-warning'] : withAlpha(t['scope-dim'], 0.6)
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y)
      ctx.restore()
      // Scale bar in metres, inside the round screen.
      const len = niceMetres(ZOOMS[zoom].scopeM * 0.35)
      const start = { x: ZOOMS[zoom].centre.x - ZOOMS[zoom].scopeM * 0.45, y: ZOOMS[zoom].centre.y - ZOOMS[zoom].scopeM * 0.62 }
      const s0 = toS(start)
      const s1 = toS({ x: start.x + len, y: start.y })
      ctx.strokeStyle = t['scope-text']
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(s0.x, s0.y - 4)
      ctx.lineTo(s0.x, s0.y)
      ctx.lineTo(s1.x, s1.y)
      ctx.lineTo(s1.x, s1.y - 4)
      ctx.stroke()
      ctx.fillStyle = t['scope-text']
      ctx.font = `600 10px ${t.fontSans}`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'bottom'
      ctx.fillText(len >= 1000 ? `${len / 1000} km` : `${len} m`, s0.x + 4, s0.y - 4)
    },
    [engine, zoom],
  )

  const read = useCallback((): ScopeFrame => {
    const paints = engine.takePaints()
    return {
      nowS: engine.timeS,
      sweepAzDeg: engine.smrAz,
      beamWidthDeg: engine.smr.beamWidthDeg,
      paints: engine.layers.smr ? paints : [],
      tracks: scopeTracks(engine, selectedId, zoom === 'airport'),
    }
  }, [engine, selectedId, zoom])

  const alert = useSampled(() => {
    const a = engine.alert
    if (a.level === 'none') return null
    const who = a.intruders.map((id) => engine.nameOf(id)).join(', ')
    const against = a.against ? engine.get(a.against) : undefined
    const mv = a.against ? engine.movements().find((m) => m.id === a.against) : undefined
    const what = against ? (mv?.kind === 'takeoff' ? `${against.callsign} is taking off` : mv?.onRunway ? `${against.callsign} is landing` : `${against.callsign} is ${Math.round(mv?.timeToThresholdS ?? 0)} s from landing`) : ''
    return { level: a.level, who, what }
  }, 250, (x, y) => JSON.stringify(x) === JSON.stringify(y))

  return (
    <div className="relative">
      <RadarScope
        maxRangeNm={metresToNm(z.scopeM)}
        centerNm={centerNm}
        ringStepNm={100}
        persistenceS={0.9}
        underlay={underlay}
        read={read}
        describe={() => describe(engine)}
        onTrackClick={(id) => {
          if (engine.get(id)) select(id)
        }}
      />
      {alert && (
        <div className="absolute inset-x-2 bottom-2">
          <Alert variant={alert.level === 'alert' ? 'destructive' : 'default'} className={alert.level === 'alert' ? 'border-destructive' : 'border-warning text-warning'}>
            <TriangleAlert aria-hidden />
            <AlertTitle className="font-semibold">{alert.level === 'alert' ? 'RUNWAY INCURSION' : 'Runway entered without clearance'}</AlertTitle>
            <AlertDescription className={alert.level === 'alert' ? '' : 'text-warning'}>
              {alert.who} inside the runway area{alert.what ? ` while ${alert.what}` : ''}.
            </AlertDescription>
          </Alert>
        </div>
      )}
    </div>
  )
}

function describe(engine: SurfaceEngine): string {
  const L = engine.layers
  const used = [L.smr && 'surface movement radar', L.mlat && 'multilateration', L.adsb && 'ADS-B'].filter(Boolean).join(', ') || 'no sensor'
  const n = [...engine.tracks.values()].filter((t) => engine.trackSources(t).length).length
  const named = [...engine.tracks.values()].filter((t) => engine.trackSources(t).length && t.identity).length
  const a = engine.alert.level === 'alert' ? ' Runway incursion alert.' : engine.alert.level === 'caution' ? ' Runway entered without clearance.' : ''
  return `Controller's surface display using ${used}. ${n} targets, ${named} of them with a name.${a}`
}

export type { ZoomId }
