/**
 * The VOR hero: the station on the 60 NM terrain table (a Doppler VOR's
 * raised counterpoise with its ring of 48 sideband antennas, or a
 * conventional VOR's antenna house with its turning pattern), the aircraft,
 * the radial the receiver measures and the true bearing, the OBS course, the
 * cone of confusion over the station, and the building and monitor when
 * they matter. Every pose is read from the unchanged DvorEngine each frame,
 * so the table agrees with the map, the CDI and the side view.
 *
 * Scale: table 60 NM in radius, heights exaggerated (HEIGHT_EXAGGERATION),
 * the station and aircraft far larger than life, the building's distance not
 * to scale, the antenna switching / pattern turn slowed by SIGNAL_SLOWDOWN
 * and the conventional pattern's shape exaggerated. The page labels them.
 */

import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { bearingToThreeRotationY, destinationPoint, magneticToTrue } from '@/core/geometry'
import { coneRadiusNm, cvorPatternBearingDeg, DVOR_RING, dvorSourceBearingDeg } from '@/core/vor'
import { isWater, terrainElevationFt } from '@/core/world'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { fmt3 } from '@/instruments/draw'
import { Callout3D } from '@/stage/Callout3D'
import { AircraftModel, DioramaTable, FLOOR_Y, S, V, makeTerrainMaterial, toU, useTerrain } from '@/stage/Diorama'
import { PenPlot } from '@/stage/PenPlot'
import { StudioFloor, col } from '@/stage/Stage'
import { BUILDING_BEARING_TRUE, STATION, type DvorEngine } from './engine'
import { Wire3D, type WireHandle } from '@/stage/Wire3D'

/** Counterpoise radius on the table, scene units (the station is drawn far larger than life). */
const R_CP = 0.62
/** Sideband ring radius: the same ratio to the counterpoise as the old station view (6.76 m in 15 m). */
const RING_R = R_CP * (DVOR_RING.radiusM / 15)
/** Height of the raised counterpoise deck above the ground. */
const DECK_Y = 0.13
/** Where the radial and bearing lines leave the station. */
const ANT_Y = DECK_Y + 0.14
/** Compass rose around the station (aligned to magnetic north), radius in scene units. */
const ROSE_R = 1.35
/** The cone of confusion is drawn up to this height above the station, ft. */
const CONE_TOP_FT = 35000
/** The OBS course line reaches this far each side of the station, NM. */
const COURSE_NM = 28

const groundU = (p: { x: number; y: number }) => (isWater(p) ? 0 : terrainElevationFt(p) * V)
const STATION_U: [number, number, number] = [toU(STATION.pos)[0], groundU(STATION.pos), toU(STATION.pos)[2]]

// ---------------------------------------------------------------------------
// Doppler VOR: raised counterpoise, central carrier, 48 sideband antennas
// ---------------------------------------------------------------------------

function DvorStation({ t, engine }: { t: ThemeTokens; engine: DvorEngine }) {
  const grp = useRef<THREE.Group>(null)
  const usb = useRef<THREE.Mesh>(null)
  const lsb = useRef<THREE.Mesh>(null)
  const posts = useRef<THREE.InstancedMesh>(null)
  const caps = useRef<THREE.InstancedMesh>(null)
  const legs = useRef<THREE.InstancedMesh>(null)
  const N = DVOR_RING.antennas
  // Antenna k sits at true bearing k·360/N, like the old station view.
  const spots = useMemo(
    () =>
      Array.from({ length: N }, (_, k) => {
        const a = (k * 360) / N
        const r = (a * Math.PI) / 180
        return [Math.sin(r) * RING_R, -Math.cos(r) * RING_R] as const
      }),
    [N],
  )
  useLayoutEffect(() => {
    const m = new THREE.Matrix4()
    spots.forEach(([x, z], i) => {
      m.makeTranslation(x, DECK_Y + 0.035, z)
      posts.current?.setMatrixAt(i, m)
      m.makeTranslation(x, DECK_Y + 0.075, z)
      caps.current?.setMatrixAt(i, m)
    })
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2
      m.makeTranslation(Math.cos(a) * R_CP * 0.82, DECK_Y / 2, Math.sin(a) * R_CP * 0.82)
      legs.current?.setMatrixAt(i, m)
    }
    ;[posts, caps, legs].forEach((r) => r.current && (r.current.instanceMatrix.needsUpdate = true))
  }, [spots])
  useFrame(() => {
    if (grp.current) grp.current.visible = engine.env.type === 'dvor'
    // The sideband is switched from one antenna to the next, counter-clockwise (slowed down).
    const step = 360 / N
    const k = (((Math.round(dvorSourceBearingDeg(engine.signalTimeS, engine.variationDeg) / step) % N) + N) % N)
    const [x, z] = spots[k]
    const on = engine.last.radiating
    if (usb.current) {
      usb.current.position.set(x, DECK_Y + 0.11, z)
      usb.current.visible = on
    }
    if (lsb.current) {
      lsb.current.position.set(-x, DECK_Y + 0.11, -z)
      lsb.current.visible = on
    }
  })
  const paint = col(t, 'stage-paint')
  const dark = col(t, 'stage-metal-dark')
  const metal = col(t, 'stage-metal')
  const brass = col(t, 'stage-brass')
  const signal = col(t, 'stage-signal')
  return (
    <group ref={grp}>
      <PenPlot color={col(t, 'stage-line')}>
        {/* Equipment shelter under the deck */}
        <mesh position={[0, DECK_Y / 2, 0]} castShadow>
          <cylinderGeometry args={[0.13, 0.14, DECK_Y, 20]} />
          <meshPhysicalMaterial color={paint} roughness={0.45} metalness={0.15} clearcoat={0.4} />
        </mesh>
        {/* The counterpoise: a round metal deck */}
        <mesh position={[0, DECK_Y, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[R_CP, R_CP, 0.012, 96]} />
          <meshStandardMaterial color={metal} roughness={0.6} metalness={0.45} />
        </mesh>
        <mesh position={[0, DECK_Y + 0.007, 0]} rotation-x={Math.PI / 2}>
          <torusGeometry args={[R_CP, 0.006, 4, 96]} />
          <meshStandardMaterial color={brass} roughness={0.3} metalness={0.9} />
        </mesh>
        {/* Carrier antenna in the centre */}
        <mesh position={[0, DECK_Y + 0.06, 0]}>
          <cylinderGeometry args={[0.008, 0.008, 0.12, 8]} />
          <meshStandardMaterial color={dark} roughness={0.4} metalness={0.8} />
        </mesh>
        <mesh position={[0, DECK_Y + 0.12, 0]} rotation-x={Math.PI / 2}>
          <torusGeometry args={[0.03, 0.006, 6, 20]} />
          <meshStandardMaterial color={brass} roughness={0.3} metalness={0.9} emissive={brass} emissiveIntensity={0.15} />
        </mesh>
      </PenPlot>
      {/* Deck legs, ring posts and their loop heads (instanced) */}
      <instancedMesh ref={legs} args={[undefined, undefined, 16]} userData={{ noPenPlot: true }} castShadow>
        <cylinderGeometry args={[0.008, 0.008, DECK_Y, 5]} />
        <meshStandardMaterial color={dark} roughness={0.6} metalness={0.5} />
      </instancedMesh>
      <instancedMesh ref={posts} args={[undefined, undefined, N]} userData={{ noPenPlot: true }}>
        <cylinderGeometry args={[0.0035, 0.0035, 0.07, 4]} />
        <meshStandardMaterial color={paint} roughness={0.45} metalness={0.5} />
      </instancedMesh>
      <instancedMesh ref={caps} args={[undefined, undefined, N]} userData={{ noPenPlot: true }}>
        <boxGeometry args={[0.022, 0.008, 0.022]} />
        <meshStandardMaterial color={brass} roughness={0.35} metalness={0.9} />
      </instancedMesh>
      {/* The antenna radiating the upper sideband now, and its opposite partner (lower sideband). */}
      <mesh ref={usb} userData={{ noPenPlot: true }}>
        <sphereGeometry args={[0.022, 16, 12]} />
        <meshBasicMaterial color={signal} toneMapped={false} />
      </mesh>
      <mesh ref={lsb} userData={{ noPenPlot: true }}>
        <octahedronGeometry args={[0.022]} />
        <meshBasicMaterial color={signal} toneMapped={false} transparent opacity={0.7} />
      </mesh>
      <mesh position={[0, DECK_Y + 0.02, 0]} rotation-x={-Math.PI / 2} userData={{ noPenPlot: true }}>
        <ringGeometry args={[RING_R - 0.01, RING_R + 0.01, 96]} />
        <meshBasicMaterial color={signal} toneMapped={false} transparent opacity={0.35} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
    </group>
  )
}

// ---------------------------------------------------------------------------
// Conventional VOR: antenna house and its turning radiation pattern
// ---------------------------------------------------------------------------

function CvorStation({ t, engine }: { t: ThemeTokens; engine: DvorEngine }) {
  const grp = useRef<THREE.Group>(null)
  const pattern = useRef<THREE.Mesh>(null)
  // Carrier plus the turning figure-of-eight gives a limaçon, 1 + m·cos θ.
  // Drawn with m = 0.6 instead of about 0.3 so its shape is visible (labelled on the page).
  const geom = useMemo(() => {
    const shape = new THREE.Shape()
    const R = R_CP * 1.5
    for (let i = 0; i <= 96; i++) {
      const th = (i / 96) * Math.PI * 2
      const r = R * (1 + 0.6 * Math.cos(th)) * 0.62
      // Maximum along +y in the shape plane; rotateX(−90°) turns +y into −z (north).
      const x = r * Math.sin(th)
      const y = r * Math.cos(th)
      if (i === 0) shape.moveTo(x, y)
      else shape.lineTo(x, y)
    }
    const g = new THREE.ShapeGeometry(shape)
    g.rotateX(-Math.PI / 2)
    return g
  }, [])
  useLayoutEffect(() => () => geom.dispose(), [geom])
  useFrame(() => {
    if (grp.current) grp.current.visible = engine.env.type === 'cvor'
    if (pattern.current) {
      pattern.current.rotation.y = bearingToThreeRotationY(cvorPatternBearingDeg(engine.signalTimeS, engine.variationDeg))
      pattern.current.visible = engine.last.radiating
    }
  })
  const paint = col(t, 'stage-paint')
  const brass = col(t, 'stage-brass')
  return (
    <group ref={grp} visible={false}>
      <mesh ref={pattern} geometry={geom} position={[0, 0.03, 0]} userData={{ noPenPlot: true }}>
        <meshBasicMaterial color={col(t, 'stage-signal')} transparent opacity={0.28} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <PenPlot color={col(t, 'stage-line')}>
        <mesh position={[0, 0.07, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.22, 0.14, 0.22]} />
          <meshPhysicalMaterial color={paint} roughness={0.4} metalness={0.15} clearcoat={0.5} />
        </mesh>
        <mesh position={[0, 0.17, 0]}>
          <cylinderGeometry args={[0.06, 0.06, 0.06, 20]} />
          <meshStandardMaterial color={col(t, 'stage-metal')} roughness={0.5} metalness={0.6} />
        </mesh>
        {[0, 90, 180, 270].map((b) => {
          const r = (b * Math.PI) / 180
          return (
            <mesh key={b} position={[Math.sin(r) * 0.05, 0.225, -Math.cos(r) * 0.05]} rotation-y={bearingToThreeRotationY(b)}>
              <torusGeometry args={[0.02, 0.005, 6, 16]} />
              <meshStandardMaterial color={brass} roughness={0.3} metalness={0.9} />
            </mesh>
          )
        })}
      </PenPlot>
    </group>
  )
}

// ---------------------------------------------------------------------------
// Around the station: compass rose, cone of confusion, building, monitor
// ---------------------------------------------------------------------------

function CompassRose({ t, engine }: { t: ThemeTokens; engine: DvorEngine }) {
  const grp = useRef<THREE.Group>(null)
  const geo = useMemo(() => {
    const pos: number[] = []
    for (let d = 0; d < 360; d += 10) {
      const r = (d * Math.PI) / 180
      const len = d % 90 === 0 ? 0.16 : d % 30 === 0 ? 0.1 : 0.05
      const [sx, sz] = [Math.sin(r), -Math.cos(r)]
      pos.push(sx * ROSE_R, 0, sz * ROSE_R, sx * (ROSE_R - len), 0, sz * (ROSE_R - len))
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    return g
  }, [])
  const mat = useMemo(() => new THREE.LineBasicMaterial({ color: col(t, 'stage-line'), transparent: true, opacity: 0.6 }), [t])
  useLayoutEffect(
    () => () => {
      geo.dispose()
      mat.dispose()
    },
    [geo, mat],
  )
  // The station's rose is aligned to magnetic north.
  useFrame(() => {
    if (grp.current) grp.current.rotation.y = bearingToThreeRotationY(engine.variationDeg)
  })
  return (
    <group ref={grp} position={[0, 0.03, 0]}>
      <lineSegments geometry={geo} material={mat} />
      <mesh rotation-x={-Math.PI / 2} userData={{ noPenPlot: true }}>
        <ringGeometry args={[ROSE_R - 0.004, ROSE_R + 0.004, 128]} />
        <meshBasicMaterial color={col(t, 'stage-line')} transparent opacity={0.45} />
      </mesh>
      {/* Magnetic north marker */}
      <mesh position={[0, 0.01, -ROSE_R - 0.12]} rotation-x={-Math.PI / 2} userData={{ noPenPlot: true }}>
        <circleGeometry args={[0.08, 3, Math.PI / 2]} />
        <meshBasicMaterial color={col(t, 'stage-brass')} toneMapped={false} />
      </mesh>
      <Callout3D position={[0.1, 0.02, -ROSE_R - 0.14]} tone="brass" lead={10}>
        MAG N
      </Callout3D>
    </group>
  )
}

function Cone({ t, engine }: { t: ThemeTokens; engine: DvorEngine }) {
  const mat = useRef<THREE.MeshBasicMaterial>(null)
  const rim = useRef<THREE.MeshBasicMaterial>(null)
  const tagRoot = useRef<HTMLDivElement>(null)
  const stationMsl = STATION.elevationFt + STATION.antennaFt
  const topFt = CONE_TOP_FT - stationMsl
  const h = topFt * V
  const r = coneRadiusNm(topFt) * S
  const glass = useMemo(() => col(t, 'stage-glass'), [t])
  const brass = useMemo(() => col(t, 'stage-brass'), [t])
  useFrame(() => {
    const inside = engine.last.cone !== 'clear'
    const c = inside ? brass : glass
    if (mat.current) {
      mat.current.color.copy(c)
      mat.current.opacity = inside ? 0.12 : 0.05
    }
    if (rim.current) {
      rim.current.color.copy(c)
      rim.current.opacity = inside ? 0.8 : 0.35
    }
    if (tagRoot.current) tagRoot.current.style.opacity = inside ? '1' : '0.75'
  })
  return (
    <group position={[0, stationMsl * V - STATION_U[1], 0]}>
      {/* Apex on the station, opening upward at the flag elevation (heights exaggerated like everything else). */}
      <mesh position={[0, h / 2, 0]} rotation-x={Math.PI} userData={{ noPenPlot: true }}>
        <coneGeometry args={[r, h, 64, 1, true]} />
        <meshBasicMaterial ref={mat} transparent opacity={0.05} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh position={[0, h, 0]} rotation-x={-Math.PI / 2} userData={{ noPenPlot: true }}>
        <ringGeometry args={[r - 0.01, r + 0.01, 96]} />
        <meshBasicMaterial ref={rim} transparent opacity={0.35} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
      </mesh>
      <Callout3D position={[r * 0.4, h * 0.4, 0]} lead={14} rootRef={tagRoot}>
        CONE OF CONFUSION
      </Callout3D>
    </group>
  )
}

/** The building is drawn this far out on the table (its true distance, 100–800 m, is far too small to see). */
const buildingRadiusU = (distanceM: number) => R_CP + 0.18 + ((distanceM - 100) / 700) * 0.7

function Building({ t, engine }: { t: ThemeTokens; engine: DvorEngine }) {
  const g = useRef<THREE.Group>(null)
  const tagRoot = useRef<HTMLDivElement>(null)
  const legIn = useRef<WireHandle>(null)
  const legOut = useRef<WireHandle>(null)
  const brass = useMemo(() => col(t, 'stage-brass'), [t])
  useFrame(() => {
    const on = engine.env.building
    if (g.current) g.current.visible = on
    if (tagRoot.current) tagRoot.current.style.display = on ? '' : 'none'
    const rad = (BUILDING_BEARING_TRUE * Math.PI) / 180
    const R = buildingRadiusU(engine.env.buildingDistanceM)
    const x = Math.sin(rad) * R
    const z = -Math.cos(rad) * R
    g.current?.position.set(x, 0, z)
    const show = on && engine.last.received
    legIn.current?.setVisible(show)
    legOut.current?.setVisible(show)
    if (show) {
      const [ax, ay, az] = toU(engine.aircraft.pos, engine.aircraft.altitudeFt)
      const H: [number, number, number] = [STATION_U[0] + x, STATION_U[1] + 0.2, STATION_U[2] + z]
      legIn.current?.set([STATION_U[0], STATION_U[1] + ANT_Y, STATION_U[2]], H)
      legOut.current?.set(H, [ax, ay, az])
    }
  })
  return (
    <>
      <group ref={g} visible={false}>
        <PenPlot color={col(t, 'stage-line')}>
          <mesh position={[0, 0.1, 0]} rotation-y={bearingToThreeRotationY(BUILDING_BEARING_TRUE)} castShadow>
            <boxGeometry args={[0.24, 0.2, 0.14]} />
            <meshStandardMaterial color={col(t, 'stage-paint')} roughness={0.7} metalness={0.1} />
          </mesh>
        </PenPlot>
        <Callout3D position={[0.12, 0.22, 0]} tone="brass" lead={12} rootRef={tagRoot}>
          BUILDING · REFLECTS THE SIGNAL
        </Callout3D>
      </group>
      {/* The legs live in world space. */}
      <group position={[-STATION_U[0], -STATION_U[1], -STATION_U[2]]}>
        <Wire3D ref={legIn} color={brass} radius={0.005} dash={0.05} opacity={0.8} />
        <Wire3D ref={legOut} color={brass} radius={0.006} dash={0.08} opacity={0.7} />
      </group>
    </>
  )
}

function Monitor({ t, engine }: { t: ThemeTokens; engine: DvorEngine }) {
  const lamp = useRef<THREE.MeshBasicMaterial>(null)
  const alarmTag = useRef<HTMLDivElement>(null)
  const standbyTag = useRef<HTMLDivElement>(null)
  const c = useMemo(() => ({ ok: col(t, 'stage-signal'), alarm: col(t, 'stage-alert'), standby: col(t, 'stage-brass') }), [t])
  const rad = (205 * Math.PI) / 180
  const x = Math.sin(rad) * (R_CP + 0.28)
  const z = -Math.cos(rad) * (R_CP + 0.28)
  useFrame(() => {
    const st = engine.status
    lamp.current?.color.copy(st === 'alarm' ? c.alarm : st === 'standby' ? c.standby : c.ok)
    if (alarmTag.current) alarmTag.current.style.display = st === 'alarm' ? '' : 'none'
    if (standbyTag.current) standbyTag.current.style.display = st === 'standby' ? '' : 'none'
  })
  return (
    <group position={[x, 0, z]}>
      <PenPlot color={col(t, 'stage-line')}>
        <mesh position={[0, 0.07, 0]}>
          <cylinderGeometry args={[0.005, 0.007, 0.14, 6]} />
          <meshStandardMaterial color={col(t, 'stage-paint')} roughness={0.45} metalness={0.55} />
        </mesh>
      </PenPlot>
      <mesh position={[0, 0.15, 0]} userData={{ noPenPlot: true }}>
        <sphereGeometry args={[0.018, 12, 8]} />
        <meshBasicMaterial ref={lamp} toneMapped={false} />
      </mesh>
      <Callout3D position={[0, 0.16, 0]} side="left" tone="alert" lead={14} rootRef={alarmTag}>
        MONITOR ALARM · STATION OFF AIR
      </Callout3D>
      <Callout3D position={[0, 0.16, 0]} side="left" tone="brass" lead={14} rootRef={standbyTag}>
        MONITOR · STANDBY TRANSMITTER ON AIR
      </Callout3D>
    </group>
  )
}

// ---------------------------------------------------------------------------
// The aircraft, its track, the radial, the true bearing and the OBS course
// ---------------------------------------------------------------------------

function Aircraft({ t, engine }: { t: ThemeTokens; engine: DvorEngine }) {
  const g = useRef<THREE.Group>(null)
  const drop = useRef<THREE.Mesh>(null)
  const foot = useRef<THREE.Mesh>(null)
  const label = useRef<THREE.Group>(null)
  const text = useRef<HTMLSpanElement>(null)
  useFrame(() => {
    const a = engine.aircraft
    const r = engine.last
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
      const what = !r.received
        ? r.radiating
          ? 'NO SIGNAL HERE'
          : 'NO SIGNAL · STATION OFF AIR'
        : !r.usable
          ? 'OVER THE STATION · FLAG'
          : `ON RADIAL ${fmt3(r.radialMeasured!)}°`
      const s = `${a.callsign} · ${Math.round(a.altitudeFt / 100) * 100} FT · ${what}`
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

function Trail({ t, engine }: { t: ThemeTokens; engine: DvorEngine }) {
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
  const seen = useRef<{ n: number; head: unknown }>({ n: -1, head: null })
  useFrame(() => {
    const tr = engine.trail
    if (tr.length === seen.current.n && tr[0] === seen.current.head) return
    seen.current = { n: tr.length, head: tr[0] }
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

function RadialLines({ t, engine }: { t: ThemeTokens; engine: DvorEngine }) {
  const radial = useRef<WireHandle>(null)
  const truth = useRef<WireHandle>(null)
  const course = useRef<WireHandle>(null)
  const tag = useRef<THREE.Group>(null)
  const tagRoot = useRef<HTMLDivElement>(null)
  const tagText = useRef<HTMLSpanElement>(null)
  const obsTag = useRef<THREE.Group>(null)
  const obsText = useRef<HTMLSpanElement>(null)
  const signal = useMemo(() => col(t, 'stage-signal'), [t])
  const line = useMemo(() => col(t, 'stage-line'), [t])
  const brass = useMemo(() => col(t, 'stage-brass'), [t])
  useFrame(() => {
    const a = engine.aircraft
    const r = engine.last
    const A: [number, number, number] = [STATION_U[0], STATION_U[1] + ANT_Y, STATION_U[2]]
    const P = toU(a.pos, a.altitudeFt)
    // Where the aircraft really is (dashed).
    truth.current?.set(A, P)
    truth.current?.setVisible(true)
    // The radial the receiver measures, from the station out past the aircraft.
    const on = r.received && r.radialMeasured != null
    radial.current?.setVisible(on)
    if (tagRoot.current) tagRoot.current.style.display = on ? '' : 'none'
    const d = Math.max(r.distanceNm, 0.5)
    if (on) {
      const k = (d + 4) / d
      const brgTrue = magneticToTrue(r.radialMeasured!, engine.variationDeg)
      const [ex, , ez] = toU(destinationPoint(STATION.pos, brgTrue, d * k))
      radial.current?.set(A, [ex, A[1] + (P[1] - A[1]) * k, ez])
      const km = 0.55
      const [mx, , mz] = toU(destinationPoint(STATION.pos, brgTrue, d * km))
      tag.current?.position.set(mx, A[1] + (P[1] - A[1]) * km + 0.04, mz)
      const err = r.radialMeasured! - r.radialGeometric
      const e = Math.abs(((err + 540) % 360) - 180)
      const s = `RADIAL ${fmt3(r.radialMeasured!)}° MAG${r.usable ? (e >= 0.5 ? ` · ${e.toFixed(1)}° OFF THE TRUE LINE` : '') : ' · GARBLED'}`
      if (tagText.current && tagText.current.textContent !== s) tagText.current.textContent = s
    }
    // The selected course through the station (OBS), both ways.
    const cTrue = magneticToTrue(engine.obsDeg, engine.variationDeg)
    const [fx, , fz] = toU(destinationPoint(STATION.pos, cTrue, COURSE_NM))
    const [bx, , bz] = toU(destinationPoint(STATION.pos, cTrue + 180, COURSE_NM))
    const y = STATION_U[1] + 0.035
    course.current?.set([bx, y, bz], [fx, y, fz])
    course.current?.setVisible(true)
    const [ox, , oz] = toU(destinationPoint(STATION.pos, cTrue, COURSE_NM * 0.8))
    obsTag.current?.position.set(ox, y + 0.02, oz)
    const s2 = `OBS COURSE ${fmt3(engine.obsDeg)}°`
    if (obsText.current && obsText.current.textContent !== s2) obsText.current.textContent = s2
  })
  return (
    <>
      <Wire3D ref={course} color={brass} radius={0.007} dash={0.14} opacity={0.75} />
      <Wire3D ref={truth} color={line} radius={0.006} dash={0.1} opacity={0.7} />
      <Wire3D ref={radial} color={signal} radius={0.015} opacity={0.95} />
      <group ref={tag}>
        <Callout3D position={[0, 0, 0]} tone="signal" lead={14} rootRef={tagRoot}>
          <span ref={tagText}>RADIAL</span>
        </Callout3D>
      </group>
      <group ref={obsTag}>
        <Callout3D position={[0, 0, 0]} tone="brass" lead={12}>
          <span ref={obsText}>OBS COURSE</span>
        </Callout3D>
      </group>
    </>
  )
}

// ---------------------------------------------------------------------------

export function DvorHero({ t, engine }: { t: ThemeTokens; engine: DvorEngine }) {
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
    const s = `${STATION.ident} ${engine.env.type === 'dvor' ? 'DOPPLER VOR' : 'CONVENTIONAL VOR'} · ${engine.freqMHz.toFixed(2)} MHz`
    if (stTag.current && stTag.current.textContent !== s) stTag.current.textContent = s
  })
  return (
    <group>
      <StudioFloor t={t} y={FLOOR_Y} shadowScale={30} />
      <DioramaTable t={t} />
      <mesh geometry={terrain} material={material} receiveShadow userData={{ noPenPlot: true }} />
      <group position={STATION_U}>
        <DvorStation t={t} engine={engine} />
        <CvorStation t={t} engine={engine} />
        <CompassRose t={t} engine={engine} />
        <Cone t={t} engine={engine} />
        <Building t={t} engine={engine} />
        <Monitor t={t} engine={engine} />
        <Callout3D position={[-R_CP * 0.6, ANT_Y + 0.1, 0]} tone="signal" side="left" lead={22}>
          <span ref={stTag}>{STATION.ident} VOR</span>
        </Callout3D>
      </group>
      <Trail t={t} engine={engine} />
      <RadialLines t={t} engine={engine} />
      <Aircraft t={t} engine={engine} />
    </group>
  )
}

export default DvorHero
