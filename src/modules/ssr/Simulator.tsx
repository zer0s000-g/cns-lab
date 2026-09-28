import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowRight } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ClockControls, ClockSpeedLabel, ControlSlider, SimLabel } from '@/components/sim/Controls'
import { ChapterHead } from '@/components/module/ModuleLayout'
import { Term } from '@/components/Term'
import { bearingDeg, normalize360 } from '@/core/geometry'
import { formatIcaoAddress, rangeFromReplyUs, replyArrivalUs, SSR_DOWNLINK_MHZ, SSR_UPLINK_MHZ } from '@/core/ssr'
import { useClock, useSimulationLoop } from '@/hooks/useSimClock'
import { useSampled } from '@/hooks/useSampled'
import { Dial, LeverSwitch, Segmented } from '@/hud/Controls'
import { HudPanel } from '@/hud/HudFrame'
import { TelemetryRow } from '@/hud/Telemetry'
import { RadarScope, type ScopeTrack } from '@/instruments'
import { trackEmphasis, trackLabel, type SsrEngine } from './engine'
import { PatternView } from './PatternView'
import { ReplyBuilder } from './ReplyBuilder'
import { advanceReplay, buildSsrReplay, SlowMotion } from './SlowMotion'
import { SsrTruthMap } from './TruthMap'
import { useSsr, useSsrState } from './state'

/**
 * The Simulator chapter: a console laid over the 3D stage. Left, the
 * controller's screen (or the truth map); right, the control deck; below, the
 * transponder, the antenna pattern and one interrogation in slow motion. The
 * stage behind shows what is really out there.
 */
export function SsrSimulator() {
  const { engine, clock, store, replayRef } = useSsr()

  useSimulationLoop(clock, (dt, realDt) => {
    const s = store.getState()
    engine.params = s.params
    engine.env = s.env
    engine.xpdr = s.xpdr
    if (s.replay.phase === 'replay') {
      if (clock.getState().running) {
        // The learner pressed Play: leave the frozen replay.
        replayRef.current = null
        s.setReplay({ phase: 'idle' })
      } else if (replayRef.current) {
        advanceReplay(replayRef.current, realDt)
        return
      }
    }
    if (s.replay.phase === 'armed' && s.replay.targetId) {
      const a = engine.getAircraft(s.replay.targetId)
      if (!a) s.setReplay({ phase: 'idle' })
      else if (dt > 0) {
        const az = bearingDeg(engine.site.pos, a.pos)
        if (engine.timeToAzimuth(az) <= dt) {
          engine.advanceToAzimuth(az)
          clock.getState().pause()
          replayRef.current = buildSsrReplay(engine, a.id, s.replay.ask)
          s.setReplay({ phase: 'replay' })
          return
        }
      }
    }
    engine.step(dt)
  })

  const range = useSsrState((s) => s.scopeRangeNm)
  const params = useSsrState((s) => s.params)
  const select = useSsrState((s) => s.select)
  const [view, setView] = useState<'scope' | 'map'>('scope')

  return (
    <div className="flex flex-col gap-4">
      <div className="hud-panel rounded-md px-5 py-4 md:w-fit md:max-w-[520px]">
        <ChapterHead
          n={2}
          title="Simulator"
          lead="The table behind is what is really out there. The screen shows what the radar hears back: who each aircraft is and how high it flies."
        />
      </div>
      <div className="grid gap-4 md:grid-cols-[minmax(0,420px)_1fr_minmax(0,340px)]">
        <div className="flex min-w-0 flex-col gap-4">
          <HudPanel
            index="SCR"
            title={view === 'scope' ? 'Radar screen' : 'Truth map'}
            actions={
              <Segmented
                value={view}
                onChange={setView}
                options={[
                  { value: 'scope', label: 'Screen' },
                  { value: 'map', label: 'Map' },
                ]}
                className="w-[140px]"
              />
            }
            bodyClassName="p-3"
          >
            <div className="relative">
              {view === 'scope' ? (
                <RadarScope
                  maxRangeNm={range}
                  persistenceS={params.rotationPeriodS * 0.9}
                  read={() => ({
                    nowS: engine.timeS,
                    sweepAzDeg: engine.antennaAz,
                    beamWidthDeg: engine.beamWidthDeg,
                    paints: engine.takePaints(),
                    tracks: scopeTracks(engine, store.getState().selectedId),
                  })}
                  describe={() => describeScope(engine)}
                  onTrackClick={(id) => {
                    const src = engine.tracks.get(id)?.plot.sourceId
                    if (src) select(src)
                  }}
                />
              ) : (
                <SsrTruthMap />
              )}
              <div className="pointer-events-none absolute top-2 left-2 flex flex-wrap gap-1.5">
                <ClockSpeedLabel clock={clock} />
                {view === 'scope' && (
                  <SimLabel icon="none">
                    {params.mode === 's' ? 'Mode S' : 'Mode A/C'} · turns every {params.rotationPeriodS.toFixed(1)} s
                  </SimLabel>
                )}
              </div>
            </div>
            <p className="mt-2.5 text-[11.5px] leading-5 text-muted-foreground">
              {view === 'scope' ? (
                <>
                  What the controller sees. {params.mode === 's' ? 'Labels: callsign, flight level. ' : 'Labels: code, flight level. '}
                  Square: secondary radar reply. Square with a dot: primary echo too. Dot alone: primary echo only, no label. Small arcs
                  are the raw <Term id="interrogation">replies</Term>.
                </>
              ) : (
                'What is really out there, with callsigns. Drag an aircraft to move it.'
              )}
            </p>
          </HudPanel>
          <LiveReadouts />
        </div>
        <div aria-hidden className="hidden md:block" />
        <SsrControls />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <ReplyBuilder />
        <PatternView />
      </div>
      <SlowMotion replayRef={replayRef} />
    </div>
  )
}

function scopeTracks(engine: SsrEngine, selectedId: string | null): ScopeTrack[] {
  const sel = engine.trackFor(selectedId)
  const out: ScopeTrack[] = []
  for (const tr of engine.tracks.values()) {
    const p = tr.plot
    const emphasis = trackEmphasis(p)
    out.push({
      id: tr.id,
      x: tr.pos.x,
      y: tr.pos.y,
      symbol: p.secondary ? (p.primary ? 'combined' : 'secondary') : 'primary',
      label: trackLabel(p),
      emphasis: tr === sel && emphasis === 'normal' ? 'selected' : emphasis,
      history: tr.history,
      leaderTo: tr.vel && p.secondary ? { x: tr.pos.x + tr.vel.x * 60, y: tr.pos.y + tr.vel.y * 60 } : undefined,
    })
  }
  return out
}

function describeScope(engine: SsrEngine): string {
  const tracks = [...engine.tracks.values()]
  const labelled = tracks.filter((t) => t.plot.secondary)
  const garbled = labelled.filter((t) => t.plot.garbled).length
  const primaryOnly = tracks.length - labelled.length
  return `Controller's screen, sweep at ${Math.round(engine.antennaAz)} degrees. ${labelled.length} labelled targets${garbled ? `, ${garbled} garbled` : ''}${primaryOnly ? `, ${primaryOnly} primary-only blips without labels` : ''}. Labels: ${labelled
    .slice(0, 8)
    .map((t) => trackLabel(t.plot).join(' '))
    .join('; ')}.`
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

function LiveReadouts() {
  const { engine } = useSsr()
  const params = useSsrState((s) => s.params)
  const selectedId = useSsrState((s) => s.selectedId)
  const sel = useSampled(() => {
    const a = engine.getAircraft(selectedId)
    if (!a) return null
    const g = engine.geometry(a.id)!
    const st = engine.lastPass.get(a.id)
    const tr = engine.trackFor(a.id)
    const x = engine.transponder(a.id)
    const t = replyArrivalUs(g.slant)
    return {
      id: a.callsign,
      address: formatIcaoAddress(a.address),
      replyUs: t,
      range: rangeFromReplyUs(t),
      replies: st?.replies ?? null,
      suppressed: st?.suppressed ?? null,
      garbled: st?.garbled ?? 0,
      sideLobe: st?.sideLobeReplies ?? 0,
      shownCode: tr ? (tr.plot.secondary ? (tr.plot.modeS?.callsign ?? tr.plot.code ?? '????') : 'no label') : null,
      shownAlt: tr?.plot.altFt ?? null,
      on: x.on,
      acquired: engine.isAcquired(a.id),
    }
  }, 250)
  return (
    <HudPanel index="TLM" title="Radar telemetry" bodyClassName="px-4 py-2">
      <div className="flex flex-col divide-y divide-hud-line">
        <Row label="Question (ground → air)" value={SSR_UPLINK_MHZ} unit="MHz" tone="signal" />
        <Row label="Answer (air → ground)" value={SSR_DOWNLINK_MHZ} unit="MHz" tone="brass" />
        <Row label="Update interval" value={params.rotationPeriodS.toFixed(1)} unit="s" note="One look per antenna turn" />
        <Row
          label={params.mode === 's' ? 'Interrogations' : 'Interrogations per second'}
          value={params.mode === 's' ? 'By address' : params.prfHz}
          note={params.mode === 's' ? 'One roll-call per aircraft per turn' : 'Alternating Mode A and Mode C'}
        />
        {sel && (
          <>
            <Row label={`${sel.id}: reply time`} value={sel.replyUs.toFixed(1)} unit="µs" tone="signal" note={`After P3. Range ${sel.range.toFixed(1)} NM`} />
            <Row
              label={`${sel.id}: replies last turn`}
              value={sel.replies ?? '—'}
              note={!sel.on ? 'Transponder off' : params.mode === 's' ? 'Asked by address only' : sel.sideLobe ? `${sel.sideLobe} through side lobes` : 'All in the main beam'}
              tone={sel.sideLobe ? 'brass' : 'default'}
            />
            {params.mode === 'ac' ? (
              <Row label={`${sel.id}: silenced by P2`} value={sel.suppressed ?? '—'} note="Side-lobe questions ignored last turn" />
            ) : (
              <Row label={`${sel.id}: Mode S address`} value={sel.address} note={sel.acquired ? 'Acquired: asked by name' : 'Not acquired yet'} />
            )}
            <Row
              label={`${sel.id}: on the screen`}
              value={sel.shownCode ?? '—'}
              note={
                sel.shownAlt != null
                  ? `Flight level ${String(Math.round(sel.shownAlt / 100)).padStart(3, '0')}`
                  : sel.garbled
                    ? `${sel.garbled} garbled replies`
                    : 'Waiting for the beam'
              }
              tone={sel.shownCode === '????' ? 'brass' : sel.shownCode === 'no label' ? 'muted' : 'ok'}
            />
          </>
        )}
      </div>
    </HudPanel>
  )
}

function SsrControls() {
  const { engine, clock } = useSsr()
  const params = useSsrState((s) => s.params)
  const env = useSsrState((s) => s.env)
  const range = useSsrState((s) => s.scopeRangeNm)
  const selectedId = useSsrState((s) => s.selectedId)
  const xpdr = useSsrState((s) => s.xpdr)
  const { setParam, setEnv, setScopeRange, select, setXpdr, resetAll } = useSsrState((s) => s)
  const running = useClock(clock, (s) => s.running)
  const ids = useSampled(() => engine.aircraft.map((a) => a.id).join(','), 300)
  const sel = useSampled(() => {
    const a = engine.getAircraft(selectedId)
    return a ? { heading: Math.round(a.mode.kind === 'heading' ? a.targetHeadingDeg : a.headingDeg), speed: Math.round(a.targetSpeedKt), alt: Math.round(a.targetAltitudeFt), mode: a.mode.kind, cat: a.category } : null
  }, 200)

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <HudPanel index="CLK" title="Time" bodyClassName="p-3">
        <ClockControls clock={clock} onReset={resetAll} />
        {!running && <p className="mt-2 text-xs text-muted-foreground">Paused. Press Play to let the aircraft fly and the antenna turn.</p>}
      </HudPanel>

      <HudPanel index="INT" title="Interrogator" bodyClassName="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-1.5">
          <Segmented
            label="How the radar asks"
            value={params.mode}
            onChange={(v) => setParam('mode', v)}
            options={[
              { value: 'ac', label: 'Mode A/C', ariaLabel: 'Mode A/C: everyone' },
              { value: 's', label: 'Mode S', ariaLabel: 'Mode S: by address' },
            ]}
          />
          <p className="text-[11.5px] leading-4 text-muted-foreground">
            {params.mode === 'ac' ? 'Everyone: every transponder in the beam answers each question.' : 'By address: each aircraft is called by its 24-bit address, one at a time.'}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-x-2 gap-y-4">
          <Dial
            label="Antenna turn time"
            value={params.rotationPeriodS}
            min={4}
            max={12}
            step={0.1}
            onChange={(v) => setParam('rotationPeriodS', v)}
            format={(v) => `${v.toFixed(1)} s`}
          />
          {params.mode === 'ac' ? (
            <Dial label="Interrogations per second" value={params.prfHz} min={100} max={450} step={10} onChange={(v) => setParam('prfHz', v)} format={(v) => `${v} /s`} />
          ) : (
            <div className="flex flex-col items-center justify-center gap-1.5 text-center">
              <span className="hud-label">Interrogations</span>
              <span className="hud-value text-[12px] text-foreground">By address</span>
              <span className="text-[11px] leading-4 text-muted-foreground">Mode S sends a question only when the beam reaches each aircraft.</span>
            </div>
          )}
        </div>
        <Segmented
          label="Screen range"
          value={String(range)}
          onChange={(v) => setScopeRange(Number(v))}
          options={[
            { value: '30', label: '30 NM' },
            { value: '60', label: '60 NM' },
            { value: '120', label: '120 NM' },
          ]}
        />
      </HudPanel>

      <HudPanel index="ENV" title="Out in the world" bodyClassName="px-4 py-2">
        <LeverSwitch label="Two aircraft close together" hint="CNS303 and CNS606 in trail, 1 NM apart" checked={env.garblePair} onChange={(v) => setEnv('garblePair', v)} />
        <LeverSwitch label={<Term id="fruit">Another radar nearby (FRUIT)</Term>} checked={env.fruit} onChange={(v) => setEnv('fruit', v)} />
        <LeverSwitch
          label={<Term id="defruiter">Defruiter</Term>}
          hint="Keeps replies that repeat at the same range"
          tone="signal"
          checked={env.defruiter}
          onChange={(v) => setEnv('defruiter', v)}
        />
        <LeverSwitch
          label={<Term id="side-lobe-suppression">Control antenna (P2)</Term>}
          hint="Off: side lobes are no longer suppressed"
          tone="signal"
          checked={!env.noP2}
          onChange={(v) => setEnv('noP2', !v)}
        />
      </HudPanel>

      <HudPanel index="ACF" title="Fly an aircraft" bodyClassName="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="ssr-aircraft" className="hud-label">
            Aircraft
          </Label>
          <Select value={selectedId ?? undefined} onValueChange={(v) => select(v)}>
            <SelectTrigger id="ssr-aircraft" className="w-full">
              <SelectValue placeholder="Choose an aircraft" />
            </SelectTrigger>
            <SelectContent>
              {ids.split(',').map((id) => (
                <SelectItem key={id} value={id}>
                  {id} · squawk {xpdr[id]?.squawk ?? '----'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {sel && selectedId && (
          <>
            <LeverSwitch
              label={<Term id="transponder">Transponder</Term>}
              hint={xpdr[selectedId]?.on === false ? 'Off: no replies, only the primary echo' : 'On: answers interrogations'}
              tone="signal"
              checked={xpdr[selectedId]?.on !== false}
              onChange={(v) => setXpdr(selectedId, { on: v })}
            />
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
              step={100}
              onChange={(v) => engine.setAircraft(selectedId, { targetAltitudeFt: v })}
              format={(v) => `${v.toLocaleString('en-US')} ft`}
              hint="Mode C reports pressure altitude in 100 ft steps"
            />
          </>
        )}
        <p className="text-[12px] text-muted-foreground">
          Secondary radar needs the aircraft to answer.{' '}
          <Link to="/modules/ads" className="inline-flex items-center gap-0.5 text-signal hover:underline">
            See how ADS-B lets the aircraft broadcast by itself <ArrowRight className="size-3" aria-hidden />
          </Link>
        </p>
      </HudPanel>
    </div>
  )
}
