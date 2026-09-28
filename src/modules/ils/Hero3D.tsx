/**
 * The ILS hero: a runway close-up with the last miles of the approach. The
 * localizer array, the glide path mast and the marker beacons stand on the
 * table; the 90 Hz and 150 Hz fields are painted from the engine's own DDM
 * functions (locDdmAt, gsDdmAt), so a truck in the critical area or a course
 * shift bends them exactly as the receiver hears it. The aircraft, its trail
 * and every lamp are read from the unchanged IlsEngine each frame.
 *
 * Scale (see heroScale.ts): 1 unit = 500 m along the runway, sideways ×3,
 * heights ×4, aircraft and antennas larger than life. Geometry for the
 * runway, lights and antennas is lifted from Approach3D.
 */

import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { bearingToThreeRotationY, bearingVector, type Vec2 } from '@/core/geometry'
import { APPROACH_LIGHTS_M, GS_COVERAGE, GS_FULL_SCALE_DDM, LOC_FULL_SCALE_DDM, cdiLateral, cdiVertical, onPathHeightFt } from '@/core/ils'
import type { MarkerKind } from '@/core/morse'
import { METRES_PER_FT, METRES_PER_NM } from '@/core/units'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { toThreeStyle } from '@/lib/color'
import { Callout3D } from '@/stage/Callout3D'
import { AircraftModel } from '@/stage/Diorama'
import { PenPlot } from '@/stage/PenPlot'
import { StudioFloor, col } from '@/stage/Stage'
import { TRUCK_POS, type IlsEngine } from './engine'
import { BOUNDS_M, LAT_X, MODEL_X, SU, stretchedBearingDeg, toI } from './heroScale'

const nm = (m: number) => m / METRES_PER_NM
const X0 = BOUNDS_M.minX * SU
const X1 = BOUNDS_M.maxX * SU
const Z0 = -BOUNDS_M.maxY * SU * LAT_X
const Z1 = -BOUNDS_M.minY * SU * LAT_X
const W = X1 - X0
const D = Z1 - Z0
const CX = (X0 + X1) / 2
const CZ = (Z0 + Z1) / 2
const FLOOR = -1.2

/** A token colour for the night stage, lifted to a readable lightness (light-theme tokens are darker). */
function glowCol(t: ThemeTokens, name: keyof ThemeTokens, minL = 0.56) {
  const c = col(t, name)
  const hsl = { h: 0, s: 0, l: 0 }
  c.getHSL(hsl)
  c.setHSL(hsl.h, hsl.s, Math.max(hsl.l, minL))
  return c
}

// ---------------------------------------------------------------------------
// Tone fields: colour AND pattern show which tone is louder (90 Hz lines, 150 Hz dots)
// ---------------------------------------------------------------------------

function useToneMaterial(t: ThemeTokens, gain: number) {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
        uniforms: {
          uC90: { value: glowCol(t, 'lobe-90') },
          uC150: { value: glowCol(t, 'lobe-150') },
          uPat: { value: 9 },
          uGain: { value: gain },
        },
        vertexShader: `attribute float aK; attribute float aFade; attribute vec2 aPat;
          varying float vK; varying float vFade; varying vec2 vPat;
          void main(){ vK = aK; vFade = aFade; vPat = aPat; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform vec3 uC90; uniform vec3 uC150; uniform float uPat; uniform float uGain;
          varying float vK; varying float vFade; varying vec2 vPat;
          void main(){
            float k = clamp(abs(vK), 0.0, 1.0);
            bool is90 = vK >= 0.0;
            vec2 q = vPat * uPat;
            float lines = 1.0 - smoothstep(0.12, 0.2, abs(fract(q.x + q.y) - 0.5));
            float dots = 1.0 - smoothstep(0.16, 0.24, length(fract(q) - 0.5));
            // Far away the pattern is finer than a pixel: fade it to its average.
            float fine = smoothstep(0.2, 0.5, fwidth(q.x) + fwidth(q.y));
            float pat = mix(is90 ? lines : dots, 0.3, fine);
            // Strongest near the course, where the needle moves; beyond full scale the tint stays but gently.
            float a = (0.035 + 0.14 * k + 0.32 * k * pat) * vFade * uGain;
            vec3 c = is90 ? uC90 : uC150;
            gl_FragColor = vec4(c * a, a);
          }`,
      }),
    [t, gain],
  )
  useLayoutEffect(() => () => mat.dispose(), [mat])
  return mat
}

/** The localizer field on the ground, west of the antenna. Recomputed when a failure changes it. */
function LocalizerField({ t, engine }: { t: ThemeTokens; engine: IlsEngine }) {
  const mesh = useRef<THREE.Mesh>(null)
  const mat = useToneMaterial(t, 1)
  const key = useRef('')
  const locX = engine.site.locAntenna.x * METRES_PER_NM
  const nx = 150
  const ny = 40
  const geo = useMemo(() => {
    const pos: number[] = []
    const fade: number[] = []
    const pat: number[] = []
    const idx: number[] = []
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const xm = BOUNDS_M.minX + (i / nx) * (locX - BOUNDS_M.minX)
        const ym = BOUNDS_M.minY + (j / ny) * (BOUNDS_M.maxY - BOUNDS_M.minY)
        const [x, , z] = toI({ x: nm(xm), y: nm(ym) })
        pos.push(x, 0.014, z)
        pat.push(x, z)
        const edge = Math.min(i / 6, (nx - i) / 3, j / 3, (ny - j) / 3, 1)
        fade.push(Math.max(0, edge))
      }
    }
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i
        idx.push(a, a + 1, a + nx + 1, a + 1, a + nx + 2, a + nx + 1)
      }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('aK', new THREE.Float32BufferAttribute(new Float32Array((nx + 1) * (ny + 1)), 1))
    g.setAttribute('aFade', new THREE.Float32BufferAttribute(fade, 1))
    g.setAttribute('aPat', new THREE.Float32BufferAttribute(pat, 2))
    g.setIndex(idx)
    return g
  }, [locX])
  useLayoutEffect(() => () => geo.dispose(), [geo])
  useFrame(() => {
    if (mesh.current) mesh.current.visible = !engine.locOff
    const k = `${engine.failures.truck}|${engine.faultShiftM.toFixed(2)}`
    if (k === key.current) return
    key.current = k
    const aK = geo.getAttribute('aK') as THREE.BufferAttribute
    for (let j = 0; j <= ny; j++)
      for (let i = 0; i <= nx; i++) {
        const xm = BOUNDS_M.minX + (i / nx) * (locX - BOUNDS_M.minX)
        const ym = BOUNDS_M.minY + (j / ny) * (BOUNDS_M.maxY - BOUNDS_M.minY)
        aK.setX(j * (nx + 1) + i, THREE.MathUtils.clamp(engine.locDdmAt({ x: nm(xm), y: nm(ym) }) / LOC_FULL_SCALE_DDM, -1, 1))
      }
    aK.needsUpdate = true
  })
  return <mesh ref={mesh} geometry={geo} material={mat} userData={{ noPenPlot: true }} />
}

/** Highest point of the glide path field, ft above the runway. */
const GS_FIELD_TOP_FT = 1700

/** The glide path field in the vertical plane of the extended centreline. */
function GlideField({ t, engine }: { t: ThemeTokens; engine: IlsEngine }) {
  const mat = useToneMaterial(t, 1.1)
  const geo = useMemo(() => {
    const s = engine.site
    const back = bearingVector(s.courseDeg + 180)
    const gpipM = s.gpip.x * METRES_PER_NM
    const nx = 120
    const ny = 50
    const pos: number[] = []
    const kk: number[] = []
    const fade: number[] = []
    const pat: number[] = []
    const idx: number[] = []
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const dM = (i / nx) * (gpipM - BOUNDS_M.minX)
        const p = { x: s.gpip.x + back.x * nm(dM), y: s.gpip.y + back.y * nm(dM) }
        const hFt = (j / ny) * GS_FIELD_TOP_FT
        const [x, y, z] = toI(p, hFt)
        pos.push(x, y, z)
        pat.push(x, y)
        kk.push(THREE.MathUtils.clamp(engine.gsDdmAt(p, s.elevationFt + hFt) / GS_FULL_SCALE_DDM, -1, 1))
        const inRange = nm(dM) <= GS_COVERAGE.rangeNm ? 1 : 0
        fade.push(inRange * Math.min(1, i / 4) * Math.min(1, (ny - j) / 8) * Math.min(1, j / 1.5 + 0.2))
      }
    }
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i
        idx.push(a, a + 1, a + nx + 1, a + 1, a + nx + 2, a + nx + 1)
      }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('aK', new THREE.Float32BufferAttribute(kk, 1))
    g.setAttribute('aFade', new THREE.Float32BufferAttribute(fade, 1))
    g.setAttribute('aPat', new THREE.Float32BufferAttribute(pat, 2))
    g.setIndex(idx)
    return g
  }, [engine])
  useLayoutEffect(() => () => geo.dispose(), [geo])
  return <mesh geometry={geo} material={mat} userData={{ noPenPlot: true }} />
}

/** Reference lines: the runway's extended centreline on the ground and the 3° glide path in the air. */
function PathLines({ t, engine }: { t: ThemeTokens; engine: IlsEngine }) {
  const { centre, path } = useMemo(() => {
    const s = engine.site
    const back = bearingVector(s.courseDeg + 180)
    const far = nm(s.threshold.x * METRES_PER_NM - BOUNDS_M.minX)
    const c: number[] = []
    const p: number[] = []
    for (let d = 0; d <= far; d += 0.02) {
      const q = { x: s.threshold.x + back.x * d, y: s.threshold.y + back.y * d }
      c.push(...toI(q))
      p.push(...toI(q, onPathHeightFt(s, d)))
    }
    const gc = new THREE.BufferGeometry()
    gc.setAttribute('position', new THREE.Float32BufferAttribute(c, 3))
    const gp = new THREE.BufferGeometry()
    gp.setAttribute('position', new THREE.Float32BufferAttribute(p, 3))
    return { centre: gc, path: gp }
  }, [engine])
  useLayoutEffect(
    () => () => {
      centre.dispose()
      path.dispose()
    },
    [centre, path],
  )
  const lineC = col(t, 'stage-line')
  const pathLine = useMemo(() => {
    const l = new THREE.Line(path, new THREE.LineBasicMaterial({ color: col(t, 'stage-line'), transparent: true, opacity: 0.75, toneMapped: false }))
    l.userData.noPenPlot = true
    return l
  }, [path, t])
  useLayoutEffect(() => () => (pathLine.material as THREE.Material).dispose(), [pathLine])
  return (
    <group>
      <lineSegments geometry={centre} userData={{ noPenPlot: true }} position-y={0.02}>
        <lineBasicMaterial color={lineC} transparent opacity={0.35} />
      </lineSegments>
      <primitive object={pathLine} />
    </group>
  )
}


// ---------------------------------------------------------------------------
// Lobe outlines: the textbook picture of the two overlapping beams (shape illustrative)
// ---------------------------------------------------------------------------

function useLine(points: [number, number, number][], color: THREE.Color, opacity: number) {
  const line = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3))
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity, toneMapped: false }))
    l.userData.noPenPlot = true
    return l
  }, [points, color, opacity])
  useLayoutEffect(
    () => () => {
      line.geometry.dispose()
      ;(line.material as THREE.Material).dispose()
    },
    [line],
  )
  return line
}

/** A petal from an origin: r(θ) = length · cos²((θ − centre) · π / 2w), for |θ − centre| < w. */
function petal(centreDeg: number, widthDeg: number, lengthM: number, map: (angleDeg: number, rM: number) => [number, number, number]) {
  const pts: [number, number, number][] = []
  const n = 60
  for (let i = 0; i <= n; i++) {
    const a = centreDeg - widthDeg + (2 * widthDeg * i) / n
    const r = lengthM * Math.cos(((a - centreDeg) * Math.PI) / (2 * widthDeg)) ** 2
    pts.push(map(a, r))
  }
  return pts
}

function LobeOutlines({ t, engine }: { t: ThemeTokens; engine: IlsEngine }) {
  const s = engine.site
  const g = useRef<THREE.Group>(null)
  const c90 = useMemo(() => glowCol(t, 'lobe-90', 0.6), [t])
  const c150 = useMemo(() => glowCol(t, 'lobe-150', 0.6), [t])
  const { l90, l150, g90, g150 } = useMemo(() => {
    const locM = { x: s.locAntenna.x * METRES_PER_NM, y: s.locAntenna.y * METRES_PER_NM }
    const lenLoc = locM.x - BOUNDS_M.minX - 300
    // Localizer: angle from the back course, positive to the north (the pilot's left, where 90 Hz is louder).
    const locMap = (a: number, r: number): [number, number, number] => {
      const q = { x: nm(locM.x - Math.cos((a * Math.PI) / 180) * r), y: nm(locM.y + Math.sin((a * Math.PI) / 180) * r) }
      return toI(q, 30)
    }
    const hs = s.halfSectorDeg
    // Glideslope: elevation angle from the glide path origin, in the centreline plane.
    const gp = { x: s.gpip.x * METRES_PER_NM, y: s.gpip.y * METRES_PER_NM }
    const lenGs = gp.x - BOUNDS_M.minX - 300
    const gsMap = (a: number, r: number): [number, number, number] => {
      const q = { x: nm(gp.x - Math.cos((a * Math.PI) / 180) * r), y: nm(gp.y) }
      return toI(q, (Math.sin((a * Math.PI) / 180) * r) / METRES_PER_FT)
    }
    const p = s.pathDeg
    return {
      l90: petal(hs * 1.1, hs * 2.6, lenLoc, locMap),
      l150: petal(-hs * 1.1, hs * 2.6, lenLoc, locMap),
      g90: petal(p * 1.3, p * 0.62, lenGs, gsMap),
      g150: petal(p * 0.7, p * 0.62, lenGs, gsMap),
    }
  }, [s])
  const a = useLine(l90, c90, 0.75)
  const b = useLine(l150, c150, 0.75)
  const c = useLine(g90, c90, 0.6)
  const d = useLine(g150, c150, 0.6)
  useFrame(() => {
    if (g.current) g.current.visible = !engine.locOff
  })
  return (
    <group>
      <group ref={g}>
        <primitive object={a} />
        <primitive object={b} />
      </group>
      <primitive object={c} />
      <primitive object={d} />
    </group>
  )
}

// ---------------------------------------------------------------------------
// The table, runway, lights
// ---------------------------------------------------------------------------

function useRunwayTexture(t: ThemeTokens) {
  return useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 1024
    c.height = 64
    const ctx = c.getContext('2d')!
    ctx.fillStyle = toThreeStyle(t['stage-metal-dark'])
    ctx.fillRect(0, 0, 1024, 64)
    ctx.fillStyle = toThreeStyle(t['stage-paint'])
    // Threshold piano keys at both ends, centreline dashes, aiming-point blocks.
    for (const x0 of [4, 1024 - 4 - 14]) for (let k = 0; k < 8; k++) ctx.fillRect(x0, 6 + k * 7, 14, 4)
    for (let x = 40; x < 984; x += 20) ctx.fillRect(x, 31, 10, 2)
    for (const x of [100, 1024 - 100 - 16]) {
      ctx.fillRect(x, 18, 16, 6)
      ctx.fillRect(x, 40, 16, 6)
    }
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 8
    return tex
  }, [t])
}

function Airfield({ t, engine }: { t: ThemeTokens; engine: IlsEngine }) {
  const tex = useRunwayTexture(t)
  useLayoutEffect(() => () => tex.dispose(), [tex])
  const s = engine.site
  const thr = toI(s.runway.threshold)
  const end = toI(s.runway.end)
  const len = end[0] - thr[0]
  const wid = s.runway.widthFt * METRES_PER_FT * SU * LAT_X
  const grass = useMemo(() => col(t, 'stage-terrain').lerp(col(t, 'stage-floor'), 0.55), [t])
  return (
    <group>
      <mesh position={[CX, -0.2, CZ]} receiveShadow userData={{ noPenPlot: true }}>
        <boxGeometry args={[W + 0.6, 0.4, D + 0.6]} />
        <meshStandardMaterial color={col(t, 'stage-metal-dark')} roughness={0.55} metalness={0.6} />
      </mesh>
      <mesh position={[CX, -0.012, CZ]} userData={{ noPenPlot: true }}>
        <boxGeometry args={[W + 0.62, 0.014, D + 0.62]} />
        <meshStandardMaterial color={col(t, 'stage-brass')} roughness={0.5} metalness={0.5} />
      </mesh>
      <mesh position={[CX, (FLOOR - 0.4) / 2, CZ]} userData={{ noPenPlot: true }}>
        <boxGeometry args={[W * 0.7, Math.abs(FLOOR + 0.4), D * 0.55]} />
        <meshStandardMaterial color={col(t, 'stage-metal-dark')} roughness={0.8} metalness={0.3} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[CX, 0.001, CZ]} receiveShadow userData={{ noPenPlot: true }}>
        <planeGeometry args={[W, D]} />
        <meshStandardMaterial color={grass} roughness={0.95} metalness={0.02} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[(thr[0] + end[0]) / 2, 0.006, thr[2]]} userData={{ noPenPlot: true }}>
        <planeGeometry args={[len, wid]} />
        <meshStandardMaterial map={tex} emissiveMap={tex} emissive={col(t, 'stage-paint')} emissiveIntensity={0.35} roughness={0.85} />
      </mesh>
    </group>
  )
}

/** Runway edge, threshold, end and approach lights as constant-size points, like real lights at night. */
function Lights({ t, engine }: { t: ThemeTokens; engine: IlsEngine }) {
  const sets = useMemo(() => {
    const s = engine.site
    const u = bearingVector(s.courseDeg)
    const left = bearingVector(s.courseDeg - 90)
    const at = (alongM: number, sideM: number) =>
      toI({ x: s.threshold.x + nm(u.x * alongM + left.x * sideM), y: s.threshold.y + nm(u.y * alongM + left.y * sideM) }, 3)
    const lenM = s.runway.lengthFt * METRES_PER_FT
    const half = (s.runway.widthFt * METRES_PER_FT) / 2 + 1.5
    const white: number[] = []
    const green: number[] = []
    const red: number[] = []
    for (let d = 30; d <= APPROACH_LIGHTS_M; d += 30) for (let k = -2; k <= 2; k++) white.push(...at(-d, k * 1.2))
    for (let k = -15; k <= 15; k += 2) white.push(...at(-300, k))
    for (let d = 0; d <= lenM; d += 60) white.push(...at(d, half), ...at(d, -half))
    for (let k = -half; k <= half; k += 4.5) {
      green.push(...at(-1, k))
      red.push(...at(lenM + 1, k))
    }
    const g = (a: number[]) => {
      const b = new THREE.BufferGeometry()
      b.setAttribute('position', new THREE.Float32BufferAttribute(a, 3))
      return b
    }
    return { white: g(white), green: g(green), red: g(red) }
  }, [engine])
  useLayoutEffect(
    () => () => {
      sets.white.dispose()
      sets.green.dispose()
      sets.red.dispose()
    },
    [sets],
  )
  return (
    <group>
      <points geometry={sets.white} userData={{ noPenPlot: true }}>
        <pointsMaterial color={col(t, 'stage-paint').multiplyScalar(1.3)} size={2.2} sizeAttenuation={false} toneMapped={false} />
      </points>
      <points geometry={sets.green} userData={{ noPenPlot: true }}>
        <pointsMaterial color={glowCol(t, 'success')} size={2.6} sizeAttenuation={false} toneMapped={false} />
      </points>
      <points geometry={sets.red} userData={{ noPenPlot: true }}>
        <pointsMaterial color={col(t, 'stage-alert')} size={2.6} sizeAttenuation={false} toneMapped={false} />
      </points>
    </group>
  )
}

// ---------------------------------------------------------------------------
// Ground equipment (lifted from Approach3D, larger than life)
// ---------------------------------------------------------------------------

function LocalizerArray({ t, engine }: { t: ThemeTokens; engine: IlsEngine }) {
  const [x, , z] = toI(engine.site.locAntenna)
  const n = 14
  const span = 0.62
  const paint = col(t, 'stage-paint')
  const dark = col(t, 'stage-metal-dark')
  return (
    <group position={[x, 0, z]} rotation-y={bearingToThreeRotationY(stretchedBearingDeg(engine.site.courseDeg))}>
      {/* Elements across the course (local x), radiating back along the approach (local +z) */}
      {Array.from({ length: n }, (_, i) => {
        const ex = (i / (n - 1) - 0.5) * span
        return (
          <group key={i} position={[ex, 0, 0]}>
            <mesh position={[0, 0.06, 0]} castShadow>
              <cylinderGeometry args={[0.006, 0.008, 0.12, 6]} />
              <meshStandardMaterial color={paint} roughness={0.4} metalness={0.6} />
            </mesh>
            <mesh position={[0, 0.12, 0.02]} rotation-x={Math.PI / 2}>
              <cylinderGeometry args={[0.004, 0.004, 0.08, 5]} />
              <meshStandardMaterial color={paint} roughness={0.4} metalness={0.6} />
            </mesh>
          </group>
        )
      })}
      <mesh position={[0, 0.12, 0]}>
        <boxGeometry args={[span + 0.04, 0.012, 0.012]} />
        <meshStandardMaterial color={dark} roughness={0.4} metalness={0.8} />
      </mesh>
      <mesh position={[0, 0.005, 0]} receiveShadow>
        <boxGeometry args={[span + 0.12, 0.01, 0.12]} />
        <meshStandardMaterial color={col(t, 'stage-metal')} roughness={0.9} />
      </mesh>
      <mesh position={[span / 2 + 0.16, 0.045, -0.06]} castShadow>
        <boxGeometry args={[0.12, 0.09, 0.09]} />
        <meshPhysicalMaterial color={paint} roughness={0.4} metalness={0.15} clearcoat={0.5} />
      </mesh>
    </group>
  )
}

function GlideMast({ t, engine }: { t: ThemeTokens; engine: IlsEngine }) {
  const [x, , z] = toI(engine.site.gsAntenna)
  const h = 0.5
  const paint = col(t, 'stage-paint')
  const brass = col(t, 'stage-brass')
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, h / 2, 0]} castShadow>
        <boxGeometry args={[0.02, h, 0.02]} />
        <meshStandardMaterial color={paint} roughness={0.4} metalness={0.6} />
      </mesh>
      {[0.18, 0.3, 0.44].map((y) => (
        <mesh key={y} position={[-0.03, y, 0]}>
          <boxGeometry args={[0.035, 0.05, 0.07]} />
          <meshStandardMaterial color={brass} roughness={0.35} metalness={0.8} emissive={brass} emissiveIntensity={0.1} />
        </mesh>
      ))}
      <mesh position={[0.08, 0.04, 0.02]} castShadow>
        <boxGeometry args={[0.09, 0.08, 0.08]} />
        <meshPhysicalMaterial color={paint} roughness={0.4} metalness={0.15} clearcoat={0.5} />
      </mesh>
    </group>
  )
}

const MARKERS: { kind: MarkerKind; token: 'marker-outer' | 'marker-middle' | 'marker-inner'; name: string }[] = [
  { kind: 'outer', token: 'marker-outer', name: 'OUTER MARKER' },
  { kind: 'middle', token: 'marker-middle', name: 'MIDDLE MARKER' },
  { kind: 'inner', token: 'marker-inner', name: 'INNER MARKER' },
]

/** Marker beacons: a hut and a fan-shaped beam straight up. The beam lights while the aircraft is in it. */
function Markers({ t, engine }: { t: ThemeTokens; engine: IlsEngine }) {
  const mats = useMemo(
    () =>
      MARKERS.map(
        (m) =>
          new THREE.MeshBasicMaterial({
            color: glowCol(t, m.token),
            transparent: true,
            opacity: 0.08,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            toneMapped: false,
          }),
      ),
    [t],
  )
  useLayoutEffect(() => () => mats.forEach((m) => m.dispose()), [mats])
  const labels = useRef<(HTMLDivElement | null)[]>([])
  useFrame(() => {
    const active = engine.receiver.marker
    MARKERS.forEach((m, i) => {
      mats[i].opacity = active === m.kind ? 0.4 : 0.035
      const el = labels.current[i]
      if (el) el.style.opacity = active === m.kind ? '1' : '0.55'
    })
  })
  return (
    <group>
      {MARKERS.map((m, i) => {
        const p = engine.site.markers[m.kind]
        if (p.x * METRES_PER_NM < BOUNDS_M.minX) return null
        const [x, , z] = toI(p)
        return (
          <group key={m.kind} position={[x, 0, z]}>
            <mesh position={[0, 0.03, 0]} castShadow>
              <boxGeometry args={[0.07, 0.06, 0.06]} />
              <meshStandardMaterial color={col(t, 'stage-paint')} roughness={0.5} metalness={0.2} />
            </mesh>
            {/* Beam: a cone opening upward, flattened along the course like the real fan */}
            <mesh position={[0, 0.55, 0]} rotation-x={Math.PI} scale={[0.3, 1, 1]} material={mats[i]} userData={{ noPenPlot: true }}>
              <coneGeometry args={[0.32, 1.1, 24, 1, true]} />
            </mesh>
            <Callout3D position={[0.05, 0.22, 0]} lead={12} rootRef={(el) => void (labels.current[i] = el)}>
              {m.name}
            </Callout3D>
          </group>
        )
      })}
    </group>
  )
}

/** The vehicle parked in the localizer critical area (when that failure is on). */
function Truck({ t, engine }: { t: ThemeTokens; engine: IlsEngine }) {
  const g = useRef<THREE.Group>(null)
  const label = useRef<HTMLDivElement>(null)
  useFrame(() => {
    if (g.current) g.current.visible = engine.failures.truck
    if (label.current) label.current.style.display = engine.failures.truck ? '' : 'none'
  })
  const [x, , z] = toI(TRUCK_POS)
  return (
    <group position={[x, 0, z]}>
      <group ref={g} visible={false} rotation-y={0.4}>
        <mesh position={[0, 0.04, 0]} castShadow>
          <boxGeometry args={[0.16, 0.07, 0.06]} />
          <meshStandardMaterial color={col(t, 'stage-brass')} roughness={0.45} metalness={0.4} />
        </mesh>
        <mesh position={[0.1, 0.035, 0]}>
          <boxGeometry args={[0.05, 0.06, 0.058]} />
          <meshStandardMaterial color={col(t, 'stage-paint')} roughness={0.4} metalness={0.3} />
        </mesh>
      </group>
      <Callout3D position={[0, 0.1, 0]} tone="alert" lead={14} rootRef={label}>
        TRUCK IN THE CRITICAL AREA
      </Callout3D>
    </group>
  )
}

// ---------------------------------------------------------------------------
// The aircraft, its trail and its label
// ---------------------------------------------------------------------------

const TRAIL_MAX = 900

function Aircraft({ t, engine }: { t: ThemeTokens; engine: IlsEngine }) {
  const g = useRef<THREE.Group>(null)
  const drop = useRef<THREE.Mesh>(null)
  const foot = useRef<THREE.Mesh>(null)
  const tag = useRef<THREE.Group>(null)
  const text = useRef<HTMLSpanElement>(null)
  const trailGeo = useMemo(() => {
    const b = new THREE.BufferGeometry()
    b.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_MAX * 3), 3))
    b.setDrawRange(0, 0)
    return b
  }, [])
  const trailLine = useMemo(() => {
    const l = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: col(t, 'stage-signal'), transparent: true, opacity: 0.55, toneMapped: false }))
    l.userData.noPenPlot = true
    l.frustumCulled = false
    return l
  }, [trailGeo, t])
  useLayoutEffect(() => () => trailGeo.dispose(), [trailGeo])
  useLayoutEffect(() => () => (trailLine.material as THREE.Material).dispose(), [trailLine])
  const lastTrail = useRef<{ n: number; first: unknown }>({ n: -1, first: null })
  useFrame(() => {
    const a = engine.aircraft
    const h = engine.heightAboveRunwayFt
    const [x, y, z] = toI(a.pos, Math.max(0, h))
    if (g.current) {
      g.current.position.set(x, y + 0.04, z)
      g.current.rotation.y = bearingToThreeRotationY(stretchedBearingDeg(a.headingDeg))
    }
    if (drop.current) {
      drop.current.visible = y > 0.03
      drop.current.scale.set(1, Math.max(0.001, y), 1)
      drop.current.position.set(x, y / 2, z)
    }
    if (foot.current) foot.current.position.set(x, 0.016, z)
    if (tag.current) tag.current.position.set(x, y + 0.16, z)
    if (text.current) {
      const rx = engine.receiver
      const d = engine.distanceToThresholdNm
      let s = `${a.callsign} · ${Math.round(Math.max(0, h) / 10) * 10} FT`
      if (engine.phase === 'approach' && d > 0) s += ` · ${d.toFixed(1)} NM`
      else if (engine.phase === 'go-around') s += ' · GOING AROUND'
      else if (engine.phase !== 'approach') s += ' · ON THE RUNWAY'
      if (!rx.loc.valid) s += ' · LOC FLAG'
      if (!rx.gs.valid && engine.phase === 'approach') s += ' · GS FLAG'
      if (text.current.textContent !== s) text.current.textContent = s
    }
    // Trail: rewrite only when the engine's trail has changed.
    const tr = engine.trail
    if (tr.length !== lastTrail.current.n || tr[0] !== lastTrail.current.first) {
      lastTrail.current = { n: tr.length, first: tr[0] }
      const attr = trailGeo.getAttribute('position') as THREE.BufferAttribute
      const n = Math.min(TRAIL_MAX, tr.length)
      for (let i = 0; i < n; i++) {
        const p = tr[tr.length - n + i]
        const [px, py, pz] = toI(p.pos, Math.max(0, p.heightFt))
        attr.setXYZ(i, px, py + 0.04, pz)
      }
      attr.needsUpdate = true
      trailGeo.setDrawRange(0, n)
    }
  })
  return (
    <>
      <group ref={g}>
        <group scale={(38 * MODEL_X * SU) / 0.51}>
          <AircraftModel t={t} />
        </group>
      </group>
      <primitive object={trailLine} />
      <mesh ref={drop} userData={{ noPenPlot: true }}>
        <cylinderGeometry args={[0.005, 0.005, 1, 4]} />
        <meshBasicMaterial color={col(t, 'stage-line')} transparent opacity={0.35} />
      </mesh>
      <mesh ref={foot} rotation-x={-Math.PI / 2} userData={{ noPenPlot: true }}>
        <ringGeometry args={[0.07, 0.09, 32]} />
        <meshBasicMaterial color={col(t, 'stage-line')} transparent opacity={0.5} />
      </mesh>
      <group ref={tag}>
        <Callout3D position={[0, 0, 0]} lead={16}>
          <span ref={text} />
        </Callout3D>
      </group>
    </>
  )
}

// ---------------------------------------------------------------------------
// Labels that say what each tone means, chosen from the engine's own DDM
// ---------------------------------------------------------------------------

function ToneLabels({ engine }: { engine: IlsEngine }) {
  const s = engine.site
  const xm = -5500
  const pNorth = { x: nm(xm), y: nm(520) }
  const pSouth = { x: nm(xm), y: nm(-520) }
  const back = bearingVector(s.courseDeg + 180)
  const dAbove = 2.2
  const pc = { x: s.threshold.x + back.x * dAbove, y: s.threshold.y + back.y * dAbove }
  const above = onPathHeightFt(s, dAbove) * 1.55
  const below = onPathHeightFt(s, dAbove) * 0.5
  const lat = (p: Vec2) => {
    const k = cdiLateral(engine.locDdmAt(p))
    return k > 0 ? { tone: 'signal' as const, text: '90 Hz LOUDER · FLY RIGHT' } : { tone: 'brass' as const, text: '150 Hz LOUDER · FLY LEFT' }
  }
  const ver = (hFt: number) => {
    const k = cdiVertical(engine.gsDdmAt(pc, s.elevationFt + hFt))
    return k < 0 ? { tone: 'signal' as const, text: '90 Hz LOUDER · FLY DOWN' } : { tone: 'brass' as const, text: '150 Hz LOUDER · FLY UP' }
  }
  const n = lat(pNorth)
  const so = lat(pSouth)
  const va = ver(above)
  const vb = ver(below)
  const locRoot = useRef<HTMLDivElement>(null)
  const locRoot2 = useRef<HTMLDivElement>(null)
  const off = useRef<HTMLDivElement>(null)
  useFrame(() => {
    const hide = engine.locOff ? 'none' : ''
    if (locRoot.current) locRoot.current.style.display = hide
    if (locRoot2.current) locRoot2.current.style.display = hide
    if (off.current) off.current.style.display = engine.locOff ? '' : 'none'
  })
  const [lx, , lz] = toI(s.locAntenna)
  return (
    <>
      <Callout3D position={toI(pNorth)} tone={n.tone} lead={12} rootRef={locRoot}>
        {n.text}
      </Callout3D>
      <Callout3D position={toI(pSouth)} tone={so.tone} lead={12} rootRef={locRoot2}>
        {so.text}
      </Callout3D>
      <Callout3D position={toI(pc, above)} tone={va.tone} lead={12}>
        {va.text}
      </Callout3D>
      <Callout3D position={toI(pc, below)} tone={vb.tone} lead={12}>
        {vb.text}
      </Callout3D>
      <Callout3D position={[lx, 0.3, lz]} tone="alert" lead={14} rootRef={off}>
        LOCALIZER OFF · MONITOR
      </Callout3D>
    </>
  )
}

export function IlsHero({ t, engine }: { t: ThemeTokens; engine: IlsEngine }) {
  const lineColor = useMemo(() => col(t, 'stage-line'), [t])
  const s = engine.site
  const [lx, , lz] = toI(s.locAntenna)
  const [gx, , gz] = toI(s.gsAntenna)
  return (
    <group>
      <StudioFloor t={t} y={FLOOR} shadowScale={40} />
      <Airfield t={t} engine={engine} />
      <Lights t={t} engine={engine} />
      <LocalizerField t={t} engine={engine} />
      <GlideField t={t} engine={engine} />
      <PathLines t={t} engine={engine} />
      <LobeOutlines t={t} engine={engine} />
      <PenPlot color={lineColor}>
        <LocalizerArray t={t} engine={engine} />
        <GlideMast t={t} engine={engine} />
      </PenPlot>
      <Markers t={t} engine={engine} />
      <Truck t={t} engine={engine} />
      <Aircraft t={t} engine={engine} />
      <ToneLabels engine={engine} />
      <Callout3D position={[lx + 0.1, 0.2, lz - 0.35]} tone="signal" lead={14}>
        {`LOCALIZER · ${s.locMHz.toFixed(2)} MHz`}
      </Callout3D>
      <Callout3D position={[gx, 0.52, gz]} tone="signal" lead={14}>
        {`GLIDE PATH · ${s.pathDeg}°`}
      </Callout3D>
    </group>
  )
}

export default IlsHero
