import { useCallback, useRef } from 'react'
import { Canvas2D, type DrawFn } from '@/components/sim/Canvas2D'
import { ControlSwitch } from '@/components/sim/Controls'
import { dmeDistanceFromTimingNm, dmeReplyDelayUs, dmeTiming, replyHistogram } from '@/core/dme'
import { rangeFromRoundTripNm } from '@/core/propagation'
import { useSampled } from '@/hooks/useSampled'
import { withAlpha } from '@/lib/color'
import { useDme, useDmeState } from './state'

const BIN_US = 6
const NICE_US = [300, 400, 600, 800, 1000, 1500, 2000, 2600]

/**
 * "Which answer is mine?" Every row is one question from CNS101; every dot an
 * answer heard after it. Only answers to our own jittered questions keep the
 * same delay, so they line up; the rest are scattered.
 */
export function ReplySorter() {
  const { engine } = useDme()
  const reveal = useDmeState((s) => s.revealOwn)
  const setReveal = useDmeState((s) => s.setRevealOwn)
  const range = useRef({ maxUs: 600 })

  const draw: DrawFn = useCallback(
    (ctx, { width, height, tokens: t }) => {
      const e = engine
      const rows = e.history
      const mode = e.env.mode
      const own = dmeTiming(e.ownSlantNm, mode).totalUs
      const tw = e.twinDelayUs
      const want = Math.max(own, e.gateUs ?? 0, tw ?? 0) * 1.3 + 40
      const r = range.current
      if (want > r.maxUs || want < r.maxUs * 0.4) r.maxUs = NICE_US.find((u) => u >= want) ?? 2600
      const maxUs = r.maxUs
      const padL = 12
      const padR = 12
      const w = width - padL - padR
      const xOf = (us: number) => padL + (us / maxUs) * w
      ctx.fillStyle = t['scope-bg']
      ctx.fillRect(0, 0, width, height)

      // Question times strip: shows the jitter.
      const stripY = 22
      ctx.fillStyle = t['scope-dim']
      ctx.font = `600 10px ${t.fontSans}`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'bottom'
      ctx.fillText(e.env.noJitter ? 'When CNS101 asks (last second): evenly spaced, no jitter' : 'When CNS101 asks (last second): randomly spaced (jitter)', padL, stripY - 4)
      ctx.strokeStyle = t['scope-grid']
      ctx.beginPath()
      ctx.moveTo(padL, stripY + 6)
      ctx.lineTo(padL + w, stripY + 6)
      ctx.stroke()
      const now = e.timeS
      ctx.strokeStyle = t['scope-trace']
      ctx.lineWidth = 1.5
      for (const q of rows) {
        const age = now - q.timeS
        if (age < 0 || age > 1) continue
        const x = padL + w - age * w
        ctx.beginPath()
        ctx.moveTo(x, stripY)
        ctx.lineTo(x, stripY + 12)
        ctx.stroke()
      }

      // Rows of answers (newest at the top).
      const topY = stripY + 30
      const histH = Math.max(50, Math.round(height * 0.26))
      const axisH = 30
      const rowsH = height - topY - histH - axisH - 8
      const rowH = rowsH / Math.max(rows.length, 40)
      ctx.fillStyle = t['scope-dim']
      ctx.fillText('Each row: one question. Each dot: an answer heard after it.', padL, topY - 4)
      // Gate.
      if (e.gateUs !== null && e.mode !== 'search') {
        const gx = xOf(e.gateUs)
        ctx.fillStyle = withAlpha(e.lockedOnTwin ? t['scope-warning'] : t['scope-trace'], 0.18)
        ctx.fillRect(gx - 6, topY, 12, rowsH + histH + 8)
      }
      for (let i = 0; i < rows.length; i++) {
        const q = rows[rows.length - 1 - i]
        const y = topY + i * rowH + rowH / 2
        for (const d of q.delaysUs) {
          if (d > maxUs) break
          const isOwn = reveal && q.ownUs !== null && Math.abs(d - q.ownUs) < 1e-6
          const isTwin = reveal && q.twinUs !== null && Math.abs(d - q.twinUs) < 1e-6
          ctx.fillStyle = isOwn ? t['scope-trace'] : isTwin ? t['scope-warning'] : t['scope-text']
          ctx.fillRect(xOf(d) - 1.5, y - Math.max(0.8, rowH * 0.35), isOwn || isTwin ? 3 : 2.5, Math.max(1.6, rowH * 0.7))
        }
      }
      if (rows.length === 0) {
        ctx.fillStyle = t['scope-dim']
        ctx.textAlign = 'center'
        ctx.fillText('Press Play to start asking.', padL + w / 2, topY + rowsH / 2)
        ctx.textAlign = 'left'
      }

      // Histogram of the same rows.
      const hy0 = topY + rowsH + 8
      // Bins are lined up with the DME's gate (when it has one) so its answers fall into one bin.
      const offset = e.gateUs !== null && e.mode !== 'search' ? (e.gateUs % BIN_US) - BIN_US / 2 : 0
      const bins = replyHistogram(rows.map((q) => q.delaysUs.map((d) => d - offset)), BIN_US, maxUs)
      const n = Math.max(1, rows.length)
      const bw = (BIN_US / maxUs) * w
      ctx.strokeStyle = t['scope-grid']
      ctx.beginPath()
      ctx.moveTo(padL, hy0 + histH)
      ctx.lineTo(padL + w, hy0 + histH)
      ctx.stroke()
      let best = 0
      let bestI = -1
      bins.forEach((c, i) => {
        if (c > best) {
          best = c
          bestI = i
        }
        const bh = Math.min(1, c / n) * (histH - 14)
        ctx.fillStyle = c / n > 0.5 ? t['scope-trace'] : t['scope-clutter']
        ctx.fillRect(xOf(i * BIN_US + offset), hy0 + histH - bh, Math.max(1, bw - 0.5), bh)
      })
      ctx.fillStyle = t['scope-dim']
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText('How many rows have an answer at each delay', padL, hy0)
      // Label the peak(s).
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      ctx.font = `600 11px ${t.fontSans}`
      if (best / n > 0.5 && bestI >= 0) {
        for (let i = 0; i < bins.length; i++) {
          if (bins[i] / n <= 0.5 || (i > 0 && bins[i - 1] >= bins[i])) continue
          const centre = (i + 0.5) * BIN_US + offset
          const isGate = e.gateUs !== null && e.mode !== 'search' && Math.abs(e.gateUs - centre) < BIN_US
          const us = isGate ? e.gateUs! : centre
          const x = Math.min(Math.max(xOf(us), padL + 80), padL + w - 80)
          const nm = dmeDistanceFromTimingNm(us, mode)
          const wrong = isGate && e.lockedOnTwin
          ctx.fillStyle = wrong ? t['scope-warning'] : t['scope-text']
          const bh = Math.min(1, bins[i] / n) * (histH - 14)
          ctx.fillText(`${us.toFixed(0)} µs → ${nm.toFixed(1)} NM${isGate ? (wrong ? ' (locked: wrong)' : ' (locked)') : ''}`, x, hy0 + histH - bh - 3)
        }
      }
      // Axis.
      ctx.font = `500 10px ${t.fontMono}`
      ctx.fillStyle = t['scope-dim']
      ctx.textBaseline = 'top'
      const step = maxUs <= 400 ? 50 : maxUs <= 1000 ? 100 : maxUs <= 1500 ? 250 : 500
      const delay = dmeReplyDelayUs(mode)
      for (let us = 0; us <= maxUs + 1e-6; us += step) {
        const x = xOf(us)
        ctx.textAlign = us === 0 ? 'left' : us >= maxUs - 1e-6 ? 'right' : 'center'
        ctx.fillText(`${us}`, x, hy0 + histH + 3)
        if (us >= delay && width > 520) {
          ctx.fillStyle = withAlpha(t['scope-dim'], 0.8)
          ctx.fillText(`${rangeFromRoundTripNm(us - delay).toFixed(0)} NM`, x, hy0 + histH + 15)
          ctx.fillStyle = t['scope-dim']
        }
      }
      if (width > 520) {
        ctx.textAlign = 'right'
        ctx.textBaseline = 'top'
        ctx.font = `600 10px ${t.fontSans}`
        ctx.fillText('delay after the question, µs', padL + w, hy0)
      } else {
        ctx.textAlign = 'right'
        ctx.textBaseline = 'top'
        ctx.fillText('µs after the question', padL + w, hy0 + histH + 15)
      }
    },
    [engine, reveal],
  )

  const label = useSampled(() => {
    const e = engine
    const r = e.reading()
    return `Answers heard after the last ${e.history.length} questions. ${e.mode === 'search' ? 'The DME is still searching for a delay where answers keep lining up.' : `Answers keep lining up at ${e.gateUs?.toFixed(0)} microseconds, so the DME reads ${r.distanceNm?.toFixed(1)} nautical miles${e.lockedOnTwin ? ', but those are another aircraft’s answers' : ''}.`} ${e.env.noJitter ? 'Jitter is off.' : 'Jitter is on.'}`
  }, 1000)

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Which answer is mine?</h3>
          <p className="text-xs text-muted-foreground">
            The station answers every aircraft on the same frequency. Only the answers to CNS101's own questions come back at the same delay every time.
          </p>
        </div>
        <div className="w-full sm:w-64">
          <ControlSwitch label="Colour CNS101's real answers" checked={reveal} onChange={setReveal} hint="The DME itself cannot see colours" />
        </div>
      </div>
      <Canvas2D draw={draw} label={label} className="h-80 w-full rounded-md border" />
    </div>
  )
}
