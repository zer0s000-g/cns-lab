import { useEffect, useMemo, useRef, useState, type ComponentRef, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Html, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { LocateFixed } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Scene3D, tc } from '@/components/sim/Scene3D'
import { circularOrbitEci, earthRotationAngleRad, GPS_CONSTELLATION, GPS_PLANES } from '@/core/gnss'
import { WGS84_A_M, geodeticToEcef, type Vec3 } from '@/core/geometry'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { useSampled } from '@/hooks/useSampled'
import type { GnssEngine } from './engine'
import { Y_AXIS, receiverWorld, toThree } from './frames'
import { useGnss } from './state'

const MAX_LINES = 32

/** Camera looking at the receiver from the side (about 60° round to the west), so its sky shows. */
function cameraFor(e: GnssEngine, dist = 12.5): [number, number, number] {
  const r = receiverWorld(e).normalize().applyAxisAngle(Y_AXIS, -1.05)
  const p = r.multiplyScalar(dist).add(new THREE.Vector3(0, 3, 0)).setLength(dist)
  return [p.x, p.y, p.z]
}

function describeOrbit(e: GnssEngine) {
  const used = e.sats.filter((s) => s.used).length
  const up = e.sats.filter((s) => s.elDeg > 0).length
  return `3D view of the Earth and ${e.sats.length} GPS satellites on six orbits, 20,200 km up. ${up} satellites are above the receiver's horizon; lines join the receiver to the ${used} in use. Drag to turn the view.`
}

export function OrbitView({ className }: { className?: string }) {
  const { engine, store } = useGnss()
  const [camera] = useState(() => cameraFor(engine))
  const label = useSampled(() => describeOrbit(engine), 1000)
  // Satellite labels are drawn into this layer; a fixed target keeps drei's Html from re-creating its roots.
  const labelLayer = useRef<HTMLDivElement>(null)
  return (
    <div className="relative">
      <Scene3D className={className} camera={{ position: camera, fov: 40 }} label={label}>
        {(t) => <OrbitScene t={t} labelLayer={labelLayer} />}
      </Scene3D>
      <div ref={labelLayer} className="pointer-events-none absolute inset-px overflow-hidden rounded-lg" aria-hidden />
      <Button
        size="sm"
        variant="outline"
        onClick={() => store.getState().setView('recenter', store.getState().view.recenter + 1)}
        className="absolute right-2 bottom-2 z-10"
      >
        <LocateFixed aria-hidden /> Look at the receiver
      </Button>
    </div>
  )
}

function OrbitScene({ t, labelLayer }: { t: ThemeTokens; labelLayer: RefObject<HTMLDivElement | null> }) {
  const { engine, store } = useGnss()
  const camera = useThree((s) => s.camera)
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null)
  const earthGroup = useRef<THREE.Group>(null)
  const earthMesh = useRef<THREE.Mesh>(null)
  const satMeshes = useRef<(THREE.Mesh | null)[]>([])
  const spheres = useRef<(THREE.Mesh | null)[]>([])
  const geoLine = useRef<THREE.LineSegments>(null)
  const labelGroups = useRef<Record<string, THREE.Group | null>>({})
  const prevTheta = useRef<number | null>(null)
  const recentered = useRef(store.getState().view.recenter)

  const mats = useMemo(
    () => ({
      used: new THREE.MeshBasicMaterial({ color: tc(t, 'sim-signal') }),
      free: new THREE.MeshBasicMaterial({ color: tc(t, 'sim-ink') }),
      off: new THREE.MeshBasicMaterial({ color: tc(t, 'sim-muted'), transparent: true, opacity: 0.55 }),
      faulty: new THREE.MeshBasicMaterial({ color: tc(t, 'sim-alert') }),
    }),
    [t],
  )
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats])

  const rings = useMemo(
    () =>
      GPS_PLANES.map((plane) => {
        const raan = GPS_CONSTELLATION.find((s) => s.plane === plane)!.raanDeg
        const pts: number[] = []
        for (let k = 0; k < 128; k++) {
          const p = toThree(circularOrbitEci(raan, (k * 360) / 128, 0))
          pts.push(p.x, p.y, p.z)
        }
        const g = new THREE.BufferGeometry()
        g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
        return { plane, g }
      }),
    [],
  )

  const grid = useMemo(() => {
    const pts: number[] = []
    const seg = (a: Vec3, b: Vec3) => {
      const p = toThree(a).multiplyScalar(1.002)
      const q = toThree(b).multiplyScalar(1.002)
      pts.push(p.x, p.y, p.z, q.x, q.y, q.z)
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      for (let lon = 0; lon < 360; lon += 5) seg(geodeticToEcef({ lat, lon }), geodeticToEcef({ lat, lon: lon + 5 }))
    }
    for (let lon = 0; lon < 360; lon += 30) {
      for (let lat = -90; lat < 90; lat += 5) seg(geodeticToEcef({ lat, lon }), geodeticToEcef({ lat: lat + 5, lon }))
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [])

  const lines = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_LINES * 6), 3))
    g.setDrawRange(0, 0)
    return g
  }, [])

  const geoLineGeom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3))
    return g
  }, [])

  // Receiver (Earth-fixed, inside the rotating group) and its local horizon plane.
  const site = useSampled(() => engine.settings.site, 300)
  const rxLocal = useMemo(() => {
    void site
    return toThree(engine.receiverEcef)
  }, [engine, site])
  const horizon = useMemo(() => {
    const up = rxLocal.clone().normalize()
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), up)
    return { pos: rxLocal.clone().multiplyScalar(1.004), q }
  }, [rxLocal])
  const geoLocal = useMemo(() => toThree(engine.geo.ecef), [engine])

  const usedIds = useSampled(
    () => engine.sats.filter((s) => s.used).map((s) => s.id),
    300,
    (a, b) => a.join() === b.join(),
  )
  const sbasOn = useSampled(() => engine.augmentation === 'sbas', 300)

  useFrame(() => {
    const e = engine
    const view = store.getState().view
    const th = earthRotationAngleRad(e.timeS)
    if (earthGroup.current) earthGroup.current.rotation.y = th
    // Turn the camera with the Earth so the receiver stays in front.
    if (prevTheta.current !== null && view.followEarth) {
      const d = th - prevTheta.current
      if (d !== 0) camera.position.applyAxisAngle(Y_AXIS, d)
    }
    prevTheta.current = th
    if (view.recenter !== recentered.current) {
      recentered.current = view.recenter
      const dist = camera.position.length()
      const p = cameraFor(e, dist)
      camera.position.set(p[0], p[1], p[2])
    }
    controls.current?.update()

    const rx = rxLocal.clone().applyAxisAngle(Y_AXIS, th)
    const pos = lines.getAttribute('position') as THREE.BufferAttribute
    let n = 0
    let k = 0
    e.sats.forEach((s, i) => {
      const m = satMeshes.current[i]
      const p = toThree(s.eci)
      if (m) {
        m.position.copy(p)
        m.material = s.faulty ? mats.faulty : s.used ? mats.used : s.status === 'ok' ? mats.free : mats.off
        m.scale.setScalar(s.used || s.faulty ? 1.25 : 1)
      }
      const lg = labelGroups.current[s.id]
      if (lg) lg.position.copy(p)
      if (s.used && n < MAX_LINES) {
        pos.setXYZ(2 * n, rx.x, rx.y, rx.z)
        pos.setXYZ(2 * n + 1, p.x, p.y, p.z)
        n++
      }
      if (s.used) {
        const sp = spheres.current[k]
        if (sp) {
          sp.visible = view.showSpheres && k < 6
          sp.position.copy(p)
          sp.scale.setScalar(s.rangeM / WGS84_A_M)
        }
        k++
      }
    })
    for (let j = k; j < spheres.current.length; j++) {
      const sp = spheres.current[j]
      if (sp) sp.visible = false
    }
    pos.needsUpdate = true
    lines.setDrawRange(0, 2 * n)
    // SBAS link (both ends are Earth-fixed, so it lives in the rotating group).
    const gp = geoLineGeom.getAttribute('position') as THREE.BufferAttribute
    gp.setXYZ(0, rxLocal.x, rxLocal.y, rxLocal.z)
    gp.setXYZ(1, geoLocal.x, geoLocal.y, geoLocal.z)
    gp.needsUpdate = true
    if (geoLine.current) geoLine.current.visible = e.augmentation === 'sbas'
  })

  return (
    <>
      <ambientLight intensity={t.isDark ? 1.2 : 2.2} />
      <directionalLight position={[6, 4, 8]} intensity={t.isDark ? 1.2 : 0.9} />
      <OrbitControls ref={controls} enablePan={false} enableDamping minDistance={2.2} maxDistance={24} />

      {/* Earth-fixed things rotate with the Earth. */}
      <group ref={earthGroup}>
        <mesh ref={earthMesh}>
          <sphereGeometry args={[1, 64, 48]} />
          <meshStandardMaterial color={tc(t, 'sim-water')} roughness={0.9} />
        </mesh>
        <lineSegments geometry={grid}>
          <lineBasicMaterial color={tc(t, 'sim-grid-strong')} transparent opacity={0.8} />
        </lineSegments>
        {/* Receiver and its horizon: satellites above this plane are in view. */}
        <mesh position={rxLocal.clone().multiplyScalar(1.01)}>
          <sphereGeometry args={[0.045, 16, 12]} />
          <meshBasicMaterial color={tc(t, 'primary')} />
        </mesh>
        <mesh position={horizon.pos} quaternion={horizon.q}>
          <circleGeometry args={[0.7, 64]} />
          <meshBasicMaterial color={tc(t, 'sim-signal')} transparent opacity={0.22} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
        <group position={rxLocal.clone().multiplyScalar(1.03)}>
          <Html center pointerEvents="none" portal={labelLayer as RefObject<HTMLElement>} zIndexRange={[4, 0]} occlude={[earthMesh as RefObject<THREE.Object3D>]}>
            <span className="rounded-sm bg-background/85 px-1 text-[10px] font-semibold whitespace-nowrap text-foreground">Receiver</span>
          </Html>
        </group>
        {/* SBAS geostationary satellite: fixed above the equator, so it turns with the Earth. */}
        <mesh position={geoLocal}>
          <octahedronGeometry args={[0.12]} />
          <meshBasicMaterial color={tc(t, 'sim-signal-2')} />
        </mesh>
        <group position={geoLocal}>
          <Html center pointerEvents="none" portal={labelLayer as RefObject<HTMLElement>} zIndexRange={[4, 0]} occlude={[earthMesh as RefObject<THREE.Object3D>]}>
            <span className="translate-y-3 rounded-sm bg-background/85 px-1 text-[10px] font-semibold whitespace-nowrap text-foreground">
              SBAS{sbasOn ? ' (sending corrections)' : ''}
            </span>
          </Html>
        </group>
        <lineSegments ref={geoLine} geometry={geoLineGeom}>
          <lineBasicMaterial color={tc(t, 'sim-signal-2')} transparent opacity={0.8} />
        </lineSegments>
      </group>

      {/* Orbits stay fixed in space while the Earth turns underneath. */}
      {rings.map((r) => (
        <lineLoop key={r.plane} geometry={r.g}>
          <lineBasicMaterial color={tc(t, 'sim-grid-strong')} transparent opacity={0.75} />
        </lineLoop>
      ))}

      {engine.sats.map((s, i) => (
        <mesh
          key={s.id}
          ref={(m) => {
            satMeshes.current[i] = m
          }}
          material={mats.off}
        >
          <sphereGeometry args={[0.085, 12, 10]} />
        </mesh>
      ))}

      {usedIds.map((id) => (
        <group
          key={id}
          ref={(g) => {
            labelGroups.current[id] = g
            const s = engine.getSat(id)
            if (g && s) g.position.copy(toThree(s.eci))
          }}
        >
          <Html center pointerEvents="none" portal={labelLayer as RefObject<HTMLElement>} zIndexRange={[4, 0]} occlude={[earthMesh as RefObject<THREE.Object3D>]}>
            <span className="-translate-y-3 font-mono text-[10px] font-semibold text-foreground">{id}</span>
          </Html>
        </group>
      ))}

      <lineSegments geometry={lines}>
        <lineBasicMaterial color={tc(t, 'sim-signal')} transparent opacity={0.85} />
      </lineSegments>

      {Array.from({ length: 6 }, (_, j) => (
        <mesh
          key={j}
          visible={false}
          ref={(m) => {
            spheres.current[j] = m
          }}
        >
          <sphereGeometry args={[1, 48, 32]} />
          <meshBasicMaterial color={tc(t, 'sim-signal-2')} transparent opacity={0.07} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </>
  )
}
