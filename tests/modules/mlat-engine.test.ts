import { describe, expect, it } from 'vitest'
import { distanceNm } from '@/core/geometry'
import { hyperbolaResidualM, timeDifferenceNs, worldToEnuM, C_M_PER_NS } from '@/core/mlat'
import { METRES_PER_NM } from '@/core/units'
import {
  accuracyGrid,
  ambiguityRow,
  ambiguousAt,
  bandOf,
  cellCentre,
  needsAmbiguityCheck,
} from '@/modules/mlat/accuracy'
import {
  CLOCK_RECEIVER,
  DEFAULT_RECEIVERS,
  disagreementLimitM,
  EMIT_INTERVAL_S,
  FAILED_RECEIVER,
  FAILURE_CLOCK_ERROR_NS,
  mismatchThresholdM,
  MlatEngine,
  OUTSIDE_AIRCRAFT,
  SPOOF_OFFSET,
  SPOOFED_AIRCRAFT,
  type MlatFix,
} from '@/modules/mlat/engine'

function run(e: MlatEngine, seconds: number, dt = 1 / 30) {
  for (let t = 0; t < seconds - 1e-9; t += dt) e.step(dt)
}

function collect(e: MlatEngine, id: string, seconds: number): MlatFix[] {
  const out: MlatFix[] = []
  let last = -1
  for (let t = 0; t < seconds; t += 1 / 30) {
    e.step(1 / 30)
    const f = e.fixes.get(id)
    if (f && f.seq !== last) {
      out.push(f)
      last = f.seq
    }
  }
  return out
}

const rms = (xs: number[]) => Math.sqrt(xs.reduce((s, x) => s + x * x, 0) / xs.length)

describe('MLAT engine: normal operation', () => {
  it('makes one fix per aircraft per second', () => {
    const e = new MlatEngine()
    const fixes = collect(e, 'CNS101', 10.05)
    expect(fixes.length).toBeGreaterThanOrEqual(9)
    expect(fixes.length).toBeLessThanOrEqual(11)
    for (let i = 1; i < fixes.length; i++) expect(fixes[i].timeS - fixes[i - 1].timeS).toBeCloseTo(EMIT_INTERVAL_S, 1)
  })

  it('fixes inside the network are accurate to a few metres and match the expected error', () => {
    const e = new MlatEngine()
    const fixes = collect(e, 'CNS101', 60)
    for (const f of fixes) expect(f.solution.status).toBe('ok')
    const measured = rms(fixes.map((f) => f.errorM))
    const expected = rms(fixes.map((f) => f.expectedErrorM))
    expect(expected).toBeLessThan(15)
    expect(measured / expected).toBeGreaterThan(0.6)
    expect(measured / expected).toBeLessThan(1.5)
  })

  it('every measured curve passes through the aircraft (within the timing noise)', () => {
    const e = new MlatEngine()
    run(e, 3)
    const f = e.fixes.get('CNS101')!
    for (let i = 0; i < f.stamps.length; i++)
      for (let j = i + 1; j < f.stamps.length; j++) {
        const dt = timeDifferenceNs(f.stamps[i].stampUs, f.stamps[j].stampUs)
        expect(Math.abs(hyperbolaResidualM(f.trueEnu, f.stamps[i].enu, f.stamps[j].enu, dt))).toBeLessThan(6 * 15 * C_M_PER_NS)
      }
  })

  it('the MLAT position does not depend on the ADS-B content, so a spoofed report is caught', () => {
    const e = new MlatEngine()
    e.env = { ...e.env, spoof: true }
    const fixes = collect(e, SPOOFED_AIRCRAFT, 10)
    for (const f of fixes) {
      const adsbOff = distanceNm(f.adsbPos, f.truePos)
      expect(adsbOff).toBeCloseTo(SPOOF_OFFSET.distanceNm, 1)
      expect(f.errorM).toBeLessThan(50)
      expect(f.adsbMismatchM).toBeGreaterThan(mismatchThresholdM(f.expectedErrorM))
    }
    // Without spoofing the two agree.
    const e2 = new MlatEngine()
    const ok = collect(e2, SPOOFED_AIRCRAFT, 5)
    for (const f of ok) expect(f.adsbMismatchM).toBeLessThan(mismatchThresholdM(f.expectedErrorM))
  })
})

describe('MLAT engine: when things go wrong', () => {
  it('a failed receiver is left out, and the accuracy map gets worse, most of all to the north and south-east', () => {
    const e = new MlatEngine()
    const before = e.usedReceivers().length
    const pts = [{ x: 0, y: 35 }, { x: 35, y: -30 }]
    const good = pts.map((p) => e.expectedAt(p, 9000)!.errorM)
    const centre = e.expectedAt({ x: 0, y: 0 }, 9000)!.errorM
    e.env = { ...e.env, receiverFailed: true }
    expect(e.usedReceivers().length).toBe(before - 1)
    expect(e.usedReceivers().some((r) => r.id === FAILED_RECEIVER)).toBe(false)
    pts.forEach((p, i) => expect(e.expectedAt(p, 9000)!.errorM).toBeGreaterThan(good[i] * 3))
    // Still a good fix in the middle of the network (4 receivers are enough).
    expect(e.expectedAt({ x: 0, y: 0 }, 9000)!.errorM).toBeLessThan(centre * 1.5)
  })

  it('a clock error at R2 shifts every curve that uses R2, moves the fix, and the receivers disagree', () => {
    const e = new MlatEngine()
    e.params = { ...e.params, clockErrorNs: FAILURE_CLOCK_ERROR_NS, timingNoiseNs: 1 }
    const fixes = collect(e, 'CNS101', 8)
    const f = fixes[fixes.length - 1]
    const k = f.stamps.findIndex((s) => s.id === CLOCK_RECEIVER)
    for (let j = 0; j < f.stamps.length; j++) {
      if (j === k) continue
      const dt = timeDifferenceNs(f.stamps[k].stampUs, f.stamps[j].stampUs)
      const off = hyperbolaResidualM(f.trueEnu, f.stamps[k].enu, f.stamps[j].enu, dt)
      expect(Math.abs(off)).toBeGreaterThan(80) // ≈ 300 ns × 0.3 m/ns = 90 m
      // A pair without R2 still passes through the aircraft.
      const other = (j + 1) % f.stamps.length === k ? (j + 2) % f.stamps.length : (j + 1) % f.stamps.length
      if (other !== j && other !== k) {
        const dt2 = timeDifferenceNs(f.stamps[j].stampUs, f.stamps[other].stampUs)
        expect(Math.abs(hyperbolaResidualM(f.trueEnu, f.stamps[j].enu, f.stamps[other].enu, dt2))).toBeLessThan(3)
      }
    }
    const errors = fixes.map((x) => x.errorM)
    expect(Math.min(...errors)).toBeGreaterThan(20)
    expect(f.solution.redundancy).toBeGreaterThanOrEqual(1)
    expect(f.solution.residualRmsM).toBeGreaterThan(disagreementLimitM(1, f.solution.redundancy, f.stamps.length))
  })

  it('with realistic noise, 300 ns moves the fix by about 50–70 m and the disagreement readout flags it; clean clocks are not flagged', () => {
    const e = new MlatEngine()
    e.params = { ...e.params, clockErrorNs: FAILURE_CLOCK_ERROR_NS }
    const fixes = collect(e, 'CNS101', 40)
    const errs = fixes.map((f) => f.errorM)
    expect(Math.min(...errs)).toBeGreaterThan(30)
    expect(Math.max(...errs)).toBeLessThan(120)
    const flagged = fixes.filter((f) => f.solution.residualRmsM > disagreementLimitM(e.params.timingNoiseNs, f.solution.redundancy, f.stamps.length))
    expect(flagged.length / fixes.length).toBeGreaterThan(0.9)
    const clean = collect(new MlatEngine(), 'CNS101', 60)
    const falseFlags = clean.filter((f) => f.solution.residualRmsM > disagreementLimitM(15, f.solution.redundancy, f.stamps.length))
    expect(falseFlags.length).toBe(0)
  })

  it('bigger clock errors give bigger position errors', () => {
    const err = (ns: number) => {
      const e = new MlatEngine()
      e.params = { ...e.params, clockErrorNs: ns, timingNoiseNs: 1 }
      return rms(collect(e, 'CNS101', 6).map((f) => f.errorM))
    }
    expect(err(1000)).toBeGreaterThan(err(300) * 2)
  })

  it('receivers in a line: the mirror image fits everywhere, and accuracy collapses near the line and beyond its ends', () => {
    const e = new MlatEngine()
    const nearEnds = [
      { x: -45, y: 5 },
      { x: 40, y: -6 },
    ]
    const before = nearEnds.map((p) => e.expectedAt(p, 9000)!.errorM)
    e.applyBadGeometry(true)
    expect(e.collinear).toBe(true)
    const rx = e.usedEnu()
    const after = nearEnds.map((p) => e.expectedAt(p, 9000)?.errorM ?? Infinity)
    after.forEach((a, i) => expect(a).toBeGreaterThan(before[i] * 5))
    // On the line itself, beyond its ends, there is no position at all.
    expect(e.expectedAt({ x: -40, y: -3 }, 9000)).toBeNull()
    // Close to the line, between the receivers, the error at least doubles.
    expect(e.expectedAt({ x: 0, y: -4 }, 9000)!.errorM).toBeGreaterThan(2 * new MlatEngine().expectedAt({ x: 0, y: -4 }, 9000)!.errorM)
    for (const p of [{ x: -20, y: 20 }, { x: 10, y: 10 }, { x: 30, y: -20 }, { x: -10, y: -25 }, { x: 5, y: 3 }])
      expect(ambiguousAt(rx, worldToEnuM(p, 9000), true, 4.5)).toBe(true)
    // ... and in fact over the whole map.
    const b = { minX: -50, maxX: 50, minY: -50, maxY: 50 }
    let amb = 0
    for (let j = 0; j < 10; j++) amb += ambiguityRow(rx, 9000, true, 4.5, b, 10, 10, j).reduce((s, v) => s + v, 0)
    expect(amb / 100).toBeGreaterThan(0.9)
    expect(needsAmbiguityCheck(rx.length, true, true)).toBe(true)
    // Switching it off puts the receivers back where they were.
    e.applyBadGeometry(false)
    expect(e.collinear).toBe(false)
    for (const r of e.receivers) expect(r.pos).toEqual(DEFAULT_RECEIVERS.find((d) => d.id === r.id)!.pos)
  })

  it('an aircraft outside the network gets a much worse fix', () => {
    const e = new MlatEngine()
    const inside = collect(e, OUTSIDE_AIRCRAFT, 20)
    e.env = { ...e.env, outside: true }
    e.applyOutside(true)
    const outside = collect(e, OUTSIDE_AIRCRAFT, 40)
    const inExp = rms(inside.map((f) => f.expectedErrorM))
    const outExp = rms(outside.map((f) => f.expectedErrorM))
    expect(outExp).toBeGreaterThan(inExp * 5)
    // "From about 5 m to about 100 m."
    expect(inExp).toBeLessThan(8)
    expect(outExp).toBeGreaterThan(60)
    expect(outExp).toBeLessThan(150)
    expect(rms(outside.map((f) => f.errorM))).toBeGreaterThan(rms(inside.map((f) => f.errorM)) * 3)
  })
})

describe('MLAT engine: adding and removing receivers', () => {
  const only = (e: MlatEngine, ids: string[]) => {
    for (const r of e.receivers) e.setReceiver(r.id, { inUse: ids.includes(r.id) })
  }

  it('4 receivers still give a unique fix inside the network', () => {
    const e = new MlatEngine()
    only(e, ['R1', 'R2', 'R3', 'R4'])
    const fixes = collect(e, 'CNS101', 10)
    for (const f of fixes) expect(f.solution.status).toBe('ok')
  })

  it('with R1, R2 and R3 left, about half the map has two possible positions and there is no spare receiver', () => {
    const e = new MlatEngine()
    only(e, ['R1', 'R2', 'R3'])
    const b = { minX: -50, maxX: 50, minY: -50, maxY: 50 }
    let amb = 0
    for (let j = 0; j < 12; j++) amb += ambiguityRow(e.usedEnu(), 9000, true, 4.5, b, 12, 12, j).reduce((s, v) => s + v, 0)
    expect(amb / 144).toBeGreaterThan(0.3)
    expect(amb / 144).toBeLessThan(0.8)
    run(e, 2)
    expect(e.fixes.get('CNS101')!.solution.redundancy).toBe(0)
  })

  it('with 3 receivers some places have two possible positions', () => {
    const e = new MlatEngine()
    only(e, ['R2', 'R3', 'R4'])
    const rx = e.usedEnu()
    expect(needsAmbiguityCheck(rx.length, true, false)).toBe(true)
    const b = { minX: -50, maxX: 50, minY: -50, maxY: 50 }
    let amb = 0
    for (let j = 0; j < 12; j++) amb += ambiguityRow(rx, 9000, true, 3, b, 12, 12, j).reduce((s, v) => s + v, 0)
    expect(amb).toBeGreaterThan(5)
    expect(amb).toBeLessThan(12 * 12)
  })

  it('with 2 receivers there is no fix, and 3D needs a fourth receiver', () => {
    const e = new MlatEngine()
    only(e, ['R1', 'R2'])
    run(e, 2)
    expect(e.fixes.get('CNS101')!.solution.status).toBe('too-few')
    expect(e.fixes.get('CNS101')!.fixPos).toBeNull()
    only(e, ['R1', 'R2', 'R4'])
    e.params = { ...e.params, useAltitude: false }
    run(e, 2)
    expect(e.fixes.get('CNS101')!.solution.status).toBe('too-few')
    only(e, ['R1', 'R2', 'R3', 'R4', 'R5'])
    run(e, 2)
    const f = e.fixes.get('CNS101')!
    expect(f.solution.status).toBe('ok')
    expect(f.solution.dims).toBe(3)
    expect(Number.isFinite(f.heightErrorM)).toBe(true)
  })

  it('adding the spare receiver improves accuracy to the south', () => {
    const e = new MlatEngine()
    const p = { x: 25, y: -40 }
    const before = e.expectedAt(p, 9000)!.errorM
    e.setReceiver('R6', { inUse: true })
    expect(e.expectedAt(p, 9000)!.errorM).toBeLessThan(before * 0.6)
  })
})

describe('MLAT accuracy map', () => {
  it('agrees with the geometry used by the live fixes', () => {
    const e = new MlatEngine()
    const b = { minX: -45, maxX: 45, minY: -45, maxY: 45 }
    const grid = accuracyGrid(e.usedEnu(), 9000, true, e.params.timingNoiseNs, b, 9, 9)
    for (const [i, j] of [[0, 0], [4, 4], [8, 2], [3, 7]]) {
      const c = cellCentre(b, 9, 9, i, j)
      expect(grid[j * 9 + i]).toBeCloseTo(e.expectedAt(c, 9000)!.errorM, 2)
    }
  })

  it('is good inside the network and poor outside it', () => {
    const e = new MlatEngine()
    expect(bandOf(e.expectedAt({ x: 0, y: 0 }, 9000)!.errorM)).toBe(0)
    expect(bandOf(e.expectedAt({ x: 48, y: -48 }, 9000)!.errorM)).toBeGreaterThanOrEqual(3)
  })

  it('keeps the error units straight: 15 ns of noise is about 4.5 m per receiver', () => {
    const e = new MlatEngine()
    const x = e.expectedAt({ x: 0, y: 0 }, 9000)!
    expect(x.errorM).toBeCloseTo(x.dop.hdop * 15 * 0.2998, 3)
    expect(METRES_PER_NM).toBe(1852)
  })
})
