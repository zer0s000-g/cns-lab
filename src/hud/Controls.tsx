import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { Switch as SwitchPrimitive, ToggleGroup as ToggleGroupPrimitive } from 'radix-ui'
import { cn } from '@/lib/utils'

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

export interface DialProps {
  label: ReactNode
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  format?: (v: number) => string
  /** Size of the knob in px. */
  size?: number
  className?: string
  /** Sweep of the dial, degrees (default 270°, from -135° to +135°). */
  sweepDeg?: number
}

/**
 * Rotary knurled dial. Drag up/down (or around), scroll, or use the keyboard:
 * arrows ±step, Page Up/Down ±10 steps, Home/End min/max. Exposes
 * role="slider" with a value text, like the sliders it replaces.
 */
export function Dial({ label, value, min, max, step = 1, onChange, format, size = 64, className, sweepDeg = 270 }: DialProps) {
  const id = useId()
  const drag = useRef<{ y: number; v: number } | null>(null)
  const f = (clamp(value, min, max) - min) / (max - min)
  const angle = -sweepDeg / 2 + f * sweepDeg
  const snap = (v: number) => clamp(Math.round((v - min) / step) * step + min, min, max)
  const set = (v: number) => {
    const s = snap(v)
    if (s !== value) onChange(Number(s.toFixed(6)))
  }
  const text = format ? format(value) : String(value)
  const onKey = (e: KeyboardEvent) => {
    const big = step * 10
    const map: Record<string, number> = {
      ArrowUp: value + step,
      ArrowRight: value + step,
      ArrowDown: value - step,
      ArrowLeft: value - step,
      PageUp: value + big,
      PageDown: value - big,
      Home: min,
      End: max,
    }
    if (e.key in map) {
      e.preventDefault()
      set(map[e.key])
    }
  }
  const r = size / 2
  const teeth = 36
  return (
    <div className={cn('flex flex-col items-center gap-2', className)}>
      <div
        role="slider"
        tabIndex={0}
        aria-labelledby={`${id}-l`}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={text}
        onKeyDown={onKey}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { y: e.clientY, v: value }
        }}
        onPointerMove={(e) => {
          if (!drag.current) return
          // 160 px of vertical drag covers the whole range.
          const dv = ((drag.current.y - e.clientY) / 160) * (max - min)
          set(drag.current.v + dv)
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onWheel={(e) => set(value + (e.deltaY < 0 ? step : -step))}
        className="relative cursor-ns-resize touch-none rounded-full outline-offset-4 select-none"
        style={{ width: size, height: size }}
      >
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden>
          {/* Scale ticks around the knob. */}
          {Array.from({ length: 28 }, (_, i) => {
            const a = ((-sweepDeg / 2 + (i / 27) * sweepDeg - 90) * Math.PI) / 180
            const on = i / 27 <= f + 1e-9
            return (
              <line
                key={i}
                x1={r + Math.cos(a) * (r - 1)}
                y1={r + Math.sin(a) * (r - 1)}
                x2={r + Math.cos(a) * (r - (i % 9 === 0 ? 6 : 4))}
                y2={r + Math.sin(a) * (r - (i % 9 === 0 ? 6 : 4))}
                className={on ? 'stroke-signal' : 'stroke-muted-foreground/40'}
                strokeWidth={1}
              />
            )
          })}
          <g transform={`rotate(${angle} ${r} ${r})`}>
            {/* Knurled rim */}
            {Array.from({ length: teeth }, (_, i) => {
              const a = (i / teeth) * Math.PI * 2
              return (
                <line
                  key={i}
                  x1={r + Math.cos(a) * (r * 0.62)}
                  y1={r + Math.sin(a) * (r * 0.62)}
                  x2={r + Math.cos(a) * (r * 0.74)}
                  y2={r + Math.sin(a) * (r * 0.74)}
                  className="stroke-foreground/35"
                  strokeWidth={1.2}
                />
              )
            })}
            <circle cx={r} cy={r} r={r * 0.62} className="fill-secondary stroke-hud-line" strokeWidth={1} />
            <circle cx={r} cy={r} r={r * 0.46} className="fill-background stroke-hud-line" strokeWidth={1} />
            <line x1={r} y1={r - r * 0.18} x2={r} y2={r - r * 0.56} className="stroke-brass" strokeWidth={2} strokeLinecap="round" />
          </g>
        </svg>
      </div>
      <div className="flex flex-col items-center gap-0.5 text-center">
        <span id={`${id}-l`} className="hud-label [&_*]:uppercase">
          {label}
        </span>
        <span className="hud-value text-[12px] text-foreground">{text}</span>
      </div>
    </div>
  )
}

/** A hardware toggle lever built on the Radix switch (same keyboard and ARIA). */
export function LeverSwitch({
  label,
  checked,
  onChange,
  hint,
  tone = 'alert',
  className,
}: {
  label: ReactNode
  checked: boolean
  onChange: (v: boolean) => void
  hint?: ReactNode
  tone?: 'alert' | 'signal'
  className?: string
}) {
  const id = useId()
  return (
    <div className={cn('flex items-center gap-3 py-1.5', className)}>
      <SwitchPrimitive.Root
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        className={cn(
          'group relative h-7 w-4 shrink-0 rounded-[3px] border border-hud-line bg-background outline-offset-2',
          checked && (tone === 'alert' ? 'border-destructive/60' : 'border-signal/60'),
        )}
      >
        <SwitchPrimitive.Thumb
          className={cn(
            'absolute left-[1px] block h-3 w-3 rounded-[2px] bg-foreground/70 transition-transform duration-150',
            'data-[state=unchecked]:translate-y-[12px] data-[state=checked]:translate-y-[1px]',
            'data-[state=checked]:bg-foreground',
          )}
        />
      </SwitchPrimitive.Root>
      <label htmlFor={id} className="flex min-w-0 flex-1 cursor-pointer flex-col">
        <span className="text-[13px] leading-5 text-foreground">{label}</span>
        {hint && <span className="text-[11.5px] leading-4 text-muted-foreground">{hint}</span>}
      </label>
      <span
        aria-hidden
        className={cn(
          'hud-label w-8 text-right',
          checked ? (tone === 'alert' ? 'text-destructive' : 'text-signal') : 'text-muted-foreground/60',
        )}
      >
        {checked ? 'ON' : 'OFF'}
      </span>
    </div>
  )
}

/** Segmented selector (Radix toggle group): hairline, mono, sharp. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label?: ReactNode
  value: T
  options: { value: T; label: ReactNode; ariaLabel?: string }[]
  onChange: (v: T) => void
  className?: string
}) {
  const id = useId()
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <span id={id} className="hud-label">
          {label}
        </span>
      )}
      <ToggleGroupPrimitive.Root
        type="single"
        value={value}
        onValueChange={(v) => v && onChange(v as T)}
        aria-labelledby={label ? id : undefined}
        className="flex w-full overflow-hidden rounded-[4px] border border-hud-line"
      >
        {options.map((o, i) => (
          <ToggleGroupPrimitive.Item
            key={o.value}
            value={o.value}
            aria-label={o.ariaLabel}
            className={cn(
              'hud-value min-h-8 flex-1 px-2 text-[11px] tracking-wider text-muted-foreground uppercase outline-offset-[-2px] hover:text-foreground pointer-coarse:min-h-10',
              i > 0 && 'border-l border-hud-line',
              'data-[state=on]:bg-foreground data-[state=on]:text-background',
            )}
          >
            {o.label}
          </ToggleGroupPrimitive.Item>
        ))}
      </ToggleGroupPrimitive.Root>
    </div>
  )
}

/** Hairline HUD button. */
export function HudButton({
  children,
  onClick,
  active,
  className,
  disabled,
  'aria-label': ariaLabel,
  variant = 'line',
}: {
  children: ReactNode
  onClick?: () => void
  active?: boolean
  className?: string
  disabled?: boolean
  'aria-label'?: string
  variant?: 'line' | 'solid'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={active}
      className={cn(
        'hud-value inline-flex min-h-8 items-center justify-center gap-1.5 rounded-[4px] border px-3 text-[11px] tracking-wider uppercase transition-colors outline-offset-2 disabled:opacity-40 pointer-coarse:min-h-10 [&_svg]:size-3.5',
        variant === 'solid'
          ? 'border-signal bg-signal text-primary-foreground hover:bg-signal/85'
          : 'border-hud-line text-foreground/85 hover:border-foreground/40 hover:text-foreground',
        active && variant === 'line' && 'border-signal/70 text-signal',
        className,
      )}
    >
      {children}
    </button>
  )
}
