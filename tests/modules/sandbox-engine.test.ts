import { describe, expect, it } from 'vitest'
import { distanceNm } from '@/core/geometry'
import { trackStatus } from '@/core/fusion'
import { LAB_AIRPORT, terrainElevationFt } from '@/core/world'
import { SandboxEngine, simulateJourney, stepJourney, createJourneyAircraft } from '@/pages/Sandbox/engine'
import { OCEANIC_BOUNDARY_X } from '@/pages/Sandbox/systems'
import { glidePathAltitudeFt, THRESHOLD } from '@/pages/Sandbox/journey'

function run(e: SandboxEngine, seconds: number, dt = 1) {
  for (let t = 0; t < seconds; t += dt) e.step(dt)
}

describe('journey', () => {
  const samples = simulateJourney(10)
  it('flies out over the ocean, comes back and lands on runway 09', () => {
    const last = samples[samples.length - 1]
    expect(last.stage).toBe('Landed')
    const rwy = LAB_AIRPORT.runways[0]
    expect(last.pos.x).toBeGreaterThan(rwy.threshold.x)
    expect(last.pos.x).toBeLessThan(rwy.end.x)
    expect(Math.abs(last.pos.y)).toBeLessThan(0.05)
    expect(samples.some((s) => s.pos.x > OCEANIC_BOUNDARY_X + 100)).toBe(true)
    expect(samples.some((s) => s.altitudeFt > 34900)).toBe(true)
    // About 1.5 hours door to door.
    expect(last.t).toBeGreaterThan(60 * 60)
    expect(last.t).toBeLessThan(2.5 * 3600)
  })
  it('never gets closer than 900 ft to the terrain before the final approach', () => {
    for (const s of samples) {
      // Departing and landing aircraft are meant to be low near the airport.
      if (s.stage === 'Landing' || s.stage === 'Landed' || (s.stage === 'Approach' && s.pos.x > THRESHOLD.x - 12)) continue
      if (s.stage === 'Departure' && distanceNm(s.pos, THRESHOLD) < 8) continue
      expect(s.altitudeFt - terrainElevationFt(s.pos)).toBeGreaterThan(900)
    }
  })
  it('follows the 3° glide path within 150 ft on the last 8 NM', () => {
    let a = createJourneyAircraft()
    let checked = 0
    for (let t = 0; t < 3 * 3600 && a.journey!.phase !== 'landed'; t++) {
      a = stepJourney(a, 1)
      const toGo = THRESHOLD.x - a.pos.x
      if (a.journey!.phase === 'final' && toGo < 8 && toGo > 0.5) {
        expect(Math.abs(a.altitudeFt - glidePathAltitudeFt(a.pos.x))).toBeLessThan(150)
        expect(Math.abs(a.pos.y)).toBeLessThan(0.1)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(100)
  })
})

describe('surveillance and fusion', () => {
  it('builds a labelled, multi-source track for CNS700 near the airport', () => {
    const e = new SandboxEngine()
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
    const e = new SandboxEngine()
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
    const e = new SandboxEngine()
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
    const e = new SandboxEngine()
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
    const e = new SandboxEngine()
    const a = e.getAircraft('CNS700')!
    e.setAircraft('CNS700', { journey: { ...a.journey!, legIndex: 3 }, pos: { x: 340, y: 8 }, altitudeFt: 35000, targetAltitudeFt: 35000, speedKt: 460, targetSpeedKt: 460 })
    run(e, 60)
    expect(e.sources('CNS700')).toEqual(['adsc'])
    const e2 = new SandboxEngine()
    const b = e2.getAircraft('CNS700')!
    e2.systems.adsc = false
    e2.setAircraft('CNS700', { journey: { ...b.journey!, legIndex: 3 }, pos: { x: 340, y: 8 }, altitudeFt: 35000, targetAltitudeFt: 35000, speedKt: 460, targetSpeedKt: 460 })
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
    const e = new SandboxEngine()
    const a = e.getAircraft('CNS700')!
    e.setAircraft('CNS700', { journey: { ...a.journey!, phase: 'final' }, pos: { x: THRESHOLD.x - 4, y: 0 }, altitudeFt: glidePathAltitudeFt(THRESHOLD.x - 4), headingDeg: 90, speedKt: 140, targetSpeedKt: 140 })
    for (let t = 0; t < 60; t++) {
      e.step(1)
      expect(e.alerts.some((al) => al.kind === 'MSAW' && al.ids.includes('CNS700'))).toBe(false)
    }
    expect(distanceNm(e.getAircraft('CNS700')!.pos, THRESHOLD)).toBeLessThan(4)
  })
})
