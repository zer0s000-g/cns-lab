import { BellRing, Headphones, Radio, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LeverSwitch, Segmented } from '@/hud/Controls'
import { HudPanel } from '@/hud/HudFrame'
import { Term } from '@/components/Term'
import { SELCAL_LETTERS, SELCAL_TONES_HZ, hfQuality } from '@/core/hf'
import { useSampled } from '@/hooks/useSampled'
import { Spectrum, type SpectrumReading } from '@/instruments'
import { cn } from '@/lib/utils'
import { radioLineOfSightNm } from '@/core/propagation'
import { CRUISE_FT, type AircraftId } from './engine'
import type { HfAudioDirector } from './hfAudio'
import { QUALITY_TEXT, modeText, nmText } from './labels'
import { useHf, useHfState } from './state'

const IDS: AircraftId[] = ['CNS101', 'CNS202', 'CNS303']

/** SELCAL: the ground station rings one aircraft; only that aircraft's decoder chimes. */
export function SelcalPanel() {
  const { engine, clock } = useHf()
  const target = useHfState((s) => s.selcalTarget)
  const setTarget = useHfState((s) => s.setSelcalTarget)
  const st = useSampled(
    () => {
      const pair = engine.selcalPairNow()
      return {
        sending: engine.selcal !== null,
        code: engine.selcal?.code ?? engine.lastCall?.code ?? null,
        pair,
        rows: IDS.map((id) => {
          const res = engine.results[id]
          const r = engine.reception(id)
          return {
            id,
            code: engine.codeOf(id),
            d: engine.distanceOf(id),
            res: res ? { rang: res.rang, forMe: res.forMe, received: res.received } : null,
            mode: modeText(r),
            ok: r.mode !== null,
          }
        }),
      }
    },
    100,
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  )

  const tones = (): SpectrumReading => {
    const c = engine.selcal
    const pair = engine.selcalPairNow()
    const active = c && pair !== null ? c.code.split('-')[pair] : ''
    return {
      minF: 280,
      maxF: 1650,
      unit: 'Hz',
      log: true,
      topDb: 0,
      floorDb: -50,
      ticks: [312.6, 645.7, 1333.5],
      peaks: [...SELCAL_LETTERS].map((ch) => ({ f: SELCAL_TONES_HZ[ch], db: active.includes(ch) ? -6 : -38, emphasis: active.includes(ch), label: ch })),
    }
  }

  const statusOf = (row: (typeof st.rows)[number]) => {
    if (st.sending) return row.ok ? 'Decoder listening…' : 'No signal here'
    if (!row.res) return row.ok ? 'Quiet: loudspeaker off' : 'Out of reach on this frequency'
    if (row.res.rang) return 'Chime: called'
    if (row.res.forMe) return 'Missed: tones did not arrive'
    return row.res.received ? 'Not its code: stays quiet' : 'Nothing received'
  }

  return (
    <HudPanel
      index="SC"
      title={
        <span className="inline-flex items-center gap-2">
          <BellRing className="size-3.5 text-signal" aria-hidden />
          <span>
            <Term id="selcal">SELCAL</Term>: a doorbell for HF
          </span>
        </span>
      }
      bodyClassName="p-0"
    >
    <section aria-label="SELCAL" className="flex min-w-0 flex-col gap-4 p-4">
      <p className="-mb-1 text-xs text-muted-foreground">Pilots keep the noisy HF turned down. The station sends two pairs of tones; only the aircraft with that code chimes.</p>
      <Segmented
        label="The ground station calls"
        value={target}
        onChange={setTarget}
        options={IDS.map((id) => ({ value: id, label: id === 'CNS101' ? 'CNS101 (you)' : id }))}
      />
      <Button
        onClick={() => {
          clock.getState().play()
          engine.sendSelcal(target)
        }}
        disabled={st.sending}
        className="w-full sm:w-fit"
      >
        <Send aria-hidden /> Send SELCAL {engine.codeOf(target)}
      </Button>
      <figure className="flex min-w-0 flex-col gap-1.5">
        <figcaption className="text-xs text-muted-foreground">The 16 SELCAL tones (no I, N or O). Lit: the pair being sent now.</figcaption>
        <Spectrum read={tones} className="h-32" describe={() => (st.code ? `SELCAL code ${st.code}${st.pair !== null ? `, sending pair ${st.pair + 1}` : ''}.` : 'SELCAL tones, none being sent.')} />
      </figure>
      <ul className="flex flex-col divide-y divide-hud-line rounded-[4px] border border-hud-line" aria-live="polite">
        {st.rows.map((row) => {
          const lit = !st.sending && row.res?.rang
          return (
            <li key={row.id} className="flex min-h-12 items-center gap-3 px-3 py-2">
              <span
                className={cn(
                  'grid size-7 shrink-0 place-items-center rounded-full border text-[10px] font-bold',
                  lit ? 'border-signal bg-signal text-background shadow-[0_0_10px_var(--signal)]' : 'border-hud-line bg-background/40 text-muted-foreground',
                )}
                aria-label={lit ? 'SELCAL light on' : 'SELCAL light off'}
              >
                SC
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium">
                  {row.id === 'CNS101' ? 'CNS101 (you)' : row.id} · <span className="hud-value">{row.code}</span>
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {nmText(row.d)} out · {row.mode}
                </span>
              </div>
              <span className={cn('shrink-0 text-right text-xs font-medium', row.res?.rang ? 'text-signal' : row.res?.forMe ? 'text-destructive' : 'text-muted-foreground')}>{statusOf(row)}</span>
            </li>
          )
        })}
      </ul>
    </section>
    </HudPanel>
  )
}

/** Hear the same message over HF (with its noise now) and over VHF. */
export function ComparePanel({ director }: { director: React.RefObject<HfAudioDirector | null> }) {
  const { engine } = useHf()
  const listen = useHfState((s) => s.params.listen)
  const setParam = useHfState((s) => s.setParam)
  const d = useHfState((s) => s.params.distanceNm)
  const q = useSampled(() => {
    const r = engine.reception()
    return { q: hfQuality(r), snr: r.snrDb, mode: modeText(r) }
  }, 200)
  const vhfRange = radioLineOfSightNm(100, CRUISE_FT)
  return (
    <HudPanel
      index="AUD"
      title={
        <span className="inline-flex items-center gap-2">
          <Headphones className="size-3.5 text-signal" aria-hidden /> HF or VHF: hear the difference
        </span>
      }
      bodyClassName="p-0"
    >
    <section aria-label="HF and VHF audio" className="flex min-w-0 flex-col gap-4 p-4">
      <p className="-mb-1 text-xs text-muted-foreground">
        HF voice uses <Term id="ssb">single sideband</Term> in a narrow channel, with hiss, fading and static. VHF is clear, but only in line of sight.
      </p>
      <div className="rounded-[4px] border border-hud-line bg-background/40 p-3 text-sm" aria-live="polite">
        <p>
          <span className="font-medium">HF at CNS101 now: </span>
          <span className={cn(q.q === 'clear' ? 'text-success' : q.q === 'noisy' ? 'text-warning' : 'text-destructive', 'font-medium')}>{QUALITY_TEXT[q.q]}</span>
          {Number.isFinite(q.snr) && <span className="hud-value text-xs text-muted-foreground"> · {q.snr.toFixed(0)} dB above the noise</span>}
        </p>
        <p className="text-xs text-muted-foreground">
          {q.mode}. VHF from the coast reaches only about {Math.round(vhfRange)} NM{d > vhfRange ? ', so CNS101 is far out of VHF range.' : '.'}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => director.current?.playHf(engine)}>
          <Radio aria-hidden /> Hear it on HF
        </Button>
        <Button variant="outline" onClick={() => director.current?.playVhf()}>
          <Radio aria-hidden /> Hear it on VHF
        </Button>
      </div>
      <LeverSwitch label="Keep the HF loudspeaker on" tone="signal" checked={listen} onChange={(v) => setParam('listen', v)} hint="What pilots heard for hours before SELCAL." />
    </section>
    </HudPanel>
  )
}
