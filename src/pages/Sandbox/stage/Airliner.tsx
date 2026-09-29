/**
 * A procedural A320-class airliner at true size (metres), built from code:
 * a lathe fuselage, swept wings with winglets, tail, engines, retracting
 * landing gear and exterior lights. The nose points along local −z, the wheels
 * stand on y = 0. No model files.
 */
import { forwardRef, useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { col } from '@/stage/Stage'
import type { Lights } from '../aircraftState'
import { AIRCRAFT } from '../agents'
import { glowTexture } from './glow'

/** Height of the fuselage centre line above the ground with the gear down, m. */
export const FUSELAGE_Y = 3.3
const R = AIRCRAFT.fuselageRadius
const HALF = AIRCRAFT.length / 2
const SPAN_HALF = AIRCRAFT.span / 2

// ---------------------------------------------------------------------------
// Geometry (built once, shared by every airliner in the scene)
// ---------------------------------------------------------------------------

function buildFuselage() {
  // Profile: (radius, position along the axis), tail (−) to nose (+).
  const prof: [number, number][] = [
    [0.001, -HALF],
    [0.35, -HALF + 0.2],
    [0.9, -HALF + 1.5],
    [1.5, -HALF + 4],
    [1.9, -HALF + 7.5],
    [R, -HALF + 9.8],
    [R, HALF - 6.3],
    [1.92, HALF - 4.3],
    [1.7, HALF - 2.6],
    [1.25, HALF - 1.2],
    [0.62, HALF - 0.35],
    [0.001, HALF],
  ]
  const g = new THREE.LatheGeometry(
    prof.map(([r, a]) => new THREE.Vector2(r, a)),
    40,
  )
  g.rotateX(-Math.PI / 2) // axis +y → −z: the nose now points along −z
  // The tail cone sweeps up (the classic airliner tail).
  const pos = g.attributes.position as THREE.BufferAttribute
  const tailStart = HALF - 9.8
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i)
    if (z > tailStart) pos.setY(i, pos.getY(i) + ((z - tailStart) / (HALF - tailStart)) ** 1.4 * 0.95)
  }
  g.translate(0, FUSELAGE_Y, 0)
  g.computeVertexNormals()
  return g
}

/** A flat wing-like surface from a planform (x span, s chord aft), extruded downward by `thick`. */
function planform(points: [number, number][], thick: number) {
  const shape = new THREE.Shape(points.map(([x, s]) => new THREE.Vector2(x, s)))
  const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false })
  g.rotateX(Math.PI / 2) // shape (x, s) → scene (x, 0, s); thickness goes down
  return g
}

function buildWing() {
  // Right wing, root at the fuselage side; swept back about 25°.
  const g = planform(
    [
      [R - 0.1, -3.4],
      [SPAN_HALF, 3.4],
      [SPAN_HALF, 4.9],
      [6.2, 4.1],
      [R - 0.1, 3.4],
    ],
    0.38,
  )
  // Low wing with 5° dihedral.
  g.rotateZ((5 * Math.PI) / 180)
  g.translate(0, FUSELAGE_Y - 1.05, 0)
  return g
}

function buildStabilizer() {
  const g = planform(
    [
      [0.3, 13.6],
      [6.2, 16.9],
      [6.2, 18.0],
      [0.3, 17.6],
    ],
    0.22,
  )
  g.rotateZ((4 * Math.PI) / 180)
  g.translate(0, FUSELAGE_Y + 0.75, 0)
  return g
}

function buildFin() {
  // Planform in (chord along z, height), extruded sideways.
  const shape = new THREE.Shape(
    (
      [
        [12.4, 0],
        [16.4, 6.4],
        [18.1, 6.4],
        [18.7, 0],
      ] as [number, number][]
    ).map(([s, h]) => new THREE.Vector2(s, h)),
  )
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: false })
  g.rotateY(-Math.PI / 2) // shape x (chord) → scene +z, height stays +y
  g.translate(0.15, FUSELAGE_Y + R + 0.35, 0)
  return g
}

function buildEngine() {
  const g = new THREE.CylinderGeometry(1.08, 0.92, 4.1, 28, 1, true)
  g.rotateX(Math.PI / 2)
  return g
}

let shared: ReturnType<typeof buildAll> | null = null
function buildAll() {
  return {
    fuselage: buildFuselage(),
    wing: buildWing(),
    stab: buildStabilizer(),
    fin: buildFin(),
    engine: buildEngine(),
    fan: new THREE.CircleGeometry(1.0, 28),
    pylon: new THREE.BoxGeometry(0.34, 1.0, 3.2),
    winglet: new THREE.BoxGeometry(0.1, 2.3, 1.2),
    windshield: new THREE.BoxGeometry(2.4, 0.55, 1.3),
    strut: new THREE.CylinderGeometry(0.11, 0.11, 1, 8),
    wheelSmall: new THREE.CylinderGeometry(0.36, 0.36, 0.26, 16),
    wheelMain: new THREE.CylinderGeometry(0.58, 0.58, 0.36, 18),
  }
}
function geometry() {
  if (!shared) shared = buildAll()
  return shared
}

// ---------------------------------------------------------------------------
// Lights
// ---------------------------------------------------------------------------

type LightKind = 'navRed' | 'navGreen' | 'tail' | 'beacon' | 'strobe' | 'landing' | 'taxi'
const tipY = FUSELAGE_Y - 1.05 + Math.tan((5 * Math.PI) / 180) * SPAN_HALF
const LIGHTS: { kind: LightKind; p: [number, number, number] }[] = [
  { kind: 'navRed', p: [-SPAN_HALF - 0.05, tipY, 3.9] },
  { kind: 'navGreen', p: [SPAN_HALF + 0.05, tipY, 3.9] },
  { kind: 'tail', p: [0, FUSELAGE_Y + 0.95, HALF + 0.1] },
  { kind: 'beacon', p: [0, FUSELAGE_Y + R + 0.1, 1.5] },
  { kind: 'beacon', p: [0, FUSELAGE_Y - R - 0.1, 2.5] },
  { kind: 'strobe', p: [-SPAN_HALF - 0.1, tipY, 4.4] },
  { kind: 'strobe', p: [SPAN_HALF + 0.1, tipY, 4.4] },
  { kind: 'strobe', p: [0, FUSELAGE_Y + 1.0, HALF + 0.2] },
  { kind: 'landing', p: [-3.2, FUSELAGE_Y - 1.1, -2.9] },
  { kind: 'landing', p: [3.2, FUSELAGE_Y - 1.1, -2.9] },
  { kind: 'taxi', p: [0, 1.4, -13.4] },
]

export interface AirlinerState {
  gear: boolean
  lights: Lights
}

export const PARKED_STATE: AirlinerState = { gear: true, lights: { nav: true, beacon: false, strobe: false, landing: false, taxi: false } }

/** Flash patterns: beacon about once a second, strobes a double flash (real time). */
function flashing(kind: 'beacon' | 'strobe', tS: number, steady: boolean): boolean {
  if (steady) return true
  if (kind === 'beacon') return tS % 1.0 < 0.12
  const k = tS % 1.25
  return k < 0.05 || (k > 0.14 && k < 0.19)
}

function AircraftLights({ t, stateRef, reduced, pixelRatio }: { t: ThemeTokens; stateRef: MutableRefObject<AirlinerState>; reduced: boolean; pixelRatio: number }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(LIGHTS.flatMap((l) => l.p), 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(LIGHTS.length * 3).fill(0), 3))
    return g
  }, [])
  const mat = useMemo(
    () =>
      new THREE.PointsMaterial({
        size: 7 * pixelRatio,
        sizeAttenuation: false,
        vertexColors: true,
        map: glowTexture(),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [pixelRatio],
  )
  useLayoutEffect(
    () => () => {
      geo.dispose()
      mat.dispose()
    },
    [geo, mat],
  )
  const colors = useMemo(
    () => ({ red: col(t, 'lamp-red'), green: col(t, 'lamp-green'), white: col(t, 'lamp-white'), off: new THREE.Color(0, 0, 0) }),
    [t],
  )
  useFrame((st) => {
    const s = stateRef.current.lights
    const tS = st.clock.elapsedTime
    const c = geo.attributes.color as THREE.BufferAttribute
    LIGHTS.forEach((l, i) => {
      let on = false
      let color = colors.white
      switch (l.kind) {
        case 'navRed':
          on = s.nav
          color = colors.red
          break
        case 'navGreen':
          on = s.nav
          color = colors.green
          break
        case 'tail':
          on = s.nav
          break
        case 'beacon':
          on = s.beacon && flashing('beacon', tS + i * 0.5, reduced)
          color = colors.red
          break
        case 'strobe':
          on = s.strobe && flashing('strobe', tS, reduced)
          break
        case 'landing':
          on = s.landing
          break
        case 'taxi':
          on = s.taxi
          break
      }
      const k = on ? 1 : 0
      const cc = on ? color : colors.off
      c.setXYZ(i, cc.r * k, cc.g * k, cc.b * k)
    })
    c.needsUpdate = true
  })
  return <points geometry={geo} material={mat} frustumCulled={false} userData={{ noPenPlot: true }} />
}

// ---------------------------------------------------------------------------
// The airliner
// ---------------------------------------------------------------------------

export interface AirlinerProps {
  t: ThemeTokens
  stateRef?: MutableRefObject<AirlinerState>
  reduced?: boolean
  pixelRatio?: number
  /** Accent colour of the tail. */
  accent?: 'signal' | 'brass'
}

export const Airliner = forwardRef<THREE.Group, AirlinerProps>(function Airliner({ t, stateRef, reduced = false, pixelRatio = 1, accent = 'brass' }, ref) {
  const g = geometry()
  const fallback = useRef<AirlinerState>(PARKED_STATE)
  const state = stateRef ?? fallback
  const gear = useRef<THREE.Group>(null)
  const m = useMemo(() => {
    const paint = col(t, 'stage-paint')
    return {
      body: new THREE.MeshPhysicalMaterial({ color: paint, roughness: 0.32, metalness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.2 }),
      wing: new THREE.MeshStandardMaterial({ color: paint.clone().lerp(col(t, 'stage-metal'), 0.35), roughness: 0.45, metalness: 0.35 }),
      tail: new THREE.MeshStandardMaterial({ color: col(t, accent === 'signal' ? 'stage-signal' : 'stage-brass'), roughness: 0.4, metalness: 0.3 }),
      dark: new THREE.MeshStandardMaterial({ color: col(t, 'stage-metal-dark'), roughness: 0.5, metalness: 0.6 }),
      engine: new THREE.MeshStandardMaterial({ color: paint.clone().lerp(col(t, 'stage-metal'), 0.2), roughness: 0.35, metalness: 0.5, side: THREE.DoubleSide }),
      glass: new THREE.MeshStandardMaterial({ color: col(t, 'stage-bg'), roughness: 0.15, metalness: 0.9 }),
    }
  }, [t, accent])
  useLayoutEffect(() => () => Object.values(m).forEach((x) => x.dispose()), [m])
  useFrame(() => {
    if (gear.current) gear.current.visible = state.current.gear
  })
  return (
    <group ref={ref}>
      <mesh geometry={g.fuselage} material={m.body} />
      <mesh geometry={g.windshield} material={m.glass} position={[0, FUSELAGE_Y + 1.15, -HALF + 2.3]} rotation-x={-0.35} />
      <mesh geometry={g.wing} material={m.wing} />
      <mesh geometry={g.wing} material={m.wing} scale={[-1, 1, 1]} />
      {[-1, 1].map((sx) => (
        <mesh key={sx} geometry={g.winglet} material={m.tail} position={[sx * (SPAN_HALF - 0.05), tipY + 1.0, 4.4]} />
      ))}
      <mesh geometry={g.stab} material={m.wing} />
      <mesh geometry={g.stab} material={m.wing} scale={[-1, 1, 1]} />
      <mesh geometry={g.fin} material={m.tail} />
      {[-1, 1].map((sx) => (
        <group key={sx} position={[sx * 5.75, 1.6, -2.6]}>
          <mesh geometry={g.engine} material={m.engine} />
          <mesh geometry={g.fan} material={m.dark} position={[0, 0, -1.9]} rotation-y={Math.PI} />
          <mesh geometry={g.pylon} material={m.wing} position={[0, 1.05, 0.6]} />
        </group>
      ))}
      <group ref={gear}>
        {/* Nose gear */}
        <mesh geometry={g.strut} material={m.dark} position={[0, 1.55, -AIRCRAFT.noseGear]} scale={[1, 1.9, 1]} />
        {[-0.2, 0.2].map((x) => (
          <mesh key={x} geometry={g.wheelSmall} material={m.dark} position={[x, 0.36, -AIRCRAFT.noseGear]} rotation-z={Math.PI / 2} />
        ))}
        {/* Main gear */}
        {[-3.8, 3.8].map((x) => (
          <group key={x} position={[x, 0, 0.6]}>
            <mesh geometry={g.strut} material={m.dark} position={[0, 1.7, 0]} scale={[1.4, 2.0, 1.4]} />
            {[-0.45, 0.45].map((dz) => (
              <mesh key={dz} geometry={g.wheelMain} material={m.dark} position={[0, 0.58, dz]} rotation-z={Math.PI / 2} />
            ))}
          </group>
        ))}
      </group>
      <AircraftLights t={t} stateRef={state} reduced={reduced} pixelRatio={pixelRatio} />
    </group>
  )
})
