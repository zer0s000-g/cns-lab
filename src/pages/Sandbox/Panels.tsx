import { Radio, ShieldAlert, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSampled } from '@/hooks/useSampled'
import type { ScenarioId } from './engine'
import { useSandbox } from './state'

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
