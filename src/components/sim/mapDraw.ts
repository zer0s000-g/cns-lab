/**
 * Drawing helpers for top-down maps and side views. Colours come from tokens.
 */

import { toRad, worldToScreen, type MapView, type Vec2 } from '@/core/geometry'
import { getThemeTokens, type ThemeTokens } from '@/hooks/useThemeTokens'
import { withAlpha } from '@/lib/color'

export type IconStyle = 'normal' | 'selected' | 'dim' | 'alert'

/** Aircraft silhouette rotated to its heading, with an optional label block. */
export function drawAircraftIcon(
  ctx: CanvasRenderingContext2D,
  s: Vec2,
  headingDeg: number,
  t: ThemeTokens,
  opts: { label?: string[]; style?: IconStyle; size?: number } = {},
) {
  const style = opts.style ?? 'normal'
  const size = opts.size ?? 9
  const col = style === 'alert' ? t['sim-alert'] : style === 'dim' ? t['sim-muted'] : t['sim-ink']
  ctx.save()
  ctx.translate(s.x, s.y)
  if (style === 'selected') {
    ctx.strokeStyle = t['primary']
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(0, 0, size + 6, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.rotate(toRad(headingDeg))
  ctx.globalAlpha = style === 'dim' ? 0.55 : 1
  // Outline for contrast on any background.
  ctx.lineJoin = 'round'
  ctx.strokeStyle = t['sim-bg']
  ctx.lineWidth = 3
  planePath(ctx, size)
  ctx.stroke()
  ctx.fillStyle = col
  planePath(ctx, size)
  ctx.fill()
  ctx.restore()
  if (opts.label?.length) {
    ctx.save()
    ctx.font = `600 11px ${t.fontSans}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    opts.label.forEach((line, i) => {
      const y = s.y + size + 2 + i * 13
      ctx.lineWidth = 3
      ctx.strokeStyle = withAlpha(t['sim-bg'], 0.9)
      ctx.strokeText(line, s.x + size + 2, y)
      ctx.fillStyle = i === 0 ? col : t['sim-muted']
      ctx.fillText(line, s.x + size + 2, y)
    })
    ctx.restore()
  }
}

function planePath(ctx: CanvasRenderingContext2D, s: number) {
  ctx.beginPath()
  ctx.moveTo(0, -s)
  ctx.lineTo(s * 0.18, -s * 0.45)
  ctx.lineTo(s, s * 0.1)
  ctx.lineTo(s, s * 0.32)
  ctx.lineTo(s * 0.18, s * 0.12)
  ctx.lineTo(s * 0.14, s * 0.62)
  ctx.lineTo(s * 0.45, s * 0.9)
  ctx.lineTo(s * 0.45, s * 1.02)
  ctx.lineTo(0, s * 0.88)
  ctx.lineTo(-s * 0.45, s * 1.02)
  ctx.lineTo(-s * 0.45, s * 0.9)
  ctx.lineTo(-s * 0.14, s * 0.62)
  ctx.lineTo(-s * 0.18, s * 0.12)
  ctx.lineTo(-s, s * 0.32)
  ctx.lineTo(-s, s * 0.1)
  ctx.lineTo(-s * 0.18, -s * 0.45)
  ctx.closePath()
}

export type StationKind = 'radar' | 'tower' | 'beacon' | 'receiver' | 'antenna' | 'vor' | 'dme' | 'ndb'

/** Ground station symbol with a label. Shapes differ per kind (never colour alone). */
export function drawStation(
  ctx: CanvasRenderingContext2D,
  s: Vec2,
  kind: StationKind,
  t: ThemeTokens,
  opts: { label?: string; failed?: boolean; size?: number } = {},
) {
  const r = opts.size ?? 7
  const col = opts.failed ? t['sim-muted'] : t['sim-signal']
  ctx.save()
  ctx.translate(s.x, s.y)
  ctx.lineWidth = 2
  ctx.strokeStyle = col
  ctx.fillStyle = t['sim-bg']
  ctx.beginPath()
  switch (kind) {
    case 'radar':
      ctx.arc(0, 0, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(-r * 0.6, r * 0.2)
      ctx.quadraticCurveTo(0, -r * 1.1, r * 0.6, r * 0.2)
      ctx.stroke()
      break
    case 'vor':
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3
        const x = Math.cos(a) * r
        const y = Math.sin(a) * r
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(0, 0, 1.8, 0, Math.PI * 2)
      ctx.fillStyle = col
      ctx.fill()
      break
    case 'dme':
      ctx.rect(-r, -r * 0.75, r * 2, r * 1.5)
      ctx.fill()
      ctx.stroke()
      break
    case 'ndb':
      ctx.arc(0, 0, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      for (const rr of [r * 0.35]) {
        ctx.beginPath()
        ctx.arc(0, 0, rr, 0, Math.PI * 2)
        ctx.fillStyle = col
        ctx.fill()
      }
      ctx.setLineDash([2, 2])
      ctx.beginPath()
      ctx.arc(0, 0, r + 4, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
      break
    case 'receiver':
      ctx.moveTo(0, -r)
      ctx.lineTo(r, r * 0.8)
      ctx.lineTo(-r, r * 0.8)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      break
    case 'tower':
    case 'antenna':
    case 'beacon':
    default:
      ctx.moveTo(0, -r)
      ctx.lineTo(r * 0.6, r)
      ctx.lineTo(-r * 0.6, r)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(0, -r, 2, 0, Math.PI * 2)
      ctx.fillStyle = col
      ctx.fill()
  }
  if (opts.failed) {
    ctx.strokeStyle = t['sim-alert']
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(-r - 2, -r - 2)
    ctx.lineTo(r + 2, r + 2)
    ctx.moveTo(r + 2, -r - 2)
    ctx.lineTo(-r - 2, r + 2)
    ctx.stroke()
  }
  ctx.restore()
  if (opts.label) {
    ctx.save()
    ctx.font = `600 11px ${t.fontSans}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.lineWidth = 3
    ctx.strokeStyle = withAlpha(t['sim-bg'], 0.9)
    ctx.strokeText(opts.label, s.x, s.y + r + 4)
    ctx.fillStyle = t['sim-ink']
    ctx.fillText(opts.label, s.x, s.y + r + 4)
    ctx.restore()
  }
}

/** Dashed range ring around a world point with an optional label. */
export function drawRangeRing(
  ctx: CanvasRenderingContext2D,
  center: Vec2,
  radiusNm: number,
  view: MapView,
  color: string,
  opts: { label?: string; dash?: number[]; width?: number; labelBearingDeg?: number } = {},
) {
  const c = worldToScreen(center, view)
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = opts.width ?? 1.2
  ctx.setLineDash(opts.dash ?? [6, 5])
  ctx.beginPath()
  ctx.arc(c.x, c.y, radiusNm * view.pxPerNm, 0, Math.PI * 2)
  ctx.stroke()
  ctx.setLineDash([])
  if (opts.label) {
    const a = toRad((opts.labelBearingDeg ?? 45) - 90)
    const lx = c.x + Math.cos(a) * radiusNm * view.pxPerNm
    const ly = c.y + Math.sin(a) * radiusNm * view.pxPerNm
    ctx.font = `600 10px ${getThemeTokens().fontSans}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'bottom'
    ctx.fillStyle = color
    ctx.fillText(opts.label, lx + 4, ly - 2)
  }
  ctx.restore()
}

/** A wedge from `center` along `bearingDeg` with total angular width `widthDeg`. */
export function drawBeamWedge(
  ctx: CanvasRenderingContext2D,
  center: Vec2,
  bearingDeg: number,
  widthDeg: number,
  lengthNm: number,
  view: MapView,
  fill: string,
  stroke?: string,
) {
  const c = worldToScreen(center, view)
  const r = lengthNm * view.pxPerNm
  ctx.save()
  ctx.fillStyle = fill
  ctx.beginPath()
  ctx.moveTo(c.x, c.y)
  ctx.arc(c.x, c.y, r, toRad(bearingDeg - widthDeg / 2 - 90), toRad(bearingDeg + widthDeg / 2 - 90))
  ctx.closePath()
  ctx.fill()
  if (stroke) {
    ctx.strokeStyle = stroke
    ctx.lineWidth = 1.5
    const a = toRad(bearingDeg - 90)
    ctx.beginPath()
    ctx.moveTo(c.x, c.y)
    ctx.lineTo(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r)
    ctx.stroke()
  }
  ctx.restore()
}

/** Text with a halo so it stays readable over any map background. */
export function haloText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  t: ThemeTokens,
  opts: { color?: string; font?: string; align?: CanvasTextAlign; baseline?: CanvasTextBaseline } = {},
) {
  ctx.save()
  ctx.font = opts.font ?? `600 11px ${t.fontSans}`
  ctx.textAlign = opts.align ?? 'left'
  ctx.textBaseline = opts.baseline ?? 'alphabetic'
  ctx.lineWidth = 3
  ctx.strokeStyle = withAlpha(t['sim-bg'], 0.9)
  ctx.strokeText(text, x, y)
  ctx.fillStyle = opts.color ?? t['sim-ink']
  ctx.fillText(text, x, y)
  ctx.restore()
}
