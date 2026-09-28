import { Term } from '@/components/Term'
import { channelCount, channelFrequencyMHz, nearestChannelIndex, SPACING_KHZ, UHF_GUARD_MHZ, UHF_MIL_BAND, VHF_COM_BAND, VHF_GUARD_MHZ, adjacentLeakDbm } from '@/core/vhf'
import { Spectrum, type SpectrumBand, type SpectrumPeak, type SpectrumReading } from '@/instruments'
import { FREQ_MHZ, adjacentMHz } from './engine'
import { useVhf, useVhfState } from './state'

/** Occupied width of an AM voice signal, kHz (voice up to about 3 kHz each side of the carrier). TODO(expert-review). */
const AM_WIDTH_KHZ = 6
/** Pass-band of the receiver's channel filter, kHz. TODO(expert-review): typical 25 kHz and 8.33 kHz receiver selectivity. */
const PASSBAND_KHZ = { '25': 16, '8.33': 5.6 } as const

/** Two frequency strips: where aviation voice sits in the spectrum, and a close-up of the channel grid. */
export function FrequencyStrips() {
  const { engine } = useVhf()
  const spacing = useVhfState((s) => s.params.spacing)
  const interference = useVhfState((s) => s.failures.interference)

  const overview = (): SpectrumReading => {
    const tuned = FREQ_MHZ[engine.params.com1]
    return {
      minF: 100,
      maxF: 420,
      unit: 'MHz',
      log: true,
      topDb: 0,
      floorDb: -60,
      ticks: [118, 137, 225, 400],
      bands: [
        { from: VHF_COM_BAND.minMHz, to: VHF_COM_BAND.maxMHz, label: 'VHF voice' },
        { from: UHF_MIL_BAND.minMHz, to: UHF_MIL_BAND.maxMHz, label: 'UHF military voice', hatched: true },
      ],
      peaks: [
        { f: tuned, db: -18, emphasis: true, label: tuned === VHF_GUARD_MHZ ? 'You · guard' : 'You' },
        ...(tuned === VHF_GUARD_MHZ ? [] : [{ f: VHF_GUARD_MHZ, db: -36, label: '121.5' }]),
        { f: UHF_GUARD_MHZ, db: -36, label: '243.0' },
      ],
    }
  }

  const zoom = (): SpectrumReading => {
    const sp = engine.params.spacing
    const step = SPACING_KHZ[sp] / 1000
    const center = FREQ_MHZ.main
    const half = 0.04
    const bands: SpectrumBand[] = []
    const i0 = nearestChannelIndex(center - half, sp)
    for (let i = i0; i < channelCount(sp); i++) {
      const f = channelFrequencyMHz(i, sp)
      if (f > center + half) break
      if (f < center - half) continue
      bands.push({ from: f - step / 2 + step * 0.04, to: f + step / 2 - step * 0.04, label: '' })
    }
    const pb = PASSBAND_KHZ[sp] / 2000
    bands.push({ from: center - pb, to: center + pb, label: 'filter', hatched: true })
    const peaks: SpectrumPeak[] = []
    const wanted = engine.levelAt('controller', 'CNS101', 'main')
    peaks.push({ f: center, db: Number.isFinite(wanted) ? wanted : -125, width: AM_WIDTH_KHZ / 1000, emphasis: true, label: 'controller' })
    if (engine.failures.interference) {
      const adj = adjacentMHz(sp)
      const raw = engine.levelAt('CNS707', 'CNS101', 'adjacent')
      peaks.push({ f: adj, db: raw, width: AM_WIDTH_KHZ / 1000, label: 'CNS707' })
    }
    return { minF: center - half, maxF: center + half, unit: 'MHz', topDb: -30, floorDb: -123, bands, peaks, ticks: [+(center - 0.025).toFixed(3), center, +(center + 0.025).toFixed(3)] }
  }

  const leak = interference ? adjacentLeakDbm(engine.levelAt('CNS707', 'CNS101', 'adjacent'), spacing) : null

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <figure className="flex min-w-0 flex-col gap-2">
        <figcaption className="flex flex-wrap items-baseline justify-between gap-x-2">
          <span className="text-sm font-semibold">Where aviation voice radio lives</span>
          <span className="text-xs text-muted-foreground">100–420 MHz, log scale</span>
        </figcaption>
        <Spectrum read={overview} describe={() => `Spectrum from 100 to 420 megahertz. Aviation VHF voice from 118 to 136.975 megahertz with the 121.5 guard frequency; military UHF voice from 225 to 400 megahertz with the 243.0 guard frequency. You are tuned to ${FREQ_MHZ[engine.params.com1].toFixed(3)}.`} />
        <p className="text-xs text-muted-foreground">
          Peaks are markers, not signal strengths. <Term id="guard-frequency">Guard</Term> frequencies are for emergencies.
        </p>
      </figure>
      <figure className="flex min-w-0 flex-col gap-2">
        <figcaption className="flex flex-wrap items-baseline justify-between gap-x-2">
          <span className="text-sm font-semibold">Close-up: the channel grid</span>
          <span className="text-xs text-muted-foreground">{spacing === '25' ? '25 kHz channels' : '8.33 kHz channels: three in each 25 kHz'}</span>
        </figcaption>
        <Spectrum
          read={zoom}
          describe={() =>
            `Close-up of 80 kilohertz around 128.600 megahertz with ${spacing} kilohertz channel spacing. ${engine.failures.interference ? `CNS707 transmits on the next channel, ${((adjacentMHz(engine.params.spacing) - FREQ_MHZ.main) * 1000).toFixed(2)} kilohertz away.` : ''}`
          }
        />
        <p className="text-xs text-muted-foreground">
          Strength in <Term id="dbm">dBm</Term> at your aircraft. Each outlined slot is one <Term id="channel-spacing">channel</Term>. The hatched slot is what your receiver lets through.
          {leak !== null && ` After your filter, CNS707 still arrives at ${leak.toFixed(0)} dBm.`}
        </p>
      </figure>
    </div>
  )
}
