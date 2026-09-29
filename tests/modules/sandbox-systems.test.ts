import { describe, expect, it } from 'vitest'
import { SandboxEngine } from '@/pages/Sandbox/engine'
import { FLIGHT_PHASES } from '@/pages/Sandbox/journey'
import { STOP_EVENTS } from '@/pages/Sandbox/director'
import { STOP_STORY, STORY } from '@/pages/Sandbox/narration'
import { getJourneyIndex, isOnGround, transponderOn } from '@/pages/Sandbox/phases'
import { systemsNow, type SysRow } from '@/pages/Sandbox/systemsNow'
import { MODULE_BY_ID } from '@/modules/registry'

function rowsFor(e: SandboxEngine): Map<string, SysRow> {
  const a = e.journeyAircraft!
  const rows = systemsNow({
    phase: e.phase,
    av: e.availabilityFor(a),
    sources: e.sources('CNS700'),
    up: (id) => e.systemUp(id),
    transponderOn: transponderOn(a),
    onGround: isOnGround(a),
    onIls: a.journey!.phase === 'final',
  })
  return new Map(rows.map((r) => [r.id, r]))
}

function at(phase: (typeof FLIGHT_PHASES)[number], settleS = 40, setup?: (e: SandboxEngine) => void) {
  const e = new SandboxEngine()
  setup?.(e)
  e.jumpToPhase(phase)
  for (let t = 0; t < settleS; t++) e.step(1)
  return rowsFor(e)
}

describe('narration', () => {
  it('tells every phase and every guided stop', () => {
    for (const p of FLIGHT_PHASES) {
      const s = STORY[p]
      expect(s.summary.length).toBeGreaterThan(10)
      expect(s.c && s.n && s.s).toBeTruthy()
      expect(s.body).toBeTruthy()
    }
    for (const k of STOP_EVENTS) expect(STOP_STORY[k]?.title).toBeTruthy()
  })
})

describe('systems in use now', () => {
  it('lists every system once, linking to a real module', () => {
    const rows = [...at('departure', 5).values()]
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length)
    expect(rows.length).toBe(14)
    for (const r of rows) expect(MODULE_BY_ID.has(r.moduleId), r.id).toBe(true)
    for (const p of ['communication', 'navigation', 'surveillance']) expect(rows.some((r) => r.pillar === p)).toBe(true)
  })

  it('at the gate: VHF and the surface radar; the transponder systems wait', () => {
    const r = at('gate', 60)
    expect(r.get('vhf')!.state).toBe('inUse')
    expect(r.get('smr')!.state).toBe('inUse')
    for (const id of ['ssr', 'adsb', 'mlat']) expect(r.get(id)!.state).toBe('standby')
  })

  it('climbing out: radar, ADS-B and multilateration all see it', () => {
    const r = at('departure', 30)
    for (const id of ['ssr', 'adsb', 'mlat', 'gnss', 'vhf']) expect(r.get(id)!.state, id).toBe('inUse')
    expect(r.get('smr')!.state).toBe('standby')
    expect(r.get('adsc')!.state).toBe('unavailable')
  })

  it('far over the ocean: only ADS-C, CPDLC and SATCOM', () => {
    const e = new SandboxEngine()
    e.jumpToTick(getJourneyIndex().samples.find((s) => s.pos.x > 330)!.tick)
    for (let t = 0; t < 60; t++) e.step(1)
    const r = rowsFor(e)
    for (const id of ['adsc', 'cpdlc', 'satcom']) expect(r.get(id)!.state, id).toBe('inUse')
    for (const id of ['vhf', 'ssr', 'adsb', 'mlat', 'psr']) expect(r.get(id)!.state, id).toBe('unavailable')
    expect(r.get('hf')!.state).toBe('standby')
  })

  it('on the final approach the ILS is in use', () => {
    const r = at('landing', 10)
    expect(r.get('ils')!.state).toBe('inUse')
  })

  it('failures show up as failed, and back-ups step in', () => {
    const jam = at('departure', 30, (e) => e.setScenario('gnssJam'))
    expect(jam.get('gnss')!.state).toBe('unavailable')
    expect(jam.get('vordme')!.state).toBe('inUse')
    expect(jam.get('adsb')!.state).toBe('unavailable')
    const vhf = at('departure', 5, (e) => e.setScenario('vhfFail'))
    expect(vhf.get('vhf')!.state).toBe('failed')
    const radar = at('departure', 30, (e) => e.setScenario('radarOutage'))
    expect(radar.get('ssr')!.state).toBe('failed')
    expect(radar.get('psr')!.state).toBe('failed')
    expect(radar.get('adsb')!.state).toBe('inUse')
  })
})
