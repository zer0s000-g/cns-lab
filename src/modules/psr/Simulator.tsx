import { useRef } from 'react'
import { Link } from 'react-router'
import { ArrowRight } from 'lucide-react'
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
import { bearingDeg, normalize360 } from '@/core/geometry'
import { realToSignalUs, slowMotionFor } from '@/core/clock'
import { roundTripTimeUs } from '@/core/propagation'
import { azimuthResolutionNm, hitsPerScan, maxDetectionRangeNm, maxUnambiguousRangeNm, RCS_M2 } from '@/core/radar'
import { useClock, useSimulationLoop } from '@/hooks/useSimClock'
import { useSampled } from '@/hooks/useSampled'
import { RadarScope } from '@/instruments'
import { Antenna3D } from './Antenna3D'
import { PulseView, REPLAY_REAL_S, buildReplay, type Replay } from './PulseView'
import { REASON_TEXT, TruthMap } from './TruthMap'
import { usePsr, usePsrState } from './state'

export function formatPower(kw: number) {
  return kw >= 1000 ? `${(kw / 1000).toFixed(kw >= 10000 ? 0 : 1)} MW` : `${kw >= 100 ? Math.round(kw) : kw.toFixed(kw < 10 ? 1 : 0)} kW`
}

export function PsrSimulator() {
  const { engine, clock, store } = usePsr()
  const replayRef = useRef<Replay | null>(null)

  useSimulationLoop(clock, (dt, realDt) => {
    const s = store.getState()
    engine.params = s.params
    engine.env = s.env
    if (s.pulse.phase === 'replay') {
      if (clock.getState().running) {
        // The learner pressed Play: leave the frozen replay and go back to live.
        replayRef.current = null
        s.setPulse({ phase: 'idle' })
      } else if (replayRef.current) {
        const rp = replayRef.current
        rp.tUs = Math.min(rp.totalUs, rp.tUs + realToSignalUs(realDt, slowMotionFor(rp.totalUs, REPLAY_REAL_S)))
        return
      }
    }
    if (s.pulse.phase === 'armed' && s.pulse.targetId) {
      const a = engine.getAircraft(s.pulse.targetId)
      if (!a) {
        s.setPulse({ phase: 'idle' })
      } else if (dt > 0) {
        const az = bearingDeg(engine.site.pos, a.pos)
        if (engine.timeToAzimuth(az) <= dt) {
          engine.advanceToAzimuth(az)
          clock.getState().pause()
          replayRef.current = buildReplay(engine, s.scopeRangeNm, a.id)
          s.setPulse({ ...s.pulse, phase: 'replay', azDeg: az })
          return
        }
      }
    }
    engine.step(dt)
  })

  const range = usePsrState((s) => s.scopeRangeNm)
  const params = usePsrState((s) => s.params)

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="grid gap-4 md:grid-cols-2">
          <figure className="flex min-w-0 flex-col gap-2">
            <figcaption className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold">What is really out there</span>
              <span className="text-xs text-muted-foreground">Drag an aircraft to move it</span>
            </figcaption>
            <div className="relative">
              <TruthMap />
              <div className="pointer-events-none absolute top-2 left-2 flex flex-wrap gap-1.5">
                <ClockSpeedLabel clock={clock} />
              </div>
            </div>
          </figure>
          <figure className="flex min-w-0 flex-col gap-2">
            <figcaption className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold">What the radar screen shows</span>
              <span className="text-xs text-muted-foreground">Echoes only: no names, no heights</span>
            </figcaption>
            <div className="relative">
              <RadarScope
                maxRangeNm={range}
                persistenceS={params.rotationPeriodS * 0.9}
                read={() => ({ nowS: engine.timeS, sweepAzDeg: engine.antennaAz, beamWidthDeg: engine.params.beamWidthDeg, paints: engine.takePaints() })}
                describe={() => describeScope(engine)}
              />
              <div className="pointer-events-none absolute top-2 left-2">
                <SimLabel icon="none">Antenna turns every {params.rotationPeriodS.toFixed(1)} s</SimLabel>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Bright arcs are echoes. Each arc is as wide as the <Term id="beam-width">beam</Term>. Grey speckle is{' '}
              <Term id="clutter">clutter</Term>, pale patches are rain.
            </p>
          </figure>
        </div>
        <PulseView replayRef={replayRef} />
        <LiveReadouts />
      </div>
      <PsrControls />
    </div>
  )
}

function describeScope(engine: ReturnType<typeof usePsr>['engine']) {
  const seen = engine.aircraft.filter((a) => engine.lastLook.get(a.id)?.detected).length
  return `Radar screen: sweep at ${Math.round(engine.antennaAz)} degrees. On the last turn the radar painted ${seen} of ${engine.aircraft.length} aircraft. Primary radar shows only echoes, without names or heights.`
}

function LiveReadouts() {
  const { engine } = usePsr()
  const params = usePsrState((s) => s.params)
  const selectedId = usePsrState((s) => s.selectedId)
  const sel = useSampled(() => {
    const a = engine.getAircraft(selectedId)
    const look = a ? engine.lastLook.get(a.id) : undefined
    return a && look
      ? {
          id: a.callsign,
          range: look.trueRangeNm,
          shown: look.apparentRangeNm,
          trace: look.trace,
          echoUs: roundTripTimeUs(look.trueRangeNm),
          reason: look.reason,
          detected: look.detected,
        }
      : a
        ? { id: a.callsign, range: NaN, shown: NaN, trace: 1, echoUs: NaN, reason: 'ok' as const, detected: false }
        : null
  }, 250)
  const ru = maxUnambiguousRangeNm(params.prfHz)
  return (
    <ReadoutGrid>
      <Readout label="Update interval" value={params.rotationPeriodS.toFixed(1)} unit="s" hint="One look per antenna turn" />
      <Readout label="Max unambiguous range" value={ru.toFixed(0)} unit="NM" hint="Set by the pulse rate" tone={ru < 60 ? 'warning' : 'default'} />
      <Readout label="Medium aircraft seen to" value={maxDetectionRangeNm(params, RCS_M2.medium).toFixed(0)} unit="NM" hint="90% of turns" />
      <Readout label="Small aircraft seen to" value={maxDetectionRangeNm(params, RCS_M2.light).toFixed(0)} unit="NM" hint="90% of turns" />
      <Readout label="Pulses hitting each aircraft" value={hitsPerScan(params).toFixed(0)} unit="per turn" />
      <Readout label="Beam width at 30 NM" value={azimuthResolutionNm(30, params.beamWidthDeg).toFixed(2)} unit="NM" hint="Closer aircraft merge" />
      {sel && (
        <>
          <Readout
            label={`${sel.id}: echo time`}
            value={Number.isFinite(sel.echoUs) ? sel.echoUs.toFixed(0) : '—'}
            unit="µs"
            hint={Number.isFinite(sel.range) ? `True distance ${sel.range.toFixed(1)} NM` : 'Waiting for the beam'}
          />
          <Readout
            label={`${sel.id}: on the screen`}
            value={sel.detected ? (sel.trace > 1 ? `${sel.shown.toFixed(1)} NM` : 'Seen') : Number.isFinite(sel.range) ? 'Not seen' : '—'}
            tone={sel.detected ? (sel.trace > 1 ? 'warning' : 'ok') : 'muted'}
            hint={sel.detected ? (sel.trace > 1 ? 'Wrong range: second-trace echo' : 'Blip painted this turn') : REASON_TEXT[sel.reason]}
          />
        </>
      )}
    </ReadoutGrid>
  )
}

function PsrControls() {
  const { engine, clock } = usePsr()
  const params = usePsrState((s) => s.params)
  const env = usePsrState((s) => s.env)
  const range = usePsrState((s) => s.scopeRangeNm)
  const selectedId = usePsrState((s) => s.selectedId)
  const showCoverage = usePsrState((s) => s.showCoverage)
  const { setParam, setEnv, setScopeRange, select, setShowCoverage, resetAll } = usePsrState((s) => s)
  const running = useClock(clock, (s) => s.running)
  const sel = useSampled(() => {
    const a = engine.getAircraft(selectedId)
    return a ? { heading: Math.round(a.mode.kind === 'heading' ? a.targetHeadingDeg : a.headingDeg), speed: Math.round(a.targetSpeedKt), alt: Math.round(a.targetAltitudeFt), mode: a.mode.kind } : null
  }, 200)

  return (
    <ControlsPanel className="h-fit xl:sticky xl:top-20">
      <ControlGroup title="Time">
        <ClockControls clock={clock} onReset={resetAll} />
        {!running && <p className="text-xs text-muted-foreground">Paused. Press Play to let the aircraft fly and the antenna turn.</p>}
      </ControlGroup>

      <ControlGroup title="The antenna">
        <Antenna3D className="h-40" />
      </ControlGroup>

      <ControlGroup title="Radar settings">
        <ControlSlider
          label="Antenna turn time (update interval)"
          value={params.rotationPeriodS}
          min={2}
          max={15}
          step={0.1}
          onChange={(v) => setParam('rotationPeriodS', v)}
          format={(v) => `${v.toFixed(1)} s`}
        />
        <ControlSlider
          label={<Term id="prf">Pulse rate (PRF)</Term>}
          value={params.prfHz}
          min={250}
          max={4000}
          step={50}
          onChange={(v) => setParam('prfHz', v)}
          format={(v) => `${v} per second`}
        />
        <ControlSlider
          label={<Term id="beam-width">Beam width</Term>}
          value={params.beamWidthDeg}
          min={0.5}
          max={5}
          step={0.1}
          onChange={(v) => setParam('beamWidthDeg', v)}
          format={(v) => `${v.toFixed(1)}°`}
        />
        <ControlSlider
          label="Transmitter power"
          value={Math.log10(params.peakPowerKw)}
          min={Math.log10(5)}
          max={3}
          step={0.01}
          onChange={(v) => setParam('peakPowerKw', Math.round(10 ** v * 10) / 10)}
          format={(v) => formatPower(10 ** v)}
        />
        <ControlChoice
          label="Screen range"
          value={String(range)}
          onChange={(v) => setScopeRange(Number(v))}
          options={[
            { value: '30', label: '30 NM' },
            { value: '60', label: '60 NM' },
            { value: '120', label: '120 NM' },
          ]}
        />
      </ControlGroup>

      <ControlGroup title="Out in the world">
        <ControlSwitch label="Ground clutter" checked={env.groundClutter} onChange={(v) => setEnv('groundClutter', v)} />
        <ControlSwitch label="Rain shower" checked={env.rain} onChange={(v) => setEnv('rain', v)} />
        <ControlSwitch label="Flock of birds" checked={env.birds} onChange={(v) => setEnv('birds', v)} />
        <ControlSwitch label="Wind farm" checked={env.windFarm} onChange={(v) => setEnv('windFarm', v)} />
        <ControlSwitch label="Small aircraft far away" checked={env.smallFar} onChange={(v) => setEnv('smallFar', v)} />
        <ControlSwitch
          label={<Term id="mti">MTI filter</Term>}
          hint="Hides echoes that are not moving"
          checked={env.mti}
          onChange={(v) => setEnv('mti', v)}
        />
      </ControlGroup>

      <ControlGroup title="Fly an aircraft">
        <div className="flex flex-col gap-2">
          <Label htmlFor="psr-aircraft">Aircraft</Label>
          <Select value={selectedId ?? undefined} onValueChange={(v) => select(v)}>
            <SelectTrigger id="psr-aircraft" className="w-full">
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
          <>
            <ControlSlider
              label="Heading"
              value={sel.heading}
              min={0}
              max={359}
              onChange={(v) => engine.setAircraft(selectedId, { mode: { kind: 'heading' }, targetHeadingDeg: normalize360(v) })}
              format={(v) => `${String(v).padStart(3, '0')}°`}
              hint={sel.mode === 'route' ? 'Following its route. Move this to take control.' : undefined}
            />
            <ControlSlider label="Speed" value={sel.speed} min={60} max={500} step={5} onChange={(v) => engine.setAircraft(selectedId, { targetSpeedKt: v })} format={(v) => `${v} kt`} />
            <ControlSlider
              label="Altitude"
              value={sel.alt}
              min={500}
              max={41000}
              step={500}
              onChange={(v) => engine.setAircraft(selectedId, { targetAltitudeFt: v })}
              format={(v) => `${v.toLocaleString('en-US')} ft`}
            />
            <ControlSwitch
              label="Show where the radar cannot see at this altitude"
              checked={showCoverage}
              onChange={setShowCoverage}
              hint="Shaded areas are hidden by hills or the curve of the Earth"
            />
          </>
        )}
      </ControlGroup>

      <p className="text-xs text-muted-foreground">
        Primary radar cannot tell you who an aircraft is or how high it flies.{' '}
        <Link to="/modules/ssr" className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline">
          See how secondary radar fixes that <ArrowRight className="size-3" aria-hidden />
        </Link>
      </p>
    </ControlsPanel>
  )
}
