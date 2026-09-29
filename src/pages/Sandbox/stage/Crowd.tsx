/**
 * The people of the airport, drawn as two instanced meshes (bodies and heads)
 * from the pure crowd model in agents.ts. Positions are recomputed every
 * frame from the journey state; nothing here keeps its own motion.
 */
import { useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { col } from '@/stage/Stage'
import { crowdAt, MAX_PEOPLE, ROLE_CODE, STRIDE, type VehicleContext } from '../agents'

const BODY_H = 1.42
const HEAD_Y = 1.6

export function Crowd({ t, ctxRef, reduced }: { t: ThemeTokens; ctxRef: MutableRefObject<VehicleContext | null>; reduced: boolean }) {
  const body = useRef<THREE.InstancedMesh>(null)
  const head = useRef<THREE.InstancedMesh>(null)
  const wands = useRef<THREE.InstancedMesh>(null)
  const buf = useMemo(() => new Float32Array(MAX_PEOPLE * STRIDE), [])
  const geo = useMemo(() => {
    const b = new THREE.CapsuleGeometry(0.23, BODY_H - 0.46, 4, 10)
    b.translate(0, BODY_H / 2, 0)
    const h = new THREE.SphereGeometry(0.12, 12, 8)
    const w = new THREE.BoxGeometry(0.06, 0.45, 0.06)
    return { b, h, w }
  }, [])
  useLayoutEffect(() => () => Object.values(geo).forEach((g) => g.dispose()), [geo])
  const mats = useMemo(
    () => ({
      // Unlit, so people read clearly as bright figures on the dark apron (a digital-twin convention).
      body: new THREE.MeshBasicMaterial({ toneMapped: false }),
      head: new THREE.MeshBasicMaterial({ color: col(t, 'stage-terrain-high'), toneMapped: false }),
      wand: new THREE.MeshBasicMaterial({ color: col(t, 'lamp-amber'), toneMapped: false }),
    }),
    [t],
  )
  useLayoutEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats])
  // Clothing colours from the stage tokens: varied for passengers, high-visibility for the ramp crew.
  const palette = useMemo(() => {
    const paint = col(t, 'stage-paint')
    const metal = col(t, 'stage-metal')
    const passengers = [
      paint,
      metal.clone().lerp(paint, 0.3),
      col(t, 'stage-terrain-high'),
      paint.clone().lerp(col(t, 'stage-signal'), 0.35),
      metal.clone().lerp(col(t, 'stage-brass'), 0.5),
      col(t, 'stage-glass').clone().lerp(metal, 0.4),
    ]
    return { passengers, crew: col(t, 'lamp-amber'), controller: col(t, 'stage-signal') }
  }, [t])

  // Give every instance a colour once so the shader includes instance colours from the start.
  useLayoutEffect(() => {
    if (!body.current) return
    for (let i = 0; i < MAX_PEOPLE; i++) body.current.setColorAt(i, palette.passengers[0])
    if (body.current.instanceColor) body.current.instanceColor.needsUpdate = true
  }, [palette])

  const m4 = useMemo(() => new THREE.Matrix4(), [])
  const q = useMemo(() => new THREE.Quaternion(), [])
  const e = useMemo(() => new THREE.Euler(), [])
  const v = useMemo(() => new THREE.Vector3(), [])
  const one = useMemo(() => new THREE.Vector3(1, 1, 1), [])
  const tmp = useMemo(() => new THREE.Color(), [])

  useFrame((st) => {
    const ctx = ctxRef.current
    const B = body.current
    const H = head.current
    const W = wands.current
    if (!B || !H || !W) return
    const n = ctx ? crowdAt(ctx, buf) : 0
    let wandCount = 0
    const tS = st.clock.elapsedTime
    for (let i = 0; i < n; i++) {
      const o = i * STRIDE
      const x = buf[o]
      const y = buf[o + 1]
      const h = buf[o + 2]
      const heading = buf[o + 3]
      const role = buf[o + 4]
      const gait = buf[o + 5]
      const id = buf[o + 6]
      const walking = gait >= 0
      const bob = walking && !reduced ? Math.abs(Math.sin(gait * Math.PI * 2)) * 0.05 : 0
      const sway = walking && !reduced ? Math.sin(gait * Math.PI * 2) * 0.04 : 0
      e.set(0, (-heading * Math.PI) / 180, sway)
      q.setFromEuler(e)
      v.set(x, h + bob, -y)
      m4.compose(v, q, one)
      B.setMatrixAt(i, m4)
      v.set(x, h + bob + HEAD_Y, -y)
      m4.compose(v, q, one)
      H.setMatrixAt(i, m4)
      if (role === ROLE_CODE.crew || role === ROLE_CODE.marshaller) tmp.copy(palette.crew)
      else if (role === ROLE_CODE.controller) tmp.copy(palette.controller)
      else tmp.copy(palette.passengers[Math.abs(Math.round(id)) % palette.passengers.length])
      B.setColorAt(i, tmp)
      // The marshaller's lit wands: "straight ahead" (arms beckoning above the head).
      if (role === ROLE_CODE.marshaller && wandCount < 2) {
        const r = (heading * Math.PI) / 180
        const lift = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(tS * 3)
        for (const side of [-1, 1]) {
          const dx = Math.cos(r) * 0.35 * side
          const dy = -Math.sin(r) * 0.35 * side
          e.set(0, -r, side * (0.3 + lift * 0.9))
          q.setFromEuler(e)
          v.set(x + dx, h + 1.45 + lift * 0.35, -(y + dy))
          m4.compose(v, q, one)
          W.setMatrixAt(wandCount++, m4)
        }
      }
    }
    B.count = n
    H.count = n
    W.count = wandCount
    B.instanceMatrix.needsUpdate = true
    H.instanceMatrix.needsUpdate = true
    W.instanceMatrix.needsUpdate = true
    if (B.instanceColor) B.instanceColor.needsUpdate = true
  })

  return (
    <group userData={{ noPenPlot: true }}>
      <instancedMesh ref={body} args={[geo.b, mats.body, MAX_PEOPLE]} frustumCulled={false} />
      <instancedMesh ref={head} args={[geo.h, mats.head, MAX_PEOPLE]} frustumCulled={false} />
      <instancedMesh ref={wands} args={[geo.w, mats.wand, 2]} frustumCulled={false} />
    </group>
  )
}
