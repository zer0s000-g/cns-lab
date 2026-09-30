import { useCallback, useRef } from 'react'
import { Canvas2D, type DrawFn } from '@/components/sim/Canvas2D'
import { toRad, type Vec2 } from '@/core/geometry'
import { useSampled } from '@/hooks/useSampled'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { withAlpha } from '@/lib/color'
import { cn } from '@/lib/utils'

/** A raw radar return painted by the sweep; it glows and then fades like phosphor. */
export interface ScopePaint {
  /** Position relative to the radar, NM (x east, y north). */
  x: number
  y: number
  /** 0..1 */
  strength: number
  kind: 'target' | 'clutter' | 'weather' | 'noise' | 'false'
  /** Azimuth width of the blip, degrees (about one beam width). */
  widthDeg?: number
  /** Depth in range, NM (about half a pulse length). */
  depthNm?: number
}

export type TrackSymbol = 'primary' | 'secondary' | 'combined' | 'adsb' | 'mlat' | 'coast' | 'fused'

/** A labelled track drawn every frame (secondary radar, ADS-B, fused tracks). */
export interface ScopeTrack {
  id: string
  x: number
  y: number
  symbol: TrackSymbol
  label?: string[]
  emphasis?: 'normal' | 'warning' | 'alert' | 'selected' | 'dim'
  /** Older positions, newest last, drawn as fading history dots. */
  history?: Vec2[]
  /** Optional velocity leader: end point of the predicted position. */
  leaderTo?: Vec2
}

export interface ScopeFrame {
  /** Simulation time, s. Phosphor fading uses it, so pausing freezes the picture. */
  nowS: number
  /** Current antenna azimuth (degrees true), or null for displays without a sweep. */
  sweepAzDeg: number | null
  beamWidthDeg?: number
  /** Returns painted since the previous frame. */
  paints?: ScopePaint[]
  tracks?: ScopeTrack[]
}

export type ScopeProjector = (p: Vec2) => Vec2

export interface RadarScopeProps {
  read: () => ScopeFrame
  maxRangeNm: number
  ringStepNm?: number
  /** Phosphor time constant, s (roughly one rotation). */
  persistenceS?: number
  /** Drawn under the returns, for map features (runway, coastline). */
  underlay?: (ctx: CanvasRenderingContext2D, project: ScopeProjector, t: ThemeTokens, pxPerNm: number) => void
  /** Accessible description of the scope. */
  describe?: () => string
  onTrackClick?: (id: string) => void
  className?: string
  /** Centre offset of the radar on the scope (NM), default the middle. */
  centerNm?: Vec2
}

interface Stored {
  p: ScopePaint
  t: number
}

const MAX_STORED = 12000

/**
 * PPI radar scope: range rings, compass ticks, a rotating sweep and returns
 * that glow and fade. Tracks with labels are drawn on top.
 */
export function RadarScope({
  read,
  maxRangeNm,
  ringStepNm,
  persistenceS = 4,
  underlay,
  describe,
  onTrackClick,
  className,
  centerNm = { x: 0, y: 0 },
}: RadarScopeProps) {
  const readRef = useRef(read)
  readRef.current = read
  const store = useRef<Stored[]>([])
  const lastNow = useRef(0)
  const lastTracks = useRef<ScopeTrack[]>([])
  const geom = useRef({ cx: 0, cy: 0, pxPerNm: 1 })

  const draw: DrawFn = useCallback((ctx, { width, height, tokens: t }) => {
    const f = readRef.current()
    if (f.nowS < lastNow.current - 1e-6) store.current = [] // simulation was reset
    lastNow.current = f.nowS
    if (f.paints?.length) {
      for (const p of f.paints) store.current.push({ p, t: f.nowS })
      if (store.current.length > MAX_STORED) store.current.splice(0, store.current.length - MAX_STORED)
    }

    const R = Math.max(0, Math.min(width, height) / 2 - 4)
    const pxPerNm = R / maxRangeNm
    const cx = width / 2 - centerNm.x * pxPerNm
    const cy = height / 2 + centerNm.y * pxPerNm
    geom.current = { cx, cy, pxPerNm }
    const project: ScopeProjector = (p) => ({ x: cx + p.x * pxPerNm, y: cy - p.y * pxPerNm })

    // Screen.
    ctx.fillStyle = t['scope-bg']
    ctx.fillRect(0, 0, width, height)
    ctx.save()
    ctx.beginPath()
    ctx.arc(width / 2, height / 2, R, 0, Math.PI * 2)
    ctx.clip()

    underlay?.(ctx, project, t, pxPerNm)

    // Range rings.
    const step = ringStepNm ?? niceStep(maxRangeNm / 4)
    ctx.strokeStyle = t['scope-grid']
    ctx.lineWidth = 1
    ctx.font = `500 10px ${t.fontMono}`
    ctx.fillStyle = t['scope-dim']
    ctx.textAlign = 'left'
    ctx.textBaseline = 'bottom'
    for (let r = step; r <= maxRangeNm * 1.5; r += step) {
      ctx.beginPath()
      ctx.arc(cx, cy, r * pxPerNm, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillText(`${r}`, cx + 3, cy - r * pxPerNm - 1)
    }
    // Bearing lines every 30°.
    ctx.strokeStyle = t['scope-grid']
    for (let a = 0; a < 360; a += 30) {
      const ang = toRad(a - 90)
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + Math.cos(ang) * R * 2, cy + Math.sin(ang) * R * 2)
      ctx.stroke()
    }

    // Returns (phosphor).
    const now = f.nowS
    const keep: Stored[] = []
    for (const s of store.current) {
      const age = now - s.t
      const a = Math.exp(-age / persistenceS) * s.p.strength
      if (a < 0.02) continue
      keep.push(s)
      drawPaint(ctx, s.p, a, cx, cy, pxPerNm, t)
    }
    store.current = keep

    // Sweep with a short afterglow.
    if (f.sweepAzDeg != null) {
      const bw = Math.max(0.5, f.beamWidthDeg ?? 1.5)
      for (let i = 0; i < 12; i++) {
        const a0 = f.sweepAzDeg - (i + 1) * 2.2
        const a1 = f.sweepAzDeg - i * 2.2
        ctx.fillStyle = withAlpha(t['scope-trace'], 0.16 * (1 - i / 12))
        ctx.beginPath()
        ctx.moveTo(cx, cy)
        ctx.arc(cx, cy, R * 2, toRad(a0 - 90), toRad(a1 - 90))
        ctx.closePath()
        ctx.fill()
      }
      // Beam width wedge.
      ctx.fillStyle = withAlpha(t['scope-trace'], 0.22)
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.arc(cx, cy, R * 2, toRad(f.sweepAzDeg - bw / 2 - 90), toRad(f.sweepAzDeg + bw / 2 - 90))
      ctx.closePath()
      ctx.fill()
      const ang = toRad(f.sweepAzDeg - 90)
      ctx.strokeStyle = t['scope-trace']
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + Math.cos(ang) * R * 2, cy + Math.sin(ang) * R * 2)
      ctx.stroke()
    }

    // Tracks and labels.
    const tracks = f.tracks ?? []
    lastTracks.current = tracks
    for (const tr of tracks) drawTrack(ctx, tr, project, t)
    ctx.restore()

    // Compass ring outside the clip.
    ctx.strokeStyle = t['scope-grid-strong']
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(width / 2, height / 2, R, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = t['scope-dim']
    ctx.font = `600 10px ${t.fontSans}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (let a = 0; a < 360; a += 10) {
      const ang = toRad(a - 90)
      const x0 = width / 2 + Math.cos(ang) * R
      const y0 = height / 2 + Math.sin(ang) * R
      const len = a % 30 === 0 ? 8 : 4
      ctx.strokeStyle = t['scope-grid-strong']
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.lineTo(x0 - Math.cos(ang) * len, y0 - Math.sin(ang) * len)
      ctx.stroke()
      if (a % 90 === 0) {
        ctx.fillStyle = t['scope-text']
        ctx.fillText(['N', 'E', 'S', 'W'][a / 90], x0 - Math.cos(ang) * 16, y0 - Math.sin(ang) * 16)
      }
    }
  }, [maxRangeNm, ringStepNm, persistenceS, underlay, centerNm.x, centerNm.y])

  const label = useSampled(() => (describe ? describe() : 'Radar scope'), 1000)

  return (
    <Canvas2D
      draw={draw}
      label={label}
      className={cn('aspect-square w-full rounded-lg bg-scope-bg', className)}
      onCanvasPointerDown={
        onTrackClick
          ? (e) => {
              const rect = e.currentTarget.getBoundingClientRect()
              const x = e.clientX - rect.left
              const y = e.clientY - rect.top
              const { cx, cy, pxPerNm } = geom.current
              let best: { id: string; d: number } | null = null
              for (const tr of lastTracks.current) {
                const d = Math.hypot(cx + tr.x * pxPerNm - x, cy - tr.y * pxPerNm - y)
                if (d < 24 && (!best || d < best.d)) best = { id: tr.id, d }
              }
              if (best) onTrackClick(best.id)
            }
          : undefined
      }
    />
  )
}

function drawPaint(
  ctx: CanvasRenderingContext2D,
  p: ScopePaint,
  alpha: number,
  cx: number,
  cy: number,
  pxPerNm: number,
  t: ThemeTokens,
) {
  const color =
    p.kind === 'target' || p.kind === 'false'
      ? t['scope-blip']
      : p.kind === 'weather'
        ? t['scope-trace']
        : t['scope-clutter']
  const r = Math.hypot(p.x, p.y)
  const az = (Math.atan2(p.x, p.y) * 180) / Math.PI
  const w = p.widthDeg ?? 1.5
  // Targets are drawn at least ~4 px deep and ~5 px wide so a learner can see them;
  // real phosphor blips also bloom a little beyond the true resolution cell.
  const isTarget = p.kind === 'target' || p.kind === 'false'
  const depth = Math.max(p.depthNm ?? 0.3, (isTarget ? 4 : 2.2) / pxPerNm)
  const r0 = Math.max(0, (r - depth / 2) * pxPerNm)
  const r1 = (r + depth / 2) * pxPerNm
  ctx.fillStyle = withAlpha(color, p.kind === 'weather' ? alpha * 0.55 : alpha)
  ctx.beginPath()
  const a0 = toRad(az - w / 2 - 90)
  const a1 = toRad(az + w / 2 - 90)
  // Make very narrow arcs at least ~2 px wide so they stay visible.
  const minHalf = r1 > 0 ? Math.min(Math.PI, (isTarget ? 2.6 : 1.1) / Math.max(r1, 1)) : 0
  const mid = (a0 + a1) / 2
  const half = Math.max((a1 - a0) / 2, minHalf)
  ctx.arc(cx, cy, r1, mid - half, mid + half)
  ctx.arc(cx, cy, r0, mid + half, mid - half, true)
  ctx.closePath()
  ctx.fill()
}

function drawTrack(ctx: CanvasRenderingContext2D, tr: ScopeTrack, project: ScopeProjector, t: ThemeTokens) {
  const s = project(tr)
  const col =
    tr.emphasis === 'alert'
      ? t['scope-alert']
      : tr.emphasis === 'warning'
        ? t['scope-warning']
        : tr.emphasis === 'dim'
          ? t['scope-dim']
          : t['scope-text']
  // History dots.
  if (tr.history?.length) {
    const n = tr.history.length
    tr.history.forEach((h, i) => {
      const hs = project(h)
      ctx.fillStyle = withAlpha(col, 0.15 + 0.5 * ((i + 1) / n))
      ctx.beginPath()
      ctx.arc(hs.x, hs.y, 1.6, 0, Math.PI * 2)
      ctx.fill()
    })
  }
  if (tr.leaderTo) {
    const ls = project(tr.leaderTo)
    ctx.strokeStyle = withAlpha(col, 0.8)
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(s.x, s.y)
    ctx.lineTo(ls.x, ls.y)
    ctx.stroke()
  }
  drawTrackSymbol(ctx, tr.symbol, s.x, s.y, col)
  if (tr.emphasis === 'selected' || tr.emphasis === 'alert') {
    ctx.strokeStyle = col
    ctx.lineWidth = 1.2
    ctx.strokeRect(s.x - 9, s.y - 9, 18, 18)
  }
  if (tr.label?.length) {
    const lx = s.x + 14
    const ly = s.y - 14
    ctx.strokeStyle = withAlpha(col, 0.7)
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(s.x + 5, s.y - 5)
    ctx.lineTo(lx - 2, ly + 2)
    ctx.stroke()
    ctx.font = `600 11px ${t.fontMono}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'bottom'
    tr.label.forEach((line, i) => {
      const y = ly - (tr.label!.length - 1 - i) * 13
      const w = ctx.measureText(line).width
      ctx.fillStyle = withAlpha(t['scope-bg'], 0.75)
      ctx.fillRect(lx - 2, y - 12, w + 4, 13)
      ctx.fillStyle = col
      ctx.fillText(line, lx, y)
    })
  }
}

/** Track symbols differ by shape so colour is never the only cue. */
export function drawTrackSymbol(ctx: CanvasRenderingContext2D, symbol: TrackSymbol, x: number, y: number, col: string) {
  ctx.strokeStyle = col
  ctx.fillStyle = col
  ctx.lineWidth = 1.6
  const s = 4.5
  ctx.beginPath()
  switch (symbol) {
    case 'primary': // filled dot
      ctx.arc(x, y, 3.2, 0, Math.PI * 2)
      ctx.fill()
      return
    case 'secondary': // open square
      ctx.strokeRect(x - s, y - s, s * 2, s * 2)
      return
    case 'combined': // square with a dot
      ctx.strokeRect(x - s, y - s, s * 2, s * 2)
      ctx.arc(x, y, 2, 0, Math.PI * 2)
      ctx.fill()
      return
    case 'adsb': // open diamond
      ctx.moveTo(x, y - s - 1)
      ctx.lineTo(x + s + 1, y)
      ctx.lineTo(x, y + s + 1)
      ctx.lineTo(x - s - 1, y)
      ctx.closePath()
      ctx.stroke()
      return
    case 'mlat': // open triangle
      ctx.moveTo(x, y - s - 1)
      ctx.lineTo(x + s + 1, y + s)
      ctx.lineTo(x - s - 1, y + s)
      ctx.closePath()
      ctx.stroke()
      return
    case 'fused': // filled diamond
      ctx.moveTo(x, y - s - 1)
      ctx.lineTo(x + s + 1, y)
      ctx.lineTo(x, y + s + 1)
      ctx.lineTo(x - s - 1, y)
      ctx.closePath()
      ctx.fill()
      return
    case 'coast': // dashed circle: predicted, no fresh data
      ctx.setLineDash([2, 2])
      ctx.arc(x, y, s, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
      return
  }
}

function niceStep(raw: number): number {
  const p = 10 ** Math.floor(Math.log10(raw))
  const m = raw / p
  const n = m < 1.5 ? 1 : m < 3.5 ? 2.5 : m < 7.5 ? 5 : 10
  return n * p
}
