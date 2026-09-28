/**
 * The Airspace Sandbox stage: the terminal area on the 60 NM terrain table,
 * with every ground site from `systems.ts`, both radars turning with the
 * engine's antenna azimuths, all aircraft on the table, and the safety-net
 * alerts. Everything is read from the SandboxEngine each frame; the stage
 * has no physics of its own. Sites switched off (or failed by a scenario)
 * show a red lamp.
 */
import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { bearingToThreeRotationY, distanceNm, toRad, type Vec2 } from '@/core/geometry'
import { isWater, terrainElevationFt } from '@/core/world'
import { useSampled } from '@/hooks/useSampled'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { Callout3D } from '@/stage/Callout3D'
import { AircraftModel, DioramaTable, FLOOR_Y, RadarTower, S, TABLE_RADIUS_NM, V, makeTerrainMaterial, toU, useTerrain } from '@/stage/Diorama'
import { PenPlot } from '@/stage/PenPlot'
import { StudioFloor, col } from '@/stage/Stage'
import { JAMMER, type SandboxEngine } from './engine'
import { ALL_SITES, APPROACH_RADAR_SITE, ENROUTE_RADAR_SITE, ILS09, type SiteDef, type SystemId } from './systems'

/** Radar towers are drawn smaller than in the radar module so the terminal area reads as a whole. */
const TOWER_SCALE = 0.55

const groundY = (p: Vec2) => (isWater(p) ? 0 : terrainElevationFt(p) * V)
const siteU = (p: Vec2, up = 0): [number, number, number] => {
  const [x, , z] = toU(p)
  return [x, groundY(p) + up, z]
}

function useMats(t: ThemeTokens) {
  const m = useMemo(
    () => ({
      steel: new THREE.MeshStandardMaterial({ color: col(t, 'stage-paint'), roughness: 0.45, metalness: 0.55 }),
      paint: new THREE.MeshPhysicalMaterial({ color: col(t, 'stage-paint'), roughness: 0.4, metalness: 0.2, clearcoat: 0.5 }),
      dark: new THREE.MeshStandardMaterial({ color: col(t, 'stage-metal-dark'), roughness: 0.5, metalness: 0.7 }),
      line: new THREE.MeshBasicMaterial({ color: col(t, 'stage-line'), transparent: true, opacity: 0.35 }),
    }),
    [t],
  )
  useLayoutEffect(() => () => Object.values(m).forEach((x) => x.dispose()), [m])
  return m
}
type M = ReturnType<typeof useMats>

/** A status lamp above a site: signal cyan while its system is up, alert red when it is down. */
function useLamp(t: ThemeTokens, engine: SandboxEngine, system: SystemId) {
  const ref = useRef<THREE.MeshBasicMaterial>(null)
  const up = useMemo(() => col(t, 'stage-signal'), [t])
  const down = useMemo(() => col(t, 'stage-alert'), [t])
  useFrame((st) => {
    if (!ref.current) return
    const ok = engine.systemUp(system)
    ref.current.color.copy(ok ? up : down)
    ref.current.opacity = ok ? 0.9 : 0.55 + 0.45 * Math.abs(Math.sin(st.clock.elapsedTime * 3))
  })
  return ref
}

function Lamp({ t, engine, system, y }: { t: ThemeTokens; engine: SandboxEngine; system: SystemId; y: number }) {
  const ref = useLamp(t, engine, system)
  return (
    <mesh position={[0, y, 0]} userData={{ noPenPlot: true }}>
      <sphereGeometry args={[0.035, 12, 8]} />
      <meshBasicMaterial ref={ref} transparent toneMapped={false} />
    </mesh>
  )
}

function Site({ t, engine, site, m }: { t: ThemeTokens; engine: SandboxEngine; site: SiteDef; m: M }) {
  const mast = site.kind === 'tower' ? 0.42 : site.kind === 'vor' ? 0.12 : site.kind === 'antenna' ? 0.34 : 0.22
  return (
    <group position={siteU(site.pos)}>
      {site.kind === 'vor' ? (
        <>
          <mesh position={[0, 0.1, 0]} material={m.steel} castShadow>
            <cylinderGeometry args={[0.2, 0.2, 0.01, 32]} />
          </mesh>
          {[0, 1, 2, 3].map((k) => (
            <mesh key={k} position={[Math.sin((k * Math.PI) / 2) * 0.14, 0.05, Math.cos((k * Math.PI) / 2) * 0.14]} material={m.dark}>
              <cylinderGeometry args={[0.006, 0.006, 0.1, 5]} />
            </mesh>
          ))}
          <mesh position={[0, 0.16, 0]} material={m.paint}>
            <boxGeometry args={[0.06, 0.1, 0.06]} />
          </mesh>
        </>
      ) : (
        <>
          <mesh position={[0, mast / 2, 0]} material={m.steel} castShadow>
            <cylinderGeometry args={[0.007, 0.011, mast, 6]} />
          </mesh>
          <mesh position={[0.05, 0.03, 0]} material={m.paint} castShadow>
            <boxGeometry args={[0.07, 0.06, 0.06]} />
          </mesh>
          {site.kind === 'antenna' && (
            <mesh position={[0, mast + 0.03, 0]} material={m.paint}>
              <cylinderGeometry args={[0.018, 0.018, 0.05, 10]} />
            </mesh>
          )}
        </>
      )}
      <Lamp t={t} engine={engine} system={site.system} y={(site.kind === 'vor' ? 0.24 : mast) + 0.08} />
    </group>
  )
}

function Runway({ t }: { t: ThemeTokens }) {
  // True scale: runway 09/27 is 1.62 NM long, so it is a short strip on a 120 NM table.
  const thr = toU({ x: ILS09.gsAntenna.x - 0.16, y: 0 })
  const end = toU({ x: -(ILS09.gsAntenna.x - 0.16), y: 0 })
  const len = end[0] - thr[0]
  return (
    <mesh position={[(thr[0] + end[0]) / 2, groundY({ x: 0, y: 0 }) + 0.004, 0]} rotation-x={-Math.PI / 2} userData={{ noPenPlot: true }}>
      <planeGeometry args={[len, 0.03]} />
      <meshBasicMaterial color={col(t, 'stage-line')} transparent opacity={0.7} toneMapped={false} />
    </mesh>
  )
}

/** The GNSS jammer: a pulsing red ring at the jammer, shown only in the jamming scenario. */
function Jammer({ t, engine }: { t: ThemeTokens; engine: SandboxEngine }) {
  const g = useRef<THREE.Group>(null)
  const label = useRef<HTMLDivElement>(null)
  const rings = useRef<THREE.Mesh[]>([])
  const mats = useMemo(() => [0, 1, 2].map(() => new THREE.MeshBasicMaterial({ color: col(t, 'stage-alert'), transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending })), [t])
  useLayoutEffect(() => () => mats.forEach((x) => x.dispose()), [mats])
  useFrame((st) => {
    if (!g.current) return
    const on = engine.scenario === 'gnssJam'
    g.current.visible = on
    // drei's Html ignores the parent's visibility, so hide the label directly.
    if (label.current) label.current.style.display = on ? '' : 'none'
    rings.current.forEach((r, i) => {
      const k = ((st.clock.elapsedTime * 0.35 + i / 3) % 1 + 1) % 1
      // Ripples grow to the jammer's 90 NM reach (beyond the table edge on some bearings).
      r.scale.setScalar(0.3 + k * JAMMER.radiusNm * S)
      mats[i].opacity = 0.5 * (1 - k)
    })
  })
  return (
    <group ref={g} position={siteU(JAMMER.pos, 0.03)} visible={false}>
      {mats.map((mat, i) => (
        <mesh key={i} ref={(el) => void (el && (rings.current[i] = el))} rotation-x={-Math.PI / 2} material={mat} userData={{ noPenPlot: true }}>
          <ringGeometry args={[0.97, 1, 96]} />
        </mesh>
      ))}
      <mesh position={[0, 0.05, 0]} userData={{ noPenPlot: true }}>
        <sphereGeometry args={[0.06, 12, 8]} />
        <meshBasicMaterial color={col(t, 'stage-alert')} toneMapped={false} />
      </mesh>
      <Callout3D position={[0, 0.12, 0]} tone="alert" rootRef={label}>
        GNSS jammer · 90 NM
      </Callout3D>
    </group>
  )
}

function Plane({ t, engine, id, m }: { t: ThemeTokens; engine: SandboxEngine; id: string; m: M }) {
  const g = useRef<THREE.Group>(null)
  const drop = useRef<THREE.Mesh>(null)
  const alert = useRef<THREE.Mesh>(null)
  const alertMat = useMemo(() => new THREE.MeshBasicMaterial({ color: col(t, 'stage-alert'), transparent: true, depthWrite: false, toneMapped: false }), [t])
  useLayoutEffect(() => () => alertMat.dispose(), [alertMat])
  useFrame((st) => {
    const a = engine.getAircraft(id)
    const on = Boolean(a) && distanceNm(a!.pos, { x: 0, y: 0 }) <= TABLE_RADIUS_NM
    if (g.current) g.current.visible = on
    if (drop.current) drop.current.visible = on
    if (!a || !on) {
      if (alert.current) alert.current.visible = false
      return
    }
    const [x, y, z] = toU(a.pos, a.altitudeFt)
    const ground = groundY(a.pos)
    g.current!.position.set(x, Math.max(y, ground + 0.02), z)
    g.current!.rotation.y = bearingToThreeRotationY(a.headingDeg)
    const h = Math.max(0.001, y - ground)
    drop.current!.scale.set(1, h, 1)
    drop.current!.position.set(x, ground + h / 2, z)
    const alerted = engine.alerts.some((al) => al.ids.includes(id))
    if (alert.current) {
      alert.current.visible = alerted
      if (alerted) {
        alert.current.position.set(x, y, z)
        const k = (st.clock.elapsedTime * 1.4) % 1
        alert.current.scale.setScalar(0.25 + k * 0.35)
        alertMat.opacity = 0.9 * (1 - k)
      }
    }
  })
  return (
    <>
      <group ref={g}>
        <group scale={0.8}>
          <AircraftModel t={t} />
        </group>
      </group>
      <mesh ref={drop} material={m.line} userData={{ noPenPlot: true }}>
        <cylinderGeometry args={[0.004, 0.004, 1, 4]} />
      </mesh>
      <mesh ref={alert} rotation-x={-Math.PI / 2} material={alertMat} visible={false} userData={{ noPenPlot: true }}>
        <ringGeometry args={[0.9, 1, 48]} />
      </mesh>
    </>
  )
}

export default function SandboxHero({ t, engine }: { t: ThemeTokens; engine: SandboxEngine }) {
  const m = useMats(t)
  const terrain = useTerrain(t)
  const { material, uniforms } = useMemo(() => makeTerrainMaterial(t), [t])
  useLayoutEffect(() => () => material.dispose(), [material])
  const glow = useMemo(() => col(t, 'stage-signal'), [t])
  const black = useMemo(() => new THREE.Color(0, 0, 0), [])
  useFrame(() => {
    // The sweep afterglow follows the approach radar, and stops when that radar is down.
    uniforms.uAz.value = toRad(engine.appAz)
    uniforms.uGlow.value = engine.systemUp('radarApp') ? glow : black
  })
  const ids = useSampled(() => engine.aircraft.map((a) => a.id), 500, (a, b) => a.join() === b.join())
  const lineColor = useMemo(() => col(t, 'stage-line'), [t])
  const sites = ALL_SITES.filter((s) => s.kind !== 'radar')
  return (
    <group>
      <StudioFloor t={t} y={FLOOR_Y} shadowScale={30} />
      <DioramaTable t={t} />
      <mesh geometry={terrain} material={material} receiveShadow userData={{ noPenPlot: true }} />
      <Runway t={t} />
      <PenPlot color={lineColor} durationS={2.2}>
        {[
          { site: APPROACH_RADAR_SITE, az: () => engine.appAz, sys: 'radarApp' as const },
          { site: ENROUTE_RADAR_SITE, az: () => engine.enrAz, sys: 'radarEnr' as const },
        ].map(({ site, az, sys }) => (
          <group key={sys} position={siteU(site.pos)}>
            <group scale={TOWER_SCALE}>
              <RadarTower t={t} getAzimuthDeg={az} position={[0, 0, 0]} />
            </group>
            <Lamp t={t} engine={engine} system={sys} y={1.25} />
          </group>
        ))}
        {sites.map((s) => (
          <Site key={s.id} t={t} engine={engine} site={s} m={m} />
        ))}
      </PenPlot>
      <Jammer t={t} engine={engine} />
      {ids.map((id) => (
        <Plane key={id} t={t} engine={engine} id={id} m={m} />
      ))}
      <Callout3D position={siteU(APPROACH_RADAR_SITE.pos, 1.3)} tone="signal">
        Approach radar
      </Callout3D>
      <Callout3D position={siteU(ENROUTE_RADAR_SITE.pos, 1.3)}>En-route radar</Callout3D>
      {ALL_SITES.filter((s) => s.kind !== 'radar' && s.label).map((s) => (
        <Callout3D key={s.id} position={siteU(s.pos, 0.55)} side={s.pos.x < 0 ? 'left' : 'right'} lead={16}>
          {s.label}
        </Callout3D>
      ))}
    </group>
  )
}
