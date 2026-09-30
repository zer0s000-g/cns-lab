import { describe, expect, it } from 'vitest'
import { deliveryRangeS, RCP } from '@/core/cpdlc'
import { CpdlcEngine, EXTRA_DELAY_S, OWN } from '@/modules/cpdlc/engine'

function run(e: CpdlcEngine, seconds: number, dt = 0.5) {
  for (let t = 0; t < seconds; t += dt) e.step(dt)
}

/** Log on and wait until the connection is up. */
function connect(e: CpdlcEngine) {
  e.pilotLogon()
  for (let t = 0; t < 600 && e.xlab !== 'active' && e.xhbr !== 'active'; t += 0.5) e.step(0.5)
  expect(e.link.active).not.toBeNull()
}

describe('CPDLC engine: logon and connection', () => {
  it('connects in order: logon, accepted, connection request, connection confirm', () => {
    const e = new CpdlcEngine()
    expect(e.cannotSend('CNS123')).not.toBeNull()
    expect(e.pilotLogon().ok).toBe(true)
    expect(e.logonState).toBe('sent')
    run(e, 60)
    const m = e.milestones
    expect(m.logonSent).toBe(0)
    expect(m.logonAccepted!).toBeGreaterThan(m.logonSent!)
    expect(m.connected!).toBeGreaterThan(m.logonAccepted!)
    expect(e.logonState).toBe('accepted')
    expect(e.link.active).toBe('XLAB')
    expect(e.xlab).toBe('active')
    expect(e.cannotSend('CNS123')).toBeNull()
  })

  it('rejects a logon with a mistyped flight ID', () => {
    const e = new CpdlcEngine()
    e.pilotLogon('CNS132')
    run(e, 60)
    expect(e.logonState).toBe('rejected')
    expect(e.link.active).toBeNull()
    expect(e.alerts[0].title).toBe('Logon rejected')
  })

  it('never lets the controller send to an aircraft without a connection', () => {
    const e = new CpdlcEngine()
    connect(e)
    const r = e.sendUplink('CNS132', [{ id: 'UM20', values: { level: 370 } }])
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('has not logged on')
  })

  it('does not advance timers or deliver anything while the clock is paused', () => {
    const e = new CpdlcEngine()
    e.pilotLogon()
    e.step(0)
    e.step(0)
    expect(e.timeS).toBe(0)
    expect(e.logonState).toBe('sent')
    expect(e.transits).toHaveLength(1)
  })
})

describe('CPDLC engine: clearances and replies', () => {
  it('delivers a clearance after the path delay; WILCO closes it and the aircraft climbs', () => {
    const e = new CpdlcEngine()
    connect(e)
    const r = e.sendUplink('CNS123', [{ id: 'UM20', values: { level: 370 } }])
    expect(r.ok).toBe(true)
    const up = r.entry!
    expect(up.resp).toBe('W/U')
    expect(up.open).toBe(true)
    run(e, 1)
    expect(e.cockpitMessage()).toBeUndefined()
    run(e, deliveryRangeS('vhf')[1])
    expect(e.cockpitMessage()?.id).toBe(up.id)
    expect(e.pilotRespond(up.id, 'DM0').ok).toBe(true)
    expect(e.clearedFl).toBe(370)
    run(e, 10)
    expect(e.entry(up.id)!.open).toBe(false)
    expect(e.entry(up.id)!.answer).toBe('WILCO')
    // The reply references the clearance's number.
    const wilco = e.entries.find((x) => x.dir === 'down' && x.elements[0] === 'DM0')!
    expect(wilco.mrn).toBe(up.min)
    run(e, 200)
    expect(e.levelFl).toBe(370)
  })

  it('keeps the clearance open after STANDBY until the final answer', () => {
    const e = new CpdlcEngine()
    connect(e)
    const up = e.sendUplink('CNS123', [{ id: 'UM20', values: { level: 390 } }]).entry!
    run(e, 10)
    e.pilotRespond(up.id, 'DM2')
    run(e, 10)
    expect(e.entry(up.id)!.open).toBe(true)
    expect(e.entry(up.id)!.standby).toBe(true)
    expect(e.cockpitMessage()?.id).toBe(up.id)
    e.pilotRespond(up.id, 'DM1')
    run(e, 10)
    expect(e.entry(up.id)!.open).toBe(false)
  })

  it('after UNABLE the clearance is not in force and the controller is asked to plan something else', () => {
    const e = new CpdlcEngine()
    connect(e)
    const up = e.sendUplink('CNS123', [{ id: 'UM20', values: { level: 390 } }]).entry!
    run(e, 10)
    e.pilotRespond(up.id, 'DM1')
    run(e, 200)
    expect(e.clearedFl).toBe(350)
    expect(e.levelFl).toBe(350)
    const a = e.alerts.find((x) => x.title.includes('UNABLE'))!
    expect(a).toBeDefined()
    expect(a.offerLevel).toBe(380)
  })

  it('answers a pilot request with a clearance that references it', () => {
    const e = new CpdlcEngine()
    connect(e)
    e.pilotRequest(370)
    run(e, 10)
    const req = e.openRequests()[0]
    expect(req.text).toBe('REQUEST FL370')
    const r = e.sendUplink('CNS123', [{ id: 'UM20', values: { level: 370 } }], req.min)
    expect(r.entry!.mrn).toBe(req.min)
    expect(e.openRequests()).toHaveLength(0)
  })

  it('shows the controller a timer that turns late and then expired under RCP 240 when messages are delayed', () => {
    const e = new CpdlcEngine()
    connect(e)
    e.setEnv('delay', true)
    const up = e.sendUplink('CNS123', [{ id: 'UM20', values: { level: 370 } }]).entry!
    run(e, RCP[240].tt95S + 1)
    expect(e.openUplinks()[0].rcpState).toBe('late')
    // Even a quick pilot cannot save it: the delayed uplink arrives after about EXTRA_DELAY_S.
    e.pilotRespond(up.id, 'DM0')
    run(e, RCP[240].expirationS - RCP[240].tt95S)
    expect(e.entry(up.id)!.open).toBe(true)
    expect(e.openUplinks()[0].rcpState).toBe('expired')
    expect(e.alerts.some((a) => a.title.includes('RCP 240'))).toBe(true)
    run(e, EXTRA_DELAY_S + 20)
    expect(e.entry(up.id)!.open).toBe(false)
  })

  it('is slower by SATCOM than by VHF data link', () => {
    const time = (path: 'vhf' | 'satcom' | 'hf') => {
      const e = new CpdlcEngine()
      e.setPath(path)
      connect(e)
      const up = e.sendUplink('CNS123', [{ id: 'UM20', values: { level: 370 } }]).entry!
      let t = 0
      while (!e.cockpitMessage() && t < 300) {
        e.step(0.25)
        t += 0.25
      }
      return e.entry(up.id)!.receivedS! - up.sentS
    }
    expect(time('vhf')).toBeLessThan(time('satcom'))
    expect(time('satcom')).toBeLessThan(time('hf'))
  })
})

describe('CPDLC engine: failures', () => {
  it('loses messages in transit when the connection drops, and needs voice and a new logon', () => {
    const e = new CpdlcEngine()
    e.setPath('satcom')
    connect(e)
    const up = e.sendUplink('CNS123', [{ id: 'UM20', values: { level: 370 } }]).entry!
    run(e, 2)
    e.setEnv('lost', true)
    expect(e.entry(up.id)!.status).toBe('lost')
    expect(e.entry(up.id)!.needsVoice).toBe(true)
    expect(e.link.active).toBeNull()
    expect(e.alerts[0].title).toContain('lost')
    run(e, 100)
    expect(e.cockpitMessage()).toBeUndefined()
    expect(e.sendUplink('CNS123', [{ id: 'UM23', values: { level: 330 } }]).ok).toBe(false)
    expect(e.pilotLogon().ok).toBe(false)
    // Voice fallback closes it and the clearance is in force.
    e.giveByVoice(up.id)
    expect(e.entry(up.id)!.open).toBe(false)
    expect(e.entry(up.id)!.closedBy).toBe('voice')
    expect(e.clearedFl).toBe(370)
    // Data link back: nothing happens until the crew logs on again.
    e.setEnv('lost', false)
    run(e, 30)
    expect(e.xlab).toBe('none')
    connect(e)
    expect(e.xlab).toBe('active')
  })

  it('a message already on the cockpit display and then given by voice needs no reply and can be cleared', () => {
    const e = new CpdlcEngine()
    connect(e)
    const up = e.sendUplink('CNS123', [{ id: 'UM20', values: { level: 370 } }]).entry!
    run(e, 60)
    expect(e.cockpitMessage()?.id).toBe(up.id)
    e.setEnv('lost', true)
    e.giveByVoice(up.id)
    expect(e.clearedFl).toBe(370)
    expect(e.cockpitMessage()!.void).toBe(true)
    // No WILCO/UNABLE for a clearance already in force by voice, even with the link back.
    e.setEnv('lost', false)
    connect(e)
    expect(e.pilotRespond(up.id, 'DM1').ok).toBe(false)
    expect(e.clearedFl).toBe(370)
    e.pilotDismiss(up.id)
    expect(e.cockpitMessage()).toBeUndefined()
  })

  it('rejects a wrong aircraft that logs on with CNS123’s flight ID, and the nearby aircraft ignores uplinks not addressed to it', () => {
    const e = new CpdlcEngine()
    connect(e)
    e.setEnv('wrongAircraft', true)
    run(e, 60)
    expect(e.otherLogonState).toBe('rejected')
    expect(e.alerts.some((a) => a.title === 'Logon rejected' && a.text.includes('8A1C32'))).toBe(true)
    // CNS123 is still the only connected aircraft.
    expect(e.link.active).toBe('XLAB')
    e.sendUplink('CNS123', [{ id: 'UM20', values: { level: 370 } }])
    run(e, 10)
    expect(e.otherLog[0].text).toContain(`address ${OWN.address}`)
    expect(e.otherLog[0].text).toContain('ignored')
    expect(e.cockpitMessage()?.text).toBe('CLIMB TO FL370')
  })
})

describe('CPDLC engine: transfer to the next centre', () => {
  it('sets the next data authority, connects it inactive, and makes it current at END SERVICE', () => {
    const e = new CpdlcEngine()
    connect(e)
    const nda = e.sendUplink('CNS123', [{ id: 'UM160', values: { unit: 'XHBR' } }]).entry!
    expect(nda.open).toBe(false)
    run(e, 60)
    expect(e.link.nda).toBe('XHBR')
    expect(e.link.inactive).toBe('XHBR')
    expect(e.xhbr).toBe('inactive')
    expect(e.link.active).toBe('XLAB')
    const tr = e.sendUplink('CNS123', [
      { id: 'UM117', values: { unit: 'XHBR', frequency: '132.350' } },
      { id: 'UM161' },
    ]).entry!
    expect(tr.resp).toBe('W/U')
    run(e, 10)
    e.pilotRespond(tr.id, 'DM0')
    expect(e.link.active).toBe('XHBR')
    expect(e.xhbr).toBe('active')
    expect(e.xlab).toBe('transferred')
    expect(e.cannotSend('CNS123')).toContain('XHBR')
  })

  it('leaves the aircraft without a connection after a transfer with no NEXT DATA AUTHORITY, until the crew logs on to the next centre', () => {
    const e = new CpdlcEngine()
    connect(e)
    // A transfer without NEXT DATA AUTHORITY leaves the aircraft with no connection.
    const tr = e.sendUplink('CNS123', [{ id: 'UM117', values: { unit: 'XHBR', frequency: '132.350' } }, { id: 'UM161' }]).entry!
    run(e, 10)
    e.pilotRespond(tr.id, 'DM0')
    expect(e.link.active).toBeNull()
    expect(e.logonTarget).toBe('XHBR')
    // The crew logs on to XHBR by hand and gets connected.
    e.pilotLogon()
    run(e, 60)
    expect(e.link.active).toBe('XHBR')
    expect(e.xhbr).toBe('active')
  })
})

describe('CPDLC engine: voice versus datalink challenge', () => {
  it('runs both methods on the world clock and records the result when both finish', () => {
    const e = new CpdlcEngine()
    e.startChallenge(5)
    const c = e.challenge!
    expect(c.voice.exchanges).toHaveLength(5)
    expect(c.cpdlc.misheard).toBe(0)
    e.step(0)
    expect(e.challengeElapsedS()).toBe(0)
    run(e, Math.max(c.voice.totalS, c.cpdlc.totalS) + 1, 1)
    expect(c.done).toBe(true)
    expect(e.challengeHistory[0].n).toBe(5)
  })
})
