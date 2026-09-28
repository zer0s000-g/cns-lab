import { useCallback } from 'react'
import { Canvas2D, type DrawFn } from '@/components/sim/Canvas2D'
import { ClockSpeedLabel, SimLabel } from '@/components/sim/Controls'
import { drawAircraftIcon, haloText } from '@/components/sim/mapDraw'
import { deliveryRangeS } from '@/core/cpdlc'
import { useSampled } from '@/hooks/useSampled'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { withAlpha } from '@/lib/color'
import { EXTRA_DELAY_S, type CpdlcEngine, type Transit } from './engine'
import { useCpdlc, useCpdlcState } from './state'

interface P {
  x: number
  y: number
}

/** Node positions for the current path (CSS pixels). */
function layout(e: CpdlcEngine, w: number, h: number) {
  const narrow = w < 560
  const xlab = { x: narrow ? 40 : 58, y: h * 0.3 }
  const xhbr = { x: narrow ? 40 : 58, y: h * 0.7 }
  const net = { x: narrow ? w * 0.4 : w * 0.3, y: h * 0.52 }
  const ac = { x: w - (narrow ? 84 : 96), y: h * 0.24 }
  const other = { x: w - (narrow ? 84 : 96), y: h * 0.62 }
  let relay: P[]
  if (e.path === 'satcom') {
    const ges = { x: w * 0.52, y: h * 0.74 }
    const sat = { x: w * 0.66, y: h * 0.14 }
    relay = [ges, sat]
  } else if (e.path === 'hf') {
    const st = { x: w * 0.55, y: h * 0.74 }
    const iono = { x: (st.x + ac.x) / 2, y: h * 0.12 }
    relay = [st, iono]
  } else {
    relay = [{ x: w * 0.6, y: h * 0.74 }]
  }
  return { xlab, xhbr, net, ac, other, relay }
}

/** Polyline a message follows, from sender to receiver. */
function route(t: Transit, L: ReturnType<typeof layout>): P[] {
  const centre = (id: string) => (id === 'XHBR' ? L.xhbr : L.xlab)
  const air = (id: string) => (id === 'CNS132' ? L.other : L.ac)
  if (t.kind === 'forward') return [L.xlab, L.xhbr]
  const ground = t.from === 'XLAB' || t.from === 'XHBR'
  const c = centre(ground ? t.from : t.to)
  const a = air(ground ? t.to : t.from)
  const pts = [c, L.net, ...L.relay, a]
  return ground ? pts : pts.reverse()
}

function along(pts: P[], f: number): P {
  const segs = pts.slice(1).map((p, k) => Math.hypot(p.x - pts[k].x, p.y - pts[k].y))
  const total = segs.reduce((a, b) => a + b, 0)
  let d = Math.max(0, Math.min(1, f)) * total
  for (let k = 0; k < segs.length; k++) {
    if (d <= segs[k]) {
      const u = segs[k] > 0 ? d / segs[k] : 0
      return { x: pts[k].x + (pts[k + 1].x - pts[k].x) * u, y: pts[k].y + (pts[k + 1].y - pts[k].y) * u }
    }
    d -= segs[k]
  }
  return pts[pts.length - 1]
}

function node(ctx: CanvasRenderingContext2D, p: P, label: string, sub: string, t: ThemeTokens, kind: 'centre' | 'net' | 'tower' | 'dish' | 'sat' | 'iono') {
  ctx.save()
  ctx.fillStyle = t['sim-ink']
  ctx.strokeStyle = t['sim-ink']
  ctx.lineWidth = 2
  if (kind === 'centre') {
    ctx.fillStyle = t['sim-land']
    ctx.strokeStyle = t['sim-ink']
    ctx.beginPath()
    ctx.roundRect(p.x - 22, p.y - 14, 44, 28, 4)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = t['sim-ink']
    ctx.fillRect(p.x - 12, p.y - 6, 24, 10)
  } else if (kind === 'net') {
    ctx.fillStyle = t['sim-land']
    ctx.beginPath()
    ctx.ellipse(p.x, p.y, 28, 14, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  } else if (kind === 'tower') {
    ctx.beginPath()
    ctx.moveTo(p.x - 9, p.y + 14)
    ctx.lineTo(p.x, p.y - 16)
    ctx.lineTo(p.x + 9, p.y + 14)
    ctx.moveTo(p.x - 5, p.y)
    ctx.lineTo(p.x + 5, p.y)
    ctx.stroke()
  } else if (kind === 'dish') {
    ctx.beginPath()
    ctx.moveTo(p.x - 12, p.y - 10)
    ctx.quadraticCurveTo(p.x, p.y + 8, p.x + 12, p.y - 10)
    ctx.stroke()
    ctx.fillRect(p.x - 2, p.y, 4, 14)
  } else if (kind === 'sat') {
    ctx.fillRect(p.x - 5, p.y - 5, 10, 10)
    ctx.fillStyle = t['sim-signal-2']
    ctx.fillRect(p.x - 22, p.y - 2, 14, 4)
    ctx.fillRect(p.x + 8, p.y - 2, 14, 4)
  } else {
    // The ionosphere: a dashed layer the HF signal bounces off.
    ctx.strokeStyle = t['sim-grid-strong']
    ctx.setLineDash([3, 4])
    ctx.beginPath()
    ctx.moveTo(p.x - 120, p.y + 18)
    ctx.quadraticCurveTo(p.x, p.y - 12, p.x + 120, p.y + 18)
    ctx.stroke()
    ctx.setLineDash([])
  }
  ctx.restore()
  haloText(ctx, label, p.x, p.y + (kind === 'sat' ? -12 : kind === 'iono' ? 20 : 30), t, { align: 'center', font: `600 11px ${t.fontSans}` })
  if (sub) haloText(ctx, sub, p.x, p.y + (kind === 'sat' ? -24 : kind === 'iono' ? 27 : 43), t, { align: 'center', font: `500 10px ${t.fontSans}`, color: t['sim-muted'] })
}

/** Where each message is right now: from the controller, over the network and the radio or satellite path, to the aircraft. */
export function PathView() {
  const { engine, clock } = useCpdlc()
  const path = useCpdlcState((s) => s.path)
  const delay = useCpdlcState((s) => s.env.delay)
  const wrong = useCpdlcState((s) => s.env.wrongAircraft)

  const draw: DrawFn = useCallback(
    (ctx, { width: w, height: h, tokens: t }) => {
      const e = engine
      ctx.fillStyle = t['sim-bg']
      ctx.fillRect(0, 0, w, h)
      const L = layout(e, w, h)
      // Links.
      const line = (pts: P[], color: string, dash: number[] = []) => {
        ctx.strokeStyle = color
        ctx.lineWidth = 1.5
        ctx.setLineDash(dash)
        ctx.beginPath()
        pts.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
        ctx.stroke()
        ctx.setLineDash([])
      }
      const lost = e.env.lost
      line([L.xlab, L.net], t['sim-grid-strong'])
      line([L.xhbr, L.net], t['sim-grid-strong'])
      line([L.xlab, L.xhbr], t['sim-grid-strong'], [2, 4])
      line([L.net, ...L.relay], t['sim-grid-strong'])
      line([L.relay[L.relay.length - 1], L.ac], lost ? withAlpha(t['sim-alert'], 0.8) : t['sim-signal'], lost ? [4, 5] : e.path === 'vhf' ? [] : [6, 4])
      if (e.env.wrongAircraft) line([L.relay[L.relay.length - 1], L.other], withAlpha(t['sim-muted'], 0.8), [2, 5])
      if (lost) {
        const a = L.relay[L.relay.length - 1]
        const m = { x: (a.x + L.ac.x) / 2, y: (a.y + L.ac.y) / 2 }
        ctx.strokeStyle = t['sim-alert']
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.moveTo(m.x - 7, m.y - 7)
        ctx.lineTo(m.x + 7, m.y + 7)
        ctx.moveTo(m.x + 7, m.y - 7)
        ctx.lineTo(m.x - 7, m.y + 7)
        ctx.stroke()
        haloText(ctx, 'Link down', m.x + 10, m.y - 8, t, { color: t['sim-alert'] })
      }

      // Nodes.
      node(ctx, L.xlab, 'XLAB centre', 'you', t, 'centre')
      node(ctx, L.xhbr, 'XHBR centre', 'next', t, 'centre')
      node(ctx, L.net, e.standard === 'fans' ? 'ACARS network' : 'ATN network', '', t, 'net')
      if (e.path === 'satcom') {
        node(ctx, L.relay[0], 'Ground earth station', '', t, 'dish')
        node(ctx, L.relay[1], 'Satellite', '', t, 'sat')
      } else if (e.path === 'hf') {
        node(ctx, L.relay[0], 'HF data link station', '', t, 'tower')
        node(ctx, L.relay[1], 'via the ionosphere', '', t, 'iono')
      } else {
        node(ctx, L.relay[0], e.standard === 'fans' ? 'VHF ground station' : 'VDL Mode 2 station', '', t, 'tower')
      }
      drawAircraftIcon(ctx, L.ac, 270, t, { label: ['CNS123', 'you, as pilot'], size: 10 })
      if (e.env.wrongAircraft) drawAircraftIcon(ctx, L.other, 270, t, { label: ['CNS132', 'nearby'], size: 9, style: 'dim' })

      // Messages in flight.
      const now = e.timeS
      const live = e.transits.slice(-8)
      live.forEach((tr, k) => {
        const pts = route(tr, L)
        const endS = tr.lost ? (tr.lostS ?? now) : now
        const f = (endS - tr.sentS) / Math.max(1e-6, tr.arriveS - tr.sentS)
        const p = along(pts, f)
        if (tr.lost) {
          const fade = Math.max(0, 1 - (now - (tr.lostS ?? now)) / 6)
          ctx.globalAlpha = fade
          ctx.strokeStyle = t['sim-alert']
          ctx.lineWidth = 2.5
          ctx.beginPath()
          ctx.moveTo(p.x - 6, p.y - 6)
          ctx.lineTo(p.x + 6, p.y + 6)
          ctx.moveTo(p.x + 6, p.y - 6)
          ctx.lineTo(p.x - 6, p.y + 6)
          ctx.stroke()
          haloText(ctx, `lost: ${tr.label}`, p.x + 9, p.y - 8, t, { color: t['sim-alert'], font: `600 10px ${t.fontSans}` })
          ctx.globalAlpha = 1
          return
        }
        const up = tr.from === 'XLAB' || tr.from === 'XHBR'
        ctx.fillStyle = up ? t['sim-signal'] : t['sim-ok']
        ctx.strokeStyle = t['sim-bg']
        ctx.lineWidth = 2
        ctx.beginPath()
        if (up) ctx.arc(p.x, p.y, 6, 0, Math.PI * 2)
        else ctx.rect(p.x - 5.5, p.y - 5.5, 11, 11)
        ctx.fill()
        ctx.stroke()
        const left = Math.max(0, tr.arriveS - now)
        const text = tr.label.length > 34 ? `${tr.label.slice(0, 33)}…` : tr.label
        haloText(ctx, `${text} · ${left < 10 ? left.toFixed(1) : Math.round(left)} s`, p.x + 10, p.y - 9 - (k % 2) * 12, t, { font: `600 10px ${t.fontSans}` })
      })

      // Legend.
      ctx.fillStyle = t['sim-signal']
      ctx.beginPath()
      ctx.arc(w - 170, h - 12, 5, 0, Math.PI * 2)
      ctx.fill()
      haloText(ctx, 'to the aircraft', w - 160, h - 8, t, { font: `500 10px ${t.fontSans}`, color: t['sim-muted'] })
      ctx.fillStyle = t['sim-ok']
      ctx.fillRect(w - 88, h - 17, 10, 10)
      haloText(ctx, 'to ATC', w - 72, h - 8, t, { font: `500 10px ${t.fontSans}`, color: t['sim-muted'] })
    },
    [engine],
  )

  const describe = useSampled(() => {
    const n = engine.transits.filter((x) => !x.lost).length
    return `Message path by ${engine.pathName}. ${n ? `${n} message${n === 1 ? '' : 's'} on the way.` : 'No messages on the way.'}${engine.env.lost ? ' The data link is down.' : ''}`
  }, 500)

  const [lo, hi] = deliveryRangeS(path)
  const name = path === 'vhf' ? 'VHF data link' : path === 'satcom' ? 'SATCOM' : 'HF data link'
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">The message path</span>
        <span className="text-xs text-muted-foreground">
          {name}: typically {Math.round(lo)}–{Math.round(hi)} s each way{delay ? `, plus about ${EXTRA_DELAY_S} s of congestion` : ''}
        </span>
      </figcaption>
      <div className="relative">
        <Canvas2D draw={draw} label={describe} className="h-64 w-full rounded-lg border sm:h-56" />
        <div className="pointer-events-none absolute top-2 left-2 flex flex-wrap gap-1.5">
          <ClockSpeedLabel clock={clock} />
          <SimLabel icon="none">Delays are typical, illustrative values</SimLabel>
          {wrong && <SimLabel icon="none">CNS132 hears the radio but keeps only its own messages</SimLabel>}
        </div>
      </div>
    </figure>
  )
}
