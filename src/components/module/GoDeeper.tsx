import { useState, type ReactNode } from 'react'
import { ChevronDown, GraduationCap } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

/** "Go deeper": formulas and specifications, collapsed by default. */
export function GoDeeper({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border bg-card">
      <CollapsibleTrigger className="flex w-full items-center gap-3 rounded-lg p-4 text-left hover:bg-muted/50">
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground">
          <GraduationCap className="size-4" aria-hidden />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="text-sm font-semibold">Frequencies, formulas and specifications</span>
          <span className="text-xs text-muted-foreground">For the curious. You can skip this.</span>
        </span>
        <ChevronDown className={cn('ml-auto size-4 shrink-0 transition-transform', open && 'rotate-180')} aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t px-4 py-4 md:px-6">
        <div className="prose-lab max-w-none">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}
