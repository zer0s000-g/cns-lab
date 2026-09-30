import { describe, expect, it } from 'vitest'
import { positiveStep, isFiniteNumber } from '@/core/guard'
import { lineOfSight } from '@/core/propagation'
import { msaw, MSAW_DEFAULT } from '@/core/safetyNets'
import { createTrack, updateTrack, type Measurement } from '@/core/fusion'
import { encodeGillham, modeCReportedFt } from '@/core/ssr'
import { vorCdi } from '@/core/vor'
import { buildGroundClutter, DEFAULT_RADAR, evaluateTarget } from '@/core/radar'
import { createAircraft, stepAircraftFine } from '@/core/world'
import { fanElevationsDeg, groundCoverage, ionosphereAt } from '@/core/hf'
import { makePath, pointAt } from '@/core/surface'
import { routePointAt, shortestIslRoute, type FlightRoute } from '@/core/satcom'
import { replyHistogram } from '@/core/dme'
import { faultVisibility } from '@/core/gnss'
import { damp, dampAngle } from '@/instruments/draw'

// The core's rule for wrong inputs (see src/core/guard.ts): NaN never becomes a plausible
// answer, and a step size that would loop forever throws.

const flat = () => 0
const m = (over: Partial<Measurement>): Measurement => ({ source: 'ssr', targetId: 'A', timeS: 0, x: 0, y: 0, sigmaNm: 0.1, ...over })

describe('positiveStep', () => {
  it('accepts finite positive numbers and rejects everything else with the parameter name', () => {
    expect(positiveStep(0.5, 'stepNm')).toBe(0.5)
    for (const bad of [0, -1, NaN, Infinity, -Infinity]) expect(() => positiveStep(bad, 'stepNm')).toThrow(/stepNm/)
    expect(isFiniteNumber(3)).toBe(true)
    expect(isFiniteNumber(NaN)).toBe(false)
    expect(isFiniteNumber('3')).toBe(false)
  })
})

describe('step sizes that would loop forever throw', () => {
  it('in every function that walks in steps', () => {
    expect(() => lineOfSight({ x: 0, y: 0 }, 100, { x: 10, y: 0 }, 5000, flat, 0)).toThrow(RangeError)
    expect(() => msaw({ id: 'A', pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, altitudeFt: 5000, verticalSpeedFpm: 0 }, flat, { ...MSAW_DEFAULT, stepS: 0 })).toThrow(RangeError)
    expect(() => buildGroundClutter({ pos: { x: 0, y: 0 }, heightFt: 90 }, flat, 10, { azStepDeg: 0 })).toThrow(RangeError)
    expect(() => buildGroundClutter({ pos: { x: 0, y: 0 }, heightFt: 90 }, flat, 10, { rangeStepNm: -1 })).toThrow(RangeError)
    expect(() => fanElevationsDeg(0)).toThrow(RangeError)
    expect(() => groundCoverage(ionosphereAt(12), 8, 2700, 0)).toThrow(RangeError)
    expect(() => replyHistogram([[10, 20]], 0, 100)).toThrow(RangeError)
    const ac = createAircraft({ id: 'T', pos: { x: 0, y: 0 }, altitudeFt: 5000, headingDeg: 90, speedKt: 300 })
    expect(() => stepAircraftFine(ac, Infinity)).toThrow(RangeError)
    expect(stepAircraftFine(ac, NaN)).toBe(ac)
  })
})

describe('NaN is never a plausible answer', () => {
  it('terrain of unknown height blocks the line of sight', () => {
    const r = lineOfSight({ x: 0, y: 0 }, 100, { x: 10, y: 0 }, 5000, () => NaN)
    expect(r.visible).toBe(false)
    expect(lineOfSight({ x: 0, y: 0 }, NaN, { x: 10, y: 0 }, 5000, flat).visible).toBe(false)
  })

  it('MSAW warns when the terrain height is unknown', () => {
    const r = msaw({ id: 'A', pos: { x: 0, y: 0 }, vel: { x: 0.05, y: 0 }, altitudeFt: 9000, verticalSpeedFpm: 0 }, () => NaN)
    expect(r.alert).toBe(true)
  })

  it('a radar target without an altitude is not detected', () => {
    const env = { terrain: flat, mti: false }
    const r = evaluateTarget({ pos: { x: 0, y: 0 }, heightFt: 90 }, DEFAULT_RADAR, { pos: { x: 20, y: 0 }, altitudeFt: NaN, rcsM2: 10, radialSpeedKt: 300 }, env, 0)
    expect(r.detected).toBe(false)
    expect(r.pd).toBe(0)
  })

  it('Mode C of an unknown altitude is no report, not squawk-like zeros', () => {
    expect(modeCReportedFt(NaN)).toBeNull()
    expect(encodeGillham(NaN)).toBeNull()
    expect(modeCReportedFt(Infinity)).toBeNull()
  })

  it('a VOR indicator without a radial is flagged OFF with the needle centred', () => {
    expect(vorCdi(NaN, 90)).toEqual({ toFrom: 'OFF', deviationDeg: 0, lateral: 0 })
    expect(vorCdi(90, NaN).toFrom).toBe('OFF')
  })

  it('the tracker ignores a NaN measurement and copes with zero error', () => {
    const t = createTrack(m({ x: 1, y: 2 }))
    const u = updateTrack(t, m({ timeS: 1, x: NaN, y: 2 }))
    expect(Number.isFinite(u.ax.p)).toBe(true)
    const exact = updateTrack(createTrack(m({ sigmaNm: 0 })), m({ timeS: 0, x: 3, y: 4, sigmaNm: 0 }))
    expect(exact.ax.p).toBe(3)
    expect(exact.ay.p).toBe(4)
  })

  it('an instrument needle survives one bad reading', () => {
    expect(damp(10, NaN, 0.1, 0.5)).toBe(10)
    expect(damp(NaN, 20, 0.1, 0.5)).toBe(20)
    let v = damp(10, NaN, 0.1, 0.5)
    for (let i = 0; i < 100; i++) v = damp(v, 20, 0.1, 0.5)
    expect(v).toBeCloseTo(20, 3)
    expect(dampAngle(350, NaN, 0.1, 0.5)).toBe(350)
    expect(dampAngle(NaN, -10, 0.1, 0.5)).toBe(350)
  })
})

describe('empty or out-of-range inputs', () => {
  it('fail with a clear error instead of reading undefined', () => {
    expect(() => pointAt(makePath([]), 0)).toThrow(/no points/)
    const empty: FlightRoute = { id: 'x', name: 'x', waypoints: [], cruiseAltitudeFt: 35000 } as unknown as FlightRoute
    expect(() => routePointAt(empty, 0)).toThrow(/no waypoints/)
    expect(() => faultVisibility([{ azDeg: 0, elDeg: 45 }] as never, 9)).toThrow(RangeError)
  })

  it('a satellite route to or through a satellite that does not exist is no route', () => {
    expect(shortestIslRoute(3, [{ a: 0, b: 1, distanceM: 1 }], 0, 7)).toBeNull()
    expect(shortestIslRoute(3, [{ a: 0, b: 9, distanceM: 1 }], 0, 1)).toBeNull()
    expect(shortestIslRoute(3, [{ a: 0, b: 1, distanceM: 5 }], 0, 1)).toEqual({ path: [0, 1], distanceM: 5 })
  })
})
