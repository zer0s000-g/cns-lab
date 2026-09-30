import { useState, type ReactNode } from 'react'
import { wholeDegrees } from '@/lib/format'
import { Link } from 'react-router'
import { ArrowRight, Radio, RotateCcw, Send } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ClockControls, ClockSpeedLabel, ControlSlider, SimLabel } from '@/components/sim/Controls'
import { ChapterHead } from '@/components/module/ModuleLayout'
import { Term } from '@/components/Term'
import { ADSC_EVENT_TEXT, ADSC_PERIODIC_MIN } from '@/core/ads'
import { distanceNm, normalize360 } from '@/core/geometry'
import { useClock, useSimulationLoop } from '@/hooks/useSimClock'
import { useSampled } from '@/hooks/useSampled'
import { Dial, HudButton, LeverSwitch, Segmented } from '@/hud/Controls'
import { HudPanel } from '@/hud/HudFrame'
import { TelemetryRow } from '@/hud/Telemetry'
import { AdsMap } from './AdsMap'
import { AtcScreen } from './AtcScreen'
import { CockpitTraffic } from './CockpitTraffic'
import { CompareView } from './CompareView'
import { trackState } from './engine'
import { MessagePanel } from './MessagePanel'
import { OceanMap } from './OceanMap'
import { CLEARED_FL, OFFSET_NM, utc, type AdscReport } from './oceanEngine'
import { useAds, useAdsState, type Scenario } from './state'

/**
 * The Simulator chapter: a console laid over the 3D stage. The scenario
 * switch changes both the console and the diorama behind it (the airport
 * table for ADS-B, the ocean table for ADS-C).
 */
export function AdsSimulator() {
  const { engine, ocean, clock, oceanClock, store } = useAds()
  const scenario = useAdsState((s) => s.scenario)
  const setScenario = useAdsState((s) => s.setScenario)

  useSimulationLoop(
    clock,
    (dt) => {
      const s = store.getState()
      engine.env = s.env
      engine.radarPeriodS = s.radarPeriodS
      engine.ownId = s.adsbIn ? s.selectedId : null
      engine.step(dt)
    },
    scenario === 'airport',
  )
  useSimulationLoop(
    oceanClock,
    (dt) => {
      const s = store.getState()
      ocean.opts = { ...ocean.opts, contract: s.contract, spaceAdsb: s.spaceAdsb }
      ocean.step(dt)
    },
    scenario === 'ocean',
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="hud-panel rounded-md px-5 py-4 md:w-fit md:max-w-[560px]">
        <ChapterHead
          n={2}
          title="Simulator"
          lead={
            scenario === 'airport'
              ? 'The table behind is what is really out there. Each aircraft broadcasts its own GNSS position; the lines show which ground receivers heard it.'
              : 'Over the ocean there are no receivers. The table behind shows the crossing, and the reports travelling through the satellite to the oceanic centre.'
          }
        />
        <Segmented
          label="Scenario"
          value={scenario}
          onChange={(v) => setScenario(v as Scenario)}
          options={[
            { value: 'airport', label: 'Near the airport: ADS-B' },
            { value: 'ocean', label: 'Over the ocean: ADS-C' },
          ]}
        />
      </div>
      {scenario === 'airport' ? <AirportScenario /> : <OceanScenario />}
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

// ---------------------------------------------------------------------------
// Airport (ADS-B)
// ---------------------------------------------------------------------------

function AirportScenario() {
  const { clock } = useAds()
  const [view, setView] = useState<'screen' | 'map'>('screen')
  return (
    <>
      <div className="grid gap-4 md:grid-cols-[minmax(0,420px)_1fr_minmax(0,340px)]">
        <div className="flex min-w-0 flex-col gap-4">
          <HudPanel
            index="ATC"
            title={view === 'screen' ? 'ATC screen' : 'Truth map'}
            actions={
              <Segmented
                value={view}
                onChange={setView}
                options={[
                  { value: 'screen', label: 'Screen' },
                  { value: 'map', label: 'Map' },
                ]}
                className="w-[140px]"
              />
            }
            bodyClassName="p-3"
          >
            {view === 'screen' ? (
              <>
                <AtcScreen />
                <p className="mt-2.5 text-[11.5px] leading-5 text-muted-foreground">
                  What the controller sees. Diamond: ADS-B · square: radar. Diamonds are <Term id="ads-b">ADS-B</Term> positions, updated about twice
                  a second. Squares are radar plots, updated once per antenna turn; they get a label only when there is no ADS-B for that aircraft.
                </p>
              </>
            ) : (
              <>
                <div className="relative">
                  <AdsMap />
                  <div className="pointer-events-none absolute top-2 left-2 flex max-w-[calc(100%-3rem)] flex-wrap gap-1.5">
                    <ClockSpeedLabel clock={clock} />
                    <SimLabel>Broadcast rings slowed down so you can see them</SimLabel>
                  </div>
                </div>
                <p className="mt-2.5 text-[11.5px] leading-5 text-muted-foreground">What is really out there. Drag an aircraft to move it.</p>
              </>
            )}
          </HudPanel>
          <AirportReadouts />
        </div>
        <div aria-hidden className="hidden md:block" />
        <AirportControls />
      </div>
      <CompareView />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <MessagePanel />
        <CockpitTraffic />
      </div>
    </>
  )
}

function AirportReadouts() {
  const { engine } = useAds()
  const selectedId = useAdsState((s) => s.selectedId)
  const r = useSampled(() => {
    const tracks = [...engine.atc.tracks.values()].filter((t) => t.pos && trackState(t, engine.timeS) !== 'no-position')
    const a = engine.getAircraft(selectedId)
    return {
      adsb: tracks.length,
      radar: engine.radarPlots.size,
      sel: a ? { id: a.callsign, nacp: a.gnss.lost ? 0 : a.gnss.nacp, nic: a.gnss.lost ? 0 : a.gnss.nic, lost: a.gnss.lost, out: engine.hasAdsbOut(a.id) } : null,
    }
  }, 300)
  return (
    <HudPanel index="TLM" title="Surveillance telemetry" bodyClassName="px-4 py-2">
      <div className="flex flex-col divide-y divide-hud-line">
        <Row label="Broadcast frequency" value="1090" unit="MHz" tone="signal" note="Extended squitter (DF17)" />
        <Row label="Aircraft on ADS-B" value={r.adsb} note="Tracks with a fresh position" />
        <Row label="Aircraft on radar" value={r.radar} note="Seen on the last antenna turn" />
        {r.sel && (
          <Row
            label={`${r.sel.id}: GNSS`}
            value={!r.sel.out ? 'No ADS-B' : r.sel.lost ? 'Lost' : `NACp ${r.sel.nacp}`}
            tone={!r.sel.out || r.sel.lost ? 'alert' : r.sel.nacp < 8 ? 'brass' : 'ok'}
            note={r.sel.out ? `NIC ${r.sel.nic}` : 'Invisible to ADS-B receivers'}
          />
        )}
      </div>
    </HudPanel>
  )
}

function AirportControls() {
  const { engine, clock } = useAds()
  const env = useAdsState((s) => s.env)
  const radarPeriodS = useAdsState((s) => s.radarPeriodS)
  const range = useAdsState((s) => s.mapRangeNm)
  const show = useAdsState((s) => s.atcShow)
  const crossCheck = useAdsState((s) => s.crossCheck)
  const zoom = useAdsState((s) => s.compareZoomNm)
  const adsbIn = useAdsState((s) => s.adsbIn)
  const selectedId = useAdsState((s) => s.selectedId)
  const { setEnv, setRadarPeriod, set, select, resetAirport } = useAdsState((s) => s)
  const running = useClock(clock, (s) => s.running)
  const sel = useSampled(() => {
    const a = engine.getAircraft(selectedId)
    return a ? { heading: wholeDegrees(a.mode.kind === 'heading' ? a.targetHeadingDeg : a.headingDeg), speed: Math.round(a.targetSpeedKt), alt: Math.round(a.targetAltitudeFt), mode: a.mode.kind } : null
  }, 200)

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <HudPanel index="CLK" title="Time" bodyClassName="p-3">
        <ClockControls clock={clock} onReset={resetAirport} />
        {!running && <p className="mt-2 text-xs text-muted-foreground">Paused. Press Play to let the aircraft fly.</p>}
      </HudPanel>

      <HudPanel index="SCR" title="Screens" bodyClassName="flex flex-col gap-4 p-4">
        <Segmented
          label="Map and screen range"
          value={String(range)}
          onChange={(v) => set({ mapRangeNm: Number(v) })}
          options={[
            { value: '30', label: '30 NM' },
            { value: '60', label: '60 NM' },
            { value: '250', label: '250 NM' },
          ]}
        />
        <Segmented
          label="Controller's screen shows"
          value={show}
          onChange={(v) => set({ atcShow: v })}
          options={[
            { value: 'both', label: 'Both' },
            { value: 'radar', label: 'Radar' },
            { value: 'adsb', label: 'ADS-B' },
          ]}
        />
        <div className="grid grid-cols-[auto_1fr] items-center gap-x-4">
          <Dial
            label="Radar turn time"
            value={radarPeriodS}
            min={4}
            max={12}
            step={0.2}
            onChange={setRadarPeriod}
            format={(v) => `${v.toFixed(1)} s`}
          />
          <Segmented
            label="Side-by-side zoom"
            value={String(zoom)}
            onChange={(v) => set({ compareZoomNm: Number(v) })}
            options={[
              { value: '2', label: '2 NM' },
              { value: '5', label: '5 NM' },
              { value: '10', label: '10 NM' },
            ]}
          />
        </div>
        <div>
          <LeverSwitch
            label="Cross-check ADS-B against radar"
            hint="Flags ADS-B targets the radar cannot see"
            tone="signal"
            checked={crossCheck}
            onChange={(v) => set({ crossCheck: v })}
          />
          <LeverSwitch
            label={<Term id="ads-b-in">ADS-B In (cockpit display)</Term>}
            hint="The selected aircraft shows the traffic it receives"
            tone="signal"
            checked={adsbIn}
            onChange={(v) => set({ adsbIn: v })}
          />
        </div>
      </HudPanel>

      <HudPanel index="ENV" title="Out in the world" bodyClassName="px-4 py-2">
        <LeverSwitch label={<Term id="jamming">GNSS jamming</Term>} hint="A jammer south-west of the airport" checked={env.jamming} onChange={(v) => setEnv('jamming', v)} />
        <LeverSwitch label={<Term id="adsb-spoofing">Spoofed ghost aircraft</Term>} hint="A fake CNS777 broadcast from the ground" checked={env.ghost} onChange={(v) => setEnv('ghost', v)} />
        <LeverSwitch label="CNS404 has no ADS-B" checked={env.noAdsb} onChange={(v) => setEnv('noAdsb', v)} />
        <LeverSwitch label="CNS101 low position quality" hint="Older GNSS without augmentation" checked={env.lowQuality} onChange={(v) => setEnv('lowQuality', v)} />
      </HudPanel>

      <HudPanel index="ACF" title="Fly an aircraft" bodyClassName="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="ads-aircraft" className="hud-label">
            Aircraft
          </Label>
          <Select value={selectedId ?? undefined} onValueChange={(v) => select(v)}>
            <SelectTrigger id="ads-aircraft" className="w-full">
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
            <HudButton onClick={() => flyCircle(engine, selectedId)}>
              <RotateCcw aria-hidden /> Fly a circle (to compare the turn)
            </HudButton>
            <ControlSlider
              label="Heading"
              value={sel.heading}
              min={0}
              max={359}
              onChange={(v) => engine.setAircraft(selectedId, { mode: { kind: 'heading' }, targetHeadingDeg: normalize360(v) })}
              format={(v) => `${String(v).padStart(3, '0')}° true`}
              hint={sel.mode === 'route' ? 'Following its route. Move this to take control.' : sel.mode === 'orbit' ? 'Flying a circle. Move this to take control.' : undefined}
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
              hint="Receiver coverage on the map grows with altitude"
            />
          </>
        )}
        <p className="text-[12px] text-muted-foreground">
          ADS-B only works while GNSS does.{' '}
          <Link to="/modules/dvor" className="inline-flex items-center gap-0.5 text-signal hover:underline">
            Next: how VOR guides aircraft from the ground <ArrowRight className="size-3" aria-hidden />
          </Link>
        </p>
      </HudPanel>
    </div>
  )
}

/** Put the aircraft into a steady circle 2.5 NM to its right (for the radar vs ADS-B comparison). */
export function flyCircle(engine: ReturnType<typeof useAds>['engine'], id: string) {
  const a = engine.getAircraft(id)
  if (!a) return
  const right = ((a.headingDeg + 90) * Math.PI) / 180
  const center = { x: a.pos.x + Math.sin(right) * 2.5, y: a.pos.y + Math.cos(right) * 2.5 }
  engine.setAircraft(id, { mode: { kind: 'orbit', center, radiusNm: 2.5, clockwise: true } })
}

// ---------------------------------------------------------------------------
// Ocean (ADS-C)
// ---------------------------------------------------------------------------

function OceanScenario() {
  const { oceanClock } = useAds()
  return (
    <>
      <div className="grid gap-4 md:grid-cols-[minmax(0,420px)_1fr_minmax(0,340px)]">
        <div className="flex min-w-0 flex-col gap-4">
          <HudPanel index="MAP" title="An ocean crossing" bodyClassName="p-3">
            <div className="relative">
              <OceanMap />
              <div className="pointer-events-none absolute top-2 left-2 flex max-w-[calc(100%-3rem)] flex-wrap gap-1.5">
                <ClockSpeedLabel clock={oceanClock} />
                <SimLabel icon="none">Flat map: the Earth's curve is not drawn</SimLabel>
              </div>
            </div>
            <p className="mt-2.5 text-[11.5px] leading-5 text-muted-foreground">Squares: ADS-C reports the centre received · dots: reports on their way.</p>
          </HudPanel>
          <OceanReadouts />
        </div>
        <div aria-hidden className="hidden md:block" />
        <OceanControls />
      </div>
      <ReportLog />
    </>
  )
}

function OceanReadouts() {
  const { ocean } = useAds()
  const r = useSampled(() => {
    const last = ocean.lastReport()
    const live = ocean.adsbLive()
    const heard = ocean.adsbHeardBy()
    const delays = ocean.received.map((x) => x.receivedS - x.sentS)
    return {
      utc: utc(ocean.timeS),
      surveillance: live ? (heard.length ? `ADS-B (${heard.map((h) => (h === 'west' ? 'west coast' : 'east coast')).join(', ')})` : 'ADS-B via satellites') : 'ADS-C only',
      live,
      lastAgeMin: last ? (ocean.timeS - last.sentS) / 60 : null,
      gapNm: last ? distanceNm(last.pos, ocean.aircraft.pos) : null,
      n: ocean.received.length,
      avgDelay: delays.length ? delays.reduce((a, b) => a + b, 0) / delays.length : null,
      arrived: ocean.arrived,
    }
  }, 250)
  return (
    <HudPanel index="TLM" title="Oceanic centre telemetry" bodyClassName="px-4 py-2">
      <div className="flex flex-col divide-y divide-hud-line">
        <Row label="Time (UTC)" value={r.utc} tone="signal" note={r.arrived ? 'Crossing complete' : 'Scenario starts at 10:00'} />
        <Row label="The centre sees it by" value={r.surveillance} tone={r.live ? 'ok' : 'brass'} />
        <Row label="Last ADS-C report" value={r.lastAgeMin != null ? r.lastAgeMin.toFixed(1) : '—'} unit="min ago" note={r.gapNm != null ? `The aircraft has flown ${r.gapNm.toFixed(0)} NM since` : 'None yet'} />
        <Row label="Report delay" value={r.avgDelay != null ? r.avgDelay.toFixed(0) : '—'} unit="s average" note={`${r.n} reports received`} />
      </div>
    </HudPanel>
  )
}

const REPORT_KIND: Record<AdscReport['kind'], string> = { periodic: 'Periodic', event: 'Event', demand: 'Demand' }

function ReportLog() {
  const { ocean } = useAds()
  const rows = useSampled(
    () => ({
      transit: ocean.inTransit.length,
      list: ocean.received
        .slice(-8)
        .reverse()
        .map((r) => ({
          seq: r.seq,
          kind: r.kind,
          event: r.event,
          sent: utc(r.sentS),
          delay: r.receivedS - r.sentS,
          lat: r.latLon.lat,
          lon: r.latLon.lon,
          fl: Math.round(r.altitudeFt / 100),
          next: r.nextWaypoint,
          eta: r.etaS != null ? utc(r.etaS).slice(0, 5) : null,
        })),
    }),
    300,
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  )
  return (
    <div className="hud-panel flex flex-col gap-3 rounded-md p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">
            <Term id="ads-c">ADS-C</Term> reports at the oceanic centre
          </h3>
          <p className="text-xs text-muted-foreground">Newest first. Each one left the aircraft some time before it arrived.</p>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">{rows.transit ? `${rows.transit} on the way` : 'None on the way'}</span>
      </div>
      {rows.list.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No reports yet. Press Play: the first periodic report is sent when the contract starts.</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-md border">
          {rows.list.map((r) => (
            <li key={r.seq} className="flex min-h-10 flex-col gap-1 px-3 py-2 text-xs sm:flex-row sm:items-center sm:gap-3">
              <Badge variant={r.kind === 'event' ? 'default' : r.kind === 'demand' ? 'outline' : 'secondary'}>{REPORT_KIND[r.kind]}</Badge>
              <span className="min-w-0 sm:flex-1">
                {r.event ? `${ADSC_EVENT_TEXT[r.event]}. ` : ''}
                <span className="font-mono tabular-nums">
                  {Math.abs(r.lat).toFixed(2)}°{r.lat >= 0 ? 'N' : 'S'} {Math.abs(r.lon).toFixed(2)}°{r.lon >= 0 ? 'E' : 'W'} · FL{r.fl}
                </span>
                {r.next && (
                  <span className="text-muted-foreground">
                    {' '}
                    · next {r.next}
                    {r.eta ? ` at ${r.eta}` : ''}
                  </span>
                )}
              </span>
              <span className="font-mono text-muted-foreground tabular-nums">
                sent {r.sent} · +{r.delay.toFixed(0)} s
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function OceanControls() {
  const { ocean, oceanClock } = useAds()
  const contract = useAdsState((s) => s.contract)
  const spaceAdsb = useAdsState((s) => s.spaceAdsb)
  const offset = useAdsState((s) => s.offsetRight)
  const fl = useAdsState((s) => s.oceanFl)
  const { setContract, setSpaceAdsb, setOffset, setOceanFl, restartCrossing } = useAdsState((s) => s)
  const running = useClock(oceanClock, (s) => s.running)

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <HudPanel index="CLK" title="Time" bodyClassName="p-3">
        <p className="mb-2 text-[11.5px] leading-4 text-muted-foreground">An ocean crossing takes hours, so this clock runs faster.</p>
        <ClockControls clock={oceanClock} onReset={restartCrossing} />
        {!running && <p className="mt-2 text-xs text-muted-foreground">Paused. Press Play to continue the crossing.</p>}
      </HudPanel>

      <HudPanel index="ADS-C" title="The contract" bodyClassName="flex flex-col gap-3 p-4">
        <p className="text-[11.5px] leading-4 text-muted-foreground">What the oceanic centre has asked CNS808 to report.</p>
        <Dial
          label="Periodic report every"
          value={contract.periodicMin}
          min={ADSC_PERIODIC_MIN[0]}
          max={ADSC_PERIODIC_MIN[1]}
          step={1}
          onChange={(v) => setContract({ periodicMin: v })}
          format={(v) => `${v} min`}
        />
        <div>
          <LeverSwitch label="Event: passing a waypoint" tone="signal" checked={contract.waypointEvent} onChange={(v) => setContract({ waypointEvent: v })} />
          <LeverSwitch
            label="Event: leaving the altitude band"
            hint={`FL${CLEARED_FL} ± ${contract.altitudeBandFt} ft`}
            tone="signal"
            checked={contract.altitudeEvent}
            onChange={(v) => setContract({ altitudeEvent: v })}
          />
          <LeverSwitch
            label="Event: off the route"
            hint={`More than ${contract.lateralNm} NM to either side`}
            tone="signal"
            checked={contract.lateralEvent}
            onChange={(v) => setContract({ lateralEvent: v })}
          />
          <LeverSwitch
            label="Event: fast climb or descent"
            hint={`Faster than ${contract.verticalRateFpm.toLocaleString('en-US')} ft/min`}
            tone="signal"
            checked={contract.verticalRateEvent}
            onChange={(v) => setContract({ verticalRateEvent: v })}
          />
        </div>
        <HudButton onClick={() => ocean.sendReport('demand')}>
          <Send aria-hidden /> Ask for a report now (demand)
        </HudButton>
      </HudPanel>

      <HudPanel index="ACF" title="Fly CNS808" bodyClassName="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-4">
          <Dial label="Flight level" value={fl} min={290} max={410} step={10} onChange={setOceanFl} format={(v) => `FL${v}`} />
          <p className="text-[11.5px] leading-4 text-muted-foreground">Cleared at FL{CLEARED_FL}. Leaving the band can trigger an event report.</p>
        </div>
        <LeverSwitch label={`Offset ${OFFSET_NM} NM right of the route`} tone="signal" checked={offset} onChange={setOffset} />
        <HudButton onClick={restartCrossing}>
          <RotateCcw aria-hidden /> Start the crossing again
        </HudButton>
      </HudPanel>

      <HudPanel index="SUR" title="Surveillance" bodyClassName="flex flex-col gap-2 px-4 py-3">
        <LeverSwitch
          label={<Term id="space-based-ads-b">Space-based ADS-B</Term>}
          hint="ADS-B receivers on satellites cover the whole ocean"
          tone="signal"
          checked={spaceAdsb}
          onChange={setSpaceAdsb}
        />
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Radio className="mt-0.5 size-3.5 shrink-0" aria-hidden /> ADS-C travels as data through a satellite: a quarter of a second by radio, then tens of seconds through the data network.
        </p>
      </HudPanel>
    </div>
  )
}
