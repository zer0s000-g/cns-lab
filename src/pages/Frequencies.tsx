import { Link } from 'react-router'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PillarBadge } from '@/components/PillarBadge'
import { Spectrum, type SpectrumBand } from '@/instruments'
import { FREQUENCY_BANDS, formatHz } from '@/content/frequencies'
import { MODULE_BY_ID } from '@/modules/registry'

const MIN = 100e3
const MAX = 20e9

/** Log-scale chart of the radio spectrum with every CNS system. */
export default function Frequencies() {
  const bands: SpectrumBand[] = [
    { from: 30e3, to: 300e3, label: 'LF' },
    { from: 300e3, to: 3e6, label: 'MF' },
    { from: 3e6, to: 30e6, label: 'HF' },
    { from: 30e6, to: 300e6, label: 'VHF' },
    { from: 300e6, to: 3e9, label: 'UHF' },
    { from: 3e9, to: 30e9, label: 'SHF' },
  ].map((b) => ({ ...b, from: Math.max(b.from, MIN), to: Math.min(b.to, MAX) }))

  const sorted = [...FREQUENCY_BANDS].sort((a, b) => a.fromHz - b.fromHz)
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-8 md:px-6 md:py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Frequency chart</h1>
        <p className="text-[15px] text-muted-foreground">
          Where every system in CNS Lab lives in the radio spectrum. Low frequencies (left) hug the ground and bend
          around the Earth; high frequencies (right) travel in straight lines and carry fine detail.
        </p>
      </header>
      <figure className="flex flex-col gap-2">
        <Spectrum
          className="h-64"
          read={() => ({
            minF: MIN,
            maxF: MAX,
            unit: 'Hz (log scale)',
            log: true,
            topDb: 0,
            floorDb: -60,
            bands,
            ticks: [1e6, 10e6, 100e6, 1e9, 10e9],
            peaks: sorted.map((b, i) => ({
              f: Math.sqrt(b.fromHz * b.toHz),
              db: -8 - (i % 5) * 9,
              width: b.toHz - b.fromHz,
              label: b.system.split(' ')[0].replace(/[/,]/g, ''),
            })),
          })}
          describe={() => `Spectrum chart of ${sorted.length} systems from ${formatHz(MIN)} to ${formatHz(MAX)}. The table below lists each band.`}
        />
        <figcaption className="text-xs text-muted-foreground">
          Axis ticks: 1 MHz, 10 MHz, 100 MHz, 1 GHz, 10 GHz. Bar heights are only for readability.
        </figcaption>
      </figure>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 bg-background">System</TableHead>
              <TableHead>Pillar</TableHead>
              <TableHead className="text-right">From</TableHead>
              <TableHead className="text-right">To</TableHead>
              <TableHead>Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((b) => {
              const m = b.moduleId ? MODULE_BY_ID.get(b.moduleId) : undefined
              return (
                <TableRow key={b.id}>
                  <TableCell className="sticky left-0 bg-background font-medium">
                    {m ? (
                      <Link to={m.path} className="text-primary hover:underline">
                        {b.system}
                      </Link>
                    ) : (
                      b.system
                    )}
                  </TableCell>
                  <TableCell>
                    <PillarBadge pillar={b.pillar} />
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatHz(b.fromHz)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatHz(b.toHz)}</TableCell>
                  <TableCell className="min-w-64 text-muted-foreground">{b.note}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
