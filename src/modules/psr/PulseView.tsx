import { useCallback } from 'react'
import { Crosshair, Play, RotateCcw, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Canvas2D, type DrawFn } from '@/components/sim/Canvas2D'
import { SimLabel } from '@/components/sim/Controls'
import { slowMotionFor, slowMotionLabel } from '@/core/clock'
import { apparentRange, maxUnambiguousRangeNm, pulseIntervalUs } from '@/core/radar'
import { rangeFromRoundTripNm, roundTripTimeUs } from '@/core/propagation'
import { LIGHT_NM_PER_US } from '@/core/units'
import { bearingDeg } from '@/core/geometry'
import { useSampled } from '@/hooks/useSampled'
import { withAlpha } from '@/lib/color'
import { cn } from '@/lib/utils'
import { usePsr, usePsrState } from './state'

/** Real seconds the whole replay should take. */
export const REPLAY_REAL_S = 7

export interface Replay {
  azDeg: number
  prfHz: number
  /** Longest range shown, NM. */
  lengthNm: number
  /** Signal time at the end of the replay, µs. */
  totalUs: number
  tUs: number
  echoes: { rangeNm: number; strength: number; kind: string; label: string; id?: string }[]
  targetId?: string
}

/** Build a replay for the current antenna direction. */
export function buildReplay(engine: ReturnType<typeof usePsr>['engine'], scopeRangeNm: number, targetId?: string): Replay {
  const az = engine.antennaAz
  const echoes = engine.echoesAlong(az)
  const target = echoes.find((e) => e.id === targetId)
  const farthest = Math.max(scopeRangeNm, target ? target.rangeNm * 1.12 : 0, maxUnambiguousRangeNm(engine.params.prfHz) * 0.5)
  const lengthNm = Math.min(Math.max(farthest, 10), 140)
  return {
    azDeg: az,
    prfHz: engine.params.prfHz,
    lengthNm,
    totalUs: roundTripTimeUs(lengthNm),
    tUs: 0,
    echoes: echoes.filter((e) => e.rangeNm <= lengthNm),
    targetId,
  }
}

export function PulseView({ replayRef }: { replayRef: React.RefObject<Replay | null> }) {
  const { engine } = usePsr()
  const pulse = usePsrState((s) => s.pulse)
  const setPulse = usePsrState((s) => s.setPulse)
  const selectedId = usePsrState((s) => s.selectedId)
  const { clock } = usePsr()

  const arm = (id: string) => {
    const a = engine.getAircraft(id)
    if (!a) return
    const wasRunning = clock.getState().running
    // The antenna keeps turning until it points at the aircraft; the world must run for that.
    clock.getState().play()
    setPulse({ phase: 'armed', targetId: id, azDeg: bearingDeg(engine.site.pos, a.pos), resume: wasRunning })
  }
  const stop = () => {
    replayRef.current = null
    if (pulse.resume !== false) clock.getState().play()
    setPulse({ phase: 'idle' })
  }
  const again = () => {
    if (replayRef.current) replayRef.current.tUs = 0
  }

  const draw: DrawFn = useCallback(
    (ctx, { width, height, tokens: t }) => {
      const rp = replayRef.current
      ctx.fillStyle = t['sim-bg']
      ctx.fillRect(0, 0, width, height)
      const padL = 44
      const padR = 16
      const topH = Math.round(height * 0.44)
      const w = width - padL - padR
      if (!rp) {
        ctx.fillStyle = t['sim-muted']
        ctx.font = `500 13px ${t.fontSans}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('Choose an aircraft above to follow one radar pulse to it and back.', width / 2, height / 2)
        return
      }
      const L = rp.lengthNm
      const xOf = (nm: number) => padL + (nm / L) * w
      const pri = pulseIntervalUs(rp.prfHz)
      const ru = maxUnambiguousRangeNm(rp.prfHz)
      const tNow = rp.tUs
      const beamY = topH * 0.55

      // --- Space view ---------------------------------------------------
      if (ru < L) {
        ctx.fillStyle = withAlpha(t['sim-warning'], 0.08)
        ctx.fillRect(xOf(ru), 6, xOf(L) - xOf(ru), topH - 12)
        ctx.fillStyle = t['sim-warning']
        ctx.font = `600 10px ${t.fontSans}`
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        ctx.fillText('Echoes from here return after the next pulse has left', xOf(ru) + 4, 10)
      }
      ctx.strokeStyle = t['sim-grid-strong']
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(padL, beamY)
      ctx.lineTo(xOf(L), beamY)
      ctx.stroke()
      // Radar.
      ctx.fillStyle = t['sim-signal']
      ctx.beginPath()
      ctx.arc(padL - 16, beamY, 7, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = t['sim-ink']
      ctx.font = `600 10px ${t.fontSans}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText('Radar', padL - 16, beamY + 10)

      // Echo sources.
      for (const e of rp.echoes) {
        const x = xOf(e.rangeNm)
        if (e.kind === 'target') {
          ctx.fillStyle = t['sim-ink']
          ctx.beginPath()
          ctx.moveTo(x, beamY - 9)
          ctx.lineTo(x + 5, beamY + 5)
          ctx.lineTo(x - 5, beamY + 5)
          ctx.closePath()
          ctx.fill()
          ctx.font = `600 11px ${t.fontSans}`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'bottom'
          ctx.fillText(e.label, x, beamY - 12)
        } else {
          ctx.fillStyle = withAlpha(e.kind === 'weather' ? t['sim-signal-2'] : t['sim-neutral'], 0.25 + 0.5 * e.strength)
          ctx.fillRect(x - 1.5, beamY - 5, 3, 10)
        }
      }

      // Pulse fronts: pulse 1 and any later pulses already sent.
      const nPulses = Math.floor(tNow / pri) + 1
      for (let k = 0; k < nPulses; k++) {
        const d = LIGHT_NM_PER_US * (tNow - k * pri)
        if (d < 0 || d > L) continue
        ctx.strokeStyle = k === 0 ? t['sim-signal'] : withAlpha(t['sim-signal'], 0.35)
        ctx.lineWidth = k === 0 ? 3 : 2
        ctx.beginPath()
        ctx.moveTo(xOf(d), beamY - 16)
        ctx.lineTo(xOf(d), beamY + 16)
        ctx.stroke()
        if (k > 0) {
          ctx.fillStyle = withAlpha(t['sim-signal'], 0.7)
          ctx.font = `500 10px ${t.fontSans}`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'top'
          ctx.fillText(`pulse ${k + 1}`, xOf(d), beamY + 18)
        }
      }
      // Echoes of pulse 1 travelling back.
      for (const e of rp.echoes) {
        const tHit = e.rangeNm / LIGHT_NM_PER_US
        const tBack = 2 * tHit
        if (tNow < tHit || tNow > tBack) continue
        const d = 2 * e.rangeNm - LIGHT_NM_PER_US * tNow
        ctx.strokeStyle = withAlpha(e.kind === 'target' ? t['sim-ink'] : t['sim-neutral'], 0.3 + 0.6 * e.strength)
        ctx.lineWidth = e.kind === 'target' ? 2.5 : 1.2
        ctx.beginPath()
        ctx.arc(xOf(d) + 6, beamY, 6, Math.PI * 0.7, Math.PI * 1.3)
        ctx.stroke()
      }
      // Range axis.
      ctx.fillStyle = t['sim-muted']
      ctx.font = `500 10px ${t.fontMono}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      const step = L > 80 ? 20 : L > 40 ? 10 : 5
      for (let r = 0; r <= L; r += step) ctx.fillText(`${r} NM`, xOf(r), topH - 2)

      // --- A-scope ----------------------------------------------------
      const y0 = topH + 10
      const h = height - y0 - 26
      const base = y0 + h
      ctx.fillStyle = t['scope-bg']
      ctx.fillRect(padL, y0, w, h)
      const xOfT = (us: number) => padL + (rangeFromRoundTripNm(us) / L) * w
      // Listening windows.
      for (let k = 1; k * pri < rp.totalUs; k++) {
        const x = xOfT(k * pri)
        ctx.strokeStyle = t['scope-warning']
        ctx.setLineDash([4, 3])
        ctx.beginPath()
        ctx.moveTo(x, y0)
        ctx.lineTo(x, base)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = t['scope-warning']
        ctx.font = `600 10px ${t.fontSans}`
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        ctx.fillText(`pulse ${k + 1} leaves`, x + 3, y0 + 3)
      }
      // Trace.
      const tMax = Math.min(tNow, rp.totalUs)
      ctx.strokeStyle = t['scope-trace']
      ctx.lineWidth = 1.5
      ctx.beginPath()
      const n = Math.round(w)
      for (let i = 0; i <= n; i++) {
        const us = (i / n) * rp.totalUs
        if (us > tMax) break
        let v = 0.03 * Math.sin(i * 1.7) * Math.sin(i * 0.31) + 0.03
        // Transmit bang at t = 0.
        if (us < 4) v = 1
        for (const e of rp.echoes) {
          const ta = roundTripTimeUs(e.rangeNm)
          const width = e.kind === 'weather' ? 8 : 3
          v += e.strength * (e.kind === 'target' ? 0.95 : 0.6) * Math.exp(-(((us - ta) / width) ** 2))
        }
        const y = base - Math.min(1, v) * (h - 14)
        if (i === 0) ctx.moveTo(xOfT(us), y)
        else ctx.lineTo(xOfT(us), y)
      }
      ctx.stroke()
      // Echo annotations.
      ctx.font = `600 10px ${t.fontSans}`
      for (const e of rp.echoes) {
        if (e.kind !== 'target') continue
        const ta = roundTripTimeUs(e.rangeNm)
        if (tNow < ta) continue
        const x = xOfT(ta)
        ctx.fillStyle = t['scope-text']
        ctx.textAlign = 'center'
        ctx.textBaseline = 'bottom'
        ctx.fillText(`${e.label} ${ta.toFixed(0)} µs`, x, y0 + 26)
        const app = apparentRange(e.rangeNm, rp.prfHz)
        if (app.trace > 1) {
          const xg = xOfT(roundTripTimeUs(app.rangeNm))
          ctx.strokeStyle = t['scope-warning']
          ctx.setLineDash([3, 3])
          ctx.beginPath()
          ctx.moveTo(x, y0 + 30)
          ctx.quadraticCurveTo((x + xg) / 2, y0 + 10, xg, y0 + 30)
          ctx.stroke()
          ctx.setLineDash([])
          ctx.fillStyle = t['scope-warning']
          ctx.fillText(`radar thinks ${app.rangeNm.toFixed(1)} NM`, xg, y0 + 42)
        }
      }
      // Time axis.
      ctx.fillStyle = t['sim-muted']
      ctx.font = `500 10px ${t.fontMono}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      const us = roundTripTimeUs(step)
      for (let k = 0; k * us <= rp.totalUs + 1e-6; k++) ctx.fillText(`${Math.round(k * us)} µs`, xOfT(k * us), base + 4)
      ctx.textAlign = 'right'
      ctx.textBaseline = 'top'
      ctx.fillStyle = t['scope-dim']
      ctx.font = `600 10px ${t.fontSans}`
      ctx.fillText('A-scope: echo strength over time', padL + w - 4, y0 + 4)
    },
    [replayRef],
  )

  const status = useSampled(() => {
    const rp = replayRef.current
    if (!rp) return null
    const done = rp.tUs >= rp.totalUs
    const arrived = rp.echoes.filter((e) => e.kind === 'target' && rp.tUs >= roundTripTimeUs(e.rangeNm))
    return { done, arrived: arrived.map((e) => ({ label: e.label, us: roundTripTimeUs(e.rangeNm), nm: e.rangeNm, app: apparentRange(e.rangeNm, rp.prfHz) })), slow: slowMotionLabel(slowMotionFor(rp.totalUs, REPLAY_REAL_S)) }
  }, 150, (a, b) => JSON.stringify(a) === JSON.stringify(b))

  const describe = status
    ? status.arrived.length
      ? status.arrived.map((a) => `Echo from ${a.label} returned after ${a.us.toFixed(0)} microseconds, so it is ${a.nm.toFixed(1)} nautical miles away.`).join(' ')
      : 'The pulse is travelling out along the beam.'
    : 'Pulse view waiting.'

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">One pulse in slow motion</h3>
          <p className="text-xs text-muted-foreground">
            Time freezes while we follow a single pulse out along the beam and its echoes back.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {pulse.phase === 'replay' && (
            <>
              <Button size="sm" variant="outline" onClick={again}>
                <RotateCcw aria-hidden /> Replay
              </Button>
              <Button size="sm" onClick={stop}>
                <Play aria-hidden /> Back to live
              </Button>
            </>
          )}
          {pulse.phase === 'armed' && (
            <Button size="sm" variant="outline" onClick={() => setPulse({ phase: 'idle' })}>
              <Square aria-hidden /> Cancel
            </Button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Fire a pulse at an aircraft">
        <span className="text-xs font-medium text-muted-foreground">Fire a pulse at:</span>
        {engine.aircraft.map((a) => (
          <Button
            key={a.id}
            size="sm"
            variant={pulse.targetId === a.id && pulse.phase !== 'idle' ? 'default' : a.id === selectedId ? 'secondary' : 'outline'}
            onClick={() => arm(a.id)}
            disabled={pulse.phase === 'armed'}
          >
            <Crosshair aria-hidden /> {a.callsign}
          </Button>
        ))}
      </div>
      <div className="relative">
        <Canvas2D draw={draw} label={describe} className={cn('h-72 w-full rounded-md border')} />
        <div className="pointer-events-none absolute top-2 left-2 flex flex-wrap gap-1.5">
          {pulse.phase === 'replay' && status && <SimLabel>Slowed down so you can see it · {status.slow}</SimLabel>}
          {pulse.phase === 'armed' && <SimLabel icon="none">Waiting for the antenna to point at {pulse.targetId}…</SimLabel>}
        </div>
      </div>
      {status && status.arrived.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm" aria-live="polite">
          {status.arrived.map((a) => (
            <li key={a.label} className="font-mono text-xs tabular-nums">
              {a.label}: the echo came back after {a.us.toFixed(1)} µs, so it is {a.nm.toFixed(1)} NM away
              {a.app.trace > 1 && (
                <span className="text-warning"> · arrived after pulse {a.app.trace} left, so the radar shows it at {a.app.rangeNm.toFixed(1)} NM</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
