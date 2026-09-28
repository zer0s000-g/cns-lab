import { useCallback } from 'react'
import { Canvas2D, type DrawFn } from '@/components/sim/Canvas2D'
import { toRad } from '@/core/geometry'
import { cardioidResponse, loopResponse } from '@/core/ndb'
import { useSampled } from '@/hooks/useSampled'
import { withAlpha } from '@/lib/color'
import { useNdb } from './state'

/**
 * Inside the ADF: the loop antenna's figure-of-eight and, with the sense
 * antenna, the heart-shaped pattern that has only one direction. Drawn in the
 * aircraft's frame (nose up), aligned with the needle.
 */
export function AntennaPattern() {
  const { engine } = useNdb()

  const draw: DrawFn = useCallback(
    (ctx, { width, height, tokens: t }) => {
      const ind = engine.last
      const sense = engine.env.sense
      ctx.fillStyle = t['sim-bg']
      ctx.fillRect(0, 0, width, height)
      const legendW = width >= 330 ? 128 : 0
      const cx = (width - legendW) / 2
      const cy = height / 2 + 4
      const R = Math.min(width - legendW, height) * 0.36
      // Grid.
      ctx.strokeStyle = t['sim-grid']
      ctx.lineWidth = 1
      for (const k of [0.5, 1]) {
        ctx.beginPath()
        ctx.arc(cx, cy, R * k, 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.beginPath()
      ctx.moveTo(cx - R, cy)
      ctx.lineTo(cx + R, cy)
      ctx.moveTo(cx, cy - R)
      ctx.lineTo(cx, cy + R)
      ctx.stroke()
      ctx.fillStyle = t['sim-muted']
      ctx.font = `600 10px ${t.fontSans}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      ctx.fillText('NOSE', cx, cy - R - 3)

      const at = (relDeg: number, r: number) => ({ x: cx + Math.sin(toRad(relDeg)) * r, y: cy - Math.cos(toRad(relDeg)) * r })
      if (ind.relative == null) {
        ctx.fillStyle = t['sim-muted']
        ctx.font = `500 12px ${t.fontSans}`
        ctx.textBaseline = 'middle'
        ctx.fillText('No signal', cx, cy + R * 0.6)
      } else {
        const axis = ind.relative
        // Sense antenna alone: the same in every direction.
        if (sense) {
          ctx.strokeStyle = t['sim-muted']
          ctx.setLineDash([1.5, 3])
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.arc(cx, cy, R * 0.5, 0, Math.PI * 2)
          ctx.stroke()
          ctx.setLineDash([])
        }
        // Loop alone: figure-of-eight.
        ctx.strokeStyle = t['sim-ink']
        ctx.lineWidth = 1.5
        ctx.setLineDash([5, 4])
        ctx.beginPath()
        for (let a = 0; a <= 360; a += 2) {
          const p = at(a, R * Math.abs(loopResponse(a, axis)))
          if (a === 0) ctx.moveTo(p.x, p.y)
          else ctx.lineTo(p.x, p.y)
        }
        ctx.stroke()
        ctx.setLineDash([])
        // Loop + sense: heart shape.
        if (sense) {
          ctx.beginPath()
          for (let a = 0; a <= 360; a += 2) {
            const p = at(a, R * cardioidResponse(a, axis))
            if (a === 0) ctx.moveTo(p.x, p.y)
            else ctx.lineTo(p.x, p.y)
          }
          ctx.closePath()
          ctx.fillStyle = withAlpha(t['sim-signal'], 0.2)
          ctx.fill()
          ctx.strokeStyle = t['sim-signal']
          ctx.lineWidth = 2
          ctx.stroke()
        }
        arrow(ctx, cx, cy, at(axis, R * 1.12), t['sim-signal'], false)
        if (!sense) {
          arrow(ctx, cx, cy, at(axis + 180, R * 1.12), t['sim-warning'], true)
          const q = at(axis + 180, R * 1.12)
          ctx.fillStyle = t['sim-warning']
          ctx.font = `600 11px ${t.fontSans}`
          ctx.textAlign = q.x < cx ? 'right' : 'left'
          ctx.textBaseline = 'middle'
          ctx.fillText('or here?', q.x + (q.x < cx ? -6 : 6), q.y)
        }
      }
      // Aircraft at the centre.
      ctx.fillStyle = t['sim-ink']
      ctx.beginPath()
      ctx.moveTo(cx, cy - 8)
      ctx.lineTo(cx + 6, cy + 6)
      ctx.lineTo(cx, cy + 3)
      ctx.lineTo(cx - 6, cy + 6)
      ctx.closePath()
      ctx.fill()

      // Legend (shape and dash, never colour alone).
      const lx = legendW ? width - legendW + 4 : 8
      let ly = legendW ? cy - 34 : height - 44
      const item = (draw: () => void, text: string) => {
        draw()
        ctx.fillStyle = t['sim-ink']
        ctx.font = `500 10px ${t.fontSans}`
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillText(text, lx + 24, ly)
        ly += 16
      }
      item(() => {
        ctx.strokeStyle = t['sim-ink']
        ctx.lineWidth = 1.5
        ctx.setLineDash([5, 4])
        ctx.beginPath()
        ctx.moveTo(lx, ly)
        ctx.lineTo(lx + 18, ly)
        ctx.stroke()
        ctx.setLineDash([])
      }, 'Loop: two-way')
      if (sense) {
        item(() => {
          ctx.strokeStyle = t['sim-muted']
          ctx.setLineDash([1.5, 3])
          ctx.beginPath()
          ctx.moveTo(lx, ly)
          ctx.lineTo(lx + 18, ly)
          ctx.stroke()
          ctx.setLineDash([])
        }, 'Sense: all round')
        item(() => {
          ctx.fillStyle = withAlpha(t['sim-signal'], 0.25)
          ctx.strokeStyle = t['sim-signal']
          ctx.lineWidth = 2
          ctx.fillRect(lx, ly - 5, 18, 10)
          ctx.strokeRect(lx, ly - 5, 18, 10)
        }, 'Both: one way')
      } else {
        item(() => {
          ctx.strokeStyle = t['sim-warning']
          ctx.setLineDash([4, 3])
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.moveTo(lx, ly)
          ctx.lineTo(lx + 18, ly)
          ctx.stroke()
          ctx.setLineDash([])
        }, 'Sense failed')
      }
    },
    [engine],
  )

  const label = useSampled(() => {
    const ind = engine.last
    if (ind.relative == null) return 'Antenna patterns: no signal.'
    return engine.env.sense
      ? `Antenna patterns: the loop alone hears the beacon equally from ${Math.round(ind.relative)} and ${Math.round((ind.relative + 180) % 360)} degrees; loop plus sense make a heart shape pointing ${Math.round(ind.relative)} degrees from the nose.`
      : `Sense antenna failed: the loop alone cannot tell whether the beacon is at ${Math.round(ind.relative)} or ${Math.round((ind.relative + 180) % 360)} degrees from the nose.`
  }, 500)

  return <Canvas2D draw={draw} label={label} className="h-52 w-full rounded-lg border" />
}

function arrow(ctx: CanvasRenderingContext2D, x0: number, y0: number, tip: { x: number; y: number }, color: string, dashed: boolean) {
  const ang = Math.atan2(tip.y - y0, tip.x - x0)
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 2.5
  ctx.setLineDash(dashed ? [4, 3] : [])
  ctx.beginPath()
  ctx.moveTo(x0, y0)
  ctx.lineTo(tip.x, tip.y)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.beginPath()
  ctx.moveTo(tip.x, tip.y)
  ctx.lineTo(tip.x - Math.cos(ang - 0.45) * 10, tip.y - Math.sin(ang - 0.45) * 10)
  ctx.lineTo(tip.x - Math.cos(ang + 0.45) * 10, tip.y - Math.sin(ang + 0.45) * 10)
  ctx.closePath()
  ctx.fill()
}
