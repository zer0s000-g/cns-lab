import { Antenna, Compass, Radar } from 'lucide-react'
import { HudPanel } from '@/hud/HudFrame'
import { TelemetryRow } from '@/hud/Telemetry'
import { cn } from '@/lib/utils'
import { papiReading } from '../aircraftState'
import { UNITS } from '../atc'
import { STORY } from '../narration'
import { useJourney } from './useJourney'

/** CNS700's flight data, and who is controlling it. */
export function FlightCard({ className }: { className?: string }) {
  const j = useJourney()
  const u = UNITS[j.unit]
  const fl = j.altitudeFt >= 10000 ? `FL${String(Math.round(j.altitudeFt / 100)).padStart(3, '0')}` : j.onGround ? 'Ground' : j.altitudeFt.toLocaleString('en-US')
  return (
    <HudPanel index="FLT" title="CNS700 · A320-class" className={className} bodyClassName="flex flex-col gap-3 px-4 py-3">
      <div className="grid grid-cols-2 gap-x-5">
        <TelemetryRow label="Altitude" value={fl} unit={!j.onGround && j.altitudeFt < 10000 ? 'ft' : undefined} />
        <TelemetryRow label="Ground speed" value={j.speedKt} unit="kt" />
        <TelemetryRow label="Heading" value={String(j.headingDeg).padStart(3, '0')} unit="°" />
        <TelemetryRow label="Vertical speed" value={j.onGround ? '—' : `${j.vsFpm > 0 ? '+' : ''}${j.vsFpm.toLocaleString('en-US')}`} unit={j.onGround ? undefined : 'ft/min'} />
        <TelemetryRow label="Squawk" value={j.transponder ? '4521' : 'Standby'} tone={j.transponder ? 'default' : 'muted'} />
        {j.papi ? (
          <TelemetryRow
            label="PAPI (from cockpit)"
            value={
              <span className="inline-flex flex-col items-end gap-0.5" aria-label={`${j.papi.filter(Boolean).length} white, ${j.papi.filter((w) => !w).length} red: ${papiReading(j.papi)}`}>
                <span className="inline-flex items-center gap-1" aria-hidden>
                  {j.papi.map((w, i) => (
                    <span key={i} className={cn('inline-block size-2.5 rounded-full border border-foreground/50', w ? 'bg-foreground' : 'bg-[var(--lamp-red)]')} />
                  ))}
                </span>
                <span aria-hidden className="text-[10px] text-muted-foreground">
                  {papiReading(j.papi)}
                </span>
              </span>
            }
          />
        ) : (
          <TelemetryRow label="From XCNS" value={j.onGround ? 'At the airport' : j.distNm} unit={j.onGround ? undefined : 'NM'} tone={j.onGround ? 'muted' : 'default'} />
        )}
      </div>
      <div className="border-t border-hud-line pt-3">
        <p className="hud-label">Controlled by</p>
        <p className="mt-1 text-[14px] font-medium text-foreground">
          {u.name} <span className="hud-value text-[12px] text-signal">{u.vhfMHz ? `${u.vhfMHz} MHz` : `CPDLC · HF ${u.hfKHz} kHz`}</span>
        </p>
        <p className="mt-0.5 text-[12.5px] leading-5 text-muted-foreground">{u.role}</p>
        <p className="hud-label mt-2 text-[9.5px] text-muted-foreground/80">Frequencies made up for this fictional airport</p>
      </div>
    </HudPanel>
  )
}

/** What is happening now, in plain words, and the C, N and S at work. */
export function NowCard({ className }: { className?: string }) {
  const j = useJourney(400)
  const s = STORY[j.phase]
  return (
    <HudPanel index="NOW" title="What's happening" className={className} bodyClassName="flex flex-col gap-3 px-4 py-3">
      <p className="text-[14px] leading-6 text-foreground/90">{s.body}</p>
      <ul className="flex flex-col gap-1.5 border-t border-hud-line pt-3 text-[12.5px] leading-5">
        <li className="flex gap-2">
          <Antenna className="mt-0.5 size-3.5 shrink-0 text-signal" aria-hidden />
          <span>
            <span className="hud-label mr-1.5">Talk</span>
            {s.c}
          </span>
        </li>
        <li className="flex gap-2">
          <Compass className="mt-0.5 size-3.5 shrink-0 text-signal" aria-hidden />
          <span>
            <span className="hud-label mr-1.5">Navigate</span>
            {s.n}
          </span>
        </li>
        <li className="flex gap-2">
          <Radar className="mt-0.5 size-3.5 shrink-0 text-signal" aria-hidden />
          <span>
            <span className="hud-label mr-1.5">Watch</span>
            {s.s}
          </span>
        </li>
      </ul>
    </HudPanel>
  )
}
