import { Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, Environment, Grid, Lightformer, PerformanceMonitor } from '@react-three/drei'
import { Bloom, EffectComposer, Noise, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'
import { useThemeTokens, type ThemeTokens } from '@/hooks/useThemeTokens'
import { useReducedMotion } from '@/stores/prefs'
import { toThreeStyle } from '@/lib/color'
import { cn } from '@/lib/utils'

import type { Quality, Shot } from './types'
export type { Quality, Shot } from './types'

/** three.js colour for a design token. */
export const col = (t: ThemeTokens, name: keyof ThemeTokens) => new THREE.Color(toThreeStyle(String(t[name])))

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas')
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}


/**
 * Eases the camera toward the current shot every frame (snaps when the
 * learner prefers reduced motion). `drift` adds a very slow idle orbit.
 */
/**
 * Drag to look around: mouse and pen orbit around the current shot's target
 * (yaw and a limited pitch); on touch only sideways drags turn the view, so a
 * vertical swipe still scrolls the page. Double-click resets, and a new
 * chapter shot starts from the unturned view. No wheel zoom: the stage fills
 * the page background and the wheel must keep scrolling the page.
 */
function useLookAround(shot: Shot) {
  const { gl } = useThree()
  const look = useRef({ yaw: 0, pitch: 0 })
  useEffect(() => {
    look.current = { yaw: 0, pitch: 0 }
  }, [shot])
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
      look.current.yaw -= dx * 0.006
      if (!drag.touch) look.current.pitch = Math.max(-0.3, Math.min(0.35, look.current.pitch + dy * 0.004))
    }
    const up = (e: PointerEvent) => {
      if (drag && e.pointerId === drag.id) drag = null
      el.style.cursor = ''
    }
    const reset = () => {
      look.current = { yaw: 0, pitch: 0 }
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
  }, [gl])
  return look
}

function CameraRig({ shot, drift, reduced }: { shot: Shot; drift: boolean; reduced: boolean }) {
  const { camera } = useThree()
  const target = useRef(new THREE.Vector3(...shot.target))
  const pos = useRef(new THREE.Vector3(...shot.position))
  const first = useRef(true)
  const look = useLookAround(shot)
  const yawNow = useRef(0)
  const pitchNow = useRef(0)
  useLayoutEffect(() => {
    if (first.current || reduced) {
      camera.position.set(...shot.position)
      target.current.set(...shot.target)
      pos.current.set(...shot.position)
      camera.lookAt(target.current)
      first.current = false
    }
  }, [camera, shot, reduced])
  useFrame((state, dt) => {
    const k = reduced ? 1 : 1 - Math.exp(-dt / 0.55)
    const kLook = reduced ? 1 : 1 - Math.exp(-dt / 0.12)
    yawNow.current += (look.current.yaw - yawNow.current) * kLook
    pitchNow.current += (look.current.pitch - pitchNow.current) * kLook
    const tgt = new THREE.Vector3(...shot.target)
    const off = new THREE.Vector3(...shot.position).sub(tgt)
    if (drift && !reduced) {
      // A slow, small orbit around the target keeps the scene alive.
      const a = state.clock.elapsedTime * 0.05
      off.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.sin(a) * 0.08)
    }
    // The learner's drag: yaw about the vertical, pitch about the camera's right axis.
    off.applyAxisAngle(new THREE.Vector3(0, 1, 0), yawNow.current)
    if (pitchNow.current) {
      const right = new THREE.Vector3(0, 1, 0).cross(off).normalize()
      if (right.lengthSq() > 0) off.applyAxisAngle(right, pitchNow.current)
    }
    const want = tgt.clone().add(off)
    pos.current.lerp(want, k)
    target.current.lerp(tgt, k)
    camera.position.copy(pos.current)
    const cam = camera as THREE.PerspectiveCamera
    const fov = shot.fov ?? 30
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov += (fov - cam.fov) * k
      cam.updateProjectionMatrix()
    }
    camera.lookAt(target.current)
  })
  return null
}

/** Studio lighting: soft key, cool rim, warm practical, all from light-formers (no files). */
export function StudioLights({ t }: { t: ThemeTokens }) {
  return (
    <>
      <ambientLight intensity={0.18} />
      <directionalLight position={[8, 14, 6]} intensity={1.6} castShadow={false} color={col(t, 'stage-paint')} />
      <directionalLight position={[-10, 6, -8]} intensity={0.9} color={col(t, 'stage-signal')} />
      <pointLight position={[-6, 3, 6]} intensity={14} distance={24} color={col(t, 'stage-brass')} />
      <Environment resolution={128} frames={1}>
        <Lightformer form="rect" intensity={2.2} position={[0, 6, -8]} scale={[12, 3, 1]} color={toThreeStyle(t['stage-paint'])} />
        <Lightformer form="rect" intensity={1.4} position={[-8, 3, 2]} rotation-y={Math.PI / 2} scale={[8, 2, 1]} color={toThreeStyle(t['stage-signal'])} />
        <Lightformer form="rect" intensity={1.2} position={[8, 2, 4]} rotation-y={-Math.PI / 2} scale={[8, 2, 1]} color={toThreeStyle(t['stage-brass'])} />
        <Lightformer form="circle" intensity={0.8} position={[0, 10, 0]} rotation-x={Math.PI / 2} scale={6} color={toThreeStyle(t['stage-paint'])} />
      </Environment>
    </>
  )
}

/** Blueprint floor: fading grid plus a soft contact shadow under the hero. */
export function StudioFloor({ t, y = 0, shadowScale = 22 }: { t: ThemeTokens; y?: number; shadowScale?: number }) {
  return (
    <group position={[0, y, 0]}>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.01, 0]} receiveShadow>
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
      <ContactShadows position={[0, 0.01, 0]} scale={shadowScale} blur={2.6} opacity={0.55} far={6} resolution={512} frames={1} />
    </group>
  )
}

function Effects({ quality }: { quality: Quality }) {
  if (quality === 'low') return null
  return (
    <EffectComposer multisampling={quality === 'high' ? 4 : 0} enableNormalPass={false}>
      <Bloom mipmapBlur intensity={0.85} luminanceThreshold={0.62} luminanceSmoothing={0.2} radius={0.72} />
      <Noise premultiply opacity={0.35} />
      <Vignette eskil={false} offset={0.22} darkness={0.78} />
    </EffectComposer>
  )
}

/**
 * The full-bleed 3D stage used by every redesigned module. Children receive
 * the current theme tokens. Falls back to `fallback` when WebGL is missing.
 */
export function Stage({
  children,
  shot,
  label,
  className,
  fallback,
  drift = true,
  onCreated,
  interactive = false,
}: {
  children: (t: ThemeTokens, quality: Quality) => ReactNode
  shot: Shot
  label: string
  className?: string
  fallback?: ReactNode
  drift?: boolean
  onCreated?: () => void
  /** The scene holds clickable labels: expose it as a labelled group instead of an image. */
  interactive?: boolean
}) {
  const t = useThemeTokens()
  const reduced = useReducedMotion()
  const [ok, setOk] = useState<boolean | null>(null)
  const [quality, setQuality] = useState<Quality>('high')
  const [dpr, setDpr] = useState(1.5)
  useEffect(() => setOk(webglAvailable()), [])
  // Stop rendering while the stage is scrolled out of view (browsers already
  // throttle hidden tabs).
  const root = useRef<HTMLDivElement>(null)
  const [onScreen, setOnScreen] = useState(true)
  useEffect(() => {
    const el = root.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting), { rootMargin: '120px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <div ref={root} role={interactive ? 'group' : 'img'} aria-roledescription={interactive ? '3D view' : undefined} aria-label={label} className={cn('relative overflow-hidden bg-stage-bg', className)}>
      {ok === false ? (
        <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-muted-foreground">{fallback ?? '3D view needs WebGL.'}</div>
      ) : ok ? (
        <Canvas
          frameloop={onScreen ? 'always' : 'never'}
          dpr={dpr}
          gl={{ antialias: false, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
          camera={{ position: shot.position, fov: shot.fov ?? 30, near: 0.1, far: 400 }}
          style={{ position: 'absolute', inset: 0 }}
          onCreated={() => onCreated?.()}
        >
          <color attach="background" args={[col(t, 'stage-bg')]} />
          <fog attach="fog" args={[col(t, 'stage-fog'), 26, 90]} />
          <PerformanceMonitor
            onDecline={() => {
              setQuality((q) => (q === 'high' ? 'medium' : 'low'))
              setDpr((d) => Math.max(1, d - 0.25))
            }}
            onIncline={() => setDpr((d) => Math.min(2, d + 0.25))}
          >
            <Suspense fallback={null}>
              <StudioLights t={t} />
              {children(t, quality)}
            </Suspense>
            <CameraRig shot={shot} drift={drift} reduced={reduced} />
            <Effects quality={reduced ? 'medium' : quality} />
          </PerformanceMonitor>
        </Canvas>
      ) : null}
    </div>
  )
}
