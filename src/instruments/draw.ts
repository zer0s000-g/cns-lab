/**
 * Shared canvas helpers for instruments. Colours always come from the theme
 * tokens passed in.
 */

import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { toRad } from '@/core/geometry'

/** Exponential smoothing toward a target (instrument needle damping). */
export function damp(current: number, target: number, dt: number, tauS: number): number {
  if (!(dt > 0) || tauS <= 0) return target
  return current + (target - current) * (1 - Math.exp(-dt / tauS))
}

/** Damping for angles: takes the short way round, result in [0, 360). */
export function dampAngle(current: number, target: number, dt: number, tauS: number): number {
  const diff = ((((target - current) % 360) + 540) % 360) - 180
  const v = current + damp(0, diff, dt, tauS)
  return ((v % 360) + 360) % 360
}

/**
 * Square instrument case with a round dial, like a real panel instrument.
 * Returns the dial centre and radius; the four corners are free for knobs and labels.
 */
export function drawCase(ctx: CanvasRenderingContext2D, width: number, height: number, t: ThemeTokens) {
  const s = Math.min(width, height)
  const x0 = (width - s) / 2
  const y0 = (height - s) / 2
  const rad = s * 0.08
  ctx.fillStyle = t['instrument-bezel']
  ctx.beginPath()
  ctx.roundRect(x0 + 1, y0 + 1, s - 2, s - 2, rad)
  ctx.fill()
  const cx = width / 2
  const cy = height / 2
  const R = s * 0.45
  ctx.fillStyle = t['instrument-face']
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, Math.PI * 2)
  ctx.fill()
  return { cx, cy, R, s, x0, y0 }
}

export function drawBezel(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, t: ThemeTokens) {
  ctx.fillStyle = t['instrument-bezel']
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = t['instrument-face']
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.93, 0, Math.PI * 2)
  ctx.fill()
}

/**
 * Compass rose: ticks every 5°, long ticks every 10°, numbers every 30°
 * (N, 3, 6, E, 12, ...). `rotationDeg` rotates the whole card
 * (e.g. -heading for an RMI/HSI so the heading sits at the top).
 */
export function drawCompassCard(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  rotationDeg: number,
  t: ThemeTokens,
  opts: { cardinals?: boolean; fontScale?: number } = {},
) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.strokeStyle = t['instrument-marking']
  ctx.fillStyle = t['instrument-marking']
  ctx.lineCap = 'round'
  for (let a = 0; a < 360; a += 5) {
    const ang = toRad(a + rotationDeg - 90)
    const long = a % 10 === 0
    const len = a % 30 === 0 ? r * 0.12 : long ? r * 0.09 : r * 0.05
    ctx.lineWidth = a % 30 === 0 ? 2 : 1.2
    ctx.beginPath()
    ctx.moveTo(Math.cos(ang) * r, Math.sin(ang) * r)
    ctx.lineTo(Math.cos(ang) * (r - len), Math.sin(ang) * (r - len))
    ctx.stroke()
  }
  const fs = Math.max(9, r * 0.14 * (opts.fontScale ?? 1))
  ctx.font = `600 ${fs}px ${t.fontSans}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (let a = 0; a < 360; a += 30) {
    const label =
      opts.cardinals !== false && a % 90 === 0 ? ['N', 'E', 'S', 'W'][a / 90] : String(a / 10)
    const ang = toRad(a + rotationDeg)
    ctx.save()
    ctx.rotate(ang)
    ctx.fillText(label, 0, -(r - r * 0.24))
    ctx.restore()
  }
  ctx.restore()
}

/** Small aircraft silhouette pointing up, centred at (cx, cy). */
export function drawAircraftSymbol(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.fillStyle = color
  ctx.beginPath()
  const s = size
  ctx.moveTo(0, -s)
  ctx.lineTo(s * 0.12, -s * 0.55)
  ctx.lineTo(s * 0.12, -s * 0.15)
  ctx.lineTo(s * 0.9, s * 0.2)
  ctx.lineTo(s * 0.9, s * 0.35)
  ctx.lineTo(s * 0.12, s * 0.15)
  ctx.lineTo(s * 0.1, s * 0.65)
  ctx.lineTo(s * 0.35, s * 0.85)
  ctx.lineTo(s * 0.35, s * 0.95)
  ctx.lineTo(0, s * 0.85)
  ctx.lineTo(-s * 0.35, s * 0.95)
  ctx.lineTo(-s * 0.35, s * 0.85)
  ctx.lineTo(-s * 0.1, s * 0.65)
  ctx.lineTo(-s * 0.12, s * 0.15)
  ctx.lineTo(-s * 0.9, s * 0.35)
  ctx.lineTo(-s * 0.9, s * 0.2)
  ctx.lineTo(-s * 0.12, -s * 0.15)
  ctx.lineTo(-s * 0.12, -s * 0.55)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

/** Striped warning flag (e.g. "NAV" / "OFF") drawn as a rectangle with text. */
export function drawFlag(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, text: string, t: ThemeTokens) {
  ctx.save()
  ctx.fillStyle = t['instrument-flag']
  ctx.fillRect(x, y, w, h)
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()
  ctx.strokeStyle = t['instrument-face']
  ctx.lineWidth = 2
  for (let i = -h; i < w + h; i += 7) {
    ctx.beginPath()
    ctx.moveTo(x + i, y + h)
    ctx.lineTo(x + i + h, y)
    ctx.stroke()
  }
  ctx.fillStyle = t['instrument-face']
  ctx.fillRect(x + w * 0.12, y + h * 0.18, w * 0.76, h * 0.64)
  ctx.fillStyle = t['instrument-flag']
  ctx.font = `700 ${Math.max(8, h * 0.5)}px ${t.fontSans}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x + w / 2, y + h / 2 + 0.5)
  ctx.restore()
}

/** Formats a bearing as three digits: 5 → "005". */
export const fmt3 = (deg: number) => String(Math.round(((deg % 360) + 360) % 360) % 360).padStart(3, '0')
