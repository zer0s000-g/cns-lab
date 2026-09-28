import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Scene3D, tc } from '@/components/sim/Scene3D'
import { bearingToThreeRotationY, bearingVector, worldToThree } from '@/core/geometry'
import { cvorPatternBearingDeg, DVOR_RING, dvorSourceBearingDeg, type VorType } from '@/core/vor'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { BUILDING_BEARING_TRUE, type DvorEngine } from './engine'
import { useDvor } from './state'

/** 1 three.js unit = 1 m around the station. Distances to the building and markers are not to scale. */
const COUNTERPOISE_R = 15

export function Station3D({ className, type }: { className?: string; type: VorType }) {
  const { engine } = useDvor()
  return (
    <Scene3D
      className={className}
      camera={{ position: [26, 23, 30], fov: 38 }}
      label={
        type === 'dvor'
          ? 'Doppler VOR seen from above at an angle: a central carrier antenna on a round metal platform, and a ring of 48 sideband antennas. A glowing marker jumps from antenna to antenna counter-clockwise, slowed down. A bar points toward the aircraft.'
          : 'Conventional VOR: a small antenna house whose radiation pattern, drawn as a heart-like shape on the ground, turns clockwise, slowed down. A bar points toward the aircraft.'
      }
    >
      {(t) => (type === 'dvor' ? <DvorScene t={t} engine={engine} /> : <CvorScene t={t} engine={engine} />)}
    </Scene3D>
  )
}

function CameraAim() {
  const camera = useThree((s) => s.camera)
  useLayoutEffect(() => camera.lookAt(0, 0, 0), [camera])
  return null
}

/** Ground, magnetic-north marker, pointer to the aircraft and the building (shared by both stations). */
function Surroundings({ t, engine }: { t: ThemeTokens; engine: DvorEngine }) {
  const pointer = useRef<THREE.Group>(null)
  const north = useRef<THREE.Group>(null)
  const building = useRef<THREE.Group>(null)
  useFrame(() => {
    if (pointer.current) pointer.current.rotation.y = bearingToThreeRotationY(engine.last.bearingFromStationTrue)
    if (north.current) north.current.rotation.y = bearingToThreeRotationY(engine.variationDeg)
    if (building.current) building.current.visible = engine.env.building
  })
  const [bx, , bz] = worldToThree(scaleVec(bearingVector(BUILDING_BEARING_TRUE), 20))
  return (
    <>
      <CameraAim />
      <ambientLight intensity={0.75} />
      <directionalLight position={[10, 20, 8]} intensity={1.3} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
        <circleGeometry args={[40, 64]} />
        <meshStandardMaterial color={tc(t, 'sim-land')} />
      </mesh>
      {/* Magnetic north: the direction the station is aligned to. */}
      <group ref={north}>
        <mesh position={[0, 0.05, -18.5]} rotation={[-Math.PI / 2, 0, 0]}>
          <coneGeometry args={[1.1, 2.6, 3]} />
          <meshStandardMaterial color={tc(t, 'sim-ink')} />
        </mesh>
      </group>
      {/* Toward the aircraft. */}
      <group ref={pointer}>
        <mesh position={[0, 1.6, -9.5]}>
          <boxGeometry args={[0.35, 0.1, 19]} />
          <meshStandardMaterial color={tc(t, 'primary')} />
        </mesh>
        <mesh position={[0, 1.6, -19.5]} rotation={[-Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.9, 2, 16]} />
          <meshStandardMaterial color={tc(t, 'primary')} />
        </mesh>
      </group>
      <group ref={building} position={[bx, 0, bz]}>
        <mesh position={[0, 3, 0]}>
          <boxGeometry args={[6, 6, 4]} />
          <meshStandardMaterial color={tc(t, 'sim-neutral')} />
        </mesh>
      </group>
    </>
  )
}

function scaleVec(v: { x: number; y: number }, k: number) {
  return { x: v.x * k, y: v.y * k }
}

function DvorScene({ t, engine }: { t: ThemeTokens; engine: DvorEngine }) {
  const usb = useRef<THREE.Group>(null)
  const lsb = useRef<THREE.Group>(null)
  const posts = useMemo(
    () =>
      Array.from({ length: DVOR_RING.antennas }, (_, k) => {
        const [x, , z] = worldToThree(scaleVec(bearingVector((k * 360) / DVOR_RING.antennas), DVOR_RING.radiusM))
        return [x, z] as const
      }),
    [],
  )
  useFrame(() => {
    // The sideband is switched from one antenna to the next, counter-clockwise.
    const step = 360 / DVOR_RING.antennas
    const k = Math.round(dvorSourceBearingDeg(engine.signalTimeS, engine.variationDeg) / step) % DVOR_RING.antennas
    const [x, z] = posts[(k + DVOR_RING.antennas) % DVOR_RING.antennas]
    // Nothing is radiated while the monitor has shut the station down.
    const on = engine.last.radiating
    if (usb.current) {
      usb.current.position.set(x, 0, z)
      usb.current.visible = on
    }
    if (lsb.current) {
      lsb.current.position.set(-x, 0, -z)
      lsb.current.visible = on
    }
  })
  return (
    <>
      <Surroundings t={t} engine={engine} />
      {/* Counterpoise: the round metal platform. */}
      <mesh position={[0, 1.4, 0]}>
        <cylinderGeometry args={[COUNTERPOISE_R, COUNTERPOISE_R, 0.25, 64]} />
        <meshStandardMaterial color={tc(t, 'sim-grid-strong')} metalness={0.4} roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.7, 0]}>
        <cylinderGeometry args={[1.6, 1.8, 1.4, 16]} />
        <meshStandardMaterial color={tc(t, 'sim-neutral')} />
      </mesh>
      {/* Carrier antenna in the centre. */}
      <mesh position={[0, 2.6, 0]}>
        <cylinderGeometry args={[0.18, 0.18, 2.2, 12]} />
        <meshStandardMaterial color={tc(t, 'sim-ink')} />
      </mesh>
      <mesh position={[0, 3.8, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.7, 0.12, 8, 24]} />
        <meshStandardMaterial color={tc(t, 'sim-signal-2')} />
      </mesh>
      {/* Ring of sideband antennas. */}
      {posts.map(([x, z], i) => (
        <group key={i} position={[x, 1.5, z]}>
          <mesh position={[0, 0.6, 0]}>
            <cylinderGeometry args={[0.07, 0.07, 1.2, 6]} />
            <meshStandardMaterial color={tc(t, 'sim-ink')} />
          </mesh>
          <mesh position={[0, 1.25, 0]}>
            <boxGeometry args={[0.45, 0.12, 0.45]} />
            <meshStandardMaterial color={tc(t, 'sim-neutral')} />
          </mesh>
        </group>
      ))}
      {/* The antenna radiating the upper sideband now (and its opposite partner, the lower sideband). */}
      <group ref={usb}>
        <mesh position={[0, 3.1, 0]}>
          <sphereGeometry args={[0.55, 16, 12]} />
          <meshStandardMaterial color={tc(t, 'sim-signal')} emissive={tc(t, 'sim-signal')} emissiveIntensity={0.8} />
        </mesh>
      </group>
      <group ref={lsb}>
        <mesh position={[0, 3.1, 0]}>
          <octahedronGeometry args={[0.55]} />
          <meshStandardMaterial color={tc(t, 'sim-signal')} emissive={tc(t, 'sim-signal')} emissiveIntensity={0.5} />
        </mesh>
      </group>
    </>
  )
}

function CvorScene({ t, engine }: { t: ThemeTokens; engine: DvorEngine }) {
  const pattern = useRef<THREE.Mesh>(null)
  // The radiated pattern: carrier plus the turning figure-of-eight gives a limaçon, 1 + m·cos θ.
  // Drawn with m = 0.6 instead of about 0.3 so its shape is visible.
  const geom = useMemo(() => {
    const shape = new THREE.Shape()
    const R = 9
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
  useFrame(() => {
    if (pattern.current) {
      pattern.current.rotation.y = bearingToThreeRotationY(cvorPatternBearingDeg(engine.signalTimeS, engine.variationDeg))
      pattern.current.visible = engine.last.radiating
    }
  })
  return (
    <>
      <Surroundings t={t} engine={engine} />
      <mesh ref={pattern} position={[0, 0.08, 0]}>
        <primitive object={geom} attach="geometry" />
        <meshBasicMaterial color={tc(t, 'sim-signal')} transparent opacity={0.35} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {/* Antenna house with the rotating-pattern antennas on the roof. */}
      <mesh position={[0, 1.4, 0]}>
        <boxGeometry args={[4, 2.8, 4]} />
        <meshStandardMaterial color={tc(t, 'sim-neutral')} />
      </mesh>
      <mesh position={[0, 3.3, 0]}>
        <cylinderGeometry args={[0.9, 0.9, 1, 16]} />
        <meshStandardMaterial color={tc(t, 'sim-grid-strong')} />
      </mesh>
      {[0, 90, 180, 270].map((b) => {
        const [x, , z] = worldToThree(scaleVec(bearingVector(b), 0.9))
        return (
          <mesh key={b} position={[x, 4.1, z]} rotation={[0, bearingToThreeRotationY(b), 0]}>
            <torusGeometry args={[0.35, 0.08, 6, 16]} />
            <meshStandardMaterial color={tc(t, 'sim-signal-2')} />
          </mesh>
        )
      })}
    </>
  )
}
