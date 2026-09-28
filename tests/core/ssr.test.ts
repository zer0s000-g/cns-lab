import { describe, expect, it } from 'vitest'
import {
  addressFromAp,
  altitudeField25,
  altitudeFromField25,
  bitsToHex,
  bitsToNumber,
  bitsToSquawk,
  buildDf11,
  buildDf4,
  buildDf5,
  changedPulses,
  CODE_PULSES,
  CONTROL_LEVEL_DB,
  decodeGillham,
  decodeReplyPulses,
  decodeSurveillanceReply,
  digitPulses,
  downlinkDbm,
  emptyBits,
  encodeGillham,
  F1_F2_US,
  flightStatus,
  formatFlightLevel,
  formatIcaoAddress,
  GARBLE_RANGE_NM,
  GROUND_RECEIVER_MTL_DBM,
  grayDecode,
  grayEncode,
  hexToBits,
  identityField,
  identityFromField,
  interrogationPulses,
  isValidSquawk,
  MAIN_BEAM_MTL_RANGE_NM,
  MODE_C_MAX_FT,
  MODE_C_MIN_FT,
  MODE_S_ADDRESS_COUNT,
  modeCReportedFt,
  modeSCrcRemainder,
  modeSParity,
  modeSReplyUs,
  numberToBits,
  P1_P3_US,
  parseSquawk,
  ppmDecode,
  ppmPulseTimesUs,
  rangeFromReplyUs,
  REPLY_LENGTH_US,
  REPLY_SLOTS,
  replyArrivalUs,
  replyDurationUs,
  replyPulseTimes,
  replyPulseTrain,
  repliesOverlap,
  replyWindowUs,
  slotTimeUs,
  slsDecision,
  slsReplyHalfAngleDeg,
  specialCode,
  SQUAWK_CODE_COUNT,
  squawkToBits,
  SSR_BEAM_WIDTH_DEG,
  ssrControlPatternDb,
  ssrPatternDb,
  TRANSPONDER_DELAY_US,
  TRANSPONDER_MTL_DBM,
  transponderReplies,
  uplinkP1Dbm,
  uplinkP2Dbm,
  NO_CODE_ASSIGNED,
  VFR_CODE,
} from '@/core/ssr'
import { LIGHT_NM_PER_US } from '@/core/units'

describe('interrogation pulses', () => {
  it('Mode A spaces P1 and P3 by 8 µs, Mode C by 21 µs, P2 is 2 µs after P1 from the control antenna', () => {
    expect(P1_P3_US).toEqual({ A: 8, C: 21 })
    const a = interrogationPulses('A')
    expect(a.map((p) => p.tUs)).toEqual([0, 2, 8])
    expect(a[1].antenna).toBe('control')
    expect(a[0].antenna).toBe('directional')
    expect(interrogationPulses('C')[2].tUs).toBe(21)
    for (const p of a) expect(p.widthUs).toBeCloseTo(0.8, 9)
  })
})

describe('reply pulse train', () => {
  it('places the 13 slots at 1.45 µs steps and F2 at 20.3 µs', () => {
    expect(REPLY_SLOTS).toEqual(['C1', 'A1', 'C2', 'A2', 'C4', 'A4', 'X', 'B1', 'D1', 'B2', 'D2', 'B4', 'D4'])
    expect(slotTimeUs('C1')).toBeCloseTo(1.45, 9)
    expect(slotTimeUs('X')).toBeCloseTo(10.15, 9)
    expect(slotTimeUs('D4')).toBeCloseTo(18.85, 9)
    expect(F1_F2_US).toBeCloseTo(14 * 1.45, 9)
    expect(REPLY_LENGTH_US).toBeCloseTo(20.75, 9)
  })

  it('sends framing pulses, the code pulses that are 1, never X, and SPI 4.35 µs after F2', () => {
    const t = replyPulseTrain(squawkToBits('7700'), true)
    const names = t.map((p) => p.name)
    expect(names[0]).toBe('F1')
    expect(names).toContain('F2')
    expect(names).not.toContain('X')
    expect(t.find((p) => p.name === 'SPI')!.tUs).toBeCloseTo(24.65, 9)
    // 7700: A=7 (A4 A2 A1) B=7 (B4 B2 B1), C=0, D=0 → 6 code pulses
    expect(t.length).toBe(2 + 6 + 1)
    expect(replyPulseTrain(squawkToBits('0000')).map((p) => p.name)).toEqual(['F1', 'F2'])
    expect(replyDurationUs(false)).toBeCloseTo(20.75, 9)
    expect(replyDurationUs(true)).toBeCloseTo(25.1, 9)
    const times = replyPulseTimes(100, squawkToBits('0000'), false)
    expect(times[0]).toBe(100)
    expect(times[1]).toBeCloseTo(120.3, 9)
  })
})

describe('squawk codes', () => {
  it('has 4096 octal codes and rejects 8 and 9', () => {
    expect(SQUAWK_CODE_COUNT).toBe(8 ** 4)
    expect(isValidSquawk('7777')).toBe(true)
    expect(isValidSquawk('0000')).toBe(true)
    expect(isValidSquawk('7800')).toBe(false)
    expect(isValidSquawk('123')).toBe(false)
    const bad = parseSquawk('1289')
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toMatch(/0 to 7/)
    expect(parseSquawk('12').ok).toBe(false)
    expect(parseSquawk('12a4').ok).toBe(false)
    expect(parseSquawk(' 7600 ')).toEqual({ ok: true, code: '7600' })
  })

  it('encodes digit A as A4·4 + A2·2 + A1 (and likewise B, C, D), and round-trips all 4096 codes', () => {
    const b = squawkToBits('5321')
    expect([b.A4, b.A2, b.A1]).toEqual([true, false, true]) // 5
    expect([b.B4, b.B2, b.B1]).toEqual([false, true, true]) // 3
    expect([b.C4, b.C2, b.C1]).toEqual([false, true, false]) // 2
    expect([b.D4, b.D2, b.D1]).toEqual([false, false, true]) // 1
    expect(digitPulses('B')).toEqual(['B4', 'B2', 'B1'])
    let n = 0
    for (let v = 0; v < 4096; v++) {
      const code = v.toString(8).padStart(4, '0')
      expect(bitsToSquawk(squawkToBits(code))).toBe(code)
      n++
    }
    expect(n).toBe(4096)
    expect(() => squawkToBits('8000')).toThrow()
  })

  it('knows the special codes', () => {
    expect(specialCode('7500')?.kind).toBe('hijack')
    expect(specialCode('7600')?.kind).toBe('radio')
    expect(specialCode('7700')?.kind).toBe('emergency')
    expect(specialCode('7700')?.tag).toBe('EMERGENCY')
    expect(specialCode('1234')).toBeNull()
    expect(VFR_CODE).toBe('7000')
    expect(NO_CODE_ASSIGNED).toBe('2000')
  })
})

describe('Gray code', () => {
  it('neighbours differ in one bit and decoding inverts encoding', () => {
    for (let n = 0; n < 1024; n++) {
      expect(grayDecode(grayEncode(n))).toBe(n)
      const d = grayEncode(n) ^ grayEncode(n + 1)
      expect(d & (d - 1)).toBe(0)
      expect(d).not.toBe(0)
    }
  })
})

describe('Mode C (Gillham) altitude code', () => {
  it('reports the nearest 100 ft inside −1,200 … 126,700 ft', () => {
    expect(modeCReportedFt(12049)).toBe(12000)
    expect(modeCReportedFt(12051)).toBe(12100)
    expect(modeCReportedFt(-1249)).toBe(-1200)
    expect(modeCReportedFt(-1300)).toBeNull()
    expect(modeCReportedFt(126749)).toBe(126700)
    expect(modeCReportedFt(126800)).toBeNull()
    expect(encodeGillham(200000)).toBeNull()
  })

  it('round-trips every altitude in 100 ft steps', () => {
    let count = 0
    for (let alt = MODE_C_MIN_FT; alt <= MODE_C_MAX_FT; alt += 100) {
      const bits = encodeGillham(alt)!
      expect(bits).not.toBeNull()
      expect(decodeGillham(bits)).toBe(alt)
      count++
    }
    expect(count).toBe(1280)
  })

  it('changes exactly one pulse for every 100 ft step', () => {
    for (let alt = MODE_C_MIN_FT; alt < MODE_C_MAX_FT; alt += 100) {
      const d = changedPulses(encodeGillham(alt)!, encodeGillham(alt + 100)!)
      expect(d.length).toBe(1)
    }
  })

  it('matches the worked examples of the encoding rule', () => {
    // −1,200 ft: k = 0, F = 0, H = 1 → C4 only.
    const low = encodeGillham(-1200)!
    expect(CODE_PULSES.filter((p) => low[p])).toEqual(['C4'])
    // −700 ft: k = 5, F = 1 (odd), H = 1 → H' = 5 → 7 → C1; 500 ft group Gray(1) → B4.
    const b = encodeGillham(-700)!
    expect(CODE_PULSES.filter((p) => b[p]).sort()).toEqual(['B4', 'C1'])
    // Never uses the X position or the SPI; the D1 pulse stays 0 below 126,750 ft.
    for (let alt = MODE_C_MIN_FT; alt <= MODE_C_MAX_FT; alt += 100) expect(encodeGillham(alt)!.D1).toBe(false)
  })

  it('rejects illegal 100 ft groups', () => {
    const bits = emptyBits() // C1 C2 C4 = 000 is illegal
    expect(decodeGillham(bits)).toBeNull()
    const b2 = encodeGillham(5000)!
    b2.C1 = true
    b2.C2 = true
    b2.C4 = true // 111 → 5 → illegal
    expect(decodeGillham(b2)).toBeNull()
  })

  it('formats flight levels with three digits', () => {
    expect(formatFlightLevel(12000)).toBe('120')
    expect(formatFlightLevel(2500)).toBe('025')
    expect(formatFlightLevel(35000)).toBe('350')
  })
})

describe('timing, range and garbling', () => {
  it('range from reply time: R = c(t − 3 µs)/2', () => {
    expect(TRANSPONDER_DELAY_US).toBe(3)
    const t = replyArrivalUs(30)
    expect(t).toBeCloseTo((2 * 30) / LIGHT_NM_PER_US + 3, 9)
    expect(rangeFromReplyUs(t)).toBeCloseTo(30, 9)
    expect(rangeFromReplyUs(3)).toBeCloseTo(0, 9)
  })

  it('replies overlap when slant ranges differ by less than c·20.75 µs/2 ≈ 1.68 NM', () => {
    expect(GARBLE_RANGE_NM).toBeCloseTo((LIGHT_NM_PER_US * 20.75) / 2, 9)
    expect(GARBLE_RANGE_NM).toBeGreaterThan(1.67)
    expect(GARBLE_RANGE_NM).toBeLessThan(1.69)
    expect(repliesOverlap(20, 21)).toBe(true)
    expect(repliesOverlap(20, 21.7)).toBe(false)
    const w = replyWindowUs(10, true)
    expect(w[1] - w[0]).toBeCloseTo(25.1, 9)
  })
})

describe('reply decoder', () => {
  const train = (f1: number, code: string, spi = false) => replyPulseTimes(f1, squawkToBits(code), spi)

  it('decodes a clean reply', () => {
    const r = decodeReplyPulses(train(50, '4521'))
    expect(r.length).toBe(1)
    expect(r[0].f1Us).toBe(50)
    expect(bitsToSquawk(r[0].bits)).toBe('4521')
    expect(r[0].garbled).toBe(false)
    expect(r[0].xPulse).toBe(false)
  })

  it('reads the SPI pulse and does not mistake C2 + SPI for a second reply', () => {
    // Third digit (C) = 2 sets C2.
    const r = decodeReplyPulses(train(0, '0020', true))
    expect(r.length).toBe(1)
    expect(r[0].spi).toBe(true)
    expect(bitsToSquawk(r[0].bits)).toBe('0020')
    expect(r[0].garbled).toBe(false)
  })

  it('marks two overlapping replies as garbled', () => {
    const dt = (2 * 1.0) / LIGHT_NM_PER_US // 1 NM apart → 12.4 µs
    const r = decodeReplyPulses([...train(100, '1234'), ...train(100 + dt, '5670')])
    expect(r.length).toBeGreaterThanOrEqual(2)
    expect(r.every((x) => x.garbled)).toBe(true)
  })

  it('keeps replies that do not overlap apart and clean', () => {
    // 2.5 NM apart → 30.9 µs. (At exactly 2.0 NM the second F1 would sit in the first reply's SPI position.)
    const dt = (2 * 2.5) / LIGHT_NM_PER_US
    const r = decodeReplyPulses([...train(100, '1234'), ...train(100 + dt, '5670')])
    expect(r.map((x) => bitsToSquawk(x.bits))).toEqual(['1234', '5670'])
    expect(r.some((x) => x.garbled)).toBe(false)
  })

  it('merges replies that arrive at exactly the same time into one wrong code (undetectable garble)', () => {
    const r = decodeReplyPulses([...train(100, '1000'), ...train(100.02, '0200')])
    expect(r.length).toBe(1)
    expect(bitsToSquawk(r[0].bits)).toBe('1200')
    expect(r[0].garbled).toBe(false)
  })
})

describe('antenna patterns and side-lobe suppression', () => {
  it('main beam peaks at 0 dB and is about −3 dB at half the beam width', () => {
    expect(ssrPatternDb(0)).toBeCloseTo(0, 6)
    expect(ssrPatternDb(SSR_BEAM_WIDTH_DEG / 2)).toBeGreaterThan(-3.1)
    expect(ssrPatternDb(SSR_BEAM_WIDTH_DEG / 2)).toBeLessThan(-2.8)
    expect(ssrPatternDb(-10)).toBeCloseTo(ssrPatternDb(10), 9)
    expect(ssrPatternDb(370)).toBeCloseTo(ssrPatternDb(10), 9)
  })

  it('side lobes stay below the control (P2) level everywhere outside the main beam', () => {
    for (let d = 5; d <= 180; d += 0.25) {
      expect(ssrPatternDb(d)).toBeLessThan(ssrControlPatternDb(d))
      expect(ssrPatternDb(d)).toBeGreaterThanOrEqual(-61)
    }
    expect(CONTROL_LEVEL_DB).toBeLessThan(-9)
  })

  it('applies the SLS rule: reply at ≥ 9 dB, suppress when P2 ≥ P1', () => {
    expect(slsDecision(-50, -59)).toBe('reply')
    expect(slsDecision(-50, -50)).toBe('suppress')
    expect(slsDecision(-60, -50)).toBe('suppress')
    expect(slsDecision(-50, -55)).toBe('maybe')
  })

  it('replies in the main beam, is silenced by P2 in a side lobe, but answers the side lobe without P2', () => {
    const r = 6
    const main = uplinkP1Dbm(r, 0)
    const side = uplinkP1Dbm(r, 4.7) // first side lobe
    const p2 = uplinkP2Dbm(r)
    expect(main - p2).toBeGreaterThanOrEqual(9)
    expect(side).toBeGreaterThan(TRANSPONDER_MTL_DBM) // strong enough to trigger at 6 NM
    expect(transponderReplies(main, p2, 0.99)).toBe(true)
    expect(transponderReplies(side, p2, 0)).toBe(false)
    expect(transponderReplies(side, null, 0.99)).toBe(true)
    // Far away, the same side lobe is too weak to trigger at all.
    expect(uplinkP1Dbm(60, 4.7)).toBeLessThan(TRANSPONDER_MTL_DBM)
    // In the uncertain band the roll decides.
    const p1 = p2 + 4.5
    expect(transponderReplies(p1, p2, 0.2)).toBe(true)
    expect(transponderReplies(p1, p2, 0.8)).toBe(false)
  })

  it('main beam reaches the transponder threshold at the calibration range, and replies are heard there', () => {
    expect(uplinkP1Dbm(MAIN_BEAM_MTL_RANGE_NM, 0)).toBeCloseTo(TRANSPONDER_MTL_DBM, 4)
    expect(downlinkDbm(MAIN_BEAM_MTL_RANGE_NM, 0)).toBeGreaterThan(GROUND_RECEIVER_MTL_DBM)
  })

  it('one-way link: doubling the range costs 6 dB (R²), not 12 dB (R⁴)', () => {
    expect(uplinkP1Dbm(20, 0) - uplinkP1Dbm(40, 0)).toBeCloseTo(6.02, 1)
  })

  it('the always-reply zone is wider than the 3 dB beam but only a few degrees', () => {
    const h = slsReplyHalfAngleDeg()
    expect(ssrPatternDb(h) - CONTROL_LEVEL_DB).toBeGreaterThan(8.7)
    expect(2 * h).toBeGreaterThan(SSR_BEAM_WIDTH_DEG)
    expect(2 * h).toBeLessThan(3 * SSR_BEAM_WIDTH_DEG)
  })
})

describe('Mode S', () => {
  it('has 16,777,216 addresses and formats them as 6 hex digits', () => {
    expect(MODE_S_ADDRESS_COUNT).toBe(16_777_216)
    expect(formatIcaoAddress(0x8a1c2f)).toBe('8A1C2F')
    expect(formatIcaoAddress(0xab)).toBe('0000AB')
  })

  it('bit helpers round-trip', () => {
    expect(bitsToNumber(numberToBits(0xabcdef, 24))).toBe(0xabcdef)
    expect(bitsToHex(hexToBits('8D4840D6'))).toBe('8D4840D6')
  })

  it('CRC: a known ADS-B message has zero remainder, a corrupted one does not', () => {
    // Well-known DF17 identification message (KLM1023, address 4840D6).
    const bits = hexToBits('8D4840D6202CC371C32CE0576098')
    expect(bits.length).toBe(112)
    expect(modeSCrcRemainder(bits)).toBe(0)
    expect(modeSParity(bits)).toBe(0x576098)
    bits[40] ^= 1
    expect(modeSCrcRemainder(bits)).not.toBe(0)
  })

  it('DF11 all-call reply carries the address in clear with a valid parity', () => {
    const b = buildDf11(0x8a1c2f)
    expect(b.length).toBe(56)
    expect(bitsToNumber(b.slice(0, 5))).toBe(11)
    expect(bitsToNumber(b.slice(8, 32))).toBe(0x8a1c2f)
    expect(modeSCrcRemainder(b)).toBe(0)
  })

  it('DF5 and DF4 hide the address in the parity field (AP = parity XOR address)', () => {
    const d5 = buildDf5(0x8a1c2f, '7700', flightStatus(true, false))
    expect(d5.length).toBe(56)
    expect(addressFromAp(d5)).toBe(0x8a1c2f)
    const r5 = decodeSurveillanceReply(d5)
    expect(r5).toMatchObject({ df: 5, code: '7700', fs: 2, address: 0x8a1c2f })
    const d4 = buildDf4(0x8a1c2f, 12025, 0)
    const r4 = decodeSurveillanceReply(d4)
    expect(r4).toMatchObject({ df: 4, altitudeFt: 12025, address: 0x8a1c2f })
    // Remainder equals the address, so another address would not match.
    expect(modeSCrcRemainder(d5)).toBe(0x8a1c2f)
  })

  it('identity and 25 ft altitude fields round-trip', () => {
    for (const code of ['0000', '7700', '4521', '7777']) expect(identityFromField(identityField(code))).toBe(code)
    expect(identityField('0000')[6]).toBe(0) // X
    for (const alt of [-1000, 0, 12025, 35000, 41000]) expect(altitudeFromField25(altitudeField25(alt))).toBe(alt)
    const f = altitudeField25(35000)
    expect(f[6]).toBe(0) // M: feet
    expect(f[8]).toBe(1) // Q: 25 ft steps
  })

  it('flight status: alert and SPI', () => {
    expect(flightStatus(false, false)).toBe(0)
    expect(flightStatus(true, false)).toBe(2)
    expect(flightStatus(true, true)).toBe(4)
    expect(flightStatus(false, true)).toBe(5)
  })

  it('PPM: 8 µs preamble then 1 µs per bit, a 1 pulses early and a 0 late', () => {
    const p = ppmPulseTimesUs([1, 0, 1])
    expect(p.slice(0, 4)).toEqual([0, 1, 3.5, 4.5])
    expect(p.slice(4)).toEqual([8, 9.5, 10])
    expect(ppmDecode(p, 3)).toEqual([1, 0, 1])
    expect(modeSReplyUs(56)).toBe(64)
  })
})
