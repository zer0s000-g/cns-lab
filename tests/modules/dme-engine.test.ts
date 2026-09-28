import { describe, expect, it } from 'vitest'
import { dmeDistanceFromTimingNm, dmeTiming, minimumDmeReadingNm, replyHistogram } from '@/core/dme'
import { distanceNm } from '@/core/geometry'
import { slantRangeNm } from '@/core/propagation'
import { DmeEngine, MEMORY_S } from '@/modules/dme/engine'

function run(e: DmeEngine, seconds: number, dt = 1 / 30, each?: (e: DmeEngine) => void) {
  const n = Math.round(seconds / dt)
  for (let i = 0; i < n; i++) {
    e.step(dt)
    each?.(e)
  }
}

describe('DME engine: distance', () => {
  it('locks within a second and reads the slant range, not the ground distance', () => {
    const e = new DmeEngine()
    e.placeInbound(20, 30000)
    run(e, 1)
    const r = e.reading()
    expect(r.status).toBe('LOCK')
    const slant = slantRangeNm(distanceNm(e.station.pos, e.own.pos), e.own.altitudeFt, e.station.heightFt)
    expect(r.distanceNm!).toBeCloseTo(slant, 2)
    expect(slant - e.ownGroundNm).toBeGreaterThan(0.05)
  })

  it('never reads below the height when flying over the station at 6,000 ft (about 1 NM)', () => {
    const e = new DmeEngine()
    e.placeOverhead(6000, 4, 200)
    let min = Infinity
    let minGround = Infinity
    run(e, 110, 1 / 30, (x) => {
      const d = x.reading().distanceNm
      if (d !== null) min = Math.min(min, d)
      minGround = Math.min(minGround, x.ownGroundNm)
    })
    expect(minGround).toBeLessThan(0.1)
    expect(min).toBeGreaterThanOrEqual(minimumDmeReadingNm(6000 - e.station.heightFt) - 0.01)
    expect(min).toBeLessThan(1.05)
    expect(min).toBeGreaterThan(0.95)
  })

  it('matches the X and Y reply delays: the same aircraft reads the same distance on both', () => {
    const x = new DmeEngine()
    x.placeInbound(25)
    run(x, 1)
    const y = new DmeEngine()
    y.setEnv({ ...y.env, mode: 'Y' })
    y.placeInbound(25)
    run(y, 1)
    expect(y.reading().distanceNm!).toBeCloseTo(x.reading().distanceNm!, 3)
    expect(y.reading().channel).toBe('90Y')
    // The raw timings differ by the 6 µs longer Y delay.
    const lastX = x.history[x.history.length - 1].ownUs!
    const lastY = y.history[y.history.length - 1].ownUs!
    expect(lastY - lastX).toBeCloseTo(6, 0)
  })

  it('gives slow-motion timeline numbers that agree with the readout', () => {
    const e = new DmeEngine()
    e.placeInbound(30)
    run(e, 2)
    const rec = e.interrogateNow()
    expect(rec.ownUs).not.toBeNull()
    const t = dmeTiming(e.ownSlantNm, e.env.mode)
    expect(rec.ownUs!).toBeCloseTo(t.totalUs, 6)
    expect(e.reading().distanceNm!.toFixed(1)).toBe(dmeDistanceFromTimingNm(t.totalUs, 'X').toFixed(1))
    expect(e.reading().distanceNm!.toFixed(1)).toBe(e.ownSlantNm.toFixed(1))
  })
})

describe('DME engine: groundspeed', () => {
  it('shows the true groundspeed flying straight at the station far away', () => {
    const e = new DmeEngine()
    e.placeInbound(40, 10000, 280)
    run(e, 20)
    const r = e.reading()
    expect(r.groundSpeedKt!).toBeGreaterThan(270)
    expect(r.groundSpeedKt!).toBeLessThan(285)
    expect(r.timeToStationMin!).toBeCloseTo((r.distanceNm! / r.groundSpeedKt!) * 60, 1)
  })

  it('reads almost zero while circling the station at 250 kt', () => {
    const e = new DmeEngine()
    e.placeOrbit(10, 8000, 250)
    run(e, 40)
    let maxGs = 0
    run(e, 60, 1 / 30, (x) => (maxGs = Math.max(maxGs, x.reading().groundSpeedKt ?? 0)))
    expect(e.own.speedKt).toBeCloseTo(250, 0)
    expect(maxGs).toBeLessThan(25)
    expect(e.reading().timeToStationMin).toBeNull()
  })

  it('is badly wrong close to and over the station', () => {
    const e = new DmeEngine()
    e.placeOverhead(10000, 4, 250)
    let lowest = Infinity
    run(e, 70, 1 / 30, (x) => {
      if (x.ownGroundNm < 1) lowest = Math.min(lowest, x.reading().groundSpeedKt ?? Infinity)
    })
    expect(lowest).toBeLessThan(120)
  })
})

describe('DME engine: failures', () => {
  it('keeps answering 100 aircraft, but with 150 the farthest (including us at 80 NM) lose their replies', () => {
    const ok = new DmeEngine()
    ok.setEnv({ ...ok.env, trafficCount: 100 })
    ok.placeFar(80)
    run(ok, 3)
    expect(ok.load.overloaded).toBe(false)
    expect(ok.reading().status).toBe('LOCK')

    const e = new DmeEngine()
    e.setEnv({ ...e.env, trafficCount: 150 })
    e.placeFar(80)
    run(e, 1)
    expect(e.load.overloaded).toBe(true)
    expect(e.load.cutoffNm).toBeLessThan(e.ownSlantNm)
    expect(e.ownEfficiency).toBe(0)
    expect(e.reading().distanceNm).toBeNull()
    expect(e.reading().status).toBe('SEARCH')
    // The closest traffic is still answered, the farthest is not.
    const byRange = [...e.traffic].sort((a, b) => e.slantOf(a) - e.slantOf(b))
    expect(e.isAnswered(byRange[0].id)).toBe(true)
    expect(e.isAnswered(byRange[byRange.length - 1].id)).toBe(false)
    expect(e.load.replyPps).toBeCloseTo(2700, 0)
  })

  it('when the station overloads while locked, holds the last reading (MEMORY) without stray answers upsetting it', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const e = new DmeEngine(seed)
      e.placeFar(80)
      e.assumeLocked()
      const d0 = e.reading().distanceNm!
      e.setEnv({ ...e.env, trafficCount: 150 })
      let sawMemory = false
      run(e, 5, 1 / 30, (x) => {
        const r = x.reading()
        if (r.status === 'MEMORY') {
          sawMemory = true
          expect(Math.abs(r.distanceNm! - d0)).toBeLessThan(0.15)
          expect(r.groundSpeedKt!).toBeGreaterThan(290)
          expect(r.groundSpeedKt!).toBeLessThan(345)
        }
      })
      expect(sawMemory).toBe(true)
      run(e, MEMORY_S)
      expect(e.reading().status).toBe('SEARCH')
    }
  })

  it('goes to MEMORY and then SEARCH with dashes when a hill blocks the station, and locks again past it', () => {
    const e = new DmeEngine()
    e.placeOverhead(6000, 20)
    run(e, 1)
    expect(e.reading().status).toBe('LOCK')
    const before = e.reading().distanceNm
    // Now fly low behind Mount Sentinel, keeping the lock state (as if it had flown there).
    e.setOwn({ pos: { x: -24, y: 10.5 }, altitudeFt: 2500, targetAltitudeFt: 2500, headingDeg: 180, targetHeadingDeg: 180, mode: { kind: 'heading' }, speedKt: 220, targetSpeedKt: 220 })
    expect(e.heard).toBe(false)
    run(e, 1)
    expect(e.reading().status).toBe('MEMORY')
    expect(e.reading().distanceNm).toBe(before)
    run(e, MEMORY_S + 0.5)
    expect(e.reading().status).toBe('SEARCH')
    expect(e.reading().distanceNm).toBeNull()
    // Flying south it leaves the shadow and the DME finds its replies again.
    let relocked = false
    run(e, 240, 1 / 15, (x) => {
      if (x.reading().status === 'LOCK') relocked = true
    })
    expect(relocked).toBe(true)
  })

  it('placeBehindHill starts with no line of sight', () => {
    const e = new DmeEngine()
    e.placeBehindHill()
    expect(e.heard).toBe(false)
    expect(e.los.minClearanceFt).toBeLessThan(0)
    run(e, 1)
    expect(e.reading().distanceNm).toBeNull()
  })

  it('without jitter locks onto the in-step twin and shows a wrong distance, with jitter finds its own reply', () => {
    const e = new DmeEngine()
    e.placeInbound(30)
    run(e, 1)
    const truth = e.ownSlantNm
    e.setEnv({ ...e.env, noJitter: true })
    run(e, 1.5)
    const wrong = e.reading().distanceNm!
    expect(e.reading().status).toBe('LOCK')
    expect(e.lockedOnTwin).toBe(true)
    expect(Math.abs(wrong - e.ownSlantNm)).toBeGreaterThan(5)
    expect(wrong).toBeCloseTo(truth * 0.55, 0)
    // The own answers and the twin's both line up: two tall bins.
    const bins = replyHistogram(e.history.map((h) => h.delaysUs), 4, 3000)
    const tall = bins.filter((b) => b > e.history.length * 0.5).length
    expect(tall).toBeGreaterThanOrEqual(2)
    e.setEnv({ ...e.env, noJitter: false })
    run(e, 1.5)
    expect(e.lockedOnTwin).toBe(false)
    expect(e.reading().distanceNm!).toBeCloseTo(e.ownSlantNm, 1)
  })

  it('with jitter, only its own answers line up after many questions', () => {
    const e = new DmeEngine()
    e.setEnv({ ...e.env, trafficCount: 80 })
    e.placeInbound(30)
    run(e, 3)
    const rows = e.history.map((h) => h.delaysUs)
    const bins = replyHistogram(rows, 4, 3000)
    const own = e.history[e.history.length - 1].ownUs!
    const ownBin = Math.floor(own / 4)
    const ownCount = bins[ownBin] + (bins[ownBin + 1] ?? 0) + (bins[ownBin - 1] ?? 0)
    const others = bins.filter((_, i) => Math.abs(i - ownBin) > 2)
    expect(ownCount).toBeGreaterThan(rows.length * 0.7)
    expect(Math.max(...others)).toBeLessThan(rows.length * 0.2)
    // The other answers are there: many more than ours in total.
    expect(rows.reduce((s, r) => s + r.length, 0)).toBeGreaterThan(rows.length * 3)
  })
})

describe('DME engine: interrogation rate and ident', () => {
  it('asks about 150 times a second while searching and about 30 while tracking', () => {
    const e = new DmeEngine()
    e.placeInbound(30)
    run(e, 3)
    const n0 = e.interrogations
    run(e, 10)
    expect((e.interrogations - n0) / 10).toBeGreaterThan(26)
    expect((e.interrogations - n0) / 10).toBeLessThan(34)
    const s = new DmeEngine()
    s.placeBehindHill()
    const m0 = s.interrogations
    run(s, 2)
    expect((s.interrogations - m0) / 2).toBeGreaterThan(130)
  })

  it('sends its Morse ident about every 30 seconds, only when the station can be heard', () => {
    const e = new DmeEngine()
    e.placeInbound(40)
    let n = 0
    run(e, 95, 1 / 10, (x) => {
      n += x.events.length
      x.events = []
    })
    expect(n).toBe(4)
    const h = new DmeEngine()
    h.placeBehindHill()
    h.setOwn({ speedKt: 0, targetSpeedKt: 0 })
    let m = 0
    run(h, 40, 1 / 10, (x) => {
      m += x.events.length
      x.events = []
    })
    expect(m).toBe(0)
  })
})
