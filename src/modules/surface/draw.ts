/**
 * Drawing helpers shared by the airport map (theme colours) and the
 * surveillance display underlay (scope colours). Everything is in metres and
 * goes through a `toS` transform to canvas pixels, so both views agree.
 */

import { toRad, type Vec2 } from '@/core/geometry'
import { SHAPE_SIZE, type Box, type SurfaceShape } from '@/core/surface'
import {
  APRON,
  APRON_LINKS,
  CAR_PARK,
  CONNECTORS,
  HANGAR,
  RWY,
  SERVICE_ROAD_X,
  SERVICE_ROAD_Y,
  SOUTH_ROAD_X,
  SOUTH_ROAD_Y,
  STANDS,
  STOP_BAR_Y,
  TAXILANE_Y,
  TERMINAL,
  TOWER_BOX,
  TWY_A_Y,
  TWY_HALF_WIDTH,
} from './layout'

export type ToScreen = (p: Vec2) => Vec2

export interface AirportPalette {
  grass: string | null
  runway: string
  taxiway: string
  marking: string
  guideLine: string
  building: string
  buildingEdge: string
  road: string
  text: string
  muted: string
}

function fillBox(ctx: CanvasRenderingContext2D, b: Box, toS: ToScreen) {
  const a = toS({ x: b.minX, y: b.maxY })
  const c = toS({ x: b.maxX, y: b.minY })
  ctx.fillRect(a.x, a.y, c.x - a.x, c.y - a.y)
}

function strokeBox(ctx: CanvasRenderingContext2D, b: Box, toS: ToScreen) {
  const a = toS({ x: b.minX, y: b.maxY })
  const c = toS({ x: b.maxX, y: b.minY })
  ctx.strokeRect(a.x, a.y, c.x - a.x, c.y - a.y)
}

function line(ctx: CanvasRenderingContext2D, pts: Vec2[], toS: ToScreen) {
  ctx.beginPath()
  pts.forEach((p, i) => {
    const s = toS(p)
    if (i === 0) ctx.moveTo(s.x, s.y)
    else ctx.lineTo(s.x, s.y)
  })
  ctx.stroke()
}

/** Paved surfaces, markings, buildings and roads. `pxPerM` scales line widths. */
export function drawAirport(
  ctx: CanvasRenderingContext2D,
  toS: ToScreen,
  pxPerM: number,
  pal: AirportPalette,
  opts: { labels?: boolean; font?: string; compact?: boolean } = {},
) {
  const w = (m: number) => Math.max(1, m * pxPerM)
  // Roads.
  ctx.strokeStyle = pal.road
  ctx.lineWidth = w(7)
  line(ctx, [{ x: SOUTH_ROAD_X[0], y: SOUTH_ROAD_Y }, { x: SOUTH_ROAD_X[1], y: SOUTH_ROAD_Y }], toS)
  line(ctx, [{ x: SERVICE_ROAD_X[0], y: SERVICE_ROAD_Y }, { x: SERVICE_ROAD_X[1], y: SERVICE_ROAD_Y }], toS)
  // Car park (landside).
  ctx.save()
  ctx.strokeStyle = pal.muted
  ctx.setLineDash([4, 4])
  ctx.lineWidth = 1
  strokeBox(ctx, CAR_PARK, toS)
  ctx.restore()

  // Taxiways and apron.
  ctx.fillStyle = pal.taxiway
  fillBox(ctx, APRON, toS)
  fillBox(ctx, { minX: RWY.thresholdX - 30, maxX: 2400, minY: TWY_A_Y - TWY_HALF_WIDTH, maxY: TWY_A_Y + TWY_HALF_WIDTH }, toS)
  for (const c of CONNECTORS) fillBox(ctx, { minX: c.x - TWY_HALF_WIDTH, maxX: c.x + TWY_HALF_WIDTH, minY: 0, maxY: TWY_A_Y }, toS)
  for (const x of APRON_LINKS) fillBox(ctx, { minX: x - TWY_HALF_WIDTH, maxX: x + TWY_HALF_WIDTH, minY: TWY_A_Y, maxY: APRON.minY + 5 }, toS)
  // Runway.
  ctx.fillStyle = pal.runway
  fillBox(ctx, { minX: RWY.thresholdX, maxX: RWY.endX, minY: RWY.centreY - RWY.halfWidthM, maxY: RWY.centreY + RWY.halfWidthM }, toS)

  // Markings: runway centreline dashes and threshold bars.
  ctx.strokeStyle = pal.marking
  ctx.lineWidth = w(1)
  ctx.save()
  const dash = Math.max(2, 30 * pxPerM)
  ctx.setLineDash([dash, dash * 0.67])
  line(ctx, [{ x: RWY.thresholdX + 60, y: 0 }, { x: RWY.endX - 60, y: 0 }], toS)
  ctx.restore()
  ctx.lineWidth = w(1.8)
  for (const x0 of [RWY.thresholdX + 6, RWY.endX - 6]) {
    for (let k = -3; k <= 3; k++) {
      if (k === 0) continue
      line(ctx, [{ x: x0, y: k * 5.5 }, { x: x0 - 12 * Math.sign(x0), y: k * 5.5 }], toS)
    }
  }
  // Runway designators painted near each end.
  ctx.save()
  ctx.fillStyle = pal.marking
  ctx.font = `700 ${Math.max(8, Math.min(14, 30 * pxPerM))}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const d09 = toS({ x: RWY.thresholdX + 110, y: 0 })
  const d27 = toS({ x: RWY.endX - 110, y: 0 })
  ctx.fillText('09', d09.x, d09.y)
  ctx.fillText('27', d27.x, d27.y)
  ctx.restore()
  // Taxi guide lines (only when zoomed in enough to be useful).
  if (pxPerM >= 0.35) {
  ctx.strokeStyle = pal.guideLine
  ctx.lineWidth = Math.max(1, 0.6 * pxPerM)
  line(ctx, [{ x: RWY.thresholdX - 30, y: TWY_A_Y }, { x: 2400, y: TWY_A_Y }], toS)
  for (const c of CONNECTORS) line(ctx, [{ x: c.x, y: 0 }, { x: c.x, y: TWY_A_Y }], toS)
  for (const x of APRON_LINKS) line(ctx, [{ x, y: TWY_A_Y }, { x, y: TAXILANE_Y }], toS)
  line(ctx, [{ x: APRON.minX + 20, y: TAXILANE_Y }, { x: APRON.maxX - 20, y: TAXILANE_Y }], toS)
  for (const s of Object.values(STANDS)) line(ctx, [{ x: s.x, y: TAXILANE_Y }, { x: s.x, y: s.y + 20 }], toS)
  }
  // Runway-holding position markings.
  ctx.lineWidth = Math.max(1, 0.8 * pxPerM)
  for (const c of CONNECTORS) {
    line(ctx, [{ x: c.x - TWY_HALF_WIDTH, y: STOP_BAR_Y }, { x: c.x + TWY_HALF_WIDTH, y: STOP_BAR_Y }], toS)
    line(ctx, [{ x: c.x - TWY_HALF_WIDTH, y: STOP_BAR_Y + 3 }, { x: c.x + TWY_HALF_WIDTH, y: STOP_BAR_Y + 3 }], toS)
  }

  // Buildings.
  ctx.fillStyle = pal.building
  ctx.strokeStyle = pal.buildingEdge
  ctx.lineWidth = 1
  for (const b of [TERMINAL, HANGAR, TOWER_BOX]) {
    fillBox(ctx, b, toS)
    // Diagonal hatching marks buildings apart from paved areas (not by colour alone).
    const a = toS({ x: b.minX, y: b.maxY })
    const c = toS({ x: b.maxX, y: b.minY })
    ctx.save()
    ctx.beginPath()
    ctx.rect(a.x, a.y, c.x - a.x, c.y - a.y)
    ctx.clip()
    ctx.globalAlpha = 0.35
    const hgt = c.y - a.y
    for (let x = a.x - hgt; x < c.x; x += 7) {
      ctx.beginPath()
      ctx.moveTo(x, c.y)
      ctx.lineTo(x + hgt, a.y)
      ctx.stroke()
    }
    ctx.restore()
    strokeBox(ctx, b, toS)
  }

  if (opts.labels) {
    ctx.fillStyle = pal.text
    ctx.font = opts.font ?? '600 10px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const tc = toS({ x: (TERMINAL.minX + TERMINAL.maxX) / 2, y: (TERMINAL.minY + TERMINAL.maxY) / 2 })
    ctx.fillText('Terminal', tc.x, tc.y)
    const hc = toS({ x: (HANGAR.minX + HANGAR.maxX) / 2, y: (HANGAR.minY + HANGAR.maxY) / 2 })
    ctx.fillText('Hangar', hc.x, hc.y)
    const ap = toS({ x: APRON.minX + 60, y: APRON.maxY - 30 })
    ctx.textAlign = 'left'
    ctx.fillText('Apron', ap.x, ap.y)
    ctx.textAlign = 'center'
    ctx.fillStyle = pal.muted
    const cp = toS({ x: (CAR_PARK.minX + CAR_PARK.maxX) / 2, y: (CAR_PARK.minY + CAR_PARK.maxY) / 2 })
    ctx.fillText(opts.compact ? 'Car park' : 'Car park (landside)', cp.x, cp.y)
    if (!opts.compact) {
      ctx.fillStyle = pal.text
      const rn = toS({ x: -400, y: -RWY.halfWidthM - 22 })
      ctx.fillText('Runway 09/27', rn.x, rn.y)
      for (const c of CONNECTORS) {
        const p = toS({ x: c.x + 24, y: TWY_A_Y - 45 })
        ctx.fillText(c.id, p.x, p.y)
      }
      const ta = toS({ x: 1250, y: TWY_A_Y + 22 })
      ctx.fillText('Taxiway A', ta.x, ta.y)
    }
  }
}

/** Stop bars (a row of lights across each connector at the holding position). */
export function drawStopBars(ctx: CanvasRenderingContext2D, toS: ToScreen, pxPerM: number, lit: Record<string, boolean>, red: string, off: string) {
  const r = Math.max(1.4, 1.1 * pxPerM)
  for (const c of CONNECTORS) {
    ctx.fillStyle = lit[c.id] ? red : off
    for (let k = -3; k <= 3; k++) {
      const s = toS({ x: c.x + k * 3.2, y: STOP_BAR_Y - 2 })
      ctx.beginPath()
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

/** Green taxiway centreline lights ahead of an aircraft ("follow the greens"). */
export function drawGreens(ctx: CanvasRenderingContext2D, toS: ToScreen, pxPerM: number, pts: Vec2[], green: string) {
  const r = Math.max(1.3, 0.9 * pxPerM)
  ctx.fillStyle = green
  for (const p of pts) {
    const s = toS(p)
    ctx.beginPath()
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2)
    ctx.fill()
  }
}

/** Top-down silhouette of an aircraft or vehicle, true to size unless `minLengthPx` makes it bigger. */
export function drawObjectShape(ctx: CanvasRenderingContext2D, s: Vec2, headingDeg: number, shape: SurfaceShape, pxPerM: number, fill: string, outline: string, minLengthPx = 0): number {
  const size = SHAPE_SIZE[shape]
  const k = Math.max(pxPerM, minLengthPx / size.length)
  ctx.save()
  ctx.translate(s.x, s.y)
  ctx.rotate(toRad(headingDeg))
  ctx.lineJoin = 'round'
  ctx.beginPath()
  if (shape === 'medium' || shape === 'heavy') {
    const L = (size.length / 2) * k
    const S = (size.span / 2) * k
    const fw = Math.max(1.2, size.length * 0.055 * k)
    // Nose at -y (canvas up) before rotation.
    ctx.moveTo(0, -L)
    ctx.lineTo(fw, -L * 0.8)
    ctx.lineTo(fw, -L * 0.12)
    ctx.lineTo(S, L * 0.28)
    ctx.lineTo(S, L * 0.36)
    ctx.lineTo(fw, L * 0.18)
    ctx.lineTo(fw * 0.8, L * 0.78)
    ctx.lineTo(S * 0.36, L * 0.95)
    ctx.lineTo(S * 0.36, L * 1.02)
    ctx.lineTo(0, L * 0.94)
    ctx.lineTo(-S * 0.36, L * 1.02)
    ctx.lineTo(-S * 0.36, L * 0.95)
    ctx.lineTo(-fw * 0.8, L * 0.78)
    ctx.lineTo(-fw, L * 0.18)
    ctx.lineTo(-S, L * 0.36)
    ctx.lineTo(-S, L * 0.28)
    ctx.lineTo(-fw, -L * 0.12)
    ctx.lineTo(-fw, -L * 0.8)
    ctx.closePath()
  } else {
    const L = (size.length / 2) * k
    const W = (size.span / 2) * k
    ctx.rect(-W, -L, 2 * W, 2 * L)
  }
  ctx.fillStyle = fill
  ctx.strokeStyle = outline
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.fill()
  ctx.restore()
  return k / pxPerM
}
