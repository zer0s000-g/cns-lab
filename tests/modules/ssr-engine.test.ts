import { describe, expect, it } from 'vitest'
import { angleDiff, bearingDeg, distanceNm } from '@/core/geometry'
import { slantRangeNm } from '@/core/propagation'
import { GARBLE_RANGE_NM, rangeFromReplyUs, SPI_DURATION_S } from '@/core/ssr'
import type { ScopePaint } from '@/instruments'
import { SsrEngine, trackEmphasis, trackLabel, type DisplayTrack } from '@/modules/ssr/engine'

function run(e: SsrEngine, seconds: number, dt = 1 / 60): ScopePaint[] {
  const paints: ScopePaint[] = []
  const n = Math.round(seconds / dt)
  for (let i = 0; i < n; i++) {
    e.step(dt)
    paints.push(...e.takePaints())
  }
  return paints
}

const tracks = (e: SsrEngine) => [...e.tracks.values()]
/** The track closest to where the aircraft really is (slant range on its true bearing). */
function trackOf(e: SsrEngine, id: string): DisplayTrack | undefined {
  const a = e.getAircraft(id)!
  const r = slantRangeNm(distanceNm(e.site.pos, a.pos), a.altitudeFt, e.site.heightFt)
  const az = (bearingDeg(e.site.pos, a.pos) * Math.PI) / 180
  const p = { x: Math.sin(az) * r, y: Math.cos(az) * r }
  let best: DisplayTrack | undefined
  let bd = 1.5
  for (const t of tracks(e)) {
    const d = distanceNm(t.pos, p)
    if (d < bd) {
      bd = d
      best = t
    }
  }
  return best
}

describe('SSR engine: Mode A/C', () => {
  it('turns the antenna at 360° per rotation period and interrogates at the set rate', () => {
    const e = new SsrEngine()
    run(e, e.params.rotationPeriodS / 4)
    expect(e.antennaAz).toBeCloseTo(90, 0)
    expect(e.interrogations).toBeGreaterThanOrEqual(Math.floor((e.params.rotationPeriodS / 4) * e.params.prfHz))
    expect(e.interrogations).toBeLessThanOrEqual(Math.ceil((e.params.rotationPeriodS / 4) * e.params.prfHz) + 1)
  })

  it('labels every aircraft with its squawk code and flight level, at its slant range and true bearing', () => {
    const e = new SsrEngine()
    run(e, e.params.rotationPeriodS * 2.2)
    for (const a of e.aircraft) {
      const t = trackOf(e, a.id)
      expect(t, a.id).toBeDefined()
      expect(t!.plot.secondary).toBe(true)
      expect(t!.plot.code).toBe(e.transponder(a.id).squawk)
      expect(Math.abs(t!.plot.altFt! - a.altitudeFt)).toBeLessThanOrEqual(100)
      expect(t!.plot.garbled).toBe(false)
      const r = slantRangeNm(distanceNm(e.site.pos, a.pos), a.altitudeFt, e.site.heightFt)
      // The plot is at most one turn old; allow for how far the aircraft flew since.
      const flown = (a.speedKt / 3600) * e.params.rotationPeriodS
      expect(Math.abs(t!.plot.rangeNm - r)).toBeLessThan(0.3 + flown)
      expect(Math.abs(angleDiff(t!.plot.azDeg, bearingDeg(e.site.pos, a.pos)))).toBeLessThan(3)
    }
  })

  it('gets about ten to twenty replies from each aircraft per pass of the beam', () => {
    const e = new SsrEngine()
    run(e, e.params.rotationPeriodS * 2.1)
    const st = e.lastPass.get('CNS101')!
    expect(st.replies).toBeGreaterThanOrEqual(8)
    expect(st.replies).toBeLessThanOrEqual(30)
    expect(st.sideLobeReplies).toBe(0)
  })

  it('shows a combined symbol when the primary radar sees the aircraft too', () => {
    const e = new SsrEngine()
    run(e, e.params.rotationPeriodS * 2.2)
    const t = trackOf(e, 'CNS101')!
    expect(t.plot.primary).toBe(true)
    expect(t.plot.secondary).toBe(true)
  })

  it('shows special codes as text tags: 7700 EMERGENCY (alert), 7600 RADIO FAIL (warning)', () => {
    const e = new SsrEngine()
    e.xpdr = { ...e.xpdr, CNS101: { ...e.xpdr.CNS101, squawk: '7700' }, CNS505: { ...e.xpdr.CNS505, squawk: '7600' } }
    run(e, e.params.rotationPeriodS * 2.2)
    const t = trackOf(e, 'CNS101')!
    expect(trackLabel(t.plot)).toContain('EMERGENCY')
    expect(trackEmphasis(t.plot)).toBe('alert')
    const r = trackOf(e, 'CNS505')!
    expect(trackLabel(r.plot)).toContain('RADIO FAIL')
    expect(trackEmphasis(r.plot)).toBe('warning')
  })

  it('transponder failure: the label disappears and only a primary blip remains', () => {
    const e = new SsrEngine()
    run(e, e.params.rotationPeriodS * 2.2)
    expect(trackLabel(trackOf(e, 'CNS101')!.plot).length).toBeGreaterThan(0)
    e.xpdr = { ...e.xpdr, CNS101: { ...e.xpdr.CNS101, on: false } }
    run(e, e.params.rotationPeriodS * 1.5)
    const t = trackOf(e, 'CNS101')!
    expect(t).toBeDefined()
    expect(t.plot.secondary).toBe(false)
    expect(t.plot.primary).toBe(true)
    expect(trackLabel(t.plot)).toEqual([])
    expect(t.plot.code).toBeNull()
    expect(t.plot.altFt).toBeNull()
  })

  it('IDENT adds the SPI pulse: the label shows ID for about 18 s, then it goes away', () => {
    const e = new SsrEngine()
    run(e, e.params.rotationPeriodS * 1.2)
    e.xpdr = { ...e.xpdr, CNS101: { ...e.xpdr.CNS101, identAtS: e.timeS } }
    run(e, e.params.rotationPeriodS * 1.1)
    expect(trackLabel(trackOf(e, 'CNS101')!.plot).some((l) => l.includes('ID'))).toBe(true)
    run(e, SPI_DURATION_S + e.params.rotationPeriodS * 1.2)
    expect(e.spiActive('CNS101')).toBe(false)
    expect(trackLabel(trackOf(e, 'CNS101')!.plot).some((l) => l.includes('ID'))).toBe(false)
  })
})

describe('SSR engine: garbling', () => {
  it('two aircraft in trail 1 NM apart garble in Mode A/C', () => {
    const e = new SsrEngine()
    e.env = { ...e.env, garblePair: true }
    e.applyGarblePair(true)
    const a = e.getAircraft('CNS303')!
    const b = e.getAircraft('CNS606')!
    const ra = slantRangeNm(distanceNm(e.site.pos, a.pos), a.altitudeFt, e.site.heightFt)
    const rb = slantRangeNm(distanceNm(e.site.pos, b.pos), b.altitudeFt, e.site.heightFt)
    expect(Math.abs(ra - rb)).toBeLessThan(GARBLE_RANGE_NM)
    run(e, e.params.rotationPeriodS * 2.2)
    const ta = trackOf(e, 'CNS303')!
    const tb = trackOf(e, 'CNS606')!
    expect(ta.plot.garbled).toBe(true)
    expect(tb.plot.garbled).toBe(true)
    expect(trackLabel(ta.plot)).toContain('GARBLED')
    expect(e.lastPass.get('CNS303')!.garbled).toBeGreaterThan(3)
    // The others are unaffected.
    expect(trackOf(e, 'CNS101')!.plot.garbled).toBe(false)
  })

  it('Mode S asks each aircraft by address: both get clean labels with callsigns', () => {
    const e = new SsrEngine()
    e.env = { ...e.env, garblePair: true }
    e.applyGarblePair(true)
    e.params = { ...e.params, mode: 's' }
    run(e, e.params.rotationPeriodS * 3.2)
    for (const id of ['CNS303', 'CNS606']) {
      const t = trackOf(e, id)!
      expect(t.plot.garbled).toBe(false)
      expect(t.plot.modeS?.callsign).toBe(id)
      expect(t.plot.code).toBe(e.transponder(id).squawk)
      expect(trackLabel(t.plot)[0]).toBe(id)
      expect(e.isAcquired(id)).toBe(true)
    }
    // Each Mode S aircraft answers only a couple of times per pass.
    expect(e.lastPass.get('CNS101')!.replies).toBeLessThanOrEqual(4)
  })
})

describe('SSR engine: side lobes and P2', () => {
  it('with P2, the aircraft close to the radar gets one plot; without P2 its side-lobe replies make false plots around the radar', () => {
    const e = new SsrEngine()
    run(e, e.params.rotationPeriodS * 2.2)
    const near = e.getAircraft('CNS404')!
    const trueAz = bearingDeg(e.site.pos, near.pos)
    const ghosts = () =>
      tracks(e).filter((t) => t.plot.code === '7000' && Math.abs(angleDiff(t.plot.azDeg, bearingDeg(e.site.pos, e.getAircraft('CNS404')!.pos))) > 15)
    expect(ghosts().length).toBe(0)
    expect(e.lastPass.get('CNS404')!.suppressed).toBeGreaterThan(0)
    e.env = { ...e.env, noP2: true }
    run(e, e.params.rotationPeriodS * 2.2)
    expect(ghosts().length).toBeGreaterThanOrEqual(2)
    expect(e.lastPass.get('CNS404')!.sideLobeReplies).toBeGreaterThan(10)
    // Far aircraft do not answer side lobes: they are too weak out there.
    expect(e.lastPass.get('CNS202')!.sideLobeReplies).toBe(0)
    void trueAz
  })

  it('hearInterrogation: in the main beam the aircraft replies, and range = c(t − 3 µs)/2', () => {
    const e = new SsrEngine()
    const a = e.getAircraft('CNS101')!
    const heard = e.hearInterrogation(bearingDeg(e.site.pos, a.pos), 'A', () => 0.5)
    const h = heard.find((x) => x.id === 'CNS101')!
    expect(h.replies).toBe(true)
    expect(h.decision).toBe('reply')
    expect(h.p1Dbm - h.p2Dbm!).toBeGreaterThan(9)
    expect(rangeFromReplyUs(h.arrivalUs!)).toBeCloseTo(h.slantNm, 6)
    // Ninety degrees away, P2 is stronger than P1: suppressed.
    const side = e.hearInterrogation(bearingDeg(e.site.pos, a.pos) + 90, 'A', () => 0.5).find((x) => x.id === 'CNS101')!
    expect(side.replies).toBe(false)
  })
})

describe('SSR engine: FRUIT', () => {
  it('without the defruiter FRUIT paints random dots; the defruiter removes almost all of them; FRUIT never makes plots', () => {
    const off = new SsrEngine(3)
    off.env = { ...off.env, fruit: true, defruiter: false }
    const pOff = run(off, off.params.rotationPeriodS).filter((p) => p.kind === 'false').length
    const on = new SsrEngine(3)
    on.env = { ...on.env, fruit: true, defruiter: true }
    const pOn = run(on, on.params.rotationPeriodS).filter((p) => p.kind === 'false').length
    expect(pOff).toBeGreaterThan(1000)
    expect(pOn).toBeLessThan(pOff * 0.05)
    run(off, off.params.rotationPeriodS * 1.2)
    const real = new Set(off.aircraft.map((a) => a.id))
    expect(tracks(off).every((t) => !t.plot.secondary || (t.plot.sourceId && real.has(t.plot.sourceId)))).toBe(true)
  })
})

describe('SSR engine: slow-motion support', () => {
  it('advanceToAzimuth points the antenna exactly and moves time forward', () => {
    const e = new SsrEngine()
    const t0 = e.timeS
    e.advanceToAzimuth(123.4)
    expect(e.antennaAz).toBeCloseTo(123.4, 6)
    expect(e.timeS - t0).toBeCloseTo((123.4 / 360) * e.params.rotationPeriodS, 3)
  })
})
