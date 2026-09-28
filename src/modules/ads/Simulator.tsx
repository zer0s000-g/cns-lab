import { Link } from 'react-router'
import { ArrowRight, Radio, RotateCcw, Send } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
import { ADSC_EVENT_TEXT, ADSC_PERIODIC_MIN } from '@/core/ads'
import { distanceNm, normalize360 } from '@/core/geometry'
import { useClock, useSimulationLoop } from '@/hooks/useSimClock'
import { useSampled } from '@/hooks/useSampled'
import { AdsMap } from './AdsMap'
import { AtcScreen } from './AtcScreen'
import { CockpitTraffic } from './CockpitTraffic'
import { CompareView } from './CompareView'
import { trackState } from './engine'
import { MessagePanel } from './MessagePanel'
import { OceanMap } from './OceanMap'
import { CLEARED_FL, OFFSET_NM, utc, type AdscReport } from './oceanEngine'
import { useAds, useAdsState, type Scenario } from './state'

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
    <Tabs value={scenario} onValueChange={(v) => setScenario(v as Scenario)} className="gap-4">
      <TabsList className="h-auto w-full flex-wrap sm:w-fit">
        <TabsTrigger value="airport" className="px-3">
          Near the airport: ADS-B
        </TabsTrigger>
        <TabsTrigger value="ocean" className="px-3">
          Over the ocean: ADS-C
        </TabsTrigger>
      </TabsList>
      <TabsContent value="airport">
        <AirportScenario />
      </TabsContent>
      <TabsContent value="ocean">
        <OceanScenario />
      </TabsContent>
    </Tabs>
  )
}

// ---------------------------------------------------------------------------
// Airport (ADS-B)
// ---------------------------------------------------------------------------

function AirportScenario() {
  const { clock } = useAds()
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
              <AdsMap />
              <div className="pointer-events-none absolute top-2 left-2 flex max-w-[calc(100%-3rem)] flex-wrap gap-1.5">
                <ClockSpeedLabel clock={clock} />
                <SimLabel>Broadcast rings slowed down so you can see them</SimLabel>
              </div>
            </div>
          </figure>
          <figure className="flex min-w-0 flex-col gap-2">
            <figcaption className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold">What the controller sees</span>
              <span className="text-xs text-muted-foreground">Diamond: ADS-B · square: radar</span>
            </figcaption>
            <AtcScreen />
            <p className="text-xs text-muted-foreground">
              Diamonds are <Term id="ads-b">ADS-B</Term> positions, updated about twice a second. Squares are radar plots, updated once per antenna
              turn; they get a label only when there is no ADS-B for that aircraft.
            </p>
          </figure>
        </div>
        <CompareView />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <MessagePanel />
          <CockpitTraffic />
        </div>
        <AirportReadouts />
      </div>
      <AirportControls />
    </div>
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
    <ReadoutGrid>
      <Readout label="Broadcast frequency" value="1090" unit="MHz" hint="Extended squitter (DF17)" />
      <Readout label="Aircraft on ADS-B" value={r.adsb} hint="Tracks with a fresh position" />
      <Readout label="Aircraft on radar" value={r.radar} hint="Seen on the last antenna turn" />
      {r.sel && (
        <Readout
          label={`${r.sel.id}: GNSS`}
          value={!r.sel.out ? 'No ADS-B' : r.sel.lost ? 'Lost' : `NACp ${r.sel.nacp}`}
          tone={!r.sel.out || r.sel.lost ? 'alert' : r.sel.nacp < 8 ? 'warning' : 'ok'}
          hint={r.sel.out ? `NIC ${r.sel.nic}` : 'Invisible to ADS-B receivers'}
        />
      )}
    </ReadoutGrid>
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
    return a ? { heading: Math.round(a.mode.kind === 'heading' ? a.targetHeadingDeg : a.headingDeg), speed: Math.round(a.targetSpeedKt), alt: Math.round(a.targetAltitudeFt), mode: a.mode.kind } : null
  }, 200)

  return (
    <ControlsPanel className="h-fit xl:sticky xl:top-20">
      <ControlGroup title="Time">
        <ClockControls clock={clock} onReset={resetAirport} />
        {!running && <p className="text-xs text-muted-foreground">Paused. Press Play to let the aircraft fly.</p>}
      </ControlGroup>

      <ControlGroup title="Screens">
        <ControlChoice
          label="Map and screen range"
          value={String(range)}
          onChange={(v) => set({ mapRangeNm: Number(v) })}
          options={[
            { value: '30', label: '30 NM' },
            { value: '60', label: '60 NM' },
            { value: '250', label: '250 NM' },
          ]}
        />
        <ControlChoice
          label="Controller's screen shows"
          value={show}
          onChange={(v) => set({ atcShow: v })}
          options={[
            { value: 'both', label: 'Both' },
            { value: 'radar', label: 'Radar' },
            { value: 'adsb', label: 'ADS-B' },
          ]}
        />
        <ControlSwitch
          label="Cross-check ADS-B against radar"
          hint="Flags ADS-B targets the radar cannot see"
          checked={crossCheck}
          onChange={(v) => set({ crossCheck: v })}
        />
        <ControlSlider
          label="Radar antenna turn time"
          value={radarPeriodS}
          min={4}
          max={12}
          step={0.2}
          onChange={setRadarPeriod}
          format={(v) => `${v.toFixed(1)} s`}
        />
        <ControlChoice
          label="Side-by-side zoom"
          value={String(zoom)}
          onChange={(v) => set({ compareZoomNm: Number(v) })}
          options={[
            { value: '2', label: '2 NM' },
            { value: '5', label: '5 NM' },
            { value: '10', label: '10 NM' },
          ]}
        />
        <ControlSwitch
          label={<Term id="ads-b-in">ADS-B In (cockpit display)</Term>}
          hint="The selected aircraft shows the traffic it receives"
          checked={adsbIn}
          onChange={(v) => set({ adsbIn: v })}
        />
      </ControlGroup>

      <ControlGroup title="Out in the world">
        <ControlSwitch label={<Term id="jamming">GNSS jamming</Term>} hint="A jammer south-west of the airport" checked={env.jamming} onChange={(v) => setEnv('jamming', v)} />
        <ControlSwitch label={<Term id="adsb-spoofing">Spoofed ghost aircraft</Term>} hint="A fake CNS777 broadcast from the ground" checked={env.ghost} onChange={(v) => setEnv('ghost', v)} />
        <ControlSwitch label="CNS404 has no ADS-B" checked={env.noAdsb} onChange={(v) => setEnv('noAdsb', v)} />
        <ControlSwitch label="CNS101 low position quality" hint="Older GNSS without augmentation" checked={env.lowQuality} onChange={(v) => setEnv('lowQuality', v)} />
      </ControlGroup>

      <ControlGroup title="Fly an aircraft">
        <div className="flex flex-col gap-2">
          <Label htmlFor="ads-aircraft">Aircraft</Label>
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
            <Button variant="outline" size="sm" onClick={() => flyCircle(engine, selectedId)}>
              <RotateCcw aria-hidden /> Fly a circle (to compare the turn)
            </Button>
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
      </ControlGroup>

      <p className="text-xs text-muted-foreground">
        ADS-B only works while GNSS does.{' '}
        <Link to="/modules/dvor" className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline">
          Next: how VOR guides aircraft from the ground <ArrowRight className="size-3" aria-hidden />
        </Link>
      </p>
    </ControlsPanel>
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
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-4">
        <figure className="flex min-w-0 flex-col gap-2">
          <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-semibold">An ocean crossing</span>
            <span className="text-xs text-muted-foreground">Squares: ADS-C reports the centre received · dots: reports on their way</span>
          </figcaption>
          <div className="relative">
            <OceanMap />
            <div className="pointer-events-none absolute top-2 left-2 flex max-w-[calc(100%-3rem)] flex-wrap gap-1.5">
              <ClockSpeedLabel clock={oceanClock} />
              <SimLabel icon="none">Flat map: the Earth's curve is not drawn</SimLabel>
            </div>
          </div>
        </figure>
        <OceanReadouts />
        <ReportLog />
      </div>
      <OceanControls />
    </div>
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
    <ReadoutGrid>
      <Readout label="Time (UTC)" value={r.utc} hint={r.arrived ? 'Crossing complete' : 'Scenario starts at 10:00'} />
      <Readout label="The centre sees it by" value={r.surveillance} tone={r.live ? 'ok' : 'warning'} className="col-span-2 sm:col-span-1" />
      <Readout label="Last ADS-C report" value={r.lastAgeMin != null ? r.lastAgeMin.toFixed(1) : '—'} unit="min ago" hint={r.gapNm != null ? `The aircraft has flown ${r.gapNm.toFixed(0)} NM since` : 'None yet'} />
      <Readout label="Report delay" value={r.avgDelay != null ? r.avgDelay.toFixed(0) : '—'} unit="s average" hint={`${r.n} reports received`} />
    </ReadoutGrid>
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
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
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
    <ControlsPanel className="h-fit xl:sticky xl:top-20">
      <ControlGroup title="Time" description="An ocean crossing takes hours, so this clock runs faster.">
        <ClockControls clock={oceanClock} onReset={restartCrossing} />
        {!running && <p className="text-xs text-muted-foreground">Paused. Press Play to continue the crossing.</p>}
      </ControlGroup>

      <ControlGroup title="The contract" description="What the oceanic centre has asked CNS808 to report.">
        <ControlSlider
          label="Periodic report every"
          value={contract.periodicMin}
          min={ADSC_PERIODIC_MIN[0]}
          max={ADSC_PERIODIC_MIN[1]}
          step={1}
          onChange={(v) => setContract({ periodicMin: v })}
          format={(v) => `${v} min`}
        />
        <ControlSwitch label="Event: passing a waypoint" checked={contract.waypointEvent} onChange={(v) => setContract({ waypointEvent: v })} />
        <ControlSwitch
          label="Event: leaving the altitude band"
          hint={`FL${CLEARED_FL} ± ${contract.altitudeBandFt} ft`}
          checked={contract.altitudeEvent}
          onChange={(v) => setContract({ altitudeEvent: v })}
        />
        <ControlSwitch
          label="Event: off the route"
          hint={`More than ${contract.lateralNm} NM to either side`}
          checked={contract.lateralEvent}
          onChange={(v) => setContract({ lateralEvent: v })}
        />
        <ControlSwitch
          label="Event: fast climb or descent"
          hint={`Faster than ${contract.verticalRateFpm.toLocaleString('en-US')} ft/min`}
          checked={contract.verticalRateEvent}
          onChange={(v) => setContract({ verticalRateEvent: v })}
        />
        <Button variant="outline" size="sm" onClick={() => ocean.sendReport('demand')}>
          <Send aria-hidden /> Ask for a report now (demand)
        </Button>
      </ControlGroup>

      <ControlGroup title="Fly CNS808">
        <ControlSlider label="Flight level" value={fl} min={290} max={410} step={10} onChange={setOceanFl} format={(v) => `FL${v}`} hint={`Cleared at FL${CLEARED_FL}`} />
        <ControlSwitch label={`Offset ${OFFSET_NM} NM right of the route`} checked={offset} onChange={setOffset} />
        <Button variant="outline" size="sm" onClick={restartCrossing}>
          <RotateCcw aria-hidden /> Start the crossing again
        </Button>
      </ControlGroup>

      <ControlGroup title="Surveillance">
        <ControlSwitch
          label={<Term id="space-based-ads-b">Space-based ADS-B</Term>}
          hint="ADS-B receivers on satellites cover the whole ocean"
          checked={spaceAdsb}
          onChange={setSpaceAdsb}
        />
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Radio className="mt-0.5 size-3.5 shrink-0" aria-hidden /> ADS-C travels as data through a satellite: a quarter of a second by radio, then tens of seconds through the data network.
        </p>
      </ControlGroup>
    </ControlsPanel>
  )
}
