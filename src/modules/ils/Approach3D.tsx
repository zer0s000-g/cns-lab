import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Scene3D, tc } from '@/components/sim/Scene3D'
import { bearingToThreeRotationY, bearingVector, type Vec2 } from '@/core/geometry'
import { APPROACH_LIGHTS_M, onPathHeightFt } from '@/core/ils'
import { METRES_PER_FT, METRES_PER_NM } from '@/core/units'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { TRUCK_POS, type IlsEngine } from './engine'
import { useIls, useIlsState, type ViewMode } from './state'

/** Map point (NM) to scene metres: east = +x, up = +y, north = −z. */
function toScene(p: Vec2, upM = 0): [number, number, number] {
  return [p.x * METRES_PER_NM, upM, -p.y * METRES_PER_NM]
}

/** 3D approach view driven by the same aircraft state as the other views. */
export function Approach3D({ className, label }: { className?: string; label: string }) {
  const { engine } = useIls()
  const weather = useIlsState((s) => s.weather)
  useIlsState((s) => s.thickFog) // re-render when the fog changes
  const view = useIlsState((s) => s.view)
  const showPath = useIlsState((s) => s.showPath)
  const truck = useIlsState((s) => s.failures.truck)
  // The store updates the engine before it re-renders us, so this is always current.
  const visibilityM = engine.visibilityM
  return (
    <Scene3D className={className} camera={{ position: [0, 100, 0], fov: 26 }} background="sim-sky" label={label}>
      {(t) => <ApproachScene t={t} engine={engine} visibilityM={visibilityM} foggy={weather !== 'clear'} view={view} showPath={showPath} truck={truck} />}
    </Scene3D>
  )
}

function ApproachScene({
  t,
  engine,
  visibilityM,
  foggy,
  view,
  showPath,
  truck,
}: {
  t: ThemeTokens
  engine: IlsEngine
  visibilityM: number
  foggy: boolean
  view: ViewMode
  showPath: boolean
  truck: boolean
}) {
  const get = useThree((s) => s.get)
  const plane = useRef<THREE.Group>(null)
  useLayoutEffect(() => {
    const cam = get().camera as THREE.PerspectiveCamera
    cam.near = 0.5
    cam.far = 70000
    cam.updateProjectionMatrix()
  }, [get])

  const site = engine.site
  const elevFt = site.elevationFt
  const fogColor = tc(t, foggy ? 'sim-fog' : 'sim-sky')
  const bg = useMemo(() => new THREE.Color(fogColor), [fogColor])

  useFrame((state) => {
    const { camera, scene } = state
    // In fog the sky is the fog; set every frame so nothing else can override it.
    scene.background = bg
    const a = engine.aircraft
    const hM = Math.max(0, (a.altitudeFt - elevFt) * METRES_PER_FT)
    const [x, , z] = toScene(a.pos)
    const yaw = bearingToThreeRotationY(a.headingDeg)
    if (plane.current) {
      plane.current.position.set(x, hM + 2, z)
      plane.current.rotation.set(0, yaw, 0)
      plane.current.visible = view === 'outside'
    }
    if (view === 'cockpit') {
      camera.position.set(x, hM + 5, z)
      camera.rotation.set(THREE.MathUtils.degToRad(-4), yaw, 0, 'YXZ')
    } else {
      const f = bearingVector(a.headingDeg)
      camera.position.set(x - f.x * 140, hM + 38, z + f.y * 140)
      camera.lookAt(x + f.x * 260, hM - 12, z - f.y * 260)
    }
  })

  // Runway lights and approach lights as constant-size points so they show from far away, like real lights.
  const lights = useMemo(() => buildLights(engine), [engine])
  const pathPoints = useMemo(() => {
    const pts: number[] = []
    const back = bearingVector(site.courseDeg + 180)
    for (let d = 0; d <= 12; d += 0.1) {
      const p = { x: site.threshold.x + back.x * d, y: site.threshold.y + back.y * d }
      pts.push(...toScene(p, onPathHeightFt(site, d) * METRES_PER_FT))
    }
    return new Float32Array(pts)
  }, [site])

  const rwyLenM = site.runway.lengthFt * METRES_PER_FT
  const rwyWidM = site.runway.widthFt * METRES_PER_FT
  const rwyCentre = toScene({ x: (site.runway.threshold.x + site.runway.end.x) / 2, y: 0 })
  const rwyRot = bearingToThreeRotationY(site.courseDeg)

  return (
    <>
      <fog attach="fog" args={[fogColor, foggy ? visibilityM * 0.05 : 8000, foggy ? visibilityM * 1.35 : 60000]} />
      <ambientLight intensity={0.9} />
      <directionalLight position={[3000, 6000, 2000]} intensity={1.1} />
      {/* Ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
        <planeGeometry args={[90000, 90000]} />
        <meshStandardMaterial color={tc(t, t.isDark ? 'sim-terrain' : 'sim-terrain-high')} roughness={1} />
      </mesh>
      {/* Runway and markings */}
      <group position={rwyCentre} rotation={[0, rwyRot, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[rwyWidM, rwyLenM]} />
          <meshStandardMaterial color={tc(t, 'instrument-bezel')} roughness={0.9} />
        </mesh>
        <RunwayMarkings t={t} lengthM={rwyLenM} widthM={rwyWidM} />
      </group>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[lights.white, 3]} />
        </bufferGeometry>
        <pointsMaterial color={tc(t, 'instrument-marking')} size={foggy ? 3.5 : 2} sizeAttenuation={false} />
      </points>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[lights.centre, 3]} />
        </bufferGeometry>
        <pointsMaterial color={tc(t, 'instrument-marking')} size={1.5} sizeAttenuation={false} />
      </points>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[lights.green, 3]} />
        </bufferGeometry>
        <pointsMaterial color={tc(t, 'sim-ok')} size={foggy ? 3.5 : 2.5} sizeAttenuation={false} />
      </points>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[lights.red, 3]} />
        </bufferGeometry>
        <pointsMaterial color={tc(t, 'sim-alert')} size={foggy ? 3.5 : 2.5} sizeAttenuation={false} />
      </points>
      {showPath && (
        <points>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[pathPoints, 3]} />
          </bufferGeometry>
          <pointsMaterial color={tc(t, 'primary')} size={2.5} sizeAttenuation={false} transparent opacity={0.8} />
        </points>
      )}
      {/* Localizer antenna array beyond the far end */}
      <group position={toScene(site.locAntenna)} rotation={[0, rwyRot, 0]}>
        {Array.from({ length: 14 }, (_, i) => (
          <mesh key={i} position={[(i - 6.5) * 4, 2.5, 0]}>
            <boxGeometry args={[0.6, 5, 0.6]} />
            <meshStandardMaterial color={tc(t, 'sim-neutral')} />
          </mesh>
        ))}
      </group>
      {/* Glideslope mast beside the runway */}
      <mesh position={toScene(site.gsAntenna, 8)}>
        <boxGeometry args={[1, 16, 1]} />
        <meshStandardMaterial color={tc(t, 'sim-neutral')} />
      </mesh>
      {truck && (
        <mesh position={toScene(TRUCK_POS, 1.8)} rotation={[0, 0.4, 0]}>
          <boxGeometry args={[9, 3.6, 3]} />
          <meshStandardMaterial color={tc(t, 'sim-warning')} />
        </mesh>
      )}
      {/* The aircraft (seen in the outside view) */}
      <group ref={plane}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[2, 2, 36, 12]} />
          <meshStandardMaterial color={tc(t, 'sim-ink')} />
        </mesh>
        <mesh position={[0, 0, 1]}>
          <boxGeometry args={[34, 0.6, 5]} />
          <meshStandardMaterial color={tc(t, 'sim-ink')} />
        </mesh>
        <mesh position={[0, 0.5, 16]}>
          <boxGeometry args={[12, 0.5, 3]} />
          <meshStandardMaterial color={tc(t, 'sim-ink')} />
        </mesh>
        <mesh position={[0, 4, 16.5]}>
          <boxGeometry args={[0.5, 7, 3.5]} />
          <meshStandardMaterial color={tc(t, 'sim-ink')} />
        </mesh>
      </group>
    </>
  )
}

/** Threshold "piano keys", centreline dashes and aiming-point blocks (local frame: runway along −z from +L/2). */
function RunwayMarkings({ t, lengthM, widthM }: { t: ThemeTokens; lengthM: number; widthM: number }) {
  const color = tc(t, 'instrument-marking')
  const items: { x: number; z: number; w: number; l: number }[] = []
  const thrZ = lengthM / 2 // the threshold end is at +z in the runway's local frame (it is flown toward −z)
  for (let i = 0; i < 8; i++) {
    const x = -widthM / 2 + 3 + i * ((widthM - 6) / 7)
    items.push({ x: x > 0 ? x + 1.5 : x - 1.5, z: thrZ - 36, w: 1.8, l: 30 })
  }
  for (let z = thrZ - 90; z > -thrZ + 60; z -= 60) items.push({ x: 0, z, w: 0.9, l: 30 })
  for (const side of [-1, 1]) items.push({ x: side * 7, z: thrZ - 300, w: 5, l: 45 })
  return (
    <>
      {items.map((m, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[m.x, 0.03, m.z]}>
          <planeGeometry args={[m.w, m.l]} />
          <meshBasicMaterial color={color} />
        </mesh>
      ))}
    </>
  )
}

function buildLights(engine: IlsEngine) {
  const s = engine.site
  const white: number[] = []
  const green: number[] = []
  const red: number[] = []
  const centre: number[] = []
  const u = bearingVector(s.courseDeg)
  const left = bearingVector(s.courseDeg - 90)
  const at = (alongM: number, sideM: number, h = 0.4): [number, number, number] => {
    const p = { x: s.threshold.x + (u.x * alongM + left.x * sideM) / METRES_PER_NM, y: s.threshold.y + (u.y * alongM + left.y * sideM) / METRES_PER_NM }
    return toScene(p, h)
  }
  const lenM = s.runway.lengthFt * METRES_PER_FT
  const half = (s.runway.widthFt * METRES_PER_FT) / 2 + 1.5
  // Approach lights: a light bar every 30 m out to 900 m, a crossbar at 300 m.
  for (let d = 30; d <= APPROACH_LIGHTS_M; d += 30) for (let k = -2; k <= 2; k++) white.push(...at(-d, k * 1.2, 1.5))
  for (let k = -15; k <= 15; k++) white.push(...at(-300, k, 1.5))
  // Runway edge and centreline lights.
  for (let d = 0; d <= lenM; d += 60) {
    white.push(...at(d, half), ...at(d, -half))
  }
  for (let d = 30; d < lenM; d += 30) centre.push(...at(d, 0, 0.1))
  // Threshold (green) and runway end (red).
  for (let k = -half; k <= half; k += 1.5) {
    green.push(...at(-1, k))
    red.push(...at(lenM + 1, k))
  }
  return { white: new Float32Array(white), green: new Float32Array(green), red: new Float32Array(red), centre: new Float32Array(centre) }
}
