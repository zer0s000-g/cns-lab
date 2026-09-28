import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { ELEVATION_MASK_DEG, errorBudget, predictedSigmaM, rms } from '@/core/gnss'
import {
  CLOCK_GUESS_RANGE_NS,
  CROSS_CHECK_LIMIT_M,
  FAULT_RAMP_M_PER_S,
  GnssEngine,
  MONITOR_TIME_TO_ALERT_S,
  SPOOF,
  TRUE_CLOCK_BIAS_M,
  pdopOf,
  type GnssEnv,
  type GnssSettings,
} from '@/modules/gnss/engine'
import { receiverWorld, toThree } from '@/modules/gnss/frames'
import { createGnssStore } from '@/modules/gnss/store'

function engineAt(t: number, settings: Partial<GnssSettings> = {}, env: Partial<GnssEnv> = {}) {
  const e = new GnssEngine()
  e.timeS = t
  e.settings = { ...e.settings, ...settings }
  e.env = { ...e.env, ...env }
  e.markDirty()
  e.update(true)
  return e
}

/** A store-driven engine, exactly like the page's "Set it up" buttons use it. */
function storeAt(t: number) {
  const e = engineAt(t)
  return { e, s: createGnssStore(e).getState }
}

function run(e: GnssEngine, seconds: number, dt = 1) {
  for (let k = 0; k < seconds / dt; k++) e.step(dt)
}

function trailScatter(e: GnssEngine) {
  const tr = e.trail
  const me = tr.reduce((a, p) => a + p.e, 0) / tr.length
  const mn = tr.reduce((a, p) => a + p.n, 0) / tr.length
  return Math.sqrt(tr.reduce((a, p) => a + (p.e - me) ** 2 + (p.n - mn) ** 2, 0) / tr.length)
}

const TIMES = Array.from({ length: 12 }, (_, i) => i * 7200 + 600)

describe('GNSS engine: one set of satellite states for every view', () => {
  it('tracks only satellites above the 5° mask', () => {
    for (const t of TIMES) {
      const e = engineAt(t)
      for (const s of e.sats) {
        if (s.status === 'ok') expect(s.elDeg).toBeGreaterThanOrEqual(ELEVATION_MASK_DEG)
        if (s.elDeg < 0) expect(s.status).toBe('below')
      }
      expect(e.result.nTracked).toBeGreaterThanOrEqual(7)
    }
  })

  it('satellites above the horizon on the sky plot are above the receiver horizon in the 3D view, and vice versa', () => {
    for (const t of [0, 5000, 20000, 43000]) {
      const e = engineAt(t)
      const rx = receiverWorld(e)
      const up = rx.clone().normalize()
      for (const s of e.sats) {
        if (Math.abs(s.elDeg) < 0.5) continue
        const d = toThree(s.eci).sub(rx).normalize()
        const el3d = (Math.asin(d.dot(up)) * 180) / Math.PI
        expect(Math.sign(el3d)).toBe(Math.sign(s.elDeg))
        // The 3D angle uses the geocentric "up", which differs from the geodetic one by a few hundredths of a degree here.
        expect(Math.abs(el3d - s.elDeg)).toBeLessThan(0.2)
      }
    }
  })

  it('the 3D view maps the north pole to +y and keeps distances to scale', () => {
    const p = toThree({ x: 0, y: 0, z: 6_378_137 })
    expect(p.y).toBeCloseTo(1, 9)
    const q = toThree({ x: 0, y: 6_378_137, z: 0 })
    expect(q.z).toBeCloseTo(-1, 9)
    // Proper rotation (no mirror): x × y = z is preserved.
    const X = toThree({ x: 1, y: 0, z: 0 })
    const Y = toThree({ x: 0, y: 1, z: 0 })
    const Z = toThree({ x: 0, y: 0, z: 1 })
    expect(new THREE.Vector3().crossVectors(X, Y).dot(Z)).toBeGreaterThan(0)
  })

  it('is deterministic for a given seed', () => {
    const a = engineAt(1234)
    const b = engineAt(1234)
    run(a, 30)
    run(b, 30)
    expect(a.result.enu).toEqual(b.result.enu)
  })
})

describe('GNSS engine: the normal position fix', () => {
  it('uses every satellite in view, lands within the 95% circle most of the time and works out the clock', () => {
    let inside = 0
    let n = 0
    for (const t of TIMES) {
      const e = engineAt(t)
      for (let k = 0; k < 20; k++) {
        e.step(15)
        const r = e.result
        expect(r.kind).toBe('fix')
        expect(r.usedIds.length).toBe(r.nTracked)
        expect(r.raim?.status).toBe('ok')
        expect(r.hErrM).toBeLessThan(25)
        expect(Math.abs(r.clockBiasM! - TRUE_CLOCK_BIAS_M)).toBeLessThan(40)
        if (r.hErrM <= r.h95M) inside++
        n++
      }
    }
    expect(inside / n).toBeGreaterThan(0.95)
  })

  it('the receiver clock is 0.35 ms fast, about 105 km of distance', () => {
    expect(TRUE_CLOCK_BIAS_M / 1000).toBeCloseTo(104.9, 1)
  })
})

describe('Try this 1: three satellites are not enough', () => {
  it('every clock guess gives an answer where all three spheres meet, on a line that is mostly vertical', () => {
    for (const t of TIMES) {
      const { e, s } = storeAt(t)
      s().applyPreset('spread3')
      s().setSetting('clockMode', 'guess')
      const answers = [-800, -400, 0, 400, 800].map((ns) => {
        s().setSetting('clockGuessNs', ns)
        e.update()
        expect(e.result.kind).toBe('three')
        expect(e.result.misfitM).toBeLessThan(0.01)
        return e.result.enu!
      })
      const c = e.result.curve!
      expect(c.length).toBe((2 * CLOCK_GUESS_RANGE_NS) / 50 + 1)
      const span = (k: 'x' | 'y' | 'z') => Math.max(...c.map((p) => p.enu[k])) - Math.min(...c.map((p) => p.enu[k]))
      expect(span('z')).toBeGreaterThan(Math.hypot(span('x'), span('y')))
      // Several hundred metres per microsecond.
      const moved = Math.hypot(answers[4].x - answers[0].x, answers[4].y - answers[0].y, answers[4].z - answers[0].z) / 1.6
      expect(moved).toBeGreaterThan(300)
      // Guessing right lands close to the truth.
      expect(Math.hypot(answers[2].x, answers[2].y, answers[2].z)).toBeLessThan(60)
    }
  })

  it('with a well-placed fourth satellite only a guess near 0 makes the spheres meet', () => {
    let good = 0
    let total = 0
    let grows = 0
    let all = 0
    for (const t of TIMES) {
      const { e, s } = storeAt(t)
      s().applyPreset('spread3')
      s().setSetting('clockMode', 'guess')
      const three = s().settings.selected
      for (const extra of e.sats.filter((x) => x.status === 'ok' && !three.includes(x.id))) {
        s().setSetting('selected', [...three, extra.id])
        const misfit = (ns: number) => {
          s().setSetting('clockGuessNs', ns)
          e.update()
          return e.result.misfitM
        }
        const m0 = misfit(0)
        const m400 = misfit(400)
        const m800 = misfit(800)
        all++
        if (m800 > m400 && m400 > m0) grows++
        if (e.result.dop!.pdop < 6) {
          total++
          if (m400 > 10 && m400 > 3 * m0) good++
        }
      }
    }
    expect(total).toBeGreaterThan(30)
    expect(good / total).toBeGreaterThan(0.9)
    expect(grows / all).toBeGreaterThan(0.9)
  })

  it('a badly placed fourth satellite cannot tell the clock from the position (huge DOP, misfit barely changes)', () => {
    const { e, s } = storeAt(0)
    s().setSetting('selectMode', 'manual')
    s().setSetting('selected', ['G01', 'G02', 'G06', 'G08'])
    s().setSetting('clockMode', 'guess')
    s().setSetting('clockGuessNs', 400)
    e.update()
    expect(e.result.dop!.pdop).toBeGreaterThan(1000)
    expect(e.result.misfitM).toBeLessThan(2)
  })
})

describe('Try this 2: geometry', () => {
  it('bunched satellites give a large DOP and circle, spread ones a small one, with the same ranging errors', () => {
    for (const t of TIMES) {
      const { e, s } = storeAt(t)
      s().applyPreset('clustered4')
      e.update()
      const c = { dop: e.result.dop!, h95: e.result.h95M }
      run(e, 150)
      const cScatter = trailScatter(e)
      s().applyPreset('spread4')
      e.update()
      const sp = { dop: e.result.dop!, h95: e.result.h95M }
      run(e, 150)
      const sScatter = trailScatter(e)
      expect(c.dop.hdop).toBeGreaterThanOrEqual(4)
      expect(c.dop.pdop).toBeGreaterThanOrEqual(8)
      expect(c.h95).toBeGreaterThan(40)
      expect(sp.dop.pdop).toBeGreaterThan(1.8)
      expect(sp.dop.pdop).toBeLessThan(3.2)
      expect(sp.h95).toBeGreaterThan(12)
      expect(sp.h95).toBeLessThan(23)
      expect(c.h95 / sp.h95).toBeGreaterThan(3)
      expect(cScatter / sScatter).toBeGreaterThan(1.4)
    }
  })
})

describe('Try this 3 and failures: a faulty satellite and RAIM', () => {
  it('RAIM detects the fault with 5 satellites (without blaming one) and excludes the right one with 6', () => {
    for (const t of [...TIMES, 3000, 30000, 61000]) {
      const { e, s } = storeAt(t)
      s().applyPreset('five')
      s().setEnv('faultySat', true)
      const faulty = e.faultyId!
      expect(s().settings.selected).toContain(faulty)
      let detectedAt = -1
      for (let k = 1; k <= 60; k++) {
        e.step(1)
        const st = e.result.raim?.status
        expect(st).not.toBe('fault-excluded')
        if (st === 'fault-detected' && detectedAt < 0) detectedAt = k
      }
      expect(detectedAt).toBeGreaterThanOrEqual(5)
      expect(detectedAt).toBeLessThanOrEqual(30)
      // Add a sixth.
      s().applyPreset('six')
      expect(s().settings.selected).toHaveLength(6)
      run(e, 3)
      expect(e.result.raim?.status).toBe('fault-excluded')
      expect(e.getSat(faulty)!.excluded).toBe(true)
      expect(e.result.usedIds).not.toContain(faulty)
      expect(e.result.hErrM).toBeLessThan(25)
    }
  })

  it('without RAIM the fault pulls the answer tens of metres away and nobody is warned', () => {
    let worst = 0
    for (const t of TIMES) {
      const { e, s } = storeAt(t)
      s().applyPreset('five')
      s().setEnv('raim', false)
      s().setEnv('faultySat', true)
      run(e, 60)
      expect(e.result.raim).toBeNull()
      expect(e.result.faultBiasM).toBeCloseTo(Math.min(200, 60 * FAULT_RAMP_M_PER_S), 6)
      worst = Math.max(worst, e.result.hErrM)
      expect(Math.hypot(e.result.hErrM, e.result.vErrM)).toBeGreaterThan(20)
    }
    expect(worst).toBeGreaterThan(40)
  })

  it('with all satellites in view RAIM finds and excludes the faulty one', () => {
    for (const t of TIMES) {
      const { e, s } = storeAt(t)
      s().setEnv('faultySat', true)
      run(e, 80)
      expect(e.result.raim?.status).toBe('fault-excluded')
      expect(e.getSat(e.faultyId)!.excluded).toBe(true)
    }
  })

  it('SBAS and GBAS flag the faulty satellite "do not use" within seconds', () => {
    for (const aug of ['sbas', 'gbas'] as const) {
      const { e, s } = storeAt(600)
      s().setSetting(aug, true)
      s().setEnv('faultySat', true)
      run(e, MONITOR_TIME_TO_ALERT_S - 1)
      expect(e.getSat(e.faultyId)!.flagged).toBe(false)
      run(e, 2)
      expect(e.getSat(e.faultyId)!.flagged).toBe(true)
      expect(e.result.usedIds).not.toContain(e.faultyId)
    }
  })
})

describe('Try this 5 and failures: ionosphere, SBAS and GBAS', () => {
  const at = (t: number, env: Partial<GnssEnv>, settings: Partial<GnssSettings> = {}) => engineAt(t, settings, env).result

  it('the storm makes the error large; SBAS and GBAS remove most of it', () => {
    for (const t of TIMES) {
      const none = at(t, { ionoStorm: true })
      const sbas = at(t, { ionoStorm: true }, { sbas: true })
      const gbas = at(t, { ionoStorm: true }, { gbas: true })
      expect(none.sigmaM).toBeGreaterThan(20)
      expect(none.sigmaM).toBeLessThan(30)
      expect(none.h95M).toBeGreaterThan(28)
      expect(none.h95M).toBeLessThan(55)
      expect(sbas.augmentation).toBe('sbas')
      expect(sbas.h95M).toBeGreaterThan(4)
      expect(sbas.h95M).toBeLessThan(8)
      expect(gbas.augmentation).toBe('gbas')
      expect(gbas.h95M).toBeGreaterThan(0.9)
      expect(gbas.h95M).toBeLessThan(1.8)
    }
  })

  it('on a quiet day SBAS gives about 1.5 m and GBAS about half a metre', () => {
    for (const t of TIMES) {
      const sbas = at(t, {}, { sbas: true })
      const gbas = at(t, {}, { gbas: true })
      expect(sbas.h95M).toBeGreaterThan(1)
      expect(sbas.h95M).toBeLessThan(2.2)
      expect(gbas.h95M).toBeGreaterThan(0.35)
      expect(gbas.h95M).toBeLessThan(0.75)
      expect(gbas.h95M).toBeLessThan(1)
    }
  })

  it('actual errors shrink with corrections too, not only the predicted circle', () => {
    const mean = (aug: Partial<GnssSettings>) => {
      const v: number[] = []
      for (const t of TIMES) {
        const e = engineAt(t, aug, { ionoStorm: true })
        for (let k = 0; k < 10; k++) {
          e.step(30)
          v.push(e.result.hErrM)
        }
      }
      return rms(v)
    }
    const none = mean({})
    const sbas = mean({ sbas: true })
    const gbas = mean({ gbas: true })
    expect(sbas).toBeLessThan(none / 3)
    expect(gbas).toBeLessThan(sbas / 2)
  })

  it('GBAS is only used near the ground; SBAS works in cruise', () => {
    expect(at(600, {}, { gbas: true, site: 'cruise' }).augmentation).toBe('none')
    expect(at(600, {}, { gbas: true, site: 'low' }).augmentation).toBe('gbas')
    expect(at(600, {}, { sbas: true, site: 'cruise' }).augmentation).toBe('sbas')
  })

  it('the storm does not trigger false RAIM alarms', () => {
    for (const t of TIMES) {
      const e = engineAt(t, {}, { ionoStorm: true })
      for (let k = 0; k < 10; k++) {
        e.step(60)
        expect(e.result.raim?.status).toBe('ok')
      }
    }
  })

  it('predicted errors match the budget', () => {
    const e = engineAt(600)
    const used = e.sats.filter((s) => s.used)
    expect(e.result.sigmaM).toBeCloseTo(rms(used.map((s) => predictedSigmaM(errorBudget('none'), s.elDeg))), 9)
  })
})

describe('Failures: blocked sky', () => {
  it('buildings hide satellites on the ground and the DOP gets worse; in the air nothing changes', () => {
    for (const t of TIMES) {
      const open = engineAt(t)
      const blocked = engineAt(t, {}, { blocked: true })
      expect(blocked.result.nTracked).toBeLessThan(open.result.nTracked)
      expect(blocked.sats.some((s) => s.status === 'blocked')).toBe(true)
      if (blocked.result.dop) expect(blocked.result.dop.pdop).toBeGreaterThan(open.result.dop!.pdop)
      const air = engineAt(t, { site: 'cruise' }, { blocked: true })
      expect(air.result.nTracked).toBe(engineAt(t, { site: 'cruise' }).result.nTracked)
    }
  })
})

describe('Try this 4 and failures: jamming', () => {
  it('a jammer 10 km away drowns every signal, SBAS included, more than 50 dB above the satellites', () => {
    for (const site of ['ground', 'low', 'cruise'] as const) {
      const e = engineAt(600, { site, jammerKm: 10, sbas: true }, { jamming: true })
      expect(e.result.jsDb!).toBeGreaterThan(50)
      expect(e.result.nTracked).toBe(0)
      expect(e.result.kind).toBe('none')
      expect(e.geo.tracked).toBe(false)
      expect(e.augmentation).toBe('none')
    }
  })

  it('on the ground the jammer drops behind the horizon beyond about 20 km; at 35,000 ft it still blinds at 100 km', () => {
    expect(engineAt(600, { jammerKm: 18 }, { jamming: true }).result.nTracked).toBe(0)
    const far = engineAt(600, { jammerKm: 25 }, { jamming: true })
    expect(far.result.jsDb).toBeNull()
    expect(far.result.kind).toBe('fix')
    expect(engineAt(600, { site: 'cruise', jammerKm: 100 }, { jamming: true }).result.nTracked).toBe(0)
    expect(engineAt(600, { site: 'cruise', jammerKm: 200 }, { jamming: true }).result.nTracked).toBeGreaterThan(5)
  })
})

describe('Failures: spoofing', () => {
  it('the fake position drifts away while RAIM sees nothing wrong, and the DME/DME cross-check catches it', () => {
    const { e, s } = storeAt(600)
    s().setEnv('spoofing', true)
    run(e, 30)
    expect(e.result.raim?.status).toBe('ok')
    expect(e.result.hErrM).toBeGreaterThan(30 * SPOOF.driftMs - 30)
    expect(e.result.hErrM).toBeLessThan(30 * SPOOF.driftMs + 30)
    expect(e.result.crossCheckM!).toBeLessThan(CROSS_CHECK_LIMIT_M)
    run(e, 150)
    expect(e.result.raim?.status).toBe('ok')
    expect(e.result.crossCheckM!).toBeGreaterThan(CROSS_CHECK_LIMIT_M)
    // Suspicious sign: every tracked signal is equally strong.
    const cn0 = e.sats.filter((x) => x.status === 'ok').map((x) => x.cn0DbHz)
    expect(new Set(cn0).size).toBe(1)
    // Drift is towards the north-east.
    expect(e.result.enu!.x).toBeGreaterThan(0)
    expect(e.result.enu!.y).toBeGreaterThan(0)
  })
})

describe('presets and selection', () => {
  it('presets return the right number of satellites from those being received', () => {
    const e = engineAt(600)
    const ok = new Set(e.sats.filter((s) => s.status === 'ok').map((s) => s.id))
    for (const [k, n] of [
      ['spread3', 3],
      ['clustered4', 4],
      ['spread4', 4],
      ['five', 5],
      ['six', 6],
    ] as const) {
      const ids = e.presetSelection(k)
      expect(ids).toHaveLength(n)
      for (const id of ids) expect(ok.has(id)).toBe(true)
    }
    expect(pdopOf(e.presetSelection('spread4').map((id) => e.getSat(id)!))).toBeLessThan(pdopOf(e.presetSelection('clustered4').map((id) => e.getSat(id)!)))
  })

  it('clicking a satellite in "all" mode switches to choosing and removes just that one', () => {
    const { e, s } = storeAt(600)
    const before = e.result.usedIds
    s().toggleSatellite(before[0])
    e.update()
    expect(s().settings.selectMode).toBe('manual')
    expect(e.result.usedIds).toEqual(before.slice(1))
  })

  it('with fewer than 3 satellites there is no position', () => {
    const { e, s } = storeAt(600)
    s().applyPreset('spread3')
    s().toggleSatellite(s().settings.selected[0])
    e.update()
    expect(e.result.kind).toBe('none')
  })
})
