import { describe, expect, it } from 'vitest'
import { mulberry32 } from '@/core/random'
import { createSimClock } from '@/hooks/useSimClock'
import { NDB_BAND_KHZ } from '@/core/ndb'
import { VOR_BAND_MHZ } from '@/core/vor'
import { PsrEngine } from '@/modules/psr/engine'
import { createPsrStore } from '@/modules/psr/state'
import { SsrEngine } from '@/modules/ssr/engine'
import { createSsrStore } from '@/modules/ssr/state'
import { MlatEngine } from '@/modules/mlat/engine'
import { createMlatStore } from '@/modules/mlat/state'
import { VhfEngine } from '@/modules/vhf/engine'
import { createVhfStore } from '@/modules/vhf/state'
import { MAX_ALT_FT, MAX_DIST_NM, MIN_ALT_FT, MIN_DIST_NM } from '@/modules/vhf/SideView'
import { HfEngine } from '@/modules/hf/engine'
import { createHfStore } from '@/modules/hf/state'
import { HF_CHANNELS_MHZ } from '@/core/hf'
import { DmeEngine, MAX_TRAFFIC } from '@/modules/dme/engine'
import { createDmeStore } from '@/modules/dme/state'
import { SurfaceEngine } from '@/modules/surface/engine'
import { createSurfaceStore } from '@/modules/surface/state'
import { NdbEngine } from '@/modules/ndb/engine'
import { createNdbStore } from '@/modules/ndb/state'
import { DvorEngine } from '@/modules/dvor/engine'
import { createDvorStore } from '@/modules/dvor/state'
import { IlsEngine } from '@/modules/ils/engine'
import { createIlsStore } from '@/modules/ils/state'
import { CpdlcEngine } from '@/modules/cpdlc/engine'
import { createCpdlcStore } from '@/modules/cpdlc/state'
import { SatcomEngine } from '@/modules/satcom/engine'
import { createSatcomStore } from '@/modules/satcom/state'
import { SandboxEngine } from '@/pages/Sandbox/engine'
import { createSandboxStore } from '@/pages/Sandbox/state'
import { FLIGHT_PHASES } from '@/pages/Sandbox/journey'

/*
 * Fuzz every module through its real store, with values the controls can actually
 * produce (the ranges of each module's dials, sliders and switches), random frame
 * steps (the clock hands an engine 0 to 1.6 s per frame at 16×), and random failure
 * switches. After every step, nothing physical may be NaN: positions, altitudes,
 * headings, speeds, times. (Other fields may use NaN as "no value": the UI shows "—".)
 */

type Rand = () => number
type Action = (r: Rand) => void
interface Subject {
  engine: { step: (dt: number) => unknown }
  actions: Action[]
}

const PHYSICAL = new Set(['x', 'y', 'z', 'lat', 'lon', 'altitudeFt', 'headingDeg', 'speedKt', 'timeS', 'verticalSpeedFpm', 'targetAltitudeFt', 'targetHeadingDeg', 'targetSpeedKt', 'distanceNm'])
const DTS = [0, 0.001, 1 / 60, 0.1, 0.4, 1.6]

const pick = <T,>(r: Rand, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]
const uniform = (r: Rand, a: number, b: number) => a + (b - a) * r()
const stepped = (r: Rand, a: number, b: number, step: number) => a + Math.round(uniform(r, 0, (b - a) / step)) * step
const extreme = (r: Rand, a: number, b: number, step = 0) => {
  const x = r()
  return x < 0.15 ? a : x < 0.3 ? b : step ? stepped(r, a, b, step) : uniform(r, a, b)
}

/** Paths of physical fields that are NaN, anywhere in the object graph. */
function nanFields(root: unknown): string[] {
  const out: string[] = []
  const seen = new Set<unknown>()
  const walk = (v: unknown, path: string, depth: number) => {
    if (out.length > 5 || depth > 7 || v === null || typeof v !== 'object' || seen.has(v)) return
    seen.add(v)
    if (ArrayBuffer.isView(v)) return
    const entries: [string, unknown][] = v instanceof Map ? [...v.entries()].map(([k, x]) => [String(k), x]) : Object.entries(v as object)
    for (const [k, x] of entries) {
      if (typeof x === 'number') {
        if (Number.isNaN(x) && PHYSICAL.has(k)) out.push(`${path}.${k}`)
      } else if (typeof x === 'object') walk(x, `${path}.${k}`, depth + 1)
    }
  }
  walk(root, 'engine', 0)
  return out
}

/** Toggle every boolean field of an env/failures object through its store action. */
function toggles<T extends object>(obj: T, set: (k: keyof T, v: boolean) => void): Action[] {
  return (Object.keys(obj) as (keyof T)[]).filter((k) => typeof obj[k] === 'boolean').map((k) => (r: Rand) => set(k, r() < 0.5))
}

const SUBJECTS: Record<string, () => Subject> = {
  psr: () => {
    const engine = new PsrEngine()
    const s = createPsrStore(engine).getState()
    return {
      engine,
      actions: [
        ...toggles(engine.env, (k, v) => s.setEnv(k, v as never)),
        (r) => s.setParam('rotationPeriodS', extreme(r, 2, 15, 0.1)),
        (r) => s.setParam('prfHz', extreme(r, 250, 4000, 50)),
        (r) => s.setParam('beamWidthDeg', extreme(r, 0.5, 5, 0.1)),
        (r) => s.setParam('peakPowerKw', Math.round(10 ** extreme(r, Math.log10(5), 3) * 10) / 10),
        (r) => engine.setAircraft(pick(r, engine.aircraft).id, { targetHeadingDeg: extreme(r, 0, 359, 1), targetSpeedKt: extreme(r, 60, 500, 5), targetAltitudeFt: extreme(r, 500, 41000, 500) }),
        () => s.resetAll(),
      ],
    }
  },
  ssr: () => {
    const engine = new SsrEngine()
    const s = createSsrStore(engine).getState()
    return {
      engine,
      actions: [
        ...toggles(engine.env, (k, v) => s.setEnv(k, v as never)),
        (r) => s.setParam('mode', pick(r, ['ac', 's'] as const)),
        (r) => s.setParam('rotationPeriodS', extreme(r, 4, 12, 0.1)),
        (r) => s.setParam('prfHz', extreme(r, 100, 450, 10)),
        (r) => s.setXpdr(pick(r, engine.aircraft).id, { on: r() < 0.7 }),
        (r) => engine.setAircraft(pick(r, engine.aircraft).id, { mode: { kind: 'heading' }, targetHeadingDeg: extreme(r, 0, 359, 1), targetSpeedKt: extreme(r, 60, 500, 5), targetAltitudeFt: extreme(r, 500, 41000, 100) }),
        () => s.resetAll(),
      ],
    }
  },
  mlat: () => {
    const engine = new MlatEngine()
    const s = createMlatStore(engine).getState()
    return {
      engine,
      actions: [
        ...toggles(engine.env, (k, v) => s.setEnv(k, v as never)),
        (r) => s.setParam('useAltitude', r() < 0.5),
        (r) => s.setParam('timingNoiseNs', extreme(r, 1, 50, 1)),
        (r) => s.setParam('clockErrorNs', extreme(r, -1000, 1000, 10)),
        (r) => s.setReceiverInUse(pick(r, engine.receivers).id, r() < 0.6),
        // Dragging: anywhere on the map, including stacking receivers in a corner.
        (r) => s.moveReceiver(pick(r, engine.receivers).id, r() < 0.3 ? { x: -48, y: 48 } : { x: uniform(r, -60, 60), y: uniform(r, -60, 60) }),
        () => s.resetReceivers(),
        () => s.resetAll(),
      ],
    }
  },
  vhf: () => {
    const engine = new VhfEngine()
    const s = createVhfStore(engine).getState()
    return {
      engine,
      actions: [
        ...toggles(engine.failures, (k, v) => s.setFailure(k, v as never)),
        (r) => s.setParam('distanceNm', extreme(r, MIN_DIST_NM, MAX_DIST_NM, 1)),
        (r) => s.setParam('altitudeFt', extreme(r, MIN_ALT_FT, MAX_ALT_FT, 100)),
        (r) => s.setParam('spacing', pick(r, ['25', '8.33'] as const)),
        () => engine.pressTalk(),
        () => engine.releaseTalk(),
        () => engine.moveTrafficToBackup(),
        () => s.resetAll(),
      ],
    }
  },
  hf: () => {
    const engine = new HfEngine()
    const s = createHfStore(engine).getState()
    return {
      engine,
      actions: [
        ...toggles(engine.failures, (k, v) => s.setFailure(k, v as never)),
        (r) => s.setParam('hour', extreme(r, 0, 23.75, 0.25)),
        (r) => s.setParam('timelapse', r() < 0.5),
        (r) => s.setParam('channelIndex', Math.round(extreme(r, 0, HF_CHANNELS_MHZ.length - 1, 1))),
        (r) => s.setParam('distanceNm', extreme(r, 50, 2500, 10)),
        () => s.resetAll(),
      ],
    }
  },
  dme: () => {
    const engine = new DmeEngine()
    const s = createDmeStore(engine).getState()
    return {
      engine,
      actions: [
        (r) => s.setEnv('trafficCount', Math.round(extreme(r, 0, MAX_TRAFFIC, 1))),
        (r) => s.setEnv('noJitter', r() < 0.5),
        (r) => s.setEnv('mode', pick(r, ['X', 'Y'] as const)),
        (r) => engine.setOwn({ targetAltitudeFt: extreme(r, 1000, 40000, 500), targetSpeedKt: extreme(r, 120, 480, 10) }),
        (r) => engine.setOwn({ mode: { kind: 'heading' }, targetHeadingDeg: extreme(r, 0, 359, 1) }),
        () => s.resetAll(),
      ],
    }
  },
  surface: () => {
    const engine = new SurfaceEngine(5, 30)
    const s = createSurfaceStore(engine).getState()
    return {
      engine,
      actions: [
        ...toggles(engine.env, (k, v) => s.setEnv(k, v as never)),
        ...toggles(engine.layers, (k, v) => s.setLayer(k, v)),
        (r) => s.setPreset(pick(r, ['smr', 'mlat', 'adsb', 'fused'] as const)),
        (r) => s.setVisibility(Math.round(10 ** extreme(r, Math.log10(50), 4))),
        () => s.resetAll(),
      ],
    }
  },
  ndb: () => {
    const engine = new NdbEngine()
    const s = createNdbStore(engine).getState()
    return {
      engine,
      actions: [
        ...toggles(engine.env, (k, v) => s.setEnv(k, v as never)),
        (r) => s.setFreq(extreme(r, NDB_BAND_KHZ.min, NDB_BAND_KHZ.usualMax, 1)),
        (r) => s.setCoverage(extreme(r, 15, 100, 5)),
        (r) => s.setOrbitRadius(extreme(r, 2, 20, 1)),
        (r) => s.setVariation(extreme(r, -20, 20, 1)),
        (r) => s.setAutopilot(pick(r, ['heading', 'home', 'orbit'] as const)),
        (r) => s.place(pick(r, ['start', 'near', 'far', 'coast', 'mountains', 'behind'] as const)),
        (r) => engine.setAircraft({ targetHeadingDeg: extreme(r, 0, 359, 1), targetSpeedKt: extreme(r, 120, 300, 5), targetAltitudeFt: extreme(r, 1000, 15000, 500) }),
        () => s.resetAll(),
      ],
    }
  },
  dvor: () => {
    const engine = new DvorEngine()
    const s = createDvorStore(engine).getState()
    return {
      engine,
      actions: [
        ...toggles(engine.env, (k, v) => s.setEnv(k, v as never)),
        (r) => s.setFreq(Math.round(extreme(r, VOR_BAND_MHZ.min, VOR_BAND_MHZ.max) * 20) / 20),
        (r) => s.setVariation(extreme(r, -20, 20, 1)),
        (r) => s.setObs(extreme(r, 0, 359, 1)),
        (r) => s.setOrbitRadius(extreme(r, 2, 20, 1)),
        (r) => s.setAutopilot(pick(r, ['heading', 'track', 'orbit', 'direct'] as const)),
        (r) => s.place(pick(r, ['start', 'west', 'overfly', 'circle', 'building'] as const)),
        (r) => engine.setAircraft({ targetHeadingDeg: extreme(r, 0, 359, 1), targetSpeedKt: extreme(r, 120, 450, 10), targetAltitudeFt: extreme(r, 1000, 35000, 500) }),
        () => s.resetAll(),
      ],
    }
  },
  ils: () => {
    const engine = new IlsEngine()
    const s = createIlsStore(engine).getState()
    return {
      engine,
      actions: [
        ...toggles(engine.failures, (k, v) => s.setFailure(k, v)),
        (r) => s.setWeather(pick(r, ['clear', 'I', 'II', 'IIIA', 'IIIB'] as const)),
        (r) => s.setThickFog(r() < 0.5),
        (r) => s.setGuidance(r() < 0.5),
        (r) => s.setTargetHeading(extreme(r, 0, 359, 1)),
        (r) => s.setSelectedVs(extreme(r, -2000, 1000, 100)),
        (r) => s.resetApproach(r() < 0.5 ? undefined : extreme(r, 1, 15, 1)),
        () => s.resetAll(),
      ],
    }
  },
  cpdlc: () => {
    const engine = new CpdlcEngine()
    const s = createCpdlcStore(engine).getState()
    return {
      engine,
      actions: [
        ...toggles(engine.env, (k, v) => s.setEnv(k, v as never)),
        (r) => s.setPath(pick(r, ['vhf', 'satcom', 'hf'] as const)),
        (r) => s.setStandard(pick(r, ['fans', 'atn'] as const)),
        (r) => engine.pilotLogon(pick(r, ['CNS123', 'CNS132', '', '  cns123 '])),
        (r) => engine.sendUplink('CNS123', [{ id: pick(r, ['UM20', 'UM23'] as const), values: { level: stepped(r, 300, 410, 10) } }]),
        (r) => engine.pilotRequest(stepped(r, 300, 410, 10)),
        (r) => {
          const up = engine.cockpitMessage()
          if (up) engine.pilotRespond(up.id, pick(r, ['DM0', 'DM1', 'DM2'] as const))
        },
        (r) => {
          const open = engine.openUplinks()
          if (open.length) engine.giveByVoice(pick(r, open).id)
        },
        () => s.resetAll(),
      ],
    }
  },
  satcom: () => {
    const engine = new SatcomEngine()
    const s = createSatcomStore(engine, createSimClock({ speeds: [1, 2, 4, 8, 16], speed: 1 })).getState()
    return {
      engine,
      actions: [
        ...toggles(engine.env, (k, v) => s.setEnv(k, v as never)),
        (r) => s.setConstellation(pick(r, ['geo', 'leo'] as const)),
        (r) => s.setRoute(pick(r, ['atlantic', 'polar'] as const)),
        (r) => s.setDistance(extreme(r, 0, engine.routeLengthNm)),
        () => s.resetAll(),
      ],
    }
  },
  sandbox: () => {
    const engine = new SandboxEngine()
    const s = createSandboxStore(engine).getState()
    return {
      engine,
      actions: [
        ...toggles(engine.systems, (k, v) => s.setSystem(k, v)),
        (r) => s.setScenario(pick(r, ['normal', 'radarOutage', 'gnssJam', 'vhfFail', 'mountain'] as const)),
        (r) => s.jumpTo(pick(r, FLIGHT_PHASES)),
        () => s.selectVhfStandby(),
        () => engine.spawnConflict(),
        () => engine.resolveConflict(),
        () => engine.resolveTerrain(),
        () => s.resetAll(),
        () => s.flyAgain(),
      ],
    }
  },
}

describe('fuzzing every module with the values its controls can produce', () => {
  it('the checker itself finds NaN in physical fields, and only there', () => {
    const aircraft = new Map([['A', { pos: { x: NaN, y: 1 }, altitudeFt: 3000 }]])
    expect(nanFields({ aircraft, fix: { errorM: NaN }, list: [{ headingDeg: NaN }] })).toEqual(['engine.aircraft.A.pos.x', 'engine.list.0.headingDeg'])
  })

  for (const [name, make] of Object.entries(SUBJECTS)) {
    it(`${name}: nothing physical ever becomes NaN`, () => {
      const r = mulberry32(20260930)
      const { engine, actions } = make()
      for (let i = 0; i < 250; i++) {
        if (r() < 0.35) pick(r, actions)(r)
        engine.step(pick(r, DTS))
        const bad = nanFields(engine)
        if (bad.length) expect.fail(`step ${i}: NaN in ${bad.join(', ')}`)
      }
    })
  }
})
