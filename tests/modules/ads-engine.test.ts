import { describe, expect, it } from 'vitest'
import { distanceNm } from '@/core/geometry'
import { radioLineOfSightNm } from '@/core/propagation'
import {
  AdsbEngine,
  GHOST_ID,
  JAMMER,
  NO_ADSB_ID,
  REACQUIRE_S,
  RECEIVERS,
  SPOOFER,
  trackState,
  type AdsbMessage,
} from '@/modules/ads/engine'
import { AdscEngine, CLEARED_FL, OCEAN_RECEIVERS, OCEAN_ROUTE } from '@/modules/ads/oceanEngine'

function run(e: { step: (dt: number) => void }, seconds: number, dt = 1 / 30) {
  const n = Math.round(seconds / dt)
  for (let i = 0; i < n; i++) e.step(dt)
}

/** Count messages of each kind sent by one aircraft during `seconds`. */
function countMessages(e: AdsbEngine, id: string, seconds: number) {
  const seen = new Set<number>()
  const counts: Record<string, number> = {}
  const n = Math.round(seconds * 30)
  for (let i = 0; i < n; i++) {
    e.step(1 / 30)
    for (const m of e.messages.get(id) ?? []) {
      if (seen.has(m.seq)) continue
      seen.add(m.seq)
      counts[m.kind] = (counts[m.kind] ?? 0) + 1
    }
  }
  return counts
}

describe('ADS-B engine: broadcasting', () => {
  it('sends position and velocity about twice a second and identification about every 5 s, as valid DF17 messages', () => {
    const e = new AdsbEngine()
    const c = countMessages(e, 'CNS101', 60)
    expect(c.position).toBeGreaterThanOrEqual(110)
    expect(c.position).toBeLessThanOrEqual(130)
    expect(c.velocity).toBeGreaterThanOrEqual(110)
    expect(c.identification).toBeGreaterThanOrEqual(11)
    expect(c.identification).toBeLessThanOrEqual(13)
    for (const m of e.messages.get('CNS101')!) {
      expect(m.hex).toHaveLength(28)
      expect(m.decoded.crcOk).toBe(true)
      expect(m.decoded.df).toBe(17)
    }
  })

  it('the ground network decodes the broadcast positions to within a few tens of metres of the truth', () => {
    const e = new AdsbEngine()
    run(e, 20)
    for (const a of e.aircraft) {
      const tr = e.atc.tracks.get(a.address)!
      expect(tr, a.id).toBeDefined()
      expect(tr.callsign).toBe(a.callsign)
      expect(trackState(tr, e.timeS)).toBe('live')
      // A position is at most ~0.6 s old; allow for the distance flown since.
      const flown = (a.speedKt / 3600) * (e.timeS - tr.posS)
      expect(distanceNm(tr.pos!, a.pos) * 1852).toBeLessThan(40 + flown * 1852)
      expect(Math.abs(tr.altFt! - a.altitudeFt)).toBeLessThanOrEqual(25)
      expect(Math.abs(tr.gsKt! - a.speedKt)).toBeLessThan(2)
    }
  })

  it('needs radio line of sight: a low aircraft far from every receiver is not heard', () => {
    const e = new AdsbEngine()
    e.setAircraft('CNS404', { pos: { x: -160, y: 0 }, mode: { kind: 'heading' }, targetHeadingDeg: 270, headingDeg: 270 })
    for (const r of RECEIVERS) expect(distanceNm(r.pos, { x: -160, y: 0 })).toBeGreaterThan(radioLineOfSightNm(r.heightFt, 2500))
    run(e, 10)
    const a = e.getAircraft('CNS404')!
    expect(e.atc.tracks.get(a.address)).toBeUndefined()
    // It is still broadcasting: nobody hears it.
    expect((e.messages.get('CNS404') ?? []).every((m) => m.heardBy.length === 0)).toBe(true)
  })

  it('radar updates once per antenna turn, ADS-B about every half second', () => {
    const e = new AdsbEngine()
    e.radarPeriodS = 12
    run(e, 60)
    const a = e.getAircraft('CNS101')!
    const radar = e.radarPlots.get(a.address)!.filter((p) => p.t > e.timeS - 48)
    const adsb = e.atc.tracks.get(a.address)!.history.filter((h) => h.t > e.timeS - 48)
    expect(radar.length).toBeGreaterThanOrEqual(3)
    expect(radar.length).toBeLessThanOrEqual(5)
    expect(adsb.length).toBeGreaterThan(85)
    for (let i = 1; i < radar.length; i++) expect(radar[i].t - radar[i - 1].t).toBeCloseTo(12, 0)
  })
})

describe('ADS-B engine: ADS-B In', () => {
  it('the own ship sees the other aircraft, not itself', () => {
    const e = new AdsbEngine()
    e.ownId = 'CNS101'
    run(e, 10)
    const own = e.getAircraft('CNS101')!
    expect(e.air.tracks.has(own.address)).toBe(false)
    const others = e.aircraft.filter((a) => a.id !== 'CNS101' && distanceNm(a.pos, own.pos) < 80)
    for (const o of others) expect(e.air.tracks.has(o.address), o.id).toBe(true)
  })
})

describe('ADS-B engine: when things go wrong', () => {
  it('GNSS jamming: quality falls, then the position disappears from ADS-B, while the radar keeps seeing the aircraft', () => {
    const e = new AdsbEngine()
    e.env = { ...e.env, jamming: true }
    const a0 = e.getAircraft('CNS303')!
    // Degraded zone first.
    e.setAircraft('CNS303', { pos: { x: JAMMER.pos.x, y: JAMMER.pos.y + (JAMMER.degradeRadiusNm + JAMMER.denyRadiusNm) / 2 }, mode: { kind: 'heading' }, speedKt: 60, targetSpeedKt: 60 })
    run(e, 5)
    let a = e.getAircraft('CNS303')!
    expect(a.gnss.lost).toBe(false)
    expect(a.gnss.nacp).toBeLessThan(10)
    expect(a.gnss.nacp).toBeGreaterThanOrEqual(5)
    expect(a.gnss.nic).toBeLessThan(8)
    // Now inside the inner circle: GNSS lost, NIC and NACp 0, no position in the messages.
    e.setAircraft('CNS303', { pos: { x: JAMMER.pos.x + 3, y: JAMMER.pos.y } })
    run(e, 20)
    a = e.getAircraft('CNS303')!
    expect(a.gnss.lost).toBe(true)
    const recent = (e.messages.get('CNS303') ?? []).filter((m: AdsbMessage) => m.timeS > e.timeS - 3)
    expect(recent.some((m) => m.kind === 'no-position')).toBe(true)
    expect(recent.some((m) => m.kind === 'position' || m.kind === 'velocity')).toBe(false)
    const tr = e.atc.tracks.get(a0.address)!
    expect(tr.nic).toBe(0)
    expect(trackState(tr, e.timeS)).toBe('no-position')
    // The radar does not need GNSS.
    const r = e.lastRadar(a0.address)!
    expect(e.timeS - r.t).toBeLessThanOrEqual(e.radarPeriodS + 0.1)
    expect(distanceNm(r.pos, a.pos)).toBeLessThan(0.5)
  })

  it('after the jamming stops, the receiver needs time to get a fix again', () => {
    const e = new AdsbEngine()
    e.env = { ...e.env, jamming: true }
    e.setAircraft('CNS303', { pos: { ...JAMMER.pos }, mode: { kind: 'heading' }, speedKt: 60, targetSpeedKt: 60 })
    run(e, 3)
    expect(e.getAircraft('CNS303')!.gnss.lost).toBe(true)
    e.env = { ...e.env, jamming: false }
    run(e, REACQUIRE_S - 2)
    expect(e.getAircraft('CNS303')!.gnss.lost).toBe(true)
    run(e, 4)
    expect(e.getAircraft('CNS303')!.gnss.lost).toBe(false)
  })

  it('spoofing: a ghost appears on ADS-B, its signal comes from the ground spoofer, and the radar cannot confirm it', () => {
    const e = new AdsbEngine()
    e.env = { ...e.env, ghost: true }
    run(e, 20)
    const tr = e.atc.tracks.get(e.ghost.address)!
    expect(tr).toBeDefined()
    expect(tr.callsign).toBe(GHOST_ID)
    expect(distanceNm(tr.pos!, e.ghost.pos)).toBeLessThan(0.3)
    // The radio signal comes from the spoofer, far from the claimed position.
    const msgs = e.messages.get('spoofer')!
    expect(msgs.every((m) => distanceNm(m.txPos, SPOOFER.pos) < 1e-9)).toBe(true)
    expect(distanceNm(SPOOFER.pos, e.ghost.pos)).toBeGreaterThan(5)
    expect(e.lastRadar(e.ghost.address)).toBeUndefined()
    expect(e.crossCheck(tr)).toBe('unconfirmed')
    const real = e.atc.tracks.get(e.getAircraft('CNS101')!.address)!
    expect(e.crossCheck(real)).toBe('confirmed')
  })

  it('an aircraft without ADS-B Out is invisible to ADS-B (ground and cockpit) but still on radar', () => {
    const e = new AdsbEngine()
    e.env = { ...e.env, noAdsb: true }
    e.ownId = 'CNS101'
    run(e, 15)
    const a = e.getAircraft(NO_ADSB_ID)!
    expect(e.messages.get(NO_ADSB_ID)).toBeUndefined()
    expect(e.atc.tracks.has(a.address)).toBe(false)
    expect(e.air.tracks.has(a.address)).toBe(false)
    expect(e.lastRadar(a.address)).toBeDefined()
  })

  it('low position quality: NACp 6 and a noticeably larger, jittery error', () => {
    const errors = (low: boolean) => {
      const e = new AdsbEngine(5)
      e.env = { ...e.env, lowQuality: low }
      let sum = 0
      let n = 0
      for (let i = 0; i < 60 * 30; i++) {
        e.step(1 / 30)
        const a = e.getAircraft('CNS101')!
        const tr = e.atc.tracks.get(a.address)
        if (i > 300 && tr?.pos && e.timeS - tr.posS < 0.05) {
          sum += (distanceNm(tr.pos, a.pos) * 1852) ** 2
          n++
        }
      }
      return { rms: Math.sqrt(sum / n), nacp: e.getAircraft('CNS101')!.gnss.nacp }
    }
    const good = errors(false)
    const bad = errors(true)
    expect(good.nacp).toBe(10)
    expect(bad.nacp).toBe(6)
    expect(good.rms).toBeLessThan(15)
    expect(bad.rms).toBeGreaterThan(80)
    expect(bad.rms).toBeLessThan(0.3 * 1852)
  })
})

describe('ADS-C engine: the ocean crossing', () => {
  it('periodic reports arrive every interval, each some tens of seconds after it was sent', () => {
    const e = new AdscEngine()
    e.opts = { ...e.opts, contract: { ...e.opts.contract, periodicMin: 10, waypointEvent: false } }
    run(e, 45 * 60, 1)
    const periodic = e.received.filter((r) => r.kind === 'periodic')
    expect(periodic.length).toBeGreaterThanOrEqual(4)
    for (let i = 1; i < periodic.length; i++) expect(periodic[i].sentS - periodic[i - 1].sentS).toBeCloseTo(600, 0)
    for (const r of periodic) {
      const delay = r.receivedS - r.sentS
      expect(delay).toBeGreaterThan(20)
      expect(delay).toBeLessThan(81)
    }
  })

  it('sends a waypoint event report when it passes a waypoint', () => {
    const e = new AdscEngine()
    const d = distanceNm(e.aircraft.pos, OCEAN_ROUTE[0].pos)
    run(e, (d / 480) * 3600 + 120, 1)
    const wp = e.received.find((r) => r.event === 'waypoint-change')
    expect(wp).toBeDefined()
    expect(wp!.nextWaypoint).toBe(OCEAN_ROUTE[1].name)
    expect(distanceNm(wp!.pos, OCEAN_ROUTE[0].pos)).toBeLessThan(2)
  })

  it('ADS-B works near the coast, is lost over mid-ocean, and comes back with space-based ADS-B', () => {
    const e = new AdscEngine()
    run(e, 20, 0.5)
    expect(e.adsbLive()).toBe(true)
    // Put the aircraft in the middle of the ocean.
    e.placeAt({ x: 0, y: 48 }, 3)
    for (const r of OCEAN_RECEIVERS) expect(distanceNm(r.pos, e.aircraft.pos)).toBeGreaterThan(radioLineOfSightNm(r.heightFt, e.aircraft.altitudeFt))
    run(e, 30, 0.5)
    expect(e.adsbLive()).toBe(false)
    e.opts = { ...e.opts, spaceAdsb: true }
    run(e, 10, 0.5)
    expect(e.adsbLive()).toBe(true)
  })

  it('event contract: a climb triggers vertical-rate and altitude-range reports without waiting for the next periodic report', () => {
    const e = new AdscEngine()
    e.opts = { ...e.opts, contract: { ...e.opts.contract, periodicMin: 30, altitudeEvent: true, verticalRateEvent: true, waypointEvent: false } }
    run(e, 60, 1)
    e.setTargetAltitude((CLEARED_FL + 20) * 100)
    run(e, 5 * 60, 1)
    const kinds = e.received.filter((r) => r.kind === 'event').map((r) => r.event)
    expect(kinds).toContain('vertical-rate')
    expect(kinds).toContain('altitude-range')
    const alt = e.received.find((r) => r.event === 'altitude-range')!
    expect(alt.altitudeFt).toBeGreaterThan(CLEARED_FL * 100 + 300)
    expect(alt.altitudeFt).toBeLessThan(CLEARED_FL * 100 + 400)
  })

  it('event contract: an offset from the route triggers a lateral deviation report', () => {
    const e = new AdscEngine()
    e.opts = { ...e.opts, contract: { ...e.opts.contract, lateralEvent: true, waypointEvent: false } }
    run(e, 60, 1)
    e.applyOffset(true)
    run(e, 20 * 60, 1)
    const lat = e.received.find((r) => r.event === 'lateral-deviation')
    expect(lat).toBeDefined()
    expect(Math.abs(e.crossTrackNm())).toBeGreaterThan(5)
  })

  it('a demand report is sent at once and delivered after the network delay', () => {
    const e = new AdscEngine()
    run(e, 30, 1)
    e.sendReport('demand')
    expect(e.inTransit.some((r) => r.kind === 'demand')).toBe(true)
    run(e, 90, 1)
    expect(e.received.some((r) => r.kind === 'demand')).toBe(true)
  })
})
