import { useCallback, useRef } from 'react'
import { Canvas2D, type DrawFn } from '@/components/sim/Canvas2D'
import { normalize360, toRad } from '@/core/geometry'
import { useSampled } from '@/hooks/useSampled'
import { cn } from '@/lib/utils'
import { dampAngle, drawAircraftSymbol, drawCase, drawCompassCard, drawFlag, fmt3 } from './draw'

export interface AdfReading {
  /** Aircraft magnetic heading (used by the RMI card). */
  headingDeg: number
  /** Relative bearing of the station from the nose, or null when there is no usable signal. */
  relativeBearingDeg: number | null
  /** Optional second needle (for example a VOR on an RMI), relative bearing. */
  secondRelativeBearingDeg?: number | null
}

export interface AdfProps {
  read: () => AdfReading
  /** 'adf' = fixed card with 0 at the nose; 'rmi' = card turns with heading. */
  mode?: 'adf' | 'rmi'
  size?: number
  className?: string
  /** Needle damping time constant, s. A real ADF needle takes a moment to swing. */
  dampingS?: number
}

/**
 * ADF (fixed card: needle shows relative bearing) and RMI (card turns with the
 * heading: the needle head reads the magnetic bearing TO the station, the tail
 * the bearing FROM it).
 */
export function ADF({ read, mode = 'adf', size = 240, className, dampingS = 0.35 }: AdfProps) {
  const readRef = useRef(read)
  readRef.current = read
  const init = read()
  const disp = useRef({ needle: init.relativeBearingDeg ?? 90, needle2: init.secondRelativeBearingDeg ?? 0, heading: init.headingDeg })

  const draw: DrawFn = useCallback((ctx, { width, height, dt, tokens: t }) => {
    const r = readRef.current()
    const d = disp.current
    // With no signal a real ADF needle parks; we park it at 090.
    d.needle = dampAngle(d.needle, r.relativeBearingDeg ?? 90, dt, dampingS)
    if (r.secondRelativeBearingDeg != null) d.needle2 = dampAngle(d.needle2, r.secondRelativeBearingDeg, dt, dampingS)
    d.heading = dampAngle(d.heading, r.headingDeg, dt, 0.08)

    const { cx, cy, R: dialR, s: caseS, x0, y0 } = drawCase(ctx, width, height, t)
    const R = dialR / 0.93
    const cardR = dialR * 0.96
    const rotation = mode === 'rmi' ? -d.heading : 0
    drawCompassCard(ctx, cx, cy, cardR, rotation, t, { cardinals: mode === 'rmi' })

    // Lubber line (the nose) at the top.
    ctx.fillStyle = t['instrument-accent']
    ctx.beginPath()
    ctx.moveTo(cx, cy - cardR - 2)
    ctx.lineTo(cx - 7, cy - cardR - 12)
    ctx.lineTo(cx + 7, cy - cardR - 12)
    ctx.closePath()
    ctx.fill()

    drawAircraftSymbol(ctx, cx, cy, R * 0.18, t['instrument-dim'])

    // Second needle (thin, double line) first so the main needle is on top.
    if (r.secondRelativeBearingDeg != null) {
      drawNeedle(ctx, cx, cy, cardR * 0.8, d.needle2, t['instrument-dim'], 2.5, true)
    }
    drawNeedle(ctx, cx, cy, cardR * 0.8, d.needle, t['instrument-needle'], 4.5, false)

    if (r.relativeBearingDeg == null) drawFlag(ctx, cx - R * 0.3, cy + R * 0.28, R * 0.6, R * 0.15, 'NO SIGNAL', t)

    const pad = caseS * 0.035
    const fs = Math.max(9, caseS * 0.045)
    ctx.fillStyle = t['instrument-dim']
    ctx.font = `700 ${fs}px ${t.fontSans}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText(mode === 'rmi' ? 'RMI' : 'ADF', x0 + pad, y0 + pad)
    if (mode === 'rmi') {
      ctx.fillStyle = t['instrument-marking']
      ctx.font = `600 ${fs}px ${t.fontMono}`
      ctx.textAlign = 'right'
      ctx.fillText(`HDG ${fmt3(r.headingDeg)}`, x0 + caseS - pad, y0 + pad)
    }
  }, [mode, dampingS])

  const summary = useSampled(() => {
    const r = readRef.current()
    if (r.relativeBearingDeg == null) return `${mode.toUpperCase()}: no signal, needle parked.`
    if (mode === 'rmi') {
      return `RMI: heading ${fmt3(r.headingDeg)}, needle points to ${fmt3(normalize360(r.headingDeg + r.relativeBearingDeg))} magnetic.`
    }
    return `ADF: needle points ${fmt3(r.relativeBearingDeg)} degrees right of the nose.`
  }, 500)

  return (
    <Canvas2D
      draw={draw}
      label={summary}
      style={{ width: size, height: size, maxWidth: '100%' }}
      className={cn('aspect-square', className)}
    />
  )
}

function drawNeedle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  len: number,
  relDeg: number,
  color: string,
  width: number,
  double: boolean,
) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(toRad(relDeg))
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineCap = 'round'
  ctx.lineWidth = width
  if (double) {
    for (const off of [-3, 3]) {
      ctx.beginPath()
      ctx.moveTo(off, len * 0.75)
      ctx.lineTo(off, -len * 0.75)
      ctx.stroke()
    }
  } else {
    ctx.beginPath()
    ctx.moveTo(0, len * 0.85)
    ctx.lineTo(0, -len * 0.75)
    ctx.stroke()
  }
  // Arrow head (points to the station).
  ctx.beginPath()
  ctx.moveTo(0, -len)
  ctx.lineTo(-width * 2.2, -len * 0.72)
  ctx.lineTo(width * 2.2, -len * 0.72)
  ctx.closePath()
  ctx.fill()
  // Tail feather.
  ctx.lineWidth = Math.max(1.5, width * 0.5)
  ctx.beginPath()
  ctx.moveTo(-width * 1.6, len * 0.85)
  ctx.lineTo(0, len * 0.72)
  ctx.lineTo(width * 1.6, len * 0.85)
  ctx.stroke()
  ctx.restore()
}
