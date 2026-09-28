import { useCallback, useMemo, useRef } from 'react'
import { Canvas2D, type DrawFn } from '@/components/sim/Canvas2D'
import { magneticToTrue, trueToMagnetic } from '@/core/geometry'
import { DVOR_RING, dvorModulationIndex, reflectionAmplitude, siteErrorEnvelopeDeg } from '@/core/vor'
import { useSampled } from '@/hooks/useSampled'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { withAlpha } from '@/lib/color'
import { BUILDING_BEARING_TRUE } from './engine'
import { useDvor, useDvorState } from './state'

const STEP = 0.5

/**
 * Course error around the station: for every radial, how far the building's
 * reflection can push the indication (the band), for CVOR and DVOR, plus the
 * errors the aircraft actually met (dots).
 */
export function ErrorChart() {
  const { engine } = useDvor()
  const env = useDvorState((s) => s.env)
  const freq = useDvorState((s) => s.freqMHz)
  const variation = useDvorState((s) => s.variationDeg)

  const bands = useMemo(() => {
    const a = reflectionAmplitude(env.buildingDistanceM)
    const m = dvorModulationIndex(DVOR_RING.radiusM, freq)
    const cvor: [number, number][] = []
    const dvor: [number, number][] = []
    for (let r = 0; r <= 360; r += STEP) {
      const th = magneticToTrue(r, variation)
      cvor.push(siteErrorEnvelopeDeg('cvor', th, BUILDING_BEARING_TRUE, a, m))
      dvor.push(siteErrorEnvelopeDeg('dvor', th, BUILDING_BEARING_TRUE, a, m))
    }
    const maxC = Math.max(...cvor.map(([lo, hi]) => Math.max(-lo, hi)))
    return { cvor, dvor, maxC }
  }, [env.buildingDistanceM, freq, variation])
  const bandsRef = useRef(bands)
  bandsRef.current = bands

  const draw: DrawFn = useCallback(
    (ctx, { width, height, tokens: t }) => {
      const e = engine
      const b = bandsRef.current
      ctx.fillStyle = t['sim-bg']
      ctx.fillRect(0, 0, width, height)
      const padL = 34
      const padR = 10
      const padT = 30
      const padB = 22
      const w = width - padL - padR
      const h = height - padT - padB
      const yMax = Math.max(2, Math.ceil(b.maxC + 0.5))
      const xOf = (r: number) => padL + (r / 360) * w
      const yOf = (err: number) => padT + h / 2 - (err / yMax) * (h / 2)

      // Grid.
      ctx.strokeStyle = t['sim-grid']
      ctx.lineWidth = 1
      ctx.fillStyle = t['sim-muted']
      ctx.font = `500 10px ${t.fontMono}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      for (let r = 0; r <= 360; r += 90) {
        ctx.beginPath()
        ctx.moveTo(xOf(r), padT)
        ctx.lineTo(xOf(r), padT + h)
        ctx.stroke()
        ctx.fillText(String(r).padStart(3, '0'), xOf(r), padT + h + 5)
      }
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      for (const v of [-yMax, 0, yMax]) {
        ctx.strokeStyle = v === 0 ? t['sim-grid-strong'] : t['sim-grid']
        ctx.beginPath()
        ctx.moveTo(padL, yOf(v))
        ctx.lineTo(padL + w, yOf(v))
        ctx.stroke()
        ctx.fillText(`${v > 0 ? '+' : ''}${v}°`, padL - 4, yOf(v))
      }

      if (!e.env.building) {
        ctx.fillStyle = t['sim-muted']
        ctx.font = `500 12px ${t.fontSans}`
        ctx.textAlign = 'center'
        ctx.fillText('No building near the station: no reflection error', padL + w / 2, padT + h / 2 - 14)
      } else {
        const band = (data: [number, number][], fill: string, stroke: string, dashed: boolean) => {
          ctx.beginPath()
          data.forEach(([, hi], i) => (i === 0 ? ctx.moveTo(xOf(i * STEP), yOf(hi)) : ctx.lineTo(xOf(i * STEP), yOf(hi))))
          for (let i = data.length - 1; i >= 0; i--) ctx.lineTo(xOf(i * STEP), yOf(data[i][0]))
          ctx.closePath()
          ctx.fillStyle = fill
          ctx.fill()
          ctx.strokeStyle = stroke
          ctx.lineWidth = 1.2
          ctx.setLineDash(dashed ? [4, 3] : [])
          ctx.stroke()
          ctx.setLineDash([])
        }
        band(b.cvor, withAlpha(t['sim-warning'], 0.14), t['sim-warning'], true)
        band(b.dvor, withAlpha(t['sim-signal'], 0.5), t['sim-signal'], false)
        // What the needle actually did as the aircraft flew.
        ctx.fillStyle = t['sim-ink']
        for (const s of e.errorTrail) ctx.fillRect(xOf(s.radial) - 1, yOf(s.error) - 1, 2, 2)
        // The building's direction (no error there).
        const br = trueToMagnetic(BUILDING_BEARING_TRUE, e.variationDeg)
        ctx.strokeStyle = t['sim-muted']
        ctx.setLineDash([2, 3])
        ctx.beginPath()
        ctx.moveTo(xOf(br), padT)
        ctx.lineTo(xOf(br), padT + h)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = t['sim-muted']
        ctx.font = `500 10px ${t.fontSans}`
        ctx.textAlign = 'left'
        ctx.textBaseline = 'bottom'
        ctx.fillText('building', xOf(br) + 3, padT + h - 2)
      }

      // The aircraft's current radial.
      const r = e.last
      if (r.received) {
        const cur = trueToMagnetic(r.bearingFromStationTrue, e.variationDeg)
        ctx.strokeStyle = t['primary']
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(xOf(cur), padT)
        ctx.lineTo(xOf(cur), padT + h)
        ctx.stroke()
        ctx.fillStyle = t['primary']
        ctx.beginPath()
        ctx.arc(xOf(cur), yOf(Math.max(-yMax, Math.min(yMax, r.siteErrorDeg))), 4, 0, Math.PI * 2)
        ctx.fill()
      }

      legend(ctx, t, padL, 8, e.env.type)
    },
    [engine],
  )

  const label = useSampled(() => {
    if (!engine.env.building) return 'Course error chart: no building, so no reflection error on any radial.'
    return `Course error around the station. With the building ${engine.env.buildingDistanceM} metres away, a conventional VOR can be off by up to ${bands.maxC.toFixed(1)} degrees; a Doppler VOR by much less. Now: ${engine.last.siteErrorDeg.toFixed(1)} degrees.`
  }, 800)

  return <Canvas2D draw={draw} label={label} className="h-56 w-full rounded-lg border" />
}

function legend(ctx: CanvasRenderingContext2D, t: ThemeTokens, x: number, y: number, type: string) {
  ctx.font = `500 10px ${t.fontSans}`
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  let cx = x
  const item = (drawKey: () => void, text: string) => {
    drawKey()
    ctx.fillStyle = t['sim-ink']
    ctx.fillText(text, cx + 20, y + 5)
    cx += 26 + ctx.measureText(text).width + 10
  }
  item(() => {
    ctx.fillStyle = withAlpha(t['sim-warning'], 0.14)
    ctx.strokeStyle = t['sim-warning']
    ctx.setLineDash([4, 3])
    ctx.fillRect(cx, y, 16, 10)
    ctx.strokeRect(cx, y, 16, 10)
    ctx.setLineDash([])
  }, 'CVOR')
  item(() => {
    ctx.fillStyle = withAlpha(t['sim-signal'], 0.5)
    ctx.fillRect(cx, y, 16, 10)
  }, 'DVOR')
  item(() => {
    ctx.fillStyle = t['sim-ink']
    ctx.fillRect(cx + 3, y + 4, 2, 2)
    ctx.fillRect(cx + 8, y + 3, 2, 2)
    ctx.fillRect(cx + 12, y + 6, 2, 2)
  }, `flown (${type.toUpperCase()})`)
}
