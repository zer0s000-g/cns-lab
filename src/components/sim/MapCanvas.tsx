import { useCallback, useRef } from 'react'
import { Canvas2D, type DrawInfo } from '@/components/sim/Canvas2D'
import { screenToWorld, worldToScreen, type MapView, type Vec2 } from '@/core/geometry'
import { DEFAULT_TERRAIN, sampleTerrainGrid, type Terrain } from '@/core/world'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { parseColor, withAlpha } from '@/lib/color'
import { cn } from '@/lib/utils'
import { drawAircraftIcon } from '@/components/sim/mapDraw'

export interface MapAircraft {
  id: string
  pos: Vec2
  headingDeg: number
  label?: string[]
  /** Visual style: normal, selected, dim (e.g. invisible to the sensor), alert. */
  style?: 'normal' | 'selected' | 'dim' | 'alert'
  draggable?: boolean
}

export interface MapCanvasProps {
  /** Half the visible width/height (whichever is smaller), NM. */
  rangeNm: number
  center?: Vec2
  showTerrain?: boolean
  /** Label the terrain peaks (default true). */
  peakLabels?: boolean
  terrain?: Terrain
  /** Draw module-specific content (under the aircraft). */
  drawOverlay?: (ctx: CanvasRenderingContext2D, view: MapView, info: DrawInfo) => void
  /** Draw module-specific content above the aircraft. */
  drawTop?: (ctx: CanvasRenderingContext2D, view: MapView, info: DrawInfo) => void
  /** Aircraft to draw (and drag). Called every frame. */
  aircraft?: () => MapAircraft[]
  selectedId?: string | null
  onSelect?: (id: string) => void
  onDragStart?: (id: string) => void
  onDrag?: (id: string, pos: Vec2) => void
  onDragEnd?: (id: string) => void
  /** Click on empty map. */
  onMapClick?: (pos: Vec2) => void
  /** Arrow keys nudge the selected aircraft (NM per press). */
  onNudge?: (id: string, delta: Vec2) => void
  label: string
  className?: string
  overlay?: React.ReactNode
  animate?: boolean
}

interface TerrainCache {
  key: string
  canvas: HTMLCanvasElement
}

/** Elevation bands (ft) used for the topographic colouring. */
const BANDS = [300, 1000, 2000, 3500, 5500, 8000]

/**
 * A top-down map (north up) with optional terrain, drag-and-drop aircraft and
 * keyboard nudging. Modules draw their stations and signals in drawOverlay.
 */
export function MapCanvas({
  rangeNm,
  center = { x: 0, y: 0 },
  showTerrain = true,
  peakLabels = true,
  terrain = DEFAULT_TERRAIN,
  drawOverlay,
  drawTop,
  aircraft,
  selectedId,
  onSelect,
  onDragStart,
  onDrag,
  onDragEnd,
  onMapClick,
  onNudge,
  label,
  className,
  overlay,
  animate = true,
}: MapCanvasProps) {
  const viewRef = useRef<MapView>({ center, pxPerNm: 1, width: 1, height: 1 })
  const cache = useRef<TerrainCache | null>(null)
  const dragging = useRef<string | null>(null)
  const lastAircraft = useRef<MapAircraft[]>([])
  const props = useRef({ drawOverlay, drawTop, aircraft, selectedId })
  props.current = { drawOverlay, drawTop, aircraft, selectedId }

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, info: DrawInfo) => {
      const { width, height, tokens: t } = info
      const pxPerNm = Math.min(width, height) / 2 / rangeNm
      const view: MapView = { center, pxPerNm, width, height }
      viewRef.current = view
      ctx.fillStyle = t['sim-bg']
      ctx.fillRect(0, 0, width, height)
      if (showTerrain) {
        const key = `${width}x${height}:${rangeNm}:${center.x},${center.y}:${t.isDark}:${info.dpr}:${peakLabels}`
        if (!cache.current || cache.current.key !== key) cache.current = { key, canvas: renderTerrain(view, terrain, t, info.dpr, peakLabels) }
        ctx.drawImage(cache.current.canvas, 0, 0, width, height)
      }
      props.current.drawOverlay?.(ctx, view, info)
      const list = props.current.aircraft?.() ?? []
      lastAircraft.current = list
      for (const a of list) {
        const s = worldToScreen(a.pos, view)
        drawAircraftIcon(ctx, s, a.headingDeg, t, {
          label: a.label,
          style: a.id === props.current.selectedId ? 'selected' : a.style ?? 'normal',
        })
      }
      props.current.drawTop?.(ctx, view, info)
      drawScaleBar(ctx, view, t)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rangeNm, center.x, center.y, showTerrain, terrain, peakLabels],
  )

  const hit = (p: { x: number; y: number }): MapAircraft | null => {
    let best: { a: MapAircraft; d: number } | null = null
    for (const a of lastAircraft.current) {
      const s = worldToScreen(a.pos, viewRef.current)
      const d = Math.hypot(s.x - p.x, s.y - p.y)
      if (d < 22 && (!best || d < best.d)) best = { a, d }
    }
    return best?.a ?? null
  }

  return (
    <Canvas2D
      draw={draw}
      animate={animate}
      label={label}
      focusable
      overlay={overlay}
      className={cn('w-full rounded-lg border bg-sim-bg', className)}
      canvasClassName={cn(onDrag && 'cursor-grab active:cursor-grabbing')}
      onCanvasPointerDown={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        const p = { x: e.clientX - r.left, y: e.clientY - r.top }
        const a = hit(p)
        if (a) {
          onSelect?.(a.id)
          if (a.draggable !== false && onDrag) {
            dragging.current = a.id
            e.currentTarget.setPointerCapture(e.pointerId)
            onDragStart?.(a.id)
          }
        } else {
          onMapClick?.(screenToWorld(p, viewRef.current))
        }
      }}
      onCanvasPointerMove={(e) => {
        if (!dragging.current) return
        const r = e.currentTarget.getBoundingClientRect()
        const w = screenToWorld({ x: e.clientX - r.left, y: e.clientY - r.top }, viewRef.current)
        onDrag?.(dragging.current, w)
      }}
      onCanvasPointerUp={() => {
        if (dragging.current) onDragEnd?.(dragging.current)
        dragging.current = null
      }}
      onCanvasKeyDown={(e) => {
        if (!selectedId || !onNudge) return
        const step = e.shiftKey ? 2 : 0.5
        const d =
          e.key === 'ArrowUp'
            ? { x: 0, y: step }
            : e.key === 'ArrowDown'
              ? { x: 0, y: -step }
              : e.key === 'ArrowLeft'
                ? { x: -step, y: 0 }
                : e.key === 'ArrowRight'
                  ? { x: step, y: 0 }
                  : null
        if (d) {
          e.preventDefault()
          onNudge(selectedId, d)
        }
      }}
    />
  )
}

function renderTerrain(view: MapView, terrain: Terrain, t: ThemeTokens, dpr: number, peakLabels = true): HTMLCanvasElement {
  // Sample the terrain on a coarse grid into a small image, then scale it up
  // with smoothing so the elevation bands get soft edges.
  const cell = 4 // CSS px per terrain sample
  const cols = Math.ceil(view.width / cell)
  const rows = Math.ceil(view.height / cell)
  const tl = screenToWorld({ x: 0, y: 0 }, view)
  const br = screenToWorld({ x: cols * cell, y: rows * cell }, view)
  const grid = sampleTerrainGrid(tl.x, br.x, br.y, tl.y, cols, rows, terrain)
  const small = document.createElement('canvas')
  small.width = cols
  small.height = rows
  const sctx = small.getContext('2d')!
  const img = sctx.createImageData(cols, rows)
  const land = parseColor(t['sim-land'])!
  const water = parseColor(t['sim-water'])!
  const high = parseColor(t['sim-terrain-high'])!
  const bandRgb = BANDS.map((_, i) => {
    const k = (i + 1) / BANDS.length
    return [land.r + (high.r - land.r) * k, land.g + (high.g - land.g) * k, land.b + (high.b - land.b) * k]
  })
  for (let i = 0; i < cols * rows; i++) {
    let rgb: number[]
    if (grid.water[i]) rgb = [water.r, water.g, water.b]
    else {
      const h = grid.heights[i]
      let b = -1
      for (let j = 0; j < BANDS.length; j++) if (h >= BANDS[j]) b = j
      rgb = b < 0 ? [land.r, land.g, land.b] : bandRgb[b]
    }
    img.data[i * 4] = rgb[0]
    img.data[i * 4 + 1] = rgb[1]
    img.data[i * 4 + 2] = rgb[2]
    img.data[i * 4 + 3] = 255
  }
  sctx.putImageData(img, 0, 0)
  const c = document.createElement('canvas')
  c.width = Math.round(view.width * dpr)
  c.height = Math.round(view.height * dpr)
  const ctx = c.getContext('2d')!
  ctx.scale(dpr, dpr)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(small, 0, 0, cols * cell, rows * cell)
  // Coastline.
  const tl2 = screenToWorld({ x: 0, y: 0 }, view)
  const br2 = screenToWorld({ x: view.width, y: view.height }, view)
  ctx.strokeStyle = withAlpha(t['sim-signal'], 0.45)
  ctx.lineWidth = 1.2
  ctx.beginPath()
  let first = true
  for (let y = br2.y; y <= tl2.y; y += (tl2.y - br2.y) / 200) {
    const s = worldToScreen({ x: terrain.coastX(y), y }, view)
    if (first) ctx.moveTo(s.x, s.y)
    else ctx.lineTo(s.x, s.y)
    first = false
  }
  ctx.stroke()
  if (!peakLabels) return c
  // Peak labels.
  ctx.font = `500 10px ${t.fontSans}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  const seen = new Set<string>()
  for (const h of terrain.hills) {
    if (h.peakFt < 2000) continue
    const s = worldToScreen(h.center, view)
    if (s.x < 0 || s.y < 0 || s.x > view.width || s.y > view.height) continue
    ctx.fillStyle = t['sim-ink']
    ctx.beginPath()
    ctx.moveTo(s.x, s.y - 4)
    ctx.lineTo(s.x + 4, s.y + 3)
    ctx.lineTo(s.x - 4, s.y + 3)
    ctx.closePath()
    ctx.fill()
    const name = h.name && !seen.has(h.name) ? h.name : ''
    if (h.name) seen.add(h.name)
    const text = `${name ? `${name} ` : ''}${h.peakFt.toLocaleString('en-US')} ft`
    ctx.lineWidth = 3
    ctx.strokeStyle = withAlpha(t['sim-bg'], 0.8)
    ctx.strokeText(text, s.x, s.y + 5)
    ctx.fillStyle = t['sim-muted']
    ctx.fillText(text, s.x, s.y + 5)
  }
  return c
}

function drawScaleBar(ctx: CanvasRenderingContext2D, view: MapView, t: ThemeTokens) {
  const targetPx = 90
  const nm = niceNm(targetPx / view.pxPerNm)
  const px = nm * view.pxPerNm
  const x = 12
  const y = view.height - 14
  ctx.strokeStyle = t['sim-ink']
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(x, y - 4)
  ctx.lineTo(x, y)
  ctx.lineTo(x + px, y)
  ctx.lineTo(x + px, y - 4)
  ctx.stroke()
  ctx.fillStyle = t['sim-ink']
  ctx.font = `600 10px ${t.fontSans}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.fillText(`${nm} NM`, x + 4, y - 4)
  // North arrow.
  const nx = view.width - 18
  const ny = 18
  ctx.beginPath()
  ctx.moveTo(nx, ny - 9)
  ctx.lineTo(nx + 5, ny + 5)
  ctx.lineTo(nx, ny + 2)
  ctx.lineTo(nx - 5, ny + 5)
  ctx.closePath()
  ctx.fill()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText('N', nx, ny + 7)
}

function niceNm(v: number): number {
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000]
  let best = steps[0]
  for (const s of steps) if (s <= v) best = s
  return best
}
