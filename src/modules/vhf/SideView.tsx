import { useCallback, useMemo, useRef } from 'react'
import { drawAircraftIcon, drawStation, haloText } from '@/components/sim/mapDraw'
import { SimLabel } from '@/components/sim/Controls'
import { radioHorizonNm } from '@/core/propagation'
import { FT_PER_NM, clamp } from '@/core/units'
import { firstObstructionNm, minAltitudeForContactFt, sideViewPoint } from '@/core/vhf'
import { earthDropFt } from '@/core/propagation'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { withAlpha } from '@/lib/color'
import { useReducedMotion } from '@/stores/prefs'
import { CurvedEarthView } from './CurvedEarthView'
import { curvePath, drawDistanceTicks, fillEarth, segment, type SideFrame, type SideProjection } from './curvedEarth'
import { CNS202_POS, CNS303_POS, CNS707_OFFSET_NM, MOUNTAIN, SITE, mountainProfile, type Who } from './engine'
import { useVhf, useVhfState } from './state'

export const VIEW_MIN_NM = -12
export const VIEW_MAX_NM = 270
export const VIEW_TOP_FT = 44000
export const MIN_ALT_FT = 500
export const MAX_ALT_FT = 40000
export const MIN_DIST_NM = 5
export const MAX_DIST_NM = 260
const CENTER_NM = (VIEW_MIN_NM + VIEW_MAX_NM) / 2

const FRAME: SideFrame = {
  point: (d, h) => sideViewPoint(d, h, CENTER_NM),
  yUnitsPerX: FT_PER_NM,
  inverse: (x, y) => ({ d: x, h: y + earthDropFt(x - CENTER_NM) }),
}

const fmtAlt = (ft: number) => (ft >= 10000 ? `FL${Math.round(ft / 100)}` : `${Math.round(ft / 100) * 100} ft`)

/** Side view: ground antenna, terrain, the curve of the Earth and the straight radio rays. */
export function VhfSideView() {
  const { engine } = useVhf()
  const setParam = useVhfState((s) => s.setParam)
  const params = useVhfState((s) => s.params)
  const failures = useVhfState((s) => s.failures)
  const reduced = useReducedMotion()
  const projRef = useRef<SideProjection | null>(null)
  const dragging = useRef(false)

  // The no-contact boundary does not depend on the learner, only on the terrain: compute it once per terrain.
  const floorCurve = useMemo(() => {
    const profile = mountainProfile(failures.mountain)
    const pts: [number, number][] = []
    for (let d = 0.5; d <= VIEW_MAX_NM; d += 1.5) pts.push([d, minAltitudeForContactFt(SITE.antennaFt, d, profile)])
    return pts
  }, [failures.mountain])

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, proj: SideProjection, info: { width: number; height: number; now: number; tokens: ThemeTokens }) => {
      const t = info.tokens
      const e = engine
      const profile = e.profile()
      const surface = (d: number) => Math.max(0, profile(d))
      const P = (d: number, h: number) => proj.toScreen(d, h)
      ctx.fillStyle = t['sim-sky']
      ctx.fillRect(0, 0, info.width, info.height)

      // Region with no contact to the radio site (below the tangent / mountain shadow).
      ctx.save()
      ctx.beginPath()
      const first = floorCurve[0]
      ctx.moveTo(P(first[0], surface(first[0])).x, P(first[0], surface(first[0])).y)
      for (const [d] of floorCurve) {
        const p = P(d, surface(d))
        ctx.lineTo(p.x, p.y)
      }
      for (let i = floorCurve.length - 1; i >= 0; i--) {
        const [d, h] = floorCurve[i]
        const p = P(d, Math.min(h, VIEW_TOP_FT * 1.6))
        ctx.lineTo(p.x, p.y)
      }
      ctx.closePath()
      ctx.fillStyle = t['sim-shadow-zone']
      ctx.fill()
      ctx.clip()
      ctx.strokeStyle = withAlpha(t['sim-muted'], 0.25)
      ctx.lineWidth = 1
      for (let x = -info.height; x < info.width; x += 9) {
        ctx.beginPath()
        ctx.moveTo(x, info.height)
        ctx.lineTo(x + info.height, 0)
        ctx.stroke()
      }
      ctx.restore()
      // Its upper edge: the lowest height with line of sight (a straight tangent over a smooth Earth).
      ctx.save()
      ctx.setLineDash([6, 4])
      ctx.strokeStyle = t['sim-muted']
      ctx.lineWidth = 1.4
      ctx.beginPath()
      floorCurve.forEach(([d, h], i) => {
        const p = P(d, h)
        if (i === 0) ctx.moveTo(P(0, SITE.antennaFt).x, P(0, SITE.antennaFt).y)
        ctx.lineTo(p.x, p.y)
      })
      ctx.stroke()
      ctx.restore()

      // Altitude reference lines: constant height above the sea, so they curve with the Earth.
      ctx.save()
      ctx.setLineDash([2, 5])
      ctx.strokeStyle = t['sim-grid-strong']
      ctx.lineWidth = 1
      for (const alt of [10000, 20000, 30000, 40000]) {
        ctx.beginPath()
        curvePath(ctx, proj, VIEW_MIN_NM, VIEW_MAX_NM, () => alt, 90)
        ctx.stroke()
        const lp2 = P(VIEW_MIN_NM + 1, alt)
        haloText(ctx, `${alt.toLocaleString('en-US')} ft`, lp2.x, lp2.y - 3, t, { align: 'left', color: t['sim-muted'], font: `500 10px ${t.fontSans}` })
      }
      ctx.restore()

      // Earth and terrain.
      fillEarth(ctx, proj, surface, t['sim-land'], info.height, t['sim-grid-strong'])
      if (failures.mountain) {
        const m0 = MOUNTAIN.centerNm - 3.2 * MOUNTAIN.sigmaNm
        const m1 = MOUNTAIN.centerNm + 3.2 * MOUNTAIN.sigmaNm
        ctx.beginPath()
        curvePath(ctx, proj, m0, m1, surface, 80)
        curvePath(ctx, proj, m1, m0, () => 0, 20, false)
        ctx.closePath()
        ctx.fillStyle = t['sim-terrain']
        ctx.fill()
        ctx.beginPath()
        curvePath(ctx, proj, m0, m1, surface, 80)
        ctx.strokeStyle = t['sim-terrain-high']
        ctx.lineWidth = 2
        ctx.stroke()
        const top = P(MOUNTAIN.centerNm, MOUNTAIN.peakFt)
        haloText(ctx, `${MOUNTAIN.name} ${MOUNTAIN.peakFt.toLocaleString('en-US')} ft`, top.x + 8, top.y - 4, t, { align: 'left', font: `600 10px ${t.fontSans}` })
      }
      drawDistanceTicks(ctx, proj, t, { step: info.width < 560 ? 100 : 50, unit: 'NM', surface, format: (d) => `${d} NM` })

      // Labels for the shadow region.
      const lx = e.params.distanceNm < 160 ? 225 : 105
      const lp = P(lx, surface(lx) + 1500)
      haloText(ctx, 'No line of sight here', lp.x, lp.y - 14, t, { align: 'center', color: t['sim-muted'], font: `600 10px ${t.fontSans}` })
      const horizon = radioHorizonNm(SITE.antennaFt)
      const hp = P(horizon, 0)
      ctx.fillStyle = t['sim-muted']
      ctx.beginPath()
      ctx.arc(hp.x, hp.y, 2.5, 0, Math.PI * 2)
      ctx.fill()

      // Rays from the radio site to the aircraft.
      const ant = P(SITE.distanceNm, SITE.antennaFt)
      const rays: { who: Who; d: number; h: number; main: boolean }[] = [
        { who: 'CNS202', d: CNS202_POS.distanceNm, h: CNS202_POS.altitudeFt, main: false },
        ...(failures.stuckMic ? [{ who: 'CNS303' as Who, d: CNS303_POS.distanceNm, h: CNS303_POS.altitudeFt, main: false }] : []),
        { who: 'CNS101', d: e.params.distanceNm, h: e.params.altitudeFt, main: true },
      ]
      for (const r of rays) {
        const listener = r.who === 'CNS303' ? null : (r.who as 'CNS101' | 'CNS202')
        const level = listener ? e.levelAt('controller', listener) : e.levelAt('CNS303', 'ground')
        const ok = level > -Infinity
        ctx.save()
        ctx.lineWidth = r.main ? 2.2 : 1.2
        if (ok) {
          ctx.strokeStyle = r.main ? t['sim-signal'] : withAlpha(t['sim-signal'], 0.55)
          ctx.beginPath()
          segment(ctx, proj, [0, SITE.antennaFt], [r.d, r.h])
          ctx.stroke()
        } else if (r.main) {
          // Straight ray until it hits the Earth or the mountain.
          const worst = firstObstructionNm(SITE.antennaFt, r.d, r.h, profile) ?? r.d
          ctx.strokeStyle = t['sim-alert']
          ctx.setLineDash([5, 4])
          ctx.beginPath()
          segment(ctx, proj, [0, SITE.antennaFt], [worst, surface(worst)])
          ctx.stroke()
          ctx.setLineDash([2, 4])
          ctx.strokeStyle = withAlpha(t['sim-alert'], 0.6)
          ctx.beginPath()
          segment(ctx, proj, [worst, surface(worst)], [r.d, r.h])
          ctx.stroke()
          const bp = P(worst, surface(worst))
          ctx.setLineDash([])
          ctx.strokeStyle = t['sim-alert']
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.moveTo(bp.x - 5, bp.y - 5)
          ctx.lineTo(bp.x + 5, bp.y + 5)
          ctx.moveTo(bp.x + 5, bp.y - 5)
          ctx.lineTo(bp.x - 5, bp.y + 5)
          ctx.stroke()
          const byMountain = failures.mountain && Math.abs(worst - MOUNTAIN.centerNm) < 3 * MOUNTAIN.sigmaNm
          const text = byMountain ? 'Blocked by the mountain' : `Blocked: the ray meets the sea ${worst.toFixed(0)} NM out`
          ctx.font = `600 10px ${t.fontSans}`
          const tw = ctx.measureText(text).width
          // Keep the label on the canvas and clear of the radio-site label.
          const tx = Math.min(Math.max(bp.x - tw / 2, ant.x + 58), info.width - tw - 8)
          haloText(ctx, text, byMountain ? bp.x + 12 : tx, byMountain ? bp.y + 14 : bp.y + 30, t, { align: 'left', color: t['sim-alert'], font: `600 10px ${t.fontSans}` })
        }
        ctx.restore()
      }

      // Stations.
      const talking = (w: Who) => e.isTransmitting(w) && (w !== 'controller' || e.transmissions.some((x) => x.who === 'controller' && x.radiated && x.start <= e.timeS && (x.end === null || x.end > e.timeS)))
      const ring = (x: number, y: number, on: boolean) => {
        if (!on) return
        ctx.save()
        ctx.strokeStyle = t['sim-signal']
        ctx.lineWidth = 1.5
        const ph = reduced ? 0.5 : (info.now / 900) % 1
        for (const k of [0, 0.5]) {
          const f = (ph + k) % 1
          ctx.globalAlpha = 1 - f
          ctx.beginPath()
          ctx.arc(x, y, 8 + f * 16, 0, Math.PI * 2)
          ctx.stroke()
        }
        ctx.restore()
      }
      ring(ant.x, ant.y - 6, talking('controller'))
      drawStation(ctx, { x: ant.x, y: ant.y - 6 }, 'tower', t, { label: 'Radio site', failed: e.failures.txFailure && e.vccs.transmitter === 'main' })

      const plane = (who: Who, d: number, h: number, lines: string[], style: 'normal' | 'selected' | 'dim' = 'normal') => {
        const p = P(d, h)
        ring(p.x, p.y, talking(who))
        drawAircraftIcon(ctx, p, 90, t, { label: lines, style, size: who === 'CNS101' ? 10 : 8 })
      }
      plane('CNS202', CNS202_POS.distanceNm, CNS202_POS.altitudeFt, ['CNS202', fmtAlt(CNS202_POS.altitudeFt)], 'dim')
      if (failures.stuckMic) plane('CNS303', CNS303_POS.distanceNm, CNS303_POS.altitudeFt, ['CNS303', 'stuck microphone'], 'dim')
      if (failures.interference) {
        const p = P(e.params.distanceNm + CNS707_OFFSET_NM, e.params.altitudeFt)
        ring(p.x, p.y, talking('CNS707'))
        drawAircraftIcon(ctx, { x: p.x, y: p.y - 16 }, 90, t, { style: 'dim', size: 7 })
        haloText(ctx, 'CNS707 (next channel)', p.x + 10, p.y - 24, t, { font: `600 10px ${t.fontSans}`, color: t['sim-muted'] })
      }
      const inContact = e.learnerInContact()
      plane('CNS101', e.params.distanceNm, e.params.altitudeFt, [`CNS101 (you)`, fmtAlt(e.params.altitudeFt), inContact ? 'in contact' : 'no contact'], 'selected')
    },
    [engine, floorCurve, failures.mountain, failures.stuckMic, failures.interference, reduced],
  )

  const toParams = (x: number, y: number) => {
    const p = projRef.current?.fromScreen(x, y)
    if (!p) return
    setParam('distanceNm', Math.round(clamp(p.d, MIN_DIST_NM, MAX_DIST_NM)))
    setParam('altitudeFt', Math.round(clamp(p.h, MIN_ALT_FT, MAX_ALT_FT) / 100) * 100)
  }
  const local = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const floor = engine.contactFloorFt()
  const label = `Side view of the radio site and the curve of the Earth. Your aircraft CNS101 is ${params.distanceNm} nautical miles away at ${Math.round(params.altitudeFt).toLocaleString('en-US')} feet and is ${engine.learnerInContact() ? 'in' : 'out of'} line of sight. At this distance contact is lost below ${Math.round(floor).toLocaleString('en-US')} feet. Use the arrow keys to move the aircraft.`

  return (
    <CurvedEarthView
      frame={FRAME}
      domain={() => ({ dMin: VIEW_MIN_NM, dMax: VIEW_MAX_NM, hMin: 0, hMax: VIEW_TOP_FT })}
      padding={{ top: 40, right: 18, bottom: 26, left: 18 }}
      draw={draw}
      projRef={projRef}
      label={label}
      className="h-72 md:h-80"
      focusable
      labels={<SimLabel icon="none">Aircraft drawn larger than life</SimLabel>}
      onPointerDown={(ev) => {
        const pr = projRef.current
        if (!pr) return
        const { x, y } = local(ev)
        const a = pr.toScreen(engine.params.distanceNm, engine.params.altitudeFt)
        if (Math.hypot(a.x - x, a.y - y) > 28) return
        dragging.current = true
        ev.currentTarget.setPointerCapture(ev.pointerId)
      }}
      onPointerMove={(ev) => {
        if (!dragging.current) return
        const { x, y } = local(ev)
        toParams(x, y)
      }}
      onPointerUp={() => {
        dragging.current = false
      }}
      onKeyDown={(ev) => {
        // Read the live values from the engine: several key presses can arrive before React re-renders.
        const p = engine.params
        const step = ev.shiftKey ? 20 : 5
        if (ev.key === 'ArrowLeft') setParam('distanceNm', clamp(p.distanceNm - step, MIN_DIST_NM, MAX_DIST_NM))
        else if (ev.key === 'ArrowRight') setParam('distanceNm', clamp(p.distanceNm + step, MIN_DIST_NM, MAX_DIST_NM))
        else if (ev.key === 'ArrowUp') setParam('altitudeFt', clamp(p.altitudeFt + (ev.shiftKey ? 2000 : 500), MIN_ALT_FT, MAX_ALT_FT))
        else if (ev.key === 'ArrowDown') setParam('altitudeFt', clamp(p.altitudeFt - (ev.shiftKey ? 2000 : 500), MIN_ALT_FT, MAX_ALT_FT))
        else return
        ev.preventDefault()
      }}
    />
  )
}
