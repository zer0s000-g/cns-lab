/**
 * The terminal-area view: the 60 NM terrain table with every ground site from
 * `systems.ts`, both radars turning with the engine's antenna azimuths, all
 * aircraft on the table, the safety-net alerts, the 40 NM terminal control
 * area, and CNS700 highlighted with its trail, its planned route and live
 * data links to the ground systems that are tracking it right now.
 * Everything is read from the SandboxEngine each frame; the stage has no
 * physics of its own. Sites switched off (or failed by a scenario) show a red
 * lamp.
 */
import { useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Grid } from '@react-three/drei'
import * as THREE from 'three'
import { bearingToThreeRotationY, distanceNm, toRad, type Vec2 } from '@/core/geometry'
import { siteSees } from '@/core/coverage'
import { isWater, terrainElevationFt, terrainFn } from '@/core/world'
import { useSampled } from '@/hooks/useSampled'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { toThreeStyle } from '@/lib/color'
import { Callout3D } from '@/stage/Callout3D'
import { AircraftModel, DioramaTable, FLOOR_Y, RadarTower, S, TABLE_RADIUS_NM, V, makeTerrainMaterial, toU, useTerrain } from '@/stage/Diorama'
import { PenPlot } from '@/stage/PenPlot'
import { col } from '@/stage/Stage'
import { Wire3D, type WireHandle } from '@/stage/Wire3D'
import { JAMMER, type SandboxEngine } from '../engine'
import { ADSB_RANGE_NM, ADSB_SITES, ALL_SITES, APPROACH_RADAR_SITE, ENROUTE_RADAR_SITE, ILS09, MLAT_RANGE_NM, MLAT_SITES, SSR_RANGE_APP_NM, SSR_RANGE_ENR_NM, VHF_RANGE_NM, VHF_SITES, type SiteDef, type SystemId } from '../systems'
import { JOURNEY, TMA_RADIUS_NM } from '../journey'
import { JOURNEY_ID } from '../phases'

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
      signal: new THREE.MeshBasicMaterial({ color: col(t, 'stage-signal'), transparent: true, opacity: 0.6, toneMapped: false }),
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
function Jammer({ t, engine, active, labels }: { t: ThemeTokens; engine: SandboxEngine; active: boolean; labels: RefObject<HTMLElement> }) {
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
    if (label.current) label.current.style.display = on && active ? '' : 'none'
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
      <Callout3D portal={labels} position={[0, 0.12, 0]} tone="alert" rootRef={label}>
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
  const isJourney = id === JOURNEY_ID
  useFrame((st) => {
    const a = engine.getAircraft(id)
    // CNS700 is drawn from its smoothed pose; the others from the engine directly.
    const pose = isJourney ? engine.journeyPose() : null
    const pos = pose?.pos ?? a?.pos
    const alt = pose?.altitudeFt ?? a?.altitudeFt ?? 0
    const hdg = pose?.headingDeg ?? a?.headingDeg ?? 0
    const on = Boolean(a && pos) && distanceNm(pos!, { x: 0, y: 0 }) <= TABLE_RADIUS_NM
    if (g.current) g.current.visible = on
    if (drop.current) drop.current.visible = on
    if (!a || !pos || !on) {
      if (alert.current) alert.current.visible = false
      return
    }
    const [x, y, z] = toU(pos, alt)
    const ground = groundY(pos)
    g.current!.position.set(x, Math.max(y, ground + 0.02), z)
    g.current!.rotation.y = bearingToThreeRotationY(hdg)
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
        <group scale={isJourney ? 1.1 : 0.8}>
          <AircraftModel t={t} dim={!isJourney} />
        </group>
      </group>
      <mesh ref={drop} material={isJourney ? m.signal : m.line} userData={{ noPenPlot: true }}>
        <cylinderGeometry args={[isJourney ? 0.007 : 0.004, isJourney ? 0.007 : 0.004, 1, 4]} />
      </mesh>
      <mesh ref={alert} rotation-x={-Math.PI / 2} material={alertMat} visible={false} userData={{ noPenPlot: true }}>
        <ringGeometry args={[0.9, 1, 48]} />
      </mesh>
    </>
  )
}

/** The terminal control area: Departure and Approach inside, Area control outside. */
function TmaRing({ t }: { t: ThemeTokens }) {
  const r = TMA_RADIUS_NM * S
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, 0.9, 0]} userData={{ noPenPlot: true }}>
      <ringGeometry args={[r - 0.025, r + 0.025, 160]} />
      <meshBasicMaterial color={col(t, 'stage-brass')} transparent opacity={0.55} depthWrite={false} toneMapped={false} />
    </mesh>
  )
}

/** CNS700's planned route on the table (dashed), clipped at the rim. */
function PlannedRoute({ t }: { t: ThemeTokens }) {
  const geo = useMemo(() => {
    const pts: number[] = []
    let prev: Vec2 = { x: 0, y: 0 }
    for (const leg of JOURNEY) {
      const n = Math.max(2, Math.ceil(distanceNm(prev, leg.to) / 1.2))
      for (let i = 0; i < n; i += 2) {
        const a = { x: prev.x + ((leg.to.x - prev.x) * i) / n, y: prev.y + ((leg.to.y - prev.y) * i) / n }
        const b = { x: prev.x + ((leg.to.x - prev.x) * (i + 1)) / n, y: prev.y + ((leg.to.y - prev.y) * (i + 1)) / n }
        if (Math.hypot(a.x, a.y) > TABLE_RADIUS_NM - 1 || Math.hypot(b.x, b.y) > TABLE_RADIUS_NM - 1) continue
        pts.push(...toU(a, 0), ...toU(b, 0))
      }
      prev = leg.to
    }
    for (let i = 0; i < pts.length; i += 3) pts[i + 1] = groundYAt(pts[i], pts[i + 2]) + 0.03
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [])
  useLayoutEffect(() => () => geo.dispose(), [geo])
  return (
    <lineSegments geometry={geo} userData={{ noPenPlot: true }}>
      <lineBasicMaterial color={col(t, 'stage-signal')} transparent opacity={0.45} toneMapped={false} />
    </lineSegments>
  )
}

/** Height of the table surface under a scene point. */
function groundYAt(x: number, z: number) {
  return groundY({ x: x / S, y: -z / S })
}

const TRAIL = 90
/** Where CNS700 has been: a fading line of its last positions. */
function Trail({ t, engine }: { t: ThemeTokens; engine: SandboxEngine }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(TRAIL * 3), 3))
    g.setDrawRange(0, 0)
    return g
  }, [])
  const line = useMemo(() => {
    const l = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: col(t, 'stage-signal'), transparent: true, opacity: 0.8, toneMapped: false }))
    l.frustumCulled = false
    l.userData.noPenPlot = true
    return l
  }, [geo, t])
  useLayoutEffect(() => () => geo.dispose(), [geo])
  useLayoutEffect(() => () => (line.material as THREE.Material).dispose(), [line])
  const pts = useRef<[number, number, number][]>([])
  const next = useRef({ run: -1, t: -Infinity })
  useFrame(() => {
    const p = engine.journeyPose()
    if (!p) return
    if (next.current.run !== engine.runId) {
      pts.current = []
      next.current = { run: engine.runId, t: -Infinity }
    }
    // A point every 5 s of simulated time.
    if (engine.timeS - next.current.t >= 5 || engine.timeS < next.current.t) {
      next.current.t = engine.timeS
      pts.current.push(toU(p.pos, p.altitudeFt))
      if (pts.current.length > TRAIL) pts.current.shift()
    }
    const attr = geo.attributes.position as THREE.BufferAttribute
    const all = [...pts.current, toU(p.pos, p.altitudeFt)]
    const n = Math.min(TRAIL, all.length)
    for (let i = 0; i < n; i++) attr.setXYZ(i, ...all[all.length - n + i])
    attr.needsUpdate = true
    geo.setDrawRange(0, n)
  })
  return <primitive object={line} />
}

const terrain = terrainFn()
const RADARS = [
  { site: APPROACH_RADAR_SITE, range: SSR_RANGE_APP_NM, sys: 'radarApp' as const, up: 1.25 * 0.55 * 0.82 * 1.9 },
  { site: ENROUTE_RADAR_SITE, range: SSR_RANGE_ENR_NM, sys: 'radarEnr' as const, up: 1.25 * 0.55 * 0.82 * 1.9 },
]

/**
 * Live data links: a glowing line from CNS700 to each ground system that is
 * feeding its track right now (radars when their beam paints it, ADS-B and
 * multilateration receivers), and to the VHF site while a radio call is on air.
 */
function DataLinks({ t, engine }: { t: ThemeTokens; engine: SandboxEngine }) {
  const wires = useRef<(WireHandle | null)[]>([])
  const colors = useMemo(() => ({ surv: col(t, 'stage-signal'), comm: col(t, 'stage-brass') }), [t])
  const n = RADARS.length + ADSB_SITES.length + MLAT_SITES.length + VHF_SITES.length
  useFrame(() => {
    const p = engine.journeyPose()
    const tr = engine.tracks.get(JOURNEY_ID)
    let w = 0
    const link = (site: { pos: Vec2; heightFt: number }, fresh: number, up = 0.06) => {
      const h = wires.current[w++]
      if (!h || !p) return
      const [sx, , sz] = toU(site.pos)
      h.set([sx, groundY(site.pos) + up, sz], toU(p.pos, p.altitudeFt), 0)
      h.setOpacity(0.25 + 0.6 * fresh)
      h.setVisible(true)
    }
    const hideRest = (upTo: number) => {
      while (w < upTo) wires.current[w++]?.setVisible(false)
    }
    const now = engine.timeS
    const age = (k: 'psr' | 'ssr' | 'adsb' | 'mlat') => (tr?.lastBySource[k] !== undefined ? now - tr.lastBySource[k]! : Infinity)
    // A link glows brightly just after a report and fades until the next one.
    const glow = (a: number, period: number) => (a < period * 1.6 ? Math.max(0, 1 - a / period) : -1)
    let limit = RADARS.length
    if (p) {
      for (const r of RADARS) {
        const g = glow(Math.min(age('ssr'), age('psr')), r.sys === 'radarApp' ? 4.8 : 12)
        if (g >= 0 && engine.systemUp(r.sys) && siteSees(r.site, p.pos, p.altitudeFt, terrain, r.range)) link(r.site, g, r.up)
      }
    }
    hideRest(limit)
    limit += ADSB_SITES.length
    if (p) {
      const g = glow(age('adsb'), 0.6)
      if (g >= 0) for (const s of ADSB_SITES) if (siteSees(s, p.pos, p.altitudeFt, terrain, ADSB_RANGE_NM)) link(s, g, 0.35)
    }
    hideRest(limit)
    limit += MLAT_SITES.length
    if (p) {
      const g = glow(age('mlat'), 1.2)
      if (g >= 0) for (const s of MLAT_SITES) if (siteSees(s, p.pos, p.altitudeFt, terrain, MLAT_RANGE_NM)) link(s, g, 0.24)
    }
    hideRest(limit)
    limit += VHF_SITES.length
    const talking = engine.radio[0] && engine.radio[0].medium === 'vhf' && !engine.radio[0].earlier && now - engine.radio[0].timeS < 6
    if (p && talking) {
      const g = 1 - (now - engine.radio[0].timeS) / 6
      for (const s of VHF_SITES) if (siteSees(s, p.pos, p.altitudeFt, terrain, VHF_RANGE_NM)) link(s, g, 0.44)
    }
    hideRest(limit)
  })
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <Wire3D
          key={i}
          ref={(el) => void (wires.current[i] = el)}
          color={i >= n - VHF_SITES.length ? colors.comm : colors.surv}
          radius={0.012}
          dash={i >= RADARS.length + ADSB_SITES.length && i < n - VHF_SITES.length ? 0.12 : 0}
        />
      ))}
    </>
  )
}

/** A plain studio floor (no baked contact shadow, which would be wrong while this view is hidden). */
function Floor({ t }: { t: ThemeTokens }) {
  return (
    <group position={[0, FLOOR_Y, 0]} userData={{ noPenPlot: true }}>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.01, 0]}>
        <circleGeometry args={[80, 64]} />
        <meshStandardMaterial color={col(t, 'stage-floor')} roughness={0.92} metalness={0.05} />
      </mesh>
      <Grid
        position={[0, 0.005, 0]}
        args={[160, 160]}
        cellSize={1}
        cellThickness={0.5}
        cellColor={toThreeStyle(t['stage-line'])}
        sectionSize={5}
        sectionThickness={0.9}
        sectionColor={toThreeStyle(t['stage-line'])}
        fadeDistance={48}
        fadeStrength={2.2}
        infiniteGrid
      />
    </group>
  )
}

export function TerminalWorld({ t, engine, active, labels, overview }: { t: ThemeTokens; engine: SandboxEngine; active: boolean; labels: RefObject<HTMLElement>; overview: boolean }) {
  const m = useMats(t)
  const terrainGeo = useTerrain(t)
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
  // On a narrow view only CNS700's own tag is shown, so the place names do not crowd the HUD.
  const roomy = useThree((s) => s.size.width) >= 640
  const places = active && roomy
  return (
    <group visible={active} userData={{ world: 'terminal' }}>
      <Floor t={t} />
      <DioramaTable t={t} />
      <mesh geometry={terrainGeo} material={material} userData={{ noPenPlot: true }} />
      <Runway t={t} />
      <TmaRing t={t} />
      <PlannedRoute t={t} />
      <PenPlot color={lineColor} durationS={2.2}>
        {RADARS.map(({ site, sys }) => (
          <group key={sys} position={siteU(site.pos)}>
            <group scale={TOWER_SCALE}>
              <RadarTower t={t} getAzimuthDeg={sys === 'radarApp' ? () => engine.appAz : () => engine.enrAz} position={[0, 0, 0]} />
            </group>
            <Lamp t={t} engine={engine} system={sys} y={1.25} />
          </group>
        ))}
        {sites.map((s) => (
          <Site key={s.id} t={t} engine={engine} site={s} m={m} />
        ))}
      </PenPlot>
      <Jammer t={t} engine={engine} active={active} labels={labels} />
      {ids.map((id) => (
        <Plane key={id} t={t} engine={engine} id={id} m={m} />
      ))}
      <Trail t={t} engine={engine} />
      <DataLinks t={t} engine={engine} />
      {/* Labels stay mounted (drei's Html must not unmount mid-render); hidden while this view is not on show. */}
      <Callout3D portal={labels} position={siteU(APPROACH_RADAR_SITE.pos, 1.3)} tone="signal" hidden={!places}>
        Approach radar
      </Callout3D>
      <Callout3D portal={labels} position={siteU(ENROUTE_RADAR_SITE.pos, 1.3)} hidden={!places}>
        En-route radar
      </Callout3D>
      {ALL_SITES.filter((s) => s.kind !== 'radar' && s.label).map((s) => (
        <Callout3D key={s.id} portal={labels} position={siteU(s.pos, 0.55)} side={s.pos.x < 0 ? 'left' : 'right'} lead={16} hidden={!places || !overview}>
          {s.label}
        </Callout3D>
      ))}
      <Callout3D portal={labels} position={[TMA_RADIUS_NM * S * Math.sin(-2.4), 1, -TMA_RADIUS_NM * S * Math.cos(-2.4)]} tone="brass" side="left" lead={12} hidden={!places}>
        Terminal area · 40 NM
      </Callout3D>
      <Cns700Tag engine={engine} active={active} labels={labels} />
    </group>
  )
}

function Cns700Tag({ engine, active, labels }: { engine: SandboxEngine; active: boolean; labels: RefObject<HTMLElement> }) {
  const tag = useSampled(
    () => {
      const p = engine.journeyPose()
      if (!p || distanceNm(p.pos, { x: 0, y: 0 }) > TABLE_RADIUS_NM) return null
      const [x, y, z] = toU(p.pos, p.altitudeFt)
      return { pos: [x, y + 0.35, z] as [number, number, number], text: `CNS700 · ${(Math.round(p.altitudeFt / 100) * 100).toLocaleString('en-US')} ft` }
    },
    200,
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  )
  return (
    <Callout3D portal={labels} position={tag?.pos ?? [0, 0, 0]} tone="signal" lead={16} hidden={!active || !tag}>
      {tag?.text ?? 'CNS700'}
    </Callout3D>
  )
}
