/**
 * Voice for the radio modules: the Web Speech API reads messages aloud when
 * the browser has it and sound is on. Every message is also posted as a
 * caption by the caller, so speech is never the only way to follow the radio.
 * Noise, squeals and tones come from src/lib/audio.ts.
 */

import { usePrefs } from '@/stores/prefs'

export function speechAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function'
}

const DIGITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner']

/** Say numbers the way radio operators do: digit by digit, "decimal" for the point. */
export function spokenText(text: string): string {
  return text
    .replace(/CNS(\d{3})/g, (_, n: string) => `C N S ${[...n].map((d) => DIGITS[Number(d)]).join(' ')}`)
    .replace(/(\d{3})\.(\d{1,3})/g, (_, a: string, b: string) => `${[...a].map((d) => DIGITS[Number(d)]).join(' ')} decimal ${[...b.replace(/0+$/, '') || '0'].map((d) => DIGITS[Number(d)]).join(' ')}`)
    .replace(/flight level (\d{2,3})/g, (_, n: string) => `flight level ${[...n].map((d) => DIGITS[Number(d)]).join(' ')}`)
}

let speaking = false

/** Speak a radio message. Returns false when speech is unavailable or sound is off. */
export function speak(text: string, opts: { rate?: number; volume?: number; pitch?: number } = {}): boolean {
  if (!speechAvailable() || !usePrefs.getState().soundOn) return false
  try {
    const synth = window.speechSynthesis
    synth.cancel()
    const u = new SpeechSynthesisUtterance(spokenText(text))
    u.rate = opts.rate ?? 1.1
    u.volume = opts.volume ?? 1
    u.pitch = opts.pitch ?? 1
    u.lang = 'en-GB'
    u.onend = () => {
      speaking = false
    }
    speaking = true
    synth.speak(u)
    return true
  } catch {
    return false
  }
}

export function cancelSpeech() {
  if (!speechAvailable()) return
  try {
    if (speaking || window.speechSynthesis.speaking) window.speechSynthesis.cancel()
  } catch {
    /* ignore */
  }
  speaking = false
}

// Stop talking when sound is switched off.
usePrefs.subscribe((s, prev) => {
  if (prev.soundOn && !s.soundOn) cancelSpeech()
})
