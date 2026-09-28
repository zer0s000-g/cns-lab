import type { Pillar } from '@/modules/registry'

/** Where every CNS Lab system sits in the radio spectrum. Frequencies in Hz. */
export interface FrequencyBand {
  id: string
  system: string
  pillar: Pillar
  moduleId?: string
  fromHz: number
  toHz: number
  /** Plain description of the band. */
  note: string
}

const kHz = 1e3
const MHz = 1e6
const GHz = 1e9

export const FREQUENCY_BANDS: FrequencyBand[] = [
  { id: 'ndb', system: 'NDB', pillar: 'navigation', moduleId: 'ndb', fromHz: 190 * kHz, toHz: 1750 * kHz, note: 'LF/MF ground wave, mostly 190–535 kHz' },
  // TODO(expert-review): the exact list of HF (R) sub-bands used for aeronautical voice in each region.
  { id: 'hf', system: 'HF voice and SELCAL', pillar: 'communication', moduleId: 'hf', fromHz: 2.85 * MHz, toHz: 22 * MHz, note: 'Aeronautical bands between about 2.85 and 22 MHz, single sideband (USB)' },
  { id: 'marker', system: 'ILS marker beacons', pillar: 'navigation', moduleId: 'ils', fromHz: 74.8 * MHz, toHz: 75.2 * MHz, note: '75 MHz, cone-shaped beam pointing straight up' },
  { id: 'vor', system: 'VOR', pillar: 'navigation', moduleId: 'dvor', fromHz: 108 * MHz, toHz: 117.95 * MHz, note: '108.00–117.95 MHz (shares 108–112 MHz with ILS localizers)' },
  { id: 'loc', system: 'ILS localizer', pillar: 'navigation', moduleId: 'ils', fromHz: 108.1 * MHz, toHz: 111.95 * MHz, note: '108.10–111.95 MHz, odd tenths only' },
  { id: 'vhf', system: 'VHF voice and data link', pillar: 'communication', moduleId: 'vhf', fromHz: 118 * MHz, toHz: 136.975 * MHz, note: '118.000–136.975 MHz, AM voice, 25 or 8.33 kHz channels; also VHF data link for CPDLC' },
  { id: 'guard', system: 'Emergency (guard) frequency', pillar: 'communication', moduleId: 'vhf', fromHz: 121.49 * MHz, toHz: 121.51 * MHz, note: '121.5 MHz, monitored for emergencies' },
  { id: 'uhf', system: 'UHF military voice', pillar: 'communication', moduleId: 'vhf', fromHz: 225 * MHz, toHz: 400 * MHz, note: '225–400 MHz' },
  { id: 'gs', system: 'ILS glideslope', pillar: 'navigation', moduleId: 'ils', fromHz: 329.15 * MHz, toHz: 335 * MHz, note: '329.15–335.00 MHz, paired with the localizer' },
  { id: 'dme', system: 'DME', pillar: 'navigation', moduleId: 'dme', fromHz: 962 * MHz, toHz: 1213 * MHz, note: '962–1213 MHz, pulse pairs' },
  { id: 'uat', system: 'ADS-B UAT (US only)', pillar: 'surveillance', moduleId: 'ads', fromHz: 977.5 * MHz, toHz: 978.5 * MHz, note: '978 MHz' },
  { id: 'ssr-up', system: 'SSR / Mode S interrogation', pillar: 'surveillance', moduleId: 'ssr', fromHz: 1029.5 * MHz, toHz: 1030.5 * MHz, note: '1030 MHz, ground to air' },
  { id: 'ssr-down', system: 'SSR replies, ADS-B 1090ES, MLAT', pillar: 'surveillance', moduleId: 'ads', fromHz: 1089.5 * MHz, toHz: 1090.5 * MHz, note: '1090 MHz, air to ground' },
  { id: 'psr-l', system: 'En-route primary radar (L-band)', pillar: 'surveillance', moduleId: 'psr', fromHz: 1215 * MHz, toHz: 1400 * MHz, note: 'L-band, long range, antenna turns every 10–12 s' },
  // TODO(expert-review): aeronautical mobile-satellite (R) L-band allocations for SATCOM.
  { id: 'satcom', system: 'Aeronautical SATCOM (L-band)', pillar: 'communication', moduleId: 'satcom', fromHz: 1525 * MHz, toHz: 1660.5 * MHz, note: 'About 1.5–1.66 GHz (Inmarsat, Iridium)' },
  { id: 'gnss', system: 'GPS L1 / Galileo E1', pillar: 'navigation', moduleId: 'gnss', fromHz: 1563 * MHz, toHz: 1587 * MHz, note: '1575.42 MHz centre' },
  { id: 'psr-s', system: 'Approach primary radar (S-band)', pillar: 'surveillance', moduleId: 'psr', fromHz: 2.7 * GHz, toHz: 2.9 * GHz, note: 'S-band, antenna turns every 4–5 s' },
  // TODO(expert-review): typical SMR operating range within the X-band.
  { id: 'smr', system: 'Surface movement radar (X-band)', pillar: 'surveillance', moduleId: 'surface', fromHz: 9 * GHz, toHz: 9.5 * GHz, note: 'About 9 GHz, very fine detail' },
]

export function formatHz(hz: number): string {
  if (hz >= GHz) return `${trim(hz / GHz)} GHz`
  if (hz >= MHz) return `${trim(hz / MHz)} MHz`
  if (hz >= kHz) return `${trim(hz / kHz)} kHz`
  return `${hz} Hz`
}

function trim(v: number): string {
  return Number(v.toFixed(3)).toString()
}
