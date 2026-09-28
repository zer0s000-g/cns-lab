import { useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { BookOpen } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { getTerm } from '@/content/glossary'
import { cn } from '@/lib/utils'

/**
 * A jargon word with a definition from the glossary. Opens on hover (mouse),
 * on focus + Enter (keyboard) and on tap (touch), so it never relies on hover.
 */
export function Term({ id, children, className }: { id: string; children?: ReactNode; className?: string }) {
  const entry = getTerm(id)
  const [open, setOpen] = useState(false)
  const closeTimer = useRef<number | undefined>(undefined)

  if (!entry) {
    if (import.meta.env.DEV) console.warn(`[Term] Unknown glossary id "${id}"`)
    return <>{children}</>
  }

  const openSoon = () => {
    window.clearTimeout(closeTimer.current)
    setOpen(true)
  }
  const closeSoon = () => {
    window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => setOpen(false), 150)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline cursor-help rounded-sm border-0 bg-transparent p-0 text-inherit underline decoration-primary/60 decoration-dotted decoration-2 underline-offset-4 hover:decoration-primary focus-visible:outline-2',
            className,
          )}
          onPointerEnter={(e) => e.pointerType === 'mouse' && openSoon()}
          onPointerLeave={(e) => e.pointerType === 'mouse' && closeSoon()}
          aria-label={`${typeof children === 'string' ? children : entry.term}: show definition`}
        >
          {children ?? entry.term}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 max-w-[calc(100vw-2rem)] p-4"
        onPointerEnter={(e) => e.pointerType === 'mouse' && openSoon()}
        onPointerLeave={(e) => e.pointerType === 'mouse' && closeSoon()}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <p className="text-sm font-semibold">{entry.term}</p>
        <p className="text-sm leading-relaxed text-muted-foreground">{entry.definition}</p>
        <Link
          to={`/glossary#${entry.id}`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
        >
          <BookOpen className="size-3.5" aria-hidden />
          Open glossary
        </Link>
      </PopoverContent>
    </Popover>
  )
}
