import { Link } from 'react-router'
import { ModuleLayout } from '@/components/module/ModuleLayout'
import type { FailureItem } from '@/components/module/FailureList'
import type { Experiment } from '@/components/module/TryThis'
import type { QuizQuestion } from '@/components/module/Quiz'
import type { Step } from '@/components/module/Stepper'
import { Term } from '@/components/Term'
import { MONITOR } from '@/core/vor'
import Deeper from './deeper.mdx'
import { DvorSimulator } from './Simulator'
import { DvorProvider, useDvor, useDvorState } from './state'
import { CdiVisual, CvorVisual, DvorVisual, LighthouseVisual, LimitsVisual, PhaseVisual } from './visuals'

const steps: Step[] = [
  {
    title: 'Two clocks ticking',
    body: (
      <>
        <p>
          A <Term id="vor">VOR</Term> station sends two signals that tick 30 times a second. The{' '}
          <Term id="reference-signal">reference</Term> ticks at the same moment in every direction, like a flash everyone
          sees at once.
        </p>
        <p>
          The <Term id="variable-signal">variable</Term> signal ticks at a different moment depending on which direction you
          are from the station, like a lighthouse beam that sweeps past you.
        </p>
      </>
    ),
    visual: <LighthouseVisual />,
  },
  {
    title: 'The delay is your direction',
    body: (
      <>
        <p>
          The receiver measures how far apart the two ticks are: their <Term id="phase">phase</Term> difference, in degrees
          of one cycle.
        </p>
        <p>
          That number is your <Term id="radial">radial</Term>: your direction FROM the station, measured from{' '}
          <Term id="magnetic-north">magnetic north</Term>. Out of step by 90°? You are on radial 090, east of the station.
        </p>
      </>
    ),
    visual: <PhaseVisual />,
  },
  {
    title: 'Conventional VOR: a turning pattern',
    body: (
      <>
        <p>
          In a <Term id="cvor">conventional VOR</Term> the antenna's pattern has a bulge that turns clockwise 30 times a
          second. Each direction hears the signal grow stronger and weaker once per turn: the variable signal is{' '}
          <Term id="am">AM</Term>.
        </p>
        <p>
          The reference rides on a 9960 Hz <Term id="subcarrier">subcarrier</Term> tone whose pitch wobbles 30 times a
          second: it is <Term id="fm">FM</Term>, and the same everywhere.
        </p>
      </>
    ),
    visual: <CvorVisual />,
  },
  {
    title: 'Doppler VOR: a ring of antennas',
    body: (
      <>
        <p>
          A <Term id="dvor">Doppler VOR</Term> swaps the roles. A ring of about 48 antennas is switched on one after another
          (<Term id="commutation">commutation</Term>), so the signal seems to race round a 13.5 m circle 30 times a second.
        </p>
        <p>
          When it moves toward you its pitch rises, and when it moves away it falls: the{' '}
          <Term id="doppler-effect">Doppler effect</Term>. Now the variable signal is FM, and the reference is plain AM from
          the centre antenna. Your receiver cannot tell the difference.
        </p>
      </>
    ),
    visual: <DvorVisual />,
  },
  {
    title: 'Choose a course, follow the needle',
    body: (
      <>
        <p>
          In the cockpit you turn the <Term id="obs">OBS</Term> knob to the course you want. The{' '}
          <Term id="cdi">CDI</Term> needle shows whether that course is to your left or right, and the{' '}
          <Term id="to-from">TO/FROM flag</Term> says whether flying it takes you toward or away from the station.
        </p>
        <p>The needle does not care which way the aircraft points: only where it is.</p>
      </>
    ),
    visual: <CdiVisual />,
  },
  {
    title: 'Know its limits',
    body: (
      <>
        <p>
          Straight above the station there is a <Term id="cone-of-confusion">cone of confusion</Term> where the needle swings
          and the flag appears. Buildings nearby reflect the signal and bend the course (
          <Term id="scalloping">scalloping</Term>).
        </p>
        <p>
          A <Term id="vor-monitor">monitor</Term> watches the station and switches it off if its signal goes wrong. And
          always listen for the <Term id="morse-ident">Morse ident</Term>: no ident, no use.
        </p>
      </>
    ),
    visual: <LimitsVisual />,
  },
]

const quiz: QuizQuestion[] = [
  {
    question: 'The variable signal is out of step with the reference by 90°. Where are you?',
    options: ['On radial 090, east of the station', 'On radial 270, west of the station', 'Directly over the station', '90 NM from the station'],
    answer: 0,
    explanation:
      'The phase difference is the radial: your magnetic bearing FROM the station. 90° means you are on radial 090, to the east. It says nothing about distance; that is what a DME adds.',
  },
  {
    question: 'The OBS is set to 090, the flag says FROM and the needle is centred. Where are you?',
    options: ['West of the station, flying toward it', 'East of the station, on radial 090', 'North of the station', 'You cannot tell'],
    answer: 1,
    explanation:
      'Centred with FROM means course 090 leads away from the station from where you are: you are on the 090 radial, east of it. West of the station the same course would show TO.',
  },
  {
    question: 'Flying high directly over a VOR, the needle swings and the flag appears. Why?',
    options: ['The station has failed', 'You are in the cone of confusion above the station', 'The Morse ident has stopped', 'Your OBS is set wrong'],
    answer: 1,
    explanation:
      'Straight above the station the direction information breaks down. The cone is wider the higher you fly. Hold your heading and the signal comes back on the other side.',
  },
  {
    question: 'Why is a Doppler VOR less disturbed by a nearby building than a conventional VOR?',
    options: [
      'It transmits more power',
      'Its large ring of antennas makes most of the reflection average out',
      'It uses a different frequency band',
      'Buildings do not reflect VHF signals',
    ],
    answer: 1,
    explanation:
      'The DVOR ring is about five wavelengths across. A reflected signal comes back with a very different Doppler pattern, and the FM detection averages most of it away, so the course error is typically ten or more times smaller.',
  },
  {
    question: 'The VOR needle and flag look normal, but you hear no Morse ident. What should you do?',
    options: ['Use it, the needle is fine', 'Do not use it for navigation', 'Turn the OBS until the ident comes back', 'Climb higher'],
    answer: 1,
    explanation:
      'A station under maintenance may radiate while its ident is removed, and its guidance may be wrong. The ident is how you confirm you have the right, working station.',
  },
]

function DvorPage() {
  const { store, clock } = useDvor()
  const env = useDvorState((s) => s.env)
  const overfly = useDvorState((s) => s.overfly)
  const s = store.getState()

  const experiments: Experiment[] = [
    {
      id: 'circle',
      question: 'What happens to the two signals as you fly all the way round?',
      action: <p>Fly a clockwise circle 5 NM from the station, sped up 4×. Watch the oscilloscope and the radial readout.</p>,
      setup: () => {
        s.setMapRange(10)
        s.place('circle')
        clock.getState().setSpeed(4)
        clock.getState().play()
      },
      notice: (
        <p>
          The dashed VAR wave slides along under the REF wave, and the shaded phase difference grows through every value
          from 0° to 360°: it always equals the radial. On radial 000, magnetic north of the station, the two waves peak
          together. In the 3D view, the VAR wave peaks (the orange line on the oscilloscope crosses a VAR peak) when the
          glowing ball is a quarter turn short of the blue bar and heading toward it: the moment it approaches you fastest.
        </p>
      ),
    },
    {
      id: 'obs',
      question: 'How does one course take you TO and then FROM the station?',
      action: (
        <p>
          The OBS is set to 090 and the autopilot flies the needle, inbound from the west, sped up 4×. Watch the TO/FROM flag
          as you pass the station.
        </p>
      ),
      setup: () => {
        s.setMapRange(10)
        s.place('west')
        clock.getState().setSpeed(4)
        clock.getState().play()
      },
      notice: (
        <p>
          Inbound the flag says TO and the needle stays centred. Over the station the needle wavers and the flag shows OFF
          for a moment, then it says FROM: the same course 090 now leads away. The needle never depended on the heading,
          only on which radial you were on.
        </p>
      ),
    },
    {
      id: 'building',
      question: 'Does a building near the station matter, and which type copes better?',
      action: (
        <p>
          A building stands 250 m from a conventional VOR. Circle the station at 6 NM and watch the course-error chart and the
          needle. Then switch the station type to Doppler and compare.
        </p>
      ),
      setup: () => {
        s.setMapRange(10)
        s.setEnv('buildingDistanceM', 250)
        s.setEnv('building', true)
        s.setEnv('type', 'cvor')
        s.place('building')
        clock.getState().setSpeed(1)
        clock.getState().play()
      },
      notice: (
        <p>
          With the CVOR the reflection pushes the needle several degrees back and forth as you cross radials: the dots
          scatter across the wide dashed band. It is worst at right angles to the building and zero in line with it. With the
          DVOR the band shrinks to a thin sliver and the dots hug zero: about ten or more times smaller.
        </p>
      ),
    },
    {
      id: 'cone',
      question: 'What happens when you fly high over the station?',
      action: <p>Fly over the station at 20,000 ft on course 090, sped up 4×. Watch the side view, the CDI and the angle readout.</p>,
      setup: () => {
        s.setMapRange(10)
        s.place('overfly')
        clock.getState().setSpeed(4)
        clock.getState().play()
      },
      notice: (
        <p>
          Once the angle up from the station passes 40° the needle starts to swing, and above 50° the flag shows OFF: you are
          in the cone of confusion. At 20,000 ft it is about 5.5 NM across, more than a minute of flying. Then the flag
          reads FROM. The higher you fly, the wider the cone.
        </p>
      ),
    },
    {
      id: 'ident',
      question: 'Is a working needle enough?',
      action: <p>The station is under maintenance: its ident has been removed. Listen, and look at the CDI. Then switch the ident back on.</p>,
      setup: () => {
        s.setEnv('identRemoved', true)
        s.setListening(true)
      },
      notice: (
        <p>
          The needle and flag look perfectly normal, but no Morse comes through. A station under maintenance may be sending
          wrong guidance. Never navigate with a VOR you have not identified. With the ident back you hear CNS: <span className="font-mono">-.-. -. ...</span>
        </p>
      ),
    },
  ]

  const failures: FailureItem[] = [
    {
      id: 'building',
      title: 'Reflections from a nearby building',
      explanation: (
        <p>
          A building, fence or hill near the station reflects part of the signal. The reflection carries the variable signal
          of the building's direction and mixes with the direct one, so the course bends and wobbles:{' '}
          <Term id="site-error">site error</Term> and scalloping. A CVOR can be off by several degrees; a DVOR's big ring
          averages most of it away.
        </p>
      ),
      watch: 'the course-error chart and the "Reflection error now" readout. Switch between CVOR and DVOR.',
      checked: env.building,
      onChange: (v) => s.setEnv('building', v),
    },
    {
      id: 'fault',
      title: 'Station alarm and automatic shutdown',
      explanation: (
        <p>
          A fault makes the transmitted bearing drift. The station's monitor measures it; once the error passes about{' '}
          {MONITOR.bearingAlarmDeg}°, it switches the station off (or over to a standby transmitter) so that no wrong
          guidance goes out. In the cockpit the flag appears and the ident stops.
        </p>
      ),
      watch: 'the Station readout: the monitor value creeps up to 1°, then OFF AIR. Turn on "Standby transmitter fitted" to see the changeover.',
      checked: env.fault,
      onChange: (v) => s.setEnv('fault', v),
    },
    {
      id: 'ident',
      title: 'Ident removed during maintenance',
      explanation: (
        <p>
          While engineers work on a station it may radiate without its Morse ident. The needle can look fine, but the ident is
          the pilot's only confirmation that the station is the right one and in service.
        </p>
      ),
      watch: 'the Ident readout, and listen with "Listen to the ident".',
      checked: env.identRemoved,
      onChange: (v) => s.setEnv('identRemoved', v),
    },
    {
      id: 'cone',
      title: 'Flying through the cone of confusion',
      explanation: (
        <p>
          Straight above the station the direction information breaks down. The needle swings, the flag appears, and TO turns
          into FROM. Pilots hold their heading until the signal settles on the other side.
        </p>
      ),
      watch: 'the side view and the CDI flag. Switching this on sets the aircraft up at 20,000 ft, inbound; off puts it back at 6,000 ft.',
      checked: overfly,
      onChange: (v) => {
        s.place(v ? 'overfly' : 'west')
        clock.getState().play()
      },
    },
  ]

  return (
    <ModuleLayout
      moduleId="dvor"
      nextId="dme"
      idea={{
        analogy: (
          <p>
            Imagine a lighthouse that gives one quick flash in every direction when its turning beam points north. Count the
            time from the flash until the beam sweeps past you. A quarter of a turn? You are east of the lighthouse. Half a
            turn? South. <strong>The delay is your direction.</strong>
          </p>
        ),
        what: (
          <>
            <p>
              A <Term id="vor">VOR</Term> station does the same with two radio signals instead of light. The aircraft's
              receiver compares them and works out the <Term id="radial">radial</Term>: which direction the aircraft is from
              the station.
            </p>
            <p>
              The pilot picks a course with the <Term id="obs">OBS</Term> knob, and a needle shows whether to fly left or
              right to stay on it. In a <Term id="dvor">Doppler VOR</Term>, one of the two signals is made by a ring of
              antennas switched on one after another, so the signal seems to spin and its frequency shifts.
            </p>
          </>
        ),
        where: (
          <ul>
            <li>Along airways: for decades, the network of VORs defined the routes aircraft fly.</li>
            <li>At and near airports, for arrivals, departures and non-precision approaches.</li>
            <li>
              Usually together with a{' '}
              <Link to="/modules/dme" className="font-medium text-primary underline underline-offset-2">
                DME
              </Link>{' '}
              for distance, and kept as a backup to satellite navigation.
            </li>
          </ul>
        ),
      }}
      simulator={<DvorSimulator />}
      howItWorks={steps}
      tryThis={experiments}
      failures={failures}
      goDeeper={<Deeper />}
      quiz={quiz}
    />
  )
}

export default function DvorModule() {
  return (
    <DvorProvider>
      <DvorPage />
    </DvorProvider>
  )
}
