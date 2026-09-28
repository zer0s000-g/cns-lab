import { lazy } from 'react'
import { Link } from 'react-router'
import { ModuleLayout, type StageSpec } from '@/components/module/ModuleLayout'
import { useClock } from '@/hooks/useSimClock'
import { useSampled } from '@/hooks/useSampled'
import { TelemetryRow } from '@/hud/Telemetry'
import { HEIGHT_EXAGGERATION, TABLE_RADIUS_NM } from '@/stage/scale'
import type { FailureItem } from '@/components/module/FailureList'
import type { Experiment } from '@/components/module/TryThis'
import type { QuizQuestion } from '@/components/module/Quiz'
import type { Step } from '@/components/module/Stepper'
import { Term } from '@/components/Term'
import Deeper from './deeper.mdx'
import { SCENARIO_TEXT } from './Panels'
import { SandboxSimulator } from './Simulator'
import { SandboxProvider, useSandbox, useSandboxState } from './state'
import { FusionVisual, JourneyVisual, RedundancyVisual, SafetyNetVisual, TrackVisual } from './visuals'
import type { ScenarioId } from './engine'
import { SYSTEMS } from './systems'

// The 3D scene is its own chunk, so the page text appears before three.js loads.
const SandboxHero = lazy(() => import('./Hero3D'))

const SHOTS: StageSpec['shots'] = {
  idea: { position: [12, 10, 16], target: [-2.6, 0.6, 0.4], fov: 36 },
  simulator: { position: [0, 22, 14], target: [0, 0, 1], fov: 38 },
  how: { position: [6, 5.5, 9], target: [-2.2, 0.6, 0], fov: 38 },
  try: { position: [-9, 10, 15], target: [-4, 0.5, 0], fov: 36 },
  wrong: { position: [-14, 9, 8], target: [-6, 0.5, -1], fov: 36 },
  deeper: { position: [18, 10, 18], target: [-3, 0, 2], fov: 30 },
  quiz: { position: [-4, 30, 0.1], target: [-4, 0, 0], fov: 34 },
}

function SandboxTelemetry() {
  const { engine } = useSandbox()
  const t = useSampled(
    () => ({
      n: engine.aircraft.length,
      alerts: engine.alerts.length,
      down: SYSTEMS.filter((x) => !engine.systemUp(x.id)).length,
    }),
    400,
    (a, b) => a.n === b.n && a.alerts === b.alerts && a.down === b.down,
  )
  return (
    <div className="hud-panel flex flex-col rounded-md px-3.5 py-2.5">
      <TelemetryRow label="Aircraft" value={t.n} />
      <TelemetryRow label="Safety-net alerts" value={t.alerts} tone={t.alerts ? 'alert' : 'default'} />
      <TelemetryRow label="Systems off" value={`${t.down}/${SYSTEMS.length}`} tone={t.down ? 'brass' : 'default'} />
    </div>
  )
}

const steps: Step[] = [
  {
    title: 'Many sensors, one picture',
    body: (
      <>
        <p>
          Every aircraft is seen by several systems at once: primary and secondary radar, ADS-B, multilateration and, over
          the ocean, ADS-C. Each has its own strengths, update rate and blind spots.
        </p>
        <p>
          A computer called the tracker merges them. This is <Term id="data-fusion">data fusion</Term>: the controller sees one
          label per aircraft, not five.
        </p>
      </>
    ),
    visual: <FusionVisual />,
  },
  {
    title: 'Tracks predict and coast',
    body: (
      <>
        <p>
          The tracker keeps a <Term id="track">track</Term> for each aircraft: where it is, where it is going and how sure it
          is. Each new report nudges the track; precise reports nudge it more.
        </p>
        <p>
          If reports stop, the track <Term id="coasting">coasts</Term> along its prediction for a short time, marked as
          such, and is then dropped.
        </p>
      </>
    ),
    visual: <TrackVisual />,
  },
  {
    title: 'Safety nets watch the tracks',
    body: (
      <p>
        Two automatic <Term id="safety-net">safety nets</Term> look a minute or two ahead. <Term id="stca">STCA</Term> warns
        when two aircraft are about to come too close. <Term id="msaw">MSAW</Term> warns when an aircraft is heading too low
        over the terrain. The controller then gives an instruction at once.
      </p>
    ),
    visual: <SafetyNetVisual />,
  },
  {
    title: 'Overlapping layers',
    body: (
      <p>
        Systems overlap on purpose. When one fails, the others carry on and the picture stays usable: this is{' '}
        <Term id="graceful-degradation">graceful degradation</Term>. Controllers and pilots also have procedures for each
        failure, like switching to standby radios or navigating by VOR/DME when GNSS is jammed.
      </p>
    ),
    visual: <RedundancyVisual />,
  },
  {
    title: 'Different systems at each stage',
    body: (
      <p>
        Near the airport the aircraft is watched by radar, ADS-B and multilateration and talks by VHF. Over the ocean,
        beyond the reach of ground stations, it reports by satellite (ADS-C and CPDLC) or HF. Coming home it lands on the
        ILS. The timeline in the simulator shows this for every minute of the flight.
      </p>
    ),
    visual: <JourneyVisual />,
  },
]

const quiz: QuizQuestion[] = [
  {
    question: 'The radars fail. Why do most aircraft stay on the controller’s screen?',
    options: ['The screen freezes the last picture', 'ADS-B and multilateration still report them', 'Pilots read out their positions', 'The radar has batteries'],
    answer: 1,
    explanation:
      'ADS-B comes from the aircraft itself and multilateration times the transponder signals, so neither needs the radar. Only an aircraft with no transponder would vanish.',
  },
  {
    question: 'GNSS is jammed near the airport. Which of these still gives the controller a position?',
    options: ['ADS-B', 'Secondary radar', 'RNP approach', 'None of them'],
    answer: 1,
    explanation:
      'Secondary radar measures the reply time and the antenna direction itself. ADS-B broadcasts the aircraft’s GNSS position, so it fails with GNSS.',
  },
  {
    question: 'What does STCA warn the controller about?',
    options: ['An aircraft flying into a hill', 'Two aircraft predicted to come too close', 'A radio failure', 'Bad weather ahead'],
    answer: 1,
    explanation: 'Short-term conflict alert predicts pairs of tracks a minute or two ahead. MSAW is the one that watches the terrain.',
  },
  {
    question: 'Far out over the ocean, how does the controller get CNS700’s position?',
    options: ['Approach radar', 'VHF voice every minute', 'ADS-C reports via satellite every few minutes', 'Multilateration'],
    answer: 2,
    explanation:
      'Ground radar, ADS-B stations and VHF only reach a few hundred miles. ADS-C reports travel via a geostationary satellite, so they work over the ocean, but they arrive every few minutes and with a delay.',
  },
  {
    question: 'Why does a track keep moving for a while after the data stops?',
    options: ['It is a display bug', 'The tracker predicts it along its last known speed and direction', 'The aircraft sends a final message', 'The controller moves it by hand'],
    answer: 1,
    explanation:
      'The tracker knows the aircraft’s velocity, so it can predict where it should be. It marks the track as coasting and drops it if no data arrives within about a minute.',
  },
]

const SCENARIO_ORDER: Exclude<ScenarioId, 'normal'>[] = ['radarOutage', 'gnssJam', 'vhfFail', 'mountain']

function SandboxPage() {
  const { engine, store, clock } = useSandbox()
  const scenario = useSandboxState((s) => s.scenario)
  const running = useClock(clock, (c) => c.running)
  const speed = useClock(clock, (c) => c.speed)
  const s = store.getState()

  const stage: StageSpec = {
    scene: (t) => <SandboxHero t={t} engine={engine} />,
    shots: SHOTS,
    labels: [
      `Terminal area · table ${TABLE_RADIUS_NM * 2} NM across · heights ×${Math.round(HEIGHT_EXAGGERATION * 10) / 10}`,
      'Masts and aircraft larger than life · the ocean crossing is off the table',
      `Time ×${speed}`,
    ],
    telemetry: <SandboxTelemetry />,
    clock: { getTimeS: () => engine.timeS, running, sub: 'Journey time' },
    label: 'A tabletop model of the terminal area: the approach and en-route radars turning, ADS-B, WAM, VOR/DME and VHF sites with status lamps, and the aircraft of the sandbox with safety-net alerts ringed in red.',
  }

  const experiments: Experiment[] = [
    {
      id: 'off',
      question: 'When does an aircraft finally disappear from the controller’s screen?',
      action: (
        <p>
          Select CNS700 near the airport. In the Systems list, switch off surveillance systems one at a time: approach radar,
          en-route radar, ADS-B, WAM. Watch its symbol and the sources panel after each one.
        </p>
      ),
      setup: () => {
        s.resetAll()
        s.setView('terminal')
        s.select('CNS700')
      },
      notice: (
        <p>
          The symbol changes as sources drop out, but the track stays until the very last source is gone. Then it coasts
          (dashed circle) for about a minute and disappears. No single failure makes it vanish: that is redundancy.
        </p>
      ),
    },
    {
      id: 'jam',
      question: 'GNSS is jammed. What still works?',
      action: <p>Choose the GNSS jamming scenario and read the sources and on-board panels for CNS700 and for CNS833.</p>,
      setup: () => {
        s.setScenario('gnssJam')
        s.setView('terminal')
        s.select('CNS700')
      },
      notice: (
        <p>
          ADS-B positions and GNSS navigation stop inside the red circle. Secondary radar, primary radar and WAM keep
          tracking, and on board VOR/DME, ILS and the inertial system still work. The timeline shows the gap in ADS-B and
          GNSS near the airport.
        </p>
      ),
    },
    {
      id: 'stca',
      question: 'Can the system spot a collision course before the controller does?',
      action: <p>Add two aircraft on a collision course and watch the safety-nets panel. Then give the climb instruction.</p>,
      setup: () => {
        engine.spawnConflict()
        s.setView('terminal')
        s.select('CNS9A')
      },
      notice: (
        <p>
          STCA fires about two minutes before the aircraft would meet, while they are still more than 3 NM apart, and both
          labels turn to alert. After "climb 2,000 ft" the predicted vertical distance grows past 1,000 ft and the alert
          clears.
        </p>
      ),
    },
    {
      id: 'ocean',
      question: 'What happens to surveillance over the ocean?',
      action: (
        <p>
          Switch to the ocean view, follow CNS700 and watch the sources panel as it leaves the coast. Then switch ADS-C off.
        </p>
      ),
      setup: () => {
        s.setView('ocean')
        s.setFollow(true)
        s.select('CNS700')
        const a = engine.getAircraft('CNS700')
        if (a?.journey) {
          engine.setAircraft('CNS700', {
            journey: { ...a.journey, legIndex: 3, phase: 'plan' },
            pos: { x: 150, y: 9 },
            altitudeFt: 35000,
            targetAltitudeFt: 35000,
            headingDeg: 90,
            speedKt: 460,
            targetSpeedKt: 460,
          })
        }
      },
      setupLabel: 'Jump to the ocean crossing',
      notice: (
        <p>
          Past about 250 NM from the coast the ADS-B and radar sources fall away and only ADS-C remains: a new position every
          few minutes, arriving after a satellite delay. Without ADS-C the track is lost, and the controller would fall back
          to <Term id="procedural-separation">procedural separation</Term> using position reports by HF or CPDLC.
        </p>
      ),
    },
  ]

  const failures: FailureItem[] = SCENARIO_ORDER.map((id) => ({
    id,
    title: SCENARIO_TEXT[id].title,
    explanation: (
      <>
        <p>
          <strong>Fails:</strong> {SCENARIO_TEXT[id].fails}
        </p>
        <p>
          <strong>Still works:</strong> {SCENARIO_TEXT[id].works}
        </p>
      </>
    ),
    watch: `Controller: ${SCENARIO_TEXT[id].controller}`,
    checked: scenario === id,
    onChange: (v: boolean) => s.setScenario(v ? id : 'normal'),
  }))

  return (
    <ModuleLayout
      moduleId="sandbox"
      stage={stage}
      idea={{
        analogy: (
          <p>
            Think of an orchestra. Each instrument plays its own part, and together they make the music. If one violin
            breaks a string, the music continues: the others are still playing. Air traffic management works the same way.
          </p>
        ),
        what: (
          <>
            <p>
              No single system does everything. Controllers rely on many overlapping systems at once: radars and ADS-B to see,
              VOR, DME, ILS and GNSS to guide, VHF, data link and satellites to talk.
            </p>
            <p>
              This sandbox puts every system from CNS Lab on one map, flies an aircraft on a complete journey, and lets you
              break things to see how the combination keeps traffic safe.
            </p>
          </>
        ),
        where: (
          <ul>
            <li>In every approach and area control centre: the controller’s screen is always a fused picture.</li>
            <li>Over oceans, where satellite links replace radar and VHF.</li>
            <li>In safety cases: engineers show that no single failure makes aircraft disappear.</li>
          </ul>
        ),
      }}
      simulator={<SandboxSimulator />}
      howItWorks={steps}
      tryThis={experiments}
      failures={failures}
      failuresNote={
        <p>
          Each scenario is also available from the buttons above the simulator. For every system on its own, visit its module
          from the Systems list or the <Link to="/">home page</Link>.
        </p>
      }
      goDeeper={<Deeper />}
      quiz={quiz}
    />
  )
}

export default function Sandbox() {
  return (
    <SandboxProvider>
      <SandboxPage />
    </SandboxProvider>
  )
}
