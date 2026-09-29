import { describe, expect, it } from 'vitest'
import { distanceNm } from '@/core/geometry'
import { trackStatus } from '@/core/fusion'
import { LAB_AIRPORT, terrainElevationFt } from '@/core/world'
import { SandboxEngine } from '@/pages/Sandbox/engine'
import { OCEANIC_BOUNDARY_X } from '@/pages/Sandbox/systems'
import { glidePathAltitudeFt, THRESHOLD, TICK_S } from '@/pages/Sandbox/journey'
import { createJourneyAircraft, getJourneyIndex, stepJourneyTick } from '@/pages/Sandbox/phases'

function run(e: SandboxEngine, seconds: number, dt = 1) {
  for (let t = 0; t < seconds; t += dt) e.step(dt)
}

/** An engine with CNS700 already airborne, a little after take-off (as these tests assumed before the gate was added). */
function airborne() {
  const e = new SandboxEngine()
  e.jumpToPhase('departure')
  return e
}

/** An engine with CNS700 at the first point of its journey that satisfies a test. */
function at(test: (s: { pos: { x: number; y: number }; altitudeFt: number; phase: string }) => boolean) {
  const e = new SandboxEngine()
  const s = getJourneyIndex().samples.find(test)!
  e.jumpToTick(s.tick)
  return e
}

describe('journey', () => {
  const idx = getJourneyIndex()
  const samples = idx.samples
  it('flies out over the ocean, comes back, lands on runway 09 and parks', () => {
    const last = samples[samples.length - 1]
    expect(last.phase).toBe('arrived')
    expect(samples.some((s) => s.pos.x > OCEANIC_BOUNDARY_X + 100)).toBe(true)
    expect(samples.some((s) => s.altitudeFt > 34900)).toBe(true)
    // About 2.5 hours gate to gate (boarding and deboarding shortened).
    const t = idx.totalTicks * TICK_S
    expect(t).toBeGreaterThan(60 * 60)
    expect(t).toBeLessThan(3 * 3600)
  })
  it('never gets closer than 900 ft to the terrain away from the airport', () => {
    for (const s of samples) {
      // On the ground, and departing or landing near the airport, the aircraft is low by design.
      if (['gate', 'pushback', 'taxi', 'takeoff', 'landing', 'taxiIn', 'arrived'].includes(s.phase)) continue
      if (s.phase === 'approach' && s.pos.x > THRESHOLD.x - 12 && Math.abs(s.pos.y) < 8) continue
      if (s.phase === 'departure' && distanceNm(s.pos, THRESHOLD) < 8) continue
      expect(s.altitudeFt - terrainElevationFt(s.pos)).toBeGreaterThan(900)
    }
  })
  it('follows the 3° glide path within 150 ft on the last 8 NM', () => {
    let a = createJourneyAircraft()
    let checked = 0
    while (a.journey!.phase !== 'rollout') {
      a = stepJourneyTick(a)
      const toGo = THRESHOLD.x - a.pos.x
      if (a.journey!.phase === 'final' && toGo < 8 && toGo > 0.5) {
        expect(Math.abs(a.altitudeFt - glidePathAltitudeFt(a.pos.x))).toBeLessThan(150)
        expect(Math.abs(a.pos.y)).toBeLessThan(0.1)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(1000)
    const rwy = LAB_AIRPORT.runways[0]
    expect(a.pos.x).toBeGreaterThan(rwy.threshold.x)
    expect(a.pos.x).toBeLessThan(rwy.end.x)
  })
})

describe('surveillance and fusion', () => {
  it('builds a labelled, multi-source track for CNS700 near the airport', () => {
    const e = airborne()
    run(e, 30)
    const t = e.tracks.get('CNS700')!
    expect(t).toBeDefined()
    expect(t.callsign).toBe('CNS700')
    const src = e.sources('CNS700')
    expect(src).toContain('ssr')
    expect(src).toContain('adsb')
    expect(src).toContain('mlat')
  })
  it('radar outage: tracks continue on ADS-B and WAM; the Mode C aircraft continues on WAM only', () => {
    const e = airborne()
    run(e, 20)
    e.setScenario('radarOutage')
    run(e, 40)
    expect(trackStatus(e.tracks.get('CNS700')!, e.timeS)).toBe('live')
    const vfr = e.sources('CNS844')
    expect(vfr).toContain('mlat')
    expect(vfr).not.toContain('ssr')
    // The aircraft with no transponder at all is only seen by primary radar: it coasts, then is lost.
    expect(trackStatus(e.tracks.get('UNK1')!, e.timeS)).toBe('coast')
    run(e, 40)
    expect(e.tracks.get('UNK1')).toBeUndefined()
  })
  it('GNSS jamming: ADS-B stops near the airport, radar and WAM continue', () => {
    const e = airborne()
    e.setScenario('gnssJam')
    run(e, 40)
    const src = e.sources('CNS700')
    expect(src).not.toContain('adsb')
    expect(src).toContain('ssr')
    expect(src).toContain('mlat')
    const av = e.availabilityFor(e.getAircraft('CNS700')!)
    expect(av.gnss).toBe(false)
    expect(av.vordme).toBe(true)
  })
  it('switching off every surveillance system makes the tracks coast and then vanish', () => {
    const e = airborne()
    run(e, 20)
    for (const id of ['radarApp', 'radarEnr', 'adsb', 'mlat', 'adsc', 'sbadsb'] as const) e.systems[id] = false
    run(e, 20)
    expect(trackStatus(e.tracks.get('CNS700')!, e.timeS)).toBe('coast')
    run(e, 60)
    expect(e.tracks.get('CNS700')).toBeUndefined()
    // Only the oceanic aircraft remains, carried by its last ADS-C report until the next one is due.
    expect([...e.tracks.keys()]).toEqual(['CNS855'])
  })
  it('over the ocean only ADS-C (via SATCOM) keeps the track, with a delay', () => {
    const farOut = (s: { pos: { x: number } }) => s.pos.x > 330
    const e = at(farOut)
    run(e, 60)
    expect(e.sources('CNS700')).toEqual(['adsc'])
    const e2 = at(farOut)
    e2.systems.adsc = false
    run(e2, 60)
    expect(e2.tracks.get('CNS700')).toBeUndefined()
  })
})

describe('safety nets', () => {
  it('STCA fires for the converging pair, and the climb instruction clears it', () => {
    const e = new SandboxEngine()
    e.spawnConflict()
    let fired = -1
    for (let t = 0; t < 120; t++) {
      e.step(1)
      if (fired < 0 && e.alerts.some((a) => a.kind === 'STCA' && a.ids.includes('CNS9A'))) fired = t
    }
    expect(fired).toBeGreaterThanOrEqual(0)
    expect(fired).toBeLessThan(60)
    e.resolveConflict()
    run(e, 60)
    expect(e.alerts.some((a) => a.kind === 'STCA' && a.ids.includes('CNS9A'))).toBe(false)
    const a = e.getAircraft('CNS9A')!
    const b = e.getAircraft('CNS9B')!
    expect(Math.abs(a.altitudeFt - b.altitudeFt)).toBeGreaterThanOrEqual(1000)
  })
  it('MSAW fires for the aircraft descending toward the North Range, and nobody hits the ground', () => {
    const e = new SandboxEngine()
    e.setScenario('mountain')
    let fired = false
    let minClear = Infinity
    for (let t = 0; t < 400; t++) {
      e.step(1)
      if (e.alerts.some((a) => a.kind === 'MSAW' && a.ids.includes('CNS9M'))) fired = true
      const m = e.getAircraft('CNS9M')
      if (m) minClear = Math.min(minClear, m.altitudeFt - terrainElevationFt(m.pos))
    }
    expect(fired).toBe(true)
    expect(minClear).toBeGreaterThan(0)
  })
  it('does not raise MSAW for CNS700 on the ILS final approach', () => {
    const e = at((s) => s.phase === 'landing' && s.pos.x > THRESHOLD.x - 4.2)
    expect(e.getAircraft('CNS700')!.journey!.phase).toBe('final')
    for (let t = 0; t < 60; t++) {
      e.step(1)
      expect(e.alerts.some((al) => al.kind === 'MSAW' && al.ids.includes('CNS700'))).toBe(false)
    }
    expect(distanceNm(e.getAircraft('CNS700')!.pos, THRESHOLD)).toBeLessThan(4)
  })
})
