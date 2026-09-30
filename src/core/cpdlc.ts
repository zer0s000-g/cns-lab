/**
 * Controller–Pilot Data Link Communications (CPDLC): message elements and
 * their response rules, logon and addressing checks, the data-authority
 * connection rules (current and next data authority), delivery delay by
 * path, required communication performance (RCP) timing, and a simple,
 * clearly illustrative "voice versus datalink" workload model.
 *
 * All functions are pure. Randomness only through a passed-in generator.
 */

// ---------------------------------------------------------------------------
// Message set
// ---------------------------------------------------------------------------

/**
 * Response attribute of a message element:
 *   W/U  WILCO, UNABLE (STANDBY allowed first)       for clearances
 *   A/N  AFFIRM, NEGATIVE (STANDBY allowed first)    for questions
 *   R    ROGER, UNABLE (STANDBY allowed first)       for information
 *   Y    any reply required (used for pilot requests; the controller answers)
 *   N    no reply required
 */
export type ResponseAttr = 'W/U' | 'A/N' | 'R' | 'Y' | 'N'

export type ElementParam = 'level' | 'unit' | 'frequency'

export interface MessageElementDef {
  /** e.g. "UM20" or "DM0". */
  id: string
  dir: 'up' | 'down'
  /** Text with parameters in brackets, e.g. "CLIMB TO [level]". */
  template: string
  resp: ResponseAttr
  params: ElementParam[]
}

// TODO(expert-review): element numbers and response attributes checked against the FANS 1/A and ATN B1 message sets.
export const MESSAGE_ELEMENTS: Record<string, MessageElementDef> = {
  UM0: { id: 'UM0', dir: 'up', template: 'UNABLE', resp: 'N', params: [] },
  UM1: { id: 'UM1', dir: 'up', template: 'STANDBY', resp: 'N', params: [] },
  UM3: { id: 'UM3', dir: 'up', template: 'ROGER', resp: 'N', params: [] },
  UM20: { id: 'UM20', dir: 'up', template: 'CLIMB TO [level]', resp: 'W/U', params: ['level'] },
  UM23: { id: 'UM23', dir: 'up', template: 'DESCEND TO [level]', resp: 'W/U', params: ['level'] },
  UM117: { id: 'UM117', dir: 'up', template: 'CONTACT [unit] [frequency]', resp: 'W/U', params: ['unit', 'frequency'] },
  UM120: { id: 'UM120', dir: 'up', template: 'MONITOR [unit] [frequency]', resp: 'W/U', params: ['unit', 'frequency'] },
  UM160: { id: 'UM160', dir: 'up', template: 'NEXT DATA AUTHORITY [unit]', resp: 'N', params: ['unit'] },
  UM161: { id: 'UM161', dir: 'up', template: 'END SERVICE', resp: 'N', params: [] },
  DM0: { id: 'DM0', dir: 'down', template: 'WILCO', resp: 'N', params: [] },
  DM1: { id: 'DM1', dir: 'down', template: 'UNABLE', resp: 'N', params: [] },
  DM2: { id: 'DM2', dir: 'down', template: 'STANDBY', resp: 'N', params: [] },
  DM3: { id: 'DM3', dir: 'down', template: 'ROGER', resp: 'N', params: [] },
  DM4: { id: 'DM4', dir: 'down', template: 'AFFIRM', resp: 'N', params: [] },
  DM5: { id: 'DM5', dir: 'down', template: 'NEGATIVE', resp: 'N', params: [] },
  DM6: { id: 'DM6', dir: 'down', template: 'REQUEST [level]', resp: 'Y', params: ['level'] },
}

export interface ElementValues {
  /** Flight level, e.g. 350 for FL350. */
  level?: number
  unit?: string
  frequency?: string
}

/** Flight level as CPDLC prints it: "FL350". */
export const formatLevel = (fl: number) => (Number.isFinite(fl) ? `FL${String(Math.max(0, Math.round(fl))).padStart(3, '0')}` : 'FL—')

/** Fill a message element's parameters, e.g. UM20 + {level: 370} → "CLIMB TO FL370". */
export function formatElement(id: string, v: ElementValues = {}): string {
  const def = MESSAGE_ELEMENTS[id]
  if (!def) throw new Error(`Unknown message element ${id}`)
  return def.template
    .replace('[level]', v.level != null ? formatLevel(v.level) : '[level]')
    .replace('[unit]', v.unit ?? '[unit]')
    .replace('[frequency]', v.frequency ?? '[frequency]')
}

const ATTR_RANK: Record<ResponseAttr, number> = { 'W/U': 4, 'A/N': 3, R: 2, Y: 1, N: 0 }

/** A message made of several elements takes the most demanding response attribute among them. */
export function messageResponseAttr(elementIds: string[]): ResponseAttr {
  let best: ResponseAttr = 'N'
  for (const id of elementIds) {
    const r = MESSAGE_ELEMENTS[id]?.resp ?? 'N'
    if (ATTR_RANK[r] > ATTR_RANK[best]) best = r
  }
  return best
}

/** Downlink replies the pilot may send to an uplink with this response attribute. */
export function responseOptions(attr: ResponseAttr): string[] {
  switch (attr) {
    case 'W/U':
      return ['DM0', 'DM1', 'DM2']
    case 'A/N':
      return ['DM4', 'DM5', 'DM2']
    case 'R':
      return ['DM3', 'DM1', 'DM2']
    default:
      return []
  }
}

/** Uplink replies the controller may send to a pilot request (attribute Y). */
export const CONTROLLER_REPLIES_TO_REQUEST = ['UM20', 'UM23', 'UM0', 'UM1'] as const

/** STANDBY keeps the dialogue open; every other reply closes it. */
export const isClosingResponse = (elementId: string) => elementId !== 'DM2' && elementId !== 'UM1'

/** Does a message with this attribute wait for a reply? */
export const needsResponse = (attr: ResponseAttr) => attr !== 'N'

/** Message identification numbers run 0–63 and then wrap. TODO(expert-review): FANS 1/A MIN range. */
export const MIN_MODULO = 64
export const nextMin = (prev: number | null) => (prev == null ? 0 : (prev + 1) % MIN_MODULO)

// ---------------------------------------------------------------------------
// Logon and addressing
// ---------------------------------------------------------------------------

export interface AircraftIdentity {
  flightId: string
  registration: string
  /** 24-bit ICAO aircraft address, six hex digits. */
  address: string
}

export type LogonResult = { ok: true; plan: AircraftIdentity } | { ok: false; reason: string }

/**
 * The centre checks a logon against its flight plans: the flight identification
 * must exist AND the aircraft address and registration must be the ones filed
 * for that flight. This stops a wrong aircraft being connected.
 */
export function validateLogon(logon: AircraftIdentity, plans: AircraftIdentity[]): LogonResult {
  const plan = plans.find((p) => p.flightId === logon.flightId.trim().toUpperCase())
  if (!plan) return { ok: false, reason: `No flight plan for ${logon.flightId}` }
  if (plan.address.toUpperCase() !== logon.address.toUpperCase() || plan.registration.toUpperCase() !== logon.registration.toUpperCase()) {
    return { ok: false, reason: `${logon.flightId} is filed for aircraft ${plan.address} (${plan.registration}), but this logon came from ${logon.address} (${logon.registration})` }
  }
  return { ok: true, plan }
}

/** The aircraft's own view of its data-link connections. */
export interface AvionicsLink {
  address: string
  /** Centre with the active connection: the Current Data Authority. */
  active: string | null
  /** Centre with an inactive connection, ready to take over. */
  inactive: string | null
  /** Next Data Authority announced by the current one (UM160). */
  nda: string | null
}

export const emptyLink = (address: string): AvionicsLink => ({ address, active: null, inactive: null, nda: null })

export type UplinkCheck = 'ok' | 'not-my-address' | 'not-current-authority'

/**
 * Should this aircraft's avionics accept an uplink? Messages carry the aircraft
 * address; a unit only accepts messages addressed to it, and CPDLC messages
 * only from its Current Data Authority.
 */
export function checkUplink(link: AvionicsLink, toAddress: string, fromUnit: string): UplinkCheck {
  if (toAddress.toUpperCase() !== link.address.toUpperCase()) return 'not-my-address'
  if (fromUnit !== link.active) return 'not-current-authority'
  return 'ok'
}

export type ConnectionAnswer = { accept: true; as: 'active' | 'inactive'; link: AvionicsLink } | { accept: false; reason: string; link: AvionicsLink }

/**
 * A centre asks the aircraft for a connection. With no connection the aircraft
 * accepts (that centre becomes Current Data Authority). With a connection it
 * only accepts the Next Data Authority, as an inactive connection.
 */
export function answerConnectionRequest(link: AvionicsLink, fromUnit: string): ConnectionAnswer {
  if (link.active === fromUnit) return { accept: true, as: 'active', link }
  if (!link.active) return { accept: true, as: 'active', link: { ...link, active: fromUnit, nda: link.nda === fromUnit ? null : link.nda } }
  if (link.nda === fromUnit) return { accept: true, as: 'inactive', link: { ...link, inactive: fromUnit } }
  return { accept: false, reason: `${fromUnit} is not the next data authority`, link }
}

/**
 * UM160: the current centre names the next one. Naming a different centre ends any
 * inactive connection with the previously named one: only the Next Data Authority
 * may hold it, so END SERVICE can never hand control to a centre no longer named.
 */
export function setNextDataAuthority(link: AvionicsLink, fromUnit: string, next: string): AvionicsLink {
  if (fromUnit !== link.active) return link
  return { ...link, nda: next, inactive: link.inactive === next ? link.inactive : null }
}

/**
 * END SERVICE: the active connection ends. If the next centre already holds an
 * inactive connection, it becomes active: the new Current Data Authority.
 */
export function endService(link: AvionicsLink): AvionicsLink {
  return { ...link, active: link.inactive, inactive: null, nda: null }
}

/** The data link failed: every connection is gone and the crew must log on again. */
export const loseAllConnections = (link: AvionicsLink): AvionicsLink => emptyLink(link.address)

// ---------------------------------------------------------------------------
// Delivery delay and performance
// ---------------------------------------------------------------------------

export type DataLinkPath = 'vhf' | 'satcom' | 'hf'

/**
 * Typical one-way delivery time of a CPDLC message, s, by path.
 * TODO(expert-review): illustrative typical values. VHF data link a few seconds,
 * SATCOM tens of seconds end to end, HF data link longer.
 */
export const PATH_DELAY_S: Record<DataLinkPath, number> = { vhf: 5, satcom: 20, hf: 60 }

/** One delivery time: spread ±40 % around the typical value. */
export function sampleDeliveryS(path: DataLinkPath, rand: () => number): number {
  return PATH_DELAY_S[path] * (0.6 + 0.8 * rand())
}

/** Range of delivery times the sampler can produce, s. */
export const deliveryRangeS = (path: DataLinkPath): [number, number] => [PATH_DELAY_S[path] * 0.6, PATH_DELAY_S[path] * 1.4]

export type RcpType = 240 | 400

/**
 * Required Communication Performance: a controller's instruction and the reply
 * must be complete within the expiration time (99.9 %) and usually within
 * TT95 (95 %). TODO(expert-review): RCP 400 values.
 */
export const RCP: Record<RcpType, { expirationS: number; tt95S: number }> = {
  240: { expirationS: 240, tt95S: 210 },
  400: { expirationS: 400, tt95S: 350 },
}

export type RcpStatus = 'ok' | 'late' | 'expired'

/** Controller-side timer state for an open transaction. */
export function rcpStatus(elapsedS: number, rcp: RcpType): RcpStatus {
  if (elapsedS >= RCP[rcp].expirationS) return 'expired'
  if (elapsedS >= RCP[rcp].tt95S) return 'late'
  return 'ok'
}

// ---------------------------------------------------------------------------
// Voice versus datalink: an ILLUSTRATIVE workload model
// ---------------------------------------------------------------------------

/**
 * Parameters of the illustrative challenge. None of these are measured values.
 * TODO(expert-review): illustrative only.
 */
export interface ChallengeParams {
  /** Controller speaks the clearance, s. */
  voiceInstructionS: number
  /** Pilot reads it back, s. */
  voiceReadbackS: number
  /** Pause before the next call, s. */
  voiceGapS: number
  /** Chance the frequency is already busy with another call when the controller wants to talk. */
  frequencyBusyChance: number
  /** How long such a wait lasts, s: [min, max]. */
  busyWaitS: [number, number]
  /** Chance a transmission is blocked (two people talk at once) and must be repeated. */
  blockedChance: number
  /** Chance the pilot reads back something different from what was said. */
  readbackErrorChance: number
  /** Chance the controller hears the wrong readback and corrects it. */
  hearbackCatchChance: number
  /** Controller selects and sends one CPDLC message, s. */
  composeS: number
  /** Pilot reads the message, checks it and replies, s: [min, max]. */
  pilotResponseS: [number, number]
}

export const DEFAULT_CHALLENGE: ChallengeParams = {
  voiceInstructionS: 5,
  voiceReadbackS: 4,
  voiceGapS: 1.5,
  frequencyBusyChance: 0.35,
  busyWaitS: [2, 8],
  blockedChance: 0.06,
  readbackErrorChance: 0.08,
  hearbackCatchChance: 0.6,
  composeS: 6,
  pilotResponseS: [10, 40],
}

export type SegmentKind = 'busy' | 'say' | 'blocked' | 'readback' | 'correct' | 'compose' | 'uplink' | 'pilot' | 'downlink'

export interface Segment {
  kind: SegmentKind
  fromS: number
  toS: number
}

export interface Exchange {
  aircraft: number
  segments: Segment[]
  startS: number
  endS: number
  /** Voice: a wrong readback nobody noticed. */
  misheard: boolean
  /** Voice: a wrong readback the controller caught and corrected. */
  corrected: boolean
  blocked: number
}

export interface ChallengeResult {
  method: 'voice' | 'cpdlc'
  exchanges: Exchange[]
  totalS: number
  misheard: number
  corrected: number
  blocked: number
  /** Time the voice frequency was in use for these clearances, s. */
  frequencyS: number
}

const between = (r: () => number, [a, b]: [number, number]) => a + (b - a) * r()

/**
 * Voice: one call at a time on one frequency. Each clearance is quick, but the
 * next cannot start until the last readback is finished.
 */
export function simulateVoice(n: number, rand: () => number, p: ChallengeParams = DEFAULT_CHALLENGE): ChallengeResult {
  let t = 0
  let freq = 0
  const exchanges: Exchange[] = []
  for (let i = 0; i < n; i++) {
    const segs: Segment[] = []
    const add = (kind: SegmentKind, d: number) => {
      segs.push({ kind, fromS: t, toS: t + d })
      if (kind !== 'busy') freq += d
      t += d
    }
    const start = t
    if (rand() < p.frequencyBusyChance) add('busy', between(rand, p.busyWaitS))
    add('say', p.voiceInstructionS)
    let blocked = 0
    while (rand() < p.blockedChance && blocked < 3) {
      // The readback was stepped on: the controller has to say it again.
      segs[segs.length - 1].kind = 'blocked'
      blocked++
      add('say', p.voiceInstructionS)
    }
    add('readback', p.voiceReadbackS)
    let misheard = false
    let corrected = false
    if (rand() < p.readbackErrorChance) {
      if (rand() < p.hearbackCatchChance) {
        corrected = true
        add('correct', p.voiceInstructionS)
        add('readback', p.voiceReadbackS)
      } else misheard = true
    }
    exchanges.push({ aircraft: i, segments: segs, startS: start, endS: t, misheard, corrected, blocked })
    t += p.voiceGapS
  }
  const last = exchanges[exchanges.length - 1]
  return {
    method: 'voice',
    exchanges,
    totalS: last ? last.endS : 0,
    misheard: exchanges.filter((e) => e.misheard).length,
    corrected: exchanges.filter((e) => e.corrected).length,
    blocked: exchanges.reduce((a, e) => a + e.blocked, 0),
    frequencyS: freq,
  }
}

/**
 * CPDLC: the controller sends one message after another without waiting; each
 * then takes its own time (delivery, the pilot reading it, the reply). Nothing
 * can be misheard, but every single exchange takes longer than a voice call.
 */
export function simulateCpdlc(n: number, rand: () => number, path: DataLinkPath, p: ChallengeParams = DEFAULT_CHALLENGE): ChallengeResult {
  const exchanges: Exchange[] = []
  for (let i = 0; i < n; i++) {
    const composeFrom = i * p.composeS
    const sent = composeFrom + p.composeS
    const up = sampleDeliveryS(path, rand)
    const pilot = between(rand, p.pilotResponseS)
    const down = sampleDeliveryS(path, rand)
    const segs: Segment[] = [
      { kind: 'compose', fromS: composeFrom, toS: sent },
      { kind: 'uplink', fromS: sent, toS: sent + up },
      { kind: 'pilot', fromS: sent + up, toS: sent + up + pilot },
      { kind: 'downlink', fromS: sent + up + pilot, toS: sent + up + pilot + down },
    ]
    exchanges.push({ aircraft: i, segments: segs, startS: composeFrom, endS: sent + up + pilot + down, misheard: false, corrected: false, blocked: 0 })
  }
  return {
    method: 'cpdlc',
    exchanges,
    totalS: exchanges.reduce((a, e) => Math.max(a, e.endS), 0),
    misheard: 0,
    corrected: 0,
    blocked: 0,
    frequencyS: 0,
  }
}

/** Average results over many seeded runs (for the "on average" line). */
export function averageChallenge(n: number, runs: number, makeRand: (seed: number) => () => number, path: DataLinkPath, p: ChallengeParams = DEFAULT_CHALLENGE) {
  let vT = 0
  let cT = 0
  let vM = 0
  let vC = 0
  let vOne = 0
  let cOne = 0
  for (let k = 0; k < runs; k++) {
    const v = simulateVoice(n, makeRand(1000 + k), p)
    const c = simulateCpdlc(n, makeRand(5000 + k), path, p)
    vT += v.totalS
    cT += c.totalS
    vM += v.misheard
    vC += v.corrected
    vOne += v.exchanges.reduce((a, e) => a + (e.endS - e.startS), 0) / n
    cOne += c.exchanges.reduce((a, e) => a + (e.endS - e.segments[1].fromS), 0) / n
  }
  return {
    voiceTotalS: vT / runs,
    cpdlcTotalS: cT / runs,
    voiceMisheardPerRun: vM / runs,
    voiceCorrectedPerRun: vC / runs,
    /** Average time of one exchange, from the start of the call (voice) or from pressing Send (CPDLC) to the answer, s. */
    voiceOneS: vOne / runs,
    cpdlcOneS: cOne / runs,
  }
}
