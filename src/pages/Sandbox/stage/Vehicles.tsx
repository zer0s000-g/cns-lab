/**
 * Ground vehicles from the pure model in agents.ts: the push-back tug, stair
 * truck, baggage train, fuel truck, cars at the kerb and the airport
 * operations car. Simple boxes and cylinders at true size, nose along −z.
 */
import { useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { ThemeTokens } from '@/hooks/useThemeTokens'
import { col } from '@/stage/Stage'
import { createVehicles, vehiclesAt, type VehicleContext, type VehicleKind } from '../agents'

type Mats = ReturnType<typeof useVehicleMats>

function useVehicleMats(t: ThemeTokens) {
  const m = useMemo(
    () => ({
      brass: new THREE.MeshStandardMaterial({ color: col(t, 'stage-brass'), roughness: 0.5, metalness: 0.3 }),
      paint: new THREE.MeshStandardMaterial({ color: col(t, 'stage-paint'), roughness: 0.45, metalness: 0.3 }),
      metal: new THREE.MeshStandardMaterial({ color: col(t, 'stage-metal'), roughness: 0.6, metalness: 0.4 }),
      dark: new THREE.MeshStandardMaterial({ color: col(t, 'stage-metal-dark'), roughness: 0.6, metalness: 0.5 }),
      glass: new THREE.MeshStandardMaterial({ color: col(t, 'stage-bg'), roughness: 0.2, metalness: 0.8 }),
      beacon: new THREE.MeshBasicMaterial({ color: col(t, 'lamp-amber'), toneMapped: false }),
    }),
    [t],
  )
  useLayoutEffect(() => () => Object.values(m).forEach((x) => x.dispose()), [m])
  return m
}

const box = (w: number, h: number, l: number) => new THREE.BoxGeometry(w, h, l)

type Part = { geo: THREE.BufferGeometry; mat: THREE.Material; p: number[] }

function Model({ kind, m, index }: { kind: VehicleKind; m: Mats; index: number }) {
  const g = useMemo((): Part[] => {
    switch (kind) {
      case 'tug':
        return [
          { geo: box(2.8, 1.2, 6), mat: m.brass, p: [0, 0.8, 0] },
          { geo: box(2.2, 0.9, 1.6), mat: m.glass, p: [0, 1.8, 1.6] },
        ]
      case 'stairs': {
        // Chassis, cab at the back, and the stair ramp rising toward the front (the aircraft door).
        const ramp = new THREE.BoxGeometry(1.6, 0.25, 7.9)
        ramp.rotateX(Math.atan2(2.4, 7.4))
        return [
          { geo: box(2.4, 0.9, 8), mat: m.paint, p: [0, 0.75, 0] },
          { geo: box(2.2, 1.3, 1.8), mat: m.glass, p: [0, 1.6, 3.2] },
          { geo: ramp, mat: m.metal, p: [0, 2.35, -0.3] },
          { geo: box(0.08, 0.9, 7.6), mat: m.dark, p: [-0.8, 2.9, -0.3] },
          { geo: box(1.8, 0.2, 1.4), mat: m.metal, p: [0, 3.4, -3.9] },
        ]
      }
      case 'bagTractor':
        return [
          { geo: box(1.6, 1.1, 2.7), mat: m.paint, p: [0, 0.8, 0] },
          { geo: box(1.4, 0.7, 1.1), mat: m.glass, p: [0, 1.7, 0.4] },
        ]
      case 'bagCart':
        return [
          { geo: box(1.6, 0.25, 3.2), mat: m.dark, p: [0, 0.5, 0] },
          { geo: box(1.3, 0.9, 2.6), mat: m.metal, p: [0, 1.1, 0] },
        ]
      case 'fuel': {
        const tank = new THREE.CylinderGeometry(1.15, 1.15, 7, 20)
        tank.rotateX(Math.PI / 2)
        return [
          { geo: box(2.4, 0.6, 10), mat: m.dark, p: [0, 0.6, 0] },
          { geo: box(2.4, 2.1, 2.2), mat: m.paint, p: [0, 1.9, -3.8] },
          { geo: tank, mat: m.paint, p: [0, 2.1, 1.3] },
        ]
      }
      case 'car':
      case 'ops': {
        const body = index % 3 === 0 ? m.metal : index % 3 === 1 ? m.paint : m.dark
        const parts: Part[] = [
          { geo: box(1.8, 0.75, 4.4), mat: kind === 'ops' ? m.brass : body, p: [0, 0.65, 0] },
          { geo: box(1.6, 0.6, 2.3), mat: m.glass, p: [0, 1.3, 0.3] },
        ]
        if (kind === 'ops') parts.push({ geo: box(1.0, 0.18, 0.3), mat: m.beacon, p: [0, 1.7, 0.3] })
        return parts
      }
    }
  }, [kind, m, index])
  useLayoutEffect(() => () => g.forEach((x) => x.geo.dispose()), [g])
  return (
    <>
      {g.map((x, i) => (
        <mesh key={i} geometry={x.geo} material={x.mat} position={x.p as [number, number, number]} />
      ))}
    </>
  )
}

export function Vehicles({ t, ctxRef }: { t: ThemeTokens; ctxRef: MutableRefObject<VehicleContext | null> }) {
  const m = useVehicleMats(t)
  const list = useMemo(() => createVehicles(), [])
  const groups = useRef<(THREE.Group | null)[]>([])
  useFrame(() => {
    const ctx = ctxRef.current
    if (!ctx) return
    vehiclesAt(ctx, list)
    list.forEach((v, i) => {
      const g = groups.current[i]
      if (!g) return
      const on = v.visible && v.fade > 0.001
      g.visible = on
      if (!on) return
      g.position.set(v.x, 0, -v.y)
      g.rotation.y = (-v.headingDeg * Math.PI) / 180
      g.scale.setScalar(Math.max(0.001, v.fade))
    })
  })
  return (
    <group userData={{ noPenPlot: true }}>
      {list.map((v, i) => (
        <group key={i} ref={(el) => void (groups.current[i] = el)} visible={false}>
          <Model kind={v.kind} m={m} index={i} />
        </group>
      ))}
    </group>
  )
}
