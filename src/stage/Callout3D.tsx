import type { ReactNode, Ref, RefObject } from 'react'
import { Html } from '@react-three/drei'
import { cn } from '@/lib/utils'

/**
 * A label pinned to a point in the 3D scene: a small dot, a leader line and a
 * mono tag. It is ordinary DOM (so screen readers can read it) and stays
 * underneath page chrome (zIndexRange) when the stage scrolls.
 */
export function Callout3D({
  position,
  children,
  side = 'right',
  lead = 28,
  tone = 'default',
  portal,
  hidden,
  rootRef,
}: {
  position: [number, number, number]
  children: ReactNode
  side?: 'right' | 'left'
  /** Leader line length, px. */
  lead?: number
  tone?: 'default' | 'signal' | 'brass' | 'alert'
  portal?: RefObject<HTMLElement>
  hidden?: boolean
  /** For toggling visibility from a frame loop without re-rendering. */
  rootRef?: Ref<HTMLDivElement>
}) {
  return (
    <Html position={position} zIndexRange={[5, 0]} portal={portal} style={{ pointerEvents: 'none' }} center={false}>
      <div
        ref={rootRef}
        className={cn('flex items-center whitespace-nowrap transition-opacity duration-300', side === 'left' && 'flex-row-reverse', hidden && 'opacity-0')}
        style={{ transform: `translate(${side === 'left' ? '-100%' : '0'}, -50%)` }}
      >
        <span
          aria-hidden
          className={cn(
            'block size-1.5 shrink-0 rounded-full',
            tone === 'signal' ? 'bg-signal shadow-[0_0_8px_var(--signal)]' : tone === 'brass' ? 'bg-brass' : tone === 'alert' ? 'bg-destructive' : 'bg-foreground',
          )}
        />
        <span aria-hidden className="block h-px bg-foreground/45" style={{ width: lead }} />
        <span
          className={cn(
            'hud-panel hud-value rounded-[3px] px-1 py-px text-[9px] tracking-wide text-foreground md:px-1.5 md:py-0.5 md:text-[10.5px]',
            tone === 'signal' && 'text-signal',
            tone === 'brass' && 'text-brass',
            tone === 'alert' && 'text-destructive',
          )}
        >
          {children}
        </span>
      </div>
    </Html>
  )
}
