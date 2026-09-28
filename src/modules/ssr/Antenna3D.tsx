import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Scene3D, tc } from '@/components/sim/Scene3D'
import { bearingToThreeRotationY } from '@/core/geometry'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { useSsr } from './state'

/**
 * The secondary radar antenna (a long flat "bar") rides on top of the primary
 * radar reflector, so both turn together. Its angle comes from the same engine
 * as the sweep on the screen.
 */
export function SsrAntenna3D({ className }: { className?: string }) {
  const { engine } = useSsr()
  return (
    <Scene3D
      className={className}
      camera={{ position: [4.2, 2.6, 5.2], fov: 42 }}
      label="3D view of the radar head: the flat secondary radar antenna sits on top of the curved primary radar reflector and turns with it. Its direction matches the sweep on the screen."
    >
      {(t) => <Head t={t} getAz={() => engine.antennaAz} />}
    </Scene3D>
  )
}

function Head({ t, getAz }: { t: ThemeTokens; getAz: () => number }) {
  const head = useRef<THREE.Group>(null)
  const beam = useRef<THREE.Mesh>(null)
  // Curved primary reflector (slice of a cylinder, concave side facing local -z = "forward").
  const reflector = useMemo(() => {
    const g = new THREE.CylinderGeometry(2.4, 2.4, 1.1, 32, 1, true, -0.62, 1.24)
    g.translate(0, 0, -2.2)
    return g
  }, [])
  const camera = useThree((st) => st.camera)
  useLayoutEffect(() => camera.lookAt(0, -0.2, 0), [camera])
  useFrame(() => {
    const ry = bearingToThreeRotationY(getAz())
    if (head.current) head.current.rotation.y = ry
    if (beam.current) beam.current.rotation.y = ry
  })
  const wedge = useMemo(() => {
    const len = 5.8
    const half = (2.4 / 2) * (Math.PI / 180) * 5 // exaggerated so it is visible
    const shape = new THREE.Shape()
    shape.moveTo(0, 0)
    shape.lineTo(-Math.tan(half) * len, len)
    shape.lineTo(Math.tan(half) * len, len)
    shape.closePath()
    const g = new THREE.ShapeGeometry(shape)
    g.rotateX(-Math.PI / 2)
    return g
  }, [])
  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[5, 8, 4]} intensity={1.4} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.6, 0]}>
        <circleGeometry args={[6, 48]} />
        <meshStandardMaterial color={tc(t, 'sim-land')} />
      </mesh>
      <mesh position={[0, -1.58, -5.2]} rotation={[-Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.25, 0.6, 3]} />
        <meshStandardMaterial color={tc(t, 'sim-ink')} />
      </mesh>
      <mesh position={[0, -0.9, 0]}>
        <cylinderGeometry args={[0.35, 0.6, 1.4, 16]} />
        <meshStandardMaterial color={tc(t, 'sim-neutral')} />
      </mesh>
      <mesh ref={beam} position={[0, -1.57, 0]} geometry={wedge}>
        <meshBasicMaterial color={tc(t, 'sim-signal')} transparent opacity={0.35} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <group ref={head} position={[0, -0.1, 0]}>
        <mesh>
          <cylinderGeometry args={[0.3, 0.3, 0.3, 16]} />
          <meshStandardMaterial color={tc(t, 'sim-ink')} />
        </mesh>
        <mesh geometry={reflector} position={[0, 0.45, 0]}>
          <meshStandardMaterial color={tc(t, 'sim-neutral')} side={THREE.DoubleSide} metalness={0.3} roughness={0.5} />
        </mesh>
        {/* SSR "large vertical aperture" bar on top, facing forward (-z) like the reflector. */}
        <mesh position={[0, 1.25, -0.25]}>
          <boxGeometry args={[3.6, 0.42, 0.14]} />
          <meshStandardMaterial color={tc(t, 'sim-signal')} metalness={0.2} roughness={0.6} />
        </mesh>
        <mesh position={[0, 1.02, -0.2]}>
          <boxGeometry args={[0.16, 0.2, 0.16]} />
          <meshStandardMaterial color={tc(t, 'sim-ink')} />
        </mesh>
      </group>
    </>
  )
}
