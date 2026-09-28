import { useCallback } from 'react'
import { Play, Radio, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Canvas2D, type DrawFn } from '@/components/sim/Canvas2D'
import { SimLabel } from '@/components/sim/Controls'
import { slowMotionFor, slowMotionLabel } from '@/core/clock'
import { C_M_PER_US } from '@/core/mlat'
import { useSampled } from '@/hooks/useSampled'
import { withAlpha } from '@/lib/color'
import { formatM } from './accuracy'
import { useMlat, useMlatState } from './state'

/** Real seconds one slow-motion signal should take on screen. */
export const REPLAY_REAL_S = 6

export function SignalView() {
  const { engine, clock, replayRef, store } = useMlat()
  const replay = useMlatState((s) => s.replay)
  const selectedId = useMlatState((s) => s.selectedId)
  const callsign = engine.getAircraft(selectedId)?.callsign ?? selectedId

  const start = () => {
    if (!selectedId) return
    const wasRunning = clock.getState().running
    clock.getState().pause()
    const fix = engine.emitNow(selectedId)
    if (!fix) return
    const longest = Math.max(1, ...fix.stamps.map((s) => s.travelUs))
    replayRef.current = { fix, tUs: 0, totalUs: longest * 1.08 + 2 }
    store.getState().setReplay({ phase: 'replay', fix, resume: replay.phase === 'replay' ? replay.resume : wasRunning })
  }
  const again = () => {
    if (replayRef.current) replayRef.current.tUs = 0
  }
  const stop = () => {
    replayRef.current = null
    const resume = replay.resume
    store.getState().setReplay({ phase: 'idle' })
    if (resume !== false) clock.getState().play()
  }

  const draw: DrawFn = useCallback(
    (ctx, { width, height, tokens: t }) => {
      ctx.fillStyle = t['sim-bg']
      ctx.fillRect(0, 0, width, height)
      const rp = replayRef.current
      const fix = rp?.fix ?? (selectedId ? engine.fixes.get(selectedId) : undefined)
      if (!fix || !fix.stamps.length) {
        ctx.fillStyle = t['sim-muted']
        ctx.font = `500 13px ${t.fontSans}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(fix ? 'No receiver is switched on.' : 'Waiting for the aircraft to transmit…', width / 2, height / 2)
        return
      }
      const rows = [...fix.stamps].sort((a, b) => a.stampUs - b.stampUs)
      const T = rp ? rp.totalUs : Math.max(...rows.map((r) => r.stampUs)) * 1.08 + 2
      const narrow = width < 520
      const padL = narrow ? 44 : 128
      const padR = 16
      const top = 30
      const bottom = height - 22
      const rowH = (bottom - top) / rows.length
      const x = (us: number) => padL + (us / T) * (width - padL - padR)

      // Transmission moment.
      ctx.strokeStyle = t['sim-grid-strong']
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.moveTo(x(0), top - 6)
      ctx.lineTo(x(0), bottom)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = t['sim-muted']
      ctx.font = `600 10px ${t.fontSans}`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'bottom'
      ctx.fillText(narrow ? 'Sent (moment unknown)' : 'Aircraft transmits (the receivers do not know this moment)', x(0) + 4, top - 8)

      rows.forEach((r, k) => {
        const y = top + (k + 0.5) * rowH
        ctx.fillStyle = t['sim-ink']
        ctx.font = `600 11px ${t.fontSans}`
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillText(narrow ? r.id : `${r.id} ${r.name}`, 8, y)
        ctx.strokeStyle = t['sim-grid']
        ctx.beginPath()
        ctx.moveTo(x(0), y)
        ctx.lineTo(width - padR, y)
        ctx.stroke()
        const arrived = !rp || rp.tUs >= r.travelUs
        if (!arrived) return
        const xs = x(r.stampUs)
        ctx.strokeStyle = t['sim-signal']
        ctx.lineWidth = 2.5
        ctx.beginPath()
        ctx.moveTo(xs, y - rowH * 0.32)
        ctx.lineTo(xs, y + rowH * 0.32)
        ctx.stroke()
        ctx.lineWidth = 1
        ctx.fillStyle = t['sim-ink']
        ctx.font = `500 10px ${t.fontMono}`
        const text = `${r.stampUs.toFixed(3)} µs${r.clockErrorNs ? ` (clock ${r.clockErrorNs > 0 ? '+' : ''}${r.clockErrorNs} ns)` : ''}`
        const w = ctx.measureText(text).width
        const right = xs + 6 + w < width - padR
        ctx.textAlign = right ? 'left' : 'right'
        ctx.fillText(text, right ? xs + 6 : xs - 6, y - rowH * 0.18)
      })

      // Signal time cursor during the replay.
      if (rp) {
        ctx.strokeStyle = withAlpha(t['sim-signal'], 0.7)
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(x(rp.tUs), top - 4)
        ctx.lineTo(x(rp.tUs), bottom)
        ctx.stroke()
      }

      // Time axis.
      ctx.fillStyle = t['sim-muted']
      ctx.font = `500 10px ${t.fontMono}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      // Keep tick labels at least ~56 px apart.
      const pxPerUs = (width - padL - padR) / T
      const step = [5, 10, 25, 50, 100, 250].find((st) => st * pxPerUs >= 56) ?? 500
      for (let us = 0; us <= T; us += step) ctx.fillText(`${us} µs`, x(us), bottom + 5)
    },
    [engine, replayRef, selectedId],
  )

  const summary = useSampled(
    () => {
      const rp = replayRef.current
      const fix = rp?.fix ?? (selectedId ? engine.fixes.get(selectedId) : undefined)
      if (!fix || !fix.stamps.length) return null
      const rows = [...fix.stamps].sort((a, b) => a.stampUs - b.stampUs)
      const first = rows[0]
      const done = !rp || rp.tUs >= Math.max(...rows.map((r) => r.travelUs))
      return {
        seq: fix.seq,
        done,
        first: `${first.id} ${first.name}`,
        diffs: rows.slice(1).map((r) => {
          const dtUs = r.stampUs - first.stampUs
          return { id: r.id, name: r.name, dtUs, farther: dtUs * C_M_PER_US, clock: r.clockErrorNs || first.clockErrorNs ? true : false, heard: !rp || rp.tUs >= r.travelUs }
        }),
      }
    },
    200,
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  )

  const slow = replayRef.current ? slowMotionLabel(slowMotionFor(replayRef.current.totalUs, REPLAY_REAL_S)) : ''
  const describe = summary
    ? `Arrival times at ${summary.diffs.length + 1} receivers. ${summary.first} heard the signal first. ${summary.diffs
        .filter((d) => d.heard)
        .map((d) => `${d.id} heard it ${d.dtUs.toFixed(2)} microseconds later, so it is ${formatM(d.farther)} farther away.`)
        .join(' ')}`
    : 'Arrival times: waiting for a signal.'

  return (
    <div className="hud-panel flex flex-col gap-3 rounded-md p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">When the signal reached each receiver</h3>
          <p className="text-xs text-muted-foreground">
            Only the differences between these times are known. That is enough to find the aircraft.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {replay.phase === 'replay' ? (
            <>
              <Button size="sm" variant="outline" onClick={again}>
                <RotateCcw aria-hidden /> Replay
              </Button>
              <Button size="sm" onClick={stop}>
                <Play aria-hidden /> Back to live
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={start} disabled={!selectedId}>
              <Radio aria-hidden /> Follow one signal from {callsign} in slow motion
            </Button>
          )}
        </div>
      </div>
      {replay.phase === 'replay' && (
        <div>
          <SimLabel>Slowed down so you can see it · {slow}</SimLabel>
        </div>
      )}
      <Canvas2D draw={draw} label={describe} className="h-56 w-full rounded-md border" />
      {summary && (
        <ul className="grid gap-1 text-xs sm:grid-cols-2" aria-live="polite">
          <li className="text-muted-foreground">
            <span className="font-medium text-foreground">{summary.first}</span> heard it first.
          </li>
          {summary.diffs.map((d) => (
            <li key={d.id} className="font-mono tabular-nums">
              {d.heard ? (
                <>
                  {d.id}: +{d.dtUs.toFixed(3)} µs → {formatM(d.farther)} farther away
                  {d.clock && <span className="text-warning"> (includes a clock error)</span>}
                </>
              ) : (
                <span className="text-muted-foreground">{d.id}: not reached yet…</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
