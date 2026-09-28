import { Link } from 'react-router'
import { ArrowRight, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  ClockControls,
  ClockSpeedLabel,
  ControlChoice,
  ControlGroup,
  ControlSlider,
  ControlSwitch,
  ControlsPanel,
  Readout,
  ReadoutGrid,
  SimLabel,
} from '@/components/sim/Controls'
import { Term } from '@/components/Term'
import { realToSignalUs, slowMotionFor } from '@/core/clock'
import { C_M_PER_NS } from '@/core/mlat'
import { METRES_PER_NM } from '@/core/units'
import { useClock, useSimulationLoop } from '@/hooks/useSimClock'
import { useSampled } from '@/hooks/useSampled'
import { BANDS_M, bandLabel, formatM } from './accuracy'
import { CloseUp } from './CloseUp'
import { CLOCK_RECEIVER, disagreementLimitM, FAILED_RECEIVER, mismatchThresholdM, SPOOFED_AIRCRAFT, statusText } from './engine'
import { NetworkMap } from './NetworkMap'
import { REPLAY_REAL_S, SignalView } from './SignalView'
import { useMlat, useMlatState } from './state'

export function MlatSimulator() {
  const { engine, clock, store, replayRef } = useMlat()

  useSimulationLoop(clock, (dt, realDt) => {
    const s = store.getState()
    engine.env = s.env
    engine.params = s.params
    if (s.replay.phase !== 'replay' && replayRef.current) replayRef.current = null
    if (s.replay.phase === 'replay') {
      if (clock.getState().running) {
        // The learner pressed Play: leave the frozen replay and go back to live.
        replayRef.current = null
        s.setReplay({ phase: 'idle' })
      } else if (replayRef.current) {
        const rp = replayRef.current
        rp.tUs = Math.min(rp.totalUs, rp.tUs + realToSignalUs(realDt, slowMotionFor(rp.totalUs, REPLAY_REAL_S)))
        return
      }
    }
    engine.step(dt)
  })

  const replay = useMlatState((s) => s.replay)

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="grid gap-4 md:grid-cols-2">
          <figure className="flex min-w-0 flex-col gap-2">
            <figcaption className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold">The receiver network</span>
              <span className="text-xs text-muted-foreground">Drag receivers and aircraft</span>
            </figcaption>
            <div className="relative">
              <NetworkMap />
              <div className="pointer-events-none absolute top-2 left-2 flex flex-wrap gap-1.5">
                {replay.phase === 'replay' ? <SimLabel>Time frozen while the signal travels</SimLabel> : <ClockSpeedLabel clock={clock} />}
              </div>
            </div>
            <MapLegend />
          </figure>
          <figure className="flex min-w-0 flex-col gap-2">
            <figcaption className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold">Close-up around the aircraft</span>
              <span className="text-xs text-muted-foreground">Where the curves cross</span>
            </figcaption>
            <CloseUp />
            <p className="text-xs text-muted-foreground">
              The aircraft is always in the middle. Each curve is one pair of receivers. Blue dots are the last fixes; the dashed
              ellipse holds 95% of fixes when the only error is timing noise.
            </p>
          </figure>
        </div>
        <SignalView />
        <LiveReadouts />
      </div>
      <MlatControls />
    </div>
  )
}

/** Swatch drawn with the same opacity the accuracy map uses. */
function Swatch({ alpha }: { alpha: number }) {
  return (
    <span className="relative inline-block size-3 overflow-hidden rounded-sm border border-sim-grid-strong bg-sim-bg" aria-hidden>
      <span className="absolute inset-0 bg-sim-signal" style={{ opacity: alpha }} />
    </span>
  )
}

function MapLegend() {
  const alphas = [0.4, 0.3, 0.2, 0.12, 0.06, 0]
  return (
    <div className="flex flex-col gap-2 text-xs text-muted-foreground">
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        <li className="flex items-center gap-1.5">
          <svg viewBox="0 0 14 14" className="size-3.5" aria-hidden>
            <path d="M7 2 L12.5 12 L1.5 12 Z" className="fill-none stroke-sim-signal" strokeWidth="1.6" />
          </svg>
          MLAT position
        </li>
        <li className="flex items-center gap-1.5">
          <svg viewBox="0 0 14 14" className="size-3.5" aria-hidden>
            <path d="M7 1.5 L12.5 7 L7 12.5 L1.5 7 Z" className="fill-none stroke-sim-ink" strokeWidth="1.6" />
          </svg>
          <Term id="ads-b">ADS-B</Term> report
        </li>
        <li className="flex items-center gap-1.5">
          <svg viewBox="0 0 14 14" className="size-3.5" aria-hidden>
            <path d="M7 1.5 L13 12 L1 12 Z" className="fill-sim-bg stroke-sim-signal" strokeWidth="1.8" />
          </svg>
          Receiver
        </li>
        <li className="flex items-center gap-1.5">
          <svg viewBox="0 0 22 8" className="h-2 w-5" aria-hidden>
            <path d="M1 4 H21" className="stroke-sim-signal-2" strokeWidth="1.6" />
          </svg>
          Curve of one time difference
        </li>
        <li className="flex items-center gap-1.5">
          <svg viewBox="0 0 22 8" className="h-2 w-5" aria-hidden>
            <path d="M1 4 H21" className="stroke-sim-signal-2" strokeWidth="1.8" strokeDasharray="5 3" />
          </svg>
          Curve using a receiver with a clock error
        </li>
        <li className="flex items-center gap-1.5">
          <svg viewBox="0 0 22 10" className="h-2.5 w-5" aria-hidden>
            <rect x="1" y="1" width="20" height="8" className="fill-sim-warning stroke-sim-warning" fillOpacity="0.25" strokeWidth="1.4" strokeDasharray="4 3" />
          </svg>
          Amber: two positions fit
        </li>
      </ul>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium text-foreground">Expected accuracy:</span>
        {alphas.map((a, b) => (
          <span key={b} className="inline-flex items-center gap-1">
            <Swatch alpha={a} />
            {bandLabel(b)}
          </span>
        ))}
      </div>
      <p className="sr-only">Band edges: {BANDS_M.map((m) => formatM(m)).join(', ')}.</p>
    </div>
  )
}

function LiveReadouts() {
  const { engine } = useMlat()
  const selectedId = useMlatState((s) => s.selectedId)
  const params = useMlatState((s) => s.params)
  const r = useSampled(() => {
    const f = selectedId ? engine.fixes.get(selectedId) : undefined
    const a = engine.getAircraft(selectedId)
    if (!f || !a) return null
    return {
      id: a.callsign,
      used: f.stamps.length,
      status: f.solution.status,
      dims: f.solution.dims,
      err: f.errorM,
      hErr: f.heightErrorM,
      expected: f.expectedErrorM,
      hdop: f.dop?.hdop ?? NaN,
      resid: f.solution.residualRmsM,
      redundancy: f.solution.redundancy,
      residLimit: disagreementLimitM(engine.params.timingNoiseNs, f.solution.redundancy, f.stamps.length),
      mismatch: f.adsbMismatchM,
      flag: f.adsbMismatchM > mismatchThresholdM(f.expectedErrorM),
      collinear: engine.collinear,
    }
  }, 300)
  const rangeNoise = C_M_PER_NS * params.timingNoiseNs
  if (!r) return <ReadoutGrid><Readout label="Waiting" value="—" hint="The first signal arrives within a second" /></ReadoutGrid>
  const statusTone = r.status === 'ok' ? 'ok' : r.status === 'ambiguous' ? 'warning' : 'alert'
  return (
    <ReadoutGrid>
      <Readout label={`${r.id}: receivers that heard it`} value={r.used} hint={`Needs ${params.useAltitude ? 3 : 4} or more`} tone={r.used < (params.useAltitude ? 3 : 4) ? 'alert' : 'default'} />
      <Readout label="Position" value={statusText(r.status)} tone={statusTone} hint={r.dims === 2 ? 'Across the ground, height from the altitude report' : 'Across the ground and height'} />
      <Readout label="MLAT error right now" value={Number.isFinite(r.err) ? formatM(r.err) : '—'} tone={Number.isFinite(r.err) && Number.isFinite(r.expected) && r.err > 4 * r.expected + 20 ? 'warning' : 'default'} hint="Distance from the real aircraft" />
      <Readout label="Expected error here" value={Number.isFinite(r.expected) ? formatM(r.expected) : '—'} hint={Number.isFinite(r.hdop) ? `Geometry factor ${r.hdop < 100 ? r.hdop.toFixed(1) : '> 100'} × ${rangeNoise.toFixed(1)} m` : 'Geometry gives no position'} />
      <Readout
        label="Receivers disagree by"
        value={r.redundancy > 0 && Number.isFinite(r.resid) ? formatM(r.resid) : '—'}
        hint={r.redundancy > 0 ? (r.resid > r.residLimit ? 'More than timing noise explains: one is wrong' : 'No more than timing noise explains') : 'No spare receiver to cross-check'}
        tone={r.redundancy > 0 && r.resid > r.residLimit ? 'warning' : 'default'}
      />
      {r.dims === 3 && <Readout label="Height error" value={Number.isFinite(r.hErr) ? formatM(Math.abs(r.hErr)) : '—'} hint="Ground receivers see height poorly" />}
      <Readout
        label="ADS-B report vs MLAT"
        value={Number.isFinite(r.mismatch) ? (r.mismatch >= 1000 ? `${(r.mismatch / METRES_PER_NM).toFixed(1)} NM` : formatM(r.mismatch)) : '—'}
        tone={r.flag ? 'alert' : 'ok'}
        hint={r.flag ? 'Report does not match: not validated' : 'Report confirmed by MLAT'}
      />
      {r.collinear && <Readout label="Geometry" value="In a line" tone="warning" hint="Mirror image fits too" />}
    </ReadoutGrid>
  )
}

function MlatControls() {
  const { engine, clock } = useMlat()
  const receivers = useMlatState((s) => s.receivers)
  const env = useMlatState((s) => s.env)
  const params = useMlatState((s) => s.params)
  const selectedId = useMlatState((s) => s.selectedId)
  const showHeatmap = useMlatState((s) => s.showHeatmap)
  const showCurves = useMlatState((s) => s.showCurves)
  const { setEnv, setParam, setReceiverInUse, resetReceivers, select, setShowHeatmap, setShowCurves, resetAll } = useMlatState((s) => s)
  const running = useClock(clock, (s) => s.running)
  const sel = useSampled(() => {
    const a = engine.getAircraft(selectedId)
    return a ? { alt: Math.round(a.targetAltitudeFt) } : null
  }, 250)

  return (
    <ControlsPanel className="h-fit xl:sticky xl:top-20">
      <ControlGroup title="Time">
        <ClockControls clock={clock} onReset={resetAll} />
        {!running && <p className="text-xs text-muted-foreground">Paused. Press Play to let the aircraft fly.</p>}
      </ControlGroup>

      <ControlGroup title="Receivers" description="Switch receivers on or off. Drag them on the map, or focus one and use the arrow keys.">
        {receivers.map((r) => (
          <ControlSwitch
            key={r.id}
            label={`${r.id} ${r.name}`}
            checked={r.inUse}
            onChange={(v) => setReceiverInUse(r.id, v)}
            hint={
              env.receiverFailed && r.id === FAILED_RECEIVER
                ? 'Failed: sends no time stamps'
                : r.id === CLOCK_RECEIVER && params.clockErrorNs !== 0
                  ? `Clock is off by ${params.clockErrorNs} ns`
                  : r.id === 'R6' && !r.inUse
                    ? 'Spare: switch on to add it'
                    : undefined
            }
          />
        ))}
        <ControlChoice
          label="Layout"
          value={env.badGeometry ? 'line' : 'spread'}
          onChange={(v) => setEnv('badGeometry', v === 'line')}
          options={[
            { value: 'spread', label: 'Spread around' },
            { value: 'line', label: 'All in a line' },
          ]}
        />
        <Button variant="outline" size="sm" onClick={resetReceivers} className="self-start">
          <RotateCcw aria-hidden /> Put receivers back
        </Button>
      </ControlGroup>

      <ControlGroup title="How the position is worked out">
        <ControlSwitch
          label="Use the altitude the aircraft reports"
          hint={params.useAltitude ? 'Only the position across the ground is solved: 3 receivers are enough' : 'Height is solved too: needs 4 receivers, and height from the ground is poor'}
          checked={params.useAltitude}
          onChange={(v) => setParam('useAltitude', v)}
        />
        <ControlSlider
          label="Receiver timing noise"
          value={params.timingNoiseNs}
          min={1}
          max={50}
          step={1}
          onChange={(v) => setParam('timingNoiseNs', v)}
          format={(v) => `${v} ns ≈ ${(v * C_M_PER_NS).toFixed(1)} m`}
          hint="Random error of each time stamp"
        />
        <ControlSlider
          label={`Clock error at ${CLOCK_RECEIVER}`}
          value={params.clockErrorNs}
          min={-1000}
          max={1000}
          step={10}
          onChange={(v) => setParam('clockErrorNs', v)}
          format={(v) => `${v > 0 ? '+' : ''}${v} ns ≈ ${Math.round(Math.abs(v) * C_M_PER_NS)} m`}
          hint={<><Term id="time-synchronisation">Synchronisation</Term> fault at one receiver</>}
        />
      </ControlGroup>

      <ControlGroup title="Show on the map">
        <ControlSwitch label="Accuracy map" checked={showHeatmap} onChange={setShowHeatmap} hint="For the selected aircraft's altitude" />
        <ControlSwitch label={<Term id="hyperbola">Curves (hyperbolas)</Term>} checked={showCurves} onChange={setShowCurves} hint="For the selected aircraft" />
      </ControlGroup>

      <ControlGroup title="Aircraft">
        <div className="flex flex-col gap-2">
          <Label htmlFor="mlat-aircraft">Follow</Label>
          <Select value={selectedId ?? undefined} onValueChange={(v) => select(v)}>
            <SelectTrigger id="mlat-aircraft" className="w-full">
              <SelectValue placeholder="Choose an aircraft" />
            </SelectTrigger>
            <SelectContent>
              {engine.aircraft.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.callsign} · {a.category}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {sel && selectedId && (
          <ControlSlider
            label="Altitude"
            value={sel.alt}
            min={1000}
            max={40000}
            step={500}
            onChange={(v) => engine.setAircraft(selectedId, { targetAltitudeFt: v })}
            format={(v) => `${v.toLocaleString('en-US')} ft`}
          />
        )}
        <ControlSwitch
          label={`${SPOOFED_AIRCRAFT} sends a false ADS-B position`}
          hint={<Term id="adsb-spoofing">Spoofing</Term>}
          checked={env.spoof}
          onChange={(v) => setEnv('spoof', v)}
        />
      </ControlGroup>

      <p className="text-xs text-muted-foreground">
        MLAT also watches the airport surface.{' '}
        <Link to="/modules/surface" className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline">
          See it in the surface movement module <ArrowRight className="size-3" aria-hidden />
        </Link>
      </p>
    </ControlsPanel>
  )
}
