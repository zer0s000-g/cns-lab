import { useCallback, useId } from 'react'
import { Canvas2D, type DrawFn } from '@/components/sim/Canvas2D'
import { Term } from '@/components/Term'
import { cdiLateral, cdiVertical } from '@/core/ils'
import { MARKER_TONE_HZ, markerKeying, type MarkerKind } from '@/core/morse'
import { useSampled } from '@/hooks/useSampled'
import { CDI } from '@/instruments'
import { cn } from '@/lib/utils'
import { useIls } from './state'

const MARKERS: { kind: MarkerKind; letter: string; name: string; token: 'marker-outer' | 'marker-middle' | 'marker-inner' }[] = [
  { kind: 'outer', letter: 'O', name: 'Outer', token: 'marker-outer' },
  { kind: 'middle', letter: 'M', name: 'Middle', token: 'marker-middle' },
  { kind: 'inner', letter: 'I', name: 'Inner', token: 'marker-inner' },
]

/** The pilot's ILS display: CDI with glideslope, a strength meter under each needle, marker lamps and the ident. */
export function Cockpit({ className }: { className?: string }) {
  const { engine } = useIls()
  const r = useSampled(
    () => {
      const rx = engine.receiver
      return {
        loc: { m90: rx.loc.m90, m150: rx.loc.m150, ddm: rx.loc.ddm, valid: rx.loc.valid, weak: rx.loc.severity > 0.1 },
        gs: { m90: rx.gs.m90, m150: rx.gs.m150, ddm: rx.gs.ddm, valid: rx.gs.valid, weak: rx.gs.severity > 0.1 },
        ident: engine.timeS < engine.identUntilS,
        off: engine.locOff,
      }
    },
    120,
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  )

  return (
    <div className={cn('flex flex-col gap-3 rounded-lg border bg-card p-3', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">In the cockpit</h3>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          ILS {engine.site.locMHz.toFixed(2)} · {engine.site.ident}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)] lg:grid-cols-1">
        <div className="flex flex-col items-center gap-2">
          <CDI
            title="ILS"
            size={210}
            read={() => {
              const rx = engine.receiver
              return {
                courseDeg: engine.site.courseDeg,
                lateral: rx.loc.valid ? cdiLateral(rx.loc.ddm) : 0,
                toFrom: rx.loc.valid ? 'TO' : 'OFF',
                hideToFrom: true,
                glideslope: { vertical: rx.gs.valid ? cdiVertical(rx.gs.ddm) : 0, valid: rx.gs.valid },
              }
            }}
          />
          <MarkerLamps />
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <ToneMeter
            title={<Term id="localizer">Localizer</Term>}
            m90={r.loc.m90}
            m150={r.loc.m150}
            max={0.4}
            valid={r.loc.valid}
            weak={r.loc.weak}
            advice={locAdvice(r.loc.ddm)}
            offText={r.off ? 'Switched off by its monitor: no signal' : 'Flag: no usable signal'}
          />
          <ToneMeter
            title={<Term id="glideslope">Glideslope</Term>}
            m90={r.gs.m90}
            m150={r.gs.m150}
            max={0.7}
            valid={r.gs.valid}
            weak={r.gs.weak}
            advice={gsAdvice(r.gs.ddm)}
            offText="Flag: no usable signal"
          />
          <p className={cn('text-xs', r.ident ? 'text-foreground' : 'text-muted-foreground')} aria-live="off">
            <span className="font-semibold">Ident:</span>{' '}
            {r.off ? 'none, the localizer is off' : r.ident ? `keying ${engine.site.ident} in Morse (1020 Hz)` : `${engine.site.ident}, sent every few seconds`}
          </p>
        </div>
      </div>
    </div>
  )
}

function locAdvice(ddm: number): string {
  if (Math.abs(ddm) < 0.004) return 'Both equal: on the centreline'
  return ddm > 0 ? `90 Hz louder by ${(ddm * 100).toFixed(1)}%: left of the centreline, fly right` : `150 Hz louder by ${(-ddm * 100).toFixed(1)}%: right of the centreline, fly left`
}

function gsAdvice(ddm: number): string {
  if (Math.abs(ddm) < 0.004) return 'Both equal: on the glide path'
  return ddm > 0 ? `90 Hz louder by ${(ddm * 100).toFixed(1)}%: above the path, fly down` : `150 Hz louder by ${(-ddm * 100).toFixed(1)}%: below the path, fly up`
}

/** "Difference in strength": how deep each tone is, as two bars with the tones' colours and patterns. */
function ToneMeter({
  title,
  m90,
  m150,
  max,
  valid,
  weak,
  advice,
  offText,
}: {
  title: React.ReactNode
  m90: number
  m150: number
  max: number
  valid: boolean
  weak: boolean
  advice: string
  offText: string
}) {
  const id = useId().replace(/:/g, '')
  const rows = [
    { tone: '90 Hz', v: m90, pat: `p90-${id}`, cls: 'fill-lobe-90', stroke: 'stroke-lobe-90' },
    { tone: '150 Hz', v: m150, pat: `p150-${id}`, cls: 'fill-lobe-150', stroke: 'stroke-lobe-150' },
  ]
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold">{title}: which tone is louder?</span>
      </div>
      {valid ? (
        <>
          <svg viewBox="0 0 200 38" className="h-auto w-full max-w-[300px]" role="img" aria-label={`90 hertz ${(m90 * 100).toFixed(0)} percent, 150 hertz ${(m150 * 100).toFixed(0)} percent. ${advice}.`}>
            <defs>
              <pattern id={`p90-${id}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="6" className="stroke-lobe-90" strokeWidth="2.2" />
              </pattern>
              <pattern id={`p150-${id}`} width="6" height="6" patternUnits="userSpaceOnUse">
                <circle cx="3" cy="3" r="1.3" className="fill-lobe-150" />
              </pattern>
            </defs>
            {rows.map((row, i) => {
              const y = i * 19 + 2
              const bw = Math.max(0, Math.min(1, row.v / max)) * 128
              return (
                <g key={row.tone}>
                  <text x="0" y={y + 11} className="fill-foreground text-[10px] font-semibold">
                    {row.tone}
                  </text>
                  <rect x="40" y={y} width="128" height="14" rx="2" className="fill-muted" />
                  <rect x="40" y={y} width={bw} height="14" rx="2" className={row.cls} opacity="0.35" />
                  <rect x="40" y={y} width={bw} height="14" rx="2" fill={`url(#${row.pat})`} />
                  <rect x="40" y={y} width={bw} height="14" rx="2" className={cn('fill-none', row.stroke)} strokeWidth="1" />
                  <text x="198" y={y + 11} textAnchor="end" className="fill-foreground font-mono text-[10px] tabular-nums">
                    {(row.v * 100).toFixed(1)}%
                  </text>
                </g>
              )
            })}
          </svg>
          <p className="text-xs text-muted-foreground">
            {advice}
            {weak && <span className="text-warning"> · weak signal outside the coverage area: unreliable</span>}
          </p>
        </>
      ) : (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs font-medium text-destructive">{offText}</p>
      )}
    </div>
  )
}

/** Marker lamps: each flashes in step with its Morse-like keying while the aircraft is over that marker. */
function MarkerLamps() {
  const { engine } = useIls()
  const draw: DrawFn = useCallback(
    (ctx, { width, height, tokens: t }) => {
      const active = engine.receiver.marker
      const n = MARKERS.length
      const gap = width / n
      const r = Math.min(13, gap / 2 - 6, height / 2 - 2)
      MARKERS.forEach((m, i) => {
        const cx = gap * (i + 0.5)
        const cy = height / 2
        let on = false
        if (active === m.kind) {
          const k = markerKeying(m.kind)
          const ph = (engine.timeS - engine.markerSinceS) % k.periodS
          on = k.segments.some((sg) => ph >= sg.startS && ph < sg.startS + sg.durationS)
        }
        ctx.fillStyle = t['instrument-face']
        ctx.beginPath()
        ctx.arc(cx, cy, r + 2, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = on ? t[m.token] : t['instrument-bezel']
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = on ? t['scope-bg'] : t['instrument-dim']
        ctx.font = `700 ${Math.round(r)}px ${t.fontSans}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(m.letter, cx, cy + 0.5)
      })
    },
    [engine],
  )
  const active = useSampled(() => engine.receiver.marker, 150)
  const m = MARKERS.find((x) => x.kind === active)
  return (
    <div className="flex w-full max-w-[210px] flex-col items-center gap-1">
      <Canvas2D
        draw={draw}
        label={m ? `${m.name} marker lamp flashing, ${MARKER_TONE_HZ[m.kind]} hertz tone.` : 'Marker lamps: all dark.'}
        className="h-9 w-full rounded-md border-2 border-instrument-bezel bg-instrument-face"
      />
      <span className="text-center text-[11px] text-muted-foreground">
        <Term id="marker-beacon">Markers</Term>: {m ? `${m.name}, ${MARKER_TONE_HZ[m.kind]} Hz` : 'O blue · M amber · I white'}
      </span>
    </div>
  )
}
