import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useReducedMotion } from '@/stores/prefs'

/**
 * "Pen-plot" reveal: on first render the model is traced as glowing edge
 * lines, which then give way to the lit materials. Wrap any group of meshes.
 * With reduced motion the model appears immediately.
 */
export function PenPlot({
  children,
  color,
  durationS = 2.2,
  delayS = 0.2,
  keepLinesOpacity = 0.14,
}: {
  children: ReactNode
  color: THREE.Color
  durationS?: number
  delayS?: number
  /** Edge lines stay faintly visible afterwards (blueprint feel). */
  keepLinesOpacity?: number
}) {
  const group = useRef<THREE.Group>(null)
  const lines = useRef<{ line: THREE.LineSegments; total: number }[]>([])
  const mats = useRef<{ m: THREE.Material; opacity: number; transparent: boolean }[]>([])
  const start = useRef<number | null>(null)
  const reduced = useReducedMotion()

  useLayoutEffect(() => {
    const g = group.current
    if (!g) return
    const made: { line: THREE.LineSegments; total: number }[] = []
    const seen = new Set<THREE.Material>()
    g.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh || mesh.userData.noPenPlot) return
      const edges = new THREE.EdgesGeometry(mesh.geometry, 28)
      const mat = new THREE.LineDashedMaterial({ color, transparent: true, opacity: 0.95, dashSize: 1, gapSize: 1e6, toneMapped: false })
      const line = new THREE.LineSegments(edges, mat)
      line.computeLineDistances()
      const dist = line.geometry.getAttribute('lineDistance') as THREE.BufferAttribute
      let total = 0
      for (let i = 0; i < dist.count; i++) total = Math.max(total, dist.getX(i))
      line.userData.penPlot = true
      mesh.add(line)
      made.push({ line, total: Math.max(total, 1e-3) })
      const ms = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const m of ms) {
        if (seen.has(m)) continue
        seen.add(m)
        mats.current.push({ m, opacity: m.opacity, transparent: m.transparent })
        m.transparent = true
        m.opacity = reduced ? m.opacity : 0
      }
    })
    lines.current = made
    return () => {
      for (const { line } of made) {
        line.parent?.remove(line)
        line.geometry.dispose()
        ;(line.material as THREE.Material).dispose()
      }
      for (const { m, opacity, transparent } of mats.current) {
        m.opacity = opacity
        m.transparent = transparent
      }
      mats.current = []
    }
    // The reveal runs once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useFrame((state) => {
    if (start.current === null) start.current = state.clock.elapsedTime
    const tS = state.clock.elapsedTime - start.current - delayS
    const draw = reduced ? 1 : Math.min(1, Math.max(0, tS / durationS))
    const fill = reduced ? 1 : Math.min(1, Math.max(0, (tS - durationS * 0.7) / 0.9))
    const eased = 1 - Math.pow(1 - draw, 3)
    for (const { line, total } of lines.current) {
      const m = line.material as THREE.LineDashedMaterial
      m.dashSize = Math.max(1e-4, eased * total)
      m.opacity = 0.95 - (0.95 - keepLinesOpacity) * fill
    }
    for (const { m, opacity } of mats.current) {
      m.opacity = opacity * fill
      if (fill >= 1 && m.opacity === opacity) m.transparent = opacity < 1
    }
  })

  return <group ref={group}>{children}</group>
}
