/**
 * The camera of the journey stage. In "follow" it keeps CNS700 exactly in the
 * centre and eases its angle and distance with the phase; "tower" looks from
 * the tower cab with binocular zoom; "overview" shows the whole airport or the
 * whole terminal-area table. The learner can drag to look around (on touch,
 * sideways drags only, so the page still scrolls); double-click resets.
 */
import { useEffect, useRef, type MutableRefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { StoreApi } from 'zustand'
import { angleDiff, distanceNm } from '@/core/geometry'
import { TOWER_POS, TOWER_EYE_M } from '@/modules/surface/layout'
import { TABLE_RADIUS_NM, toU } from '@/stage/scale'
import type { SandboxEngine } from '../engine'
import { clipPlanes, followIntent, narrowViewFactor, towerFovDeg, type WorldView } from '../director'
import { STAIRS_TOP } from '../agents'
import { aglM } from '../jscale'
import type { SandboxState } from '../state'
import { FUSELAGE_Y } from './Airliner'

/** The learner's orbit offsets, degrees (shared with the keyboard controls outside the canvas). */
export interface LookOffsets {
  yaw: number
  pitch: number
  /** Bumped by the keyboard or double-click to snap back to the framing. */
  reset: number
}

const AIRPORT_CENTRE = new THREE.Vector3(-250, 0, -120)
/** Just north of the airstairs: the stairs, the walk from the gate and the terminal front in one frame. */
const GATE_FOCUS = { x: STAIRS_TOP.x - 2, y: STAIRS_TOP.y + 16 }
const TABLE_CENTRE = new THREE.Vector3(0, 0, 0)

/** Offset from a target at a bearing (clockwise from north, north = −z) and height angle. */
function orbit(dist: number, elevDeg: number, bearingDeg: number, out: THREE.Vector3) {
  const e = (elevDeg * Math.PI) / 180
  const b = (bearingDeg * Math.PI) / 180
  const h = dist * Math.cos(e)
  return out.set(Math.sin(b) * h, dist * Math.sin(e), -Math.cos(b) * h)
}

export function JourneyCamera({ engine, store, view, reduced, look }: { engine: SandboxEngine; store: StoreApi<SandboxState>; view: WorldView; reduced: boolean; look: MutableRefObject<LookOffsets> }) {
  const { camera, gl, size } = useThree()
  const s = useRef({ dist: 0, elev: 0, yaw: 0, fov: 38, key: '' })
  const target = useRef(new THREE.Vector3())
  const off = useRef(new THREE.Vector3())
  const towerEye = useRef(new THREE.Vector3(TOWER_POS.x, TOWER_EYE_M, -TOWER_POS.y))

  // Drag to look around.
  useEffect(() => {
    const el = gl.domElement
    el.style.touchAction = 'pan-y'
    let drag: { id: number; x: number; y: number; touch: boolean } | null = null
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, touch: e.pointerType === 'touch' }
    }
    const move = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return
      const dx = e.clientX - drag.x
      const dy = e.clientY - drag.y
      if (drag.touch && Math.abs(dy) > Math.abs(dx)) return
      drag.x = e.clientX
      drag.y = e.clientY
      if (!el.hasPointerCapture(e.pointerId)) el.setPointerCapture(e.pointerId)
      el.style.cursor = 'grabbing'
      look.current.yaw -= dx * 0.35
      if (!drag.touch) look.current.pitch = Math.max(-15, Math.min(45, look.current.pitch + dy * 0.2))
    }
    const up = (e: PointerEvent) => {
      if (drag && e.pointerId === drag.id) drag = null
      el.style.cursor = ''
    }
    const reset = () => {
      look.current = { yaw: 0, pitch: 0, reset: look.current.reset + 1 }
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('dblclick', reset)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('dblclick', reset)
    }
  }, [gl, look])

  useFrame((_, realDt) => {
    const st = store.getState()
    const cam = camera as THREE.PerspectiveCamera
    const pose = engine.journeyPose()
    if (!pose) return
    // A new view, camera mode, reset or jump starts from its own framing.
    const key = `${view}|${st.cameraMode}|${st.cameraResetKey}|${look.current.reset}|${engine.runId}`
    const snap = key !== s.current.key || reduced
    if (key !== s.current.key) {
      // A new view or mode starts from its own framing, not from where the learner dragged.
      look.current.yaw = 0
      look.current.pitch = 0
    }
    s.current.key = key
    const k = snap ? 1 : 1 - Math.exp(-Math.min(0.1, realDt) / 0.55)
    let want: { dist: number; elev: number; yaw: number; fov: number }
    let fixedEye: THREE.Vector3 | null = null
    const phase = engine.phase
    // The part of the canvas not covered by side panels.
    const visibleAspect = Math.max(0.2, (size.width - 2 * st.sideInsetPx) / Math.max(1, size.height))
    if (view === 'airport') {
      const agl = aglM(pose.altitudeFt)
      target.current.set(pose.posM.x, agl + FUSELAGE_Y, -pose.posM.y)
      if (st.cameraMode === 'tower') {
        fixedEye = towerEye.current
        const d = fixedEye.distanceTo(target.current)
        want = { dist: d, elev: 0, yaw: 0, fov: towerFovDeg(d / Math.max(0.35, st.zoom)) }
      } else if (st.cameraMode === 'overview') {
        target.current.copy(AIRPORT_CENTRE)
        want = { dist: (3200 * Math.min(2, Math.max(1, 1.6 / visibleAspect))) / st.zoom, elev: 34 + look.current.pitch, yaw: 165 + look.current.yaw, fov: 38 }
      } else if (phase === 'gate' || phase === 'arrived') {
        // At the gate the story is the boarding: frame the walk between the terminal and the stairs.
        target.current.set(GATE_FOCUS.x, 4, -GATE_FOCUS.y)
        const k = narrowViewFactor(visibleAspect) ** 0.5
        // From the south-west: the terminal door on the left, the walk across the apron, the stairs and the aircraft on the right.
        want = { dist: (150 * k) / st.zoom, elev: 26 + look.current.pitch, yaw: 225 + look.current.yaw, fov: 38 }
      } else {
        const f = followIntent('airport', phase, agl, st.zoom, visibleAspect)
        want = { dist: f.dist, elev: f.elevDeg + look.current.pitch, yaw: pose.headingDeg + f.yawDeg + look.current.yaw, fov: f.fov }
      }
    } else {
      const onTable = distanceNm(pose.pos, { x: 0, y: 0 }) <= TABLE_RADIUS_NM
      if (st.cameraMode === 'follow' && onTable) {
        target.current.set(...toU(pose.pos, pose.altitudeFt))
        const f = followIntent('terminal', phase, 0, st.zoom, visibleAspect)
        want = { dist: f.dist, elev: f.elevDeg + look.current.pitch, yaw: pose.headingDeg + f.yawDeg + look.current.yaw, fov: f.fov }
      } else {
        target.current.copy(TABLE_CENTRE)
        want = { dist: (26 * Math.min(2, Math.max(1, 1.6 / visibleAspect))) / st.zoom, elev: 50 + look.current.pitch, yaw: 180 + look.current.yaw, fov: 36 }
      }
    }
    const c = s.current
    if (snap) {
      c.dist = want.dist
      c.elev = want.elev
      c.yaw = want.yaw
      c.fov = want.fov
    } else {
      c.dist += (want.dist - c.dist) * k
      c.elev += (want.elev - c.elev) * k
      c.yaw += angleDiff(c.yaw, want.yaw) * k
      c.fov += (want.fov - c.fov) * k
    }
    if (fixedEye) cam.position.copy(fixedEye)
    else {
      cam.position.copy(target.current).add(orbit(c.dist, c.elev, c.yaw, off.current))
      // Never under the ground.
      if (view === 'airport') cam.position.y = Math.max(2, cam.position.y)
    }
    cam.lookAt(target.current)
    const clip = clipPlanes(view, fixedEye ? cam.position.distanceTo(target.current) : c.dist)
    if (Math.abs(cam.fov - c.fov) > 1e-3 || cam.near !== clip.near || cam.far !== clip.far) {
      cam.fov = c.fov
      cam.near = clip.near
      cam.far = clip.far
      cam.updateProjectionMatrix()
    }
  })
  return null
}
