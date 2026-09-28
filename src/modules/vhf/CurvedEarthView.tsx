import { useCallback, useRef, type ReactNode } from 'react'
import { Canvas2D, type DrawFn, type DrawInfo } from '@/components/sim/Canvas2D'
import { SimLabel } from '@/components/sim/Controls'
import { useSampled } from '@/hooks/useSampled'
import { cn } from '@/lib/utils'
import { fitSideProjection, type SideDomain, type SideFrame, type SideProjection } from './curvedEarth'

/** Shared curved-Earth side view (VHF and HF). See curvedEarth.ts for the geometry. */

export interface CurvedEarthViewProps {
  frame: SideFrame
  /** Domain for the current canvas size (lets narrow screens show less). */
  domain: (width: number, height: number) => SideDomain
  /** Pixels to keep free around the drawing. */
  padding?: { top: number; right: number; bottom: number; left: number }
  draw: (ctx: CanvasRenderingContext2D, proj: SideProjection, info: DrawInfo) => void
  label: string
  className?: string
  /** Extra honesty labels shown next to "Heights exaggerated". */
  labels?: ReactNode
  /** Receives the projection each frame (for pointer hit-testing). */
  projRef?: React.MutableRefObject<SideProjection | null>
  onPointerDown?: React.PointerEventHandler<HTMLCanvasElement>
  onPointerMove?: React.PointerEventHandler<HTMLCanvasElement>
  onPointerUp?: React.PointerEventHandler<HTMLCanvasElement>
  onKeyDown?: React.KeyboardEventHandler<HTMLCanvasElement>
  focusable?: boolean
}

/** Canvas with a curved Earth whose heights are exaggerated, labelled on screen. */
export function CurvedEarthView({
  frame,
  domain,
  padding = { top: 36, right: 16, bottom: 26, left: 16 },
  draw,
  label,
  className,
  labels,
  projRef,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onKeyDown,
  focusable,
}: CurvedEarthViewProps) {
  const exRef = useRef(1)
  const frameRef = useRef(frame)
  frameRef.current = frame
  const drawRef = useRef(draw)
  drawRef.current = draw
  const domainRef = useRef(domain)
  domainRef.current = domain

  const paint: DrawFn = useCallback(
    (ctx, info) => {
      const rect = {
        x: padding.left,
        y: padding.top,
        w: Math.max(10, info.width - padding.left - padding.right),
        h: Math.max(10, info.height - padding.top - padding.bottom),
      }
      const proj = fitSideProjection(frameRef.current, domainRef.current(info.width, info.height), rect)
      exRef.current = proj.exaggeration
      if (projRef) projRef.current = proj
      drawRef.current(ctx, proj, info)
    },
    [padding.left, padding.right, padding.top, padding.bottom, projRef],
  )

  const ex = useSampled(() => exRef.current, 400, (a, b) => Math.abs(a - b) / Math.max(1, b) < 0.02)
  const exText = ex >= 10 ? Math.round(ex / 5) * 5 : ex >= 2 ? Math.round(ex) : Math.round(ex * 10) / 10

  return (
    <div className={cn('relative', className)}>
      <Canvas2D
        draw={paint}
        label={label}
        className="size-full rounded-md border"
        focusable={focusable}
        onCanvasPointerDown={onPointerDown}
        onCanvasPointerMove={onPointerMove}
        onCanvasPointerUp={onPointerUp}
        onCanvasKeyDown={onKeyDown}
      />
      <div className="pointer-events-none absolute top-2 left-2 flex max-w-[calc(100%-1rem)] flex-wrap gap-1.5">
        <SimLabel icon="none">Heights exaggerated about {exText}×</SimLabel>
        {labels}
      </div>
    </div>
  )
}
