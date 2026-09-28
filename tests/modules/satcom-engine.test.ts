import { describe, expect, it } from 'vitest'
import { dist3 } from '@/core/geometry'
import { GEO_MASK_DEG, LEO, lookAngles, sphericalToEcef } from '@/core/satcom'
import { GEO_SATS, HANDOVER_GAP_S, LEO_GATEWAY, SatcomEngine, type LinkState } from '@/modules/satcom/engine'

/** Fly the whole route in steps of `dt` seconds, counting time spent in each link state. */
function flyAll(e: SatcomEngine, dt = 5) {
  const time: Record<LinkState, number> = { connected: 0, handover: 0, blocked: 0, 'no-satellite': 0 }
  let t = 0
  while (!e.arrived && t < 24 * 3600) {
    e.step(dt)
    t += dt
    time[e.link.state] += dt
  }
  return { time, t }
}

describe('SATCOM engine: coverage', () => {
  it('loses GEO coverage for hours on the polar route, but LEO keeps a link all the way', () => {
    const geo = new SatcomEngine({ constellation: 'geo', routeId: 'polar' })
    const g = flyAll(geo)
    expect(g.time['no-satellite']).toBeGreaterThan(2 * 3600)
    const gap = geo.history.find((h) => h.state === 'no-satellite')!
    // The gap is centred on the pole, which is half way along the route.
    expect((gap.fromNm + gap.toNm) / 2).toBeGreaterThan(0.4 * geo.routeLengthNm)
    expect((gap.fromNm + gap.toNm) / 2).toBeLessThan(0.6 * geo.routeLengthNm)

    const leo = new SatcomEngine({ constellation: 'leo', routeId: 'polar' })
    const l = flyAll(leo)
    expect(l.time['no-satellite']).toBe(0)
    expect(l.time.blocked).toBe(0)
    // Only the brief handovers interrupt it.
    expect(l.time.handover / l.t).toBeLessThan(0.02)
  })

  it('keeps GEO coverage across the Atlantic and hands over from the eastern to the western satellite', () => {
    const e = new SatcomEngine({ constellation: 'geo', routeId: 'atlantic' })
    expect(GEO_SATS[e.link.sat!].id).toBe('GEO-2')
    const r = flyAll(e)
    expect(r.time['no-satellite']).toBe(0)
    expect(e.handovers).toBe(1)
    expect(GEO_SATS[e.link.sat!].id).toBe('GEO-1')
    const sats = e.history.filter((h) => h.state === 'connected').map((h) => GEO_SATS[h.sat!].id)
    expect(sats).toEqual(['GEO-2', 'GEO-1'])
  })

  it('hands over between LEO satellites every few minutes', () => {
    const e = new SatcomEngine({ constellation: 'leo', routeId: 'atlantic' })
    const r = flyAll(e)
    const minutesPerHandover = r.t / 60 / e.handovers
    expect(minutesPerHandover).toBeGreaterThan(3)
    expect(minutesPerHandover).toBeLessThan(11)
    expect(e.timeUntilSetS()).toBeGreaterThan(0)
  })

  it('reports look angles computed from the same satellite positions it draws', () => {
    const e = new SatcomEngine({ constellation: 'leo', routeId: 'atlantic' })
    e.step(1234)
    const i = e.link.sat!
    const la = lookAngles(e.satPos[i], e.routePoint.pos, e.aircraftHeightM)
    expect(e.looks[i].elevationDeg).toBeCloseTo(la.elevationDeg, 9)
    expect(e.looks[i].elevationDeg).toBeGreaterThanOrEqual(LEO.maskDeg)
    expect(e.looks.every((l) => l.visible === l.elevationDeg >= LEO.maskDeg)).toBe(true)
  })

  it('keeps every GEO ground station in view of its satellite', () => {
    for (const g of GEO_SATS) {
      const e = new SatcomEngine({ constellation: 'geo' })
      const idx = GEO_SATS.indexOf(g)
      expect(lookAngles(e.satPos[idx], g.station.pos).elevationDeg).toBeGreaterThan(GEO_MASK_DEG)
    }
  })
})

describe('SATCOM engine: latency', () => {
  it('needs about a quarter of a second one way through GEO and half a second for a question and answer', () => {
    const e = new SatcomEngine({ constellation: 'geo', routeId: 'atlantic' })
    e.setDistance(1500)
    const p = e.computePath('voice')!
    expect(p.propagationS).toBeGreaterThan(0.24)
    expect(p.propagationS).toBeLessThan(0.28)
    expect(2 * p.propagationS).toBeGreaterThan(0.48)
    expect(2 * p.propagationS).toBeLessThan(0.56)
    // Two legs: aircraft → satellite → ground station, each 36,000–41,700 km.
    expect(p.legs).toHaveLength(2)
    for (const l of p.legs) {
      expect(l.distanceM / 1000).toBeGreaterThan(36_000)
      expect(l.distanceM / 1000).toBeLessThan(41_700)
    }
    // The path starts at the aircraft and ends at the ground station.
    expect(dist3(p.legs[0].from, e.aircraftEcef)).toBeLessThan(1)
    expect(dist3(p.legs[1].to, sphericalToEcef(GEO_SATS[e.link.sat!].station.pos))).toBeLessThan(1)
  })

  it('needs only tens of milliseconds through LEO, even with several inter-satellite hops', () => {
    const e = new SatcomEngine({ constellation: 'leo', routeId: 'atlantic' })
    for (const d of [100, 1500, 2800]) {
      e.setDistance(d)
      const p = e.computePath('voice')!
      expect(p.propagationS * 1000).toBeGreaterThan(5)
      expect(p.propagationS * 1000).toBeLessThan(100)
      expect(dist3(p.legs[p.legs.length - 1].to, sphericalToEcef(LEO_GATEWAY.pos))).toBeLessThan(1)
      expect(p.legs.filter((l) => l.kind === 'isl')).toHaveLength(p.islHops)
    }
  })

  it('plays a message along its path in signal time and records the result', () => {
    const e = new SatcomEngine({ constellation: 'geo' })
    e.setDistance(1500)
    expect(e.send('voice')).toBe('replay')
    const r = e.replay!
    expect(dist3(e.replayPosition()!, e.aircraftEcef)).toBeLessThan(1)
    e.advanceReplay(r.path.legs[0].delayS)
    expect(dist3(e.replayPosition()!, e.satPos[e.link.sat!])).toBeLessThan(1000)
    expect(e.advanceReplay(1)).toBe(true)
    expect(e.replay!.done).toBe(true)
    expect(e.results[0].propagationS).toBeCloseTo(r.path.propagationS, 12)
    expect(e.results[0].queueS).toBe(0)
  })

  it('offers space-based ADS-B only with LEO, and it does not depend on the SATCOM antenna', () => {
    const geo = new SatcomEngine({ constellation: 'geo' })
    expect(geo.send('adsb')).toBe('unavailable')
    const leo = new SatcomEngine({ constellation: 'leo' })
    leo.setDistance(1500)
    leo.bankDeg = 60
    leo.headingDeg = 0
    expect(leo.computePath('adsb')).not.toBeNull()
  })

  it('queues a message while there is no satellite and sends it when coverage returns', () => {
    const e = new SatcomEngine({ constellation: 'geo', routeId: 'polar' })
    e.setDistance(e.routeLengthNm / 2)
    expect(e.link.state).toBe('no-satellite')
    expect(e.send('cpdlc')).toBe('queued')
    let t = 0
    while (!e.replay && t < 10 * 3600) {
      e.step(10)
      t += 10
    }
    expect(e.replay).not.toBeNull()
    expect(e.replay!.queueS).toBeGreaterThan(3600)
    expect(e.pending).toBeNull()
  })
})

describe('SATCOM engine: failures', () => {
  it('loses the GEO link during a steep turn away from the satellite, and regains it with wings level', () => {
    const e = new SatcomEngine({ constellation: 'geo', routeId: 'atlantic' })
    e.setDistance(600)
    e.env.steepTurn = true
    const seen = new Set<LinkState>()
    let blockedS = 0
    for (let k = 0; k < 400; k++) {
      e.step(0.5)
      seen.add(e.link.state)
      if (e.link.state === 'blocked') blockedS += 0.5
    }
    expect(e.bankDeg).toBe(45)
    expect(seen.has('blocked')).toBe(true)
    expect(blockedS).toBeGreaterThan(20)
    // Wings level again: the turn finishes on the route course and the link returns.
    e.env.steepTurn = false
    let k = 0
    while (e.turnPhase !== 'level' && k++ < 1000) e.step(0.5)
    expect(e.turnPhase).toBe('level')
    expect(e.bankDeg).toBe(0)
    expect(Math.abs(e.headingOffRouteDeg())).toBeLessThan(1)
    e.step(10)
    expect(e.link.state).toBe('connected')
  })

  it('waits until the aircraft is airborne before starting the turn', () => {
    const e = new SatcomEngine({ constellation: 'geo' })
    e.env.steepTurn = true
    e.step(10)
    expect(e.bankDeg).toBe(0)
    expect(e.distanceNm).toBeGreaterThan(0)
    let t = 0
    while (e.routePoint.altitudeFt < 1000 && t < 600) {
      e.step(1)
      t++
    }
    e.step(5)
    expect(e.bankDeg).toBeGreaterThan(0)
  })

  it('does not move the aircraft along the route during the turn', () => {
    const e = new SatcomEngine({ constellation: 'geo' })
    e.setDistance(600)
    e.env.steepTurn = true
    e.step(60)
    expect(e.distanceNm).toBe(600)
  })

  it('leaves the L-band link almost untouched by heavy rain while Ku and Ka fade, and nothing fades above the rain', () => {
    const e = new SatcomEngine({ constellation: 'geo' })
    e.env.heavyRain = true
    e.setDistance(0)
    const [l, ku, ka] = e.bandFades()
    expect(l.band).toBe('L')
    expect(l.attenuationDb).toBeLessThan(0.1)
    expect(l.status).toBe('ok')
    expect(ku.status).not.toBe('ok')
    expect(ka.status).toBe('lost')
    expect(e.link.state).toBe('connected')
    // At cruise the aircraft is above the rain.
    e.setDistance(1000)
    for (const f of e.bandFades()) expect(f.attenuationDb).toBe(0)
  })

  it('brings Ku back before Ka as the aircraft climbs out of the rain', () => {
    const e = new SatcomEngine({ constellation: 'geo' })
    e.env.heavyRain = true
    let kuBack = NaN
    let kaBack = NaN
    for (let d = 0; d <= 150; d += 1) {
      e.setDistance(d)
      const [l, ku, ka] = e.bandFades()
      expect(l.status).toBe('ok')
      if (Number.isNaN(kuBack) && ku.status !== 'lost') kuBack = e.routePoint.altitudeFt
      if (Number.isNaN(kaBack) && ka.status !== 'lost') kaBack = e.routePoint.altitudeFt
    }
    expect(kuBack).toBeLessThan(kaBack)
    expect(kaBack).toBeLessThan(16_404)
  })

  it('makes a slow handover interrupt the link for longer', () => {
    const quick = new SatcomEngine({ constellation: 'leo' })
    const slow = new SatcomEngine({ constellation: 'leo' })
    slow.env.handoverTrouble = true
    const a = flyAll(quick, 1)
    const b = flyAll(slow, 1)
    expect(b.time.handover).toBeGreaterThan(a.time.handover * 10)
    expect(b.time.handover / slow.handovers).toBeCloseTo(HANDOVER_GAP_S.leo.trouble, 0)
  })

  it('freezes when the clock is paused', () => {
    const e = new SatcomEngine({ constellation: 'leo' })
    e.step(100)
    const before = { t: e.timeS, d: e.distanceNm, p: { ...e.satPos[0] } }
    e.step(0)
    expect(e.timeS).toBe(before.t)
    expect(e.distanceNm).toBe(before.d)
    expect(e.satPos[0]).toEqual(before.p)
  })
})
