import { Link, NavLink } from 'react-router'
import { BookOpen, House, Menu, RadioReceiver, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { ThemeToggle } from '@/components/ThemeToggle'
import { PILLARS, isModuleReady, modulesByPillar, pillarName, type ModuleMeta } from '@/modules/registry'
import { cn } from '@/lib/utils'

const NAV = [
  { to: '/', label: 'Home', icon: House },
  { to: '/glossary', label: 'Glossary', icon: BookOpen },
  { to: '/frequencies', label: 'Frequency chart', icon: RadioReceiver },
  { to: '/instruments', label: 'Instruments', icon: SlidersHorizontal },
]

/** Top bar: CNS Lab wordmark, current module and pillar, Home link, settings. */
export function SiteHeader({ module }: { module?: ModuleMeta }) {
  return (
    <header className="sticky top-0 z-40 border-b border-hud-line bg-background/75 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-4 px-4 md:px-8">
        <Link to="/" className="flex shrink-0 items-center gap-2.5 rounded-sm" aria-label="CNS Lab home">
          <span className="relative grid size-6 place-items-center border border-foreground/60" aria-hidden>
            <span className="absolute inset-1 rounded-full border border-signal/70" />
            <span className="size-1 rounded-full bg-signal shadow-[0_0_6px_var(--signal)]" />
          </span>
          <span className="hud-title text-[12.5px] text-foreground">CNS Lab</span>
        </Link>

        {module && (
          <div className="flex min-w-0 items-center gap-2">
            <span className="hud-label text-muted-foreground/60" aria-hidden>
              //
            </span>
            <span className="hud-label truncate text-foreground/85" title={module.name}>
              {module.short}
            </span>
            <span className="hud-label hidden text-muted-foreground/70 sm:inline">· {pillarName(module.pillar)}</span>
          </div>
        )}

        <nav className="ml-auto hidden items-center gap-1 lg:flex" aria-label="Main">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                cn('hud-label inline-flex h-9 items-center px-3 transition-colors hover:text-foreground', isActive ? 'text-signal' : 'text-muted-foreground')
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1 lg:ml-0">
          <ThemeToggle />
          <MobileNav />
        </div>
      </div>
    </header>
  )
}

function MobileNav() {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu">
          <Menu className="size-5" aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[320px] max-w-[88vw] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>CNS Lab</SheetTitle>
          <SheetDescription>Explore the radio systems behind air traffic management.</SheetDescription>
        </SheetHeader>
        <nav className="flex flex-col gap-1 px-4 pb-6" aria-label="Mobile">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex h-10 items-center gap-2 rounded-md px-3 text-sm font-medium hover:bg-muted',
                  isActive && 'bg-accent text-accent-foreground',
                )
              }
            >
              <n.icon className="size-4" aria-hidden />
              {n.label}
            </NavLink>
          ))}
          {PILLARS.map((p) => (
            <div key={p.id} className="mt-4">
              <p className="px-3 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{p.name}</p>
              {modulesByPillar(p.id).map((m) => (
                <NavLink
                  key={m.id}
                  to={m.path}
                  className={({ isActive }) =>
                    cn(
                      'flex h-10 items-center gap-2 rounded-md px-3 text-sm hover:bg-muted',
                      isActive && 'bg-accent text-accent-foreground',
                      !isModuleReady(m.id) && 'text-muted-foreground',
                    )
                  }
                >
                  <m.icon className="size-4" aria-hidden />
                  <span className="truncate">{m.short}</span>
                  {!isModuleReady(m.id) && <span className="ml-auto text-xs">Soon</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  )
}

