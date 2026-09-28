/**
 * Canvas helpers for drawing the 90 Hz and 150 Hz lobes. Colour is never the
 * only cue: 90 Hz areas get diagonal lines (/), 150 Hz areas get dots.
 */

import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { withAlpha } from '@/lib/color'

export type Tone = '90' | '150'

const cache = new Map<string, CanvasPattern | null>()

/** Repeating hatch pattern for a tone, in the tone's token colour. */
export function tonePattern(ctx: CanvasRenderingContext2D, tone: Tone, t: ThemeTokens): CanvasPattern | null {
  const color = tone === '90' ? t['lobe-90'] : t['lobe-150']
  const key = `${tone}:${color}`
  if (cache.has(key)) return cache.get(key)!
  const c = document.createElement('canvas')
  const n = 8
  c.width = n
  c.height = n
  const g = c.getContext('2d')!
  if (tone === '90') {
    g.strokeStyle = withAlpha(color, 0.75)
    g.lineWidth = 1.2
    g.beginPath()
    g.moveTo(0, n)
    g.lineTo(n, 0)
    g.moveTo(-n / 2, n / 2)
    g.lineTo(n / 2, -n / 2)
    g.moveTo(n / 2, n + n / 2)
    g.lineTo(n + n / 2, n / 2)
    g.stroke()
  } else {
    g.fillStyle = withAlpha(color, 0.85)
    g.beginPath()
    g.arc(n / 4, n / 4, 1.1, 0, Math.PI * 2)
    g.arc((3 * n) / 4, (3 * n) / 4, 1.1, 0, Math.PI * 2)
    g.fill()
  }
  const p = ctx.createPattern(c, 'repeat')
  cache.set(key, p)
  return p
}

/**
 * Paint a DDM field into an offscreen canvas: each cell is tinted with the
 * tone that predominates there (stronger tint = larger difference) and
 * hatched with that tone's pattern.
 */
export function paintField(
  width: number,
  height: number,
  dpr: number,
  t: ThemeTokens,
  cell: number,
  ddmAt: (sx: number, sy: number) => { ddm: number; fade: number } | null,
  fullScaleDdm: number,
): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(width * dpr))
  c.height = Math.max(1, Math.round(height * dpr))
  const ctx = c.getContext('2d')!
  ctx.scale(dpr, dpr)
  const p90 = tonePattern(ctx, '90', t)
  const p150 = tonePattern(ctx, '150', t)
  for (let y = 0; y < height; y += cell) {
    for (let x = 0; x < width; x += cell) {
      const v = ddmAt(x + cell / 2, y + cell / 2)
      if (!v) continue
      const tone: Tone = v.ddm >= 0 ? '90' : '150'
      const k = Math.min(1, Math.abs(v.ddm) / fullScaleDdm)
      ctx.fillStyle = withAlpha(tone === '90' ? t['lobe-90'] : t['lobe-150'], (0.04 + 0.2 * k) * v.fade)
      ctx.fillRect(x, y, cell, cell)
      if (k > 0.2) {
        ctx.globalAlpha = Math.min(1, 0.15 + 0.45 * k) * v.fade
        ctx.fillStyle = (tone === '90' ? p90 : p150) ?? 'transparent'
        ctx.fillRect(x, y, cell, cell)
        ctx.globalAlpha = 1
      }
    }
  }
  return c
}

/** A small legend swatch (colour + pattern) drawn at x, y. */
export function drawToneSwatch(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, tone: Tone, t: ThemeTokens) {
  const color = tone === '90' ? t['lobe-90'] : t['lobe-150']
  ctx.fillStyle = withAlpha(color, 0.35)
  ctx.fillRect(x, y, size, size)
  const p = tonePattern(ctx, tone, t)
  if (p) {
    ctx.fillStyle = p
    ctx.fillRect(x, y, size, size)
  }
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1)
}
