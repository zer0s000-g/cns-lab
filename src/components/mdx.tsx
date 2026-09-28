import type { ReactNode } from 'react'
import { Term } from '@/components/Term'

/** A formula block for "Go deeper" sections. */
export function Formula({ children }: { children: ReactNode }) {
  return <div className="formula">{children}</div>
}

/** A small highlighted note inside prose. */
export function Note({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <div className="my-3 rounded-md border-l-2 border-primary bg-muted/60 px-3 py-2 text-sm">
      {title && <p className="font-semibold">{title}</p>}
      {children}
    </div>
  )
}

/** Components available inside every MDX file without importing them. */
export const mdxComponents = { Term, Formula, Note }
