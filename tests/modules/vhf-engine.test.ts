import { describe, expect, it } from 'vitest'
import { minHeightForLineOfSightFt, radioLineOfSightNm } from '@/core/propagation'
import { adjacentMHz, clearOfTerrain, MOUNTAIN, SITE, TERRAIN_CLEARANCE_FT, VhfEngine, type Transmission } from '@/modules/vhf/engine'

const DT = 1 / 30

function run(e: VhfEngine, seconds: number) {
  const n = Math.round(seconds / DT)
  for (let i = 0; i < n; i++) e.step(DT)
}

function runUntil(e: VhfEngine, pred: () => boolean, maxS = 60) {
  const n = Math.round(maxS / DT)
  for (let i = 0; i < n && !pred(); i++) e.step(DT)
  return pred()
}

const lastBy = (e: VhfEngine, who: Transmission['who']) => [...e.transmissions].reverse().find((x) => x.who === who)

describe('VHF engine: contact and the radio horizon', () => {
  it('loses contact exactly at minHeightForLineOfSightFt for the distance', () => {
    const e = new VhfEngine()
    e.params = { ...e.params, distanceNm: 180 }
    const floor = e.contactFloorFt()
    expect(floor).toBe(minHeightForLineOfSightFt(SITE.antennaFt, 180))
    e.params = { ...e.params, altitudeFt: floor + 1 }
    expect(e.learnerInContact()).toBe(true)
    e.params = { ...e.params, altitudeFt: floor - 1 }
    expect(e.learnerInContact()).toBe(false)
    // The range readout for an altitude uses the same rule.
    expect(radioLineOfSightNm(SITE.antennaFt, floor)).toBeCloseTo(180, 9)
  })

  it('a mountain in between cuts contact until the aircraft climbs above its shadow', () => {
    const e = new VhfEngine()
    e.params = { ...e.params, distanceNm: 120, altitudeFt: 10000 }
    expect(e.learnerInContact()).toBe(true)
    e.setFailure('mountain', true)
    expect(e.learnerInContact()).toBe(false)
    const floor = e.contactFloorFt()
    expect(floor).toBeGreaterThan(10000)
    e.params = { ...e.params, altitudeFt: floor + 50 }
    expect(e.learnerInContact()).toBe(true)
  })

  it('an aircraft is never placed inside the mountain', () => {
    const e = new VhfEngine()
    e.params = { ...e.params, distanceNm: MOUNTAIN.centerNm, altitudeFt: 1000 }
    e.setFailure('mountain', true)
    expect(e.params.altitudeFt).toBeGreaterThanOrEqual(MOUNTAIN.peakFt + TERRAIN_CLEARANCE_FT)
    const p = clearOfTerrain({ ...e.params, altitudeFt: 500 }, true)
    expect(p.altitudeFt).toBeGreaterThanOrEqual(MOUNTAIN.peakFt + TERRAIN_CLEARANCE_FT)
    expect(clearOfTerrain({ ...e.params, distanceNm: 200, altitudeFt: 500 }, true).altitudeFt).toBe(500)
  })

  it('the signal gets weaker with distance (free-space loss)', () => {
    const e = new VhfEngine()
    e.params = { ...e.params, distanceNm: 40, altitudeFt: 30000 }
    const near = e.levelAt('controller', 'CNS101')
    e.params = { ...e.params, distanceNm: 160 }
    const far = e.levelAt('controller', 'CNS101')
    expect(near - far).toBeGreaterThan(10)
    expect(near - far).toBeLessThan(13)
  })
})

describe('VHF engine: press to talk', () => {
  it('a clear call is heard by the controller, who answers "roger"', () => {
    const e = new VhfEngine()
    e.pressTalk()
    run(e, 2)
    e.releaseTalk()
    const mine = lastBy(e, 'CNS101')!
    expect(mine.outcome.ground).toBe('heard')
    expect(runUntil(e, () => lastBy(e, 'controller')?.text.includes('roger') ?? false, 10)).toBe(true)
    const reply = lastBy(e, 'controller')!
    run(e, 3)
    expect(reply.outcome.CNS101).toBe('heard')
  })

  it('the other pilot waits while it hears you talking (listen before talk)', () => {
    const e = new VhfEngine()
    e.pressTalk()
    run(e, 1)
    e.scheduleCns202(0.5)
    run(e, 3)
    expect(e.isTransmitting('CNS202')).toBe(false)
    e.releaseTalk()
    expect(runUntil(e, () => e.isTransmitting('CNS202'), 20)).toBe(true)
  })

  it('talking at the same moment as the other pilot blocks both: the controller asks to say again', () => {
    const e = new VhfEngine()
    e.scheduleCns202(3)
    run(e, 2.9)
    e.pressTalk()
    run(e, 2.2)
    e.releaseTalk()
    const mine = lastBy(e, 'CNS101')!
    const other = lastBy(e, 'CNS202')!
    expect(other.start).toBeGreaterThan(mine.start)
    expect(mine.outcome.ground).toBe('blocked')
    run(e, 3)
    expect(other.outcome.ground).toBe('blocked')
    expect(runUntil(e, () => /blocked/i.test(lastBy(e, 'controller')?.text ?? ''), 10)).toBe(true)
  })

  it('out of line of sight nobody hears you and you hear nobody', () => {
    const e = new VhfEngine()
    e.params = { ...e.params, distanceNm: 200, altitudeFt: minHeightForLineOfSightFt(SITE.antennaFt, 200) - 200 }
    e.pressTalk()
    run(e, 2)
    e.releaseTalk()
    expect(lastBy(e, 'CNS101')!.outcome.ground).toBe('not-heard')
    run(e, 30)
    const calls = e.transmissions.filter((x) => x.who === 'controller')
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.every((x) => x.outcome.CNS101 === undefined || x.outcome.CNS101 === 'not-heard')).toBe(true)
    expect(calls.some((x) => x.text.includes('roger'))).toBe(false)
  })
})

describe('VHF engine: squelch', () => {
  it('too low gives constant hiss, too high cuts out a distant station', () => {
    const e = new VhfEngine()
    e.params = { ...e.params, squelchDbm: -125 }
    expect(e.learnerView().rx.state).toBe('hiss')
    e.params = { ...e.params, squelchDbm: -105 }
    expect(e.learnerView().rx.state).toBe('muted')
    // A controller call from 200 NM away: clear with a normal squelch, silent with a very high one.
    e.params = { ...e.params, distanceNm: 200, altitudeFt: 36000 }
    expect(runUntil(e, () => e.isTransmitting('controller'), 10)).toBe(true)
    run(e, 0.2)
    expect(e.learnerView().rx.state).toBe('clear')
    e.params = { ...e.params, squelchDbm: -80 }
    expect(e.learnerView().rx.state).toBe('muted')
    // ...but a nearby aircraft would still open it.
    e.params = { ...e.params, distanceNm: 20, altitudeFt: 10000 }
    expect(e.learnerView().rx.state).toBe('clear')
  })
})

describe('VHF engine: failures', () => {
  it('a stuck microphone blocks the frequency until the controller moves traffic to the backup', () => {
    const e = new VhfEngine()
    e.setFailure('stuckMic', true)
    run(e, 3)
    // Everything on 128.600 collides with the open carrier.
    e.pressTalk()
    run(e, 1.5)
    e.releaseTalk()
    expect(lastBy(e, 'CNS101')!.outcome.ground).toBe('blocked')
    expect(runUntil(e, () => e.sectorFreq === 'backup', 20)).toBe(true)
    expect(runUntil(e, () => e.cpdlc !== null, 5)).toBe(true)
    expect(e.cpdlc!.text).toContain('124.350')
    const announce = e.transmissions.find((x) => x.who === 'controller' && x.text.includes('124.350'))!
    expect(announce.freqs).toEqual(['guard', 'backup'])
    // The pilot hears the announcement on 121.5 over the open microphone on 128.600.
    run(e, 0.5)
    expect(e.learnerView().freq).toBe('guard')
    expect(e.learnerView().tx?.id).toBe(announce.id)
    run(e, 7)
    // Heard on the second radio, which listens to 121.5.
    expect(announce.outcome.CNS101).toBe('heard')
    // On the backup frequency the learner gets through again.
    e.params = { ...e.params, com1: 'backup' }
    runUntil(e, () => !e.isTransmitting('controller') && !e.isTransmitting('CNS202'), 20)
    run(e, 1)
    e.pressTalk()
    run(e, 2)
    e.releaseTalk()
    expect(lastBy(e, 'CNS101')!.outcome.ground).toBe('heard')
    expect(runUntil(e, () => lastBy(e, 'controller')?.text.includes('roger') ?? false, 10)).toBe(true)
  })

  it('a failed main transmitter sends nothing until the controller changes to standby', () => {
    const e = new VhfEngine()
    e.setFailure('txFailure', true)
    expect(runUntil(e, () => e.isTransmitting('controller'), 10)).toBe(true)
    const dead = lastBy(e, 'controller')!
    expect(dead.radiated).toBe(false)
    run(e, 0.3)
    expect(e.learnerView().rx.state).toBe('muted')
    runUntil(e, () => !e.isTransmitting('controller'), 10)
    e.setVccs({ ...e.vccs, transmitter: 'standby' })
    expect(runUntil(e, () => e.isTransmitting('controller'), 30)).toBe(true)
    const live = lastBy(e, 'controller')!
    expect(live.radiated).toBe(true)
    run(e, 0.3)
    expect(e.learnerView().rx.state).toBe('clear')
  })

  it('a strong aircraft on the next channel leaks in with 8.33 kHz spacing, not with 25 kHz', () => {
    const e = new VhfEngine()
    e.params = { ...e.params, distanceNm: 200, altitudeFt: 36000, spacing: '8.33' }
    e.setFailure('interference', true)
    expect(adjacentMHz('8.33') - 128.6).toBeCloseTo(0.025 / 3, 9)
    expect(adjacentMHz('25') - 128.6).toBeCloseTo(0.025, 9)
    expect(runUntil(e, () => e.isTransmitting('CNS707') && !e.isTransmitting('controller'), 20)).toBe(true)
    expect(e.learnerView().rx.state).toBe('bleed')
    e.params = { ...e.params, spacing: '25' }
    expect(e.learnerView().rx.state).toBe('muted')
    // A weak wanted station under the leak is unreadable with 8.33 kHz.
    e.params = { ...e.params, spacing: '8.33' }
    expect(runUntil(e, () => e.isTransmitting('CNS707') && e.isTransmitting('controller'), 120)).toBe(true)
    expect(e.learnerView().rx.state).toBe('garbled')
    e.params = { ...e.params, spacing: '25' }
    expect(e.learnerView().rx.state).toBe('clear')
  })

  it('the emergency key calls on 121.5, heard on the guard receiver', () => {
    const e = new VhfEngine()
    e.emergencyCall()
    run(e, 0.2)
    const g = lastBy(e, 'controller')!
    expect(g.freqs).toEqual(['guard'])
    run(e, 1)
    expect(e.learnerView().freq).toBe('guard')
    expect(e.learnerView().rx.state).toBe('clear')
  })
})
