import { describe, expect, it } from 'vitest'
import {
  approachSpeed,
  azimuthDeg,
  brakingDistanceM,
  closestAlong,
  CONTRAST_THRESHOLD,
  DEFAULT_SMR,
  distanceToThresholdM,
  FINAL_ALERT_DISTANCE_M,
  fogContrast,
  ghostPosition,
  glidePathHeightM,
  inRunwayProtectedArea,
  insideBox,
  labRunway,
  makePath,
  mirrorPoint,
  movementIsActive,
  onRunway,
  pointAt,
  rainAttenuationDbPerKm,
  rainClutterStrength,
  runwayIncursion,
  scatterPointsWorld,
  segmentHitsBox,
  sideOf,
  smrAzimuthResolutionM,
  smrPointDetection,
  smrPointSnrDb,
  smrRangeResolutionM,
  stopSpeedLimitMs,
  turnSpeedLimitKt,
  visibleInFog,
  SHAPE_SIZE,
} from '@/core/surface'
import { LAB_AIRPORT } from '@/core/world'
import { METRES_PER_NM } from '@/core/units'

const rwy = labRunway()
const dry = { rateMmH: 0, circularPolarisation: false }
const heavy = { rateMmH: 25, circularPolarisation: false }

describe('runway geometry', () => {
  it('matches LAB_AIRPORT: 3,000 m × 45 m, centred on the origin, east–west', () => {
    expect(rwy.endX - rwy.thresholdX).toBeCloseTo(3000, 0)
    expect(rwy.thresholdX).toBeCloseTo(-1500, 0)
    expect(rwy.halfWidthM * 2).toBeCloseTo(45, 0)
    expect(rwy.headingDeg).toBe(LAB_AIRPORT.runways[0].headingTrue)
    expect(rwy.centreY).toBe(0)
  })

  it('knows the paved runway and the protected area inside the holding positions', () => {
    expect(onRunway({ x: 0, y: 10 }, rwy)).toBe(true)
    expect(onRunway({ x: 0, y: 30 }, rwy)).toBe(false)
    expect(inRunwayProtectedArea({ x: 0, y: 30 }, rwy)).toBe(true)
    expect(inRunwayProtectedArea({ x: 0, y: 89 }, rwy)).toBe(true)
    expect(inRunwayProtectedArea({ x: 0, y: 91 }, rwy)).toBe(false)
    expect(inRunwayProtectedArea({ x: 0, y: -60 }, rwy)).toBe(true)
    expect(inRunwayProtectedArea({ x: -1540, y: 0 }, rwy)).toBe(true)
    expect(inRunwayProtectedArea({ x: -1600, y: 0 }, rwy)).toBe(false)
  })

  it('3° glide path: about 210 m high 2 NM out, 15 m over the threshold', () => {
    expect(glidePathHeightM(0)).toBeCloseTo(15, 6)
    expect(glidePathHeightM(2 * METRES_PER_NM)).toBeCloseTo(15 + 3704 * Math.tan((3 * Math.PI) / 180), 3)
    expect(glidePathHeightM(2 * METRES_PER_NM)).toBeGreaterThan(200)
    expect(distanceToThresholdM({ x: -2500, y: 0 }, rwy)).toBeCloseTo(1000, 0)
  })
})

describe('paths and kinematics', () => {
  const path = makePath([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }])

  it('measures and walks a polyline', () => {
    expect(path.length).toBeCloseTo(150, 9)
    const a = pointAt(path, 50)
    expect(a.pos).toEqual({ x: 50, y: 0 })
    expect(a.trackDeg).toBeCloseTo(90, 9)
    const b = pointAt(path, 125)
    expect(b.pos.x).toBeCloseTo(100, 9)
    expect(b.pos.y).toBeCloseTo(25, 9)
    expect(b.trackDeg).toBeCloseTo(0, 9)
    expect(pointAt(path, 999).pos).toEqual({ x: 100, y: 50 })
    expect(closestAlong(path, { x: 60, y: 7 })).toBeCloseTo(60, 6)
    expect(closestAlong(path, { x: 120, y: 30 })).toBeCloseTo(130, 6)
  })

  it('braking distance and stopping speed are inverses', () => {
    expect(brakingDistanceM(20, 2)).toBeCloseTo(100, 9)
    expect(stopSpeedLimitMs(100, 2)).toBeCloseTo(20, 9)
    expect(stopSpeedLimitMs(-5, 2)).toBe(0)
  })

  it('changes speed no faster than the limits', () => {
    expect(approachSpeed(10, 20, 1, 2, 3)).toBe(12)
    expect(approachSpeed(10, 0, 1, 2, 3)).toBe(7)
    expect(approachSpeed(10, 11, 1, 2, 3)).toBe(11)
  })

  it('slows down for tight turns ahead', () => {
    expect(turnSpeedLimitKt(path, 60)).toBe(10)
    expect(turnSpeedLimitKt(path, 0, 60)).toBe(20)
  })
})

describe('surface movement radar', () => {
  it('20 ns pulses give about 3 m range resolution; 0.35° is about 6 m across at 1 km', () => {
    expect(smrRangeResolutionM(DEFAULT_SMR)).toBeCloseTo(3.0, 1)
    expect(smrAzimuthResolutionM(DEFAULT_SMR, 1000)).toBeCloseTo(6.1, 1)
    expect(DEFAULT_SMR.rotationPeriodS).toBe(1)
    expect(DEFAULT_SMR.frequencyGHz).toBeGreaterThan(8)
    expect(DEFAULT_SMR.frequencyGHz).toBeLessThan(12)
  })

  it('places scatter points along the nose and the wings', () => {
    const pts = scatterPointsWorld('medium', { x: 0, y: 0 }, 90)
    const xs = pts.map((p) => p.pos.x)
    const ys = pts.map((p) => p.pos.y)
    // Heading east: the fuselage lies along x, the wings along y.
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(SHAPE_SIZE.medium.length * 0.9)
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(SHAPE_SIZE.medium.span * 0.9)
    // Nose points east.
    const nose = pts.reduce((a, b) => (b.pos.x > a.pos.x ? b : a))
    expect(Math.abs(nose.pos.y)).toBeLessThan(1)
    const car = scatterPointsWorld('car', { x: 10, y: 10 }, 0)
    expect(car).toHaveLength(5)
    expect(Math.max(...car.map((p) => p.pos.y)) - Math.min(...car.map((p) => p.pos.y))).toBeCloseTo(SHAPE_SIZE.car.length, 6)
  })

  it('detects targets reliably in dry weather across the airport', () => {
    expect(smrPointDetection(2500, 3, dry)).toBeGreaterThan(0.95)
    expect(smrPointDetection(500, 3, dry)).toBeGreaterThan(0.99)
  })

  it('heavy rain (X-band) weakens and hides detail, most of all far away', () => {
    expect(rainAttenuationDbPerKm(25)).toBeGreaterThan(0.3)
    expect(rainAttenuationDbPerKm(25)).toBeLessThan(1)
    expect(rainAttenuationDbPerKm(0)).toBe(0)
    const near = smrPointDetection(400, 3, heavy)
    const far = smrPointDetection(1800, 3, heavy)
    expect(near).toBeGreaterThan(0.8)
    expect(far).toBeLessThan(0.1)
    expect(smrPointSnrDb(1000, 3, heavy)).toBeLessThan(smrPointSnrDb(1000, 3, dry) - 10)
  })

  it('circular polarisation brings most of the detail back and weakens the rain echo', () => {
    const cp = { rateMmH: 25, circularPolarisation: true }
    expect(smrPointDetection(1500, 3, cp)).toBeGreaterThan(smrPointDetection(1500, 3, heavy) + 0.5)
    expect(rainClutterStrength(800, cp)).toBeLessThan(rainClutterStrength(800, heavy) * 0.25)
    expect(rainClutterStrength(800, dry)).toBe(0)
  })
})

describe('reflections (ghost targets)', () => {
  const wall = { a: { x: -100, y: 100 }, b: { x: 100, y: 100 } }

  it('mirrors a point across the wall line', () => {
    expect(mirrorPoint({ x: 30, y: 40 }, wall)).toEqual({ x: 30, y: 160 })
    expect(sideOf({ x: 0, y: 0 }, wall)).toBe(-sideOf({ x: 0, y: 200 }, wall))
  })

  it('puts the ghost behind the wall, at the mirror image, farther away along the reflected path', () => {
    const radar = { x: -50, y: 0 }
    const target = { x: 40, y: 20 }
    const g = ghostPosition(target, radar, wall)!
    expect(g.ghost).toEqual({ x: 40, y: 180 })
    expect(g.ghost.y).toBeGreaterThan(wall.a.y) // other side of the wall from the radar
    const direct = Math.hypot(target.x - radar.x, target.y - radar.y)
    const ghostRange = Math.hypot(g.ghost.x - radar.x, g.ghost.y - radar.y)
    const reflected = Math.hypot(g.reflection.x - radar.x, g.reflection.y - radar.y) + Math.hypot(target.x - g.reflection.x, target.y - g.reflection.y)
    expect(ghostRange).toBeGreaterThan(direct)
    expect(ghostRange).toBeCloseTo(reflected, 6)
    // The radar sees it in the direction of the reflection point.
    expect(azimuthDeg(radar, g.ghost)).toBeCloseTo(azimuthDeg(radar, g.reflection), 6)
    expect(g.reflection.y).toBeCloseTo(100, 9)
  })

  it('makes no ghost when the target is behind the wall or the reflection misses the wall', () => {
    expect(ghostPosition({ x: 0, y: 150 }, { x: 0, y: 0 }, wall)).toBeNull()
    expect(ghostPosition({ x: 400, y: 20 }, { x: 350, y: 0 }, wall)).toBeNull()
  })
})

describe('fog', () => {
  it('contrast falls as exp(−3·d/V) and reaches the 5% threshold at the visibility', () => {
    expect(fogContrast(0, 1000)).toBe(1)
    expect(fogContrast(1000, 1000)).toBeCloseTo(CONTRAST_THRESHOLD, 9)
    expect(fogContrast(500, 1000)).toBeCloseTo(Math.exp(-Math.log(20) / 2), 9)
    expect(Math.log(20)).toBeCloseTo(3, 0)
    expect(visibleInFog(900, 1000)).toBe(true)
    expect(visibleInFog(1100, 1000)).toBe(false)
  })
})

describe('runway incursion alerting', () => {
  const landing = (d: number) => ({ id: 'ARR', kind: 'landing' as const, distanceToThresholdM: d, timeToThresholdS: d / 72, onRunway: false })
  const car = { id: 'CAR', pos: { x: 200, y: 0 }, onGround: true, name: 'CAR' }

  it('no intruder, no alert', () => {
    expect(runwayIncursion(rwy, [landing(3000)], [{ ...car, pos: { x: 200, y: 150 } }], new Set()).level).toBe('none')
  })

  it('a vehicle on the runway with nothing landing is a caution', () => {
    const r = runwayIncursion(rwy, [landing(9000)], [car], new Set())
    expect(r.level).toBe('caution')
    expect(r.intruders).toEqual(['CAR'])
  })

  it('becomes an alert once the arrival is within 2 NM or 60 s', () => {
    expect(movementIsActive(landing(FINAL_ALERT_DISTANCE_M - 1))).toBe(true)
    expect(movementIsActive(landing(FINAL_ALERT_DISTANCE_M + 900))).toBe(false)
    // 60 s rule: a fast arrival 4,500 m out.
    expect(movementIsActive({ ...landing(4500), timeToThresholdS: 55 })).toBe(true)
    const r = runwayIncursion(rwy, [landing(3000)], [car], new Set())
    expect(r.level).toBe('alert')
    expect(r.against).toBe('ARR')
  })

  it('alerts during a take-off roll too, and ignores cleared aircraft and airborne ones', () => {
    const dep = { id: 'DEP', kind: 'takeoff' as const, onRunway: true }
    expect(runwayIncursion(rwy, [dep], [car], new Set()).level).toBe('alert')
    expect(runwayIncursion(rwy, [dep], [{ ...car, id: 'DEP' }], new Set()).level).toBe('none')
    expect(runwayIncursion(rwy, [], [car], new Set(['CAR'])).level).toBe('none')
    expect(runwayIncursion(rwy, [dep], [{ ...car, onGround: false }], new Set()).level).toBe('none')
  })

  it('a target waiting at the stop bar is not an intruder', () => {
    expect(runwayIncursion(rwy, [landing(1000)], [{ ...car, pos: { x: -1470, y: 115 } }], new Set()).level).toBe('none')
  })
})

describe('line of sight on the airport', () => {
  const box = { minX: 0, maxX: 10, minY: 0, maxY: 10 }
  it('finds segments through a building', () => {
    expect(segmentHitsBox({ x: -5, y: 5 }, { x: 15, y: 5 }, box)).toBe(true)
    expect(segmentHitsBox({ x: -5, y: 15 }, { x: 15, y: 15 }, box)).toBe(false)
    expect(segmentHitsBox({ x: -5, y: -5 }, { x: -1, y: 20 }, box)).toBe(false)
    expect(insideBox({ x: 5, y: 5 }, box)).toBe(true)
    expect(insideBox({ x: 12, y: 5 }, box, 3)).toBe(true)
  })
})
