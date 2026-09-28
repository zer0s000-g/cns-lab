import { ClockControls, ClockSpeedLabel } from '@/components/sim/Controls'
import { ChapterHead } from '@/components/module/ModuleLayout'
import { Term } from '@/components/Term'
import type { DataLinkPath, RcpType } from '@/core/cpdlc'
import { useClock, useSimulationLoop } from '@/hooks/useSimClock'
import { LeverSwitch, Segmented } from '@/hud/Controls'
import { HudPanel } from '@/hud/HudFrame'
import { Challenge } from './Challenge'
import { Cockpit } from './Cockpit'
import { EXTRA_DELAY_S } from './engine'
import { LogonStrip } from './LogonStrip'
import { PathView } from './PathView'
import { useCpdlc, useCpdlcState } from './state'
import { Workstation } from './Workstation'

/**
 * The Simulator chapter: a console laid over the 3D stage. Left, the
 * controller workstation and the cockpit display; right, the control deck;
 * the coast and ocean show through in between, with every message packet on
 * its path. Below, the 2D path view, the logon strip and the challenge.
 */
export function CpdlcSimulator() {
  const { engine, clock } = useCpdlc()
  useSimulationLoop(clock, (dt) => engine.step(dt))

  return (
    <div className="flex flex-col gap-4">
      <div className="hud-panel rounded-md px-5 py-4 md:w-fit md:max-w-[520px]">
        <ChapterHead
          n={2}
          title="Simulator"
          lead="You are the controller at XLAB and the pilot of CNS123. Every message crosses the table behind as a packet on its path."
        />
      </div>
      <div className="grid gap-4 md:grid-cols-[minmax(0,420px)_1fr_minmax(0,340px)]">
        <div className="flex min-w-0 flex-col gap-4">
          <HudPanel index="ATC" title="Controller workstation">
            <Workstation />
          </HudPanel>
          <HudPanel index="DCDU" title="Cockpit data link display" bodyClassName="p-3">
            <p className="mb-2 text-[11.5px] leading-4 text-muted-foreground">And you are the pilot of CNS123.</p>
            <Cockpit />
          </HudPanel>
        </div>
        <div aria-hidden className="hidden md:block" />
        <CpdlcControls />
      </div>
      <HudPanel index="NET" title="Network map" bodyClassName="p-3">
        <PathView />
      </HudPanel>
      <LogonStrip />
      <Challenge />
    </div>
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-[11.5px] leading-4 text-muted-foreground">{children}</p>
}

function CpdlcControls() {
  const { clock } = useCpdlc()
  const standard = useCpdlcState((s) => s.standard)
  const path = useCpdlcState((s) => s.path)
  const rcp = useCpdlcState((s) => s.rcp)
  const env = useCpdlcState((s) => s.env)
  const { setStandard, setPath, setRcp, setEnv, resetAll } = useCpdlcState((s) => s)
  const running = useClock(clock, (s) => s.running)
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <HudPanel index="CLK" title="Time" bodyClassName="flex flex-col gap-2 p-3">
        <ClockControls clock={clock} onReset={resetAll} />
        <div className="flex flex-wrap items-center gap-2">
          <ClockSpeedLabel clock={clock} />
          {!running && <span className="text-xs text-muted-foreground">Paused: no message moves and no timer runs.</span>}
        </div>
      </HudPanel>

      <HudPanel index="DL" title="Data link" bodyClassName="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-1.5">
          <Segmented
            label="Standard"
            value={standard}
            onChange={setStandard}
            options={[
              { value: 'fans', label: 'FANS 1/A' },
              { value: 'atn', label: 'ATN B1' },
            ]}
          />
          <Hint>
            {standard === 'fans' ? (
              <>
                <Term id="fans-1a">FANS 1/A</Term>, used over oceans: messages travel over <Term id="acars">ACARS</Term> by VHF, satellite or HF.
              </>
            ) : (
              <>
                <Term id="atn-b1">ATN Baseline 1</Term>, used in European airspace: messages travel over <Term id="vdl-mode-2">VDL Mode 2</Term> only.
                Changing the standard restarts the scenario.
              </>
            )}
          </Hint>
        </div>
        <div className="flex flex-col gap-1.5">
          <Segmented<DataLinkPath>
            label="Path to the aircraft"
            value={path}
            onChange={setPath}
            options={
              standard === 'fans'
                ? [
                    { value: 'vhf', label: 'VHF' },
                    { value: 'satcom', label: 'SATCOM' },
                    { value: 'hf', label: 'HF' },
                  ]
                : [{ value: 'vhf', label: 'VDL Mode 2' }]
            }
          />
          <Hint>{path === 'vhf' ? 'Quick, but only within radio range of a ground station.' : path === 'satcom' ? 'Reaches the middle of the ocean, a little slower.' : 'Reaches almost anywhere, but slowest.'}</Hint>
        </div>
        <div className="flex flex-col gap-1.5">
          <Segmented<string>
            label={<Term id="rcp">Required performance</Term>}
            value={String(rcp)}
            onChange={(v) => setRcp(Number(v) as RcpType)}
            options={[
              { value: '240', label: 'RCP 240' },
              { value: '400', label: 'RCP 400' },
            ]}
          />
          <Hint>{rcp === 240 ? 'Instruction and answer within 240 s (210 s for 95 %).' : 'Instruction and answer within 400 s.'}</Hint>
        </div>
      </HudPanel>

      <HudPanel index="ENV" title="Things that go wrong" bodyClassName="px-4 py-2">
        <LeverSwitch label="Message delay" hint={`The network is congested: about ${EXTRA_DELAY_S} s more per message`} checked={env.delay} onChange={(v) => setEnv('delay', v)} />
        <LeverSwitch label="Lost connection" hint="The data link fails: fall back to voice" checked={env.lost} onChange={(v) => setEnv('lost', v)} />
        <LeverSwitch label="Message to the wrong aircraft" hint="CNS132 logs on as CNS123 by mistake" checked={env.wrongAircraft} onChange={(v) => setEnv('wrongAircraft', v)} />
      </HudPanel>
    </div>
  )
}
