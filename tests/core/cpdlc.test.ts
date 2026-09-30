import { describe, expect, it } from 'vitest'
import {
  answerConnectionRequest,
  averageChallenge,
  checkUplink,
  CONTROLLER_REPLIES_TO_REQUEST,
  DEFAULT_CHALLENGE,
  deliveryRangeS,
  emptyLink,
  endService,
  formatElement,
  formatLevel,
  isClosingResponse,
  loseAllConnections,
  MESSAGE_ELEMENTS,
  messageResponseAttr,
  MIN_MODULO,
  needsResponse,
  nextMin,
  PATH_DELAY_S,
  RCP,
  rcpStatus,
  responseOptions,
  sampleDeliveryS,
  setNextDataAuthority,
  type AvionicsLink,
  simulateCpdlc,
  simulateVoice,
  validateLogon,
} from '@/core/cpdlc'
import { mulberry32 } from '@/core/random'

describe('message set', () => {
  it('uses the standard element numbers and texts', () => {
    expect(formatElement('UM20', { level: 370 })).toBe('CLIMB TO FL370')
    expect(formatElement('UM23', { level: 310 })).toBe('DESCEND TO FL310')
    expect(formatElement('UM117', { unit: 'XHBR', frequency: '132.350' })).toBe('CONTACT XHBR 132.350')
    expect(formatElement('UM120', { unit: 'XHBR', frequency: '132.350' })).toBe('MONITOR XHBR 132.350')
    expect(formatElement('DM6', { level: 390 })).toBe('REQUEST FL390')
    expect(['DM0', 'DM1', 'DM2', 'DM3', 'DM4', 'DM5'].map((d) => MESSAGE_ELEMENTS[d].template)).toEqual(['WILCO', 'UNABLE', 'STANDBY', 'ROGER', 'AFFIRM', 'NEGATIVE'])
    expect(formatLevel(90)).toBe('FL090')
    expect(() => formatElement('UM999')).toThrow()
  })

  it('makes clearances need WILCO or UNABLE, with STANDBY allowed first', () => {
    expect(MESSAGE_ELEMENTS.UM20.resp).toBe('W/U')
    expect(MESSAGE_ELEMENTS.UM117.resp).toBe('W/U')
    expect(responseOptions('W/U')).toEqual(['DM0', 'DM1', 'DM2'])
    expect(responseOptions('A/N')).toEqual(['DM4', 'DM5', 'DM2'])
    expect(responseOptions('R')).toEqual(['DM3', 'DM1', 'DM2'])
    expect(responseOptions('N')).toEqual([])
    expect(needsResponse('N')).toBe(false)
    expect(needsResponse('Y')).toBe(true)
  })

  it('gives a multi-element message the most demanding response attribute', () => {
    expect(messageResponseAttr(['UM117', 'UM161'])).toBe('W/U')
    expect(messageResponseAttr(['UM160'])).toBe('N')
    expect(messageResponseAttr(['DM6'])).toBe('Y')
    expect(messageResponseAttr([])).toBe('N')
  })

  it('keeps a dialogue open after STANDBY and closes it on any final answer', () => {
    expect(isClosingResponse('DM2')).toBe(false)
    expect(isClosingResponse('UM1')).toBe(false)
    for (const d of ['DM0', 'DM1', 'DM3', 'DM4', 'DM5', 'UM0', 'UM20']) expect(isClosingResponse(d)).toBe(true)
    expect(CONTROLLER_REPLIES_TO_REQUEST).toContain('UM0')
  })

  it('numbers messages 0 to 63 and wraps', () => {
    expect(nextMin(null)).toBe(0)
    expect(nextMin(5)).toBe(6)
    expect(nextMin(MIN_MODULO - 1)).toBe(0)
  })
})

describe('logon and addressing', () => {
  const plans = [
    { flightId: 'CNS123', registration: 'PK-CNS', address: '8A1C23' },
    { flightId: 'CNS132', registration: 'PK-CNT', address: '8A1C32' },
  ]

  it('accepts a logon that matches the flight plan', () => {
    const r = validateLogon({ flightId: 'cns123 ', registration: 'PK-CNS', address: '8a1c23' }, plans)
    expect(r.ok).toBe(true)
  })

  it('rejects a logon with the right flight ID from the wrong aircraft', () => {
    const r = validateLogon({ flightId: 'CNS123', registration: 'PK-CNT', address: '8A1C32' }, plans)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('8A1C23')
  })

  it('rejects an unknown flight', () => {
    expect(validateLogon({ flightId: 'XYZ9', registration: 'PK-CNS', address: '8A1C23' }, plans).ok).toBe(false)
  })

  it('only accepts uplinks addressed to this aircraft, from its current data authority', () => {
    const link = { ...emptyLink('8A1C23'), active: 'XLAB' }
    expect(checkUplink(link, '8A1C23', 'XLAB')).toBe('ok')
    expect(checkUplink(link, '8A1C32', 'XLAB')).toBe('not-my-address')
    expect(checkUplink(link, '8a1c23', 'XHBR')).toBe('not-current-authority')
    expect(checkUplink(emptyLink('8A1C23'), '8A1C23', 'XLAB')).toBe('not-current-authority')
  })
})

describe('data authority connections', () => {
  it('connects the first centre as current data authority', () => {
    const a = answerConnectionRequest(emptyLink('8A1C23'), 'XLAB')
    expect(a.accept).toBe(true)
    expect(a.link.active).toBe('XLAB')
  })

  it('accepts a second centre only if it is the announced next data authority', () => {
    const connected = { ...emptyLink('8A1C23'), active: 'XLAB' }
    const refused = answerConnectionRequest(connected, 'XHBR')
    expect(refused.accept).toBe(false)
    const withNda = setNextDataAuthority(connected, 'XLAB', 'XHBR')
    expect(withNda.nda).toBe('XHBR')
    // Only the current authority may name the next one.
    expect(setNextDataAuthority(connected, 'XOTH', 'XHBR').nda).toBeNull()
    const ok = answerConnectionRequest(withNda, 'XHBR')
    expect(ok.accept).toBe(true)
    if (ok.accept) expect(ok.as).toBe('inactive')
    expect(ok.link.active).toBe('XLAB')
    expect(ok.link.inactive).toBe('XHBR')
  })

  it('hands over at END SERVICE: the inactive connection becomes active', () => {
    const l = endService({ address: '8A1C23', active: 'XLAB', inactive: 'XHBR', nda: 'XHBR' })
    expect(l).toEqual({ address: '8A1C23', active: 'XHBR', inactive: null, nda: null })
    // Without a next connection the aircraft is left with none.
    expect(endService({ address: '8A1C23', active: 'XLAB', inactive: null, nda: null }).active).toBeNull()
  })

  it('drops everything when the link is lost', () => {
    expect(loseAllConnections({ address: '8A1C23', active: 'XLAB', inactive: 'XHBR', nda: 'XHBR' })).toEqual(emptyLink('8A1C23'))
  })
})

describe('delivery time and RCP', () => {
  it('is quickest by VHF data link, slower by SATCOM, slowest by HF', () => {
    expect(PATH_DELAY_S.vhf).toBeLessThan(PATH_DELAY_S.satcom)
    expect(PATH_DELAY_S.satcom).toBeLessThan(PATH_DELAY_S.hf)
    const r = mulberry32(3)
    for (const path of ['vhf', 'satcom', 'hf'] as const) {
      const [lo, hi] = deliveryRangeS(path)
      for (let k = 0; k < 200; k++) {
        const d = sampleDeliveryS(path, r)
        expect(d).toBeGreaterThanOrEqual(lo)
        expect(d).toBeLessThanOrEqual(hi)
      }
    }
    // VHF: a few seconds. SATCOM: tens of seconds.
    expect(deliveryRangeS('vhf')[1]).toBeLessThan(10)
    expect(deliveryRangeS('satcom')[0]).toBeGreaterThanOrEqual(10)
  })

  it('flags a transaction late at 210 s and expired at 240 s for RCP 240', () => {
    expect(RCP[240]).toEqual({ expirationS: 240, tt95S: 210 })
    expect(rcpStatus(100, 240)).toBe('ok')
    expect(rcpStatus(210, 240)).toBe('late')
    expect(rcpStatus(240, 240)).toBe('expired')
    expect(rcpStatus(300, 400)).toBe('ok')
    expect(rcpStatus(400, 400)).toBe('expired')
  })
})

describe('voice versus datalink (illustrative model)', () => {
  it('is repeatable with the same seed', () => {
    expect(simulateVoice(10, mulberry32(7))).toEqual(simulateVoice(10, mulberry32(7)))
    expect(simulateCpdlc(10, mulberry32(7), 'vhf')).toEqual(simulateCpdlc(10, mulberry32(7), 'vhf'))
  })

  it('puts voice calls one after another on the frequency', () => {
    const v = simulateVoice(10, mulberry32(11))
    for (let k = 1; k < v.exchanges.length; k++) expect(v.exchanges[k].startS).toBeGreaterThanOrEqual(v.exchanges[k - 1].endS)
    expect(v.frequencyS).toBeGreaterThan(10 * (DEFAULT_CHALLENGE.voiceInstructionS + DEFAULT_CHALLENGE.voiceReadbackS) - 1e-9)
  })

  it('lets CPDLC exchanges overlap, never mishears, and leaves the frequency free', () => {
    const c = simulateCpdlc(10, mulberry32(11), 'vhf')
    const overlapping = c.exchanges.some((e, k) => k > 0 && e.startS < c.exchanges[k - 1].endS)
    expect(overlapping).toBe(true)
    expect(c.misheard).toBe(0)
    expect(c.frequencyS).toBe(0)
    for (const e of c.exchanges) expect(e.segments.map((s) => s.kind)).toEqual(['compose', 'uplink', 'pilot', 'downlink'])
  })

  it('on average: each CPDLC exchange is slower, but with 10 aircraft CPDLC finishes first and nothing is misheard', () => {
    const a10 = averageChallenge(10, 200, mulberry32, 'vhf')
    expect(a10.cpdlcOneS).toBeGreaterThan(2 * a10.voiceOneS)
    expect(a10.cpdlcTotalS).toBeLessThan(a10.voiceTotalS)
    expect(a10.voiceMisheardPerRun).toBeGreaterThan(0)
    // With 5 clearances the totals are close.
    const a5 = averageChallenge(5, 200, mulberry32, 'vhf')
    expect(Math.abs(a5.cpdlcTotalS - a5.voiceTotalS) / a5.voiceTotalS).toBeLessThan(0.2)
    // A slow path (HF data link) makes CPDLC the slower option.
    expect(averageChallenge(10, 100, mulberry32, 'hf').cpdlcTotalS).toBeGreaterThan(a10.voiceTotalS)
  })

  it('sometimes needs corrections and repeats on a busy voice frequency', () => {
    let corrected = 0
    let blocked = 0
    for (let s = 0; s < 50; s++) {
      const v = simulateVoice(10, mulberry32(s))
      corrected += v.corrected
      blocked += v.blocked
    }
    expect(corrected).toBeGreaterThan(0)
    expect(blocked).toBeGreaterThan(0)
  })
})

describe('changing the next data authority', () => {
  it('ends an inactive connection with the centre no longer named, so END SERVICE cannot hand over to it', () => {
    let link: AvionicsLink = { address: '8A1C23', active: 'XLAB', inactive: null, nda: null }
    link = setNextDataAuthority(link, 'XLAB', 'XHBR')
    link = { ...link, inactive: 'XHBR' }
    link = setNextDataAuthority(link, 'XLAB', 'XOTH')
    expect(link).toEqual({ address: '8A1C23', active: 'XLAB', inactive: null, nda: 'XOTH' })
    expect(endService(link).active).toBeNull()
    // Naming the same centre again keeps its connection.
    const kept = setNextDataAuthority({ address: 'A', active: 'XLAB', inactive: 'XHBR', nda: 'XHBR' }, 'XLAB', 'XHBR')
    expect(kept.inactive).toBe('XHBR')
  })
})
