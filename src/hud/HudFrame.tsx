import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Four hairline corner brackets framing a region, like a viewfinder. */
export function CornerBrackets({ className, size = 18, inset = 12 }: { className?: string; size?: number; inset?: number }) {
  const arm = `${size}px`
  const common = 'pointer-events-none absolute border-hud-line'
  return (
    <div aria-hidden className={cn('pointer-events-none absolute inset-0', className)}>
      <span className={cn(common, 'border-t border-l')} style={{ top: inset, left: inset, width: arm, height: arm }} />
      <span className={cn(common, 'border-t border-r')} style={{ top: inset, right: inset, width: arm, height: arm }} />
      <span className={cn(common, 'border-b border-l')} style={{ bottom: inset, left: inset, width: arm, height: arm }} />
      <span className={cn(common, 'border-b border-r')} style={{ bottom: inset, right: inset, width: arm, height: arm }} />
    </div>
  )
}

/** A title block: tiny kicker, wide display title, mono sub-line. */
export function TitleBlock({
  kicker,
  title,
  sub,
  className,
  as: Tag = 'h1',
}: {
  kicker?: ReactNode
  title: ReactNode
  sub?: ReactNode
  className?: string
  as?: 'h1' | 'h2' | 'div'
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {kicker && (
        <p className="hud-label flex items-center gap-2">
          <span className="inline-block size-1.5 bg-brass" aria-hidden />
          {kicker}
        </p>
      )}
      <Tag className="hud-title text-[22px] leading-[1.15] text-foreground md:text-[30px]">{title}</Tag>
      {sub && <p className="hud-label text-muted-foreground/90">{sub}</p>}
    </div>
  )
}

/** Small square status lamp with a label: LIVE, ARC ON, PAUSED... */
export function StatusLamp({ on, label, tone = 'alert' }: { on: boolean; label: string; tone?: 'alert' | 'signal' | 'brass' }) {
  return (
    <span className="hud-label inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className={cn(
          'inline-block size-2 rounded-full',
          on ? (tone === 'alert' ? 'bg-destructive shadow-[0_0_10px_var(--destructive)]' : tone === 'brass' ? 'bg-brass shadow-[0_0_10px_var(--brass)]' : 'bg-signal shadow-[0_0_10px_var(--signal)]') : 'bg-muted-foreground/30',
        )}
      />
      <span className={cn(on && (tone === 'alert' ? 'text-destructive' : tone === 'brass' ? 'text-brass' : 'text-signal'))}>{label}</span>
    </span>
  )
}

/** Translucent HUD panel with an indexed header. */
export function HudPanel({
  index,
  title,
  children,
  className,
  actions,
  bodyClassName,
  id,
}: {
  index?: string
  title?: ReactNode
  children: ReactNode
  className?: string
  actions?: ReactNode
  bodyClassName?: string
  id?: string
}) {
  return (
    <section id={id} className={cn('hud-panel relative rounded-md', className)}>
      {(title || index) && (
        <header className="flex items-center justify-between gap-3 border-b border-hud-line px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-3">
            {index && <span className="hud-label text-signal">{index}</span>}
            {title && <h3 className="hud-title truncate text-[11px] text-foreground">{title}</h3>}
          </div>
          {actions}
        </header>
      )}
      <div className={cn('p-4', bodyClassName)}>{children}</div>
    </section>
  )
}
