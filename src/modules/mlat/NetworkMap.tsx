import { useCallback, useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { MapCanvas, type MapAircraft } from '@/components/sim/MapCanvas'
import { drawStation, haloText } from '@/components/sim/mapDraw'
import { worldToScreen, type MapView, type Vec2 } from '@/core/geometry'
import { contourSegments, type Bounds, type Segment } from '@/core/mlat'
import { METRES_PER_NM } from '@/core/units'
import { useSampled } from '@/hooks/useSampled'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { drawTrackSymbol } from '@/instruments'
import { parseColor, withAlpha } from '@/lib/color'
import { accuracyGrid, ambiguityRow, BANDS_M, bandOf, formatM, needsAmbiguityCheck } from './accuracy'
import { curvesForFix, wavefrontRadiusNm, type CurveSet } from './curves'
import { CLOCK_RECEIVER, mismatchThresholdM, type MlatEngine, type MlatReceiver, type ReceiverId } from './engine'
import { useMlat, useMlatState } from './state'

/** Half-width of the network map, NM. */
export const MAP_RANGE_NM = 50
const GRID = 72
const AMB_GRID = 26
const BOUNDS_NM: Bounds = { minX: -MAP_RANGE_NM, maxX: MAP_RANGE_NM, minY: -MAP_RANGE_NM, maxY: MAP_RANGE_NM }
/** Opacity of each accuracy band (better than 10 m … worse than 1 km). */
const BAND_ALPHA = [0.4, 0.3, 0.2, 0.12, 0.06, 0]

interface AccuracyLayer {
  key: string
  errors: Float32Array
  contours: { thresholdM: number; segs: Segment[] }[]
  ambiguous: Uint8Array | null
  ambRowsDone: number
  image: HTMLCanvasElement | null
  imageKey: string
  ambContours: Segment[]
  ambContourRows: number
}

/** Convex hull of map points (monotone chain), for outlining the network. */
function hull(points: Vec2[]): Vec2[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  if (p.length < 3) return p
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: Vec2[] = []
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop()
    lower.push(q)
  }
  const upper: Vec2[] = []
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop()
    upper.push(q)
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1))
}

/** Contours of a cell-centred grid (values at cell centres). */
function gridContours(values: ArrayLike<number>, cols: number, rows: number, level: number, map: (v: number) => number): Segment[] {
  const dx = (BOUNDS_NM.maxX - BOUNDS_NM.minX) / cols
  const dy = (BOUNDS_NM.maxY - BOUNDS_NM.minY) / rows
  const b: Bounds = { minX: BOUNDS_NM.minX + dx / 2, maxX: BOUNDS_NM.maxX - dx / 2, minY: BOUNDS_NM.minY + dy / 2, maxY: BOUNDS_NM.maxY - dy / 2 }
  return contourSegments(
    (x, y) => {
      const i = Math.max(0, Math.min(cols - 1, Math.round((x - b.minX) / dx)))
      const j = Math.max(0, Math.min(rows - 1, Math.round((y - b.minY) / dy)))
      return map(values[j * cols + i]) - level
    },
    b,
    cols - 1,
    rows - 1,
  )
}

const logErr = (v: number) => (Number.isFinite(v) ? Math.log10(Math.max(v, 1e-3)) : 9)

/** Accuracy map for the selected aircraft's altitude, recomputed off the animation loop. */
function useAccuracyLayer(enabled: boolean) {
  const { engine } = useMlat()
  const version = useMlatState((s) => s.geometryVersion)
  const params = useMlatState((s) => s.params)
  const selectedId = useMlatState((s) => s.selectedId)
  const alt = useSampled(() => {
    const a = engine.getAircraft(selectedId)
    return a ? Math.round(a.altitudeFt / 1000) * 1000 : 9000
  }, 500)
  const ref = useRef<AccuracyLayer | null>(null)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let timer = window.setTimeout(() => {
      const rx = engine.usedEnu()
      const key = `${version}:${alt}:${params.useAltitude}:${params.timingNoiseNs}`
      const errors = accuracyGrid(rx, alt, params.useAltitude, params.timingNoiseNs, BOUNDS_NM, GRID, GRID)
      const contours = BANDS_M.map((thresholdM) => ({ thresholdM, segs: gridContours(errors, GRID, GRID, Math.log10(thresholdM), logErr) }))
      const layer: AccuracyLayer = { key, errors, contours, ambiguous: null, ambRowsDone: 0, image: null, imageKey: '', ambContours: [], ambContourRows: 0 }
      ref.current = layer
      if (!needsAmbiguityCheck(rx.length, params.useAltitude, engine.collinear)) return
      // The ambiguity check runs the full solver per cell: do it a few rows at a time.
      const amb = new Uint8Array(AMB_GRID * AMB_GRID)
      layer.ambiguous = amb
      const noiseM = Math.max(1, params.timingNoiseNs * 0.3)
      const work = () => {
        if (cancelled) return
        const t0 = performance.now()
        while (layer.ambRowsDone < AMB_GRID && performance.now() - t0 < 10) {
          amb.set(ambiguityRow(rx, alt, params.useAltitude, noiseM, BOUNDS_NM, AMB_GRID, AMB_GRID, layer.ambRowsDone), layer.ambRowsDone * AMB_GRID)
          layer.ambRowsDone++
        }
        if (layer.ambRowsDone < AMB_GRID) timer = window.setTimeout(work, 16)
      }
      work()
    }, 120)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [enabled, version, alt, params.useAltitude, params.timingNoiseNs, engine])
  return ref
}

/** Low-resolution picture of the accuracy bands and the "two positions" area, smoothed when scaled up. */
function renderLayerImage(layer: AccuracyLayer, t: ThemeTokens): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = GRID
  c.height = GRID
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(GRID, GRID)
  const sig = parseColor(t['sim-signal'])!
  const warn = parseColor(t['sim-warning'])!
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      // Image rows go top (north) to bottom; grid row 0 is the south edge.
      const k = ((GRID - 1 - j) * GRID + i) * 4
      const e = layer.errors[j * GRID + i]
      const band = bandOf(e)
      let r = sig.r
      let g = sig.g
      let b = sig.b
      let a = band < 0 ? 0 : BAND_ALPHA[band]
      if (layer.ambiguous) {
        const ai = Math.min(AMB_GRID - 1, Math.floor((i / GRID) * AMB_GRID))
        const aj = Math.min(AMB_GRID - 1, Math.floor((j / GRID) * AMB_GRID))
        if (aj < layer.ambRowsDone && layer.ambiguous[aj * AMB_GRID + ai]) {
          r = warn.r
          g = warn.g
          b = warn.b
          a = Math.max(a, 0.16)
        }
      }
      img.data[k] = r
      img.data[k + 1] = g
      img.data[k + 2] = b
      img.data[k + 3] = Math.round(a * 255)
    }
  }
  ctx.putImageData(img, 0, 0)
  return c
}

function strokeSegments(ctx: CanvasRenderingContext2D, segs: Segment[], toScreen: (p: Vec2) => Vec2) {
  ctx.beginPath()
  for (const [a, b] of segs) {
    const sa = toScreen(a)
    const sb = toScreen(b)
    ctx.moveTo(sa.x, sa.y)
    ctx.lineTo(sb.x, sb.y)
  }
  ctx.stroke()
}

export function NetworkMap() {
  const { engine, store, replayRef } = useMlat()
  const selectedId = useMlatState((s) => s.selectedId)
  const select = useMlatState((s) => s.select)
  const showHeatmap = useMlatState((s) => s.showHeatmap)
  const showCurves = useMlatState((s) => s.showCurves)
  const receivers = useMlatState((s) => s.receivers)
  const layerRef = useAccuracyLayer(showHeatmap)
  const curves = useRef<CurveSet | null>(null)

  const drawOverlay = useCallback(
    (ctx: CanvasRenderingContext2D, view: MapView, { tokens: t }: { tokens: ThemeTokens }) => {
      const e = engine
      const toS = (p: Vec2) => worldToScreen(p, view)
      // Accuracy map.
      const layer = layerRef.current
      if (showHeatmap && layer) {
        const imageKey = `${layer.key}:${layer.ambRowsDone}:${t.isDark}`
        if (layer.imageKey !== imageKey) {
          layer.image = renderLayerImage(layer, t)
          layer.imageKey = imageKey
        }
        const tl = toS({ x: BOUNDS_NM.minX, y: BOUNDS_NM.maxY })
        const br = toS({ x: BOUNDS_NM.maxX, y: BOUNDS_NM.minY })
        ctx.save()
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        if (layer.image) ctx.drawImage(layer.image, tl.x, tl.y, br.x - tl.x, br.y - tl.y)
        ctx.restore()
        // Band edges with labels.
        ctx.save()
        ctx.lineWidth = 1
        for (const c of layer.contours) {
          if (!c.segs.length) continue
          ctx.strokeStyle = withAlpha(t['sim-signal'], 0.55)
          ctx.setLineDash([])
          strokeSegments(ctx, c.segs, toS)
          // Label the piece closest to a line from the map centre toward the east-south-east.
          let best: Segment | null = null
          let bestScore = Infinity
          for (const sg of c.segs) {
            const m = { x: (sg[0].x + sg[1].x) / 2, y: (sg[0].y + sg[1].y) / 2 }
            if (Math.abs(m.y) > MAP_RANGE_NM * 0.85 || Math.abs(m.x) > MAP_RANGE_NM * 0.82) continue
            const brg = (Math.atan2(m.x, m.y) * 180) / Math.PI
            const score = Math.abs(((brg - 110 + 540) % 360) - 180)
            if (score < bestScore) {
              bestScore = score
              best = sg
            }
          }
          if (best) {
            const m = toS({ x: (best[0].x + best[1].x) / 2, y: (best[0].y + best[1].y) / 2 })
            haloText(ctx, formatM(c.thresholdM), m.x + 3, m.y - 3, t, { font: `600 10px ${t.fontSans}`, color: t['sim-signal'] })
          }
        }
        // Outline of the area with two possible positions.
        if (layer.ambiguous && layer.ambRowsDone === AMB_GRID) {
          if (layer.ambContourRows !== AMB_GRID) {
            layer.ambContours = gridContours(layer.ambiguous, AMB_GRID, AMB_GRID, 0.5, (v) => v)
            layer.ambContourRows = AMB_GRID
          }
          ctx.strokeStyle = t['sim-warning']
          ctx.lineWidth = 1.5
          ctx.setLineDash([5, 4])
          strokeSegments(ctx, layer.ambContours, toS)
          ctx.setLineDash([])
          const any = layer.ambiguous.some((v) => v === 1)
          if (any) {
            // Label the largest ambiguous cell cluster roughly at its centre.
            let sx = 0
            let sy = 0
            let n = 0
            layer.ambiguous.forEach((v, k) => {
              if (!v) return
              sx += (k % AMB_GRID) + 0.5
              sy += Math.floor(k / AMB_GRID) + 0.5
              n++
            })
            const cx = BOUNDS_NM.minX + (sx / n / AMB_GRID) * (BOUNDS_NM.maxX - BOUNDS_NM.minX)
            const cy = BOUNDS_NM.minY + (sy / n / AMB_GRID) * (BOUNDS_NM.maxY - BOUNDS_NM.minY)
            let lp = { x: cx, y: cy }
            // Keep the label inside an ambiguous cell when the area is split in several pieces.
            const cellOf = (p: Vec2) => {
              const i = Math.floor(((p.x - BOUNDS_NM.minX) / (BOUNDS_NM.maxX - BOUNDS_NM.minX)) * AMB_GRID)
              const j = Math.floor(((p.y - BOUNDS_NM.minY) / (BOUNDS_NM.maxY - BOUNDS_NM.minY)) * AMB_GRID)
              return i >= 0 && j >= 0 && i < AMB_GRID && j < AMB_GRID ? layer.ambiguous![j * AMB_GRID + i] : 0
            }
            if (!cellOf(lp)) {
              let bestD = Infinity
              layer.ambiguous.forEach((v, k) => {
                if (!v) return
                const p = cellCentreNm(k % AMB_GRID, Math.floor(k / AMB_GRID))
                const d = Math.hypot(p.x - cx, p.y - cy)
                if (d < bestD) {
                  bestD = d
                  lp = p
                }
              })
            }
            const s = toS(lp)
            haloText(ctx, 'Two possible positions', s.x, s.y, t, { align: 'center', color: t['sim-warning'], font: `600 11px ${t.fontSans}` })
          }
        }
        ctx.restore()
      }

      // Receiver network outline.
      const used = e.usedReceivers()
      if (used.length >= 3) {
        const h = hull(used.map((r) => r.pos))
        ctx.save()
        ctx.strokeStyle = withAlpha(t['sim-ink'], 0.45)
        ctx.lineWidth = 1
        ctx.setLineDash([2, 4])
        ctx.beginPath()
        h.forEach((p, i) => {
          const s = toS(p)
          if (i === 0) ctx.moveTo(s.x, s.y)
          else ctx.lineTo(s.x, s.y)
        })
        ctx.closePath()
        ctx.stroke()
        ctx.restore()
      }

      // Curves for the selected aircraft (or the fix being replayed).
      const rp = replayRef.current
      const fix = rp?.fix ?? (selectedId ? e.fixes.get(selectedId) : undefined)
      if (showCurves && fix) {
        if (!curves.current || curves.current.seq !== fix.seq) curves.current = { seq: fix.seq, pairs: curvesForFix(fix, BOUNDS_NM, 110) }
        ctx.save()
        for (const pr of curves.current.pairs) {
          if (rp && rp.tUs < pr.readyUs) continue
          ctx.strokeStyle = withAlpha(t['sim-signal-2'], pr.biased ? 0.95 : 0.7)
          ctx.lineWidth = pr.biased ? 1.8 : 1.3
          ctx.setLineDash(pr.biased ? [6, 4] : [])
          strokeSegments(ctx, pr.segs, toS)
        }
        ctx.setLineDash([])
        ctx.restore()
      }

      // Slow-motion signal front.
      if (rp) {
        const r = wavefrontRadiusNm(rp.fix, rp.tUs)
        const c = toS(rp.fix.truePos)
        ctx.save()
        ctx.strokeStyle = t['sim-signal']
        ctx.lineWidth = 2.5
        ctx.beginPath()
        ctx.arc(c.x, c.y, r * view.pxPerNm, 0, Math.PI * 2)
        ctx.stroke()
        ctx.strokeStyle = withAlpha(t['sim-signal'], 0.25)
        ctx.lineWidth = 8
        ctx.beginPath()
        ctx.arc(c.x, c.y, Math.max(0, r * view.pxPerNm - 5), 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
      }

      // Receivers.
      for (const r of e.receivers) {
        const s = toS(r.pos)
        const failed = e.isFailed(r)
        const heard = rp ? rp.fix.stamps.find((x) => x.id === r.id) : undefined
        const lit = rp && heard ? rp.tUs >= heard.travelUs : false
        if (lit) {
          ctx.save()
          ctx.fillStyle = withAlpha(t['sim-signal'], 0.25)
          ctx.beginPath()
          ctx.arc(s.x, s.y, 13, 0, Math.PI * 2)
          ctx.fill()
          ctx.restore()
        }
        ctx.save()
        if (!r.inUse) ctx.globalAlpha = 0.45
        drawStation(ctx, s, 'receiver', t, {
          label: `${r.id}${r.id === CLOCK_RECEIVER && e.params.clockErrorNs !== 0 ? ` clock ${e.params.clockErrorNs > 0 ? '+' : ''}${e.params.clockErrorNs} ns` : ''}${failed ? ' failed' : !r.inUse ? ' off' : ''}`,
          failed,
        })
        ctx.restore()
      }
    },
    [engine, layerRef, showHeatmap, showCurves, selectedId, replayRef],
  )

  const drawTop = useCallback(
    (ctx: CanvasRenderingContext2D, view: MapView, { tokens: t }: { tokens: ThemeTokens }) => {
      if (replayRef.current) return
      for (const a of engine.aircraft) {
        const f = engine.fixes.get(a.id)
        if (!f) continue
        const col = t['sim-signal']
        // ADS-B report (open diamond).
        const sa = worldToScreen(f.adsbPos, view)
        drawTrackSymbol(ctx, 'adsb', sa.x, sa.y, t['sim-ink'])
        if (f.fixPos) {
          const sm = worldToScreen(f.fixPos, view)
          const mismatch = f.adsbMismatchM > mismatchThresholdM(f.expectedErrorM)
          if (mismatch) {
            ctx.save()
            ctx.strokeStyle = t['sim-alert']
            ctx.lineWidth = 1.5
            ctx.setLineDash([4, 3])
            ctx.beginPath()
            ctx.moveTo(sm.x, sm.y)
            ctx.lineTo(sa.x, sa.y)
            ctx.stroke()
            ctx.restore()
            haloText(ctx, `ADS-B ${a.callsign}? ${(f.adsbMismatchM / METRES_PER_NM).toFixed(1)} NM from MLAT`, sa.x + 8, sa.y - 6, t, { color: t['sim-alert'], font: `600 10px ${t.fontSans}` })
          }
          drawTrackSymbol(ctx, 'mlat', sm.x, sm.y, col)
          if (f.solution.status === 'ambiguous') {
            for (const c of f.candidatePos) {
              const sc = worldToScreen(c, view)
              drawTrackSymbol(ctx, 'mlat', sc.x, sc.y, t['sim-warning'])
              haloText(ctx, '?', sc.x + 8, sc.y + 4, t, { color: t['sim-warning'], font: `700 12px ${t.fontSans}` })
            }
          }
        }
      }
    },
    [engine, replayRef],
  )

  const aircraft = useCallback((): MapAircraft[] => {
    return engine.aircraft.map((a) => {
      const f = engine.fixes.get(a.id)
      const status = f && f.solution.status !== 'ok' ? (f.solution.status === 'ambiguous' ? 'two positions fit' : 'no MLAT position') : null
      return {
        id: a.id,
        pos: a.pos,
        headingDeg: a.headingDeg,
        label: [a.callsign, `FL${String(Math.round(a.altitudeFt / 100)).padStart(3, '0')}`, ...(status ? [status] : [])],
        style: f && f.solution.status !== 'ok' && f.solution.status !== 'ambiguous' ? 'dim' : 'normal',
      }
    })
  }, [engine])

  const describe = useSampled(() => describeMap(engine, selectedId), 1000)

  return (
    <MapCanvas
      rangeNm={MAP_RANGE_NM}
      className="aspect-square"
      drawOverlay={drawOverlay}
      drawTop={drawTop}
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
      label={describe}
      overlay={<ReceiverHandles receivers={receivers} onMove={(id, p) => store.getState().moveReceiver(id, p)} />}
    />
  )
}

function cellCentreNm(i: number, j: number): Vec2 {
  return {
    x: BOUNDS_NM.minX + ((i + 0.5) / AMB_GRID) * (BOUNDS_NM.maxX - BOUNDS_NM.minX),
    y: BOUNDS_NM.minY + ((j + 0.5) / AMB_GRID) * (BOUNDS_NM.maxY - BOUNDS_NM.minY),
  }
}

function describeMap(engine: MlatEngine, selectedId: string | null): string {
  const used = engine.usedReceivers()
  const a = engine.getAircraft(selectedId)
  const f = a ? engine.fixes.get(a.id) : undefined
  const fixText = a && f ? `${a.callsign}: ${f.fixPos ? `MLAT position ${formatM(f.errorM)} from the truth` : 'no MLAT position'}.` : ''
  return `Map of the receiver network, ${MAP_RANGE_NM} nautical miles in every direction. ${used.length} receivers in use. ${fixText} Select an aircraft and use the arrow keys to move it. Receivers can be moved with the arrow keys after focusing them.`
}

/** Invisible, focusable handles over the receivers so they can be dragged or moved with the keyboard. */
function ReceiverHandles({ receivers, onMove }: { receivers: MlatReceiver[]; onMove: (id: ReceiverId, p: Vec2) => void }) {
  return (
    <div className="pointer-events-none absolute inset-0">
      {receivers.map((r) => (
        <ReceiverHandle key={r.id} r={r} onMove={onMove} />
      ))}
    </div>
  )
}

function ReceiverHandle({ r, onMove }: { r: MlatReceiver; onMove: (id: ReceiverId, p: Vec2) => void }) {
  const dragging = useRef(false)
  const toWorld = (e: PointerEvent<HTMLButtonElement>): Vec2 | null => {
    const parent = e.currentTarget.parentElement
    if (!parent) return null
    const rect = parent.getBoundingClientRect()
    return {
      x: (((e.clientX - rect.left) / rect.width) * 2 - 1) * MAP_RANGE_NM,
      y: (1 - ((e.clientY - rect.top) / rect.height) * 2) * MAP_RANGE_NM,
    }
  }
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = e.shiftKey ? 5 : 1
    const d = e.key === 'ArrowUp' ? { x: 0, y: step } : e.key === 'ArrowDown' ? { x: 0, y: -step } : e.key === 'ArrowLeft' ? { x: -step, y: 0 } : e.key === 'ArrowRight' ? { x: step, y: 0 } : null
    if (!d) return
    e.preventDefault()
    onMove(r.id, { x: r.pos.x + d.x, y: r.pos.y + d.y })
  }
  return (
    <button
      type="button"
      aria-label={`Receiver ${r.id}, ${r.name}${r.inUse ? '' : ' (switched off)'}. Drag it, or use the arrow keys to move it (Shift for bigger steps).`}
      className="pointer-events-auto absolute size-8 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full bg-transparent focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring active:cursor-grabbing"
      style={{ left: `${50 + (r.pos.x / MAP_RANGE_NM) * 50}%`, top: `${50 - (r.pos.y / MAP_RANGE_NM) * 50}%` }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        dragging.current = true
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return
        const p = toWorld(e)
        if (p) onMove(r.id, p)
      }}
      onPointerUp={() => {
        dragging.current = false
      }}
      onPointerCancel={() => {
        dragging.current = false
      }}
      onKeyDown={onKey}
    />
  )
}
