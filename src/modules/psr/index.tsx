import { lazy } from 'react'
import { Link } from 'react-router'
import { ModuleLayout } from '@/components/module/ModuleLayout'
import type { FailureItem } from '@/components/module/FailureList'
import type { Experiment } from '@/components/module/TryThis'
import type { QuizQuestion } from '@/components/module/Quiz'
import type { Step } from '@/components/module/Stepper'
import { Term } from '@/components/Term'
import { maxUnambiguousRangeNm } from '@/core/radar'
import { useClock } from '@/hooks/useSimClock'
import { useSampled } from '@/hooks/useSampled'
import { BarMeter, TelemetryRow } from '@/hud/Telemetry'
import type { StageSpec } from '@/components/module/ModuleLayout'
import { HEIGHT_EXAGGERATION, TABLE_RADIUS_NM } from '@/stage/scale'

// The 3D scene is its own chunk, so the page text appears before three.js loads.
const PsrHero = lazy(() => import('./Hero3D'))

/** Honesty label: what is to scale on the table and what is not. */
const tableScaleLabel = `Table ${TABLE_RADIUS_NM * 2} NM across · heights ×${Math.round(HEIGHT_EXAGGERATION * 10) / 10} · radar and aircraft larger than life`
import Deeper from './deeper.mdx'
import { PsrSimulator } from './Simulator'
import { PsrProvider, usePsr, usePsrState } from './state'
import { DirectionVisual, EchoVisual, LimitsVisual, PulseOutVisual, ScreenVisual, TimingVisual } from './visuals'

const steps: Step[] = [
  {
    title: 'Send a pulse',
    body: (
      <>
        <p>
          The radar's transmitter fires a very short burst of radio energy, a <Term id="pulse">pulse</Term>. The curved
          antenna focuses it into a narrow <Term id="beam-width">beam</Term>, like a flashlight instead of a bare bulb.
        </p>
        <p>It does this about a thousand times every second.</p>
      </>
    ),
    visual: <PulseOutVisual />,
  },
  {
    title: 'Listen for the echo',
    body: (
      <>
        <p>
          When the pulse hits an aircraft, a tiny part of it bounces back: the <Term id="echo">echo</Term>. Between
          pulses the radar switches from shouting to listening.
        </p>
        <p>The aircraft does nothing to help. Even a switched-off aircraft reflects the pulse.</p>
      </>
    ),
    visual: <EchoVisual />,
  },
  {
    title: 'Turn time into distance',
    body: (
      <>
        <p>
          Radio travels at the <Term id="speed-of-light">speed of light</Term>. The radar measures how long the echo took and
          halves it, because the signal went there <em>and</em> back.
        </p>
        <p>A longer wait means a more distant aircraft.</p>
      </>
    ),
    visual: <TimingVisual />,
  },
  {
    title: 'Point the direction',
    body: (
      <p>
        The antenna turns steadily, like a lighthouse. The direction it points when the echo comes back is the
        aircraft's <Term id="bearing">bearing</Term>. One full turn takes a few seconds, so each aircraft is looked at
        once per turn.
      </p>
    ),
    visual: <DirectionVisual />,
  },
  {
    title: 'Paint the screen',
    body: (
      <p>
        Distance and direction together give a spot on the round screen, the <Term id="ppi">PPI</Term>. The{' '}
        <Term id="sweep">sweep</Term> line shows where the antenna points. Each <Term id="blip">blip</Term> glows and
        slowly fades until the sweep comes round again.
      </p>
    ),
    visual: <ScreenVisual />,
  },
  {
    title: 'Know its limits',
    body: (
      <>
        <p>
          A primary radar sees anything that reflects: hills, rain, birds and wind farms too. That unwanted mess is called{' '}
          <Term id="clutter">clutter</Term>.
        </p>
        <p>
          And a blip is just a position. It cannot say which aircraft it is, or how high it is flying. That is the job of{' '}
          <Link to="/modules/ssr" className="font-medium text-primary underline underline-offset-2">
            secondary radar
          </Link>
          .
        </p>
      </>
    ),
    visual: <LimitsVisual />,
  },
]

const quiz: QuizQuestion[] = [
  {
    question: 'An echo comes back after 247 microseconds. Roughly how far away is the aircraft?',
    options: ['About 10 NM', 'About 20 NM', 'About 40 NM', 'About 80 NM'],
    answer: 1,
    explanation:
      'Half the time is the trip out: about 123 µs. Radio covers 1 NM in about 6.2 µs, so 123 ÷ 6.2 ≈ 20 NM. Forgetting to halve the time is the classic mistake, and gives 40 NM.',
  },
  {
    question: 'Why can a very high pulse rate make a distant aircraft appear in the wrong place?',
    options: [
      'The pulses are too weak to reach it',
      'Its echo returns after the next pulse left, so the radar times it from the wrong pulse',
      'The antenna turns too fast to see it',
      'The Doppler effect shifts its frequency',
    ],
    answer: 1,
    explanation:
      'The radar starts a new stopwatch with every pulse. An echo that arrives after the next pulse is measured from that newer pulse, so it looks much closer. This is a second-trace echo.',
  },
  {
    question: 'What does the MTI filter remove?',
    options: ['Echoes that do not move, like hills and buildings', 'Echoes from small aircraft', 'Echoes from far away', 'All rain echoes'],
    answer: 0,
    explanation:
      'MTI compares echoes from pulse to pulse and cancels the ones that stay the same. Rain drifts with the wind, so some of it survives, and an aircraft flying straight across the beam can briefly vanish too.',
  },
  {
    question: 'To double the distance at which a radar can see an aircraft, the transmitter power must be multiplied by about…',
    options: ['2', '4', '8', '16'],
    answer: 3,
    explanation:
      'The echo gets weaker with the fourth power of distance (it spreads out on the way there and again on the way back). Twice the distance means 2 × 2 × 2 × 2 = 16 times the power.',
  },
  {
    question: 'A controller sees a blip from the primary radar. What else does the radar tell them about it?',
    options: ['Its callsign', 'Its altitude', 'Nothing: only its position', 'Its destination'],
    answer: 2,
    explanation:
      'Primary radar only knows where something reflected its pulse. Identity and altitude need the aircraft to answer, which is what secondary radar (SSR) does.',
  },
]

const SHOTS: StageSpec['shots'] = {
  idea: { position: [13, 7, 15], target: [0, 1, 0], fov: 32 },
  simulator: { position: [0, 22, 14], target: [0, 0, 1], fov: 38 },
  how: { position: [3.8, 2.3, 5.4], target: [-1.0, 1.25, 0.8], fov: 36 },
  try: { position: [-9, 10, 15], target: [-4, 0.5, 0], fov: 36 },
  wrong: { position: [-14, 9, 8], target: [-6, 0.5, -1], fov: 36 },
  deeper: { position: [18, 10, 18], target: [-3, 0, 2], fov: 30 },
  quiz: { position: [-4, 30, 0.1], target: [-4, 0, 0], fov: 34 },
}

/** Close-ups for the six "How it works" steps. */
const HOW_SHOTS: StageSpec['howShots'] = [
  // 1 Send a pulse: close on the antenna, framed right of the panel.
  { position: [3.8, 2.3, 5.4], target: [-1.0, 1.25, 0.8], fov: 36 },
  // 2 Listen for the echo: antenna and the nearest aircraft.
  { position: [8, 5, 9], target: [-0.5, 0.8, 1.5], fov: 38 },
  // 3 Time into distance: low along the beam.
  { position: [2, 7, 14], target: [-3, 0.4, 2], fov: 36 },
  // 4 Direction: from above and behind, the lighthouse sweep.
  { position: [-4, 9, 9], target: [-2.5, 0.8, 0], fov: 40 },
  // 5 The screen: straight down on the table.
  { position: [-3, 24, 0.1], target: [-3, 0, 0], fov: 36 },
  // 6 Limits: clutter on the hills.
  { position: [-12, 8, -8], target: [-4, 0.5, 0], fov: 36 },
]

function PsrTelemetry() {
  const { engine } = usePsr()
  const params = usePsrState((s) => s.params)
  const seen = useSampled(() => {
    const n = engine.aircraft.length
    const k = engine.aircraft.filter((a) => engine.lastLook.get(a.id)?.detected).length
    return { n, k, az: Math.round(engine.antennaAz) }
  }, 250)
  return (
    <div className="hud-panel flex flex-col rounded-md px-3.5 py-2.5">
      <TelemetryRow label="Antenna" value={String(seen.az).padStart(3, '0')} unit="°" tone="signal" />
      <TelemetryRow label="Turn" value={params.rotationPeriodS.toFixed(1)} unit="s" />
      <TelemetryRow label="Pulse rate" value={params.prfHz} unit="/s" />
      <TelemetryRow label="Painted" value={`${seen.k}/${seen.n}`} />
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="hud-label">Last turn</span>
        <BarMeter orientation="horizontal" value={seen.n ? seen.k / seen.n : 0} segments={14} label="Share of aircraft painted on the last turn" />
      </div>
    </div>
  )
}

function PsrPage() {
  const { engine, store, clock, replayRef } = usePsr()
  const env = usePsrState((s) => s.env)
  const params = usePsrState((s) => s.params)
  const replaying = usePsrState((s) => s.pulse.phase === 'replay')
  const running = useClock(clock, (c) => c.running)
  const s = store.getState()

  const stage: StageSpec = {
    scene: (t) => <PsrHero t={t} engine={engine} replayRef={replayRef} />,
    shots: SHOTS,
    howShots: HOW_SHOTS,
    kicker: 'S-band · about 2.8 GHz',
    labels: [tableScaleLabel, ...(replaying ? ['Slowed down so you can see it · the world is frozen'] : [])],
    telemetry: <PsrTelemetry />,
    clock: { getTimeS: () => engine.timeS, running, sub: replaying ? 'Pulse replay' : 'Sim time' },
    label: 'A tabletop model of the airspace: a primary radar on a hill sweeps its beam over the terrain; aircraft fly above it and flash when the beam paints them.',
  }

  const experiments: Experiment[] = [
    {
      id: 'prf',
      question: 'What happens if the radar sends pulses too quickly?',
      action: (
        <p>
          Raise the pulse rate to about 3,000 per second and watch the heavy jet CNS202, far out at 35,000 ft. Compare the
          truth map with the radar screen.
        </p>
      ),
      setup: () => {
        s.setParam('prfHz', 3000)
        s.select('CNS202')
        engine.setAircraft('CNS202', { pos: { x: 44, y: 20 } })
        store.getState().setScopeRange(60)
      },
      notice: (
        <p>
          At 3,000 pulses per second the radar only waits long enough for echoes from about{' '}
          {Math.round(maxUnambiguousRangeNm(3000))} NM. CNS202's echo arrives after the next pulse has already left, so
          the radar draws it much closer than it really is: a second-trace echo. Use the slow-motion pulse to see the
          timing.
        </p>
      ),
    },
    {
      id: 'rain',
      question: 'Can a radar tell rain from aircraft?',
      action: <p>Turn on the rain shower and look at the screen. Then switch on the MTI filter and compare.</p>,
      setup: () => {
        s.setEnv('rain', true)
        s.setEnv('mti', false)
        s.setEnv('groundClutter', true)
      },
      notice: (
        <p>
          Rain paints a big pale patch that can hide aircraft inside it. MTI removes the ground clutter almost completely,
          but only weakens the rain, because the rain is drifting with the wind and so it is "moving".
        </p>
      ),
    },
    {
      id: 'mountain',
      question: 'Can the radar see behind a mountain?',
      action: (
        <p>
          We will put CNS505 low, at 3,000 ft, flying north behind Mount Sentinel. Watch its blip as it passes behind the
          hill. Then climb it to 10,000 ft.
        </p>
      ),
      setup: () => {
        s.select('CNS505')
        s.setShowCoverage(true)
        engine.setAircraft('CNS505', {
          pos: { x: -26, y: 3 },
          headingDeg: 0,
          targetHeadingDeg: 0,
          altitudeFt: 3000,
          targetAltitudeFt: 3000,
          speedKt: 240,
          targetSpeedKt: 240,
          mode: { kind: 'heading' },
        })
      },
      notice: (
        <p>
          Radio travels in straight lines. While the hill is between the radar and the aircraft, there is no echo and the
          blip disappears. The shaded area on the map shows everywhere the radar is blind at that altitude. Climbing puts
          the aircraft back in view.
        </p>
      ),
    },
    {
      id: 'rotation',
      question: 'Why do blips move in jumps?',
      action: <p>Slow the antenna down to a 12-second turn, like an en-route radar, and watch a fast jet.</p>,
      setup: () => {
        s.setParam('rotationPeriodS', 12)
        s.select('CNS202')
      },
      notice: (
        <p>
          The radar only looks at each aircraft once per turn. With a 12-second turn, a jet at 460 kt moves about 1.5 NM
          between looks, so the blip jumps. Faster turns give smoother tracks but fewer pulses per look.
        </p>
      ),
    },
    {
      id: 'identity',
      question: 'Which aircraft is which, and how high?',
      action: <p>Look only at the radar screen. Try to say which blip is CNS101 and how high it is.</p>,
      notice: (
        <p>
          You cannot. A primary radar only knows that something reflected its pulse there. The next module,{' '}
          <Link to="/modules/ssr" className="font-medium text-primary underline underline-offset-2">
            secondary radar
          </Link>
          , asks each aircraft to answer with its identity and altitude.
        </p>
      ),
    },
  ]

  const failures: FailureItem[] = [
    {
      id: 'ground',
      title: 'Ground clutter',
      explanation: (
        <p>
          Hills, trees and buildings reflect the pulse too. Close to the radar, and on hillsides facing it, they paint a
          bright speckled mess that can hide aircraft.
        </p>
      ),
      watch: 'grey speckle around the radar and on Mount Sentinel and the North Range.',
      checked: env.groundClutter,
      onChange: (v) => s.setEnv('groundClutter', v),
    },
    {
      id: 'rain',
      title: 'Weather clutter (rain)',
      explanation: <p>Rain drops reflect radio waves. A shower appears as a pale patch that drifts with the wind.</p>,
      watch: 'the pale patch south-east of the radar.',
      checked: env.rain,
      onChange: (v) => s.setEnv('rain', v),
    },
    {
      id: 'birds',
      title: 'Birds',
      explanation: <p>A flock of birds is small but close, so it echoes. Birds move, so MTI does not remove them.</p>,
      watch: 'faint wandering blips north-east of the airport.',
      checked: env.birds,
      onChange: (v) => s.setEnv('birds', v),
    },
    {
      id: 'windfarm',
      title: 'Wind farm',
      explanation: (
        <p>
          The towers stand still, but the spinning blades move fast. MTI removes the towers and keeps the blades, which
          flicker like false aircraft.
        </p>
      ),
      watch: 'a flickering cluster east of the radar.',
      checked: env.windFarm,
      onChange: (v) => s.setEnv('windFarm', v),
    },
    {
      id: 'small',
      title: 'A small aircraft far away',
      explanation: (
        <p>
          A small aircraft has a small <Term id="rcs">radar cross section</Term>. Far away its echo is so weak that the
          radar misses it on some turns: the blip flickers or disappears.
        </p>
      ),
      watch: 'CNS404 far out over the sea.',
      checked: env.smallFar,
      onChange: (v) => s.setEnv('smallFar', v),
    },
    {
      id: 'prf',
      title: 'Pulse rate too high (second-trace echoes)',
      explanation: (
        <p>
          Sending pulses faster gives more hits, but echoes from very far away come back after the next pulse and are
          drawn much too close.
        </p>
      ),
      watch: 'a distant jet appearing close to the radar.',
      checked: params.prfHz >= 2000,
      onChange: (v) => s.setParam('prfHz', v ? 3000 : 1000),
    },
    {
      id: 'mti',
      title: 'The fix: MTI filter',
      explanation: (
        <p>
          <Term id="mti">Moving target indication</Term> keeps only echoes that change between pulses. It clears the ground
          clutter, weakens rain and hides the wind-farm towers, but an aircraft flying straight across the beam can briefly
          vanish too, because it has no <Term id="radial-speed">radial speed</Term>.
        </p>
      ),
      checked: env.mti,
      onChange: (v) => s.setEnv('mti', v),
      kind: 'fix',
    },
  ]

  return (
    <ModuleLayout
      moduleId="psr"
      stage={stage}
      nextId="ssr"
      idea={{
        analogy: (
          <p>
            Imagine standing in a dark field with a flashlight that you sweep slowly around you. Anything the beam hits
            shines back. You know <strong>where</strong> it is from the direction you are pointing and how long the light
            took to return, but you have no idea <strong>what</strong> it is. A bat does the same with sound.
          </p>
        ),
        what: (
          <>
            <p>
              A <Term id="psr">primary surveillance radar</Term> sends out short <Term id="pulse">pulses</Term> of radio
              energy and listens for the <Term id="echo">echoes</Term>. The time until an echo returns gives the distance.
              The direction the antenna points gives the bearing.
            </p>
            <p>
              It works even if the aircraft does not cooperate at all: no radio, no special equipment. That is why air
              forces and airports still use it, alongside the secondary radar that aircraft answer.
            </p>
          </>
        ),
        where: (
          <ul>
            <li>At almost every large airport: the rotating antenna you can often see from the terminal.</li>
            <li>For en-route airspace, with bigger antennas that see 200 NM and more.</li>
            <li>For air defence and for spotting aircraft that have switched off their transponder.</li>
          </ul>
        ),
      }}
      simulator={<PsrSimulator />}
      howItWorks={steps}
      tryThis={experiments}
      failures={failures}
      goDeeper={<Deeper />}
      quiz={quiz}
    />
  )
}

export default function PsrModule() {
  return (
    <PsrProvider>
      <PsrPage />
    </PsrProvider>
  )
}
