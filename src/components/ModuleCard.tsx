import { Link } from 'react-router'
import { CircleCheck, Clock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { isModuleReady, type ModuleMeta } from '@/modules/registry'
import { useProgress } from '@/stores/progress'
import { cn } from '@/lib/utils'

/** Card for a module on the home page: icon, name, summary, time, completed badge. */
export function ModuleCard({ m, className }: { m: ModuleMeta; className?: string }) {
  const ready = isModuleReady(m.id)
  const done = useProgress((s) => s.modules[m.id]?.completed)
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className={cn('grid size-9 place-items-center rounded-md', ready ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground')}>
          <m.icon className="size-5" aria-hidden />
        </span>
        {done ? (
          <Badge variant="outline" className="gap-1 border-success/40 text-success">
            <CircleCheck aria-hidden /> Completed
          </Badge>
        ) : !ready ? (
          <Badge variant="outline" className="border-dashed text-muted-foreground">
            Coming soon
          </Badge>
        ) : null}
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">{m.name}</h3>
        <p className="text-sm leading-relaxed text-muted-foreground">{m.summary}</p>
      </div>
      <p className="mt-auto flex items-center gap-1 text-xs text-muted-foreground">
        <Clock className="size-3.5" aria-hidden /> About {m.minutes} min
      </p>
    </>
  )
  const cls = cn('flex h-full flex-col gap-3 rounded-lg border bg-card p-4', className)
  return ready ? (
    <Link to={m.path} className={cn(cls, 'transition-colors hover:border-primary')}>
      {body}
    </Link>
  ) : (
    <div className={cn(cls, 'opacity-80')} aria-disabled="true">
      {body}
    </div>
  )
}
