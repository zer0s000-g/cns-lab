import { useId, type ReactNode } from 'react'
import { ShieldCheck, TriangleAlert } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
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
  /** A remedy rather than a failure (e.g. MTI, RAIM): shown in blue, not amber. */
  kind?: 'failure' | 'fix'
}

/**
 * "When things go wrong": each card has a switch bound to the same state as
 * the simulator, so flipping it here changes the simulator above.
 */
export function FailureList({ items }: { items: FailureItem[] }) {
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {items.map((f) => (
        <FailureCard key={f.id} f={f} />
      ))}
    </ul>
  )
}

function FailureCard({ f }: { f: FailureItem }) {
  const id = useId()
  const fix = f.kind === 'fix'
  const Icon = fix ? ShieldCheck : TriangleAlert
  return (
    <li className={cn('flex flex-col gap-3 rounded-lg border bg-card p-4', f.checked && (fix ? 'border-primary/60' : 'border-warning/60'))}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              'grid size-7 shrink-0 place-items-center rounded-md',
              f.checked ? (fix ? 'bg-accent text-accent-foreground' : 'bg-warning/15 text-warning') : 'bg-muted text-muted-foreground',
            )}
          >
            <Icon className="size-4" aria-hidden />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <Label htmlFor={id} className="text-sm font-semibold">
              {f.title}
            </Label>
            <span className="text-xs text-muted-foreground">{f.checked ? 'On in the simulator' : 'Off'}</span>
          </div>
        </div>
        <Switch id={id} checked={f.checked} onCheckedChange={f.onChange} disabled={f.disabled} aria-describedby={`${id}-d`} />
      </div>
      <div id={`${id}-d`} className="prose-lab text-sm">
        {f.explanation}
      </div>
      {f.watch && (
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">Watch for: </span>
          {f.watch}
        </p>
      )}
    </li>
  )
}
