import { describe, expect, it } from 'vitest'
import {
  alongTrackNm,
  angleDiff,
  azimuthElevation,
  bearingDeg,
  bearingToCanvasAngle,
  bearingToThreeRotationY,
  crossTrackNm,
  destinationLatLon,
  destinationPoint,
  distanceNm,
  distanceToSegmentNm,
  ecefToEnu,
  ecefToGeodetic,
  enuToEcef,
  geodeticToEcef,
  greatCircleDistanceNm,
  initialBearingDeg,
  interpolateGreatCircle,
  latLonToLocal,
  localToLatLon,
  magneticBearingFromRelative,
  magneticToTrue,
  normalize180,
  normalize360,
  reciprocal,
  sweepCovers,
  relativeBearing,
  screenToWorld,
  trueToMagnetic,
  worldToScreen,
  worldToThree,
  WGS84_A_M,
} from '@/core/geometry'

describe('angle normalisation', () => {
  it('wraps into [0, 360)', () => {
    expect(normalize360(370)).toBe(10)
    expect(normalize360(-10)).toBe(350)
    expect(normalize360(360)).toBe(0)
    expect(normalize360(-360)).toBe(0)
    expect(normalize360(-1e-15)).toBeLessThan(360)
  })
  it('wraps into (-180, 180]', () => {
    expect(normalize180(190)).toBe(-170)
    expect(normalize180(180)).toBe(180)
    expect(normalize180(-180)).toBe(180)
    expect(normalize180(-90)).toBe(-90)
  })
  it('angleDiff takes the short way round', () => {
    expect(angleDiff(350, 10)).toBe(20)
    expect(angleDiff(10, 350)).toBe(-20)
    expect(angleDiff(0, 180)).toBe(180)
  })
})

describe('bearing and distance', () => {
  const o = { x: 0, y: 0 }
  it('measures bearings clockwise from north', () => {
    expect(bearingDeg(o, { x: 0, y: 5 })).toBeCloseTo(0)
    expect(bearingDeg(o, { x: 5, y: 0 })).toBeCloseTo(90)
    expect(bearingDeg(o, { x: 0, y: -5 })).toBeCloseTo(180)
    expect(bearingDeg(o, { x: -5, y: 0 })).toBeCloseTo(270)
    expect(bearingDeg(o, { x: 1, y: 1 })).toBeCloseTo(45)
  })
  it('distance is Euclidean in the local map frame', () => {
    expect(distanceNm(o, { x: 3, y: 4 })).toBeCloseTo(5)
  })
  it('destinationPoint is consistent with bearing and distance', () => {
    for (const b of [0, 37, 90, 181, 275, 359]) {
      const p = destinationPoint({ x: 2, y: -3 }, b, 7.5)
      expect(distanceNm({ x: 2, y: -3 }, p)).toBeCloseTo(7.5)
      expect(bearingDeg({ x: 2, y: -3 }, p)).toBeCloseTo(b === 0 ? 0 : b, 6)
    }
  })
  it('reciprocal flips by 180°', () => {
    expect(reciprocal(90)).toBe(270)
    expect(reciprocal(270)).toBe(90)
  })
  it('cross-track is positive to the right of the course', () => {
    // Course 090 through origin; a point south of it is to the right.
    expect(crossTrackNm({ x: 5, y: -1 }, o, 90)).toBeCloseTo(1)
    expect(crossTrackNm({ x: 5, y: 1 }, o, 90)).toBeCloseTo(-1)
    // Course 000; a point east is to the right.
    expect(crossTrackNm({ x: 2, y: 5 }, o, 0)).toBeCloseTo(2)
    expect(alongTrackNm({ x: 2, y: 5 }, o, 0)).toBeCloseTo(5)
  })
  it('distance to segment clamps to the ends', () => {
    expect(distanceToSegmentNm({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(3)
    expect(distanceToSegmentNm({ x: -3, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(5)
  })
})

describe('sweep coverage', () => {
  it('covers angles passed by a clockwise sweep in one frame', () => {
    expect(sweepCovers(10, 5, 10)).toBe(true)
    expect(sweepCovers(5, 5, 10)).toBe(true)
    expect(sweepCovers(15, 5, 10)).toBe(false)
    expect(sweepCovers(4, 5, 10)).toBe(false)
  })
  it('handles the wrap through north', () => {
    expect(sweepCovers(2, 355, 10)).toBe(true)
    expect(sweepCovers(358, 355, 10)).toBe(true)
    expect(sweepCovers(6, 355, 10)).toBe(false)
  })
  it('a full turn covers everything, zero span nothing', () => {
    expect(sweepCovers(123, 0, 360)).toBe(true)
    expect(sweepCovers(123, 0, 0)).toBe(false)
  })
  it('consecutive frames paint each azimuth exactly once per revolution', () => {
    let az = 0
    let hits = 0
    const target = 137.3
    for (let i = 0; i < 1000; i++) {
      const span = 360 / 250
      if (sweepCovers(target, az, span)) hits++
      az = normalize360(az + span)
    }
    expect(hits).toBe(4)
  })
})

describe('magnetic variation (East is least, West is best)', () => {
  it('converts true to magnetic with easterly variation', () => {
    expect(trueToMagnetic(100, 10)).toBe(90)
    expect(magneticToTrue(90, 10)).toBe(100)
  })
  it('converts true to magnetic with westerly variation', () => {
    expect(trueToMagnetic(100, -10)).toBe(110)
    expect(magneticToTrue(110, -10)).toBe(100)
  })
  it('wraps around north', () => {
    expect(trueToMagnetic(5, 10)).toBe(355)
  })
})

describe('relative bearing (NDB / ADF)', () => {
  it('is the angle from the nose to the station', () => {
    // Station due east, heading north → station is off the right wing (090).
    expect(relativeBearing(90, 0)).toBe(90)
    // Station behind.
    expect(relativeBearing(180, 0)).toBe(180)
    // Heading 300, station bearing 030 → 090 relative.
    expect(relativeBearing(30, 300)).toBe(90)
  })
  it('magnetic bearing = magnetic heading + relative bearing', () => {
    expect(magneticBearingFromRelative(300, 90)).toBe(30)
    for (const h of [0, 45, 123, 359]) {
      for (const brg of [0, 10, 170, 355]) {
        expect(magneticBearingFromRelative(h, relativeBearing(brg, h))).toBeCloseTo(brg)
      }
    }
  })
})

describe('local tangent plane', () => {
  const ref = { lat: -6.2, lon: 106.8 }
  it('round-trips lat/lon ↔ local', () => {
    const p = { x: 12.3, y: -45.6 }
    const back = latLonToLocal(localToLatLon(p, ref), ref)
    expect(back.x).toBeCloseTo(p.x, 9)
    expect(back.y).toBeCloseTo(p.y, 9)
  })
  it('one minute of latitude is one nautical mile', () => {
    expect(latLonToLocal({ lat: ref.lat + 1 / 60, lon: ref.lon }, ref).y).toBeCloseTo(1, 9)
  })
  it('agrees with the great-circle distance over short ranges', () => {
    const p = { x: 30, y: 40 }
    const gc = greatCircleDistanceNm(ref, localToLatLon(p, ref))
    expect(Math.abs(gc - 50) / 50).toBeLessThan(0.003)
  })
})

describe('great circle', () => {
  it('equator: one degree of longitude ≈ 60 NM', () => {
    const d = greatCircleDistanceNm({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })
    expect(d).toBeCloseTo(60.04, 1)
  })
  it('destination and distance are consistent', () => {
    const a = { lat: 51.47, lon: -0.45 }
    const b = destinationLatLon(a, 287, 3000)
    expect(greatCircleDistanceNm(a, b)).toBeCloseTo(3000, 3)
    expect(initialBearingDeg(a, b)).toBeCloseTo(287, 6)
  })
  it('interpolation passes through both ends and the midpoint', () => {
    const a = { lat: 40, lon: -74 }
    const b = { lat: 51.5, lon: -0.1 }
    const d = greatCircleDistanceNm(a, b)
    const m = interpolateGreatCircle(a, b, 0.5)
    expect(greatCircleDistanceNm(a, m)).toBeCloseTo(d / 2, 3)
    expect(greatCircleDistanceNm(interpolateGreatCircle(a, b, 0), a)).toBeCloseTo(0, 6)
    expect(greatCircleDistanceNm(interpolateGreatCircle(a, b, 1), b)).toBeCloseTo(0, 6)
  })
})

describe('ECEF and ENU', () => {
  it('equator/prime meridian sits on the x axis', () => {
    const e = geodeticToEcef({ lat: 0, lon: 0 })
    expect(e.x).toBeCloseTo(WGS84_A_M, 3)
    expect(e.y).toBeCloseTo(0, 6)
    expect(e.z).toBeCloseTo(0, 6)
  })
  it('round-trips geodetic ↔ ECEF', () => {
    const g = { lat: -6.2, lon: 106.8 }
    const back = ecefToGeodetic(geodeticToEcef(g, 1234))
    expect(back.lat).toBeCloseTo(g.lat, 9)
    expect(back.lon).toBeCloseTo(g.lon, 9)
    expect(back.heightM).toBeCloseTo(1234, 3)
  })
  it('ENU round-trips and "up" is up', () => {
    const g = { lat: 45, lon: 10 }
    const o = geodeticToEcef(g)
    const above = geodeticToEcef(g, 1000)
    const enu = ecefToEnu(above, o, g)
    expect(enu.x).toBeCloseTo(0, 3)
    expect(enu.y).toBeCloseTo(0, 3)
    expect(enu.z).toBeCloseTo(1000, 3)
    const back = enuToEcef({ x: 100, y: -200, z: 300 }, o, g)
    const again = ecefToEnu(back, o, g)
    expect(again.x).toBeCloseTo(100, 6)
    expect(again.y).toBeCloseTo(-200, 6)
    expect(again.z).toBeCloseTo(300, 6)
  })
  it('a point straight overhead has elevation 90°', () => {
    const g = { lat: 10, lon: 20 }
    const r = azimuthElevation(geodeticToEcef(g, 20_000_000), geodeticToEcef(g), g)
    expect(r.elevationDeg).toBeCloseTo(90, 3)
    expect(r.rangeM).toBeCloseTo(20_000_000, 0)
  })
  it('a point to the north has azimuth 0', () => {
    const g = { lat: 10, lon: 20 }
    const r = azimuthElevation(geodeticToEcef({ lat: 10.5, lon: 20 }, 0), geodeticToEcef(g), g)
    expect(Math.abs(angleDiff(0, r.azimuthDeg))).toBeLessThan(0.05)
  })
})

describe('screen and 3D conventions', () => {
  const view = { center: { x: 10, y: -5 }, pxPerNm: 8, width: 800, height: 600 }
  it('north is up and east is right on screen', () => {
    const c = worldToScreen(view.center, view)
    expect(c).toEqual({ x: 400, y: 300 })
    const north = worldToScreen({ x: 10, y: -4 }, view)
    expect(north.y).toBeLessThan(300)
    const east = worldToScreen({ x: 11, y: -5 }, view)
    expect(east.x).toBeGreaterThan(400)
  })
  it('screenToWorld inverts worldToScreen', () => {
    const p = { x: 3.3, y: 7.7 }
    const back = screenToWorld(worldToScreen(p, view), view)
    expect(back.x).toBeCloseTo(p.x, 9)
    expect(back.y).toBeCloseTo(p.y, 9)
  })
  it('canvas angle for north points up (-y)', () => {
    const a = bearingToCanvasAngle(0)
    expect(Math.cos(a)).toBeCloseTo(0)
    expect(Math.sin(a)).toBeCloseTo(-1)
    const e = bearingToCanvasAngle(90)
    expect(Math.cos(e)).toBeCloseTo(1)
    expect(Math.sin(e)).toBeCloseTo(0)
  })
  it('three.js rotation points local north along the bearing', () => {
    for (const b of [0, 90, 180, 270, 30]) {
      const a = bearingToThreeRotationY(b)
      // Rotating (0,0,-1) about +y by a: x' = -sin(a), z' = -cos(a)
      const x = -Math.sin(a)
      const z = -Math.cos(a)
      // Convert back to map frame: east = x, north = -z
      const brg = normalize360((Math.atan2(x, -z) * 180) / Math.PI)
      expect(brg).toBeCloseTo(b, 6)
    }
    expect(worldToThree({ x: 1, y: 2 }, 3)).toEqual([1, 3, -2])
  })
})
