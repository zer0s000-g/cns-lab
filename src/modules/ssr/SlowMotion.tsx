import { useCallback } from 'react'
import { Crosshair, Play, RotateCcw, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Canvas2D, type DrawFn } from '@/components/sim/Canvas2D'
import { ControlChoice, SimLabel } from '@/components/sim/Controls'
import { slowMotionLabel } from '@/core/clock'
import { travelTimeUs } from '@/core/propagation'
import {
  bitsToSquawk,
  buildDf4,
  buildDf5,
  decodeGillham,
  decodeReplyPulses,
  decodeSurveillanceReply,
  flightStatus,
  formatIcaoAddress,
  interrogationPulses,
  MODE_S_P6_SHORT_US,
  MODE_S_P6_START_US,
  MODE_S_PULSE_US,
  MODE_S_SPR_AFTER_P6_US,
  MODE_S_TURNAROUND_US,
  modeSReplyUs,
  P1_P3_US,
  ppmPulseTimesUs,
  rangeFromReplyUs,
  REPLY_PULSE_US,
  replyDurationUs,
  replyPulseTrain,
  specialCode,
  TRANSPONDER_DELAY_US,
  type DecodedReply,
} from '@/core/ssr'
import { rangeFromRoundTripNm } from '@/core/propagation'
import { useSampled } from '@/hooks/useSampled'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { withAlpha } from '@/lib/color'
import type { InterrogationHeard, SsrEngine } from './engine'
import { useSsr, useSsrState, type ReplayAsk } from './state'

interface Pulse {
  name: string
  tUs: number
  widthUs: number
}

interface ReplyOnAir {
  id: string
  callsign: string
  slantNm: number
  /** When the first reply pulse leaves the aircraft, µs after P1 left the radar. */
  startUs: number
  pulses: Pulse[]
  lengthUs: number
}

interface Segment {
  from: number
  to: number
  usPerS: number
  note: string
}

export interface SsrReplay {
  kind: 'ac' | 's'
  ask: ReplayAsk
  targetId: string
  callsign: string
  azDeg: number
  lengthNm: number
  heard: InterrogationHeard[]
  target: InterrogationHeard
  uplink: (Pulse & { antenna: 'directional' | 'control' })[]
  uplinkEndUs: number
  replies: ReplyOnAir[]
  /** Reference time the radar measures from (P3 for Mode A/C, the sync phase reversal for Mode S), µs after P1. */
  refUs: number
  tAtTarget: number
  totalUs: number
  tUs: number
  segments: Segment[]
  decodedAC: DecodedReply[]
  modeS?: { bits: number[]; address: number; decoded: ReturnType<typeof decodeSurveillanceReply> }
}

const FOCUS_AC_US_PER_S = 8
const FOCUS_S_US_PER_S = 16

/** Freeze-frame of one interrogation toward the aircraft the antenna points at now. */
export function buildSsrReplay(engine: SsrEngine, targetId: string, ask: ReplayAsk): SsrReplay | null {
  const a = engine.getAircraft(targetId)
  if (!a) return null
  const kind = engine.params.mode
  const az = engine.antennaAz
  const all = engine.hearInterrogation(az, ask, () => 0.5)
  const target = all.find((h) => h.id === targetId)!
  const tAt = travelTimeUs(target.slantNm)
  const replies: ReplyOnAir[] = []
  let uplink: SsrReplay['uplink']
  let refUs: number
  let modeS: SsrReplay['modeS']
  let heard = all
  if (kind === 'ac') {
    uplink = interrogationPulses(ask)
      .filter((p) => p.name !== 'P2' || !engine.env.noP2)
      .map((p) => ({ name: p.name, tUs: p.tUs, widthUs: p.widthUs, antenna: p.antenna }))
    refUs = P1_P3_US[ask]
    for (const h of all) {
      if (!h.replies || !h.bits) continue
      const len = replyDurationUs(h.spi)
      replies.push({
        id: h.id,
        callsign: h.callsign,
        slantNm: h.slantNm,
        startUs: travelTimeUs(h.slantNm) + refUs + TRANSPONDER_DELAY_US,
        pulses: replyPulseTrain(h.bits, h.spi).map((p) => ({ name: p.name, tUs: p.tUs, widthUs: REPLY_PULSE_US })),
        lengthUs: len,
      })
    }
  } else {
    uplink = [
      { name: 'P1', tUs: 0, widthUs: 0.8, antenna: 'directional' },
      { name: 'P2', tUs: 2, widthUs: 0.8, antenna: 'directional' },
      { name: 'P6', tUs: MODE_S_P6_START_US, widthUs: MODE_S_P6_SHORT_US, antenna: 'directional' },
    ]
    refUs = MODE_S_P6_START_US + MODE_S_SPR_AFTER_P6_US
    // Only the addressed aircraft answers a roll-call.
    heard = all.map((h) => (h.id === targetId ? h : { ...h, replies: false }))
    const x = engine.transponder(targetId)
    const answers = x.on && target.decision !== 'hidden' && target.decision !== 'too-weak'
    target.replies = answers
    if (answers) {
      const alert = specialCode(x.squawk) != null
      const fs = flightStatus(alert, target.spi)
      const bits = ask === 'A' ? buildDf5(a.address, x.squawk, fs) : buildDf4(a.address, Math.round(a.altitudeFt / 25) * 25, fs)
      modeS = { bits, address: a.address, decoded: decodeSurveillanceReply(bits) }
      replies.push({
        id: targetId,
        callsign: a.callsign,
        slantNm: target.slantNm,
        startUs: tAt + refUs + MODE_S_TURNAROUND_US,
        pulses: ppmPulseTimesUs(bits).map((t, i) => ({ name: i < 4 ? 'pre' : 'bit', tUs: t, widthUs: MODE_S_PULSE_US })),
        lengthUs: modeSReplyUs(56),
      })
    }
  }
  const uplinkEndUs = Math.max(...uplink.map((p) => p.tUs + p.widthUs))
  // Pulses at the radar, µs after the reference (P3): the decoder sees every reply at once.
  const atRadar: number[] = []
  if (kind === 'ac') for (const r of replies) for (const p of r.pulses) atRadar.push(r.startUs + travelTimeUs(r.slantNm) + p.tUs - refUs)
  const decodedAC = kind === 'ac' ? decodeReplyPulses(atRadar) : []
  const tr = replies.find((r) => r.id === targetId)
  const lastArrival = Math.max(tAt + uplinkEndUs + 10, ...replies.map((r) => r.startUs + travelTimeUs(r.slantNm) + r.lengthUs))
  const totalUs = lastArrival + 4
  const lengthNm = Math.min(Math.max(10, ...all.filter((h) => h.replies || h.id === targetId).map((h) => h.slantNm * 1.12)), 130)

  // Playback speed: slow where pulses are being sent or received, faster while they travel.
  const focusRate = kind === 'ac' ? FOCUS_AC_US_PER_S : FOCUS_S_US_PER_S
  const travelRate = Math.max(30, tAt / 2.4)
  const focus: [number, number, string][] = [[0, uplinkEndUs + 1, 'The question leaves the radar']]
  focus.push([tAt - 1.5, tAt + uplinkEndUs + 1.5, 'The question reaches the aircraft'])
  if (tr) {
    focus.push([tr.startUs - 1.5, tr.startUs + tr.lengthUs + 1.5, 'The transponder answers'])
    const back = tr.startUs + travelTimeUs(tr.slantNm)
    focus.push([back - 1.5, back + tr.lengthUs + 1.5, 'The answer reaches the radar'])
  }
  focus.sort((x, y) => x[0] - y[0])
  const segments: Segment[] = []
  let cursor = 0
  for (const [f0, f1, note] of focus) {
    const from = Math.max(cursor, f0)
    if (from > cursor) {
      const waiting = kind === 's' && tr && from > tAt && from <= tr.startUs
      segments.push({ from: cursor, to: from, usPerS: waiting ? 64 : travelRate, note: waiting ? 'The transponder waits 128 µs' : 'Travelling at the speed of light' })
    }
    if (f1 > from) segments.push({ from, to: f1, usPerS: focusRate, note })
    cursor = Math.max(cursor, f1)
  }
  if (cursor < totalUs) segments.push({ from: cursor, to: totalUs, usPerS: travelRate, note: 'Travelling at the speed of light' })

  return {
    kind,
    ask,
    targetId,
    callsign: a.callsign,
    azDeg: az,
    lengthNm,
    heard,
    target,
    uplink,
    uplinkEndUs,
    replies,
    refUs,
    tAtTarget: tAt,
    totalUs,
    tUs: 0,
    segments,
    decodedAC,
    modeS,
  }
}

export function replaySegment(rp: SsrReplay): Segment {
  return rp.segments.find((s) => rp.tUs >= s.from && rp.tUs < s.to) ?? rp.segments[rp.segments.length - 1]
}

/** Advance a replay by a real frame time. */
export function advanceReplay(rp: SsrReplay, realDt: number) {
  const seg = replaySegment(rp)
  rp.tUs = Math.min(rp.totalUs, rp.tUs + Math.min(realDt, 0.1) * seg.usPerS)
}

export function SlowMotion({ replayRef }: { replayRef: React.RefObject<SsrReplay | null> }) {
  const { engine, clock } = useSsr()
  const replay = useSsrState((s) => s.replay)
  const setReplay = useSsrState((s) => s.setReplay)
  const selectedId = useSsrState((s) => s.selectedId)
  const mode = useSsrState((s) => s.params.mode)
  // Re-render when the in-trail pair (CNS606) is added or removed, so its button appears.
  useSsrState((s) => s.env.garblePair)

  const arm = (id: string) => {
    const a = engine.getAircraft(id)
    if (!a) return
    const wasRunning = clock.getState().running
    clock.getState().play()
    replayRef.current = null
    setReplay({ phase: 'armed', targetId: id, resume: wasRunning })
  }
  const stop = () => {
    replayRef.current = null
    if (replay.resume !== false) clock.getState().play()
    setReplay({ phase: 'idle' })
  }
  const again = () => {
    if (replayRef.current) replayRef.current.tUs = 0
  }

  const draw: DrawFn = useCallback(
    (ctx, { width, height, tokens: t }) => {
      ctx.fillStyle = t['sim-bg']
      ctx.fillRect(0, 0, width, height)
      const rp = replayRef.current
      if (!rp) {
        ctx.fillStyle = t['sim-muted']
        ctx.font = `500 13px ${t.fontSans}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        const msg = width < 460 ? ['Choose an aircraft above to follow', 'one question and its answer.'] : ['Choose an aircraft above to follow one question to it and its answer back.']
        msg.forEach((m, i) => ctx.fillText(m, width / 2, height / 2 + (i - (msg.length - 1) / 2) * 18))
        return
      }
      drawReplay(ctx, width, t, rp)
    },
    [replayRef],
  )

  const status = useSampled(
    () => {
      const rp = replayRef.current
      if (!rp) return null
      const seg = replaySegment(rp)
      return {
        t: Math.floor(rp.tUs),
        done: rp.tUs >= rp.totalUs,
        note: seg.note,
        rate: slowMotionLabel({ realSecondsPerMicrosecond: 1 / seg.usPerS }),
        steps: replaySteps(rp),
      }
    },
    150,
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  )

  const describe = status ? status.steps.join(' ') : 'Slow-motion view waiting.'

  return (
    <div className="hud-panel flex flex-col gap-3 rounded-md p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">One question and its answer, in slow motion</h3>
          <p className="text-xs text-muted-foreground">Time freezes while we follow the pulses up at 1030 MHz and the reply back at 1090 MHz.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {replay.phase === 'replay' && (
            <>
              <Button size="sm" variant="outline" onClick={again}>
                <RotateCcw aria-hidden /> Replay
              </Button>
              <Button size="sm" onClick={stop}>
                <Play aria-hidden /> Back to live
              </Button>
            </>
          )}
          {replay.phase === 'armed' && (
            <Button size="sm" variant="outline" onClick={() => setReplay({ phase: 'idle' })}>
              <Square aria-hidden /> Cancel
            </Button>
          )}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Send an interrogation to an aircraft">
          <span className="text-xs font-medium text-muted-foreground">Ask:</span>
          {engine.aircraft.map((a) => (
            <Button
              key={a.id}
              size="sm"
              variant={replay.targetId === a.id && replay.phase !== 'idle' ? 'default' : a.id === selectedId ? 'secondary' : 'outline'}
              onClick={() => arm(a.id)}
              disabled={replay.phase === 'armed'}
            >
              <Crosshair aria-hidden /> {a.callsign}
            </Button>
          ))}
        </div>
        <div className="sm:w-64">
          <ControlChoice
            label="Question"
            value={replay.ask}
            onChange={(v) => setReplay({ ask: v })}
            options={[
              { value: 'A', label: mode === 's' ? 'Identity (DF5)' : 'Identity (Mode A)' },
              { value: 'C', label: mode === 's' ? 'Altitude (DF4)' : 'Altitude (Mode C)' },
            ]}
          />
        </div>
      </div>
      <div className="relative">
        <Canvas2D draw={draw} label={describe} className="h-[400px] w-full rounded-md border" />
        <div className="pointer-events-none absolute top-2 left-2 flex max-w-[calc(100%-1rem)] flex-wrap gap-1.5">
          {replay.phase === 'replay' && status && (
            <SimLabel>
              Slowed down so you can see it · {status.done ? 'Finished: press Replay, or Back to live' : status.rate}
            </SimLabel>
          )}
          {replay.phase === 'armed' && <SimLabel icon="none">Waiting for the antenna to point at {replay.targetId}…</SimLabel>}
        </div>
      </div>
      {status && (
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm" aria-live="polite">
          {status.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      )}
    </div>
  )
}

/** Plain-language steps revealed as the replay reaches them. */
function replaySteps(rp: SsrReplay): string[] {
  const out: string[] = []
  const t = rp.tUs
  const tg = rp.target
  const tr = rp.replies.find((r) => r.id === rp.targetId)
  if (rp.kind === 'ac') {
    out.push(
      `P1, ${rp.uplink.some((p) => p.name === 'P2') ? 'P2 (from the control antenna) ' : 'no P2 (control antenna off) '}and P3 leave on 1030 MHz. P1 to P3 is ${P1_P3_US[rp.ask]} µs, which means "${rp.ask === 'A' ? 'Mode A: who are you?' : 'Mode C: how high are you?'}"`,
    )
  } else {
    out.push(`A Mode S roll-call leaves on 1030 MHz: P1, P2 and the long P6 pulse carrying ${rp.callsign}'s 24-bit address (${formatIcaoAddress(rp.modeS?.address ?? 0)}).`)
  }
  if (t >= rp.tAtTarget) {
    out.push(`The pulses reach ${rp.callsign} after ${rp.tAtTarget.toFixed(1)} µs (${tg.slantNm.toFixed(1)} NM away).`)
    if (rp.kind === 'ac') {
      if (tg.decision === 'off') out.push(`${rp.callsign}'s transponder is off, so nothing answers.`)
      else if (tg.p2Dbm == null) out.push(`There is no P2 to compare with, so the transponder simply answers.`)
      else {
        const d = tg.p1Dbm - tg.p2Dbm
        out.push(
          d >= 9
            ? `P1 is ${d.toFixed(0)} dB stronger than P2, so the transponder knows it is in the main beam and answers.`
            : d <= 0
              ? `P2 is as strong as P1 or stronger: this is a side lobe, so the transponder stays silent.`
              : `P1 is only ${d.toFixed(0)} dB above P2: at the edge of the beam it may or may not answer.`,
        )
      }
      const others = rp.replies.filter((r) => r.id !== rp.targetId)
      if (others.length) out.push(`Mode A/C asks everyone in the beam: ${others.map((r) => `${r.callsign} (${r.slantNm.toFixed(1)} NM)`).join(', ')} answers too.`)
    } else {
      out.push(tg.replies ? `The address matches, so ${rp.callsign} answers. Every other transponder ignores the question.` : `${rp.callsign}'s transponder is off, so nothing answers.`)
    }
  }
  if (tr && t >= tr.startUs) {
    out.push(
      rp.kind === 'ac'
        ? `${TRANSPONDER_DELAY_US} µs after P3 it sends its reply on 1090 MHz: F1, the code pulses, F2${tg.spi ? ' and the SPI (ident) pulse' : ''}.`
        : `${MODE_S_TURNAROUND_US} µs after the sync phase reversal it sends a 56-bit reply (DF${rp.ask === 'A' ? 5 : 4}) on 1090 MHz.`,
    )
  }
  if (tr) {
    const back = tr.startUs + travelTimeUs(tr.slantNm)
    if (t >= back + tr.lengthUs) {
      const meas = back - rp.refUs
      if (rp.kind === 'ac') {
        out.push(`F1 arrives ${meas.toFixed(1)} µs after P3 left. Take away the ${TRANSPONDER_DELAY_US} µs delay, halve, multiply by the speed of light: ${rangeFromReplyUs(meas).toFixed(1)} NM.`)
        const mine = rp.decodedAC.find((d) => Math.abs(d.f1Us - meas) < 0.1)
        if (mine) {
          const value = rp.ask === 'A' ? `squawk ${bitsToSquawk(mine.bits)}` : (() => {
            const alt = decodeGillham(mine.bits)
            return alt == null ? 'an illegal altitude code' : `${alt.toLocaleString('en-US')} ft`
          })()
          out.push(mine.garbled ? `Another reply overlapped it, so the pulses are mixed up: the radar marks it garbled (it read ${value}).` : `Decoded: ${value}.`)
        } else out.push('The reply was lost in overlapping pulses.')
      } else if (rp.modeS) {
        const d = rp.modeS.decoded
        out.push(`The preamble arrives ${meas.toFixed(1)} µs after the sync phase reversal: (${meas.toFixed(1)} − 128) ÷ 2 × c = ${rangeFromRoundTripNm(meas - MODE_S_TURNAROUND_US).toFixed(1)} NM.`)
        out.push(`Decoded: address ${formatIcaoAddress(d.address)}${d.code ? `, squawk ${d.code}` : ''}${d.altitudeFt != null ? `, ${d.altitudeFt.toLocaleString('en-US')} ft (25 ft steps)` : ''}. No other aircraft answered, so nothing can overlap.`)
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function drawReplay(ctx: CanvasRenderingContext2D, width: number, t: ThemeTokens, rp: SsrReplay) {
  const narrow = width < 520
  const padL = 46
  const padR = 14
  const w = width - padL - padR
  const L = rp.lengthNm
  const xOf = (nm: number) => padL + (nm / L) * w
  const c = 1 / travelTimeUs(1) // NM per µs
  const now = rp.tUs
  const laneY = 88

  // --- Space lane --------------------------------------------------------
  ctx.strokeStyle = t['sim-grid-strong']
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(padL, laneY)
  ctx.lineTo(xOf(L), laneY)
  ctx.stroke()
  ctx.fillStyle = t['sim-signal']
  ctx.beginPath()
  ctx.arc(padL - 18, laneY, 7, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = t['sim-ink']
  ctx.font = `600 10px ${t.fontSans}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText('Radar', padL - 18, laneY + 10)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.fillStyle = t['sim-signal']
  ctx.fillText('Question on 1030 MHz →', padL + 2, laneY - 34)
  ctx.textBaseline = 'top'
  ctx.fillStyle = t['sim-signal-2']
  ctx.fillText('← Answer on 1090 MHz', padL + 2, laneY + 34)

  // Aircraft along the beam (labels staggered when two are close together).
  const shown = rp.heard
    .filter((h) => (h.id === rp.targetId || rp.replies.some((r) => r.id === h.id)) && h.slantNm <= L)
    .sort((a, b) => a.slantNm - b.slantNm)
  let prevX = -Infinity
  let row = 0
  for (const h of shown) {
    const isTarget = h.id === rp.targetId
    const x = xOf(h.slantNm)
    row = x - prevX < 56 ? row + 1 : 0
    prevX = x
    ctx.fillStyle = isTarget ? t['sim-ink'] : withAlpha(t['sim-ink'], 0.6)
    ctx.beginPath()
    ctx.moveTo(x, laneY - 9)
    ctx.lineTo(x + 5, laneY + 5)
    ctx.lineTo(x - 5, laneY + 5)
    ctx.closePath()
    ctx.fill()
    ctx.font = `${isTarget ? 700 : 500} 11px ${t.fontSans}`
    ctx.textAlign = row % 2 ? 'left' : 'center'
    ctx.textBaseline = 'bottom'
    ctx.fillText(h.callsign, x + (row % 2 ? 6 : 0), laneY - 46 + (row % 2) * 13)
  }

  // Uplink pulses travelling right (drawn to scale: 1 µs of pulse = 0.16 NM).
  let lastLabelX = Infinity
  for (const p of rp.uplink) {
    const lead = (now - p.tUs) * c
    const tail = (now - p.tUs - p.widthUs) * c
    if (lead <= 0 || tail > L) continue
    const x0 = xOf(Math.max(0, tail))
    const x1 = xOf(Math.min(L, lead))
    ctx.fillStyle = p.name === 'P2' && rp.kind === 'ac' ? t['sim-warning'] : t['sim-signal']
    ctx.fillRect(x0, laneY - 26, Math.max(1.5, x1 - x0), p.name === 'P2' && rp.kind === 'ac' ? 10 : 22)
    const lx = (x0 + x1) / 2
    if (Math.abs(lx - lastLabelX) >= 14) {
      ctx.font = `600 9px ${t.fontSans}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      ctx.fillStyle = t['sim-ink']
      ctx.fillText(p.name, lx, laneY - 27)
      lastLabelX = lx
    }
  }
  // Replies travelling left.
  for (const r of rp.replies) {
    for (const p of r.pulses) {
      const dist0 = (now - r.startUs - p.tUs) * c
      const dist1 = (now - r.startUs - p.tUs - p.widthUs) * c
      if (dist0 <= 0 || dist1 > r.slantNm) continue
      const n0 = r.slantNm - Math.min(r.slantNm, dist0)
      const n1 = r.slantNm - Math.max(0, dist1)
      ctx.fillStyle = r.id === rp.targetId ? t['sim-signal-2'] : withAlpha(t['sim-signal-2'], 0.55)
      ctx.fillRect(xOf(n0), laneY + 4, Math.max(1.5, xOf(n1) - xOf(n0)), 22)
    }
  }
  // Range axis.
  ctx.fillStyle = t['sim-muted']
  ctx.font = `500 10px ${t.fontMono}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  const step = L > 80 ? 20 : L > 40 ? 10 : 5
  for (let r = 0; r <= L + 1e-6; r += step) ctx.fillText(`${r} NM`, xOf(r), laneY + 52)

  // --- Timelines ------------------------------------------------------------
  const tg = rp.target
  const tr = rp.replies.find((r) => r.id === rp.targetId)
  const stripH = 104
  const aTop = 150
  const bTop = aTop + stripH + 18

  // Strip A: at the aircraft (local time, µs after P1 arrives).
  const aEnd = rp.kind === 'ac' ? (tr ? tr.startUs - rp.tAtTarget + tr.lengthUs + 2 : rp.uplinkEndUs + 12) : rp.uplinkEndUs + 4
  const aStart = -2
  const aCursor = now - rp.tAtTarget
  strip(ctx, t, padL, aTop, w, stripH, `At ${rp.callsign}: ${rp.kind === 'ac' ? 'question heard, answer sent' : 'the question arrives'}`, aStart, aEnd, aCursor, (xT, base, h) => {
    const maxDb = Math.max(tg.p1Dbm, tg.p2Dbm ?? -200)
    const hOf = (db: number) => Math.max(4, Math.min(1, (db - (maxDb - 40)) / 40) * (h - 60))
    for (const p of rp.uplink) {
      if (aCursor < p.tUs) continue
      const lvl = rp.kind === 'ac' && p.name === 'P2' ? (tg.p2Dbm ?? -200) : tg.p1Dbm
      const x0 = xT(p.tUs)
      const x1 = xT(Math.min(aCursor, p.tUs + p.widthUs))
      const hh = hOf(lvl)
      ctx.fillStyle = rp.kind === 'ac' && p.name === 'P2' ? t['sim-warning'] : t['sim-signal']
      ctx.fillRect(x0, base - hh, Math.max(1.5, x1 - x0), hh)
      ctx.fillStyle = t['sim-ink']
      ctx.font = `600 9px ${t.fontSans}`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'bottom'
      ctx.fillText(p.name, x0, base - hh - 1)
    }
    if (rp.kind === 's' && aCursor >= MODE_S_P6_START_US + MODE_S_SPR_AFTER_P6_US) {
      const xs = xT(MODE_S_P6_START_US + MODE_S_SPR_AFTER_P6_US)
      ctx.strokeStyle = t['sim-bg']
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(xs, base)
      ctx.lineTo(xs, base - hOf(tg.p1Dbm))
      ctx.stroke()
      ctx.fillStyle = t['sim-ink']
      ctx.font = `500 9px ${t.fontSans}`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText(narrow ? 'sync' : 'sync phase reversal (timing mark)', xs + 3, base + 2)
      ctx.fillText(narrow ? 'address inside P6' : 'the data and address are inside P6', xT(11), base + 2)
    }
    if (rp.kind === 'ac' && tr) {
      const p3 = P1_P3_US[rp.ask]
      const f1 = tr.startUs - rp.tAtTarget
      if (aCursor >= p3 + 0.8) {
        ctx.strokeStyle = t['sim-muted']
        ctx.lineWidth = 1
        const y = base - 8
        ctx.beginPath()
        ctx.moveTo(xT(p3), y)
        ctx.lineTo(xT(Math.min(aCursor, f1)), y)
        ctx.stroke()
        ctx.fillStyle = t['sim-muted']
        ctx.font = `500 9px ${t.fontSans}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'bottom'
        ctx.fillText('3 µs', xT(p3 + 1.5), y - 1)
      }
      for (const p of tr.pulses) {
        const tp = f1 + p.tUs
        if (aCursor < tp) continue
        const x0 = xT(tp)
        const x1 = xT(Math.min(aCursor, tp + p.widthUs))
        ctx.fillStyle = t['sim-signal-2']
        ctx.fillRect(x0, base - (h - 60), Math.max(1.5, x1 - x0), h - 60)
        if (!narrow || p.name === 'F1' || p.name === 'F2') {
          ctx.fillStyle = t['sim-ink']
          ctx.font = `600 8.5px ${t.fontSans}`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'bottom'
          ctx.fillText(p.name, x0 + 1, base - (h - 60) - 1)
        }
      }
    }
  })

  // Strip B: at the radar (µs after the reference pulse left).
  if (tr) {
    const back = tr.startUs + travelTimeUs(tr.slantNm) - rp.refUs
    const bStart = back - 3
    const bEnd = back + tr.lengthUs + 3
    const bCursor = now - rp.refUs
    strip(ctx, t, padL, bTop, w, stripH, `At the radar: ${rp.kind === 'ac' ? 'µs after P3 left' : 'µs after the sync phase reversal left'}`, bStart, bEnd, bCursor, (xT, base, h) => {
      for (const r of rp.replies) {
        const arr = r.startUs + travelTimeUs(r.slantNm) - rp.refUs
        for (const p of r.pulses) {
          const tp = arr + p.tUs
          if (tp < bStart || tp > bEnd || bCursor < tp) continue
          const x0 = xT(tp)
          const x1 = xT(Math.min(bCursor, tp + p.widthUs))
          const mine = r.id === rp.targetId
          const hh = mine ? h - 60 : h - 72
          if (mine) {
            ctx.fillStyle = t['sim-signal-2']
            ctx.fillRect(x0, base - hh, Math.max(1.5, x1 - x0), hh)
            if (rp.kind === 'ac' && (!narrow || p.name === 'F1' || p.name === 'F2')) {
              ctx.fillStyle = t['sim-ink']
              ctx.font = `600 8.5px ${t.fontSans}`
              ctx.textAlign = 'center'
              ctx.textBaseline = 'bottom'
              ctx.fillText(p.name, x0 + 1, base - hh - 1)
            }
          } else {
            ctx.strokeStyle = t['sim-warning']
            ctx.lineWidth = 1.2
            ctx.strokeRect(x0, base - hh, Math.max(1.5, x1 - x0), hh)
          }
        }
        if (r.id !== rp.targetId && arr < bEnd && arr + r.lengthUs > bStart && bCursor >= arr) {
          ctx.fillStyle = t['sim-warning']
          ctx.font = `600 9.5px ${t.fontSans}`
          ctx.textAlign = 'right'
          ctx.textBaseline = 'top'
          ctx.fillText(narrow ? `Outlined: ${r.callsign}` : `Outlined: ${r.callsign}'s reply, on top of it`, xT(bEnd) - 6, base - h + (narrow ? 48 : 35))
        }
      }
      if (bCursor >= back) {
        const x = xT(back)
        ctx.fillStyle = t['sim-ink']
        ctx.font = `600 10px ${t.fontMono}`
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        ctx.fillText(`${back.toFixed(1)} µs`, x + 2, base + 2)
      }
      if (rp.kind === 's' && bCursor >= back + tr.lengthUs) {
        // Field boundaries of the 56-bit reply.
        const fields: [string, number][] = [['DF', 5], ['FS', 3], ['DR', 5], ['UM', 6], [rp.ask === 'A' ? 'ID' : 'AC', 13], ['AP (address + parity)', 24]]
        let bit = 0
        ctx.font = `500 9px ${t.fontSans}`
        ctx.textBaseline = 'top'
        for (const [name, n] of fields) {
          const x0 = xT(back + 8 + bit)
          const x1 = xT(back + 8 + bit + n)
          ctx.strokeStyle = t['sim-grid-strong']
          ctx.beginPath()
          ctx.moveTo(x0, base + 13)
          ctx.lineTo(x0, base + 19)
          ctx.moveTo(x0, base + 16)
          ctx.lineTo(x1, base + 16)
          ctx.stroke()
          ctx.fillStyle = t['sim-muted']
          ctx.textAlign = 'center'
          if (!narrow || n >= 13) ctx.fillText(narrow && n === 24 ? 'AP' : name, (x0 + x1) / 2, base + 18)
          bit += n
        }
      }
    })
  } else if (now >= rp.tAtTarget + 2) {
    ctx.fillStyle = t['sim-muted']
    ctx.font = `500 12px ${t.fontSans}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(`No answer from ${rp.callsign}.`, padL + w / 2, bTop + stripH / 2)
  }
}

function strip(
  ctx: CanvasRenderingContext2D,
  t: ThemeTokens,
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
  t0: number,
  t1: number,
  cursor: number,
  body: (xT: (us: number) => number, base: number, h: number) => void,
) {
  ctx.fillStyle = withAlpha(t['sim-grid'], 0.35)
  ctx.fillRect(x, y, w, h)
  ctx.strokeStyle = t['sim-grid']
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
  ctx.fillStyle = t['sim-ink']
  ctx.font = `600 10.5px ${t.fontSans}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(title, x + 6, y + 5)
  const xT = (us: number) => x + ((us - t0) / (t1 - t0)) * w
  const base = y + h - 30
  ctx.strokeStyle = t['sim-grid-strong']
  ctx.beginPath()
  ctx.moveTo(x, base)
  ctx.lineTo(x + w, base)
  ctx.stroke()
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()
  body(xT, base, h)
  // Cursor: "now".
  if (cursor >= t0 && cursor <= t1) {
    ctx.strokeStyle = t['primary']
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(xT(cursor), y + 18)
    ctx.lineTo(xT(cursor), base)
    ctx.stroke()
  }
  ctx.restore()
  // Time ticks.
  ctx.fillStyle = t['sim-muted']
  ctx.font = `500 9px ${t.fontMono}`
  ctx.textAlign = 'right'
  ctx.textBaseline = 'bottom'
  ctx.fillText(`${(t1 - t0).toFixed(0)} µs shown`, x + w - 4, y + h - 3)
}
