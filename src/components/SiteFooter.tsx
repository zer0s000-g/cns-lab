import { Link } from 'react-router'
import { ShieldAlert } from 'lucide-react'

export const DISCLAIMER = 'For educational use only, not for operational use.'

export function SiteFooter() {
  return (
    <footer className="border-t border-hud-line">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-3 px-4 py-6 pb-28 text-[12px] text-muted-foreground md:flex-row md:items-center md:justify-between md:px-8">
        <p className="hud-label flex items-center gap-2 text-foreground/80">
          <ShieldAlert className="size-4 shrink-0" aria-hidden />
          {DISCLAIMER}
        </p>
        <p className="max-w-2xl">
          Simulations are simplified to teach principles. Technical values follow ICAO Annex 10 where stated and
          should be checked by a qualified CNS/ATSEP engineer. <Link to="/glossary" className="underline underline-offset-2 hover:text-foreground">Glossary</Link>
          {' · '}
          <Link to="/frequencies" className="underline underline-offset-2 hover:text-foreground">Frequency chart</Link>
        </p>
      </div>
    </footer>
  )
}
