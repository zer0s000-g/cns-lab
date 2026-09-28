import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowRight, RotateCcw } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ClockControls, ClockSpeedLabel, ControlSlider, SimLabel } from '@/components/sim/Controls'
import { ChapterHead } from '@/components/module/ModuleLayout'
import { Term } from '@/components/Term'
import { realToSignalUs, slowMotionFor } from '@/core/clock'
import { C_M_PER_NS } from '@/core/mlat'
import { METRES_PER_NM } from '@/core/units'
import { useClock, useSimulationLoop } from '@/hooks/useSimClock'
import { useSampled } from '@/hooks/useSampled'
import { Dial, HudButton, LeverSwitch, Segmented } from '@/hud/Controls'
import { HudPanel } from '@/hud/HudFrame'
import { TelemetryRow } from '@/hud/Telemetry'
import { BANDS_M, bandLabel, formatM } from './accuracy'
import { CloseUp } from './CloseUp'
import { CLOCK_RECEIVER, disagreementLimitM, FAILED_RECEIVER, mismatchThresholdM, SPOOFED_AIRCRAFT, statusText } from './engine'
import { NetworkMap } from './NetworkMap'
import { REPLAY_REAL_S, SignalView } from './SignalView'
import { useMlat, useMlatState } from './state'

/**
 * The Simulator chapter: a console laid over the 3D stage. Left, the receiver
 * network map; right, the control deck; below, the close-up and the arrival
 * times. The stage behind shows the receivers on the terrain and the curves.
 */
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
    <div className="flex flex-col gap-4">
      <div className="hud-panel rounded-md px-5 py-4 md:w-fit md:max-w-[520px]">
        <ChapterHead
          n={2}
          title="Simulator"
          lead="The table behind shows the receivers on the ground and the curves of equal time difference. Where the curves cross is the aircraft."
        />
      </div>
      <div className="grid gap-4 md:grid-cols-[minmax(0,420px)_1fr_minmax(0,340px)]">
        <div className="flex min-w-0 flex-col gap-4">
          <HudPanel index="NET" title="The receiver network" bodyClassName="p-3">
            <div className="relative">
              <NetworkMap />
              <div className="pointer-events-none absolute top-2 left-2 flex flex-wrap gap-1.5">
                {replay.phase === 'replay' ? <SimLabel>Time frozen while the signal travels</SimLabel> : <ClockSpeedLabel clock={clock} />}
              </div>
            </div>
            <p className="mt-2.5 mb-2 text-[11.5px] leading-5 text-muted-foreground">Drag receivers and aircraft.</p>
            <MapLegend />
          </HudPanel>
          <LiveReadouts />
        </div>
        <div aria-hidden className="hidden md:block" />
        <MlatControls />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <HudPanel index="ZOOM" title="Close-up around the aircraft" bodyClassName="p-3">
          <CloseUp />
          <p className="mt-2.5 text-[11.5px] leading-5 text-muted-foreground">
            Where the curves cross. The aircraft is always in the middle. Each curve is one pair of receivers. Blue dots are the last
            fixes; the dashed ellipse holds 95% of fixes when the only error is timing noise.
          </p>
        </HudPanel>
        <SignalView />
      </div>
    </div>
  )
}

/** A telemetry row with an optional plain-language note under it. */
function Row({ note, ...row }: Parameters<typeof TelemetryRow>[0] & { note?: ReactNode }) {
  return (
    <div className="flex flex-col">
      <TelemetryRow {...row} />
      {note && <p className="-mt-0.5 pb-1.5 text-[11px] leading-4 text-muted-foreground">{note}</p>}
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
  if (!r)
    return (
      <HudPanel index="TLM" title="MLAT telemetry" bodyClassName="px-4 py-2">
        <Row label="Waiting" value="—" note="The first signal arrives within a second" />
      </HudPanel>
    )
  const statusTone = r.status === 'ok' ? 'ok' : r.status === 'ambiguous' ? 'brass' : 'alert'
  return (
    <HudPanel index="TLM" title="MLAT telemetry" bodyClassName="px-4 py-2">
      <div className="flex flex-col divide-y divide-hud-line">
        <Row label={`${r.id}: receivers that heard it`} value={r.used} note={`Needs ${params.useAltitude ? 3 : 4} or more`} tone={r.used < (params.useAltitude ? 3 : 4) ? 'alert' : 'signal'} />
        <Row label="Position" value={statusText(r.status)} tone={statusTone} note={r.dims === 2 ? 'Across the ground, height from the altitude report' : 'Across the ground and height'} />
        <Row
          label="MLAT error right now"
          value={Number.isFinite(r.err) ? formatM(r.err) : '—'}
          tone={Number.isFinite(r.err) && Number.isFinite(r.expected) && r.err > 4 * r.expected + 20 ? 'brass' : 'default'}
          note="Distance from the real aircraft"
        />
        <Row
          label="Expected error here"
          value={Number.isFinite(r.expected) ? formatM(r.expected) : '—'}
          note={Number.isFinite(r.hdop) ? `Geometry factor ${r.hdop < 100 ? r.hdop.toFixed(1) : '> 100'} × ${rangeNoise.toFixed(1)} m` : 'Geometry gives no position'}
        />
        <Row
          label="Receivers disagree by"
          value={r.redundancy > 0 && Number.isFinite(r.resid) ? formatM(r.resid) : '—'}
          note={r.redundancy > 0 ? (r.resid > r.residLimit ? 'More than timing noise explains: one is wrong' : 'No more than timing noise explains') : 'No spare receiver to cross-check'}
          tone={r.redundancy > 0 && r.resid > r.residLimit ? 'brass' : 'default'}
        />
        {r.dims === 3 && <Row label="Height error" value={Number.isFinite(r.hErr) ? formatM(Math.abs(r.hErr)) : '—'} note="Ground receivers see height poorly" />}
        <Row
          label="ADS-B report vs MLAT"
          value={Number.isFinite(r.mismatch) ? (r.mismatch >= 1000 ? `${(r.mismatch / METRES_PER_NM).toFixed(1)} NM` : formatM(r.mismatch)) : '—'}
          tone={r.flag ? 'alert' : 'ok'}
          note={r.flag ? 'Report does not match: not validated' : 'Report confirmed by MLAT'}
        />
        {r.collinear && <Row label="Geometry" value="In a line" tone="brass" note="Mirror image fits too" />}
      </div>
    </HudPanel>
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
    <div className="flex min-w-0 flex-col gap-4">
      <HudPanel index="CLK" title="Time" bodyClassName="p-3">
        <ClockControls clock={clock} onReset={resetAll} />
        {!running && <p className="mt-2 text-xs text-muted-foreground">Paused. Press Play to let the aircraft fly.</p>}
      </HudPanel>

      <HudPanel index="RX" title="Receivers" bodyClassName="flex flex-col gap-3 px-4 py-3">
        <p className="text-[11.5px] leading-4 text-muted-foreground">Switch receivers on or off. Drag them on the map, or focus one and use the arrow keys.</p>
        <div>
          {receivers.map((r) => (
            <LeverSwitch
              key={r.id}
              label={`${r.id} ${r.name}`}
              tone="signal"
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
        </div>
        <Segmented
          label="Layout"
          value={env.badGeometry ? 'line' : 'spread'}
          onChange={(v) => setEnv('badGeometry', v === 'line')}
          options={[
            { value: 'spread', label: 'Spread around' },
            { value: 'line', label: 'All in a line' },
          ]}
        />
        <HudButton onClick={resetReceivers} className="self-start">
          <RotateCcw aria-hidden /> Put receivers back
        </HudButton>
      </HudPanel>

      <HudPanel index="SOL" title="How the position is worked out" bodyClassName="flex flex-col gap-4 p-4">
        <LeverSwitch
          label="Use the altitude the aircraft reports"
          hint={params.useAltitude ? 'Only the position across the ground is solved: 3 receivers are enough' : 'Height is solved too: needs 4 receivers, and height from the ground is poor'}
          tone="signal"
          checked={params.useAltitude}
          onChange={(v) => setParam('useAltitude', v)}
        />
        <div className="grid grid-cols-2 gap-x-2">
          <Dial
            label="Receiver timing noise"
            value={params.timingNoiseNs}
            min={1}
            max={50}
            step={1}
            onChange={(v) => setParam('timingNoiseNs', v)}
            format={(v) => `${v} ns ≈ ${(v * C_M_PER_NS).toFixed(1)} m`}
          />
          <Dial
            label={`Clock error at ${CLOCK_RECEIVER}`}
            value={params.clockErrorNs}
            min={-1000}
            max={1000}
            step={10}
            onChange={(v) => setParam('clockErrorNs', v)}
            format={(v) => `${v > 0 ? '+' : ''}${v} ns ≈ ${Math.round(Math.abs(v) * C_M_PER_NS)} m`}
          />
        </div>
        <p className="text-[11.5px] leading-4 text-muted-foreground">
          Timing noise: random error of each time stamp. Clock error: a <Term id="time-synchronisation">synchronisation</Term> fault at one receiver.
        </p>
      </HudPanel>

      <HudPanel index="MAP" title="Show on the map" bodyClassName="px-4 py-2">
        <LeverSwitch label="Accuracy map" tone="signal" checked={showHeatmap} onChange={setShowHeatmap} hint="For the selected aircraft's altitude" />
        <LeverSwitch label={<Term id="hyperbola">Curves (hyperbolas)</Term>} tone="signal" checked={showCurves} onChange={setShowCurves} hint="For the selected aircraft, on the map and on the table" />
      </HudPanel>

      <HudPanel index="ACF" title="Aircraft" bodyClassName="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="mlat-aircraft" className="hud-label">
            Follow
          </Label>
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
        <LeverSwitch
          label={`${SPOOFED_AIRCRAFT} sends a false ADS-B position`}
          hint={<Term id="adsb-spoofing">Spoofing</Term>}
          checked={env.spoof}
          onChange={(v) => setEnv('spoof', v)}
        />
        <p className="text-[12px] text-muted-foreground">
          MLAT also watches the airport surface.{' '}
          <Link to="/modules/surface" className="inline-flex items-center gap-0.5 text-signal hover:underline">
            See it in the surface movement module <ArrowRight className="size-3" aria-hidden />
          </Link>
        </p>
      </HudPanel>
    </div>
  )
}
