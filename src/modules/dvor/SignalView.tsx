import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { thirtyHz, VOR_SIGNAL } from '@/core/vor'
import { fmt3 } from '@/instruments/draw'
import { Oscilloscope, Spectrum, type OscilloscopeReading, type SpectrumReading } from '@/instruments'
import { STATION } from './engine'
import { useDvor } from './state'

const T = 1 / VOR_SIGNAL.refVarHz

/** The two 30 Hz signals (oscilloscope) and the radio spectrum around the carrier. */
export function SignalView() {
  const { engine } = useDvor()

  const readScope = (): OscilloscopeReading => {
    const r = engine.last
    const type = engine.env.type
    const window = 2 * T
    const refLabel = type === 'cvor' ? 'REF · 30 Hz FM (9960 Hz subcarrier)' : 'REF · 30 Hz AM (centre antenna)'
    const varLabel = type === 'cvor' ? 'VAR · 30 Hz AM (turning pattern)' : 'VAR · 30 Hz FM (Doppler ring)'
    if (r.radialMeasured == null) {
      return {
        windowS: window,
        note: r.radiating ? 'No signal: out of range' : 'No signal: station off the air',
        traces: [
          { label: refLabel, fn: () => 0 },
          { label: varLabel, fn: () => 0, dashed: true },
        ],
      }
    }
    const radial = r.radialMeasured
    // Shade how far the AM peak lags the FM peak: what every VOR receiver measures.
    const lag = (radial / 360) * T
    // Drawn on the second cycle for CVOR so the label stays inside the screen.
    const span = type === 'cvor' ? { fromS: T, toS: T + lag } : { fromS: T - lag, toS: T }
    const now = ((engine.signalTimeS % window) + window) % window
    return {
      windowS: window,
      note: 'Triggered on REF: the waves stand still',
      traces: [
        { label: refLabel, fn: (t) => thirtyHz(type, t, radial).ref },
        { label: varLabel, fn: (t) => thirtyHz(type, t, radial).variable, dashed: true },
      ],
      span: { ...span, label: `AM lags FM by ${fmt3(radial)}°${r.usable ? '' : ' (garbled)'}` },
      markers: [{ tS: now, label: '' }],
    }
  }

  const readSpectrum = (): SpectrumReading => {
    const r = engine.last
    const dvor = engine.env.type === 'dvor'
    const peaks: SpectrumReading['peaks'] = []
    if (r.received) {
      peaks.push({ f: 0, db: 0, label: `Carrier ${engine.freqMHz.toFixed(2)} MHz`, emphasis: true })
      const sub = VOR_SIGNAL.subcarrierHz / 1000
      const width = (2 * VOR_SIGNAL.fmDeviationHz) / 1000
      const subDb = 20 * Math.log10(VOR_SIGNAL.subcarrierDepth / 2)
      peaks.push({ f: sub, db: subDb, width, label: dvor ? 'Ring sideband (VAR)' : 'Subcarrier (REF)' })
      peaks.push({ f: -sub, db: subDb, width, label: dvor ? 'Ring sideband' : 'Subcarrier' })
      if (r.identAudible) {
        const idDb = 20 * Math.log10(VOR_SIGNAL.identDepth / 2)
        peaks.push({ f: 1.02, db: idDb, label: 'Ident 1020 Hz' })
        peaks.push({ f: -1.02, db: idDb })
      }
    }
    return {
      minF: -12,
      maxF: 12,
      unit: 'kHz from the carrier',
      topDb: 0,
      floorDb: -50,
      peaks,
      ticks: [-9.96, 0, 9.96],
    }
  }

  const describeScope = () => {
    const r = engine.last
    if (r.radialMeasured == null) return 'Oscilloscope: no signal.'
    const type = engine.env.type === 'cvor' ? 'conventional VOR' : 'Doppler VOR'
    return `Oscilloscope, ${type}: the 30 hertz AM wave lags the 30 hertz FM wave by ${Math.round(r.radialMeasured)} degrees, which is the radial.`
  }

  return (
    <Tabs defaultValue="scope" className="gap-2">
      <TabsList>
        <TabsTrigger value="scope">Oscilloscope</TabsTrigger>
        <TabsTrigger value="spectrum">Spectrum</TabsTrigger>
      </TabsList>
      <TabsContent value="scope" className="flex flex-col gap-2">
        <Oscilloscope read={readScope} describe={describeScope} className="h-56" />
        <p className="text-xs text-muted-foreground">
          Two 30 Hz waves over two cycles (about 67 ms). The shaded part is the phase difference: the radial. The orange
          line moves with the slowed-down station view.
        </p>
      </TabsContent>
      <TabsContent value="spectrum" className="flex flex-col gap-2">
        <Spectrum
          read={readSpectrum}
          className="h-56"
          describe={() =>
            engine.last.received
              ? `Spectrum of the ${STATION.ident} VOR: the carrier, the 1020 hertz ident and the 9960 hertz sidebands. The 30 hertz modulation sits too close to the carrier to see.`
              : 'Spectrum: no signal.'
          }
        />
        <p className="text-xs text-muted-foreground">
          CVOR and DVOR look the same here, which is why one receiver works with both. The 30 Hz AM sits too close to the
          carrier to see at this scale.
        </p>
      </TabsContent>
    </Tabs>
  )
}
