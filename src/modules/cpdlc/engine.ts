/**
 * CPDLC scenario engine: one oceanic centre (the learner is its controller),
 * the next centre, the learner's aircraft CNS123 and a nearby aircraft CNS132
 * with a similar callsign. Every message travels over the selected path with a
 * delivery delay; nothing happens without the world clock moving.
 */

import {
  answerConnectionRequest,
  checkUplink,
  emptyLink,
  endService,
  formatElement,
  isClosingResponse,
  loseAllConnections,
  messageResponseAttr,
  needsResponse,
  nextMin,
  RCP,
  rcpStatus,
  sampleDeliveryS,
  setNextDataAuthority,
  simulateCpdlc,
  simulateVoice,
  validateLogon,
  type AircraftIdentity,
  type AvionicsLink,
  type ChallengeResult,
  type DataLinkPath,
  type ElementValues,
  type RcpType,
  type ResponseAttr,
} from '@/core/cpdlc'
import { mulberry32 } from '@/core/random'

export type Standard = 'fans' | 'atn'

export interface CpdlcEnv {
  /** The network is congested: every message takes much longer. */
  delay: boolean
  /** The data link is down. */
  lost: boolean
  /** A nearby aircraft with a similar callsign tries to log on as CNS123 and hears CNS123's uplinks. */
  wrongAircraft: boolean
}

export const DEFAULT_ENV: CpdlcEnv = { delay: false, lost: false, wrongAircraft: false }

export const CENTRE = { id: 'XLAB', name: 'Lab Oceanic' } as const
export const NEXT_CENTRE = { id: 'XHBR', name: 'Harbour Oceanic', frequency: '132.350' } as const
export const OWN: AircraftIdentity = { flightId: 'CNS123', registration: 'PK-CNS', address: '8A1C23' }
export const OTHER: AircraftIdentity = { flightId: 'CNS132', registration: 'PK-CNT', address: '8A1C32' }
/** Flight plans the centre holds. */
export const FLIGHT_PLANS: AircraftIdentity[] = [OWN, OTHER]

/** Extra delay per message when the network is congested, s. TODO(expert-review): illustrative. */
export const EXTRA_DELAY_S = 150
/** Ground-to-ground forwarding between centres, s. TODO(expert-review): illustrative. */
export const GROUND_FORWARD_S = 2
/** Climb and descent rate after WILCO, flight levels per second (1,000 ft/min). */
export const LEVEL_RATE_FL_S = 10 / 60
/** Levels the controller can choose. */
export const LEVELS = [300, 310, 320, 330, 340, 350, 360, 370, 380, 390, 400, 410]
/** Clock time shown on the displays at t = 0 (fictional UTC). */
export const START_UTC_S = 14 * 3600 + 20 * 60

export type Party = 'XLAB' | 'XHBR' | 'CNS123' | 'CNS132'
export type TransitKind = 'cpdlc' | 'logon' | 'logon-ack' | 'logon-reject' | 'cr' | 'cc' | 'forward'

export interface Transit {
  id: number
  kind: TransitKind
  from: Party
  to: Party
  /** The aircraft address the message is for (up) or from (down). */
  address: string
  label: string
  path: DataLinkPath | 'ground'
  sentS: number
  arriveS: number
  lost: boolean
  /** When the link failed under it (for drawing), s. */
  lostS?: number
  /** Log entry for CPDLC messages. */
  entry?: number
  /** Extra data for logon messages. */
  logon?: AircraftIdentity
}

export interface Entry {
  id: number
  dir: 'up' | 'down'
  aircraft: 'CNS123' | 'CNS132'
  from: Party
  to: Party
  min: number
  mrn: number | null
  elements: string[]
  values: ElementValues
  text: string
  resp: ResponseAttr
  path: DataLinkPath
  sentS: number
  receivedS: number | null
  status: 'sending' | 'received' | 'lost' | 'rejected'
  /** The sender is waiting for a reply. */
  open: boolean
  standby: boolean
  answer: string | null
  closedS: number | null
  closedBy: 'reply' | 'voice' | null
  /** The connection was lost while this was open: it must be handled by voice. */
  needsVoice: boolean
  /** Handled by voice: the cockpit only shows it for information (OK key, no reply). */
  void: boolean
  /** Cockpit: the pilot has replied or dismissed it. */
  handled: boolean
  /** Controller has seen the RCP alert for this one. */
  alerted: boolean
}

export interface Alert {
  id: number
  timeS: number
  tone: 'warning' | 'alert' | 'info'
  title: string
  text: string
  /** Offer a follow-up: another level after UNABLE. */
  offerLevel?: number
  entry?: number
}

export type LogonState = 'none' | 'sent' | 'accepted' | 'rejected' | 'failed'
export type GroundConn = 'none' | 'requested' | 'inactive' | 'active' | 'transferred'

export interface Milestones {
  logonSent?: number
  logonAccepted?: number
  crSent?: number
  connected?: number
  ndaSent?: number
  nextConnected?: number
  transferred?: number
}

export interface ChallengeRun {
  n: number
  path: DataLinkPath
  seed: number
  startS: number
  voice: ChallengeResult
  cpdlc: ChallengeResult
  done: boolean
}

export class CpdlcEngine {
  timeS = 0
  standard: Standard = 'fans'
  path: DataLinkPath = 'vhf'
  rcp: RcpType = 240
  env: CpdlcEnv = { ...DEFAULT_ENV }

  transits: Transit[] = []
  entries: Entry[] = []
  alerts: Alert[] = []
  milestones: Milestones = {}

  // Aircraft CNS123.
  link: AvionicsLink = emptyLink(OWN.address)
  logonState: LogonState = 'none'
  logonNote = ''
  levelFl = 350
  clearedFl = 350
  // Nearby CNS132 (only used when "wrong aircraft" is on).
  otherLog: { timeS: number; text: string }[] = []
  otherLogonState: LogonState = 'none'

  // Ground side, seen by XLAB.
  xlab: GroundConn = 'none'
  xhbr: GroundConn = 'none'

  /** New messages shown on the cockpit display (for the chime and caption). */
  chimes: { id: number; text: string }[] = []

  challenge: ChallengeRun | null = null
  challengeHistory: { n: number; path: DataLinkPath; voiceS: number; voiceMisheard: number; voiceCorrected: number; cpdlcS: number }[] = []

  private rand: () => number
  private nextId = 1
  private groundMin: number | null = null
  private airMin: number | null = null
  private runs = 0

  constructor(seed = 7) {
    this.rand = mulberry32(seed)
  }

  reset() {
    const { standard, path, rcp } = this
    Object.assign(this, new CpdlcEngine())
    this.standard = standard
    this.path = standard === 'atn' ? 'vhf' : path
    this.rcp = rcp
  }

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------

  setStandard(s: Standard) {
    if (s === this.standard) return
    this.standard = s
    this.reset()
  }

  setPath(p: DataLinkPath) {
    this.path = this.standard === 'atn' ? 'vhf' : p
  }

  setEnv(k: keyof CpdlcEnv, v: boolean) {
    const was = this.env[k]
    this.env = { ...this.env, [k]: v }
    if (k === 'lost' && v && !was) this.loseLink()
    if (k === 'wrongAircraft' && v && !was) this.impostorLogon()
  }

  get logonName() {
    return this.standard === 'fans' ? 'AFN logon' : 'CM logon'
  }

  get pathName() {
    return this.path === 'vhf' ? (this.standard === 'atn' ? 'VDL Mode 2' : 'VHF data link') : this.path === 'satcom' ? 'SATCOM' : 'HF data link'
  }

  /** Display clock, e.g. "1423:05". */
  utc(tS = this.timeS) {
    const s = Math.floor(START_UTC_S + tS) % 86400
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    return `${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  }

  // -------------------------------------------------------------------------
  // Stepping
  // -------------------------------------------------------------------------

  step(dt: number) {
    if (!(dt > 0)) return
    const end = this.timeS + dt
    // Deliver messages in time order, even within one long frame.
    for (;;) {
      const due = this.transits.filter((t) => !t.lost && t.arriveS <= end).sort((a, b) => a.arriveS - b.arriveS)[0]
      if (!due) break
      this.timeS = Math.max(this.timeS, due.arriveS)
      this.transits = this.transits.filter((t) => t !== due)
      this.deliver(due)
    }
    this.timeS = end
    this.transits = this.transits.filter((t) => !t.lost || end - (t.lostS ?? t.sentS) < 6)
    // The aircraft climbs or descends to its cleared level.
    const d = this.clearedFl - this.levelFl
    const stepFl = LEVEL_RATE_FL_S * dt
    this.levelFl = Math.abs(d) <= stepFl ? this.clearedFl : this.levelFl + Math.sign(d) * stepFl
    // RCP alarms.
    for (const e of this.entries) {
      if (e.dir !== 'up' || !e.open || e.needsVoice || e.alerted) continue
      if (rcpStatus(this.timeS - e.sentS, this.rcp) === 'expired') {
        e.alerted = true
        this.alert('alert', `No answer within RCP ${this.rcp}`, `MIN ${e.min} “${e.text}” to ${e.aircraft} has had no final answer for ${RCP[this.rcp].expirationS} s. Contact the aircraft by voice.`, { entry: e.id })
      }
    }
    // Challenge.
    const c = this.challenge
    if (c && !c.done && this.timeS - c.startS >= Math.max(c.voice.totalS, c.cpdlc.totalS)) {
      c.done = true
      this.challengeHistory.unshift({ n: c.n, path: c.path, voiceS: c.voice.totalS, voiceMisheard: c.voice.misheard, voiceCorrected: c.voice.corrected, cpdlcS: c.cpdlc.totalS })
      if (this.challengeHistory.length > 6) this.challengeHistory.length = 6
    }
  }

  private send(t: Omit<Transit, 'id' | 'sentS' | 'arriveS' | 'lost' | 'path'> & { path?: DataLinkPath | 'ground' }): Transit {
    const path = t.path ?? this.path
    const delay = path === 'ground' ? GROUND_FORWARD_S : sampleDeliveryS(path, this.rand) + (this.env.delay ? EXTRA_DELAY_S : 0)
    const tr: Transit = { ...t, path, id: this.nextId++, sentS: this.timeS, arriveS: this.timeS + delay, lost: false }
    this.transits.push(tr)
    return tr
  }

  private alert(tone: Alert['tone'], title: string, text: string, extra: Partial<Alert> = {}) {
    this.alerts.unshift({ id: this.nextId++, timeS: this.timeS, tone, title, text, ...extra })
    if (this.alerts.length > 5) this.alerts.length = 5
  }

  dismissAlert(id: number) {
    this.alerts = this.alerts.filter((a) => a.id !== id)
  }

  private deliver(t: Transit) {
    switch (t.kind) {
      case 'logon':
        return this.groundReceivesLogon(t)
      case 'logon-ack':
        if (t.to === 'CNS123') this.logonState = 'accepted'
        return
      case 'logon-reject':
        if (t.to === 'CNS132') {
          this.otherLogonState = 'rejected'
          this.otherLog.unshift({ timeS: this.timeS, text: 'LOGON REJECTED by XLAB: flight ID does not match this aircraft.' })
        } else {
          this.logonState = 'rejected'
        }
        return
      case 'forward':
        // The next centre has the aircraft's details: it asks for an (inactive) connection.
        this.xhbr = 'requested'
        this.send({ kind: 'cr', from: 'XHBR', to: 'CNS123', address: OWN.address, label: 'Connection request (XHBR)' })
        return
      case 'cr': {
        const ans = answerConnectionRequest(this.link, t.from)
        this.link = ans.link
        if (ans.accept) this.send({ kind: 'cc', from: 'CNS123', to: t.from, address: OWN.address, label: 'Connection confirm' })
        else if (t.from === 'XHBR') this.xhbr = 'none'
        return
      }
      case 'cc':
        if (t.to === 'XLAB') {
          this.xlab = 'active'
          this.milestones.connected = this.timeS
        } else if (this.link.active === 'XHBR') {
          // The crew logged on to XHBR directly: it is the current authority.
          this.xhbr = 'active'
          this.milestones.transferred = this.timeS
        } else {
          this.xhbr = 'inactive'
          this.milestones.nextConnected = this.timeS
        }
        return
      case 'cpdlc':
        return t.to === 'CNS123' ? this.aircraftReceives(t) : this.groundReceives(t)
    }
  }

  // -------------------------------------------------------------------------
  // Logon and connection
  // -------------------------------------------------------------------------

  pilotLogon(flightId = OWN.flightId): { ok: boolean; reason?: string } {
    if (this.env.lost) {
      this.logonState = 'failed'
      this.logonNote = 'No data link service: the logon could not be sent.'
      return { ok: false, reason: this.logonNote }
    }
    if (this.link.active) return { ok: false, reason: 'Already connected.' }
    this.logonState = 'sent'
    this.logonNote = ''
    const to = this.logonTarget
    if (to === 'XLAB') this.milestones = { logonSent: this.timeS }
    this.send({ kind: 'logon', from: 'CNS123', to, address: OWN.address, label: `${this.logonName} to ${to}`, logon: { ...OWN, flightId: flightId.trim().toUpperCase() } })
    return { ok: true }
  }

  /** Where the crew logs on: XLAB, or XHBR once XLAB has ended its service. */
  get logonTarget(): 'XLAB' | 'XHBR' {
    return this.xlab === 'transferred' ? 'XHBR' : 'XLAB'
  }

  /** CNS132's crew typed CNS123 by mistake and logs on. */
  private impostorLogon() {
    this.otherLog.unshift({ timeS: this.timeS, text: `Crew typed flight ID CNS123 by mistake and sent a ${this.logonName}.` })
    if (this.env.lost) {
      this.otherLog.unshift({ timeS: this.timeS, text: 'No data link service: logon not sent.' })
      return
    }
    this.otherLogonState = 'sent'
    this.send({ kind: 'logon', from: 'CNS132', to: 'XLAB', address: OTHER.address, label: `${this.logonName} (CNS132)`, logon: { ...OTHER, flightId: 'CNS123' } })
  }

  private groundReceivesLogon(t: Transit) {
    const logon = t.logon!
    const centre = t.to as 'XLAB' | 'XHBR'
    const r = validateLogon(logon, FLIGHT_PLANS)
    const aircraft = t.from as 'CNS123' | 'CNS132'
    if (!r.ok) {
      if (centre === 'XLAB') this.alert('warning', 'Logon rejected', `${this.logonName} for ${logon.flightId} from aircraft ${logon.address} (${logon.registration}) refused. ${r.reason}.`)
      this.send({ kind: 'logon-reject', from: centre, to: aircraft, address: logon.address, label: 'Logon rejected' })
      if (aircraft === 'CNS123') this.logonNote = r.reason
      return
    }
    this.send({ kind: 'logon-ack', from: centre, to: aircraft, address: logon.address, label: 'Logon accepted' })
    if (centre === 'XLAB') {
      this.milestones.logonAccepted = this.timeS
      this.milestones.crSent = this.timeS
      this.xlab = 'requested'
    } else this.xhbr = 'requested'
    this.send({ kind: 'cr', from: centre, to: aircraft, address: logon.address, label: `Connection request (${centre})` })
  }

  /** Set-up shortcut for experiments: logon and connection already done. */
  quickConnect() {
    this.env = { ...this.env, lost: false }
    this.link = { ...emptyLink(OWN.address), active: 'XLAB' }
    this.logonState = 'accepted'
    this.logonNote = ''
    this.xlab = 'active'
    this.xhbr = 'none'
    const t = this.timeS
    this.milestones = { logonSent: t, logonAccepted: t, crSent: t, connected: t }
  }

  private loseLink() {
    for (const t of this.transits) {
      if (t.lost) continue
      t.lost = true
      t.lostS = this.timeS
      const e = t.entry != null ? this.entry(t.entry) : undefined
      if (e) e.status = 'lost'
    }
    const had = this.link.active != null || this.xlab !== 'none'
    this.link = loseAllConnections(this.link)
    if (this.logonState === 'sent') this.logonState = 'none'
    else if (this.logonState === 'accepted') this.logonState = 'none'
    this.logonNote = 'Data link lost. Log on again when it is back.'
    if (this.xlab !== 'transferred') this.xlab = 'none'
    this.xhbr = 'none'
    let open = 0
    for (const e of this.entries) {
      if (e.open && !e.closedBy) {
        e.needsVoice = true
        open++
      }
    }
    if (had || open) {
      this.alert(
        'alert',
        'CPDLC connection with CNS123 lost',
        `${open ? `${open} open message${open === 1 ? '' : 's'} must now be handled by voice (HF, VHF or SATVOICE). ` : ''}The crew must log on again when the data link returns.`,
      )
    }
  }

  // -------------------------------------------------------------------------
  // Controller
  // -------------------------------------------------------------------------

  /** Why the controller cannot send to this aircraft right now, or null. */
  cannotSend(aircraft: 'CNS123' | 'CNS132'): string | null {
    if (this.env.lost) return 'The data link is down. Use voice.'
    if (aircraft === 'CNS132') return 'No CPDLC connection with CNS132: it has not logged on to XLAB. Its messages can only go by voice.'
    if (this.xlab === 'transferred') return 'CNS123 now belongs to XHBR, the current data authority.'
    if (this.xlab !== 'active') return 'No CPDLC connection with CNS123 yet: the aircraft must log on first.'
    return null
  }

  /** The controller sends an uplink. `mrn` answers a pilot request. */
  sendUplink(aircraft: 'CNS123' | 'CNS132', elements: { id: string; values?: ElementValues }[], mrn: number | null = null): { ok: boolean; reason?: string; entry?: Entry } {
    const why = this.cannotSend(aircraft)
    if (why) return { ok: false, reason: why }
    const ids = elements.map((e) => e.id)
    const values = Object.assign({}, ...elements.map((e) => e.values ?? {})) as ElementValues
    const text = elements.map((e) => formatElement(e.id, e.values)).join(' · ')
    const resp = messageResponseAttr(ids)
    this.groundMin = nextMin(this.groundMin)
    const entry = this.addEntry({ dir: 'up', aircraft, from: 'XLAB', to: aircraft, min: this.groundMin, mrn, elements: ids, values, text, resp, open: needsResponse(resp) })
    if (ids.includes('UM160')) this.milestones.ndaSent = this.timeS
    // The reply to a pilot request closes that request (unless it is STANDBY).
    if (mrn != null) {
      const req = this.entries.find((e) => e.dir === 'down' && e.min === mrn && e.open)
      if (req) {
        if (isClosingResponse(ids[0])) this.close(req, 'reply')
        else req.standby = true
        req.answer = text
      }
    }
    this.send({ kind: 'cpdlc', from: 'XLAB', to: aircraft, address: OWN.address, label: `${ids.join('+')} ${text}`, entry: entry.id })
    return { ok: true, entry }
  }

  /** Fall back to voice for an open message. */
  giveByVoice(entryId: number) {
    const e = this.entry(entryId)
    if (!e || !e.open) return
    this.close(e, 'voice')
    // Whether it is still on its way or already on the cockpit display, the crew now has
    // it by voice: the data link copy needs no reply.
    e.void = true
    e.answer = 'Given by voice'
    const lv = e.values.level
    if (lv != null && (e.elements.includes('UM20') || e.elements.includes('UM23'))) this.clearedFl = lv
    this.alerts = this.alerts.filter((a) => a.entry !== entryId)
  }

  private close(e: Entry, by: 'reply' | 'voice') {
    e.open = false
    e.closedS = this.timeS
    e.closedBy = by
    e.needsVoice = false
  }

  // -------------------------------------------------------------------------
  // Aircraft
  // -------------------------------------------------------------------------

  private aircraftReceives(t: Transit) {
    const e = t.entry != null ? this.entry(t.entry) : undefined
    if (this.env.wrongAircraft) {
      this.otherLog.unshift({ timeS: this.timeS, text: `Heard an uplink for address ${t.address}. This aircraft is ${OTHER.address}: not for us, ignored.` })
      if (this.otherLog.length > 6) this.otherLog.length = 6
    }
    if (!e) return
    const check = checkUplink(this.link, t.address, t.from)
    if (check !== 'ok') {
      e.status = 'rejected'
      e.receivedS = this.timeS
      if (e.open) {
        e.needsVoice = true
        this.alert('warning', 'Message rejected by the aircraft', `CNS123 has no active connection with ${t.from}, so its avionics refused MIN ${e.min}. Use voice.`, { entry: e.id })
      }
      return
    }
    e.status = 'received'
    e.receivedS = this.timeS
    if (!e.void) this.chimes.push({ id: e.id, text: e.text })
    if (e.elements.includes('UM160')) {
      this.link = setNextDataAuthority(this.link, t.from, e.values.unit ?? NEXT_CENTRE.id)
      // The network confirms delivery; XLAB then forwards the aircraft's logon to the next centre.
      this.send({ kind: 'forward', from: 'XLAB', to: 'XHBR', address: OWN.address, label: 'Logon forwarded to XHBR', path: 'ground' })
    }
    if (e.elements.includes('UM161') && e.resp === 'N') this.doEndService()
  }

  /** The pilot replies to an uplink. */
  pilotRespond(entryId: number, dm: 'DM0' | 'DM1' | 'DM2' | 'DM3' | 'DM4' | 'DM5'): { ok: boolean; reason?: string } {
    const up = this.entry(entryId)
    if (!up || up.dir !== 'up' || up.status !== 'received' || up.handled) return { ok: false, reason: 'Nothing to answer.' }
    if (up.void) return { ok: false, reason: 'ATC has already given this by voice. No reply.' }
    if (this.env.lost || !this.link.active) return { ok: false, reason: 'No data link connection. Use voice.' }
    this.airMin = nextMin(this.airMin)
    const text = formatElement(dm)
    const down = this.addEntry({ dir: 'down', aircraft: 'CNS123', from: 'CNS123', to: up.from, min: this.airMin, mrn: up.min, elements: [dm], values: {}, text, resp: 'N', open: false })
    this.send({ kind: 'cpdlc', from: 'CNS123', to: up.from, address: OWN.address, label: `${dm} ${text}`, entry: down.id })
    if (isClosingResponse(dm)) up.handled = true
    if (dm === 'DM0') {
      const lv = up.values.level
      if (lv != null && (up.elements.includes('UM20') || up.elements.includes('UM23'))) this.clearedFl = lv
      if (up.elements.includes('UM161')) this.doEndService()
    }
    return { ok: true }
  }

  /** The pilot has read a message that needs no reply (or one already handled by voice). */
  pilotDismiss(entryId: number) {
    const e = this.entry(entryId)
    if (e && e.dir === 'up' && e.status === 'received' && (!needsResponse(e.resp) || e.void)) e.handled = true
  }

  /** DM6: the pilot asks for a level. */
  pilotRequest(level: number): { ok: boolean; reason?: string } {
    if (this.env.lost || !this.link.active) return { ok: false, reason: 'No data link connection. Use voice.' }
    this.airMin = nextMin(this.airMin)
    const text = formatElement('DM6', { level })
    const e = this.addEntry({ dir: 'down', aircraft: 'CNS123', from: 'CNS123', to: this.link.active as Party, min: this.airMin, mrn: null, elements: ['DM6'], values: { level }, text, resp: 'Y', open: true })
    this.send({ kind: 'cpdlc', from: 'CNS123', to: this.link.active as Party, address: OWN.address, label: `DM6 ${text}`, entry: e.id })
    return { ok: true }
  }

  private doEndService() {
    const hadNext = this.link.inactive
    this.link = endService(this.link)
    this.xlab = 'transferred'
    if (hadNext) {
      this.xhbr = 'active'
      this.milestones.transferred = this.timeS
    } else {
      this.logonState = 'none'
      this.logonNote = 'XLAB ended its service before XHBR was connected. Log on to XHBR.'
      this.alert('info', 'CNS123 has no data link connection now', 'XLAB ended the service before XHBR had a connection, so the crew must log on to XHBR by hand. Sending NEXT DATA AUTHORITY first avoids this gap.')
    }
  }

  /** A downlink arrives at a centre. */
  private groundReceives(t: Transit) {
    const e = t.entry != null ? this.entry(t.entry) : undefined
    if (!e) return
    e.status = 'received'
    e.receivedS = this.timeS
    if (t.to !== 'XLAB') return
    if (e.mrn != null) {
      const up = this.entries.find((x) => x.dir === 'up' && x.min === e.mrn && x.aircraft === e.aircraft)
      if (up && up.open) {
        const dm = e.elements[0]
        up.answer = e.text
        if (dm === 'DM2') up.standby = true
        else this.close(up, 'reply')
        if (dm === 'DM1') {
          const lv = up.values.level
          const other = lv != null ? this.alternativeLevel(lv) : undefined
          this.alert(
            'warning',
            `${up.aircraft} is UNABLE`,
            `“${up.text}” is not accepted, so it is not in force: the aircraft stays at FL${String(Math.round(this.clearedFl)).padStart(3, '0')}. Plan something else: offer another level, keep it where it is, or talk it through on voice.`,
            { entry: up.id, offerLevel: other },
          )
        }
      }
    }
  }

  /** A sensible second offer after UNABLE: one level closer to the current one. */
  alternativeLevel(refused: number): number | undefined {
    const cur = Math.round(this.clearedFl)
    if (refused === cur) return undefined
    const alt = refused > cur ? refused - 10 : refused + 10
    return alt !== cur ? alt : undefined
  }

  // -------------------------------------------------------------------------
  // Readouts
  // -------------------------------------------------------------------------

  entry(id: number): Entry | undefined {
    return this.entries.find((e) => e.id === id)
  }

  private addEntry(p: Pick<Entry, 'dir' | 'aircraft' | 'from' | 'to' | 'min' | 'mrn' | 'elements' | 'values' | 'text' | 'resp' | 'open'>): Entry {
    const e: Entry = {
      ...p,
      id: this.nextId++,
      path: this.path,
      sentS: this.timeS,
      receivedS: null,
      status: 'sending',
      standby: false,
      answer: null,
      closedS: null,
      closedBy: null,
      needsVoice: false,
      void: false,
      handled: false,
      alerted: false,
    }
    this.entries.unshift(e)
    if (this.entries.length > 40) this.entries.length = 40
    return e
  }

  /** The uplink the cockpit display should show now (oldest unhandled first). */
  cockpitMessage(): Entry | undefined {
    const shown = this.entries.filter((e) => e.dir === 'up' && e.status === 'received' && !e.handled)
    return shown[shown.length - 1]
  }

  /** Messages the controller is waiting on, with their timers. */
  openUplinks(): (Entry & { elapsedS: number; rcpState: ReturnType<typeof rcpStatus> })[] {
    return this.entries
      .filter((e) => e.dir === 'up' && e.open)
      .map((e) => ({ ...e, elapsedS: this.timeS - e.sentS, rcpState: rcpStatus(this.timeS - e.sentS, this.rcp) }))
  }

  /** Pilot requests waiting for the controller's answer. */
  openRequests(): Entry[] {
    return this.entries.filter((e) => e.dir === 'down' && e.open && e.status === 'received' && e.to === 'XLAB')
  }

  // -------------------------------------------------------------------------
  // Voice versus datalink challenge
  // -------------------------------------------------------------------------

  startChallenge(n: number) {
    this.runs++
    const seed = 100 + this.runs
    this.challenge = { n, path: this.path, seed, startS: this.timeS, voice: simulateVoice(n, mulberry32(seed)), cpdlc: simulateCpdlc(n, mulberry32(seed + 5000), this.path), done: false }
  }

  challengeElapsedS(): number {
    return this.challenge ? Math.max(0, this.timeS - this.challenge.startS) : 0
  }
}
