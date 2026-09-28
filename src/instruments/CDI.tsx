import { useCallback, useRef } from 'react'
import { Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Canvas2D, type DrawFn } from '@/components/sim/Canvas2D'
import { normalize360, toRad } from '@/core/geometry'
import { clamp } from '@/core/units'
import { useSampled } from '@/hooks/useSampled'
import { withAlpha } from '@/lib/color'
import { cn } from '@/lib/utils'
import { damp, dampAngle, drawAircraftSymbol, drawCase, drawCompassCard, drawFlag, fmt3 } from './draw'

export interface CdiReading {
  /** Selected course (OBS), degrees magnetic. */
  courseDeg: number
  /**
   * Lateral deviation as a fraction of full-scale deflection.
   * +1 = needle fully RIGHT (the course is to the right: fly right). Values beyond ±1 peg the needle.
   */
  lateral: number
  /** Ambiguity indicator. OFF shows the warning flag and parks the needle. */
  toFrom: 'TO' | 'FROM' | 'OFF'
  /** Aircraft heading, degrees magnetic (HSI only). */
  headingDeg?: number
  /**
   * Glideslope: vertical deviation as a fraction of full scale.
   * +1 = needle fully UP (the glide path is above: fly up).
   */
  glideslope?: { vertical: number; valid: boolean }
  /** Hide the TO/FROM flag (ILS localizers have no TO/FROM). */
  hideToFrom?: boolean
}

export interface CdiProps {
  read: () => CdiReading
  variant?: 'cdi' | 'hsi'
  /** When provided, the OBS knob and buttons are interactive. */
  onCourseChange?: (deg: number) => void
  size?: number
  /** Label printed on the face, e.g. "VOR" or "ILS". */
  title?: string
  className?: string
}

const DOTS = 5

/**
 * Course deviation indicator with OBS knob and TO/FROM flag. The HSI
 * variant adds a compass card that turns with the aircraft's heading.
 */
export function CDI({ read, variant = 'cdi', onCourseChange, size = 240, title, className }: CdiProps) {
  const disp = useRef({ lateral: 0, vertical: 0, course: read().courseDeg, heading: read().headingDeg ?? 0 })
  const readRef = useRef(read)
  readRef.current = read
  const drag = useRef<{ startAngle: number; startCourse: number } | null>(null)

  const draw: DrawFn = useCallback((ctx, { width, height, dt, tokens: t }) => {
    const r0 = readRef.current()
    const d = disp.current
    const offFlag = r0.toFrom === 'OFF'
    // Needle damping: a real movement takes a fraction of a second.
    d.lateral = damp(d.lateral, offFlag ? 0 : clamp(r0.lateral, -1.08, 1.08), dt, 0.12)
    const gsValid = r0.glideslope?.valid ?? false
    d.vertical = damp(d.vertical, gsValid ? clamp(r0.glideslope!.vertical, -1.08, 1.08) : 0, dt, 0.12)
    d.course = dampAngle(d.course, r0.courseDeg, dt, 0.05)
    d.heading = dampAngle(d.heading, r0.headingDeg ?? 0, dt, 0.08)

    const { cx, cy, R: dialR, s: caseS, x0, y0 } = drawCase(ctx, width, height, t)
    const R = dialR / 0.93
    const cardR = dialR * 0.96
    const hsi = variant === 'hsi'
    const cardRotation = hsi ? -d.heading : -d.course
    drawCompassCard(ctx, cx, cy, cardR, cardRotation, t, { cardinals: hsi })

    // Fixed index / lubber line at the top.
    ctx.fillStyle = t['instrument-accent']
    ctx.beginPath()
    ctx.moveTo(cx, cy - cardR - 2)
    ctx.lineTo(cx - 7, cy - cardR - 12)
    ctx.lineTo(cx + 7, cy - cardR - 12)
    ctx.closePath()
    ctx.fill()

    const dotGap = (R * 0.52) / DOTS
    ctx.save()
    ctx.translate(cx, cy)
    // In HSI mode the deviation bar and dots rotate with the course pointer.
    const pointerAngle = hsi ? toRad(normalize360(d.course - d.heading)) : 0
    ctx.rotate(pointerAngle)

    // Deviation dots.
    ctx.strokeStyle = t['instrument-marking']
    ctx.lineWidth = 1.5
    for (let i = -DOTS; i <= DOTS; i++) {
      if (i === 0) continue
      ctx.beginPath()
      ctx.arc(i * dotGap, 0, Math.max(2.5, R * 0.022), 0, Math.PI * 2)
      ctx.stroke()
    }

    if (hsi) {
      // Course pointer arrow (head toward the course, tail toward the reciprocal).
      const len = cardR * 0.78
      ctx.strokeStyle = t['instrument-accent']
      ctx.fillStyle = t['instrument-accent']
      ctx.lineWidth = 4
      ctx.beginPath()
      ctx.moveTo(0, -len)
      ctx.lineTo(0, -len * 0.45)
      ctx.moveTo(0, len * 0.45)
      ctx.lineTo(0, len)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(0, -len - 10)
      ctx.lineTo(-8, -len + 4)
      ctx.lineTo(8, -len + 4)
      ctx.closePath()
      ctx.fill()
    }

    // Deviation bar (needle).
    const nx = d.lateral * DOTS * dotGap
    const nlen = hsi ? cardR * 0.42 : R * 0.62
    ctx.strokeStyle = offFlag ? withAlpha(t['instrument-needle'], 0.35) : t['instrument-needle']
    ctx.lineWidth = hsi ? 4 : 3.5
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(nx, -nlen)
    ctx.lineTo(nx, nlen)
    ctx.stroke()

    // TO / FROM triangle.
    if (!r0.hideToFrom && !offFlag) {
      const up = r0.toFrom === 'TO'
      const tx = hsi ? 0 : dotGap * 2.6
      const ty = hsi ? (up ? -cardR * 0.3 : cardR * 0.3) : up ? -R * 0.34 : R * 0.34
      ctx.fillStyle = t['instrument-marking']
      ctx.beginPath()
      if (up) {
        ctx.moveTo(tx, ty - 9)
        ctx.lineTo(tx - 9, ty + 6)
        ctx.lineTo(tx + 9, ty + 6)
      } else {
        ctx.moveTo(tx, ty + 9)
        ctx.lineTo(tx - 9, ty - 6)
        ctx.lineTo(tx + 9, ty - 6)
      }
      ctx.closePath()
      ctx.fill()
      if (!hsi) {
        ctx.font = `700 ${Math.max(9, R * 0.085)}px ${t.fontSans}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(up ? 'TO' : 'FROM', tx, up ? ty + 16 : ty - 17)
      }
    }
    ctx.restore()

    // Aircraft symbol (HSI) or centre ring (CDI).
    if (hsi) drawAircraftSymbol(ctx, cx, cy, R * 0.16, t['instrument-dim'])
    else {
      ctx.strokeStyle = t['instrument-marking']
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(cx, cy, Math.max(5, R * 0.05), 0, Math.PI * 2)
      ctx.stroke()
    }

    // Glideslope scale and needle on the right side.
    if (r0.glideslope) {
      const gx = cx + R * 0.66
      ctx.strokeStyle = t['instrument-marking']
      ctx.lineWidth = 1.5
      for (let i = -2; i <= 2; i++) {
        if (i === 0) continue
        ctx.beginPath()
        ctx.arc(gx, cy + i * (dotGap * 2.2), Math.max(2.5, R * 0.022), 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.beginPath()
      ctx.moveTo(gx - 6, cy)
      ctx.lineTo(gx + 6, cy)
      ctx.stroke()
      if (gsValid) {
        // +vertical = glide path above → needle up.
        const gy = cy - d.vertical * 2 * dotGap * 2.2
        ctx.strokeStyle = t['instrument-needle']
        ctx.lineWidth = 3.5
        ctx.beginPath()
        ctx.moveTo(cx - R * 0.55, gy)
        ctx.lineTo(cx + R * 0.55, gy)
        ctx.stroke()
      } else {
        drawFlag(ctx, gx - R * 0.14, cy - R * 0.36, R * 0.28, R * 0.14, 'GS', t)
      }
    }

    // Warning flag.
    if (offFlag) drawFlag(ctx, cx - R * 0.62, cy - R * 0.2, R * 0.34, R * 0.15, 'NAV', t)

    // Corner labels: title top-left, course top-right, heading bottom-right (HSI).
    const pad = caseS * 0.035
    const fs = Math.max(9, caseS * 0.045)
    ctx.textBaseline = 'top'
    if (title) {
      ctx.fillStyle = t['instrument-dim']
      ctx.font = `700 ${fs}px ${t.fontSans}`
      ctx.textAlign = 'left'
      ctx.fillText(title, x0 + pad, y0 + pad)
    }
    ctx.fillStyle = t['instrument-marking']
    ctx.font = `600 ${fs}px ${t.fontMono}`
    ctx.textAlign = 'right'
    ctx.fillText(`CRS ${fmt3(r0.courseDeg)}`, x0 + caseS - pad, y0 + pad)
    if (hsi) {
      ctx.textBaseline = 'bottom'
      ctx.fillText(`HDG ${fmt3(r0.headingDeg ?? 0)}`, x0 + caseS - pad, y0 + caseS - pad)
    }
    // OBS knob in the bottom-left corner of the case.
    if (onCourseChange) {
      const kr = caseS * 0.075
      const kx = x0 + pad + kr
      const ky = y0 + caseS - pad - kr
      ctx.fillStyle = t['instrument-face']
      ctx.strokeStyle = t['instrument-dim']
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(kx, ky, kr, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      // Knurling marks turn with the selected course.
      for (let k = 0; k < 12; k++) {
        const a = toRad(k * 30 + d.course)
        ctx.beginPath()
        ctx.moveTo(kx + Math.cos(a) * kr * 0.75, ky + Math.sin(a) * kr * 0.75)
        ctx.lineTo(kx + Math.cos(a) * kr, ky + Math.sin(a) * kr)
        ctx.stroke()
      }
      ctx.fillStyle = t['instrument-marking']
      ctx.font = `700 ${Math.max(8, caseS * 0.032)}px ${t.fontSans}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('OBS', kx, ky)
    }
  }, [variant, onCourseChange, title])

  const summary = useSampled(() => {
    const r = readRef.current()
    if (r.toFrom === 'OFF') return `${title ?? 'CDI'}: course ${fmt3(r.courseDeg)}, warning flag showing, no usable signal.`
    const dots = Math.round(Math.abs(clamp(r.lateral, -1, 1)) * DOTS * 10) / 10
    const side = r.lateral > 0.02 ? 'right' : r.lateral < -0.02 ? 'left' : 'centred'
    const gs = r.glideslope
      ? r.glideslope.valid
        ? `, glideslope needle ${r.glideslope.vertical > 0.02 ? 'up' : r.glideslope.vertical < -0.02 ? 'down' : 'centred'}`
        : ', glideslope flag showing'
      : ''
    return `${title ?? 'CDI'}: course ${fmt3(r.courseDeg)}, needle ${side === 'centred' ? 'centred' : `${dots} dots ${side}`}${r.hideToFrom ? '' : `, ${r.toFrom}`}${gs}.`
  }, 500)

  const change = (delta: number) => {
    if (!onCourseChange) return
    onCourseChange(normalize360(Math.round(readRef.current().courseDeg + delta)))
  }

  return (
    <div className={cn('flex flex-col items-center gap-2', className)}>
      <Canvas2D
        draw={draw}
        label={summary}
        focusable={Boolean(onCourseChange)}
        style={{ width: size, height: size, maxWidth: '100%' }}
        className="aspect-square"
        onCanvasKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
            change(e.shiftKey ? -10 : -1)
            e.preventDefault()
          } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
            change(e.shiftKey ? 10 : 1)
            e.preventDefault()
          }
        }}
        onCanvasPointerDown={(e) => {
          if (!onCourseChange) return
          const rect = e.currentTarget.getBoundingClientRect()
          const x = e.clientX - rect.left - rect.width / 2
          const y = e.clientY - rect.top - rect.height / 2
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { startAngle: Math.atan2(y, x), startCourse: readRef.current().courseDeg }
        }}
        onCanvasPointerMove={(e) => {
          if (!drag.current || !onCourseChange) return
          const rect = e.currentTarget.getBoundingClientRect()
          const x = e.clientX - rect.left - rect.width / 2
          const y = e.clientY - rect.top - rect.height / 2
          const a = Math.atan2(y, x)
          // Dragging the card clockwise lowers the course under the index, like turning a real OBS card.
          const deltaDeg = ((a - drag.current.startAngle) * 180) / Math.PI
          onCourseChange(normalize360(Math.round(drag.current.startCourse - deltaDeg)))
        }}
        onCanvasPointerUp={() => {
          drag.current = null
        }}
      />
      {onCourseChange && (
        <div className="flex items-center gap-2" role="group" aria-label="Course selector (OBS)">
          <Button variant="outline" size="icon-sm" onClick={() => change(-10)} aria-label="Course minus 10 degrees">
            <Minus aria-hidden />
            <span className="sr-only">10</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => change(-1)} aria-label="Course minus 1 degree">
            −1°
          </Button>
          <span className="w-16 text-center font-mono text-sm tabular-nums" aria-live="polite">
            OBS {fmt3(read().courseDeg)}
          </span>
          <Button variant="outline" size="sm" onClick={() => change(1)} aria-label="Course plus 1 degree">
            +1°
          </Button>
          <Button variant="outline" size="icon-sm" onClick={() => change(10)} aria-label="Course plus 10 degrees">
            <Plus aria-hidden />
          </Button>
        </div>
      )}
    </div>
  )
}
