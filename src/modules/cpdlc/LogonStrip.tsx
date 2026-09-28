import { Check, Circle, LoaderCircle } from 'lucide-react'
import { Term } from '@/components/Term'
import { useSampled } from '@/hooks/useSampled'
import { cn } from '@/lib/utils'
import { useCpdlc } from './state'

type StepState = 'done' | 'active' | 'todo'

/** The logon and connection sequence, then the hand-over to the next centre, with the time of each step. */
export function LogonStrip() {
  const { engine } = useCpdlc()
  const s = useSampled(
    () => {
      const e = engine
      const m = e.milestones
      const t = (v?: number) => (v != null ? e.utc(v) : null)
      return {
        name: e.logonName,
        standard: e.standard,
        steps: [
          { label: `${e.logonName} sent by CNS123`, at: t(m.logonSent), active: e.logonState === 'sent' && m.logonAccepted == null },
          { label: 'XLAB checks it against the flight plan', at: t(m.logonAccepted), active: false },
          { label: 'XLAB asks for a connection', at: t(m.crSent), active: e.xlab === 'requested' },
          { label: 'CNS123 confirms: XLAB is the Current Data Authority', at: t(m.connected), active: false },
        ],
        transfer: [
          { label: 'XLAB names XHBR as Next Data Authority', at: t(m.ndaSent), active: false },
          { label: 'XHBR connects (inactive, waiting)', at: t(m.nextConnected), active: e.xhbr === 'requested' },
          { label: 'END SERVICE: XHBR becomes current', at: t(m.transferred), active: false },
        ],
        rejected: e.logonState === 'rejected' ? e.logonNote : '',
      }
    },
    250,
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  )
  const row = (st: { label: string; at: string | null; active: boolean }, k: number) => {
    const state: StepState = st.at ? 'done' : st.active ? 'active' : 'todo'
    return (
      <li key={k} className="flex min-w-0 items-start gap-2">
        <span
          className={cn(
            'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border',
            state === 'done' && 'border-primary bg-primary text-primary-foreground',
            state === 'active' && 'border-primary text-primary',
            state === 'todo' && 'text-muted-foreground',
          )}
          aria-hidden
        >
          {state === 'done' ? <Check className="size-3" /> : state === 'active' ? <LoaderCircle className="size-3 motion-safe:animate-spin" /> : <Circle className="size-2" />}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className={cn('text-xs', state === 'todo' ? 'text-muted-foreground' : 'font-medium')}>{st.label}</span>
          <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{st.at ? `${st.at}Z` : state === 'active' ? 'in progress…' : 'not yet'}</span>
        </span>
      </li>
    )
  }
  return (
    <div className="hud-panel grid gap-4 rounded-md p-4 md:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-2">
        <h3 className="text-sm font-semibold">
          Logging on (<Term id={s.standard === 'fans' ? 'fans-1a' : 'atn-b1'}>{s.standard === 'fans' ? 'FANS 1/A' : 'ATN B1'}</Term>)
        </h3>
        <ol className="flex flex-col gap-2">{s.steps.map(row)}</ol>
        {s.rejected && <p className="text-xs text-destructive">Logon rejected: {s.rejected}</p>}
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <h3 className="text-sm font-semibold">
          Handing over to the next centre (<Term id="next-data-authority">NDA</Term>)
        </h3>
        <ol className="flex flex-col gap-2">{s.transfer.map((x, k) => row(x, k + 10))}</ol>
      </div>
    </div>
  )
}
