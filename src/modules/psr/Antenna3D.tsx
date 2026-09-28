import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Scene3D, tc } from '@/components/sim/Scene3D'
import { bearingToThreeRotationY } from '@/core/geometry'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { usePsr } from './state'

/** Rotating radar antenna. Its angle is read from the same engine as the scope sweep. */
export function Antenna3D({ className }: { className?: string }) {
  const { engine } = usePsr()
  return (
    <Scene3D
      className={className}
      camera={{ position: [4.2, 2.6, 5.2], fov: 42 }}
      label="3D view of the radar antenna turning. Its direction matches the sweep on the radar screen."
    >
      {(t) => <AntennaScene t={t} getAz={() => engine.antennaAz} getBeam={() => engine.params.beamWidthDeg} />}
    </Scene3D>
  )
}

function AntennaScene({ t, getAz, getBeam }: { t: ThemeTokens; getAz: () => number; getBeam: () => number }) {
  const head = useRef<THREE.Group>(null)
  const beam = useRef<THREE.Mesh>(null)

  // A curved reflector: a slice of a cylinder. three.js places cylinder vertices at
  // (r·sinθ, y, r·cosθ), so θ around 0 is the +z side; the centre of curvature is
  // then toward -z, which makes the concave face look "forward" (local -z = north
  // at rotation 0). Shift it so the dish sits just behind the pivot.
  const reflector = useMemo(() => {
    const g = new THREE.CylinderGeometry(2.4, 2.4, 1.3, 32, 1, true, -0.62, 1.24)
    g.translate(0, 0, -2.2)
    return g
  }, [])

  const camera = useThree((st) => st.camera)
  useLayoutEffect(() => camera.lookAt(0, -0.4, 0), [camera])

  useFrame(() => {
    const ry = bearingToThreeRotationY(getAz())
    if (head.current) head.current.rotation.y = ry
    if (beam.current) {
      beam.current.rotation.y = ry
      const w = Math.max(0.5, getBeam())
      beam.current.scale.set(w / 1.4, 1, 1)
    }
  })

  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[5, 8, 4]} intensity={1.4} />
      {/* Ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.6, 0]}>
        <circleGeometry args={[6, 48]} />
        <meshStandardMaterial color={tc(t, 'sim-land')} />
      </mesh>
      {/* North marker */}
      <mesh position={[0, -1.58, -5.2]} rotation={[-Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.25, 0.6, 3]} />
        <meshStandardMaterial color={tc(t, 'sim-ink')} />
      </mesh>
      {/* Tower */}
      <mesh position={[0, -0.9, 0]}>
        <cylinderGeometry args={[0.35, 0.6, 1.4, 16]} />
        <meshStandardMaterial color={tc(t, 'sim-neutral')} />
      </mesh>
      {/* Beam footprint on the ground: a thin wedge pointing where the antenna looks */}
      <mesh ref={beam} position={[0, -1.57, 0]}>
        <BeamWedge color={tc(t, 'sim-signal')} />
      </mesh>
      {/* Rotating head */}
      <group ref={head} position={[0, -0.1, 0]}>
        <mesh position={[0, 0, 0]}>
          <cylinderGeometry args={[0.3, 0.3, 0.3, 16]} />
          <meshStandardMaterial color={tc(t, 'sim-ink')} />
        </mesh>
        <mesh geometry={reflector} position={[0, 0.55, 0]}>
          <meshStandardMaterial color={tc(t, 'sim-signal')} side={THREE.DoubleSide} metalness={0.3} roughness={0.5} />
        </mesh>
        {/* Feed horn boom pointing forward (-z) */}
        <mesh position={[0, 0.25, -0.55]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.05, 0.05, 1.1, 8]} />
          <meshStandardMaterial color={tc(t, 'sim-neutral')} />
        </mesh>
        <mesh position={[0, 0.3, -1.15]}>
          <boxGeometry args={[0.35, 0.25, 0.25]} />
          <meshStandardMaterial color={tc(t, 'sim-ink')} />
        </mesh>
      </group>
    </>
  )
}

function BeamWedge({ color }: { color: string }) {
  const geom = useMemo(() => {
    const len = 5.8
    const half = (1.4 / 2) * (Math.PI / 180) * 6 // exaggerated so it is visible
    const shape = new THREE.Shape()
    shape.moveTo(0, 0)
    shape.lineTo(-Math.tan(half) * len, len)
    shape.lineTo(Math.tan(half) * len, len)
    shape.closePath()
    const g = new THREE.ShapeGeometry(shape)
    // Shape is in the xy plane pointing +y; lay it flat pointing -z (north at rotation 0).
    g.rotateX(-Math.PI / 2)
    return g
  }, [])
  return (
    <>
      <primitive object={geom} attach="geometry" />
      <meshBasicMaterial color={color} transparent opacity={0.35} side={THREE.DoubleSide} depthWrite={false} />
    </>
  )
}
