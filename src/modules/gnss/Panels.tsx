import { CircleCheck, CircleX, ShieldAlert, ShieldCheck, ShieldQuestion, TriangleAlert } from 'lucide-react'
import { Readout, ReadoutGrid } from '@/components/sim/Controls'
import { Term } from '@/components/Term'
import { Spectrum, type SpectrumReading } from '@/instruments'
import { GNSS_SIGNAL_DBM, GPS_CA_CHIP_RATE, TRACKING_THRESHOLD_DBHZ, dopRating, thermalNoiseDbm, type DopRating } from '@/core/gnss'
import { SPEED_OF_LIGHT_MS } from '@/core/units'
import { useSampled } from '@/hooks/useSampled'
import { cn } from '@/lib/utils'
import { CROSS_CHECK_LIMIT_M, SPOOF } from './engine'
import { formatDistance, formatMetres } from './format'
import { useGnss } from './state'
import { correctionsSummary, raimSummary, type StatusLine } from './status'

const jsonEqual = <T,>(a: T, b: T) => JSON.stringify(a) === JSON.stringify(b)

// ---------------------------------------------------------------------------
// DOP meter
// ---------------------------------------------------------------------------

const RATING_TEXT: Record<DopRating, string> = {
  ideal: 'Ideal',
  excellent: 'Excellent',
  good: 'Good',
  moderate: 'Moderate',
  fair: 'Fair',
  poor: 'Poor',
}

/** Log-scale meter of position DOP: 1 on the left, 50 on the right. */
export function DopMeter() {
  const { engine } = useGnss()
  const d = useSampled(() => {
    const dop = engine.result.dop
    return dop ? { p: dop.pdop, h: dop.hdop, v: dop.vdop } : null
  }, 250, jsonEqual)
  const nUsed = useSampled(() => engine.result.usedIds.length, 250)
  const pos = (x: number) => Math.min(1, Math.log(Math.max(1, x)) / Math.log(50)) * 100
  const rating = d ? dopRating(d.p) : null
  const tone = rating === null ? (nUsed >= 4 ? 'alert' : 'muted') : rating === 'ideal' || rating === 'excellent' || rating === 'good' ? 'ok' : rating === 'moderate' ? 'warning' : 'alert'
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">
          Satellite geometry (<Term id="dop">PDOP</Term>)
        </span>
        <span
          className={cn(
            'font-mono text-sm font-semibold tabular-nums',
            tone === 'ok' && 'text-success',
            tone === 'warning' && 'text-warning',
            tone === 'alert' && 'text-destructive',
            tone === 'muted' && 'text-muted-foreground',
          )}
        >
          {d ? `${d.p >= 100 ? '> 99' : d.p.toFixed(1)} · ${RATING_TEXT[rating!]}` : nUsed >= 4 ? 'Too poor to measure' : 'Needs 4 satellites'}
        </span>
      </div>
      <div className="relative h-3 overflow-hidden rounded-full border bg-muted" aria-hidden>
        <div className="absolute inset-y-0 left-0 bg-success/25" style={{ width: `${pos(5)}%` }} />
        <div className="absolute inset-y-0 bg-warning/25" style={{ left: `${pos(5)}%`, width: `${pos(10) - pos(5)}%` }} />
        <div className="absolute inset-y-0 right-0 bg-destructive/20" style={{ left: `${pos(10)}%` }} />
        {d && <div className="absolute inset-y-0 w-1 -translate-x-1/2 rounded-full bg-foreground" style={{ left: `${pos(d.p)}%` }} />}
      </div>
      <div className="flex justify-between font-mono text-[10px] text-muted-foreground tabular-nums" aria-hidden>
        <span>1 best</span>
        <span>2</span>
        <span>5</span>
        <span>10</span>
        <span>20</span>
        <span>50 worst</span>
      </div>
      {d && (
        <p className="text-xs text-muted-foreground">
          Across (HDOP) <span className="font-mono tabular-nums text-foreground">{d.h.toFixed(1)}</span> · Up and down (VDOP){' '}
          <span className="font-mono tabular-nums text-foreground">{d.v.toFixed(1)}</span>. Error ≈ DOP × ranging error.
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Integrity (RAIM) and corrections
// ---------------------------------------------------------------------------

function StatusRow({ line, kind }: { line: StatusLine; kind: 'raim' | 'corr' }) {
  const Icon = line.tone === 'ok' ? ShieldCheck : line.tone === 'alert' ? ShieldAlert : line.tone === 'warning' ? TriangleAlert : ShieldQuestion
  return (
    <div className="flex items-start gap-2.5">
      <Icon
        className={cn(
          'mt-0.5 size-4 shrink-0',
          line.tone === 'ok' && 'text-success',
          line.tone === 'warning' && 'text-warning',
          line.tone === 'alert' && 'text-destructive',
          line.tone === 'muted' && 'text-muted-foreground',
        )}
        aria-hidden
      />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-semibold">
          <span className="sr-only">{kind === 'raim' ? 'Integrity check: ' : 'Corrections: '}</span>
          {line.title}
        </span>
        <span className="text-xs text-muted-foreground">{line.detail}</span>
      </div>
    </div>
  )
}

/** Geometry, integrity and corrections at a glance. */
export function PositionCheck() {
  const { engine } = useGnss()
  const raim = useSampled(() => raimSummary(engine), 250, jsonEqual)
  const corr = useSampled(() => correctionsSummary(engine), 250, jsonEqual)
  return (
    <div className="flex flex-col gap-4">
      <DopMeter />
      <div className="flex flex-col gap-1.5 border-t pt-3">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Integrity check (<Term id="raim">RAIM</Term>)
        </p>
        <div aria-live="polite">
          <StatusRow line={raim} kind="raim" />
        </div>
      </div>
      <div className="flex flex-col gap-1.5 border-t pt-3">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Corrections</p>
        <StatusRow line={corr} kind="corr" />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

const CN0_MIN = 20
const CN0_MAX = 55

export function SignalBars() {
  const { engine } = useGnss()
  const bars = useSampled(
    () =>
      engine.sats
        .filter((s) => s.elDeg >= 5)
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((s) => ({ id: s.id, cn0: Math.round(s.cn0DbHz), status: s.status, used: s.used, faulty: s.faulty })),
    250,
    jsonEqual,
  )
  const spoof = useSampled(() => engine.env.spoofing && engine.result.spoofOffsetM > 0, 250)
  const pct = (v: number) => Math.max(0, Math.min(1, (v - CN0_MIN) / (CN0_MAX - CN0_MIN))) * 100
  const summary = bars.map((b) => `${b.id} ${b.status === 'ok' ? `${b.cn0} dB-Hz` : b.status === 'blocked' ? 'blocked' : 'lost'}`).join(', ')
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">
          Signal strength (<Term id="c-n0">C/N0</Term>)
        </span>
        <span className="text-xs text-muted-foreground">dB-Hz</span>
      </div>
      <div role="img" aria-label={`Signal strength of each satellite above the mask: ${summary}.`}>
        <div className="relative flex h-28 items-end gap-1 border-b border-border">
          {bars.map((b) => (
            <div key={b.id} className="relative flex h-full min-w-0 flex-1 flex-col justify-end" aria-hidden>
              <span className="mb-0.5 text-center font-mono text-[9px] tabular-nums text-muted-foreground">{b.status === 'ok' ? b.cn0 : '–'}</span>
              <div
                className={cn(
                  'w-full rounded-t-sm',
                  b.status !== 'ok' && 'bg-transparent',
                  b.status === 'ok' && b.used && (b.faulty ? 'bg-destructive' : 'bg-primary'),
                  b.status === 'ok' && !b.used && 'border border-primary bg-primary/15',
                )}
                style={{ height: `${b.status === 'ok' ? pct(b.cn0) : 0}%` }}
              />
            </div>
          ))}
          <div
            className="absolute inset-x-0 z-10 border-t-2 border-dashed border-destructive"
            style={{ bottom: `${pct(TRACKING_THRESHOLD_DBHZ)}%` }}
            aria-hidden
          />
          <span
            className="absolute left-0 z-10 rounded-sm bg-card px-1 text-[10px] font-medium text-destructive"
            style={{ bottom: `calc(${pct(TRACKING_THRESHOLD_DBHZ)}% + 3px)` }}
            aria-hidden
          >
            Lost below {TRACKING_THRESHOLD_DBHZ}
          </span>
        </div>
        <div className="mt-1 flex gap-1" aria-hidden>
          {bars.map((b) => (
            <span key={b.id} className="min-w-0 flex-1 truncate text-center font-mono text-[9px] text-muted-foreground">
              {b.id.slice(1)}
            </span>
          ))}
        </div>
      </div>
      {spoof ? (
        <p className="text-xs font-medium text-warning">Suspicious: every signal is exactly as strong as the others, and stronger than usual.</p>
      ) : (
        <p className="text-xs text-muted-foreground">Filled bars are used. Low satellites are weaker: their signal crosses more air.</p>
      )}
    </div>
  )
}

/** The L1 band on a spectrum view: the GPS signal lies below the noise; a jammer towers above it. */
export function SignalSpectrum() {
  const { engine } = useGnss()
  const noiseDbm = thermalNoiseDbm(2 * GPS_CA_CHIP_RATE)
  const read = (): SpectrumReading => {
    const js = engine.result.jsDb
    const peaks: SpectrumReading['peaks'] = []
    if (js !== null) peaks.push({ f: 1575.42, width: 9, db: GNSS_SIGNAL_DBM + js, label: `Jammer ${Math.round(GNSS_SIGNAL_DBM + js)} dBm` })
    peaks.push({ f: 1575.42, width: 9.6, db: noiseDbm, label: `Receiver noise ${Math.round(noiseDbm)} dBm` })
    if (engine.env.spoofing && js === null) peaks.push({ f: 1575.42, width: 2.046, db: GNSS_SIGNAL_DBM + (SPOOF.cn0DbHz - 45), label: 'Fake GPS signals', emphasis: true })
    else peaks.push({ f: 1575.42, width: 2.046, db: GNSS_SIGNAL_DBM, label: `GPS ${GNSS_SIGNAL_DBM} dBm`, emphasis: true })
    return { minF: 1570.42, maxF: 1580.42, unit: 'MHz', levelUnit: 'dBm', topDb: -50, floorDb: -140, peaks, ticks: [1571, 1575.42, 1580] }
  }
  const describe = () => {
    const js = engine.result.jsDb
    return `L1 band around 1575.42 MHz. The GPS signal arrives at about ${GNSS_SIGNAL_DBM} dBm, below the receiver noise of about ${Math.round(noiseDbm)} dBm.${
      js !== null ? ` A jammer arrives at ${Math.round(GNSS_SIGNAL_DBM + js)} dBm, ${Math.round(js)} dB stronger than the satellites.` : ''
    }`
  }
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">The L1 frequency band (1575.42 MHz)</span>
      <Spectrum read={read} describe={describe} className="h-48" />
      <p className="text-xs text-muted-foreground">
        Power in dBm. The GPS signal is weaker than the receiver's own noise: the receiver digs it out by matching the satellite's code.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Other navigation aids (jamming / spoofing)
// ---------------------------------------------------------------------------

type AidState = 'works' | 'lost' | 'wrong'

export function OtherAids() {
  const { engine } = useGnss()
  const st = useSampled(() => {
    const r = engine.result
    const lost = r.kind === 'none' && r.nTracked < 3
    const wrong = !lost && engine.env.spoofing && r.spoofOffsetM > 0
    return { gnss: (lost ? 'lost' : wrong ? 'wrong' : 'works') as AidState, cross: r.crossCheckM }
  }, 300, jsonEqual)
  const g = st.gnss
  const dep = (lostText: string, wrongText: string): { state: AidState; note: string } =>
    g === 'lost' ? { state: 'lost', note: lostText } : g === 'wrong' ? { state: 'wrong', note: wrongText } : { state: 'works', note: 'Working' }
  const rows: { name: React.ReactNode; state: AidState; note: string }[] = [
    { name: <Term id="vor">VOR</Term>, state: 'works', note: 'Ground beacon on VHF: not affected' },
    { name: <Term id="dme">DME</Term>, state: 'works', note: 'Ground beacon, different frequency: not affected' },
    { name: <Term id="ils">ILS</Term>, state: 'works', note: 'Landing beams from the runway: not affected' },
    { name: 'Radar (primary and secondary)', state: 'works', note: 'The controller still sees the aircraft' },
    { name: 'VHF voice radio', state: 'works', note: 'Pilot and controller can still talk' },
    { name: <Term id="inertial-navigation">Inertial navigation</Term>, state: 'works', note: 'Keeps going, but slowly drifts without GNSS' },
    { name: <Term id="ads-b">ADS-B</Term>, ...dep('Has no position to broadcast', 'Broadcasts the fake position') },
    { name: <Term id="rnp">RNP</Term>, ...dep('GNSS approaches not available', 'Would guide towards the wrong place') },
    { name: 'SBAS and GBAS approaches', ...dep('Not available', 'Would guide towards the wrong place') },
  ]
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-semibold">What still works?</h3>
        <p className="text-xs text-muted-foreground">
          {g === 'lost'
            ? 'GNSS is gone. Everything that relies on it stops; ground-based aids keep working.'
            : g === 'wrong'
              ? 'GNSS looks healthy but is wrong. Only a cross-check with other aids reveals it.'
              : 'Everything is working. Switch on jamming or spoofing to see what changes.'}
        </p>
      </div>
      <ul className="flex flex-col divide-y">
        {rows.map((row, i) => (
          <li key={i} className="flex min-h-10 items-center justify-between gap-3 py-1.5">
            <span className="text-sm">{row.name}</span>
            <span
              className={cn(
                'flex shrink-0 items-center gap-1.5 text-right text-xs',
                row.state === 'works' && 'text-muted-foreground',
                row.state === 'lost' && 'font-medium text-destructive',
                row.state === 'wrong' && 'font-medium text-warning',
              )}
            >
              {row.state === 'works' ? (
                <CircleCheck className="size-4 text-success" aria-hidden />
              ) : row.state === 'lost' ? (
                <CircleX className="size-4" aria-hidden />
              ) : (
                <TriangleAlert className="size-4" aria-hidden />
              )}
              <span className="max-w-44">{row.note}</span>
            </span>
          </li>
        ))}
      </ul>
      {st.cross !== null && (
        <p className={cn('rounded-md border px-3 py-2 text-xs', st.cross > CROSS_CHECK_LIMIT_M ? 'border-destructive/50 text-destructive' : 'text-muted-foreground')} aria-live="polite">
          <span className="font-semibold">Cross-check: </span>
          GNSS and the DME/DME position are {formatDistance(st.cross)} apart.{' '}
          {st.cross > CROSS_CHECK_LIMIT_M ? 'They disagree: GNSS position rejected, the crew is alerted.' : `Still within ${formatDistance(CROSS_CHECK_LIMIT_M)}.`}
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Readouts
// ---------------------------------------------------------------------------

export function LiveReadouts() {
  const { engine } = useGnss()
  const v = useSampled(() => {
    const r = engine.result
    return {
      kind: r.kind,
      used: r.usedIds.length,
      tracked: r.nTracked,
      h: r.hErrM,
      vErr: r.vErrM,
      h95: r.h95M,
      sigma: r.sigmaM,
      cb: r.clockBiasM,
      misfit: r.misfitM,
      guess: engine.settings.clockMode === 'guess',
      guessNs: engine.settings.clockGuessNs,
      fault: engine.env.faultySat ? { id: engine.faultyId, m: r.faultBiasM } : null,
      spoof: engine.env.spoofing ? r.spoofOffsetM : null,
      js: r.jsDb,
      aug: r.augmentation,
    }
  }, 250, jsonEqual)
  const has = v.kind !== 'none' && Number.isFinite(v.h)
  const outside = has && v.kind === 'fix' && v.h95 > 0 && v.h > v.h95
  return (
    <ReadoutGrid>
      <Readout label="Satellites used" value={`${v.used}`} unit={`of ${v.tracked} received`} hint={v.used >= 4 ? 'Enough for a position' : 'At least 4 needed'} tone={v.used >= 4 ? 'default' : 'warning'} />
      <Readout
        label="Position error"
        value={has ? formatMetres(v.h) : '—'}
        hint={has ? `Height ${v.vErr >= 0 ? '+' : '−'}${formatMetres(Math.abs(v.vErr))}` : 'No position'}
        tone={outside ? 'warning' : 'default'}
      />
      <Readout label="95% circle radius" value={v.kind === 'fix' && v.h95 > 0 ? formatMetres(v.h95) : '—'} hint="Predicted: 2 × HDOP × ranging error" />
      <Readout
        label={<Term id="ranging-error">Ranging error</Term>}
        value={v.sigma > 0 ? formatMetres(v.sigma, 2) : '—'}
        hint={v.aug === 'none' ? 'Per satellite, no corrections' : `Per satellite, with ${v.aug === 'sbas' ? 'SBAS' : 'GBAS'}`}
      />
      <Readout
        label={<Term id="receiver-clock-error">Receiver clock</Term>}
        value={v.guess ? `${v.guessNs >= 0 ? '+' : '−'}${Math.abs(v.guessNs)} ns` : v.cb !== null ? `${((v.cb / SPEED_OF_LIGHT_MS) * 1e3).toFixed(4)} ms` : '—'}
        hint={v.guess ? 'Your guess is off by this much' : v.cb !== null ? `Fast by ${(v.cb / 1000).toFixed(1)} km of distance` : 'Needs 4 satellites'}
      />
      <Readout
        label="Misfit"
        value={has ? formatMetres(v.misfit, 2) : '—'}
        hint="How far the spheres miss the answer"
        tone={has && v.misfit > 20 ? 'warning' : 'default'}
      />
      {v.fault && <Readout label={`${v.fault.id ?? 'Faulty'}: extra range error`} value={formatMetres(v.fault.m)} hint="Growing clock fault" tone="alert" />}
      {v.spoof !== null && <Readout label="Fake position drift" value={formatDistance(v.spoof)} hint="Pulled towards the north-east" tone="warning" />}
      {v.js !== null && <Readout label="Jammer vs satellites" value={`+${Math.round(v.js)} dB`} hint={`${Math.round(10 ** (v.js / 10)).toLocaleString('en-US')} times stronger`} tone="alert" />}
    </ReadoutGrid>
  )
}
