import { useCallback } from 'react'
import { Moon, Sun } from 'lucide-react'
import { drawAircraftIcon, drawStation, haloText } from '@/components/sim/mapDraw'
import { SimLabel } from '@/components/sim/Controls'
import { D_LAYER_KM, HF_STATION_ANTENNA_FT, hfSidePoint, traceRay, type BandKind, type RaySegment } from '@/core/hf'
import { rayHeightFt } from '@/core/propagation'
import { FT_PER_NM, kmToNm } from '@/core/units'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { withAlpha } from '@/lib/color'
import { CurvedEarthView } from '@/modules/vhf/CurvedEarthView'
import { curvePath, fillBand, fillEarth, drawDistanceTicks, type SideFrame, type SideProjection } from '@/modules/vhf/curvedEarth'
import { CRUISE_FT, OTHER_AIRCRAFT, TIMELAPSE_H_PER_S, VIEW_MAX_NM } from './engine'
import { formatHour, REASON_TEXT } from './labels'
import { useHf, useHfState } from './state'

const VIEW_MIN_NM = -70
/** Top of the view, km: a little above the F2 layer (escaping rays leave through it). */
const VIEW_TOP_KM = 470
const CENTER_NM = (VIEW_MIN_NM + VIEW_MAX_NM) / 2

const FRAME: SideFrame = { point: (d, h) => hfSidePoint(d, h, CENTER_NM), yUnitsPerX: 1 }

/** Band colours and patterns: never colour alone (labels and hatching too). */
function bandStyle(kind: BandKind, t: ThemeTokens): { fill: string | null; hatch: string | null } {
  switch (kind) {
    case 'ground':
    case 'sky':
      return { fill: t['sim-signal'], hatch: null }
    case 'weak':
      return { fill: withAlpha(t['sim-signal'], 0.35), hatch: null }
    case 'skip':
      return { fill: withAlpha(t['sim-warning'], 0.18), hatch: t['sim-warning'] }
    case 'absorbed':
      return { fill: withAlpha(t['sim-muted'], 0.15), hatch: t['sim-muted'] }
    default:
      return { fill: null, hatch: null }
  }
}

const BAND_LABEL: Record<BandKind, string> = {
  ground: 'ground wave',
  sky: 'heard',
  weak: 'too weak',
  skip: 'skip zone: nothing heard',
  absorbed: 'absorbed',
  none: '',
}

/** Curved Earth with the ionosphere, the fan of rays and where on the ground the signal is heard. */
export function HfSideView() {
  const { engine } = useHf()
  const params = useHfState((s) => s.params)
  const failures = useHfState((s) => s.failures)

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, proj: SideProjection, info: { width: number; height: number; tokens: ThemeTokens }) => {
      const t = info.tokens
      const e = engine
      const io = e.iono()
      const f = e.freqMHz
      const P = (d: number, h: number) => proj.toScreen(d, h)
      const { dMin, dMax } = proj.domain
      const pxPerNm = Math.abs(P(CENTER_NM, 0).y - P(CENTER_NM, 1).y)
      const bandNm = 9 / Math.max(pxPerNm, 1e-6)

      ctx.fillStyle = t['sim-sky']
      ctx.fillRect(0, 0, info.width, info.height)
      if (!io.day) {
        ctx.fillStyle = withAlpha(t['sim-ink'], 0.07)
        ctx.fillRect(0, 0, info.width, info.height)
      }

      // Layers.
      // Short layer names at the far edge, away from the station and its crowded rays (full names in the legend).
      const labels: (() => void)[] = []
      const layerLabel = (text: string, hNm: number, color: string) => {
        labels.push(() => {
          const p = P(dMax - 25, hNm)
          haloText(ctx, text, Math.min(p.x, info.width - 6), p.y, t, { font: `700 11px ${t.fontSans}`, color, align: 'right', baseline: 'middle' })
        })
      }
      const dStrength = Math.min(1, io.dAbsorptionDb / 1.5)
      fillBand(ctx, proj, kmToNm(D_LAYER_KM.bottom), kmToNm(D_LAYER_KM.top), withAlpha(io.flare ? t['sim-alert'] : t['sim-neutral'], 0.08 + 0.3 * Math.min(1, dStrength)))
      layerLabel('D', kmToNm((D_LAYER_KM.top + D_LAYER_KM.bottom) / 2), io.flare ? t['sim-alert'] : t['sim-ink'])
      for (const L of io.layers) {
        const h = kmToNm(L.heightKm)
        const half = kmToNm(L.id === 'E' ? 10 : L.id === 'F1' ? 15 : 35)
        const strength = L.id === 'E' ? Math.min(1, L.foMHz / 3.8) : 1
        fillBand(ctx, proj, h - half, h + half, withAlpha(t['sim-signal-2'], 0.06 + 0.16 * strength))
        ctx.beginPath()
        curvePath(ctx, proj, dMin, dMax, () => h, 120)
        ctx.strokeStyle = withAlpha(t['sim-signal-2'], 0.25 + 0.4 * strength)
        ctx.lineWidth = 1
        ctx.stroke()
        layerLabel(L.id, h, t['sim-ink'])
      }

      // Fan of rays.
      const seg = (s: RaySegment) => {
        const a = P(s.from.dNm, s.from.hNm)
        const b = P(s.to.dNm, s.to.hNm)
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
      }
      const rays = e.rays()
      // Label the most slanted escaping ray, part-way along, clear of the labels at the top of the view.
      const firstEscape = rays.find((r) => r.fate === 'escaped')
      for (const r of rays) {
        ctx.save()
        if (r.fate === 'escaped') {
          ctx.strokeStyle = withAlpha(t['sim-signal-2'], 0.7)
          ctx.setLineDash([7, 5])
          ctx.lineWidth = 1.2
          ctx.beginPath()
          r.segments.forEach(seg)
          ctx.stroke()
          const s = r.segments[r.segments.length - 1]
          const a = P(s.from.dNm, s.from.hNm)
          const b = P(s.to.dNm, s.to.hNm)
          arrowHead(ctx, a, b, withAlpha(t['sim-signal-2'], 0.8))
          if (r === firstEscape) {
            const k = 0.72
            haloText(ctx, 'escapes to space', a.x + (b.x - a.x) * k + 8, a.y + (b.y - a.y) * k, t, { font: `600 10px ${t.fontSans}`, color: t['sim-signal-2'] })
          }
        } else {
          const last = r.fate === 'absorbed' ? r.segments.length - 1 : r.segments.length
          ctx.strokeStyle = withAlpha(t['sim-signal'], 0.45)
          ctx.lineWidth = 1.1
          ctx.beginPath()
          r.segments.slice(0, last).forEach(seg)
          ctx.stroke()
          if (r.fate === 'absorbed' && r.absorbedAt) {
            ctx.strokeStyle = t['sim-muted']
            ctx.setLineDash([1.5, 3])
            ctx.lineWidth = 1.4
            ctx.beginPath()
            seg(r.segments[r.segments.length - 1])
            ctx.stroke()
            ctx.setLineDash([])
            const x = P(r.absorbedAt.dNm, r.absorbedAt.hNm)
            ctx.beginPath()
            ctx.moveTo(x.x - 3, x.y - 3)
            ctx.lineTo(x.x + 3, x.y + 3)
            ctx.moveTo(x.x + 3, x.y - 3)
            ctx.lineTo(x.x - 3, x.y + 3)
            ctx.stroke()
          }
        }
        ctx.restore()
      }

      // The path that actually reaches CNS101.
      const rx = e.reception()
      const D = e.params.distanceNm
      const aNm = CRUISE_FT / FT_PER_NM
      ctx.save()
      ctx.strokeStyle = t['primary']
      ctx.lineWidth = 3
      ctx.lineJoin = 'round'
      ctx.beginPath()
      if (rx.mode === 'sky' && rx.elevationDeg !== null && rx.leg) {
        const ray = traceRay(io, f, rx.elevationDeg, VIEW_MAX_NM + 200)
        const n = rx.hops
        const before = rx.leg === 'down' ? 2 * n - 1 : 2 * n
        const last = ray.segments[before - 1]
        if (last) {
          ray.segments.slice(0, before).forEach(seg)
          const a = P(last.to.dNm, last.to.hNm)
          const b = P(D, aNm)
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
        }
      } else if (rx.mode === 'direct') {
        // Direct wave: bends very slightly in the lower atmosphere, like VHF (4/3 Earth).
        for (let k = 0; k <= 40; k++) {
          const s = (D * k) / 40
          const h = rayHeightFt(s, D, HF_STATION_ANTENNA_FT, CRUISE_FT) / FT_PER_NM
          const p = P(s, h)
          if (k === 0) ctx.moveTo(p.x, p.y)
          else ctx.lineTo(p.x, p.y)
        }
      }
      ctx.stroke()
      ctx.restore()

      // Earth, then the coverage band just under the surface.
      fillEarth(ctx, proj, () => 0, t['sim-water'], info.height, t['sim-grid-strong'])
      for (const b of e.coverage()) {
        const st = bandStyle(b.kind, t)
        if (!st.fill && !st.hatch) continue
        ctx.save()
        ctx.beginPath()
        curvePath(ctx, proj, b.fromNm, b.toNm, () => 0, 24)
        curvePath(ctx, proj, b.toNm, b.fromNm, () => -bandNm, 24, false)
        ctx.closePath()
        if (st.fill) {
          ctx.fillStyle = st.fill
          ctx.fill()
        }
        if (st.hatch) {
          ctx.clip()
          ctx.strokeStyle = st.hatch
          ctx.lineWidth = 1.2
          const x0 = P(b.fromNm, 0).x
          const x1 = P(b.toNm, 0).x
          for (let x = x0 - 20; x < x1 + 20; x += 6) {
            ctx.beginPath()
            ctx.moveTo(x, info.height)
            ctx.lineTo(x + info.height * 0.6, 0)
            ctx.stroke()
          }
        }
        ctx.restore()
        const w = P(b.toNm, 0).x - P(b.fromNm, 0).x
        const label = BAND_LABEL[b.kind]
        ctx.font = `600 10px ${t.fontSans}`
        if (label && w > ctx.measureText(label).width + 8) {
          const mid = b.fromNm + (b.toNm - b.fromNm) * (b.kind === 'skip' ? 0.62 : 0.5)
          const p = P(mid, -bandNm * 2.6)
          haloText(ctx, label, p.x, p.y + 12, t, { align: 'center', font: `600 10px ${t.fontSans}`, color: b.kind === 'skip' ? t['sim-warning'] : t['sim-ink'] })
        }
      }
      drawDistanceTicks(ctx, proj, t, { step: info.width < 560 ? 1000 : 500, unit: 'NM', surface: () => -bandNm * 1.2, format: (d) => `${d.toLocaleString('en-US')} NM`, from: 500 })

      // Layer names on top of everything else.
      for (const draw of labels) draw()

      // Station and aircraft.
      const st = P(0, 0)
      drawStation(ctx, { x: st.x, y: st.y - 8 }, 'tower', t)
      haloText(ctx, 'HF station', st.x + 6, st.y - 22, t, { font: `600 10px ${t.fontSans}` })
      const pin = (d: number, label: string[], selected: boolean) => {
        const p = P(d, aNm)
        ctx.save()
        ctx.fillStyle = selected ? t['primary'] : t['sim-muted']
        ctx.beginPath()
        ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = selected ? t['primary'] : t['sim-muted']
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(p.x, p.y)
        ctx.lineTo(p.x, p.y - 20)
        ctx.stroke()
        ctx.restore()
        drawAircraftIcon(ctx, { x: p.x, y: p.y - 28 }, 90, t, { style: selected ? 'selected' : 'dim', size: selected ? 9 : 7, label })
      }
      for (const o of Object.values(OTHER_AIRCRAFT)) pin(o.distanceNm, [o.id], false)
      pin(D, ['CNS101 (you)', rx.mode ? 'hears the station' : 'hears nothing'], true)
    },
    [engine],
  )

  const rx = engine.reception()
  const label = `Side view of the curved Earth and the ionosphere at ${formatHour(params.hour)} local time, on ${engine.freqMHz} megahertz. ${engine.rays().filter((r) => r.fate === 'reflected').length} of ${engine.rays().length} rays come back down, ${engine.rays().filter((r) => r.fate === 'absorbed').length} are absorbed and ${engine.rays().filter((r) => r.fate === 'escaped').length} escape into space. CNS101, ${params.distanceNm} nautical miles away, ${rx.mode ? 'hears the ground station' : REASON_TEXT[rx.reason ?? 'gap']}.`

  return (
    <CurvedEarthView
      frame={FRAME}
      domain={() => ({ dMin: VIEW_MIN_NM, dMax: VIEW_MAX_NM, hMin: 0, hMax: kmToNm(VIEW_TOP_KM) })}
      padding={{ top: 40, right: 12, bottom: 30, left: 12 }}
      draw={draw}
      label={label}
      className="h-80 md:h-[26rem]"
      labels={
        <>
          <SimLabel icon="none">
            {engine.day ? <Sun className="size-3.5 text-primary" aria-hidden /> : <Moon className="size-3.5 text-primary" aria-hidden />}
            {formatHour(params.hour)} local, {engine.day ? 'day' : 'night'}
          </SimLabel>
          {params.timelapse && <SimLabel icon="gauge">Sped up: 1 hour every {Math.round(1 / TIMELAPSE_H_PER_S)} s</SimLabel>}
          {failures.flare && engine.day && <SimLabel icon="none">Solar flare</SimLabel>}
          <SimLabel icon="none">One ionosphere for the whole path</SimLabel>
        </>
      }
    />
  )
}

function arrowHead(ctx: CanvasRenderingContext2D, a: { x: number; y: number }, b: { x: number; y: number }, color: string) {
  const ang = Math.atan2(b.y - a.y, b.x - a.x)
  ctx.save()
  ctx.setLineDash([])
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(b.x, b.y)
  ctx.lineTo(b.x - 7 * Math.cos(ang - 0.4), b.y - 7 * Math.sin(ang - 0.4))
  ctx.lineTo(b.x - 7 * Math.cos(ang + 0.4), b.y - 7 * Math.sin(ang + 0.4))
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}
