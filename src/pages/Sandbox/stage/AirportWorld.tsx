/**
 * The airport as a digital twin at true scale (1 unit = 1 m): the airfield
 * painted by the Surface Movement module's drawing code, a glass terminal,
 * the hangar, the control tower with its surface movement radar, the ILS
 * antennas, airfield lights, parked aircraft, the people and vehicles, and
 * CNS700 itself. Everything moving is read from the Sandbox engine each frame.
 */
import { useLayoutEffect, useMemo, useRef, type MutableRefObject, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Grid } from '@react-three/drei'
import * as THREE from 'three'
import { bearingToThreeRotationY, type Vec2 } from '@/core/geometry'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { mix, toThreeStyle, withAlpha } from '@/lib/color'
import { col } from '@/stage/Stage'
import { Callout3D } from '@/stage/Callout3D'
import { useSampled } from '@/hooks/useSampled'
import { drawAirport } from '@/modules/surface/draw'
import { CAR_PARK, HANGAR, RWY, SMR_HEIGHT_M, STANDS, TERMINAL, TOWER_POS, type ConnectorId } from '@/modules/surface/layout'
import { BOUNDS } from '@/modules/surface/heroScale'
import type { SandboxEngine } from '../engine'
import { bankDeg, exteriorLights, gearDown, stepPitch, targetPitchDeg } from '../aircraftState'
import { contextFor, type VehicleContext } from '../agents'
import { clearOfRunway } from '../ground'
import { FIRST_RETURN_LEG, GPIP_X, GS_ANGLE_DEG } from '../journey'
import { ILS09 } from '../systems'
import { aglM, GROUND_RADIUS_M, toJ } from '../jscale'
import { Airliner, PARKED_STATE, type AirlinerState } from './Airliner'
import { AirfieldLights, PAPI_UNITS } from './AirfieldLights'
import { Crowd } from './Crowd'
import { Vehicles } from './Vehicles'


// ---------------------------------------------------------------------------
// Ground and airfield
// ---------------------------------------------------------------------------

function useAirfieldTexture(t: ThemeTokens, highRes: boolean) {
  return useMemo(() => {
    const cw = highRes ? 4096 : 2048
    const k = cw / (BOUNDS.maxX - BOUNDS.minX)
    const ch = Math.round((BOUNDS.maxY - BOUNDS.minY) * k)
    const c = document.createElement('canvas')
    c.width = cw
    c.height = ch
    const ctx = c.getContext('2d')!
    const toS = (p: Vec2) => ({ x: (p.x - BOUNDS.minX) * k, y: (BOUNDS.maxY - p.y) * k })
    const grass = mix(t['stage-floor'], t['stage-terrain'], 0.22)
    ctx.fillStyle = toThreeStyle(grass)
    ctx.fillRect(0, 0, cw, ch)
    drawAirport(ctx, toS, k, {
      grass,
      runway: toThreeStyle(mix(t['stage-metal-dark'], t['stage-bg'], 0.25)),
      taxiway: toThreeStyle(mix(t['stage-metal-dark'], t['stage-metal'], 0.7)),
      marking: toThreeStyle(t['stage-paint']),
      guideLine: withAlpha(toThreeStyle(t['stage-brass']), 0.9),
      building: toThreeStyle(t['stage-metal-dark']),
      buildingEdge: withAlpha(toThreeStyle(t['stage-line']), 0.4),
      road: toThreeStyle(mix(t['stage-metal'], t['stage-floor'], 0.45)),
      text: toThreeStyle(t['stage-line']),
      muted: toThreeStyle(t['stage-line']),
    })
    // Car park bays behind the terminal.
    ctx.save()
    ctx.strokeStyle = withAlpha(toThreeStyle(t['stage-line']), 0.2)
    ctx.lineWidth = Math.max(1, k * 1.2)
    for (let y = CAR_PARK.minY + 40; y < CAR_PARK.maxY - 20; y += 60) {
      const p = toS({ x: CAR_PARK.minX + 20, y })
      const q = toS({ x: CAR_PARK.maxX - 20, y })
      ctx.beginPath()
      ctx.moveTo(p.x, p.y)
      ctx.lineTo(q.x, q.y)
      ctx.stroke()
    }
    ctx.restore()
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 8
    return tex
  }, [t, highRes])
}

function Ground({ t, highRes }: { t: ThemeTokens; highRes: boolean }) {
  const tex = useAirfieldTexture(t, highRes)
  useLayoutEffect(() => () => tex.dispose(), [tex])
  const w = BOUNDS.maxX - BOUNDS.minX
  const d = BOUNDS.maxY - BOUNDS.minY
  const [cx, , cz] = toJ({ x: (BOUNDS.minX + BOUNDS.maxX) / 2, y: (BOUNDS.minY + BOUNDS.maxY) / 2 })
  const groundCol = useMemo(() => col(t, 'stage-floor').lerp(col(t, 'stage-terrain'), 0.18), [t])
  return (
    <group userData={{ noPenPlot: true }}>
      {/* The country around the airport: a dark plain with a fading survey grid. A finite grid:
          drei's "infinite" grid scales its plane by the fade distance, which at this scale costs
          float precision and lets the grid show through the airfield. */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -2.5, 0]}>
        <circleGeometry args={[GROUND_RADIUS_M, 96]} />
        <meshStandardMaterial color={groundCol} roughness={0.95} metalness={0.02} />
      </mesh>
      <Grid
        position={[0, -2.2, 0]}
        args={[GROUND_RADIUS_M, GROUND_RADIUS_M]}
        cellSize={100}
        cellThickness={0.4}
        cellColor={toThreeStyle(mix(t['stage-line'], t['stage-floor'], 0.55))}
        sectionSize={1000}
        sectionThickness={0.8}
        sectionColor={toThreeStyle(mix(t['stage-line'], t['stage-floor'], 0.35))}
        fadeDistance={3200}
        fadeStrength={1.2}
      />
      {/* The airfield itself. */}
      <mesh rotation-x={-Math.PI / 2} position={[cx, 0, cz]} renderOrder={1}>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial map={tex} emissiveMap={tex} emissive={col(t, 'stage-paint')} emissiveIntensity={0.22} roughness={0.92} metalness={0.02} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
      </mesh>
    </group>
  )
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

function boxAt(b: { minX: number; maxX: number; minY: number; maxY: number }, h: number) {
  const [x, , z] = toJ({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 })
  return { position: [x, h / 2, z] as [number, number, number], size: [b.maxX - b.minX, h, b.maxY - b.minY] as [number, number, number] }
}

/** A box drawn with glowing edges: the digital-twin look. */
function EdgedBox({ size, position, material, edge }: { size: [number, number, number]; position: [number, number, number]; material: THREE.Material; edge: THREE.LineBasicMaterial }) {
  const geo = useMemo(() => new THREE.BoxGeometry(...size), [size])
  const edges = useMemo(() => new THREE.EdgesGeometry(geo), [geo])
  useLayoutEffect(
    () => () => {
      geo.dispose()
      edges.dispose()
    },
    [geo, edges],
  )
  return (
    <group position={position}>
      <mesh geometry={geo} material={material} />
      <lineSegments geometry={edges} material={edge} />
    </group>
  )
}

function Buildings({ t, engine }: { t: ThemeTokens; engine: SandboxEngine }) {
  const m = useMemo(
    () => ({
      glass: new THREE.MeshPhysicalMaterial({ color: col(t, 'stage-glass'), emissive: col(t, 'stage-glass'), emissiveIntensity: 0.18, transparent: true, opacity: 0.26, roughness: 0.1, metalness: 0.2, depthWrite: false, side: THREE.DoubleSide }),
      floor: new THREE.MeshStandardMaterial({ color: col(t, 'stage-paint').lerp(col(t, 'stage-metal'), 0.55), emissive: col(t, 'stage-paint'), emissiveIntensity: 0.08, roughness: 0.8 }),
      roof: new THREE.MeshStandardMaterial({ color: col(t, 'stage-metal-dark').lerp(col(t, 'stage-metal'), 0.5), roughness: 0.6, metalness: 0.5 }),
      solid: new THREE.MeshStandardMaterial({ color: col(t, 'stage-metal-dark').lerp(col(t, 'stage-metal'), 0.4), roughness: 0.6, metalness: 0.4 }),
      paint: new THREE.MeshStandardMaterial({ color: col(t, 'stage-paint'), roughness: 0.45, metalness: 0.3 }),
      edge: new THREE.LineBasicMaterial({ color: col(t, 'stage-signal'), transparent: true, opacity: 0.85, toneMapped: false }),
      edgeDim: new THREE.LineBasicMaterial({ color: col(t, 'stage-line'), transparent: true, opacity: 0.35 }),
      brass: new THREE.MeshStandardMaterial({ color: col(t, 'stage-brass'), roughness: 0.35, metalness: 0.8 }),
    }),
    [t],
  )
  useLayoutEffect(() => () => Object.values(m).forEach((x) => x.dispose()), [m])
  const term = boxAt(TERMINAL, 20)
  const hangar = boxAt(HANGAR, 25)
  const [tx, , tz] = toJ(TOWER_POS)
  const smr = useRef<THREE.Group>(null)
  const blur = useRef<THREE.Mesh>(null)
  const last = useRef({ t: 0, az: 0 })
  useFrame(() => {
    // The surface movement radar turns once a second of simulated time. When time-lapse makes it
    // turn faster than the eye can follow, a faint disc stands in for the blurred antenna.
    const now = engine.timeS
    const az = ((now % 1) + 1) % 1
    const step = Math.abs(now - last.current.t) * 360
    last.current = { t: now, az }
    const blurred = step > 45
    if (smr.current) {
      smr.current.visible = !blurred
      smr.current.rotation.y = -az * Math.PI * 2
    }
    if (blur.current) blur.current.visible = blurred
  })
  return (
    <group>
      {/* Terminal: glass walls, a floor slab and a roof, so the people inside are visible. */}
      <mesh position={[term.position[0], 0.3, term.position[2]]} material={m.floor}>
        <boxGeometry args={[term.size[0], 0.6, term.size[2]]} />
      </mesh>
      <EdgedBox size={term.size} position={term.position} material={m.glass} edge={m.edge} />
      <mesh position={[term.position[0], 20.4, term.position[2]]} material={m.roof}>
        <boxGeometry args={[term.size[0] + 4, 0.8, term.size[2] + 6]} />
      </mesh>
      <EdgedBox size={hangar.size} position={hangar.position} material={m.solid} edge={m.edgeDim} />
      {/* Control tower: shaft, glass cab (controllers inside), roof and the surface movement radar. */}
      <group position={[tx, 0, tz]}>
        <mesh position={[0, 23, 0]} material={m.paint}>
          <cylinderGeometry args={[3.6, 4.8, 46, 20]} />
        </mesh>
        <mesh position={[0, 46.3, 0]} material={m.roof}>
          <cylinderGeometry args={[8.2, 6.2, 0.6, 8]} />
        </mesh>
        <mesh position={[0, 50.8, 0]} material={m.glass}>
          <cylinderGeometry args={[8.2, 7.4, 8.4, 8, 1, true]} />
        </mesh>
        <mesh position={[0, 55.3, 0]} material={m.roof}>
          <cylinderGeometry args={[8.8, 8.2, 0.6, 8]} />
        </mesh>
        <mesh position={[0, (55.6 + SMR_HEIGHT_M) / 2, 0]} material={m.roof}>
          <cylinderGeometry args={[0.35, 0.5, SMR_HEIGHT_M - 55.6, 10]} />
        </mesh>
        <group ref={smr} position={[0, SMR_HEIGHT_M, 0]}>
          <mesh material={m.paint}>
            <boxGeometry args={[6.5, 0.6, 0.45]} />
          </mesh>
          <mesh position={[0, 0, -0.26]} material={m.brass}>
            <boxGeometry args={[6.3, 0.35, 0.06]} />
          </mesh>
        </group>
        <mesh ref={blur} position={[0, SMR_HEIGHT_M, 0]} rotation-x={-Math.PI / 2} visible={false}>
          <circleGeometry args={[3.3, 32]} />
          <meshBasicMaterial color={col(t, 'stage-paint')} transparent opacity={0.18} depthWrite={false} />
        </mesh>
      </group>
    </group>
  )
}

/** ILS antennas, the PAPI units and the approach light stands. */
function NavAids({ t }: { t: ThemeTokens }) {
  const m = useMemo(
    () => ({
      mast: new THREE.MeshStandardMaterial({ color: col(t, 'stage-paint'), roughness: 0.5, metalness: 0.5 }),
      box: new THREE.MeshStandardMaterial({ color: col(t, 'stage-metal-dark'), roughness: 0.6, metalness: 0.5 }),
    }),
    [t],
  )
  useLayoutEffect(() => () => Object.values(m).forEach((x) => x.dispose()), [m])
  const loc = { x: ILS09.locAntenna.x * 1852, y: ILS09.locAntenna.y * 1852 }
  const gs = { x: ILS09.gsAntenna.x * 1852, y: ILS09.gsAntenna.y * 1852 }
  return (
    <group>
      {/* Localizer: a row of antennas beyond the far end of the runway. */}
      {Array.from({ length: 14 }, (_, i) => (
        <mesh key={i} material={m.mast} position={toJ({ x: loc.x, y: -22 + i * (44 / 13) }, 1.6)}>
          <boxGeometry args={[0.25, 3.2, 0.25]} />
        </mesh>
      ))}
      <mesh material={m.box} position={toJ({ x: loc.x + 18, y: 0 }, 1.5)}>
        <boxGeometry args={[4, 3, 3]} />
      </mesh>
      {/* Glideslope: one mast beside the touchdown zone. */}
      <mesh material={m.mast} position={toJ(gs, 8)}>
        <cylinderGeometry args={[0.25, 0.35, 16, 8]} />
      </mesh>
      <mesh material={m.box} position={toJ({ x: gs.x + 6, y: gs.y }, 1.3)}>
        <boxGeometry args={[3, 2.6, 2.4]} />
      </mesh>
      {PAPI_UNITS.map((p, i) => (
        <mesh key={i} material={m.box} position={toJ(p, 0.4)}>
          <boxGeometry args={[1.2, 0.8, 1.6]} />
        </mesh>
      ))}
    </group>
  )
}

/** The ILS beams as a faint overlay: the localizer course and the 3° glide path. */
function IlsOverlay({ t, engine }: { t: ThemeTokens; engine: SandboxEngine }) {
  const g = useRef<THREE.Group>(null)
  const geo = useMemo(() => {
    const far = 26000
    const gpip = GPIP_X * 1852
    const tan = Math.tan((GS_ANGLE_DEG * Math.PI) / 180)
    const pts: number[] = []
    // Glide path: a dashed line from the touchdown point up the 3° slope.
    for (let d = 0; d < far; d += 240) {
      pts.push(...toJ({ x: gpip - d, y: 0 }, d * tan), ...toJ({ x: gpip - d - 150, y: 0 }, (d + 150) * tan))
    }
    const line = new THREE.BufferGeometry()
    line.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    // Localizer course: a thin wedge on the ground widening away from the antenna.
    const loc = ILS09.locAntenna.x * 1852
    const half = Math.tan((2.5 * Math.PI) / 180)
    const wedge = new THREE.BufferGeometry()
    const a = toJ({ x: loc, y: 0 }, 0.3)
    const b = toJ({ x: loc - far, y: far * half }, 0.3)
    const c = toJ({ x: loc - far, y: -far * half }, 0.3)
    wedge.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...c, ...b], 3))
    return { line, wedge }
  }, [])
  useLayoutEffect(
    () => () => {
      geo.line.dispose()
      geo.wedge.dispose()
    },
    [geo],
  )
  useFrame(() => {
    const p = engine.phase
    if (g.current) g.current.visible = p === 'approach' || p === 'landing'
  })
  return (
    <group ref={g} visible={false} userData={{ noPenPlot: true }}>
      <lineSegments geometry={geo.line}>
        <lineBasicMaterial color={col(t, 'stage-signal')} transparent opacity={0.75} toneMapped={false} />
      </lineSegments>
      <mesh geometry={geo.wedge} renderOrder={2}>
        <meshBasicMaterial color={col(t, 'stage-signal')} transparent opacity={0.035} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
    </group>
  )
}

// ---------------------------------------------------------------------------
// CNS700
// ---------------------------------------------------------------------------

function Cns700({ t, engine, reduced, pixelRatio }: { t: ThemeTokens; engine: SandboxEngine; reduced: boolean; pixelRatio: number }) {
  const ref = useRef<THREE.Group>(null)
  const state = useRef<AirlinerState>({ ...PARKED_STATE })
  const att = useRef({ pitch: 0, bank: 0, lastT: -1 })
  useFrame(() => {
    const a = engine.journeyAircraft
    const pose = engine.journeyPose()
    const g = ref.current
    if (!a?.journey || !pose || !g) return
    const j = a.journey
    const dt = att.current.lastT < 0 ? 0 : Math.max(0, Math.min(10, engine.timeS - att.current.lastT))
    att.current.lastT = engine.timeS
    const onGround = j.ground != null
    const target = targetPitchDeg(j.phase, pose.speedKt, pose.verticalSpeedFpm)
    att.current.pitch = dt === 0 && onGround ? target : stepPitch(att.current.pitch, target, dt)
    const bankWant = bankDeg(pose.speedKt, engine.journeyTurnRateDegS(), !onGround)
    att.current.bank = stepPitch(att.current.bank, bankWant, dt * 3)
    g.position.set(pose.posM.x, aglM(pose.altitudeFt), -pose.posM.y)
    g.rotation.order = 'YXZ'
    g.rotation.set((att.current.pitch * Math.PI) / 180, bearingToThreeRotationY(pose.headingDeg), (-att.current.bank * Math.PI) / 180)
    const onRunway = onGround && !clearOfRunway(pose.posM)
    state.current.gear = gearDown(j.phase, pose.altitudeFt, j.legIndex >= FIRST_RETURN_LEG)
    state.current.lights = exteriorLights(j.phase, pose.altitudeFt, onRunway)
  })
  return <Airliner ref={ref} t={t} stateRef={state} reduced={reduced} pixelRatio={pixelRatio} accent="signal" />
}

const PARKED: (keyof typeof STANDS)[] = ['S1', 'S2', 'S4', 'S5']

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

function Labels({ engine, active, labels }: { engine: SandboxEngine; active: boolean; labels: RefObject<HTMLElement> }) {
  const phase = useSampled(() => engine.phase, 300)
  const tag = useSampled(
    () => {
      const p = engine.journeyPose()
      if (!p) return null
      const alt = Math.round(p.altitudeFt / 10) * 10
      return {
        pos: toJ(p.posM, aglM(p.altitudeFt) + 16) as [number, number, number],
        text: `CNS700 · ${alt < 100 ? 'on the ground' : `${alt.toLocaleString('en-US')} ft`} · ${Math.round(p.speedKt)} kt`,
      }
    },
    200,
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  )
  // Labels stay mounted (drei's Html must not unmount mid-render) and are hidden when not relevant.
  // On a narrow view only CNS700's own tag is shown, so the place names do not crowd the HUD.
  const roomy = useThree((s) => s.size.width) >= 640
  const onAirport = active && roomy && (phase === 'gate' || phase === 'pushback' || phase === 'taxi' || phase === 'taxiIn' || phase === 'arrived')
  const onRunway = active && roomy && (phase === 'takeoff' || phase === 'landing')
  const a1: ConnectorId = 'A1'
  return (
    <>
      <Callout3D portal={labels} position={tag?.pos ?? [0, 0, 0]} tone="signal" lead={18} hidden={!active || !tag}>
        {tag?.text ?? 'CNS700'}
      </Callout3D>
      <Callout3D portal={labels} position={toJ({ x: STANDS.S3.x + 45, y: TERMINAL.minY + 5 }, 24)} lead={14} hidden={!onAirport}>
        Terminal · gate S3
      </Callout3D>
      <Callout3D portal={labels} position={toJ(TOWER_POS, 62)} side="left" lead={14} hidden={!onAirport}>
        Tower · surface radar
      </Callout3D>
      <Callout3D portal={labels} position={toJ({ x: -1470, y: 90 }, 4)} tone="alert" side="left" lead={16} hidden={!active || !roomy || phase !== 'taxi'}>
        {`Stop bar · holding point ${a1}`}
      </Callout3D>
      <Callout3D portal={labels} position={toJ({ x: RWY.thresholdX + 150, y: -30 }, 3)} side="left" lead={14} hidden={!onRunway}>
        Runway 09
      </Callout3D>
      <Callout3D portal={labels} position={toJ(PAPI_UNITS[0], 4)} tone="brass" lead={14} hidden={!onRunway}>
        PAPI
      </Callout3D>
      <Callout3D portal={labels} position={toJ({ x: ILS09.locAntenna.x * 1852, y: 0 }, 6)} tone="brass" lead={14} hidden={!onRunway}>
        ILS localizer
      </Callout3D>
      <Callout3D portal={labels} position={toJ({ x: ILS09.gsAntenna.x * 1852, y: ILS09.gsAntenna.y * 1852 }, 18)} tone="brass" side="left" lead={14} hidden={!onRunway}>
        Glide path antenna
      </Callout3D>
    </>
  )
}

// ---------------------------------------------------------------------------
// The world
// ---------------------------------------------------------------------------

export function AirportWorld({ t, engine, active, reduced, pixelRatio, highRes, labels }: { t: ThemeTokens; engine: SandboxEngine; active: boolean; reduced: boolean; pixelRatio: number; highRes: boolean; labels: RefObject<HTMLElement> }) {
  const ctxRef = useRef<VehicleContext | null>(null) as MutableRefObject<VehicleContext | null>
  useFrame(() => {
    if (!active) {
      ctxRef.current = null
      return
    }
    const a = engine.journeyAircraft
    const pose = engine.journeyPose()
    ctxRef.current = a?.journey && pose ? contextFor(a, engine.timeS, engine.journeyDisplayElapsedS(), { posM: pose.posM, headingDeg: pose.headingDeg }) : null
  }, -1)
  return (
    <group visible={active} userData={{ world: 'airport' }}>
      <Ground t={t} highRes={highRes} />
      <Buildings t={t} engine={engine} />
      <NavAids t={t} />
      <AirfieldLights t={t} engine={engine} pixelRatio={pixelRatio} reduced={reduced} />
      <IlsOverlay t={t} engine={engine} />
      {PARKED.map((id) => (
        <group key={id} position={toJ(STANDS[id])}>
          <Airliner t={t} pixelRatio={pixelRatio} reduced={reduced} />
        </group>
      ))}
      <Cns700 t={t} engine={engine} reduced={reduced} pixelRatio={pixelRatio} />
      <Crowd t={t} ctxRef={ctxRef} reduced={reduced} />
      <Vehicles t={t} ctxRef={ctxRef} />
      <Labels engine={engine} active={active} labels={labels} />
    </group>
  )
}
