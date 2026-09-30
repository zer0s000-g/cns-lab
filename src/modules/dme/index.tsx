import { Link } from 'react-router'
import { lazyRetry } from '@/lib/lazyRetry'
import { ModuleLayout, type StageSpec } from '@/components/module/ModuleLayout'
import type { FailureItem } from '@/components/module/FailureList'
import type { Experiment } from '@/components/module/TryThis'
import type { QuizQuestion } from '@/components/module/Quiz'
import type { Step } from '@/components/module/Stepper'
import { Term } from '@/components/Term'
import { DME_BAND_MHZ, DME_TRANSPONDER } from '@/core/dme'
import { useClock } from '@/hooks/useSimClock'
import { useSampled } from '@/hooks/useSampled'
import { TelemetryRow } from '@/hud/Telemetry'
import { HEIGHT_EXAGGERATION, TABLE_RADIUS_NM, toU } from '@/stage/scale'
import type { Shot } from '@/stage/types'
import Deeper from './deeper.mdx'
import { DEFAULT_ENV, DEFAULT_OWN, STATION } from './engine'
import { DmeSimulator } from './Simulator'
import { DmeProvider, useDme, useDmeState } from './state'
import { AnswerVisual, AskVisual, ManyVisual, MathVisual, SlantVisual, SpeedVisual, WaitVisual } from './visuals'

// The 3D scene is its own chunk, so the page text appears before three.js loads.
const DmeHero = lazyRetry(() => import('./Hero3D'))

/** Honesty labels: what is to scale on the table and what is not. */
const tableScaleLabel = `Table ${TABLE_RADIUS_NM * 2} NM across · heights ×${Math.round(HEIGHT_EXAGGERATION * 10) / 10} · station and aircraft larger than life`
const replayLabel = 'Slowed down so you can see it · the world is frozen'

const steps: Step[] = [
  {
    title: 'Ask the question',
    body: (
      <>
        <p>
          The <Term id="dme-interrogator">DME in the aircraft</Term> sends a very short radio question: two quick <Term id="pulse">pulses</Term>, a{' '}
          <Term id="dme-pulse-pair">pulse pair</Term>. At the same moment it starts a stopwatch.
        </p>
        <p>
          It uses <Term id="uhf">UHF</Term> radio, around 1,000 MHz, which travels in straight lines like light.
        </p>
      </>
    ),
    visual: <AskVisual />,
  },
  {
    title: 'The station waits',
    body: (
      <>
        <p>
          The <Term id="dme-transponder">ground station</Term> hears the question and waits exactly 50{' '}
          <Term id="microsecond">microseconds</Term> before it answers. This <Term id="dme-reply-delay">reply delay</Term> is always the same, so the
          aircraft knows how much of its stopwatch time was just waiting.
        </p>
      </>
    ),
    visual: <WaitVisual />,
  },
  {
    title: 'The answer comes back',
    body: (
      <p>
        The station answers with its own pulse pair, on a frequency 63 MHz away from the question so the two never get mixed up. When the answer arrives,
        the aircraft stops its stopwatch.
      </p>
    ),
    visual: <AnswerVisual />,
  },
  {
    title: 'Turn time into distance',
    body: (
      <>
        <p>
          Take away the fixed wait. What is left is the time the radio took to go there and back, at the <Term id="speed-of-light">speed of light</Term>.
          Halve it and you have the distance.
        </p>
        <p>Every nautical mile there and back takes about 12.36 microseconds.</p>
      </>
    ),
    visual: <MathVisual />,
  },
  {
    title: 'A diagonal distance',
    body: (
      <>
        <p>
          The radio goes in a straight line from the aircraft to the antenna, so the DME measures the <Term id="slant-range">slant range</Term>, the
          diagonal. It is a little longer than the distance over the ground.
        </p>
        <p>Far away the difference is tiny. Right above the station the DME shows your height instead of zero: 6,000 ft is about 1 NM.</p>
      </>
    ),
    visual: <SlantVisual />,
  },
  {
    title: 'Groundspeed from distance',
    body: (
      <p>
        The DME watches how fast the distance changes and shows it as a <Term id="dme-groundspeed">groundspeed</Term> and a time to the station. That is
        only right when you fly straight toward or away from the station. Fly a circle around it and the distance stays the same, so the DME says you are
        barely moving.
      </p>
    ),
    visual: <SpeedVisual />,
  },
  {
    title: 'Sharing one station',
    body: (
      <>
        <p>
          Many aircraft ask the same station at once, and they all hear every answer. Each aircraft spaces its questions randomly (
          <Term id="dme-jitter">jitter</Term>), so only the answers to its own questions come back at the same delay every time.
        </p>
        <p>
          One station can serve about {DME_TRANSPONDER.designAircraft} aircraft. With more, it answers the closest ones first and the farthest lose their
          answers.
        </p>
      </>
    ),
    visual: <ManyVisual />,
  },
]

const quiz: QuizQuestion[] = [
  {
    question: 'On an X channel, the answer arrives 173.6 µs after the question. How far away is the station?',
    options: ['About 7 NM', 'About 10 NM', 'About 14 NM', 'About 20 NM'],
    answer: 1,
    explanation:
      'First take away the station’s fixed 50 µs wait: 123.6 µs are left for the trip there and back. At 12.36 µs per nautical mile that is 10 NM. Forgetting the wait gives 14 NM.',
  },
  {
    question: 'You fly directly over the DME station at 12,000 ft. What does the DME show?',
    options: ['0.0 NM', 'About 1 NM', 'About 2 NM', '12 NM'],
    answer: 2,
    explanation:
      'The DME measures the straight line to the antenna. Right overhead, that line is simply your height: 12,000 ft is almost 2 nautical miles (one NM is about 6,076 ft).',
  },
  {
    question: 'You fly a circle 15 NM around the station at 200 kt. What groundspeed does the DME show?',
    options: ['About 200 kt', 'About 100 kt', 'Almost 0 kt', 'It shows a warning flag'],
    answer: 2,
    explanation:
      'DME groundspeed is how fast the distance to the station changes. On a circle the distance stays the same, so it reads almost zero even though you are flying at 200 kt.',
  },
  {
    question: 'Why does each aircraft space its questions randomly (jitter)?',
    options: [
      'To save power in the transmitter',
      'So it can recognise the answers to its own questions among everyone else’s',
      'So the station can tell which aircraft is closest',
      'To make the signal harder to jam',
    ],
    answer: 1,
    explanation:
      'All aircraft hear every answer the station sends. Answers to your own randomly timed questions always arrive at the same delay after them; everyone else’s arrive at random times, so they never line up.',
  },
  {
    question: 'A station built for about 100 aircraft suddenly has 150 asking. Who loses their answers first?',
    options: ['The aircraft that asked last', 'The aircraft farthest away', 'The aircraft flying highest', 'Everyone equally'],
    answer: 1,
    explanation:
      'The station turns down its receiver sensitivity so it keeps answering the strongest questions, which come from the closest aircraft. The farthest aircraft are the first to lose their DME distance.',
  },
]

type V3 = [number, number, number]
/**
 * A camera shot on `subject` from `offset`, with the subject pushed `shift`
 * units to the right of the frame (the chapter panels sit on the left).
 */
function frame(subject: V3, offset: V3, fov: number, shift = 0): Shot {
  const len = Math.hypot(offset[0], offset[2]) || 1
  // Screen-right for a camera looking along -offset (forward x up, flattened).
  const r: V3 = [offset[2] / len, 0, -offset[0] / len]
  return {
    position: [subject[0] + offset[0], subject[1] + offset[1], subject[2] + offset[2]],
    target: [subject[0] - r[0] * shift, subject[1], subject[2] - r[2] * shift],
    fov,
  }
}

const ST = toU(STATION.pos)
const STN: V3 = [ST[0], 0.22, ST[2]]
const START = toU(DEFAULT_OWN.pos, DEFAULT_OWN.altitudeFt)
/** Halfway along the slant line at the start of the route. */
const MIDDLE: V3 = [(ST[0] + START[0]) / 2, START[1] / 2, (ST[2] + START[2]) / 2]

const SHOTS: StageSpec['shots'] = {
  idea: frame(STN, [-2.6, 1.6, -2.4], 34, 0.6),
  // From behind CNS101's shoulder: the slant line runs up the frame to the station.
  simulator: frame(MIDDLE, [-4, 7, 7], 36, 0),
  how: frame(MIDDLE, [8.6, 4.2, 8.6], 36, 2.6),
  try: frame(MIDDLE, [9.6, 6, 9.6], 36, 3.6),
  wrong: frame(MIDDLE, [9.6, 7, 9.6], 36, 3.2),
  deeper: frame([0, 0, 0], [16, 10, 16], 30, 4),
  quiz: { position: [-4, 30, 0.1], target: [-4, 0, 0], fov: 34 },
}

/**
 * Close-ups for the seven "How it works" steps. Side-on shots from the
 * south-east see the slant-range triangle square on (the route runs south-west
 * to north-east), pushed right of the chapter panel.
 */
const HOW_SHOTS: StageSpec['howShots'] = [
  // 1 Ask the question: side-on to the slant line.
  frame(MIDDLE, [8.6, 4.2, 8.6], 36, 2.6),
  // 2 The station waits: close on the transponder.
  frame(STN, [1.5, 0.9, 1.4], 32, 0.5),
  // 3 The answer comes back: the same line, a little lower.
  frame(MIDDLE, [9, 3, 7.2], 36, 2.6),
  // 4 Time into distance: the whole line.
  frame(MIDDLE, [9, 5, 9], 36, 2.8),
  // 5 A diagonal distance: low and side-on, the triangle.
  frame(MIDDLE, [9, 1.8, 9], 36, 2.8),
  // 6 Groundspeed from distance: high over the route.
  frame([0, 0.3, 0], [6, 10, 6], 38, 2.4),
  // 7 Sharing one station: wide, all the traffic.
  frame([0, 0.5, 0], [9, 12, 9], 38, 3),
]

function DmeTelemetry() {
  const { engine } = useDme()
  const v = useSampled(() => {
    const r = engine.reading()
    return {
      shown: r.distanceNm,
      status: r.status,
      slant: engine.ownSlantNm,
      ground: engine.ownGroundNm,
      height: engine.ownHeightFt,
      eff: engine.heard ? engine.ownEfficiency : 0,
    }
  }, 250)
  return (
    <div className="hud-panel flex flex-col rounded-md px-3.5 py-2.5">
      <TelemetryRow label="DME shows" value={v.shown === null ? '—' : v.shown.toFixed(1)} unit={v.shown === null ? String(v.status) : 'NM'} tone={v.status === 'LOCK' ? 'signal' : 'muted'} />
      <TelemetryRow label="Slant range" value={v.slant.toFixed(1)} unit="NM" />
      <TelemetryRow label="Ground distance" value={v.ground.toFixed(1)} unit="NM" />
      <TelemetryRow label="Height" value={Math.round(v.height / 100) * 100} unit="ft" />
      <TelemetryRow label="Our answers" value={`${Math.round(v.eff * 100)}%`} tone={v.eff < 0.5 ? 'alert' : 'default'} />
    </div>
  )
}

function DmePage() {
  const { engine, store, clock, replayRef } = useDme()
  const env = useDmeState((s) => s.env)
  const s = store.getState()
  const heard = useSampled(() => engine.heard, 300)
  const running = useClock(clock, (c) => c.running)
  const replaying = useDmeState((st) => st.replay.phase === 'replay')

  const stage: StageSpec = {
    scene: (t) => <DmeHero t={t} engine={engine} replayRef={replayRef} />,
    shots: SHOTS,
    howShots: HOW_SHOTS,
    kicker: `UHF · ${DME_BAND_MHZ.min}–${DME_BAND_MHZ.max} MHz`,
    labels: [tableScaleLabel, ...(replaying ? [replayLabel] : [])],
    telemetry: <DmeTelemetry />,
    clock: { getTimeS: () => engine.timeS, running, sub: replaying ? 'Pulse replay' : 'Sim time' },
    label: `A tabletop model of the airspace around the ${STATION.ident} DME ground transponder beside the runway. CNS101 flies above the terrain; a solid cyan line runs straight from the aircraft to the station antenna: the slant range the DME measures. A dashed line on the ground under it is the shorter ground distance. Small darts are the other aircraft sharing the station, bright when it answers them. In slow motion, two question pulses travel along the slant line to the station, it waits, and two answer pulses travel back; the world is frozen while they do.`,
  }

  const experiments: Experiment[] = [
    {
      id: 'overhead',
      question: 'What does the DME show right above the station?',
      action: <p>Fly CNS101 at 6,000 ft straight over the station. Watch the DME distance as you pass overhead.</p>,
      setup: () => {
        s.setMapRange(25)
        engine.placeOverhead(6000, 5, 200)
        engine.assumeLocked()
      },
      notice: (
        <p>
          The distance counts down but stops at about 1.0 NM right over the station, then counts up again. It never reaches zero: 6,000 ft of height is
          about 1 NM, and the DME measures the diagonal to the antenna. The groundspeed also drops to almost nothing overhead, because the distance
          hardly changes there.
        </p>
      ),
    },
    {
      id: 'circle',
      question: 'Can the DME groundspeed be wrong?',
      action: <p>Let CNS101 fly a circle 10 NM around the station at 250 kt. Compare the DME groundspeed with the true groundspeed.</p>,
      setup: () => {
        s.setMapRange(25)
        engine.placeOrbit(10, 8000, 250)
        engine.assumeLocked()
      },
      notice: (
        <p>
          The DME shows about 10.1 NM and a groundspeed of 0 kt, although the aircraft flies at 250 kt. Time to station shows dashes. The DME only knows
          how fast the distance changes, and on a circle it does not change.
        </p>
      ),
    },
    {
      id: 'overload',
      question: 'What happens when too many aircraft ask?',
      action: (
        <p>
          CNS101 is 80 NM out and has a steady DME reading. Now 150 more aircraft start asking the same station. Watch the map and the cockpit DME.
        </p>
      ),
      setup: () => {
        s.setMapRange(100)
        engine.placeFar(80)
        engine.assumeLocked()
        s.setEnv('trafficCount', 150)
      },
      notice: (
        <p>
          The station can only send about 2,700 answers a second. It turns its receiver sensitivity down and keeps answering the closest aircraft (the
          filled dots inside the ring labelled “Answering only within…”). CNS101 is one of the farthest: its DME holds the last reading for a few seconds (MEMORY), then shows
          dashes while it searches. The answers come back once it flies inside the ring.
        </p>
      ),
    },
    {
      id: 'timing',
      question: 'How long does one question and answer take?',
      action: <p>Fire one question from 30 NM in slow motion and read the stopwatch bar.</p>,
      setupLabel: 'Set it up and play it',
      setup: () => {
        engine.placeInbound(30)
        engine.assumeLocked()
        s.requestReplay()
      },
      notice: (
        <p>
          The question needs about 186 µs to reach the station, the station waits 50 µs, and the answer needs another 186 µs: about 421 µs in all, less
          than half a thousandth of a second. (421 − 50) ÷ 12.36 ≈ 30.0 NM, the same number the cockpit DME shows.
        </p>
      ),
    },
    {
      id: 'jitter',
      question: 'How does the DME know which answer is its own?',
      action: (
        <p>
          Look at “Which answer is mine?” with 60 other aircraft asking. Then switch off <Term id="dme-jitter">jitter</Term>.
        </p>
      ),
      setup: () => {
        s.setEnv('noJitter', false)
        s.setEnv('trafficCount', 60)
        engine.placeInbound(30)
        engine.assumeLocked()
      },
      notice: (
        <p>
          The station’s answers to other aircraft land at random delays, so they are scattered. Only CNS101’s own answers come back at the same delay
          every time and build the one tall bar. Without jitter, CNS202 asks exactly in step with CNS101, its answers line up too, and the DME locks onto
          the first line it finds: it shows about half the real distance.
        </p>
      ),
    },
  ]

  const failures: FailureItem[] = [
    {
      id: 'overload',
      title: 'Station overload',
      explanation: (
        <p>
          <Term id="dme-overload">Too many aircraft</Term> ask at once. The station cannot answer everyone, so it lowers its receiver sensitivity and keeps
          answering the closest aircraft. The farthest ones lose their answers first.
        </p>
      ),
      watch: 'the dashed ring on the map, the hollow dots outside it and "Station sends" in the readouts.',
      checked: env.trafficCount > DME_TRANSPONDER.designAircraft,
      onChange: (v) => s.setEnv('trafficCount', v ? 150 : DEFAULT_ENV.trafficCount),
    },
    {
      id: 'los',
      title: 'Out of line of sight',
      explanation: (
        <p>
          DME needs <Term id="line-of-sight">line of sight</Term>. Behind a hill or below the <Term id="radio-horizon">radio horizon</Term> the station
          never hears the question. The DME first holds its last value (<Term id="dme-memory">memory</Term>), then shows dashes while it searches.
        </p>
      ),
      watch: 'CNS101 low behind Mount Sentinel; the red dashed path in both views.',
      checked: !heard,
      onChange: (v) => (v ? engine.placeBehindHill() : engine.placeDefault()),
    },
    {
      id: 'jitter',
      title: "Confusing another aircraft's answers with your own",
      explanation: (
        <p>
          If two aircraft asked at exactly the same steady rate, the answers to the other one would also line up and the DME could lock onto them. Random
          spacing (<Term id="dme-jitter">jitter</Term>) prevents this. Switching this on turns jitter off for CNS101 and a second aircraft, CNS202.
        </p>
      ),
      watch: 'a second tall bar in "Which answer is mine?" and a wrong DME distance.',
      checked: env.noJitter,
      onChange: (v) => s.setEnv('noJitter', v),
    },
  ]

  return (
    <ModuleLayout
      moduleId="dme"
      stage={stage}
      nextId="ils"
      idea={{
        analogy: (
          <p>
            Shout at a cliff and time the echo: the longer you wait, the farther the cliff. DME works the same way, except the cliff is polite. It hears
            your shout, counts to a fixed number, and only then shouts back. You take that pause off your stopwatch and turn the rest into distance.
          </p>
        ),
        what: (
          <>
            <p>
              <Term id="dme">Distance Measuring Equipment</Term> tells the pilot how far the aircraft is from a ground station. The aircraft sends a radio
              question, the station answers after exactly 50 microseconds, and the aircraft turns the total time into nautical miles.
            </p>
            <p>
              The same box also shows how fast that distance is changing and how many minutes it will take to reach the station.
            </p>
          </>
        ),
        where: (
          <ul>
            <li>
              Next to almost every <Link to="/modules/dvor" className="font-medium text-primary underline underline-offset-2">VOR</Link>: direction from the
              VOR plus distance from the DME gives a position.
            </li>
            <li>
              With many <Link to="/modules/ils" className="font-medium text-primary underline underline-offset-2">ILS</Link> approaches, to show the
              distance to the runway.
            </li>
            <li>In modern airliners, which use two or more DME distances at once to check their position.</li>
          </ul>
        ),
      }}
      simulator={<DmeSimulator />}
      howItWorks={steps}
      tryThis={experiments}
      failures={failures}
      goDeeper={<Deeper />}
      quiz={quiz}
    />
  )
}

export default function DmeModule() {
  return (
    <DmeProvider>
      <DmePage />
    </DmeProvider>
  )
}
