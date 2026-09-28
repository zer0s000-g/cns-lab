import { useCallback } from 'react'
import { CircleSlash, EyeOff, RefreshCw, SatelliteDish } from 'lucide-react'
import { Canvas2D, type DrawFn } from '@/components/sim/Canvas2D'
import { Readout } from '@/components/sim/Controls'
import { Term } from '@/components/Term'
import { Badge } from '@/components/ui/badge'
import { haloText } from '@/components/sim/mapDraw'
import { ftToFlightLevel, metresToFt } from '@/core/units'
import { useSampled } from '@/hooks/useSampled'
import { withAlpha } from '@/lib/color'
import { cn } from '@/lib/utils'
import { CLEAR_SKY_MARGIN_DB, GEO_SATS, HEAVY_RAIN_MM_H, RAIN_HEIGHT_KM } from './engine'
import { fmtLat, fmtLon, formatDuration, STATE_TEXT } from './format'
import { useSatcom } from './state'

/** Live link status, readouts and the coverage strip along the route. */
export function LinkPanel() {
  const { engine } = useSatcom()
  const s = useSampled(() => {
    const e = engine
    const sat = e.link.sat ?? e.link.target ?? (e.link.state === 'blocked' ? e.bestVisible() : null)
    const look = sat != null ? e.looks[sat] : null
    return {
      state: e.link.state,
      satName: sat == null ? '—' : `${e.satName(sat)}${e.link.state === 'blocked' ? ' (hidden)' : e.link.state === 'handover' ? ' (next)' : ''}`,
      el: look ? look.elevationDeg : NaN,
      antEl: look ? look.antennaElevationDeg : NaN,
      delayMs: e.livePath ? e.livePath.propagationS * 1000 : NaN,
      lat: e.routePoint.pos.lat,
      lon: e.routePoint.pos.lon,
      fl: ftToFlightLevel(e.routePoint.altitudeFt),
      flown: e.distanceNm,
      total: e.routeLengthNm,
      handovers: e.handovers,
      setIn: e.timeUntilSetS(),
      handoverLeft: e.link.state === 'handover' && e.link.handoverEndsS != null ? e.link.handoverEndsS - e.timeS : null,
      geo: e.constellation === 'geo',
      turning: e.turnPhase !== 'level',
      events: e.events.slice(0, 3).map((x) => `${x.kind}|${x.text}`).join('\n'),
    }
  }, 200)
  const Icon = s.state === 'connected' ? SatelliteDish : s.state === 'handover' ? RefreshCw : s.state === 'blocked' ? EyeOff : CircleSlash
  const tone = s.state === 'connected' ? 'ok' : s.state === 'handover' ? 'warning' : 'alert'

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Link status</h3>
        <span
          role="status"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-semibold',
            tone === 'ok' && 'border-success/40 text-success',
            tone === 'warning' && 'border-warning/50 text-warning',
            tone === 'alert' && 'border-destructive/50 text-destructive',
          )}
        >
          <Icon className="size-3.5" aria-hidden />
          {STATE_TEXT[s.state]}
          {s.handoverLeft != null && s.handoverLeft > 0 ? ` · ${formatDuration(s.handoverLeft)}` : ''}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Readout label="Satellite" value={<span className="text-sm">{s.satName}</span>} />
        <Readout
          label={<Term id="satellite-elevation">Elevation</Term>}
          value={Number.isFinite(s.el) ? s.el.toFixed(1) : '—'}
          unit="°"
          hint={Number.isFinite(s.antEl) && s.turning ? `${s.antEl.toFixed(0)}° from the antenna’s tilted horizon` : undefined}
        />
        <Readout
          label="Delay through space"
          hint="One way, at the speed of light"
          value={Number.isFinite(s.delayMs) ? (s.delayMs >= 100 ? Math.round(s.delayMs) : s.delayMs.toFixed(1)) : '—'}
          unit="ms"
          tone={Number.isFinite(s.delayMs) ? 'default' : 'muted'}
        />
        <Readout
          label={s.geo ? 'Moves in the sky' : 'In view for another'}
          value={s.geo ? 'No' : s.setIn != null ? formatDuration(s.setIn) : '—'}
          hint={s.geo ? 'Geostationary: it stays put' : 'Then a handover'}
        />
        <Readout label="Aircraft" value={<span className="text-sm">{`${fmtLat(s.lat)} ${fmtLon(s.lon)}`}</span>} hint={s.fl > 5 ? `FL${String(s.fl).padStart(3, '0')}` : 'On the ground'} />
        <Readout label="Handovers so far" value={s.handovers} hint={`${Math.round(s.flown).toLocaleString('en-US')} of ${Math.round(s.total).toLocaleString('en-US')} NM flown`} />
      </div>
      <CoverageStrip />
      {s.events && (
        <ul className="flex flex-col gap-1 text-xs" aria-live="polite">
          {s.events.split('\n').map((line, k) => {
            const [kind, text] = line.split('|')
            return (
              <li key={k} className="flex items-start gap-2">
                <Badge variant={kind === 'lost' ? 'destructive' : 'secondary'} className="shrink-0">
                  {kind === 'handover' ? 'Handover' : kind === 'lost' ? 'Lost' : 'Back'}
                </Badge>
                <span className="text-muted-foreground">{text}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** Which satellite served which part of the route (and where the link was lost). */
function CoverageStrip() {
  const { engine } = useSatcom()
  const draw: DrawFn = useCallback(
    (ctx, { width, height, tokens: t }) => {
      const e = engine
      const x0 = 4
      const w = width - 8
      const y = 18
      const h = height - 22
      const xOf = (nm: number) => x0 + (nm / Math.max(1, e.routeLengthNm)) * w
      ctx.fillStyle = t['sim-bg']
      ctx.fillRect(x0, y, w, h)
      ctx.strokeStyle = t['border']
      ctx.strokeRect(x0 + 0.5, y + 0.5, w - 1, h - 1)
      for (const seg of e.history) {
        const a = xOf(seg.fromNm)
        const b = Math.max(a + 1.5, xOf(seg.toNm))
        if (seg.state === 'connected') {
          const alt = seg.sat != null && seg.sat % 2 === 1
          ctx.fillStyle = withAlpha(t['sim-signal'], alt ? 0.55 : 0.8)
          ctx.fillRect(a, y + 1, b - a, h - 2)
          if (b - a > 52 && seg.sat != null) {
            ctx.fillStyle = t['primary-foreground']
            ctx.font = `600 10px ${t.fontSans}`
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText(e.constellation === 'geo' ? GEO_SATS[seg.sat].id : e.leoSats[seg.sat].id, (a + b) / 2, y + h / 2)
          }
        } else {
          ctx.fillStyle = withAlpha(seg.state === 'handover' ? t['sim-warning'] : t['sim-alert'], 0.85)
          ctx.fillRect(a, y + 1, b - a, h - 2)
          if (seg.state === 'no-satellite' && b - a > 70) {
            ctx.fillStyle = t['background']
            ctx.font = `600 10px ${t.fontSans}`
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText('No satellite', (a + b) / 2, y + h / 2)
          }
        }
      }
      // Aircraft position.
      const xa = xOf(e.distanceNm)
      ctx.fillStyle = t['sim-ink']
      ctx.beginPath()
      ctx.moveTo(xa, y - 1)
      ctx.lineTo(xa - 5, y - 8)
      ctx.lineTo(xa + 5, y - 8)
      ctx.closePath()
      ctx.fill()
      haloText(ctx, e.route.waypoints[0].name.replace(/ \(.*\)$/, ''), x0, 10, t, { font: `500 10px ${t.fontSans}`, color: t['sim-muted'] })
      haloText(ctx, e.route.waypoints[e.route.waypoints.length - 1].name.replace(/ \(.*\)$/, ''), x0 + w, 10, t, { font: `500 10px ${t.fontSans}`, align: 'right', color: t['sim-muted'] })
    },
    [engine],
  )
  const label = useSampled(() => {
    const lost = engine.history.filter((h) => h.state === 'no-satellite').reduce((a, h) => a + (h.toNm - h.fromNm), 0)
    return `Coverage along the route so far: ${Math.round(lost)} nautical miles without a satellite, ${engine.handovers} handovers.`
  }, 1000)
  return (
    <figure className="flex flex-col gap-1">
      <Canvas2D draw={draw} label={label} className="h-11 w-full" />
      <figcaption className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span>Route so far:</span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-2.5 rounded-sm bg-sim-signal" aria-hidden /> connected (name of satellite)
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-2.5 rounded-sm bg-sim-warning" aria-hidden /> switching
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-2.5 rounded-sm bg-sim-alert" aria-hidden /> no link
        </span>
      </figcaption>
    </figure>
  )
}

/** How heavy rain affects the same path at three frequency bands. */
export function RainPanel() {
  const { engine } = useSatcom()
  const s = useSampled(() => ({ rain: engine.env.heavyRain, fades: engine.bandFades(), alt: engine.routePoint.altitudeFt }), 250, (a, b) => JSON.stringify(a) === JSON.stringify(b))
  const NAME = { L: 'L-band safety link', Ku: 'Ku-band passenger Wi-Fi', Ka: 'Ka-band passenger Wi-Fi' } as const
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Rain on the path, by frequency band</h3>
        <span className="text-xs text-muted-foreground">
          {s.rain ? `Heavy rain, about ${HEAVY_RAIN_MM_H} mm per hour, below ${RAIN_HEIGHT_KM} km` : 'No rain'}
        </span>
      </div>
      <ul className="flex flex-col gap-2.5">
        {s.fades.map((f) => (
          <li key={f.band} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="font-medium">
                {f.band === 'L' ? <Term id="l-band">{NAME.L}</Term> : f.band === 'Ku' ? <Term id="ku-band">{NAME.Ku}</Term> : <Term id="ka-band">{NAME.Ka}</Term>}
                <span className="ml-1 font-mono text-muted-foreground tabular-nums">{f.freqGHz} GHz</span>
              </span>
              <span className={cn('font-mono tabular-nums', f.status === 'ok' ? 'text-success' : f.status === 'fading' ? 'text-warning' : 'text-destructive')}>
                {f.attenuationDb === 0 ? '0 dB' : `−${f.attenuationDb < 0.1 ? f.attenuationDb.toFixed(2) : f.attenuationDb.toFixed(1)} dB`} · {f.status === 'ok' ? 'OK' : f.status === 'fading' ? 'fading' : 'lost'}
              </span>
            </div>
            <div className="relative h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div
                className={cn('absolute inset-y-0 left-0 rounded-full', f.status === 'ok' ? 'bg-success' : f.status === 'fading' ? 'bg-warning' : 'bg-destructive')}
                style={{ width: `${Math.max(0, Math.min(1, f.marginDb / CLEAR_SKY_MARGIN_DB)) * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        {s.rain && s.alt > metresToFt(RAIN_HEIGHT_KM * 1000)
          ? 'The aircraft is flying above the rain, so none of the bands lose anything right now.'
          : 'Bars show the link margin left over (illustrative 6 dB in clear sky). Only the aircraft’s side of the path is modelled.'}
      </p>
    </div>
  )
}
