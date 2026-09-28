import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** One row of telemetry: label on the left, value on the right, optional unit. */
export function TelemetryRow({
  label,
  value,
  unit,
  tone = 'default',
  bar,
  className,
}: {
  label: ReactNode
  value: ReactNode
  unit?: string
  tone?: 'default' | 'signal' | 'brass' | 'alert' | 'muted' | 'ok'
  /** Optional 0..1 fill drawn as a thin bar under the row. */
  bar?: number
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-1 py-1.5', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="hud-label">{label}</span>
        <span
          className={cn(
            'hud-value text-[13px] text-foreground',
            tone === 'signal' && 'text-signal',
            tone === 'brass' && 'text-brass',
            tone === 'alert' && 'text-destructive',
            tone === 'muted' && 'text-muted-foreground',
            tone === 'ok' && 'text-success',
          )}
        >
          {value}
          {unit && <span className="ml-1 text-[10px] text-muted-foreground">{unit}</span>}
        </span>
      </div>
      {bar !== undefined && (
        <div className="h-px w-full bg-hud-line" aria-hidden>
          <div className={cn('h-px', tone === 'alert' ? 'bg-destructive' : tone === 'brass' ? 'bg-brass' : 'bg-signal')} style={{ width: `${Math.max(0, Math.min(1, bar)) * 100}%` }} />
        </div>
      )}
    </div>
  )
}

/** Big number with a mono label, for hero readouts. */
export function BigReadout({ label, value, unit, tone = 'default' }: { label: string; value: ReactNode; unit?: string; tone?: 'default' | 'signal' | 'brass' | 'alert' }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="hud-label">{label}</span>
      <span
        className={cn(
          'hud-value text-[26px] leading-none font-light text-foreground',
          tone === 'signal' && 'text-signal',
          tone === 'brass' && 'text-brass',
          tone === 'alert' && 'text-destructive',
        )}
      >
        {value}
        {unit && <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">{unit}</span>}
      </span>
    </div>
  )
}

/**
 * Segmented vertical bar meter (the column of dashes on the right edge of a
 * HUD). `value` is 0..1; segments above it are dim.
 */
export function BarMeter({
  value,
  segments = 18,
  label,
  className,
  orientation = 'vertical',
}: {
  value: number
  segments?: number
  label: string
  className?: string
  orientation?: 'vertical' | 'horizontal'
}) {
  const lit = Math.round(Math.max(0, Math.min(1, value)) * segments)
  if (orientation === 'horizontal')
    return (
      <div className={cn('flex items-end gap-[3px]', className)} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
        {Array.from({ length: segments }, (_, i) => (
          <span key={i} className={cn('block w-[3px]', i < lit ? 'bg-signal shadow-[0_0_6px_var(--signal)]' : 'bg-foreground/15')} style={{ height: 6 + (i / segments) * 8 }} />
        ))}
      </div>
    )
  return (
    <div className={cn('flex flex-col items-end gap-[3px]', className)} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
      {Array.from({ length: segments }, (_, i) => {
        const idx = segments - 1 - i
        const on = idx < lit
        const w = 8 + (idx / segments) * 22
        return <span key={i} className={cn('block h-[3px]', on ? 'bg-foreground/80' : 'bg-foreground/15')} style={{ width: w }} />
      })}
    </div>
  )
}

/** Semicircular needle gauge (SVG). Tokens only. */
export function NeedleGauge({
  value,
  min,
  max,
  label,
  valueText,
  ticks = [0, 25, 50, 75, 100],
  redFrom,
  className,
}: {
  value: number
  min: number
  max: number
  label: string
  valueText: string
  ticks?: number[]
  redFrom?: number
  className?: string
}) {
  const f = (v: number) => (Math.max(min, Math.min(max, v)) - min) / (max - min)
  const ang = (v: number) => Math.PI * (1 - f(v))
  const R = 44
  const cx = 60
  const cy = 58
  const pt = (a: number, r: number) => [cx + Math.cos(a) * r, cy - Math.sin(a) * r]
  const [nx, ny] = pt(ang(value), R - 6)
  const arc = (a0: number, a1: number, r: number) => {
    const [x0, y0] = pt(a0, r)
    const [x1, y1] = pt(a1, r)
    return `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`
  }
  return (
    <figure className={cn('flex flex-col items-center', className)}>
      <svg viewBox="0 0 120 70" className="w-full" role="img" aria-label={`${label}: ${valueText}`}>
        <path d={arc(Math.PI, 0, R)} className="fill-none stroke-hud-line" strokeWidth="1" />
        {redFrom !== undefined && <path d={arc(ang(redFrom), 0, R)} className="fill-none stroke-destructive" strokeWidth="2" />}
        {Array.from({ length: 21 }, (_, i) => {
          const a = Math.PI * (1 - i / 20)
          const [x0, y0] = pt(a, R)
          const [x1, y1] = pt(a, R - (i % 5 === 0 ? 6 : 3))
          return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} className="stroke-muted-foreground" strokeWidth="0.8" />
        })}
        {ticks.map((t) => {
          const [x, y] = pt(ang(t), R - 13)
          return (
            <text key={t} x={x} y={y + 2} textAnchor="middle" className="fill-muted-foreground font-mono text-[6px]">
              {t}
            </text>
          )
        })}
        <line x1={cx} y1={cy} x2={nx} y2={ny} className="stroke-brass" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="2.4" className="fill-background stroke-brass" strokeWidth="1" />
      </svg>
      <figcaption className="-mt-1 flex w-full items-baseline justify-between">
        <span className="hud-label">{label}</span>
        <span className="hud-value text-[15px] text-foreground">{valueText}</span>
      </figcaption>
    </figure>
  )
}
