/**
 * Airfield lighting of runway 09/27 and taxiway A, drawn as glowing points of
 * constant screen size: runway edge, threshold, end and centreline lights,
 * taxiway centreline (green) and edge (blue) lights, the approach lighting
 * system with its sequenced flashers, the A1 stop bar and the PAPI.
 * The stop bar and the PAPI follow CNS700's journey.
 */
import { useLayoutEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { ThemeTokens, TokenName } from '@/hooks/useThemeTokens'
import { col } from '@/stage/Stage'
import { CONNECTORS, RWY, STOP_BAR_Y, TWY_A_Y, TWY_HALF_WIDTH } from '@/modules/surface/layout'
import type { SandboxEngine } from '../engine'
import { papi, papiAngleDeg, PAPI_POS_M } from '../aircraftState'
import { toJ } from '../jscale'
import { glowTexture } from './glow'

type Lamp = { p: [number, number, number]; c: TokenName; k: number }

/** Length of the approach lighting system before the threshold, m. */
// TODO(expert-review): approach lighting system layout (900 m centreline with a crossbar at 300 m, as for a precision approach category I).
export const ALS_LENGTH_M = 900
const ALS_STEP_M = 30

function staticLamps(): Lamp[] {
  const out: Lamp[] = []
  const at = (x: number, y: number, c: TokenName, k = 1, h = 0.4) => out.push({ p: toJ({ x, y }, h), c, k })
  const edge = RWY.halfWidthM + 1.5
  for (let x = RWY.thresholdX; x <= RWY.endX + 0.1; x += 60) {
    at(x, edge, 'lamp-white', 0.9)
    at(x, -edge, 'lamp-white', 0.9)
  }
  for (let y = -RWY.halfWidthM; y <= RWY.halfWidthM + 0.1; y += 3) {
    at(RWY.thresholdX - 1, y, 'lamp-green')
    at(RWY.endX + 1, y, 'lamp-red')
  }
  for (let x = RWY.thresholdX + 30; x < RWY.endX - 15; x += 30) at(x, 0, 'lamp-white', 0.45, 0.1)
  // Taxiway A and the connectors: green centreline, blue edges.
  for (let x = RWY.thresholdX; x <= 2300; x += 30) at(x, TWY_A_Y, 'lamp-green', 0.7, 0.1)
  for (let x = RWY.thresholdX; x <= 2300; x += 60) {
    at(x, TWY_A_Y + TWY_HALF_WIDTH + 1, 'lamp-blue', 0.8)
    at(x, TWY_A_Y - TWY_HALF_WIDTH - 1, 'lamp-blue', 0.8)
  }
  for (const c of CONNECTORS) for (let y = RWY.halfWidthM + 8; y < TWY_A_Y; y += 15) at(c.x, y, 'lamp-green', 0.7, 0.1)
  // Approach lights: barrettes of five every 30 m, and a crossbar 300 m out.
  for (let d = ALS_STEP_M; d <= ALS_LENGTH_M; d += ALS_STEP_M) for (let y = -2; y <= 2; y++) at(RWY.thresholdX - d, y, 'lamp-white', 0.75, 0.6)
  for (let y = -15; y <= 15; y += 1.5) if (Math.abs(y) > 2.5) at(RWY.thresholdX - 300, y, 'lamp-white', 0.75, 0.6)
  return out
}

/** Dynamic lamps: A1 stop bar, sequenced flashers, PAPI units. */
const STOP_BAR = Array.from({ length: 8 }, (_, i) => ({ x: CONNECTORS[0].x - TWY_HALF_WIDTH + (i + 0.5) * ((2 * TWY_HALF_WIDTH) / 8), y: STOP_BAR_Y }))
const FLASHERS = Array.from({ length: ALS_LENGTH_M / ALS_STEP_M }, (_, i) => ({ x: RWY.thresholdX - ALS_LENGTH_M + i * ALS_STEP_M, y: 0 }))
/** PAPI units from the farthest from the runway to the nearest (the order `papi()` uses). */
const PAPI_UNITS = [3, 2, 1, 0].map((k) => ({ x: PAPI_POS_M.x, y: PAPI_POS_M.y + k * 9 }))

export function AirfieldLights({ t, engine, pixelRatio, reduced }: { t: ThemeTokens; engine: SandboxEngine; pixelRatio: number; reduced: boolean }) {
  const tex = glowTexture()
  const fixed = useMemo(() => {
    const lamps = staticLamps()
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(lamps.flatMap((l) => l.p), 3))
    const colors: number[] = []
    for (const l of lamps) {
      const c = col(t, l.c)
      colors.push(c.r * l.k, c.g * l.k, c.b * l.k)
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    return g
  }, [t])
  const dyn = useMemo(() => {
    const pts = [...STOP_BAR.map((p) => toJ(p, 0.5)), ...FLASHERS.map((p) => toJ(p, 1.2)), ...PAPI_UNITS.map((p) => toJ(p, 1.0))]
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(pts.length * 3).fill(0), 3))
    return g
  }, [])
  const mats = useMemo(() => {
    const mk = (px: number) =>
      // No fog: at night the lights are what you see first, from many miles out.
      new THREE.PointsMaterial({ size: px * pixelRatio, sizeAttenuation: false, vertexColors: true, map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false })
    return { fixed: mk(6), dyn: mk(10) }
  }, [pixelRatio, tex])
  useLayoutEffect(() => () => fixed.dispose(), [fixed])
  useLayoutEffect(() => () => dyn.dispose(), [dyn])
  useLayoutEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats])
  const c = useMemo(() => ({ red: col(t, 'lamp-red'), white: col(t, 'lamp-white') }), [t])

  useFrame((st) => {
    const attr = dyn.attributes.color as THREE.BufferAttribute
    const a = engine.journeyAircraft
    // The stop bar goes out while CNS700 is cleared to line up, and is lit again once it is on the runway.
    const lit = a?.journey?.phase !== 'lineup'
    STOP_BAR.forEach((_, i) => {
      const k = lit ? 1 : 0
      attr.setXYZ(i, c.red.r * k, c.red.g * k, c.red.b * k)
    })
    // Sequenced flashers: a flash runs toward the threshold twice a second (steady under reduced motion).
    const n = FLASHERS.length
    const run = reduced ? -1 : Math.floor((st.clock.elapsedTime * 2 * n) % n)
    FLASHERS.forEach((_, i) => {
      const k = i === run ? 1.4 : 0
      attr.setXYZ(STOP_BAR.length + i, c.white.r * k, c.white.g * k, c.white.b * k)
    })
    // PAPI: what CNS700's crew see from where it is now.
    const pose = engine.journeyPose()
    const white = pose ? papi(papiAngleDeg(pose.posM, pose.altitudeFt)) : [true, true, false, false]
    white.forEach((w, i) => {
      const cc = w ? c.white : c.red
      attr.setXYZ(STOP_BAR.length + n + i, cc.r, cc.g, cc.b)
    })
    attr.needsUpdate = true
  })

  return (
    <group userData={{ noPenPlot: true }}>
      <points geometry={fixed} material={mats.fixed} frustumCulled={false} />
      <points geometry={dyn} material={mats.dyn} frustumCulled={false} />
    </group>
  )
}

export { PAPI_UNITS, STOP_BAR }
