import { Link } from 'react-router'
import { CircleCheck, CircleSlash, Radio, ShieldAlert, TriangleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SOURCE_LABEL, predictTrack, trackSigmaNm, trackSpeedKt, trackStatus, type SourceKind } from '@/core/fusion'
import { METRES_PER_NM } from '@/core/units'
import { useSampled } from '@/hooks/useSampled'
import { MODULE_BY_ID } from '@/modules/registry'
import { cn } from '@/lib/utils'
import { journeyStage, type Availability, type ScenarioId } from './engine'
import { useSandbox, useSandboxState } from './state'

const SOURCES: { key: SourceKind; module: string }[] = [
  { key: 'psr', module: 'psr' },
  { key: 'ssr', module: 'ssr' },
  { key: 'adsb', module: 'ads' },
  { key: 'mlat', module: 'mlat' },
  { key: 'adsc', module: 'ads' },
]

function Row({ ok, label, detail, to }: { ok: boolean; label: string; detail?: string; to?: string }) {
  const Icon = ok ? CircleCheck : CircleSlash
  return (
    <li className="flex min-h-8 items-center gap-2 text-sm">
      <Icon className={cn('size-4 shrink-0', ok ? 'text-success' : 'text-muted-foreground')} aria-hidden />
      <span className={cn('flex-1', !ok && 'text-muted-foreground')}>
        {to ? (
          <Link to={to} className="hover:underline">
            {label}
          </Link>
        ) : (
          label
        )}
        <span className="sr-only">{ok ? ': in use' : ': not available'}</span>
      </span>
      {detail && <span className="font-mono text-xs text-muted-foreground tabular-nums">{detail}</span>}
    </li>
  )
}

/** Which systems feed the selected track, and what the aircraft itself can use. */
export function SourcesPanel() {
  const { engine } = useSandbox()
  const selectedId = useSandboxState((s) => s.selectedId)
  const data = useSampled(() => {
    const a = engine.getAircraft(selectedId)
    const tr = selectedId ? engine.tracks.get(selectedId) : undefined
    const now = engine.timeS
    const ages = Object.fromEntries(SOURCES.map((s) => [s.key, tr?.lastBySource[s.key] !== undefined ? now - tr.lastBySource[s.key]! : null]))
    const active = tr ? engine.sources(tr.id) : []
    return {
      id: selectedId,
      callsign: a?.callsign ?? selectedId,
      status: tr ? trackStatus(tr, now) : 'none',
      active,
      ages,
      sigmaM: tr ? trackSigmaNm(predictTrack(tr, now)) * METRES_PER_NM : null,
      speed: tr ? trackSpeedKt(predictTrack(tr, now)) : null,
      altitude: tr?.altitudeFt,
      av: a ? engine.availabilityFor(a) : null,
      stage: a?.journey ? journeyStage(a) : null,
      equip: a?.equip,
    }
  }, 300, (x, y) => JSON.stringify(x) === JSON.stringify(y))

  if (!data.id) return <p className="text-sm text-muted-foreground">Select a track or an aircraft to see its sources.</p>
  const av = data.av as Availability | null
  const fmtAge = (s: number | null) => (s === null ? '—' : s < 60 ? `${Math.round(s)} s ago` : `${Math.round(s / 60)} min ago`)
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold">{data.callsign === 'UNK1' ? 'Unknown aircraft (no transponder)' : data.callsign}</p>
          <Badge variant="outline" className={cn(data.status === 'live' && 'border-success/40 text-success', data.status === 'coast' && 'border-warning/50 text-warning')}>
            {data.status === 'live' ? 'Live track' : data.status === 'coast' ? 'Coasting: no fresh data' : 'Not on the screen'}
          </Badge>
          {data.stage && <Badge variant="secondary">{data.stage}</Badge>}
        </div>
        <p className="text-xs text-muted-foreground">
          {data.sigmaM !== null ? `Track uncertainty about ${data.sigmaM < 1000 ? `${Math.round(data.sigmaM)} m` : `${(data.sigmaM / METRES_PER_NM).toFixed(1)} NM`}` : 'No track'}
          {data.altitude !== undefined ? ` · ${Math.round(data.altitude / 100) * 100} ft` : data.status !== 'none' ? ' · no altitude (primary radar only)' : ''}
          {data.speed !== null ? ` · ${Math.round(data.speed)} kt` : ''}
        </p>
        <p className="mt-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Surveillance sources</p>
        <ul className="flex flex-col">
          {SOURCES.map((s) => (
            <Row key={s.key} ok={data.active.includes(s.key)} label={SOURCE_LABEL[s.key]} detail={fmtAge(data.ages[s.key] as number | null)} to={MODULE_BY_ID.get(s.module)?.path} />
          ))}
        </ul>
      </div>
      {av && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Navigation on board</p>
          <ul className="flex flex-col">
            <Row ok={av.gnss} label="GNSS" to="/modules/gnss" />
            <Row ok={av.vordme} label="VOR/DME" to="/modules/dvor" />
            <Row ok={av.ils} label="ILS" to="/modules/ils" />
            <Row ok label="Inertial reference (always on board)" />
          </ul>
          <p className="mt-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Communication</p>
          <ul className="flex flex-col">
            <Row ok={av.vhf} label="VHF voice" to="/modules/vhf" />
            <Row ok={av.cpdlc} label="CPDLC data link" to="/modules/cpdlc" />
            <Row ok={av.satcom && Boolean(data.equip?.fans)} label="SATCOM" to="/modules/satcom" />
            <Row ok={av.hf} label="HF voice (noisy)" to="/modules/hf" />
          </ul>
        </div>
      )}
    </div>
  )
}

/** STCA and MSAW alerts with the controller's possible responses. */
export function AlertsPanel() {
  const { engine } = useSandbox()
  const alerts = useSampled(() => engine.alerts.map((a) => ({ ...a })), 300, (x, y) => JSON.stringify(x) === JSON.stringify(y))
  if (!alerts.length)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <ShieldAlert className="size-4" aria-hidden /> No safety-net alerts right now.
      </p>
    )
  return (
    <ul className="flex flex-col gap-2" aria-live="assertive">
      {alerts.map((a) => (
        <li key={`${a.kind}-${a.ids.join('-')}`} className="flex flex-col gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
            <TriangleAlert className="size-4" aria-hidden /> {a.kind === 'STCA' ? 'STCA: conflict alert' : 'MSAW: terrain alert'}
          </p>
          <p className="text-sm">{a.text}.</p>
          {a.kind === 'STCA' && a.ids.includes('CNS9B') && (
            <Button size="sm" variant="outline" className="self-start" onClick={() => engine.resolveConflict()}>
              <Radio aria-hidden /> Tell CNS9B to climb 2,000 ft
            </Button>
          )}
          {a.kind === 'MSAW' && a.ids.includes('CNS9M') && (
            <Button size="sm" variant="outline" className="self-start" onClick={() => engine.resolveTerrain()}>
              <Radio aria-hidden /> Tell CNS9M to climb immediately
            </Button>
          )}
        </li>
      ))}
    </ul>
  )
}

export const SCENARIO_TEXT: Record<Exclude<ScenarioId, 'normal'>, { title: string; fails: string; works: string; controller: string; pilot: string }> = {
  radarOutage: {
    title: 'Radar outage',
    fails: 'Both radars: no primary echoes and no secondary replies. The aircraft without a transponder disappears.',
    works: 'ADS-B (aircraft broadcast their own position) and WAM (receivers time the transponder signals) keep most tracks alive. The Mode C light aircraft stays visible on WAM only.',
    controller: 'Keeps working on the ADS-B and WAM tracks, applies larger separation where only one source remains, and reports the outage to engineering.',
    pilot: 'Often notices nothing. Transponders and ADS-B keep working as usual.',
  },
  gnssJam: {
    title: 'GNSS jamming',
    fails: 'GNSS inside the red circle: ADS-B positions drop out and GNSS/RNP navigation is lost.',
    works: 'Radar (it measures echoes and replies itself), WAM (it times transponder signals, not GNSS positions), VOR/DME and ILS.',
    controller: 'Relies on radar and WAM tracks, gives radar vectors, and warns other aircraft about the interference.',
    pilot: 'Switches navigation to VOR/DME, DME/DME or inertial, tells ATC "unable RNP due to GNSS interference", and flies the ILS instead of a GNSS approach.',
  },
  vhfFail: {
    title: 'VHF failure',
    fails: 'The main VHF transmitters: pilots cannot hear the controller on the usual frequency.',
    works: 'Standby transmitters (select them below), CPDLC over satellite for equipped aircraft, SATCOM and HF voice, and the guard frequency 121.5 MHz.',
    controller: 'Switches to the standby transmitters in the voice switch, or sends instructions by CPDLC.',
    pilot: 'Tries the previous frequency and 121.5 MHz; if all contact is lost, sets squawk 7600 and follows the radio-failure procedure.',
  },
  mountain: {
    title: 'Mountain terrain',
    fails: 'Coverage: behind the North Range radar and radio have gaps (shaded on the map at 5,000 ft).',
    works: 'The mountain-top VHF site and the WAM receivers cover more of the area; MSAW watches the tracks against a terrain database.',
    controller: 'On an MSAW alert: "Terrain alert, climb immediately", with a turn away from the high ground.',
    pilot: 'Climbs at once. If the ground warning in the cockpit (TAWS) says "pull up", climbs at full power without waiting.',
  },
}
