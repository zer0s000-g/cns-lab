import { Suspense, useEffect, useState, type ReactNode } from 'react'
import { Canvas } from '@react-three/fiber'
import { Skeleton } from '@/components/ui/skeleton'
import { useThemeTokens, type ThemeTokens } from '@/hooks/useThemeTokens'
import { toThreeStyle } from '@/lib/color'
import { cn } from '@/lib/utils'

/** three.js colour string for a design token. */
export const tc = (t: ThemeTokens, name: keyof ThemeTokens) => toThreeStyle(String(t[name]))

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas')
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

/**
 * Wrapper for react-three-fiber scenes: lazy-friendly, themed background,
 * a text fallback when WebGL is unavailable, and an accessible label.
 */
export function Scene3D({
  children,
  label,
  className,
  camera = { position: [6, 5, 8] as [number, number, number], fov: 40 },
  fallback,
  background = 'sim-bg',
}: {
  children: (t: ThemeTokens) => ReactNode
  label: string
  className?: string
  camera?: { position: [number, number, number]; fov?: number }
  fallback?: ReactNode
  background?: 'sim-bg' | 'scope-bg' | 'sim-sky'
}) {
  const t = useThemeTokens()
  const [ok, setOk] = useState<boolean | null>(null)
  useEffect(() => setOk(webglAvailable()), [])
  return (
    <div role="img" aria-label={label} className={cn('relative overflow-hidden rounded-lg border', className)}>
      {ok === null ? (
        <Skeleton className="absolute inset-0" />
      ) : ok ? (
        <Suspense fallback={<Skeleton className="absolute inset-0" />}>
          <Canvas camera={camera} dpr={[1, 2]} gl={{ antialias: true }} style={{ position: 'absolute', inset: 0 }}>
            <color attach="background" args={[tc(t, background)]} />
            {children(t)}
          </Canvas>
        </Suspense>
      ) : (
        <div className="absolute inset-0 grid place-items-center p-4 text-center text-xs text-muted-foreground">
          {fallback ?? '3D view needs WebGL, which this browser does not provide.'}
        </div>
      )}
    </div>
  )
}
