import { useRef, useState, type ReactNode } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ClockControls, ControlChoice, ControlSlider, ControlSwitch } from '@/components/sim/Controls'
import { ADF, CDI, DMEReadout, Oscilloscope, RadarScope, Spectrum, type ScopePaint, type ScopeTrack } from '@/instruments'
import { normalize360, bearingDeg, distanceNm, sweepCovers } from '@/core/geometry'
import { createAircraft, stepAircraftFine, type Aircraft } from '@/core/world'
import { useSimClock, useSimulationLoop } from '@/hooks/useSimClock'

function Demo({ title, description, children, controls }: { title: string; description: string; children: ReactNode; controls: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 items-center justify-center">{children}</div>
        <div className="flex min-w-0 flex-col gap-4">{controls}</div>
      </CardContent>
    </Card>
  )
}

function CdiDemo() {
  const [course, setCourse] = useState(90)
  const [lateral, setLateral] = useState(0.3)
  const [toFrom, setToFrom] = useState<'TO' | 'FROM' | 'OFF'>('TO')
  const [gs, setGs] = useState(false)
  const [vertical, setVertical] = useState(-0.2)
  const [hsi, setHsi] = useState(false)
  const [heading, setHeading] = useState(80)
  return (
    <Demo
      title="CDI / HSI"
      description="Course deviation indicator with OBS knob and TO/FROM flag. Drag the card, use the buttons, or focus it and press the arrow keys."
      controls={
        <>
          <ControlChoice label="Style" value={hsi ? 'hsi' : 'cdi'} onChange={(v) => setHsi(v === 'hsi')} options={[{ value: 'cdi', label: 'CDI' }, { value: 'hsi', label: 'HSI' }]} />
          <ControlSlider label="Needle (fraction of full scale)" value={lateral} min={-1.2} max={1.2} step={0.01} onChange={setLateral} format={(v) => `${v > 0 ? 'right ' : v < 0 ? 'left ' : ''}${Math.abs(v * 5).toFixed(1)} dots`} />
          <ControlChoice label="Flag" value={toFrom} onChange={setToFrom} options={[{ value: 'TO', label: 'TO' }, { value: 'FROM', label: 'FROM' }, { value: 'OFF', label: 'OFF' }]} />
          {hsi && <ControlSlider label="Heading" value={heading} min={0} max={359} onChange={setHeading} format={(v) => `${v}°`} />}
          <ControlSwitch label="Glideslope needle" checked={gs} onChange={setGs} />
          {gs && <ControlSlider label="Glideslope (fraction of full scale)" value={vertical} min={-1.2} max={1.2} step={0.01} onChange={setVertical} format={(v) => (v > 0 ? `fly up ${v.toFixed(2)}` : v < 0 ? `fly down ${(-v).toFixed(2)}` : 'on path')} />}
        </>
      }
    >
      <CDI
        variant={hsi ? 'hsi' : 'cdi'}
        title={gs ? 'ILS' : 'VOR'}
        read={() => ({ courseDeg: course, lateral, toFrom, headingDeg: heading, glideslope: gs ? { vertical, valid: true } : undefined })}
        onCourseChange={setCourse}
      />
    </Demo>
  )
}

function AdfDemo() {
  const [heading, setHeading] = useState(300)
  const [rel, setRel] = useState(90)
  const [signal, setSignal] = useState(true)
  const [mode, setMode] = useState<'adf' | 'rmi'>('adf')
  return (
    <Demo
      title="ADF and RMI"
      description="The ADF needle shows the relative bearing (from the nose). On the RMI the card turns with the heading, so the needle reads the magnetic bearing to the station."
      controls={
        <>
          <ControlChoice label="Instrument" value={mode} onChange={setMode} options={[{ value: 'adf', label: 'ADF (fixed card)' }, { value: 'rmi', label: 'RMI' }]} />
          <ControlSlider label="Magnetic heading" value={heading} min={0} max={359} onChange={setHeading} format={(v) => `${v}°`} />
          <ControlSlider label="Relative bearing" value={rel} min={0} max={359} onChange={setRel} format={(v) => `${v}°`} />
          <ControlSwitch label="Signal received" checked={signal} onChange={setSignal} />
          <p className="font-mono text-xs text-muted-foreground tabular-nums">
            Magnetic bearing = {heading}° + {rel}° = {normalize360(heading + rel).toFixed(0)}°
          </p>
        </>
      }
    >
      <ADF mode={mode} read={() => ({ headingDeg: heading, relativeBearingDeg: signal ? rel : null })} />
    </Demo>
  )
}

function DmeDemo() {
  const [dist, setDist] = useState(12.4)
  const [gs, setGs] = useState(240)
  const [status, setStatus] = useState<'LOCK' | 'SEARCH' | 'MEMORY' | 'OFF'>('LOCK')
  return (
    <Demo
      title="DME readout"
      description="Distance (slant range), groundspeed and time to station."
      controls={
        <>
          <ControlSlider label="Distance" value={dist} min={0} max={199} step={0.1} onChange={setDist} format={(v) => `${v.toFixed(1)} NM`} />
          <ControlSlider label="Closure rate" value={gs} min={0} max={600} onChange={setGs} format={(v) => `${v} kt`} />
          <ControlChoice label="Status" value={status} onChange={setStatus} options={[{ value: 'LOCK', label: 'Lock' }, { value: 'SEARCH', label: 'Search' }, { value: 'MEMORY', label: 'Memory' }, { value: 'OFF', label: 'Off' }]} />
        </>
      }
    >
      <DMEReadout
        className="w-full max-w-xs"
        read={() => ({
          distanceNm: status === 'SEARCH' ? null : dist,
          groundSpeedKt: status === 'SEARCH' ? null : gs,
          timeToStationMin: gs > 0 ? (dist / gs) * 60 : null,
          channel: 'CH 42X',
          ident: 'CNS',
          status,
        })}
      />
    </Demo>
  )
}

/** A tiny self-contained radar sim just for the demo page. */
function ScopeDemo() {
  const clock = useSimClock()
  const [periodS, setPeriodS] = useState(4)
  const [clutter, setClutter] = useState(true)
  const [labels, setLabels] = useState(true)
  const sim = useRef({
    az: 0,
    aircraft: [
      createAircraft({ id: 'A', callsign: 'CNS101', pos: { x: -20, y: 25 }, altitudeFt: 12000, headingDeg: 130, speedKt: 300 }),
      createAircraft({ id: 'B', callsign: 'CNS202', pos: { x: 30, y: -10 }, altitudeFt: 24000, headingDeg: 280, speedKt: 420 }),
      createAircraft({ id: 'C', callsign: 'CNS303', pos: { x: 5, y: -35 }, altitudeFt: 6000, headingDeg: 20, speedKt: 220 }),
    ] as Aircraft[],
    paints: [] as ScopePaint[],
  })
  useSimulationLoop(clock, (dt) => {
    const s = sim.current
    if (dt <= 0) return
    s.aircraft = s.aircraft.map((a) => stepAircraftFine(a, dt))
    const prevAz = s.az
    const span = (360 / periodS) * dt
    s.az = normalize360(s.az + span)
    for (const a of s.aircraft) {
      const brg = bearingDeg({ x: 0, y: 0 }, a.pos)
      if (distanceNm({ x: 0, y: 0 }, a.pos) < 60 && sweepCovers(brg, prevAz, span)) s.paints.push({ x: a.pos.x, y: a.pos.y, strength: 1, kind: 'target', widthDeg: 1.5, depthNm: 0.4 })
    }
    if (clutter) {
      for (let k = 0; k < 6; k++) {
        const r = 1 + Math.random() * 6
        const brg = prevAz + Math.random() * span
        s.paints.push({ x: r * Math.sin((brg * Math.PI) / 180), y: r * Math.cos((brg * Math.PI) / 180), strength: 0.5, kind: 'clutter', widthDeg: 1.5, depthNm: 0.3 })
      }
    }
  })
  return (
    <Demo
      title="Radar PPI scope"
      description="Rotating sweep, glowing and fading returns, range rings and labelled tracks."
      controls={
        <>
          <ClockControls clock={clock} />
          <ControlSlider label="Antenna rotation period" value={periodS} min={1} max={12} step={0.5} onChange={setPeriodS} format={(v) => `${v} s`} />
          <ControlSwitch label="Ground clutter" checked={clutter} onChange={setClutter} />
          <ControlSwitch label="Labels (secondary radar)" checked={labels} onChange={setLabels} />
        </>
      }
    >
      <div className="w-full max-w-md">
        <RadarScope
          maxRangeNm={60}
          ringStepNm={10}
          persistenceS={periodS}
          read={() => {
            const s = sim.current
            const paints = s.paints
            s.paints = []
            const tracks: ScopeTrack[] = labels
              ? s.aircraft.map((a) => ({ id: a.id, x: a.pos.x, y: a.pos.y, symbol: 'combined', label: [a.callsign, `${Math.round(a.altitudeFt / 100).toString().padStart(3, '0')}`] }))
              : []
            return { nowS: clock.getState().timeS, sweepAzDeg: s.az, beamWidthDeg: 1.5, paints, tracks }
          }}
          describe={() => `Radar scope, range 60 NM, ${sim.current.aircraft.length} aircraft.`}
        />
      </div>
    </Demo>
  )
}

function OscilloscopeDemo() {
  const [phase, setPhase] = useState(90)
  return (
    <Demo
      title="Dual-trace oscilloscope"
      description="Two 30 Hz signals. The shift between them is their phase difference."
      controls={<ControlSlider label="Phase difference" value={phase} min={0} max={359} onChange={setPhase} format={(v) => `${v}°`} />}
    >
      <Oscilloscope
        className="h-56"
        read={() => {
          const f = 30
          const lag = phase / 360 / f
          return {
            windowS: 2 / f,
            note: 'Triggered on REF',
            traces: [
              { label: 'REF 30 Hz', fn: (t) => Math.cos(2 * Math.PI * f * t) },
              { label: 'VAR 30 Hz', fn: (t) => Math.cos(2 * Math.PI * f * (t - lag)), dashed: true },
            ],
            span: { fromS: 0, toS: lag, label: `${phase}°` },
          }
        }}
        describe={() => `Two 30 Hz waves, the second lags the first by ${phase} degrees.`}
      />
    </Demo>
  )
}

function SpectrumDemo() {
  const [ident, setIdent] = useState(true)
  return (
    <Demo
      title="Spectrum view"
      description="What a VOR's modulation contains, by frequency: the 30 Hz signal, the 1020 Hz Morse ident, and the 9960 Hz subcarrier."
      controls={<ControlSwitch label="Ident tone on" checked={ident} onChange={setIdent} />}
    >
      <Spectrum
        read={() => ({
          minF: 0,
          maxF: 12,
          unit: 'kHz',
          topDb: 0,
          floorDb: -50,
          ticks: [0, 2, 4, 6, 8, 10, 12],
          peaks: [
            { f: 0.03, db: -6, label: '30 Hz', emphasis: true },
            ...(ident ? [{ f: 1.02, db: -14, label: '1020 Hz ident' }] : []),
            { f: 9.96, db: -8, width: 0.96, label: '9960 Hz ±480', emphasis: true },
          ],
        })}
        describe={() => `Spectrum from 0 to 12 kHz with peaks at 30 Hz${ident ? ', 1020 Hz' : ''} and 9960 Hz.`}
      />
    </Demo>
  )
}

export default function Instruments() {
  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-6 px-4 py-8 md:px-6 md:py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Instrument library</h1>
        <p className="text-[15px] text-muted-foreground">
          Every reusable instrument in CNS Lab, with test controls. Modules drive these same components from their
          simulations. Values here are set by hand.
        </p>
      </header>
      <CdiDemo />
      <AdfDemo />
      <DmeDemo />
      <ScopeDemo />
      <OscilloscopeDemo />
      <SpectrumDemo />
    </div>
  )
}
