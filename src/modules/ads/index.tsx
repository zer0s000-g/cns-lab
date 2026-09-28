import { Link } from 'react-router'
import { ModuleLayout } from '@/components/module/ModuleLayout'
import type { FailureItem } from '@/components/module/FailureList'
import type { Experiment } from '@/components/module/TryThis'
import type { QuizQuestion } from '@/components/module/Quiz'
import type { Step } from '@/components/module/Stepper'
import { Term } from '@/components/Term'
import Deeper from './deeper.mdx'
import { JAMMER } from './engine'
import { CLEARED_FL } from './oceanEngine'
import { AdsSimulator, flyCircle } from './Simulator'
import { AdsProvider, useAds, useAdsState } from './state'
import { AdsbInVisual, AdscVisual, BroadcastVisual, DependencyVisual, GnssVisual, QualityVisual, ReceiversVisual } from './visuals'

const steps: Step[] = [
  {
    title: 'Know where you are',
    body: (
      <p>
        ADS-B starts on board. The aircraft's <Term id="gnss">GNSS</Term> receiver (GPS and similar systems) works out its own
        position from satellite signals, very accurately and many times a second.
      </p>
    ),
    visual: <GnssVisual />,
  },
  {
    title: 'Tell everyone',
    body: (
      <>
        <p>
          With <Term id="ads-b-out">ADS-B Out</Term>, the aircraft broadcasts that position about twice a second on 1090 MHz,
          together with its altitude, speed, direction, callsign and its unique{' '}
          <Term id="icao-address">24-bit address</Term>.
        </p>
        <p>
          Nobody has to ask. Each broadcast is a short digital message, an <Term id="extended-squitter">extended squitter</Term>.
        </p>
      </>
    ),
    visual: <BroadcastVisual />,
  },
  {
    title: 'Anyone can listen',
    body: (
      <>
        <p>
          A ground receiver is a small box with a fixed antenna: no rotating dish, no transmitter. It hears every aircraft in
          radio <Term id="line-of-sight">line of sight</Term>, so a high aircraft is heard much further away than a low one.
        </p>
        <p>Because the aircraft does the measuring, the controller gets a fresh, precise position every half second.</p>
      </>
    ),
    visual: <ReceiversVisual />,
  },
  {
    title: 'How good is the position?',
    body: (
      <p>
        Every position comes with quality numbers. <Term id="nacp">NACp</Term> says how accurate it is;{' '}
        <Term id="nic">NIC</Term> gives a radius the aircraft is guaranteed to be inside. A controller's screen can draw them as a
        circle of uncertainty around the target.
      </p>
    ),
    visual: <QualityVisual />,
  },
  {
    title: 'Pilots can listen too',
    body: (
      <p>
        With <Term id="ads-b-in">ADS-B In</Term>, an aircraft receives the broadcasts of the traffic around it and shows them on
        a <Term id="cdti">cockpit traffic display</Term>, with each one's height difference in hundreds of feet.
      </p>
    ),
    visual: <AdsbInVisual />,
  },
  {
    title: 'Over the ocean: ADS-C',
    body: (
      <>
        <p>
          Far from land there are no receivers. <Term id="ads-c">ADS-C</Term> is a private arrangement instead: the oceanic
          centre sets up a <Term id="adsc-contract">contract</Term>, and the aircraft sends reports only to that centre, through
          a satellite, using <Term id="fans-1a">FANS 1/A</Term> over <Term id="acars">ACARS</Term>.
        </p>
        <p>Reports come every few minutes, or when something changes, and each takes a while to arrive.</p>
      </>
    ),
    visual: <AdscVisual />,
  },
  {
    title: 'The catch: it depends on GNSS',
    body: (
      <>
        <p>
          The "D" in ADS stands for <em>dependent</em>: on the aircraft's GNSS, and on the transmitter telling the truth. If GNSS
          is <Term id="jamming">jammed</Term>, positions degrade and then disappear. A ground transmitter can even invent a
          fake aircraft (<Term id="adsb-spoofing">spoofing</Term>).
        </p>
        <p>
          That is why ADS-B is <Term id="position-cross-check">cross-checked</Term> against{' '}
          <Link to="/modules/ssr" className="font-medium text-primary underline underline-offset-2">
            radar
          </Link>{' '}
          or <Term id="multilateration">multilateration</Term>, which measure the aircraft independently.
        </p>
      </>
    ),
    visual: <DependencyVisual />,
  },
]

const quiz: QuizQuestion[] = [
  {
    question: 'Where does an aircraft get the position it broadcasts with ADS-B?',
    options: ['From the nearest radar', 'From its own GNSS receiver', 'From the controller', 'From its altitude encoder'],
    answer: 1,
    explanation:
      'The aircraft works out its own position with GNSS and broadcasts it. That is what "dependent" means: the position depends on the aircraft’s own navigation equipment.',
  },
  {
    question: 'About how often does ADS-B send a new position?',
    options: ['Once per radar antenna turn, every 4 to 12 s', 'About twice a second', 'Once a minute', 'Every 14 minutes'],
    answer: 1,
    explanation: 'Position and velocity messages each go out about every half second. Radar looks at an aircraft only once per antenna turn; ADS-C over the ocean may report every 14 minutes.',
  },
  {
    question: 'GNSS is jammed near an airport. What does the controller see?',
    options: [
      'Both radar and ADS-B lose the aircraft',
      'ADS-B positions get worse and then disappear, but the radar still sees the aircraft',
      'Nothing changes',
      'Radar loses the aircraft, ADS-B keeps it',
    ],
    answer: 1,
    explanation:
      'ADS-B can only broadcast the position its GNSS gives it. Radar measures the aircraft from the ground and does not need GNSS, which is one reason radar is kept as a backup.',
  },
  {
    question: 'In the middle of an ocean, without satellite ADS-B receivers, how does the oceanic centre follow an aircraft?',
    options: [
      'ADS-B receivers on ships',
      'ADS-C reports sent through a satellite, under a contract',
      'Primary radar on islands',
      'It cannot know anything until the aircraft reaches land',
    ],
    answer: 1,
    explanation:
      'The centre sets up an ADS-C contract: reports every so many minutes, and extra ones when events happen, sent by satellite data link. They arrive some tens of seconds after they were sent.',
  },
  {
    question: 'An ADS-B target shows NACp 6 instead of NACp 10. What does that mean?',
    options: ['Its position is less accurate', 'It is flying lower', 'Its transmitter is weaker', 'Its callsign is missing'],
    answer: 0,
    explanation: 'NACp is the accuracy category: 10 means better than 10 m, 6 means better than 0.3 NM (about 556 m). The screen can draw that as a bigger circle of uncertainty.',
  },
]

function AdsPage() {
  const { engine, clock, oceanClock, store } = useAds()
  const env = useAdsState((s) => s.env)
  const crossCheck = useAdsState((s) => s.crossCheck)
  const s = store.getState()

  const airport = () => {
    s.setScenario('airport')
    clock.getState().play()
  }

  const experiments: Experiment[] = [
    {
      id: 'turn',
      question: 'Which draws a turn better: radar or ADS-B?',
      action: <p>Make CNS101 fly a circle, slow the radar antenna to a 12-second turn, and compare the two side-by-side views.</p>,
      setup: () => {
        airport()
        s.select('CNS101')
        s.setRadarPeriod(12)
        s.set({ compareZoomNm: 5 })
        flyCircle(engine, 'CNS101')
      },
      notice: (
        <p>
          The radar gives one plot every 12 seconds, so its track cuts across the circle like a polygon and its newest plot lags
          behind the aircraft. The ADS-B diamonds arrive about twice a second and trace the circle smoothly. The radar's sideways
          error also grows with distance from the radar (see the readout); the ADS-B error does not.
        </p>
      ),
    },
    {
      id: 'jam',
      question: 'What does radar still show when GNSS is jammed?',
      action: <p>Switch on the jammer and fly CNS303 straight into it. Watch its NACp and NIC in the message panel, and both screens.</p>,
      setup: () => {
        airport()
        s.setEnv('jamming', true)
        s.select('CNS303')
        s.set({ atcShow: 'both' })
        const start = { x: JAMMER.pos.x + 15.5, y: JAMMER.pos.y + 15.5 }
        engine.setAircraft('CNS303', { pos: start, headingDeg: 225, targetHeadingDeg: 225, mode: { kind: 'heading' }, speedKt: 250, targetSpeedKt: 250 })
        clock.getState().setSpeed(4)
      },
      notice: (
        <p>
          As CNS303 flies in, NACp and NIC fall and its ADS-B position gets noisier. Inside the red circle the receiver loses
          GNSS: the messages carry no position (NIC 0), and the ADS-B diamond stops and then disappears. The radar square keeps coming
          every turn and now carries CNS303's label, because radar measures the aircraft itself and does not need GNSS.
        </p>
      ),
    },
    {
      id: 'ocean',
      question: 'Can ADS-B follow an aircraft across an ocean?',
      action: <p>Open the ocean crossing, sped up 60 times, and watch what the oceanic centre receives as CNS808 leaves the coast.</p>,
      setup: () => {
        s.setScenario('ocean')
        s.restartCrossing()
        s.setSpaceAdsb(false)
        oceanClock.getState().setSpeed(60)
        oceanClock.getState().play()
      },
      notice: (
        <p>
          While CNS808 is inside the west coast receiver's circle (about 244 NM at FL350), the centre has an ADS-B diamond updated
          twice a second. After that only ADS-C reports arrive: one every 14 minutes plus one at each waypoint, each some tens of
          seconds late. Between reports the aircraft flies on for up to about 110 NM, which is why oceanic separation is so large.
          Switch on space-based ADS-B and the gap disappears.
        </p>
      ),
    },
    {
      id: 'noadsb',
      question: 'Who can see an aircraft that has no ADS-B?',
      action: <p>Take CNS404's ADS-B away and look at the controller's screen and at CNS101's cockpit traffic display.</p>,
      setup: () => {
        airport()
        s.setEnv('noAdsb', true)
        s.select('CNS101')
        s.set({ adsbIn: true, cdtiRangeNm: 40, cdtiUp: 'north', atcShow: 'both' })
      },
      notice: (
        <p>
          CNS404 vanishes from ADS-B: no diamond on the controller's screen and nothing on CNS101's cockpit display, even when it
          is close. The radar still shows it as a labelled square, because the radar measures it. An aircraft without ADS-B Out is
          invisible to ADS-B receivers, on the ground and in the air.
        </p>
      ),
    },
    {
      id: 'event',
      question: 'Does ADS-C wait for the next periodic report?',
      action: (
        <p>
          Turn on the altitude-band and fast-climb events, then climb CNS808 from FL{CLEARED_FL} to FL370 without a clearance.
        </p>
      ),
      setup: () => {
        s.setScenario('ocean')
        s.setContract({ altitudeEvent: true, verticalRateEvent: true })
        s.setOceanFl(370)
        oceanClock.getState().setSpeed(10)
        oceanClock.getState().play()
      },
      notice: (
        <p>
          As soon as the climb exceeds 1,500 ft/min, an event report is sent; when the aircraft leaves FL347–FL353, another
          follows. Neither waits for the periodic report, but each still takes some tens of seconds to reach the centre.
        </p>
      ),
    },
  ]

  const failures: FailureItem[] = [
    {
      id: 'jam',
      title: 'GNSS jamming',
      explanation: (
        <p>
          GNSS signals are extremely weak. A jammer on the ground drowns them out: first the position gets less accurate (NACp and
          NIC fall), then the receiver loses its fix and ADS-B has no position to send. Radar is not affected.
        </p>
      ),
      watch: 'aircraft near the jammer south-west of the airport losing their ADS-B diamond while the radar square stays.',
      checked: env.jamming,
      onChange: (v) => {
        s.setScenario('airport')
        s.setEnv('jamming', v)
      },
    },
    {
      id: 'ghost',
      title: 'Spoofed "ghost" aircraft',
      explanation: (
        <p>
          A transmitter on the ground broadcasts messages for an aircraft that does not exist. ADS-B receivers have no way to tell
          from the message alone: it looks perfect. Radar sees nothing there, and multilateration would find the signal coming
          from the ground.
        </p>
      ),
      watch: 'CNS777 circling south-east of the airport: a diamond with no radar square. The rings come from the spoofer, not from CNS777.',
      checked: env.ghost,
      onChange: (v) => {
        s.setScenario('airport')
        s.setEnv('ghost', v)
      },
    },
    {
      id: 'check',
      title: 'The fix for spoofing: cross-check with radar',
      explanation: (
        <p>
          The ground system compares every ADS-B target with the radar. A real aircraft has a radar plot with the same address in
          the same place. A target the radar should see but does not is flagged NO RADAR.
        </p>
      ),
      checked: crossCheck,
      onChange: (v) => {
        s.setScenario('airport')
        s.set({ crossCheck: v })
      },
    },
    {
      id: 'noadsb',
      title: 'An aircraft without ADS-B',
      explanation: (
        <p>
          ADS-B only knows about aircraft that broadcast. Without ADS-B Out, CNS404 is invisible to every ADS-B receiver, and to
          other pilots' traffic displays. Radar still sees it where there is radar coverage.
        </p>
      ),
      watch: 'CNS404 near the airport: only a radar square, no diamond.',
      checked: env.noAdsb,
      onChange: (v) => {
        s.setScenario('airport')
        s.setEnv('noAdsb', v)
      },
    },
    {
      id: 'quality',
      title: 'Low position quality',
      explanation: (
        <p>
          An older GNSS receiver without augmentation reports a lower NACp. The broadcast position wanders by a couple of hundred
          metres, and a zoomed-in view shows a wide circle of uncertainty around it.
        </p>
      ),
      watch: 'CNS101 in the side-by-side ADS-B view: jittery diamonds inside a big dashed circle.',
      checked: env.lowQuality,
      onChange: (v) => {
        s.setScenario('airport')
        s.setEnv('lowQuality', v)
        if (v) s.select('CNS101')
      },
    },
  ]

  return (
    <ModuleLayout
      moduleId="ads"
      nextId="dvor"
      idea={{
        analogy: (
          <p>
            ADS-B is like posting your location on a public notice board every second: anyone walking past can read it. ADS-C is
            like texting your location to one friend every 15 minutes, or straight away when something changes.
          </p>
        ),
        what: (
          <>
            <p>
              With <Term id="ads-b">ADS-B</Term>, the aircraft works out its own position using <Term id="gnss">GNSS</Term> and
              broadcasts it about twice a second, together with its identity, altitude and speed. Anyone with a receiver can listen:
              controllers on the ground, and other aircraft. No radar is needed.
            </p>
            <p>
              <Term id="ads-c">ADS-C</Term> is used over oceans and remote areas: the aircraft sends reports to one chosen control
              centre, by satellite, at agreed times or when something changes.
            </p>
          </>
        ),
        where: (
          <ul>
            <li>Around the world as a main or added source of surveillance, with ground receivers far cheaper than radar.</li>
            <li>In the cockpit, where ADS-B In shows pilots the traffic around them.</li>
            <li>Over oceans and remote regions: ADS-C, and more and more space-based ADS-B.</li>
          </ul>
        ),
      }}
      simulator={<AdsSimulator />}
      howItWorks={steps}
      tryThis={experiments}
      failures={failures}
      goDeeper={<Deeper />}
      quiz={quiz}
    />
  )
}

export default function AdsModule() {
  return (
    <AdsProvider>
      <AdsPage />
    </AdsProvider>
  )
}
