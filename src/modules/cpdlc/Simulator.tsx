import { ClockControls, ClockSpeedLabel, ControlChoice, ControlGroup, ControlSwitch, ControlsPanel } from '@/components/sim/Controls'
import { Term } from '@/components/Term'
import type { DataLinkPath, RcpType } from '@/core/cpdlc'
import { useClock, useSimulationLoop } from '@/hooks/useSimClock'
import { Challenge } from './Challenge'
import { Cockpit } from './Cockpit'
import { EXTRA_DELAY_S } from './engine'
import { LogonStrip } from './LogonStrip'
import { PathView } from './PathView'
import { useCpdlc, useCpdlcState } from './state'
import { Workstation } from './Workstation'

export function CpdlcSimulator() {
  const { engine, clock } = useCpdlc()
  useSimulationLoop(clock, (dt) => engine.step(dt))

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <figure className="flex min-w-0 flex-col gap-2">
            <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-semibold">Controller workstation</span>
              <span className="text-xs text-muted-foreground">You are the controller</span>
            </figcaption>
            <Workstation />
          </figure>
          <figure className="flex min-w-0 flex-col gap-2">
            <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-semibold">Cockpit data link display</span>
              <span className="text-xs text-muted-foreground">And you are the pilot of CNS123</span>
            </figcaption>
            <Cockpit />
          </figure>
        </div>
        <PathView />
        <LogonStrip />
        <Challenge />
      </div>
      <CpdlcControls />
    </div>
  )
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
    <ControlsPanel className="h-fit xl:sticky xl:top-20">
      <ControlGroup title="Time">
        <ClockControls clock={clock} onReset={resetAll} />
        <div className="flex flex-wrap items-center gap-2">
          <ClockSpeedLabel clock={clock} />
          {!running && <span className="text-xs text-muted-foreground">Paused: no message moves and no timer runs.</span>}
        </div>
      </ControlGroup>

      <ControlGroup title="Data link">
        <ControlChoice
          label="Standard"
          value={standard}
          onChange={setStandard}
          options={[
            { value: 'fans', label: 'FANS 1/A' },
            { value: 'atn', label: 'ATN B1' },
          ]}
          hint={
            standard === 'fans' ? (
              <>
                <Term id="fans-1a">FANS 1/A</Term>, used over oceans: messages travel over <Term id="acars">ACARS</Term> by VHF, satellite or HF.
              </>
            ) : (
              <>
                <Term id="atn-b1">ATN Baseline 1</Term>, used in European airspace: messages travel over <Term id="vdl-mode-2">VDL Mode 2</Term> only.
                Changing the standard restarts the scenario.
              </>
            )
          }
        />
        <ControlChoice<DataLinkPath>
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
          hint={path === 'vhf' ? 'Quick, but only within radio range of a ground station.' : path === 'satcom' ? 'Reaches the middle of the ocean, a little slower.' : 'Reaches almost anywhere, but slowest.'}
        />
        <ControlChoice<string>
          label={<Term id="rcp">Required performance</Term>}
          value={String(rcp)}
          onChange={(v) => setRcp(Number(v) as RcpType)}
          options={[
            { value: '240', label: 'RCP 240' },
            { value: '400', label: 'RCP 400' },
          ]}
          hint={rcp === 240 ? 'Instruction and answer within 240 s (210 s for 95 %).' : 'Instruction and answer within 400 s.'}
        />
      </ControlGroup>

      <ControlGroup title="Things that go wrong">
        <ControlSwitch label="Message delay" hint={`The network is congested: about ${EXTRA_DELAY_S} s more per message`} checked={env.delay} onChange={(v) => setEnv('delay', v)} />
        <ControlSwitch label="Lost connection" hint="The data link fails: fall back to voice" checked={env.lost} onChange={(v) => setEnv('lost', v)} />
        <ControlSwitch label="Message to the wrong aircraft" hint="CNS132 logs on as CNS123 by mistake" checked={env.wrongAircraft} onChange={(v) => setEnv('wrongAircraft', v)} />
      </ControlGroup>
    </ControlsPanel>
  )
}
