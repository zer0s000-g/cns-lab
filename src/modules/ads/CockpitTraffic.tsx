import { useCallback } from 'react'
import { Canvas2D, type DrawFn } from '@/components/sim/Canvas2D'
import { ControlChoice, SimLabel } from '@/components/sim/Controls'
import { Term } from '@/components/Term'
import { displayOffset, relativeAltitudeTag } from '@/core/ads'
import { distanceNm, toRad, type Vec2 } from '@/core/geometry'
import { useSampled } from '@/hooks/useSampled'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { drawAircraftSymbol, drawCompassCard, drawFlag, fmt3 } from '@/instruments/draw'
import { withAlpha } from '@/lib/color'
import { trackState, type AdsbEngine } from './engine'
import { useAds, useAdsState, type CdtiUp } from './state'

/** Own ship's position as its own avionics know it (GNSS, with its error), or null without a fix. */
function ownFix(e: AdsbEngine, id: string | null) {
  const a = e.getAircraft(id)
  if (!a) return null
  if (a.gnss.lost) return { a, pos: null as Vec2 | null }
  return { a, pos: { x: a.pos.x + a.gnss.err.x, y: a.pos.y + a.gnss.err.y } }
}

/**
 * ADS-B In: a cockpit traffic display. Other aircraft are placed from the
 * ADS-B messages this aircraft receives, relative to its own GNSS position.
 */
export function CockpitTraffic() {
  const { engine } = useAds()
  const selectedId = useAdsState((s) => s.selectedId)
  const on = useAdsState((s) => s.adsbIn)
  const up = useAdsState((s) => s.cdtiUp)
  const rangeNm = useAdsState((s) => s.cdtiRangeNm)
  const set = useAdsState((s) => s.set)

  const draw: DrawFn = useCallback(
    (ctx, { width, height, tokens: t }) => drawCdti(ctx, width, height, t, engine, selectedId, on, up, rangeNm),
    [engine, selectedId, on, up, rangeNm],
  )

  const info = useSampled(() => {
    const f = ownFix(engine, selectedId)
    if (!f) return null
    const traffic = [...engine.air.tracks.values()].filter((tr) => tr.pos && trackState(tr, engine.timeS) !== 'no-position')
    return { id: f.a.callsign, n: traffic.length, lost: !f.pos, names: traffic.map((tr) => tr.callsign ?? '?').join(', ') }
  }, 400)

  const label = !on
    ? 'Cockpit traffic display switched off.'
    : info?.lost
      ? `${info.id}'s traffic display: own GNSS position lost, traffic cannot be placed.`
      : `${info?.id ?? 'Own ship'}'s traffic display, ${up === 'track' ? 'track up' : 'north up'}, ${rangeNm} nautical mile range. Traffic received: ${info?.names || 'none'}.`

  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-4">
      <div>
        <h3 className="text-sm font-semibold">
          <Term id="ads-b-in">ADS-B In</Term>: the cockpit of {info?.id ?? '—'}
        </h3>
        <p className="text-xs text-muted-foreground">Traffic the pilot sees, placed from the ADS-B messages this aircraft picks up itself.</p>
      </div>
      <div className="relative mx-auto w-full max-w-[340px]">
        <Canvas2D draw={draw} label={label} className="aspect-square w-full rounded-lg bg-instrument-bezel" />
        <div className="pointer-events-none absolute bottom-2 left-2">
          <SimLabel icon="none">{up === 'track' ? 'Track up · true' : 'North up · true'}</SimLabel>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <ControlChoice
          label="Orientation"
          value={up}
          onChange={(v) => set({ cdtiUp: v })}
          options={[
            { value: 'track', label: 'Track up' },
            { value: 'north', label: 'North up' },
          ]}
        />
        <ControlChoice
          label="Range"
          value={String(rangeNm)}
          onChange={(v) => set({ cdtiRangeNm: Number(v) })}
          options={[
            { value: '10', label: '10' },
            { value: '20', label: '20' },
            { value: '40', label: '40' },
          ]}
        />
      </div>
    </div>
  )
}

function drawCdti(ctx: CanvasRenderingContext2D, width: number, height: number, t: ThemeTokens, e: AdsbEngine, ownId: string | null, on: boolean, up: CdtiUp, rangeNm: number) {
  const s = Math.min(width, height)
  const cx = width / 2
  const cy = height / 2
  const R = s * 0.43
  ctx.fillStyle = t['instrument-bezel']
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = t['instrument-face']
  ctx.beginPath()
  ctx.arc(cx, cy, R + 12, 0, Math.PI * 2)
  ctx.fill()
  const f = ownFix(e, ownId)
  if (!on || !f) {
    drawFlag(ctx, cx - 58, cy - 12, 116, 24, on ? 'NO OWN SHIP' : 'ADS-B IN OFF', t)
    return
  }
  const own = f.a
  // TRUE references throughout (the simulated world has no magnetic variation table).
  const upDeg = up === 'track' ? own.headingDeg : 0
  drawCompassCard(ctx, cx, cy, R + 8, -upDeg, t, { fontScale: 0.8 })
  // Range rings: the traffic area sits inside the compass numerals.
  const Rt = R * 0.64
  ctx.strokeStyle = t['instrument-dim']
  ctx.lineWidth = 1
  ctx.setLineDash([2, 4])
  for (const k of [0.5, 1]) {
    ctx.beginPath()
    ctx.arc(cx, cy, Rt * k, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.setLineDash([])
  ctx.fillStyle = t['instrument-dim']
  ctx.font = `600 10px ${t.fontMono}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  for (const k of [0.5, 1]) {
    const d = Rt * k * Math.SQRT1_2
    ctx.fillText(`${rangeNm * k}`, cx + d + 2, cy + d + 1)
  }
  const pxPerNm = Rt / rangeNm

  // Header: heading readout.
  // Header in the free top-left corner of the bezel.
  ctx.fillStyle = t['instrument-marking']
  ctx.font = `700 11px ${t.fontMono}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(up === 'track' ? 'TRK UP' : 'N UP', 8, 7)
  ctx.fillStyle = t['instrument-accent']
  ctx.fillText(`${fmt3(own.headingDeg)}°T`, 8, 21)

  if (!f.pos) {
    drawFlag(ctx, cx - 62, cy + 18, 124, 24, 'NO OWN POSITION', t)
  } else {
    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, Rt + 6, 0, Math.PI * 2)
    ctx.clip()
    for (const tr of e.air.tracks.values()) {
      if (!tr.pos || trackState(tr, e.timeS) === 'no-position') continue
      if (distanceNm(f.pos, tr.pos) > rangeNm * 1.05) continue
      const d = displayOffset(f.pos, upDeg, tr.pos)
      const x = cx + d.x * pxPerNm
      const y = cy - d.y * pxPerNm
      const tag = relativeAltitudeTag(own.altitudeFt, tr.altFt ?? own.altitudeFt)
      const stale = trackState(tr, e.timeS) === 'coast'
      const col = stale ? t['instrument-dim'] : t['instrument-accent']
      // Arrowhead pointing along the traffic's track (relative to the display).
      ctx.save()
      ctx.translate(x, y)
      if (tr.trackDeg != null) ctx.rotate(toRad(tr.trackDeg - upDeg))
      ctx.fillStyle = col
      ctx.strokeStyle = t['instrument-face']
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(0, -7)
      ctx.lineTo(5, 5)
      ctx.lineTo(0, 2)
      ctx.lineTo(-5, 5)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      ctx.restore()
      ctx.fillStyle = col
      ctx.font = `600 10px ${t.fontMono}`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      const arrow = tr.vrFpm != null && Math.abs(tr.vrFpm) > 500 ? (tr.vrFpm > 0 ? '↑' : '↓') : ''
      ctx.fillText(`${tag}${arrow}`, x + 8, y - 5)
      ctx.fillStyle = withAlpha(t['instrument-marking'], 0.75)
      ctx.font = `500 9px ${t.fontSans}`
      ctx.fillText(tr.callsign ?? '', x + 8, y + 6)
    }
    ctx.restore()
  }
  // Own ship in the middle, nose along its track.
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(toRad(own.headingDeg - upDeg))
  drawAircraftSymbol(ctx, 0, 0, 11, t['instrument-marking'])
  ctx.restore()
}
