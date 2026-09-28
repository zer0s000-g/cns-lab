import { useCallback } from 'react'
import { Canvas2D, type DrawFn } from '@/components/sim/Canvas2D'
import { SimLabel } from '@/components/sim/Controls'
import { angleDiff, bearingDeg, toRad, type Vec2 } from '@/core/geometry'
import { fogContrast, SHAPE_SIZE, visibleInFog, type Box } from '@/core/surface'
import { useSampled } from '@/hooks/useSampled'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { mix } from '@/lib/color'
import type { SurfaceObject } from './engine'
import { APRON, APRON_LINKS, CONNECTORS, HANGAR, RWY, STOP_BAR_Y, TOUCHDOWN_X, TOWER_EYE_M, TOWER_POS, TWY_A_Y, TWY_HALF_WIDTH } from './layout'
import { useSurface, useSurfaceState } from './state'

/** The window view looks south, 140° wide, from the tower cab: both runway ends are in view. */
export const VIEW_CENTRE_DEG = 168
export const VIEW_FOV_DEG = 140
/** Heights and depth below the horizon are stretched so the flat airport is not a thin line. */
export const VERTICAL_STRETCH = 2.5

type P3 = { x: number; y: number; z: number }

interface Cam {
  k: number
  cx: number
  horizon: number
}

function project(c: Cam, p: P3): { x: number; y: number; d: number } | null {
  const dx = p.x - TOWER_POS.x
  const dy = p.y - TOWER_POS.y
  const d = Math.hypot(dx, dy)
  if (d < 2) return null
  const rel = angleDiff(VIEW_CENTRE_DEG, bearingDeg(TOWER_POS, { x: p.x, y: p.y }))
  if (Math.abs(rel) > VIEW_FOV_DEG / 2 + 5) return null
  return { x: c.cx + toRad(rel) * c.k, y: c.horizon - Math.atan2(p.z - TOWER_EYE_M, d) * c.k * VERTICAL_STRETCH, d }
}

/** Fill a ground rectangle split into tiles, each faded by its own distance. */
function groundBox(ctx: CanvasRenderingContext2D, c: Cam, b: Box, colour: string, fog: string, vis: number, tile: number) {
  for (let x0 = b.minX; x0 < b.maxX; x0 += tile) {
    for (let y0 = b.minY; y0 < b.maxY; y0 += tile) {
      const x1 = Math.min(b.maxX, x0 + tile)
      const y1 = Math.min(b.maxY, y0 + tile)
      const corners: Vec2[] = []
      const n = 4
      for (let i = 0; i <= n; i++) corners.push({ x: x0 + ((x1 - x0) * i) / n, y: y0 })
      for (let i = 0; i <= n; i++) corners.push({ x: x1, y: y0 + ((y1 - y0) * i) / n })
      for (let i = 0; i <= n; i++) corners.push({ x: x1 - ((x1 - x0) * i) / n, y: y1 })
      for (let i = 0; i <= n; i++) corners.push({ x: x0, y: y1 - ((y1 - y0) * i) / n })
      const pts = corners.map((p) => project(c, { ...p, z: 0 }))
      if (pts.some((p) => !p)) continue
      const mid = project(c, { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: 0 })!
      ctx.fillStyle = mix(colour, fog, 1 - fogContrast(mid.d, vis))
      ctx.beginPath()
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p!.x, p!.y) : ctx.lineTo(p!.x, p!.y)))
      ctx.closePath()
      ctx.fill()
    }
  }
}

function drawBuilding(ctx: CanvasRenderingContext2D, c: Cam, b: Box, h: number, colour: string, fog: string, vis: number) {
  const corners: Vec2[] = [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
  ]
  const faces = corners.map((a, i) => [a, corners[(i + 1) % 4]] as const)
  const withDist = faces.map(([a, bb]) => ({ a, b: bb, d: Math.hypot((a.x + bb.x) / 2 - TOWER_POS.x, (a.y + bb.y) / 2 - TOWER_POS.y) }))
  withDist.sort((p, q) => q.d - p.d)
  for (const f of withDist) {
    const q = [project(c, { ...f.a, z: 0 }), project(c, { ...f.b, z: 0 }), project(c, { ...f.b, z: h }), project(c, { ...f.a, z: h })]
    if (q.some((p) => !p)) continue
    ctx.fillStyle = mix(colour, fog, 1 - fogContrast(f.d, vis))
    ctx.beginPath()
    q.forEach((p, i) => (i === 0 ? ctx.moveTo(p!.x, p!.y) : ctx.lineTo(p!.x, p!.y)))
    ctx.closePath()
    ctx.fill()
  }
}

function strokeWorld(ctx: CanvasRenderingContext2D, c: Cam, a: P3, b: P3, widthM: number, colour: string) {
  const pa = project(c, a)
  const pb = project(c, b)
  if (!pa || !pb) return
  const d = (pa.d + pb.d) / 2
  ctx.strokeStyle = colour
  ctx.lineWidth = Math.max(1, (widthM / d) * c.k)
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(pa.x, pa.y)
  ctx.lineTo(pb.x, pb.y)
  ctx.stroke()
}

function drawObject(ctx: CanvasRenderingContext2D, c: Cam, o: SurfaceObject, t: ThemeTokens, vis: number) {
  const d = Math.hypot(o.pos.x - TOWER_POS.x, o.pos.y - TOWER_POS.y)
  const colour = mix(o.kind === 'vehicle' ? t['sim-signal'] : t['sim-ink'], t['sim-fog'], 1 - fogContrast(d, vis))
  const h = toRad(o.headingDeg)
  const fwd = { x: Math.sin(h), y: Math.cos(h) }
  const right = { x: Math.cos(h), y: -Math.sin(h) }
  const z0 = o.altitudeM
  const at = (along: number, side: number, z: number): P3 => ({ x: o.pos.x + fwd.x * along + right.x * side, y: o.pos.y + fwd.y * along + right.y * side, z: z0 + z })
  if (o.kind === 'aircraft') {
    const s = SHAPE_SIZE[o.shape]
    const L = s.length / 2
    const S = s.span / 2
    const scale = s.length / 38
    strokeWorld(ctx, c, at(L, 0, 3 * scale), at(-L, 0, 3.5 * scale), 4 * scale, colour)
    strokeWorld(ctx, c, at(-2 * scale, -S, 2.5 * scale), at(-2 * scale, S, 2.5 * scale), 1.5 * scale, colour)
    strokeWorld(ctx, c, at(-L * 0.85, 0, 4 * scale), at(-L * 0.95, 0, 12 * scale), 2 * scale, colour)
  } else {
    const s = SHAPE_SIZE[o.shape]
    strokeWorld(ctx, c, at(0, 0, 0.3), at(0, 0, 1.9), Math.max(s.length, s.span) * 0.8, colour)
  }
}

export function TowerView() {
  const { engine } = useSurface()
  const vis = useSurfaceState((s) => s.visibilityM)

  const draw: DrawFn = useCallback(
    (ctx, { width, height, tokens: t }) => {
      const c: Cam = { k: width / toRad(VIEW_FOV_DEG), cx: width / 2, horizon: height * 0.3 }
      const fog = t['sim-fog']
      // Sky: hazier as the visibility drops.
      ctx.fillStyle = mix(t['sim-sky'], fog, 1 - fogContrast(2500, vis) * 0.8)
      ctx.fillRect(0, 0, width, c.horizon + 1)
      // Ground: each band faded by its distance.
      const grass = mix(t['sim-land'], t['sim-terrain'], 0.35)
      for (let y = Math.floor(c.horizon); y < height; y += 3) {
        const below = (y + 1.5 - c.horizon) / (c.k * VERTICAL_STRETCH)
        const d = below > 0 ? TOWER_EYE_M / Math.tan(below) : 1e6
        ctx.fillStyle = mix(grass, fog, 1 - fogContrast(d, vis))
        ctx.fillRect(0, y, width, 3)
      }
      const paved = mix(t['sim-neutral'], t['sim-land'], 0.4)
      const rwyCol = mix(t['sim-neutral'], t['sim-ink'], 0.25)
      groundBox(ctx, c, { minX: APRON.minX, maxX: APRON.maxX, minY: APRON.minY, maxY: Math.min(APRON.maxY, TOWER_POS.y - 5) }, paved, fog, vis, 110)
      groundBox(ctx, c, { minX: RWY.thresholdX - 30, maxX: 2400, minY: TWY_A_Y - TWY_HALF_WIDTH, maxY: TWY_A_Y + TWY_HALF_WIDTH }, paved, fog, vis, 90)
      for (const cn of CONNECTORS) groundBox(ctx, c, { minX: cn.x - TWY_HALF_WIDTH, maxX: cn.x + TWY_HALF_WIDTH, minY: RWY.halfWidthM, maxY: TWY_A_Y - TWY_HALF_WIDTH }, paved, fog, vis, 60)
      for (const x of APRON_LINKS) groundBox(ctx, c, { minX: x - TWY_HALF_WIDTH, maxX: x + TWY_HALF_WIDTH, minY: TWY_A_Y + TWY_HALF_WIDTH, maxY: APRON.minY }, paved, fog, vis, 60)
      groundBox(ctx, c, { minX: RWY.thresholdX, maxX: RWY.endX, minY: -RWY.halfWidthM, maxY: RWY.halfWidthM }, rwyCol, fog, vis, 100)
      // Runway centreline and threshold markings.
      for (let x = RWY.thresholdX + 60; x < RWY.endX - 60; x += 50) {
        const a = project(c, { x, y: 0, z: 0 })
        const b = project(c, { x: x + 30, y: 0, z: 0 })
        if (!a || !b) continue
        ctx.strokeStyle = mix(t['sim-bg'], fog, 1 - fogContrast(a.d, vis))
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
      }
      // Buildings in view (the hangar; the terminal is behind the tower).
      drawBuilding(ctx, c, HANGAR, 25, mix(t['sim-terrain'], t['sim-ink'], 0.2), fog, vis)
      // Stop bars: lights stay visible a little farther than objects.
      for (const cn of CONNECTORS) {
        const p = project(c, { x: cn.x, y: STOP_BAR_Y, z: 0.4 })
        if (!p || !engine.stopBars[cn.id]) continue
        const k = fogContrast(p.d, vis * 2)
        if (k < 0.05) continue
        ctx.fillStyle = mix(t['sim-alert'], fog, 1 - k)
        ctx.beginPath()
        ctx.arc(p.x, p.y, Math.max(1.2, (6 / p.d) * c.k * 0.4), 0, Math.PI * 2)
        ctx.fill()
      }
      // Aircraft and vehicles, far to near.
      const objs = engine.objects.filter((o) => o.phase !== 'cargo-away').map((o) => ({ o, d: Math.hypot(o.pos.x - TOWER_POS.x, o.pos.y - TOWER_POS.y) }))
      objs.sort((a, b) => b.d - a.d)
      for (const { o } of objs) drawObject(ctx, c, o, t, vis)
      // Window frame mullions.
      ctx.fillStyle = mix(t['sim-ink'], t['sim-bg'], 0.35)
      for (const f of [0.25, 0.5, 0.75]) ctx.fillRect(Math.round(width * f) - 1.5, 0, 3, height)
      ctx.fillRect(0, 0, width, 3)
      ctx.fillRect(0, height - 3, width, 3)
      // Compass directions along the top.
      ctx.font = `600 10px ${t.fontSans}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillStyle = t['sim-ink']
      for (const [brg, name] of [[112.5, 'ESE'], [135, 'SE'], [157.5, 'SSE'], [180, 'S'], [202.5, 'SSW'], [225, 'SW']] as const) {
        const x = c.cx + toRad(angleDiff(VIEW_CENTRE_DEG, brg)) * c.k
        if (x > 12 && x < width - 12) ctx.fillText(name, x, 6)
      }
    },
    [engine, vis],
  )

  const info = useSampled(() => {
    const tdz = Math.hypot(TOUCHDOWN_X - TOWER_POS.x, 0 - TOWER_POS.y)
    const far = Math.hypot(RWY.endX - TOWER_POS.x, 0 - TOWER_POS.y)
    const arr = engine.objects.find((o) => o.phase === 'final' || o.phase === 'rollout')
    const arrD = arr ? Math.hypot(arr.pos.x - TOWER_POS.x, arr.pos.y - TOWER_POS.y) : NaN
    return { tdz: visibleInFog(tdz, vis), far: visibleInFog(far, vis), arr: arr ? arr.callsign : null, arrSeen: arr ? visibleInFog(arrD, vis) : false }
  }, 400)

  const label = `View from the control tower windows, looking south, with visibility ${vis >= 1000 ? `${(vis / 1000).toFixed(1)} kilometres` : `${Math.round(vis)} metres`}. ${info.far ? 'The whole runway can be seen.' : info.tdz ? 'Only the near part of the runway can be seen.' : 'The runway cannot be seen from the tower.'}`

  return (
    <div className="flex flex-col gap-2">
      <Canvas2D draw={draw} label={label} className="aspect-[12/5] w-full rounded-lg border bg-sim-sky" />
      <div className="flex flex-wrap gap-1.5">
        <SimLabel icon="none">Simplified view, 140° wide, heights stretched ×{VERTICAL_STRETCH}</SimLabel>
      </div>
    </div>
  )
}
