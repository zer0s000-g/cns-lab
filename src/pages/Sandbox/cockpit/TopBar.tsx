import { Columns2, Maximize2, Pause, Play } from 'lucide-react'
import { speedLabel } from '@/core/clock'
import { useClock } from '@/hooks/useSimClock'
import { HudButton, LeverSwitch, Segmented } from '@/hud/Controls'
import { cn } from '@/lib/utils'
import { UNITS } from '../atc'
import { SANDBOX_SPEEDS, VIEW_LABEL, type ViewChoice } from '../director'
import { FLIGHT_PHASES, PHASE_LABEL } from '../journey'
import { useSandbox, useSandboxState } from '../state'
import { formatElapsed, useJourney } from './useJourney'

/** Phase, controller, journey clock and play/pause: the line across the top of the view. */
export function TopBar({ className }: { className?: string }) {
  const { clock } = useSandbox()
  const j = useJourney(250)
  const running = useClock(clock, (s) => s.running)
  const toggle = useClock(clock, (s) => s.toggle)
  const activeStop = useSandboxState((s) => s.activeStop)
  const hidden = useSandboxState((s) => s.panelsHidden)
  const setHidden = useSandboxState((s) => s.setPanelsHidden)
  const n = FLIGHT_PHASES.indexOf(j.phase) + 1
  const u = UNITS[j.unit]
  return (
    <div className={cn('flex items-start justify-between gap-3 text-foreground', className)}>
      <div className="min-w-0">
        <p className="hud-label hidden items-center gap-2 text-foreground/70 sm:flex">
          <span className="inline-block size-1.5 bg-brass" aria-hidden />
          Airspace sandbox · CNS700 gate to gate
        </p>
        <p className="hud-title mt-1 text-[15px] leading-tight md:text-[20px]">
          <span className="text-signal">{String(n).padStart(2, '0')}</span> {PHASE_LABEL[j.phase]}
        </p>
        <p className="hud-label mt-1 text-foreground/80">
          <span className="text-foreground">{u.callsign}</span> · {u.vhfMHz ? `${u.vhfMHz} MHz` : `CPDLC · HF ${u.hfKHz} kHz`}
        </p>
      </div>
      <div className="pointer-events-auto flex shrink-0 items-start gap-2">
        <div className="flex flex-col items-end" aria-label={`Journey time ${formatElapsed(j.elapsedS)}`}>
          <span className="hud-value text-[15px] leading-none md:text-[18px]">T+{formatElapsed(j.elapsedS)}</span>
          <span className="hud-label mt-1 text-foreground/70">Journey time</span>
        </div>
        <HudButton variant={running ? 'line' : 'solid'} onClick={toggle} disabled={activeStop !== null} aria-label={running ? 'Pause the journey' : 'Play the journey'} className="min-h-10 min-w-10 px-2.5">
          {running ? <Pause aria-hidden /> : <Play aria-hidden />}
        </HudButton>
        <HudButton onClick={() => setHidden(!hidden)} aria-label={hidden ? 'Show the panels' : 'Hide the panels to see the whole view'} active={hidden} className="hidden min-h-10 min-w-10 px-2.5 lg:inline-flex">
          {hidden ? <Columns2 aria-hidden /> : <Maximize2 aria-hidden />}
        </HudButton>
      </div>
    </div>
  )
}

/** Time-lapse, the view choice and guided stops. */
export function ControlsStrip({ className }: { className?: string }) {
  const { clock } = useSandbox()
  const speed = useClock(clock, (s) => s.speed)
  const setSpeed = useClock(clock, (s) => s.setSpeed)
  const timeMode = useSandboxState((s) => s.timeMode)
  const setTimeMode = useSandboxState((s) => s.setTimeMode)
  const viewChoice = useSandboxState((s) => s.viewChoice)
  const setViewChoice = useSandboxState((s) => s.setViewChoice)
  const stops = useSandboxState((s) => s.stopsEnabled)
  const setStops = useSandboxState((s) => s.setStopsEnabled)
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="hud-label">
            Time-lapse <span className="text-foreground/80">· {timeMode === 'auto' ? `auto, now ${speed}×` : speedLabel(speed).toLowerCase()}</span>
          </span>
          <HudButton onClick={() => setTimeMode(timeMode === 'auto' ? 'manual' : 'auto')} active={timeMode === 'auto'} aria-label="Automatic time-lapse" className="min-h-8 px-2 pointer-coarse:min-h-10">
            Auto
          </HudButton>
        </div>
        {/* Picking a speed takes over from the automatic time-lapse. */}
        <Segmented
          label={<span className="sr-only">Clock speed</span>}
          value={timeMode === 'auto' ? ('' as string) : String(speed)}
          onChange={(v) => {
            setTimeMode('manual')
            setSpeed(Number(v))
          }}
          options={SANDBOX_SPEEDS.map((s) => ({ value: String(s), label: `${s}×`, ariaLabel: speedLabel(s) }))}
        />
      </div>
      <Segmented<ViewChoice>
        label="View"
        value={viewChoice}
        onChange={setViewChoice}
        options={[
          { value: 'auto', label: 'Auto', ariaLabel: 'Automatic view: follows the controller in charge' },
          { value: 'airport', label: 'Airport' },
          { value: 'terminal', label: 'Terminal', ariaLabel: VIEW_LABEL.terminal },
          { value: 'map', label: 'Map', ariaLabel: VIEW_LABEL.map },
        ]}
      />
      <LeverSwitch label="Guided stops" hint="Pause at take-off, the ocean, the ILS and touchdown" tone="signal" checked={stops} onChange={setStops} className="py-0 md:col-span-2 lg:col-span-1" />
    </div>
  )
}
