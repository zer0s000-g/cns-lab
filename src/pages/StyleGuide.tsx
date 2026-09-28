import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dial, HudButton, LeverSwitch, Segmented } from '@/hud/Controls'
import { CornerBrackets, HudPanel, StatusLamp, TitleBlock } from '@/hud/HudFrame'
import { BarMeter, BigReadout, NeedleGauge, TelemetryRow } from '@/hud/Telemetry'
import { formatMissionTime } from '@/hud/MissionClock'

/** Colour tokens shown as swatches. Values come from globals.css at runtime. */
const SWATCHES: { group: string; tokens: { name: string; role: string }[] }[] = [
  {
    group: 'Surfaces',
    tokens: [
      { name: 'background', role: 'Graphite page' },
      { name: 'card', role: 'Raised panel' },
      { name: 'hud-panel', role: 'Glass panel over a stage' },
      { name: 'hud-line', role: 'Hairline rules' },
    ],
  },
  {
    group: 'Signal',
    tokens: [
      { name: 'signal', role: 'Live signal, focus, primary action' },
      { name: 'brass', role: 'Hardware, analogy, second signal' },
      { name: 'destructive', role: 'Alarms and failures only' },
      { name: 'success', role: 'OK, completed' },
    ],
  },
  {
    group: 'Stage (night in both themes)',
    tokens: [
      { name: 'stage-bg', role: 'Studio backdrop' },
      { name: 'stage-terrain-high', role: 'Clay model' },
      { name: 'stage-water', role: 'Sea' },
      { name: 'stage-paint', role: 'Miniatures' },
    ],
  },
]

function Swatch({ name, role }: { name: string; role: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="block size-9 shrink-0 rounded-[4px] border border-hud-line" style={{ background: `var(--${name})` }} aria-hidden />
      <span className="flex min-w-0 flex-col">
        <span className="hud-value text-[11.5px] text-foreground">--{name}</span>
        <span className="text-[12px] leading-4 text-muted-foreground">{role}</span>
      </span>
    </div>
  )
}

/** The Flight Deck design system on one page: tokens, type and HUD components. */
export function StyleGuide() {
  const [dial, setDial] = useState(4.8)
  const [lever, setLever] = useState(true)
  const [fault, setFault] = useState(false)
  const [seg, setSeg] = useState<'30' | '60' | '120'>('60')
  return (
    <section aria-labelledby="sg-title" className="flex flex-col gap-6">
      <div className="relative px-6 py-8 md:px-10">
        <CornerBrackets inset={0} />
        <TitleBlock as="h2" kicker="Design system · Flight Deck" title="The style guide" sub="Tokens, type and the HUD kit every page is built from. Everything here is live." />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {SWATCHES.map((g, i) => (
          <HudPanel key={g.group} index={`C${i + 1}`} title={g.group} bodyClassName="flex flex-col gap-3 p-4">
            {g.tokens.map((tk) => (
              <Swatch key={tk.name} {...tk} />
            ))}
          </HudPanel>
        ))}
      </div>

      <HudPanel index="TYP" title="Type" bodyClassName="grid gap-6 p-5 md:grid-cols-3">
        <div className="flex flex-col gap-2">
          <span className="hud-label">Display · Michroma · .hud-title</span>
          <span className="hud-title text-[28px] leading-8">Primary radar</span>
        </div>
        <div className="flex flex-col gap-2">
          <span className="hud-label">Reading · Inter Tight</span>
          <p className="text-[15px] leading-7 text-foreground/85">A primary radar sends short pulses of radio energy and listens for the echoes.</p>
        </div>
        <div className="flex flex-col gap-2">
          <span className="hud-label">Data · JetBrains Mono · .hud-label / .hud-value</span>
          <span className="hud-value text-[22px]">{formatMissionTime(3725)}</span>
          <span className="hud-label">Max unambiguous range</span>
        </div>
      </HudPanel>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr_1.2fr]">
        <HudPanel index="TLM" title="Telemetry" bodyClassName="flex flex-col px-4 py-2">
          <TelemetryRow label="Antenna" value="046" unit="°" tone="signal" />
          <TelemetryRow label="Turn" value={dial.toFixed(1)} unit="s" />
          <TelemetryRow label="Unambiguous range" value="81" unit="NM" bar={0.68} />
          <TelemetryRow label="Second trace" value="Yes" tone="brass" />
          <div className="flex items-center justify-between py-2.5">
            <span className="hud-label">Bar meter</span>
            <BarMeter orientation="horizontal" value={0.62} segments={16} label="Example bar meter at 62 percent" />
          </div>
        </HudPanel>
        <HudPanel index="GAU" title="Gauges and readouts" bodyClassName="grid grid-cols-2 items-center gap-4 p-4">
          <NeedleGauge value={81} min={0} max={200} ticks={[0, 50, 100, 150, 200]} label="Example gauge" valueText="81 NM" />
          <BigReadout label="Echo time" value="393" unit="µs" tone="signal" />
          <div className="col-span-2 flex flex-wrap gap-4">
            <StatusLamp on label="Live" tone="signal" />
            <StatusLamp on={fault} label="Fault" />
            <StatusLamp on label="Replay" tone="brass" />
          </div>
        </HudPanel>
        <HudPanel index="CTL" title="Controls" bodyClassName="flex flex-col gap-5 p-4">
          <div className="flex flex-wrap items-end gap-6">
            <Dial label="Turn time" value={dial} min={2} max={15} step={0.1} onChange={setDial} format={(v) => `${v.toFixed(1)} s`} />
            <Segmented className="min-w-[220px] flex-1" label="Screen range" value={seg} onChange={setSeg} options={[{ value: '30', label: '30 NM' }, { value: '60', label: '60 NM' }, { value: '120', label: '120 NM' }]} />
          </div>
          <div>
            <LeverSwitch label="MTI filter" hint="Signal-toned lever: a fix" tone="signal" checked={lever} onChange={setLever} />
            <LeverSwitch label="Ground clutter" hint="Alert-toned lever: a failure" checked={fault} onChange={setFault} />
          </div>
          <div className="flex flex-wrap gap-2">
            <HudButton variant="solid">Solid</HudButton>
            <HudButton active>Active</HudButton>
            <HudButton>Line</HudButton>
            <Button size="sm">shadcn Button</Button>
            <Button size="sm" variant="outline">
              Outline
            </Button>
          </div>
        </HudPanel>
      </div>
    </section>
  )
}
