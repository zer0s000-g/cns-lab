import { cn } from '@/lib/utils'

export interface Chapter {
  id: string
  label: string
}

/**
 * Bottom timeline: a hairline track with a tick per chapter. The active
 * chapter's tick glows; clicking (or ←/→ when focused) jumps to a chapter.
 */
export function ChapterScrubber({
  chapters,
  active,
  onSelect,
  progress,
  className,
}: {
  chapters: Chapter[]
  active: string
  onSelect: (id: string) => void
  /** 0..1 overall progress through the page. */
  progress?: number
  className?: string
}) {
  const idx = Math.max(0, chapters.findIndex((c) => c.id === active))
  const p = progress ?? idx / Math.max(1, chapters.length - 1)
  return (
    <nav aria-label="Chapters" className={cn('relative', className)}>
      <div className="relative mx-2 h-px bg-hud-line" aria-hidden>
        <div className="absolute inset-y-0 left-0 bg-signal/80" style={{ width: `${p * 100}%` }} />
        <div
          className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-signal shadow-[0_0_12px_var(--signal)]"
          style={{ left: `${p * 100}%` }}
        />
      </div>
      <ol
        className="mt-2 grid"
        style={{ gridTemplateColumns: `repeat(${chapters.length}, minmax(0, 1fr))` }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault()
            const n = Math.min(chapters.length - 1, Math.max(0, idx + (e.key === 'ArrowRight' ? 1 : -1)))
            onSelect(chapters[n].id)
            ;(e.currentTarget.querySelectorAll('button')[n] as HTMLButtonElement | undefined)?.focus()
          }
        }}
      >
        {chapters.map((c, i) => (
          <li key={c.id} className={cn('flex', i === 0 ? 'justify-start' : i === chapters.length - 1 ? 'justify-end' : 'justify-center')}>
            <button
              type="button"
              onClick={() => onSelect(c.id)}
              aria-current={c.id === active ? 'step' : undefined}
              className={cn(
                'hud-label rounded-sm px-1 py-1 transition-colors hover:text-foreground pointer-coarse:py-2',
                c.id === active ? 'text-signal' : 'text-muted-foreground/70',
              )}
            >
              <span className="mr-1 text-muted-foreground">{String(i + 1).padStart(2, '0')}</span>
              <span className="hidden sm:inline">{c.label}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  )
}
