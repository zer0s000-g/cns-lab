/**
 * The region map (2D): what area and oceanic control work with. The coast,
 * the terminal area, the oceanic boundary, how far the radar, ADS-B and VHF
 * reach, CNS700's route, the other traffic, and — over the ocean — the gap
 * between where CNS700 really is and what the controller knows from its
 * last ADS-C report. Night colours in both themes (scope and stage tokens).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Canvas2D, type DrawFn } from '@/components/sim/Canvas2D'
import { predictTrack, trackPosition } from '@/core/fusion'
import { bearingVector, distanceNm, type Vec2 } from '@/core/geometry'
import { DEFAULT_TERRAIN } from '@/core/world'
import { getThemeTokens, type ThemeTokens } from '@/hooks/useThemeTokens'
import { useSampled } from '@/hooks/useSampled'
import { withAlpha } from '@/lib/color'
import { cn } from '@/lib/utils'
import { ADSB_RANGE_NM, ADSB_SITES, ENROUTE_RADAR_SITE, OCEANIC_BOUNDARY_X, SSR_RANGE_ENR_NM, SYSTEMS, VHF_RANGE_NM, VHF_SITES, type SystemId } from './systems'
import { TMA_RADIUS_NM } from './journey'
import { getJourneyIndex, JOURNEY_ID } from './phases'
import { ADSC_LATENCY_S, type SandboxEngine } from './engine'
import { useSandbox, useSandboxState } from './state'

/** The part of the world the map always shows, NM. */
const FRAME = { minX: -75, maxX: 400, minY: -105, maxY: 95 }

interface View {
  cx: number
  cy: number
  k: number
  w: number
  h: number
}

const toS = (v: View, p: Vec2) => ({ x: v.w / 2 + (p.x - v.cx) * v.k, y: v.h / 2 - (p.y - v.cy) * v.k })

/** Fit the frame into the canvas, leaving `inset` px free on each side (the side panels) and room at the top and bottom for the HUD. */
function frameView(w: number, h: number, inset: number, top: number, bottom: number): View {
  const pad = 20
  const fw = Math.max(80, w - 2 * inset - pad * 2)
  const fh = Math.max(80, h - top - bottom - pad * 2)
  const k = Math.max(0.05, Math.min(fw / (FRAME.maxX - FRAME.minX), fh / (FRAME.maxY - FRAME.minY)))
  // Centre the frame in the free area (top and bottom margins may differ).
  const cy = (FRAME.minY + FRAME.maxY) / 2 + (bottom - top) / 2 / k
  return { cx: (FRAME.minX + FRAME.maxX) / 2, cy, k, w, h }
}

function text(ctx: CanvasRenderingContext2D, t: ThemeTokens, s: string, x: number, y: number, color: string, opts: { size?: number; align?: CanvasTextAlign; baseline?: CanvasTextBaseline; weight?: number } = {}) {
  ctx.font = `${opts.weight ?? 600} ${opts.size ?? 10.5}px ${t.fontMono}`
  ctx.textAlign = opts.align ?? 'left'
  ctx.textBaseline = opts.baseline ?? 'middle'
  ctx.lineWidth = 3
  ctx.strokeStyle = withAlpha(t['scope-bg'], 0.85)
  ctx.strokeText(s, x, y)
  ctx.fillStyle = color
  ctx.fillText(s, x, y)
}

function ring(ctx: CanvasRenderingContext2D, v: View, c: Vec2, rNm: number, color: string, dash: number[], width = 1.2) {
  const s = toS(v, c)
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.setLineDash(dash)
  ctx.beginPath()
  ctx.arc(s.x, s.y, Math.max(0, rNm * v.k), 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

function planeIcon(ctx: CanvasRenderingContext2D, s: Vec2, headingDeg: number, color: string, size: number) {
  ctx.save()
  ctx.translate(s.x, s.y)
  ctx.rotate((headingDeg * Math.PI) / 180)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(0, -size)
  ctx.lineTo(size * 0.18, -size * 0.35)
  ctx.lineTo(size, size * 0.1)
  ctx.lineTo(size, size * 0.3)
  ctx.lineTo(size * 0.18, size * 0.05)
  ctx.lineTo(size * 0.12, size * 0.65)
  ctx.lineTo(size * 0.4, size * 0.9)
  ctx.lineTo(size * 0.4, size)
  ctx.lineTo(0, size * 0.85)
  ctx.lineTo(-size * 0.4, size)
  ctx.lineTo(-size * 0.4, size * 0.9)
  ctx.lineTo(-size * 0.12, size * 0.65)
  ctx.lineTo(-size * 0.18, size * 0.05)
  ctx.lineTo(-size, size * 0.3)
  ctx.lineTo(-size, size * 0.1)
  ctx.lineTo(-size * 0.18, -size * 0.35)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

/** Coverage of one system at one altitude, computed in small chunks off the frame loop (scope colours). */
function useCoverage(engine: SandboxEngine, system: SystemId | null, altFt: number, depsKey: string) {
  const ref = useRef<{ canvas: HTMLCanvasElement | null; key: string }>({ canvas: null, key: '' })
  const key = system ? `${system}|${altFt}|${depsKey}` : ''
  useEffect(() => {
    if (!system) {
      ref.current = { canvas: null, key: '' }
      return
    }
    const nx = 190
    const ny = Math.round((nx * (FRAME.maxY - FRAME.minY)) / (FRAME.maxX - FRAME.minX))
    const c = document.createElement('canvas')
    c.width = nx
    c.height = ny
    const ctx = c.getContext('2d')!
    ctx.fillStyle = withAlpha(getThemeTokens()['scope-trace'], 0.22)
    let row = 0
    let cancelled = false
    let timer = 0
    const tick = () => {
      if (cancelled) return
      const until = Math.min(ny, row + 8)
      for (; row < until; row++) {
        const y = FRAME.maxY - ((row + 0.5) / ny) * (FRAME.maxY - FRAME.minY)
        for (let i = 0; i < nx; i++) {
          const x = FRAME.minX + ((i + 0.5) / nx) * (FRAME.maxX - FRAME.minX)
          if (engine.coverageAt(system, { x, y }, altFt)) ctx.fillRect(i, row, 1, 1)
        }
      }
      ref.current = { canvas: c, key }
      if (row < ny) timer = window.setTimeout(tick, 0)
    }
    timer = window.setTimeout(tick, 20)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [engine, system, altFt, key])
  return { ref, key }
}

export function RegionMap({ className }: { className?: string }) {
  const { engine } = useSandbox()
  const inset = useSandboxState((s) => s.sideInsetPx)
  const coverage = useSandboxState((s) => s.coverage)
  const coverageAlt = useSandboxState((s) => s.coverageAltFt)
  const systems = useSandboxState((s) => s.systems)
  const scenario = useSandboxState((s) => s.scenario)
  const cov = useCoverage(engine, coverage, coverageAlt, `${JSON.stringify(systems)}|${scenario}`)
  const [samples] = useState(() => getJourneyIndex().samples)

  const draw: DrawFn = useCallback(
    (ctx, { width, height, tokens: t, now }) => {
      // Hidden (the map is not the view on show): nothing to draw.
      if (width < 60 || height < 60) return
      // Leave room for the phase line above and the camera row and timeline below.
      const v = frameView(width, height, inset, width >= 1024 ? 70 : 64, width >= 1024 ? 150 : 50)
      // Sea and land.
      ctx.fillStyle = t['stage-water']
      ctx.fillRect(0, 0, width, height)
      ctx.beginPath()
      const top = FRAME.maxY + 60
      const bottom = FRAME.minY - 60
      ctx.moveTo(0, toS(v, { x: 0, y: top }).y)
      for (let y = top; y >= bottom; y -= 2) {
        const s = toS(v, { x: DEFAULT_TERRAIN.coastX(y), y })
        ctx.lineTo(s.x, s.y)
      }
      ctx.lineTo(0, toS(v, { x: 0, y: bottom }).y)
      ctx.closePath()
      ctx.fillStyle = withAlpha(t['stage-terrain'], 0.45)
      ctx.fill()
      ctx.strokeStyle = withAlpha(t['stage-line'], 0.5)
      ctx.lineWidth = 1
      ctx.stroke()
      // Graticule every 50 NM.
      ctx.strokeStyle = t['scope-grid']
      ctx.lineWidth = 1
      for (let x = -50; x <= FRAME.maxX + 50; x += 50) {
        const s = toS(v, { x, y: 0 })
        ctx.beginPath()
        ctx.moveTo(s.x, 0)
        ctx.lineTo(s.x, height)
        ctx.stroke()
      }
      for (let y = -100; y <= 100; y += 50) {
        const s = toS(v, { x: 0, y })
        ctx.beginPath()
        ctx.moveTo(0, s.y)
        ctx.lineTo(width, s.y)
        ctx.stroke()
      }
      // Coverage overlay chosen by the learner.
      const c = cov.ref.current
      if (c.canvas && c.key === cov.key) {
        const a = toS(v, { x: FRAME.minX, y: FRAME.maxY })
        const b = toS(v, { x: FRAME.maxX, y: FRAME.minY })
        ctx.imageSmoothingEnabled = true
        ctx.drawImage(c.canvas, a.x, a.y, b.x - a.x, b.y - a.y)
      }
      // How far the ground systems reach (maximum ranges; less at low altitude).
      const reach = withAlpha(t['scope-dim'], 0.7)
      ring(ctx, v, ENROUTE_RADAR_SITE.pos, SSR_RANGE_ENR_NM, reach, [2, 5])
      ring(ctx, v, ADSB_SITES[1].pos, ADSB_RANGE_NM, reach, [8, 5])
      ring(ctx, v, VHF_SITES[1].pos, VHF_RANGE_NM, reach, [1, 3])
      const labelAt = (center: Vec2, r: number, brg: number, s: string) => {
        const u = bearingVector(brg)
        const p = toS(v, { x: center.x + u.x * r, y: center.y + u.y * r })
        text(ctx, t, s, p.x + 4, p.y, t['scope-dim'], { size: 9.5 })
      }
      labelAt(ENROUTE_RADAR_SITE.pos, SSR_RANGE_ENR_NM, 72, 'RADAR RANGE')
      labelAt(ADSB_SITES[1].pos, ADSB_RANGE_NM, 95, 'ADS-B RANGE')
      labelAt(VHF_SITES[1].pos, VHF_RANGE_NM, 120, 'VHF RANGE')
      // Terminal area and the oceanic boundary.
      ring(ctx, v, { x: 0, y: 0 }, TMA_RADIUS_NM, withAlpha(t['stage-brass'], 0.9), [6, 4], 1.5)
      const tl = toS(v, { x: -TMA_RADIUS_NM * 0.7, y: TMA_RADIUS_NM * 0.78 })
      text(ctx, t, 'TERMINAL AREA · APPROACH', tl.x, tl.y - 8, t['stage-brass'], { size: 9.5, align: 'center' })
      const b0 = toS(v, { x: OCEANIC_BOUNDARY_X, y: FRAME.maxY + 40 })
      const b1 = toS(v, { x: OCEANIC_BOUNDARY_X, y: FRAME.minY - 40 })
      ctx.save()
      ctx.strokeStyle = t['scope-grid-strong']
      ctx.lineWidth = 1.5
      ctx.setLineDash([10, 6])
      ctx.beginPath()
      ctx.moveTo(b0.x, b0.y)
      ctx.lineTo(b1.x, b1.y)
      ctx.stroke()
      ctx.restore()
      const lbY = toS(v, { x: 0, y: FRAME.maxY - 6 }).y
      text(ctx, t, 'AREA CONTROL · RADAR', b0.x - 8, lbY, t['scope-text'], { size: 10, align: 'right' })
      text(ctx, t, 'OCEANIC CONTROL · PROCEDURAL', b0.x + 8, lbY, t['scope-text'], { size: 10 })
      // The airport.
      const ap = toS(v, { x: 0, y: 0 })
      ctx.fillStyle = t['scope-text']
      ctx.fillRect(ap.x - 4, ap.y - 1.5, 8, 3)
      text(ctx, t, 'XCNS', ap.x - 8, ap.y + 12, t['scope-text'], { align: 'right', size: 10 })

      // CNS700's route: planned (dashed) and flown (solid).
      const tick = engine.journeyTick
      ctx.save()
      ctx.lineWidth = 1.4
      ctx.setLineDash([4, 4])
      ctx.strokeStyle = withAlpha(t['scope-trace'], 0.45)
      ctx.beginPath()
      samples.forEach((sm, i) => {
        const s = toS(v, sm.pos)
        if (i === 0) ctx.moveTo(s.x, s.y)
        else ctx.lineTo(s.x, s.y)
      })
      ctx.stroke()
      ctx.setLineDash([])
      ctx.strokeStyle = t['scope-trace']
      ctx.lineWidth = 2
      ctx.beginPath()
      let started = false
      for (const sm of samples) {
        if (sm.tick > tick) break
        const s = toS(v, sm.pos)
        if (!started) ctx.moveTo(s.x, s.y)
        else ctx.lineTo(s.x, s.y)
        started = true
      }
      const pose = engine.journeyPose()
      if (pose && started) {
        const s = toS(v, pose.pos)
        ctx.lineTo(s.x, s.y)
      }
      ctx.stroke()
      ctx.restore()

      // Other traffic.
      for (const a of engine.aircraft) {
        if (a.id === JOURNEY_ID) continue
        const s = toS(v, a.pos)
        if (s.x < -20 || s.y < -20 || s.x > width + 20 || s.y > height + 20) continue
        planeIcon(ctx, s, a.headingDeg, t['scope-dim'], 6)
        if (distanceNm(a.pos, { x: 0, y: 0 }) > 30) text(ctx, t, a.callsign === 'UNK1' ? '' : a.callsign, s.x + 8, s.y - 6, t['scope-dim'], { size: 9 })
      }

      if (!pose) return
      const cp = toS(v, pose.pos)
      // What the controller knows: the fused track (over the ocean, the last ADS-C report carried forward).
      const tr = engine.tracks.get(JOURNEY_ID)
      const oceanic = pose.pos.x > OCEANIC_BOUNDARY_X
      if (tr) {
        const known = trackPosition(predictTrack(tr, engine.timeS))
        const ks = toS(v, known)
        if (oceanic) {
          ctx.save()
          ctx.strokeStyle = withAlpha(t['scope-blip'], 0.7)
          ctx.setLineDash([3, 3])
          ctx.beginPath()
          ctx.moveTo(ks.x, ks.y)
          ctx.lineTo(cp.x, cp.y)
          ctx.stroke()
          ctx.restore()
        }
        ctx.save()
        ctx.translate(ks.x, ks.y)
        ctx.rotate(Math.PI / 4)
        ctx.strokeStyle = t['scope-blip']
        ctx.lineWidth = 1.8
        ctx.strokeRect(-5, -5, 10, 10)
        ctx.restore()
        // Label on the far side from the aircraft's own label (which sits below right).
        if (oceanic) text(ctx, t, "CONTROLLER'S PICTURE", ks.x - 10, ks.y - 16, t['scope-blip'], { size: 9.5, align: 'right' })
      }
      // ADS-C reports as received by the oceanic centre.
      engine.adscLog.forEach((r, i) => {
        const s = toS(v, r.pos)
        ctx.fillStyle = withAlpha(t['scope-blip'], Math.max(0.25, 0.9 - i * 0.12))
        ctx.beginPath()
        ctx.arc(s.x, s.y, 3, 0, Math.PI * 2)
        ctx.fill()
        if (i === 0) {
          const ageMin = Math.max(0, (engine.timeS - r.receivedS) / 60)
          text(ctx, t, `ADS-C REPORT · ${ageMin < 1 ? 'JUST NOW' : `${Math.round(ageMin)} MIN AGO`}`, s.x + 8, s.y - 10, t['scope-blip'], { size: 9.5 })
        }
      })
      // SATCOM: a link up to the geostationary satellite; a pulse travels while a report is on its way.
      if (oceanic) {
        const sat = { x: cp.x + (width * 0.5 - cp.x) * 0.35, y: 14 }
        ctx.save()
        ctx.strokeStyle = withAlpha(t['stage-brass'], 0.6)
        ctx.setLineDash([2, 4])
        ctx.beginPath()
        ctx.moveTo(cp.x, cp.y)
        ctx.lineTo(sat.x, sat.y)
        ctx.stroke()
        ctx.restore()
        ctx.fillStyle = t['stage-brass']
        ctx.fillRect(sat.x - 7, sat.y - 2, 14, 4)
        ctx.fillRect(sat.x - 2, sat.y - 5, 4, 10)
        text(ctx, t, 'SATCOM · GEOSTATIONARY', sat.x + 12, sat.y + 1, t['stage-brass'], { size: 9.5 })
        const r = engine.adscLog[0]
        const since = r ? engine.timeS - r.receivedS : Infinity
        if (since >= 0 && since < 6) {
          const k = (now / 700) % 1
          const px = cp.x + (sat.x - cp.x) * k
          const py = cp.y + (sat.y - cp.y) * k
          ctx.fillStyle = t['stage-brass']
          ctx.beginPath()
          ctx.arc(px, py, 3, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      // HF voice: rings while a call is on air.
      const m = engine.radio[0]
      if (m && m.medium === 'hf' && !m.earlier && engine.timeS - m.timeS < 8) {
        for (let k = 0; k < 3; k++) {
          const f = ((now / 900 + k / 3) % 1 + 1) % 1
          ctx.strokeStyle = withAlpha(t['stage-brass'], 0.8 * (1 - f))
          ctx.beginPath()
          ctx.arc(cp.x, cp.y, 8 + f * 26, 0, Math.PI * 2)
          ctx.stroke()
        }
      }
      // CNS700 itself.
      planeIcon(ctx, cp, pose.headingDeg, t['scope-trace'], 9)
      text(ctx, t, `CNS700 · FL${String(Math.round(pose.altitudeFt / 100)).padStart(3, '0')} · ${Math.round(pose.speedKt)} KT`, cp.x + 12, cp.y + 16, t['scope-trace'], { size: 10.5, weight: 700 })
      // Scale bar.
      const sb = { x: 16, y: height - 18 }
      ctx.strokeStyle = t['scope-text']
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(sb.x, sb.y)
      ctx.lineTo(sb.x + 100 * v.k, sb.y)
      ctx.moveTo(sb.x, sb.y - 4)
      ctx.lineTo(sb.x, sb.y + 4)
      ctx.moveTo(sb.x + 100 * v.k, sb.y - 4)
      ctx.lineTo(sb.x + 100 * v.k, sb.y + 4)
      ctx.stroke()
      text(ctx, t, '100 NM', sb.x + 100 * v.k + 6, sb.y, t['scope-text'], { size: 9.5 })
    },
    [engine, cov.ref, cov.key, samples, inset],
  )

  const label = useSampled(() => describe(engine), 1500)
  return <Canvas2D draw={draw} label={label} className={cn('bg-stage-bg', className)} />
}

function describe(e: SandboxEngine): string {
  const p = e.journeyPose()
  if (!p) return 'Region map.'
  const oceanic = p.pos.x > OCEANIC_BOUNDARY_X
  const r = e.adscLog[0]
  return `Region map. CNS700 is ${Math.round(distanceNm(p.pos, { x: 0, y: 0 }))} NM from the airport at flight level ${Math.round(p.altitudeFt / 100)}, ${oceanic ? 'in oceanic airspace, beyond radar and VHF range' : 'within radar cover'}.${
    oceanic && r ? ` The controller's last ADS-C report arrived ${Math.round((e.timeS - r.receivedS) / 60)} minutes ago, ${ADSC_LATENCY_S} seconds after it was sent.` : ''
  }`
}

export const COVERAGE_CHOICES = SYSTEMS.filter((s) => s.coverage)
