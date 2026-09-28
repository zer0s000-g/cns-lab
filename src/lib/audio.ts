/**
 * Web Audio engine for CNS Lab: Morse idents, marker tones, radio noise,
 * heterodyne squeals and SELCAL chimes. All sounds are synthesised; nothing
 * is recorded. Every sound posts a caption so it is never the only cue.
 */

import { create } from 'zustand'
import type { ToneSegment } from '@/core/morse'
import { usePrefs } from '@/stores/prefs'

// ---------------------------------------------------------------------------
// Captions
// ---------------------------------------------------------------------------

interface CaptionState {
  text: string | null
  id: number
  show: (text: string, seconds?: number) => void
  clear: () => void
}

let captionTimer: number | undefined

export const useCaptions = create<CaptionState>()((set, get) => ({
  text: null,
  id: 0,
  show: (text, seconds = 4) => {
    window.clearTimeout(captionTimer)
    const id = get().id + 1
    set({ text, id })
    captionTimer = window.setTimeout(() => {
      if (get().id === id) set({ text: null })
    }, seconds * 1000)
  },
  clear: () => set({ text: null }),
}))

export const caption = (text: string, seconds?: number) => useCaptions.getState().show(text, seconds)

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export interface SoundHandle {
  stop: () => void
  setGain?: (g: number) => void
}

const RAMP = 0.004 // s, to avoid clicks

class AudioEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private handles = new Set<SoundHandle>()

  get enabled() {
    return usePrefs.getState().soundOn
  }

  /** Create (or resume) the audio context. Must be called from a user gesture the first time. */
  ensure(): AudioContext | null {
    if (typeof window === 'undefined') return null
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    if (!this.ctx) {
      this.ctx = new Ctor()
      this.master = this.ctx.createGain()
      this.master.gain.value = 0.8
      this.master.connect(this.ctx.destination)
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    return this.ctx
  }

  private track(h: SoundHandle): SoundHandle {
    this.handles.add(h)
    const stop = h.stop
    h.stop = () => {
      this.handles.delete(h)
      stop()
    }
    return h
  }

  /** Stop every sound (used when leaving a module or muting). */
  stopAll() {
    for (const h of [...this.handles]) h.stop()
  }

  /** A single tone. */
  tone(freqHz: number, durationS: number, opts: { gain?: number; type?: OscillatorType; delayS?: number } = {}): SoundHandle {
    const ctx = this.enabled ? this.ensure() : null
    if (!ctx || !this.master) return { stop: () => {} }
    const t0 = ctx.currentTime + (opts.delayS ?? 0) + 0.01
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = opts.type ?? 'sine'
    osc.frequency.value = freqHz
    g.gain.setValueAtTime(0, t0)
    g.gain.linearRampToValueAtTime(opts.gain ?? 0.15, t0 + RAMP)
    g.gain.setValueAtTime(opts.gain ?? 0.15, t0 + durationS - RAMP)
    g.gain.linearRampToValueAtTime(0, t0 + durationS)
    osc.connect(g).connect(this.master)
    osc.start(t0)
    osc.stop(t0 + durationS + 0.05)
    const h = this.track({
      stop: () => {
        try {
          osc.stop()
        } catch {
          /* already stopped */
        }
      },
    })
    osc.onended = () => h.stop()
    return h
  }

  /**
   * A keyed tone (Morse, marker beacons). Segments are tone-on periods.
   * With `loopPeriodS` the pattern repeats until stopped.
   */
  keyed(
    segments: ToneSegment[],
    freqHz: number,
    opts: { gain?: number; loopPeriodS?: number; type?: OscillatorType; onDone?: () => void } = {},
  ): SoundHandle {
    const ctx = this.enabled ? this.ensure() : null
    if (!ctx || !this.master) return { stop: () => {} }
    const gainLevel = opts.gain ?? 0.15
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = opts.type ?? 'sine'
    osc.frequency.value = freqHz
    g.gain.value = 0
    osc.connect(g).connect(this.master)
    const start = ctx.currentTime + 0.05
    osc.start(start)

    const schedule = (offset: number) => {
      for (const s of segments) {
        const a = offset + s.startS
        const b = a + s.durationS
        g.gain.setValueAtTime(0, a)
        g.gain.linearRampToValueAtTime(gainLevel, a + RAMP)
        g.gain.setValueAtTime(gainLevel, Math.max(a + RAMP, b - RAMP))
        g.gain.linearRampToValueAtTime(0, b)
      }
    }

    let timer: number | undefined
    let stopped = false
    if (opts.loopPeriodS) {
      const period = opts.loopPeriodS
      let next = start
      const pump = () => {
        if (stopped) return
        while (next < ctx.currentTime + 1.5) {
          schedule(next)
          next += period
        }
      }
      pump()
      timer = window.setInterval(pump, 250)
    } else {
      schedule(start)
      const end = segments.length ? Math.max(...segments.map((s) => s.startS + s.durationS)) : 0
      osc.stop(start + end + 0.05)
      osc.onended = () => {
        if (!stopped) opts.onDone?.()
        h.stop()
      }
    }
    const h = this.track({
      stop: () => {
        if (stopped) return
        stopped = true
        window.clearInterval(timer)
        const now = ctx.currentTime
        g.gain.cancelScheduledValues(now)
        g.gain.setTargetAtTime(0, now, 0.01)
        try {
          osc.stop(now + 0.05)
        } catch {
          /* already stopped */
        }
      },
      setGain: () => {},
    })
    return h
  }

  /** Continuous band-limited noise (radio hiss, HF static). Adjust with setGain. */
  noise(opts: { gain?: number; lowpassHz?: number; highpassHz?: number; crackle?: boolean } = {}): SoundHandle {
    const ctx = this.enabled ? this.ensure() : null
    if (!ctx || !this.master) return { stop: () => {}, setGain: () => {} }
    const len = ctx.sampleRate * 2
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) {
      let v = Math.random() * 2 - 1
      // Occasional impulses for atmospheric static.
      if (opts.crackle && Math.random() < 0.0008) v *= 6
      data[i] = v
    }
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.loop = true
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = opts.highpassHz ?? 300
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = opts.lowpassHz ?? 3000
    const g = ctx.createGain()
    g.gain.value = 0
    g.gain.setTargetAtTime(opts.gain ?? 0.05, ctx.currentTime, 0.05)
    src.connect(hp).connect(lp).connect(g).connect(this.master)
    src.start()
    return this.track({
      stop: () => {
        g.gain.setTargetAtTime(0, ctx.currentTime, 0.03)
        try {
          src.stop(ctx.currentTime + 0.15)
        } catch {
          /* already stopped */
        }
      },
      setGain: (v: number) => g.gain.setTargetAtTime(v, ctx.currentTime, 0.05),
    })
  }

  /**
   * Two carriers a little apart beating together: the squeal you hear when two
   * radios transmit on the same frequency at once.
   */
  heterodyne(durationS: number, opts: { gain?: number; beatHz?: number } = {}): SoundHandle {
    const ctx = this.enabled ? this.ensure() : null
    if (!ctx || !this.master) return { stop: () => {} }
    const t0 = ctx.currentTime + 0.01
    const g = ctx.createGain()
    const level = opts.gain ?? 0.08
    g.gain.setValueAtTime(0, t0)
    g.gain.linearRampToValueAtTime(level, t0 + 0.02)
    g.gain.setValueAtTime(level, t0 + durationS - 0.05)
    g.gain.linearRampToValueAtTime(0, t0 + durationS)
    g.connect(this.master)
    const a = ctx.createOscillator()
    const b = ctx.createOscillator()
    a.type = 'sawtooth'
    b.type = 'sawtooth'
    a.frequency.value = 1400
    b.frequency.setValueAtTime(1400 + (opts.beatHz ?? 600), t0)
    b.frequency.linearRampToValueAtTime(1400 + (opts.beatHz ?? 600) * 1.6, t0 + durationS)
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 3200
    a.connect(lp)
    b.connect(lp)
    lp.connect(g)
    a.start(t0)
    b.start(t0)
    a.stop(t0 + durationS + 0.05)
    b.stop(t0 + durationS + 0.05)
    const h = this.track({
      stop: () => {
        try {
          a.stop()
          b.stop()
        } catch {
          /* already stopped */
        }
      },
    })
    a.onended = () => h.stop()
    return h
  }

  /**
   * SELCAL: two pairs of simultaneous tones, each pair about 1 s long with a
   * 0.2 s gap. `pairs` holds two [f1, f2] frequency pairs in Hz.
   */
  selcal(pairs: [[number, number], [number, number]], opts: { gain?: number } = {}): SoundHandle {
    const ctx = this.enabled ? this.ensure() : null
    if (!ctx || !this.master) return { stop: () => {} }
    const hs: SoundHandle[] = []
    pairs.forEach(([f1, f2], i) => {
      const delay = i * 1.2
      hs.push(this.tone(f1, 1.0, { gain: (opts.gain ?? 0.1) / 2, delayS: delay }))
      hs.push(this.tone(f2, 1.0, { gain: (opts.gain ?? 0.1) / 2, delayS: delay }))
    })
    return { stop: () => hs.forEach((h) => h.stop()) }
  }
}

export const audio = new AudioEngine()

// Stop sounds when muted.
usePrefs.subscribe((s, prev) => {
  if (prev.soundOn && !s.soundOn) audio.stopAll()
})
