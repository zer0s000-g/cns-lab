import { useCallback, useRef } from 'react'
import { Canvas2D, type DrawFn } from '@/components/sim/Canvas2D'
import { useSampled } from '@/hooks/useSampled'
import type { TokenName } from '@/hooks/useThemeTokens'
import { withAlpha } from '@/lib/color'
import { cn } from '@/lib/utils'

export interface ScopeTrace {
  label: string
  /** Signal value at time t (s) within the window, roughly -1..1. */
  fn: (tS: number) => number
  /** Dashed traces are distinguishable without colour. */
  dashed?: boolean
  color?: TokenName
}

export interface ScopeMarker {
  /** Time within the window, s. */
  tS: number
  label: string
}

export interface OscilloscopeReading {
  /** Width of the time window shown, s. */
  windowS: number
  traces: ScopeTrace[]
  markers?: ScopeMarker[]
  /** Optional shaded interval, e.g. the phase difference between two peaks. */
  span?: { fromS: number; toS: number; label: string }
  /** Small text at the top left, e.g. "Triggered on REF". */
  note?: string
}

/** Dual-trace oscilloscope with a 10 × 8 graticule. */
export function Oscilloscope({
  read,
  className,
  describe,
  timeUnit = 'ms',
}: {
  read: () => OscilloscopeReading
  className?: string
  describe?: () => string
  timeUnit?: 'ms' | 'µs' | 's'
}) {
  const readRef = useRef(read)
  readRef.current = read

  const draw: DrawFn = useCallback((ctx, { width, height, tokens: t }) => {
    const r = readRef.current()
    const padL = 8
    const padR = 8
    const padT = 22
    const padB = 22
    const w = width - padL - padR
    const h = height - padT - padB
    ctx.fillStyle = t['scope-bg']
    ctx.fillRect(0, 0, width, height)

    // Graticule.
    ctx.strokeStyle = t['scope-grid']
    ctx.lineWidth = 1
    for (let i = 0; i <= 10; i++) {
      const x = padL + (w * i) / 10
      ctx.beginPath()
      ctx.moveTo(x, padT)
      ctx.lineTo(x, padT + h)
      ctx.stroke()
    }
    for (let j = 0; j <= 8; j++) {
      const y = padT + (h * j) / 8
      ctx.beginPath()
      ctx.moveTo(padL, y)
      ctx.lineTo(padL + w, y)
      ctx.stroke()
    }

    const n = r.traces.length
    const laneH = h / Math.max(1, n)
    const toX = (tS: number) => padL + (tS / r.windowS) * w

    if (r.span) {
      const x0 = toX(r.span.fromS)
      const x1 = toX(r.span.toS)
      ctx.fillStyle = withAlpha(t['scope-trace'], 0.12)
      ctx.fillRect(Math.min(x0, x1), padT, Math.abs(x1 - x0), h)
      ctx.fillStyle = t['scope-text']
      ctx.font = `600 11px ${t.fontSans}`
      ctx.textBaseline = 'bottom'
      placeText(ctx, r.span.label, (x0 + x1) / 2, padT + h - 4, padL, padL + w)
    }

    r.traces.forEach((tr, k) => {
      const mid = padT + laneH * (k + 0.5)
      const amp = laneH * 0.38
      ctx.strokeStyle = t[tr.color ?? (k === 0 ? 'scope-trace' : 'scope-trace-2')]
      ctx.lineWidth = 2
      ctx.setLineDash(tr.dashed ? [6, 4] : [])
      ctx.beginPath()
      const samples = Math.max(200, Math.round(w))
      for (let i = 0; i <= samples; i++) {
        const tS = (i / samples) * r.windowS
        const v = Math.max(-1.2, Math.min(1.2, tr.fn(tS)))
        const x = padL + (i / samples) * w
        const y = mid - v * amp
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = t['scope-text']
      ctx.font = `600 11px ${t.fontSans}`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText(`${tr.dashed ? '- - ' : '— '}${tr.label}`, padL + 4, padT + laneH * k + 3)
    })

    for (const m of r.markers ?? []) {
      const x = toX(m.tS)
      ctx.strokeStyle = t['scope-warning']
      ctx.lineWidth = 1
      ctx.setLineDash([3, 3])
      ctx.beginPath()
      ctx.moveTo(x, padT)
      ctx.lineTo(x, padT + h)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = t['scope-warning']
      ctx.font = `600 10px ${t.fontSans}`
      ctx.textBaseline = 'top'
      placeText(ctx, m.label, x, padT + h + 4, padL, padL + w)
    }

    // Time axis labels.
    ctx.fillStyle = t['scope-dim']
    ctx.font = `500 10px ${t.fontMono}`
    ctx.textBaseline = 'bottom'
    ctx.textAlign = 'left'
    ctx.fillText(r.note ?? '', padL, padT - 6)
    const scale = timeUnit === 'ms' ? 1000 : timeUnit === 'µs' ? 1e6 : 1
    ctx.textAlign = 'right'
    ctx.fillText(`${formatNum((r.windowS * scale) / 10)} ${timeUnit}/div`, padL + w, padT - 6)
  }, [timeUnit])

  const label = useSampled(() => (describe ? describe() : 'Oscilloscope'), 1000)
  return <Canvas2D draw={draw} label={label} className={cn('h-48 w-full rounded-lg', className)} />
}

/** Centred text that is shifted so it stays between `minX` and `maxX`. */
function placeText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, minX: number, maxX: number) {
  const w = ctx.measureText(text).width
  ctx.textAlign = 'left'
  ctx.fillText(text, Math.min(maxX - w, Math.max(minX, x - w / 2)), y)
}

function formatNum(v: number): string {
  if (v >= 100) return v.toFixed(0)
  if (v >= 10) return v.toFixed(1)
  return v.toPrecision(2)
}
