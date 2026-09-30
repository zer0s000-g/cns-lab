/**
 * Shared pieces for the tabletop dioramas: the 60 NM terrain table built from
 * the one world model (core/world), the compass rim, and miniatures (radar
 * tower, aircraft). Scenes place them with `toU`, which maps map NM and feet
 * to scene units.
 */
import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { ParametricGeometry } from 'three/examples/jsm/geometries/ParametricGeometry.js'
import { bearingToThreeRotationY, toRad } from '@/core/geometry'
import { isWater, terrainElevationFt } from '@/core/world'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { toThreeStyle } from '@/lib/color'
import { col } from './Stage'

export { FLOOR_Y, HEIGHT_EXAGGERATION, S, TABLE_RADIUS_NM, TABLE_RADIUS_U, V, toU } from './scale'
import { FLOOR_Y, TABLE_RADIUS_NM, TABLE_RADIUS_U, V, toU } from './scale'

// ---------------------------------------------------------------------------
// Terrain relief with contour lines and the sweep afterglow painted on it
// ---------------------------------------------------------------------------

export function useTerrain(t: ThemeTokens) {
  const geometry = useMemo(() => {
    const rings = 110
    const segs = 360
    const pos: number[] = []
    const colr: number[] = []
    const idx: number[] = []
    const low = col(t, 'stage-terrain')
    const high = col(t, 'stage-terrain-high')
    const water = col(t, 'stage-water')
    const c = new THREE.Color()
    for (let r = 0; r <= rings; r++) {
      const rad = (r / rings) * TABLE_RADIUS_NM
      const n = r === 0 ? 1 : segs
      for (let k = 0; k < n; k++) {
        const a = (k / segs) * Math.PI * 2
        const p = { x: Math.sin(a) * rad, y: Math.cos(a) * rad }
        const w = isWater(p)
        const h = w ? 0 : terrainElevationFt(p)
        const [x, y, z] = toU(p, h)
        pos.push(x, y, z)
        if (w) c.copy(water)
        else c.copy(low).lerp(high, Math.min(1, Math.pow(h / 8500, 0.8)))
        colr.push(c.r, c.g, c.b)
      }
    }
    // Centre fan. Winding is counter-clockwise seen from above, so normals point up.
    for (let k = 0; k < segs; k++) idx.push(0, 1 + ((k + 1) % segs), 1 + k)
    for (let r = 1; r < rings; r++) {
      const a0 = 1 + (r - 1) * segs
      const a1 = 1 + r * segs
      for (let k = 0; k < segs; k++) {
        const k1 = (k + 1) % segs
        idx.push(a0 + k, a1 + k1, a1 + k, a0 + k, a0 + k1, a1 + k1)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3))
    g.setIndex(idx)
    g.computeVertexNormals()
    return g
  }, [t])
  // Free the GPU buffers when the scene (or the theme) changes.
  useLayoutEffect(() => () => geometry.dispose(), [geometry])
  return geometry
}

export function makeTerrainMaterial(t: ThemeTokens) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0.04, flatShading: false })
  const uniforms = {
    uAz: { value: 0 },
    uPersist: { value: 0.1 },
    uGlow: { value: col(t, 'stage-signal') },
    uLine: { value: col(t, 'stage-metal-dark') },
    uStep: { value: 1000 * V },
    uRadius: { value: TABLE_RADIUS_U },
  }
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vWorldPos;
         uniform float uAz; uniform float uPersist; uniform vec3 uGlow; uniform vec3 uLine; uniform float uStep; uniform float uRadius;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         // Contour lines every 1,000 ft (above sea level only).
         float h = vWorldPos.y / uStep;
         // fwidth is 0 on flat ground (sea, coastal plain): a zero-width smoothstep is
         // undefined and gives NaN on some GPUs (Apple Metal), which bloom then smears
         // across the frame. Keep the edge width strictly positive.
         float fw = max(fwidth(h), 1e-4);
         float line = 1.0 - smoothstep(0.0, fw * 1.4, abs(fract(h + 0.5) - 0.5));
         line *= step(0.35, h);
         // Every fifth contour (5,000 ft) is an index line, drawn heavier.
         float h5 = h / 5.0;
         float index = 1.0 - smoothstep(0.0, max(fwidth(h5), 1e-4) * 1.6, abs(fract(h5 + 0.5) - 0.5));
         index *= step(0.35, h);
         diffuseColor.rgb = mix(diffuseColor.rgb, uLine, max(line * 0.42, index * 0.75));
         // Sweep afterglow: bright just behind the beam, fading around the turn.
         float bearing = atan(vWorldPos.x, -vWorldPos.z);
         float behind = mod(uAz - bearing + 6.2831853, 6.2831853);
         float glow = exp(-behind / (6.2831853 * uPersist));
         float r = length(vWorldPos.xz) / uRadius;
         glow *= smoothstep(0.02, 0.08, r) * (1.0 - smoothstep(0.96, 1.0, r));
         totalEmissiveRadiance += uGlow * glow * 0.2;`,
      )
  }
  return { material: m, uniforms }
}

// ---------------------------------------------------------------------------
// Table, compass ring and plinth
// ---------------------------------------------------------------------------

function useCompassTexture(t: ThemeTokens) {
  return useMemo(() => {
    const N = 2048
    const c = document.createElement('canvas')
    c.width = N
    c.height = N
    const ctx = c.getContext('2d')!
    const cx = N / 2
    const rOut = N / 2
    const rIn = rOut * (TABLE_RADIUS_U / (TABLE_RADIUS_U + 0.7))
    ctx.strokeStyle = toThreeStyle(t['stage-line'])
    ctx.fillStyle = toThreeStyle(t['stage-line'])
    for (let a = 0; a < 360; a += 2) {
      const ang = toRad(a - 90)
      const len = a % 30 === 0 ? 0.42 : a % 10 === 0 ? 0.28 : 0.14
      ctx.lineWidth = a % 10 === 0 ? 4 : 2
      ctx.beginPath()
      ctx.moveTo(cx + Math.cos(ang) * rIn, cx + Math.sin(ang) * rIn)
      ctx.lineTo(cx + Math.cos(ang) * (rIn + (rOut - rIn) * len), cx + Math.sin(ang) * (rIn + (rOut - rIn) * len))
      ctx.stroke()
    }
    ctx.font = `700 34px Michroma, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (let a = 0; a < 360; a += 30) {
      const ang = toRad(a - 90)
      const rr = rIn + (rOut - rIn) * 0.7
      ctx.save()
      ctx.translate(cx + Math.cos(ang) * rr, cx + Math.sin(ang) * rr)
      ctx.rotate(toRad(a))
      ctx.fillText(a % 90 === 0 ? ['N', 'E', 'S', 'W'][a / 90] : String(a).padStart(3, '0'), 0, 0)
      ctx.restore()
    }
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 8
    return tex
  }, [t])
}

export function DioramaTable({ t }: { t: ThemeTokens }) {
  const tex = useCompassTexture(t)
  // A new 2048² texture is drawn on every theme change: free the old one's GPU memory.
  useLayoutEffect(() => () => tex.dispose(), [tex])
  const R = TABLE_RADIUS_U
  return (
    <group>
      {/* Brass-edged table body */}
      <mesh position={[0, -0.34, 0]} receiveShadow>
        <cylinderGeometry args={[R + 0.7, R + 0.8, 0.66, 128]} />
        <meshStandardMaterial color={col(t, 'stage-metal-dark')} roughness={0.55} metalness={0.6} />
      </mesh>
      <mesh position={[0, 0.005, 0]} rotation-x={-Math.PI / 2} userData={{ noPenPlot: true }}>
        <ringGeometry args={[R, R + 0.7, 256, 1]} />
        <meshStandardMaterial color={col(t, 'stage-metal-dark')} roughness={0.4} metalness={0.7} map={tex} emissiveMap={tex} emissive={col(t, 'stage-line')} emissiveIntensity={0.35} />
      </mesh>
      <mesh position={[0, 0.02, 0]} rotation-x={-Math.PI / 2} userData={{ noPenPlot: true }}>
        <ringGeometry args={[R + 0.68, R + 0.74, 256, 1]} />
        <meshStandardMaterial color={col(t, 'stage-brass')} roughness={0.3} metalness={0.95} />
      </mesh>
      {/* Plinth */}
      <mesh position={[0, (FLOOR_Y - 0.67) / 2, 0]}>
        <cylinderGeometry args={[R * 0.55, R * 0.7, Math.abs(FLOOR_Y + 0.67) + 0.02, 64]} />
        <meshStandardMaterial color={col(t, 'stage-metal-dark')} roughness={0.8} metalness={0.3} />
      </mesh>
    </group>
  )
}

// ---------------------------------------------------------------------------
// The radar head
// ---------------------------------------------------------------------------

/** Doubly curved "orange peel" reflector, concave side facing local -z. */
const REF_W = 1.5
const REF_H = 0.62
const REF_DEPTH = 0.2
const reflectorZ = (x: number, y: number) => -REF_DEPTH * ((x / (REF_W / 2)) ** 2 * 0.9 + (y / (REF_H / 2)) ** 2 * 0.4) + REF_DEPTH * 0.7

function useReflector() {
  return useMemo(() => {
    const surface = new ParametricGeometry(
      (u, v, target) => {
        const x = (u - 0.5) * REF_W
        const y = (v - 0.5) * REF_H
        target.set(x, y, reflectorZ(x, y))
      },
      48,
      16,
    )
    surface.computeVertexNormals()
    // Rim tube around the edge and a few stiffening ribs on the back.
    const edge: THREE.Vector3[] = []
    const N = 96
    for (let i = 0; i <= N; i++) {
      const k = i / N
      let x: number, y: number
      if (k < 0.25) [x, y] = [(-0.5 + k * 4) * REF_W, -REF_H / 2]
      else if (k < 0.5) [x, y] = [REF_W / 2, (-0.5 + (k - 0.25) * 4) * REF_H]
      else if (k < 0.75) [x, y] = [(0.5 - (k - 0.5) * 4) * REF_W, REF_H / 2]
      else [x, y] = [-REF_W / 2, (0.5 - (k - 0.75) * 4) * REF_H]
      edge.push(new THREE.Vector3(x, y, reflectorZ(x, y)))
    }
    const rim = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(edge, true), 160, 0.012, 6, true)
    const ribs = [-0.5, -0.25, 0, 0.25, 0.5].map((f) => {
      const pts = Array.from({ length: 12 }, (_, i) => {
        const y = (i / 11 - 0.5) * REF_H
        const x = f * REF_W * 0.96
        return new THREE.Vector3(x, y, reflectorZ(x, y) + 0.018)
      })
      return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.008, 5, false)
    })
    return { surface, rim, ribs }
  }, [])
}

/** A radar antenna (primary reflector with the secondary array on top), its tower and shelter. */
export { ANTENNA_Y, RADAR_SCALE } from './scale'
import { RADAR_SCALE } from './scale'

const LEG_H = 1.1
const TOWER_TOP = 0.12 + LEG_H
const LEGS: [number, number][] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
]
/** Tapered lattice: legs lean in from 0.3 at the ground to 0.2 at the deck. */
function legAt(sx: number, sz: number, f: number) {
  const w = 0.3 + (0.2 - 0.3) * f
  return new THREE.Vector3(sx * w, 0.12 + LEG_H * f, sz * w)
}
/** Tower members (legs, diagonal braces and horizontals), computed once. */
const TOWER_MEMBERS = (() => {
  const out: { a: THREE.Vector3; b: THREE.Vector3; r: number }[] = []
  LEGS.forEach(([sx, sz]) => out.push({ a: legAt(sx, sz, 0), b: legAt(sx, sz, 1), r: 0.018 }))
  const bays = 4
  for (let i = 0; i < bays; i++) {
    const f0 = i / bays
    const f1 = (i + 1) / bays
    for (let s = 0; s < 4; s++) {
      const [ax, az] = LEGS[s]
      const [bx, bz] = LEGS[(s + 1) % 4]
      out.push({ a: legAt(ax, az, f0), b: legAt(bx, bz, f1), r: 0.007 })
      out.push({ a: legAt(bx, bz, f0), b: legAt(ax, az, f1), r: 0.007 })
      out.push({ a: legAt(ax, az, f1), b: legAt(bx, bz, f1), r: 0.009 })
    }
  }
  return out
})()

export function RadarTower({ t, getAzimuthDeg, position }: { t: ThemeTokens; getAzimuthDeg: () => number; position: [number, number, number] }) {
  const head = useRef<THREE.Group>(null)
  const lamp = useRef<THREE.MeshStandardMaterial>(null)
  const { surface, rim, ribs } = useReflector()
  const paint = col(t, 'stage-paint')
  const dark = col(t, 'stage-metal-dark')
  const metal = col(t, 'stage-metal')
  const brass = col(t, 'stage-brass')
  useFrame((state) => {
    if (head.current) head.current.rotation.y = bearingToThreeRotationY(getAzimuthDeg())
    if (lamp.current) lamp.current.emissiveIntensity = 1.4 + Math.sin(state.clock.elapsedTime * 2.2) * 0.9
  })
  const top = TOWER_TOP
  const steel = <meshStandardMaterial color={paint} roughness={0.45} metalness={0.55} />
  return (
    <group position={position} scale={RADAR_SCALE}>
      {/* Concrete pad and equipment shelter */}
      <mesh position={[0, 0.06, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.25, 0.12, 1.0]} />
        <meshStandardMaterial color={metal} roughness={0.95} />
      </mesh>
      <mesh position={[0.46, 0.25, 0.26]} castShadow>
        <boxGeometry args={[0.28, 0.26, 0.42]} />
        <meshPhysicalMaterial color={paint} roughness={0.4} metalness={0.15} clearcoat={0.5} />
      </mesh>
      <mesh position={[0.46, 0.39, 0.26]}>
        <boxGeometry args={[0.32, 0.02, 0.46]} />
        <meshStandardMaterial color={dark} roughness={0.5} metalness={0.6} />
      </mesh>
      <mesh position={[0.46, 0.43, 0.14]}>
        <sphereGeometry args={[0.018, 12, 8]} />
        <meshStandardMaterial ref={lamp} color={col(t, 'stage-alert')} emissive={col(t, 'stage-alert')} emissiveIntensity={2} toneMapped={false} />
      </mesh>
      {/* Lattice tower */}
      {TOWER_MEMBERS.map(({ a, b, r }, i) => {
        const mid = a.clone().add(b).multiplyScalar(0.5)
        const dir = b.clone().sub(a)
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize())
        return (
          <mesh key={i} position={mid} quaternion={q} castShadow>
            <cylinderGeometry args={[r, r, dir.length(), 6]} />
            {steel}
          </mesh>
        )
      })}
      {/* Deck with a railing */}
      <mesh position={[0, top + 0.015, 0]} castShadow>
        <boxGeometry args={[0.62, 0.03, 0.62]} />
        <meshStandardMaterial color={dark} roughness={0.5} metalness={0.7} />
      </mesh>
      <mesh position={[0, top + 0.11, 0]} rotation-y={Math.PI / 4}>
        <torusGeometry args={[0.43, 0.006, 4, 4]} />
        {steel}
      </mesh>
      {/* Pedestal and turntable */}
      <mesh position={[0, top + 0.09, 0]}>
        <cylinderGeometry args={[0.13, 0.16, 0.14, 28]} />
        <meshStandardMaterial color={dark} roughness={0.35} metalness={0.85} />
      </mesh>
      <mesh position={[0, top + 0.17, 0]}>
        <cylinderGeometry args={[0.17, 0.17, 0.025, 36]} />
        <meshStandardMaterial color={brass} roughness={0.28} metalness={0.95} />
      </mesh>
      {/* Rotating head: yoke, reflector, feed horn and the secondary radar array on top */}
      <group ref={head} position={[0, top + 0.18, 0]}>
        <mesh position={[0, 0.07, 0.04]}>
          <boxGeometry args={[0.2, 0.14, 0.16]} />
          <meshStandardMaterial color={dark} roughness={0.4} metalness={0.8} />
        </mesh>
        <group position={[0, 0.42, 0.06]}>
          <mesh geometry={surface} castShadow>
            <meshPhysicalMaterial color={paint} roughness={0.32} metalness={0.5} side={THREE.DoubleSide} clearcoat={0.5} clearcoatRoughness={0.25} />
          </mesh>
          <mesh geometry={rim}>
            <meshStandardMaterial color={dark} roughness={0.4} metalness={0.8} />
          </mesh>
          {ribs.map((g, i) => (
            <mesh key={i} geometry={g}>
              <meshStandardMaterial color={dark} roughness={0.4} metalness={0.8} />
            </mesh>
          ))}
        </group>
        {/* Feed support struts from the yoke to the horn, in front of the concave face */}
        {[-0.1, 0.1].map((x) => (
          <mesh key={x} position={[x * 0.6, 0.17, -0.2]} rotation-x={-1.19}>
            <cylinderGeometry args={[0.009, 0.009, 0.5, 6]} />
            <meshStandardMaterial color={metal} roughness={0.5} metalness={0.7} />
          </mesh>
        ))}
        <mesh position={[0, 0.26, -0.44]} rotation-x={Math.PI / 2 - 0.35}>
          <cylinderGeometry args={[0.07, 0.035, 0.14, 4]} />
          <meshStandardMaterial color={dark} roughness={0.35} metalness={0.8} />
        </mesh>
        {/* Secondary radar (SSR) array riding on top */}
        <mesh position={[0, 0.78, 0.1]}>
          <boxGeometry args={[1.56, 0.12, 0.05]} />
          <meshStandardMaterial color={dark} roughness={0.45} metalness={0.7} />
        </mesh>
        <mesh position={[0, 0.78, 0.072]}>
          <boxGeometry args={[1.5, 0.08, 0.004]} />
          <meshStandardMaterial color={brass} roughness={0.35} metalness={0.9} emissive={brass} emissiveIntensity={0.08} />
        </mesh>
      </group>
    </group>
  )
}

export function AircraftModel({ t, dim }: { t: ThemeTokens; dim?: boolean }) {
  const c = dim ? col(t, 'stage-metal') : col(t, 'stage-paint')
  return (
    <group scale={1.4}>
      <mesh rotation-x={Math.PI / 2} castShadow>
        <capsuleGeometry args={[0.032, 0.3, 4, 12]} />
        <meshPhysicalMaterial color={c} roughness={0.35} metalness={0.3} clearcoat={0.8} />
      </mesh>
      <mesh position={[0, 0, 0.02]}>
        <boxGeometry args={[0.36, 0.008, 0.07]} />
        <meshPhysicalMaterial color={c} roughness={0.35} metalness={0.3} clearcoat={0.8} />
      </mesh>
      <mesh position={[0, 0.04, 0.15]}>
        <boxGeometry args={[0.008, 0.08, 0.05]} />
        <meshPhysicalMaterial color={c} roughness={0.35} metalness={0.3} />
      </mesh>
      <mesh position={[0, 0.005, 0.16]}>
        <boxGeometry args={[0.13, 0.006, 0.035]} />
        <meshPhysicalMaterial color={c} roughness={0.35} metalness={0.3} />
      </mesh>
    </group>
  )
}
