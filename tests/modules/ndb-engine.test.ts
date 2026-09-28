import { describe, expect, it } from 'vitest'
import { angleDiff, bearingDeg, distanceNm, normalize180, normalize360 } from '@/core/geometry'
import { bearingSum } from '@/core/ndb'
import { NdbEngine, TIME_OF_DAY_HOUR } from '@/modules/ndb/engine'

function run(e: NdbEngine, seconds: number, dt = 0.1, each?: (e: NdbEngine) => void) {
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    e.step(dt)
    each?.(e)
  }
}

describe('NDB engine: the ideal ADF', () => {
  it('the needle shows the true relative bearing when nothing goes wrong', () => {
    const e = new NdbEngine()
    e.station.ratedCoverageNm = 200 // strong signal: no noise to speak of
    run(e, 5, 0.1, (x) => {
      const ind = x.last
      expect(ind.signal).toBe(true)
      expect(Math.abs(angleDiff(ind.truth.relative, ind.relative!))).toBeLessThan(0.5)
    })
  })

  it('the needle agrees with the map: heading + relative bearing = bearing to the station', () => {
    const e = new NdbEngine()
    e.station.ratedCoverageNm = 200
    e.step(0.1)
    const a = e.aircraft
    const ind = e.last
    expect(Math.abs(angleDiff(normalize360(a.headingDeg + ind.relative!), bearingDeg(a.pos, e.station.pos)))).toBeLessThan(0.5)
  })

  it('RMI and formula: magnetic bearing = magnetic heading + relative bearing, with variation East is least', () => {
    const e = new NdbEngine()
    e.variationDeg = 15
    e.station.ratedCoverageNm = 200
    e.step(0.1)
    const ind = e.last
    const rmi = ind.rmi!
    expect(rmi.headingMag).toBeCloseTo(normalize360(e.aircraft.headingDeg - 15), 6)
    expect(angleDiff(rmi.bearingToMag, normalize360(rmi.headingMag + ind.relative!))).toBeCloseTo(0, 6)
    expect(Math.abs(angleDiff(rmi.bearingToMag, normalize360(ind.truth.bearingTrue - 15)))).toBeLessThan(0.5)
    const s = bearingSum(rmi.headingMag, ind.relative!)
    expect((s.heading + s.relative) % 360).toBe(s.bearing)
    expect(Math.abs(angleDiff(s.bearing, rmi.bearingToMag))).toBeLessThanOrEqual(1)
  })
})

describe('NDB engine: experiments', () => {
  it('orbiting clockwise: the needle stays near 090 while the bearing goes all the way round', () => {
    const e = new NdbEngine()
    e.station.ratedCoverageNm = 200
    const st = e.station.pos
    e.setAircraft({ pos: { x: st.x, y: st.y - 4 }, headingDeg: 270, targetHeadingDeg: 270, speedKt: 240, targetSpeedKt: 240 })
    e.orbitRadiusNm = 4
    e.setAutopilot('orbit')
    run(e, 60) // settle on the circle
    const bearings: number[] = []
    run(e, 400, 0.1, (x) => {
      expect(Math.abs(angleDiff(90, x.last.relative!))).toBeLessThan(15)
      bearings.push(x.last.rmi!.bearingToMag)
    })
    // The magnetic bearing to the station covers the whole compass.
    const bins = new Set(bearings.map((b) => Math.floor(b / 30)))
    expect(bins.size).toBe(12)
  })

  it('homing: put the needle on the nose, fly straight, pass overhead, needle swings to the tail', () => {
    const e = new NdbEngine()
    e.station.ratedCoverageNm = 200
    e.place('near')
    expect(Math.abs(normalize180(e.last.relative!))).toBeGreaterThan(40)
    e.turnToNeedle()
    run(e, 30) // turning
    expect(Math.abs(normalize180(e.last.relative!))).toBeLessThan(2)
    let minD = Infinity
    let passedAt = -1
    const rels: number[] = []
    run(e, 480, 0.1, (x) => {
      const d = distanceNm(x.aircraft.pos, x.station.pos)
      minD = Math.min(minD, d)
      rels.push(x.last.relative!)
      if (passedAt < 0 && x.lastPassageS > 0) passedAt = x.timeS
    })
    // No wind: homing is tracking, so the aircraft goes (almost) straight over the beacon.
    expect(minD).toBeLessThan(0.3)
    expect(passedAt).toBeGreaterThan(0)
    // Before: needle on the nose. After: needle on the tail.
    expect(Math.abs(normalize180(rels[100]))).toBeLessThan(3)
    expect(Math.abs(angleDiff(180, rels[rels.length - 1]))).toBeLessThan(3)
  })

  it('the homing autopilot follows the needle and stops overhead', () => {
    const e = new NdbEngine()
    e.station.ratedCoverageNm = 200
    e.place('near')
    e.setAutopilot('home')
    let minD = Infinity
    run(e, 600, 0.1, (x) => (minD = Math.min(minD, distanceNm(x.aircraft.pos, x.station.pos))))
    expect(minD).toBeLessThan(0.5)
    expect(e.autopilot).toBe('heading')
    // Flying away afterwards, not circling back.
    expect(Math.abs(angleDiff(180, e.last.relative!))).toBeLessThan(10)
  })

  it('thunderstorm: the needle swings toward the lightning, then settles back', () => {
    const e = new NdbEngine()
    e.station.ratedCoverageNm = 200
    e.place('near')
    e.turnToNeedle()
    run(e, 30)
    e.env = { ...e.env, storm: true }
    e.placeStormNearAircraft()
    let maxErr = 0
    let signedSum = 0
    let n = 0
    run(e, 120, 0.05, (x) => {
      const err = x.last.errors.storm
      maxErr = Math.max(maxErr, Math.abs(err))
      signedSum += err
      n++
    })
    // The storm is to the right of the beacon: the needle is pulled clockwise.
    expect(signedSum / n).toBeGreaterThan(1)
    expect(maxErr).toBeGreaterThan(10)
    expect(maxErr).toBeLessThan(60)
    e.env = { ...e.env, storm: false }
    run(e, 10)
    expect(e.last.errors.storm).toBe(0)
  })

  it('each lightning flash swings the needle by roughly 10–30°', () => {
    const e = new NdbEngine()
    e.place('near')
    e.turnToNeedle()
    e.placeStormNearAircraft()
    e.env = { ...e.env, storm: true }
    const peaks: number[] = []
    let cur = 0
    let lastFlash = -1
    for (let t = 0; t < 300; t += 0.05) {
      e.step(0.05)
      const f = e.flashes[e.flashes.length - 1]
      if (f && f.timeS !== lastFlash) {
        if (lastFlash >= 0) peaks.push(cur)
        cur = 0
        lastFlash = f.timeS
      }
      cur = Math.max(cur, Math.abs(e.last.errors.storm))
    }
    peaks.sort((a, b) => a - b)
    const median = peaks[Math.floor(peaks.length / 2)]
    expect(median).toBeGreaterThan(8)
    expect(median).toBeLessThan(30)
  })

  it('lightning is deterministic for a given seed', () => {
    const mk = () => {
      const e = new NdbEngine(11)
      e.env = { ...e.env, storm: true }
      e.placeStormNearAircraft()
      return e
    }
    const a = mk()
    const b = mk()
    run(a, 30, 1 / 60)
    run(b, 30, 0.1)
    expect(a.flashes.map((f) => f.timeS)).toEqual(b.flashes.map((f) => f.timeS))
  })

  it('day and night: steady by day, wandering at night, worst at dusk', () => {
    const wander = (hour: number) => {
      const e = new NdbEngine(5)
      e.place('far')
      e.env = { ...e.env, hour }
      e.setAircraft({ speedKt: 120, targetSpeedKt: 120 })
      let s2 = 0
      let n = 0
      run(e, 240, 0.25, (x) => {
        s2 += x.last.errors.night ** 2
        n++
      })
      return Math.sqrt(s2 / n)
    }
    const day = wander(TIME_OF_DAY_HOUR.day)
    const dusk = wander(TIME_OF_DAY_HOUR.dusk)
    const night = wander(TIME_OF_DAY_HOUR.night)
    expect(day).toBe(0)
    expect(night).toBeGreaterThan(1.5)
    expect(dusk).toBeGreaterThan(night)
  })

  it('night effect is small close to the beacon', () => {
    const e = new NdbEngine(5)
    e.env = { ...e.env, hour: 18 }
    const st = e.station.pos
    // Held in place 10 NM from the beacon at dusk.
    e.setAircraft({ pos: { x: st.x + 10, y: st.y }, held: true })
    let max = 0
    run(e, 240, 0.25, (x) => (max = Math.max(max, Math.abs(x.last.errors.night))))
    expect(max).toBeLessThan(1.5)
  })

  it('coastal refraction: an error appears over the sea and vanishes when the path stays over land', () => {
    const e = new NdbEngine()
    e.env = { ...e.env, coastal: true }
    e.place('coast')
    expect(e.last.crossings.length).toBeGreaterThan(0)
    let max = 0
    run(e, 240, 0.25, (x) => (max = Math.max(max, Math.abs(x.last.errors.coastal))))
    expect(max).toBeGreaterThan(2)
    expect(max).toBeLessThan(15)
    e.place('near')
    expect(e.last.errors.coastal).toBe(0)
  })

  it('mountain effect: an erratic needle next to the mountains', () => {
    const e = new NdbEngine()
    e.env = { ...e.env, mountain: true }
    e.place('mountains')
    const errs: number[] = []
    run(e, 240, 0.25, (x) => errs.push(x.last.errors.mountain))
    const max = Math.max(...errs.map(Math.abs))
    expect(max).toBeGreaterThan(4)
    let flips = 0
    for (let i = 1; i < errs.length; i++) if (Math.sign(errs[i]) !== Math.sign(errs[i - 1])) flips++
    expect(flips).toBeGreaterThan(4)
  })

  it('sense antenna off: with the beacon behind, the needle points ahead, exactly 180° wrong', () => {
    const e = new NdbEngine()
    e.station.ratedCoverageNm = 200
    e.place('behind')
    expect(Math.abs(angleDiff(180, e.last.relative!))).toBeLessThan(3)
    e.env = { ...e.env, sense: false }
    e.step(0.1)
    expect(Math.abs(normalize180(e.last.relative!))).toBeLessThan(3)
    expect(e.last.ambiguous).toBe(true)
    e.env = { ...e.env, sense: true }
    e.step(0.1)
    expect(Math.abs(angleDiff(180, e.last.relative!))).toBeLessThan(3)
  })

  it('too far away: no usable signal, needle parked', () => {
    const e = new NdbEngine()
    e.station.ratedCoverageNm = 15
    e.place('far')
    expect(e.last.signal).toBe(false)
    expect(e.last.relative).toBeNull()
    expect(e.last.rmi).toBeNull()
  })

  it('pausing freezes the needle (no world time passes)', () => {
    const e = new NdbEngine()
    e.env = { ...e.env, hour: 18 }
    e.place('far')
    run(e, 5)
    const before = e.last.relative
    const pos = { ...e.aircraft.pos }
    for (let i = 0; i < 30; i++) e.step(0)
    expect(e.last.relative).toBe(before)
    expect(e.aircraft.pos).toEqual(pos)
  })
})
