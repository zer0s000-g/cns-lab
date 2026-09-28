import { describe, expect, it } from 'vitest'
import { inRunwayProtectedArea, insideBox } from '@/core/surface'
import { METRES_PER_NM } from '@/core/units'
import { GO_AROUND_CHECK_M, SurfaceEngine, type SurfaceEngine as Engine } from '@/modules/surface/engine'
import { BUILDINGS, HOLD_A1, RWY, SMR_SITE, TERMINAL } from '@/modules/surface/layout'

const KT = 1.943844

function run(e: Engine, seconds: number, dt = 1 / 30, each?: (e: Engine) => void) {
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    e.step(dt)
    e.takePaints()
    each?.(e)
  }
}

describe('surface engine: normal traffic', () => {
  it('runs 20 minutes of landings and take-offs with no alert, no go-around and no conflicts', () => {
    const e = new SurfaceEngine()
    const landed = new Set<string>()
    const departed = new Set<string>()
    let alerts = 0
    let inBuilding = 0
    let minSep = Infinity
    const maxKt = { taxi: 0, vehicle: 0, rollout: 0 }
    run(e, 1200, 1 / 20, (x) => {
      if (x.alert.level !== 'none') alerts++
      for (const o of x.objects) {
        if (o.phase === 'rollout') landed.add(o.id)
        if (o.phase === 'climb') departed.add(o.id)
        const kt = o.speedMs * KT
        if (o.kind === 'vehicle') maxKt.vehicle = Math.max(maxKt.vehicle, kt)
        else if (['taxi-in', 'taxi-out', 'pushback', 'lineup', 'cargo-in', 'cargo-out', 'cargo-pushback', 'backtrack'].includes(o.phase)) maxKt.taxi = Math.max(maxKt.taxi, kt)
        else if (o.phase === 'rollout') maxKt.rollout = Math.max(maxKt.rollout, kt)
        // Nothing drives or taxis through a building.
        if (o.phase !== 'cargo-away') for (const b of BUILDINGS) if (insideBox(o.pos, b.box)) inBuilding++
      }
      const ground = x.objects.filter((o) => o.kind === 'aircraft' && o.altitudeM < 5 && o.phase !== 'cargo-away')
      for (let i = 0; i < ground.length; i++)
        for (let j = i + 1; j < ground.length; j++) minSep = Math.min(minSep, Math.hypot(ground[i].pos.x - ground[j].pos.x, ground[i].pos.y - ground[j].pos.y))
    })
    expect(alerts).toBe(0)
    expect(inBuilding).toBe(0)
    expect(e.events).toEqual([])
    expect(landed.size).toBeGreaterThanOrEqual(5)
    expect(departed.size).toBeGreaterThanOrEqual(5)
    expect(minSep).toBeGreaterThan(50)
    // Realistic speeds: taxi ≤ 25 kt, vehicles ≤ 30 kt, landing roll from about 130 kt.
    expect(maxKt.taxi).toBeLessThanOrEqual(25)
    expect(maxKt.vehicle).toBeLessThanOrEqual(30)
    expect(maxKt.rollout).toBeGreaterThan(120)
    expect(maxKt.rollout).toBeLessThanOrEqual(135)
  }, 30000)

  it('the landing roll slows from about 130 kt to taxi speed before turning off at A3', () => {
    const e = new SurfaceEngine()
    e.arrivalNow()
    let touchdown: { x: number; kt: number } | null = null
    let atTurnoff = Infinity
    run(e, 150, 1 / 30, (x) => {
      const a = x.objects.find((o) => o.phase === 'rollout')
      if (!a) return
      if (!touchdown) touchdown = { x: a.pos.x, kt: a.speedMs * KT }
      if (a.pos.x >= 55 && a.pos.x <= 65) atTurnoff = Math.min(atTurnoff, a.speedMs * KT)
    })
    expect(touchdown).not.toBeNull()
    expect(touchdown!.kt).toBeGreaterThan(125)
    expect(touchdown!.x).toBeCloseTo(RWY.thresholdX + 300, -1)
    expect(atTurnoff).toBeLessThan(20)
  })

  it('the SMR turns once per second and paints objects where they really are', () => {
    const e = new SurfaceEngine()
    const a0 = e.smrAz
    run(e, 0.25, 1 / 40)
    expect(((e.smrAz - a0 + 360) % 360)).toBeCloseTo(90, 0)
    run(e, 2)
    const van = e.get('VAN2')!
    const plot = e.smrPlots.get('VAN2')!
    expect(plot).toBeDefined()
    // Within a couple of metres, allowing for how far it drove since it was painted.
    expect(Math.hypot(plot.pos.x - van.pos.x, plot.pos.y - van.pos.y)).toBeLessThan(10)
  })

  it('the fused picture labels transponder-equipped objects with their callsigns', () => {
    const e = new SurfaceEngine()
    run(e, 3)
    const ops = e.tracks.get('OPS1')!
    expect(ops.identity).toBe('OPS1')
    expect(e.trackSources(ops).sort()).toEqual(['adsb', 'mlat', 'smr'])
    // The parked aircraft with its transponder off is seen by the SMR only, without a label.
    const parked = e.tracks.get('CNS440')!
    expect(parked.identity).toBeNull()
    expect(e.trackSources(parked)).toEqual(['smr'])
  })
})

describe('surface engine: runway incursion', () => {
  it('a vehicle on the runway is a caution, an alert once the arrival is within 2 NM, and the arrival goes around', () => {
    const e = new SurfaceEngine()
    // Wait for a quiet runway: nobody landing or taking off.
    const busy = (x: Engine) => x.objects.some((o) => ['final', 'rollout', 'lineup', 'lined', 'takeoff'].includes(o.phase) || (o.phase === 'climb' && o.altitudeM < 5))
    let guard = 0
    while (busy(e) && guard++ < 20000) {
      e.step(1 / 10)
      e.takePaints()
    }
    e.arrivalNow()
    run(e, 1)
    e.driveOntoRunway('OPS1')
    let caution = false
    let alertAtM = NaN
    let goAround = false
    run(e, 120, 1 / 30, (x) => {
      const arr = x.objects.find((o) => o.phase === 'final')
      if (x.alert.level === 'caution') caution = true
      if (x.alert.level === 'alert' && Number.isNaN(alertAtM) && arr) alertAtM = RWY.thresholdX - arr.pos.x
      if (x.objects.some((o) => o.phase === 'goaround')) goAround = true
    })
    expect(caution).toBe(true)
    // Within 2 NM or 60 s of the threshold, whichever comes first (60 s at 140 kt ≈ 4.3 km).
    expect(alertAtM).toBeLessThanOrEqual(Math.max(2 * METRES_PER_NM, 60 * 140 / KT) + 80)
    expect(alertAtM).toBeGreaterThan(Math.max(2 * METRES_PER_NM, 60 * 130 / KT) - 80)
    expect(alertAtM).toBeGreaterThan(GO_AROUND_CHECK_M)
    expect(goAround).toBe(true)
    expect(e.events.some((ev) => ev.text.includes('went around'))).toBe(true)
    expect(e.alert.intruders).toContain('OPS1')
  })

  it('a dragged vehicle inside the protected area triggers it too; outside the holding line does not', () => {
    const e = new SurfaceEngine()
    run(e, 2)
    e.arrivalNow()
    run(e, 30)
    e.dragVehicle('OPS1', { x: -600, y: -40 })
    run(e, 3)
    expect(e.alert.level).toBe('alert')
    e.dragVehicle('OPS1', { x: -600, y: -120 })
    run(e, 3)
    expect(e.alert.level).toBe('none')
  })

  it('the departure is not cleared to line up while a vehicle is on the runway', () => {
    const e = new SurfaceEngine()
    // Wait for a departure at the holding point.
    let tries = 0
    while (!e.objects.some((o) => o.phase === 'holding') && tries++ < 20000) {
      e.step(1 / 10)
      e.takePaints()
    }
    const dep = e.objects.find((o) => o.phase === 'holding')!
    e.dragVehicle('OPS1', { x: 0, y: 0 })
    run(e, 200, 1 / 10)
    expect(e.get(dep.id)!.phase).toBe('holding')
    expect(e.stopBars.A1).toBe(true)
    expect(Math.hypot(e.get(dep.id)!.pos.x - HOLD_A1.x, e.get(dep.id)!.pos.y - HOLD_A1.y)).toBeLessThan(1)
  })

  it('without SMR, a vehicle with no transponder is invisible, so no alert fires', () => {
    const e = new SurfaceEngine()
    e.env = { ...e.env, noTransponder: true }
    e.applyEquipment()
    e.setLayers({ smr: false, mlat: true, adsb: true, fused: true })
    run(e, 2)
    e.arrivalNow()
    run(e, 40)
    e.dragVehicle('VAN2', { x: 0, y: 0 })
    run(e, 3)
    expect(e.alert.level).toBe('none')
    e.setLayers({ smr: true, mlat: true, adsb: true, fused: true })
    run(e, 3)
    expect(e.alert.level).toBe('alert')
    expect(e.nameOf('VAN2')).toBe('an unidentified target')
  })
})

describe('surface engine: when things go wrong', () => {
  it('a vehicle without a transponder is seen only by the SMR, and vanishes when the SMR layer is removed', () => {
    const e = new SurfaceEngine()
    run(e, 3)
    expect(e.tracks.get('VAN2')!.identity).toBe('VAN2')
    e.env = { ...e.env, noTransponder: true }
    e.applyEquipment()
    run(e, 3)
    const van = e.tracks.get('VAN2')!
    expect(van.identity).toBeNull()
    expect(e.trackSources(van)).toEqual(['smr'])
    e.setLayers({ smr: false, mlat: true, adsb: true, fused: true })
    run(e, 5)
    expect(e.tracks.get('VAN2')).toBeUndefined()
    expect(e.tracks.get('CNS440')).toBeUndefined()
    // Equipped objects are still there, labelled.
    expect(e.tracks.get('OPS1')!.identity).toBe('OPS1')
  })

  it('reflections off the terminal add ghost targets behind the building, never on the runway', () => {
    const e = new SurfaceEngine()
    e.env = { ...e.env, reflections: true }
    let ghosts = 0
    run(e, 30, 1 / 30, (x) => {
      for (const tr of x.tracks.values()) {
        if (!tr.ghost) continue
        ghosts++
        expect(tr.pos.y).toBeGreaterThan(TERMINAL.minY)
        expect(inRunwayProtectedArea(tr.pos, RWY)).toBe(false)
        expect(tr.identity).toBeNull()
      }
    })
    expect(ghosts).toBeGreaterThan(0)
    // A ghost is the mirror image of its real object across the terminal face.
    const tr = [...e.tracks.values()].find((t) => t.ghost)!
    const real = e.get(tr.objectId)!
    expect(Math.abs(tr.pos.x - real.pos.x)).toBeLessThan(25)
    expect(Math.abs(tr.pos.y - (2 * TERMINAL.minY - real.pos.y))).toBeLessThan(25)
    // Farther from the radar than the real object.
    expect(Math.hypot(tr.pos.x - SMR_SITE.x, tr.pos.y - SMR_SITE.y)).toBeGreaterThan(Math.hypot(real.pos.x - SMR_SITE.x, real.pos.y - SMR_SITE.y))
  })

  it('heavy rain makes the SMR miss much of a distant vehicle, but not a near one', () => {
    const count = (rain: boolean) => {
      const e = new SurfaceEngine()
      e.env = { ...e.env, heavyRain: rain }
      let far = 0
      let near = 0
      run(e, 20, 1 / 30, (x) => {
        for (const p of x.smrPlots.values()) {
          if (p.timeS !== x.timeS) continue
          if (p.objectId === 'OPS1') far += p.points
          if (p.objectId === 'VAN2') near += p.points
        }
      })
      return { far, near }
    }
    const dry = count(false)
    const wet = count(true)
    expect(wet.far).toBeLessThan(dry.far * 0.5)
    expect(wet.near).toBeGreaterThan(dry.near * 0.7)
  })

  it('an MLAT receiver failure leaves a gap at the west end; the departure there keeps its label from SMR and ADS-B', () => {
    const e = new SurfaceEngine()
    let tries = 0
    while (!e.objects.some((o) => o.phase === 'holding') && tries++ < 20000) {
      e.step(1 / 10)
      e.takePaints()
    }
    run(e, 3)
    const dep = e.objects.find((o) => o.phase === 'holding')!
    expect(e.receiversHearing(dep.pos).length).toBeGreaterThanOrEqual(3)
    expect(e.trackSources(e.tracks.get(dep.id)!)).toContain('mlat')
    e.env = { ...e.env, mlatFailure: true }
    run(e, 4)
    expect(e.receiversHearing(dep.pos).length).toBeLessThan(3)
    const tr = e.tracks.get(dep.id)!
    expect(e.trackSources(tr)).not.toContain('mlat')
    expect(tr.identity).toBe(dep.callsign)
    // Elsewhere, MLAT still works.
    expect(e.receiversHearing({ x: 0, y: 182 }).length).toBeGreaterThanOrEqual(3)
  })

  it('SMR alone gives shapes without names', () => {
    const e = new SurfaceEngine()
    e.setLayers({ smr: true, mlat: false, adsb: false, fused: true })
    run(e, 3)
    for (const tr of e.tracks.values()) expect(tr.identity).toBeNull()
    expect(e.tracks.size).toBeGreaterThan(3)
  })
})

describe('surface engine: fixes and set-ups', () => {
  it('circular polarisation brings back most of what heavy rain hid', () => {
    const farPoints = (env: Partial<Engine['env']>) => {
      const e = new SurfaceEngine()
      e.env = { ...e.env, ...env }
      let far = 0
      run(e, 20, 1 / 30, (x) => {
        for (const p of x.smrPlots.values()) if (p.timeS === x.timeS && p.objectId === 'OPS1') far += p.points
      })
      return far
    }
    const dry = farPoints({})
    const cp = farPoints({ heavyRain: true, circularPol: true })
    const wet = farPoints({ heavyRain: true })
    expect(cp).toBeGreaterThan(dry * 0.7)
    expect(cp).toBeGreaterThan(wet * 1.5)
  })

  it('placing a vehicle on its road keeps it driving there', () => {
    const e = new SurfaceEngine()
    e.placeOnRoad('OPS1', -300)
    run(e, 5)
    const o = e.get('OPS1')!
    expect(o.phase).toBe('patrol')
    expect(o.pos.y).toBeCloseTo(-220, 3)
    expect(Math.abs(o.pos.x + 300)).toBeLessThan(80)
  })

  it('in thick fog the tower cannot see even the nearest runway edge', async () => {
    const { fogContrast, visibleInFog } = await import('@/core/surface')
    const { TOWER_POS } = await import('@/modules/surface/layout')
    const nearestEdge = TOWER_POS.y - RWY.halfWidthM
    expect(nearestEdge).toBeGreaterThan(350)
    expect(nearestEdge).toBeLessThan(400)
    expect(visibleInFog(nearestEdge, 150)).toBe(false)
    expect(fogContrast(nearestEdge, 10000)).toBeGreaterThan(0.8)
  })
})

describe('surface engine: vehicles never drive through buildings', () => {
  it('a vehicle dropped behind the terminal drives round it to get back to its road', async () => {
    const { pathAround } = await import('@/modules/surface/engine')
    const { segmentHitsBox } = await import('@/core/surface')
    const p = pathAround([{ x: 0, y: 700 }, { x: 0, y: -220 }])
    for (let i = 1; i < p.points.length; i++) for (const b of BUILDINGS) expect(segmentHitsBox(p.points[i - 1], p.points[i], b.box)).toBe(false)
    const e = new SurfaceEngine()
    e.dragVehicle('OPS1', { x: 0, y: 700 })
    e.sendVehiclesBack()
    let inside = 0
    run(e, 150, 1 / 20, (x) => {
      const o = x.get('OPS1')!
      for (const b of BUILDINGS) if (insideBox(o.pos, b.box)) inside++
    })
    expect(inside).toBe(0)
    expect(e.get('OPS1')!.phase).toBe('patrol')
  })
})
