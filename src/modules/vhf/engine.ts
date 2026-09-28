/**
 * VHF air-ground radio scenario. One ground radio site, the learner's
 * aircraft (CNS101), another pilot on the same frequency (CNS202), and for
 * the failures an aircraft with a stuck microphone (CNS303) and one close to
 * the learner talking on the next channel (CNS707).
 *
 * Everything sits on one straight line (the side view): positions are
 * distances from the radio site in NM, heights in ft above sea level. Every
 * received level comes from the link budget and line-of-sight functions in
 * src/core/vhf.ts, so squelch, contact and collisions all follow distance,
 * altitude and terrain.
 */

import {
  adjacentLeakDbm,
  AIRCRAFT_RADIO,
  AUDIBLE_SNR_DB,
  channelFrequencyMHz,
  GROUND_RADIO,
  minAltitudeForContactFt,
  nearestChannelIndex,
  pathLink,
  RECEIVER_NOISE_DBM,
  receiverOutput,
  type ChannelSpacing,
  type PathProfile,
  type RadioEnd,
  type RxResult,
  type RxState,
} from '@/core/vhf'

// ---------------------------------------------------------------------------
// The world
// ---------------------------------------------------------------------------

export type Who = 'controller' | 'CNS101' | 'CNS202' | 'CNS303' | 'CNS707'
export type FreqId = 'main' | 'backup' | 'guard' | 'adjacent'
export type ControllerFreq = 'main' | 'backup' | 'guard'
export type Listener = 'ground' | 'CNS101' | 'CNS202'

export const SITE = { distanceNm: 0, antennaFt: 100 } as const
export const CNS202_POS = { distanceNm: 45, altitudeFt: 12000 } as const
export const CNS303_POS = { distanceNm: 80, altitudeFt: 31000 } as const
/** The aircraft on the next channel flies this far beyond the learner, at the same height. */
export const CNS707_OFFSET_NM = 1
export const MOUNTAIN = { centerNm: 70, peakFt: 7000, sigmaNm: 5, name: 'Mount Barrier' } as const

export const FREQ_MHZ: Record<ControllerFreq, number> = { main: 128.6, backup: 124.35, guard: 121.5 }
export const FREQ_LABEL: Record<ControllerFreq, string> = { main: 'West sector', backup: 'Backup', guard: 'Guard (emergency)' }

/** The channel just above the main frequency, for the given spacing (MHz). */
export function adjacentMHz(spacing: ChannelSpacing): number {
  return channelFrequencyMHz(nearestChannelIndex(FREQ_MHZ.main, spacing) + 1, spacing)
}

export function mountainProfile(on: boolean): PathProfile {
  if (!on) return () => 0
  const { centerNm, peakFt, sigmaNm } = MOUNTAIN
  return (s) => peakFt * Math.exp(-((s - centerNm) ** 2) / (2 * sigmaNm * sigmaNm))
}

/** Lowest height an aircraft may fly above the terrain below it, ft (it can never be inside the mountain). */
export const TERRAIN_CLEARANCE_FT = 500

/** The learner's altitude raised, if needed, to stay above the terrain under it. */
export function clearOfTerrain(params: VhfParams, mountain: boolean): VhfParams {
  const floor = Math.ceil((mountainProfile(mountain)(params.distanceNm) + TERRAIN_CLEARANCE_FT) / 100) * 100
  return params.altitudeFt >= floor ? params : { ...params, altitudeFt: floor }
}

/** Squelch of the ground receivers, dBm. TODO(expert-review): typical ground receiver squelch setting. */
export const GROUND_SQUELCH_DBM = -105
/** A speaker does not notice a carrier that started less than this long ago (human reaction), s. */
export const REACTION_S = 0.8
/** Quiet time a speaker waits for before talking, s. */
export const QUIET_CONTROLLER_S = 1.0
export const QUIET_PILOT_S = 2.0
/** The controller moves traffic when the frequency has been blocked this long, s. */
export const STUCK_DETECT_S = 8
/** Transmissions shorter than this get no answer, s. */
export const MIN_CALL_S = 0.8
/** Radios stop transmitting after this long with the button held, s. TODO(expert-review): typical push-to-talk time-out. */
export const PTT_TIMEOUT_S = 20

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface VhfParams {
  /** Learner's distance from the radio site, NM. */
  distanceNm: number
  /** Learner's altitude, ft. */
  altitudeFt: number
  squelchDbm: number
  spacing: ChannelSpacing
  /** Learner's main radio (COM1). */
  com1: ControllerFreq
  /** Second radio (COM2) listening on 121.5. */
  guardWatch: boolean
}

export interface VhfFailures {
  stuckMic: boolean
  mountain: boolean
  txFailure: boolean
  interference: boolean
}

export interface Vccs {
  rx: Record<ControllerFreq, boolean>
  tx: Record<ControllerFreq, boolean>
  transmitter: 'main' | 'standby'
}

export const DEFAULT_PARAMS: VhfParams = { distanceNm: 120, altitudeFt: 24000, squelchDbm: -105, spacing: '25', com1: 'main', guardWatch: true }
export const DEFAULT_FAILURES: VhfFailures = { stuckMic: false, mountain: false, txFailure: false, interference: false }
export const DEFAULT_VCCS: Vccs = {
  rx: { main: true, backup: true, guard: true },
  tx: { main: true, backup: false, guard: false },
  transmitter: 'main',
}

export type Outcome = 'heard' | 'noisy' | 'garbled' | 'blocked' | 'not-heard'

const OUTCOME_RANK: Record<Outcome, number> = { heard: 0, noisy: 1, 'not-heard': 2, garbled: 3, blocked: 4 }

export interface Transmission {
  id: number
  who: Who
  freqs: FreqId[]
  text: string
  start: number
  /** null while the transmitter is still keyed. */
  end: number | null
  kind: 'voice' | 'open-mic'
  /** False when the controller keyed a failed transmitter: nothing went on the air. */
  radiated: boolean
  /** Worst reception so far at each listener that was tuned to it. */
  outcome: Partial<Record<Listener, Outcome>>
}

export interface CpdlcMessage {
  text: string
  atS: number
}

interface Pending {
  who: 'controller' | 'CNS202'
  text: string
  dur: number
  notBefore: number
  /** Frequencies (controller: its TX keys unless given). */
  freqs?: FreqId[]
  /** Only say this if the condition holds when it is due. */
  cond?: () => boolean
  onStart?: (tx: Transmission) => void
  tag?: string
}

interface CycleLine {
  who: 'controller' | 'CNS202'
  text: string
  dur: number
  gap: number
  /** Say this only if the previous line was heard by this listener. */
  ifHeardBy?: Listener
}

const CYCLE: CycleLine[] = [
  { who: 'controller', text: 'CNS202, descend to flight level 120.', dur: 3.2, gap: 2 },
  { who: 'CNS202', text: 'Descending flight level 120, CNS202.', dur: 2.8, gap: 1.4, ifHeardBy: 'CNS202' },
  { who: 'controller', text: 'CNS101, report your level.', dur: 2.4, gap: 6 },
  { who: 'CNS202', text: 'Control, CNS202, request direct DELTA.', dur: 2.8, gap: 8 },
  { who: 'controller', text: 'CNS202, proceed direct DELTA.', dur: 2.4, gap: 1.4, ifHeardBy: 'ground' },
  { who: 'CNS202', text: 'Direct DELTA, CNS202.', dur: 1.8, gap: 1.4, ifHeardBy: 'CNS202' },
]
const CYCLE_REST_S = 6

export interface ListenerView {
  rx: RxResult
  /** Transmission currently heard (strongest carrier), if any. */
  tx: Transmission | null
  /** True while this listener's own transmitter is keyed (its receiver is muted). */
  transmitting: boolean
  freq: FreqId
}

export class VhfEngine {
  timeS = 0
  params: VhfParams = { ...DEFAULT_PARAMS }
  failures: VhfFailures = { ...DEFAULT_FAILURES }
  vccs: Vccs = { ...DEFAULT_VCCS, rx: { ...DEFAULT_VCCS.rx }, tx: { ...DEFAULT_VCCS.tx } }
  /** Frequency the sector (controller and CNS202) currently works on. */
  sectorFreq: ControllerFreq = 'main'
  transmissions: Transmission[] = []
  cpdlc: CpdlcMessage | null = null
  /** When set, CNS202 is due to start talking at this time (Try this countdown). */
  countdownTo: number | null = null
  /** Event log for captions and the radio log. */
  events: { id: number; atS: number; text: string }[] = []

  private nextId = 1
  private queue: Pending[] = []
  private cycleIndex = 0
  private lastCycleTx: Transmission | null = null
  private cycleWaitUntil = 1
  private lastBusy: Record<'controller' | 'CNS202', number> = { controller: -99, CNS202: -99 }
  private busySince: Record<'controller' | 'CNS202', number | null> = { controller: null, CNS202: null }
  private blockedSince: number | null = null
  private ptt: Transmission | null = null
  private interfNextAt = 3
  private moved = false

  // ------------------------------------------------------------------ links

  profile(): PathProfile {
    return mountainProfile(this.failures.mountain)
  }

  /** Where each station is on the line: [distance NM, height ft]. */
  position(who: Who | Listener): [number, number] {
    switch (who) {
      case 'controller':
      case 'ground':
        return [SITE.distanceNm, SITE.antennaFt]
      case 'CNS101':
        return [this.params.distanceNm, this.params.altitudeFt]
      case 'CNS202':
        return [CNS202_POS.distanceNm, CNS202_POS.altitudeFt]
      case 'CNS303':
        return [CNS303_POS.distanceNm, CNS303_POS.altitudeFt]
      case 'CNS707':
        return [this.params.distanceNm + CNS707_OFFSET_NM, this.params.altitudeFt]
    }
  }

  private radioOf(who: Who | Listener): RadioEnd {
    return who === 'controller' || who === 'ground' ? GROUND_RADIO : AIRCRAFT_RADIO
  }

  freqMHz(f: FreqId): number {
    return f === 'adjacent' ? adjacentMHz(this.params.spacing) : FREQ_MHZ[f]
  }

  private linkCache = new Map<string, number>()

  /** Carrier level from `who` at `listener`, dBm (−∞ if there is no line of sight). */
  levelAt(who: Who, listener: Listener, f: FreqId = 'main'): number {
    const [a, ha] = this.position(who)
    const [b, hb] = this.position(listener)
    const mhz = this.freqMHz(f)
    const key = `${who}|${listener}|${mhz}|${a}|${ha}|${b}|${hb}|${this.failures.mountain}`
    const hit = this.linkCache.get(key)
    if (hit !== undefined) return hit
    const v = pathLink(a, ha, b, hb, this.profile(), mhz, this.radioOf(who), this.radioOf(listener)).levelDbm
    if (this.linkCache.size > 400) this.linkCache.clear()
    this.linkCache.set(key, v)
    return v
  }

  /** Lowest altitude at which the learner, at its current distance, is in contact with the radio site. */
  contactFloorFt(distanceNm = this.params.distanceNm): number {
    return minAltitudeForContactFt(SITE.antennaFt, distanceNm, this.profile())
  }

  /** True when the learner has line of sight to the radio site. */
  learnerInContact(): boolean {
    return this.levelAt('controller', 'CNS101') > -Infinity
  }

  // ------------------------------------------------------------------ receivers

  private active(t: number): Transmission[] {
    return this.transmissions.filter((x) => x.radiated && x.start <= t && (x.end === null || x.end > t))
  }

  private squelchOf(listener: Listener): number {
    return listener === 'CNS101' ? this.params.squelchDbm : GROUND_SQUELCH_DBM
  }

  /** What `listener` hears on frequency `f` at time `t`. */
  receive(listener: Listener, f: FreqId, t = this.timeS): { rx: RxResult; carriers: { tx: Transmission; levelDbm: number }[] } {
    const act = this.active(t)
    const carriers = act
      .filter((x) => x.freqs.includes(f) && x.who !== (listener === 'ground' ? 'controller' : listener))
      .map((x) => ({ tx: x, levelDbm: this.levelAt(x.who, listener, f) }))
    let interferenceDbm = -Infinity
    if (listener === 'CNS101' && f === 'main') {
      for (const x of act) if (x.freqs.includes('adjacent')) interferenceDbm = Math.max(interferenceDbm, adjacentLeakDbm(this.levelAt(x.who, 'CNS101', 'adjacent'), this.params.spacing))
    }
    const rx = receiverOutput(
      carriers.map((c) => ({ id: String(c.tx.id), levelDbm: c.levelDbm })),
      this.squelchOf(listener),
      { interferenceDbm },
    )
    return { rx, carriers }
  }

  isTransmitting(who: Who): boolean {
    return this.transmissions.some((x) => x.who === who && x.start <= this.timeS && (x.end === null || x.end > this.timeS))
  }

  /**
   * The learner's COM1, mixed with COM2 on guard: a voice on 121.5 is what the
   * pilot notices when COM1 is quiet, hissing, squealing or only an open microphone.
   */
  learnerView(): ListenerView {
    const transmitting = this.ptt !== null
    const c1 = this.receive('CNS101', this.params.com1)
    let view: ListenerView = { rx: c1.rx, tx: this.topTx(c1), transmitting, freq: this.params.com1 }
    if (this.params.guardWatch && this.params.com1 !== 'guard') {
      const g = this.receive('CNS101', 'guard')
      const gTx = this.topTx(g)
      const c1Voice = view.tx !== null && view.tx.kind === 'voice' && c1.rx.state !== 'blocked'
      if (g.rx.heard.length && gTx?.kind === 'voice' && !c1Voice) view = { rx: g.rx, tx: gTx, transmitting, freq: 'guard' }
    }
    if (transmitting) view = { ...view, rx: { ...view.rx, state: 'muted', open: false, hiss: 0 } }
    return view
  }

  /** The controller's headset: the working frequency, or guard when that is quiet. */
  controllerView(): ListenerView {
    const f: ControllerFreq = this.sectorFreq
    const w = this.receive('ground', f)
    let view: ListenerView = { rx: w.rx, tx: this.topTx(w), transmitting: this.isTransmitting('controller'), freq: f }
    if (this.vccs.rx.guard && f !== 'guard') {
      const g = this.receive('ground', 'guard')
      if (g.rx.heard.length && (w.rx.state === 'muted' || w.rx.state === 'hiss')) view = { rx: g.rx, tx: this.topTx(g), transmitting: view.transmitting, freq: 'guard' }
    }
    if (!this.vccs.rx[f] && view.freq === f) view = { ...view, rx: { ...view.rx, state: 'muted', open: false, heard: [], hiss: 0 }, tx: null }
    return view
  }

  private topTx(r: { rx: RxResult; carriers: { tx: Transmission; levelDbm: number }[] }): Transmission | null {
    const top = r.rx.heard[0]
    if (!top) return null
    return r.carriers.find((c) => String(c.tx.id) === top.id)?.tx ?? null
  }

  // ------------------------------------------------------------------ talking

  private log(text: string) {
    this.events.push({ id: this.nextId++, atS: this.timeS, text })
    if (this.events.length > 40) this.events.shift()
  }

  private start(who: Who, freqs: FreqId[], text: string, dur: number | null, kind: Transmission['kind'] = 'voice'): Transmission {
    const radiated = who !== 'controller' || !(this.failures.txFailure && this.vccs.transmitter === 'main')
    const tx: Transmission = { id: this.nextId++, who, freqs, text, start: this.timeS, end: dur === null ? null : this.timeS + dur, kind, radiated, outcome: {} }
    this.transmissions.push(tx)
    if (!radiated) this.log(`Controller keyed the failed main transmitter: "${text}" never went on the air.`)
    return tx
  }

  /** Learner presses the push-to-talk button. */
  pressTalk() {
    if (this.ptt) return
    const fl = Math.round(this.params.altitudeFt / 100)
    const level = this.params.altitudeFt >= 10000 ? `flight level ${fl}` : `${Math.round(this.params.altitudeFt / 100) * 100} feet`
    this.ptt = this.start('CNS101', [this.params.com1], `Control, CNS101, ${level}.`, null)
  }

  /** Learner releases the button: the controller answers depending on what reached the ground. */
  releaseTalk() {
    const tx = this.ptt
    if (!tx) return
    tx.end = this.timeS
    this.ptt = null
    const dur = tx.end - tx.start
    if (dur < MIN_CALL_S) {
      this.log('Your transmission was too short to be understood.')
      return
    }
    // The controller hears every frequency with its receive key on, and answers on it too.
    const heardOn = tx.freqs.filter((f): f is ControllerFreq => f !== 'adjacent' && this.vccs.rx[f])
    const o = heardOn.length ? tx.outcome.ground ?? 'not-heard' : 'not-heard'
    const freqs = [...new Set<FreqId>([...this.controllerTxFreqs(), ...heardOn])]
    const reply = (text: string, d: number) => this.queue.unshift({ who: 'controller', text, dur: d, notBefore: this.timeS + 1.2, tag: 'reply', freqs })
    if (o === 'heard' || o === 'noisy') reply('CNS101, Control, roger.', 1.8)
    else if (o === 'garbled') reply('CNS101, you are unreadable. Say again.', 2.4)
    else if (o === 'blocked') reply('Transmission blocked. Station calling Control, say again.', 3.0)
    else this.log(heardOn.length ? 'The controller did not hear you: no line of sight, or the signal was below the squelch.' : 'The controller is not listening on that frequency.')
  }

  get pttActive() {
    return this.ptt !== null
  }

  /** Try this: CNS202 starts talking in `delayS` seconds. */
  scheduleCns202(delayS: number) {
    this.queue = this.queue.filter((p) => p.tag === 'reply')
    this.countdownTo = this.timeS + delayS
    this.queue.push({
      who: 'CNS202',
      text: 'Control, CNS202, request higher level.',
      dur: 3.0,
      notBefore: this.countdownTo,
      tag: 'countdown',
      onStart: () => {
        this.countdownTo = null
      },
    })
    this.cycleIndex = 0
    this.cycleWaitUntil = this.countdownTo + 8
  }

  /** Controller moves traffic off a blocked frequency: announce on guard and backup, send CPDLC. */
  moveTrafficToBackup() {
    if (this.moved) return
    this.moved = true
    this.vccs = { ...this.vccs, tx: { main: false, backup: true, guard: false }, rx: { ...this.vccs.rx, backup: true } }
    this.sectorFreq = 'backup'
    this.queue = this.queue.filter((p) => p.tag === 'reply')
    this.queue.unshift({
      who: 'controller',
      text: this.failures.stuckMic
        ? 'All stations, Control. 128.600 is blocked by an open microphone. Contact me on 124.350.'
        : 'All stations, Control. Frequency change: contact me on 124.350.',
      dur: 5.5,
      notBefore: this.timeS,
      freqs: ['guard', 'backup'],
      tag: 'move',
      onStart: () => {
        this.cpdlc = { text: 'CONTACT CONTROL 124.350', atS: this.timeS }
        this.log('Controller sent a CPDLC text message: CONTACT CONTROL 124.350.')
      },
    })
    this.queue.push({ who: 'CNS202', text: 'Control, CNS202, with you on 124.350.', dur: 2.6, notBefore: this.timeS + 7, tag: 'checkin' })
    this.cycleIndex = 0
    this.cycleWaitUntil = this.timeS + 16
    this.log('Controller moved the sector to the backup frequency 124.350.')
  }

  /** Controller presses the emergency key: a call on 121.5. */
  emergencyCall() {
    this.queue.unshift({ who: 'controller', text: 'All stations, all stations, Control on guard. Radio check.', dur: 3.4, notBefore: this.timeS, freqs: ['guard'], tag: 'guard' })
  }

  setFailure<K extends keyof VhfFailures>(k: K, v: VhfFailures[K]) {
    const was = this.failures[k]
    this.failures = { ...this.failures, [k]: v }
    if (k === 'mountain') this.params = clearOfTerrain(this.params, this.failures.mountain)
    if (k === 'stuckMic' && v && !was) {
      this.start('CNS303', ['main'], 'Open microphone: engine noise and cockpit talk.', null, 'open-mic')
      this.log('CNS303 has a stuck microphone: its transmitter stays on and blocks 128.600.')
    }
    if (k === 'stuckMic' && !v && was) {
      for (const x of this.transmissions) if (x.who === 'CNS303' && x.end === null) x.end = this.timeS
      this.blockedSince = null
      if (this.moved) {
        this.moved = false
        this.sectorFreq = 'main'
        this.vccs = { ...this.vccs, tx: { main: true, backup: false, guard: false } }
        this.params = { ...this.params, com1: 'main' }
        this.cpdlc = null
        this.queue = this.queue.filter((p) => p.tag === 'reply')
        this.cycleIndex = 0
        this.cycleWaitUntil = this.timeS + 2
        this.log('Microphone fixed: the sector and your radio are back on 128.600.')
      }
    }
    if (k === 'interference') this.interfNextAt = this.timeS + 1
  }

  setVccs(v: Vccs) {
    this.vccs = v
  }

  // ------------------------------------------------------------------ stepping

  /** Can this speaker start now (listen before talk)? */
  private canStart(who: 'controller' | 'CNS202'): boolean {
    if (this.isTransmitting(who)) return false
    const since = this.busySince[who]
    if (since !== null && this.timeS - since >= REACTION_S) return false
    const quiet = who === 'controller' ? QUIET_CONTROLLER_S : QUIET_PILOT_S
    if (since === null && this.timeS - this.lastBusy[who] < quiet) return false
    return true
  }

  /** Update what the controller and CNS202 can hear (for listen-before-talk). */
  private updateBusy() {
    const check = (who: 'controller' | 'CNS202') => {
      const listener: Listener = who === 'controller' ? 'ground' : 'CNS202'
      const r = this.receive(listener, this.sectorFreq)
      const heard = r.carriers.filter((c) => c.levelDbm >= RECEIVER_NOISE_DBM + AUDIBLE_SNR_DB)
      if (heard.length) {
        this.lastBusy[who] = this.timeS
        this.busySince[who] = Math.min(...heard.map((c) => c.tx.start))
      } else this.busySince[who] = null
    }
    check('controller')
    check('CNS202')
  }

  private record(listener: Listener, f: FreqId, tuned: boolean) {
    if (!tuned) return
    const muted = listener === 'CNS101' && this.ptt !== null
    const r = this.receive(listener, f)
    for (const c of r.carriers) {
      const heard = r.rx.heard.some((h) => h.id === String(c.tx.id))
      let o: Outcome
      if (muted || !heard || !r.rx.open) o = 'not-heard'
      else if (r.rx.state === 'blocked') o = 'blocked'
      else if (r.rx.state === 'clear') o = 'heard'
      else if (r.rx.state === 'noisy') o = 'noisy'
      else o = 'garbled'
      const prev = c.tx.outcome[listener]
      if (!prev || OUTCOME_RANK[o] > OUTCOME_RANK[prev]) c.tx.outcome[listener] = o
    }
  }

  step(dt: number) {
    if (dt <= 0) return
    this.timeS += dt
    const t = this.timeS

    // Receptions during this frame.
    for (const f of ['main', 'backup', 'guard'] as const) {
      this.record('ground', f, this.vccs.rx[f])
      this.record('CNS101', f, this.params.com1 === f || (f === 'guard' && this.params.guardWatch))
      this.record('CNS202', f, this.sectorFreq === f || f === 'guard')
    }
    this.updateBusy()

    // Push-to-talk timeout.
    if (this.ptt && t - this.ptt.start > PTT_TIMEOUT_S) {
      this.log('Your radio stopped transmitting after 20 seconds.')
      this.releaseTalk()
    }

    // Stuck microphone: the controller notices a frequency that never goes quiet.
    const stuck = this.transmissions.some((x) => x.who === 'CNS303' && x.end === null)
    if (stuck && this.sectorFreq === 'main' && this.busySince.controller !== null) {
      if (this.blockedSince === null) this.blockedSince = t
      if (t - this.blockedSince >= STUCK_DETECT_S) this.moveTrafficToBackup()
    } else if (!stuck) this.blockedSince = null

    // Interference: CNS707 chats on the next channel now and then.
    if (this.failures.interference && t >= this.interfNextAt && !this.isTransmitting('CNS707')) {
      this.start('CNS707', ['adjacent'], 'Approach, CNS707, passing flight level 200.', 3.5)
      this.interfNextAt = t + 9
    }
    if (!this.failures.interference) for (const x of this.transmissions) if (x.who === 'CNS707' && x.end !== null && x.end > t) x.end = t

    // Scripted traffic.
    this.runQueue()
    this.runCycle()

    // Forget old transmissions.
    const cutoff = t - 90
    this.transmissions = this.transmissions.filter((x) => x.end === null || x.end > cutoff)
  }

  private runQueue() {
    const t = this.timeS
    for (let i = 0; i < this.queue.length; i++) {
      const p = this.queue[i]
      if (t < p.notBefore) continue
      if (p.cond && !p.cond()) {
        this.queue.splice(i, 1)
        i--
        continue
      }
      // The countdown call is the Try-this collision: CNS202 keys up on time unless it has clearly heard someone.
      if (!this.canStart(p.who)) continue
      const freqs: FreqId[] = p.freqs ?? (p.who === 'controller' ? this.controllerTxFreqs() : [this.sectorFreq])
      if (!freqs.length) {
        this.log('The controller has no transmit key selected, so nothing was sent.')
        this.queue.splice(i, 1)
        i--
        continue
      }
      const tx = this.start(p.who, freqs, p.text, p.dur)
      p.onStart?.(tx)
      this.queue.splice(i, 1)
      i--
    }
  }

  controllerTxFreqs(): FreqId[] {
    return (['main', 'backup', 'guard'] as const).filter((f) => this.vccs.tx[f])
  }

  private runCycle() {
    const t = this.timeS
    if (this.queue.length || t < this.cycleWaitUntil) return
    // One conversation at a time: never start a line while the controller or CNS202 is talking.
    if (this.isTransmitting('controller') || this.isTransmitting('CNS202')) return
    const line = CYCLE[this.cycleIndex]
    if (line.ifHeardBy && this.lastCycleTx) {
      const o = this.lastCycleTx.outcome[line.ifHeardBy]
      if (!(o === 'heard' || o === 'noisy')) {
        this.advanceCycle(1.5)
        return
      }
    }
    if (!this.canStart(line.who)) return
    const freqs: FreqId[] = line.who === 'controller' ? this.controllerTxFreqs() : [this.sectorFreq]
    if (!freqs.length) {
      this.advanceCycle(line.gap)
      return
    }
    const tx = this.start(line.who, freqs, line.text, line.dur)
    this.lastCycleTx = tx
    this.advanceCycle(line.dur)
  }

  private advanceCycle(afterS: number) {
    this.cycleIndex = (this.cycleIndex + 1) % CYCLE.length
    const next = CYCLE[this.cycleIndex]
    this.cycleWaitUntil = this.timeS + afterS + (this.cycleIndex === 0 ? CYCLE_REST_S : next.gap)
  }

  /** Remove every transmission and restart the traffic (keeps parameters). */
  reset() {
    this.timeS = 0
    this.transmissions = []
    this.queue = []
    this.cycleIndex = 0
    this.cycleWaitUntil = 1
    this.lastCycleTx = null
    this.ptt = null
    this.cpdlc = null
    this.countdownTo = null
    this.events = []
    this.blockedSince = null
    this.moved = false
    this.sectorFreq = 'main'
    this.lastBusy = { controller: -99, CNS202: -99 }
    this.busySince = { controller: null, CNS202: null }
    if (this.failures.stuckMic) this.start('CNS303', ['main'], 'Open microphone: engine noise and cockpit talk.', null, 'open-mic')
  }
}

export type { RxState }
