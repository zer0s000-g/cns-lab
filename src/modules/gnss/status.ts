import { formatMetres } from './format'
import { SITES, type GnssEngine } from './engine'

/** Plain-language status lines for the integrity and corrections panel. */
export interface StatusLine {
  tone: 'ok' | 'warning' | 'alert' | 'muted'
  title: string
  detail: string
}

export function raimSummary(e: GnssEngine): StatusLine {
  const r = e.result
  if (!e.env.raim) return { tone: 'muted', title: 'RAIM is switched off', detail: 'Nobody checks whether the satellites agree with each other.' }
  if (r.kind === 'none') return { tone: 'muted', title: 'RAIM not available', detail: 'There is no position to check.' }
  if (e.settings.clockMode === 'guess' || r.kind === 'three')
    return { tone: 'muted', title: 'RAIM not available', detail: 'RAIM needs the receiver to work out its own clock error, with at least 5 satellites.' }
  const raim = r.raim
  if ((!raim || raim.status === 'unavailable') && r.usedIds.length >= 5)
    return { tone: 'warning', title: 'RAIM not available', detail: 'The satellites are lined up so badly that no reliable position can be worked out to check.' }
  if (!raim || raim.status === 'unavailable')
    return {
      tone: 'warning',
      title: 'RAIM not available',
      detail: `Needs at least 5 satellites; ${r.usedIds.length} in use. With only 4 there is no spare measurement to check the others.`,
    }
  const dis = `Disagreement ${formatMetres(raim.disagreementM)}, alarm above ${formatMetres(raim.limitM)}.`
  switch (raim.status) {
    case 'ok':
      return { tone: 'ok', title: 'All measurements agree', detail: `${raim.n} satellites, ${raim.redundancy} spare. ${dis}` }
    case 'fault-excluded': {
      const ex = e.sats.find((s) => s.excluded)
      return {
        tone: 'warning',
        title: `Fault found: ${ex?.id ?? 'a satellite'} left out`,
        detail: `Without ${ex?.id ?? 'it'} the other ${raim.n - 1} agree, so it must be the faulty one. The position is worked out again without it. ${dis}`,
      }
    }
    case 'fault-detected':
      if (raim.n === 5)
        return {
          tone: 'alert',
          title: 'Alarm: one measurement does not fit',
          detail: `With 5 satellites RAIM can tell something is wrong, but not which satellite. Do not use this position. ${dis}`,
        }
      return {
        tone: 'alert',
        title: raim.ambiguous ? 'Alarm: fault found, not yet located' : 'Alarm: measurements do not fit',
        detail: raim.ambiguous
          ? `Leaving out different satellites still gives answers that look acceptable, so RAIM cannot yet say which one is faulty. Do not use this position. ${dis}`
          : `No group of satellites agrees, so there may be more than one fault. Do not use this position. ${dis}`,
      }
  }
  return { tone: 'muted', title: '', detail: '' }
}

export function correctionsSummary(e: GnssEngine): StatusLine {
  const s = e.settings
  const flagged = e.sats.find((x) => x.flagged)
  const aug = e.augmentation
  if (flagged && aug !== 'none')
    return {
      tone: 'warning',
      title: `${aug === 'sbas' ? 'SBAS' : 'GBAS'} says: do not use ${flagged.id}`,
      detail: 'Its ground network spotted the bad satellite within seconds and told every receiver to leave it out.',
    }
  if (aug === 'gbas') return { tone: 'ok', title: 'GBAS corrections in use', detail: 'From the ground station at this airport, sent over a VHF data link.' }
  if (aug === 'sbas') return { tone: 'ok', title: 'SBAS corrections in use', detail: 'From the geostationary satellite: satellite orbit, clock and ionosphere corrections.' }
  if (s.gbas && !e.gbasInRange)
    return { tone: 'warning', title: 'GBAS not used up here', detail: `GBAS serves approaches and landings near the airport, not cruise at ${SITES[s.site].short}.` }
  if (s.sbas && !e.geo.tracked) return { tone: 'alert', title: 'SBAS signal lost', detail: 'The SBAS satellite broadcasts on the same frequency as GPS, so it is jammed too.' }
  return { tone: 'muted', title: 'No corrections', detail: "Only the satellites' own broadcast information is used." }
}

