import { useId, type ReactNode } from 'react'
import { Switch as SwitchPrimitive } from 'radix-ui'
import { cn } from '@/lib/utils'

export interface FailureItem {
  id: string
  title: string
  /** Plain explanation of what happens and why. */
  explanation: ReactNode
  /** What to look for in the simulator. */
  watch?: ReactNode
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  /** A remedy rather than a failure (e.g. MTI, RAIM): shown in cyan, not red. */
  kind?: 'failure' | 'fix'
}

/**
 * "When things go wrong" as a bank of fault levers. Each lever is bound to
 * the same state as the simulator, so throwing it here changes the scene.
 */
export function FailureList({ items }: { items: FailureItem[] }) {
  return (
    <ul className="grid gap-x-8 gap-y-1 md:grid-cols-2">
      {items.map((f, i) => (
        <FailureRow key={f.id} f={f} n={i + 1} />
      ))}
    </ul>
  )
}

function FailureRow({ f, n }: { f: FailureItem; n: number }) {
  const id = useId()
  const fix = f.kind === 'fix'
  return (
    <li className={cn('flex gap-3 border-b border-hud-line py-3.5', f.checked && (fix ? 'border-signal/40' : 'border-destructive/40'))}>
      <SwitchPrimitive.Root
        id={id}
        checked={f.checked}
        onCheckedChange={f.onChange}
        disabled={f.disabled}
        aria-describedby={`${id}-d`}
        className={cn(
          'relative mt-0.5 h-9 w-5 shrink-0 rounded-[3px] border border-hud-line bg-background outline-offset-2 disabled:opacity-40',
          f.checked && (fix ? 'border-signal/70 shadow-[0_0_14px_-4px_var(--signal)]' : 'border-destructive/70 shadow-[0_0_14px_-4px_var(--destructive)]'),
        )}
      >
        <SwitchPrimitive.Thumb
          className={cn(
            'absolute left-[2px] block h-3.5 w-3.5 rounded-[2px] bg-foreground/60 transition-transform duration-150',
            'data-[state=unchecked]:translate-y-[16px] data-[state=checked]:translate-y-[2px]',
            f.checked && (fix ? 'bg-signal' : 'bg-destructive'),
          )}
        />
      </SwitchPrimitive.Root>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor={id} className="cursor-pointer text-[13.5px] leading-5 font-medium text-foreground">
            <span className="hud-value mr-2 text-[10.5px] text-muted-foreground">{fix ? 'FIX' : `F${String(n).padStart(2, '0')}`}</span>
            {f.title}
          </label>
          <span className={cn('hud-label shrink-0', f.checked ? (fix ? 'text-signal' : 'text-destructive') : 'text-muted-foreground/60')}>
            {f.checked ? (fix ? 'Engaged' : 'Active') : 'Off'}
          </span>
        </div>
        <div id={`${id}-d`} className="prose-lab text-[13.5px] leading-6 text-foreground/75">
          {f.explanation}
        </div>
        {f.watch && (
          <p className="text-[12px] text-muted-foreground">
            <span className="hud-label mr-1 text-foreground/70">Watch</span>
            {f.watch}
          </p>
        )}
      </div>
    </li>
  )
}
