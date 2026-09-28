import { Term } from '@/components/Term'
import { nacpInfo, nicInfo } from '@/core/ads'
import { formatIcaoAddress } from '@/core/ssr'
import { useSampled } from '@/hooks/useSampled'
import { cn } from '@/lib/utils'
import { trackState, type AdsbKind } from './engine'
import { useAds, useAdsState } from './state'

const KIND_TEXT: Record<AdsbKind, string> = {
  position: 'Position',
  'no-position': 'No position',
  velocity: 'Velocity',
  identification: 'Identification',
}

function latText(v: number, pos: string, neg: string) {
  return `${Math.abs(v).toFixed(4)}° ${v >= 0 ? pos : neg}`
}

/** What the selected aircraft is broadcasting, and what the ground station decoded. */
export function MessagePanel() {
  const { engine } = useAds()
  const selectedId = useAdsState((s) => s.selectedId)
  const crossCheck = useAdsState((s) => s.crossCheck)

  const data = useSampled(
    () => {
      const a = engine.getAircraft(selectedId)
      if (!a) return null
      const msgs = (engine.messages.get(a.id) ?? []).slice(-6).reverse()
      const tr = engine.atc.tracks.get(a.address)
      const heard = msgs[0]?.heardBy ?? []
      return {
        id: a.callsign,
        out: engine.hasAdsbOut(a.id),
        address: formatIcaoAddress(a.address),
        msgs: msgs.map((m) => ({ seq: m.seq, kind: m.kind, age: Math.max(0, engine.timeS - m.timeS), hex: m.hex, odd: m.decoded.cpr?.odd })),
        heard: heard.map((id) => engine.receivers.find((r) => r.id === id)?.name ?? id),
        track: tr
          ? {
              callsign: tr.callsign,
              lat: tr.latLon?.lat,
              lon: tr.latLon?.lon,
              alt: tr.altFt,
              gs: tr.gsKt,
              trk: tr.trackDeg,
              vr: tr.vrFpm,
              nic: tr.nic,
              nacp: tr.nacp,
              state: trackState(tr, engine.timeS),
              check: crossCheck ? engine.crossCheck(tr) : null,
            }
          : null,
      }
    },
    250,
    (x, y) => JSON.stringify(x) === JSON.stringify(y),
  )

  if (!data) return <div className="hud-panel rounded-md p-4 text-sm text-muted-foreground">Choose an aircraft to see its messages.</div>
  const tr = data.track

  return (
    <div className="hud-panel flex min-w-0 flex-col gap-3 rounded-md p-4">
      <div>
        <h3 className="text-sm font-semibold">What {data.id} broadcasts</h3>
        <p className="text-xs text-muted-foreground">
          Real 112-bit <Term id="extended-squitter">extended squitter</Term> messages on 1090 MHz, and what the ground station decoded from them.
        </p>
      </div>
      {!data.out ? (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          {data.id} has no ADS-B Out. It sends nothing, so ADS-B receivers cannot know it exists.
        </p>
      ) : (
        <>
          <ul className="flex flex-col divide-y rounded-md border" aria-label="Latest messages">
            {data.msgs.map((m) => (
              <li key={m.seq} className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-1.5">
                <span className="w-28 shrink-0 text-xs font-medium">
                  {KIND_TEXT[m.kind]}
                  {m.kind === 'position' ? (m.odd ? ' (odd)' : ' (even)') : ''}
                </span>
                <span className="min-w-0 flex-1 font-mono text-[11px] break-all text-muted-foreground tabular-nums">{m.hex}</span>
                <span className="w-14 shrink-0 text-right font-mono text-[11px] tabular-nums">{m.age.toFixed(1)} s</span>
              </li>
            ))}
          </ul>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <Field label="Callsign" value={tr?.callsign ?? '—'} />
            <Field label={<Term id="icao-address">Address</Term>} value={data.address} mono />
            <Field label="Latitude" value={tr?.lat != null ? latText(tr.lat, 'N', 'S') : '—'} mono />
            <Field label="Longitude" value={tr?.lon != null ? latText(tr.lon, 'E', 'W') : '—'} mono />
            <Field label="Altitude (barometric)" value={tr?.alt != null ? `${tr.alt.toLocaleString('en-US')} ft` : '—'} mono />
            <Field label="Ground speed" value={tr?.gs != null ? `${Math.round(tr.gs)} kt` : '—'} mono />
            <Field label="Track" value={tr?.trk != null ? `${String(Math.round(tr.trk) % 360).padStart(3, '0')}° true` : '—'} mono />
            <Field label="Vertical rate" value={tr?.vr != null ? `${tr.vr > 0 ? '+' : ''}${tr.vr} ft/min` : '—'} mono />
            <Field
              label={<Term id="nic">NIC (integrity)</Term>}
              value={tr ? `${tr.nic}: ${nicInfo(tr.nic).text}` : '—'}
              tone={tr && tr.nic < 7 ? 'warning' : undefined}
            />
            <Field
              label={<Term id="nacp">NACp (accuracy)</Term>}
              value={tr ? `${tr.nacp}: ${nacpInfo(tr.nacp).text}` : '—'}
              tone={tr && tr.nacp < 8 ? 'warning' : undefined}
            />
          </dl>
          <p className="text-xs text-muted-foreground">
            {tr?.state === 'no-position'
              ? 'The messages carry no position: the aircraft has lost GNSS. '
              : tr?.state === 'coast'
                ? 'No fresh position for a few seconds: the track is coasting. '
                : ''}
            Heard by: {data.heard.length ? data.heard.join(', ') : 'no ground receiver (out of line of sight)'}.
            {tr?.check === 'unconfirmed' && <span className="font-medium text-warning"> The radar sees nothing at this position.</span>}
          </p>
        </>
      )}
    </div>
  )
}

function Field({ label, value, mono, tone }: { label: React.ReactNode; value: string; mono?: boolean; tone?: 'warning' }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('truncate font-medium', mono && 'font-mono tabular-nums', tone === 'warning' && 'text-warning')}>{value}</dd>
    </div>
  )
}
