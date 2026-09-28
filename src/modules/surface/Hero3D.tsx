/**
 * The Surface Movement hero: a miniature of the CNS Lab airport. Runway,
 * taxiways, apron and roads are painted from the same drawing code as the
 * airport map (draw.ts, layout.ts), so the two always agree. Every aircraft,
 * vehicle, stop bar, alert and the radar antenna is read from the unchanged
 * SurfaceEngine each frame; the scene has no motion of its own.
 *
 * Scale (see heroScale.ts): 1 unit = 250 m, heights ×3, aircraft ×2 and
 * vehicles ×6 larger than life, the tower and its radar wider than life.
 */

import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { bearingDeg, bearingToThreeRotationY, normalize360, toRad, type Vec2 } from '@/core/geometry'
import { SHAPE_SIZE, pointAt } from '@/core/surface'
import { metresToFt } from '@/core/units'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { mix, toThreeStyle, withAlpha } from '@/lib/color'
import { useReducedMotion } from '@/stores/prefs'
import { Callout3D } from '@/stage/Callout3D'
import { AircraftModel } from '@/stage/Diorama'
import { PenPlot } from '@/stage/PenPlot'
import { StudioFloor, col } from '@/stage/Stage'
import { drawAirport } from './draw'
import type { Source, SurfaceEngine, SurfaceObject } from './engine'
import {
  CAR_PARK,
  CONNECTORS,
  FAILING_RECEIVER,
  HANGAR,
  MLAT_RECEIVERS,
  RWY,
  SMR_HEIGHT_M,
  SMR_SITE,
  STOP_BAR_Y,
  TERMINAL,
  TOWER_POS,
  TWY_HALF_WIDTH,
} from './layout'
import { AIRCRAFT_X, BOUNDS, SU, TOWER_X, VEHICLE_X, VU, toA } from './heroScale'

const W = (BOUNDS.maxX - BOUNDS.minX) * SU
const D = (BOUNDS.maxY - BOUNDS.minY) * SU
const CX = ((BOUNDS.minX + BOUNDS.maxX) / 2) * SU
const CZ = -((BOUNDS.minY + BOUNDS.maxY) / 2) * SU
const FLOOR = -1.2
const SMR_Y = SMR_HEIGHT_M * VU

/** A token colour for the night stage, lifted to a readable lightness (light-theme tokens are darker). */
function glowCol(t: ThemeTokens, name: keyof ThemeTokens, minL = 0.52) {
  const c = col(t, name)
  const hsl = { h: 0, s: 0, l: 0 }
  c.getHSL(hsl)
  c.setHSL(hsl.h, hsl.s, Math.max(hsl.l, minL))
  return c
}

// ---------------------------------------------------------------------------
// The airfield: one canvas texture painted by the airport map's own drawing code
// ---------------------------------------------------------------------------

function useAirportTexture(t: ThemeTokens) {
  return useMemo(() => {
    const cw = 2048
    const k = cw / (BOUNDS.maxX - BOUNDS.minX)
    const ch = Math.round((BOUNDS.maxY - BOUNDS.minY) * k)
    const c = document.createElement('canvas')
    c.width = cw
    c.height = ch
    const ctx = c.getContext('2d')!
    const toS = (p: Vec2) => ({ x: (p.x - BOUNDS.minX) * k, y: (BOUNDS.maxY - p.y) * k })
    const grass = mix(t['stage-terrain'], t['stage-floor'], 0.62)
    ctx.fillStyle = toThreeStyle(grass)
    ctx.fillRect(0, 0, cw, ch)
    drawAirport(ctx, toS, k, {
      grass,
      runway: toThreeStyle(mix(t['stage-metal-dark'], t['stage-bg'], 0.35)),
      taxiway: toThreeStyle(mix(t['stage-metal'], t['stage-paint'], 0.12)),
      marking: toThreeStyle(t['stage-paint']),
      guideLine: withAlpha(toThreeStyle(t['stage-brass']), 0.85),
      building: toThreeStyle(t['stage-metal-dark']),
      buildingEdge: withAlpha(toThreeStyle(t['stage-line']), 0.5),
      road: toThreeStyle(mix(t['stage-metal'], t['stage-floor'], 0.3)),
      text: toThreeStyle(t['stage-line']),
      muted: toThreeStyle(t['stage-line']),
    })
    // Runway protected area (inside the holding positions), dashed like on the map.
    ctx.save()
    ctx.strokeStyle = withAlpha(toThreeStyle(t['stage-line']), 0.55)
    ctx.lineWidth = 2
    ctx.setLineDash([10, 7])
    const a = toS({ x: RWY.thresholdX - 60, y: RWY.holdingDistM })
    const b = toS({ x: RWY.endX + 60, y: -RWY.holdingDistM })
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y)
    ctx.restore()
    // Car park bays behind the terminal.
    ctx.save()
    ctx.strokeStyle = withAlpha(toThreeStyle(t['stage-line']), 0.22)
    ctx.lineWidth = 1
    for (let y = CAR_PARK.minY + 40; y < CAR_PARK.maxY - 20; y += 60) {
      const p = toS({ x: CAR_PARK.minX + 20, y })
      const q = toS({ x: CAR_PARK.maxX - 20, y })
      ctx.beginPath()
      ctx.moveTo(p.x, p.y)
      ctx.lineTo(q.x, q.y)
      ctx.stroke()
    }
    ctx.restore()
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 8
    return tex
  }, [t])
}

function Airfield({ t }: { t: ThemeTokens }) {
  const tex = useAirportTexture(t)
  useLayoutEffect(() => () => tex.dispose(), [tex])
  return (
    <group>
      {/* Table body with a brass lip, on a plinth */}
      <mesh position={[CX, -0.2, CZ]} receiveShadow userData={{ noPenPlot: true }}>
        <boxGeometry args={[W + 0.6, 0.4, D + 0.6]} />
        <meshStandardMaterial color={col(t, 'stage-metal-dark')} roughness={0.55} metalness={0.6} />
      </mesh>
      <mesh position={[CX, -0.02, CZ]} userData={{ noPenPlot: true }}>
        <boxGeometry args={[W + 0.62, 0.014, D + 0.62]} />
        <meshStandardMaterial color={col(t, 'stage-brass')} roughness={0.5} metalness={0.5} />
      </mesh>
      <mesh position={[CX, (FLOOR - 0.4) / 2, CZ]} userData={{ noPenPlot: true }}>
        <boxGeometry args={[W * 0.7, Math.abs(FLOOR + 0.4), D * 0.55]} />
        <meshStandardMaterial color={col(t, 'stage-metal-dark')} roughness={0.8} metalness={0.3} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[CX, 0.002, CZ]} receiveShadow userData={{ noPenPlot: true }}>
        <planeGeometry args={[W, D]} />
        <meshStandardMaterial map={tex} emissiveMap={tex} emissive={col(t, 'stage-paint')} emissiveIntensity={0.3} roughness={0.9} metalness={0.05} />
      </mesh>
    </group>
  )
}

// ---------------------------------------------------------------------------
// Buildings, the tower with its radar, MLAT receivers
// ---------------------------------------------------------------------------

function boxProps(b: { minX: number; maxX: number; minY: number; maxY: number }, hM: number) {
  const w = (b.maxX - b.minX) * SU
  const d = (b.maxY - b.minY) * SU
  const h = hM * VU
  const [x, , z] = toA({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 })
  return { position: [x, h / 2, z] as [number, number, number], args: [w, h, d] as [number, number, number] }
}

function Buildings({ t }: { t: ThemeTokens }) {
  const term = boxProps(TERMINAL, 20)
  const hang = boxProps(HANGAR, 25)
  const paint = col(t, 'stage-paint')
  const glassZ = -TERMINAL.minY * SU + 0.004
  return (
    <group>
      <mesh position={term.position} castShadow>
        <boxGeometry args={term.args} />
        <meshStandardMaterial color={col(t, 'stage-metal')} roughness={0.6} metalness={0.3} />
      </mesh>
      {/* The airside glass face: the mirror that makes ghost targets. */}
      <mesh position={[term.position[0], term.position[1] * 0.95, glassZ]}>
        <planeGeometry args={[term.args[0] * 0.98, term.args[1] * 0.8]} />
        <meshPhysicalMaterial color={col(t, 'stage-glass')} emissive={col(t, 'stage-glass')} emissiveIntensity={0.18} roughness={0.08} metalness={0.8} clearcoat={1} />
      </mesh>
      <mesh position={[term.position[0], term.args[1] + 0.008, term.position[2]]}>
        <boxGeometry args={[term.args[0] * 1.01, 0.016, term.args[2] * 1.04]} />
        <meshStandardMaterial color={col(t, 'stage-metal-dark')} roughness={0.5} metalness={0.6} />
      </mesh>
      <mesh position={hang.position} castShadow>
        <boxGeometry args={hang.args} />
        <meshStandardMaterial color={paint} roughness={0.5} metalness={0.4} />
      </mesh>
      {/* Hangar door on the airside face */}
      <mesh position={[hang.position[0], hang.args[1] * 0.4, hang.position[2] + hang.args[2] / 2 + 0.003]}>
        <planeGeometry args={[hang.args[0] * 0.8, hang.args[1] * 0.8]} />
        <meshStandardMaterial color={col(t, 'stage-metal')} roughness={0.7} metalness={0.5} />
      </mesh>
    </group>
  )
}

/** Control tower with the surface movement radar antenna turning on its roof. */
function Tower({ t, engine }: { t: ThemeTokens; engine: SurfaceEngine }) {
  const head = useRef<THREE.Group>(null)
  useFrame(() => {
    if (head.current) head.current.rotation.y = bearingToThreeRotationY(engine.smrAz)
  })
  const [x, , z] = toA(TOWER_POS)
  const r = 8 * TOWER_X * SU
  const paint = col(t, 'stage-paint')
  const dark = col(t, 'stage-metal-dark')
  const shaftTop = 46 * VU
  const cabH = 9 * VU
  const roofY = shaftTop + cabH + 0.01
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.03, 0]} castShadow>
        <boxGeometry args={[r * 3.2, 0.06, r * 2.4]} />
        <meshStandardMaterial color={col(t, 'stage-metal')} roughness={0.8} />
      </mesh>
      <mesh position={[0, shaftTop / 2, 0]} castShadow>
        <cylinderGeometry args={[r * 0.42, r * 0.55, shaftTop, 16]} />
        <meshStandardMaterial color={paint} roughness={0.45} metalness={0.3} />
      </mesh>
      <mesh position={[0, shaftTop, 0]}>
        <cylinderGeometry args={[r * 1.1, r * 0.8, 0.03, 8]} />
        <meshStandardMaterial color={dark} roughness={0.5} metalness={0.6} />
      </mesh>
      {/* Glass cab: the controllers' eye height */}
      <mesh position={[0, shaftTop + cabH / 2 + 0.015, 0]}>
        <cylinderGeometry args={[r * 1.12, r, cabH, 8, 1, true]} />
        <meshPhysicalMaterial color={col(t, 'stage-glass')} emissive={col(t, 'stage-glass')} emissiveIntensity={0.35} roughness={0.1} metalness={0.6} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, roofY, 0]}>
        <cylinderGeometry args={[r * 1.22, r * 1.12, 0.025, 8]} />
        <meshStandardMaterial color={dark} roughness={0.5} metalness={0.6} />
      </mesh>
      <mesh position={[0, (roofY + SMR_Y) / 2, 0]}>
        <cylinderGeometry args={[0.018, 0.026, SMR_Y - roofY, 10]} />
        <meshStandardMaterial color={dark} roughness={0.4} metalness={0.8} />
      </mesh>
      {/* SMR antenna: a long horizontal array; the beam leaves its -z face */}
      <group ref={head} position={[0, SMR_Y, 0]}>
        <mesh>
          <boxGeometry args={[0.34, 0.04, 0.035]} />
          <meshStandardMaterial color={paint} roughness={0.35} metalness={0.5} />
        </mesh>
        <mesh position={[0, 0, -0.019]}>
          <boxGeometry args={[0.33, 0.024, 0.004]} />
          <meshStandardMaterial color={col(t, 'stage-brass')} roughness={0.3} metalness={0.9} emissive={col(t, 'stage-brass')} emissiveIntensity={0.15} />
        </mesh>
      </group>
    </group>
  )
}

function Receivers({ t, engine }: { t: ThemeTokens; engine: SurfaceEngine }) {
  const lamps = useRef<(THREE.MeshBasicMaterial | null)[]>([])
  const on = useMemo(() => col(t, 'stage-signal').multiplyScalar(1.4), [t])
  const failed = useMemo(() => col(t, 'stage-alert').multiplyScalar(1.4), [t])
  useFrame(() => {
    MLAT_RECEIVERS.forEach((r, i) => {
      const m = lamps.current[i]
      if (m) m.color.copy(engine.env.mlatFailure && r.id === FAILING_RECEIVER ? failed : on)
    })
  })
  return (
    <group>
      {MLAT_RECEIVERS.map((r, i) => {
        const [x, , z] = toA(r.pos)
        const h = r.heightM * VU * 1.6
        return (
          <group key={r.id} position={[x, 0, z]}>
            <mesh position={[0, 0.012, 0]}>
              <boxGeometry args={[0.07, 0.024, 0.07]} />
              <meshStandardMaterial color={col(t, 'stage-metal')} roughness={0.8} />
            </mesh>
            <mesh position={[0, h / 2, 0]}>
              <cylinderGeometry args={[0.006, 0.009, h, 6]} />
              <meshStandardMaterial color={col(t, 'stage-paint')} roughness={0.4} metalness={0.6} />
            </mesh>
            <mesh position={[0, h + 0.02, 0]}>
              <coneGeometry args={[0.018, 0.045, 12]} />
              <meshStandardMaterial color={col(t, 'stage-paint')} roughness={0.4} metalness={0.4} />
            </mesh>
            <mesh position={[0, h + 0.055, 0]} userData={{ noPenPlot: true }}>
              <sphereGeometry args={[0.011, 10, 8]} />
              <meshBasicMaterial ref={(m) => void (lamps.current[i] = m)} color={on} toneMapped={false} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

// ---------------------------------------------------------------------------
// The radar beam and its afterglow on the ground
// ---------------------------------------------------------------------------

function SweepGlow({ t, engine }: { t: ThemeTokens; engine: SurfaceEngine }) {
  const [sx, , sz] = toA(SMR_SITE)
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        uniforms: {
          uAz: { value: 0 },
          uSite: { value: new THREE.Vector2(sx, sz) },
          uRange: { value: engine.smr.maxRangeM * SU },
          uColor: { value: col(t, 'stage-signal') },
        },
        vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: `varying vec3 vW; uniform float uAz; uniform vec2 uSite; uniform float uRange; uniform vec3 uColor;
          void main(){
            vec2 d = vW.xz - uSite;
            float bearing = atan(d.x, -d.y);
            float behind = mod(uAz - bearing + 6.2831853, 6.2831853);
            float glow = exp(-behind / (6.2831853 * 0.045));
            float r = length(d) / uRange;
            glow *= smoothstep(0.0, 0.015, r) * (1.0 - smoothstep(0.8, 1.0, r));
            gl_FragColor = vec4(uColor * glow * 0.3, glow * 0.3);
          }`,
      }),
    [t, engine, sx, sz],
  )
  useLayoutEffect(() => () => mat.dispose(), [mat])
  useFrame(() => {
    mat.uniforms.uAz.value = toRad(engine.smrAz)
  })
  return (
    <mesh rotation-x={-Math.PI / 2} position={[CX, 0.006, CZ]} material={mat} userData={{ noPenPlot: true }}>
      <planeGeometry args={[W, D]} />
    </mesh>
  )
}

/** Two faint blades from the antenna down to the ground, one (widened) beam apart. */
function BeamBlade({ t, engine }: { t: ThemeTokens; engine: SurfaceEngine }) {
  const group = useRef<THREE.Group>(null)
  const [sx, , sz] = toA(SMR_SITE)
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
        uniforms: { uColor: { value: col(t, 'stage-signal') } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `varying vec2 vUv; uniform vec3 uColor;
          void main(){
            float a = pow(max(1.0 - vUv.x, 0.0), 1.3) * smoothstep(0.0, 0.04, vUv.x) * (1.0 - vUv.y * 0.6);
            gl_FragColor = vec4(uColor * a * 0.5, a * 0.5);
          }`,
      }),
    [t],
  )
  useLayoutEffect(() => () => mat.dispose(), [mat])
  const geo = useMemo(() => {
    // From the antenna out along local -z, falling to the ground (the SMR looks down on the airfield).
    const g = new THREE.BufferGeometry()
    const n = 24
    const R = 2800 * SU
    const pos: number[] = []
    const uv: number[] = []
    const idx: number[] = []
    for (let i = 0; i <= n; i++) {
      const u = i / n
      const top = SMR_Y * (1 - u) + 0.01
      pos.push(0, 0.008, -u * R, 0, top, -u * R)
      uv.push(u, 0, u, 1)
      if (i < n) {
        const b = i * 2
        idx.push(b, b + 1, b + 3, b, b + 3, b + 2)
      }
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.setIndex(idx)
    return g
  }, [])
  useLayoutEffect(() => () => geo.dispose(), [geo])
  useFrame(() => {
    if (group.current) group.current.rotation.y = bearingToThreeRotationY(engine.smrAz)
  })
  // The real beam is 0.35° wide; the blades are drawn 1.2° apart so it can be seen.
  const half = toRad(0.6)
  return (
    <group ref={group} position={[sx, 0, sz]}>
      <mesh geometry={geo} material={mat} rotation-y={half} userData={{ noPenPlot: true }} />
      <mesh geometry={geo} material={mat} rotation-y={-half} userData={{ noPenPlot: true }} />
    </group>
  )
}

// ---------------------------------------------------------------------------
// Airfield lights and the runway safety net
// ---------------------------------------------------------------------------

function StopBars({ t, engine }: { t: ThemeTokens; engine: SurfaceEngine }) {
  const mats = useMemo(() => CONNECTORS.map(() => new THREE.MeshBasicMaterial({ toneMapped: false })), [])
  useLayoutEffect(() => () => mats.forEach((m) => m.dispose()), [mats])
  const lit = useMemo(() => col(t, 'stage-alert').multiplyScalar(1.6), [t])
  const off = useMemo(() => col(t, 'stage-metal'), [t])
  useFrame(() => {
    CONNECTORS.forEach((c, i) => mats[i].color.copy(engine.stopBars[c.id] ? lit : off))
  })
  return (
    <group>
      {CONNECTORS.map((c, i) =>
        [-2, -1, 0, 1, 2].map((k) => {
          const [x, , z] = toA({ x: c.x + (k * (TWY_HALF_WIDTH * 2 + 6)) / 4, y: STOP_BAR_Y - 2 })
          return (
            <mesh key={`${c.id}${k}`} position={[x, 0.012, z]} material={mats[i]} userData={{ noPenPlot: true }}>
              <sphereGeometry args={[0.011, 8, 6]} />
            </mesh>
          )
        }),
      )}
    </group>
  )
}

const MAX_GREENS = 160

/** Green centreline lights switched on ahead of a departing aircraft ("follow the greens"). */
function Greens({ t, engine }: { t: ThemeTokens; engine: SurfaceEngine }) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const m = useMemo(() => new THREE.Matrix4(), [])
  const green = useMemo(() => glowCol(t, 'success').multiplyScalar(1.2), [t])
  useFrame(() => {
    const im = mesh.current
    if (!im) return
    let n = 0
    for (const o of engine.objects) {
      if (!(o.phase === 'taxi-out' || (o.phase === 'lineup' && engine.cleared.has(o.id))) || !o.path) continue
      for (let s = o.s + 30; s < o.path.length && s < o.s + 520 && n < MAX_GREENS; s += 15) {
        const [x, , z] = toA(pointAt(o.path, s).pos)
        m.makeTranslation(x, 0.01, z)
        im.setMatrixAt(n++, m)
      }
    }
    im.count = n
    im.instanceMatrix.needsUpdate = true
  })
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, MAX_GREENS]} userData={{ noPenPlot: true }} frustumCulled={false}>
      <sphereGeometry args={[0.008, 6, 4]} />
      <meshBasicMaterial color={green} toneMapped={false} />
    </instancedMesh>
  )
}

/** The runway protected area lights up amber (caution) or red (incursion) with the safety net. */
function ProtectedArea({ t, engine }: { t: ThemeTokens; engine: SurfaceEngine }) {
  const fill = useRef<THREE.MeshBasicMaterial>(null)
  const label = useRef<HTMLDivElement>(null)
  const text = useRef<HTMLSpanElement>(null)
  const alertC = useMemo(() => col(t, 'stage-alert'), [t])
  const warnC = useMemo(() => glowCol(t, 'warning'), [t])
  const x0 = (RWY.thresholdX - 60) * SU
  const x1 = (RWY.endX + 60) * SU
  const d = 2 * RWY.holdingDistM * SU
  useFrame(() => {
    const lv = engine.alert.level
    if (fill.current) {
      fill.current.color.copy(lv === 'alert' ? alertC : warnC)
      fill.current.opacity = lv === 'none' ? 0 : lv === 'alert' ? 0.32 : 0.22
    }
    if (label.current) label.current.style.display = lv === 'none' ? 'none' : ''
    if (text.current) {
      const s = lv === 'alert' ? 'RUNWAY INCURSION' : 'RUNWAY ENTERED WITHOUT CLEARANCE'
      if (text.current.textContent !== s) text.current.textContent = s
    }
  })
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[(x0 + x1) / 2, 0.009, -RWY.centreY * SU]} userData={{ noPenPlot: true }}>
        <planeGeometry args={[x1 - x0, d]} />
        <meshBasicMaterial ref={fill} transparent opacity={0} depthWrite={false} toneMapped={false} />
      </mesh>
      <Callout3D position={[0.6, 0.35, -RWY.centreY * SU]} tone="alert" rootRef={label} lead={16}>
        <span ref={text} />
      </Callout3D>
    </group>
  )
}

// ---------------------------------------------------------------------------
// Aircraft and vehicles: a fixed pool of slots filled from engine.objects
// ---------------------------------------------------------------------------

const POOL = 14
const LETTER: Record<Source, string> = { smr: 'S', mlat: 'M', adsb: 'A' }

/** What is on the airport right now (the cargo aircraft waiting off the map is not). */
const present = (engine: SurfaceEngine) => engine.objects.filter((o) => o.phase !== 'cargo-away')

function objectLabel(engine: SurfaceEngine, o: SurfaceObject): string {
  const tr = engine.tracks.get(o.id)
  const letters = tr ? engine.trackSources(tr).map((s) => LETTER[s]).join('') : ''
  let s = o.callsign
  if (o.altitudeM > 5) s += ` · ${Math.round(metresToFt(o.altitudeM) / 10) * 10} FT`
  if (!letters) return `${s} · NOT ON THE DISPLAY`
  s += ` · ${letters}`
  if (!tr?.identity) s += ' · NO NAME'
  return s
}

function ObjectSlot({ t, engine, index }: { t: ThemeTokens; engine: SurfaceEngine; index: number }) {
  const body = useRef<THREE.Group>(null)
  const air = useRef<THREE.Group>(null)
  const veh = useRef<THREE.Group>(null)
  const drop = useRef<THREE.Mesh>(null)
  const ring = useRef<THREE.Mesh>(null)
  const glint = useRef<THREE.Mesh>(null)
  const glintMat = useRef<THREE.MeshBasicMaterial>(null)
  const tag = useRef<THREE.Group>(null)
  const labelRoot = useRef<HTMLDivElement>(null)
  const text = useRef<HTMLSpanElement>(null)
  useFrame(() => {
    const o = present(engine)[index]
    const show = Boolean(o)
    if (body.current) body.current.visible = show
    // Labels only over the table: an aircraft far out on final or climbing away keeps its model, not its tag.
    const onTable = o && o.pos.x > BOUNDS.minX && o.pos.x < BOUNDS.maxX && o.pos.y > BOUNDS.minY && o.pos.y < BOUNDS.maxY
    if (labelRoot.current) labelRoot.current.style.display = show && onTable ? '' : 'none'
    if (drop.current) drop.current.visible = show && (o?.altitudeM ?? 0) > 3
    if (ring.current) ring.current.visible = false
    if (glint.current) glint.current.visible = false
    if (!o || !body.current) return
    const isAir = o.kind === 'aircraft'
    const size = SHAPE_SIZE[o.shape]
    const lift = isAir ? (o.shape === 'heavy' ? 0.06 : 0.036) : 0
    const [x, y, z] = toA(o.pos, o.altitudeM)
    body.current.position.set(x, y + lift, z)
    body.current.rotation.y = bearingToThreeRotationY(o.headingDeg)
    if (air.current) {
      air.current.visible = isAir
      // AircraftModel is about 0.51 units nose to tail; scale it to the true length × AIRCRAFT_X.
      air.current.scale.setScalar((size.length * AIRCRAFT_X * SU) / 0.51)
    }
    if (veh.current) {
      veh.current.visible = !isAir
      const k = VEHICLE_X * SU
      veh.current.scale.set(size.span * k, (o.shape === 'van' ? 2.6 : 1.6) * k, size.length * k)
    }
    // Drop line from an airborne aircraft to its point on the ground.
    if (drop.current && o.altitudeM > 3) {
      drop.current.scale.set(1, Math.max(0.001, y), 1)
      drop.current.position.set(x, y / 2, z)
    }
    const r = (Math.max(size.length, size.span) * (isAir ? AIRCRAFT_X : VEHICLE_X) * SU) / 2
    // Safety-net intruder: a red ring, as on the display.
    if (ring.current && engine.alert.intruders.includes(o.id)) {
      ring.current.visible = true
      ring.current.position.set(x, 0.012, z)
      ring.current.scale.setScalar(r * 1.5)
    }
    // Echo glint just behind the sweep, for objects the radar is actually painting (a fresh SMR plot).
    const plot = engine.smrPlots.get(o.id)
    const behind = normalize360(engine.smrAz - bearingDeg(SMR_SITE, o.pos))
    if (glint.current && glintMat.current && plot && engine.timeS - plot.timeS < 2.5 && behind < 60) {
      const k = behind / 60
      glint.current.visible = true
      glint.current.position.set(x, 0.014, z)
      glint.current.scale.setScalar(r * (1.1 + k * 0.8))
      glintMat.current.opacity = (1 - k) ** 2
    }
    if (tag.current) tag.current.position.set(x, y + lift + (isAir ? 0.1 : 0.06), z)
    if (text.current) {
      const s = objectLabel(engine, o)
      if (text.current.textContent !== s) text.current.textContent = s
    }
  })
  const lineC = col(t, 'stage-line')
  return (
    <>
      <group ref={body} visible={false}>
        <group ref={air}>
          <AircraftModel t={t} />
        </group>
        <group ref={veh}>
          <mesh position={[0, 0.5, 0]} castShadow>
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial color={col(t, 'stage-brass')} roughness={0.45} metalness={0.4} />
          </mesh>
          <mesh position={[0, 1.05, -0.12]}>
            <boxGeometry args={[0.8, 0.12, 0.35]} />
            <meshBasicMaterial color={col(t, 'stage-brass').multiplyScalar(1.4)} toneMapped={false} />
          </mesh>
        </group>
      </group>
      <mesh ref={drop} visible={false} userData={{ noPenPlot: true }}>
        <cylinderGeometry args={[0.004, 0.004, 1, 4]} />
        <meshBasicMaterial color={lineC} transparent opacity={0.35} />
      </mesh>
      <mesh ref={ring} rotation-x={-Math.PI / 2} visible={false} userData={{ noPenPlot: true }}>
        <ringGeometry args={[0.85, 1, 40]} />
        <meshBasicMaterial color={col(t, 'stage-alert').multiplyScalar(1.4)} toneMapped={false} transparent depthWrite={false} />
      </mesh>
      <mesh ref={glint} rotation-x={-Math.PI / 2} visible={false} userData={{ noPenPlot: true }}>
        <ringGeometry args={[0.8, 1, 40]} />
        <meshBasicMaterial ref={glintMat} color={col(t, 'stage-signal')} transparent toneMapped={false} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <group ref={tag}>
        <Callout3D position={[0, 0, 0]} lead={14} rootRef={labelRoot}>
          <span ref={text} />
        </Callout3D>
      </group>
    </>
  )
}

const GHOSTS = 6

/** Ghost targets: where the display draws an echo that bounced off the terminal's glass face. */
function GhostSlot({ t, engine, index }: { t: ThemeTokens; engine: SurfaceEngine; index: number }) {
  const g = useRef<THREE.Group>(null)
  const labelRoot = useRef<HTMLDivElement>(null)
  const text = useRef<HTMLSpanElement>(null)
  useFrame(() => {
    const tr = [...engine.tracks.values()].filter((x) => x.ghost && engine.trackSources(x).length)[index]
    const show = Boolean(tr)
    if (g.current) g.current.visible = show
    if (labelRoot.current) labelRoot.current.style.display = show ? '' : 'none'
    if (!tr || !g.current) return
    const [x, , z] = toA(tr.pos)
    g.current.position.set(x, 0.014, z)
    const s = `GHOST OF ${engine.get(tr.objectId)?.callsign ?? 'AN AIRCRAFT'} · REFLECTION`
    if (text.current && text.current.textContent !== s) text.current.textContent = s
  })
  return (
    <group ref={g} visible={false}>
      <mesh rotation-x={-Math.PI / 2} userData={{ noPenPlot: true }}>
        <ringGeometry args={[0.07, 0.09, 32]} />
        <meshBasicMaterial color={col(t, 'stage-brass').multiplyScalar(1.3)} transparent opacity={0.9} toneMapped={false} depthWrite={false} />
      </mesh>
      <Callout3D position={[0, 0.04, 0]} tone="brass" lead={12} rootRef={labelRoot}>
        <span ref={text} />
      </Callout3D>
    </group>
  )
}

// ---------------------------------------------------------------------------
// Heavy rain, falling in sim time (it stops when the clock is paused)
// ---------------------------------------------------------------------------

function Rain({ t, engine }: { t: ThemeTokens; engine: SurfaceEngine }) {
  const pts = useRef<THREE.Points>(null)
  const reduced = useReducedMotion()
  const geo = useMemo(() => {
    const n = 1400
    const pos = new Float32Array(n * 3)
    let s = 7
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < n; i++) pos.set([CX + (rnd() - 0.5) * W, rnd() * 2.2, CZ + (rnd() - 0.5) * D], i * 3)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    return g
  }, [])
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        uniforms: { uT: { value: 0 }, uColor: { value: col(t, 'stage-glass') } },
        vertexShader: `uniform float uT; void main(){ vec3 p = position; p.y = mod(p.y - uT * 1.6, 2.2); vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_PointSize = 18.0 / -mv.z; gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform vec3 uColor; void main(){ vec2 d = gl_PointCoord - 0.5; float a = smoothstep(0.08, 0.0, abs(d.x)) * smoothstep(0.5, 0.0, abs(d.y)) * 0.5; gl_FragColor = vec4(uColor * a, a); }`,
      }),
    [t],
  )
  useLayoutEffect(
    () => () => {
      mat.dispose()
      geo.dispose()
    },
    [mat, geo],
  )
  useFrame(() => {
    if (pts.current) pts.current.visible = engine.env.heavyRain
    mat.uniforms.uT.value = reduced ? 0 : engine.timeS
  })
  return <points ref={pts} geometry={geo} material={mat} visible={false} userData={{ noPenPlot: true }} />
}

// ---------------------------------------------------------------------------

function FaultCallouts({ engine }: { engine: SurfaceEngine }) {
  const rx = useRef<HTMLDivElement>(null)
  const glass = useRef<HTMLDivElement>(null)
  useFrame(() => {
    if (rx.current) rx.current.style.display = engine.env.mlatFailure ? '' : 'none'
    if (glass.current) glass.current.style.display = engine.env.reflections ? '' : 'none'
  })
  const m1 = MLAT_RECEIVERS.find((r) => r.id === FAILING_RECEIVER)!
  const [mx, , mz] = toA(m1.pos)
  return (
    <>
      <Callout3D position={[mx, 0.12, mz]} tone="alert" rootRef={rx} lead={14}>
        {`MLAT ${FAILING_RECEIVER} FAILED`}
      </Callout3D>
      <Callout3D position={[TERMINAL.maxX * SU, 0.14, -TERMINAL.minY * SU]} tone="brass" rootRef={glass} lead={14}>
        GLASS FACE REFLECTS THE RADAR
      </Callout3D>
    </>
  )
}

export function SurfaceHero({ t, engine }: { t: ThemeTokens; engine: SurfaceEngine }) {
  const lineColor = useMemo(() => col(t, 'stage-line'), [t])
  const [tx, , tz] = toA(TOWER_POS)
  return (
    <group>
      <StudioFloor t={t} y={FLOOR} shadowScale={30} />
      <Airfield t={t} />
      <SweepGlow t={t} engine={engine} />
      <ProtectedArea t={t} engine={engine} />
      <StopBars t={t} engine={engine} />
      <Greens t={t} engine={engine} />
      <PenPlot color={lineColor}>
        <Buildings t={t} />
        <Tower t={t} engine={engine} />
        <Receivers t={t} engine={engine} />
      </PenPlot>
      <BeamBlade t={t} engine={engine} />
      {Array.from({ length: POOL }, (_, i) => (
        <ObjectSlot key={i} t={t} engine={engine} index={i} />
      ))}
      {Array.from({ length: GHOSTS }, (_, i) => (
        <GhostSlot key={i} t={t} engine={engine} index={i} />
      ))}
      <Rain t={t} engine={engine} />
      <FaultCallouts engine={engine} />
      <Callout3D position={[tx + 0.2, SMR_Y + 0.06, tz]} tone="signal">
        SURFACE MOVEMENT RADAR · X-BAND
      </Callout3D>
      <Callout3D position={[1.8, 0.02, (RWY.halfWidthM + 30) * SU]} lead={16}>
        RUNWAY 09/27
      </Callout3D>
    </group>
  )
}

export default SurfaceHero
