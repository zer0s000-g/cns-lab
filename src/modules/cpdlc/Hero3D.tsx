/**
 * The CPDLC hero: a coast and an ocean in miniature. On land, the two
 * oceanic control centres, the data link network and the radio and
 * satellite stations; over the sea, CNS123 (and CNS132 nearby). Every
 * message in flight is a packet on the path the engine uses, placed along
 * the route by its own send and arrival times on the simulator clock, as in
 * the 2D path view.
 *
 * Nothing here is to scale: distances are shrunk and the satellite is drawn
 * far closer than it really is. The page labels it.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { bearingToThreeRotationY } from '@/core/geometry'
import type { DataLinkPath } from '@/core/cpdlc'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { useReducedMotion } from '@/stores/prefs'
import { Callout3D } from '@/stage/Callout3D'
import { AircraftModel } from '@/stage/Diorama'
import { PenPlot } from '@/stage/PenPlot'
import { StudioFloor, col } from '@/stage/Stage'
import type { CpdlcEngine, Transit } from './engine'

type V3 = [number, number, number]

// ---------------------------------------------------------------------------
// Layout (scene units, not to scale): land on the west, ocean to the east
// ---------------------------------------------------------------------------

const TABLE = { x0: -10, x1: 8, z0: -5.5, z1: 5.5 }
const TOP = 0
const N = {
  xlab: [-8.4, 0.3, -1.4] as V3,
  xhbr: [-8.4, 0.3, 2.8] as V3,
  net: [-6.9, 0.35, 0.6] as V3,
  vhf: [-4.9, 1.05, -0.4] as V3,
  hf: [-5.4, 0.85, 2.6] as V3,
  ges: [-5.6, 0.45, -3.2] as V3,
  sat: [-0.6, 7.2, -4.2] as V3,
  ac: [2.6, 0, -0.6] as V3,
  other: [3.8, 0, 1.6] as V3,
}
/** Aircraft height in the scene for a flight level (heights not to scale). */
const flY = (fl: number) => 1.2 + (fl - 300) * 0.02
/** Where the HF signal turns back at the ionosphere, between the station and the aircraft. */
const ionoPoint = (): V3 => [(N.hf[0] + N.ac[0]) / 2, 5.4, (N.hf[2] + N.ac[2]) / 2]

function acPos(e: CpdlcEngine, who: 'CNS123' | 'CNS132'): V3 {
  return who === 'CNS123' ? [N.ac[0], flY(e.levelFl), N.ac[2]] : [N.other[0], flY(360), N.other[2]]
}

function relays(path: DataLinkPath): V3[] {
  if (path === 'satcom') return [N.ges, N.sat]
  if (path === 'hf') return [N.hf, ionoPoint()]
  return [N.vhf]
}

/** Polyline a message follows, from sender to receiver: the same route as the 2D path view. */
function route(e: CpdlcEngine, t: Transit): V3[] {
  if (t.kind === 'forward') return [N.xlab, N.xhbr]
  const ground = t.from === 'XLAB' || t.from === 'XHBR'
  const centre = (ground ? t.from : t.to) === 'XHBR' ? N.xhbr : N.xlab
  const air = acPos(e, (ground ? t.to : t.from) === 'CNS132' ? 'CNS132' : 'CNS123')
  const pts = [centre, N.net, ...relays(t.path === 'ground' ? e.path : t.path), air]
  return ground ? pts : pts.reverse()
}

function along(pts: V3[], f: number): V3 {
  const segs = pts.slice(1).map((p, k) => Math.hypot(p[0] - pts[k][0], p[1] - pts[k][1], p[2] - pts[k][2]))
  const total = segs.reduce((a, b) => a + b, 0)
  let d = Math.max(0, Math.min(1, f)) * total
  for (let k = 0; k < segs.length; k++) {
    if (d <= segs[k]) {
      const u = segs[k] > 0 ? d / segs[k] : 0
      return [pts[k][0] + (pts[k + 1][0] - pts[k][0]) * u, pts[k][1] + (pts[k + 1][1] - pts[k][1]) * u, pts[k][2] + (pts[k + 1][2] - pts[k][2]) * u]
    }
    d -= segs[k]
  }
  return pts[pts.length - 1]
}

// ---------------------------------------------------------------------------
// Links: thin tubes, lit for the path in use
// ---------------------------------------------------------------------------

const tubeGeo = (() => {
  const g = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true)
  g.translate(0, 0.5, 0)
  return g
})()
const UP = new THREE.Vector3(0, 1, 0)
const LINK_FRAG = `varying vec2 vUv; uniform vec3 uColor; uniform float uOpacity; uniform float uLen; uniform float uDash;
  void main(){
    float a = uOpacity;
    if (uDash > 0.0) a *= step(0.45, fract(vUv.y * uLen / uDash));
    gl_FragColor = vec4(uColor * a, a);
  }`
const LINK_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`

type Tone = 'stage-signal' | 'stage-line' | 'stage-alert' | 'stage-brass'

function Link({ t, read }: { t: ThemeTokens; read: () => { a: V3; b: V3; tone: Tone; opacity: number; dash?: number; r?: number } | null }) {
  const mesh = useRef<THREE.Mesh>(null)
  const colors = useMemo(() => ({ 'stage-signal': col(t, 'stage-signal'), 'stage-line': col(t, 'stage-line'), 'stage-alert': col(t, 'stage-alert'), 'stage-brass': col(t, 'stage-brass') }), [t])
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        uniforms: { uColor: { value: new THREE.Color() }, uOpacity: { value: 1 }, uLen: { value: 1 }, uDash: { value: 0 } },
        vertexShader: LINK_VERT,
        fragmentShader: LINK_FRAG,
      }),
    [],
  )
  useEffect(() => () => mat.dispose(), [mat])
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
    const r = s.r ?? 0.012
    m.scale.set(r, len, r)
    mat.uniforms.uColor.value.copy(colors[s.tone])
    mat.uniforms.uOpacity.value = s.opacity
    mat.uniforms.uLen.value = len
    mat.uniforms.uDash.value = s.dash ?? 0
  })
  return <mesh ref={mesh} geometry={tubeGeo} material={mat} visible={false} frustumCulled={false} userData={{ noPenPlot: true }} />
}

// ---------------------------------------------------------------------------
// The table: land with a wavy coast, and the ocean
// ---------------------------------------------------------------------------

const coastX = (z: number) => -4.4 + Math.sin(z * 0.9) * 0.35 + Math.sin(z * 2.3 + 1) * 0.15

function Table({ t }: { t: ThemeTokens }) {
  const land = useMemo(() => {
    const s = new THREE.Shape()
    s.moveTo(TABLE.x0, TABLE.z0)
    for (let k = 0; k <= 40; k++) {
      const z = TABLE.z0 + ((TABLE.z1 - TABLE.z0) * k) / 40
      s.lineTo(coastX(z), z)
    }
    s.lineTo(TABLE.x0, TABLE.z1)
    s.closePath()
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.18, bevelEnabled: false, curveSegments: 4 })
    // Shape is drawn in x/y; lay it flat (y up) with z as the shape's y.
    g.rotateX(Math.PI / 2)
    g.translate(0, 0.18, 0)
    return g
  }, [])
  useEffect(() => () => land.dispose(), [land])
  const W = TABLE.x1 - TABLE.x0
  const D = TABLE.z1 - TABLE.z0
  const cx = (TABLE.x0 + TABLE.x1) / 2
  const cz = (TABLE.z0 + TABLE.z1) / 2
  return (
    <group>
      {/* Table body */}
      <mesh position={[cx, -0.3, cz]} receiveShadow>
        <boxGeometry args={[W + 0.6, 0.6, D + 0.6]} />
        <meshStandardMaterial color={col(t, 'stage-metal-dark')} roughness={0.6} metalness={0.5} />
      </mesh>
      <mesh position={[cx, 0.004, cz]} rotation-x={-Math.PI / 2} receiveShadow userData={{ noPenPlot: true }}>
        <planeGeometry args={[W, D]} />
        <meshStandardMaterial color={col(t, 'stage-water')} emissive={col(t, 'stage-water')} emissiveIntensity={0.9} roughness={0.35} metalness={0.2} />
      </mesh>
      <mesh geometry={land} receiveShadow>
        <meshStandardMaterial color={col(t, 'stage-terrain')} roughness={0.85} metalness={0.05} />
      </mesh>
    </group>
  )
}

// ---------------------------------------------------------------------------
// Ground hardware
// ---------------------------------------------------------------------------

function Centre({ t, position, active }: { t: ThemeTokens; position: V3; active: () => boolean }) {
  const win = useRef<THREE.MeshBasicMaterial>(null)
  const glass = useMemo(() => col(t, 'stage-glass'), [t])
  const signal = useMemo(() => col(t, 'stage-signal'), [t])
  useFrame(() => {
    if (win.current) win.current.color.copy(active() ? signal : glass)
  })
  const paint = col(t, 'stage-paint')
  const dark = col(t, 'stage-metal-dark')
  return (
    <group position={[position[0], TOP + 0.18, position[2]]}>
      <mesh position={[0, 0.2, 0]} castShadow>
        <boxGeometry args={[0.9, 0.4, 0.7]} />
        <meshPhysicalMaterial color={paint} roughness={0.4} metalness={0.15} clearcoat={0.5} />
      </mesh>
      <mesh position={[0, 0.41, 0]}>
        <boxGeometry args={[0.95, 0.03, 0.75]} />
        <meshStandardMaterial color={dark} roughness={0.5} metalness={0.6} />
      </mesh>
      <mesh position={[0.451, 0.24, 0]} rotation-y={Math.PI / 2}>
        <planeGeometry args={[0.56, 0.08]} />
        <meshBasicMaterial ref={win} color={glass} toneMapped={false} />
      </mesh>
    </group>
  )
}

function NetworkHub({ t }: { t: ThemeTokens }) {
  const ring = useRef<THREE.Mesh>(null)
  const reduced = useReducedMotion()
  useFrame((_, dt) => {
    if (ring.current && !reduced) ring.current.rotation.y += dt * 0.6
  })
  return (
    <group position={[N.net[0], TOP + 0.18, N.net[2]]}>
      {[0, 1, 2].map((k) => (
        <mesh key={k} position={[(k - 1) * 0.2, 0.16, 0]} castShadow>
          <boxGeometry args={[0.16, 0.32, 0.3]} />
          <meshStandardMaterial color={col(t, 'stage-metal')} roughness={0.5} metalness={0.6} />
        </mesh>
      ))}
      <mesh ref={ring} position={[0, 0.2, 0]} rotation-x={Math.PI / 2} userData={{ noPenPlot: true }}>
        <torusGeometry args={[0.5, 0.008, 6, 48]} />
        <meshBasicMaterial color={col(t, 'stage-signal')} transparent opacity={0.6} toneMapped={false} />
      </mesh>
    </group>
  )
}

function VhfStation({ t }: { t: ThemeTokens }) {
  return (
    <group position={[N.vhf[0], TOP + 0.18, N.vhf[2]]}>
      <mesh position={[0, 0.43, 0]} castShadow>
        <cylinderGeometry args={[0.015, 0.03, 0.86, 8]} />
        <meshStandardMaterial color={col(t, 'stage-paint')} roughness={0.45} metalness={0.55} />
      </mesh>
      <mesh position={[0, 0.8, 0]} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.006, 0.006, 0.26, 6]} />
        <meshStandardMaterial color={col(t, 'stage-metal-dark')} roughness={0.4} metalness={0.8} />
      </mesh>
      {[-0.1, 0.1].map((x) => (
        <mesh key={x} position={[x, 0.86, 0]}>
          <cylinderGeometry args={[0.004, 0.004, 0.12, 6]} />
          <meshStandardMaterial color={col(t, 'stage-brass')} roughness={0.3} metalness={0.9} />
        </mesh>
      ))}
      <mesh position={[-0.18, 0.08, 0.1]} castShadow>
        <boxGeometry args={[0.2, 0.16, 0.18]} />
        <meshPhysicalMaterial color={col(t, 'stage-paint')} roughness={0.4} metalness={0.15} />
      </mesh>
    </group>
  )
}

function HfStation({ t }: { t: ThemeTokens }) {
  return (
    <group position={[N.hf[0], TOP + 0.18, N.hf[2]]}>
      {[-0.35, 0.35].map((z) => (
        <mesh key={z} position={[0, 0.34, z]} castShadow>
          <cylinderGeometry args={[0.012, 0.02, 0.68, 8]} />
          <meshStandardMaterial color={col(t, 'stage-paint')} roughness={0.45} metalness={0.55} />
        </mesh>
      ))}
      <mesh position={[0, 0.64, 0]} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.004, 0.004, 0.7, 5]} />
        <meshStandardMaterial color={col(t, 'stage-brass')} roughness={0.3} metalness={0.9} emissive={col(t, 'stage-brass')} emissiveIntensity={0.2} />
      </mesh>
      <mesh position={[-0.25, 0.08, 0]} castShadow>
        <boxGeometry args={[0.22, 0.16, 0.2]} />
        <meshPhysicalMaterial color={col(t, 'stage-paint')} roughness={0.4} metalness={0.15} />
      </mesh>
    </group>
  )
}

function EarthStation({ t }: { t: ThemeTokens }) {
  const dish = useMemo(() => {
    const pts: THREE.Vector2[] = []
    for (let k = 0; k <= 12; k++) {
      const r = (k / 12) * 0.32
      pts.push(new THREE.Vector2(r, r * r * 1.1))
    }
    return new THREE.LatheGeometry(pts, 32)
  }, [])
  useEffect(() => () => dish.dispose(), [dish])
  // Point the dish at the satellite.
  const q = useMemo(() => {
    const d = new THREE.Vector3(N.sat[0] - N.ges[0], N.sat[1] - N.ges[1], N.sat[2] - N.ges[2]).normalize()
    return new THREE.Quaternion().setFromUnitVectors(UP, d)
  }, [])
  return (
    <group position={[N.ges[0], TOP + 0.18, N.ges[2]]}>
      <mesh position={[0, 0.12, 0]} castShadow>
        <cylinderGeometry args={[0.04, 0.06, 0.24, 8]} />
        <meshStandardMaterial color={col(t, 'stage-metal')} roughness={0.5} metalness={0.6} />
      </mesh>
      <mesh geometry={dish} position={[0, 0.27, 0]} quaternion={q} castShadow>
        <meshPhysicalMaterial color={col(t, 'stage-paint')} roughness={0.35} metalness={0.4} side={THREE.DoubleSide} clearcoat={0.5} />
      </mesh>
    </group>
  )
}

function Satellite({ t }: { t: ThemeTokens }) {
  return (
    <group position={N.sat}>
      <mesh castShadow>
        <boxGeometry args={[0.26, 0.26, 0.34]} />
        <meshPhysicalMaterial color={col(t, 'stage-brass')} roughness={0.3} metalness={0.9} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.62, 0, 0]}>
          <boxGeometry args={[0.9, 0.01, 0.3]} />
          <meshStandardMaterial color={col(t, 'stage-metal-dark')} roughness={0.3} metalness={0.7} emissive={col(t, 'stage-signal')} emissiveIntensity={0.08} />
        </mesh>
      ))}
      <mesh position={[0, -0.2, 0]} rotation-x={Math.PI}>
        <coneGeometry args={[0.1, 0.12, 16, 1, true]} />
        <meshStandardMaterial color={col(t, 'stage-paint')} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

/** A faint arc of the ionosphere, shown when HF is the path. */
function Ionosphere({ t, engine }: { t: ThemeTokens; engine: CpdlcEngine }) {
  const m = useRef<THREE.Mesh>(null)
  const geo = useMemo(() => {
    const g = new THREE.CylinderGeometry(9, 9, 3.2, 48, 1, true, -0.55, 1.1)
    g.rotateX(Math.PI / 2)
    return g
  }, [])
  useEffect(() => () => geo.dispose(), [geo])
  useFrame(() => {
    if (m.current) m.current.visible = engine.path === 'hf'
  })
  const p = ionoPoint()
  return (
    <mesh ref={m} geometry={geo} position={[p[0], p[1] - 9, p[2]]} rotation-z={0} userData={{ noPenPlot: true }}>
      <meshBasicMaterial color={col(t, 'stage-glass')} transparent opacity={0.07} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
    </mesh>
  )
}

function Plane({ t, engine, who }: { t: ThemeTokens; engine: CpdlcEngine; who: 'CNS123' | 'CNS132' }) {
  const g = useRef<THREE.Group>(null)
  const drop = useRef<THREE.Mesh>(null)
  useFrame(() => {
    const p = acPos(engine, who)
    if (g.current) g.current.position.set(...p)
    if (drop.current) {
      drop.current.scale.set(1, p[1], 1)
      drop.current.position.set(p[0], p[1] / 2, p[2])
    }
  })
  return (
    <>
      <group ref={g} rotation-y={bearingToThreeRotationY(270)}>
        <group scale={2.2}>
          <AircraftModel t={t} dim={who === 'CNS132'} />
        </group>
      </group>
      <mesh ref={drop} userData={{ noPenPlot: true }}>
        <cylinderGeometry args={[0.006, 0.006, 1, 4]} />
        <meshBasicMaterial color={col(t, 'stage-line')} transparent opacity={0.35} />
      </mesh>
    </>
  )
}

// ---------------------------------------------------------------------------
// Packets: one per message in flight, placed by its own send and arrival times
// ---------------------------------------------------------------------------

const MAX_PACKETS = 8

function Packets({ t, engine }: { t: ThemeTokens; engine: CpdlcEngine }) {
  const up = useRef<THREE.Mesh[]>([])
  const down = useRef<THREE.Mesh[]>([])
  const lost = useRef<THREE.Group[]>([])
  const lostMats = useRef<THREE.MeshBasicMaterial[]>([])
  const labels = useRef<THREE.Group[]>([])
  const roots = useRef<(HTMLDivElement | null)[]>([])
  const texts = useRef<(HTMLSpanElement | null)[]>([])
  useFrame(() => {
    const now = engine.timeS
    const live = engine.transits.slice(-MAX_PACKETS)
    for (let k = 0; k < MAX_PACKETS; k++) {
      const tr = live[k]
      const u = up.current[k]
      const d = down.current[k]
      const x = lost.current[k]
      const root = roots.current[k]
      if (!tr) {
        if (u) u.visible = false
        if (d) d.visible = false
        if (x) x.visible = false
        if (root) root.style.display = 'none'
        continue
      }
      const pts = route(engine, tr)
      const endS = tr.lost ? (tr.lostS ?? now) : now
      const f = (endS - tr.sentS) / Math.max(1e-6, tr.arriveS - tr.sentS)
      const p = along(pts, f)
      const isUp = tr.from === 'XLAB' || tr.from === 'XHBR'
      if (u) {
        u.visible = !tr.lost && isUp
        u.position.set(...p)
      }
      if (d) {
        d.visible = !tr.lost && !isUp
        d.position.set(...p)
      }
      if (x) {
        x.visible = tr.lost
        x.position.set(...p)
        const fade = tr.lost ? Math.max(0, 1 - (now - (tr.lostS ?? now)) / 6) : 0
        const m = lostMats.current[k]
        if (m) m.opacity = fade
      }
      const lg = labels.current[k]
      if (lg) lg.position.set(p[0], p[1] + 0.12 + (k % 2) * 0.22, p[2])
      if (root) root.style.display = ''
      const text = texts.current[k]
      if (text) {
        const left = Math.max(0, tr.arriveS - now)
        const name = tr.label.length > 30 ? `${tr.label.slice(0, 29)}…` : tr.label
        const s = tr.lost ? `LOST: ${name}` : `${name} · ${left < 10 ? left.toFixed(1) : Math.round(left)} S`
        if (text.textContent !== s) text.textContent = s
        text.className = tr.lost ? 'text-destructive' : isUp ? 'text-signal' : 'text-brass'
      }
    }
  })
  return (
    <group>
      {Array.from({ length: MAX_PACKETS }, (_, k) => (
        <group key={k}>
          <mesh ref={(el) => void (el && (up.current[k] = el))} visible={false} userData={{ noPenPlot: true }}>
            <sphereGeometry args={[0.09, 16, 12]} />
            <meshBasicMaterial color={col(t, 'stage-signal')} toneMapped={false} />
          </mesh>
          <mesh ref={(el) => void (el && (down.current[k] = el))} visible={false} userData={{ noPenPlot: true }}>
            <boxGeometry args={[0.15, 0.15, 0.15]} />
            <meshBasicMaterial color={col(t, 'stage-brass')} toneMapped={false} />
          </mesh>
          <group ref={(el) => void (el && (lost.current[k] = el))} visible={false}>
            {[1, -1].map((s) => (
              <mesh key={s} rotation-z={(s * Math.PI) / 4} userData={{ noPenPlot: true }}>
                <boxGeometry args={[0.3, 0.04, 0.04]} />
                <meshBasicMaterial ref={(el) => void (el && s === 1 && (lostMats.current[k] = el))} color={col(t, 'stage-alert')} transparent toneMapped={false} />
              </mesh>
            ))}
          </group>
          <group ref={(el) => void (el && (labels.current[k] = el))}>
            <Callout3D position={[0, 0, 0]} lead={10} rootRef={(el) => void (roots.current[k] = el)}>
              <span ref={(el) => void (texts.current[k] = el)} />
            </Callout3D>
          </group>
        </group>
      ))}
    </group>
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

const top = (p: V3): V3 => [p[0], p[1] + 0.18, p[2]]

export function CpdlcHero({ t, engine }: { t: ThemeTokens; engine: CpdlcEngine }) {
  const lineColor = useMemo(() => col(t, 'stage-line'), [t])
  // Static ground links, and the radio or satellite legs of each path (lit when in use).
  const ground = (a: V3, b: V3, dash = 0) => () => ({ a: top(a), b: top(b), tone: 'stage-line' as Tone, opacity: 0.35, dash })
  const leg = (path: DataLinkPath, i: number) => () => {
    const pts = [N.net, ...relays(path), acPos(engine, 'CNS123')]
    const a = pts[i]
    const b = pts[i + 1]
    if (!a || !b) return null
    const inUse = engine.path === path
    const last = i === pts.length - 2
    const lost = inUse && last && engine.env.lost
    return {
      a: i === 0 ? top(a) : a,
      b,
      tone: (lost ? 'stage-alert' : inUse ? 'stage-signal' : 'stage-line') as Tone,
      opacity: lost ? 0.9 : inUse ? 0.8 : 0.08,
      dash: lost ? 0.18 : inUse && last && path !== 'vhf' ? 0.26 : 0,
      r: inUse ? 0.016 : 0.01,
    }
  }
  const paths: DataLinkPath[] = ['vhf', 'satcom', 'hf']
  const lostPoint = (): V3 | null => {
    if (!engine.env.lost) return null
    const r = relays(engine.path)
    const a = r[r.length - 1]
    const b = acPos(engine, 'CNS123')
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
  }
  return (
    <group>
      <StudioFloor t={t} y={-0.6} shadowScale={30} />
      <Table t={t} />
      <PenPlot color={lineColor}>
        <Centre t={t} position={N.xlab} active={() => engine.xlab === 'active'} />
        <Centre t={t} position={N.xhbr} active={() => engine.xhbr === 'active' || engine.xhbr === 'inactive'} />
        <NetworkHub t={t} />
        <VhfStation t={t} />
        <HfStation t={t} />
        <EarthStation t={t} />
        <Satellite t={t} />
      </PenPlot>
      <Ionosphere t={t} engine={engine} />
      <Plane t={t} engine={engine} who="CNS123" />
      <Plane t={t} engine={engine} who="CNS132" />

      <Link t={t} read={ground(N.xlab, N.net)} />
      <Link t={t} read={ground(N.xhbr, N.net)} />
      <Link t={t} read={ground(N.xlab, N.xhbr, 0.14)} />
      {paths.flatMap((p) => [0, 1, 2].map((i) => <Link key={`${p}-${i}`} t={t} read={leg(p, i)} />))}
      {/* CNS132 hears the radio too when it has logged on as CNS123 by mistake */}
      <Link
        t={t}
        read={() => {
          if (!engine.env.wrongAircraft) return null
          const r = relays(engine.path)
          return { a: r[r.length - 1], b: acPos(engine, 'CNS132'), tone: 'stage-line', opacity: 0.5, dash: 0.12 }
        }}
      />
      <Packets t={t} engine={engine} />

      {/* Labels */}
      <LiveCallout
        tone="signal"
        side="left"
        read={() => ({ pos: [N.xlab[0], 1.0, N.xlab[2]], text: `XLAB CENTRE · YOU${engine.xlab === 'active' ? ' · CONNECTED' : ''}` })}
        lead={12}
      />
      <LiveCallout side="left" read={() => ({ pos: [N.xhbr[0], 1.0, N.xhbr[2]], text: `XHBR CENTRE · NEXT${engine.xhbr === 'active' ? ' · IN CONTROL' : engine.xhbr === 'inactive' ? ' · READY' : ''}` })} lead={12} />
      <LiveCallout read={() => ({ pos: [N.net[0], 0.95, N.net[2]], text: engine.standard === 'fans' ? 'ACARS NETWORK' : 'ATN NETWORK' })} lead={10} />
      <LiveCallout
        read={() => (engine.path === 'vhf' ? { pos: [N.vhf[0] + 0.05, 1.12, N.vhf[2]], text: engine.standard === 'fans' ? 'VHF GROUND STATION' : 'VDL MODE 2 STATION' } : null)}
        lead={10}
      />
      <LiveCallout read={() => (engine.path === 'satcom' ? { pos: [N.ges[0], 0.8, N.ges[2]], text: 'GROUND EARTH STATION' } : null)} lead={10} />
      <LiveCallout read={() => (engine.path === 'satcom' ? { pos: [N.sat[0] + 1, N.sat[1], N.sat[2]], text: 'SATELLITE (FAR CLOSER THAN LIFE)' } : null)} lead={10} />
      <LiveCallout read={() => (engine.path === 'hf' ? { pos: [N.hf[0], 0.95, N.hf[2]], text: 'HF DATA LINK STATION' } : null)} lead={10} />
      <LiveCallout read={() => (engine.path === 'hf' ? { pos: ionoPoint(), text: 'VIA THE IONOSPHERE' } : null)} lead={10} />
      <LiveCallout
        tone="signal"
        side="left"
        read={() => {
          const p = acPos(engine, 'CNS123')
          const fl = Math.round(engine.levelFl)
          const climbing = Math.abs(engine.clearedFl - engine.levelFl) > 0.05
          return { pos: [p[0], p[1] + 0.5, p[2]], text: `CNS123 · YOU AS PILOT · FL${fl}${climbing ? ` → FL${engine.clearedFl}` : ''}` }
        }}
        lead={14}
      />
      <LiveCallout read={() => ({ pos: [N.other[0], flY(360) + 0.2, N.other[2]], text: engine.env.wrongAircraft ? 'CNS132 · LOGGED ON AS CNS123 BY MISTAKE' : 'CNS132 · NEARBY' })} lead={12} />
      <LiveCallout tone="alert" read={() => {
        const p = lostPoint()
        return p ? { pos: [p[0], p[1] - 0.45, p[2]], text: 'LINK DOWN · USE VOICE' } : null
      }} lead={14} />
    </group>
  )
}

export default CpdlcHero
