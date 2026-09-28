import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type HTMLAttributes } from 'react'
import { useAnimationFrame } from '@/hooks/useAnimationFrame'
import { getThemeTokens, onThemeChange, type ThemeTokens } from '@/hooks/useThemeTokens'
import { cn } from '@/lib/utils'

export interface DrawInfo {
  /** CSS pixel size of the canvas. */
  width: number
  height: number
  dpr: number
  /** Real seconds since the previous frame. */
  dt: number
  now: number
  tokens: ThemeTokens
}

export type DrawFn = (ctx: CanvasRenderingContext2D, info: DrawInfo) => void

export interface Canvas2DProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  draw: DrawFn
  /** Redraw every animation frame (default). When false, redraws on resize, theme change or redrawKey change. */
  animate?: boolean
  redrawKey?: unknown
  /** Accessible description of what the canvas currently shows. */
  label: string
  /** Extra DOM overlays (labels, buttons) positioned over the canvas. */
  overlay?: React.ReactNode
  canvasClassName?: string
  /** Make the canvas focusable (for keyboard control). */
  focusable?: boolean
  onCanvasKeyDown?: React.KeyboardEventHandler<HTMLCanvasElement>
  onCanvasPointerDown?: React.PointerEventHandler<HTMLCanvasElement>
  onCanvasPointerMove?: React.PointerEventHandler<HTMLCanvasElement>
  onCanvasPointerUp?: React.PointerEventHandler<HTMLCanvasElement>
  onCanvasPointerLeave?: React.PointerEventHandler<HTMLCanvasElement>
}

export interface Canvas2DHandle {
  canvas: HTMLCanvasElement | null
  /** CSS pixel size. */
  size: () => { width: number; height: number }
  /** Pointer event → CSS pixel coordinates within the canvas. */
  toLocal: (e: { clientX: number; clientY: number }) => { x: number; y: number }
}

/**
 * A high-DPI canvas that fills its container, redraws at 60 fps while on
 * screen and reads colours from the theme tokens.
 */
export const Canvas2D = forwardRef<Canvas2DHandle, Canvas2DProps>(function Canvas2D(
  {
    draw,
    animate = true,
    redrawKey,
    label,
    overlay,
    className,
    canvasClassName,
    focusable,
    onCanvasKeyDown,
    onCanvasPointerDown,
    onCanvasPointerMove,
    onCanvasPointerUp,
    onCanvasPointerLeave,
    ...rest
  },
  ref,
) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 })
  const drawRef = useRef(draw)
  drawRef.current = draw
  const [visible, setVisible] = useState(true)

  useImperativeHandle(ref, () => ({
    get canvas() {
      return canvasRef.current
    },
    size: () => ({ width: sizeRef.current.width, height: sizeRef.current.height }),
    toLocal: (e) => {
      const r = canvasRef.current?.getBoundingClientRect()
      return r ? { x: e.clientX - r.left, y: e.clientY - r.top } : { x: 0, y: 0 }
    },
  }))

  const render = useCallback((dt: number, now: number) => {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    const { width, height, dpr } = sizeRef.current
    if (width === 0 || height === 0) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    drawRef.current(ctx, { width, height, dpr, dt, now, tokens: getThemeTokens() })
  }, [])

  // Size the backing store to the container at device pixel ratio.
  useEffect(() => {
    const wrap = wrapRef.current
    const c = canvasRef.current
    if (!wrap || !c) return
    const resize = () => {
      const r = wrap.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5)
      const w = Math.max(1, Math.round(r.width))
      const h = Math.max(1, Math.round(r.height))
      sizeRef.current = { width: w, height: h, dpr }
      c.width = Math.round(w * dpr)
      c.height = Math.round(h * dpr)
      c.style.width = `${w}px`
      c.style.height = `${h}px`
      render(0, performance.now())
    }
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    resize()
    return () => ro.disconnect()
  }, [render])

  // Skip drawing while scrolled off screen.
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((entries) => setVisible(entries.some((e) => e.isIntersecting)), {
      rootMargin: '100px',
    })
    io.observe(wrap)
    return () => io.disconnect()
  }, [])

  useAnimationFrame(render, animate && visible)

  // Static canvases redraw on theme change and redrawKey change.
  useEffect(() => onThemeChange(() => render(0, performance.now())), [render])
  useEffect(() => {
    if (!animate) render(0, performance.now())
  }, [animate, redrawKey, render])

  return (
    <div ref={wrapRef} className={cn('relative overflow-hidden', className)} {...rest}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={label}
        tabIndex={focusable ? 0 : undefined}
        className={cn('absolute inset-0 block touch-none select-none', canvasClassName)}
        onKeyDown={onCanvasKeyDown}
        onPointerDown={onCanvasPointerDown}
        onPointerMove={onCanvasPointerMove}
        onPointerUp={onCanvasPointerUp}
        onPointerLeave={onCanvasPointerLeave}
        onPointerCancel={onCanvasPointerUp}
      />
      {overlay}
    </div>
  )
})
