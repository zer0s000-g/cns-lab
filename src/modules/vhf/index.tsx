import { Link } from 'react-router'
import { lazyRetry } from '@/lib/lazyRetry'
import { ModuleLayout, type StageSpec } from '@/components/module/ModuleLayout'
import type { FailureItem } from '@/components/module/FailureList'
import type { Experiment } from '@/components/module/TryThis'
import type { QuizQuestion } from '@/components/module/Quiz'
import type { Step } from '@/components/module/Stepper'
import { Term } from '@/components/Term'
import { minHeightForLineOfSightFt, radioHorizonNm, radioLineOfSightNm, slantRangeNm } from '@/core/propagation'
import { AIRCRAFT_RADIO, GROUND_RADIO, RECEIVER_NOISE_DBM, NOISE_PEAK_DB, adjacentLeakDbm, linkLevelDbm } from '@/core/vhf'
import Deeper from './deeper.mdx'
import { VhfSimulator } from './Simulator'
import { FREQ_MHZ, MOUNTAIN, SITE, STUCK_DETECT_S } from './engine'
import { VhfProvider, useVhf, useVhfState } from './state'
import { useClock } from '@/hooks/useSimClock'
import { useSampled } from '@/hooks/useSampled'
import { TelemetryRow } from '@/hud/Telemetry'
import { HERO_D_MAX, HERO_D_MIN, HERO_HEIGHT_X } from './heroScale'
import { RX_TEXT } from './labels'
import { ChannelsVisual, GroundSystemVisual, LineOfSightVisual, OneAtATimeVisual, PressToTalkVisual, SquelchVisual } from './visuals'

// The 3D scene is its own chunk, so the page text appears before three.js loads.
const VhfHero = lazyRetry(() => import('./Hero3D'))

/** Honesty labels: what is to scale in the Earth slice and what is not. */
const sliceLabel = `Earth slice ${HERO_D_MAX - HERO_D_MIN} NM long · heights and curve ×${HERO_HEIGHT_X}`
const sizeLabel = 'Mast and aircraft larger than life'
const pulseLabel = 'Pulses show who talks; radio is instant'

const steps: Step[] = [
  {
    title: 'Press to talk',
    body: (
      <>
        <p>
          Pilots and controllers talk on shared radio channels. To speak you hold the <Term id="press-to-talk">transmit button</Term>; to listen you
          let go. Everyone tuned to that <Term id="frequency">frequency</Term> hears you: the controller and every other pilot.
        </p>
        <p>
          The voice rides on the radio wave by making it stronger and weaker, which is called <Term id="am">AM</Term>.
        </p>
      </>
    ),
    visual: <PressToTalkVisual />,
  },
  {
    title: 'Straight lines only',
    body: (
      <>
        <p>
          <Term id="vhf">VHF</Term> radio waves travel in almost straight lines. The Earth is curved, so beyond a certain distance the ground itself
          gets in the way. That limit is the <Term id="radio-horizon">radio horizon</Term>.
        </p>
        <p>
          The higher the aircraft, the farther it can see "over the bulge". A jet at cruise can talk to an antenna more than 200 NM away; a small
          aircraft near the ground only a few tens of miles. Mountains block the waves too.
        </p>
      </>
    ),
    visual: <LineOfSightVisual />,
  },
  {
    title: 'One at a time',
    body: (
      <>
        <p>
          The channel is <Term id="simplex">simplex</Term>: one speaker at a time. Nobody can tell that someone else has just pressed their button.
          If two do, receivers get both <Term id="carrier">carriers</Term> at once. They beat together into a{' '}
          <Term id="heterodyne">squeal</Term> and neither message gets through: a <Term id="blocked-transmission">blocked transmission</Term>.
        </p>
        <p>Pilots listen before they talk, and keep messages short, to make this rare.</p>
      </>
    ),
    visual: <OneAtATimeVisual />,
  },
  {
    title: 'Silence between calls',
    body: (
      <>
        <p>
          A radio with nobody talking would hiss all the time. The <Term id="squelch">squelch</Term> keeps it silent until a signal stronger than a
          threshold arrives.
        </p>
        <p>Set it too low and the hiss comes back. Set it too high and weak, distant stations are cut out.</p>
      </>
    ),
    visual: <SquelchVisual />,
  },
  {
    title: 'Channels side by side',
    body: (
      <>
        <p>
          The aviation voice band is divided into channels 25 kHz apart. Busy European airspace ran out of them, so the{' '}
          <Term id="channel-spacing">spacing</Term> was cut to 8.33 kHz: three channels where there used to be one.
        </p>
        <p>The price: neighbours are much closer, so radios need sharper filters, and a strong transmitter next door can leak in.</p>
      </>
    ),
    visual: <ChannelsVisual />,
  },
  {
    title: 'Behind the controller',
    body: (
      <>
        <p>
          The controller's headset connects through a <Term id="vccs">voice switch</Term> to <Term id="radio-site">radio sites</Term> that can be
          far away. Each site has a <Term id="standby-transmitter">main and a standby transmitter</Term>, so one failure does not silence the
          sector (<Term id="redundancy">redundancy</Term>).
        </p>
        <p>
          In an emergency anyone can call on the <Term id="guard-frequency">guard frequency</Term>, 121.5 MHz. Military aircraft use{' '}
          <Term id="uhf">UHF</Term> radios, with guard on 243.0 MHz.
        </p>
      </>
    ),
    visual: <GroundSystemVisual />,
  },
]

const quiz: QuizQuestion[] = [
  {
    question: 'A ground antenna is 100 ft high and an aircraft flies at 10,000 ft. Roughly how far apart can they still talk?',
    options: ['About 50 NM', 'About 135 NM', 'About 250 NM', 'About 1,000 NM'],
    answer: 1,
    explanation: `Range grows with the square root of height, for the antenna and for the aircraft. From 10,000 ft to a 100 ft mast it is about ${Math.round(radioLineOfSightNm(100, 10000))} NM; beyond that, the curve of the Earth is in the way. Go deeper shows the rule of thumb.`,
  },
  {
    question: 'Two pilots press their transmit buttons at the same moment. What does the controller hear?',
    options: ['Both messages, one after the other', 'Only the stronger one, perfectly clear', 'A squeal, and neither message', 'Silence'],
    answer: 2,
    explanation:
      'Both carriers arrive at once and beat together into a whistle, the heterodyne. Neither message can be understood, so the controller asks the stations to say again.',
  },
  {
    question: 'Your radio hisses all the time, even when nobody is talking. What is wrong?',
    options: ['The squelch is set too low', 'The squelch is set too high', 'You are out of range', 'The transmitter has failed'],
    answer: 0,
    explanation:
      'With the squelch below the noise level, the noise itself keeps the gate open. Turn it up a little: the radio goes quiet between calls but still opens for real stations.',
  },
  {
    question: 'Why did Europe start using 8.33 kHz channel spacing?',
    options: ['It gives clearer sound', 'It reaches farther', 'There were not enough channels for all the sectors', 'It uses less power'],
    answer: 2,
    explanation:
      'Every sector, approach and tower needs its own frequency. Splitting each 25 kHz channel into three 8.33 kHz channels tripled the number available in the same band.',
  },
  {
    question: 'One aircraft has a stuck microphone and blocks the frequency. What can the controller do?',
    options: [
      'Nothing, wait until the aircraft lands',
      'Talk louder so the message gets through',
      'Move everyone to another frequency and tell them on 121.5 or by text message',
      'Switch to the standby transmitter',
    ],
    answer: 2,
    explanation:
      'Talking louder does not help: the open carrier still beats with everything. The controller moves the traffic to another frequency (or radio site) and tells pilots on the guard frequency or by CPDLC text message. The standby transmitter would be blocked just the same.',
  },
]

const SHOTS: StageSpec['shots'] = {
  idea: { position: [-8, 10, 34], target: [-9, 1.8, 0], fov: 30 },
  simulator: { position: [-4, 10, 27], target: [-4.6, 1.2, 0], fov: 36 },
  how: { position: [-11, 8, 32], target: [-10, 2.1, 0], fov: 36 },
  try: { position: [-13, 9, 40], target: [-15, 2.6, 0], fov: 36 },
  wrong: { position: [-14, 6, 28], target: [-9.8, 1.9, 0], fov: 36 },
  deeper: { position: [-6, 12, 38], target: [-9.5, 1.2, 0], fov: 36 },
  quiz: { position: [-8, 22, 22], target: [-8.5, 0, 0], fov: 36 },
}

/** One shot per "How it works" step (panels sit on the left, so the subject is framed right of centre). */
const HOW_SHOTS: StageSpec['howShots'] = [
  // 1 Press to talk: the site and your aircraft, joined by the ray.
  { position: [-11, 8, 32], target: [-10, 2.1, 0], fov: 36 },
  // 2 Straight lines only: the whole slice, the curve, the horizon and the shadow.
  { position: [-6, 8, 40], target: [-9.5, 1.2, 0], fov: 36 },
  // 3 One at a time: the site, CNS202 and you, from lower down.
  { position: [-14, 6, 28], target: [-9.8, 1.9, 0], fov: 36 },
  // 4 Squelch: close on your aircraft.
  { position: [-2.5, 4.5, 9], target: [-3.2, 2.7, 0], fov: 36 },
  // 5 Channels side by side: you and the neighbour on the next channel.
  { position: [-1.8, 4.2, 7], target: [-2.6, 2.7, 0.3], fov: 36 },
  // 6 Behind the controller: the control centre and the radio site.
  { position: [-9.3, 0.2, 6], target: [-10.1, -1, 0], fov: 34 },
]

function VhfTelemetry() {
  const { engine } = useVhf()
  const r = useSampled(() => {
    const p = engine.params
    const v = engine.learnerView()
    const lvl = engine.levelAt('controller', 'CNS101', p.com1)
    return {
      range: radioLineOfSightNm(SITE.antennaFt, p.altitudeFt),
      floor: engine.contactFloorFt(),
      level: lvl,
      contact: engine.learnerInContact(),
      state: engine.pttActive ? 'Transmitting' : RX_TEXT[v.rx.state].split(':')[0],
      bad: v.rx.state === 'blocked' || v.rx.state === 'garbled',
    }
  }, 250)
  return (
    <div className="hud-panel flex flex-col rounded-md px-3.5 py-2.5">
      <TelemetryRow label="Range here" value={r.range.toFixed(0)} unit="NM" tone="signal" />
      <TelemetryRow label="Contact below" value={Math.round(r.floor).toLocaleString('en-US')} unit="ft" tone={r.contact ? 'default' : 'alert'} />
      <TelemetryRow label="Signal" value={Number.isFinite(r.level) ? r.level.toFixed(0) : '—'} unit={Number.isFinite(r.level) ? 'dBm' : undefined} />
      <TelemetryRow label="Receiver" value={r.state} tone={r.bad ? 'alert' : 'default'} />
    </div>
  )
}

function VhfPage() {
  const { engine, clock } = useVhf()
  const failures = useVhfState((s) => s.failures)
  const { setParam, setFailure, setListenAt, setVccs } = useVhfState((s) => s)

  const d1 = 150
  const floor1 = minHeightForLineOfSightFt(SITE.antennaFt, d1)
  const dSq = 220
  const levelSq = linkLevelDbm(GROUND_RADIO, AIRCRAFT_RADIO, slantRangeNm(dSq, 36000, SITE.antennaFt), FREQ_MHZ.main)
  const leak833 = adjacentLeakDbm(engine.levelAt('CNS707', 'CNS101', 'adjacent'), '8.33')
  const play = () => clock.getState().play()
  const running = useClock(clock, (c) => c.running)

  const stage: StageSpec = {
    scene: (t) => <VhfHero t={t} engine={engine} />,
    shots: SHOTS,
    howShots: HOW_SHOTS,
    kicker: 'VHF voice · 118–137 MHz',
    labels: [sliceLabel, sizeLabel, pulseLabel, ...(failures.interference ? ['CNS707 drawn beside you so you can see it'] : [])],
    telemetry: <VhfTelemetry />,
    clock: { getTimeS: () => engine.timeS, running, sub: 'Real time' },
    label:
      'A slice of the curved Earth along the radio path: a radio mast at one end, your aircraft and another pilot above the sea. Straight radio rays join the antenna to each aircraft; a hatched shadow below the radio horizon shows where there is no line of sight.',
  }
  const clearFailures = () => {
    for (const k of ['stuckMic', 'mountain', 'txFailure', 'interference'] as const) if (engine.failures[k]) setFailure(k, false)
  }

  const experiments: Experiment[] = [
    {
      id: 'horizon',
      question: 'At what altitude do you lose contact?',
      action: (
        <p>
          Your aircraft is {d1} NM from the radio site at 20,000 ft. Lower the altitude slowly (slider, or the down arrow on the side view) and watch
          the straight line to the antenna and the "Contact lost below" readout.
        </p>
      ),
      setup: () => {
        clearFailures()
        setParam('distanceNm', d1)
        setParam('altitudeFt', 20000)
        setParam('squelchDbm', -105)
        setParam('com1', 'main')
        setListenAt('cockpit')
        play()
      },
      notice: (
        <p>
          Contact is lost below about {Math.round(floor1 / 100) * 100} ft. At that height the straight line just grazes the sea{' '}
          {radioHorizonNm(SITE.antennaFt).toFixed(0)} NM from the antenna, at the antenna's own horizon. Any lower and the bulge of the Earth is in the
          way: the controller's calls stop reaching you and your calls get no answer. Range grows only with the square root of height: from 5,000 ft
          you reach about {Math.round(radioLineOfSightNm(100, 5000))} NM, from 20,000 ft about {Math.round(radioLineOfSightNm(100, 20000))} NM.
        </p>
      ),
    },
    {
      id: 'collision',
      question: 'What happens if two pilots talk at once?',
      action: (
        <p>
          A countdown starts under your radio. When it reaches zero, press and hold "Hold to talk" for about two seconds. You are listening at the
          controller's position this time.
        </p>
      ),
      setupLabel: 'Start the countdown',
      setup: () => {
        clearFailures()
        setParam('distanceNm', 100)
        setParam('altitudeFt', 24000)
        setParam('com1', 'main')
        setListenAt('controller')
        play()
        engine.scheduleCns202(5)
      },
      notice: (
        <p>
          Where the two bars overlap, the timeline turns red. The controller's receiver gets both carriers and plays a squeal: neither message gets
          through, so the controller answers "Transmission blocked, say again". Try pressing a second or two early: CNS202 hears you and waits. That
          is why pilots listen before they talk.
        </p>
      ),
    },
    {
      id: 'stuck',
      question: 'How does the controller work around a stuck microphone?',
      action: <p>CNS303's microphone is stuck on 128.600. Listen, watch the timeline, then try calling the controller.</p>,
      setup: () => {
        clearFailures()
        setParam('distanceNm', 100)
        setParam('altitudeFt', 24000)
        setParam('com1', 'main')
        setParam('guardWatch', true)
        setListenAt('cockpit')
        setFailure('stuckMic', true)
        play()
      },
      notice: (
        <p>
          The open carrier fills 128.600: your call collides with it and is blocked. After about {STUCK_DETECT_S} seconds the controller moves the
          sector to 124.350, announces it on the guard frequency 121.5 (your second radio hears it) and sends a CPDLC text message. Tune 124.350 and
          call again: this time you get "roger". Another fix is a different radio site that the stuck aircraft cannot reach.
        </p>
      ),
    },
    {
      id: 'squelch',
      question: 'What does the squelch knob do?',
      action: (
        <p>
          The squelch starts fully down and you are {dSq} NM away. Watch "Your receiver" (and listen). Raise the squelch until the hiss stops. Then keep
          going to −80 dBm and wait for the controller's next call.
        </p>
      ),
      setup: () => {
        clearFailures()
        setParam('distanceNm', dSq)
        setParam('altitudeFt', 36000)
        setParam('squelchDbm', -125)
        setParam('com1', 'main')
        setListenAt('cockpit')
        play()
      },
      notice: (
        <p>
          Below about {RECEIVER_NOISE_DBM + NOISE_PEAK_DB} dBm the receiver noise itself opens the squelch: constant hiss. Above it the radio is
          silent between calls but still opens for the controller, whose signal arrives at about {Math.round(levelSq)} dBm from {dSq} NM. Raise the
          squelch above that and the controller is cut out, even though he is in range. Move closer and his stronger signal opens it again.
        </p>
      ),
    },
    {
      id: 'spacing',
      question: 'Why do 8.33 kHz channels need better radios?',
      action: <p>CNS707 flies 1 NM from you, talking on the next channel. Watch the close-up frequency strip, then switch Channel spacing to 25 kHz.</p>,
      setup: () => {
        clearFailures()
        setParam('distanceNm', 200)
        setParam('altitudeFt', 36000)
        setParam('spacing', '8.33')
        setParam('squelchDbm', -105)
        setParam('com1', 'main')
        setListenAt('cockpit')
        setFailure('interference', true)
        play()
      },
      notice: (
        <p>
          With 8.33 kHz spacing the neighbour is only 8.33 kHz away. So close to you, it is so strong that about {Math.round(leak833)} dBm still gets
          through your filter: it opens your squelch with broken speech and makes the controller, 200 NM away, unreadable. With 25 kHz the neighbour
          is three times farther away in frequency, the filter removes it, and the controller is clear again.
        </p>
      ),
    },
  ]

  const failureItems: FailureItem[] = [
    {
      id: 'stuck',
      title: 'Stuck microphone',
      explanation: (
        <p>
          A transmit button jams, and CNS303's radio stays on the air. Its <Term id="carrier">carrier</Term> collides with every other transmission on
          128.600, so nothing gets through for anyone who can hear it.
        </p>
      ),
      watch: 'a bar that never ends on the timeline, then the controller moving to 124.350.',
      checked: failures.stuckMic,
      onChange: (v) => setFailure('stuckMic', v),
    },
    {
      id: 'mountain',
      title: 'A mountain in the way',
      explanation: (
        <p>
          A {MOUNTAIN.peakFt.toLocaleString('en-US')} ft mountain rises {MOUNTAIN.centerNm} NM from the radio site. Low aircraft behind it are in its
          radio shadow even when the curve of the Earth is not in the way. Climbing takes them out of the shadow.
        </p>
      ),
      watch: 'the red ray stopping at the mountain, and the hatched shadow behind it.',
      checked: failures.mountain,
      onChange: (v) => setFailure('mountain', v),
    },
    {
      id: 'tx',
      title: 'Main transmitter failure',
      explanation: (
        <p>
          The controller speaks, but nothing goes on the air. The voice switch raises an alarm; changing over to the <Term id="standby-transmitter">standby transmitter</Term> restores the voice.
        </p>
      ),
      watch: 'dashed "not on the air" bars on the timeline; press Standby on the voice switch.',
      checked: failures.txFailure,
      onChange: (v) => {
        setFailure('txFailure', v)
        if (!v) setVccs({ ...engine.vccs, transmitter: 'main' })
      },
    },
    {
      id: 'adjacent',
      title: 'Interference from the next channel',
      explanation: (
        <p>
          CNS707, very close to you, talks on the neighbouring channel. With 8.33 kHz spacing some of it leaks through your receiver's filter:{' '}
          <Term id="adjacent-channel-interference">adjacent-channel interference</Term>.
        </p>
      ),
      watch: 'the CNS707 peak next to yours on the close-up strip, and "Next channel leaking in".',
      checked: failures.interference,
      onChange: (v) => setFailure('interference', v),
    },
  ]

  return (
    <ModuleLayout
      moduleId="vhf"
      stage={stage}
      nextId="hf"
      idea={{
        analogy: (
          <p>
            It works like a walkie-talkie. Press the button to talk, let go to listen. Everyone on the same channel hears you, and if two people press
            at once, nobody hears anything but a squeal. And like a walkie-talkie, it only reaches as far as you can "see": hills and the curve of the
            Earth get in the way.
          </p>
        ),
        what: (
          <>
            <p>
              <Term id="vhf">VHF</Term> air-ground radio is how pilots and <Term id="controller">controllers</Term> talk to each other. Each sector of
              airspace has its own frequency. Pilots hear the instructions for other aircraft too, which helps everyone keep the picture.
            </p>
            <p>
              Because the waves travel in straight lines, the range depends on height: high aircraft can be heard far away, low ones only nearby.
            </p>
          </>
        ),
        where: (
          <ul>
            <li>Every control tower, approach and area control sector, on 118–137 MHz.</li>
            <li>Remote radio sites on hills and masts, linked to control centres.</li>
            <li>Military aircraft on UHF, 225–400 MHz.</li>
            <li>
              Not over the middle of the ocean: that is too far for straight-line radio. There,{' '}
              <Link to="/modules/hf" className="font-medium text-primary underline underline-offset-2">
                HF radio
              </Link>
              , satellites and text messages take over.
            </li>
          </ul>
        ),
      }}
      simulator={<VhfSimulator />}
      howItWorks={steps}
      tryThis={experiments}
      failures={failureItems}
      goDeeper={<Deeper />}
      quiz={quiz}
    />
  )
}

export default function VhfModule() {
  return (
    <VhfProvider>
      <VhfPage />
    </VhfProvider>
  )
}
