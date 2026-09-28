import { describe, expect, it } from 'vitest'
import {
  ADSC_EVENT_TEXT,
  ADSC_LATENCY_S,
  adscEventsTriggered,
  adscLatencyS,
  airbornePositionMe,
  broadcastIntervalS,
  cprDecodeGlobal,
  cprDecodeLocal,
  cprEncode,
  cprNL,
  crossRangeSigmaNm,
  crossTrackFromLegNm,
  decodeAltitude12,
  decodeCallsign,
  decodeEs,
  df17,
  displayOffset,
  encodeAltitude12,
  encodeCallsign,
  EPU95_PER_SIGMA,
  gaussMarkovStep,
  geoHopDelayS,
  geoSlantRangeKm,
  GEO_ALTITUDE_KM,
  IDENT_INTERVAL_S,
  identificationMe,
  jammingLevel,
  MSSR_ACCURACY,
  NACP_TABLE,
  nacpForEpuM,
  nacpInfo,
  NIC_TABLE,
  nicFromTypeCode,
  nicInfo,
  noPositionMe,
  POSITION_INTERVAL_S,
  positionTypeCode,
  qualityUnderJamming,
  radarMeasure,
  relativeAltitudeTag,
  sigmaNmForEpuM,
  UAT_FREQ_MHZ,
  ES_FREQ_MHZ,
  VELOCITY_INTERVAL_S,
  velocityComponents,
  velocityMe,
  type AdscEventContract,
  type AdscSample,
  type Jammer,
} from '@/core/ads'
import { bitsToHex, hexToBits, modeSCrcRemainder } from '@/core/ssr'
import { distanceNm, greatCircleDistanceNm } from '@/core/geometry'
import { gaussian, mulberry32 } from '@/core/random'

describe('frequencies and rates', () => {
  it('1090 MHz extended squitter, UAT on 978 MHz', () => {
    expect(ES_FREQ_MHZ).toBe(1090)
    expect(UAT_FREQ_MHZ).toBe(978)
  })

  it('position and velocity about twice a second, identification about every 5 s', () => {
    const mean = (r: readonly [number, number]) => (r[0] + r[1]) / 2
    expect(1 / mean(POSITION_INTERVAL_S)).toBeCloseTo(2, 6)
    expect(1 / mean(VELOCITY_INTERVAL_S)).toBeCloseTo(2, 6)
    expect(mean(IDENT_INTERVAL_S)).toBeCloseTo(5, 6)
    expect(broadcastIntervalS(POSITION_INTERVAL_S, 0)).toBe(0.4)
    expect(broadcastIntervalS(POSITION_INTERVAL_S, 0.999999)).toBeLessThan(0.6)
  })
})

describe('quality indicators', () => {
  it('NACp and NIC tables are ordered, with 0 meaning unknown', () => {
    for (const t of [NACP_TABLE, NIC_TABLE]) {
      for (let i = 1; i < t.length - 1; i++) expect(t[i].boundM!).toBeGreaterThan(t[i - 1].boundM!)
      expect(t[t.length - 1]).toMatchObject({ value: 0, boundM: null })
    }
    expect(nacpInfo(11).boundM).toBe(3)
    expect(nacpInfo(10).boundM).toBe(10)
    expect(nacpInfo(9).boundM).toBe(30)
    expect(nacpInfo(8).boundM).toBeCloseTo(0.05 * 1852, 6)
    expect(nacpInfo(6).boundM).toBeCloseTo(0.3 * 1852, 6)
    expect(nicInfo(8).boundM).toBeCloseTo(0.1 * 1852, 6)
    expect(nicInfo(7).boundM).toBeCloseTo(0.2 * 1852, 6)
    expect(nicInfo(0).text).toBe('unknown')
  })

  it('picks the NACp whose bound contains the error, and converts a 95% bound to σ', () => {
    expect(nacpForEpuM(5)).toBe(10)
    expect(nacpForEpuM(2)).toBe(11)
    expect(nacpForEpuM(400)).toBe(6)
    expect(nacpForEpuM(1e6)).toBe(0)
    expect(EPU95_PER_SIGMA).toBeCloseTo(2.4477, 3)
    // 95% of a 2D Gaussian falls inside the bound.
    const rand = mulberry32(3)
    const sigma = sigmaNmForEpuM(100)
    let inside = 0
    const n = 20000
    for (let i = 0; i < n; i++) if (Math.hypot(gaussian(rand) * sigma, gaussian(rand) * sigma) * 1852 < 100) inside++
    expect(inside / n).toBeGreaterThan(0.94)
    expect(inside / n).toBeLessThan(0.96)
  })
})

describe('callsign and altitude fields', () => {
  it('round-trips callsigns in the 6-bit character set', () => {
    expect(decodeCallsign(encodeCallsign('CNS101'))).toBe('CNS101')
    expect(encodeCallsign('KLM1023').length).toBe(48)
    expect(() => encodeCallsign('AB-1')).toThrow()
  })

  it('12-bit altitude in 25 ft steps', () => {
    for (const a of [-1000, 0, 2500, 12000, 35025, 41000]) expect(decodeAltitude12(encodeAltitude12(a))).toBe(a)
    expect(decodeAltitude12(encodeAltitude12(38000))).toBe(38000)
  })
})

describe('known extended squitter messages', () => {
  it('decodes the classic identification message (KLM1023)', () => {
    const d = decodeEs('8D4840D6202CC371C32CE0576098')
    expect(d).toMatchObject({ df: 17, address: 0x4840d6, tc: 4, kind: 'identification', callsign: 'KLM1023', crcOk: true })
  })

  it('encodes the same identification message bit for bit', () => {
    const bits = df17(0x4840d6, [...identificationMe('KLM1023', 'medium').slice(0, 5), 0, 0, 0, ...identificationMe('KLM1023', 'medium').slice(8)])
    expect(bitsToHex(bits)).toBe('8D4840D6202CC371C32CE0576098')
  })

  it('decodes the classic airborne position pair (52.2572°, 3.91937°, 38,000 ft)', () => {
    const e = decodeEs('8D40621D58C382D690C8AC2863A7')
    const o = decodeEs('8D40621D58C386435CC412692AD6')
    expect(e.kind).toBe('position')
    expect(e.crcOk && o.crcOk).toBe(true)
    expect(e.altitudeFt).toBe(38000)
    expect(e.cpr).toEqual({ odd: false, yz: 93000, xz: 51372 })
    expect(o.cpr).toEqual({ odd: true, yz: 74158, xz: 50194 })
    const p = cprDecodeGlobal(e.cpr!, o.cpr!, 'even')!
    expect(p.lat).toBeCloseTo(52.2572, 4)
    expect(p.lon).toBeCloseTo(3.91937, 4)
    // Local decode with a nearby reference gives the same answer.
    const l = cprDecodeLocal({ lat: 52.3, lon: 3.9 }, e.cpr!)
    expect(l.lat).toBeCloseTo(p.lat, 9)
    expect(l.lon).toBeCloseTo(p.lon, 9)
  })

  it('decodes the classic airborne velocity message (159 kt, track 182.88°, −832 ft/min)', () => {
    const v = decodeEs('8D485020994409940838175B284F')
    expect(v.kind).toBe('velocity')
    expect(v.crcOk).toBe(true)
    expect(v.groundSpeedKt!).toBeCloseTo(159.2, 1)
    expect(v.trackDeg!).toBeCloseTo(182.88, 2)
    expect(v.verticalRateFpm).toBe(-832)
  })
})

describe('CPR encoding', () => {
  it('has 59 longitude zones at the equator and 1 at the poles, decreasing with latitude', () => {
    expect(cprNL(0)).toBe(59)
    expect(cprNL(87)).toBe(2)
    expect(cprNL(89)).toBe(1)
    expect(cprNL(-6.2)).toBe(cprNL(6.2))
    for (let lat = 0; lat < 86; lat += 1) expect(cprNL(lat + 1)).toBeLessThanOrEqual(cprNL(lat))
  })

  it('encodes the classic example back to the transmitted values', () => {
    const e = cprEncode({ lat: 52.2572021484375, lon: 3.91937255859375 }, false)
    expect(Math.abs(e.yz - 93000)).toBeLessThanOrEqual(1)
    expect(Math.abs(e.xz - 51372)).toBeLessThanOrEqual(1)
  })

  it('round-trips positions to within about 5 m, globally and locally', () => {
    const rand = mulberry32(11)
    for (let i = 0; i < 400; i++) {
      const p = { lat: -60 + 120 * rand(), lon: -180 + 360 * rand() }
      const e = cprEncode(p, false)
      const o = cprEncode(p, true)
      for (const newest of ['even', 'odd'] as const) {
        const g = cprDecodeGlobal(e, o, newest)
        if (!g) continue // pair straddles a zone boundary: receivers wait for the next pair
        expect(greatCircleDistanceNm(p, g) * 1852).toBeLessThan(6)
      }
      const ref = { lat: p.lat + (rand() - 0.5) * 2, lon: p.lon + (rand() - 0.5) * 2 }
      const l = cprDecodeLocal(ref, o)
      expect(greatCircleDistanceNm(p, l) * 1852).toBeLessThan(6)
    }
  })
})

describe('message building', () => {
  it('builds valid 112-bit position, velocity and identification messages that decode back', () => {
    const addr = 0x8a0101
    const pos = { lat: -6.4, lon: 107.1 }
    const pm = df17(addr, airbornePositionMe({ nic: 8, altitudeFt: 12000, pos, odd: true }))
    expect(pm.length).toBe(112)
    expect(modeSCrcRemainder(pm)).toBe(0)
    const d = decodeEs(pm)
    expect(d).toMatchObject({ kind: 'position', nic: 8, altitudeFt: 12000, address: addr })
    const back = cprDecodeLocal({ lat: -6.2, lon: 106.8 }, d.cpr!)
    expect(greatCircleDistanceNm(pos, back) * 1852).toBeLessThan(6)

    const { eastKt, northKt } = velocityComponents(280, 90)
    const v = decodeEs(df17(addr, velocityMe({ eastKt, northKt, verticalRateFpm: 1500 })))
    expect(v.groundSpeedKt!).toBeCloseTo(280, 0)
    expect(v.trackDeg!).toBeCloseTo(90, 0)
    expect(v.verticalRateFpm).toBe(1472) // nearest 64 ft/min step

    const s = decodeEs(df17(addr, identificationMe('CNS101', 'heavy')))
    expect(s).toMatchObject({ kind: 'identification', callsign: 'CNS101', category: 5 })

    const np = decodeEs(df17(addr, noPositionMe(8000)))
    expect(np).toMatchObject({ kind: 'no-position', altitudeFt: 8000, nic: 0 })
  })

  it('maps NIC to the position type code and back', () => {
    for (const nic of [11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]) {
      const { tc, nicB } = positionTypeCode(nic)
      expect(tc).toBeGreaterThanOrEqual(9)
      expect(tc).toBeLessThanOrEqual(18)
      expect(nicFromTypeCode(tc, nicB)).toBe(nic)
    }
  })

  it('a flipped bit is caught by the CRC', () => {
    const bits = hexToBits('8D485020994409940838175B284F')
    bits[60] ^= 1
    expect(decodeEs(bits).crcOk).toBe(false)
  })
})

describe('errors: GNSS wander and radar plots', () => {
  it('Gauss–Markov error keeps the requested spread', () => {
    const rand = mulberry32(8)
    const g = () => gaussian(rand)
    let e = { x: 0, y: 0 }
    let sum = 0
    const n = 20000
    for (let i = 0; i < n; i++) {
      e = gaussMarkovStep(e, 0.5, 0.1, 5, g)
      sum += e.x * e.x
    }
    expect(Math.sqrt(sum / n)).toBeGreaterThan(0.085)
    expect(Math.sqrt(sum / n)).toBeLessThan(0.115)
    expect(gaussMarkovStep(e, 0, 0.1, 5, g)).toBe(e)
  })

  it('radar sideways error grows in proportion to range', () => {
    expect(crossRangeSigmaNm(60, 0.07)).toBeCloseTo(2 * crossRangeSigmaNm(30, 0.07), 9)
    expect(crossRangeSigmaNm(30, 0.07) * 1852).toBeGreaterThan(60)
    expect(crossRangeSigmaNm(30, 0.07) * 1852).toBeLessThan(75)
    const rand = mulberry32(2)
    const g = () => gaussian(rand)
    const spread = (r: number) => {
      let s = 0
      for (let i = 0; i < 4000; i++) {
        const m = radarMeasure({ x: 0, y: 0 }, { x: 0, y: r }, MSSR_ACCURACY, g)
        s += m.x * m.x
      }
      return Math.sqrt(s / 4000)
    }
    expect(spread(100) / spread(20)).toBeGreaterThan(4)
    expect(spread(100) / spread(20)).toBeLessThan(6)
  })
})

describe('GNSS jamming', () => {
  const j: Jammer = { pos: { x: 0, y: 0 }, heightFt: 30, degradeRadiusNm: 40, denyRadiusNm: 20 }

  it('has no effect outside the footprint or without line of sight, and loses the fix near the jammer', () => {
    expect(jammingLevel(50, true, j)).toBe(0)
    expect(jammingLevel(10, false, j)).toBe(0)
    expect(jammingLevel(10, true, j)).toBe(1)
    expect(jammingLevel(30, true, j)).toBeCloseTo(0.5, 9)
  })

  it('quality falls as jamming rises, then NIC and NACp drop to 0 when the fix is lost', () => {
    const base = { nacp: 10, nic: 8 }
    expect(qualityUnderJamming(base, 0)).toEqual({ nacp: 10, nic: 8, lost: false })
    const half = qualityUnderJamming(base, 0.5)
    expect(half.nacp).toBeLessThan(10)
    expect(half.nacp).toBeGreaterThanOrEqual(5)
    expect(half.nic).toBeLessThan(8)
    const nearly = qualityUnderJamming(base, 0.99)
    expect(nearly.nacp).toBeLessThanOrEqual(half.nacp)
    expect(qualityUnderJamming(base, 1)).toEqual({ nacp: 0, nic: 0, lost: true })
  })
})

describe('ADS-B In helpers', () => {
  it('relative altitude tags in hundreds of feet', () => {
    expect(relativeAltitudeTag(10000, 10500)).toBe('+05')
    expect(relativeAltitudeTag(10000, 7700)).toBe('−23')
    expect(relativeAltitudeTag(10000, 10020)).toBe('00')
  })

  it('track-up rotation puts traffic ahead at the top and traffic to the right on the right', () => {
    const own = { x: 0, y: 0 }
    // Own track east (090°T). Traffic 5 NM east is dead ahead → straight up.
    const ahead = displayOffset(own, 90, { x: 5, y: 0 })
    expect(ahead.x).toBeCloseTo(0, 9)
    expect(ahead.y).toBeCloseTo(5, 9)
    // Traffic 5 NM south is on the right-hand side when flying east.
    const right = displayOffset(own, 90, { x: 0, y: -5 })
    expect(right.x).toBeCloseTo(5, 9)
    expect(right.y).toBeCloseTo(0, 9)
    // North-up leaves the picture as on the map.
    expect(displayOffset(own, 0, { x: 3, y: 4 })).toEqual({ x: 3, y: 4 })
    expect(Math.hypot(ahead.x, ahead.y)).toBeCloseTo(distanceNm(own, { x: 5, y: 0 }), 9)
  })
})

describe('ADS-C', () => {
  const contract: AdscEventContract = {
    altitudeRange: { floorFt: 34700, ceilingFt: 35300 },
    lateralDeviationNm: 5,
    verticalRateFpm: 1500,
    waypointChange: true,
  }
  const s = (over: Partial<AdscSample>): AdscSample => ({ altitudeFt: 35000, crossTrackNm: 0, verticalRateFpm: 0, nextWaypoint: 1, ...over })

  it('fires each event once, on the edge where the limit is crossed', () => {
    expect(adscEventsTriggered(s({}), s({}), contract)).toEqual([])
    expect(adscEventsTriggered(s({}), s({ altitudeFt: 35400 }), contract)).toEqual(['altitude-range'])
    expect(adscEventsTriggered(s({ altitudeFt: 35400 }), s({ altitudeFt: 35600 }), contract)).toEqual([])
    expect(adscEventsTriggered(s({ crossTrackNm: 4.9 }), s({ crossTrackNm: 5.1 }), contract)).toEqual(['lateral-deviation'])
    expect(adscEventsTriggered(s({ crossTrackNm: -4.9 }), s({ crossTrackNm: -5.1 }), contract)).toEqual(['lateral-deviation'])
    expect(adscEventsTriggered(s({ verticalRateFpm: 1000 }), s({ verticalRateFpm: 1800 }), contract)).toEqual(['vertical-rate'])
    expect(adscEventsTriggered(s({ nextWaypoint: 1 }), s({ nextWaypoint: 2 }), contract)).toEqual(['waypoint-change'])
    const none: AdscEventContract = { altitudeRange: null, lateralDeviationNm: null, verticalRateFpm: null, waypointChange: false }
    expect(adscEventsTriggered(s({}), s({ altitudeFt: 20000, crossTrackNm: 50, verticalRateFpm: 4000, nextWaypoint: 3 }), none)).toEqual([])
    for (const k of Object.keys(ADSC_EVENT_TEXT)) expect(ADSC_EVENT_TEXT[k as keyof typeof ADSC_EVENT_TEXT].length).toBeGreaterThan(5)
  })

  it('delivery takes tens of seconds, the radio hop only a quarter of a second', () => {
    expect(adscLatencyS(0)).toBe(ADSC_LATENCY_S[0])
    expect(adscLatencyS(0.5)).toBeGreaterThan(20)
    expect(adscLatencyS(0.99)).toBeLessThan(90)
    expect(geoSlantRangeKm(90)).toBeCloseTo(GEO_ALTITUDE_KM, 6)
    expect(geoSlantRangeKm(0)).toBeGreaterThan(41000)
    const hop = geoHopDelayS(30, 30)
    expect(hop).toBeGreaterThan(0.24)
    expect(hop).toBeLessThan(0.28)
  })

  it('measures distance from the cleared route, positive to the right', () => {
    const a = { x: 0, y: 0 }
    const b = { x: 100, y: 0 } // eastbound leg
    expect(crossTrackFromLegNm({ x: 50, y: -10 }, a, b)).toBeCloseTo(10, 9) // south = right
    expect(crossTrackFromLegNm({ x: 50, y: 7 }, a, b)).toBeCloseTo(-7, 9)
  })
})
