import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Fingerprint } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Term } from '@/components/Term'
import {
  changedPulses,
  CODE_PULSES,
  decodeGillham,
  digitPulses,
  encodeGillham,
  F1_F2_US,
  formatFlightLevel,
  parseSquawk,
  REPLY_SLOTS,
  slotTimeUs,
  specialCode,
  SPI_AFTER_F2_US,
  SPI_DURATION_S,
  squawkToBits,
  type CodeBits,
  type CodePulse,
} from '@/core/ssr'
import { useSampled } from '@/hooks/useSampled'
import { cn } from '@/lib/utils'
import { useSsr, useSsrState } from './state'

const QUICK_CODES = [
  { code: '7700', label: '7700 emergency' },
  { code: '7600', label: '7600 radio failure' },
  { code: '7500', label: '7500 hijack' },
  { code: '7000', label: '7000 VFR' },
]

/** Type a squawk code and watch the reply pulse trains build. */
export function ReplyBuilder() {
  const { engine } = useSsr()
  const selectedId = useSsrState((s) => s.selectedId)
  const xpdr = useSsrState((s) => (selectedId ? s.xpdr[selectedId] : undefined))
  const setXpdr = useSsrState((s) => s.setXpdr)
  const pressIdent = useSsrState((s) => s.pressIdent)
  // What the learner is typing. It only overrides the committed code while it belongs to that code and aircraft,
  // so a code set elsewhere (a "Set it up" button, another aircraft) shows up straight away.
  const [draft, setDraft] = useState<{ id: string; code: string; text: string } | null>(null)
  const inputId = useId()
  const errId = useId()
  const text = draft && xpdr && draft.id === selectedId && draft.code === xpdr.squawk ? draft.text : (xpdr?.squawk ?? '')
  const setText = (v: string) => {
    if (selectedId && xpdr) setDraft({ id: selectedId, code: xpdr.squawk, text: v })
  }

  const live = useSampled(() => {
    const a = engine.getAircraft(selectedId)
    if (!a) return null
    return { alt: Math.round(a.altitudeFt), spi: engine.spiActive(a.id), identLeft: identLeft(engine, a.id) }
  }, 150)

  const parsed = parseSquawk(text)
  const error = text.length > 0 && !parsed.ok && (text.length >= 4 || /[89]/.test(text) || /\D/.test(text)) ? parsed.error : null

  if (!selectedId || !xpdr || !live) {
    return (
      <div className="hud-panel rounded-md p-4 text-sm text-muted-foreground">Choose an aircraft to see its transponder.</div>
    )
  }

  const code = xpdr.squawk
  const special = specialCode(code)
  const bitsA = squawkToBits(code)

  return (
    <div className="hud-panel flex min-w-0 flex-col gap-4 rounded-md p-4">
      <div>
        <h3 className="text-sm font-semibold">The transponder in {selectedId}</h3>
        <p className="text-xs text-muted-foreground">
          Type a <Term id="squawk">squawk</Term> code. Each digit goes from 0 to 7, so there are 4,096 codes.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={inputId}>Squawk code</Label>
          <Input
            id={inputId}
            value={text}
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errId : undefined}
            className="w-24 font-mono text-base tracking-widest tabular-nums"
            onChange={(e) => {
              const v = e.target.value.replace(/\s/g, '').slice(0, 4)
              const p = parseSquawk(v)
              if (p.ok) {
                setDraft(null)
                setXpdr(selectedId, { squawk: p.code })
              } else setText(v)
            }}
          />
        </div>
        <Button
          variant={live.spi ? 'default' : 'outline'}
          size="sm"
          onClick={() => pressIdent(selectedId)}
          disabled={!xpdr.on}
          aria-label={`Press IDENT on ${selectedId}`}
        >
          <Fingerprint aria-hidden /> IDENT{live.spi ? ` · ${live.identLeft} s` : ''}
        </Button>
      </div>
      {error && (
        <p id={errId} className="-mt-2 text-xs font-medium text-destructive" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Special codes">
        {QUICK_CODES.map((q) => (
          <Button
            key={q.code}
            size="xs"
            variant={code === q.code ? 'secondary' : 'outline'}
            onClick={() => {
              setDraft(null)
              setXpdr(selectedId, { squawk: q.code })
            }}
          >
            {q.label}
          </Button>
        ))}
      </div>
      {!xpdr.on && <p className="text-xs font-medium text-warning">The transponder is switched off: it sends no replies at all.</p>}
      {special && (
        <p className="text-xs">
          <span className="font-semibold">{special.tag}:</span> {special.meaning}. The controller's label shows this in words.
        </p>
      )}

      <PulseTrain
        title="Mode A reply: identity"
        caption={`Code ${code}`}
        bits={bitsA}
        spi={live.spi}
        digits={code}
      />
      <ModeCTrain altitudeFt={live.alt} spi={live.spi} />
    </div>
  )
}

function identLeft(engine: ReturnType<typeof useSsr>['engine'], id: string): number {
  const t = engine.transponder(id).identAtS
  return t == null ? 0 : Math.max(0, Math.ceil(SPI_DURATION_S - (engine.timeS - t)))
}

function ModeCTrain({ altitudeFt, spi }: { altitudeFt: number; spi: boolean }) {
  const reported = Math.round(altitudeFt / 100) * 100
  const bits = useMemo(() => encodeGillham(reported), [reported])
  const prev = useRef<CodeBits | null>(null)
  const [changed, setChanged] = useState<CodePulse[]>([])
  useEffect(() => {
    if (!bits) return
    if (prev.current) {
      const d = changedPulses(prev.current, bits)
      if (d.length) setChanged(d)
    }
    prev.current = bits
    const id = window.setTimeout(() => setChanged([]), 2500)
    return () => window.clearTimeout(id)
  }, [bits])
  if (!bits) return <p className="text-xs text-muted-foreground">Altitude outside the Mode C range.</p>
  const back = decodeGillham(bits)
  return (
    <PulseTrain
      title="Mode C reply: altitude"
      caption={`${reported.toLocaleString('en-US')} ft, shown as ${formatFlightLevel(reported)}`}
      bits={bits}
      spi={spi}
      highlight={changed}
      footer={
        <p className="text-xs text-muted-foreground">
          <Term id="gillham-code">Gray code</Term>: when the aircraft climbs or descends by 100 ft, exactly one pulse changes
          {changed.length ? (
            <>
              {' '}
              (just now: <span className="font-mono font-semibold text-foreground">{changed.join(', ')}</span>)
            </>
          ) : null}
          . Decoded back: {back != null ? `${back.toLocaleString('en-US')} ft` : 'illegal code'}.
        </p>
      }
    />
  )
}

const W = 400
const PAD_L = 14
const PAD_R = 14
const SPAN_US = F1_F2_US + SPI_AFTER_F2_US + 0.45
const xOf = (us: number) => PAD_L + (us / SPAN_US) * (W - PAD_L - PAD_R)
const PULSE_W = xOf(0.45) - xOf(0)

function PulseTrain({
  title,
  caption,
  bits,
  spi,
  digits,
  highlight = [],
  footer,
}: {
  title: string
  caption: string
  bits: CodeBits
  spi: boolean
  digits?: string
  highlight?: CodePulse[]
  footer?: React.ReactNode
}) {
  const sent = CODE_PULSES.filter((p) => bits[p])
  const label = `${title}. ${caption}. Pulses sent: F1, ${sent.join(', ') || 'no code pulses'}, F2${spi ? ', SPI' : ''}.`
  const top = 18
  const h = 34
  const base = top + h
  return (
    <figure className="flex min-w-0 flex-col gap-1.5">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="text-xs font-semibold">{title}</span>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">{caption}</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} 96`} role="img" aria-label={label} className="h-auto w-full rounded-md border bg-sim-bg">
        {/* time axis */}
        <line x1={xOf(0)} x2={xOf(SPAN_US)} y1={base} y2={base} className="stroke-sim-grid-strong" strokeWidth="1" />
        {/* framing */}
        {[0, F1_F2_US].map((t, i) => (
          <g key={t}>
            <rect x={xOf(t)} y={top} width={PULSE_W} height={h} className="fill-sim-ink" />
            <text x={xOf(t) + PULSE_W / 2} y={top - 5} textAnchor="middle" className="fill-sim-ink text-[10px] font-semibold">
              {i === 0 ? 'F1' : 'F2'}
            </text>
          </g>
        ))}
        {REPLY_SLOTS.map((s) => {
          const x = xOf(slotTimeUs(s))
          const on = s !== 'X' && bits[s]
          const hi = s !== 'X' && highlight.includes(s)
          return (
            <g key={s}>
              {on ? (
                <rect x={x} y={top} width={PULSE_W} height={h} className={cn('fill-sim-signal', hi && 'stroke-sim-warning')} strokeWidth={hi ? 2 : 0} />
              ) : (
                <rect
                  x={x}
                  y={base - 4}
                  width={PULSE_W}
                  height={4}
                  className={cn(s === 'X' ? 'fill-none stroke-sim-muted' : 'fill-sim-grid-strong', hi && 'fill-sim-warning')}
                  strokeDasharray={s === 'X' ? '1.5 1.5' : undefined}
                />
              )}
              <text x={x + PULSE_W / 2} y={base + 12} textAnchor="middle" className={cn('text-[9.5px]', on ? 'fill-sim-ink font-semibold' : 'fill-sim-muted')}>
                {s}
              </text>
            </g>
          )
        })}
        {/* SPI */}
        <rect
          x={xOf(F1_F2_US + SPI_AFTER_F2_US)}
          y={spi ? top : base - 4}
          width={PULSE_W}
          height={spi ? h : 4}
          className={spi ? 'fill-sim-warning' : 'fill-none stroke-sim-muted'}
          strokeDasharray={spi ? undefined : '1.5 1.5'}
        />
        <text x={xOf(F1_F2_US + SPI_AFTER_F2_US) + PULSE_W / 2} y={top - 5} textAnchor="end" className={cn('text-[10px] font-semibold', spi ? 'fill-sim-ink' : 'fill-sim-muted')}>
          SPI
        </text>
        <text x={xOf(0)} y={90} className="fill-sim-muted text-[9.5px]">
          0 µs
        </text>
        <text x={xOf(F1_F2_US)} y={90} textAnchor="middle" className="fill-sim-muted text-[9.5px]">
          20.3 µs
        </text>
        <text x={xOf(SPAN_US)} y={90} textAnchor="end" className="fill-sim-muted text-[9.5px]">
          24.65
        </text>
      </svg>
      {digits && <DigitSums digits={digits} bits={bits} />}
      {footer}
    </figure>
  )
}

/** Shows how each digit is made from its three pulses (weights 4, 2, 1). */
function DigitSums({ digits, bits }: { digits: string; bits: CodeBits }) {
  return (
    <div className="grid grid-cols-4 gap-1.5" aria-hidden>
      {(['A', 'B', 'C', 'D'] as const).map((d, i) => {
        const [p4, p2, p1] = digitPulses(d)
        return (
          <div key={d} className="rounded-md border bg-background px-1.5 py-1 text-center">
            <p className="font-mono text-[11px] leading-4 text-muted-foreground tabular-nums">
              {bits[p4] ? 4 : 0}+{bits[p2] ? 2 : 0}+{bits[p1] ? 1 : 0}
            </p>
            <p className="font-mono text-sm leading-5 font-semibold tabular-nums">
              {d} = {digits[i]}
            </p>
          </div>
        )
      })}
    </div>
  )
}
