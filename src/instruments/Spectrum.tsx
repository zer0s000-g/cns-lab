import { useCallback, useRef } from 'react'
import { Canvas2D, type DrawFn } from '@/components/sim/Canvas2D'
import { useSampled } from '@/hooks/useSampled'
import { withAlpha } from '@/lib/color'
import { cn } from '@/lib/utils'

export interface SpectrumPeak {
  /** Centre frequency, in the display unit. */
  f: number
  /** Level, dB relative to the top of the screen scale. */
  db: number
  /** Occupied width, in the display unit (0 = a single spectral line). */
  width?: number
  label?: string
  /** Emphasis draws a highlighted peak (e.g. the wanted signal). */
  emphasis?: boolean
}

export interface SpectrumBand {
  from: number
  to: number
  label: string
  /** Draw hatched (for example a guard band or a busy channel). */
  hatched?: boolean
}

export interface SpectrumReading {
  minF: number
  maxF: number
  /** Unit label for the axis, e.g. "kHz" or "MHz". */
  unit: string
  topDb?: number
  floorDb?: number
  peaks: SpectrumPeak[]
  bands?: SpectrumBand[]
  /** Frequencies at which to print axis ticks. */
  ticks?: number[]
  /** Log-frequency axis (for spectrum-wide charts). */
  log?: boolean
  /** Unit of the level axis (default "dB"). */
  levelUnit?: string
}

/** Spectrum view: frequency across, strength up. */
export function Spectrum({ read, className, describe }: { read: () => SpectrumReading; className?: string; describe?: () => string }) {
  const readRef = useRef(read)
  readRef.current = read

  const draw: DrawFn = useCallback((ctx, { width, height, tokens: t }) => {
    const r = readRef.current()
    const top = r.topDb ?? 0
    const floor = r.floorDb ?? -60
    const padL = 36
    const padR = 10
    const padT = 20
    const padB = 26
    const w = width - padL - padR
    const h = height - padT - padB
    const toX = (f: number) =>
      r.log
        ? padL + ((Math.log10(f) - Math.log10(r.minF)) / (Math.log10(r.maxF) - Math.log10(r.minF))) * w
        : padL + ((f - r.minF) / (r.maxF - r.minF)) * w
    const toY = (db: number) => padT + ((top - Math.max(floor, Math.min(top, db))) / (top - floor)) * h

    ctx.fillStyle = t['scope-bg']
    ctx.fillRect(0, 0, width, height)

    // Grid.
    ctx.strokeStyle = t['scope-grid']
    ctx.lineWidth = 1
    ctx.font = `500 10px ${t.fontMono}`
    ctx.fillStyle = t['scope-dim']
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    for (let db = top; db >= floor; db -= 10) {
      const y = toY(db)
      ctx.beginPath()
      ctx.moveTo(padL, y)
      ctx.lineTo(padL + w, y)
      ctx.stroke()
      ctx.fillText(`${db}`, padL - 4, y)
    }

    // Bands.
    for (const b of r.bands ?? []) {
      const x0 = toX(b.from)
      const x1 = toX(b.to)
      ctx.fillStyle = withAlpha(t['scope-trace'], 0.1)
      ctx.fillRect(x0, padT, x1 - x0, h)
      if (b.hatched) {
        ctx.save()
        ctx.beginPath()
        ctx.rect(x0, padT, x1 - x0, h)
        ctx.clip()
        ctx.strokeStyle = withAlpha(t['scope-trace'], 0.25)
        for (let x = x0 - h; x < x1; x += 8) {
          ctx.beginPath()
          ctx.moveTo(x, padT + h)
          ctx.lineTo(x + h, padT)
          ctx.stroke()
        }
        ctx.restore()
      }
      ctx.strokeStyle = withAlpha(t['scope-trace'], 0.45)
      ctx.strokeRect(x0, padT, x1 - x0, h)
      ctx.fillStyle = t['scope-text']
      ctx.font = `600 10px ${t.fontSans}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText(b.label, (x0 + x1) / 2, padT + 3)
    }

    // Noise floor.
    ctx.strokeStyle = t['scope-clutter']
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let x = 0; x <= w; x += 2) {
      const y = toY(floor + 3 + Math.sin(x * 0.9) * 1.2 + Math.sin(x * 0.37) * 1.5)
      if (x === 0) ctx.moveTo(padL + x, y)
      else ctx.lineTo(padL + x, y)
    }
    ctx.stroke()

    // Peaks.
    for (const p of r.peaks) {
      const x = toX(p.f)
      const y = toY(p.db)
      ctx.strokeStyle = p.emphasis ? t['scope-trace'] : t['scope-trace-2']
      ctx.fillStyle = withAlpha(p.emphasis ? t['scope-trace'] : t['scope-trace-2'], 0.35)
      ctx.lineWidth = p.emphasis ? 2.5 : 1.8
      if (p.width && p.width > 0) {
        const xw = Math.max(3, toX(p.f + p.width / 2) - toX(p.f - p.width / 2))
        ctx.beginPath()
        ctx.moveTo(x - xw / 2, toY(floor))
        ctx.lineTo(x - xw / 2, y)
        ctx.lineTo(x + xw / 2, y)
        ctx.lineTo(x + xw / 2, toY(floor))
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
      } else {
        ctx.beginPath()
        ctx.moveTo(x, toY(floor))
        ctx.lineTo(x, y)
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(x, y, 2.5, 0, Math.PI * 2)
        ctx.fillStyle = ctx.strokeStyle
        ctx.fill()
      }
      if (p.label) {
        ctx.fillStyle = t['scope-text']
        ctx.font = `600 10px ${t.fontSans}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'bottom'
        ctx.fillText(p.label, x, y - 5)
      }
    }

    // Axis.
    ctx.fillStyle = t['scope-dim']
    ctx.font = `500 10px ${t.fontMono}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    const ticks = r.ticks ?? [r.minF, (r.minF + r.maxF) / 2, r.maxF]
    for (const f of ticks) ctx.fillText(`${f}`, toX(f), padT + h + 4)
    ctx.textAlign = 'right'
    ctx.fillText(r.unit, padL + w, padT + h + 14)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText(r.levelUnit ?? 'dB', 2, 3)
  }, [])

  const label = useSampled(() => (describe ? describe() : 'Spectrum view'), 1000)
  return <Canvas2D draw={draw} label={label} className={cn('h-44 w-full rounded-lg', className)} />
}
