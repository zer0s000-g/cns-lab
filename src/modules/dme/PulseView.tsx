import { useCallback, useEffect, useRef } from 'react'
import { Play, RotateCcw, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Canvas2D, type DrawFn } from '@/components/sim/Canvas2D'
import { SimLabel } from '@/components/sim/Controls'
import { slowMotionFor, slowMotionLabel } from '@/core/clock'
import { dmeDistanceFromTimingNm } from '@/core/dme'
import { LIGHT_NM_PER_US, ROUND_TRIP_US_PER_NM } from '@/core/units'
import { useSampled } from '@/hooks/useSampled'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { withAlpha } from '@/lib/color'
import { buildReplay, PULSE_US, REPLAY_REAL_S, type DmeReplay } from './replay'
import { useDme, useDmeState } from './state'

const fmtUs = (us: number) => us.toFixed(1)

export function PulseView({ replayRef }: { replayRef: React.RefObject<DmeReplay | null> }) {
  const { engine, clock } = useDme()
  const replay = useDmeState((s) => s.replay)
  const setReplay = useDmeState((s) => s.setReplay)

  const ask = () => {
    // A second question during a replay keeps the original "was it running?" answer.
    const wasRunning = replay.phase === 'replay' ? replay.resume !== false : clock.getState().running
    clock.getState().pause()
    const rec = engine.interrogateNow()
    replayRef.current = buildReplay(engine, rec)
    setReplay({ phase: 'replay', resume: wasRunning })
  }
  const again = () => {
    if (replayRef.current) replayRef.current.tUs = 0
  }
  // "Try this" can ask for a replay: fire one and bring this view into sight.
  const request = useDmeState((s) => s.replayRequest)
  const boxRef = useRef<HTMLDivElement>(null)
  const askRef = useRef(ask)
  askRef.current = ask
  useEffect(() => {
    if (request === 0) return
    askRef.current()
    const id = window.setTimeout(() => boxRef.current?.scrollIntoView({ block: 'center' }), 450)
    return () => window.clearTimeout(id)
  }, [request])
  const back = () => {
    replayRef.current = null
    if (replay.resume !== false) clock.getState().play()
    setReplay({ phase: 'idle' })
  }

  const draw: DrawFn = useCallback(
    (ctx, { width, height, tokens: t }) => {
      const rp = replayRef.current
      ctx.fillStyle = t['sim-bg']
      ctx.fillRect(0, 0, width, height)
      if (!rp) {
        ctx.fillStyle = t['sim-muted']
        ctx.font = `500 13px ${t.fontSans}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        const narrow = width < 520
        ctx.fillText(narrow ? 'Press "Ask once in slow motion"' : 'Press "Ask once in slow motion" to follow one question to the station and back.', width / 2, height / 2 - (narrow ? 8 : 0))
        if (narrow) ctx.fillText('to follow one question and answer.', width / 2, height / 2 + 10)
        return
      }
      drawSpace(ctx, rp, width, Math.round(height * 0.5), t)
      drawTimeline(ctx, rp, width, Math.round(height * 0.5), height, t)
    },
    [replayRef],
  )

  const status = useSampled(
    () => {
      const rp = replayRef.current
      if (!rp) return null
      const tm = rp.timing
      const arrived = rp.replied && rp.tUs >= tm.totalUs
      return {
        arrived,
        outUs: tm.outboundUs,
        delayUs: tm.delayUs,
        totalUs: tm.totalUs,
        nm: dmeDistanceFromTimingNm(tm.totalUs, rp.mode),
        reason: rp.reason,
        shown: rp.shownNm,
        twin: rp.lockedOnTwin,
        done: rp.tUs >= rp.totalUs,
        slow: slowMotionLabel(slowMotionFor(rp.totalUs, REPLAY_REAL_S)),
      }
    },
    150,
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  )

  const describe = status
    ? status.arrived
      ? `The answer arrived ${status.totalUs.toFixed(1)} microseconds after the question. Minus the ${status.delayUs} microsecond wait, divided by ${ROUND_TRIP_US_PER_NM.toFixed(2)} microseconds per nautical mile, that is ${status.nm.toFixed(1)} nautical miles.`
      : status.reason === 'blocked'
        ? 'The question is stopped by a hill or the curve of the Earth. No answer comes back.'
        : status.reason === 'ignored'
          ? 'The station is too busy to answer this aircraft. No answer comes back.'
          : 'The question pulse pair is on its way.'
    : 'Slow-motion view waiting.'

  return (
    <div ref={boxRef} className="flex scroll-mt-20 flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">One question and answer in slow motion</h3>
          <p className="text-xs text-muted-foreground">Time freezes while we follow one pulse pair out to the station and back.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {replay.phase === 'replay' ? (
            <>
              <Button size="sm" variant="outline" onClick={again}>
                <RotateCcw aria-hidden /> Replay
              </Button>
              <Button size="sm" onClick={back}>
                <Play aria-hidden /> Back to live
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={ask}>
              <Send aria-hidden /> Ask once in slow motion
            </Button>
          )}
        </div>
      </div>
      <div className="relative">
        <Canvas2D draw={draw} label={describe} className="h-80 w-full rounded-md border sm:h-72" />
        <div className="pointer-events-none absolute top-2 left-2 flex flex-wrap gap-1.5">
          {replay.phase === 'replay' && status && <SimLabel>Slowed down so you can see it · {status.slow}</SimLabel>}
        </div>
      </div>
      {status && (
        <div aria-live="polite" className="flex flex-col gap-1 font-mono text-xs tabular-nums">
          {status.arrived ? (
            <>
              <p>
                Stopwatch: {status.totalUs.toFixed(1)} µs. Take away the station's {status.delayUs} µs wait: ({status.totalUs.toFixed(1)} − {status.delayUs}) ÷{' '}
                {ROUND_TRIP_US_PER_NM.toFixed(2)} µs per NM = <span className="font-semibold">{status.nm.toFixed(1)} NM</span>
              </p>
              {status.twin && status.shown !== null ? (
                <p className="text-warning">
                  But the cockpit DME shows {status.shown.toFixed(1)} NM: it has locked onto answers meant for CNS202, which line up because neither aircraft uses jitter.
                </p>
              ) : (
                status.shown !== null && (
                  <p className="text-muted-foreground">
                    The cockpit DME shows {status.shown.toFixed(1)} NM
                    {status.shown.toFixed(1) === status.nm.toFixed(1) ? ': the same number.' : ', a value it measured a moment earlier.'}
                  </p>
                )
              )}
            </>
          ) : status.reason === 'blocked' && status.done ? (
            <p className="text-destructive">No answer: a hill or the curve of the Earth stops the question before it reaches the station.</p>
          ) : status.reason === 'ignored' && status.done ? (
            <p className="text-warning">No answer: the station is overloaded and has turned its receiver sensitivity down. It only answers closer aircraft.</p>
          ) : (
            <p className="text-muted-foreground">Trip out {fmtUs(status.outUs)} µs, then the station waits {status.delayUs} µs, then the trip back {fmtUs(status.outUs)} µs.</p>
          )}
        </div>
      )}
    </div>
  )
}

/** Top half: the path from the aircraft (left) to the station (right) with the pulses on it. */
function drawSpace(ctx: CanvasRenderingContext2D, rp: DmeReplay, width: number, h: number, t: ThemeTokens) {
  const padL = 54
  const padR = 60
  const w = width - padL - padR
  const L = Math.max(rp.slantNm, 0.1)
  const xOf = (nm: number) => padL + (Math.min(Math.max(nm, 0), L) / L) * w
  const y = Math.round(h * (width < 560 ? 0.62 : 0.52))
  const tm = rp.timing
  const tNow = rp.tUs
  // Path.
  ctx.strokeStyle = t['sim-grid-strong']
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(padL, y)
  ctx.lineTo(padL + w, y)
  ctx.stroke()
  // Distance axis.
  ctx.fillStyle = t['sim-muted']
  ctx.font = `500 10px ${t.fontMono}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  const step = L > 100 ? 50 : L > 40 ? 10 : L > 12 ? 5 : L > 4 ? 1 : 0.5
  for (let d = 0; d <= L + 1e-9; d += step) ctx.fillText(`${d}`, xOf(d), h - 14)
  ctx.font = `500 10px ${t.fontSans}`
  ctx.fillText('distance from the aircraft along the radio path, NM', padL + w / 2, h - 1)
  // Aircraft and station.
  ctx.fillStyle = t['sim-ink']
  ctx.font = `600 11px ${t.fontSans}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.beginPath()
  ctx.moveTo(padL - 22, y - 3)
  ctx.lineTo(padL - 6, y)
  ctx.lineTo(padL - 22, y + 3)
  ctx.closePath()
  ctx.fill()
  ctx.fillText('CNS101', padL - 22, y + 8)
  const sx = padL + w
  ctx.fillStyle = t['sim-signal']
  ctx.fillRect(sx + 8, y - 12, 14, 24)
  ctx.fillStyle = t['sim-ink']
  ctx.fillText('Station', sx + 15, y + 16)
  // Hill blocking the path.
  if (rp.blockNm !== null) {
    const bx = xOf(rp.blockNm)
    ctx.fillStyle = withAlpha(t['sim-terrain-high'], 0.7)
    ctx.beginPath()
    ctx.moveTo(bx - 18, y + 18)
    ctx.quadraticCurveTo(bx, y - 30, bx + 18, y + 18)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = t['sim-alert']
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.fillText('Blocked', bx, y - 22)
  }
  // Question pulses travelling to the station.
  const limit = rp.blockNm ?? L
  const drawPulse = (dNm: number, up: boolean, color: string) => {
    const x = xOf(dNm)
    const pw = Math.max(3, (PULSE_US * LIGHT_NM_PER_US * w) / L)
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(x - pw / 2, y)
    ctx.bezierCurveTo(x - pw / 4, y, x - pw / 4, y + (up ? -20 : 20), x, y + (up ? -20 : 20))
    ctx.bezierCurveTo(x + pw / 4, y + (up ? -20 : 20), x + pw / 4, y, x + pw / 2, y)
    ctx.closePath()
    ctx.fill()
  }
  for (let k = 0; k < 2; k++) {
    const d = LIGHT_NM_PER_US * (tNow - k * rp.code.interrogationSpacingUs)
    if (d >= 0 && d <= limit) drawPulse(d, true, t['sim-signal'])
  }
  // Station waiting.
  const arrive = tm.outboundUs
  if (rp.reason !== 'blocked' && tNow >= arrive) {
    const waited = Math.min(tNow - arrive, tm.delayUs)
    const frac = waited / tm.delayUs
    const cx = sx + 15
    const cy = y - 34
    ctx.strokeStyle = t['sim-grid-strong']
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.arc(cx, cy, 11, 0, Math.PI * 2)
    ctx.stroke()
    ctx.strokeStyle = rp.reason === 'ignored' ? t['sim-muted'] : t['sim-signal']
    ctx.beginPath()
    ctx.arc(cx, cy, 11, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = rp.reason === 'ignored' ? t['sim-warning'] : t['sim-ink']
    ctx.font = `600 11px ${t.fontSans}`
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    const txt = rp.reason === 'ignored' ? 'Too busy: no answer' : frac < 1 ? `Waiting ${waited.toFixed(0)} of ${tm.delayUs} µs` : 'Answer sent'
    ctx.fillText(txt, cx - 16, cy)
  }
  // Answer pulses travelling back.
  if (rp.replied) {
    const leave = tm.outboundUs + tm.delayUs
    for (let k = 0; k < 2; k++) {
      const d = L - LIGHT_NM_PER_US * (tNow - leave - k * rp.code.replySpacingUs)
      if (d >= 0 && d <= L && tNow >= leave + k * rp.code.replySpacingUs) drawPulse(d, false, t['sim-signal-2'])
    }
  }
  // Legend for the two pulse directions.
  ctx.font = `500 10px ${t.fontSans}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillStyle = t['sim-muted']
  const legend =
    width >= 560
      ? `Question: 2 pulses ${rp.code.interrogationSpacingUs} µs apart (above the line) · Answer: ${rp.code.replySpacingUs} µs apart (below)`
      : `Question above the line, answer below`
  ctx.fillText(legend, padL - 40, y + 28)
}

/** Bottom half: the stopwatch as a bar split into trip out, the fixed wait and trip back. */
function drawTimeline(ctx: CanvasRenderingContext2D, rp: DmeReplay, width: number, y0: number, height: number, t: ThemeTokens) {
  const padL = 16
  const padR = 16
  const w = width - padL - padR
  const tm = rp.timing
  const total = tm.totalUs
  const xOfT = (us: number) => padL + (Math.min(Math.max(us, 0), total) / total) * w
  const barY = y0 + 30
  const barH = 30
  const tNow = Math.min(rp.tUs, total)
  ctx.fillStyle = t['sim-ink']
  ctx.font = `600 11px ${t.fontSans}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.fillText(`CNS101's stopwatch: ${fmtUs(tNow)} µs`, padL, barY - 8)
  type Seg = { from: number; to: number; label: string; fill: string; hatch?: boolean; faded?: boolean }
  const out: Seg = { from: 0, to: tm.outboundUs, label: `Trip out ${fmtUs(tm.outboundUs)} µs`, fill: t['sim-signal'] }
  const waitEnd = tm.outboundUs + tm.delayUs
  let segs: Seg[]
  if (rp.reason === 'blocked') {
    const tb = Math.min(tm.outboundUs, (rp.blockNm ?? rp.slantNm) / LIGHT_NM_PER_US)
    segs = [
      { from: 0, to: tb, label: `Question travels ${fmtUs(tb)} µs, to the hill`, fill: t['sim-signal'] },
      { from: tb, to: total, label: 'Blocked: nothing comes back', fill: t['sim-neutral'], hatch: true, faded: true },
    ]
  } else if (rp.reason === 'ignored') {
    segs = [
      out,
      { from: tm.outboundUs, to: waitEnd, label: 'Too busy: ignored', fill: t['sim-neutral'], hatch: true, faded: true },
      { from: waitEnd, to: total, label: 'No answer', fill: t['sim-signal-2'], faded: true },
    ]
  } else {
    segs = [
      out,
      { from: tm.outboundUs, to: waitEnd, label: `Station waits ${tm.delayUs} µs`, fill: t['sim-neutral'], hatch: true },
      { from: waitEnd, to: total, label: `Trip back ${fmtUs(tm.returnUs)} µs`, fill: t['sim-signal-2'] },
    ]
  }
  // Empty bar.
  ctx.strokeStyle = t['sim-grid-strong']
  ctx.lineWidth = 1
  ctx.strokeRect(padL, barY, w, barH)
  for (const sg of segs) {
    const x0 = xOfT(sg.from)
    const x1 = xOfT(sg.to)
    const filled = Math.max(0, Math.min(x1, xOfT(tNow)) - x0)
    ctx.fillStyle = withAlpha(sg.fill, sg.faded ? 0.08 : 0.18)
    ctx.fillRect(x0, barY, x1 - x0, barH)
    if (filled > 0 && !sg.faded) {
      ctx.fillStyle = withAlpha(sg.fill, 0.85)
      ctx.fillRect(x0, barY, filled, barH)
    }
    if (sg.hatch) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(x0, barY, x1 - x0, barH)
      ctx.clip()
      ctx.strokeStyle = withAlpha(t['sim-ink'], sg.faded ? 0.2 : 0.35)
      ctx.lineWidth = 1
      for (let x = x0 - barH; x < x1; x += 6) {
        ctx.beginPath()
        ctx.moveTo(x, barY + barH)
        ctx.lineTo(x + barH, barY)
        ctx.stroke()
      }
      ctx.restore()
    }
    ctx.strokeStyle = t['sim-bg']
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(x1, barY)
    ctx.lineTo(x1, barY + barH)
    ctx.stroke()
  }
  // Segment labels below the bar; a label that would overlap the previous one moves down a row.
  ctx.font = `600 11px ${t.fontSans}`
  ctx.textBaseline = 'top'
  const rowsRight: number[] = []
  segs.forEach((sg) => {
    const x0 = xOfT(sg.from)
    const x1 = xOfT(sg.to)
    const cx = (x0 + x1) / 2
    const tw = ctx.measureText(sg.label).width
    const left = Math.min(Math.max(cx - tw / 2, padL), padL + w - tw)
    let row = rowsRight.findIndex((r) => left > r + 8)
    if (row < 0) row = rowsRight.length
    rowsRight[row] = left + tw
    ctx.fillStyle = sg.faded ? t['sim-muted'] : t['sim-ink']
    ctx.textAlign = 'left'
    ctx.fillText(sg.label, left, barY + barH + 6 + row * 15)
    if (row > 0) {
      ctx.strokeStyle = t['sim-muted']
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(cx, barY + barH)
      ctx.lineTo(cx, barY + barH + 4 + row * 15)
      ctx.stroke()
    }
  })
  // "Now" cursor.
  const cx = xOfT(tNow)
  ctx.strokeStyle = t['sim-ink']
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(cx, barY - 4)
  ctx.lineTo(cx, barY + barH + 4)
  ctx.stroke()
  // Total.
  ctx.fillStyle = t['sim-muted']
  ctx.font = `500 10px ${t.fontMono}`
  ctx.textAlign = 'right'
  ctx.textBaseline = 'bottom'
  ctx.fillText(`total ${fmtUs(total)} µs`, padL + w, barY - 8)
  if (height - (barY + barH) > 60 && width >= 560) {
    ctx.textAlign = 'left'
    ctx.textBaseline = 'bottom'
    ctx.fillStyle = t['sim-muted']
    ctx.font = `500 10px ${t.fontSans}`
    ctx.fillText('Bar length is time. The two trips are equal; only the wait is fixed.', padL, height - 8)
  }
}
