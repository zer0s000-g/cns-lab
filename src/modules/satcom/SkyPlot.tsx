import { useCallback } from 'react'
import { Canvas2D, type DrawFn } from '@/components/sim/Canvas2D'
import { toRad } from '@/core/geometry'
import { airframeHorizonElevationDeg } from '@/core/satcom'
import { useSampled } from '@/hooks/useSampled'
import { withAlpha } from '@/lib/color'
import { GEO_SATS } from './engine'
import { useSatcom } from './state'

/**
 * The sky above the aircraft, nose at the top: centre = straight up, rim = horizon.
 * The shaded zone is the part of the sky the top-mounted antenna cannot see
 * because the aircraft is banked.
 */
export function SkyPlot({ className }: { className?: string }) {
  const { engine } = useSatcom()

  const draw: DrawFn = useCallback(
    (ctx, { width, height, tokens: t }) => {
      const e = engine
      ctx.fillStyle = t['scope-bg']
      ctx.fillRect(0, 0, width, height)
      const cx = width / 2
      const cy = height / 2 + 6
      const R = Math.max(0, Math.min(width, height) / 2 - 36)
      const rOf = (el: number) => ((90 - Math.max(0, el)) / 90) * R
      const xy = (relAz: number, el: number) => ({ x: cx + rOf(el) * Math.sin(toRad(relAz)), y: cy - rOf(el) * Math.cos(toRad(relAz)) })

      // Zone hidden by the airframe (only when banked).
      if (Math.abs(e.bankDeg) > 0.5) {
        ctx.beginPath()
        for (let a = 0; a <= 360; a += 3) {
          const p = xy(a, 0)
          if (a === 0) ctx.moveTo(p.x, p.y)
          else ctx.lineTo(p.x, p.y)
        }
        for (let a = 360; a >= 0; a -= 3) {
          const p = xy(a, Math.max(0, airframeHorizonElevationDeg(a, e.bankDeg)))
          ctx.lineTo(p.x, p.y)
        }
        ctx.closePath()
        ctx.fillStyle = withAlpha(t['scope-alert'], 0.22)
        ctx.fill('evenodd')
        // Hatch so the zone does not rely on colour.
        ctx.save()
        ctx.clip('evenodd')
        ctx.strokeStyle = withAlpha(t['scope-alert'], 0.5)
        ctx.lineWidth = 1
        for (let k = -2 * R; k < 2 * R; k += 8) {
          ctx.beginPath()
          ctx.moveTo(cx + k, cy - R)
          ctx.lineTo(cx + k + R, cy + R)
          ctx.stroke()
        }
        ctx.restore()
      }

      // Elevation rings: horizon, 30°, 60°, and the mask (dashed).
      ctx.strokeStyle = t['scope-grid-strong']
      ctx.lineWidth = 1
      for (const el of [0, 30, 60]) {
        ctx.beginPath()
        ctx.arc(cx, cy, rOf(el), 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.setLineDash([4, 4])
      ctx.strokeStyle = t['scope-warning']
      ctx.beginPath()
      ctx.arc(cx, cy, rOf(e.maskDeg), 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.strokeStyle = t['scope-grid']
      ctx.beginPath()
      ctx.moveTo(cx - R, cy)
      ctx.lineTo(cx + R, cy)
      ctx.moveTo(cx, cy - R)
      ctx.lineTo(cx, cy + R)
      ctx.stroke()

      ctx.font = `600 10px ${t.fontSans}`
      ctx.fillStyle = t['scope-dim']
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      ctx.fillText('Nose', cx, cy - R - 3)
      ctx.textBaseline = 'top'
      ctx.fillText('Tail', cx, cy + R + 3)
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'right'
      ctx.fillText('Left', cx - R - 3, cy)
      ctx.textAlign = 'left'
      ctx.fillText('Right', cx + R + 3, cy)
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.font = `500 9px ${t.fontMono}`
      ctx.fillText('60°', cx + 3, cy - rOf(60) + 6)
      ctx.fillText('30°', cx + 3, cy - rOf(30) + 6)

      // Aircraft seen from behind at the centre, tilted by the bank.
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(toRad(e.bankDeg))
      ctx.strokeStyle = t['scope-text']
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.moveTo(-18, 0)
      ctx.lineTo(18, 0)
      ctx.moveTo(0, 0)
      ctx.lineTo(0, -7)
      ctx.stroke()
      ctx.restore()

      // Satellites.
      const serving = e.link.sat ?? e.link.target
      for (let i = 0; i < e.looks.length; i++) {
        const l = e.looks[i]
        if (l.elevationDeg < 0) continue
        const p = xy(e.relativeAzimuthDeg(i), l.elevationDeg)
        const isServing = i === serving
        if (isServing) {
          ctx.strokeStyle = t['scope-trace']
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.arc(p.x, p.y, 9, 0, Math.PI * 2)
          ctx.stroke()
        }
        if (l.visible && !l.usable) {
          // Above the mask but hidden by the airframe: a cross.
          ctx.strokeStyle = t['scope-alert']
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.moveTo(p.x - 5, p.y - 5)
          ctx.lineTo(p.x + 5, p.y + 5)
          ctx.moveTo(p.x + 5, p.y - 5)
          ctx.lineTo(p.x - 5, p.y + 5)
          ctx.stroke()
        } else {
          ctx.beginPath()
          ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2)
          if (l.visible) {
            ctx.fillStyle = isServing ? t['scope-trace'] : t['scope-text']
            ctx.fill()
          } else {
            ctx.strokeStyle = t['scope-dim']
            ctx.lineWidth = 1.5
            ctx.stroke()
          }
        }
        if (isServing || e.constellation === 'geo') {
          ctx.font = `600 10px ${t.fontSans}`
          ctx.fillStyle = isServing ? t['scope-trace'] : t['scope-dim']
          ctx.textAlign = p.x > cx ? 'right' : 'left'
          ctx.textBaseline = 'bottom'
          const name = e.constellation === 'geo' ? GEO_SATS[i].id : e.leoSats[i].id
          ctx.fillText(name, p.x + (p.x > cx ? -8 : 8), p.y - 5)
        }
      }

      // Legend line.
      ctx.font = `500 10px ${t.fontSans}`
      ctx.fillStyle = t['scope-dim']
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText(`Bank ${Math.round(Math.abs(e.bankDeg))}°${e.bankDeg > 0.5 ? ' right' : e.bankDeg < -0.5 ? ' left' : ''}`, 8, 8)
      ctx.textAlign = 'right'
      ctx.fillStyle = t['scope-warning']
      ctx.fillText(`dashed ring: ${e.maskDeg}° mask`, width - 8, 8)
    },
    [engine],
  )

  const describe = useSampled(() => {
    const e = engine
    const n = e.looks.filter((l) => l.visible).length
    const blocked = e.looks.filter((l) => l.visible && !l.usable).length
    return `Sky above the aircraft, nose at the top. ${n} satellite${n === 1 ? '' : 's'} above the ${e.maskDeg} degree mask${blocked ? `, ${blocked} hidden by the aircraft's body` : ''}. Bank ${Math.round(e.bankDeg)} degrees.`
  }, 500)

  return <Canvas2D draw={draw} label={describe} className={className} />
}
