import { hfQuality, selcalPairs, skyFadingDb, type HfQuality } from '@/core/hf'
import { audio, caption, type SoundHandle } from '@/lib/audio'
import { usePrefs } from '@/stores/prefs'
import { cancelSpeech, speak } from '@/modules/vhf/radioAudio'
import type { HfEngine } from './engine'
import { QUALITY_TEXT, REASON_TEXT } from './labels'

/** Noise behind a message, for each HF reception quality (0..1 gain). */
const HF_NOISE: Record<HfQuality, number> = { clear: 0.025, noisy: 0.05, unreadable: 0.075, none: 0.07 }

/** Loudspeaker noise follows the receiver noise level: louder at low frequencies and in thunderstorms. */
export function loudspeakerNoiseGain(noiseDbm: number): number {
  return Math.max(0.02, Math.min(0.1, 0.02 + 0.0025 * (noiseDbm + 110)))
}

export const HF_MESSAGE = 'CNS101, Ocean Radio, climb to flight level 360, report reaching.'

/**
 * HF sounds with captions: the receiver's hiss and static (with slow fading),
 * SELCAL tones and chime, and the same message on HF and on VHF for comparison.
 */
export class HfAudioDirector {
  private noise: SoundHandle | null = null
  private noiseGain = 0
  private crackle = false
  private soundOn = usePrefs.getState().soundOn
  private lastSelcalStart = -1
  private lastDecode = 0
  /** Until this engine time a message is being read out over the noise. */
  private voiceUntil = -1
  private voiceGain = 0
  private listenCaptionAt = -99
  /** The message waiting for the SELCAL chime to finish (cancelled when leaving the module). */
  private voiceTimer: number | undefined

  private ensureNoise(crackle: boolean) {
    if (this.noise && this.crackle === crackle) return
    this.noise?.stop()
    this.noise = audio.noise({ gain: 0, highpassHz: 300, lowpassHz: 2700, crackle })
    this.noiseGain = 0
    this.crackle = crackle
  }

  private setNoise(g: number, crackle: boolean) {
    if (g <= 0 && !this.noise) return
    this.ensureNoise(crackle)
    if (Math.abs(g - this.noiseGain) > 0.001) {
      this.noise?.setGain?.(Math.max(0, g))
      this.noiseGain = g
    }
  }

  update(e: HfEngine, running: boolean) {
    const on = usePrefs.getState().soundOn
    if (on !== this.soundOn) {
      this.soundOn = on
      this.noise = null
      this.noiseGain = 0
    }
    // Voice and caption timing use real time, so pausing the simulator never leaves noise hanging on.
    const now = performance.now() / 1000
    const storm = e.failures.storm
    const r = e.reception()
    const q = hfQuality(r)

    // SELCAL: tones as they arrive at CNS101, then the chime if it decoded its own code.
    if (e.selcal && e.selcal.startS !== this.lastSelcalStart) {
      this.lastSelcalStart = e.selcal.startS
      const pairs = selcalPairs(e.selcal.code)
      const heard = r.mode !== null && r.snrDb > 0
      if (pairs && heard) audio.selcal(pairs, { gain: 0.12 })
      const [p1, p2] = e.selcal.code.split('-')
      caption(
        heard
          ? `SELCAL tones for ${e.selcal.code}: ${p1[0]} and ${p1[1]} together for 1 second, a short gap, then ${p2[0]} and ${p2[1]}.`
          : `The station sends SELCAL ${e.selcal.code}, but nothing reaches CNS101 (${REASON_TEXT[r.reason ?? 'gap']}).`,
        3,
      )
    }
    if (e.decodeSerial !== this.lastDecode) {
      this.lastDecode = e.decodeSerial
      const mine = e.results.CNS101
      if (mine?.rang) {
        audio.tone(988, 0.35, { gain: 0.12 })
        audio.tone(740, 0.7, { gain: 0.12, delayS: 0.38 })
        caption('Chime and SELCAL light in the cockpit of CNS101: the ground station is calling you.', 3)
        this.playHf(e, 1.3)
      } else if (mine?.forMe) {
        caption('No chime: the call was for CNS101, but the tones did not arrive clearly enough to decode.', 4)
      } else if (mine) {
        caption(`Silence in CNS101: the code was ${e.lastCall?.code ?? 'for another aircraft'}, not ours (${e.codeOf('CNS101')}), so its HF stays muted.`, 4)
      }
    }

    // Loudspeaker: constant HF noise when listening, and behind any HF message.
    if (!running && now >= this.voiceUntil) {
      this.setNoise(0, true)
      return
    }
    const fade = r.mode ? skyFadingDb(e.timeS, 1) : 0
    const fadeFactor = 10 ** (-fade / 40)
    let g = 0
    if (now < this.voiceUntil) g = this.voiceGain * fadeFactor
    else if (e.params.listen) {
      g = loudspeakerNoiseGain(e.noiseDbm()) * (r.mode ? fadeFactor : 1)
      if (now - this.listenCaptionAt > 4) {
        this.listenCaptionAt = now
        caption(`HF loudspeaker on: ${storm ? 'loud hiss and crashes of static from thunderstorms' : 'constant hiss and crackles of static'}, louder on low frequencies. ${r.mode ? `Signal from the station: ${QUALITY_TEXT[q].toLowerCase()}.` : 'No signal from the station.'}`, 4.2)
      }
    }
    this.setNoise(g, true)
  }

  /** Read the test message as it would sound over HF right now. */
  playHf(e: HfEngine, delayS = 0) {
    const r = e.reception()
    const q = hfQuality(r)
    const dur = 4.5
    const start = () => {
      this.voiceUntil = performance.now() / 1000 + dur
      this.voiceGain = HF_NOISE[q]
      if (q === 'none' || q === 'unreadable') {
        cancelSpeech()
        caption(q === 'none' ? `HF: only noise. Nothing reaches CNS101 now (${REASON_TEXT[r.reason ?? 'gap']}).` : 'HF: a voice somewhere under the noise, too weak to understand.', dur)
        return
      }
      speak(HF_MESSAGE, { rate: 1, volume: q === 'clear' ? 0.9 : 0.7 })
      caption(`HF (${QUALITY_TEXT[q].toLowerCase()}, with hiss, fading and static): "${HF_MESSAGE}"`, dur)
    }
    window.clearTimeout(this.voiceTimer)
    if (delayS > 0) this.voiceTimer = window.setTimeout(start, delayS * 1000)
    else start()
  }

  /** The same message on VHF: clear, but only within line of sight of a VHF antenna. */
  playVhf() {
    this.voiceUntil = performance.now() / 1000 + 4
    this.voiceGain = 0.006
    speak(HF_MESSAGE.replace('Ocean Radio', 'Control'), { rate: 1.05 })
    caption(`VHF (clear, but only within about 240 NM of a VHF antenna): "${HF_MESSAGE.replace('Ocean Radio', 'Control')}"`, 4.5)
  }

  dispose() {
    window.clearTimeout(this.voiceTimer)
    this.noise?.stop()
    this.noise = null
    cancelSpeech()
  }
}
