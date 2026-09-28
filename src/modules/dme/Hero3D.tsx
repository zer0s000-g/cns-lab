/**
 * The DME hero: the ground transponder beside the runway on the 60 NM
 * terrain table, CNS101 with the slant range (the straight line the DME
 * measures) and the ground distance under it, the other aircraft sharing the
 * station, and, while a slow-motion replay runs, the question and answer
 * pulse pairs travelling along the slant path. Every pose comes from the
 * unchanged DmeEngine each frame and every pulse from the same replay the
 * 2D pulse view draws; during the replay the world is frozen (the engine is
 * not stepped), so nothing on the table moves except the pulses.
 *
 * Scale: table 60 NM in radius, heights exaggerated (HEIGHT_EXAGGERATION),
 * station and aircraft larger than life, pulses drawn about their true
 * length along the path. The page labels all of it.
 */

import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { formatDmeChannel } from '@/core/dme'
import { bearingToThreeRotationY } from '@/core/geometry'
import { LIGHT_NM_PER_US } from '@/core/units'
import { isWater, terrainElevationFt, type Aircraft } from '@/core/world'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { Callout3D } from '@/stage/Callout3D'
import { AircraftModel, DioramaTable, FLOOR_Y, V, makeTerrainMaterial, toU, useTerrain } from '@/stage/Diorama'
import { PenPlot } from '@/stage/PenPlot'
import { StudioFloor, col } from '@/stage/Stage'
import { MAX_TRAFFIC, STATION, type DmeEngine } from './engine'
import { PULSE_US, type DmeReplay } from './replay'
import { Wire3D, type WireHandle } from '@/stage/Wire3D'

/** Height of the miniature antenna's radome centre above the ground, scene units. */
const ANT_Y = 0.36

const groundU = (p: { x: number; y: number }) => (isWater(p) ? 0 : terrainElevationFt(p) * V)
const STATION_U: [number, number, number] = [toU(STATION.pos)[0], groundU(STATION.pos), toU(STATION.pos)[2]]
/** Where the slant line and the pulses meet the station: the miniature antenna. */
const ANTENNA = new THREE.Vector3(STATION_U[0], STATION_U[1] + ANT_Y, STATION_U[2])

// ---------------------------------------------------------------------------
// The ground transponder: equipment shelter, mast and antenna radome
// ---------------------------------------------------------------------------

function Transponder({ t }: { t: ThemeTokens }) {
  const paint = col(t, 'stage-paint')
  const dark = col(t, 'stage-metal-dark')
  return (
    <group position={STATION_U}>
      <PenPlot color={col(t, 'stage-line')}>
        <mesh position={[0, 0.02, 0]} receiveShadow>
          <boxGeometry args={[0.42, 0.04, 0.34]} />
          <meshStandardMaterial color={col(t, 'stage-metal')} roughness={0.95} />
        </mesh>
        {/* Equipment shelter with the transponder inside */}
        <mesh position={[0.1, 0.12, 0.06]} castShadow>
          <boxGeometry args={[0.18, 0.16, 0.16]} />
          <meshPhysicalMaterial color={paint} roughness={0.4} metalness={0.15} clearcoat={0.5} />
        </mesh>
        <mesh position={[0.1, 0.205, 0.06]}>
          <boxGeometry args={[0.21, 0.012, 0.19]} />
          <meshStandardMaterial color={dark} roughness={0.5} metalness={0.6} />
        </mesh>
        {/* Mast and the vertical antenna array in its radome */}
        <mesh position={[-0.08, 0.15, -0.02]} castShadow>
          <cylinderGeometry args={[0.012, 0.016, 0.3, 8]} />
          <meshStandardMaterial color={dark} roughness={0.4} metalness={0.8} />
        </mesh>
        <mesh position={[-0.08, ANT_Y, -0.02]} castShadow>
          <cylinderGeometry args={[0.03, 0.03, 0.14, 16]} />
          <meshPhysicalMaterial color={paint} roughness={0.3} metalness={0.1} clearcoat={0.7} />
        </mesh>
        <mesh position={[-0.08, ANT_Y + 0.075, -0.02]}>
          <sphereGeometry args={[0.03, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshPhysicalMaterial color={paint} roughness={0.3} metalness={0.1} clearcoat={0.7} />
        </mesh>
      </PenPlot>
    </group>
  )
}

// ---------------------------------------------------------------------------
// CNS101, its in-step twin, and the other aircraft sharing the station
// ---------------------------------------------------------------------------

function useDropLine(t: ThemeTokens) {
  const drop = useRef<THREE.Mesh>(null)
  const foot = useRef<THREE.Mesh>(null)
  const place = (a: Aircraft) => {
    const [x, y, z] = toU(a.pos, a.altitudeFt)
    const ground = groundU(a.pos)
    if (drop.current) {
      const h = Math.max(0.001, y - ground)
      drop.current.scale.set(1, h, 1)
      drop.current.position.set(x, ground + h / 2, z)
    }
    foot.current?.position.set(x, ground + 0.01, z)
  }
  const nodes = (
    <>
      <mesh ref={drop} userData={{ noPenPlot: true }}>
        <cylinderGeometry args={[0.006, 0.006, 1, 4]} />
        <meshBasicMaterial color={col(t, 'stage-line')} transparent opacity={0.35} />
      </mesh>
      <mesh ref={foot} rotation-x={-Math.PI / 2} userData={{ noPenPlot: true }}>
        <ringGeometry args={[0.07, 0.09, 32]} />
        <meshBasicMaterial color={col(t, 'stage-line')} transparent opacity={0.5} />
      </mesh>
    </>
  )
  return { place, nodes }
}

function OwnAircraft({ t, engine }: { t: ThemeTokens; engine: DmeEngine }) {
  const g = useRef<THREE.Group>(null)
  const label = useRef<THREE.Group>(null)
  const text = useRef<HTMLSpanElement>(null)
  const { place, nodes } = useDropLine(t)
  useFrame(() => {
    const a = engine.own
    const [x, y, z] = toU(a.pos, a.altitudeFt)
    g.current?.position.set(x, y, z)
    if (g.current) g.current.rotation.y = bearingToThreeRotationY(a.headingDeg)
    place(a)
    label.current?.position.set(x, y + 0.2, z)
    if (text.current) {
      const r = engine.reading()
      const dme =
        r.distanceNm === null
          ? 'DME SEARCHING'
          : `DME ${r.distanceNm.toFixed(1)} NM${engine.lockedOnTwin ? ' (CNS202’S ANSWERS)' : r.status === 'MEMORY' ? ' (MEMORY)' : ''}`
      const s = `${a.callsign} · ${Math.round(a.altitudeFt / 100) * 100} FT · ${dme}`
      if (text.current.textContent !== s) text.current.textContent = s
    }
  })
  return (
    <>
      <group ref={g}>
        <AircraftModel t={t} />
      </group>
      {nodes}
      <group ref={label}>
        <Callout3D position={[0, 0, 0]} lead={18}>
          <span ref={text}>{engine.own.callsign}</span>
        </Callout3D>
      </group>
    </>
  )
}

/** CNS202, the aircraft asking in step with CNS101 when jitter is switched off. */
function Twin({ t, engine }: { t: ThemeTokens; engine: DmeEngine }) {
  const grp = useRef<THREE.Group>(null)
  const g = useRef<THREE.Group>(null)
  const tagRoot = useRef<HTMLDivElement>(null)
  const label = useRef<THREE.Group>(null)
  const { place, nodes } = useDropLine(t)
  useFrame(() => {
    const a = engine.twin
    if (grp.current) grp.current.visible = Boolean(a)
    if (tagRoot.current) tagRoot.current.style.display = a ? '' : 'none'
    if (!a) return
    const [x, y, z] = toU(a.pos, a.altitudeFt)
    g.current?.position.set(x, y, z)
    if (g.current) g.current.rotation.y = bearingToThreeRotationY(a.headingDeg)
    place(a)
    label.current?.position.set(x, y + 0.2, z)
  })
  return (
    <>
      <group ref={grp} visible={false}>
        <group ref={g}>
          <AircraftModel t={t} dim />
        </group>
        {nodes}
      </group>
      <group ref={label}>
        <Callout3D position={[0, 0, 0]} tone="brass" side="left" lead={18} rootRef={tagRoot}>
          CNS202 · ASKS IN STEP WITH CNS101
        </Callout3D>
      </group>
    </>
  )
}

/** Up to MAX_TRAFFIC other aircraft, instanced: bright when the station answers them, dim when it does not. */
function Traffic({ t, engine }: { t: ThemeTokens; engine: DmeEngine }) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const geo = useMemo(() => {
    // A small dart pointing along local -z (the nose).
    const g = new THREE.ConeGeometry(0.045, 0.18, 3)
    g.rotateX(-Math.PI / 2)
    return g
  }, [])
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.3 }), [])
  useLayoutEffect(
    () => () => {
      geo.dispose()
      mat.dispose()
    },
    [geo, mat],
  )
  const on = useMemo(() => col(t, 'stage-paint'), [t])
  const off = useMemo(() => col(t, 'stage-metal'), [t])
  const m = useMemo(() => new THREE.Matrix4(), [])
  const q = useMemo(() => new THREE.Quaternion(), [])
  const p = useMemo(() => new THREE.Vector3(), [])
  const one = useMemo(() => new THREE.Vector3(1, 1, 1), [])
  const small = useMemo(() => new THREE.Vector3(0.7, 0.7, 0.7), [])
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), [])
  // Give every instance a colour before the first frame, so the shader is built with instance colours.
  useLayoutEffect(() => {
    const im = mesh.current
    if (!im) return
    for (let i = 0; i < MAX_TRAFFIC; i++) im.setColorAt(i, off)
    if (im.instanceColor) im.instanceColor.needsUpdate = true
    mat.needsUpdate = true
  }, [off, mat])
  useFrame(() => {
    const im = mesh.current
    if (!im) return
    const list = engine.traffic
    im.count = list.length
    for (let i = 0; i < list.length; i++) {
      const a = list[i]
      p.set(...toU(a.pos, a.altitudeFt))
      q.setFromAxisAngle(up, bearingToThreeRotationY(a.headingDeg))
      const answered = engine.isAnswered(a.id)
      m.compose(p, q, answered ? one : small)
      im.setMatrixAt(i, m)
      im.setColorAt(i, answered ? on : off)
    }
    im.instanceMatrix.needsUpdate = true
    if (im.instanceColor) im.instanceColor.needsUpdate = true
  })
  return <instancedMesh ref={mesh} args={[geo, mat, MAX_TRAFFIC]} frustumCulled={false} userData={{ noPenPlot: true }} />
}

// ---------------------------------------------------------------------------
// Slant range (what the DME measures) and ground distance (what a map shows)
// ---------------------------------------------------------------------------

function RangeLines({ t, engine, replayRef }: { t: ThemeTokens; engine: DmeEngine; replayRef: React.MutableRefObject<DmeReplay | null> }) {
  const slant = useRef<WireHandle>(null)
  const ground = useRef<WireHandle>(null)
  const slantTag = useRef<THREE.Group>(null)
  const slantText = useRef<HTMLSpanElement>(null)
  const groundTag = useRef<THREE.Group>(null)
  const groundText = useRef<HTMLSpanElement>(null)
  const block = useRef<THREE.Group>(null)
  const blockRoot = useRef<HTMLDivElement>(null)
  const signal = useMemo(() => col(t, 'stage-signal'), [t])
  const line = useMemo(() => col(t, 'stage-line'), [t])
  const A = useMemo(() => new THREE.Vector3(), [])
  const F = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    const a = engine.own
    A.set(...toU(a.pos, a.altitudeFt))
    const heard = engine.heard
    slant.current?.set(A, ANTENNA)
    slant.current?.setVisible(true)
    // Dimmed while a replay runs, so the pulses travelling along it stand out.
    slant.current?.setOpacity(!heard || replayRef.current ? 0.3 : 0.95)
    // The ground distance, laid along the table from under the aircraft to the foot of the station.
    const [fx, , fz] = toU(a.pos)
    F.set(fx, groundU(a.pos) + 0.02, fz)
    ground.current?.set(F, [STATION_U[0], STATION_U[1] + 0.02, STATION_U[2]])
    ground.current?.setVisible(true)
    slantTag.current?.position.set((A.x + ANTENNA.x) / 2, (A.y + ANTENNA.y) / 2 + 0.05, (A.z + ANTENNA.z) / 2)
    groundTag.current?.position.set((F.x + STATION_U[0]) * 0.5, (F.y + STATION_U[1]) * 0.5, (F.z + STATION_U[2]) * 0.5)
    const s1 = `SLANT RANGE ${engine.ownSlantNm.toFixed(1)} NM · WHAT THE DME MEASURES`
    const s2 = `GROUND DISTANCE ${engine.ownGroundNm.toFixed(1)} NM`
    if (slantText.current && slantText.current.textContent !== s1) slantText.current.textContent = s1
    if (groundText.current && groundText.current.textContent !== s2) groundText.current.textContent = s2
    // Where a hill or the Earth's curve stops the questions.
    if (blockRoot.current) blockRoot.current.style.display = heard ? 'none' : ''
    if (block.current) {
      block.current.visible = !heard
      if (!heard) {
        const w = engine.los.worstPoint
        const [wx, , wz] = toU(w)
        block.current.position.set(wx, groundU(w) + 0.03, wz)
      }
    }
  })
  return (
    <>
      <Wire3D ref={ground} color={line} radius={0.007} dash={0.12} opacity={0.7} />
      <Wire3D ref={slant} color={signal} radius={0.015} opacity={0.95} />
      <group ref={slantTag}>
        <Callout3D position={[0, 0, 0]} tone="signal" lead={14}>
          <span ref={slantText}>SLANT RANGE</span>
        </Callout3D>
      </group>
      <group ref={groundTag}>
        <Callout3D position={[0, 0, 0]} side="left" lead={14}>
          <span ref={groundText}>GROUND DISTANCE</span>
        </Callout3D>
      </group>
      <group ref={block} visible={false}>
        <mesh rotation-x={-Math.PI / 2} userData={{ noPenPlot: true }}>
          <ringGeometry args={[0.1, 0.13, 32]} />
          <meshBasicMaterial color={col(t, 'stage-alert')} toneMapped={false} transparent opacity={0.9} />
        </mesh>
        <Callout3D position={[0, 0.05, 0]} tone="alert" lead={12} rootRef={blockRoot}>
          BLOCKED · THE STATION CANNOT HEAR CNS101
        </Callout3D>
      </group>
    </>
  )
}

// ---------------------------------------------------------------------------
// One question and answer in slow motion (the world is frozen meanwhile)
// ---------------------------------------------------------------------------

function ReplayPulses({ t, engine, replayRef }: { t: ThemeTokens; engine: DmeEngine; replayRef: React.MutableRefObject<DmeReplay | null> }) {
  const grp = useRef<THREE.Group>(null)
  const q = useRef<THREE.Mesh[]>([])
  const r = useRef<THREE.Mesh[]>([])
  const wait = useRef<THREE.Mesh>(null)
  const arrive = useRef<THREE.Mesh>(null)
  const arriveMat = useRef<THREE.MeshBasicMaterial>(null)
  const waitRoot = useRef<HTMLDivElement>(null)
  const waitText = useRef<HTMLSpanElement>(null)
  const signal = useMemo(() => col(t, 'stage-signal'), [t])
  const brass = useMemo(() => col(t, 'stage-brass'), [t])
  const muted = useMemo(() => col(t, 'stage-metal'), [t])
  // A pulse: a short glowing capsule along local +y, stretched to its length on the path.
  const pulseGeo = useMemo(() => new THREE.CapsuleGeometry(0.045, 1, 4, 12), [])
  const qMat = useMemo(() => new THREE.MeshBasicMaterial({ color: signal, toneMapped: false }), [signal])
  const rMat = useMemo(() => new THREE.MeshBasicMaterial({ color: brass, toneMapped: false }), [brass])
  // The station's fixed wait as a filling ring (the same clock face as the 2D view).
  const waitMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
        uniforms: { uFrac: { value: 0 }, uColor: { value: signal.clone() }, uTrack: { value: muted.clone() } },
        vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `varying vec2 vP; uniform float uFrac; uniform vec3 uColor; uniform vec3 uTrack;
          void main(){
            float a = mod(atan(vP.x, vP.y) + 6.2831853, 6.2831853) / 6.2831853;
            vec3 c = a <= uFrac ? uColor : uTrack;
            gl_FragColor = vec4(c, a <= uFrac ? 1.0 : 0.5);
          }`,
      }),
    [signal, muted],
  )
  useLayoutEffect(
    () => () => {
      pulseGeo.dispose()
      qMat.dispose()
      rMat.dispose()
      waitMat.dispose()
    },
    [pulseGeo, qMat, rMat, waitMat],
  )
  const A = useMemo(() => new THREE.Vector3(), [])
  const dir = useMemo(() => new THREE.Vector3(), [])
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), [])
  const quat = useMemo(() => new THREE.Quaternion(), [])
  useFrame(() => {
    const rp = replayRef.current
    const on = Boolean(rp)
    if (grp.current) grp.current.visible = on
    if (waitRoot.current) waitRoot.current.style.display = on ? '' : 'none'
    if (!rp) return
    // The path: from CNS101 (frozen) to the station antenna, L = the slant range.
    const a = engine.own
    A.set(...toU(a.pos, a.altitudeFt))
    dir.copy(ANTENNA).sub(A)
    const pathU = dir.length()
    dir.normalize()
    quat.setFromUnitVectors(up, dir)
    const L = Math.max(rp.slantNm, 0.1)
    const lenU = Math.max(0.03, ((PULSE_US * LIGHT_NM_PER_US) / L) * pathU)
    const at = (m: THREE.Mesh | undefined, dNm: number | null) => {
      if (!m) return
      m.visible = dNm !== null
      if (dNm === null) return
      m.position.copy(A).addScaledVector(dir, (dNm / L) * pathU)
      m.quaternion.copy(quat)
      m.scale.set(1, lenU, 1)
    }
    const tm = rp.timing
    const tNow = rp.tUs
    // Question pulses travelling to the station (stopped by a hill when blocked), exactly as in the 2D view.
    const limit = rp.blockNm ?? L
    for (let k = 0; k < 2; k++) {
      const d = LIGHT_NM_PER_US * (tNow - k * rp.code.interrogationSpacingUs)
      at(q.current[k], d >= 0 && d <= limit ? d : null)
    }
    // Answer pulses travelling back.
    const leave = tm.outboundUs + tm.delayUs
    for (let k = 0; k < 2; k++) {
      const d = L - LIGHT_NM_PER_US * (tNow - leave - k * rp.code.replySpacingUs)
      at(r.current[k], rp.replied && d >= 0 && d <= L && tNow >= leave + k * rp.code.replySpacingUs ? d : null)
    }
    // The station's wait.
    const waiting = rp.reason !== 'blocked' && tNow >= tm.outboundUs
    if (wait.current) wait.current.visible = waiting
    const waited = Math.min(Math.max(0, tNow - tm.outboundUs), tm.delayUs)
    waitMat.uniforms.uFrac.value = rp.reason === 'ignored' ? 0 : waited / tm.delayUs
    let s = ''
    if (rp.reason === 'blocked') s = tNow >= rp.totalUs ? 'NO ANSWER · BLOCKED' : 'QUESTION ON ITS WAY'
    else if (!waiting) s = 'QUESTION ON ITS WAY'
    else if (rp.reason === 'ignored') s = 'TOO BUSY · NO ANSWER'
    else if (waited < tm.delayUs) s = `STATION WAITS ${waited.toFixed(0)} OF ${tm.delayUs} µs`
    else s = tNow >= tm.totalUs ? `ANSWER BACK AFTER ${tm.totalUs.toFixed(1)} µs` : 'ANSWER ON ITS WAY'
    if (waitText.current && waitText.current.textContent !== s) waitText.current.textContent = s
    // The answer reaching CNS101.
    const back = rp.replied && tNow >= tm.totalUs
    if (arrive.current && arriveMat.current) {
      arrive.current.visible = back
      if (back) {
        const k = Math.min(1, (tNow - tm.totalUs) / 20)
        arrive.current.position.copy(A)
        arrive.current.scale.setScalar(0.4 + k * 0.8)
        arriveMat.current.opacity = 1 - k * 0.7
      }
    }
  })
  return (
    <group ref={grp} visible={false}>
      {[0, 1].map((k) => (
        <mesh key={`q${k}`} ref={(el) => void (el && (q.current[k] = el))} geometry={pulseGeo} material={qMat} visible={false} userData={{ noPenPlot: true }} />
      ))}
      {[0, 1].map((k) => (
        <mesh key={`r${k}`} ref={(el) => void (el && (r.current[k] = el))} geometry={pulseGeo} material={rMat} visible={false} userData={{ noPenPlot: true }} />
      ))}
      <mesh ref={wait} position={[ANTENNA.x, ANTENNA.y + 0.2, ANTENNA.z]} material={waitMat} userData={{ noPenPlot: true }}>
        <ringGeometry args={[0.07, 0.1, 48]} />
      </mesh>
      <mesh ref={arrive} rotation-x={-Math.PI / 2} visible={false} userData={{ noPenPlot: true }}>
        <ringGeometry args={[0.2, 0.25, 40]} />
        <meshBasicMaterial ref={arriveMat} color={brass} toneMapped={false} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <Callout3D position={[ANTENNA.x + 0.12, ANTENNA.y + 0.2, ANTENNA.z]} tone="brass" lead={14} rootRef={waitRoot}>
        <span ref={waitText}>QUESTION ON ITS WAY</span>
      </Callout3D>
    </group>
  )
}

// ---------------------------------------------------------------------------

export function DmeHero({ t, engine, replayRef }: { t: ThemeTokens; engine: DmeEngine; replayRef: React.MutableRefObject<DmeReplay | null> }) {
  const terrain = useTerrain(t)
  const { material } = useMemo(() => {
    const m = makeTerrainMaterial(t)
    // No sweeping radar here: switch the table's sweep afterglow off.
    m.uniforms.uGlow.value.setScalar(0)
    return m
  }, [t])
  useLayoutEffect(() => () => material.dispose(), [material])
  const stTag = useRef<HTMLSpanElement>(null)
  useFrame(() => {
    const s = `${STATION.ident} DME · ${formatDmeChannel(STATION.channel, engine.env.mode)}`
    if (stTag.current && stTag.current.textContent !== s) stTag.current.textContent = s
  })
  return (
    <group>
      <StudioFloor t={t} y={FLOOR_Y} shadowScale={30} />
      <DioramaTable t={t} />
      <mesh geometry={terrain} material={material} receiveShadow userData={{ noPenPlot: true }} />
      <Transponder t={t} />
      <Traffic t={t} engine={engine} />
      <Twin t={t} engine={engine} />
      <RangeLines t={t} engine={engine} replayRef={replayRef} />
      <OwnAircraft t={t} engine={engine} />
      <ReplayPulses t={t} engine={engine} replayRef={replayRef} />
      <Callout3D position={[ANTENNA.x - 0.1, ANTENNA.y + 0.08, ANTENNA.z]} tone="signal" side="left" lead={20}>
        <span ref={stTag}>{STATION.ident} DME</span>
      </Callout3D>
    </group>
  )
}

export default DmeHero
