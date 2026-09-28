/**
 * The ADS hero. Two dioramas, one per scenario, both driven every frame by
 * the unchanged engines:
 *
 * - Near the airport (ADS-B, AdsbEngine): the 60 NM terrain table with the
 *   ground receivers and the comparison radar. Each aircraft's squitters
 *   spread from it as rings (engine.rings, at the same slowed ring speed as
 *   the 2D map), and a line joins it to every receiver that heard its latest
 *   message (the message's heardBy list). Jammer and spoofer appear when those
 *   failures are on.
 * - Over the ocean (ADS-C, AdscEngine): a separate, much smaller-scale ocean
 *   table (see oceanScale.ts) with the two coasts, the route, the coastal
 *   ADS-B coverage, and ADS-C reports travelling up to the geostationary
 *   satellite and down to the oceanic centre on their real delays.
 *
 * Nothing here moves by itself: every pose comes from the engine state.
 */

import { useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { bearingToThreeRotationY, distanceNm, toRad, type Vec2 } from '@/core/geometry'
import { radioLineOfSightNm } from '@/core/propagation'
import { isWater, terrainElevationFt } from '@/core/world'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { Callout3D } from '@/stage/Callout3D'
import { AircraftModel, DioramaTable, FLOOR_Y, RADAR_SCALE, RadarTower, S, V, makeTerrainMaterial, toU, useTerrain } from '@/stage/Diorama'
import { PenPlot } from '@/stage/PenPlot'
import { StudioFloor, col } from '@/stage/Stage'
import { RING_NM_PER_S } from './AdsMap'
import { GHOST_ID, JAMMER, RADAR_SITE, SPOOFER, type AdsbEngine, type AdsbMessage, type GroundReceiver } from './engine'
import { coastEast, coastWest, GROUND_EARTH_STATION, OCEAN_ROUTE, OCEAN_START, OCEANIC_CENTRE, SATELLITE_DRAWN, type AdscEngine, type AdscReport } from './oceanEngine'
import { OS, toOcean } from './oceanScale'
import type { Scenario } from './state'

const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false } as const
const UP = new THREE.Vector3(0, 1, 0)

/** Stretch a unit-height cylinder between two points. */
function placeBetween(m: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3) {
  const d = b.clone().sub(a)
  const len = d.length()
  m.position.copy(a).addScaledVector(d, 0.5)
  m.scale.set(1, Math.max(1e-3, len), 1)
  m.quaternion.setFromUnitVectors(UP, d.normalize())
}

// ---------------------------------------------------------------------------
// Station miniatures (larger than life)
// ---------------------------------------------------------------------------

/** Mast height of a receiver miniature, scene units. */
const MAST_TOP = 1.05

/** An ADS-B ground receiver: pad, shelter, lattice-free mast and a blade antenna on top. */
function ReceiverMast({ t, position, scale = 1 }: { t: ThemeTokens; position: [number, number, number]; scale?: number }) {
  const paint = col(t, 'stage-paint')
  const dark = col(t, 'stage-metal-dark')
  const metal = col(t, 'stage-metal')
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.04, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.42, 0.08, 0.36]} />
        <meshStandardMaterial color={metal} roughness={0.95} />
      </mesh>
      <mesh position={[0.1, 0.16, 0.06]} castShadow>
        <boxGeometry args={[0.16, 0.16, 0.2]} />
        <meshPhysicalMaterial color={paint} roughness={0.4} metalness={0.15} clearcoat={0.5} />
      </mesh>
      <mesh position={[-0.08, 0.08 + (MAST_TOP - 0.16) / 2, -0.04]} castShadow>
        <cylinderGeometry args={[0.018, 0.028, MAST_TOP - 0.16, 8]} />
        <meshStandardMaterial color={paint} roughness={0.45} metalness={0.55} />
      </mesh>
      <mesh position={[-0.08, MAST_TOP - 0.04, -0.04]}>
        <cylinderGeometry args={[0.03, 0.03, 0.16, 12]} />
        <meshStandardMaterial color={dark} roughness={0.4} metalness={0.8} />
      </mesh>
      <mesh position={[-0.08, MAST_TOP + 0.08, -0.04]}>
        <cylinderGeometry args={[0.006, 0.006, 0.12, 6]} />
        <meshStandardMaterial color={col(t, 'stage-brass')} roughness={0.3} metalness={0.9} />
      </mesh>
    </group>
  )
}

/** A small ground transmitter mast (jammer, spoofer), with a lamp. */
function TxMast({ t, position, lamp }: { t: ThemeTokens; position: [number, number, number]; lamp: 'stage-alert' | 'stage-brass' }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.03, 0]}>
        <boxGeometry args={[0.24, 0.06, 0.24]} />
        <meshStandardMaterial color={col(t, 'stage-metal')} roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.36, 0]}>
        <cylinderGeometry args={[0.012, 0.02, 0.62, 6]} />
        <meshStandardMaterial color={col(t, 'stage-paint')} roughness={0.5} metalness={0.5} />
      </mesh>
      <mesh position={[0, 0.7, 0]}>
        <sphereGeometry args={[0.035, 12, 8]} />
        <meshStandardMaterial color={col(t, lamp)} emissive={col(t, lamp)} emissiveIntensity={2} toneMapped={false} />
      </mesh>
    </group>
  )
}

// ---------------------------------------------------------------------------
// Airport scene (ADS-B)
// ---------------------------------------------------------------------------

/** Where a receiver miniature stands. The airport receiver shares its site with the radar, so it is drawn beside the tower. */
function receiverPos(r: GroundReceiver): [number, number, number] {
  const [x, , z] = toU(r.pos)
  const y = isWater(r.pos) ? 0 : terrainElevationFt(r.pos) * V
  return r.id === 'airport' ? [x + 0.62, y, z + 0.5] : [x, y, z]
}

const MAX_RINGS = 48

/** Squitter rings: each position message spreading from its transmitter (engine.rings). */
function SquitterRings({ t, engine }: { t: ThemeTokens; engine: AdsbEngine }) {
  const meshes = useRef<THREE.Mesh[]>([])
  const mats = useMemo(() => Array.from({ length: MAX_RINGS }, () => new THREE.MeshBasicMaterial({ color: col(t, 'stage-signal'), ...additive, side: THREE.DoubleSide })), [t])
  useLayoutEffect(() => () => mats.forEach((m) => m.dispose()), [mats])
  const signal = useMemo(() => col(t, 'stage-signal'), [t])
  const brass = useMemo(() => col(t, 'stage-brass'), [t])
  useFrame(() => {
    let n = 0
    for (const r of engine.rings) {
      if (n >= MAX_RINGS) break
      const age = engine.timeS - r.t
      if (age < 0) continue
      const m = meshes.current[n]
      const mat = mats[n++]
      if (!m) continue
      const spoof = r.from === 'spoofer'
      const alt = spoof ? 0 : (engine.getAircraft(r.from)?.altitudeFt ?? 0)
      const ground = spoof ? (isWater(r.pos) ? 0 : terrainElevationFt(r.pos) * V) + 0.05 : 0
      const [x, y, z] = toU(r.pos, alt)
      m.visible = true
      m.position.set(x, spoof ? ground : y, z)
      const rad = Math.max(0.02, age * RING_NM_PER_S * S)
      m.scale.set(rad, rad, 1)
      mat.color.copy(spoof ? brass : signal)
      mat.opacity = Math.max(0, 0.7 * (1 - age / 1.6))
    }
    for (let i = n; i < MAX_RINGS; i++) if (meshes.current[i]) meshes.current[i].visible = false
  })
  return (
    <>
      {mats.map((mat, i) => (
        <mesh key={i} ref={(el) => void (el && (meshes.current[i] = el))} rotation-x={-Math.PI / 2} material={mat} visible={false} userData={{ noPenPlot: true }}>
          <ringGeometry args={[0.965, 1, 64]} />
        </mesh>
      ))}
    </>
  )
}

/** A transmitter (aircraft or spoofer) and the fading lines to the receivers that heard its latest message. */
function ReceptionLinks({ t, engine, from, receivers }: { t: ThemeTokens; engine: AdsbEngine; from: string; receivers: GroundReceiver[] }) {
  const lines = useRef<THREE.Mesh[]>([])
  const mats = useMemo(() => receivers.map(() => new THREE.MeshBasicMaterial({ color: col(t, from === 'spoofer' ? 'stage-brass' : 'stage-signal'), ...additive })), [t, receivers, from])
  useLayoutEffect(() => () => mats.forEach((m) => m.dispose()), [mats])
  const tops = useMemo(() => receivers.map((r) => new THREE.Vector3(...receiverPos(r)).add(new THREE.Vector3(-0.08, MAST_TOP + 0.08, -0.04))), [receivers])
  const src = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    const list = engine.messages.get(from)
    const on = from === 'spoofer' ? engine.env.ghost : engine.hasAdsbOut(from)
    receivers.forEach((r, i) => {
      const m = lines.current[i]
      if (!m) return
      let heard: AdsbMessage | undefined
      if (list && on) {
        for (let k = list.length - 1; k >= 0 && !heard; k--) if (list[k].heardBy.includes(r.id)) heard = list[k]
      }
      const age = heard ? engine.timeS - heard.timeS : Infinity
      const vis = age >= 0 && age < 0.9
      m.visible = vis
      if (!vis || !heard) return
      if (from === 'spoofer') {
        const [x, , z] = toU(SPOOFER.pos)
        src.set(x, terrainElevationFt(SPOOFER.pos) * V + 0.7, z)
      } else {
        const a = engine.getAircraft(from)
        if (!a) return
        src.set(...toU(a.pos, a.altitudeFt))
      }
      placeBetween(m, src, tops[i])
      mats[i].opacity = 0.75 * (1 - age / 0.9) ** 1.5
    })
  })
  return (
    <>
      {mats.map((mat, i) => (
        <mesh key={i} ref={(el) => void (el && (lines.current[i] = el))} material={mat} visible={false} userData={{ noPenPlot: true }}>
          <cylinderGeometry args={[0.008, 0.008, 1, 5, 1, true]} />
        </mesh>
      ))}
    </>
  )
}

function Aircraft({ t, engine, id, portal }: { t: ThemeTokens; engine: AdsbEngine; id: string; portal?: RefObject<HTMLElement> }) {
  const g = useRef<THREE.Group>(null)
  const drop = useRef<THREE.Mesh>(null)
  const foot = useRef<THREE.Mesh>(null)
  const label = useRef<THREE.Group>(null)
  const text = useRef<HTMLSpanElement>(null)
  const a0 = engine.getAircraft(id)!
  const init = toU(a0.pos, a0.altitudeFt)
  useFrame(() => {
    const a = engine.getAircraft(id)
    if (!a || !g.current) return
    const [x, y, z] = toU(a.pos, a.altitudeFt)
    g.current.position.set(x, y, z)
    g.current.rotation.y = bearingToThreeRotationY(a.headingDeg)
    const ground = terrainElevationFt(a.pos) * V * (isWater(a.pos) ? 0 : 1)
    if (drop.current) {
      const h = Math.max(0.001, y - ground)
      drop.current.scale.set(1, h, 1)
      drop.current.position.set(x, ground + h / 2, z)
    }
    foot.current?.position.set(x, ground + 0.01, z)
    label.current?.position.set(x, y + 0.18, z)
    if (text.current) {
      const out = engine.hasAdsbOut(id)
      const state = !out ? 'NO ADS-B OUT' : a.gnss.lost ? 'GNSS LOST' : `NACp ${a.gnss.nacp}`
      const s = `${a.callsign} · ${Math.round(a.altitudeFt / 100) * 100} FT · ${state}`
      if (text.current.textContent !== s) text.current.textContent = s
      const tone = out && a.gnss.lost ? 'var(--destructive)' : !out ? 'var(--muted-foreground)' : a.gnss.nacp < 8 ? 'var(--brass)' : ''
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
      <group ref={label} position={[init[0], init[1] + 0.18, init[2]]}>
        <Callout3D position={[0, 0, 0]} portal={portal} lead={18}>
          <span ref={text}>{a0.callsign}</span>
        </Callout3D>
      </group>
    </>
  )
}

/** The spoofed CNS777: drawn only where its messages claim it is, with the real transmitter on the ground. */
function Spoof({ t, engine, portal }: { t: ThemeTokens; engine: AdsbEngine; portal?: RefObject<HTMLElement> }) {
  const grp = useRef<THREE.Group>(null)
  const ghost = useRef<THREE.Group>(null)
  const ghostRoot = useRef<HTMLDivElement>(null)
  const spoofRoot = useRef<HTMLDivElement>(null)
  const ghostLabel = useRef<THREE.Group>(null)
  const [sx, , sz] = toU(SPOOFER.pos)
  const sy = terrainElevationFt(SPOOFER.pos) * V
  useFrame(() => {
    const on = engine.env.ghost
    if (grp.current) grp.current.visible = on
    if (ghostRoot.current) ghostRoot.current.style.display = on ? '' : 'none'
    if (spoofRoot.current) spoofRoot.current.style.display = on ? '' : 'none'
    if (!on || !ghost.current) return
    const a = engine.ghost
    const [x, y, z] = toU(a.pos, a.altitudeFt)
    ghost.current.position.set(x, y, z)
    ghost.current.rotation.y = bearingToThreeRotationY(a.headingDeg)
    ghostLabel.current?.position.set(x, y + 0.18, z)
  })
  return (
    <>
      <group ref={grp} visible={false}>
        <TxMast t={t} position={[sx, sy, sz]} lamp="stage-brass" />
        <group ref={ghost}>
          <AircraftModel t={t} dim />
          <mesh rotation-x={-Math.PI / 2} userData={{ noPenPlot: true }}>
            <ringGeometry args={[0.3, 0.34, 40]} />
            <meshBasicMaterial color={col(t, 'stage-brass')} transparent opacity={0.8} toneMapped={false} />
          </mesh>
        </group>
      </group>
      <group ref={ghostLabel}>
        <Callout3D position={[0, 0, 0]} tone="brass" portal={portal} rootRef={ghostRoot} lead={18}>
          {GHOST_ID} · only in the messages, no aircraft here
        </Callout3D>
      </group>
      <Callout3D position={[sx + 0.1, sy + 0.72, sz]} tone="brass" portal={portal} rootRef={spoofRoot}>
        Spoofer on the ground
      </Callout3D>
    </>
  )
}

/** The GNSS jammer and its footprint: lost inside the red dome, degraded inside the brass ring. */
function Jammer({ t, engine, portal }: { t: ThemeTokens; engine: AdsbEngine; portal?: RefObject<HTMLElement> }) {
  const grp = useRef<THREE.Group>(null)
  const root = useRef<HTMLDivElement>(null)
  const [x, , z] = toU(JAMMER.pos)
  const y = terrainElevationFt(JAMMER.pos) * V
  const domeMat = useMemo(() => new THREE.MeshBasicMaterial({ color: col(t, 'stage-alert'), ...additive, opacity: 0.1, side: THREE.DoubleSide }), [t])
  useLayoutEffect(() => () => domeMat.dispose(), [domeMat])
  useFrame(() => {
    if (grp.current) grp.current.visible = engine.env.jamming
    if (root.current) root.current.style.display = engine.env.jamming ? '' : 'none'
  })
  return (
    <>
      <group ref={grp} visible={false}>
        <TxMast t={t} position={[x, y, z]} lamp="stage-alert" />
        <mesh position={[x, 0, z]} material={domeMat} userData={{ noPenPlot: true }}>
          <sphereGeometry args={[JAMMER.denyRadiusNm * S, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        </mesh>
        <mesh position={[x, 0.04, z]} rotation-x={-Math.PI / 2} userData={{ noPenPlot: true }}>
          <ringGeometry args={[JAMMER.degradeRadiusNm * S - 0.04, JAMMER.degradeRadiusNm * S, 128]} />
          <meshBasicMaterial color={col(t, 'stage-brass')} transparent opacity={0.7} toneMapped={false} />
        </mesh>
      </group>
      <Callout3D position={[x + 0.1, y + 0.75, z]} tone="alert" portal={portal} rootRef={root}>
        GNSS jammer · lost inside the dome, degraded inside the ring
      </Callout3D>
    </>
  )
}

function AirportScene({ t, engine, portal }: { t: ThemeTokens; engine: AdsbEngine; portal?: RefObject<HTMLElement> }) {
  const terrain = useTerrain(t)
  const { material, uniforms } = useMemo(() => makeTerrainMaterial(t), [t])
  useLayoutEffect(() => () => material.dispose(), [material])
  useFrame(() => {
    uniforms.uAz.value = toRad(engine.radarAz)
    uniforms.uPersist.value = 0.05
  })
  const lineColor = useMemo(() => col(t, 'stage-line'), [t])
  const ids = useMemo(() => engine.aircraft.map((a) => a.id), [engine])
  const receivers = engine.receivers
  return (
    <group>
      <StudioFloor t={t} y={FLOOR_Y} shadowScale={30} />
      <DioramaTable t={t} />
      <mesh geometry={terrain} material={material} receiveShadow userData={{ noPenPlot: true }} />
      <PenPlot color={lineColor}>
        <RadarTower t={t} getAzimuthDeg={() => engine.radarAz} position={toU(RADAR_SITE.pos)} />
        {receivers.map((r) => (
          <ReceiverMast key={r.id} t={t} position={receiverPos(r)} />
        ))}
      </PenPlot>
      {receivers.map((r) => {
        const [x, y, z] = receiverPos(r)
        return (
          <Callout3D key={r.id} position={[x + 0.05, y + MAST_TOP + 0.12, z]} tone="signal" portal={portal} lead={20}>
            {r.name}
          </Callout3D>
        )
      })}
      <Callout3D position={[toU(RADAR_SITE.pos)[0] - 0.4, 1.9 * RADAR_SCALE, toU(RADAR_SITE.pos)[2]]} side="left" portal={portal} lead={20}>
        Mode S radar, for comparison
      </Callout3D>
      <SquitterRings t={t} engine={engine} />
      {ids.map((id) => (
        <ReceptionLinks key={id} t={t} engine={engine} from={id} receivers={receivers} />
      ))}
      <ReceptionLinks t={t} engine={engine} from="spoofer" receivers={receivers} />
      {ids.map((id) => (
        <Aircraft key={id} t={t} engine={engine} id={id} portal={portal} />
      ))}
      <Spoof t={t} engine={engine} portal={portal} />
      <Jammer t={t} engine={engine} portal={portal} />
    </group>
  )
}

// ---------------------------------------------------------------------------
// Ocean scene (ADS-C), on its own scale
// ---------------------------------------------------------------------------

const Y_MIN = -150
const Y_MAX = 390
const X_MIN = -770
const X_MAX = 800
/** Drawn height of the geostationary satellite above the table (not to scale). */
const SAT_Y = 3

function useCoastGeometry(side: 'w' | 'e') {
  return useMemo(() => {
    const n = 90
    const pos: number[] = []
    const idx: number[] = []
    for (let i = 0; i <= n; i++) {
      const y = Y_MIN + ((Y_MAX - Y_MIN) * i) / n
      const coast = side === 'w' ? coastWest(y) : coastEast(y)
      const edge = side === 'w' ? X_MIN : X_MAX
      const [ax, , az] = toOcean({ x: edge, y })
      const [bx, , bz] = toOcean({ x: coast, y })
      pos.push(ax, 0.05, az, bx, 0.05, bz)
      if (i < n) {
        const b = i * 2
        if (side === 'w') idx.push(b, b + 1, b + 3, b, b + 3, b + 2)
        else idx.push(b, b + 3, b + 1, b, b + 2, b + 3)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setIndex(idx)
    g.computeVertexNormals()
    return g
  }, [side])
}

const SAT_POS = (() => {
  const [x, , z] = toOcean(SATELLITE_DRAWN)
  return new THREE.Vector3(x, SAT_Y, z)
})()
const at = (p: Vec2, h = 0.06) => {
  const [x, , z] = toOcean(p)
  return new THREE.Vector3(x, h, z)
}
const CENTRE_POS = at(OCEANIC_CENTRE, 0.3)
const GES_POS = at(GROUND_EARTH_STATION, 0.34)

/** Where a report in transit is: up to the satellite, down to the ground station, then along the ground network (the 2D map's split). */
function transitPoint(r: AdscReport, t: number, out: THREE.Vector3) {
  const f = Math.min(1, Math.max(0, (t - r.sentS) / (r.receivedS - r.sentS)))
  const from = new THREE.Vector3(...toOcean(r.pos, r.altitudeFt))
  if (f < 0.12) return out.copy(from).lerp(SAT_POS, f / 0.12)
  if (f < 0.24) return out.copy(SAT_POS).lerp(GES_POS, (f - 0.12) / 0.12)
  return out.copy(GES_POS).lerp(CENTRE_POS, (f - 0.24) / 0.76)
}

function Satellite({ t, position, scale = 1 }: { t: ThemeTokens; position: THREE.Vector3; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      <mesh>
        <boxGeometry args={[0.22, 0.22, 0.3]} />
        <meshPhysicalMaterial color={col(t, 'stage-paint')} roughness={0.4} metalness={0.5} clearcoat={0.4} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.42, 0, 0]}>
          <boxGeometry args={[0.52, 0.012, 0.2]} />
          <meshStandardMaterial color={col(t, 'stage-glass')} roughness={0.3} metalness={0.7} emissive={col(t, 'stage-signal')} emissiveIntensity={0.15} />
        </mesh>
      ))}
      <mesh position={[0, -0.16, 0]} rotation-x={Math.PI}>
        <coneGeometry args={[0.08, 0.1, 16, 1, true]} />
        <meshStandardMaterial color={col(t, 'stage-brass')} roughness={0.3} metalness={0.9} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

const MAX_TRANSIT = 8
const MAX_RECEIVED = 12

function OceanScene({ t, ocean, portal }: { t: ThemeTokens; ocean: AdscEngine; portal?: RefObject<HTMLElement> }) {
  const west = useCoastGeometry('w')
  const east = useCoastGeometry('e')
  const lineColor = useMemo(() => col(t, 'stage-line'), [t])
  const ac = useRef<THREE.Group>(null)
  const drop = useRef<THREE.Mesh>(null)
  const acLabel = useRef<THREE.Group>(null)
  const acText = useRef<HTMLSpanElement>(null)
  const coverageMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        ...additive,
        uniforms: {
          uColor: { value: col(t, 'stage-signal') },
          uRx: { value: ocean.receivers.map((r) => new THREE.Vector2(toOcean(r.pos)[0], toOcean(r.pos)[2])) },
          uR: { value: ocean.receivers.map(() => 0) },
          uLine: { value: col(t, 'stage-line') },
          uGrid: { value: 100 * OS },
        },
        vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: `uniform vec3 uColor; uniform vec2 uRx[2]; uniform float uR[2]; uniform vec3 uLine; uniform float uGrid; varying vec3 vW;
          void main(){
            // A faint 100 NM grid, so distances on the flat ocean read.
            vec2 g = vW.xz / uGrid;
            vec2 gw = fwidth(g);
            vec2 gl = 1.0 - smoothstep(vec2(0.0), gw * 1.2, abs(fract(g + 0.5) - 0.5));
            float grid = max(gl.x, gl.y) * 0.08;
            float a = 0.0;
            for (int i = 0; i < 2; i++) {
              float d = length(vW.xz - uRx[i]);
              float fw = fwidth(d);
              float rim = 1.0 - smoothstep(0.0, fw * 1.8, abs(d - uR[i]));
              float fill = (1.0 - step(uR[i], d)) * 0.06;
              a = max(a, max(rim * 0.85, fill));
            }
            gl_FragColor = vec4(uColor * a + uLine * grid, max(a, grid));
          }`,
      }),
    [t, ocean],
  )
  useLayoutEffect(() => () => coverageMat.dispose(), [coverageMat])
  const transit = useRef<THREE.Mesh[]>([])
  const received = useRef<THREE.Mesh[]>([])
  const uplink = useRef<THREE.Mesh>(null)
  const uplinkMat = useRef<THREE.MeshBasicMaterial>(null)
  const gap = useRef<THREE.Mesh>(null)
  const gapLabel = useRef<THREE.Group>(null)
  const gapRoot = useRef<HTMLDivElement>(null)
  const gapText = useRef<HTMLSpanElement>(null)
  const space = useRef<THREE.Group>(null)
  const spaceLink = useRef<THREE.Mesh>(null)
  const spaceRoot = useRef<HTMLDivElement>(null)
  const spaceLabel = useRef<THREE.Group>(null)
  const tmp = useMemo(() => new THREE.Vector3(), [])
  const here = useMemo(() => new THREE.Vector3(), [])

  // The route as a chain of thin rods.
  const legs = useMemo(() => {
    const pts = [OCEAN_START, ...OCEAN_ROUTE.map((w) => w.pos)]
    return pts.slice(1).map((p, i) => [at(pts[i], 0.07), at(p, 0.07)] as const)
  }, [])

  useFrame(() => {
    const a = ocean.aircraft
    const [x, y, z] = toOcean(a.pos, a.altitudeFt)
    here.set(x, y, z)
    if (ac.current) {
      ac.current.position.set(x, y, z)
      ac.current.rotation.y = bearingToThreeRotationY(a.headingDeg)
    }
    if (drop.current) {
      drop.current.scale.set(1, Math.max(0.001, y), 1)
      drop.current.position.set(x, y / 2, z)
    }
    acLabel.current?.position.set(x, y + 0.2, z)
    const live = ocean.adsbLive()
    const heard = ocean.adsbHeardBy()
    if (acText.current) {
      const by = live ? (heard.length ? `ADS-B (${heard.map((h) => (h === 'west' ? 'west coast' : 'east coast')).join(', ')})` : 'ADS-B via satellites') : 'ADS-C only'
      const s = `${a.callsign} · FL${Math.round(a.altitudeFt / 100)} · seen by ${by}`
      if (acText.current.textContent !== s) acText.current.textContent = s
      const tone = live ? 'var(--signal)' : 'var(--brass)'
      if (acText.current.style.color !== tone) acText.current.style.color = tone
    }
    // Coastal ADS-B coverage at the aircraft's altitude (radio line of sight).
    ocean.receivers.forEach((r, i) => {
      coverageMat.uniforms.uR.value[i] = radioLineOfSightNm(r.heightFt, a.altitudeFt) * OS
    })
    // Reports on their way to the oceanic centre.
    for (let i = 0; i < MAX_TRANSIT; i++) {
      const m = transit.current[i]
      const r = ocean.inTransit[i]
      if (!m) continue
      m.visible = Boolean(r)
      if (r) m.position.copy(transitPoint(r, ocean.timeS, tmp))
    }
    // The radio hop up to the satellite, lit while a report is on it.
    const onHop = ocean.inTransit.find((r) => (ocean.timeS - r.sentS) / (r.receivedS - r.sentS) < 0.12)
    if (uplink.current && uplinkMat.current) {
      uplink.current.visible = Boolean(onHop)
      if (onHop) placeBetween(uplink.current, new THREE.Vector3(...toOcean(onHop.pos, onHop.altitudeFt)), SAT_POS)
    }
    // Reports the centre has received: what the controller knows.
    const recent = ocean.received.slice(-MAX_RECEIVED)
    for (let i = 0; i < MAX_RECEIVED; i++) {
      const m = received.current[i]
      const r = recent[i]
      if (!m) continue
      m.visible = Boolean(r)
      if (r) {
        m.position.set(...toOcean(r.pos, r.altitudeFt))
        const s = i === recent.length - 1 ? 1.4 : 1
        m.scale.setScalar(s)
      }
    }
    // Gap between the centre's latest knowledge and reality.
    const last = ocean.lastReport()
    const showGap = Boolean(last && !live)
    if (gap.current) gap.current.visible = showGap
    if (gapRoot.current) gapRoot.current.style.display = showGap ? '' : 'none'
    if (showGap && last && gap.current) {
      const p = new THREE.Vector3(...toOcean(last.pos, last.altitudeFt))
      placeBetween(gap.current, p, here)
      gapLabel.current?.position.copy(p).lerp(here, 0.5).add(new THREE.Vector3(0, -0.12, 0))
      const s = `${distanceNm(last.pos, a.pos).toFixed(0)} NM since the last report`
      if (gapText.current && gapText.current.textContent !== s) gapText.current.textContent = s
    }
    // Space-based ADS-B: a receiver on a satellite passing overhead.
    const sp = ocean.opts.spaceAdsb
    if (space.current) {
      space.current.visible = sp
      space.current.position.set(x + 0.5, 1.8, z - 0.3)
    }
    if (spaceRoot.current) spaceRoot.current.style.display = sp ? '' : 'none'
    spaceLabel.current?.position.set(x + 0.75, 1.9, z - 0.3)
    if (spaceLink.current) {
      spaceLink.current.visible = sp && live
      if (sp) placeBetween(spaceLink.current, here, tmp.set(x + 0.5, 1.8, z - 0.3))
    }
  })

  const [x0, , z0] = toOcean({ x: (X_MIN + X_MAX) / 2, y: (Y_MIN + Y_MAX) / 2 })
  const w = (X_MAX - X_MIN) * OS
  const d = (Y_MAX - Y_MIN) * OS
  return (
    <group>
      <StudioFloor t={t} y={FLOOR_Y} shadowScale={30} />
      {/* Sea table and plinth */}
      <mesh position={[x0, -0.3, z0]} receiveShadow>
        <boxGeometry args={[w + 0.8, 0.6, d + 0.8]} />
        <meshStandardMaterial color={col(t, 'stage-metal-dark')} roughness={0.55} metalness={0.6} />
      </mesh>
      <mesh position={[x0, 0.005, z0]} rotation-x={-Math.PI / 2} receiveShadow userData={{ noPenPlot: true }}>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color={col(t, 'stage-water')} roughness={0.9} metalness={0.05} emissive={col(t, 'stage-water')} emissiveIntensity={0.35} />
      </mesh>
      <mesh geometry={west} receiveShadow userData={{ noPenPlot: true }}>
        <meshStandardMaterial color={col(t, 'stage-terrain')} roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={east} receiveShadow userData={{ noPenPlot: true }}>
        <meshStandardMaterial color={col(t, 'stage-terrain')} roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
      {/* Route and waypoints */}
      {legs.map(([a, b], i) => (
        <mesh key={i} ref={(el) => void (el && placeBetween(el, a, b))} userData={{ noPenPlot: true }}>
          <cylinderGeometry args={[0.012, 0.012, 1, 5]} />
          <meshBasicMaterial color={col(t, 'stage-line')} transparent opacity={0.55} />
        </mesh>
      ))}
      {OCEAN_ROUTE.map((wp) => {
        const p = at(wp.pos, 0.07)
        return (
          <group key={wp.name}>
            <mesh position={p} rotation-x={-Math.PI / 2} userData={{ noPenPlot: true }}>
              <ringGeometry args={[0.05, 0.075, 3]} />
              <meshBasicMaterial color={col(t, 'stage-brass')} toneMapped={false} />
            </mesh>
            <Callout3D position={[p.x, p.y + 0.02, p.z + 0.25]} portal={portal} lead={10}>
              {wp.name}
            </Callout3D>
          </group>
        )
      })}
      {/* Coastal ADS-B receivers and their coverage at the aircraft's altitude */}
      <PenPlot color={lineColor}>
        {ocean.receivers.map((r) => (
          <ReceiverMast key={r.id} t={t} position={[toOcean(r.pos)[0], 0.05, toOcean(r.pos)[2]]} scale={0.4} />
        ))}
        <group position={CENTRE_POS.clone().setY(0.05)}>
          <mesh position={[0, 0.14, 0]} castShadow>
            <boxGeometry args={[0.34, 0.28, 0.24]} />
            <meshPhysicalMaterial color={col(t, 'stage-paint')} roughness={0.4} metalness={0.15} clearcoat={0.5} />
          </mesh>
        </group>
        <group position={GES_POS.clone().setY(0.05)}>
          <mesh position={[0, 0.06, 0]}>
            <boxGeometry args={[0.2, 0.12, 0.2]} />
            <meshStandardMaterial color={col(t, 'stage-metal')} roughness={0.8} />
          </mesh>
          <mesh position={[0, 0.24, 0]} rotation-x={-0.7}>
            <sphereGeometry args={[0.16, 24, 8, 0, Math.PI * 2, 0, 0.9]} />
            <meshStandardMaterial color={col(t, 'stage-paint')} roughness={0.4} metalness={0.4} side={THREE.DoubleSide} />
          </mesh>
        </group>
        <Satellite t={t} position={SAT_POS} />
      </PenPlot>
      {/* Coverage of the coastal receivers, painted on the table only (clipped at its edges). */}
      <mesh position={[x0, 0.07, z0]} rotation-x={-Math.PI / 2} material={coverageMat} userData={{ noPenPlot: true }}>
        <planeGeometry args={[w, d]} />
      </mesh>
      <Callout3D position={[toOcean(ocean.receivers[0].pos)[0] + 0.1, 0.7, toOcean(ocean.receivers[0].pos)[2]]} tone="signal" portal={portal} lead={16}>
        West coast ADS-B · coverage ring
      </Callout3D>
      <Callout3D position={[CENTRE_POS.x - 0.1, 0.5, CENTRE_POS.z]} side="left" portal={portal} lead={16}>
        Oceanic centre
      </Callout3D>
      <Callout3D position={[GES_POS.x - 0.1, 0.55, GES_POS.z]} side="left" portal={portal} lead={16}>
        Satellite ground station
      </Callout3D>
      <Callout3D position={[SAT_POS.x + 0.6, SAT_POS.y, SAT_POS.z]} tone="signal" portal={portal}>
        Geostationary satellite · drawn close, really 35,786 km up
      </Callout3D>
      {/* The aircraft */}
      <group ref={ac}>
        <AircraftModel t={t} />
      </group>
      <mesh ref={drop} userData={{ noPenPlot: true }}>
        <cylinderGeometry args={[0.006, 0.006, 1, 4]} />
        <meshBasicMaterial color={col(t, 'stage-line')} transparent opacity={0.35} />
      </mesh>
      <group ref={acLabel}>
        <Callout3D position={[0, 0, 0]} portal={portal} lead={18}>
          <span ref={acText}>{ocean.aircraft.callsign}</span>
        </Callout3D>
      </group>
      {/* ADS-C reports */}
      <mesh ref={uplink} visible={false} userData={{ noPenPlot: true }}>
        <cylinderGeometry args={[0.01, 0.01, 1, 5, 1, true]} />
        <meshBasicMaterial ref={uplinkMat} color={col(t, 'stage-brass')} {...additive} opacity={0.6} />
      </mesh>
      {Array.from({ length: MAX_TRANSIT }, (_, i) => (
        <mesh key={i} ref={(el) => void (el && (transit.current[i] = el))} visible={false} userData={{ noPenPlot: true }}>
          <sphereGeometry args={[0.07, 12, 8]} />
          <meshBasicMaterial color={col(t, 'stage-brass')} toneMapped={false} />
        </mesh>
      ))}
      {Array.from({ length: MAX_RECEIVED }, (_, i) => (
        <mesh key={i} ref={(el) => void (el && (received.current[i] = el))} visible={false} userData={{ noPenPlot: true }}>
          <boxGeometry args={[0.1, 0.1, 0.1]} />
          <meshBasicMaterial color={col(t, 'stage-brass')} wireframe toneMapped={false} />
        </mesh>
      ))}
      <mesh ref={gap} visible={false} userData={{ noPenPlot: true }}>
        <cylinderGeometry args={[0.008, 0.008, 1, 5, 1, true]} />
        <meshBasicMaterial color={col(t, 'stage-brass')} transparent opacity={0.8} toneMapped={false} />
      </mesh>
      <group ref={gapLabel}>
        <Callout3D position={[0, 0, 0]} tone="brass" portal={portal} rootRef={gapRoot} lead={14}>
          <span ref={gapText} />
        </Callout3D>
      </group>
      {/* Space-based ADS-B */}
      <group ref={space} visible={false}>
        <Satellite t={t} position={new THREE.Vector3()} scale={0.45} />
      </group>
      <mesh ref={spaceLink} visible={false} userData={{ noPenPlot: true }}>
        <cylinderGeometry args={[0.008, 0.008, 1, 5, 1, true]} />
        <meshBasicMaterial color={col(t, 'stage-signal')} {...additive} opacity={0.7} />
      </mesh>
      <group ref={spaceLabel}>
        <Callout3D position={[0, 0, 0]} tone="signal" portal={portal} rootRef={spaceRoot} lead={14}>
          ADS-B receiver on a satellite (one of many)
        </Callout3D>
      </group>
    </group>
  )
}

// ---------------------------------------------------------------------------

export function AdsHero({
  t,
  engine,
  ocean,
  scenario,
  portal,
}: {
  t: ThemeTokens
  engine: AdsbEngine
  ocean: AdscEngine
  scenario: Scenario
  portal?: RefObject<HTMLElement>
}) {
  return scenario === 'ocean' ? <OceanScene t={t} ocean={ocean} portal={portal} /> : <AirportScene t={t} engine={engine} portal={portal} />
}

export default AdsHero
