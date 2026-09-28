/**
 * The Primary Radar hero: a diorama table of the radar's airspace. Every
 * object's pose is read from the unchanged PsrEngine each frame, so the 3D
 * view always agrees with the radar screen and the map.
 *
 * Scale: the table is 60 NM in radius. Heights are exaggerated (see
 * HEIGHT_EXAGGERATION) and the radar and aircraft are drawn larger than life;
 * the page labels both.
 */

import { useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { bearingDeg, bearingToThreeRotationY, toRad } from '@/core/geometry'
import { apparentRange, rainReflectivity } from '@/core/radar'
import { LIGHT_NM_PER_US } from '@/core/units'
import { isWater, terrainElevationFt } from '@/core/world'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { Callout3D } from '@/stage/Callout3D'
import {
  ANTENNA_Y,
  AircraftModel,
  DioramaTable,
  FLOOR_Y,
  RadarTower,
  S,
  TABLE_RADIUS_NM,
  TABLE_RADIUS_U,
  V,
  makeTerrainMaterial,
  toU,
  useTerrain,
} from '@/stage/Diorama'
import { PenPlot } from '@/stage/PenPlot'
import { StudioFloor, col } from '@/stage/Stage'
import type { PsrEngine } from './engine'
import type { Replay } from './PulseView'
import { REASON_TEXT } from './TruthMap'

// ---------------------------------------------------------------------------
// The beam: two translucent blades one beam width apart, fading outward
// ---------------------------------------------------------------------------

function BeamBlade({ t, engine }: { t: ThemeTokens; engine: PsrEngine }) {
  const group = useRef<THREE.Group>(null)
  const left = useRef<THREE.Group>(null)
  const right = useRef<THREE.Group>(null)
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: { uColor: { value: col(t, 'stage-signal') } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `varying vec2 vUv; uniform vec3 uColor;
          void main(){
            float along = vUv.x;               // 0 at the antenna, 1 at the table edge
            float up = vUv.y;                  // 0 at the ground, 1 at the top of the coverage
            float a = pow(1.0 - along, 1.6) * (1.0 - smoothstep(0.55, 1.0, up)) * smoothstep(0.0, 0.05, along);
            gl_FragColor = vec4(uColor * a * 0.55, a * 0.55);
          }`,
        toneMapped: false,
      }),
    [t],
  )
  const geo = useMemo(() => {
    // A blade from the antenna out to the rim, rising like the elevation coverage.
    const g = new THREE.BufferGeometry()
    const n = 40
    const pos: number[] = []
    const uv: number[] = []
    const idx: number[] = []
    for (let i = 0; i <= n; i++) {
      const u = i / n
      const r = u * TABLE_RADIUS_U
      const top = ANTENNA_Y + Math.min(4.2, r * 0.42)
      pos.push(0, ANTENNA_Y * (1 - u) + 0.02, -r, 0, top, -r)
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
  useFrame(() => {
    if (!group.current) return
    group.current.rotation.y = bearingToThreeRotationY(engine.antennaAz)
    // Blades one (exaggerated) beam width apart so the beam is visible from any angle.
    const half = toRad(Math.max(1.2, engine.params.beamWidthDeg) / 2)
    if (left.current) left.current.rotation.y = half
    if (right.current) right.current.rotation.y = -half
  })
  return (
    <group ref={group} position={toU(engine.site.pos)}>
      <group ref={left}>
        <mesh geometry={geo} material={mat} userData={{ noPenPlot: true }} />
      </group>
      <group ref={right}>
        <mesh geometry={geo} material={mat} userData={{ noPenPlot: true }} />
      </group>
    </group>
  )
}

// ---------------------------------------------------------------------------
// Aircraft miniatures, altitude drop-lines, echo flashes, second-trace ghosts
// ---------------------------------------------------------------------------

function Aircraft({ t, engine, id, portal }: { t: ThemeTokens; engine: PsrEngine; id: string; portal?: RefObject<HTMLElement> }) {
  const g = useRef<THREE.Group>(null)
  const drop = useRef<THREE.Mesh>(null)
  const foot = useRef<THREE.Mesh>(null)
  const flash = useRef<THREE.Mesh>(null)
  const flashMat = useRef<THREE.MeshBasicMaterial>(null)
  const ghost = useRef<THREE.Group>(null)
  const ghostMat = useRef<THREE.MeshBasicMaterial>(null)
  const ghostLabel = useRef<HTMLDivElement>(null)
  const labelPos = useRef<[number, number, number]>([0, 0, 0])
  const a0 = engine.getAircraft(id)!
  const init = toU(a0.pos, a0.altitudeFt)
  useFrame(() => {
    const a = engine.getAircraft(id)
    if (!a || !g.current) return
    const [x, y, z] = toU(a.pos, a.altitudeFt)
    g.current.position.set(x, y, z)
    g.current.rotation.y = bearingToThreeRotationY(a.headingDeg)
    const ground = terrainElevationFt(a.pos) * V * (isWater(a.pos) ? 0 : 1)
    if (drop.current) {
      const h = Math.max(0.001, y - ground)
      drop.current.scale.set(1, h, 1)
      drop.current.position.set(x, ground + h / 2, z)
    }
    if (foot.current) foot.current.position.set(x, ground + 0.01, z)
    labelPos.current = [x, y + 0.18, z]
    // Echo flash: the moment the beam paints the aircraft.
    const look = engine.lastLook.get(id)
    const age = look ? engine.timeS - look.timeS : Infinity
    if (flash.current && flashMat.current) {
      const on = look?.detected && age < 1.6
      flash.current.visible = Boolean(on)
      if (on) {
        const k = age / 1.6
        flash.current.position.set(x, y, z)
        flash.current.scale.setScalar(0.25 + k * 0.9)
        flashMat.current.opacity = (1 - k) ** 2
      }
    }
    // Second-trace ghost: where the radar screen draws this aircraft when its echo comes back late.
    if (ghost.current && ghostMat.current) {
      const show = Boolean(look?.detected && look.trace > 1)
      ghost.current.visible = show
      // drei's Html ignores the parent's visibility, so hide the label directly.
      if (ghostLabel.current) ghostLabel.current.style.display = show ? '' : 'none'
      if (show && look) {
        const brg = bearingDeg(engine.site.pos, a.pos)
        const app = apparentRange(look.trueRangeNm, engine.params.prfHz).rangeNm
        const gp = { x: engine.site.pos.x + Math.sin(toRad(brg)) * app, y: engine.site.pos.y + Math.cos(toRad(brg)) * app }
        const [gx, , gz] = toU(gp)
        ghost.current.position.set(gx, terrainElevationFt(gp) * V + 0.03, gz)
        ghostMat.current.opacity = 0.9
      }
    }
  })
  const look = engine.lastLook.get(id)
  const status = look && look.reason !== 'ok' ? REASON_TEXT[look.reason] : null
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
      <mesh ref={flash} rotation-x={-Math.PI / 2} visible={false} userData={{ noPenPlot: true }}>
        <ringGeometry args={[0.28, 0.34, 48]} />
        <meshBasicMaterial ref={flashMat} color={col(t, 'stage-signal')} transparent toneMapped={false} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <group ref={ghost} visible={false}>
        <mesh rotation-x={-Math.PI / 2} userData={{ noPenPlot: true }}>
          <ringGeometry args={[0.16, 0.2, 32]} />
          <meshBasicMaterial ref={ghostMat} color={col(t, 'stage-brass')} transparent toneMapped={false} />
        </mesh>
        <Callout3D position={[0, 0.05, 0]} tone="brass" portal={portal} rootRef={ghostLabel}>
          {`${a0.callsign} shown here (second trace)`}
        </Callout3D>
      </group>
      <AircraftLabel labelPos={labelPos} callsign={a0.callsign} engine={engine} id={id} status={status} portal={portal} />
    </>
  )
}

function AircraftLabel({
  labelPos,
  callsign,
  engine,
  id,
  portal,
}: {
  labelPos: React.MutableRefObject<[number, number, number]>
  callsign: string
  engine: PsrEngine
  id: string
  status: string | null
  portal?: RefObject<HTMLElement>
}) {
  const g = useRef<THREE.Group>(null)
  const text = useRef<HTMLSpanElement>(null)
  useFrame(() => {
    if (g.current) g.current.position.set(...labelPos.current)
    const a = engine.getAircraft(id)
    const look = engine.lastLook.get(id)
    if (text.current && a) {
      const alt = `${Math.round(a.altitudeFt / 100) * 100} FT`
      const seen = !look ? '' : look.detected ? ' · ECHO' : ` · NOT SEEN: ${REASON_TEXT[look.reason].toUpperCase()}`
      const s = `${callsign} · ${alt}${seen}`
      if (text.current.textContent !== s) text.current.textContent = s
    }
  })
  return (
    <group ref={g}>
      <Callout3D position={[0, 0, 0]} portal={portal} lead={18}>
        <span ref={text}>{callsign}</span>
      </Callout3D>
    </group>
  )
}

// ---------------------------------------------------------------------------
// Clutter glints and rain: points that light up as the beam passes them
// ---------------------------------------------------------------------------

function useSweptPointsMaterial(t: ThemeTokens, colorName: keyof ThemeTokens, size: number) {
  return useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        uniforms: {
          uAz: { value: 0 },
          uPersist: { value: 0.12 },
          uGain: { value: 1 },
          uOffset: { value: new THREE.Vector3() },
          uColor: { value: col(t, colorName) },
          uSize: { value: size },
        },
        vertexShader: `attribute float aStrength; uniform float uAz; uniform float uPersist; uniform float uGain; uniform vec3 uOffset; uniform float uSize;
          varying float vA;
          void main(){
            vec3 p = position + uOffset;
            float bearing = atan(p.x, -p.z);
            float behind = mod(uAz - bearing + 6.2831853, 6.2831853);
            vA = aStrength * uGain * exp(-behind / (6.2831853 * uPersist));
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_PointSize = uSize * (8.0 / -mv.z);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `uniform vec3 uColor; varying float vA;
          void main(){
            vec2 d = gl_PointCoord - 0.5;
            float f = smoothstep(0.5, 0.0, length(d));
            gl_FragColor = vec4(uColor * vA * f, vA * f);
          }`,
      }),
    [t, colorName, size],
  )
}

function Clutter({ t, engine }: { t: ThemeTokens; engine: PsrEngine }) {
  const mat = useSweptPointsMaterial(t, 'stage-glass', 9)
  const geo = useMemo(() => {
    const cells = engine.clutter.filter((c) => c.rangeNm <= TABLE_RADIUS_NM)
    const pos = new Float32Array(cells.length * 3)
    const str = new Float32Array(cells.length)
    cells.forEach((c, i) => {
      const [x, y, z] = toU(c.pos, terrainElevationFt(c.pos) + 150)
      pos.set([x, y, z], i * 3)
      str[i] = c.strength * 0.9
    })
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aStrength', new THREE.BufferAttribute(str, 1))
    return g
  }, [engine])
  useFrame(() => {
    mat.uniforms.uAz.value = toRad(engine.antennaAz)
    mat.uniforms.uPersist.value = 0.1
    mat.uniforms.uGain.value = engine.env.groundClutter ? (engine.env.mti ? 0.03 : 1) : 0
  })
  return <points geometry={geo} material={mat} userData={{ noPenPlot: true }} />
}

function Rain({ t, engine }: { t: ThemeTokens; engine: PsrEngine }) {
  const mat = useSweptPointsMaterial(t, 'stage-glass', 4)
  const geo = useMemo(() => {
    const pos: number[] = []
    const str: number[] = []
    const storm = { ...engine.storm, center: { x: 0, y: 0 } }
    for (let x = -14; x <= 14; x += 0.7) {
      for (let y = -14; y <= 14; y += 0.7) {
        const r = rainReflectivity({ x, y }, storm)
        if (r <= 0.05) continue
        for (let k = 0; k < 3; k++) {
          const [px, , pz] = toU({ x: x + (k - 1) * 0.2, y: y + ((k * 7) % 3) * 0.2 })
          pos.push(px, (0.12 + ((x * 13 + y * 7 + k * 5) % 10) / 10) * 1.3, pz)
          str.push(r)
        }
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('aStrength', new THREE.Float32BufferAttribute(str, 1))
    return g
  }, [engine])
  useFrame(() => {
    const [cx, , cz] = toU(engine.storm.center)
    mat.uniforms.uOffset.value.set(cx, 0, cz)
    mat.uniforms.uAz.value = toRad(engine.antennaAz)
    mat.uniforms.uPersist.value = 0.9
    mat.uniforms.uGain.value = engine.env.rain ? 0.7 : 0
  })
  return <points geometry={geo} material={mat} userData={{ noPenPlot: true }} />
}

function WindFarm({ t, engine }: { t: ThemeTokens; engine: PsrEngine }) {
  const rotors = useRef<THREE.Group[]>([])
  const grp = useRef<THREE.Group>(null)
  useFrame((_, dt) => {
    if (grp.current) grp.current.visible = engine.env.windFarm
    for (const r of rotors.current) if (r) r.rotation.z += dt * 2.4
  })
  return (
    <group ref={grp}>
      {engine.turbines.map((p, i) => {
        const [x, y, z] = toU(p, terrainElevationFt(p))
        return (
          <group key={i} position={[x, y, z]} scale={0.5}>
            <mesh position={[0, 0.3, 0]}>
              <cylinderGeometry args={[0.008, 0.014, 0.6, 6]} />
              <meshStandardMaterial color={col(t, 'stage-paint')} />
            </mesh>
            <group position={[0, 0.6, 0.02]} ref={(el) => void (el && (rotors.current[i] = el))}>
              {[0, 1, 2].map((k) => (
                <mesh key={k} rotation-z={(k * Math.PI * 2) / 3} position={[0, 0, 0]}>
                  <boxGeometry args={[0.012, 0.36, 0.004]} />
                  <meshStandardMaterial color={col(t, 'stage-paint')} />
                </mesh>
              ))}
            </group>
          </group>
        )
      })}
    </group>
  )
}

// ---------------------------------------------------------------------------
// One pulse in slow motion: the outgoing front and the returning echoes
// ---------------------------------------------------------------------------

function PulseArcs({ t, engine, replayRef }: { t: ThemeTokens; engine: PsrEngine; replayRef: React.MutableRefObject<Replay | null> }) {
  const grp = useRef<THREE.Group>(null)
  const front = useRef<THREE.Mesh>(null)
  const echoes = useRef<THREE.Mesh[]>([])
  // A glowing curtain: the pulse front at every elevation, fading upward.
  const curtain = (name: keyof ThemeTokens) =>
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
      uniforms: { uColor: { value: col(t, name) } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec2 vUv; uniform vec3 uColor;
        void main(){
          float edge = smoothstep(0.0, 0.2, vUv.x) * smoothstep(1.0, 0.8, vUv.x);
          float a = edge * pow(1.0 - vUv.y, 1.4);
          gl_FragColor = vec4(uColor * a * 1.4, a);
        }`,
    })
  const mat = useMemo(() => curtain('stage-signal'), [t])
  const echoMat = useMemo(() => curtain('stage-brass'), [t])
  // An arc of an open cylinder one (exaggerated) beam width wide, centred on
  // local -z like the beam; scaled to its radius each frame.
  const arc = useMemo(() => {
    const w = 0.1
    const g = new THREE.CylinderGeometry(1, 1, 3.2, 24, 1, true, Math.PI - w / 2, w)
    g.translate(0, 1.6 - 0.9, 0)
    return g
  }, [])
  useFrame(() => {
    const rp = replayRef.current
    if (!grp.current) return
    grp.current.visible = Boolean(rp)
    if (!rp) return
    grp.current.rotation.y = bearingToThreeRotationY(rp.azDeg)
    const d = LIGHT_NM_PER_US * rp.tUs
    if (front.current) {
      front.current.visible = d * S < TABLE_RADIUS_U
      const r = Math.max(0.01, d * S)
      front.current.scale.set(r, 1, r)
    }
    rp.echoes.forEach((e, i) => {
      const m = echoes.current[i]
      if (!m) return
      const tHit = e.rangeNm / LIGHT_NM_PER_US
      const on = e.kind === 'target' && rp.tUs >= tHit && rp.tUs <= 2 * tHit
      m.visible = on
      if (on) {
        const r = Math.max(0.01, (2 * e.rangeNm - d) * S)
        m.scale.set(r, 1, r)
      }
    })
  })
  const n = replayRef.current?.echoes.length ?? 12
  return (
    <group ref={grp} position={[toU(engine.site.pos)[0], 0.9, toU(engine.site.pos)[2]]} visible={false}>
      <mesh ref={front} geometry={arc} material={mat} userData={{ noPenPlot: true }} />
      {Array.from({ length: Math.max(n, 12) }, (_, i) => (
        <mesh key={i} ref={(el) => void (el && (echoes.current[i] = el))} geometry={arc} material={echoMat} visible={false} userData={{ noPenPlot: true }} />
      ))}
    </group>
  )
}

// ---------------------------------------------------------------------------

export function PsrHero({
  t,
  engine,
  replayRef,
  portal,
}: {
  t: ThemeTokens
  engine: PsrEngine
  replayRef: React.MutableRefObject<Replay | null>
  portal?: RefObject<HTMLElement>
}) {
  const terrain = useTerrain(t)
  const { material, uniforms } = useMemo(() => makeTerrainMaterial(t), [t])
  useLayoutEffect(() => () => material.dispose(), [material])
  useFrame(() => {
    uniforms.uAz.value = toRad(engine.antennaAz)
    uniforms.uPersist.value = 0.1
  })
  const lineColor = useMemo(() => col(t, 'stage-line'), [t])
  const ids = engine.aircraft.map((a) => a.id)
  return (
    <group>
      <StudioFloor t={t} y={FLOOR_Y} shadowScale={30} />
      <DioramaTable t={t} />
      <mesh geometry={terrain} material={material} receiveShadow userData={{ noPenPlot: true }} />
      <PenPlot color={lineColor}>
        <RadarTower t={t} getAzimuthDeg={() => engine.antennaAz} position={toU(engine.site.pos)} />
      </PenPlot>
      <BeamBlade t={t} engine={engine} />
      <Clutter t={t} engine={engine} />
      <Rain t={t} engine={engine} />
      <WindFarm t={t} engine={engine} />
      {ids.map((id) => (
        <Aircraft key={id} t={t} engine={engine} id={id} portal={portal} />
      ))}
      <PulseArcs t={t} engine={engine} replayRef={replayRef} />
      <Callout3D position={[toU(engine.site.pos)[0] + 0.7, ANTENNA_Y + 0.3, toU(engine.site.pos)[2]]} tone="signal" portal={portal}>
        PRIMARY RADAR · S-BAND
      </Callout3D>
    </group>
  )
}

export default PsrHero
