/**
 * Shared curved-Earth side view helpers (used by the VHF and HF modules).
 *
 * A module supplies a `frame`: where a point at distance d along the ground and
 * height h sits in a flat model plane. The frame must be one in which straight
 * radio rays are straight lines (VHF: the 4/3 effective Earth via earthDropFt;
 * HF: exact circle geometry). The view then scales the two axes separately
 * (heights exaggerated) with an affine map, which keeps straight lines straight
 * and tangents tangent, and labels the exaggeration on screen.
 */

import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { withAlpha } from '@/lib/color'

export interface SideFrame {
  /** Model-plane point for distance `d` along the ground and height `h`. */
  point: (d: number, h: number) => { x: number; y: number }
  /** How many model y-units make one model x-unit in real life (ft per NM for VHF, 1 for HF). */
  yUnitsPerX: number
  /** Inverse of `point` (optional, for dragging things in the view). */
  inverse?: (x: number, y: number) => { d: number; h: number }
}

export interface SideDomain {
  dMin: number
  dMax: number
  hMin: number
  hMax: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface SideProjection {
  toScreen: (d: number, h: number) => { x: number; y: number }
  /** Screen point back to (distance, height); null when the frame has no inverse. */
  fromScreen: (x: number, y: number) => { d: number; h: number } | null
  /** How many times heights are stretched relative to distances. */
  exaggeration: number
  rect: Rect
  domain: SideDomain
}

/** Fit a frame's domain into a screen rectangle, with independent horizontal and vertical scales. */
export function fitSideProjection(frame: SideFrame, domain: SideDomain, rect: Rect): SideProjection {
  let xMin = Infinity
  let xMax = -Infinity
  let yMin = Infinity
  let yMax = -Infinity
  const n = 96
  for (let k = 0; k <= n; k++) {
    const d = domain.dMin + ((domain.dMax - domain.dMin) * k) / n
    for (const h of [domain.hMin, domain.hMax]) {
      const p = frame.point(d, h)
      xMin = Math.min(xMin, p.x)
      xMax = Math.max(xMax, p.x)
      yMin = Math.min(yMin, p.y)
      yMax = Math.max(yMax, p.y)
    }
  }
  const sx = rect.w / Math.max(1e-9, xMax - xMin)
  const sy = rect.h / Math.max(1e-9, yMax - yMin)
  return {
    toScreen: (d, h) => {
      const p = frame.point(d, h)
      return { x: rect.x + (p.x - xMin) * sx, y: rect.y + rect.h - (p.y - yMin) * sy }
    },
    fromScreen: (x, y) => (frame.inverse ? frame.inverse(xMin + (x - rect.x) / sx, yMin + (rect.y + rect.h - y) / sy) : null),
    exaggeration: (sy * frame.yUnitsPerX) / sx,
    rect,
    domain,
  }
}

/** Path along a constant-height (or height-function) curve, e.g. the ground or a layer. */
export function curvePath(ctx: CanvasRenderingContext2D, proj: SideProjection, d0: number, d1: number, hOf: (d: number) => number, n = 180, move = true) {
  for (let k = 0; k <= n; k++) {
    const d = d0 + ((d1 - d0) * k) / n
    const p = proj.toScreen(d, hOf(d))
    if (k === 0 && move) ctx.moveTo(p.x, p.y)
    else ctx.lineTo(p.x, p.y)
  }
}

/** Fill the Earth below a surface-height function down to the bottom of the canvas. */
export function fillEarth(ctx: CanvasRenderingContext2D, proj: SideProjection, hOf: (d: number) => number, fill: string, bottomY: number, stroke?: string) {
  const { dMin, dMax } = proj.domain
  ctx.beginPath()
  curvePath(ctx, proj, dMin, dMax, hOf)
  const end = proj.toScreen(dMax, hOf(dMax))
  const start = proj.toScreen(dMin, hOf(dMin))
  ctx.lineTo(end.x, bottomY)
  ctx.lineTo(start.x, bottomY)
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
  if (stroke) {
    ctx.beginPath()
    curvePath(ctx, proj, dMin, dMax, hOf)
    ctx.strokeStyle = stroke
    ctx.lineWidth = 1.5
    ctx.stroke()
  }
}

/** A band between two heights (e.g. an ionospheric layer). */
export function fillBand(ctx: CanvasRenderingContext2D, proj: SideProjection, h0: number, h1: number, fill: string) {
  const { dMin, dMax } = proj.domain
  ctx.beginPath()
  curvePath(ctx, proj, dMin, dMax, () => h1)
  curvePath(ctx, proj, dMax, dMin, () => h0, 180, false)
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
}

/** A straight segment between two (distance, height) points: straight on screen by construction. */
export function segment(ctx: CanvasRenderingContext2D, proj: SideProjection, a: [number, number], b: [number, number]) {
  const p = proj.toScreen(a[0], a[1])
  const q = proj.toScreen(b[0], b[1])
  ctx.moveTo(p.x, p.y)
  ctx.lineTo(q.x, q.y)
}

/** Distance ticks along the ground surface. */
export function drawDistanceTicks(
  ctx: CanvasRenderingContext2D,
  proj: SideProjection,
  t: ThemeTokens,
  opts: { step: number; unit: string; surface?: (d: number) => number; format?: (d: number) => string; from?: number },
) {
  const { dMin, dMax } = proj.domain
  const surf = opts.surface ?? (() => 0)
  ctx.save()
  ctx.font = `500 10px ${t.fontMono}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  const first = Math.ceil((opts.from ?? Math.max(0, dMin)) / opts.step) * opts.step
  for (let d = first; d <= dMax + 1e-9; d += opts.step) {
    const p = proj.toScreen(d, surf(d))
    ctx.strokeStyle = t['sim-grid-strong']
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
    ctx.lineTo(p.x, p.y + 5)
    ctx.stroke()
    const label = opts.format ? opts.format(d) : `${d}`
    ctx.lineWidth = 3
    ctx.strokeStyle = withAlpha(t['sim-land'], 0.9)
    ctx.strokeText(label, p.x, p.y + 7)
    ctx.fillStyle = t['sim-muted']
    ctx.fillText(label, p.x, p.y + 7)
  }
  ctx.restore()
}
