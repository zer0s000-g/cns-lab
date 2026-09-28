import { Link } from 'react-router'
import { ModuleLayout } from '@/components/module/ModuleLayout'
import type { FailureItem } from '@/components/module/FailureList'
import type { Experiment } from '@/components/module/TryThis'
import type { QuizQuestion } from '@/components/module/Quiz'
import type { Step } from '@/components/module/Stepper'
import { Term } from '@/components/Term'
import Deeper from './deeper.mdx'
import { FAILED_RECEIVER, FAILURE_CLOCK_ERROR_NS, OUTSIDE_AIRCRAFT, SPOOF_OFFSET, SPOOFED_AIRCRAFT } from './engine'
import { MlatSimulator } from './Simulator'
import { MlatProvider, useMlat, useMlatState } from './state'
import { ArrivalVisual, CrossVisual, CurveVisual, DifferenceVisual, GeometryVisual, TransmitVisual } from './visuals'

const steps: Step[] = [
  {
    title: 'The aircraft transmits',
    body: (
      <>
        <p>
          Every airliner already carries a <Term id="transponder">transponder</Term>. It answers radar questions (in{' '}
          <Term id="mode-s">Mode S</Term> its reply includes the altitude) and, with <Term id="ads-b">ADS-B</Term>, sends
          short messages by itself about twice a second, on 1090 MHz.
        </p>
        <p>Multilateration simply listens to those signals. Nothing new has to be fitted to the aircraft.</p>
      </>
    ),
    visual: <TransmitVisual />,
  },
  {
    title: 'Several receivers hear it',
    body: (
      <p>
        Simple listening stations, <Term id="receiver">receivers</Term>, are spread around the area. The signal travels at
        the <Term id="speed-of-light">speed of light</Term>, so it reaches the nearest receiver first and the farthest last:
        about 3.3 millionths of a second later for every extra kilometre.
      </p>
    ),
    visual: <ArrivalVisual />,
  },
  {
    title: 'Only the differences count',
    body: (
      <>
        <p>
          Nobody knows exactly when the aircraft transmitted. But subtract two arrival times and that unknown moment
          cancels out. This <Term id="tdoa">time difference of arrival</Term> tells you how much farther the aircraft is
          from one receiver than from the other.
        </p>
        <p>Like thunder: you do not know when the lightning struck, but you know which town heard it first.</p>
      </>
    ),
    visual: <DifferenceVisual />,
  },
  {
    title: 'Each difference draws a curve',
    body: (
      <p>
        "3.6 km farther from A than from B" is true all along a curve, a <Term id="hyperbola">hyperbola</Term>. One pair of
        receivers says: the aircraft is somewhere on this line.
      </p>
    ),
    visual: <CurveVisual />,
  },
  {
    title: 'Where the curves cross',
    body: (
      <>
        <p>
          A third receiver gives a second curve, and where they cross is the aircraft. The aircraft also reports its
          altitude, so three receivers are enough for the position across the ground. Four or more remove doubts and
          let the system check itself.
        </p>
      </>
    ),
    visual: <CrossVisual />,
  },
  {
    title: 'Geometry and clocks',
    body: (
      <>
        <p>
          The fix is sharp where curves cross at steep angles, inside the network. Outside it the curves run nearly
          parallel and the fix smears out. The <Term id="geometry-factor">geometry factor</Term> measures this.
        </p>
        <p>
          The clocks must agree to within a few billionths of a second: 1 nanosecond is 30 cm of distance. That is why
          the receivers are kept in step by <Term id="time-synchronisation">time synchronisation</Term>.
        </p>
      </>
    ),
    visual: <GeometryVisual />,
  },
]

const quiz: QuizQuestion[] = [
  {
    question: 'Receiver B hears a reply 10 µs after receiver A. What does that tell you?',
    options: [
      'The aircraft is 3 km from receiver A',
      'The aircraft is about 3 km farther from B than from A',
      'The aircraft is flying 3 km high',
      'Receiver B is 3 km from receiver A',
    ],
    answer: 1,
    explanation:
      'Radio covers about 0.3 km per microsecond, so 10 µs is 3 km. But a time difference only gives a difference of distances: B is 3 km farther away than A. That puts the aircraft on a curve, not at a point.',
  },
  {
    question: 'Why does MLAT not need to know when the aircraft transmitted?',
    options: [
      'Transponders put the time in every message',
      'The unknown moment cancels out when two arrival times are subtracted',
      'The receivers ask the aircraft when it transmitted',
      'It uses the time from the aircraft’s GNSS',
    ],
    answer: 1,
    explanation:
      'Every arrival time contains the same unknown sending moment. Subtract two of them and it disappears, leaving only the difference in travel time. That is why the method is called time difference of arrival.',
  },
  {
    question: 'The aircraft reports its altitude. What is the smallest number of receivers that can give a position?',
    options: ['2', '3', '4', '5'],
    answer: 1,
    explanation:
      'Three receivers give two independent time differences, so two curves, and they cross at the aircraft (in some places at two points). Without the altitude report you need a fourth receiver, because height is a third unknown.',
  },
  {
    question: 'One receiver’s clock is 100 ns late. Roughly how much error does that put into its distance?',
    options: ['3 cm', '30 cm', '3 m', '30 m'],
    answer: 3,
    explanation:
      'Light travels about 0.3 m in a nanosecond, so 100 ns is about 30 m. That shifts every curve that uses this receiver, which is why the clocks are synchronised so carefully.',
  },
  {
    question: 'An aircraft broadcasts a false ADS-B position. Why is MLAT not fooled?',
    options: [
      'MLAT decodes a hidden, correct position in the message',
      'MLAT works out where the signal came from, using arrival times, not what the message says',
      'MLAT asks the pilot to confirm',
      'MLAT is fooled too',
    ],
    answer: 1,
    explanation:
      'MLAT measures when the signal reached each receiver, which depends only on where the transmitter really is. It is an independent check on ADS-B: when the two disagree, the ADS-B report is not trusted.',
  },
]

function MlatPage() {
  const { store } = useMlat()
  const env = useMlatState((s) => s.env)
  const params = useMlatState((s) => s.params)
  const s = store.getState()

  const experiments: Experiment[] = [
    {
      id: 'line',
      question: 'What happens if all the receivers stand in a straight line?',
      action: <p>Put every receiver along one east–west road and watch the accuracy map, the curves and the readouts for CNS101.</p>,
      setup: () => {
        s.resetReceivers()
        s.setEnv('badGeometry', true)
        s.select('CNS101')
        s.setShowHeatmap(true)
        s.setShowCurves(true)
      },
      notice: (
        <p>
          The curves now cross twice, once on each side of the line: the mirror image fits the times just as well, and
          the whole map turns amber, marked "two possible positions". Close to the line and beyond its ends the curves run
          almost parallel, so the expected error there jumps to hundreds of metres, and on the line itself, beyond the
          last receiver, there is no position at all. Spread the receivers around the area again with "Spread around".
        </p>
      ),
    },
    {
      id: 'remove',
      question: 'How few receivers can still find the aircraft?',
      action: (
        <p>
          Switch off R5, then R4, then R3 in the Receivers panel, one at a time. Watch the readouts, the curves and the
          amber "two possible positions" area.
        </p>
      ),
      setup: () => {
        s.resetAll()
        s.select('CNS101')
      },
      notice: (
        <p>
          With 4 receivers the fix is still good. With 3 (R1, R2, R3), about half of the map turns amber inside a dashed
          outline, because the two curves can cross twice there, and "Receivers disagree by" shows a dash: there is no spare receiver left to check
          the answer. With 2 there is only one curve: the aircraft could be anywhere along it, so there is no position.
          Switch off "Use the altitude the aircraft reports" and you need a fourth receiver again.
        </p>
      ),
    },
    {
      id: 'spoof',
      question: 'Can a false ADS-B position fool multilateration?',
      action: <p>Make {SPOOFED_AIRCRAFT} broadcast a false position and compare the diamond (its ADS-B report) with the triangle (MLAT).</p>,
      setup: () => {
        s.setEnv('spoof', true)
        s.select(SPOOFED_AIRCRAFT)
        s.setShowCurves(true)
      },
      notice: (
        <p>
          The diamond jumps {SPOOF_OFFSET.distanceNm} NM to the north-east and a red dashed line links it to the MLAT
          triangle, which stays on the real aircraft. MLAT uses when the signal arrived, not what the message says, so the
          system flags the ADS-B report as not validated.
        </p>
      ),
    },
    {
      id: 'clock',
      question: 'How much does a clock error of a fraction of a microsecond matter?',
      action: (
        <p>
          Give receiver R2 a clock error of {FAILURE_CLOCK_ERROR_NS} ns (0.3 µs) and look at the close-up. Then drag the
          "Clock error at R2" slider to 1,000 ns.
        </p>
      ),
      setup: () => {
        s.resetReceivers()
        s.setParam('clockErrorNs', FAILURE_CLOCK_ERROR_NS)
        s.select('CNS101')
        s.setShowCurves(true)
      },
      notice: (
        <p>
          The curves that use R2 (dashed) move off the aircraft while the others still meet on it. The fix is pulled
          about 50–70 m away, and "Receivers disagree by" turns amber: with spare receivers the system can tell that one
          of them is wrong. At 1,000 ns the fix moves about 200 m. Every nanosecond is 30 cm.
        </p>
      ),
    },
    {
      id: 'outside',
      question: 'How well does MLAT work outside its network?',
      action: <p>Send {OUTSIDE_AIRCRAFT} far out over the sea, beyond the receivers, and follow it in the close-up.</p>,
      setup: () => {
        s.resetReceivers()
        s.setEnv('outside', true)
        s.setShowHeatmap(true)
      },
      notice: (
        <p>
          From out there all the signals arrive from roughly the same direction. The curves meet at a shallow angle, the
          95% ellipse stretches out and the close-up zooms out: the expected error grows from about 5 m inside the network
          to about 100 m.
        </p>
      ),
    },
  ]

  const failures: FailureItem[] = [
    {
      id: 'receiver',
      title: 'A receiver fails',
      explanation: (
        <p>
          Receiver {FAILED_RECEIVER} on the coast road stops sending time stamps. The system simply leaves it out. Four
          receivers are still enough, but the good area shrinks: to the north and south-east the expected error becomes
          several times larger.
        </p>
      ),
      watch: `${FAILED_RECEIVER} is crossed out and the accuracy map shrinks.`,
      checked: env.receiverFailed,
      onChange: (v) => s.setEnv('receiverFailed', v),
    },
    {
      id: 'timing',
      title: 'A timing error at one receiver',
      explanation: (
        <p>
          Receiver R2's clock drifts {FAILURE_CLOCK_ERROR_NS} ns out of step, for example after losing its GNSS time. Every
          curve that uses R2 moves, and the fix is pulled away from the aircraft. Spare receivers let the system notice
          that the times no longer agree.
        </p>
      ),
      watch: 'dashed curves in the close-up, and the "Receivers disagree by" readout.',
      checked: params.clockErrorNs !== 0,
      onChange: (v) => s.setParam('clockErrorNs', v ? FAILURE_CLOCK_ERROR_NS : 0),
    },
    {
      id: 'geometry',
      title: 'Bad geometry: receivers in a line',
      explanation: (
        <p>
          Receivers along one road or coastline cannot tell which side of the line an aircraft is on, and near the line
          and beyond its ends the curves are almost parallel. Real networks are planned to surround the airspace they
          cover.
        </p>
      ),
      watch: 'the amber "two possible positions" area covering the whole map.',
      checked: env.badGeometry,
      onChange: (v) => s.setEnv('badGeometry', v),
    },
    {
      id: 'outside',
      title: 'An aircraft outside the network',
      explanation: (
        <p>
          {OUTSIDE_AIRCRAFT} flies far out over the sea. Seen from there, all the receivers are in roughly the same
          direction, so the curves cross at shallow angles and the error grows quickly with distance.
        </p>
      ),
      watch: `${OUTSIDE_AIRCRAFT}'s readouts and its stretched ellipse in the close-up.`,
      checked: env.outside,
      onChange: (v) => s.setEnv('outside', v),
    },
    {
      id: 'spoof',
      title: 'A false ADS-B position (spoofing)',
      explanation: (
        <p>
          A faulty or tampered transmitter broadcasts the wrong position. Radar-free surveillance that trusted ADS-B alone
          would be fooled; MLAT, working from arrival times, is not, so it is used to validate ADS-B reports.
        </p>
      ),
      watch: 'the red dashed line between the diamond and the triangle.',
      checked: env.spoof,
      onChange: (v) => s.setEnv('spoof', v),
    },
  ]

  return (
    <ModuleLayout
      moduleId="mlat"
      nextId="surface"
      idea={{
        analogy: (
          <p>
            You see lightning and wait for the thunder. Now imagine friends in three towns all note the moment they hear
            it. Nobody knows exactly when the lightning struck, but whoever heard it first was closest, and comparing the
            <strong> differences</strong> between their times tells you where it hit.
          </p>
        ),
        what: (
          <>
            <p>
              <Term id="multilateration">Multilateration</Term> (MLAT) does the same with radio. Ground receivers
              listen to the signals aircraft already send. Each one notes when the signal arrived, and the differences
              between those times pinpoint the aircraft.
            </p>
            <p>
              It does not need a rotating radar, and it does not depend on the position the aircraft reports about
              itself. Over a large area it is called <Term id="wam">wide area multilateration</Term> (WAM).
            </p>
          </>
        ),
        where: (
          <ul>
            <li>At busy airports, to see aircraft on runways and taxiways, even in fog.</li>
            <li>In mountainous regions and terminal areas, where many cheap receivers replace a radar.</li>
            <li>
              To check <Link to="/modules/ads" className="font-medium text-primary underline underline-offset-2">ADS-B</Link>{' '}
              reports, because it cannot be fooled by a false position message.
            </li>
          </ul>
        ),
      }}
      simulator={<MlatSimulator />}
      howItWorks={steps}
      tryThis={experiments}
      failures={failures}
      goDeeper={<Deeper />}
      quiz={quiz}
    />
  )
}

export default function MlatModule() {
  return (
    <MlatProvider>
      <MlatPage />
    </MlatProvider>
  )
}
