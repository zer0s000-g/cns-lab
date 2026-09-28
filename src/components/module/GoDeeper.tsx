import { useState, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

/** "Go deeper": the technical file — formulas and specifications, collapsed by default. */
export function GoDeeper({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="group flex w-full items-center gap-4 border-y border-hud-line py-4 text-left">
        <span className="hud-value text-[11px] text-signal">SPEC</span>
        <span className="flex min-w-0 flex-col">
          <span className="hud-title text-[13px] text-foreground">Frequencies, formulas and specifications</span>
          <span className="hud-label mt-1">For the curious. You can skip this.</span>
        </span>
        <Plus className={cn('ml-auto size-4 shrink-0 text-muted-foreground transition-transform duration-300 group-hover:text-foreground', open && 'rotate-45')} aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent className="py-5">
        <div className="prose-lab spec-sheet max-w-none">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}
