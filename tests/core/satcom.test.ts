import { describe, expect, it } from 'vitest'
import { greatCircleDistanceNm } from '@/core/geometry'
import { travelTimeS } from '@/core/propagation'
import {
  AIRFRAME_MASK_DEG,
  airframeHorizonElevationDeg,
  antennaElevationDeg,
  blockedByAirframe,
  buildLeoConstellation,
  centralAngleDeg,
  circularOrbitEcef,
  clearsEarth,
  coverageHalfAngleDeg,
  ecefToSpherical,
  ecefToThree,
  elevationAtCentralAngleDeg,
  footprintRing,
  GEO_ALTITUDE_KM,
  GEO_MASK_DEG,
  GEO_RADIUS_M,
  geoMaxLatitudeDeg,
  geoPositionEcef,
  islLinks,
  KA_BAND_GHZ,
  KU_BAND_GHZ,
  L_BAND_GHZ,
  LEO,
  LEO_RADIUS_M,
  lonDiffDeg,
  lookAngles,
  maxPassDurationS,
  orbitalPeriodS,
  orbitTrackEcef,
  orbitalSpeedMs,
  pathDelayS,
  pathLengthM,
  rainAttenuationDb,
  rainPathKm,
  rainSpecificAttenuationDbPerKm,
  routeLengthNm,
  routePointAt,
  shortestIslRoute,
  SIDEREAL_DAY_S,
  slantRangeM,
  sphericalToEcef,
  subSatellitePoint,
  turnRateDegS,
  type FlightRoute,
} from '@/core/satcom'
import { EARTH_RADIUS_M, EARTH_RADIUS_NM } from '@/core/units'

describe('orbits', () => {
  it('puts the geostationary orbit about 35,786 km above the equator with a one-sidereal-day period', () => {
    expect(GEO_RADIUS_M / 1000).toBeCloseTo(42164, 0)
    expect(GEO_ALTITUDE_KM).toBeCloseTo(35786, 0)
    expect(orbitalPeriodS(GEO_RADIUS_M)).toBeCloseTo(SIDEREAL_DAY_S, 3)
    // 23 h 56 min 4 s
    expect(SIDEREAL_DAY_S).toBeCloseTo(23 * 3600 + 56 * 60 + 4, 0)
  })

  it('gives an Iridium-style 780 km orbit a period of about 100 minutes', () => {
    expect(orbitalPeriodS(LEO_RADIUS_M) / 60).toBeGreaterThan(99)
    expect(orbitalPeriodS(LEO_RADIUS_M) / 60).toBeLessThan(102)
    expect(orbitalSpeedMs(LEO_RADIUS_M)).toBeCloseTo(7460, -2)
  })

  it('keeps a GEO satellite fixed over the Earth: a circular equatorial orbit at GEO radius does not drift', () => {
    const o = { radiusM: GEO_RADIUS_M, inclinationDeg: 0, raanDeg: 0, argLatDeg: -30 }
    for (const t of [0, 3600, 10 * 3600, 20 * 3600]) {
      const p = subSatellitePoint(circularOrbitEcef(o, t))
      expect(p.lat).toBeCloseTo(0, 6)
      expect(p.lon).toBeCloseTo(-30, 3)
    }
    const g = geoPositionEcef(-30)
    const c = circularOrbitEcef(o, 0)
    expect(Math.hypot(g.x - c.x, g.y - c.y, g.z - c.z)).toBeLessThan(1)
  })

  it('moves a LEO satellite a full turn in one period (relative to the stars) and never beyond its inclination in latitude', () => {
    const [s] = buildLeoConstellation()
    const T = orbitalPeriodS(s.radiusM)
    let maxLat = 0
    for (let t = 0; t < T; t += 30) maxLat = Math.max(maxLat, Math.abs(ecefToSpherical(circularOrbitEcef(s, t)).lat))
    expect(maxLat).toBeLessThanOrEqual(LEO.inclinationDeg + 1e-6)
    expect(maxLat).toBeGreaterThan(LEO.inclinationDeg - 0.5)
    // Height stays constant.
    expect(ecefToSpherical(circularOrbitEcef(s, 1234)).heightM).toBeCloseTo(LEO.altitudeM, 0)
  })

  it('draws each orbit track through the satellites of that plane at the same moment', () => {
    const c = buildLeoConstellation()
    const t = 4321
    const track = orbitTrackEcef(c[22], t, 360)
    expect(track[0].x).toBeCloseTo(track[track.length - 1].x, 3)
    for (const s of c.filter((x) => x.plane === c[22].plane)) {
      const p = circularOrbitEcef(s, t)
      const nearest = Math.min(...track.map((q) => Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z)))
      expect(nearest).toBeLessThan(70_000) // within half a track step (1°) of the drawn circle
    }
  })

  it('builds 66 satellites in 6 planes of 11', () => {
    const c = buildLeoConstellation()
    expect(c).toHaveLength(66)
    expect(new Set(c.map((s) => s.plane)).size).toBe(6)
    expect(c.filter((s) => s.plane === 3)).toHaveLength(11)
    expect(new Set(c.map((s) => s.id)).size).toBe(66)
  })
})

describe('frames', () => {
  it('maps ECEF to three.js with the North Pole at +y and 90°E at −z', () => {
    const r = EARTH_RADIUS_M
    expect(ecefToThree(sphericalToEcef({ lat: 90, lon: 0 }))[1]).toBeCloseTo(1, 9)
    const e = ecefToThree(sphericalToEcef({ lat: 0, lon: 0 }))
    expect(e[0]).toBeCloseTo(1, 9)
    const east = ecefToThree(sphericalToEcef({ lat: 0, lon: 90 }))
    expect(east[2]).toBeCloseTo(-1, 9)
    const west = ecefToThree(sphericalToEcef({ lat: 0, lon: -90 }))
    expect(west[2]).toBeCloseTo(1, 9)
    const v = ecefToThree({ x: r, y: 2 * r, z: 3 * r })
    expect(v[0]).toBeCloseTo(1, 12)
    expect(v[1]).toBeCloseTo(3, 12)
    expect(v[2]).toBeCloseTo(-2, 12)
  })

  it('round-trips spherical coordinates', () => {
    const p = { lat: 51.5, lon: -0.45 }
    const q = ecefToSpherical(sphericalToEcef(p, 10_000))
    expect(q.lat).toBeCloseTo(p.lat, 9)
    expect(q.lon).toBeCloseTo(p.lon, 9)
    expect(q.heightM).toBeCloseTo(10_000, 3)
  })

  it('agrees with the great-circle helpers on the same sphere', () => {
    const a = { lat: 51.47, lon: -0.45 }
    const b = { lat: 40.64, lon: -73.78 }
    const va = sphericalToEcef(a)
    const vb = sphericalToEcef(b)
    const angle = Math.acos((va.x * vb.x + va.y * vb.y + va.z * vb.z) / EARTH_RADIUS_M ** 2)
    expect((angle * 180) / Math.PI).toBeCloseTo(centralAngleDeg(a, b), 6)
    expect(greatCircleDistanceNm(a, b)).toBeGreaterThan(2900)
  })
})

describe('look angles and coverage', () => {
  it('sees a satellite straight up from the point below it', () => {
    const la = lookAngles(geoPositionEcef(-15.5), { lat: 0, lon: -15.5 })
    expect(la.elevationDeg).toBeCloseTo(90, 6)
    expect(la.rangeM).toBeCloseTo(GEO_RADIUS_M - EARTH_RADIUS_M, 0)
  })

  it('gives the right azimuth: a GEO satellite to the south-west of London is seen toward the south-west', () => {
    const la = lookAngles(geoPositionEcef(-15.5), { lat: 51.47, lon: -0.45 })
    expect(la.azimuthDeg).toBeGreaterThan(180)
    expect(la.azimuthDeg).toBeLessThan(225)
    expect(la.elevationDeg).toBeGreaterThan(25)
    expect(la.elevationDeg).toBeLessThan(32)
  })

  it('matches the analytic elevation formula', () => {
    for (const c of [10, 40, 70, 80]) {
      const obs = { lat: c, lon: 20 }
      const la = lookAngles(geoPositionEcef(20), obs)
      expect(la.elevationDeg).toBeCloseTo(elevationAtCentralAngleDeg(c, GEO_RADIUS_M), 6)
      expect(la.rangeM).toBeCloseTo(slantRangeM(la.elevationDeg, GEO_RADIUS_M), 0)
    }
  })

  it('reaches about 81° from the sub-satellite point with a 0° mask, so GEO does not cover the poles', () => {
    expect(coverageHalfAngleDeg(GEO_RADIUS_M, 0)).toBeCloseTo(81.3, 1)
    expect(geoMaxLatitudeDeg(GEO_MASK_DEG)).toBeGreaterThan(75)
    expect(geoMaxLatitudeDeg(GEO_MASK_DEG)).toBeLessThan(80)
    // From the North Pole every GEO satellite is below the horizon.
    for (const lon of [-98, -15.5, 64, 143.5]) expect(lookAngles(geoPositionEcef(lon), { lat: 90, lon: 0 }).elevationDeg).toBeLessThan(0)
  })

  it('draws the coverage edge exactly where the elevation equals the mask', () => {
    const lon = 64
    const half = coverageHalfAngleDeg(GEO_RADIUS_M, GEO_MASK_DEG)
    for (const p of footprintRing({ lat: 0, lon }, half, 24)) {
      expect(lookAngles(geoPositionEcef(lon), p).elevationDeg).toBeCloseTo(GEO_MASK_DEG, 4)
    }
    const leoHalf = coverageHalfAngleDeg(LEO_RADIUS_M, LEO.maskDeg)
    expect(leoHalf).toBeGreaterThan(18)
    expect(leoHalf).toBeLessThan(22)
  })

  it('also matches for an observer at cruise height (the edge drawn on the globe for the aircraft)', () => {
    const h = 10_668
    const s = circularOrbitEcef(buildLeoConstellation()[5], 777)
    const sub = subSatellitePoint(s)
    const half = coverageHalfAngleDeg(LEO_RADIUS_M, LEO.maskDeg, EARTH_RADIUS_M + h)
    for (const p of footprintRing(sub, half, 12)) expect(lookAngles(s, p, h).elevationDeg).toBeCloseTo(LEO.maskDeg, 4)
    // Slightly smaller than the ground footprint.
    expect(half).toBeLessThan(coverageHalfAngleDeg(LEO_RADIUS_M, LEO.maskDeg))
  })

  it('keeps a LEO satellite in view only for minutes: at most about 11 minutes on an overhead pass', () => {
    const s = maxPassDurationS(LEO_RADIUS_M, LEO.maskDeg) / 60
    expect(s).toBeGreaterThan(9)
    expect(s).toBeLessThan(12)
  })

  it('slant range to GEO is 35,786 km overhead and about 41,700 km at the horizon', () => {
    expect(slantRangeM(90, GEO_RADIUS_M) / 1000).toBeCloseTo((GEO_RADIUS_M - EARTH_RADIUS_M) / 1000, 3)
    expect(slantRangeM(0, GEO_RADIUS_M) / 1000).toBeGreaterThan(41_500)
    expect(slantRangeM(0, GEO_RADIUS_M) / 1000).toBeLessThan(41_800)
  })

  it('covers the whole globe, poles included, with the LEO constellation', () => {
    const sats = buildLeoConstellation()
    let worst = 90
    for (let t = 0; t < 6000; t += 300) {
      const pos = sats.map((s) => circularOrbitEcef(s, t))
      for (let lat = -90; lat <= 90; lat += 10) {
        for (let lon = -180; lon < 180; lon += 10) {
          let best = -90
          for (const p of pos) best = Math.max(best, lookAngles(p, { lat, lon }).elevationDeg)
          worst = Math.min(worst, best)
        }
      }
    }
    expect(worst).toBeGreaterThanOrEqual(LEO.maskDeg - 0.2)
  })
})

describe('signal travel time', () => {
  it('takes about a quarter of a second one way through a GEO satellite, half a second for a question and answer', () => {
    const ac = sphericalToEcef({ lat: 52, lon: -30 }, 10_700)
    const sat = geoPositionEcef(-15.5)
    const gs = sphericalToEcef({ lat: 53.3, lon: 7.1 })
    const up = pathLengthM([ac, sat])
    const down = pathLengthM([sat, gs])
    expect(up / 1000).toBeGreaterThan(36_000)
    expect(up / 1000).toBeLessThan(41_700)
    expect(down / 1000).toBeGreaterThan(36_000)
    const oneWay = pathDelayS([ac, sat, gs])
    expect(oneWay).toBeCloseTo(travelTimeS(up + down), 12)
    expect(oneWay).toBeGreaterThan(0.24)
    expect(oneWay).toBeLessThan(0.28)
    expect(2 * oneWay).toBeGreaterThan(0.48)
    expect(2 * oneWay).toBeLessThan(0.56)
  })

  it('takes only milliseconds for one hop up to a LEO satellite', () => {
    const s = circularOrbitEcef(buildLeoConstellation()[0], 0)
    const below = subSatellitePoint(s)
    expect(pathDelayS([sphericalToEcef(below), s]) * 1000).toBeCloseTo(2.6, 1)
  })

  it('checks that a straight line clears the Earth', () => {
    const a = sphericalToEcef({ lat: 0, lon: 0 }, 780_000)
    const b = sphericalToEcef({ lat: 0, lon: 180 }, 780_000)
    const c = sphericalToEcef({ lat: 0, lon: 20 }, 780_000)
    expect(clearsEarth(a, b)).toBe(false)
    expect(clearsEarth(a, c)).toBe(true)
  })
})

describe('inter-satellite links', () => {
  const sats = buildLeoConstellation()
  const pos = sats.map((s) => circularOrbitEcef(s, 1500))
  const links = islLinks(sats, pos)

  it('links every satellite to its in-plane neighbours and never across the seam', () => {
    const inPlane = links.filter((l) => sats[l.a].plane === sats[l.b].plane)
    expect(inPlane).toHaveLength(66)
    const seam = links.filter((l) => Math.abs(sats[l.a].plane - sats[l.b].plane) === LEO.planes - 1)
    expect(seam).toHaveLength(0)
    for (const l of links) expect(clearsEarth(pos[l.a], pos[l.b])).toBe(true)
    // Cross-plane links only between neighbouring planes and away from the poles.
    for (const l of links.filter((x) => sats[x.a].plane !== sats[x.b].plane)) {
      expect(Math.abs(sats[l.a].plane - sats[l.b].plane)).toBe(1)
      expect(Math.abs(ecefToSpherical(pos[l.a]).lat)).toBeLessThanOrEqual(LEO.crossPlaneMaxLatDeg)
    }
  })

  it('finds a route between any two satellites, a few thousand km per hop', () => {
    const r = shortestIslRoute(sats.length, links, 0, 40)
    expect(r).not.toBeNull()
    expect(r!.path[0]).toBe(0)
    expect(r!.path[r!.path.length - 1]).toBe(40)
    const hop = r!.distanceM / (r!.path.length - 1) / 1000
    expect(hop).toBeGreaterThan(2000)
    expect(hop).toBeLessThan(5000)
    // Tens of milliseconds, not hundreds.
    expect(travelTimeS(r!.distanceM) * 1000).toBeLessThan(100)
    expect(shortestIslRoute(sats.length, links, 5, 5)).toEqual({ path: [5], distanceM: 0 })
  })
})

describe('antenna blockage in a turn', () => {
  it('equals the ordinary elevation in level flight', () => {
    expect(antennaElevationDeg(123, 27, 250, 0)).toBeCloseTo(27, 9)
  })

  it('hides a low satellite on the high-wing side when the aircraft banks away from it', () => {
    // Heading north, satellite low to the west (on the left). Bank 45° right: left wing up.
    expect(blockedByAirframe(270, 20, 0, 45)).toBe(true)
    // Banking toward it (left, negative) lifts it higher in the antenna's view.
    expect(blockedByAirframe(270, 20, 0, -45)).toBe(false)
    expect(antennaElevationDeg(270, 20, 0, -45)).toBeGreaterThan(20)
    // A satellite on the right is fine in a right bank.
    expect(blockedByAirframe(90, 20, 0, 45)).toBe(false)
    // Straight ahead is barely affected by bank.
    expect(antennaElevationDeg(0, 20, 0, 45)).toBeCloseTo((Math.asin(Math.sin((20 * Math.PI) / 180) * Math.cos(Math.PI / 4)) * 180) / Math.PI, 6)
  })

  it('draws the airframe horizon where the antenna elevation equals the mask', () => {
    for (const rel of [30, 90, 200, 270, 300]) {
      const e = airframeHorizonElevationDeg(rel, 45)
      if (e > -90 && e < 90) expect(antennaElevationDeg(rel, e, 0, 45)).toBeCloseTo(AIRFRAME_MASK_DEG, 6)
    }
    // Level wings: the horizon is the mask everywhere.
    expect(airframeHorizonElevationDeg(123, 0)).toBeCloseTo(AIRFRAME_MASK_DEG, 9)
    // On the high-wing side the blocked zone reaches far up the sky.
    expect(airframeHorizonElevationDeg(270, 45)).toBeGreaterThan(40)
  })

  it('computes the rate of a coordinated turn', () => {
    // 45° bank at 480 kt: about 2.3°/s, so a full circle takes about 2.6 minutes.
    expect(turnRateDegS(45, 480)).toBeCloseTo(2.28, 2)
    expect(turnRateDegS(0, 480)).toBe(0)
    expect(turnRateDegS(30, 0)).toBe(0)
  })
})

describe('rain attenuation', () => {
  it('barely touches L-band but fades Ku and Ka band in heavy rain', () => {
    const l = rainAttenuationDb(L_BAND_GHZ, 25, 30, 0, 5)
    const ku = rainAttenuationDb(KU_BAND_GHZ, 25, 30, 0, 5)
    const ka = rainAttenuationDb(KA_BAND_GHZ, 25, 30, 0, 5)
    expect(l).toBeLessThan(0.1)
    expect(ku).toBeGreaterThan(3)
    expect(ka).toBeGreaterThan(ku)
  })

  it('increases with frequency and rain rate, and is zero without rain', () => {
    expect(rainSpecificAttenuationDbPerKm(12, 0)).toBe(0)
    expect(rainSpecificAttenuationDbPerKm(20, 25)).toBeGreaterThan(rainSpecificAttenuationDbPerKm(12, 25))
    expect(rainSpecificAttenuationDbPerKm(12, 50)).toBeGreaterThan(rainSpecificAttenuationDbPerKm(12, 25))
    // Matches the table at a listed frequency.
    expect(rainSpecificAttenuationDbPerKm(12, 1)).toBeCloseTo(0.02386, 6)
  })

  it('is zero for an aircraft flying above the rain', () => {
    expect(rainPathKm(30, 10.7, 5)).toBe(0)
    expect(rainAttenuationDb(KA_BAND_GHZ, 25, 30, 10.7, 5)).toBe(0)
    // Low elevation means a longer path through the rain.
    expect(rainPathKm(10, 0, 5)).toBeGreaterThan(rainPathKm(60, 0, 5))
  })
})

describe('routes', () => {
  const r: FlightRoute = {
    id: 't',
    name: 'test',
    waypoints: [
      { name: 'A', pos: { lat: 40, lon: -74 } },
      { name: 'P', pos: { lat: 90, lon: 0 } },
      { name: 'B', pos: { lat: 40, lon: 116 } },
    ],
    cruiseAltitudeFt: 35000,
    groundSpeedKt: 480,
    climbNm: 150,
    descentNm: 150,
  }

  it('adds up great-circle legs and passes over the North Pole', () => {
    const len = routeLengthNm(r)
    // Two legs of 50° of arc each.
    expect(len).toBeCloseTo(100 * (Math.PI / 180) * EARTH_RADIUS_NM, 3)
    const mid = routePointAt(r, len / 2)
    expect(mid.pos.lat).toBeGreaterThan(89.9)
  })

  it('climbs, cruises and descends', () => {
    const len = routeLengthNm(r)
    expect(routePointAt(r, 0).altitudeFt).toBe(0)
    expect(routePointAt(r, 75).altitudeFt).toBeCloseTo(17500, 6)
    expect(routePointAt(r, 1000).altitudeFt).toBe(35000)
    expect(routePointAt(r, len).altitudeFt).toBeCloseTo(0, 6)
  })

  it('points the course along the great circle (north at the start of a leg toward the pole)', () => {
    expect(routePointAt(r, 10).courseDeg).toBeCloseTo(0, 3)
    const end = routePointAt(r, routeLengthNm(r))
    expect(end.pos.lat).toBeCloseTo(40, 6)
  })

  it('computes signed longitude differences', () => {
    expect(lonDiffDeg(170, -170)).toBeCloseTo(20, 9)
    expect(lonDiffDeg(-170, 170)).toBeCloseTo(-20, 9)
  })
})
