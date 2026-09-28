/**
 * The home page diorama: the same 60 NM terrain table the modules use, with
 * a miniature of every CNS system placed on it. It is a picture, not a
 * simulation: sites are spread out and enlarged so each one can be seen, and
 * the aircraft fly at true speeds with time sped up. The page labels both.
 *
 * Each site's label is a link to its module (mouse and touch). Keyboard and
 * screen-reader users get the same links in the module index below, so the
 * labels are taken out of the tab order.
 */
import { useLayoutEffect, useMemo, useRef } from 'react'
import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { bearingToThreeRotationY, toRad, type Vec2 } from '@/core/geometry'
import { ktToNmPerS } from '@/core/units'
import { isWater, terrainElevationFt } from '@/core/world'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { cn } from '@/lib/utils'
import { MODULE_BY_ID, type Pillar } from '@/modules/registry'
import { ANTENNA_Y, AircraftModel, DioramaTable, FLOOR_Y, RadarTower, S, V, makeTerrainMaterial, toU, useTerrain } from '@/stage/Diorama'
import { PenPlot } from '@/stage/PenPlot'
import { StudioFloor, col } from '@/stage/Stage'

import { AIRPORT_ZOOM, HOME_RADAR_SCALE, RUNWAY_HALF_NM, WORLD_SITES, WORLD_TIME_SCALE, type WorldFilter, type WorldSite } from './worldSites'

/** Glide path antenna: about 300 m in from the threshold and 120 m to the side, zoomed like the airport. */
const GLIDE_PATH_POS: Vec2 = { x: -RUNWAY_HALF_NM + 0.16 * AIRPORT_ZOOM, y: 0.065 * AIRPORT_ZOOM * 1.8 }

const GNSS_SITE: WorldSite = { id: 'gnss', label: 'GNSS', desc: 'Satellites broadcast the exact time; a receiver measures the delays and works out where it is.', pos: { x: 0, y: 0 }, labelY: 0 }

/** Extra MLAT receivers around the table (the labelled one is in WORLD_SITES). */
const MLAT_RX: Vec2[] = [
  { x: -22, y: 24 },
  { x: -2, y: -24 },
]
/**
 * The SATCOM satellite, scene units. The airport is at 6°S, so the
 * geostationary arc (above the equator) is high in the northern sky (-z).
 */
const GEO_SAT: [number, number, number] = [1.5, 6.2, -3.5]
const RIPPLE_SITES: Vec2[] = [
  { x: 24, y: -14 },
  { x: -32, y: -12 },
]

const groundY = (p: Vec2) => (isWater(p) ? 0 : terrainElevationFt(p) * V)
const siteU = (p: Vec2, up = 0): [number, number, number] => {
  const [x, , z] = toU(p)
  return [x, groundY(p) + up, z]
}

function pillarOf(id: string): Pillar {
  return MODULE_BY_ID.get(id)?.pillar ?? 'integration'
}

// ---------------------------------------------------------------------------
// Miniatures (stylised; token colours only)
// ---------------------------------------------------------------------------

function useMats(t: ThemeTokens) {
  return useMemo(
    () => ({
      paint: new THREE.MeshPhysicalMaterial({ color: col(t, 'stage-paint'), roughness: 0.4, metalness: 0.2, clearcoat: 0.5 }),
      steel: new THREE.MeshStandardMaterial({ color: col(t, 'stage-paint'), roughness: 0.45, metalness: 0.55 }),
      dark: new THREE.MeshStandardMaterial({ color: col(t, 'stage-metal-dark'), roughness: 0.45, metalness: 0.7 }),
      metal: new THREE.MeshStandardMaterial({ color: col(t, 'stage-metal'), roughness: 0.8, metalness: 0.2 }),
      brass: new THREE.MeshStandardMaterial({ color: col(t, 'stage-brass'), roughness: 0.3, metalness: 0.9 }),
      glass: new THREE.MeshStandardMaterial({ color: col(t, 'stage-glass'), roughness: 0.1, metalness: 0.2, emissive: col(t, 'stage-glass'), emissiveIntensity: 0.25 }),
    }),
    [t],
  )
}
type M = ReturnType<typeof useMats>

function Mast({ h, r = 0.012, m, at = [0, 0, 0] }: { h: number; r?: number; m: THREE.Material; at?: [number, number, number] }) {
  return (
    <mesh position={[at[0], at[1] + h / 2, at[2]]} material={m} castShadow>
      <cylinderGeometry args={[r * 0.7, r, h, 6]} />
    </mesh>
  )
}

function Block({ size, at, m }: { size: [number, number, number]; at: [number, number, number]; m: THREE.Material }) {
  return (
    <mesh position={[at[0], at[1] + size[1] / 2, at[2]]} material={m} castShadow receiveShadow>
      <boxGeometry args={size} />
    </mesh>
  )
}

function useRunwayTexture(t: ThemeTokens) {
  return useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 1024
    c.height = 64
    const g = c.getContext('2d')!
    g.fillStyle = 'rgba(0,0,0,0)'
    g.clearRect(0, 0, 1024, 64)
    g.fillStyle = t['stage-line']
    for (let x = 90; x < 934; x += 44) g.fillRect(x, 30, 24, 4)
    for (const x0 of [14, 1010 - 40]) for (let k = 0; k < 6; k++) g.fillRect(x0, 8 + k * 9, 40, 4)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 8
    return tex
  }, [t])
}

function Airport({ t, m }: { t: ThemeTokens; m: M }) {
  const tex = useRunwayTexture(t)
  const len = 2 * RUNWAY_HALF_NM * S
  const y = groundY({ x: 0, y: 0 }) + 0.004
  return (
    <group>
      <mesh position={[0, y, 0]} rotation-x={-Math.PI / 2} receiveShadow userData={{ noPenPlot: true }}>
        <planeGeometry args={[len, 0.12]} />
        <meshStandardMaterial color={col(t, 'stage-metal-dark')} roughness={0.9} />
      </mesh>
      <mesh position={[0, y + 0.002, 0]} rotation-x={-Math.PI / 2} userData={{ noPenPlot: true }}>
        <planeGeometry args={[len, 0.12]} />
        <meshBasicMaterial map={tex} transparent toneMapped={false} />
      </mesh>
      {/* Parallel taxiway and apron */}
      <mesh position={[0, y, -0.28]} rotation-x={-Math.PI / 2} userData={{ noPenPlot: true }}>
        <planeGeometry args={[len * 0.8, 0.05]} />
        <meshStandardMaterial color={col(t, 'stage-metal-dark')} roughness={0.9} />
      </mesh>
      <mesh position={[0, y, -0.52]} rotation-x={-Math.PI / 2} userData={{ noPenPlot: true }}>
        <planeGeometry args={[1.3, 0.34]} />
        <meshStandardMaterial color={col(t, 'stage-metal-dark')} roughness={0.9} />
      </mesh>
      <Block size={[0.9, 0.12, 0.16]} at={[0, y, -0.8]} m={m.paint} />
      <Block size={[0.9, 0.012, 0.18]} at={[0, y + 0.12, -0.8]} m={m.dark} />
    </group>
  )
}

function ControlTower({ m }: { m: M }) {
  const p = WORLD_SITES.find((s) => s.id === 'vhf')!.pos
  return (
    <group position={siteU(p)}>
      <mesh position={[0, 0.34, 0]} material={m.paint} castShadow>
        <cylinderGeometry args={[0.045, 0.07, 0.68, 12]} />
      </mesh>
      <mesh position={[0, 0.74, 0]} material={m.glass}>
        <cylinderGeometry args={[0.12, 0.09, 0.12, 8]} />
      </mesh>
      <mesh position={[0, 0.81, 0]} material={m.dark}>
        <cylinderGeometry args={[0.13, 0.13, 0.02, 8]} />
      </mesh>
      {/* VHF antennas on the roof */}
      {[-0.07, 0, 0.07].map((x) => (
        <Mast key={x} h={0.2} r={0.006} m={m.steel} at={[x, 0.82, 0.03]} />
      ))}
    </group>
  )
}

function SurfaceRadar({ m }: { m: M }) {
  const bar = useRef<THREE.Group>(null)
  const p = WORLD_SITES.find((s) => s.id === 'surface')!.pos
  // Surface movement radars turn about once a second.
  useFrame((st) => void (bar.current && (bar.current.rotation.y = -st.clock.elapsedTime * Math.PI * 2 * 1)))
  return (
    <group position={siteU(p)}>
      <Block size={[0.22, 0.3, 0.22]} at={[0, 0, 0]} m={m.paint} />
      <Mast h={0.42} r={0.02} m={m.steel} at={[0, 0.3, 0]} />
      <group ref={bar} position={[0, 0.74, 0]}>
        <mesh material={m.dark}>
          <boxGeometry args={[0.42, 0.035, 0.03]} />
        </mesh>
      </group>
    </group>
  )
}

function ControlCentre({ m }: { m: M }) {
  const p = WORLD_SITES.find((s) => s.id === 'cpdlc')!.pos
  return (
    <group position={siteU(p)}>
      <Block size={[0.5, 0.18, 0.32]} at={[0, 0, 0]} m={m.paint} />
      <Block size={[0.5, 0.03, 0.34]} at={[0, 0.18, 0]} m={m.dark} />
      <Mast h={0.3} r={0.008} m={m.steel} at={[0.18, 0.2, 0.08]} />
      <mesh position={[-0.12, 0.26, 0]} rotation-x={-0.6} material={m.steel}>
        <sphereGeometry args={[0.06, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
    </group>
  )
}

function Ils({ m }: { m: M }) {
  // Localizer array across the extended centreline beyond the far (east) end,
  // glide path mast beside the landing threshold (west end).
  const loc = WORLD_SITES.find((s) => s.id === 'ils')!.pos
  const gp = GLIDE_PATH_POS
  return (
    <group>
      <group position={siteU(loc)}>
        <mesh position={[0, 0.05, 0]} material={m.dark}>
          <boxGeometry args={[0.02, 0.02, 0.5]} />
        </mesh>
        {Array.from({ length: 12 }, (_, i) => (
          <Mast key={i} h={0.08} r={0.006} m={m.steel} at={[0, 0.05, -0.23 + (i * 0.46) / 11]} />
        ))}
        <Mast h={0.05} r={0.01} m={m.dark} at={[0, 0, -0.2]} />
        <Mast h={0.05} r={0.01} m={m.dark} at={[0, 0, 0.2]} />
      </group>
      <group position={siteU(gp)}>
        <Mast h={0.34} r={0.012} m={m.steel} />
        {[0.12, 0.2, 0.28].map((y) => (
          <Block key={y} size={[0.04, 0.03, 0.02]} at={[0, y, 0.015]} m={m.dark} />
        ))}
      </group>
    </group>
  )
}

function VorDme({ m }: { m: M }) {
  const p = WORLD_SITES.find((s) => s.id === 'dvor')!.pos
  const n = 24
  return (
    <group position={siteU(p)}>
      {/* Counterpoise on legs, the ring of Doppler antennas, the shelter and the DME mast */}
      {[0, 1, 2, 3, 4, 5].map((k) => (
        <Mast key={k} h={0.12} r={0.008} m={m.dark} at={[Math.sin((k * Math.PI) / 3) * 0.26, 0, Math.cos((k * Math.PI) / 3) * 0.26]} />
      ))}
      <mesh position={[0, 0.125, 0]} material={m.steel} receiveShadow castShadow>
        <cylinderGeometry args={[0.36, 0.36, 0.012, 48]} />
      </mesh>
      {Array.from({ length: n }, (_, k) => (
        <Mast key={k} h={0.06} r={0.004} m={m.paint} at={[Math.sin((k / n) * Math.PI * 2) * 0.3, 0.13, Math.cos((k / n) * Math.PI * 2) * 0.3]} />
      ))}
      <Block size={[0.1, 0.07, 0.1]} at={[0, 0.13, 0]} m={m.paint} />
      <Mast h={0.2} r={0.008} m={m.steel} at={[0, 0.2, 0]} />
    </group>
  )
}

function Ndb({ m, t }: { m: M; t: ThemeTokens }) {
  const p = WORLD_SITES.find((s) => s.id === 'ndb')!.pos
  const wire = useMemo(() => new THREE.MeshBasicMaterial({ color: col(t, 'stage-line'), transparent: true, opacity: 0.6 }), [t])
  return (
    <group position={siteU(p)}>
      <Mast h={0.6} r={0.012} m={m.steel} at={[-0.28, 0, 0]} />
      <Mast h={0.6} r={0.012} m={m.steel} at={[0.28, 0, 0]} />
      <mesh position={[0, 0.58, 0]} rotation-z={Math.PI / 2} material={wire}>
        <cylinderGeometry args={[0.003, 0.003, 0.56, 4]} />
      </mesh>
      <mesh position={[0, 0.34, 0]} material={wire}>
        <cylinderGeometry args={[0.003, 0.003, 0.48, 4]} />
      </mesh>
      <Block size={[0.12, 0.08, 0.1]} at={[0, 0, 0.12]} m={m.paint} />
    </group>
  )
}

function AdsbMast({ p, m, tall = 0.36 }: { p: Vec2; m: M; tall?: number }) {
  return (
    <group position={siteU(p)}>
      <Block size={[0.1, 0.07, 0.08]} at={[0.06, 0, 0]} m={m.paint} />
      <Mast h={tall} r={0.01} m={m.steel} />
      <mesh position={[0, tall + 0.03, 0]} material={m.paint}>
        <cylinderGeometry args={[0.022, 0.022, 0.06, 12]} />
      </mesh>
    </group>
  )
}

function HfStation({ m, t }: { m: M; t: ThemeTokens }) {
  const p = WORLD_SITES.find((s) => s.id === 'hf')!.pos
  const wire = useMemo(() => {
    const pts = Array.from({ length: 16 }, (_, i) => {
      const u = i / 15
      return new THREE.Vector3(-0.45 + u * 0.9, 0.78 - 0.1 * Math.sin(u * Math.PI), 0)
    })
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.003, 4, false)
  }, [])
  const wireMat = useMemo(() => new THREE.MeshBasicMaterial({ color: col(t, 'stage-line'), transparent: true, opacity: 0.6 }), [t])
  return (
    <group position={siteU(p)}>
      <Mast h={0.8} r={0.014} m={m.steel} at={[-0.45, 0, 0]} />
      <Mast h={0.8} r={0.014} m={m.steel} at={[0.45, 0, 0]} />
      <mesh geometry={wire} material={wireMat} />
      <Block size={[0.2, 0.1, 0.14]} at={[0, 0, 0.2]} m={m.paint} />
    </group>
  )
}

function SatcomDish({ m }: { m: M }) {
  const p = WORLD_SITES.find((s) => s.id === 'satcom')!.pos
  const base = siteU(p)
  // Point the dish at the geostationary satellite.
  const q = useMemo(() => {
    const dir = new THREE.Vector3(GEO_SAT[0] - base[0], GEO_SAT[1] - base[1], GEO_SAT[2] - base[2]).normalize()
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)
  }, [base])
  return (
    <group position={base}>
      <Block size={[0.14, 0.08, 0.14]} at={[0, 0, 0]} m={m.paint} />
      <Mast h={0.14} r={0.018} m={m.dark} at={[0, 0.08, 0]} />
      <group position={[0, 0.24, 0]} quaternion={q}>
        <mesh material={m.paint} rotation-x={Math.PI}>
          <sphereGeometry args={[0.16, 24, 8, 0, Math.PI * 2, 0, 0.9]} />
        </mesh>
        <Mast h={0.14} r={0.004} m={m.dark} at={[0, -0.02, 0]} />
      </group>
    </group>
  )
}

function SatelliteModel({ m, scale = 1 }: { m: M; scale?: number }) {
  return (
    <group scale={scale}>
      <mesh material={m.brass}>
        <boxGeometry args={[0.14, 0.14, 0.18]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.3, 0, 0]} material={m.glass}>
          <boxGeometry args={[0.42, 0.008, 0.14]} />
        </mesh>
      ))}
    </group>
  )
}

// ---------------------------------------------------------------------------
// Moving parts: satellites and aircraft (time runs WORLD_TIME_SCALE× faster)
// ---------------------------------------------------------------------------

/** GNSS satellites on a tilted ring high above the table (not to scale). */
function GnssSats({ m, label }: { m: M; label: React.ReactNode }) {
  const ring = useRef<THREE.Group>(null)
  useFrame((_, dt) => {
    // A real GNSS orbit takes about 12 hours; here one lap takes 3 minutes.
    if (ring.current) ring.current.rotation.y += (dt * Math.PI * 2) / 180
  })
  return (
    <group position={[0, 4.8, 0]} rotation={[0.3, 0, 0.18]}>
      <group ref={ring}>
        {[0, 1, 2, 3].map((k) => {
          const a = (k / 4) * Math.PI * 2
          return (
            <group key={k} position={[Math.cos(a) * 7, 0, Math.sin(a) * 7]}>
              <SatelliteModel m={m} scale={0.8} />
              {k === 0 && label}
            </group>
          )
        })}
      </group>
    </group>
  )
}

interface Flight {
  id: string
  /** Position (NM), altitude (ft) and heading at time s (seconds, already sped up). */
  at: (s: number) => { pos: Vec2; altFt: number; hdg: number; show: number }
}

/**
 * An aircraft on the ILS to runway 09: a 3° glide path (about 318 ft per NM)
 * down to the touchdown point abeam the glide path antenna, then it fades out.
 */
const approach: Flight = {
  id: 'approach',
  at: (s) => {
    const aimX = GLIDE_PATH_POS.x
    const startNm = 16
    const v = ktToNmPerS(150)
    const tApp = startNm / v
    const period = tApp + 60
    const u = s % period
    const d = Math.max(0, startNm - v * u)
    const fadeIn = Math.min(1, u / 20)
    const fadeOut = Math.min(1, d / 1.5)
    return { pos: { x: aimX - d, y: 0 }, altFt: 30 + d * 318, hdg: 90, show: u < tApp ? Math.min(fadeIn, fadeOut) : 0 }
  },
}

function straightFlight(id: string, from: Vec2, hdg: number, kt: number, altFt: number, lengthNm: number): Flight {
  const v = ktToNmPerS(kt)
  const period = lengthNm / v
  return {
    id,
    at: (s) => {
      const u = s % period
      const d = v * u
      const edge = Math.min(u, period - u) / 20
      return { pos: { x: from.x + Math.sin(toRad(hdg)) * d, y: from.y + Math.cos(toRad(hdg)) * d }, altFt, hdg, show: Math.min(1, edge) }
    },
  }
}

const FLIGHTS: Flight[] = [
  approach,
  straightFlight('enroute', { x: -42, y: -42 }, 45, 460, 35000, 118),
  straightFlight('turboprop', { x: 46, y: -18 }, 300, 240, 9000, 100),
]

function FlightView({ t, f, clockRef }: { t: ThemeTokens; f: Flight; clockRef: React.MutableRefObject<number> }) {
  const g = useRef<THREE.Group>(null)
  const drop = useRef<THREE.Mesh>(null)
  const dropMat = useMemo(() => new THREE.MeshBasicMaterial({ color: col(t, 'stage-line'), transparent: true, opacity: 0.3 }), [t])
  useFrame(() => {
    const st = f.at(clockRef.current)
    const [x, y, z] = toU(st.pos, st.altFt)
    const ground = groundY(st.pos)
    if (g.current) {
      g.current.position.set(x, Math.max(y, ground + 0.02), z)
      g.current.rotation.y = bearingToThreeRotationY(st.hdg)
      g.current.scale.setScalar(Math.max(0.001, st.show))
    }
    if (drop.current) {
      const h = Math.max(0.001, y - ground)
      drop.current.scale.set(1, h, 1)
      drop.current.position.set(x, ground + h / 2, z)
      dropMat.opacity = 0.3 * st.show
    }
  })
  return (
    <>
      <group ref={g}>
        <AircraftModel t={t} />
      </group>
      <mesh ref={drop} material={dropMat} userData={{ noPenPlot: true }}>
        <cylinderGeometry args={[0.005, 0.005, 1, 4]} />
      </mesh>
    </>
  )
}

/** Navaid signal rings rippling out over the ground. */
function Ripples({ t, sites }: { t: ThemeTokens; sites: Vec2[] }) {
  const refs = useRef<THREE.Mesh[]>([])
  const mats = useMemo(
    () => sites.map(() => new THREE.MeshBasicMaterial({ color: col(t, 'stage-signal'), transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending })),
    [t, sites],
  )
  useFrame((st) => {
    refs.current.forEach((mesh, i) => {
      if (!mesh) return
      const k = ((st.clock.elapsedTime + i * 1.3) % 3.2) / 3.2
      mesh.scale.setScalar(0.2 + k * 2.2)
      mats[i].opacity = 0.5 * (1 - k) ** 1.5
    })
  })
  return (
    <>
      {sites.map((p, i) => (
        <mesh key={i} ref={(el) => void (el && (refs.current[i] = el))} position={siteU(p, 0.02)} rotation-x={-Math.PI / 2} material={mats[i]} userData={{ noPenPlot: true }}>
          <ringGeometry args={[0.96, 1, 64]} />
        </mesh>
      ))}
    </>
  )
}

/** A thin, faint radar beam turning with the tower's antenna. */
function RadarSweep({ t, getAz, at }: { t: ThemeTokens; getAz: () => number; at: [number, number, number] }) {
  const g = useRef<THREE.Group>(null)
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
        uniforms: { uColor: { value: col(t, 'stage-signal') } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `varying vec2 vUv; uniform vec3 uColor; void main(){ float a = pow(1.0 - vUv.x, 1.8) * smoothstep(0.0, 0.04, vUv.x) * (1.0 - vUv.y) * 0.4; gl_FragColor = vec4(uColor * a, a); }`,
      }),
    [t],
  )
  const geo = useMemo(() => {
    const L = 7
    const gg = new THREE.PlaneGeometry(L, 2.2, 32, 1)
    gg.translate(L / 2, 0.8, 0)
    gg.rotateY(Math.PI / 2) // extend along -z from the antenna
    return gg
  }, [])
  useFrame(() => void (g.current && (g.current.rotation.y = bearingToThreeRotationY(getAz()))))
  return (
    <group ref={g} position={at}>
      <mesh geometry={geo} material={mat} userData={{ noPenPlot: true }} />
    </group>
  )
}

// ---------------------------------------------------------------------------
// Site labels (links)
// ---------------------------------------------------------------------------

function SiteLabel({
  site,
  at,
  dim,
  active,
  onHover,
  onOpen,
}: {
  site: WorldSite
  /** Position override (for labels riding on a moving object). */
  at?: [number, number, number]
  dim: boolean
  active: boolean
  onHover: (id: string | null) => void
  onOpen: (id: string) => void
}) {
  const pillar = pillarOf(site.id)
  const left = site.side === 'left'
  return (
    <Html position={at ?? siteU(site.pos, site.labelY)} zIndexRange={[5, 0]} center={false}>
      <div className={cn('flex items-center whitespace-nowrap transition-opacity duration-500', left && 'flex-row-reverse', dim ? 'opacity-20' : 'opacity-100')} style={{ transform: `translate(${left ? '-100%' : '0'}, -50%)` }}>
        <span
          aria-hidden
          className={cn(
            'block size-1.5 shrink-0 rounded-full',
            pillar === 'navigation' ? 'bg-signal shadow-[0_0_8px_var(--signal)]' : pillar === 'communication' ? 'bg-brass shadow-[0_0_8px_var(--brass)]' : 'bg-foreground',
          )}
        />
        <span aria-hidden className="block h-px w-5 bg-foreground/45 md:w-7" />
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          onPointerEnter={() => onHover(site.id)}
          onPointerLeave={() => onHover(null)}
          onClick={() => onOpen(site.id)}
          className={cn(
            'hud-panel hud-value cursor-pointer rounded-[3px] px-1 py-px text-[9px] tracking-wide text-foreground transition-colors md:px-1.5 md:py-0.5 md:text-[10.5px]',
            active ? 'border-signal text-signal' : 'hover:border-foreground/50',
            dim && 'pointer-events-none',
          )}
        >
          {site.label}
        </button>
      </div>
    </Html>
  )
}

// ---------------------------------------------------------------------------

export function WorldScene({
  t,
  filter,
  hover,
  onHover,
  onOpen,
}: {
  t: ThemeTokens
  filter: WorldFilter
  hover: string | null
  onHover: (id: string | null) => void
  onOpen: (id: string) => void
}) {
  const m = useMats(t)
  useLayoutEffect(() => () => Object.values(m).forEach((x) => x.dispose()), [m])
  const terrain = useTerrain(t)
  const { material, uniforms } = useMemo(() => makeTerrainMaterial(t), [t])
  useLayoutEffect(() => {
    // No radar sweep glow on the home table.
    uniforms.uGlow.value = new THREE.Color(0, 0, 0)
    return () => material.dispose()
  }, [material, uniforms])
  const clock = useRef(0)
  useFrame((_, dt) => void (clock.current += Math.min(dt, 0.1) * WORLD_TIME_SCALE))
  const radarPos = WORLD_SITES[0].pos
  // A 4.8 s approach-radar turn, at real speed so it reads as a radar.
  const radarAz = () => ((performance.now() / 1000) * (360 / 4.8)) % 360
  const lineColor = useMemo(() => col(t, 'stage-line'), [t])
  const isDim = (id: string) => filter !== 'all' && pillarOf(id) !== filter && pillarOf(id) !== 'integration'
  return (
    <group>
      <StudioFloor t={t} y={FLOOR_Y} shadowScale={30} />
      <DioramaTable t={t} />
      <mesh geometry={terrain} material={material} receiveShadow userData={{ noPenPlot: true }} />
      <PenPlot color={lineColor} durationS={2.2}>
        <Airport t={t} m={m} />
        <group position={siteU(radarPos)} scale={HOME_RADAR_SCALE}>
          <RadarTower t={t} getAzimuthDeg={radarAz} position={[0, 0, 0]} />
        </group>
        <ControlTower m={m} />
        <SurfaceRadar m={m} />
        <ControlCentre m={m} />
        <Ils m={m} />
        <VorDme m={m} />
        <Ndb m={m} t={t} />
        <AdsbMast p={WORLD_SITES.find((s) => s.id === 'ads')!.pos} m={m} />
        <AdsbMast p={WORLD_SITES.find((s) => s.id === 'mlat')!.pos} m={m} tall={0.24} />
        {MLAT_RX.map((p, i) => (
          <AdsbMast key={i} p={p} m={m} tall={0.24} />
        ))}
        <HfStation m={m} t={t} />
        <SatcomDish m={m} />
      </PenPlot>
      <RadarSweep t={t} getAz={radarAz} at={siteU(radarPos, ANTENNA_Y * HOME_RADAR_SCALE)} />
      <Ripples t={t} sites={RIPPLE_SITES} />
      <GnssSats
        m={m}
        label={<SiteLabel site={GNSS_SITE} at={[0, 0.25, 0]} dim={isDim('gnss')} active={hover === 'gnss'} onHover={onHover} onOpen={onOpen} />}
      />
      <group position={GEO_SAT}>
        <SatelliteModel m={m} />
      </group>
      {FLIGHTS.map((f) => (
        <FlightView key={f.id} t={t} f={f} clockRef={clock} />
      ))}
      {WORLD_SITES.map((s) => (
        <SiteLabel key={s.id} site={s} dim={isDim(s.id)} active={hover === s.id} onHover={onHover} onOpen={onOpen} />
      ))}
    </group>
  )
}

export default WorldScene
