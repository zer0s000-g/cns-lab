/**
 * The HF hero: one slice of the round Earth along the path, the ionosphere
 * layers above it, the fan of rays from the HF station and where on the sea
 * the signal comes back down (and where it skips). Everything is read from
 * the unchanged HfEngine each frame: the ionosphere, the traced rays, the
 * ground coverage, the path that reaches CNS101 and the SELCAL calls.
 *
 * Scale (heroScale.ts): the slice is 2,770 NM long; heights and the Earth's
 * curve are stretched ×2.5 with the same affine map as the side view, so
 * straight rays stay straight. The station and aircraft are larger than
 * life; the page labels all of it.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { D_LAYER_KM, HF_STATION_ANTENNA_FT, hfQuality, solarCosZenith, traceRay, type BandKind, type BandSegment, type Reception, type TracedRay } from '@/core/hf'
import { bearingToThreeRotationY } from '@/core/geometry'
import { rayHeightFt } from '@/core/propagation'
import { EARTH_RADIUS_NM, FT_PER_NM, kmToNm } from '@/core/units'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { useReducedMotion } from '@/stores/prefs'
import { Callout3D } from '@/stage/Callout3D'
import { AircraftModel } from '@/stage/Diorama'
import { PenPlot } from '@/stage/PenPlot'
import { StudioFloor, col } from '@/stage/Stage'
import { CRUISE_FT, VIEW_MAX_NM, type AircraftId, type HfEngine } from './engine'
import { HERO_CENTER_NM, HERO_D_MAX, HERO_D_MIN, KX, KY, SLAB_HALF_W, heroXY } from './heroScale'
import { QUALITY_TEXT, formatHour, modeText, nmText } from './labels'

type V3 = [number, number, number]

const R = EARTH_RADIUS_NM
/** The Earth slice is a shell this thick below the sea, NM. */
const SHELL_NM = 70
const CRUISE_NM = CRUISE_FT / FT_PER_NM
const AIRCRAFT_SCALE = 0.7
const at = (d: number, h: number, z = 0): V3 => {
  const [x, y] = heroXY(d, h)
  return [x, y, z]
}
/** Rotation (about z) that tilts a model to stand on the arc at distance d. */
const tiltAt = (d: number) => {
  const a = heroXY(d - 5, 0)
  const b = heroXY(d + 5, 0)
  return Math.atan2(b[1] - a[1], b[0] - a[0])
}

function useOwned<T extends THREE.Material | THREE.BufferGeometry | THREE.Texture>(make: () => T, deps: unknown[]): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const v = useMemo(make, deps)
  useEffect(() => () => v.dispose(), [v])
  return v
}

// ---------------------------------------------------------------------------
// Tubes for the path that reaches CNS101, with travelling pulses
// ---------------------------------------------------------------------------

const BEAM_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`
const BEAM_FRAG = `varying vec2 vUv; uniform vec3 uColor; uniform float uOpacity; uniform float uLen; uniform float uOffset; uniform float uTime; uniform float uPulse;
  void main(){
    float s = uOffset + vUv.y * uLen;
    float a = uOpacity;
    float p = fract((s - uTime * 3.0) / 1.2);
    a += uPulse * pow(max(p, 0.0), 6.0) * 2.0;
    gl_FragColor = vec4(uColor * a, a);
  }`
const beamGeo = (() => {
  const g = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true)
  g.translate(0, 0.5, 0)
  return g
})()
const UP = new THREE.Vector3(0, 1, 0)
const MAX_PATH_SEGMENTS = 24

function PathTubes({ t, engine }: { t: ThemeTokens; engine: HfEngine }) {
  const meshes = useRef<THREE.Mesh[]>([])
  const reduced = useReducedMotion()
  const mats = useMemo(
    () =>
      Array.from(
        { length: MAX_PATH_SEGMENTS },
        () =>
          new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
            uniforms: { uColor: { value: col(t, 'stage-signal') }, uOpacity: { value: 1 }, uLen: { value: 1 }, uOffset: { value: 0 }, uTime: { value: 0 }, uPulse: { value: 0 } },
            vertexShader: BEAM_VERT,
            fragmentShader: BEAM_FRAG,
          }),
      ),
    [t],
  )
  useEffect(() => () => mats.forEach((m) => m.dispose()), [mats])
  const cache = useRef<{ rx: Reception | null; pts: V3[] }>({ rx: null, pts: [] })
  const tmp = useMemo(() => ({ a: new THREE.Vector3(), d: new THREE.Vector3() }), [])
  useFrame(() => {
    const rx = engine.reception()
    if (rx !== cache.current.rx) {
      cache.current = { rx, pts: pathPoints(engine, rx) }
    }
    const pts = cache.current.pts
    const sending = engine.selcal !== null
    let offset = 0
    for (let i = 0; i < MAX_PATH_SEGMENTS; i++) {
      const m = meshes.current[i]
      if (!m) continue
      const a = pts[i]
      const b = pts[i + 1]
      m.visible = Boolean(a && b)
      if (!a || !b) continue
      tmp.a.set(...a)
      tmp.d.set(...b).sub(tmp.a)
      const len = Math.max(1e-4, tmp.d.length())
      m.position.copy(tmp.a)
      m.quaternion.setFromUnitVectors(UP, tmp.d.divideScalar(len))
      m.scale.set(0.022, len, 0.022)
      const u = mats[i].uniforms
      u.uLen.value = len
      u.uOffset.value = offset
      u.uTime.value = reduced ? 0 : engine.timeS
      u.uPulse.value = sending ? 1 : 0
      u.uOpacity.value = 0.95
      offset += len
    }
  })
  return (
    <group>
      {mats.map((m, i) => (
        <mesh key={i} ref={(el) => void (el && (meshes.current[i] = el))} geometry={beamGeo} material={m} visible={false} frustumCulled={false} userData={{ noPenPlot: true }} />
      ))}
    </group>
  )
}

/** The path that reaches CNS101, exactly as the side view draws it. */
function pathPoints(engine: HfEngine, rx: Reception): V3[] {
  const D = engine.params.distanceNm
  if (rx.mode === 'sky' && rx.elevationDeg !== null && rx.leg) {
    const ray = traceRay(engine.iono(), engine.freqMHz, rx.elevationDeg, VIEW_MAX_NM + 200)
    const before = rx.leg === 'down' ? 2 * rx.hops - 1 : 2 * rx.hops
    const segs = ray.segments.slice(0, before)
    const last = segs[segs.length - 1]
    if (!last) return []
    return [...segs.map((s) => at(s.from.dNm, s.from.hNm)), at(last.to.dNm, last.to.hNm), at(D, CRUISE_NM)]
  }
  if (rx.mode === 'direct') {
    const pts: V3[] = []
    for (let k = 0; k <= 16; k++) {
      const s = (D * k) / 16
      pts.push(at(s, rayHeightFt(s, D, HF_STATION_ANTENNA_FT, CRUISE_FT) / FT_PER_NM))
    }
    return pts
  }
  if (rx.mode === 'ground') {
    // The ground wave hugs the sea surface.
    const pts: V3[] = []
    for (let k = 0; k <= 16; k++) pts.push(at((D * k) / 16, (CRUISE_NM * k) / 16 + 0.5))
    return pts
  }
  return []
}

// ---------------------------------------------------------------------------
// The fan of rays: reflected, absorbed, escaping
// ---------------------------------------------------------------------------

const MAX_RAY_VERTS = 6000

function RayFan({ t, engine }: { t: ThemeTokens; engine: HfEngine }) {
  const make = () => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_RAY_VERTS * 3), 3))
    g.setDrawRange(0, 0)
    return g
  }
  const refl = useOwned(make, [])
  const esc = useOwned(make, [])
  const abs = useOwned(make, [])
  const marks = useOwned(make, [])
  const reflMat = useOwned(() => new THREE.LineBasicMaterial({ color: col(t, 'stage-signal'), transparent: true, opacity: 0.4, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending }), [t])
  const escMat = useOwned(() => new THREE.LineDashedMaterial({ color: col(t, 'stage-glass'), transparent: true, opacity: 0.6, dashSize: 0.18, gapSize: 0.12, toneMapped: false, depthWrite: false }), [t])
  const absMat = useOwned(() => new THREE.LineDashedMaterial({ color: col(t, 'stage-line'), transparent: true, opacity: 0.7, dashSize: 0.04, gapSize: 0.07, toneMapped: false, depthWrite: false }), [t])
  const markMat = useOwned(() => new THREE.PointsMaterial({ color: col(t, 'stage-line'), size: 5, sizeAttenuation: false, transparent: true, opacity: 0.9, toneMapped: false }), [t])
  const objs = useMemo(() => {
    const a = new THREE.LineSegments(refl, reflMat)
    const b = new THREE.LineSegments(esc, escMat)
    const c = new THREE.LineSegments(abs, absMat)
    const d = new THREE.Points(marks, markMat)
    for (const o of [a, b, c, d]) {
      o.frustumCulled = false
      o.userData.noPenPlot = true
    }
    return [a, b, c, d]
  }, [refl, esc, abs, marks, reflMat, escMat, absMat, markMat])
  const last = useRef<TracedRay[] | null>(null)
  useFrame(() => {
    const rays = engine.rays()
    if (rays === last.current) return
    last.current = rays
    const fill = (g: THREE.BufferGeometry, pts: V3[]) => {
      const arr = (g.getAttribute('position') as THREE.BufferAttribute).array as Float32Array
      const n = Math.min(pts.length, MAX_RAY_VERTS)
      for (let i = 0; i < n; i++) arr.set(pts[i], i * 3)
      ;(g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
      g.setDrawRange(0, n)
    }
    const r: V3[] = []
    const e: V3[] = []
    const a: V3[] = []
    const m: V3[] = []
    for (const ray of rays) {
      if (ray.fate === 'escaped') {
        for (const s of ray.segments) e.push(at(s.from.dNm, s.from.hNm), at(s.to.dNm, s.to.hNm))
      } else {
        const n = ray.fate === 'absorbed' ? ray.segments.length - 1 : ray.segments.length
        ray.segments.slice(0, n).forEach((s) => r.push(at(s.from.dNm, s.from.hNm), at(s.to.dNm, s.to.hNm)))
        if (ray.fate === 'absorbed') {
          const s = ray.segments[ray.segments.length - 1]
          a.push(at(s.from.dNm, s.from.hNm), at(s.to.dNm, s.to.hNm))
          if (ray.absorbedAt) m.push(at(ray.absorbedAt.dNm, ray.absorbedAt.hNm))
        }
      }
    }
    fill(refl, r)
    fill(esc, e)
    fill(abs, a)
    fill(marks, m)
    // Dashes need the distance along each line.
    ;(objs[1] as THREE.LineSegments).computeLineDistances()
    ;(objs[2] as THREE.LineSegments).computeLineDistances()
  })
  return (
    <group>
      {objs.map((o, i) => (
        <primitive key={i} object={o} />
      ))}
    </group>
  )
}

// ---------------------------------------------------------------------------
// The Earth slice and the coverage on the sea
// ---------------------------------------------------------------------------

function EarthSlice({ t }: { t: ThemeTokens }) {
  const nx = 200
  const top = useOwned(() => {
    const g = new THREE.BufferGeometry()
    const pos: number[] = []
    const idx: number[] = []
    const nz = 8
    for (let i = 0; i <= nx; i++) {
      const d = HERO_D_MIN + ((HERO_D_MAX - HERO_D_MIN) * i) / nx
      const [x, y] = heroXY(d, 0)
      for (let j = 0; j <= nz; j++) {
        pos.push(x, y, -SLAB_HALF_W + (2 * SLAB_HALF_W * j) / nz)
        if (i < nx && j < nz) {
          const a = i * (nz + 1) + j
          const b = a + nz + 1
          idx.push(a, a + 1, b, a + 1, b + 1, b)
        }
      }
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setIndex(idx)
    g.computeVertexNormals()
    return g
  }, [])
  const walls = useOwned(() => {
    const tri: number[] = []
    const q = (a: V3, b: V3, c: V3, d: V3) => tri.push(...a, ...b, ...c, ...a, ...c, ...d)
    const W = SLAB_HALF_W
    for (let i = 0; i < nx; i++) {
      const d0 = HERO_D_MIN + ((HERO_D_MAX - HERO_D_MIN) * i) / nx
      const d1 = HERO_D_MIN + ((HERO_D_MAX - HERO_D_MIN) * (i + 1)) / nx
      q(at(d0, -SHELL_NM, W), at(d1, -SHELL_NM, W), at(d1, 0, W), at(d0, 0, W))
      q(at(d1, -SHELL_NM, -W), at(d0, -SHELL_NM, -W), at(d0, 0, -W), at(d1, 0, -W))
      q(at(d1, -SHELL_NM, W), at(d0, -SHELL_NM, W), at(d0, -SHELL_NM, -W), at(d1, -SHELL_NM, -W))
    }
    for (const [d, s] of [
      [HERO_D_MIN, 1],
      [HERO_D_MAX, -1],
    ] as const) {
      q(at(d, -SHELL_NM, -W * s), at(d, -SHELL_NM, W * s), at(d, 0, W * s), at(d, 0, -W * s))
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3))
    g.computeVertexNormals()
    return g
  }, [])
  const topMat = useOwned(() => new THREE.MeshStandardMaterial({ color: col(t, 'stage-water'), emissive: col(t, 'stage-water'), emissiveIntensity: 0.9, roughness: 0.4, metalness: 0.2 }), [t])
  // Sea level along the cut face, in brass: the curve of the Earth, side-on.
  const rim = useMemo(() => {
    const pts: THREE.Vector3[] = []
    for (let k = 0; k <= 120; k++) pts.push(new THREE.Vector3(...at(HERO_D_MIN + ((HERO_D_MAX - HERO_D_MIN) * k) / 120, 0, SLAB_HALF_W + 0.005)))
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: col(t, 'stage-brass'), toneMapped: false }))
    l.userData.noPenPlot = true
    return l
  }, [t])
  useEffect(
    () => () => {
      rim.geometry.dispose()
      ;(rim.material as THREE.Material).dispose()
    },
    [rim],
  )
  const ticks = useMemo(() => {
    const pos: number[] = []
    for (let d = 500; d <= HERO_D_MAX; d += 500) {
      pos.push(...at(d, 0.4, -SLAB_HALF_W), ...at(d, 0.4, SLAB_HALF_W), ...at(d, 0, SLAB_HALF_W), ...at(d, -12, SLAB_HALF_W))
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: col(t, 'stage-line'), transparent: true, opacity: 0.35, toneMapped: false }))
    l.userData.noPenPlot = true
    return l
  }, [t])
  useEffect(
    () => () => {
      ticks.geometry.dispose()
      ;(ticks.material as THREE.Material).dispose()
    },
    [ticks],
  )
  return (
    <group>
      <mesh geometry={top} material={topMat} receiveShadow userData={{ noPenPlot: true }} />
      <PenPlot color={col(t, 'stage-line')} keepLinesOpacity={0.3}>
        <mesh geometry={walls}>
          <meshStandardMaterial color={col(t, 'stage-metal')} roughness={0.75} metalness={0.3} side={THREE.DoubleSide} />
        </mesh>
      </PenPlot>
      <primitive object={rim} />
      <primitive object={ticks} />
      {[1000].map((d) => (
        <Callout3D key={d} position={at(d, 0, SLAB_HALF_W)} lead={6}>
          {`${d.toLocaleString('en-US')} NM`}
        </Callout3D>
      ))}
    </group>
  )
}

const KIND_CODE: Record<BandKind, number> = { none: 0, ground: 1, sky: 1, weak: 2, skip: 3, absorbed: 4 }
const COV_TEXELS = 512

/** Where on the sea the station is heard, too weak, skipped or absorbed: from engine.coverage(). */
function Coverage({ t, engine }: { t: ThemeTokens; engine: HfEngine }) {
  const tex = useOwned(() => {
    const d = new THREE.DataTexture(new Uint8Array(COV_TEXELS * 4), COV_TEXELS, 1, THREE.RGBAFormat)
    d.magFilter = THREE.NearestFilter
    d.minFilter = THREE.NearestFilter
    d.needsUpdate = true
    return d
  }, [])
  const geo = useOwned(() => {
    const g = new THREE.BufferGeometry()
    const pos: number[] = []
    const ad: number[] = []
    const idx: number[] = []
    const nx = 240
    for (let i = 0; i <= nx; i++) {
      const d = HERO_D_MIN + ((HERO_D_MAX - HERO_D_MIN) * i) / nx
      for (const z of [-SLAB_HALF_W, SLAB_HALF_W]) {
        pos.push(...at(d, 0.8, z))
        ad.push(d)
      }
      if (i < nx) {
        const b = i * 2
        idx.push(b, b + 1, b + 3, b, b + 3, b + 2)
      }
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('aD', new THREE.Float32BufferAttribute(ad, 1))
    g.setIndex(idx)
    return g
  }, [])
  const mat = useOwned(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
        uniforms: {
          uCov: { value: tex },
          uDMin: { value: HERO_D_MIN },
          uDMax: { value: HERO_D_MAX },
          uHeard: { value: col(t, 'stage-signal') },
          uSkip: { value: col(t, 'stage-brass') },
          uLine: { value: col(t, 'stage-line') },
        },
        vertexShader: `attribute float aD; varying float vD; varying vec3 vP;
          void main(){ vD = aD; vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `uniform sampler2D uCov; uniform float uDMin; uniform float uDMax; uniform vec3 uHeard; uniform vec3 uSkip; uniform vec3 uLine;
          varying float vD; varying vec3 vP;
          void main(){
            float k = floor(texture2D(uCov, vec2((vD - uDMin) / (uDMax - uDMin), 0.5)).r * 255.0 / 50.0 + 0.5);
            float hatch = step(0.62, fract((vP.x + vP.z) * 3.0));
            vec4 c = vec4(0.0);
            if (k == 1.0) c = vec4(uHeard, 0.26);
            else if (k == 2.0) c = vec4(uHeard, 0.1);
            else if (k == 3.0) c = vec4(uSkip, 0.08 + hatch * 0.5);
            else if (k == 4.0) c = vec4(uLine, 0.04 + hatch * 0.28);
            gl_FragColor = c;
          }`,
      }),
    [t, tex],
  )
  const last = useRef<BandSegment[] | null>(null)
  useFrame(() => {
    const cov = engine.coverage()
    if (cov === last.current) return
    last.current = cov
    const data = tex.image.data as Uint8Array
    let s = 0
    for (let k = 0; k < COV_TEXELS; k++) {
      const d = HERO_D_MIN + ((k + 0.5) / COV_TEXELS) * (HERO_D_MAX - HERO_D_MIN)
      while (s < cov.length - 1 && cov[s].toNm < d) s++
      const seg = cov[s]
      const code = seg && d >= seg.fromNm && d <= seg.toNm ? KIND_CODE[seg.kind] : 0
      data[k * 4] = code * 50
    }
    tex.needsUpdate = true
  })
  return <mesh geometry={geo} material={mat} renderOrder={2} frustumCulled={false} userData={{ noPenPlot: true }} />
}

// ---------------------------------------------------------------------------
// Ionosphere layers: glowing shells whose heights follow the engine
// ---------------------------------------------------------------------------

type LayerRead = { h0: number; h1: number; alpha: number; alert?: boolean } | null

function LayerShell({ t, read, neutral: isNeutral }: { t: ThemeTokens; read: () => LayerRead; neutral?: boolean }) {
  const geo = useOwned(() => {
    const g = new THREE.BufferGeometry()
    const pos: number[] = []
    const ad: number[] = []
    const ah: number[] = []
    const idx: number[] = []
    const nx = 160
    const W = SLAB_HALF_W
    let base = 0
    const sheet = (verts: [number, number, number][], cols: number) => {
      for (const [d, h, z] of verts) {
        pos.push(0, 0, z)
        ad.push(d)
        ah.push(h)
      }
      const rows = verts.length / cols
      for (let i = 0; i < rows - 1; i++)
        for (let j = 0; j < cols - 1; j++) {
          const a = base + i * cols + j
          idx.push(a, a + 1, a + cols, a + 1, a + cols + 1, a + cols)
        }
      base += verts.length
    }
    const ds = Array.from({ length: nx + 1 }, (_, i) => HERO_D_MIN + ((HERO_D_MAX - HERO_D_MIN) * i) / nx)
    for (const hk of [0, 1]) sheet(ds.flatMap((d) => [[d, hk, -W] as [number, number, number], [d, hk, W] as [number, number, number]]), 2)
    for (const z of [-W, W]) sheet(ds.flatMap((d) => [[d, 0, z] as [number, number, number], [d, 1, z] as [number, number, number]]), 2)
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('aD', new THREE.Float32BufferAttribute(ad, 1))
    g.setAttribute('aH', new THREE.Float32BufferAttribute(ah, 1))
    g.setIndex(idx)
    return g
  }, [])
  const mat = useOwned(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
        uniforms: {
          uH0: { value: 0 },
          uH1: { value: 1 },
          uR: { value: R },
          uC: { value: HERO_CENTER_NM },
          uKx: { value: KX },
          uKy: { value: KY },
          uAlpha: { value: 0.2 },
          uColor: { value: col(t, 'stage-signal') },
        },
        vertexShader: `attribute float aD; attribute float aH; uniform float uH0; uniform float uH1; uniform float uR; uniform float uC; uniform float uKx; uniform float uKy;
          varying float vH;
          void main(){
            float h = mix(uH0, uH1, aH);
            float psi = (aD - uC) / uR;
            vec3 p = vec3((uR + h) * sin(psi) * uKx, ((uR + h) * cos(psi) - uR) * uKy, position.z);
            vH = aH;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          }`,
        fragmentShader: `uniform vec3 uColor; uniform float uAlpha; varying float vH;
          void main(){
            float a = uAlpha * (0.45 + 0.55 * sin(vH * 3.14159));
            gl_FragColor = vec4(uColor * a, a);
          }`,
      }),
    [t],
  )
  const signal = useMemo(() => col(t, 'stage-signal'), [t])
  const neutral = useMemo(() => col(t, 'stage-line'), [t])
  const alert = useMemo(() => col(t, 'stage-alert'), [t])
  const mesh = useRef<THREE.Mesh>(null)
  useFrame(() => {
    const r = read()
    if (!mesh.current) return
    mesh.current.visible = Boolean(r)
    if (!r) return
    mat.uniforms.uH0.value = r.h0
    mat.uniforms.uH1.value = r.h1
    mat.uniforms.uAlpha.value = r.alpha
    mat.uniforms.uColor.value.copy(r.alert ? alert : isNeutral ? neutral : signal)
  })
  return <mesh ref={mesh} geometry={geo} material={mat} frustumCulled={false} userData={{ noPenPlot: true }} />
}

// ---------------------------------------------------------------------------
// The HF station and the aircraft
// ---------------------------------------------------------------------------

function Station({ t }: { t: ThemeTokens }) {
  const paint = col(t, 'stage-paint')
  const dark = col(t, 'stage-metal-dark')
  const metal = col(t, 'stage-metal')
  const brass = col(t, 'stage-brass')
  const MAST = 0.55
  return (
    <group position={at(0, 0)} rotation-z={tiltAt(0)}>
      <mesh position={[0, -0.01, 0]}>
        <boxGeometry args={[0.9, 0.06, 0.7]} />
        <meshStandardMaterial color={metal} roughness={0.95} />
      </mesh>
      {/* Transmitter building */}
      <mesh position={[-0.28, 0.09, 0.14]} castShadow>
        <boxGeometry args={[0.26, 0.16, 0.22]} />
        <meshPhysicalMaterial color={paint} roughness={0.4} metalness={0.15} clearcoat={0.5} />
      </mesh>
      <mesh position={[-0.28, 0.18, 0.14]}>
        <boxGeometry args={[0.29, 0.02, 0.25]} />
        <meshStandardMaterial color={dark} roughness={0.5} metalness={0.6} />
      </mesh>
      {/* Two masts holding a wire dipole across the path */}
      {[-0.3, 0.3].map((z) => (
        <mesh key={z} position={[0.18, MAST / 2, z]} castShadow>
          <cylinderGeometry args={[0.01, 0.018, MAST, 8]} />
          <meshStandardMaterial color={paint} roughness={0.45} metalness={0.55} />
        </mesh>
      ))}
      <mesh position={[0.18, MAST - 0.03, 0]} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.004, 0.004, 0.6, 5]} />
        <meshStandardMaterial color={brass} roughness={0.3} metalness={0.9} emissive={brass} emissiveIntensity={0.2} />
      </mesh>
      {/* Feed line down to the building */}
      <mesh position={[-0.05, MAST / 2 + 0.05, 0.07]} rotation-z={0.75}>
        <cylinderGeometry args={[0.003, 0.003, 0.62, 4]} />
        <meshStandardMaterial color={dark} roughness={0.5} metalness={0.6} />
      </mesh>
    </group>
  )
}

function Plane({ t, engine, id }: { t: ThemeTokens; engine: HfEngine; id: AircraftId }) {
  const g = useRef<THREE.Group>(null)
  const drop = useRef<THREE.Mesh>(null)
  useFrame(() => {
    if (!g.current) return
    const d = engine.distanceOf(id)
    g.current.position.set(...at(d, CRUISE_NM))
    g.current.rotation.z = tiltAt(d)
    if (drop.current) {
      drop.current.position.set(...at(d, CRUISE_NM / 2))
      drop.current.rotation.z = tiltAt(d)
    }
  })
  return (
    <>
      <group ref={g}>
        <group rotation-y={bearingToThreeRotationY(90)} scale={AIRCRAFT_SCALE}>
          <AircraftModel t={t} dim={id !== 'CNS101'} />
        </group>
      </group>
      <mesh ref={drop} scale={[1, CRUISE_NM * KY, 1]} userData={{ noPenPlot: true }}>
        <cylinderGeometry args={[0.005, 0.005, 1, 4]} />
        <meshBasicMaterial color={col(t, 'stage-line')} transparent opacity={0.35} />
      </mesh>
    </>
  )
}

/** A brass ring that flashes when an aircraft's SELCAL chime rings. */
function Chime({ t, engine, id }: { t: ThemeTokens; engine: HfEngine; id: AircraftId }) {
  const m = useRef<THREE.Mesh>(null)
  const mat = useRef<THREE.MeshBasicMaterial>(null)
  const reduced = useReducedMotion()
  useFrame(() => {
    if (!m.current || !mat.current) return
    const r = engine.results[id]
    const age = r ? engine.timeS - r.atS : Infinity
    const on = Boolean(r?.rang) && age < 4
    m.current.visible = on
    if (!on) return
    const d = engine.distanceOf(id)
    m.current.position.set(...at(d, CRUISE_NM))
    const k = reduced ? 0.4 : (age % 1.3) / 1.3
    m.current.scale.setScalar(0.12 + k * 0.4)
    mat.current.opacity = 1 - k
  })
  return (
    <mesh ref={m} visible={false} userData={{ noPenPlot: true }}>
      <ringGeometry args={[0.85, 1, 40]} />
      <meshBasicMaterial ref={mat} color={col(t, 'stage-brass')} transparent toneMapped={false} depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
    </mesh>
  )
}

/** Where the Sun (or, at night, the Moon) is drawn: an arc behind the slice, by the hour. */
function skyPos(hour: number, moon: boolean): V3 {
  const a = ((hour - 12) * 15 * Math.PI) / 180 + (moon ? Math.PI : 0)
  return [-4.5 + Math.sin(a) * 7, 2.8 + Math.cos(a) * 2.2, -10]
}

/** Sun (day) or Moon (night) over the slice: shows the local time of day only. */
function SkyClock({ t, engine }: { t: ThemeTokens; engine: HfEngine }) {
  const sun = useRef<THREE.Mesh>(null)
  const moon = useRef<THREE.Mesh>(null)
  useFrame(() => {
    const h = engine.params.hour
    const cz = solarCosZenith(h)
    if (sun.current) {
      sun.current.visible = cz > 0
      sun.current.position.set(...skyPos(h, false))
    }
    if (moon.current) {
      moon.current.visible = cz <= 0
      moon.current.position.set(...skyPos(h, true))
    }
  })
  return (
    <group>
      <mesh ref={sun} userData={{ noPenPlot: true }}>
        <sphereGeometry args={[0.36, 24, 16]} />
        <meshBasicMaterial color={col(t, 'stage-brass')} toneMapped={false} />
      </mesh>
      <mesh ref={moon} userData={{ noPenPlot: true }}>
        <sphereGeometry args={[0.3, 24, 16]} />
        <meshBasicMaterial color={col(t, 'stage-glass')} toneMapped={false} />
      </mesh>
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

const LAYER_HALF_KM: Record<string, number> = { E: 10, F1: 15, F2: 35, F: 35 }
const LABEL_D = 2250

/** "2 HOPS F2", "DIRECT WAVE", "SKIP ZONE" ... (the full text is in the side view and the readouts). */
function shortMode(r: Reception): string {
  if (r.mode === 'sky') return `${r.hops} HOP${r.hops > 1 ? 'S' : ''} ${r.layer}`
  if (r.mode === 'direct') return 'DIRECT WAVE'
  if (r.mode === 'ground') return 'GROUND WAVE'
  return modeText(r).split(':')[0].toUpperCase()
}

export function HfHero({ t, engine }: { t: ThemeTokens; engine: HfEngine }) {
  const lineColor = useMemo(() => col(t, 'stage-line'), [t])
  const layer = (k: 'E' | 'F1' | 'top') => (): LayerRead => {
    const io = engine.iono()
    const L = k === 'top' ? io.layers[io.layers.length - 1] : io.layers.find((x) => x.id === k)
    if (!L) return null
    const half = kmToNm(LAYER_HALF_KM[L.id])
    const strength = L.id === 'E' ? Math.min(1, L.foMHz / 3.8) : 1
    return { h0: kmToNm(L.heightKm) - half, h1: kmToNm(L.heightKm) + half, alpha: 0.05 + 0.13 * strength }
  }
  return (
    <group>
      <StudioFloor t={t} y={-6.9} shadowScale={36} />
      <EarthSlice t={t} />
      <Coverage t={t} engine={engine} />
      {/* D layer: absorbs by day, red when a solar flare makes it absorb almost everything */}
      <LayerShell
        t={t}
        neutral
        read={() => {
          const io = engine.iono()
          const k = Math.min(1, io.dAbsorptionDb / 1.5)
          return { h0: kmToNm(D_LAYER_KM.bottom), h1: kmToNm(D_LAYER_KM.top), alpha: 0.02 + 0.12 * k, alert: io.flare }
        }}
      />
      <LayerShell t={t} read={layer('E')} />
      <LayerShell t={t} read={layer('F1')} />
      <LayerShell t={t} read={layer('top')} />
      <RayFan t={t} engine={engine} />
      <PathTubes t={t} engine={engine} />
      <PenPlot color={lineColor}>
        <Station t={t} />
      </PenPlot>
      {(['CNS101', 'CNS202', 'CNS303'] as const).map((id) => (
        <group key={id}>
          <Plane t={t} engine={engine} id={id} />
          <Chime t={t} engine={engine} id={id} />
        </group>
      ))}
      <SkyClock t={t} engine={engine} />

      {/* Labels */}
      <Callout3D position={at(0, 60)} tone="signal" lead={20}>
        HF GROUND STATION
      </Callout3D>
      <LiveCallout
        tone="signal"
        side="left"
        read={() => {
          const r = engine.reception()
          const storm = engine.failures.storm ? ' · STATIC' : ''
          const p = at(engine.params.distanceNm, CRUISE_NM + 45)
          return { pos: p, text: `CNS101 (YOU) · ${shortMode(r)} · ${QUALITY_TEXT[hfQuality(r)].toUpperCase()}${storm}` }
        }}
        lead={14}
      />
      {(['CNS202', 'CNS303'] as const).map((id) => (
        <LiveCallout
          key={id}
          read={() => {
            const d = engine.distanceOf(id)
            const r = engine.results[id]
            const chime = r?.rang && engine.timeS - r.atS < 4 ? ' · SELCAL CHIME' : ''
            return { pos: at(d, CRUISE_NM + 12), text: `${id} · ${nmText(d)}${chime}` }
          }}
          lead={10}
        />
      ))}
      <LiveCallout
        tone="brass"
        read={() => {
          const s = engine.skipZone()
          if (!s) return null
          const mid = s.fromNm + (s.toNm - s.fromNm) * 0.5
          return { pos: at(mid, 1), text: `SKIP ZONE · ${Math.round(s.fromNm)}–${Math.round(s.toNm).toLocaleString('en-US')} NM` }
        }}
        lead={16}
      />
      {/* Layer names at the far end, clear of the station's crowded rays */}
      <LiveCallout
        side="left"
        read={() => {
          const io = engine.iono()
          return { pos: at(LABEL_D, kmToNm((D_LAYER_KM.bottom + D_LAYER_KM.top) / 2)), text: io.flare ? 'D · SOLAR FLARE: ABSORBS' : io.day ? 'D · ABSORBS BY DAY' : 'D · ALMOST GONE AT NIGHT' }
        }}
        lead={10}
      />
      {(['E', 'F1', 'top'] as const).map((k) => (
        <LiveCallout
          key={k}
          side={k === 'F1' ? 'left' : 'right'}
          read={() => {
            const io = engine.iono()
            const L = k === 'top' ? io.layers[io.layers.length - 1] : io.layers.find((x) => x.id === k)
            if (!L) return null
            return { pos: at(LABEL_D, kmToNm(L.heightKm)), text: `${L.id} · ${Math.round(L.heightKm)} KM` }
          }}
          lead={10}
        />
      ))}
      <LiveCallout
        tone="brass"
        read={() => {
          const h = engine.params.hour
          const day = solarCosZenith(h) > 0
          const p = skyPos(h, !day)
          return { pos: [p[0] + 0.5, p[1], p[2]], text: `${formatHour(h)} LOCAL · ${day ? 'DAY' : 'NIGHT'}` }
        }}
        lead={12}
      />
    </group>
  )
}

export default HfHero
