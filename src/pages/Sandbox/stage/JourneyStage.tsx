/**
 * The 3D stage of the journey: one WebGL canvas holding two worlds, the
 * airport at true scale and the terminal-area table. Only the world being
 * shown is visible; both stay mounted so switching is instant and nothing
 * leaks. Rendering stops while the 2D region map covers the stage and while
 * the stage is scrolled out of view. Loaded lazily (it carries three.js).
 */
import { Suspense, useEffect, useRef, useState, type MutableRefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer, PerformanceMonitor } from '@react-three/drei'
import * as THREE from 'three'
import { useStore, type StoreApi } from 'zustand'
import { useThemeTokens, type ThemeTokens } from '@/hooks/useThemeTokens'
import { toThreeStyle } from '@/lib/color'
import { cn } from '@/lib/utils'
import { Bloom, EffectComposer, Noise, Vignette } from '@react-three/postprocessing'
import { col, webglAvailable, type Quality } from '@/stage/Stage'
import type { SandboxEngine } from '../engine'
import type { WorldView } from '../director'
import { AIRPORT_FOG, TABLE_FOG } from '../jscale'
import type { SandboxState } from '../state'
import { AirportWorld } from './AirportWorld'
import { JourneyCamera, type LookOffsets } from './JourneyCamera'
import { TerminalWorld } from './TerminalWorld'

/** Lighting that works at both scales: no point lights (their reach depends on scale). */
function JourneyLights({ t }: { t: ThemeTokens }) {
  return (
    <>
      <ambientLight intensity={0.22} />
      <hemisphereLight args={[col(t, 'stage-paint'), col(t, 'stage-floor'), 0.35]} />
      <directionalLight position={[8, 14, 6]} intensity={1.5} color={col(t, 'stage-paint')} />
      <directionalLight position={[-10, 6, -8]} intensity={0.8} color={col(t, 'stage-signal')} />
      <Environment resolution={128} frames={1}>
        <Lightformer form="rect" intensity={2.2} position={[0, 6, -8]} scale={[12, 3, 1]} color={toThreeStyle(t['stage-paint'])} />
        <Lightformer form="rect" intensity={1.4} position={[-8, 3, 2]} rotation-y={Math.PI / 2} scale={[8, 2, 1]} color={toThreeStyle(t['stage-signal'])} />
        <Lightformer form="rect" intensity={1.2} position={[8, 2, 4]} rotation-y={-Math.PI / 2} scale={[8, 2, 1]} color={toThreeStyle(t['stage-brass'])} />
        <Lightformer form="circle" intensity={0.8} position={[0, 10, 0]} rotation-x={Math.PI / 2} scale={6} color={toThreeStyle(t['stage-paint'])} />
      </Environment>
    </>
  )
}

/**
 * Post-processing as on the other stages (bloom, grain, vignette), except that the film grain,
 * which changes every frame, is left out when the learner prefers reduced motion.
 */
function JourneyEffects({ quality, reduced }: { quality: Quality; reduced: boolean }) {
  if (quality === 'low') return null
  return (
    <EffectComposer multisampling={quality === 'high' ? 4 : 0} enableNormalPass={false}>
      <Bloom mipmapBlur intensity={0.85} luminanceThreshold={0.62} luminanceSmoothing={0.2} radius={0.72} />
      {reduced ? <></> : <Noise premultiply opacity={0.35} />}
      <Vignette eskil={false} offset={0.22} darkness={0.78} />
    </EffectComposer>
  )
}

/** Fog distances for the world on show (the airport is in metres, the table in table units). */
function FogByView({ view }: { view: WorldView }) {
  const { scene } = useThree()
  useFrame(() => {
    const fog = scene.fog as THREE.Fog | null
    if (!fog) return
    const [near, far] = view === 'airport' ? AIRPORT_FOG : TABLE_FOG
    fog.near = near
    fog.far = far
  })
  return null
}

/** Compile every material once, with both worlds briefly visible, so the first switch does not stall. */
function Precompile() {
  const { gl, scene, camera } = useThree()
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const hidden: THREE.Object3D[] = []
      scene.traverse((o) => {
        if (o.userData.world && !o.visible) {
          o.visible = true
          hidden.push(o)
        }
      })
      try {
        gl.compile(scene, camera)
      } finally {
        hidden.forEach((o) => (o.visible = false))
      }
    })
    return () => cancelAnimationFrame(id)
  }, [gl, scene, camera])
  return null
}

/** With ?debug in the address, expose the renderer's counters (the leak check in scripts/verify reads them). */
function DebugHook() {
  const { gl } = useThree()
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('debug')) return
    const w = window as unknown as { __sandboxGl?: THREE.WebGLRenderer }
    w.__sandboxGl = gl
    return () => {
      delete w.__sandboxGl
    }
  }, [gl])
  return null
}

export interface JourneyStageProps {
  engine: SandboxEngine
  store: StoreApi<SandboxState>
  /** The 3D world to show (the last one when the region map is on top). */
  world: WorldView
  /** The 2D map covers the stage: stop rendering. */
  paused: boolean
  reduced: boolean
  look: MutableRefObject<LookOffsets>
  label: string
  className?: string
}

export default function JourneyStage({ engine, store, world, paused, reduced, look, label, className }: JourneyStageProps) {
  const t = useThemeTokens()
  // The small site labels crowd the close follow view; they show in the overview.
  const overview = useStore(store, (s) => s.cameraMode === 'overview')
  const [ok, setOk] = useState<boolean | null>(null)
  const [quality, setQuality] = useState<Quality>('high')
  // Start at the screen's pixel ratio (capped at 2) and only ever step down: raising it resizes the canvas (a flash).
  const [dpr, setDpr] = useState(() => Math.min(2, Math.max(1, typeof window !== 'undefined' ? window.devicePixelRatio : 1)))
  const lastSwitch = useRef(0)
  useEffect(() => setOk(webglAvailable()), [])
  useEffect(() => {
    lastSwitch.current = performance.now()
  }, [world, paused])
  // One resize nudge after mount makes the canvas's first measurement reliable (React StrictMode).
  useEffect(() => {
    if (!ok) return
    const id = requestAnimationFrame(() => window.dispatchEvent(new Event('resize')))
    return () => cancelAnimationFrame(id)
  }, [ok])
  const root = useRef<HTMLDivElement>(null)
  // Labels live in their own layer from the first frame, so their roots never move (drei Html
  // otherwise re-creates them when the canvas connects its events).
  const labels = useRef<HTMLDivElement>(null) as MutableRefObject<HTMLDivElement>
  const [onScreen, setOnScreen] = useState(true)
  useEffect(() => {
    const el = root.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting), { rootMargin: '120px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <div ref={root} role="img" aria-label={label} className={cn('relative overflow-hidden bg-stage-bg', className)} data-testid="journey-stage">
      {/* Before the canvas in the tree, so the element exists when the scene first renders; above it on screen. */}
      <div ref={labels} className="pointer-events-none absolute inset-0 z-10 overflow-hidden" />
      {ok === false ? (
        <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-muted-foreground">The 3D view needs WebGL. The panels and the region map still work.</div>
      ) : ok ? (
        <Canvas
          frameloop={onScreen && !paused ? 'always' : 'never'}
          dpr={dpr}
          gl={{ antialias: false, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
          camera={{ position: [0, 200, 400], fov: 38, near: 0.5, far: 30000 }}
          style={{ position: 'absolute', inset: 0 }}
        >
          <color attach="background" args={[col(t, 'stage-bg')]} />
          <fog attach="fog" args={[col(t, 'stage-fog'), AIRPORT_FOG[0], AIRPORT_FOG[1]]} />
          <PerformanceMonitor
            onDecline={() => {
              // Shader compilation after a switch is not a slow device.
              if (performance.now() - lastSwitch.current < 2500) return
              setQuality((q) => (q === 'high' ? 'medium' : 'low'))
              setDpr((d) => Math.max(1, d - 0.25))
            }}
          >
            <Suspense fallback={null}>
              <JourneyLights t={t} />
              {/* While the region map covers the stage, both worlds (and their labels) are off. */}
              <AirportWorld t={t} engine={engine} active={world === 'airport' && !paused} reduced={reduced} pixelRatio={dpr} highRes={quality === 'high'} labels={labels} />
              <TerminalWorld t={t} engine={engine} active={world === 'terminal' && !paused} labels={labels} overview={overview} />
              <Precompile />
            </Suspense>
            <FogByView view={world} />
            <DebugHook />
            <JourneyCamera engine={engine} store={store} view={world} reduced={reduced} look={look} />
            <JourneyEffects quality={reduced ? 'medium' : quality} reduced={reduced} />
          </PerformanceMonitor>
        </Canvas>
      ) : null}
    </div>
  )
}
