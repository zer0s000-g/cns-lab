import { ChevronDown } from 'lucide-react'
import { HudPanel } from '@/hud/HudFrame'
import { useSampled } from '@/hooks/useSampled'
import { ControllerDisplay } from '../ControllerDisplay'
import { useSandbox, useSandboxState } from '../state'

const SYMBOLS: [string, string][] = [
  ['■ with dot', 'primary + secondary radar'],
  ['◆ filled', 'several sources fused'],
  ['◇', 'ADS-B or ADS-C only'],
  ['△', 'multilateration only'],
  ['●', 'primary radar only'],
  ['◌ dashed', 'coasting: no fresh data'],
]

/** The controller's radar screen: the fused picture the tracker builds from every sensor. */
export function ScopeInset({ className }: { className?: string }) {
  const { engine } = useSandbox()
  const view = useSandboxState((s) => s.shownView)
  const open = useSandboxState((s) => s.scopeOpen)
  const setOpen = useSandboxState((s) => s.setScopeOpen)
  // Framing follows the controller in charge: the airport, the terminal area or the whole region.
  const center = useSampled(
    () => {
      const p = engine.journeyPose()
      if (view !== 'map' || !p) return { x: 0, y: 0 }
      return { x: Math.round(p.pos.x / 20) * 20, y: Math.round(p.pos.y / 20) * 20 }
    },
    1500,
    (a, b) => a.x === b.x && a.y === b.y,
  )
  const range = view === 'airport' ? 30 : view === 'terminal' ? 45 : 160
  return (
    <HudPanel
      index="ATC"
      title="The controller's screen"
      className={className}
      actions={
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="hud-label inline-flex min-h-8 items-center gap-1 rounded-sm px-1 hover:text-foreground pointer-coarse:min-h-10">
          {open ? 'Hide' : 'Show'} <ChevronDown className={open ? 'size-3.5 rotate-180' : 'size-3.5'} aria-hidden />
        </button>
      }
      bodyClassName={open ? 'flex flex-col gap-2 p-3' : 'hidden'}
    >
      {open && (
        <>
          <ControllerDisplay rangeNm={range} center={center} className="aspect-square w-full rounded-[4px] bg-scope-bg" />
          <details className="group">
            <summary className="hud-label flex min-h-8 cursor-pointer list-none items-center justify-between rounded-sm pointer-coarse:min-h-10">
              What the symbols mean <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <ul className="mt-1 grid gap-0.5 text-[11.5px] text-muted-foreground" aria-label="Track symbols">
              {SYMBOLS.map(([s, d]) => (
                <li key={d}>
                  <span className="font-mono text-foreground">{s}</span> {d}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </HudPanel>
  )
}
