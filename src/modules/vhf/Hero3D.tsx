/**
 * The VHF hero: one slice of the curved Earth along the radio path, with the
 * radio site at one end and the aircraft on the line. Every pose, ray and
 * state is read from the unchanged VhfEngine each frame, so the 3D view
 * always agrees with the 2D side view, the timeline and the radios.
 *
 * Scale (heroScale.ts): the slice is 282 NM long; heights and the Earth's
 * drop are stretched ×10 with the same affine map as the side view, so
 * straight rays stay straight. The mast and aircraft are larger than life;
 * the page labels all of it.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { bearingToThreeRotationY } from '@/core/geometry'
import { radioHorizonNm, radioLineOfSightNm } from '@/core/propagation'
import { firstObstructionNm, minAltitudeForContactFt } from '@/core/vhf'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { useReducedMotion } from '@/stores/prefs'
import { Callout3D } from '@/stage/Callout3D'
import { AircraftModel } from '@/stage/Diorama'
import { PenPlot } from '@/stage/PenPlot'
import { StudioFloor, col } from '@/stage/Stage'
import { CNS707_OFFSET_NM, MOUNTAIN, SITE, mountainProfile, type VhfEngine, type Who } from './engine'
import { HERO_D_MAX, HERO_TOP_FT, SLAB_HALF_W, heroXY } from './heroScale'
import { RX_TEXT } from './labels'

type V3 = [number, number, number]

/** The Earth slice reaches a little behind the radio site, to make room for the control centre. */
const SLAB_D_MIN = -24
const SLAB_BOTTOM_Y = -2.35
/** Across the path the mountain tapers off; on the path (z = 0) it is exactly the engine's profile. */
const MOUNTAIN_SIGMA_Z = 0.8
const CONTROL_CENTRE_NM = -15
/** CNS707 flies 1 NM beyond you; it is drawn a little to the side so the two models do not overlap. */
const CNS707_Z = 0.55
const AIRCRAFT_SCALE = 0.8

const at = (d: number, h: number, z = 0): V3 => {
  const [x, y] = heroXY(d, h)
  return [x, y, z]
}
const fmtAlt = (ft: number) => (ft >= 10000 ? `FL${Math.round(ft / 100)}` : `${Math.round(ft / 100) * 100} FT`)

/** A material created once per theme and disposed when it is replaced or unmounted. */
function useOwned<T extends THREE.Material | THREE.BufferGeometry>(make: () => T, deps: unknown[]): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const v = useMemo(make, deps)
  useEffect(() => () => v.dispose(), [v])
  return v
}

// ---------------------------------------------------------------------------
// Beams: a thin tube between two points, with dashes and travelling pulses
// ---------------------------------------------------------------------------

const BEAM_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`
const BEAM_FRAG = `varying vec2 vUv; uniform vec3 uColor; uniform float uOpacity; uniform float uLen; uniform float uDash; uniform float uTime; uniform float uFlow; uniform float uPulse;
  void main(){
    float s = vUv.y * uLen;
    float a = uOpacity;
    if (uDash > 0.0) a *= step(0.42, fract(s / uDash));
    float p = fract((s - uTime * uFlow) / 0.8);
    float q = uFlow >= 0.0 ? p : 1.0 - p;
    a += uPulse * pow(max(q, 0.0), 5.0) * 1.8;
    gl_FragColor = vec4(uColor * a, a);
  }`

interface BeamState {
  a: V3
  b: V3
  opacity: number
  /** Dash period in units; 0 for a solid beam. */
  dash?: number
  /** Pulse speed along a→b in units per second (negative: b→a); 0 for none. */
  flow?: number
  /** Pulse strength, 0..1. */
  pulse?: number
  time?: number
}

const beamGeo = (() => {
  const g = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true)
  g.translate(0, 0.5, 0)
  return g
})()
const UP = new THREE.Vector3(0, 1, 0)

function Beam({ t, tone, radius, read }: { t: ThemeTokens; tone: 'stage-signal' | 'stage-brass' | 'stage-alert' | 'stage-line'; radius: number; read: () => BeamState | null }) {
  const mesh = useRef<THREE.Mesh>(null)
  const mat = useOwned(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        uniforms: {
          uColor: { value: col(t, tone) },
          uOpacity: { value: 1 },
          uLen: { value: 1 },
          uDash: { value: 0 },
          uTime: { value: 0 },
          uFlow: { value: 0 },
          uPulse: { value: 0 },
        },
        vertexShader: BEAM_VERT,
        fragmentShader: BEAM_FRAG,
      }),
    [t, tone],
  )
  const tmp = useMemo(() => ({ a: new THREE.Vector3(), d: new THREE.Vector3() }), [])
  useFrame(() => {
    const m = mesh.current
    if (!m) return
    const s = read()
    m.visible = Boolean(s)
    if (!s) return
    tmp.a.set(...s.a)
    tmp.d.set(...s.b).sub(tmp.a)
    const len = Math.max(1e-4, tmp.d.length())
    m.position.copy(tmp.a)
    m.quaternion.setFromUnitVectors(UP, tmp.d.divideScalar(len))
    m.scale.set(radius, len, radius)
    const u = mat.uniforms
    u.uLen.value = len
    u.uOpacity.value = s.opacity
    u.uDash.value = s.dash ?? 0
    u.uFlow.value = s.flow ?? 0
    u.uPulse.value = s.pulse ?? 0
    u.uTime.value = s.time ?? 0
  })
  return <mesh ref={mesh} geometry={beamGeo} material={mat} visible={false} userData={{ noPenPlot: true }} frustumCulled={false} />
}

// ---------------------------------------------------------------------------
// Expanding rings around a station while it transmits
// ---------------------------------------------------------------------------

const ringGeo = new THREE.RingGeometry(0.9, 1, 48)

function TalkRings({ t, tone, read, size = 1 }: { t: ThemeTokens; tone: 'stage-signal' | 'stage-alert'; size?: number; read: () => { pos: V3; time: number } | null }) {
  const g = useRef<THREE.Group>(null)
  const rings = useRef<THREE.Mesh[]>([])
  const reduced = useReducedMotion()
  const mats = useOwned(
    () => new THREE.MeshBasicMaterial({ color: col(t, tone), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide }),
    [t, tone],
  )
  const mat2 = useOwned(() => mats.clone(), [mats])
  useFrame(() => {
    const s = read()
    if (!g.current) return
    g.current.visible = Boolean(s)
    if (!s) return
    g.current.position.set(...s.pos)
    const ph = reduced ? 0.35 : (s.time / 1.1) % 1
    ;[mats, mat2].forEach((m, i) => {
      const f = (ph + i * 0.5) % 1
      const r = rings.current[i]
      if (r) r.scale.setScalar((0.1 + f * 0.55) * size)
      m.opacity = (1 - f) * 0.95
    })
  })
  return (
    <group ref={g} visible={false}>
      {[mats, mat2].map((m, i) => (
        <mesh key={i} ref={(el) => void (el && (rings.current[i] = el))} geometry={ringGeo} material={m} userData={{ noPenPlot: true }} />
      ))}
    </group>
  )
}

// ---------------------------------------------------------------------------
// The Earth slice (sea, the mountain when it is switched on) and its walls
// ---------------------------------------------------------------------------

function surfaceFt(mountain: boolean) {
  const profile = mountainProfile(mountain)
  return (d: number) => Math.max(0, profile(d))
}

function EarthSlab({ t, mountain }: { t: ThemeTokens; mountain: boolean }) {
  const top = useOwned(() => {
    const profile = mountainProfile(mountain)
    const nx = 280
    const nz = 20
    const water = col(t, 'stage-water')
    const terrain = col(t, 'stage-terrain')
    const high = col(t, 'stage-terrain-high')
    const pos: number[] = []
    const colors: number[] = []
    const idx: number[] = []
    const c = new THREE.Color()
    for (let i = 0; i <= nx; i++) {
      const d = SLAB_D_MIN + ((HERO_D_MAX - SLAB_D_MIN) * i) / nx
      for (let j = 0; j <= nz; j++) {
        const z = -SLAB_HALF_W + (2 * SLAB_HALF_W * j) / nz
        const hm = Math.max(0, profile(d)) * Math.exp(-(z * z) / (2 * MOUNTAIN_SIGMA_Z ** 2))
        const [x, y] = heroXY(d, hm)
        pos.push(x, y, z)
        const k = Math.min(1, hm / MOUNTAIN.peakFt)
        if (hm < 60) c.copy(water)
        else c.copy(terrain).lerp(high, k)
        colors.push(c.r, c.g, c.b)
        if (i < nx && j < nz) {
          const a = i * (nz + 1) + j
          const b = a + nz + 1
          idx.push(a, a + 1, b, a + 1, b + 1, b)
        }
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    g.setIndex(idx)
    g.computeVertexNormals()
    return g
  }, [t, mountain])
  const topMat = useOwned(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.15, emissive: col(t, 'stage-water'), emissiveIntensity: 0.9 }), [t])
  // Sea level along the cut face, in brass: the curve of the Earth, side-on.
  const rim = useOwned(() => {
    const pts: THREE.Vector3[] = []
    for (let k = 0; k <= 120; k++) {
      const d = SLAB_D_MIN + ((HERO_D_MAX - SLAB_D_MIN) * k) / 120
      pts.push(new THREE.Vector3(...at(d, 0, SLAB_HALF_W + 0.004)))
    }
    return new THREE.BufferGeometry().setFromPoints(pts)
  }, [])
  const rimMat = useOwned(() => new THREE.LineBasicMaterial({ color: col(t, 'stage-brass'), transparent: true, opacity: 0.9, toneMapped: false }), [t])
  const rimLine = useMemo(() => {
    const l = new THREE.Line(rim, rimMat)
    l.userData.noPenPlot = true
    return l
  }, [rim, rimMat])
  // Distance ticks across the slice every 50 NM, as on the side view.
  const ticks = useOwned(() => {
    const pos: number[] = []
    for (let d = 50; d <= HERO_D_MAX; d += 50) {
      const [x, y] = heroXY(d, 0)
      pos.push(x, y + 0.006, -SLAB_HALF_W, x, y + 0.006, SLAB_HALF_W, x, y + 0.006, SLAB_HALF_W, x, y - 0.12, SLAB_HALF_W)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    return g
  }, [])
  const tickMat = useOwned(() => new THREE.LineBasicMaterial({ color: col(t, 'stage-line'), transparent: true, opacity: 0.35, toneMapped: false }), [t])
  const tickLines = useMemo(() => {
    const l = new THREE.LineSegments(ticks, tickMat)
    l.userData.noPenPlot = true
    return l
  }, [ticks, tickMat])
  // Walls: the cut faces of the slice (the curve of the Earth seen side-on) and the two ends.
  const walls = useMemo(() => {
    const nx = 140
    const tri: number[] = []
    const q = (a: V3, b: V3, c: V3, d: V3) => tri.push(...a, ...b, ...c, ...a, ...c, ...d)
    for (let i = 0; i < nx; i++) {
      const d0 = SLAB_D_MIN + ((HERO_D_MAX - SLAB_D_MIN) * i) / nx
      const d1 = SLAB_D_MIN + ((HERO_D_MAX - SLAB_D_MIN) * (i + 1)) / nx
      const [x0, y0] = heroXY(d0, 0)
      const [x1, y1] = heroXY(d1, 0)
      q([x0, SLAB_BOTTOM_Y, SLAB_HALF_W], [x1, SLAB_BOTTOM_Y, SLAB_HALF_W], [x1, y1, SLAB_HALF_W], [x0, y0, SLAB_HALF_W])
      q([x1, SLAB_BOTTOM_Y, -SLAB_HALF_W], [x0, SLAB_BOTTOM_Y, -SLAB_HALF_W], [x0, y0, -SLAB_HALF_W], [x1, y1, -SLAB_HALF_W])
    }
    for (const d of [SLAB_D_MIN, HERO_D_MAX]) {
      const [x, y] = heroXY(d, 0)
      const s = d === SLAB_D_MIN ? 1 : -1
      q([x, SLAB_BOTTOM_Y, -SLAB_HALF_W * s], [x, SLAB_BOTTOM_Y, SLAB_HALF_W * s], [x, y, SLAB_HALF_W * s], [x, y, -SLAB_HALF_W * s])
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3))
    g.computeVertexNormals()
    return g
  }, [])
  useEffect(() => () => walls.dispose(), [walls])
  return (
    <group>
      <mesh geometry={top} material={topMat} receiveShadow userData={{ noPenPlot: true }} />
      <PenPlot color={col(t, 'stage-line')} keepLinesOpacity={0.3}>
        <mesh geometry={walls}>
          <meshStandardMaterial color={col(t, 'stage-metal')} roughness={0.75} metalness={0.3} side={THREE.DoubleSide} />
        </mesh>
      </PenPlot>
      <primitive object={rimLine} />
      <primitive object={tickLines} />
      {[100, 200].map((d) => (
        <Callout3D key={d} position={at(d, 0, SLAB_HALF_W)} lead={6}>
          {`${d} NM`}
        </Callout3D>
      ))}
    </group>
  )
}

/** Hatched region with no line of sight to the radio site, and its upper edge (the lowest height with contact). */
function ShadowZone({ t, mountain }: { t: ThemeTokens; mountain: boolean }) {
  const curve = useMemo(() => {
    const profile = mountainProfile(mountain)
    const surf = surfaceFt(mountain)
    const pts: { d: number; floor: number; ground: number }[] = []
    for (let d = 0.5; d <= HERO_D_MAX; d += 1.5) pts.push({ d, floor: minAltitudeForContactFt(SITE.antennaFt, d, profile), ground: surf(d) })
    return pts
  }, [mountain])
  const sheet = useOwned(() => {
    const pos: number[] = []
    const idx: number[] = []
    const cap = HERO_TOP_FT * 1.05
    curve.forEach(({ d, floor, ground }, i) => {
      const [x0, y0] = heroXY(d, ground)
      const [x1, y1] = heroXY(d, Math.max(ground, Math.min(floor, cap)))
      pos.push(x0, y0, 0, x1, y1, 0)
      if (i < curve.length - 1) {
        const b = i * 2
        idx.push(b, b + 1, b + 3, b, b + 3, b + 2)
      }
    })
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setIndex(idx)
    return g
  }, [curve])
  const sheetMat = useOwned(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
        uniforms: { uColor: { value: col(t, 'stage-line') } },
        vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `varying vec2 vP; uniform vec3 uColor;
          void main(){
            float stripe = step(0.72, fract((vP.x + vP.y) * 5.0));
            float a = 0.07 + stripe * 0.2;
            gl_FragColor = vec4(uColor, a);
          }`,
      }),
    [t],
  )
  const edge = useOwned(() => {
    const pts = [new THREE.Vector3(...at(0, SITE.antennaFt))]
    for (const p of curve) if (p.floor <= HERO_TOP_FT * 1.05) pts.push(new THREE.Vector3(...at(p.d, p.floor)))
    const g = new THREE.BufferGeometry().setFromPoints(pts)
    return g
  }, [curve])
  const edgeMat = useOwned(() => new THREE.LineDashedMaterial({ color: col(t, 'stage-line'), dashSize: 0.14, gapSize: 0.09, transparent: true, opacity: 0.85, toneMapped: false }), [t])
  const line = useMemo(() => {
    const l = new THREE.Line(edge, edgeMat)
    l.computeLineDistances()
    l.userData.noPenPlot = true
    return l
  }, [edge, edgeMat])
  // A label for the shadow, placed where it is widest in view.
  const labelD = 225
  const labelH = (curve.find((p) => p.d >= labelD)?.floor ?? 30000) * 0.45
  return (
    <group>
      <mesh geometry={sheet} material={sheetMat} renderOrder={-1} userData={{ noPenPlot: true }} />
      <primitive object={line} />
      <Callout3D position={at(labelD, labelH, 0)} side="left" lead={14}>
        NO LINE OF SIGHT
      </Callout3D>
    </group>
  )
}

/** Constant heights above the sea curve with the Earth, as on the side view. */
function AltitudeLines({ t }: { t: ThemeTokens }) {
  const mat = useOwned(() => new THREE.LineBasicMaterial({ color: col(t, 'stage-line'), transparent: true, opacity: 0.28, toneMapped: false }), [t])
  const lines = useMemo(
    () =>
      [10000, 20000, 30000, 40000].map((alt) => {
        const pts: THREE.Vector3[] = []
        for (let k = 0; k <= 90; k++) {
          const d = SLAB_D_MIN + ((HERO_D_MAX - SLAB_D_MIN) * k) / 90
          pts.push(new THREE.Vector3(...at(d, alt, -0.02)))
        }
        const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat)
        l.userData.noPenPlot = true
        return { alt, l }
      }),
    [mat],
  )
  useEffect(() => () => lines.forEach(({ l }) => l.geometry.dispose()), [lines])
  return (
    <group>
      {lines.map(({ alt, l }) => (
        <group key={alt}>
          <primitive object={l} />
          <Callout3D position={at(HERO_D_MAX - 2, alt, 0)} side="left" lead={8}>
            {`${alt.toLocaleString('en-US')} FT`}
          </Callout3D>
        </group>
      ))}
    </group>
  )
}

// ---------------------------------------------------------------------------
// The radio site (mast, antennas, transmitter hut) and the control centre
// ---------------------------------------------------------------------------

function RadioSite({ t, engine }: { t: ThemeTokens; engine: VhfEngine }) {
  const mainLamp = useRef<THREE.MeshStandardMaterial>(null)
  const stbyLamp = useRef<THREE.MeshStandardMaterial>(null)
  const alertC = useMemo(() => col(t, 'stage-alert'), [t])
  const signalC = useMemo(() => col(t, 'stage-signal'), [t])
  const offC = useMemo(() => col(t, 'stage-metal'), [t])
  useFrame((state) => {
    const failed = engine.failures.txFailure
    const onMain = engine.vccs.transmitter === 'main'
    if (mainLamp.current) {
      const m = mainLamp.current
      if (failed) {
        m.color.copy(alertC)
        m.emissive.copy(alertC)
        m.emissiveIntensity = 1.2 + Math.sin(state.clock.elapsedTime * 6) * 1.0
      } else {
        m.color.copy(onMain ? signalC : offC)
        m.emissive.copy(onMain ? signalC : offC)
        m.emissiveIntensity = onMain ? 1.6 : 0.05
      }
    }
    if (stbyLamp.current) {
      const m = stbyLamp.current
      m.color.copy(onMain ? offC : signalC)
      m.emissive.copy(onMain ? offC : signalC)
      m.emissiveIntensity = onMain ? 0.05 : 1.6
    }
  })
  const base = at(0, 0)
  const paint = col(t, 'stage-paint')
  const dark = col(t, 'stage-metal-dark')
  const metal = col(t, 'stage-metal')
  const MAST_H = 0.62
  return (
    <group position={base}>
      {/* Level pad, sunk into the slope of the curved ground */}
      <mesh position={[0, -0.02, 0]}>
        <boxGeometry args={[0.62, 0.08, 0.5]} />
        <meshStandardMaterial color={metal} roughness={0.95} />
      </mesh>
      {/* Transmitter hut: main and standby transmitters, each with its lamp */}
      <mesh position={[-0.16, 0.1, 0.1]} castShadow>
        <boxGeometry args={[0.22, 0.16, 0.2]} />
        <meshPhysicalMaterial color={paint} roughness={0.4} metalness={0.15} clearcoat={0.5} />
      </mesh>
      <mesh position={[-0.16, 0.19, 0.1]}>
        <boxGeometry args={[0.25, 0.02, 0.23]} />
        <meshStandardMaterial color={dark} roughness={0.5} metalness={0.6} />
      </mesh>
      <mesh position={[-0.2, 0.13, 0.205]}>
        <sphereGeometry args={[0.014, 10, 8]} />
        <meshStandardMaterial ref={mainLamp} color={signalC} emissive={signalC} emissiveIntensity={1.6} toneMapped={false} />
      </mesh>
      <mesh position={[-0.12, 0.13, 0.205]}>
        <sphereGeometry args={[0.014, 10, 8]} />
        <meshStandardMaterial ref={stbyLamp} color={offC} emissive={offC} emissiveIntensity={0.05} toneMapped={false} />
      </mesh>
      {/* Mast with a cross-arm of vertical dipoles (one per frequency) */}
      <mesh position={[0.1, MAST_H / 2, 0]} castShadow>
        <cylinderGeometry args={[0.012, 0.022, MAST_H, 8]} />
        <meshStandardMaterial color={paint} roughness={0.45} metalness={0.55} />
      </mesh>
      {[0.36, 0.5].map((y) => (
        <mesh key={y} position={[0.1, y, 0]} rotation-z={Math.PI / 2}>
          <cylinderGeometry args={[0.006, 0.006, 0.26, 6]} />
          <meshStandardMaterial color={dark} roughness={0.4} metalness={0.8} />
        </mesh>
      ))}
      {[-0.1, 0, 0.1].map((dx) =>
        [0.36, 0.5].map((y) => (
          <mesh key={`${dx}-${y}`} position={[0.1 + dx, y + 0.06, 0]}>
            <cylinderGeometry args={[0.004, 0.004, 0.12, 6]} />
            <meshStandardMaterial color={col(t, 'stage-brass')} roughness={0.3} metalness={0.9} />
          </mesh>
        )),
      )}
      <mesh position={[0.1, MAST_H + 0.02, 0]}>
        <sphereGeometry args={[0.012, 10, 8]} />
        <meshStandardMaterial color={alertC} emissive={alertC} emissiveIntensity={0.8} toneMapped={false} />
      </mesh>
    </group>
  )
}

function ControlCentre({ t }: { t: ThemeTokens }) {
  const base = at(CONTROL_CENTRE_NM, 0)
  const paint = col(t, 'stage-paint')
  const dark = col(t, 'stage-metal-dark')
  return (
    <group position={base}>
      <mesh position={[0, 0.07, 0]} castShadow>
        <boxGeometry args={[0.46, 0.18, 0.4]} />
        <meshPhysicalMaterial color={paint} roughness={0.4} metalness={0.15} clearcoat={0.5} />
      </mesh>
      <mesh position={[0, 0.17, 0]}>
        <boxGeometry args={[0.5, 0.02, 0.44]} />
        <meshStandardMaterial color={dark} roughness={0.5} metalness={0.6} />
      </mesh>
      {/* Lit window band: the controllers' room */}
      <mesh position={[0, 0.1, 0.201]}>
        <planeGeometry args={[0.38, 0.04]} />
        <meshBasicMaterial color={col(t, 'stage-glass')} toneMapped={false} />
      </mesh>
    </group>
  )
}

/** The landline from the control centre's voice switch to the radio site, laid along the ground. */
function Landline({ t }: { t: ThemeTokens }) {
  const geo = useOwned(() => {
    const pts: THREE.Vector3[] = []
    for (let k = 0; k <= 20; k++) {
      const d = CONTROL_CENTRE_NM + ((0 - CONTROL_CENTRE_NM) * k) / 20
      pts.push(new THREE.Vector3(...at(d, 0, 0.3)).add(new THREE.Vector3(0, 0.015, 0)))
    }
    return new THREE.BufferGeometry().setFromPoints(pts)
  }, [])
  const mat = useOwned(() => new THREE.LineBasicMaterial({ color: col(t, 'stage-brass'), transparent: true, opacity: 0.9, toneMapped: false }), [t])
  const line = useMemo(() => {
    const l = new THREE.Line(geo, mat)
    l.userData.noPenPlot = true
    return l
  }, [geo, mat])
  return <primitive object={line} />
}

// ---------------------------------------------------------------------------
// Aircraft on the line
// ---------------------------------------------------------------------------

function Plane({ t, engine, who, z = 0, dim, visible }: { t: ThemeTokens; engine: VhfEngine; who: Who; z?: number; dim?: boolean; visible?: () => boolean }) {
  const g = useRef<THREE.Group>(null)
  const drop = useRef<THREE.Mesh>(null)
  useFrame(() => {
    if (!g.current) return
    const on = visible ? visible() : true
    g.current.visible = on
    if (drop.current) drop.current.visible = on
    if (!on) return
    const [d, h] = engine.position(who)
    const p = at(d, h, z)
    g.current.position.set(...p)
    if (drop.current) {
      const ground = at(d, surfaceFt(engine.failures.mountain)(d), z)[1]
      const len = Math.max(0.001, p[1] - ground)
      drop.current.scale.set(1, len, 1)
      drop.current.position.set(p[0], ground + len / 2, z)
    }
  })
  return (
    <>
      <group ref={g} rotation-y={bearingToThreeRotationY(90)}>
        <group scale={AIRCRAFT_SCALE}>
          <AircraftModel t={t} dim={dim} />
        </group>
      </group>
      <mesh ref={drop} userData={{ noPenPlot: true }}>
        <cylinderGeometry args={[0.005, 0.005, 1, 4]} />
        <meshBasicMaterial color={col(t, 'stage-line')} transparent opacity={0.3} />
      </mesh>
    </>
  )
}

/** A world-anchored label whose text and visibility follow the engine. */
function LiveCallout({
  read,
  tone = 'default',
  side = 'right',
  lead = 18,
}: {
  read: () => { pos: V3; text: string } | null
  tone?: 'default' | 'signal' | 'brass' | 'alert'
  side?: 'left' | 'right'
  lead?: number
}) {
  const g = useRef<THREE.Group>(null)
  const root = useRef<HTMLDivElement>(null)
  const text = useRef<HTMLSpanElement>(null)
  useFrame(() => {
    const s = read()
    // drei's Html ignores the parent's visibility, so hide the label directly.
    if (root.current) root.current.style.display = s ? '' : 'none'
    if (!s || !g.current) return
    g.current.position.set(...s.pos)
    if (text.current && text.current.textContent !== s.text) text.current.textContent = s.text
  })
  return (
    <group ref={g}>
      <Callout3D position={[0, 0, 0]} tone={tone} side={side} lead={lead} rootRef={root}>
        <span ref={text} />
      </Callout3D>
    </group>
  )
}

// ---------------------------------------------------------------------------

function isOnAir(engine: VhfEngine, who: Who) {
  const t = engine.timeS
  return engine.transmissions.some((x) => x.who === who && x.radiated && x.start <= t && (x.end === null || x.end > t))
}

const FLOW_U_PER_S = 2.4

export function VhfHero({ t, engine }: { t: ThemeTokens; engine: VhfEngine }) {
  const [mountain, setMountain] = useState(engine.failures.mountain)
  const mountainRef = useRef(mountain)
  useFrame(() => {
    // Rebuild the terrain only when the learner toggles the mountain (never per frame).
    if (engine.failures.mountain !== mountainRef.current) {
      mountainRef.current = engine.failures.mountain
      setMountain(engine.failures.mountain)
    }
  })
  const ant = at(0, SITE.antennaFt)
  const lineColor = useMemo(() => col(t, 'stage-line'), [t])

  // Ray from the antenna to an aircraft; the learner's ray shows where it is blocked.
  const rayTo = (who: 'CNS101' | 'CNS202' | 'CNS303') => (): BeamState | null => {
    if (who === 'CNS303' && !engine.failures.stuckMic) return null
    const level = who === 'CNS303' ? engine.levelAt('CNS303', 'ground') : engine.levelAt('controller', who)
    if (!(level > -Infinity)) return null
    const [d, h] = engine.position(who)
    const down = isOnAir(engine, 'controller')
    const up = isOnAir(engine, who)
    return {
      a: ant,
      b: at(d, h),
      opacity: who === 'CNS101' ? 0.95 : 0.45,
      flow: up ? -FLOW_U_PER_S : down ? FLOW_U_PER_S : 0,
      pulse: up || down ? 1 : 0,
      time: engine.timeS,
    }
  }
  const blockedPoint = (): { s: number; h: number } | null => {
    if (engine.learnerInContact()) return null
    const [d, h] = engine.position('CNS101')
    const s = firstObstructionNm(SITE.antennaFt, d, h, engine.profile()) ?? d
    return { s, h: surfaceFt(engine.failures.mountain)(s) }
  }
  const limit = () => {
    const alt = engine.params.altitudeFt
    const dMax = radioLineOfSightNm(SITE.antennaFt, alt)
    return { alt, dMax, show: dMax <= HERO_D_MAX }
  }

  return (
    <group>
      <StudioFloor t={t} y={SLAB_BOTTOM_Y} shadowScale={34} />
      <EarthSlab t={t} mountain={mountain} />
      <ShadowZone t={t} mountain={mountain} />
      <AltitudeLines t={t} />
      <PenPlot color={lineColor}>
        <RadioSite t={t} engine={engine} />
        <ControlCentre t={t} />
      </PenPlot>
      <Landline t={t} />

      {/* Aircraft */}
      <Plane t={t} engine={engine} who="CNS101" />
      <Plane t={t} engine={engine} who="CNS202" dim />
      <Plane t={t} engine={engine} who="CNS303" dim visible={() => engine.failures.stuckMic} />
      <Plane t={t} engine={engine} who="CNS707" z={CNS707_Z} dim visible={() => engine.failures.interference} />

      {/* Rays: straight lines from the antenna, at its true 100 ft height */}
      <Beam t={t} tone="stage-signal" radius={0.014} read={rayTo('CNS101')} />
      <Beam t={t} tone="stage-signal" radius={0.009} read={rayTo('CNS202')} />
      <Beam t={t} tone="stage-signal" radius={0.009} read={rayTo('CNS303')} />
      <Beam
        t={t}
        tone="stage-alert"
        radius={0.014}
        read={() => {
          const b = blockedPoint()
          return b ? { a: ant, b: at(b.s, b.h), opacity: 0.95, dash: 0.16 } : null
        }}
      />
      <Beam
        t={t}
        tone="stage-alert"
        radius={0.008}
        read={() => {
          const b = blockedPoint()
          if (!b) return null
          const [d, h] = engine.position('CNS101')
          return { a: at(b.s, b.h), b: at(d, h), opacity: 0.45, dash: 0.08 }
        }}
      />
      {/* The smooth-Earth limit at your altitude: the ray that just grazes the sea at the antenna's horizon */}
      <Beam
        t={t}
        tone="stage-brass"
        radius={0.007}
        read={() => {
          const l = limit()
          return l.show ? { a: ant, b: at(l.dMax, l.alt), opacity: 0.6, dash: 0.22 } : null
        }}
      />
      <HorizonDot t={t} />

      {/* Who is on the air */}
      <TalkRings t={t} tone="stage-signal" read={() => (isOnAir(engine, 'controller') ? { pos: [ant[0] + 0.1, ant[1] + 0.45, 0], time: engine.timeS } : null)} />
      {(['CNS101', 'CNS202'] as const).map((w) => (
        <TalkRings
          key={w}
          t={t}
          tone="stage-signal"
          read={() => {
            if (!engine.isTransmitting(w)) return null
            const [d, h] = engine.position(w)
            return { pos: at(d, h), time: engine.timeS }
          }}
        />
      ))}
      <TalkRings
        t={t}
        tone="stage-alert"
        read={() => {
          if (!engine.failures.stuckMic) return null
          const [d, h] = engine.position('CNS303')
          return { pos: at(d, h), time: engine.timeS }
        }}
      />
      <TalkRings
        t={t}
        tone="stage-signal"
        size={0.7}
        read={() => {
          if (!engine.isTransmitting('CNS707')) return null
          const [d, h] = engine.position('CNS707')
          return { pos: at(d, h, CNS707_Z), time: engine.timeS }
        }}
      />
      {/* Two carriers at once at the controller's receiver: a squeal */}
      <TalkRings t={t} tone="stage-alert" size={1.6} read={() => (engine.controllerView().rx.state === 'blocked' ? { pos: [ant[0] + 0.1, ant[1] + 0.3, 0], time: engine.timeS * 2 } : null)} />

      {/* Labels */}
      <Callout3D position={[ant[0] + 0.2, ant[1] + 0.66, 0]} tone="signal" lead={22}>
        RADIO SITE · 100 FT ANTENNA
      </Callout3D>
      <Callout3D position={at(CONTROL_CENTRE_NM, 1200, 0)} lead={18}>
        CONTROL CENTRE · VOICE SWITCH
      </Callout3D>
      <LiveCallout
        tone="signal"
        side="left"
        read={() => {
          const [d, h] = engine.position('CNS101')
          const p = at(d, h)
          const v = engine.learnerView()
          const contact = engine.learnerInContact()
          const rx = engine.pttActive ? 'TRANSMITTING' : RX_TEXT[v.rx.state].split(':')[0].toUpperCase()
          return { pos: [p[0], p[1] + 0.2, 0], text: `CNS101 (YOU) · ${fmtAlt(h)} · ${contact ? rx : 'NO CONTACT'}` }
        }}
      />
      <LiveCallout
        read={() => {
          const [d, h] = engine.position('CNS202')
          const p = at(d, h)
          return { pos: [p[0], p[1] + 0.18, 0], text: `CNS202 · ${fmtAlt(h)}` }
        }}
        lead={12}
      />
      <LiveCallout
        tone="alert"
        side="left"
        read={() => {
          if (!engine.failures.stuckMic) return null
          const [d, h] = engine.position('CNS303')
          const p = at(d, h)
          return { pos: [p[0], p[1] + 0.12, 0], text: 'CNS303 · STUCK MICROPHONE' }
        }}
      />
      <LiveCallout
        read={() => {
          if (!engine.failures.interference) return null
          const [d, h] = engine.position('CNS707')
          const p = at(d, h, CNS707_Z)
          return { pos: [p[0], p[1] - 0.14, CNS707_Z], text: `CNS707 · NEXT CHANNEL · ${CNS707_OFFSET_NM} NM AWAY` }
        }}
        lead={12}
      />
      <LiveCallout
        tone="alert"
        read={() => {
          const b = blockedPoint()
          if (!b) return null
          const byMountain = engine.failures.mountain && Math.abs(b.s - MOUNTAIN.centerNm) < 3 * MOUNTAIN.sigmaNm
          const p = at(b.s, b.h)
          return { pos: [p[0], p[1] + 0.05, 0], text: byMountain ? 'BLOCKED BY THE MOUNTAIN' : `BLOCKED: THE RAY MEETS THE SEA ${b.s.toFixed(0)} NM OUT` }
        }}
        lead={24}
      />
      <LiveCallout
        tone="brass"
        side="left"
        read={() => {
          const l = limit()
          if (!l.show) return null
          const p = at(l.dMax, l.alt)
          return { pos: [p[0], p[1] - 0.05, 0], text: `LINE-OF-SIGHT LIMIT AT ${fmtAlt(l.alt)} · ${Math.round(l.dMax)} NM` }
        }}
        lead={12}
      />
      <LiveCallout
        tone="alert"
        side="left"
        read={() => (engine.controllerView().rx.state === 'blocked' ? { pos: [ant[0] - 0.1, ant[1] + 0.3, 0], text: 'SQUEAL: TWO STATIONS AT ONCE' } : null)}
      />
      <LiveCallout
        read={() => {
          if (!engine.failures.mountain) return null
          const p = at(MOUNTAIN.centerNm, MOUNTAIN.peakFt)
          return { pos: [p[0], p[1] + 0.05, 0], text: `${MOUNTAIN.name.toUpperCase()} · ${MOUNTAIN.peakFt.toLocaleString('en-US')} FT` }
        }}
        side="left"
        lead={14}
      />
    </group>
  )
}

/** Where the smooth-Earth limit ray grazes the sea: the antenna's own radio horizon. */
function HorizonDot({ t }: { t: ThemeTokens }) {
  const d = radioHorizonNm(SITE.antennaFt)
  const p = at(d, 0)
  return (
    <mesh position={[p[0], p[1] + 0.012, 0]} userData={{ noPenPlot: true }}>
      <sphereGeometry args={[0.03, 12, 8]} />
      <meshBasicMaterial color={col(t, 'stage-brass')} toneMapped={false} />
    </mesh>
  )
}

export default VhfHero
