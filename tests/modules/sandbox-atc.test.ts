import { describe, expect, it } from 'vitest'
import { commMedium, controllingUnit, OCEANIC_CHANNELS, PHASE_UNIT, RADIO_SCRIPT, spokenFreq, UNITS, type AtcUnit } from '@/pages/Sandbox/atc'
import { SandboxEngine } from '@/pages/Sandbox/engine'
import { FLIGHT_PHASES, TICK_S } from '@/pages/Sandbox/journey'
import { EVENT_ORDER, getJourneyIndex, type JourneyEventKind } from '@/pages/Sandbox/phases'

const idx = getJourneyIndex()
const firstTick = (kind: JourneyEventKind) => idx.events.find((e) => e.kind === kind)!.tick
const ALL_ON = { vhf: true, cpdlc: true, satcom: true, hf: true }

function runUntil(e: SandboxEngine, done: () => boolean, maxS = 600) {
  for (let t = 0; t < maxS && !done(); t++) e.step(1)
}

describe('air traffic control units', () => {
  it('hand the flight over in the right order: delivery, ground, tower, departure, area, oceanic, area, approach, tower, ground', () => {
    const units = FLIGHT_PHASES.map(controllingUnit).filter((u, i, a) => i === 0 || u !== a[i - 1])
    expect(units).toEqual(['delivery', 'ground', 'tower', 'departure', 'area', 'oceanic', 'area', 'approach', 'tower', 'ground'])
  })

  it('use VHF frequencies in the aeronautical band on 25 kHz channels, and an HF frequency for the ocean', () => {
    for (const [id, u] of Object.entries(UNITS)) {
      if (u.vhfMHz === null) {
        expect(id).toBe('oceanic')
        expect(u.hfKHz!).toBeGreaterThanOrEqual(2850)
        expect(u.hfKHz!).toBeLessThanOrEqual(22000)
        continue
      }
      const f = Number(u.vhfMHz)
      expect(f).toBeGreaterThanOrEqual(118)
      expect(f).toBeLessThanOrEqual(136.975)
      expect(Math.abs(Math.round(f * 40) - f * 40)).toBeLessThan(1e-6)
      expect(f).not.toBe(121.5) // the emergency frequency
    }
    const vhf = Object.values(UNITS).map((u) => u.vhfMHz).filter(Boolean)
    expect(new Set(vhf).size).toBe(vhf.length)
  })

  it('speak frequencies without trailing zeros', () => {
    expect(spokenFreq('ground')).toBe('121.9')
    expect(spokenFreq('tower')).toBe('118.1')
    expect(spokenFreq('departure')).toBe('119.75')
    expect(spokenFreq('oceanic')).toBe('HF 8864')
  })
})

describe('radio script', () => {
  it('only has lines for real journey events, with delays in order', () => {
    for (const [kind, lines] of Object.entries(RADIO_SCRIPT)) {
      expect(EVENT_ORDER).toContain(kind)
      for (let i = 0; i < lines!.length; i++) {
        expect(lines![i].delayS).toBeGreaterThanOrEqual(0)
        if (i > 0) expect(lines![i].delayS).toBeGreaterThanOrEqual(lines![i - 1].delayS)
      }
    }
  })

  it('the oceanic unit only talks by CPDLC or HF', () => {
    for (const lines of Object.values(RADIO_SCRIPT)) for (const l of lines!) if (l.unit === 'oceanic') expect(OCEANIC_CHANNELS).toContain(l.channel)
  })

  it('every "contact" instruction names the next unit and its real frequency', () => {
    for (const lines of Object.values(RADIO_SCRIPT)) {
      for (const l of lines!) {
        const m = /contact (Ground|Tower|Departure|Approach|CNS Lab Control) (\d+(?:\.\d+)?)/.exec(l.text)
        if (!m) continue
        const unit: AtcUnit = m[1] === 'CNS Lab Control' ? 'area' : (m[1].toLowerCase() as AtcUnit)
        expect(m[2]).toBe(spokenFreq(unit))
      }
    }
  })

  it('is unchanged (snapshot)', () => {
    expect(RADIO_SCRIPT).toMatchSnapshot()
  })
})

describe('which link a message uses', () => {
  it('voice goes by VHF when it works', () => {
    expect(commMedium('voice', 'tower', ALL_ON)).toEqual({ medium: 'vhf', status: 'sent' })
  })
  it('without VHF, airport units cannot talk, radar units fall back to CPDLC over satellite', () => {
    const noVhf = { ...ALL_ON, vhf: false }
    for (const u of ['delivery', 'ground', 'tower'] as const) expect(commMedium('voice', u, noVhf)).toEqual({ medium: 'none', status: 'blocked' })
    for (const u of ['departure', 'area', 'approach'] as const) expect(commMedium('voice', u, noVhf)).toEqual({ medium: 'cpdlcSat', status: 'fallback' })
    expect(commMedium('voice', 'approach', { ...noVhf, cpdlc: false })).toEqual({ medium: 'none', status: 'blocked' })
  })
  it('oceanic CPDLC goes by satellite, falling back to HF', () => {
    expect(commMedium('datalink', 'oceanic', ALL_ON)).toEqual({ medium: 'cpdlcSat', status: 'sent' })
    expect(commMedium('datalink', 'oceanic', { ...ALL_ON, cpdlc: false })).toEqual({ medium: 'hf', status: 'fallback' })
    expect(commMedium('hf', 'oceanic', { ...ALL_ON, hf: false })).toEqual({ medium: 'cpdlcSat', status: 'fallback' })
    expect(commMedium('hf', 'oceanic', { vhf: false, cpdlc: false, satcom: false, hf: false })).toEqual({ medium: 'none', status: 'blocked' })
  })
  it('notes are always shown', () => {
    expect(commMedium('note', 'ground', { vhf: false, cpdlc: false, satcom: false, hf: false })).toEqual({ medium: 'none', status: 'sent' })
  })
})

describe('radio traffic in the engine', () => {
  it('the tower clears CNS700 for take-off by VHF', () => {
    const e = new SandboxEngine()
    e.jumpToTick(firstTick('takeoffClearance') - Math.round(5 / TICK_S))
    runUntil(e, () => e.radio.some((m) => /cleared for take-off/.test(m.text) && m.from === 'atc'))
    const m = e.radio.find((x) => /cleared for take-off/.test(x.text) && x.from === 'atc')!
    expect(m.unit).toBe('tower')
    expect(m.medium).toBe('vhf')
    expect(m.status).toBe('sent')
    expect(m.earlier).toBeUndefined()
  })

  it('with the VHF transmitters failed, the take-off clearance cannot be sent until the standby is selected', () => {
    const e = new SandboxEngine()
    e.setScenario('vhfFail')
    e.jumpToTick(firstTick('lineUp') - Math.round(5 / TICK_S))
    runUntil(e, () => e.radio.some((m) => /line up and wait/.test(m.text)))
    expect(e.radio.find((m) => /line up and wait/.test(m.text))!.status).toBe('blocked')
    e.selectVhfStandby()
    runUntil(e, () => e.radio.some((m) => /cleared for take-off/.test(m.text) && m.from === 'atc'))
    const m = e.radio.find((x) => /cleared for take-off/.test(x.text) && x.from === 'atc')!
    expect(m).toMatchObject({ medium: 'vhf', status: 'sent' })
  })

  it('over the ocean, messages travel by CPDLC over satellite or by HF', () => {
    const e = new SandboxEngine()
    e.jumpToTick(firstTick('oceanEntry') - Math.round(10 / TICK_S))
    runUntil(e, () => e.radio.some((m) => m.text === 'WILCO'), 200)
    const oceanic = e.radio.filter((m) => m.unit === 'oceanic' && m.from !== 'note')
    expect(oceanic.length).toBeGreaterThan(0)
    for (const m of oceanic) expect(['cpdlcSat', 'hf']).toContain(m.medium)
  })

  it('after a jump, recent lines are shown as context and no stale lines arrive later', () => {
    const e = new SandboxEngine()
    e.jumpToTick(firstTick('toTower') + Math.round(20 / TICK_S))
    expect(e.radio.length).toBeGreaterThan(0)
    expect(e.radio.every((m) => m.earlier)).toBe(true)
    expect(e.radio[0].text).toMatch(/cleared to land/i)
    e.jumpToPhase('gate')
    expect(e.radio).toEqual([])
    for (let t = 0; t < 30; t++) e.step(1)
    expect(e.radio.some((m) => /cleared to land/.test(m.text))).toBe(false)
  })

  it('every phase has a unit, and the engine reports it', () => {
    const e = new SandboxEngine()
    for (const p of FLIGHT_PHASES) {
      e.jumpToPhase(p)
      expect(e.unit).toBe(PHASE_UNIT[p])
    }
  })
})
