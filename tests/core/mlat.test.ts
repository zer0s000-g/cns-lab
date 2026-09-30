import { describe, expect, it } from 'vitest'
import {
  arrivalTimeUs,
  C_M_PER_NS,
  C_M_PER_US,
  contourSegments,
  distinctCount,
  ELLIPSE_95,
  enuMToWorld,
  errorEllipse,
  expectedErrorM,
  gaussNewtonTdoa,
  hyperbolaResidualM,
  hyperbolaSegments,
  invertSmall,
  isNearlyCollinear,
  minReceivers,
  mlatDop,
  rangeDifferenceM,
  solveTdoa,
  tdoaJacobian,
  tdoaToRangeDifferenceM,
  timeDifferenceNs,
  travelTimeUsBetween,
  worldToEnuM,
} from '@/core/mlat'
import { dist3, type Vec3 } from '@/core/geometry'
import { gaussian, mulberry32 } from '@/core/random'
import { METRES_PER_FT, METRES_PER_NM, SPEED_OF_LIGHT_MS } from '@/core/units'

const TRIANGLE: Vec3[] = [
  { x: 0, y: 0, z: 0 },
  { x: 20000, y: 0, z: 0 },
  { x: 10000, y: 17320, z: 0 },
]
const SQUARE: Vec3[] = [
  { x: -15000, y: -15000, z: 30 },
  { x: 15000, y: -15000, z: 400 },
  { x: 15000, y: 15000, z: 50 },
  { x: -15000, y: 15000, z: 900 },
  { x: 0, y: 2000, z: 20 },
]

const times = (p: Vec3, rx: Vec3[], t0 = 1234.5, bias: number[] = []) => rx.map((r, i) => arrivalTimeUs(p, r, t0, bias[i] ?? 0))

describe('constants and frames', () => {
  it('light travels about 0.3 m per nanosecond and 300 m per microsecond', () => {
    expect(C_M_PER_NS).toBeCloseTo(0.2998, 4)
    expect(C_M_PER_US).toBeCloseTo(299.792458, 6)
    expect(C_M_PER_NS * 1e9).toBeCloseTo(SPEED_OF_LIGHT_MS, 3)
  })

  it('converts the NM / ft world frame to ENU metres and back', () => {
    const v = worldToEnuM({ x: 2, y: -3 }, 10000)
    expect(v.x).toBeCloseTo(2 * METRES_PER_NM, 6)
    expect(v.y).toBeCloseTo(-3 * METRES_PER_NM, 6)
    expect(v.z).toBeCloseTo(10000 * METRES_PER_FT, 6)
    const back = enuMToWorld(v)
    expect(back.pos.x).toBeCloseTo(2, 9)
    expect(back.pos.y).toBeCloseTo(-3, 9)
    expect(back.heightFt).toBeCloseTo(10000, 6)
  })
})

describe('arrival times and differences', () => {
  it('a signal takes about 100 µs to cross 30 km', () => {
    expect(travelTimeUsBetween({ x: 0, y: 0, z: 0 }, { x: 30000, y: 0, z: 0 })).toBeCloseTo(100.069, 3)
  })

  it('arrival time uses the 3D distance, including height', () => {
    const t = arrivalTimeUs({ x: 3000, y: 0, z: 4000 }, { x: 0, y: 0, z: 0 }, 0)
    expect(t).toBeCloseTo(5000 / C_M_PER_US, 9)
  })

  it('a clock error shifts the time stamp by exactly that amount', () => {
    const p = { x: 1000, y: 2000, z: 3000 }
    const r = { x: 0, y: 0, z: 0 }
    expect(arrivalTimeUs(p, r, 10, 300) - arrivalTimeUs(p, r, 10)).toBeCloseTo(0.3, 9)
  })

  it('the unknown emission time cancels in time differences', () => {
    const p = { x: 5000, y: 8000, z: 3000 }
    const a = times(p, TRIANGLE, 0)
    const b = times(p, TRIANGLE, 98765.4321)
    expect(timeDifferenceNs(a[1], a[0])).toBeCloseTo(timeDifferenceNs(b[1], b[0]), 3)
    // Δt × c = difference of distances.
    expect(tdoaToRangeDifferenceM(timeDifferenceNs(a[1], a[0]))).toBeCloseTo(rangeDifferenceM(p, TRIANGLE[1], TRIANGLE[0]), 4)
  })

  it('1 ns of time difference is about 0.3 m of distance difference', () => {
    expect(tdoaToRangeDifferenceM(1)).toBeCloseTo(0.2998, 4)
    expect(tdoaToRangeDifferenceM(1000)).toBeCloseTo(299.79, 2)
  })

  it('the true position lies on every measured hyperbola, and a clock error moves the curve off it', () => {
    const p = { x: 7000, y: 4000, z: 3000 }
    const t = times(p, TRIANGLE)
    expect(Math.abs(hyperbolaResidualM(p, TRIANGLE[1], TRIANGLE[0], timeDifferenceNs(t[1], t[0])))).toBeLessThan(1e-4)
    const tb = times(p, TRIANGLE, 1234.5, [0, 300, 0])
    expect(hyperbolaResidualM(p, TRIANGLE[1], TRIANGLE[0], timeDifferenceNs(tb[1], tb[0]))).toBeCloseTo(-300 * C_M_PER_NS, 3)
  })
})

describe('linear algebra', () => {
  it('inverts small matrices and rejects singular ones', () => {
    const m = [
      [4, 1, 0],
      [1, 3, 1],
      [0, 1, 2],
    ]
    const inv = invertSmall(m)!
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        const v = m[i].reduce((s, x, k) => s + x * inv[k][j], 0)
        expect(v).toBeCloseTo(i === j ? 1 : 0, 10)
      }
    expect(invertSmall([[1, 2], [2, 4]])).toBeNull()
  })

  it('Jacobian rows are differences of unit vectors', () => {
    const J = tdoaJacobian(TRIANGLE, { x: 10000, y: 5000, z: 0 }, 2)
    expect(J).toHaveLength(2)
    for (const row of J) expect(Math.hypot(...row)).toBeLessThanOrEqual(2 + 1e-9)
  })
})

describe('geometry factor (DOP)', () => {
  it('is small inside the network and grows fast outside it', () => {
    const inside = mlatDop(SQUARE, { x: 0, y: 0, z: 3000 }, true)!
    const edge = mlatDop(SQUARE, { x: 30000, y: 0, z: 3000 }, true)!
    const far = mlatDop(SQUARE, { x: 90000, y: 20000, z: 3000 }, true)!
    expect(inside.hdop).toBeLessThan(1.5)
    expect(edge.hdop).toBeGreaterThan(inside.hdop * 1.5)
    expect(far.hdop).toBeGreaterThan(10)
  })

  it('collapses near a straight line of receivers and beyond its ends', () => {
    const line: Vec3[] = [0, 10000, 20000, 30000].map((x) => ({ x, y: 0, z: 0 }))
    expect(isNearlyCollinear(line)).toBe(true)
    const good = mlatDop(SQUARE, { x: 0, y: 5000, z: 3000 }, true)!
    const nearLine = mlatDop(line, { x: 15000, y: 1000, z: 3000 }, true)!
    const offEnd = mlatDop(line, { x: 45000, y: 3000, z: 3000 }, true)!
    expect(nearLine.hdop).toBeGreaterThan(8 * good.hdop)
    expect(offEnd.hdop).toBeGreaterThan(50 * good.hdop)
  })

  it('needs 3 receivers with a known height and 4 without', () => {
    expect(minReceivers(true)).toBe(3)
    expect(minReceivers(false)).toBe(4)
    expect(mlatDop(TRIANGLE.slice(0, 2), { x: 1, y: 1, z: 1 }, true)).toBeNull()
    expect(mlatDop(TRIANGLE, { x: 10000, y: 5000, z: 3000 }, false)).toBeNull()
    expect(mlatDop(TRIANGLE, { x: 10000, y: 5000, z: 3000 }, true)).not.toBeNull()
  })

  it('solving for height as well makes the horizontal position no better, and height is poor from the ground', () => {
    const p = { x: 2000, y: 1000, z: 3000 }
    const d2 = mlatDop(SQUARE, p, true)!
    const d3 = mlatDop(SQUARE, p, false)!
    expect(d3.hdop).toBeGreaterThanOrEqual(d2.hdop - 1e-9)
    expect(d3.vdop).toBeGreaterThan(d3.hdop)
  })

  it('expected error = DOP × c × timing noise', () => {
    expect(expectedErrorM(2, 10)).toBeCloseTo(2 * 10 * 0.2998, 3)
  })

  it('agrees with the scatter of real solver fixes (Monte Carlo)', () => {
    const rand = mulberry32(7)
    for (const p of [{ x: 1000, y: 3000, z: 3000 }, { x: 32000, y: -26000, z: 3000 }]) {
      const dop = mlatDop(SQUARE, p, true)!
      let se = 0
      const n = 300
      for (let k = 0; k < n; k++) {
        const t = SQUARE.map((r) => arrivalTimeUs(p, r, 50, 0, gaussian(rand) * 10))
        const s = solveTdoa(SQUARE, t, { heightM: p.z, noiseM: 3, starts: [p] })
        expect(s.position).not.toBeNull()
        se += (s.position!.x - p.x) ** 2 + (s.position!.y - p.y) ** 2
      }
      const measured = Math.sqrt(se / n)
      const predicted = expectedErrorM(dop.hdop, 10)
      expect(measured / predicted).toBeGreaterThan(0.85)
      expect(measured / predicted).toBeLessThan(1.15)
    }
  })
})

describe('error ellipse', () => {
  it('matches the axes of a diagonal covariance', () => {
    const e = errorEllipse([[100, 0], [0, 25]])
    expect(e.semiMajorM).toBeCloseTo(10, 9)
    expect(e.semiMinorM).toBeCloseTo(5, 9)
    expect(e.majorBearingDeg).toBeCloseTo(90, 6) // major axis east-west
  })

  it('finds a rotated major axis', () => {
    // Variance along 045°: covariance [[a, b], [b, a]] with b > 0.
    const e = errorEllipse([[50, 40], [40, 50]])
    expect(e.majorBearingDeg).toBeCloseTo(45, 6)
    expect(e.semiMajorM).toBeCloseTo(Math.sqrt(90), 9)
  })

  it('95% scale is √5.99 ≈ 2.45', () => {
    expect(ELLIPSE_95).toBeCloseTo(2.4477, 3)
  })
})

describe('solver', () => {
  it('recovers the position exactly from noiseless times (2D with known height)', () => {
    const p = { x: 4000, y: -6000, z: 3048 }
    const s = solveTdoa(SQUARE, times(p, SQUARE), { heightM: p.z })
    expect(s.status).toBe('ok')
    expect(dist3(s.position!, p)).toBeLessThan(1e-3)
    expect(s.residualRmsM).toBeLessThan(1e-3)
    expect(s.redundancy).toBe(2)
  })

  it('recovers height too when solving in 3D with enough receivers', () => {
    const p = { x: -3000, y: 5000, z: 6000 }
    const s = solveTdoa(SQUARE, times(p, SQUARE), { heightM: null })
    expect(s.status).toBe('ok')
    expect(s.dims).toBe(3)
    expect(dist3(s.position!, p)).toBeLessThan(0.05)
  })

  it('Gauss–Newton converges from a distant start', () => {
    const p = { x: 3000, y: 4000, z: 3000 }
    const t = times(p, SQUARE)
    const d = t.slice(1).map((x) => (x - t[0]) * C_M_PER_US)
    const r = gaussNewtonTdoa(SQUARE, d, { x: -40000, y: 30000, z: 3000 }, 3000)
    expect(r.converged).toBe(true)
    expect(Math.hypot(r.position.x - p.x, r.position.y - p.y)).toBeLessThan(1e-3)
  })

  it('reports too few receivers', () => {
    const p = { x: 5000, y: 5000, z: 3000 }
    expect(solveTdoa(TRIANGLE.slice(0, 2), times(p, TRIANGLE.slice(0, 2)), { heightM: 3000 }).status).toBe('too-few')
    expect(solveTdoa(TRIANGLE, times(p, TRIANGLE), { heightM: null }).status).toBe('too-few')
  })

  it('with only 3 receivers, a point behind a receiver has two possible positions', () => {
    const p = { x: -40000, y: -40000, z: 3000 }
    const s = solveTdoa(TRIANGLE, times(p, TRIANGLE), { heightM: 3000 })
    expect(s.status).toBe('ambiguous')
    expect(s.candidates).toHaveLength(2)
    expect(Math.min(...s.candidates.map((c) => dist3(c, p)))).toBeLessThan(1)
    // Track continuity picks the candidate near the previous fix.
    const withPrefer = solveTdoa(TRIANGLE, times(p, TRIANGLE), { heightM: 3000, prefer: { x: -39000, y: -41000, z: 3000 } })
    expect(dist3(withPrefer.position!, p)).toBeLessThan(1)
  })

  it('inside the triangle 3 receivers give a unique fix', () => {
    const p = { x: 10000, y: 6000, z: 3000 }
    const s = solveTdoa(TRIANGLE, times(p, TRIANGLE), { heightM: 3000 })
    expect(s.status).toBe('ok')
    expect(dist3(s.position!, p)).toBeLessThan(1e-3)
  })

  it('a fourth receiver removes the ambiguity', () => {
    const rx = [...TRIANGLE, { x: -30000, y: -25000, z: 0 }]
    const p = { x: -40000, y: -40000, z: 3000 }
    const s = solveTdoa(rx, times(p, rx), { heightM: 3000 })
    expect(s.status).toBe('ok')
    expect(dist3(s.position!, p)).toBeLessThan(1e-3)
  })

  it('receivers in a line cannot tell which side of the line the aircraft is', () => {
    const line: Vec3[] = [0, 10000, 20000, 30000].map((x) => ({ x, y: 0, z: 0 }))
    const p = { x: 12000, y: 15000, z: 3000 }
    const s = solveTdoa(line, times(p, line), { heightM: 3000 })
    expect(s.status).toBe('ambiguous')
    const mirror = { x: p.x, y: -p.y, z: p.z }
    expect(s.candidates.some((c) => dist3(c, mirror) < 1)).toBe(true)
  })

  it('a clock error at one receiver moves the fix and the spare receivers show the disagreement', () => {
    const p = { x: 2000, y: 3000, z: 3000 }
    const clean = solveTdoa(SQUARE, times(p, SQUARE), { heightM: 3000 })
    const biased = solveTdoa(SQUARE, times(p, SQUARE, 1234.5, [0, 300, 0, 0, 0]), { heightM: 3000 })
    expect(biased.status).toBe('ok')
    const err = Math.hypot(biased.position!.x - p.x, biased.position!.y - p.y)
    expect(err).toBeGreaterThan(20)
    expect(err).toBeLessThan(1000)
    expect(biased.residualRmsM).toBeGreaterThan(clean.residualRmsM + 10)
  })

  it('does not pick a solution below the ground in 3D', () => {
    const p = { x: 1000, y: -2000, z: 2500 }
    const s = solveTdoa(SQUARE, times(p, SQUARE), { heightM: null })
    for (const c of s.candidates) expect(c.z).toBeGreaterThan(0)
  })
})

describe('contours and hyperbolas', () => {
  it('traces a circle with marching squares', () => {
    const segs = contourSegments((x, y) => Math.hypot(x, y) - 5, { minX: -10, maxX: 10, minY: -10, maxY: 10 }, 80, 80)
    expect(segs.length).toBeGreaterThan(50)
    for (const [a, b] of segs) {
      expect(Math.abs(Math.hypot(a.x, a.y) - 5)).toBeLessThan(0.02)
      expect(Math.abs(Math.hypot(b.x, b.y) - 5)).toBeLessThan(0.02)
    }
  })

  it('draws the hyperbola of the MEASURED difference, passing through the aircraft', () => {
    const p = { x: 7000, y: 4000, z: 3000 }
    const t = times(p, TRIANGLE)
    const dt = timeDifferenceNs(t[1], t[0])
    const b = { minX: -20000, maxX: 40000, minY: -20000, maxY: 40000 }
    const segs = hyperbolaSegments(TRIANGLE[1], TRIANGLE[0], dt, 3000, b, 150, 150)
    expect(segs.length).toBeGreaterThan(20)
    for (const [a] of segs) expect(Math.abs(hyperbolaResidualM({ ...a, z: 3000 }, TRIANGLE[1], TRIANGLE[0], dt))).toBeLessThan(5)
    const nearest = Math.min(...segs.map(([a]) => Math.hypot(a.x - p.x, a.y - p.y)))
    expect(nearest).toBeLessThan(400)
  })

  it('has no curve when the measured difference is larger than the receiver spacing', () => {
    const spacing = dist3(TRIANGLE[0], TRIANGLE[1])
    expect(hyperbolaSegments(TRIANGLE[1], TRIANGLE[0], ((spacing + 10) / C_M_PER_NS), 0, { minX: 0, maxX: 1, minY: 0, maxY: 1 })).toEqual([])
  })

  it('detects collinear receivers', () => {
    expect(isNearlyCollinear(SQUARE)).toBe(false)
    expect(isNearlyCollinear([{ x: 0, y: 0, z: 0 }, { x: 10, y: 0.5, z: 0 }, { x: 20, y: 0, z: 0 }], 1)).toBe(true)
  })
})

describe('degenerate receiver layouts', () => {
  const A = { x: 0, y: 0, z: 0 }
  const p = { x: 3000, y: 4000, z: 3000 }

  it('receivers on the same spot count once, so there are not enough of them', () => {
    const stacked = [A, { ...A, z: 60 }, { x: 20000, y: 0, z: 0 }]
    expect(distinctCount(stacked)).toBe(2)
    expect(solveTdoa(stacked, times(p, stacked), { heightM: 3000 }).status).toBe('too-few')
    const allOne = [A, { ...A }, { ...A }, { ...A }, { ...A }, { ...A }]
    expect(solveTdoa(allOne, times(p, allOne), { heightM: null }).status).toBe('too-few')
    const fourWithPair = [...SQUARE.slice(0, 3), { ...SQUARE[0] }]
    expect(solveTdoa(fourWithPair, times(p, fourWithPair), { heightM: null }).status).toBe('too-few')
  })

  it('a time or position that is not a number gives no solution, not a guess', () => {
    const t = times(p, SQUARE)
    t[2] = NaN
    expect(solveTdoa(SQUARE, t, { heightM: 3000 })).toMatchObject({ status: 'no-solution', position: null })
    const t2 = times(p, SQUARE)
    t2[1] = Infinity
    expect(solveTdoa(SQUARE, t2, { heightM: 3000 }).status).toBe('no-solution')
    const rx = SQUARE.map((r, i) => (i === 3 ? { ...r, x: NaN } : r))
    expect(solveTdoa(rx, times(p, SQUARE), { heightM: 3000 }).status).toBe('no-solution')
  })

  it('Gauss–Newton does not call a singular system converged', () => {
    const r = gaussNewtonTdoa([A, A, A, A], [0, 0, 0], { x: 1e5, y: 1e5, z: 0 }, null)
    expect(r.converged).toBe(false)
    const n = gaussNewtonTdoa(SQUARE, [NaN, 0, 0, 0], { x: 0, y: 0, z: 3000 }, 3000)
    expect(n.converged).toBe(false)
  })

  it('receivers all on one spot count as collinear', () => {
    expect(isNearlyCollinear([A, { ...A }, { ...A }, { ...A }])).toBe(true)
  })
})
