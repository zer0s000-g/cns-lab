import { useCallback } from 'react'
import { Canvas2D, type DrawFn } from '@/components/sim/Canvas2D'
import { useSampled } from '@/hooks/useSampled'
import { withAlpha } from '@/lib/color'
import { overlapS } from '@/core/vhf'
import type { Transmission, Who } from './engine'
import { OUTCOME_TEXT, WHO_LABEL } from './labels'
import { useVhf, useVhfState } from './state'

const WINDOW_S = 36
const FUTURE_S = 5

/** Who is transmitting, over the last half minute. Overlaps on one frequency are marked "blocked". */
export function RadioTimeline() {
  const { engine } = useVhf()
  const failures = useVhfState((s) => s.failures)

  const draw: DrawFn = useCallback(
    (ctx, { width, height, tokens: t }) => {
      const e = engine
      const rows: Who[] = ['controller', 'CNS101', 'CNS202']
      if (e.failures.stuckMic || e.transmissions.some((x) => x.who === 'CNS303')) rows.push('CNS303')
      if (e.failures.interference) rows.push('CNS707')
      const padL = width < 480 ? 74 : 96
      const padR = 10
      const top = 18
      const rowH = Math.min(30, (height - top - 18) / rows.length)
      const now = e.timeS
      const t0 = now - WINDOW_S
      const t1 = now + FUTURE_S
      const xOf = (s: number) => padL + ((s - t0) / (t1 - t0)) * (width - padL - padR)
      ctx.fillStyle = t['sim-bg']
      ctx.fillRect(0, 0, width, height)

      // Grid: one line every 5 s, labelled in seconds before now.
      ctx.font = `500 10px ${t.fontMono}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      const every = width < 520 ? 10 : 5
      for (let k = 0; k <= WINDOW_S; k += every) {
        const x = xOf(now - k)
        ctx.strokeStyle = t['sim-grid']
        ctx.beginPath()
        ctx.moveTo(x, top)
        ctx.lineTo(x, top + rows.length * rowH)
        ctx.stroke()
        ctx.fillStyle = t['sim-muted']
        if (k > 0) ctx.fillText(`−${k} s`, x, top + rows.length * rowH + 3)
      }

      // Overlaps on a shared frequency: two carriers at once.
      const radiated = e.transmissions.filter((x) => x.radiated && (x.end ?? now) > t0)
      for (let i = 0; i < radiated.length; i++) {
        for (let j = i + 1; j < radiated.length; j++) {
          const a = radiated[i]
          const b = radiated[j]
          if (!a.freqs.some((f) => f !== 'adjacent' && b.freqs.includes(f))) continue
          const span = { start: Math.max(a.start, b.start), end: Math.min(a.end ?? now, b.end ?? now) }
          if (overlapS({ start: a.start, end: a.end ?? now }, { start: b.start, end: b.end ?? now }) <= 0) continue
          const x0 = xOf(Math.max(span.start, t0))
          const x1 = xOf(span.end)
          ctx.fillStyle = withAlpha(t['sim-alert'], 0.12)
          ctx.fillRect(x0, top - 4, x1 - x0, rows.length * rowH + 4)
          ctx.save()
          ctx.beginPath()
          ctx.rect(x0, top - 4, x1 - x0, rows.length * rowH + 4)
          ctx.clip()
          ctx.strokeStyle = withAlpha(t['sim-alert'], 0.35)
          for (let x = x0 - 60; x < x1; x += 6) {
            ctx.beginPath()
            ctx.moveTo(x, top + rows.length * rowH)
            ctx.lineTo(x + 30, top - 4)
            ctx.stroke()
          }
          ctx.restore()
          if (x1 - x0 > 30) {
            ctx.fillStyle = t['sim-alert']
            ctx.font = `700 10px ${t.fontSans}`
            ctx.textAlign = 'center'
            ctx.textBaseline = 'bottom'
            ctx.fillText('two at once', (x0 + x1) / 2, top - 5)
          }
        }
      }

      // Rows.
      rows.forEach((who, r) => {
        const y = top + r * rowH
        ctx.fillStyle = t['sim-ink']
        ctx.font = `${who === 'CNS101' ? 700 : 600} 11px ${t.fontSans}`
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillText(WHO_LABEL[who], 6, y + rowH / 2)
        ctx.strokeStyle = t['sim-grid']
        ctx.beginPath()
        ctx.moveTo(padL, y + rowH)
        ctx.lineTo(width - padR, y + rowH)
        ctx.stroke()
        for (const tx of e.transmissions) {
          if (tx.who !== who) continue
          const end = tx.end ?? now
          if (end < t0) continue
          drawBar(ctx, tx, xOf(Math.max(tx.start, t0)), xOf(Math.min(end, t1)), y + 4, rowH - 8, t, e.transmissions)
        }
      })

      // Countdown for the Try-this collision.
      if (e.countdownTo !== null && e.countdownTo > now - 0.5) {
        const r = rows.indexOf('CNS202')
        const x = xOf(e.countdownTo)
        ctx.strokeStyle = t['sim-warning']
        ctx.setLineDash([3, 3])
        ctx.beginPath()
        ctx.moveTo(x, top + r * rowH)
        ctx.lineTo(x, top + (r + 1) * rowH)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = t['sim-warning']
        ctx.font = `700 10px ${t.fontSans}`
        ctx.textAlign = 'right'
        ctx.textBaseline = 'middle'
        const left = Math.max(0, e.countdownTo - now)
        ctx.fillText(left > 0 ? `starts in ${left.toFixed(1)} s` : 'waiting', x - 4, top + r * rowH + rowH / 2)
      }

      // "Now" line.
      const xn = xOf(now)
      ctx.strokeStyle = t['sim-ink']
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(xn, top - 6)
      ctx.lineTo(xn, top + rows.length * rowH)
      ctx.stroke()
      ctx.lineWidth = 1
      ctx.fillStyle = t['sim-ink']
      ctx.font = `600 10px ${t.fontSans}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText('now', xn, top + rows.length * rowH + 3)
    },
    [engine],
  )

  const describe = useSampled(() => {
    const now = engine.timeS
    const on = engine.transmissions.filter((x) => x.start <= now && (x.end === null || x.end > now))
    if (!on.length) return 'Radio timeline: nobody is transmitting right now.'
    return `Radio timeline: transmitting now: ${on.map((x) => `${WHO_LABEL[x.who]}${x.radiated ? '' : ' (transmitter failed, nothing on the air)'}`).join(', ')}.${on.filter((x) => x.radiated && x.freqs.includes('main')).length > 1 ? ' Two carriers on one frequency at once: blocked.' : ''}`
  }, 500)

  const rowCount = 3 + (failures.stuckMic ? 1 : 0) + (failures.interference ? 1 : 0)
  return <Canvas2D draw={draw} label={describe} className="w-full rounded-md border" style={{ height: 44 + rowCount * 30 }} />
}

function drawBar(
  ctx: CanvasRenderingContext2D,
  tx: Transmission,
  x0: number,
  x1: number,
  y: number,
  h: number,
  t: Parameters<DrawFn>[1]['tokens'],
  all: Transmission[],
) {
  const w = Math.max(2, x1 - x0)
  const base = tx.who === 'controller' ? t['sim-signal'] : tx.who === 'CNS101' ? t['primary'] : t['sim-signal-2']
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(x0, y, w, h, 3)
  if (!tx.radiated) {
    ctx.setLineDash([3, 3])
    ctx.strokeStyle = t['sim-muted']
    ctx.stroke()
    ctx.setLineDash([])
  } else {
    ctx.fillStyle = withAlpha(base, tx.kind === 'open-mic' ? 0.35 : 0.8)
    ctx.fill()
    if (tx.kind === 'open-mic' || tx.freqs.includes('adjacent')) {
      ctx.clip()
      ctx.strokeStyle = withAlpha(t['sim-ink'], 0.35)
      for (let x = x0 - h; x < x0 + w; x += 6) {
        ctx.beginPath()
        ctx.moveTo(x, y + h)
        ctx.lineTo(x + h, y)
        ctx.stroke()
      }
    }
  }
  ctx.restore()
  // Text inside the bar when there is room.
  const f = tx.freqs.filter((x) => x !== 'main')
  const tag = !tx.radiated ? 'not on the air' : tx.kind === 'open-mic' ? 'stuck microphone' : f.includes('adjacent') ? 'next channel' : f.length ? f.map((x) => (x === 'guard' ? '121.5' : '124.350')).join(' + ') : ''
  const outcome = tx.kind === 'open-mic' || tx.who === 'CNS707' ? undefined : tx.who === 'controller' ? tx.outcome.CNS101 : tx.outcome.ground
  const who = tx.who === 'controller' ? 'you' : 'controller'
  const parts = [tag, outcome ? `${who}: ${OUTCOME_TEXT[outcome]}` : ''].filter(Boolean)
  const text = parts.join(' · ')
  if (!text) return
  ctx.save()
  ctx.font = `600 10px ${t.fontSans}`
  ctx.textBaseline = 'middle'
  const tw = ctx.measureText(text).width
  if (tw + 8 < w) {
    ctx.fillStyle = tx.radiated && tx.kind !== 'open-mic' ? t['primary-foreground'] : t['sim-ink']
    ctx.textAlign = 'left'
    ctx.fillText(text, x0 + 4, y + h / 2)
  } else if (tx.end !== null && outcome) {
    // Put the result just after a finished bar, if nothing else is there.
    const clear = !all.some((o) => o !== tx && o.who === tx.who && o.start > (tx.end ?? 0) && o.start < (tx.end ?? 0) + 6)
    if (clear) {
      ctx.fillStyle = outcome === 'blocked' || outcome === 'garbled' ? t['sim-alert'] : t['sim-muted']
      ctx.textAlign = 'left'
      ctx.fillText(OUTCOME_TEXT[outcome], x1 + 3, y + h / 2)
    }
  }
  ctx.restore()
}
