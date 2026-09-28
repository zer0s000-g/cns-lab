/**
 * The Multilateration hero: the receiver network on the 60 NM terrain table.
 * Every pose is read from the unchanged MlatEngine each frame:
 *
 * - receivers stand where engine.receivers says (they move when dragged on
 *   the map), dimmed when switched off, with a red lamp when failed;
 * - each emission (one per second) draws fading lines to the receivers that
 *   time-stamped it (fix.stamps);
 * - the curves (hyperbolas) of every receiver pair come from the MEASURED
 *   time differences (curvesForFix, the same function as the 2D map), drawn
 *   at the selected aircraft's reported altitude, where they cross;
 * - the MLAT fix and the ADS-B reported position are marked separately;
 * - during the slow-motion replay (world frozen) the signal front grows from
 *   the aircraft at the replay's signal time and each receiver lights up as
 *   the front reaches it.
 */

import { useLayoutEffect, useMemo, useRef, type MutableRefObject, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { bearingToThreeRotationY } from '@/core/geometry'
import { C_M_PER_US } from '@/core/mlat'
import { METRES_PER_FT, METRES_PER_NM } from '@/core/units'
import { isWater, terrainElevationFt } from '@/core/world'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { Callout3D } from '@/stage/Callout3D'
import { AircraftModel, DioramaTable, FLOOR_Y, S, V, makeTerrainMaterial, toU, useTerrain } from '@/stage/Diorama'
import { PenPlot } from '@/stage/PenPlot'
import { StudioFloor, col } from '@/stage/Stage'
import { formatM } from './accuracy'
import { curvesForFix } from './curves'
import { CLOCK_RECEIVER, mismatchThresholdM, statusText, type MlatEngine, type MlatFix, type ReceiverId } from './engine'
import { MAP_RANGE_NM } from './NetworkMap'
import type { ReplayProgress } from './state'

const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false } as const
const UP = new THREE.Vector3(0, 1, 0)
const BOUNDS = { minX: -MAP_RANGE_NM, maxX: MAP_RANGE_NM, minY: -MAP_RANGE_NM, maxY: MAP_RANGE_NM }
/** Height of a receiver miniature's antenna above its ground, scene units (larger than life). */
const MAST_TOP = 0.9
/** How long an emission's lines to the receivers stay lit, s of world time. */
const LINK_S = 0.8

function placeBetween(m: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3) {
  const d = b.clone().sub(a)
  m.position.copy(a).addScaledVector(d, 0.5)
  m.scale.set(1, Math.max(1e-3, d.length()), 1)
  m.quaternion.setFromUnitVectors(UP, d.normalize())
}

const groundY = (p: { x: number; y: number }) => (isWater(p) ? 0 : terrainElevationFt(p) * V)

// ---------------------------------------------------------------------------
// Receivers
// ---------------------------------------------------------------------------

function Receiver({ t, engine, id, replayRef, portal }: { t: ThemeTokens; engine: MlatEngine; id: ReceiverId; replayRef: MutableRefObject<ReplayProgress | null>; portal?: RefObject<HTMLElement> }) {
  const g = useRef<THREE.Group>(null)
  const lamp = useRef<THREE.MeshStandardMaterial>(null)
  const glow = useRef<THREE.Mesh>(null)
  const glowMat = useRef<THREE.MeshBasicMaterial>(null)
  const label = useRef<THREE.Group>(null)
  const text = useRef<HTMLSpanElement>(null)
  const signal = useMemo(() => col(t, 'stage-signal'), [t])
  const alert = useMemo(() => col(t, 'stage-alert'), [t])
  const dark = useMemo(() => col(t, 'stage-metal'), [t])
  useFrame(() => {
    const r = engine.receivers.find((x) => x.id === id)
    if (!r || !g.current) return
    const [x, , z] = toU(r.pos)
    const y = groundY(r.pos)
    g.current.position.set(x, y, z)
    label.current?.position.set(x + 0.08, y + MAST_TOP + 0.15, z)
    const failed = engine.isFailed(r)
    if (lamp.current) {
      const c = failed ? alert : r.inUse ? signal : dark
      lamp.current.color.copy(c)
      lamp.current.emissive.copy(c)
      lamp.current.emissiveIntensity = r.inUse || failed ? 2 : 0
    }
    // Slow motion: the receiver lights up when the signal front reaches it.
    const rp = replayRef.current
    const st = rp?.fix.stamps.find((s) => s.id === id)
    const lit = Boolean(rp && st && rp.tUs >= st.travelUs)
    if (glow.current && glowMat.current) {
      glow.current.visible = lit
      glowMat.current.opacity = lit ? 0.55 : 0
    }
    if (text.current) {
      const clock = id === CLOCK_RECEIVER && engine.params.clockErrorNs !== 0 ? ` · clock ${engine.params.clockErrorNs > 0 ? '+' : ''}${engine.params.clockErrorNs} ns` : ''
      const state = failed ? ' · failed' : !r.inUse ? ' · off' : ''
      const heard = rp && st ? (lit ? ` · +${(st.travelUs - Math.min(...rp.fix.stamps.map((s) => s.travelUs))).toFixed(2)} µs` : '') : ''
      const s = `${r.id} ${r.name}${clock}${state}${heard}`
      if (text.current.textContent !== s) text.current.textContent = s
      const tone = failed ? 'var(--destructive)' : !r.inUse ? 'var(--muted-foreground)' : clock ? 'var(--brass)' : ''
      if (text.current.style.color !== tone) text.current.style.color = tone
    }
  })
  const paint = col(t, 'stage-paint')
  const r0 = engine.receivers.find((x) => x.id === id)!
  return (
    <>
      <group ref={g}>
        <mesh position={[0, 0.035, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.3, 0.07, 0.26]} />
          <meshStandardMaterial color={col(t, 'stage-metal')} roughness={0.95} />
        </mesh>
        <mesh position={[0.07, 0.13, 0.04]} castShadow>
          <boxGeometry args={[0.12, 0.12, 0.14]} />
          <meshPhysicalMaterial color={paint} roughness={0.4} metalness={0.15} clearcoat={0.5} />
        </mesh>
        <mesh position={[-0.06, (MAST_TOP - 0.1) / 2 + 0.07, -0.03]} castShadow>
          <cylinderGeometry args={[0.014, 0.022, MAST_TOP - 0.1, 8]} />
          <meshStandardMaterial color={paint} roughness={0.45} metalness={0.55} />
        </mesh>
        <mesh position={[-0.06, MAST_TOP, -0.03]}>
          <cylinderGeometry args={[0.026, 0.026, 0.12, 12]} />
          <meshStandardMaterial color={col(t, 'stage-metal-dark')} roughness={0.4} metalness={0.8} />
        </mesh>
        <mesh position={[-0.06, MAST_TOP + 0.09, -0.03]}>
          <sphereGeometry args={[0.022, 10, 8]} />
          <meshStandardMaterial ref={lamp} color={signal} emissive={signal} emissiveIntensity={2} toneMapped={false} />
        </mesh>
        <mesh ref={glow} position={[-0.06, MAST_TOP, -0.03]} visible={false} userData={{ noPenPlot: true }}>
          <sphereGeometry args={[0.16, 16, 12]} />
          <meshBasicMaterial ref={glowMat} color={signal} {...additive} />
        </mesh>
      </group>
      <group ref={label} position={[toU(r0.pos)[0], MAST_TOP, toU(r0.pos)[2]]}>
        <Callout3D position={[0, 0, 0]} portal={portal} lead={14}>
          <span ref={text}>{`${r0.id} ${r0.name}`}</span>
        </Callout3D>
      </group>
    </>
  )
}

/** Where a receiver's antenna is in the scene. */
function antennaAt(engine: MlatEngine, id: ReceiverId, out: THREE.Vector3) {
  const r = engine.receivers.find((x) => x.id === id)
  if (!r) return null
  const [x, , z] = toU(r.pos)
  return out.set(x - 0.06, groundY(r.pos) + MAST_TOP, z - 0.03)
}

// ---------------------------------------------------------------------------
// Aircraft, their links to the receivers, fix and ADS-B markers
// ---------------------------------------------------------------------------

const MAX_LINKS = 6

function Aircraft({ t, engine, id, selected, replayRef, portal }: { t: ThemeTokens; engine: MlatEngine; id: string; selected: () => string | null; replayRef: MutableRefObject<ReplayProgress | null>; portal?: RefObject<HTMLElement> }) {
  const g = useRef<THREE.Group>(null)
  const drop = useRef<THREE.Mesh>(null)
  const foot = useRef<THREE.Mesh>(null)
  const links = useRef<THREE.Mesh[]>([])
  const fixMark = useRef<THREE.Mesh>(null)
  const adsb = useRef<THREE.Mesh>(null)
  const adsbMat = useRef<THREE.MeshBasicMaterial>(null)
  const adsbLabel = useRef<THREE.Group>(null)
  const adsbRoot = useRef<HTMLDivElement>(null)
  const label = useRef<THREE.Group>(null)
  const text = useRef<HTMLSpanElement>(null)
  const mats = useMemo(() => Array.from({ length: MAX_LINKS }, () => new THREE.MeshBasicMaterial({ color: col(t, 'stage-signal'), ...additive })), [t])
  useLayoutEffect(() => () => mats.forEach((m) => m.dispose()), [mats])
  const signal = useMemo(() => col(t, 'stage-signal'), [t])
  const brass = useMemo(() => col(t, 'stage-brass'), [t])
  const alert = useMemo(() => col(t, 'stage-alert'), [t])
  const here = useMemo(() => new THREE.Vector3(), [])
  const tmp = useMemo(() => new THREE.Vector3(), [])
  const a0 = engine.getAircraft(id)!
  const init = toU(a0.pos, a0.altitudeFt)
  useFrame(() => {
    const a = engine.getAircraft(id)
    if (!a || !g.current) return
    const [x, y, z] = toU(a.pos, a.altitudeFt)
    here.set(x, y, z)
    g.current.position.set(x, y, z)
    g.current.rotation.y = bearingToThreeRotationY(a.headingDeg)
    const ground = groundY(a.pos)
    if (drop.current) {
      const h = Math.max(0.001, y - ground)
      drop.current.scale.set(1, h, 1)
      drop.current.position.set(x, ground + h / 2, z)
    }
    foot.current?.position.set(x, ground + 0.01, z)
    label.current?.position.set(x, y + 0.18, z)
    const fix = engine.fixes.get(id)
    const rp = replayRef.current
    const isSel = selected() === id
    // Lines to the receivers that time-stamped the latest emission (not during a replay: the front shows it then).
    const age = fix ? engine.timeS - fix.timeS : Infinity
    for (let i = 0; i < MAX_LINKS; i++) {
      const m = links.current[i]
      const st = fix?.stamps[i]
      if (!m) continue
      const on = !rp && Boolean(st) && age >= 0 && age < LINK_S
      m.visible = on
      if (!on || !st || !antennaAt(engine, st.id, tmp)) continue
      placeBetween(m, here, tmp)
      mats[i].color.copy(st.clockErrorNs !== 0 ? brass : signal)
      mats[i].opacity = (isSel ? 0.85 : 0.4) * (1 - age / LINK_S) ** 1.4
    }
    // The MLAT fix (at the reported altitude) and the ADS-B reported position.
    if (fixMark.current) {
      fixMark.current.visible = Boolean(fix?.fixPos)
      if (fix?.fixPos) fixMark.current.position.set(...toU(fix.fixPos, fix.reportedAltFt)).add(tmp.set(0, -0.09, 0))
    }
    const flag = fix ? fix.adsbMismatchM > mismatchThresholdM(fix.expectedErrorM) : false
    if (adsb.current && adsbMat.current && fix) {
      adsb.current.visible = true
      adsb.current.position.set(...toU(fix.adsbPos, fix.reportedAltFt))
      adsbMat.current.color.copy(flag ? alert : brass)
    }
    if (adsbRoot.current) adsbRoot.current.style.display = flag ? '' : 'none'
    if (flag && fix) adsbLabel.current?.position.set(...toU(fix.adsbPos, fix.reportedAltFt))
    if (text.current) {
      const st = fix ? (fix.solution.status === 'ok' ? `MLAT error ${Number.isFinite(fix.errorM) ? formatM(fix.errorM) : '—'}` : statusText(fix.solution.status).toUpperCase()) : 'WAITING'
      const s = `${a.callsign} · ${Math.round(a.altitudeFt / 100) * 100} FT · ${fix ? `${fix.stamps.length} RX · ` : ''}${st}`
      if (text.current.textContent !== s) text.current.textContent = s
      const tone = fix && fix.solution.status !== 'ok' ? 'var(--brass)' : ''
      if (text.current.style.color !== tone) text.current.style.color = tone
    }
  })
  return (
    <>
      <group ref={g} position={init}>
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
      {mats.map((mat, i) => (
        <mesh key={i} ref={(el) => void (el && (links.current[i] = el))} material={mat} visible={false} userData={{ noPenPlot: true }}>
          <cylinderGeometry args={[0.007, 0.007, 1, 5, 1, true]} />
        </mesh>
      ))}
      {/* MLAT fix: a cyan cone pointing at the solved position. */}
      <mesh ref={fixMark} rotation-x={Math.PI} visible={false} userData={{ noPenPlot: true }}>
        <coneGeometry args={[0.07, 0.14, 3]} />
        <meshBasicMaterial color={col(t, 'stage-signal')} wireframe toneMapped={false} />
      </mesh>
      {/* ADS-B reported position: a diamond (red when MLAT does not confirm it). */}
      <mesh ref={adsb} visible={false} userData={{ noPenPlot: true }}>
        <octahedronGeometry args={[0.07, 0]} />
        <meshBasicMaterial ref={adsbMat} color={col(t, 'stage-brass')} wireframe toneMapped={false} />
      </mesh>
      <group ref={adsbLabel}>
        <Callout3D position={[0, 0, 0]} tone="alert" portal={portal} rootRef={adsbRoot} lead={16}>
          {`${a0.callsign} ADS-B says here · MLAT does not confirm it`}
        </Callout3D>
      </group>
      <group ref={label} position={[init[0], init[1] + 0.18, init[2]]}>
        <Callout3D position={[0, 0, 0]} portal={portal} lead={18}>
          <span ref={text}>{a0.callsign}</span>
        </Callout3D>
      </group>
    </>
  )
}

// ---------------------------------------------------------------------------
// Hyperbolas from the measured time differences, at the aircraft's altitude
// ---------------------------------------------------------------------------

const MAX_VERTS = 24000

function Curves({ t, engine, selected, showCurves, replayRef }: { t: ThemeTokens; engine: MlatEngine; selected: () => string | null; showCurves: () => boolean; replayRef: MutableRefObject<ReplayProgress | null> }) {
  const plain = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_VERTS * 3), 3))
    g.setDrawRange(0, 0)
    return g
  }, [])
  const biased = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_VERTS * 3), 3))
    g.setDrawRange(0, 0)
    return g
  }, [])
  useLayoutEffect(
    () => () => {
      plain.dispose()
      biased.dispose()
    },
    [plain, biased],
  )
  const plainMat = useMemo(() => new THREE.LineBasicMaterial({ color: col(t, 'stage-brass'), transparent: true, opacity: 0.85, toneMapped: false }), [t])
  const biasedMat = useMemo(() => new THREE.LineDashedMaterial({ color: col(t, 'stage-brass'), dashSize: 0.12, gapSize: 0.08, transparent: true, opacity: 1, toneMapped: false }), [t])
  useLayoutEffect(
    () => () => {
      plainMat.dispose()
      biasedMat.dispose()
    },
    [plainMat, biasedMat],
  )
  const plainLines = useRef<THREE.LineSegments>(null)
  const biasedLines = useRef<THREE.LineSegments>(null)
  const cache = useRef<{ seq: number; pairs: ReturnType<typeof curvesForFix> } | null>(null)
  const shownKey = useRef('')
  useFrame(() => {
    const rp = replayRef.current
    const id = selected()
    const fix: MlatFix | undefined = rp?.fix ?? (id ? engine.fixes.get(id) : undefined)
    const show = showCurves() && Boolean(fix)
    if (plainLines.current) plainLines.current.visible = show
    if (biasedLines.current) biasedLines.current.visible = show
    if (!show || !fix) return
    if (!cache.current || cache.current.seq !== fix.seq) cache.current = { seq: fix.seq, pairs: curvesForFix(fix, BOUNDS, 90) }
    // Which pairs are drawn: all of them live; in slow motion, only those whose two receivers have heard the signal.
    const ready = cache.current.pairs.map((p) => !rp || rp.tUs >= p.readyUs)
    const key = `${fix.seq}:${ready.join('')}`
    if (key === shownKey.current) return
    shownKey.current = key
    const y = fix.reportedAltFt * V
    const fill = (geo: THREE.BufferGeometry, wantBiased: boolean) => {
      const arr = geo.getAttribute('position') as THREE.BufferAttribute
      let n = 0
      cache.current!.pairs.forEach((p, i) => {
        if (!ready[i] || p.biased !== wantBiased) return
        for (const [a, b] of p.segs) {
          if (n + 2 > MAX_VERTS) return
          const [ax, , az] = toU(a)
          const [bx, , bz] = toU(b)
          arr.setXYZ(n++, ax, y, az)
          arr.setXYZ(n++, bx, y, bz)
        }
      })
      arr.needsUpdate = true
      geo.setDrawRange(0, n)
      geo.computeBoundingSphere()
    }
    fill(plain, false)
    fill(biased, true)
    biasedLines.current?.computeLineDistances()
  })
  return (
    <>
      <lineSegments ref={plainLines} geometry={plain} material={plainMat} userData={{ noPenPlot: true }} />
      <lineSegments ref={biasedLines} geometry={biased} material={biasedMat} userData={{ noPenPlot: true }} />
    </>
  )
}

// ---------------------------------------------------------------------------
// Slow motion: the signal front spreading from the aircraft
// ---------------------------------------------------------------------------

function SignalFront({ t, replayRef }: { t: ThemeTokens; replayRef: MutableRefObject<ReplayProgress | null> }) {
  const shell = useRef<THREE.Mesh>(null)
  const ring = useRef<THREE.Mesh>(null)
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        ...additive,
        side: THREE.DoubleSide,
        uniforms: { uColor: { value: col(t, 'stage-signal') } },
        vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform vec3 uColor; varying vec3 vN; varying vec3 vV;
          void main(){ float rim = pow(1.0 - abs(dot(vN, vV)), 2.5); float a = 0.04 + rim * 0.5; gl_FragColor = vec4(uColor * a, a); }`,
      }),
    [t],
  )
  useLayoutEffect(() => () => mat.dispose(), [mat])
  useFrame(() => {
    const rp = replayRef.current
    const on = Boolean(rp)
    if (shell.current) shell.current.visible = on
    if (ring.current) ring.current.visible = on
    if (!rp) return
    const rM = C_M_PER_US * rp.tUs
    // The front is a sphere in metres; the table stretches heights, so it is drawn as an ellipsoid.
    const sx = (rM / METRES_PER_NM) * S
    const sy = (rM / METRES_PER_FT) * V
    const [x, y, z] = toU(rp.fix.truePos, rp.fix.altitudeFt)
    shell.current?.position.set(x, y, z)
    shell.current?.scale.set(Math.max(1e-3, sx), Math.max(1e-3, sy), Math.max(1e-3, sx))
    // Where the front meets the ground (the 2D map's circle).
    const h = rp.fix.altitudeFt * METRES_PER_FT
    const g = Math.sqrt(Math.max(0, rM * rM - h * h)) / METRES_PER_NM
    if (ring.current) {
      ring.current.visible = g > 0
      ring.current.position.set(x, 0.06, z)
      ring.current.scale.set(Math.max(1e-3, g * S), Math.max(1e-3, g * S), 1)
    }
  })
  return (
    <>
      <mesh ref={shell} material={mat} visible={false} userData={{ noPenPlot: true }}>
        <sphereGeometry args={[1, 48, 24]} />
      </mesh>
      <mesh ref={ring} rotation-x={-Math.PI / 2} visible={false} userData={{ noPenPlot: true }}>
        <ringGeometry args={[0.985, 1, 128]} />
        <meshBasicMaterial color={col(t, 'stage-signal')} {...additive} opacity={0.9} />
      </mesh>
    </>
  )
}

// ---------------------------------------------------------------------------

export function MlatHero({
  t,
  engine,
  replayRef,
  selected,
  showCurves,
  portal,
}: {
  t: ThemeTokens
  engine: MlatEngine
  replayRef: MutableRefObject<ReplayProgress | null>
  /** The selected aircraft (read each frame from the store). */
  selected: () => string | null
  showCurves: () => boolean
  portal?: RefObject<HTMLElement>
}) {
  const terrain = useTerrain(t)
  const { material } = useMemo(() => {
    const m = makeTerrainMaterial(t)
    // No sweeping antenna here: switch the terrain's sweep afterglow off.
    m.uniforms.uGlow.value.multiplyScalar(0)
    return m
  }, [t])
  useLayoutEffect(() => () => material.dispose(), [material])
  const lineColor = useMemo(() => col(t, 'stage-line'), [t])
  const ids = engine.aircraft.map((a) => a.id)
  const rx = engine.receivers.map((r) => r.id)
  return (
    <group>
      <StudioFloor t={t} y={FLOOR_Y} shadowScale={30} />
      <DioramaTable t={t} />
      <mesh geometry={terrain} material={material} receiveShadow userData={{ noPenPlot: true }} />
      <PenPlot color={lineColor}>
        {rx.map((id) => (
          <Receiver key={id} t={t} engine={engine} id={id} replayRef={replayRef} portal={portal} />
        ))}
      </PenPlot>
      <Curves t={t} engine={engine} selected={selected} showCurves={showCurves} replayRef={replayRef} />
      {ids.map((id) => (
        <Aircraft key={id} t={t} engine={engine} id={id} selected={selected} replayRef={replayRef} portal={portal} />
      ))}
      <SignalFront t={t} replayRef={replayRef} />
    </group>
  )
}

export default MlatHero
