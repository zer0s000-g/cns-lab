import { Link } from 'react-router'
import { ModuleLayout } from '@/components/module/ModuleLayout'
import type { FailureItem } from '@/components/module/FailureList'
import type { Experiment } from '@/components/module/TryThis'
import type { QuizQuestion } from '@/components/module/Quiz'
import type { Step } from '@/components/module/Stepper'
import { Term } from '@/components/Term'
import Deeper from './deeper.mdx'
import { NdbSimulator } from './Simulator'
import { NdbProvider, useNdb, useNdbState } from './state'
import { BeaconVisual, LimitsVisual, LoopVisual, NeedleVisual, RmiVisual, SenseVisual } from './visuals'

const steps: Step[] = [
  {
    title: 'A beacon hums in every direction',
    body: (
      <>
        <p>
          An <Term id="ndb">NDB</Term> is a radio <Term id="transmitter">transmitter</Term> on the ground with a tall mast. It
          sends the same signal in every direction: "non-directional".
        </p>
        <p>
          It uses <Term id="lf-mf">low and medium frequencies</Term>. Those waves are hundreds of metres long and travel as a{' '}
          <Term id="ground-wave">ground wave</Term> that follows the curve of the Earth, so you can pick them up far away and
          low down.
        </p>
      </>
    ),
    visual: <BeaconVisual />,
  },
  {
    title: 'The loop antenna finds the line',
    body: (
      <>
        <p>
          In the aircraft, the <Term id="adf">ADF</Term> (automatic direction finder) listens with a{' '}
          <Term id="loop-antenna">loop antenna</Term>. A loop hears the beacon strongly along one line and not at all when the
          signal comes side-on.
        </p>
        <p>That finds the line to the beacon, but not which end of the line: in front, or behind?</p>
      </>
    ),
    visual: <LoopVisual />,
  },
  {
    title: 'The sense antenna removes the doubt',
    body: (
      <>
        <p>
          A second, simple <Term id="sense-antenna">sense antenna</Term> hears every direction equally. Added to the loop, it
          turns the figure of eight into a heart shape, a <Term id="cardioid">cardioid</Term>, that points one way only.
        </p>
        <p>Now the ADF knows which side the beacon is on.</p>
      </>
    ),
    visual: <SenseVisual />,
  },
  {
    title: 'The needle points at the beacon',
    body: (
      <>
        <p>
          The ADF needle points at the beacon. On a fixed card, the number under the needle is the{' '}
          <Term id="relative-bearing">relative bearing</Term>: the angle from the aircraft's nose, measured clockwise.
        </p>
        <p>
          Keep the needle on the nose and you fly to the beacon: <Term id="homing">homing</Term>. Fly over it and the needle
          swings to the tail: <Term id="station-passage">station passage</Term>.
        </p>
      </>
    ),
    visual: <NeedleVisual />,
  },
  {
    title: 'Add the heading',
    body: (
      <>
        <p>
          To know the compass direction to the beacon, add your <Term id="heading">heading</Term> to the relative bearing.
          The result is the <Term id="magnetic-north">magnetic</Term> bearing to the beacon.
        </p>
        <p>
          An <Term id="rmi">RMI</Term> does the sum for you: its card turns with the heading, so the needle points straight at
          the magnetic bearing.
        </p>
      </>
    ),
    visual: <RmiVisual />,
  },
  {
    title: 'Listen, and know its limits',
    body: (
      <>
        <p>
          Always check the <Term id="morse-ident">Morse ident</Term>: the beacon's two or three letters tell you it is the
          right one.
        </p>
        <p>
          The needle is easily fooled: by waves bouncing off the sky at night (<Term id="night-effect">night effect</Term>),
          by lightning, by a <Term id="coastal-refraction">coastline</Term> and by <Term id="mountain-effect">mountains</Term>.
          And it never tells you how far away the beacon is.
        </p>
      </>
    ),
    visual: <LimitsVisual />,
  },
]

const quiz: QuizQuestion[] = [
  {
    question: 'Your magnetic heading is 090°. The ADF needle shows a relative bearing of 045°. What is the magnetic bearing to the beacon?',
    options: ['045°', '090°', '135°', '315°'],
    answer: 2,
    explanation:
      'Magnetic bearing = magnetic heading + relative bearing: 090 + 045 = 135°. The needle is 45° to the right of the nose, and the nose points at 090, so the beacon is at 135.',
  },
  {
    question: 'Why does an ADF need a sense antenna as well as its loop antenna?',
    options: [
      'To receive the Morse ident',
      'To tell whether the beacon is in front or behind',
      'To measure the distance to the beacon',
      'To work at night',
    ],
    answer: 1,
    explanation:
      'A loop alone hears a beacon equally well from two opposite directions, so it has two possible answers 180° apart. The sense antenna breaks the tie by turning the pattern into a heart shape that points one way.',
  },
  {
    question: 'A thunderstorm is 15 NM to your right. What might the ADF needle do?',
    options: ['Nothing, the ADF ignores weather', 'Swing toward the lightning', 'Point exactly away from the storm', 'Show the distance to the storm'],
    answer: 1,
    explanation:
      'Lightning is a very strong radio source on the same low frequencies an NDB uses. The ADF is just a direction finder, so each flash tugs the needle toward the storm.',
  },
  {
    question: 'When is the night effect usually worst?',
    options: ['At noon, close to the beacon', 'Around dusk and dawn, far from the beacon', 'At midnight, directly over the beacon', 'It is the same all day'],
    answer: 1,
    explanation:
      'Sky waves bounced back by the ionosphere only reach you at night, and the ionosphere is most unsettled around sunset and sunrise. Far from the beacon the direct ground wave is weaker, so the sky wave matters more.',
  },
  {
    question: 'You fly directly over the beacon. What do the ADF needle and the RMI needle do?',
    options: [
      'They freeze where they were',
      'They swing from pointing ahead to pointing behind',
      'They spin round and round',
      'They point at magnetic north',
    ],
    answer: 1,
    explanation:
      'Before the beacon it is ahead of you; after it, it is behind you. The needles swing through about 180°. That swing is how pilots know they have passed overhead.',
  },
]

function NdbPage() {
  const { engine, store, clock } = useNdb()
  const env = useNdbState((s) => s.env)
  const coverage = useNdbState((s) => s.ratedCoverageNm)
  const s = store.getState()

  const experiments: Experiment[] = [
    {
      id: 'circle',
      question: 'What does the needle do when you fly a circle around the beacon?',
      action: <p>Circle the beacon clockwise at 4 NM and watch both instruments for a full turn. Time is sped up 4×.</p>,
      setup: () => {
        s.setMapRange(10)
        const st = engine.station.pos
        engine.setAircraft({ pos: { x: st.x, y: st.y - 4 }, headingDeg: 270, targetHeadingDeg: 270, speedKt: 240, targetSpeedKt: 240, held: false })
        s.setOrbitRadius(4)
        s.setAutopilot('orbit')
        clock.getState().setSpeed(4)
        clock.getState().play()
      },
      notice: (
        <p>
          On the ADF the needle stays near 090, off the right wingtip, the whole way round: a clockwise circle keeps the
          beacon on your right. On the RMI the card turns all the way round and the needle turns with it, so the magnetic
          bearing to the beacon goes through all 360°. At every moment, heading + 090 = bearing.
        </p>
      ),
    },
    {
      id: 'home',
      question: 'Can you fly to the beacon with nothing but the needle?',
      action: (
        <p>
          The aircraft is 20 NM out, heading 60° to the right of the beacon. Press "Turn until the needle is on the nose" (or
          use the heading slider), then fly straight. Watch the needles as you pass overhead.
        </p>
      ),
      setup: () => {
        s.setMapRange(25)
        s.place('near')
        clock.getState().setSpeed(4)
        clock.getState().play()
      },
      notice: (
        <p>
          With the needle on the nose the magnetic bearing to the beacon equals your heading, and with no wind you fly
          straight to it. Overhead, both needles swing round to the tail: station passage. The RMI tail now reads the
          bearing FROM the beacon.
        </p>
      ),
    },
    {
      id: 'storm',
      question: 'What does a thunderstorm do to the needle?',
      action: <p>Fly toward the beacon with a thunderstorm off to the right. Watch the needle and the lightning on the map.</p>,
      setup: () => {
        s.setMapRange(25)
        s.place('near')
        engine.turnToNeedle()
        engine.placeStormNearAircraft()
        s.setEnv('storm', true)
        clock.getState().setSpeed(1)
        clock.getState().play()
      },
      notice: (
        <p>
          Each flash yanks the needle toward it, by 10–30°, and then it creeps back. Lightning is a powerful radio source on
          the same low frequencies, and the ADF simply points at the strongest signal. Near storms, an ADF cannot be
          trusted.
        </p>
      ),
    },
    {
      id: 'daynight',
      question: 'Does the time of day matter?',
      action: (
        <p>
          The aircraft is 55 NM out, flying toward the beacon at dusk. Watch the needle for a while, then switch the time of
          day between Day, Dusk and Night.
        </p>
      ),
      setup: () => {
        s.setMapRange(100)
        s.place('far')
        s.setEnv('hour', 18)
        clock.getState().setSpeed(1)
        clock.getState().play()
      },
      notice: (
        <p>
          By day the needle is steady. At dusk it wanders by up to about 20°: waves bounced back by the ionosphere mix with
          the ground wave. Night is calmer than dusk but the needle still wanders. The closer you get, the smaller the
          effect, because the ground wave grows stronger compared with the sky wave.
        </p>
      ),
    },
    {
      id: 'sense',
      question: 'Why does the ADF need a second antenna?',
      action: <p>The beacon is behind you. The sense antenna has failed: look at the needle. Then switch the sense antenna back on.</p>,
      setup: () => {
        s.setMapRange(25)
        s.place('behind')
        s.setEnv('sense', false)
      },
      notice: (
        <p>
          With only the loop, the ADF hears the beacon equally from ahead and behind. Here it shows it ahead: exactly 180°
          wrong, and nothing warns you. With the sense antenna back on, the pattern becomes a heart shape with one direction
          and the needle swings to the tail.
        </p>
      ),
    },
  ]

  const failures: FailureItem[] = [
    {
      id: 'night',
      title: 'Night effect',
      explanation: (
        <p>
          After sunset the lowest layer of the <Term id="ionosphere">ionosphere</Term> fades and{' '}
          <Term id="sky-wave">sky waves</Term> bounce back down. They mix with the ground wave and the needle wanders. It is
          worst around dusk and dawn, when the ionosphere is changing, and far from the beacon.
        </p>
      ),
      watch: 'the needle wandering on a flight far from the beacon ("Far away" in the controls). Switched on here means dusk.',
      checked: env.hour !== 12,
      onChange: (v) => s.setEnv('hour', v ? 18 : 12),
    },
    {
      id: 'storm',
      title: 'Thunderstorm',
      explanation: (
        <p>
          Every lightning flash is a huge burst of radio energy on the same low frequencies. The ADF swings toward each
          flash and then settles back.
        </p>
      ),
      watch: 'lightning bolts on the map and the needle jumping toward them.',
      checked: env.storm,
      onChange: (v) => s.setEnv('storm', v),
    },
    {
      id: 'coast',
      title: 'Coastal refraction',
      explanation: (
        <p>
          The ground wave travels slightly faster over the sea, so it bends where it crosses the coast, like light entering
          water. The shallower the angle at which the signal crosses the coast, the bigger the error. A beacon right on the
          coast hardly suffers.
        </p>
      ),
      watch: 'put the aircraft "Along the coast" and fly north. The circle marks where the signal crosses the coast.',
      checked: env.coastal,
      onChange: (v) => s.setEnv('coastal', v),
    },
    {
      id: 'mountain',
      title: 'Mountain effect',
      explanation: (
        <p>
          High ground reflects the beacon's signal. Near mountains the reflected and direct waves arrive together, and as the
          aircraft moves they add and cancel in turn: the needle becomes erratic. Flying higher helps.
        </p>
      ),
      watch: 'put the aircraft "By the mountains". Dashed lines show the reflections.',
      checked: env.mountain,
      onChange: (v) => s.setEnv('mountain', v),
    },
    {
      id: 'sense',
      title: 'Sense antenna failure',
      explanation: (
        <p>
          Without the sense antenna, the loop cannot tell front from back. The needle may point exactly the wrong way, with
          no warning.
        </p>
      ),
      watch: 'put the aircraft with the "Beacon behind": the needle points ahead.',
      checked: !env.sense,
      onChange: (v) => s.setEnv('sense', !v),
    },
    {
      id: 'weak',
      title: 'A small beacon far away',
      explanation: (
        <p>
          A low-power locator beacon only has a <Term id="rated-coverage">rated coverage</Term> of about 15 NM. Beyond it
          the signal sinks into the noise: the needle wanders, then parks with a NO SIGNAL flag.
        </p>
      ),
      watch: 'the Signal readout and the needle when the aircraft is more than about 20 NM away.',
      checked: coverage <= 20,
      onChange: (v) => s.setCoverage(v ? 15 : 60),
    },
  ]

  return (
    <ModuleLayout
      moduleId="ndb"
      nextId="dvor"
      idea={{
        analogy: (
          <p>
            Imagine standing on a beach on a dark night. You cannot see the lighthouse, but you can hear its foghorn. You turn
            your head until the sound is straight ahead, and now you know <strong>which way</strong> it is, though not{' '}
            <strong>how far</strong>.
          </p>
        ),
        what: (
          <>
            <p>
              An <Term id="ndb">NDB</Term> (non-directional beacon) is the foghorn: a simple radio transmitter that sends the
              same signal in every direction. The aircraft's <Term id="adf">ADF</Term> is the turning head: it works out which
              direction the signal comes from, and its needle points at the beacon.
            </p>
            <p>
              It is one of the oldest radio navigation aids, and still one of the simplest: one mast on the ground, one
              needle in the cockpit.
            </p>
          </>
        ),
        where: (
          <ul>
            <li>As "locators" near airports, marking a point on the approach.</li>
            <li>On islands, remote coasts and oil platforms, where there are few other aids.</li>
            <li>
              Fewer every year: satellite navigation is replacing them. See the{' '}
              <Link to="/modules/gnss" className="font-medium text-primary underline underline-offset-2">
                GNSS module
              </Link>
              .
            </li>
          </ul>
        ),
      }}
      simulator={<NdbSimulator />}
      howItWorks={steps}
      tryThis={experiments}
      failures={failures}
      goDeeper={<Deeper />}
      quiz={quiz}
    />
  )
}

export default function NdbModule() {
  return (
    <NdbProvider>
      <NdbPage />
    </NdbProvider>
  )
}
