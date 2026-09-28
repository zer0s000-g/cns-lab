/**
 * The Secondary Radar hero: the same 60 NM diorama table as the primary radar,
 * with the SSR array riding on top of the radar head. Every pose is read from
 * the unchanged SsrEngine each frame, so the 3D view agrees with the
 * controller's screen and the map:
 *
 * - the 1030 MHz interrogation beam points where engine.antennaAz points;
 * - an aircraft flashes brass (its 1090 MHz answer) when the engine turns its
 *   replies into a new plot on the screen;
 * - false plots from side lobes and FRUIT are drawn where the screen shows them;
 * - during a slow-motion replay (world frozen) the uplink pulses and the
 *   replies travel at the replay's own signal time.
 *
 * Scale: the table is 60 NM in radius, heights are exaggerated and the radar
 * and aircraft are larger than life; the page labels all of it.
 */

import { useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { bearingDeg, bearingToThreeRotationY, distanceNm, toRad } from '@/core/geometry'
import { specialCode } from '@/core/ssr'
import { LIGHT_NM_PER_US } from '@/core/units'
import { isWater, terrainElevationFt } from '@/core/world'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { Callout3D } from '@/stage/Callout3D'
import {
  ANTENNA_Y,
  AircraftModel,
  DioramaTable,
  FLOOR_Y,
  RADAR_SCALE,
  RadarTower,
  S,
  TABLE_RADIUS_U,
  V,
  makeTerrainMaterial,
  toU,
  useTerrain,
} from '@/stage/Diorama'
import { PenPlot } from '@/stage/PenPlot'
import { StudioFloor, col } from '@/stage/Stage'
import { OTHER_RADAR, type DisplayTrack, type SsrEngine } from './engine'
import type { SsrReplay } from './SlowMotion'

const ANSWER_LABEL_OFFSET = new THREE.Vector3(0, -0.32, 0)

/** Height of the SSR array on top of the radar head (RadarTower: deck 1.22 + turntable 0.18 + array 0.78). */
const SSR_Y = (0.12 + 1.1 + 0.18 + 0.78) * RADAR_SCALE
/** How long (real seconds of world time) a reply flash lingers, so it can be seen at all. */
const FLASH_S = 1.2

const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false } as const

// ---------------------------------------------------------------------------
// The 1030 MHz interrogation beam: two translucent blades one beam width apart
// ---------------------------------------------------------------------------

function InterrogationBeam({ t, engine }: { t: ThemeTokens; engine: SsrEngine }) {
  const group = useRef<THREE.Group>(null)
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        ...additive,
        side: THREE.DoubleSide,
        uniforms: { uColor: { value: col(t, 'stage-signal') } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `varying vec2 vUv; uniform vec3 uColor;
          void main(){
            float a = pow(1.0 - vUv.x, 1.5) * (1.0 - smoothstep(0.5, 1.0, vUv.y)) * smoothstep(0.0, 0.05, vUv.x);
            gl_FragColor = vec4(uColor * a * 0.5, a * 0.5);
          }`,
      }),
    [t],
  )
  useLayoutEffect(() => () => mat.dispose(), [mat])
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const n = 40
    const pos: number[] = []
    const uv: number[] = []
    const idx: number[] = []
    for (let i = 0; i <= n; i++) {
      const u = i / n
      const r = u * TABLE_RADIUS_U
      const top = SSR_Y + Math.min(4.2, r * 0.42)
      pos.push(0, SSR_Y * (1 - u) + 0.02, -r, 0, top, -r)
      uv.push(u, 0, u, 1)
      if (i < n) {
        const b = i * 2
        idx.push(b, b + 1, b + 3, b, b + 3, b + 2)
      }
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.setIndex(idx)
    return g
  }, [])
  const half = toRad(engine.beamWidthDeg / 2)
  useFrame(() => {
    if (group.current) group.current.rotation.y = bearingToThreeRotationY(engine.antennaAz)
  })
  return (
    <group ref={group} position={toU(engine.site.pos)}>
      <mesh geometry={geo} material={mat} rotation-y={half} userData={{ noPenPlot: true }} />
      <mesh geometry={geo} material={mat} rotation-y={-half} userData={{ noPenPlot: true }} />
    </group>
  )
}

// ---------------------------------------------------------------------------
// Aircraft: miniature, drop line, and the brass reply when a plot is made
// ---------------------------------------------------------------------------

/** A thin cylinder stretched between two points each frame. */
function placeBetween(m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) {
  const d = b.clone().sub(a)
  const len = d.length()
  m.position.copy(a).addScaledVector(d, 0.5)
  m.scale.set(1, Math.max(1e-3, len), 1)
  m.quaternion.setFromUnitVectors(UP, d.normalize())
}
const UP = new THREE.Vector3(0, 1, 0)

/** The screen's latest plot for this aircraft (the track nearest its true position). */
function plotFor(engine: SsrEngine, id: string) {
  const tr = engine.trackFor(id)
  return tr && tr.plot.sourceId === id ? tr.plot : undefined
}

function Aircraft({ t, engine, id, portal }: { t: ThemeTokens; engine: SsrEngine; id: string; portal?: RefObject<HTMLElement> }) {
  const g = useRef<THREE.Group>(null)
  const drop = useRef<THREE.Mesh>(null)
  const foot = useRef<THREE.Mesh>(null)
  const ring = useRef<THREE.Mesh>(null)
  const ringMat = useRef<THREE.MeshBasicMaterial>(null)
  const link = useRef<THREE.Mesh>(null)
  const linkMat = useRef<THREE.MeshBasicMaterial>(null)
  const label = useRef<THREE.Group>(null)
  const text = useRef<HTMLSpanElement>(null)
  const a0 = engine.getAircraft(id)!
  const antenna = useMemo(() => {
    const [x, , z] = toU(engine.site.pos)
    return new THREE.Vector3(x, SSR_Y, z)
  }, [engine])
  const here = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    const a = engine.getAircraft(id)
    if (!a || !g.current) return
    const [x, y, z] = toU(a.pos, a.altitudeFt)
    here.set(x, y, z)
    g.current.position.set(x, y, z)
    g.current.rotation.y = bearingToThreeRotationY(a.headingDeg)
    const ground = terrainElevationFt(a.pos) * V * (isWater(a.pos) ? 0 : 1)
    if (drop.current) {
      const h = Math.max(0.001, y - ground)
      drop.current.scale.set(1, h, 1)
      drop.current.position.set(x, ground + h / 2, z)
    }
    if (foot.current) foot.current.position.set(x, ground + 0.01, z)
    label.current?.position.set(x, y + 0.18, z)

    // The reply: the moment the engine turned this aircraft's answers into a plot.
    const plot = plotFor(engine, id)
    const age = plot?.secondary ? engine.timeS - plot.timeS : Infinity
    const on = age >= 0 && age < FLASH_S
    const k = on ? age / FLASH_S : 1
    if (ring.current && ringMat.current) {
      ring.current.visible = on
      ring.current.position.set(x, y, z)
      ring.current.scale.setScalar(0.25 + k * 0.8)
      ringMat.current.opacity = (1 - k) ** 2
    }
    if (link.current && linkMat.current) {
      link.current.visible = on
      if (on) placeBetween(link.current, here, antenna)
      linkMat.current.opacity = 0.9 * (1 - k) ** 2
    }

    // What the controller's screen says about it.
    if (text.current) {
      const x0 = engine.transponder(id)
      const alt = `${Math.round(a.altitudeFt / 100) * 100} FT`
      const special = specialCode(x0.squawk)
      let state = ''
      if (!x0.on) state = ' · NO REPLY'
      else if (plot?.garbled) state = ' · GARBLED'
      else if (special) state = ` · ${special.tag}`
      const s = `${a.callsign} · SQ ${x0.squawk} · ${alt}${state}`
      if (text.current.textContent !== s) text.current.textContent = s
      const tone = special && (special.kind === 'emergency' || special.kind === 'hijack') ? 'var(--destructive)' : plot?.garbled ? 'var(--brass)' : ''
      if (text.current.style.color !== tone) text.current.style.color = tone
    }
  })
  const init = toU(a0.pos, a0.altitudeFt)
  return (
    <>
      <group ref={g} position={init}>
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
      <mesh ref={ring} rotation-x={-Math.PI / 2} visible={false} userData={{ noPenPlot: true }}>
        <ringGeometry args={[0.28, 0.34, 48]} />
        <meshBasicMaterial ref={ringMat} color={col(t, 'stage-brass')} {...additive} />
      </mesh>
      <mesh ref={link} visible={false} userData={{ noPenPlot: true }}>
        <cylinderGeometry args={[0.012, 0.012, 1, 6, 1, true]} />
        <meshBasicMaterial ref={linkMat} color={col(t, 'stage-brass')} {...additive} />
      </mesh>
      <group ref={label} position={[init[0], init[1] + 0.18, init[2]]}>
        <Callout3D position={[0, 0, 0]} portal={portal} lead={18}>
          <span ref={text}>{a0.callsign}</span>
        </Callout3D>
      </group>
    </>
  )
}

// ---------------------------------------------------------------------------
// False plots: side-lobe ring-around and FRUIT, drawn where the screen shows them
// ---------------------------------------------------------------------------

const GHOSTS = 16

function isFalse(engine: SsrEngine, tr: DisplayTrack) {
  if (!tr.plot.secondary) return false
  const src = tr.plot.sourceId ? engine.getAircraft(tr.plot.sourceId) : undefined
  if (!src) return true
  return distanceNm(src.pos, tr.pos) > 3
}

function FalsePlots({ t, engine, portal }: { t: ThemeTokens; engine: SsrEngine; portal?: RefObject<HTMLElement> }) {
  const rings = useRef<THREE.Mesh[]>([])
  const label = useRef<THREE.Group>(null)
  const labelRoot = useRef<HTMLDivElement>(null)
  const text = useRef<HTMLSpanElement>(null)
  useFrame(() => {
    let n = 0
    let first: DisplayTrack | undefined
    for (const tr of engine.tracks.values()) {
      if (n >= GHOSTS) break
      if (!isFalse(engine, tr)) continue
      const m = rings.current[n++]
      if (!m) continue
      if (!first || tr.pos.x < first.pos.x) first = tr
      const [x, , z] = toU(tr.pos)
      const h = isWater(tr.pos) ? 0 : terrainElevationFt(tr.pos) * V
      m.position.set(x, h + 0.03, z)
      m.visible = true
    }
    for (let i = n; i < GHOSTS; i++) if (rings.current[i]) rings.current[i].visible = false
    if (labelRoot.current) labelRoot.current.style.display = first ? '' : 'none'
    if (first && label.current && text.current) {
      const [x, , z] = toU(first.pos)
      label.current.position.set(x, 0.1, z)
      const src = first.plot.sourceId ? engine.getAircraft(first.plot.sourceId) : undefined
      const s = src ? `False ${src.callsign} on the screen (side lobe)` : 'False target on the screen (FRUIT)'
      if (text.current.textContent !== s) text.current.textContent = s
    }
  })
  return (
    <>
      {Array.from({ length: GHOSTS }, (_, i) => (
        <mesh key={i} ref={(el) => void (el && (rings.current[i] = el))} rotation-x={-Math.PI / 2} visible={false} userData={{ noPenPlot: true }}>
          <ringGeometry args={[0.14, 0.18, 32]} />
          <meshBasicMaterial color={col(t, 'stage-brass')} transparent opacity={0.85} toneMapped={false} />
        </mesh>
      ))}
      <group ref={label}>
        <Callout3D position={[0, 0, 0]} side="left" tone="brass" portal={portal} rootRef={labelRoot}>
          <span ref={text} />
        </Callout3D>
      </group>
    </>
  )
}

/** The other radar whose interrogations cause FRUIT (shown only when that failure is on). */
function OtherRadar({ t, engine, portal }: { t: ThemeTokens; engine: SsrEngine; portal?: RefObject<HTMLElement> }) {
  const grp = useRef<THREE.Group>(null)
  const labelRoot = useRef<HTMLDivElement>(null)
  const [x, , z] = toU(OTHER_RADAR, terrainElevationFt(OTHER_RADAR))
  const y = isWater(OTHER_RADAR) ? 0 : terrainElevationFt(OTHER_RADAR) * V
  // A fixed pose facing our radar: the engine models its replies, not its rotation.
  const az = bearingDeg(OTHER_RADAR, engine.site.pos)
  useFrame(() => {
    if (grp.current) grp.current.visible = engine.env.fruit
    if (labelRoot.current) labelRoot.current.style.display = engine.env.fruit ? '' : 'none'
  })
  return (
    <group ref={grp} visible={false}>
      <group position={[x, y, z]} scale={0.55}>
        <RadarTower t={t} getAzimuthDeg={() => az} position={[0, 0, 0]} />
      </group>
      <Callout3D position={[x - 0.2, y + 0.9, z]} side="left" tone="brass" portal={portal} rootRef={labelRoot}>
        Another radar · its replies are FRUIT here
      </Callout3D>
    </group>
  )
}

// ---------------------------------------------------------------------------
// Slow motion: the interrogation pulses out, the replies back (world frozen)
// ---------------------------------------------------------------------------

function curtain(t: ThemeTokens, name: keyof ThemeTokens, gain: number) {
  return new THREE.ShaderMaterial({
    ...additive,
    side: THREE.DoubleSide,
    uniforms: { uColor: { value: col(t, name) }, uGain: { value: gain } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying vec2 vUv; uniform vec3 uColor; uniform float uGain;
      void main(){
        float edge = smoothstep(0.0, 0.2, vUv.x) * smoothstep(1.0, 0.8, vUv.x);
        float a = edge * pow(1.0 - vUv.y, 1.4) * uGain;
        gl_FragColor = vec4(uColor * a * 1.4, a);
      }`,
  })
}

const MAX_REPLIES = 10

function Replay({ t, engine, replayRef, portal }: { t: ThemeTokens; engine: SsrEngine; replayRef: MutableRefObject<SsrReplay | null>; portal?: RefObject<HTMLElement> }) {
  const grp = useRef<THREE.Group>(null)
  const beamGrp = useRef<THREE.Group>(null)
  const uplink = useRef<THREE.Mesh[]>([])
  const control = useRef<THREE.Mesh>(null)
  const replyRings = useRef<THREE.Mesh[]>([])
  const replyDots = useRef<THREE.Mesh[]>([])
  const qLabel = useRef<THREE.Group>(null)
  const qRoot = useRef<HTMLDivElement>(null)
  const aLabel = useRef<THREE.Group>(null)
  const aRoot = useRef<HTMLDivElement>(null)
  const aText = useRef<HTMLSpanElement>(null)
  const mat = useMemo(() => curtain(t, 'stage-signal', 1), [t])
  const ctrlMat = useMemo(() => curtain(t, 'stage-signal', 0.35), [t])
  const ringMat = useMemo(() => new THREE.MeshBasicMaterial({ color: col(t, 'stage-brass'), ...additive, opacity: 0.8, side: THREE.DoubleSide }), [t])
  const dotMat = useMemo(() => new THREE.MeshBasicMaterial({ color: col(t, 'stage-brass'), toneMapped: false }), [t])
  useLayoutEffect(
    () => () => {
      mat.dispose()
      ctrlMat.dispose()
      ringMat.dispose()
      dotMat.dispose()
    },
    [mat, ctrlMat, ringMat, dotMat],
  )
  // An arc of an open cylinder one beam width wide, centred on local -z like the beam.
  const arc = useMemo(() => {
    const w = toRad(engine.beamWidthDeg) * 1.2
    const g = new THREE.CylinderGeometry(1, 1, 3.2, 12, 1, true, Math.PI - w / 2, w)
    g.translate(0, 1.6 - 0.9, 0)
    return g
  }, [engine])
  const full = useMemo(() => {
    const g = new THREE.CylinderGeometry(1, 1, 1.2, 96, 1, true)
    g.translate(0, 0.6 - 0.9, 0)
    return g
  }, [])
  const [sx, , sz] = toU(engine.site.pos)
  const antenna = useMemo(() => new THREE.Vector3(sx, SSR_Y, sz), [sx, sz])
  const tmp = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    const rp = replayRef.current
    if (!grp.current) return
    grp.current.visible = Boolean(rp)
    if (qRoot.current) qRoot.current.style.display = rp ? '' : 'none'
    if (aRoot.current) aRoot.current.style.display = 'none'
    if (!rp) return
    if (beamGrp.current) beamGrp.current.rotation.y = bearingToThreeRotationY(rp.azDeg)
    const ry = toRad(rp.azDeg)
    // Uplink: each pulse is a front that has travelled c·(t − its start).
    let lead = -1
    rp.uplink.forEach((p, i) => {
      const d = LIGHT_NM_PER_US * (rp.tUs - p.tUs)
      const onAir = d > 0 && d < rp.lengthNm && d * S < TABLE_RADIUS_U
      const r = Math.max(0.01, d * S)
      if (p.antenna === 'control') {
        if (control.current) {
          control.current.visible = onAir
          control.current.scale.set(r, 1, r)
        }
        if (uplink.current[i]) uplink.current[i].visible = false
        return
      }
      const m = uplink.current[i]
      if (!m) return
      m.visible = onAir
      m.scale.set(r, 1, r)
      if (onAir && d > lead) lead = d
    })
    if (!rp.uplink.some((p) => p.antenna === 'control') && control.current) control.current.visible = false
    if (qLabel.current && qRoot.current) {
      const show = lead > 0
      qRoot.current.style.display = show ? '' : 'none'
      if (show) qLabel.current.position.set(sx + Math.sin(ry) * lead * S, 1.9, sz - Math.cos(ry) * lead * S)
    }
    // Replies: each transponder's answer spreads out from the aircraft at the speed of light.
    let shown = false
    for (let i = 0; i < MAX_REPLIES; i++) {
      const ringM = replyRings.current[i]
      const dotM = replyDots.current[i]
      const r = rp.replies[i]
      const a = r ? engine.getAircraft(r.id) : undefined
      if (!r || !a) {
        if (ringM) ringM.visible = false
        if (dotM) dotM.visible = false
        continue
      }
      const d = LIGHT_NM_PER_US * (rp.tUs - r.startUs)
      const lengthNm = LIGHT_NM_PER_US * r.lengthUs
      const onAir = d > 0 && d < r.slantNm + lengthNm
      const [x, y, z] = toU(a.pos, a.altitudeFt)
      if (ringM) {
        ringM.visible = onAir && d * S < TABLE_RADIUS_U
        ringM.position.set(x, y, z)
        const rr = Math.max(0.01, d * S)
        ringM.scale.set(rr, rr, 1)
      }
      if (dotM) {
        const f = Math.min(1, d / r.slantNm)
        dotM.visible = onAir
        tmp.set(x, y, z).lerp(antenna, f)
        dotM.position.copy(tmp)
        if (r.id === rp.targetId && onAir && aLabel.current && aText.current && !shown) {
          shown = true
          // Ride just below the reply so it never covers the aircraft's own tag.
          aLabel.current.position.copy(tmp).add(ANSWER_LABEL_OFFSET)
          const s = `${r.callsign} answers · 1090 MHz`
          if (aText.current.textContent !== s) aText.current.textContent = s
        }
      }
    }
    if (aRoot.current) aRoot.current.style.display = shown ? '' : 'none'
  })
  return (
    <>
      <group ref={grp} visible={false}>
        <group ref={beamGrp} position={[sx, 0.9, sz]}>
          {[0, 1, 2].map((i) => (
            <mesh key={i} ref={(el) => void (el && (uplink.current[i] = el))} geometry={arc} material={mat} visible={false} userData={{ noPenPlot: true }} />
          ))}
        </group>
        {/* P2 leaves the control antenna in every direction. */}
        <mesh ref={control} position={[sx, 0.9, sz]} geometry={full} material={ctrlMat} visible={false} userData={{ noPenPlot: true }} />
        {Array.from({ length: MAX_REPLIES }, (_, i) => (
          <group key={i}>
            <mesh ref={(el) => void (el && (replyRings.current[i] = el))} rotation-x={-Math.PI / 2} material={ringMat} visible={false} userData={{ noPenPlot: true }}>
              <ringGeometry args={[0.97, 1, 96]} />
            </mesh>
            <mesh ref={(el) => void (el && (replyDots.current[i] = el))} material={dotMat} visible={false} userData={{ noPenPlot: true }}>
              <sphereGeometry args={[0.06, 12, 8]} />
            </mesh>
          </group>
        ))}
      </group>
      <group ref={qLabel}>
        <Callout3D position={[0, 0, 0]} tone="signal" portal={portal} rootRef={qRoot}>
          Question · 1030 MHz
        </Callout3D>
      </group>
      <group ref={aLabel}>
        <Callout3D position={[0, 0, 0]} side="left" tone="brass" portal={portal} rootRef={aRoot}>
          <span ref={aText} />
        </Callout3D>
      </group>
    </>
  )
}

// ---------------------------------------------------------------------------

export function SsrHero({
  t,
  engine,
  replayRef,
  portal,
}: {
  t: ThemeTokens
  engine: SsrEngine
  replayRef: MutableRefObject<SsrReplay | null>
  portal?: RefObject<HTMLElement>
}) {
  const terrain = useTerrain(t)
  const { material, uniforms } = useMemo(() => makeTerrainMaterial(t), [t])
  useLayoutEffect(() => () => material.dispose(), [material])
  useFrame(() => {
    uniforms.uAz.value = toRad(engine.antennaAz)
    uniforms.uPersist.value = 0.06
  })
  const lineColor = useMemo(() => col(t, 'stage-line'), [t])
  // The aircraft list changes only when the in-trail pair is added or removed.
  const [ids, setIds] = useState(() => engine.aircraft.map((a) => a.id).join(','))
  useFrame(() => {
    const now = engine.aircraft.map((a) => a.id).join(',')
    if (now !== ids) setIds(now)
  })
  const [sx, , sz] = toU(engine.site.pos)
  return (
    <group>
      <StudioFloor t={t} y={FLOOR_Y} shadowScale={30} />
      <DioramaTable t={t} />
      <mesh geometry={terrain} material={material} receiveShadow userData={{ noPenPlot: true }} />
      <PenPlot color={lineColor}>
        <RadarTower t={t} getAzimuthDeg={() => engine.antennaAz} position={toU(engine.site.pos)} />
      </PenPlot>
      <InterrogationBeam t={t} engine={engine} />
      {ids.split(',').map((id) => (
        <Aircraft key={id} t={t} engine={engine} id={id} portal={portal} />
      ))}
      <FalsePlots t={t} engine={engine} portal={portal} />
      <OtherRadar t={t} engine={engine} portal={portal} />
      <Replay t={t} engine={engine} replayRef={replayRef} portal={portal} />
      <Callout3D position={[sx - 0.3, SSR_Y + 0.3, sz]} side="left" tone="signal" portal={portal}>
        SSR array · asks on 1030 MHz
      </Callout3D>
      <Callout3D position={[sx - 0.3, ANTENNA_Y - 0.3, sz]} side="left" portal={portal} lead={22}>
        Primary reflector
      </Callout3D>
    </group>
  )
}

export default SsrHero
