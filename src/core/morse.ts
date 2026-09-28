/**
 * Morse code and keying patterns for navaid idents and marker beacons.
 * Produces timelines of tone-on segments that the audio engine plays and
 * the UI captions.
 */

export const MORSE: Record<string, string> = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....',
  I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.',
  Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-',
  Y: '-.--', Z: '--..',
  '0': '-----', '1': '.----', '2': '..---', '3': '...--', '4': '....-',
  '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.',
}

export interface ToneSegment {
  /** Start time from the beginning of the pattern, s. */
  startS: number
  durationS: number
}

/** Morse unit length at a given speed (PARIS standard: 50 units per word). */
export const morseUnitS = (wpm: number) => 1.2 / wpm

/** Text in dots and dashes, letters separated by spaces, e.g. "CNS" → "-.-. -. ...". */
export function toMorse(text: string): string {
  return text
    .toUpperCase()
    .split('')
    .map((ch) => (ch === ' ' ? '/' : MORSE[ch] ?? ''))
    .filter(Boolean)
    .join(' ')
}

/**
 * Timeline of tone-on segments for a text at `wpm` words per minute.
 * dot = 1 unit, dash = 3, gap inside a letter = 1, between letters = 3, between words = 7.
 * Navaid idents are keyed at about 7 words per minute.
 */
export function morseTimeline(text: string, wpm = 7): { segments: ToneSegment[]; totalS: number } {
  const u = morseUnitS(wpm)
  const segments: ToneSegment[] = []
  let t = 0
  const words = text.toUpperCase().trim().split(/\s+/)
  words.forEach((word, wi) => {
    const letters = word.split('').filter((ch) => MORSE[ch])
    letters.forEach((ch, li) => {
      const code = MORSE[ch]
      for (let i = 0; i < code.length; i++) {
        const len = code[i] === '.' ? u : 3 * u
        segments.push({ startS: t, durationS: len })
        t += len
        if (i < code.length - 1) t += u
      }
      if (li < letters.length - 1) t += 3 * u
    })
    if (wi < words.length - 1) t += 7 * u
  })
  return { segments, totalS: t }
}

export type MarkerKind = 'outer' | 'middle' | 'inner'

/** Marker beacon audio tones, Hz (ICAO Annex 10). */
export const MARKER_TONE_HZ: Record<MarkerKind, number> = {
  outer: 400,
  middle: 1300,
  inner: 3000,
}

/**
 * One second of marker beacon keying.
 * Outer: two dashes per second. Inner: six dots per second.
 * Middle: alternating dots and dashes (dashes at 2 per second, dots at 6 per second).
 */
// TODO(expert-review): exact dot/dash on-times for the marker keying patterns.
export function markerKeying(kind: MarkerKind): { segments: ToneSegment[]; periodS: number } {
  switch (kind) {
    case 'outer':
      return {
        periodS: 1,
        segments: [
          { startS: 0, durationS: 0.375 },
          { startS: 0.5, durationS: 0.375 },
        ],
      }
    case 'inner':
      return {
        periodS: 1,
        segments: Array.from({ length: 6 }, (_, i) => ({ startS: i / 6, durationS: 1 / 12 })),
      }
    case 'middle':
      // dash (1/2 s slot) followed by dot (1/6 s slot) repeating: period 2/3 s.
      return {
        periodS: 2 / 3,
        segments: [
          { startS: 0, durationS: 0.375 },
          { startS: 0.5, durationS: 1 / 12 },
        ],
      }
  }
}
