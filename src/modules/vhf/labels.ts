import type { RxState } from '@/core/vhf'
import { FREQ_MHZ, type FreqId, type Outcome, type Who } from './engine'

export const OUTCOME_TEXT: Record<Outcome, string> = {
  heard: 'heard',
  noisy: 'heard, noisy',
  garbled: 'unreadable',
  blocked: 'blocked',
  'not-heard': 'not heard',
}

export const WHO_LABEL: Record<Who, string> = {
  controller: 'Controller',
  CNS101: 'CNS101 (you)',
  CNS202: 'CNS202',
  CNS303: 'CNS303',
  CNS707: 'CNS707',
}

/** Frequency in MHz with as many decimals as it needs (8.33 kHz channels need four). */
export function mhzText(mhz: number): string {
  return Math.abs(mhz * 200 - Math.round(mhz * 200)) > 1e-6 ? mhz.toFixed(4) : mhz.toFixed(3)
}

export function freqText(f: FreqId, adjacentMHz: number): string {
  return f === 'adjacent' ? mhzText(adjacentMHz) : FREQ_MHZ[f].toFixed(3)
}

export const RX_TEXT: Record<RxState, string> = {
  muted: 'Squelch closed: silence',
  hiss: 'Squelch open: hiss, nobody talking',
  clear: 'Receiving clearly',
  noisy: 'Receiving, with noise',
  garbled: 'Unreadable',
  blocked: 'Squeal: two stations at once',
  bleed: 'Next channel leaking in',
}
