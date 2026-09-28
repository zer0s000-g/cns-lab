import { useCallback } from 'react'
import { SimLabel } from '@/components/sim/Controls'
import { nacpInfo } from '@/core/ads'
import { formatFlightLevel } from '@/core/ssr'
import { RadarScope, type ScopeProjector, type ScopeTrack } from '@/instruments'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { withAlpha } from '@/lib/color'
import { trackState, type AdsbEngine } from './engine'
import { useAds, useAdsState, type AtcShow } from './state'

/** What the controller's screen shows: ADS-B tracks (diamonds) and radar plots (squares). */
export function AtcScreen() {
  const { engine, store } = useAds()
  const range = useAdsState((s) => s.mapRangeNm)
  const show = useAdsState((s) => s.atcShow)
  const crossCheck = useAdsState((s) => s.crossCheck)
  const select = useAdsState((s) => s.select)

  const underlay = useCallback(
    (ctx: CanvasRenderingContext2D, project: ScopeProjector, t: ThemeTokens, pxPerNm: number) => {
      if (store.getState().atcShow === 'radar') return
      // Position uncertainty (NACp bound) around each ADS-B track.
      for (const tr of engine.atc.tracks.values()) {
        if (!tr.pos || trackState(tr, engine.timeS) === 'no-position') continue
        const bound = nacpInfo(tr.nacp).boundM
        if (bound == null) continue
        const r = (bound / 1852) * pxPerNm
        if (r < 2.5) continue
        const s = project(tr.pos)
        ctx.fillStyle = withAlpha(t['scope-warning'], 0.12)
        ctx.strokeStyle = withAlpha(t['scope-warning'], 0.7)
        ctx.setLineDash([3, 3])
        ctx.beginPath()
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        ctx.setLineDash([])
      }
    },
    [engine, store],
  )

  return (
    <div className="relative">
      <RadarScope
        maxRangeNm={range}
        persistenceS={4}
        underlay={underlay}
        read={() => ({ nowS: engine.timeS, sweepAzDeg: null, tracks: atcTracks(engine, store.getState().atcShow, store.getState().crossCheck, store.getState().selectedId) })}
        describe={() => describeAtc(engine, show)}
        onTrackClick={(id) => {
          const addr = Number(id.slice(2))
          const a = engine.aircraft.find((x) => x.address === addr)
          if (a) select(a.id)
        }}
      />
      <div className="pointer-events-none absolute top-2 left-2 flex max-w-[calc(100%-1rem)] flex-wrap gap-1.5">
        <SimLabel icon="none">{show === 'radar' ? 'Radar only' : show === 'adsb' ? 'ADS-B only' : 'Radar and ADS-B'}</SimLabel>
        {crossCheck && show !== 'radar' && <SimLabel icon="none">Cross-check on</SimLabel>}
      </div>
    </div>
  )
}

export function atcTracks(engine: AdsbEngine, show: AtcShow, crossCheck: boolean, selectedId: string | null): ScopeTrack[] {
  const out: ScopeTrack[] = []
  const sel = engine.getAircraft(selectedId)
  const adsbShown = new Set<number>()
  if (show !== 'radar') {
    for (const tr of engine.atc.tracks.values()) {
      const st = trackState(tr, engine.timeS)
      if (st === 'no-position' || !tr.pos) continue
      adsbShown.add(tr.address)
      const check = crossCheck ? engine.crossCheck(tr) : 'confirmed'
      const lines = [tr.callsign ?? '------', `${tr.altFt != null ? formatFlightLevel(tr.altFt) : '---'}${trend(tr.vrFpm)}`]
      if (st === 'coast') lines.push('COAST')
      if (check === 'unconfirmed') lines.push('NO RADAR')
      else if (tr.nacp > 0 && tr.nacp < 8) lines.push(`NACp ${tr.nacp}`)
      const hist = tr.history.filter((_, i, a) => (a.length - 1 - i) % 4 === 0).slice(-12, -1).map((h) => h.p)
      out.push({
        id: `A:${tr.address}`,
        x: tr.pos.x,
        y: tr.pos.y,
        symbol: st === 'coast' ? 'coast' : 'adsb',
        label: lines,
        emphasis: check === 'unconfirmed' ? 'warning' : sel && sel.address === tr.address ? 'selected' : 'normal',
        history: hist,
        leaderTo: tr.gsKt != null && tr.trackDeg != null ? leader(tr.pos, tr.gsKt, tr.trackDeg) : undefined,
      })
    }
  }
  if (show !== 'adsb') {
    for (const [addr, plots] of engine.radarPlots) {
      const p = plots[plots.length - 1]
      const labelled = !adsbShown.has(addr)
      out.push({
        id: `R:${addr}`,
        x: p.pos.x,
        y: p.pos.y,
        symbol: 'secondary',
        label: labelled ? [p.callsign, formatFlightLevel(p.altFt)] : undefined,
        emphasis: labelled && sel && sel.address === addr ? 'selected' : labelled ? 'normal' : 'dim',
        history: plots.slice(-4, -1).map((q) => q.pos),
      })
    }
  }
  return out
}

function trend(vr?: number): string {
  if (vr == null) return ''
  return vr > 300 ? ' ↑' : vr < -300 ? ' ↓' : ''
}

/** One-minute velocity leader. */
function leader(p: { x: number; y: number }, gsKt: number, trackDeg: number) {
  const d = gsKt / 60
  const a = (trackDeg * Math.PI) / 180
  return { x: p.x + Math.sin(a) * d, y: p.y + Math.cos(a) * d }
}

function describeAtc(engine: AdsbEngine, show: AtcShow): string {
  const adsb = [...engine.atc.tracks.values()].filter((t) => t.pos && trackState(t, engine.timeS) !== 'no-position')
  const radar = engine.radarPlots.size
  return `Controller's screen showing ${show === 'radar' ? 'radar only' : show === 'adsb' ? 'ADS-B only' : 'radar and ADS-B'}. ${adsb.length} ADS-B tracks: ${adsb
    .map((t) => `${t.callsign ?? 'unknown'} at flight level ${t.altFt != null ? formatFlightLevel(t.altFt) : 'unknown'}`)
    .join(', ')}. ${radar} radar targets.`
}
