import { audio, caption, type SoundHandle } from '@/lib/audio'
import { usePrefs } from '@/stores/prefs'
import { FREQ_MHZ, type ListenerView, type VhfEngine } from './engine'
import { cancelSpeech, speak } from './radioAudio'
import { WHO_LABEL } from './labels'
import type { ListenAt } from './state'

/**
 * Turns what the chosen listener hears into sound and captions, frame by
 * frame: silence (squelch closed), hiss, a voice (speech synthesis), an open
 * microphone, or the squeal of two carriers at once. Every sound posts a caption.
 */
export class VhfAudioDirector {
  private noise: SoundHandle | null = null
  private noiseGain = 0
  private spokenId = -1
  private lastState = ''
  private squealUntil = 0
  private lastEventId = 0
  private pttCaptioned = false
  /** Messages that were stepped on: never read out afterwards. */
  private spoiled = new Set<number>()
  private soundOn = usePrefs.getState().soundOn

  private setNoise(g: number) {
    if (g > 0 && !this.noise) {
      this.noise = audio.noise({ gain: g, highpassHz: 300, lowpassHz: 3400 })
      this.noiseGain = g
      return
    }
    if (this.noise && Math.abs(g - this.noiseGain) > 0.002) {
      this.noise.setGain?.(g)
      this.noiseGain = g
    }
  }

  private againAt = 0
  private now = 0

  /** Caption a continuing sound: on a change of state, then again every few seconds while it lasts. */
  private say(text: string, seconds: number) {
    caption(text, seconds + 0.6)
    this.againAt = this.now + seconds
  }

  update(e: VhfEngine, listenAt: ListenAt, running: boolean) {
    // Muting stops every sound (src/lib/audio.ts); start a fresh noise source when sound comes back.
    const on = usePrefs.getState().soundOn
    if (on !== this.soundOn) {
      this.soundOn = on
      this.noise = null
      this.noiseGain = 0
    }
    // Engine events (controller actions, CPDLC...) are captioned too.
    for (const ev of e.events) {
      if (ev.id <= this.lastEventId) continue
      this.lastEventId = ev.id
      caption(ev.text, 5)
    }
    if (!running) {
      this.silence()
      return
    }
    const now = e.timeS
    this.now = now
    const at = listenAt === 'controller' ? 'At the controller' : 'Your radio'
    if (listenAt === 'cockpit' && e.pttActive) {
      this.setNoise(0)
      if (!this.pttCaptioned) {
        const mine = [...e.transmissions].reverse().find((x) => x.who === 'CNS101')
        caption(`You are transmitting${mine ? `: "${mine.text}"` : ''} (your receiver is muted while you talk)`, 3)
        this.pttCaptioned = true
      }
      cancelSpeech()
      this.spokenId = -1
      this.lastState = 'ptt'
      return
    }
    this.pttCaptioned = false
    const v: ListenerView = listenAt === 'controller' ? e.controllerView() : e.learnerView()
    const tx = v.tx
    const freq = v.freq === 'adjacent' ? '' : ` on ${FREQ_MHZ[v.freq].toFixed(3)}`
    const state = v.rx.state
    switch (state) {
      case 'muted':
        // Let a sentence that is being read out finish: speech can run a little longer than the transmission.
        this.setNoise(0)
        this.spokenId = -1
        break
      case 'hiss':
        this.setNoise(0.05)
        if (this.lastState !== 'hiss' || now >= this.againAt) this.say(`${at}: hiss. The squelch is open but nobody is transmitting.`, 3)
        break
      case 'bleed':
        this.setNoise(0.035)
        if (this.lastState !== 'bleed' || now >= this.againAt) this.say(`${at}: broken speech leaking in from CNS707 on the next channel.`, 3.5)
        break
      case 'blocked':
        this.setNoise(0.02)
        cancelSpeech()
        this.spokenId = -1
        for (const x of e.transmissions) if (x.start <= now && (x.end === null || x.end > now)) this.spoiled.add(x.id)
        if (now >= this.squealUntil) {
          audio.heterodyne(1.2, { gain: 0.06, beatHz: 600 })
          this.squealUntil = now + 1.1
        }
        if (this.lastState !== 'blocked' || now >= this.againAt) this.say(`${at}: squeal. ${v.rx.heard.length} stations are transmitting at once, so neither message gets through.`, 3.5)
        break
      case 'garbled':
        this.setNoise(0.05)
        cancelSpeech()
        if (this.lastState !== 'garbled' || now >= this.againAt) this.say(`${at}: ${tx ? WHO_LABEL[tx.who] : 'a station'} is unreadable (too weak or covered by interference).`, 3.5)
        break
      case 'clear':
      case 'noisy': {
        if (!tx) break
        if (tx.kind === 'open-mic') {
          this.setNoise(0.06)
          if (this.lastState !== 'open-mic' || now >= this.againAt) this.say(`${at}: open microphone from CNS303: engine noise. The frequency is blocked.`, 4)
          this.lastState = 'open-mic'
          return
        }
        this.setNoise(state === 'noisy' ? 0.03 : 0.006 + 0.03 * v.rx.hiss)
        if (tx.id !== this.spokenId && this.spoiled.has(tx.id)) {
          this.spokenId = tx.id
          caption(`${at}: the rest of ${WHO_LABEL[tx.who]}'s message. The start was lost in the squeal.`, 3)
        } else if (tx.id !== this.spokenId) {
          this.spokenId = tx.id
          const dur = (tx.end ?? now + 4) - tx.start
          speak(tx.text, { rate: 1.12 })
          caption(`${at}${freq}: ${WHO_LABEL[tx.who]}: "${tx.text}"${state === 'noisy' ? ' (noisy)' : ''}`, Math.max(3, dur + 1))
        }
        break
      }
    }
    this.lastState = state
  }

  silence() {
    this.setNoise(0)
    cancelSpeech()
    this.spokenId = -1
    this.lastState = ''
  }

  dispose() {
    this.noise?.stop()
    this.noise = null
    cancelSpeech()
  }
}
