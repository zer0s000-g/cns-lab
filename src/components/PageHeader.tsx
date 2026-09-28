import type { ReactNode } from 'react'
import { CornerBrackets, TitleBlock } from '@/hud/HudFrame'

/** Title block for reference pages (glossary, frequency chart, style guide). */
export function PageHeader({ kicker, title, sub, children }: { kicker: string; title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="relative px-6 py-8 md:px-10 md:py-10">
      <CornerBrackets inset={0} />
      <TitleBlock kicker={kicker} title={title} />
      {sub && <p className="mt-3 max-w-[70ch] text-[15px] leading-7 text-muted-foreground">{sub}</p>}
      {children}
    </header>
  )
}
