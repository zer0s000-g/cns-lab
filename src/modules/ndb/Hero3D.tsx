/**
 * The NDB / ADF hero: the beacon's two masts and T-aerial on the 60 NM
 * terrain table, the aircraft, and two lines from the aircraft: where the
 * ADF needle points (solid, cyan) and where the beacon really is (dashed).
 * Every pose and every line is read from the unchanged NdbEngine each frame,
 * so the table always agrees with the map and the instruments.
 *
 * Scale: table 60 NM in radius, heights exaggerated (HEIGHT_EXAGGERATION),
 * masts and aircraft larger than life, ground waves drawn slowed down, the
 * sky-wave hop not to scale. The page labels all of it.
 */

import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { bearingToThreeRotationY, destinationPoint, distanceNm, normalize180 } from '@/core/geometry'
import { skyWaveRatio } from '@/core/ndb'
import { DEFAULT_TERRAIN, isWater, terrainElevationFt } from '@/core/world'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { fmt3 } from '@/instruments/draw'
import { Callout3D } from '@/stage/Callout3D'
import { AircraftModel, DioramaTable, FLOOR_Y, S, TABLE_RADIUS_U, V, makeTerrainMaterial, toU, useTerrain } from '@/stage/Diorama'
import { PenPlot } from '@/stage/PenPlot'
import { StudioFloor, col } from '@/stage/Stage'
import type { NdbEngine } from './engine'
import { Wire3D, type WireHandle } from '@/stage/Wire3D'

/** Mast miniature: height above the ground and spacing between the two masts, scene units. */
export const MAST_H = 0.95
const MAST_GAP = 0.9
/** Where the T-aerial's down-lead meets the top wire (the needle lines aim here). */
const AERIAL_Y = MAST_H - 0.04
/** Ground waves on the table: one ring every WAVE_SPACING_NM, drawn slowed down. */
const WAVE_SPACING_NM = 12
/** Sky-wave hop drawn with this arch height (the real layer is ~100 km up: not to scale). */
const SKY_PEAK_U = 2.6

const groundU = (p: { x: number; y: number }) => (isWater(p) ? 0 : terrainElevationFt(p) * V)

// ---------------------------------------------------------------------------
// The beacon: two lattice masts, a T-aerial, tuning hut and counterpoise
// ---------------------------------------------------------------------------

function Mast({ t, x }: { t: ThemeTokens; x: number }) {
  const paint = col(t, 'stage-paint')
  const dark = col(t, 'stage-metal-dark')
  const bays = 6
  return (
    <group position={[x, 0, 0]}>
      <mesh position={[0, 0.02, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.1, 0.04, 0.1]} />
        <meshStandardMaterial color={col(t, 'stage-metal')} roughness={0.9} />
      </mesh>
      {/* Three legs of a slim triangular lattice, tapering to the top. */}
      {[0, 1, 2].map((k) => {
        const a = (k / 3) * Math.PI * 2
        const r0 = 0.028
        const r1 = 0.012
        const b = new THREE.Vector3(Math.cos(a) * r0, 0.04, Math.sin(a) * r0)
        const top = new THREE.Vector3(Math.cos(a) * r1, MAST_H, Math.sin(a) * r1)
        const mid = b.clone().add(top).multiplyScalar(0.5)
        const dir = top.clone().sub(b)
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize())
        return (
          <mesh key={k} position={mid} quaternion={q} castShadow>
            <cylinderGeometry args={[0.0035, 0.0035, dir.length(), 4]} />
            <meshStandardMaterial color={paint} roughness={0.45} metalness={0.55} />
          </mesh>
        )
      })}
      {Array.from({ length: bays }, (_, i) => {
        const f = (i + 1) / (bays + 1)
        const y = 0.04 + (MAST_H - 0.04) * f
        const r = 0.028 + (0.012 - 0.028) * f
        return (
          <mesh key={i} position={[0, y, 0]} rotation-x={Math.PI / 2}>
            <torusGeometry args={[r, 0.0025, 3, 3]} />
            <meshStandardMaterial color={paint} roughness={0.45} metalness={0.55} />
          </mesh>
        )
      })}
      {/* Insulator cap where the aerial wire hangs. */}
      <mesh position={[0, MAST_H + 0.01, 0]}>
        <cylinderGeometry args={[0.014, 0.018, 0.03, 10]} />
        <meshStandardMaterial color={dark} roughness={0.4} metalness={0.7} />
      </mesh>
    </group>
  )
}

/** Thin straight members (wires, guys, radials) as one line object. */
function useSegments(pairs: [THREE.Vector3, THREE.Vector3][]) {
  const geo = useMemo(() => {
    const pos: number[] = []
    for (const [a, b] of pairs) pos.push(a.x, a.y, a.z, b.x, b.y, b.z)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    return g
    // The pairs come from constants, so they are built once.
  }, [])
  useLayoutEffect(() => () => geo.dispose(), [geo])
  return geo
}

function Beacon({ t, engine }: { t: ThemeTokens; engine: NdbEngine }) {
  const st = engine.station
  const [bx, , bz] = toU(st.pos)
  const base: [number, number, number] = [bx, groundU(st.pos), bz]
  const half = MAST_GAP / 2
  // Guy wires from two heights on each mast to three anchors around it.
  const guys = useSegments(
    [-half, half].flatMap((x) =>
      [0.45, 0.8].flatMap((h) =>
        [0, 1, 2].map((k) => {
          const a = (k / 3) * Math.PI * 2 + (x > 0 ? 0.5 : -0.5)
          const r = 0.34 * (h + 0.25)
          return [new THREE.Vector3(x, MAST_H * h, 0), new THREE.Vector3(x + Math.cos(a) * r, 0.01, Math.sin(a) * r)] as [THREE.Vector3, THREE.Vector3]
        }),
      ),
    ),
  )
  // Counterpoise: buried radial wires fanning out from the aerial feed.
  const radials = useSegments(
    Array.from({ length: 24 }, (_, k) => {
      const a = (k / 24) * Math.PI * 2
      return [new THREE.Vector3(0, 0.006, 0.12), new THREE.Vector3(Math.cos(a) * 0.62, 0.006, 0.12 + Math.sin(a) * 0.62)] as [THREE.Vector3, THREE.Vector3]
    }),
  )
  // T-aerial: the top wire between the masts, its down-lead to the tuning hut.
  const aerial = useSegments([
    [new THREE.Vector3(-half, MAST_H, 0), new THREE.Vector3(half, MAST_H, 0)],
    [new THREE.Vector3(-half, MAST_H - 0.012, 0), new THREE.Vector3(half, MAST_H - 0.012, 0)],
    [new THREE.Vector3(0, MAST_H - 0.006, 0), new THREE.Vector3(0, 0.2, 0.12)],
  ])
  const lineMat = useMemo(() => new THREE.LineBasicMaterial({ color: col(t, 'stage-line'), transparent: true, opacity: 0.45 }), [t])
  const aerialMat = useMemo(() => new THREE.LineBasicMaterial({ color: col(t, 'stage-brass'), toneMapped: false }), [t])
  const radialMat = useMemo(() => new THREE.LineBasicMaterial({ color: col(t, 'stage-brass'), transparent: true, opacity: 0.35 }), [t])
  useLayoutEffect(
    () => () => {
      lineMat.dispose()
      aerialMat.dispose()
      radialMat.dispose()
    },
    [lineMat, aerialMat, radialMat],
  )
  const paint = col(t, 'stage-paint')
  // The masts stand on a 060°/240° line (local +x points to 060°), broadside to the close-up shots.
  return (
    <group position={base} rotation-y={bearingToThreeRotationY(-30)}>
      <PenPlot color={col(t, 'stage-line')}>
        <Mast t={t} x={-half} />
        <Mast t={t} x={half} />
        {/* Tuning hut with the transmitter */}
        <mesh position={[0, 0.07, 0.2]} castShadow receiveShadow>
          <boxGeometry args={[0.2, 0.14, 0.14]} />
          <meshPhysicalMaterial color={paint} roughness={0.4} metalness={0.15} clearcoat={0.5} />
        </mesh>
        <mesh position={[0, 0.145, 0.2]}>
          <boxGeometry args={[0.23, 0.012, 0.17]} />
          <meshStandardMaterial color={col(t, 'stage-metal-dark')} roughness={0.5} metalness={0.6} />
        </mesh>
      </PenPlot>
      <lineSegments geometry={guys} material={lineMat} />
      <lineSegments geometry={radials} material={radialMat} />
      <lineSegments geometry={aerial} material={aerialMat} />
    </group>
  )
}

// ---------------------------------------------------------------------------
// Ground waves and the rated coverage ring, draped over the terrain
// ---------------------------------------------------------------------------

function GroundWaves({ t, engine, terrain }: { t: ThemeTokens; engine: NdbEngine; terrain: THREE.BufferGeometry }) {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        uniforms: {
          uCenter: { value: new THREE.Vector2() },
          uPhase: { value: 0 },
          uSpacing: { value: WAVE_SPACING_NM * S },
          uCov: { value: 60 * S },
          uRadius: { value: TABLE_RADIUS_U },
          uSignal: { value: col(t, 'stage-signal') },
          uLine: { value: col(t, 'stage-line') },
        },
        vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: `varying vec3 vW;
          uniform vec2 uCenter; uniform float uPhase; uniform float uSpacing; uniform float uCov; uniform float uRadius;
          uniform vec3 uSignal; uniform vec3 uLine;
          void main(){
            vec2 d2 = vW.xz - uCenter;
            float d = length(d2);
            // Distance behind the nearest wavefront (the fronts move outward).
            float behind = uSpacing - mod(d - uPhase, uSpacing);
            float front = exp(-behind / (uSpacing * 0.12)) * smoothstep(0.0, uSpacing * 0.02, uSpacing - behind);
            // The same fade as the map: gone by 1.7 x the rated coverage.
            float fade = 0.4 * max(0.0, 1.0 - d / (uCov * 1.7));
            float rim = 1.0 - smoothstep(uRadius * 0.97, uRadius, length(vW.xz));
            float w = front * fade * rim;
            // Rated coverage: a dashed ring.
            float dash = step(0.5, fract(atan(d2.y, d2.x) * uCov / 0.22));
            float cov = (1.0 - smoothstep(0.0, 0.035, abs(d - uCov))) * dash * rim * 0.55;
            vec3 c = uSignal * w + uLine * cov;
            gl_FragColor = vec4(c, max(w, cov));
          }`,
      }),
    [t],
  )
  useLayoutEffect(() => () => mat.dispose(), [mat])
  useFrame(() => {
    const [x, , z] = toU(engine.station.pos)
    mat.uniforms.uCenter.value.set(x, z)
    // Same motion rule as the map (a fixed number of spacings every 1.6 s of world time).
    mat.uniforms.uPhase.value = ((((engine.timeS * WAVE_SPACING_NM) / 1.6) % WAVE_SPACING_NM) * S)
    mat.uniforms.uCov.value = engine.station.ratedCoverageNm * S
  })
  return <mesh geometry={terrain} material={mat} userData={{ noPenPlot: true }} renderOrder={1} />
}

// ---------------------------------------------------------------------------
// The aircraft, its track, and the two bearing lines
// ---------------------------------------------------------------------------

function Aircraft({ t, engine }: { t: ThemeTokens; engine: NdbEngine }) {
  const g = useRef<THREE.Group>(null)
  const drop = useRef<THREE.Mesh>(null)
  const foot = useRef<THREE.Mesh>(null)
  const label = useRef<THREE.Group>(null)
  const text = useRef<HTMLSpanElement>(null)
  useFrame(() => {
    const a = engine.aircraft
    const [x, y, z] = toU(a.pos, a.altitudeFt)
    g.current?.position.set(x, y, z)
    if (g.current) g.current.rotation.y = bearingToThreeRotationY(a.headingDeg)
    const ground = groundU(a.pos)
    if (drop.current) {
      const h = Math.max(0.001, y - ground)
      drop.current.scale.set(1, h, 1)
      drop.current.position.set(x, ground + h / 2, z)
    }
    foot.current?.position.set(x, ground + 0.01, z)
    label.current?.position.set(x, y + 0.2, z)
    if (text.current) {
      const s = `${a.callsign} · ${Math.round(a.altitudeFt / 100) * 100} FT · HDG ${fmt3(a.headingDeg)}°T`
      if (text.current.textContent !== s) text.current.textContent = s
    }
  })
  return (
    <>
      <group ref={g}>
        <AircraftModel t={t} />
      </group>
      <mesh ref={drop} userData={{ noPenPlot: true }}>
        <cylinderGeometry args={[0.006, 0.006, 1, 4]} />
        <meshBasicMaterial color={col(t, 'stage-line')} transparent opacity={0.35} />
      </mesh>
      <mesh ref={foot} rotation-x={-Math.PI / 2} userData={{ noPenPlot: true }}>
        <ringGeometry args={[0.07, 0.09, 32]} />
        <meshBasicMaterial color={col(t, 'stage-line')} transparent opacity={0.5} />
      </mesh>
      <group ref={label}>
        <Callout3D position={[0, 0, 0]} lead={18}>
          <span ref={text}>{engine.aircraft.callsign}</span>
        </Callout3D>
      </group>
    </>
  )
}

/** The recent track (engine.trail, one dot every 2 s of world time). */
function Trail({ t, engine }: { t: ThemeTokens; engine: NdbEngine }) {
  const MAX = 240
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX * 3), 3))
    g.setDrawRange(0, 0)
    return g
  }, [])
  const mat = useMemo(() => new THREE.PointsMaterial({ color: col(t, 'stage-line'), size: 0.035, transparent: true, opacity: 0.55, depthWrite: false }), [t])
  useLayoutEffect(
    () => () => {
      geo.dispose()
      mat.dispose()
    },
    [geo, mat],
  )
  const lastLen = useRef(-1)
  const lastHead = useRef<unknown>(null)
  useFrame(() => {
    const tr = engine.trail
    if (tr.length === lastLen.current && tr[0] === lastHead.current) return
    lastLen.current = tr.length
    lastHead.current = tr[0]
    const attr = geo.getAttribute('position') as THREE.BufferAttribute
    const n = Math.min(MAX, tr.length)
    for (let i = 0; i < n; i++) {
      const [x, , z] = toU(tr[i])
      attr.setXYZ(i, x, groundU(tr[i]) + 0.012, z)
    }
    attr.needsUpdate = true
    geo.setDrawRange(0, n)
    geo.computeBoundingSphere()
  })
  return <points geometry={geo} material={mat} userData={{ noPenPlot: true }} />
}

function BearingLines({ t, engine }: { t: ThemeTokens; engine: NdbEngine }) {
  const needle = useRef<WireHandle>(null)
  const truth = useRef<WireHandle>(null)
  const head = useRef<THREE.Mesh>(null)
  const tag = useRef<THREE.Group>(null)
  const tagText = useRef<HTMLSpanElement>(null)
  const signal = useMemo(() => col(t, 'stage-signal'), [t])
  const line = useMemo(() => col(t, 'stage-line'), [t])
  const A = useMemo(() => new THREE.Vector3(), [])
  const B = useMemo(() => new THREE.Vector3(), [])
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), [])
  useFrame(() => {
    const a = engine.aircraft
    const st = engine.station
    const ind = engine.last
    const aerialY = groundU(st.pos) + AERIAL_Y
    A.set(...toU(a.pos, a.altitudeFt))
    // Where the beacon really is: aircraft to the aerial (dashed).
    B.set(toU(st.pos)[0], aerialY, toU(st.pos)[2])
    truth.current?.set(A, B)
    truth.current?.setVisible(true)
    const dist = distanceNm(a.pos, st.pos)
    // Where the needle points: the same length along the indicated bearing (like the map).
    const on = ind.bearingTrue != null
    needle.current?.setVisible(on)
    if (head.current) head.current.visible = on
    let s: string
    if (on) {
      const end = destinationPoint(a.pos, ind.bearingTrue!, Math.max(dist, 0.5))
      const [ex, , ez] = toU(end)
      B.set(ex, aerialY, ez)
      needle.current?.set(A, B)
      if (head.current) {
        head.current.position.copy(B)
        const dir = B.clone().sub(A).normalize()
        head.current.quaternion.setFromUnitVectors(up, dir)
      }
      const err = ind.ambiguous ? 180 : normalize180(ind.errors.total)
      const e = Math.abs(err)
      const errText = e < 0.5 ? 'ON THE BEACON' : `ERROR ${err < 0 ? '−' : '+'}${e.toFixed(e < 10 ? 1 : 0)}°`
      s = `ADF NEEDLE ${fmt3(ind.bearingTrue!)}°T · TRUE ${fmt3(ind.truth.bearingTrue)}°T · ${errText}`
    } else {
      s = 'NO USABLE SIGNAL · NEEDLE PARKED'
    }
    // The tag sits halfway along the needle line.
    const k = Math.min(0.5, 20 / Math.max(dist, 1e-3))
    const [tx, , tz] = toU(destinationPoint(a.pos, ind.bearingTrue ?? ind.truth.bearingTrue, dist * k))
    tag.current?.position.set(tx, A.y + (aerialY - A.y) * k + 0.05, tz)
    if (tagText.current && tagText.current.textContent !== s) tagText.current.textContent = s
  })
  return (
    <>
      <Wire3D ref={truth} color={line} radius={0.007} dash={0.12} opacity={0.75} />
      <Wire3D ref={needle} color={signal} radius={0.016} opacity={0.95} />
      <mesh ref={head} visible={false} userData={{ noPenPlot: true }}>
        <coneGeometry args={[0.05, 0.16, 12]} />
        <meshBasicMaterial color={signal} toneMapped={false} />
      </mesh>
      <group ref={tag}>
        <Callout3D position={[0, 0, 0]} tone="signal" lead={14}>
          <span ref={tagText}>ADF NEEDLE</span>
        </Callout3D>
      </group>
    </>
  )
}

// ---------------------------------------------------------------------------
// What pulls the needle: sky wave, lightning, the coast, the mountains
// ---------------------------------------------------------------------------

function SkyWave({ t, engine }: { t: ThemeTokens; engine: NdbEngine }) {
  const wire = useRef<WireHandle>(null)
  const brass = useMemo(() => col(t, 'stage-brass'), [t])
  const tag = useRef<THREE.Group>(null)
  const tagRoot = useRef<HTMLDivElement>(null)
  useFrame(() => {
    const a = engine.aircraft
    const st = engine.station
    const ratio = skyWaveRatio(engine.last.truth.distanceNm, engine.env.hour)
    const on = ratio > 0.02
    wire.current?.setVisible(on)
    if (tagRoot.current) tagRoot.current.style.display = on ? '' : 'none'
    if (!on) return
    const [sx, , sz] = toU(st.pos)
    const A: [number, number, number] = [sx, groundU(st.pos) + AERIAL_Y, sz]
    const B = toU(a.pos, a.altitudeFt)
    wire.current?.set(A, B, SKY_PEAK_U)
    wire.current?.setOpacity(0.35 + ratio * 0.9)
    tag.current?.position.set((A[0] + B[0]) / 2, (A[1] + B[1]) / 2 + SKY_PEAK_U, (A[2] + B[2]) / 2)
  })
  return (
    <>
      <Wire3D ref={wire} color={brass} radius={0.012} dash={0.09} />
      <group ref={tag}>
        <Callout3D position={[0, 0, 0]} tone="brass" lead={14} rootRef={tagRoot}>
          SKY WAVE · BOUNCED OFF THE IONOSPHERE
        </Callout3D>
      </group>
    </>
  )
}

const FLASH_POOL = 6
const FLASH_SHOW_S = 0.35

function Storm({ t, engine }: { t: ThemeTokens; engine: NdbEngine }) {
  const grp = useRef<THREE.Group>(null)
  const bolts = useRef<THREE.Group[]>([])
  const pulls = useRef<(WireHandle | null)[]>([])
  const tagRoot = useRef<HTMLDivElement>(null)
  const brass = useMemo(() => col(t, 'stage-brass'), [t])
  const cloudMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: col(t, 'stage-paint'), transparent: true, opacity: 0.22, roughness: 1, depthWrite: false }),
    [t],
  )
  const boltMat = useMemo(() => new THREE.LineBasicMaterial({ color: brass, toneMapped: false }), [brass])
  useLayoutEffect(
    () => () => {
      cloudMat.dispose()
      boltMat.dispose()
    },
    [cloudMat, boltMat],
  )
  const CLOUD_Y = 0.95
  // A zig-zag bolt from the cloud base to the ground (local, 1 unit tall).
  const boltGeo = useMemo(() => {
    const pts = [
      [0, 1],
      [0.05, 0.78],
      [-0.03, 0.62],
      [0.06, 0.4],
      [-0.02, 0.22],
      [0.03, 0],
    ]
    const pos: number[] = []
    for (let i = 0; i < pts.length - 1; i++) pos.push(pts[i][0], pts[i][1], 0, pts[i + 1][0], pts[i + 1][1], 0)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    return g
  }, [])
  useLayoutEffect(() => () => boltGeo.dispose(), [boltGeo])
  // Puffs of the cloud, fixed offsets inside the storm cell.
  const puffs = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const a = i * 2.4
        const r = i === 0 ? 0 : 0.55 + (i % 3) * 0.15
        return { x: Math.cos(a) * r, z: Math.sin(a) * r, y: (i % 2) * 0.12, s: 0.5 - (i % 3) * 0.08 }
      }),
    [],
  )
  useFrame(() => {
    const on = engine.env.storm
    if (grp.current) grp.current.visible = on
    if (tagRoot.current) tagRoot.current.style.display = on ? '' : 'none'
    if (!on || !grp.current) {
      pulls.current.forEach((p) => p?.setVisible(false))
      return
    }
    const [cx, , cz] = toU(engine.storm.center)
    grp.current.position.set(cx, 0, cz)
    grp.current.scale.setScalar(Math.max(0.3, (engine.storm.radiusNm * S) / 0.83))
    const recent = engine.flashes.filter((f) => {
      const age = engine.timeS - f.timeS
      return age >= 0 && age <= FLASH_SHOW_S
    })
    const ac = toU(engine.aircraft.pos, engine.aircraft.altitudeFt)
    for (let i = 0; i < FLASH_POOL; i++) {
      const b = bolts.current[i]
      const f = recent[i]
      const pull = pulls.current[i]
      if (b) b.visible = Boolean(f)
      pull?.setVisible(Boolean(f))
      if (!f) continue
      const [fx, , fz] = toU(f.pos)
      const gy = groundU(f.pos)
      const s = grp.current.scale.x
      if (b) {
        // Bolts live in the storm group's space.
        b.position.set((fx - cx) / s, gy / s, (fz - cz) / s)
        b.scale.set(1, (CLOUD_Y - gy) / s, 1)
      }
      pull?.set([fx, CLOUD_Y * 0.6, fz], ac)
    }
  })
  return (
    <>
      <group ref={grp} visible={false}>
        {puffs.map((p, i) => (
          <mesh key={i} position={[p.x, CLOUD_Y + p.y + p.s * 0.3, p.z]} scale={[1, 0.55, 1]} material={cloudMat} userData={{ noPenPlot: true }}>
            <sphereGeometry args={[p.s, 16, 10]} />
          </mesh>
        ))}
        {Array.from({ length: FLASH_POOL }, (_, i) => (
          <group key={i} ref={(el) => void (el && (bolts.current[i] = el))} visible={false}>
            <lineSegments geometry={boltGeo} material={boltMat} />
            <lineSegments geometry={boltGeo} material={boltMat} rotation-y={Math.PI / 2} />
          </group>
        ))}
        <Callout3D position={[0.5, CLOUD_Y + 0.75, 0]} tone="brass" lead={12} rootRef={tagRoot}>
          THUNDERSTORM
        </Callout3D>
      </group>
      {Array.from({ length: FLASH_POOL }, (_, i) => (
        <Wire3D key={i} ref={(el) => void (pulls.current[i] = el)} color={brass} radius={0.006} dash={0.06} opacity={0.8} />
      ))}
    </>
  )
}

function CoastCrossings({ t, engine }: { t: ThemeTokens; engine: NdbEngine }) {
  const POOL = 4
  const rings = useRef<THREE.Mesh[]>([])
  const tagRoot = useRef<HTMLDivElement>(null)
  const tag = useRef<THREE.Group>(null)
  const tagText = useRef<HTMLSpanElement>(null)
  useFrame(() => {
    const cs = engine.env.coastal ? engine.last.crossings : []
    for (let i = 0; i < POOL; i++) {
      const m = rings.current[i]
      const c = cs[i]
      if (!m) continue
      m.visible = Boolean(c)
      if (c) {
        const [x, , z] = toU(c.point)
        m.position.set(x, 0.02, z)
      }
    }
    if (tagRoot.current) tagRoot.current.style.display = cs.length ? '' : 'none'
    if (cs.length) {
      const [x, , z] = toU(cs[0].point)
      tag.current?.position.set(x, 0.06, z)
      const s = `SIGNAL CROSSES THE COAST AT ${cs[0].angleDeg.toFixed(0)}°`
      if (tagText.current && tagText.current.textContent !== s) tagText.current.textContent = s
    }
  })
  return (
    <>
      {Array.from({ length: POOL }, (_, i) => (
        <mesh key={i} ref={(el) => void (el && (rings.current[i] = el))} rotation-x={-Math.PI / 2} visible={false} userData={{ noPenPlot: true }}>
          <ringGeometry args={[0.1, 0.13, 32]} />
          <meshBasicMaterial color={col(t, 'stage-brass')} toneMapped={false} transparent opacity={0.9} />
        </mesh>
      ))}
      <group ref={tag}>
        <Callout3D position={[0, 0, 0]} tone="brass" lead={14} rootRef={tagRoot}>
          <span ref={tagText}>COAST</span>
        </Callout3D>
      </group>
    </>
  )
}

function MountainReflections({ t, engine }: { t: ThemeTokens; engine: NdbEngine }) {
  const POOL = DEFAULT_TERRAIN.hills.length
  const legs = useRef<(WireHandle | null)[]>([])
  const brass = useMemo(() => col(t, 'stage-brass'), [t])
  useFrame(() => {
    const on = engine.env.mountain
    const rs = on ? engine.last.reflectors.filter((r) => r.ratio >= 0.02) : []
    const st = engine.station
    const [sx, , sz] = toU(st.pos)
    const S0: [number, number, number] = [sx, groundU(st.pos) + AERIAL_Y, sz]
    const ac = toU(engine.aircraft.pos, engine.aircraft.altitudeFt)
    for (let i = 0; i < POOL; i++) {
      const r = rs[i]
      const inLeg = legs.current[i * 2]
      const outLeg = legs.current[i * 2 + 1]
      inLeg?.setVisible(Boolean(r))
      outLeg?.setVisible(Boolean(r))
      if (!r) continue
      const [hx, , hz] = toU(r.hill.center)
      const H: [number, number, number] = [hx, terrainElevationFt(r.hill.center) * V + 0.02, hz]
      const o = Math.min(0.9, 0.3 + r.ratio * 4)
      inLeg?.set(S0, H)
      outLeg?.set(H, ac)
      inLeg?.setOpacity(o)
      outLeg?.setOpacity(o)
    }
  })
  return (
    <>
      {Array.from({ length: POOL * 2 }, (_, i) => (
        <Wire3D key={i} ref={(el) => void (legs.current[i] = el)} color={brass} radius={0.006} dash={0.07} />
      ))}
    </>
  )
}

// ---------------------------------------------------------------------------

export function NdbHero({ t, engine }: { t: ThemeTokens; engine: NdbEngine }) {
  const terrain = useTerrain(t)
  const { material } = useMemo(() => {
    const m = makeTerrainMaterial(t)
    // No sweeping radar here: switch the table's sweep afterglow off.
    m.uniforms.uGlow.value.setScalar(0)
    return m
  }, [t])
  useLayoutEffect(() => () => material.dispose(), [material])
  const [sx, , sz] = toU(engine.station.pos)
  const sy = groundU(engine.station.pos)
  const beaconTag = useRef<HTMLSpanElement>(null)
  useFrame(() => {
    const s = `${engine.station.ident} NDB · ${engine.station.freqKhz} kHz`
    if (beaconTag.current && beaconTag.current.textContent !== s) beaconTag.current.textContent = s
  })
  return (
    <group>
      <StudioFloor t={t} y={FLOOR_Y} shadowScale={30} />
      <DioramaTable t={t} />
      <mesh geometry={terrain} material={material} receiveShadow userData={{ noPenPlot: true }} />
      <GroundWaves t={t} engine={engine} terrain={terrain} />
      <Beacon t={t} engine={engine} />
      <Trail t={t} engine={engine} />
      <Aircraft t={t} engine={engine} />
      <BearingLines t={t} engine={engine} />
      <SkyWave t={t} engine={engine} />
      <Storm t={t} engine={engine} />
      <CoastCrossings t={t} engine={engine} />
      <MountainReflections t={t} engine={engine} />
      <Callout3D position={[sx - 0.2, sy + MAST_H + 0.45, sz]} tone="signal" side="left" lead={20}>
        <span ref={beaconTag}>{engine.station.ident} NDB</span>
      </Callout3D>
    </group>
  )
}

export default NdbHero
