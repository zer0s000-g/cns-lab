/**
 * Numbers quoted in "Try this" come from running the same engine the simulator
 * uses, so the text can never disagree with what the learner sees.
 */

import { routePointAt } from '@/core/satcom'
import { GEO_SATS, SatcomEngine, type LinkState } from './engine'

function fly(e: SatcomEngine, dt = 10) {
  const time: Record<LinkState, number> = { connected: 0, handover: 0, blocked: 0, 'no-satellite': 0 }
  let t = 0
  while (!e.arrived && t < 24 * 3600) {
    e.step(dt)
    t += dt
    time[e.link.state] += dt
  }
  return { time, t }
}

let polar: { gapHours: number; fromLat: number; toLat: number } | null = null
/** Hours without any GEO satellite on the polar route, and the latitudes where the gap starts and ends. */
export function polarGapFacts() {
  if (!polar) {
    const e = new SatcomEngine({ constellation: 'geo', routeId: 'polar' })
    const r = fly(e)
    const gap = e.history.find((h) => h.state === 'no-satellite')
    polar = {
      gapHours: r.time['no-satellite'] / 3600,
      fromLat: gap ? routePointAt(e.route, gap.fromNm).pos.lat : NaN,
      toLat: gap ? routePointAt(e.route, gap.toNm).pos.lat : NaN,
    }
  }
  return polar
}

let delays: { geoOneWayS: number; leoOneWayS: number } | null = null
/** One-way propagation for a voice call in the middle of the Atlantic, GEO and LEO. */
export function delayFacts() {
  if (!delays) {
    const e = new SatcomEngine({ constellation: 'geo', routeId: 'atlantic' })
    e.setDistance(1500)
    const geoOneWayS = e.computePath('voice')?.propagationS ?? NaN
    e.setConstellation('leo')
    const leoOneWayS = e.computePath('voice')?.propagationS ?? NaN
    delays = { geoOneWayS, leoOneWayS }
  }
  return delays
}

let atlantic: { handoverNm: number; from: string; to: string; leoMinutes: number } | null = null
/** Where the GEO handover happens across the Atlantic, and how often LEO hands over. */
export function atlanticFacts() {
  if (!atlantic) {
    const g = new SatcomEngine({ constellation: 'geo', routeId: 'atlantic' })
    fly(g)
    const conn = g.history.filter((h) => h.state === 'connected')
    const l = new SatcomEngine({ constellation: 'leo', routeId: 'atlantic' })
    const r = fly(l)
    atlantic = {
      handoverNm: conn.length > 1 ? conn[1].fromNm : NaN,
      from: conn[0] ? GEO_SATS[conn[0].sat!].id : '',
      to: conn[1] ? GEO_SATS[conn[1].sat!].id : '',
      leoMinutes: r.t / 60 / Math.max(1, l.handovers),
    }
  }
  return atlantic
}

let turn: { blockedS: number; circleS: number; satAzDeg: number; satElDeg: number; sat: string } | null = null
/** Seconds without a usable GEO link during one full steep-turn circle (set-up position of the experiment). */
export function turnFacts(distanceNm: number) {
  if (!turn) {
    const e = new SatcomEngine({ constellation: 'geo', routeId: 'atlantic' })
    e.setDistance(distanceNm)
    const i = e.link.sat ?? 0
    const satAzDeg = e.looks[i].azimuthDeg
    const satElDeg = e.looks[i].elevationDeg
    const sat = GEO_SATS[i].id
    e.env.steepTurn = true
    // Roll in first, then time one full circle.
    while (e.bankDeg < 45) e.step(0.25)
    const start = e.headingDeg
    let turned = 0
    let last = start
    let blockedS = 0
    let t = 0
    while (turned < 360 && t < 600) {
      e.step(0.25)
      t += 0.25
      turned += (e.headingDeg - last + 360) % 360
      last = e.headingDeg
      if (e.link.state !== 'connected') blockedS += 0.25
    }
    turn = { blockedS, circleS: t, satAzDeg, satElDeg, sat }
  }
  return turn
}
