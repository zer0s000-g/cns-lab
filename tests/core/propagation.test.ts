import { describe, expect, it } from 'vitest'
import {
  earthBulgeFt,
  earthDropFt,
  EFFECTIVE_K_FACTOR,
  freeSpacePathLossDb,
  freeSpacePathLossDbNm,
  groundDistanceFromSlantNm,
  lineOfSight,
  minHeightForLineOfSightFt,
  radioHorizonNm,
  radioLineOfSightNm,
  rangeFromRoundTripNm,
  rayHeightFt,
  receivedPowerDbm,
  roundTripTimeUs,
  slantRangeNm,
  travelTimeS,
  travelTimeUs,
} from '@/core/propagation'
import { ROUND_TRIP_US_PER_NM } from '@/core/units'

describe('radio line of sight', () => {
  it('uses 1.23 × (√h_tx + √h_rx) NM with heights in feet', () => {
    expect(radioHorizonNm(10000)).toBeCloseTo(123)
    expect(radioLineOfSightNm(100, 10000)).toBeCloseTo(1.23 * (10 + 100))
    expect(radioLineOfSightNm(0, 0)).toBe(0)
  })
  it('a 36,000 ft aircraft and a 100 ft antenna are about 246 NM apart at most', () => {
    expect(radioLineOfSightNm(100, 36000)).toBeCloseTo(245.7, 1)
  })
  it('implies an effective Earth of about 4/3 the real radius', () => {
    expect(EFFECTIVE_K_FACTOR).toBeGreaterThan(1.3)
    expect(EFFECTIVE_K_FACTOR).toBeLessThan(1.37)
  })
  it('minHeightForLineOfSight inverts the range formula', () => {
    const h = minHeightForLineOfSightFt(100, 150)
    expect(radioLineOfSightNm(100, h)).toBeCloseTo(150, 6)
    expect(minHeightForLineOfSightFt(10000, 20)).toBe(0)
  })
  it('earth drop at the horizon equals the antenna height', () => {
    for (const h of [25, 400, 10000, 35000]) {
      expect(earthDropFt(radioHorizonNm(h))).toBeCloseTo(h, 6)
    }
  })
  it('bulge is zero at the ends and largest in the middle', () => {
    expect(earthBulgeFt(0, 100)).toBe(0)
    expect(earthBulgeFt(100, 100)).toBe(0)
    expect(earthBulgeFt(50, 100)).toBeGreaterThan(earthBulgeFt(20, 100))
  })
  it('ray height interpolates between the ends', () => {
    expect(rayHeightFt(0, 50, 100, 5000)).toBe(100)
    expect(rayHeightFt(50, 50, 100, 5000)).toBe(5000)
  })
})

describe('terrain-aware line of sight agrees with the horizon formula', () => {
  const tx = { x: 0, y: 0 }
  it('smooth Earth: visible just inside the radio horizon, blocked just outside', () => {
    const hTx = 100
    const hRx = 10000
    const dMax = radioLineOfSightNm(hTx, hRx)
    expect(lineOfSight(tx, hTx, { x: dMax * 0.99, y: 0 }, hRx, () => 0, 0.05).visible).toBe(true)
    expect(lineOfSight(tx, hTx, { x: dMax * 1.01, y: 0 }, hRx, () => 0, 0.05).visible).toBe(false)
  })
  it('a hill between the two antennas blocks the path', () => {
    const hill = (p: { x: number; y: number }) => (Math.abs(p.x - 20) < 1 ? 5000 : 0)
    const r = lineOfSight(tx, 100, { x: 40, y: 0 }, 3000, hill)
    expect(r.visible).toBe(false)
    expect(r.worstPoint.x).toBeGreaterThan(19)
    expect(r.worstPoint.x).toBeLessThan(21)
    // Climbing high enough clears the hill.
    expect(lineOfSight(tx, 100, { x: 40, y: 0 }, 12000, hill).visible).toBe(true)
  })
})

describe('free-space path loss', () => {
  it('matches the textbook value: 1 km at 1 GHz ≈ 92.4 dB', () => {
    expect(freeSpacePathLossDb(1000, 1e9)).toBeCloseTo(92.45, 1)
  })
  it('grows 6 dB per doubling of distance', () => {
    const a = freeSpacePathLossDbNm(10, 120)
    const b = freeSpacePathLossDbNm(20, 120)
    expect(b - a).toBeCloseTo(6.02, 2)
  })
  it('Friis budget subtracts path loss from power and gains', () => {
    const pr = receivedPowerDbm(40, 3, 0, 1000, 1e9)
    expect(pr).toBeCloseTo(40 + 3 - 92.45, 1)
  })
})

describe('slant range and timing', () => {
  it('directly over a DME at 6,000 ft reads about 1 NM', () => {
    expect(slantRangeNm(0, 6000)).toBeCloseTo(0.987, 3)
  })
  it('slant range approaches ground distance far away', () => {
    expect(slantRangeNm(100, 6000) - 100).toBeLessThan(0.01)
  })
  it('ground distance inverts slant range', () => {
    const s = slantRangeNm(7, 30000)
    expect(groundDistanceFromSlantNm(s, 30000)).toBeCloseTo(7, 9)
    expect(groundDistanceFromSlantNm(0.5, 30000)).toBe(0)
  })
  it('one nautical mile round trip takes about 12.36 µs', () => {
    expect(ROUND_TRIP_US_PER_NM).toBeCloseTo(12.355, 2)
    expect(roundTripTimeUs(1)).toBeCloseTo(12.355, 2)
    expect(travelTimeUs(1)).toBeCloseTo(6.178, 2)
  })
  it('range from echo time inverts round-trip time (R = c·t/2)', () => {
    expect(rangeFromRoundTripNm(roundTripTimeUs(37.5))).toBeCloseTo(37.5, 9)
  })
  it('GEO altitude one way ≈ 0.12 s', () => {
    expect(travelTimeS(35_786_000)).toBeCloseTo(0.1194, 3)
  })
})
