/**
 * Which CNS systems are serving CNS700 right now, and why the others are not.
 * Pure: it only reads the engine's answers (availability, track sources,
 * which systems are switched on) for the current moment.
 */

import type { SourceKind } from '@/core/fusion'
import type { Pillar } from '@/modules/registry'
import type { Availability } from './engine'
import type { FlightPhase } from './journey'
import type { SystemId } from './systems'

export type SysState = 'inUse' | 'standby' | 'failed' | 'unavailable'

export interface SysRow {
  id: string
  pillar: Exclude<Pillar, 'integration'>
  name: string
  moduleId: string
  state: SysState
  /** Why, in a few words. */
  note: string
}

export interface SystemsInput {
  phase: FlightPhase
  av: Availability
  /** Surveillance sources feeding CNS700's track. */
  sources: SourceKind[]
  /** Switched on and not failed by a scenario. */
  up: (id: SystemId) => boolean
  transponderOn: boolean
  onGround: boolean
  /** Airborne on the final approach (the ILS is flying the aircraft). */
  onIls: boolean
}

export const STATE_LABEL: Record<SysState, string> = { inUse: 'In use', standby: 'Ready', failed: 'Failed', unavailable: 'Out of reach' }

export function systemsNow(i: SystemsInput): SysRow[] {
  const { phase, av, sources, up } = i
  const ocean = phase === 'ocean'
  const datalinkPhase = phase === 'climb' || phase === 'ocean' || phase === 'descent'
  const why = (ok: boolean, failed: boolean, idle: string, off: string, broken = 'Switched off or failed'): { state: SysState; note: string } =>
    failed ? { state: 'failed', note: broken } : ok ? { state: 'standby', note: idle } : { state: 'unavailable', note: off }
  const rows: SysRow[] = []
  const add = (id: string, pillar: SysRow['pillar'], name: string, moduleId: string, r: { state: SysState; note: string }) => rows.push({ id, pillar, name, moduleId, ...r })

  // Communication
  if (phase === 'arrived') add('vhf', 'communication', 'VHF voice', 'vhf', { state: 'standby', note: 'Radio quiet on the stand' })
  else if (!ocean && av.vhf) add('vhf', 'communication', 'VHF voice', 'vhf', { state: 'inUse', note: 'Talking to the controller' })
  else add('vhf', 'communication', 'VHF voice', 'vhf', why(av.vhf, !up('vhf'), 'In range, not needed', ocean ? 'Beyond VHF range' : 'Out of range'))
  if (datalinkPhase && av.cpdlc) add('cpdlc', 'communication', 'CPDLC data link', 'cpdlc', { state: 'inUse', note: ocean ? 'Text messages by satellite' : 'Text messages with the controller' })
  else add('cpdlc', 'communication', 'CPDLC data link', 'cpdlc', why(av.cpdlc, !up('cpdlc'), 'Logged on, voice used here', 'No link'))
  if (ocean && av.satcom) add('satcom', 'communication', 'SATCOM', 'satcom', { state: 'inUse', note: 'Carries CPDLC and ADS-C' })
  else add('satcom', 'communication', 'SATCOM', 'satcom', why(av.satcom, !up('satcom'), 'Ready if needed', 'Satellite not in view'))
  add('hf', 'communication', 'HF voice', 'hf', why(av.hf, !up('hf'), ocean ? 'Back-up over the ocean' : 'Not needed over land', 'Not available'))

  // Navigation
  if (av.gnss) add('gnss', 'navigation', 'GNSS', 'gnss', { state: 'inUse', note: 'Position from satellites' })
  else add('gnss', 'navigation', 'GNSS', 'gnss', why(false, !up('gnss'), '', 'Jammed here'))
  if (!av.gnss && av.vordme && !i.onGround) add('vordme', 'navigation', 'VOR/DME', 'dvor', { state: 'inUse', note: 'Back-up while GNSS is lost' })
  else add('vordme', 'navigation', 'VOR/DME', 'dvor', why(av.vordme, !up('vordme'), 'In range, back-up', 'Beyond range'))
  if (i.onIls && av.ils) add('ils', 'navigation', 'ILS', 'ils', { state: 'inUse', note: 'Localizer and glideslope' })
  else add('ils', 'navigation', 'ILS', 'ils', why(av.ils, !up('ils'), 'Ready for the approach', 'Only near the runway'))
  add('inertial', 'navigation', 'Inertial navigation', 'gnss', i.onGround ? { state: 'standby', note: 'Aligned, ready' } : { state: 'inUse', note: 'Always on board' })

  // Surveillance
  add('smr', 'surveillance', 'Surface movement radar', 'surface', i.onGround ? { state: 'inUse', note: 'Sees everything on the airport' } : { state: 'standby', note: 'Airport surface only' })
  const src = (k: SourceKind) => sources.includes(k)
  const radarUp = up('radarApp') || up('radarEnr')
  add('psr', 'surveillance', 'Primary radar', 'psr', src('psr') ? { state: 'inUse', note: 'Echo from the aircraft' } : why(false, !radarUp, '', i.onGround ? 'Cannot see the surface' : 'Out of cover'))
  if (src('ssr')) add('ssr', 'surveillance', 'Secondary radar', 'ssr', { state: 'inUse', note: 'Transponder replies' })
  else if (!i.transponderOn) add('ssr', 'surveillance', 'Secondary radar', 'ssr', { state: 'standby', note: 'Transponder on standby' })
  else add('ssr', 'surveillance', 'Secondary radar', 'ssr', why(false, !radarUp, '', i.onGround ? 'Cannot see the surface' : 'Out of cover'))
  if (src('adsb')) add('adsb', 'surveillance', 'ADS-B', 'ads', { state: 'inUse', note: 'Aircraft broadcasts its GNSS position' })
  else if (!i.transponderOn) add('adsb', 'surveillance', 'ADS-B', 'ads', { state: 'standby', note: 'Transponder on standby' })
  else add('adsb', 'surveillance', 'ADS-B', 'ads', why(false, !up('adsb'), '', !av.gnss ? 'No GNSS position to send' : 'Beyond receiver range'))
  if (src('mlat')) add('mlat', 'surveillance', 'Multilateration', 'mlat', { state: 'inUse', note: 'Receivers time the replies' })
  else if (!i.transponderOn) add('mlat', 'surveillance', 'Multilateration', 'mlat', { state: 'standby', note: 'Transponder on standby' })
  else add('mlat', 'surveillance', 'Multilateration', 'mlat', why(false, !up('mlat'), '', 'Too few receivers in view'))
  if (src('adsc') || (ocean && av.adsc)) add('adsc', 'surveillance', 'ADS-C', 'ads', { state: 'inUse', note: 'Reports by satellite every 14 min' })
  else add('adsc', 'surveillance', 'ADS-C', 'ads', why(false, !up('adsc'), '', 'Oceanic airspace only'))
  return rows
}
