import { describe, expect, it } from 'vitest'
import { angleDiff, destinationPoint, magneticToTrue, normalize180 } from '@/core/geometry'
import { dvorSourceBearingDeg, MONITOR, receiverPhaseDifferenceDeg, thirtyHz, vorCdi } from '@/core/vor'
import { DvorEngine, FAULT_DRIFT_DEG_PER_S, STATION } from '@/modules/dvor/engine'

function run(e: DvorEngine, seconds: number, dt = 0.1, each?: (e: DvorEngine) => void) {
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    e.step(dt)
    each?.(e)
  }
}

function putOn(e: DvorEngine, radial: number, distNm: number, altitudeFt = 6000) {
  e.setAircraft({ pos: destinationPoint(STATION.pos, magneticToTrue(radial, e.variationDeg), distNm), altitudeFt, targetAltitudeFt: altitudeFt })
}

describe('VOR engine: the ideal station', () => {
  it('the measured radial (= phase difference) is the magnetic bearing from the station', () => {
    const e = new DvorEngine()
    e.variationDeg = 12
    for (const radial of [0, 45, 133, 270, 359]) {
      putOn(e, radial, 15)
      expect(e.last.usable).toBe(true)
      expect(Math.abs(angleDiff(radial, e.last.radialMeasured!))).toBeLessThan(1e-6)
    }
  })

  it('the oscilloscope signals give the receiver the same radial, in CVOR and DVOR', () => {
    const e = new DvorEngine()
    putOn(e, 213, 20)
    for (const type of ['cvor', 'dvor'] as const) {
      e.env = { ...e.env, type }
      e.update()
      const r = e.last.radialMeasured!
      const m = receiverPhaseDifferenceDeg((t) => thirtyHz(type, t, r).fm, (t) => thirtyHz(type, t, r).am)
      expect(Math.abs(angleDiff(213, m))).toBeLessThan(1e-6)
    }
  })

  it('CDI cases on the map: OBS 090 on radials 095 (FROM, left), 265 (TO, left), 275 (TO, right)', () => {
    const e = new DvorEngine()
    e.setObs(90)
    putOn(e, 95, 10)
    expect(e.last.cdi.toFrom).toBe('FROM')
    expect(e.last.cdi.lateral).toBeLessThan(0)
    putOn(e, 265, 10)
    expect(e.last.cdi.toFrom).toBe('TO')
    expect(e.last.cdi.lateral).toBeLessThan(0)
    putOn(e, 275, 10)
    expect(e.last.cdi.toFrom).toBe('TO')
    expect(e.last.cdi.lateral).toBeGreaterThan(0)
  })

  it('the needle does not depend on the heading', () => {
    const e = new DvorEngine()
    putOn(e, 200, 10)
    const a = e.last.cdi
    e.setAircraft({ headingDeg: 17 })
    expect(e.last.cdi).toEqual(a)
  })
})

describe('VOR engine: experiments', () => {
  it('flying a full circle, the phase difference goes through 0–360° and matches the radial', () => {
    const e = new DvorEngine()
    e.place('circle')
    const bins = new Set<number>()
    run(e, 480, 0.1, (x) => {
      const r = x.last
      expect(Math.abs(angleDiff(r.radialGeometric, r.radialMeasured!))).toBeLessThan(1e-6)
      bins.add(Math.floor(r.radialMeasured! / 30))
    })
    expect(bins.size).toBe(12)
  })

  it('OBS 090: TO while inbound, FROM after the station, the needle centred both ways', () => {
    const e = new DvorEngine()
    e.place('west')
    const flags: string[] = []
    let maxDev = 0
    run(e, 360, 0.1, (x) => {
      flags.push(x.last.cdi.toFrom)
      if (x.last.distanceNm > 3 && x.last.usable) maxDev = Math.max(maxDev, Math.abs(x.last.cdi.deviationDeg))
    })
    expect(flags[10]).toBe('TO')
    expect(flags[flags.length - 1]).toBe('FROM')
    // Over the station (even at 6,000 ft) the flag shows OFF for a moment.
    const firstFrom = flags.indexOf('FROM')
    expect(flags.slice(0, firstFrom).includes('OFF')).toBe(true)
    expect(maxDev).toBeLessThan(2)
    // Still on the 090 course after passing: now on radial 090.
    expect(Math.abs(angleDiff(90, e.last.radialMeasured!))).toBeLessThan(2)
  })

  it('climbing over the station: the needle swings, then the flag shows OFF, inside the cone', () => {
    const e = new DvorEngine()
    e.place('overfly')
    const states = new Set<string>()
    let offInCone = true
    run(e, 300, 0.1, (x) => {
      states.add(x.last.cone)
      if (x.last.cone === 'cone' && x.last.cdi.toFrom !== 'OFF') offInCone = false
    })
    expect(states.has('swing')).toBe(true)
    expect(states.has('cone')).toBe(true)
    expect(offInCone).toBe(true)
    expect(e.last.cdi.toFrom).toBe('FROM')
  })

  it('the cone is wider the higher you fly', () => {
    const e = new DvorEngine()
    putOn(e, 90, 2, 6000)
    expect(e.last.cone).toBe('clear')
    putOn(e, 90, 2, 25000)
    expect(e.last.cone).toBe('cone')
    const r1 = (e.setAircraft({ altitudeFt: 10000 }), e.coneRadiusHereNm)
    const r2 = (e.setAircraft({ altitudeFt: 30000 }), e.coneRadiusHereNm)
    expect(r2).toBeGreaterThan(2.5 * r1)
  })

  it('a building near the station: CVOR errors of a few degrees, DVOR ten times smaller or better', () => {
    const rms = (type: 'cvor' | 'dvor') => {
      const e = new DvorEngine()
      e.env = { ...e.env, type, building: true }
      e.place('building')
      let s2 = 0
      let n = 0
      let max = 0
      run(e, 240, 0.05, (x) => {
        s2 += x.last.siteErrorDeg ** 2
        n++
        max = Math.max(max, Math.abs(x.last.siteErrorDeg))
      })
      return { rms: Math.sqrt(s2 / n), max }
    }
    const c = rms('cvor')
    const d = rms('dvor')
    expect(c.max).toBeGreaterThan(3)
    expect(c.max).toBeLessThan(10)
    expect(d.rms).toBeLessThan(c.rms / 10)
    // The error chart trail is recorded.
    const e = new DvorEngine()
    e.env = { ...e.env, building: true }
    e.place('building')
    run(e, 5)
    expect(e.errorTrail.length).toBeGreaterThan(10)
  })

  it('the building bends the course: the needle and the map disagree (CVOR)', () => {
    const e = new DvorEngine()
    e.env = { ...e.env, type: 'cvor', building: true }
    e.place('building')
    let max = 0
    run(e, 60, 0.05, (x) => (max = Math.max(max, Math.abs(angleDiff(x.last.radialGeometric, x.last.radialMeasured!)))))
    expect(max).toBeGreaterThan(2)
  })
})

describe('VOR engine: monitoring and ident', () => {
  it('a fault drifts the bearing; the monitor shuts the station down past 1°', () => {
    const e = new DvorEngine()
    putOn(e, 120, 15)
    e.env = { ...e.env, fault: true }
    let maxErr = 0
    let offAt = -1
    run(e, 10, 0.05, (x) => {
      if (x.last.received) maxErr = Math.max(maxErr, Math.abs(x.last.faultErrorDeg))
      if (offAt < 0 && !x.last.radiating) offAt = x.timeS
    })
    expect(offAt).toBeGreaterThan(0)
    expect(offAt).toBeCloseTo(MONITOR.bearingAlarmDeg / FAULT_DRIFT_DEG_PER_S, 0)
    expect(maxErr).toBeLessThanOrEqual(MONITOR.bearingAlarmDeg + 0.05)
    expect(e.last.cdi.toFrom).toBe('OFF')
    expect(e.last.identAudible).toBe(false)
    expect(e.last.radialMeasured).toBeNull()
  })

  it('with a standby transmitter the station comes back after the changeover, bearing correct', () => {
    const e = new DvorEngine()
    putOn(e, 120, 15)
    e.env = { ...e.env, fault: true, standby: true }
    run(e, 5)
    expect(e.status).toBe('alarm')
    run(e, MONITOR.changeoverS + 0.5)
    expect(e.status).toBe('standby')
    expect(e.last.usable).toBe(true)
    expect(Math.abs(angleDiff(e.last.radialGeometric, e.last.radialMeasured!))).toBeLessThan(1e-6)
    expect(e.last.identAudible).toBe(true)
  })

  it('repairing the fault restores the main transmitter', () => {
    const e = new DvorEngine()
    e.env = { ...e.env, fault: true }
    run(e, 8)
    e.env = { ...e.env, fault: false }
    run(e, 0.2)
    expect(e.status).toBe('normal')
    expect(e.last.radiating).toBe(true)
    expect(e.last.faultErrorDeg).toBe(0)
  })

  it('ident removed for maintenance: the needle works but no ident is heard', () => {
    const e = new DvorEngine()
    e.env = { ...e.env, identRemoved: true }
    e.update()
    expect(e.last.usable).toBe(true)
    expect(e.last.identAudible).toBe(false)
  })
})

describe('VOR engine: world rules', () => {
  it('no signal low down far away or behind the mountains', () => {
    const e = new DvorEngine()
    putOn(e, 90, 120, 1000)
    expect(e.last.received).toBe(false)
    expect(e.last.cdi.toFrom).toBe('OFF')
    // North-west, low, behind the North Range.
    e.setAircraft({ pos: { x: -45, y: 45 }, altitudeFt: 3000 })
    expect(e.last.received).toBe(false)
    e.setAircraft({ altitudeFt: 25000 })
    expect(e.last.received).toBe(true)
  })

  it('the slowed-down commutation turns counter-clockwise and freezes when paused', () => {
    const e = new DvorEngine()
    run(e, 1)
    const a = dvorSourceBearingDeg(e.signalTimeS, e.variationDeg)
    const pos = { ...e.aircraft.pos }
    for (let i = 0; i < 20; i++) e.step(0)
    expect(dvorSourceBearingDeg(e.signalTimeS, e.variationDeg)).toBe(a)
    expect(e.aircraft.pos).toEqual(pos)
    e.step(0.1)
    expect(angleDiff(a, dvorSourceBearingDeg(e.signalTimeS, e.variationDeg))).toBeLessThan(0)
  })

  it('the track autopilot follows the needle, so OBS changes turn the aircraft', () => {
    const e = new DvorEngine()
    e.place('west')
    run(e, 20)
    expect(Math.abs(normalize180(vorCdi(90, e.last.radialMeasured!).deviationDeg))).toBeLessThan(1)
  })
})
