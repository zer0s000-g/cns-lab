import { lazy } from 'react'
import { Link } from 'react-router'
import { ModuleLayout, type StageSpec } from '@/components/module/ModuleLayout'
import type { FailureItem } from '@/components/module/FailureList'
import type { Experiment } from '@/components/module/TryThis'
import type { QuizQuestion } from '@/components/module/Quiz'
import type { Step } from '@/components/module/Stepper'
import { Term } from '@/components/Term'
import { useClock } from '@/hooks/useSimClock'
import { useSampled } from '@/hooks/useSampled'
import { BarMeter, TelemetryRow } from '@/hud/Telemetry'
import { HEIGHT_EXAGGERATION, TABLE_RADIUS_NM } from '@/stage/scale'
import Deeper from './deeper.mdx'
import { SsrSimulator } from './Simulator'
import { SsrProvider, useSsr, useSsrState } from './state'
import { AltitudeVisual, AskVisual, LabelVisual, ModeSVisual, RangeVisual, ReplyVisual, SideLobeVisual } from './visuals'

// The 3D scene is its own chunk, so the page text appears before three.js loads.
const SsrHero = lazy(() => import('./Hero3D'))

/** Honesty labels: what is to scale on the table and what is not. */
const tableScaleLabel = `Table ${TABLE_RADIUS_NM * 2} NM across · heights ×${Math.round(HEIGHT_EXAGGERATION * 10) / 10} · radar and aircraft larger than life`
const flashLabel = 'Replies take microseconds · each answer is held on screen about a second'

const SHOTS: StageSpec['shots'] = {
  idea: { position: [13, 7, 15], target: [0, 1, 0], fov: 32 },
  simulator: { position: [0, 22, 14], target: [0, 0, 1], fov: 38 },
  how: { position: [4.8, 3.0, 6.2], target: [-1.2, 1.35, 0.7], fov: 36 },
  try: { position: [-9, 10, 15], target: [-4, 0.5, 0], fov: 36 },
  wrong: { position: [12, 11, 14], target: [-3, 0.5, 0], fov: 36 },
  deeper: { position: [18, 10, 18], target: [-3, 0, 2], fov: 30 },
  quiz: { position: [-4, 30, 0.1], target: [-4, 0, 0], fov: 34 },
}

/** Close-ups for the seven "How it works" steps. */
const HOW_SHOTS: StageSpec['howShots'] = [
  // 1 Ask a question: close on the SSR array on top of the radar head.
  { position: [4.8, 3.0, 6.2], target: [-1.2, 1.35, 0.7], fov: 36 },
  // 2 Main beam or side lobe: above and behind the antenna, along the beam.
  { position: [-3, 7, 8], target: [-2, 1, 0], fov: 40 },
  // 3 The answer: the antenna and the nearest aircraft.
  { position: [8, 5, 9], target: [-0.5, 0.8, 1.5], fov: 38 },
  // 4 Distance and direction: high over the table.
  { position: [-2, 16, 12], target: [-3, 0, 0], fov: 38 },
  // 5 Altitude: low, so the heights of the aircraft read.
  { position: [-14, 3.5, 12], target: [-4, 1.2, 0], fov: 36 },
  // 6 Mode S: a wide three-quarter view.
  { position: [13, 9, 14], target: [-3, 0.6, 0], fov: 36 },
  // 7 On the screen: straight down on the table.
  { position: [-3, 24, 0.1], target: [-3, 0, 0], fov: 36 },
]

const steps: Step[] = [
  {
    title: 'Ask a question',
    body: (
      <>
        <p>
          The radar sends three short pulses, P1, P2 and P3, on 1030 MHz: an <Term id="interrogation">interrogation</Term>. The
          gap between P1 and P3 is the question. 8 millionths of a second means{' '}
          <Term id="mode-a">"who are you?"</Term> (Mode A); 21 means <Term id="mode-c">"how high are you?"</Term> (Mode C).
        </p>
        <p>
          A box on the aircraft, the <Term id="transponder">transponder</Term>, hears the question and answers on a different
          frequency, 1090 MHz.
        </p>
      </>
    ),
    visual: <AskVisual />,
  },
  {
    title: 'Main beam or side lobe?',
    body: (
      <>
        <p>
          The antenna focuses P1 and P3 into a narrow beam, but a little energy always leaks sideways in weak{' '}
          <Term id="side-lobe">side lobes</Term>. Near the radar, even a side lobe could wake up a transponder, and the answer
          would appear in the wrong direction.
        </p>
        <p>
          So P2 is sent from a second antenna that shines equally in every direction. The transponder compares P1 with P2 and
          only answers when P1 is clearly stronger: it must be in the main beam. That is{' '}
          <Term id="side-lobe-suppression">side-lobe suppression</Term>.
        </p>
      </>
    ),
    visual: <SideLobeVisual />,
  },
  {
    title: 'The answer',
    body: (
      <>
        <p>
          The reply is a train of pulses. Two <Term id="framing-pulses">framing pulses</Term>, F1 and F2, mark its start and
          end. Between them, 12 pulses are either there or not.
        </p>
        <p>
          For Mode A they spell the four-digit <Term id="squawk">squawk</Term> code. Each digit is made of three pulses worth 4,
          2 and 1, so a digit can only be 0 to 7. When the pilot presses IDENT, an extra <Term id="spi">SPI</Term> pulse is added
          for a few seconds.
        </p>
      </>
    ),
    visual: <ReplyVisual />,
  },
  {
    title: 'Distance and direction',
    body: (
      <p>
        Like primary radar, secondary radar times the answer. The transponder always waits exactly 3 millionths of a second
        before answering, so the radar takes that away and halves the rest to get the distance. The antenna direction gives the
        bearing.
      </p>
    ),
    visual: <RangeVisual />,
  },
  {
    title: 'Altitude, one pulse at a time',
    body: (
      <>
        <p>
          In Mode C the same 12 pulses carry the <Term id="pressure-altitude">pressure altitude</Term> in 100 ft steps, using a{' '}
          <Term id="gillham-code">Gray code</Term>: climbing 100 ft always changes exactly one pulse.
        </p>
        <p>If the radar catches the reply just as the altitude changes, it is never more than 100 ft wrong.</p>
      </>
    ),
    visual: <AltitudeVisual />,
  },
  {
    title: 'Mode S: calling by name',
    body: (
      <>
        <p>
          In Mode A/C, every transponder in the beam answers every question. Two aircraft close together answer at the same
          moment and their pulses get mixed up: <Term id="garbling">garbling</Term>.
        </p>
        <p>
          <Term id="mode-s">Mode S</Term> gives each aircraft a unique <Term id="icao-address">24-bit address</Term>. The radar
          learns the address once with an <Term id="all-call">all-call</Term>, then calls each aircraft by name. Only that
          aircraft answers, and it can send more: its callsign and, with <Term id="enhanced-surveillance">Enhanced Surveillance</Term>,
          its selected altitude, track and speed.
        </p>
      </>
    ),
    visual: <ModeSVisual />,
  },
  {
    title: 'On the screen',
    body: (
      <>
        <p>
          The <Term id="plot-extractor">plot extractor</Term> turns the replies from one pass of the beam into a target with a
          label: who it is (code or callsign) and how high it is (flight level).
        </p>
        <p>
          <Term id="emergency-codes">Special codes</Term> are spelled out: 7700 shows EMERGENCY, 7600 RADIO FAIL, 7500 HIJACK.
          Primary radar could answer neither question; see what comes next with{' '}
          <Link to="/modules/ads" className="font-medium text-primary underline underline-offset-2">
            ADS-B
          </Link>
          .
        </p>
      </>
    ),
    visual: <LabelVisual />,
  },
]

const quiz: QuizQuestion[] = [
  {
    question: 'On which frequencies does secondary radar ask and answer?',
    options: ['Asks on 1030 MHz, answers on 1090 MHz', 'Asks on 1090 MHz, answers on 1030 MHz', 'Both on 1030 MHz', 'Both on about 2.8 GHz, like primary radar'],
    answer: 0,
    explanation:
      'The question goes up on 1030 MHz and the answer comes down on 1090 MHz. Using two frequencies means the radar never confuses its own question with an answer.',
  },
  {
    question: 'A pilot sets the squawk code 7700. What does the controller see?',
    options: ['RADIO FAIL next to the aircraft', 'HIJACK next to the aircraft', 'EMERGENCY next to the aircraft', 'Nothing special: it is a normal code'],
    answer: 2,
    explanation: '7700 means emergency. 7600 is radio failure and 7500 is unlawful interference. The screen spells the meaning out in words, not just in colour.',
  },
  {
    question: 'Why can a squawk code never be 7800?',
    options: [
      'Codes above 7777 are kept for the military',
      'Each digit is made of three pulses worth 4, 2 and 1, so it can only be 0 to 7',
      'The transponder display has no room for an 8',
      'It can: 7800 is a normal code',
    ],
    answer: 1,
    explanation: 'Three on/off pulses per digit give 4 + 2 + 1 = 7 at most. That is why there are 8 × 8 × 8 × 8 = 4,096 codes.',
  },
  {
    question: 'Two aircraft fly one behind the other, 1 NM apart, straight toward the radar. In Mode A/C, what happens?',
    options: [
      'The radar reads both codes correctly',
      'Their replies overlap and the codes get garbled',
      'Only the closer aircraft answers',
      'Each aircraft answers on its own frequency',
    ],
    answer: 1,
    explanation:
      'A reply lasts about 21 millionths of a second, which is about 1.7 NM of there-and-back distance. Closer than that, the two answers arrive on top of each other. Mode S avoids it by asking one aircraft at a time.',
  },
  {
    question: 'What is the P2 pulse for?',
    options: [
      'It carries the altitude',
      'It stops transponders from answering the antenna’s side lobes',
      'It tells the transponder which code to send',
      'It measures the distance to the aircraft',
    ],
    answer: 1,
    explanation:
      'P2 is sent equally in all directions. In the main beam P1 is much stronger than P2, so the transponder answers; in a side lobe P2 is stronger, so it stays silent. Without P2, aircraft near the radar show up all around it.',
  },
]

function SsrTelemetry() {
  const { engine } = useSsr()
  const params = useSsrState((s) => s.params)
  const seen = useSampled(() => {
    const tracks = [...engine.tracks.values()]
    const labelled = engine.aircraft.filter((a) => engine.trackFor(a.id)?.plot.secondary).length
    const falseN = tracks.filter((t) => t.plot.secondary && (!t.plot.sourceId || !engine.getAircraft(t.plot.sourceId))).length
    return { n: engine.aircraft.length, k: labelled, az: Math.round(engine.antennaAz), falseN }
  }, 250)
  return (
    <div className="hud-panel flex flex-col rounded-md px-3.5 py-2.5">
      <TelemetryRow label="Antenna" value={String(seen.az).padStart(3, '0')} unit="°" tone="signal" />
      <TelemetryRow label="Asks" value={params.mode === 's' ? 'Mode S' : 'Mode A/C'} />
      <TelemetryRow label="Turn" value={params.rotationPeriodS.toFixed(1)} unit="s" />
      <TelemetryRow label="Labelled" value={`${seen.k}/${seen.n}`} tone="brass" />
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="hud-label">On screen</span>
        <BarMeter orientation="horizontal" value={seen.n ? seen.k / seen.n : 0} segments={14} label="Share of aircraft with a label on the controller's screen" />
      </div>
    </div>
  )
}

function SsrPage() {
  const { engine, store, clock, replayRef } = useSsr()
  const env = useSsrState((s) => s.env)
  const params = useSsrState((s) => s.params)
  const xpdr = useSsrState((s) => s.xpdr)
  const replaying = useSsrState((s) => s.replay.phase === 'replay')
  const running = useClock(clock, (c) => c.running)
  const s = store.getState()

  const stage: StageSpec = {
    scene: (t) => <SsrHero t={t} engine={engine} replayRef={replayRef} />,
    shots: SHOTS,
    howShots: HOW_SHOTS,
    kicker: 'Asks on 1030 MHz · answers on 1090 MHz',
    labels: [tableScaleLabel, replaying ? 'Slowed down so you can see it · the world is frozen' : flashLabel],
    telemetry: <SsrTelemetry />,
    clock: { getTimeS: () => engine.timeS, running, sub: replaying ? 'Interrogation replay' : 'Sim time' },
    label:
      'A tabletop model of the airspace: the secondary radar array rides on top of the radar head and sweeps its 1030 MHz question beam over the terrain. Each aircraft flashes brass when its transponder answer becomes a label on the controller’s screen; false targets from side lobes or another radar are ringed where the screen draws them.',
  }

  const experiments: Experiment[] = [
    {
      id: 'special',
      question: 'What does the controller see when a pilot squawks 7700?',
      action: <p>Give CNS101 the code 7700 with the reply builder, then watch its label on the controller's screen. Try 7600 as well.</p>,
      setup: () => {
        s.select('CNS101')
        s.setXpdr('CNS101', { squawk: '7700', on: true })
        s.setParam('mode', 'ac')
      },
      notice: (
        <p>
          Within one turn of the antenna, CNS101's label reads EMERGENCY and the target is boxed. With 7600 it reads RADIO FAIL.
          The meaning is written out in words, so nobody has to rely on a colour. In the reply builder, 7700 lights A4, A2, A1 and
          B4, B2, B1: digits A and B are both 4 + 2 + 1 = 7.
        </p>
      ),
    },
    {
      id: 'garble',
      question: 'What if two aircraft are close together?',
      action: (
        <p>
          We will put CNS303 and CNS606 in trail, 1 NM apart, flying along the same bearing from the radar. Look at their labels
          in Mode A/C. Then switch the radar to Mode S.
        </p>
      ),
      setup: () => {
        s.setParam('mode', 'ac')
        if (!store.getState().env.garblePair) s.setEnv('garblePair', true)
        s.select('CNS303')
      },
      notice: (
        <p>
          In Mode A/C both answer every question at the same moment, their pulses overlap and both labels show ???? and GARBLED.
          In Mode S the radar calls each by its own address, so the answers never collide: after a turn or two each shows its
          callsign and flight level. Try the slow-motion view on CNS303 in both modes.
        </p>
      ),
    },
    {
      id: 'xpdr',
      question: 'What happens if a transponder stops working?',
      action: <p>Switch off CNS101's transponder and watch its label.</p>,
      setup: () => {
        s.select('CNS101')
        s.setXpdr('CNS101', { on: false })
      },
      notice: (
        <p>
          After one turn the label disappears. Only a dot remains: the echo seen by the primary radar that shares the antenna. The
          controller still sees something is there, but no longer knows who it is or how high it flies.
        </p>
      ),
    },
    {
      id: 'gray',
      question: 'Why does Mode C use such an odd code for altitude?',
      action: <p>Make CNS101 climb from 12,000 ft to 13,000 ft and watch the Mode C reply in the reply builder.</p>,
      setup: () => {
        s.select('CNS101')
        s.setXpdr('CNS101', { on: true })
        const a = engine.getAircraft('CNS101')
        engine.setAircraft('CNS101', { targetAltitudeFt: a && a.altitudeFt > 12500 ? 12000 : 13000 })
      },
      notice: (
        <p>
          Every 100 ft exactly one pulse changes (it is outlined for a moment). With ordinary binary numbers, going from 12,700 to
          12,800 ft could change many pulses at once, and a reply caught halfway could read as a wildly wrong altitude.
        </p>
      ),
    },
    {
      id: 'sidelobe',
      question: 'Why does the radar send P2 at all?',
      action: <p>Switch off the control antenna (no P2) and watch CNS404, the light aircraft flying a circuit 6 to 7 NM from the radar.</p>,
      setup: () => {
        s.setParam('mode', 'ac')
        s.setEnv('noP2', true)
        s.select('CNS404')
        s.setScopeRange(30)
      },
      notice: (
        <p>
          Without P2, CNS404 answers the side lobes too, so false copies of its label appear all around the radar at the same
          distance (ring-around). Aircraft far away do not: out there the side lobes are too weak to trigger them. Turn P2 back
          on and only the real target remains.
        </p>
      ),
    },
  ]

  const failures: FailureItem[] = [
    {
      id: 'garble',
      title: 'Garbling: two aircraft close together',
      explanation: (
        <p>
          Two aircraft less than about 1.7 NM apart in distance from the radar, both in the beam, answer the same Mode A/C
          question at the same time. Their pulse trains overlap and the codes and altitudes get mixed up.
        </p>
      ),
      watch: 'CNS303 and CNS606 south-west of the radar, labelled GARBLED.',
      checked: env.garblePair,
      onChange: (v) => s.setEnv('garblePair', v),
    },
    {
      id: 'modes',
      title: 'The fix for garbling: Mode S',
      explanation: (
        <p>
          <Term id="mode-s">Mode S</Term> calls each aircraft by its unique address, one at a time, and plans the answers so they
          never overlap. It also sends the callsign.
        </p>
      ),
      checked: params.mode === 's',
      onChange: (v) => s.setParam('mode', v ? 's' : 'ac'),
    },
    {
      id: 'fruit',
      title: 'FRUIT: replies triggered by another radar',
      explanation: (
        <p>
          Nearby radars ask the same aircraft their own questions. The answers go everywhere, and reach your receiver at moments
          that have nothing to do with your questions, so they show up at random distances as <Term id="fruit">FRUIT</Term>.
        </p>
      ),
      watch: 'speckles all over the screen (switch the defruiter off to see them all).',
      checked: env.fruit,
      onChange: (v) => s.setEnv('fruit', v),
    },
    {
      id: 'defruit',
      title: 'The fix for FRUIT: the defruiter',
      explanation: (
        <p>
          A real aircraft answers several questions in a row from the same distance. FRUIT lands somewhere different every time.
          The <Term id="defruiter">defruiter</Term> keeps only replies that repeat at the same range.
        </p>
      ),
      checked: env.defruiter,
      onChange: (v) => s.setEnv('defruiter', v),
    },
    {
      id: 'sidelobe',
      title: 'Answers from antenna side lobes',
      explanation: (
        <p>
          If the control antenna fails there is no P2, and a transponder close to the radar also answers the weak{' '}
          <Term id="side-lobe">side lobes</Term>. The radar then believes the aircraft is in many directions at once:{' '}
          <Term id="ring-around">ring-around</Term>.
        </p>
      ),
      watch: 'false CNS404 labels in a ring around the radar (Mode A/C).',
      checked: env.noP2,
      onChange: (v) => s.setEnv('noP2', v),
    },
    {
      id: 'xpdr',
      title: 'Transponder failure',
      explanation: (
        <p>
          With no transponder answering, secondary radar has nothing to show. Only the primary echo remains: a position with no
          identity and no altitude.
        </p>
      ),
      watch: 'CNS101 turning into an unlabelled dot.',
      checked: xpdr.CNS101?.on === false,
      onChange: (v) => s.setXpdr('CNS101', { on: !v }),
    },
  ]

  return (
    <ModuleLayout
      moduleId="ssr"
      stage={stage}
      nextId="ads"
      idea={{
        analogy: (
          <p>
            Primary radar is like seeing someone in the dark: you know <strong>where</strong> they are, nothing more. Secondary
            radar is calling out <strong>"Who's there?"</strong> and hearing them answer with their name and which floor they are
            on.
          </p>
        ),
        what: (
          <>
            <p>
              A <Term id="ssr">secondary surveillance radar</Term> sends a radio question, and a{' '}
              <Term id="transponder">transponder</Term> on board answers with a four-digit identity code and the aircraft's
              altitude. The radar measures the distance from how long the answer takes, and the direction from where its antenna
              points.
            </p>
            <p>
              It only works if the aircraft cooperates, but it tells the controller who each aircraft is and how high it flies,
              which primary radar cannot.
            </p>
          </>
        ),
        where: (
          <ul>
            <li>On top of most primary radar antennas at airports: the flat bar that turns with the dish.</li>
            <li>At en-route radar sites covering 200 NM and more.</li>
            <li>In almost all controlled airspace, where a working transponder is required.</li>
          </ul>
        ),
      }}
      simulator={<SsrSimulator />}
      howItWorks={steps}
      tryThis={experiments}
      failures={failures}
      goDeeper={<Deeper />}
      quiz={quiz}
    />
  )
}

export default function SsrModule() {
  return (
    <SsrProvider>
      <SsrPage />
    </SsrProvider>
  )
}
