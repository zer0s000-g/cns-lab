import { useId, type ReactNode } from 'react'
import { Gauge, Pause, Play, RotateCcw, Timer, Volume2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { speedLabel } from '@/core/clock'
import { useClock, type SimClock } from '@/hooks/useSimClock'
import { useCaptions } from '@/lib/audio'
import { usePrefs } from '@/stores/prefs'
import { cn } from '@/lib/utils'

/** The panel of controls next to (desktop) or under (phone) a simulator view. */
export function ControlsPanel({ children, className, title = 'Controls' }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <section aria-label={title} className={cn('hud-panel flex flex-col gap-5 rounded-md p-4', className)}>
      {children}
    </section>
  )
}

export function ControlGroup({ title, children, className, description }: { title: string; children: ReactNode; className?: string; description?: ReactNode }) {
  return (
    <fieldset className={cn('flex min-w-0 flex-col gap-3', className)}>
      <legend className="hud-label mb-1 flex w-full items-center gap-2 text-foreground/70">
        <span className="h-px w-3 bg-signal" aria-hidden />
        {title}
      </legend>
      {description && <p className="-mt-1 text-[12px] text-muted-foreground">{description}</p>}
      {children}
    </fieldset>
  )
}

export interface ControlSliderProps {
  label: ReactNode
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  /** Formats the value shown next to the label and read by screen readers. */
  format?: (v: number) => string
  hint?: ReactNode
  disabled?: boolean
}

export function ControlSlider({ label, value, min, max, step = 1, onChange, format, hint, disabled }: ControlSliderProps) {
  const id = useId()
  const shown = format ? format(value) : String(value)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <Label id={`${id}-label`} className="text-[12.5px] font-normal text-foreground/85">
          <span>{label}</span>
        </Label>
        <span className="hud-value text-[11.5px] text-signal" aria-hidden>
          {shown}
        </span>
      </div>
      <Slider
        id={id}
        aria-labelledby={`${id}-label`}
        value={[value]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={(v) => onChange(v[0])}
        aria-valuetext={shown}
        className="py-2"
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function ControlSwitch({
  label,
  checked,
  onChange,
  hint,
  disabled,
}: {
  label: ReactNode
  checked: boolean
  onChange: (v: boolean) => void
  hint?: ReactNode
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <Label htmlFor={id} className="text-[12.5px] leading-5 font-normal text-foreground/85">
          <span>{label}</span>
        </Label>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} className="mt-0.5" />
    </div>
  )
}

export function ControlChoice<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: ReactNode
  value: T
  options: { value: T; label: ReactNode; ariaLabel?: string }[]
  onChange: (v: T) => void
  hint?: ReactNode
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-2">
      <span id={id} className="text-[12.5px] text-foreground/85">
        {label}
      </span>
      <ToggleGroup
        type="single"
        variant="outline"
        spacing={0}
        value={value}
        onValueChange={(v) => v && onChange(v as T)}
        aria-labelledby={id}
        className="w-full flex-wrap"
      >
        {options.map((o) => (
          <ToggleGroupItem key={o.value} value={o.value} aria-label={o.ariaLabel} className="flex-1 px-2 text-xs">
            {o.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

/** A live numeric readout. */
export function Readout({
  label,
  value,
  unit,
  hint,
  tone = 'default',
  className,
}: {
  label: ReactNode
  value: ReactNode
  unit?: string
  hint?: ReactNode
  tone?: 'default' | 'warning' | 'alert' | 'ok' | 'muted'
  className?: string
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1 border-l border-hud-line py-1 pl-3', className)}>
      <span className="hud-label truncate">{label}</span>
      <span
        className={cn(
          'hud-value text-[17px] leading-6 font-light text-foreground',
          tone === 'warning' && 'text-warning',
          tone === 'alert' && 'text-destructive',
          tone === 'ok' && 'text-success',
          tone === 'muted' && 'text-muted-foreground',
        )}
      >
        {value}
        {unit && <span className="ml-1 text-[10.5px] font-normal text-muted-foreground">{unit}</span>}
      </span>
      {hint && <span className="text-[11.5px] leading-4 text-muted-foreground">{hint}</span>}
    </div>
  )
}

export function ReadoutGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4', className)} aria-live="off">
      {children}
    </div>
  )
}

/** Honesty label shown on a view: "Slowed down so you can see it", "Not to scale", ... */
export function SimLabel({ children, icon = 'timer', className }: { children: ReactNode; icon?: 'timer' | 'gauge' | 'none'; className?: string }) {
  const Icon = icon === 'timer' ? Timer : icon === 'gauge' ? Gauge : null
  return (
    <span
      className={cn(
        'hud-label pointer-events-none inline-flex items-center gap-1.5 rounded-[3px] border border-hud-line bg-background/75 px-2 py-1 text-foreground/85 backdrop-blur-sm',
        className,
      )}
    >
      {Icon && <Icon className="size-3.5 text-primary" aria-hidden />}
      {children}
    </span>
  )
}

/** Shows the caption of whatever sound is playing (never rely on audio alone). */
export function AudioCaption({ className }: { className?: string }) {
  const text = useCaptions((s) => s.text)
  const on = usePrefs((s) => s.captionsOn)
  return (
    <div aria-live="polite" className={cn('min-h-0', className)}>
      {on && text && (
        <span className="hud-panel inline-flex max-w-full items-center gap-2 rounded-[3px] px-2.5 py-1.5 text-[12px]">
          <Volume2 className="size-3.5 shrink-0 text-primary" aria-hidden />
          <span className="truncate">{text}</span>
        </span>
      )}
    </div>
  )
}

/** Play / pause, speed and optional reset for a simulator clock. */
export function ClockControls({ clock, onReset, className }: { clock: SimClock; onReset?: () => void; className?: string }) {
  const running = useClock(clock, (s) => s.running)
  const speed = useClock(clock, (s) => s.speed)
  const speeds = useClock(clock, (s) => s.speeds)
  const toggle = useClock(clock, (s) => s.toggle)
  const setSpeed = useClock(clock, (s) => s.setSpeed)
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <Button variant={running ? 'outline' : 'default'} size="sm" onClick={toggle} aria-label={running ? 'Pause simulation' : 'Play simulation'}>
        {running ? <Pause aria-hidden /> : <Play aria-hidden />}
        {running ? 'Pause' : 'Play'}
      </Button>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={0}
        value={String(speed)}
        onValueChange={(v) => v && setSpeed(Number(v))}
        aria-label="Simulation speed"
      >
        {speeds.map((s) => (
          <ToggleGroupItem key={s} value={String(s)} aria-label={speedLabel(s)} className="px-2 font-mono text-xs tabular-nums">
            {s}×
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {onReset && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={onReset} aria-label="Reset simulator">
              <RotateCcw aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Reset</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}

/** Speed badge for a view, e.g. "Sped up 4×". Renders nothing at real time. */
export function ClockSpeedLabel({ clock }: { clock: SimClock }) {
  const speed = useClock(clock, (s) => s.speed)
  const running = useClock(clock, (s) => s.running)
  if (!running) return <SimLabel icon="none">Paused</SimLabel>
  if (speed === 1) return null
  return <SimLabel icon="gauge">{speedLabel(speed)}</SimLabel>
}
