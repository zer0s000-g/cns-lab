import { describe, expect, it } from 'vitest'
import { closestApproach, msaw, MSAW_DEFAULT, stca, stcaAll, STCA_TMA, type PredictState } from '@/core/safetyNets'

const kt = (v: number) => v / 3600
const ac = (over: Partial<PredictState>): PredictState => ({
  id: 'A',
  pos: { x: 0, y: 0 },
  vel: { x: 0, y: 0 },
  altitudeFt: 10000,
  verticalSpeedFpm: 0,
  ...over,
})

describe('closest approach', () => {
  it('head-on aircraft meet halfway', () => {
    const a = ac({ pos: { x: -10, y: 0 }, vel: { x: kt(300), y: 0 } })
    const b = ac({ id: 'B', pos: { x: 10, y: 0 }, vel: { x: -kt(300), y: 0 } })
    const c = closestApproach(a, b, 600)
    expect(c.tcpaS).toBeCloseTo(120, 6)
    expect(c.distanceNm).toBeCloseTo(0, 6)
  })
  it('clamps to the look-ahead window and to now', () => {
    const a = ac({ pos: { x: -100, y: 0 }, vel: { x: kt(300), y: 0 } })
    const b = ac({ id: 'B', pos: { x: 100, y: 0 }, vel: { x: -kt(300), y: 0 } })
    expect(closestApproach(a, b, 120).tcpaS).toBe(120)
    const diverging = ac({ id: 'B', pos: { x: 5, y: 0 }, vel: { x: kt(300), y: 0 } })
    expect(closestApproach(ac({}), diverging, 120).tcpaS).toBe(0)
  })
})

describe('STCA', () => {
  it('alerts for two aircraft converging at the same level', () => {
    const a = ac({ pos: { x: -6, y: 0 }, vel: { x: kt(250), y: 0 } })
    const b = ac({ id: 'B', pos: { x: 6, y: 0 }, vel: { x: -kt(250), y: 0 } })
    const r = stca(a, b)
    expect(r.alert).toBe(true)
    // Separation drops below 3 NM when the gap has closed by 9 NM at 500 kt closure: 64.8 s.
    expect(r.timeToViolationS).toBeCloseTo(65, -0.5)
  })
  it('does not alert when vertically separated by 2,000 ft', () => {
    const a = ac({ pos: { x: -6, y: 0 }, vel: { x: kt(250), y: 0 } })
    const b = ac({ id: 'B', pos: { x: 6, y: 0 }, vel: { x: -kt(250), y: 0 }, altitudeFt: 12000 })
    expect(stca(a, b).alert).toBe(false)
  })
  it('alerts when a climb will remove the vertical separation', () => {
    const a = ac({ pos: { x: -6, y: 0 }, vel: { x: kt(250), y: 0 }, altitudeFt: 8000, verticalSpeedFpm: 2000 })
    const b = ac({ id: 'B', pos: { x: 6, y: 0 }, vel: { x: -kt(250), y: 0 }, altitudeFt: 10000 })
    expect(stca(a, b).alert).toBe(true)
  })
  it('does not alert for parallel tracks 5 NM apart', () => {
    const a = ac({ vel: { x: kt(250), y: 0 } })
    const b = ac({ id: 'B', pos: { x: 0, y: 5 }, vel: { x: kt(250), y: 0 } })
    expect(stca(a, b).alert).toBe(false)
  })
  it('finds every alerting pair once', () => {
    const list = [
      ac({ id: 'A', pos: { x: -5, y: 0 }, vel: { x: kt(250), y: 0 } }),
      ac({ id: 'B', pos: { x: 5, y: 0 }, vel: { x: -kt(250), y: 0 } }),
      ac({ id: 'C', pos: { x: 0, y: 40 } }),
    ]
    const pairs = stcaAll(list, STCA_TMA)
    expect(pairs).toHaveLength(1)
    expect([pairs[0].a, pairs[0].b].sort()).toEqual(['A', 'B'])
  })
})

describe('MSAW', () => {
  const hill = (p: { x: number; y: number }) => (p.x > 10 && p.x < 12 ? 6000 : 0)
  it('alerts when the aircraft will fly into rising terrain', () => {
    // 240 kt = 4 NM per minute: the hill 10 NM ahead is reached after 150 s.
    const s = ac({ pos: { x: 0, y: 0 }, vel: { x: kt(240), y: 0 }, altitudeFt: 6500 })
    expect(msaw(s, hill).alert).toBe(false) // beyond the default 60 s look-ahead
    const r = msaw(s, hill, { ...MSAW_DEFAULT, lookaheadS: 180 })
    expect(r.alert).toBe(true)
    expect(r.timeToViolationS!).toBeCloseTo(150, -1)
  })
  it('alerts early enough when the hill is close', () => {
    const s = ac({ pos: { x: 8, y: 0 }, vel: { x: kt(240), y: 0 }, altitudeFt: 6500 })
    const r = msaw(s, hill)
    expect(r.alert).toBe(true)
    expect(r.timeToViolationS!).toBeCloseTo(30, -1)
  })
  it('alerts for a descent toward flat ground and stays quiet in an inhibit area', () => {
    const s = ac({ vel: { x: kt(160), y: 0 }, altitudeFt: 1500, verticalSpeedFpm: -1000 })
    expect(msaw(s, () => 0).alert).toBe(true)
    expect(msaw(s, () => 0, undefined, () => true).alert).toBe(false)
  })
})
