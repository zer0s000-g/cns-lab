import { lazy } from 'react'
import { Link } from 'react-router'
import { ModuleLayout, type StageSpec } from '@/components/module/ModuleLayout'
import type { FailureItem } from '@/components/module/FailureList'
import type { Experiment } from '@/components/module/TryThis'
import type { QuizQuestion } from '@/components/module/Quiz'
import type { Step } from '@/components/module/Stepper'
import { Term } from '@/components/Term'
import { cdiLateral, cdiVertical, glideslopeElevationDeg, GS_COVERAGE } from '@/core/ils'
import { useClock } from '@/hooks/useSimClock'
import { useSampled } from '@/hooks/useSampled'
import { TelemetryRow } from '@/hud/Telemetry'
import { HEIGHT_X, LAT_X, MODEL_X, TABLE_LENGTH_KM } from './heroScale'
import Deeper from './deeper.mdx'
import { IlsSimulator } from './Simulator'
import { IlsProvider, useIls, useIlsState } from './state'
import { CompareVisual, GlideslopeVisual, HonestVisual, LocalizerVisual, MarkersVisual, MinimumsVisual, NeedlesVisual, TwoBeamsVisual } from './visuals'

// The 3D scene is its own chunk, so the page text appears before three.js loads.
const IlsHero = lazy(() => import('./Hero3D'))

/** Honesty labels: the runway close-up has its own scale, and the tone colours are always explained. */
const SCALE_LABEL = `Runway close-up · ${TABLE_LENGTH_KM.toFixed(1)} km table · sideways ×${LAT_X} · heights ×${HEIGHT_X} · aircraft and antennas ×${MODEL_X}`
const TONE_LABEL = 'Cyan, lines: 90 Hz louder · amber, dots: 150 Hz louder'
const FIELD_LABEL = 'Tint from the real signals · lobe outlines illustrative'

const SHOTS: StageSpec['shots'] = {
  idea: { position: [-15, 5.5, 7], target: [-4.5, 0.6, -1.8], fov: 36 },
  simulator: { position: [-2, 12, 11], target: [-4.6, 0.8, -0.6], fov: 38 },
  how: { position: [-15, 5.5, 7], target: [-4.5, 0.6, -1.8], fov: 36 },
  try: { position: [-6, 9, 13], target: [-9, 1.2, 0], fov: 36 },
  wrong: { position: [7, 3.2, 6], target: [0.5, 0.4, -0.6], fov: 34 },
  deeper: { position: [10, 7, 13], target: [-6, 1, 0], fov: 32 },
  quiz: { position: [-7, 22, 0.1], target: [-7, 0, 0], fov: 38 },
}

/** Shots for the eight "How it works" steps. */
const HOW_SHOTS: StageSpec['howShots'] = [
  // 1 Two beams: the runway, both antennas and the approach.
  { position: [-15, 5.5, 7], target: [-4.5, 0.6, -1.8], fov: 36 },
  // 2 Two songs, one each side: down on the localizer field.
  { position: [-5, 12, 7], target: [-9, 0, 0], fov: 38 },
  // 3 Compare the loudness: low along the course, looking at the seam.
  { position: [-1, 3, 6], target: [-7, 0.4, 0], fov: 36 },
  // 4 The glideslope: from the side, the vertical field.
  { position: [-6.5, 2.2, 11], target: [-9.5, 1.5, 0], fov: 36 },
  // 5 Two needles: behind the approach, looking at the runway.
  { position: [-24, 5, 5], target: [-8, 1.4, 0], fov: 36 },
  // 6 Markers along the way.
  { position: [-3, 3.2, 7], target: [-6.5, 0.8, 0], fov: 36 },
  // 7 How low in fog: close on the threshold and the approach lights.
  { position: [0, 1.6, 3.4], target: [-4.5, 0.3, 0], fov: 36 },
  // 8 Keeping it honest: the localizer array and its monitor.
  { position: [6.4, 1.3, 2.6], target: [2.6, 0.1, 0], fov: 36 },
]

function IlsTelemetry() {
  const { engine } = useIls()
  const r = useSampled(
    () => {
      const rx = engine.receiver
      return {
        d: Math.max(0, engine.distanceToThresholdNm),
        h: Math.max(0, Math.round(engine.heightAboveRunwayFt / 10) * 10),
        loc: rx.loc.valid ? cdiLateral(rx.loc.ddm) : null,
        gs: rx.gs.valid ? cdiVertical(rx.gs.ddm) : null,
        marker: rx.marker,
      }
    },
    250,
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  )
  const needle = (v: number | null, pos: string, neg: string) =>
    v === null ? 'FLAG' : Math.abs(v) < 0.05 ? 'CENTRED' : `${v > 0 ? pos : neg} ${Math.round(Math.min(1, Math.abs(v)) * 100)}%`
  return (
    <div className="hud-panel flex flex-col rounded-md px-3.5 py-2.5">
      <TelemetryRow label="To the runway" value={r.d.toFixed(1)} unit="NM" tone="signal" />
      <TelemetryRow label="Height" value={r.h.toLocaleString('en-US')} unit="ft" />
      <TelemetryRow label="Localizer" value={needle(r.loc, 'FLY R', 'FLY L')} tone={r.loc === null ? 'alert' : 'default'} />
      <TelemetryRow label="Glideslope" value={needle(r.gs, 'FLY UP', 'FLY DN')} tone={r.gs === null ? 'alert' : 'default'} />
      <TelemetryRow label="Marker" value={r.marker ? r.marker.toUpperCase() : '—'} tone={r.marker ? 'brass' : 'muted'} />
    </div>
  )
}

const steps: Step[] = [
  {
    title: 'Two beams',
    body: (
      <>
        <p>
          An <Term id="ils">ILS</Term> is two radio beams pointing up the approach. The <Term id="localizer">localizer</Term> tells the pilot left or right
          of the runway centreline. The <Term id="glideslope">glideslope</Term> tells them above or below the correct descent.
        </p>
        <p>With both, a pilot can fly down to a runway they cannot see.</p>
      </>
    ),
    visual: <TwoBeamsVisual />,
  },
  {
    title: 'Two songs, one each side',
    body: (
      <>
        <p>
          The localizer antennas stand beyond the far end of the runway. They send two overlapping signals, each carrying its own low hum: the{' '}
          <Term id="tone-90-150">90 Hz and 150 Hz tones</Term>. For a pilot flying towards the runway, 90 Hz is stronger on the left and 150 Hz on the
          right.
        </p>
      </>
    ),
    visual: <LocalizerVisual />,
  },
  {
    title: 'Compare the loudness',
    body: (
      <>
        <p>
          The receiver does not measure where the beam is. It only compares how strong the two tones are: their{' '}
          <Term id="depth-of-modulation">depth of modulation</Term>. The difference is the <Term id="ddm">DDM</Term>.
        </p>
        <p>Equal means you are on the centreline. The bigger the difference, the further the needle moves.</p>
      </>
    ),
    visual: <CompareVisual />,
  },
  {
    title: 'The glideslope works the same way',
    body: (
      <p>
        A mast beside the runway sends the same two tones, stacked instead of side by side: 90 Hz louder above the glide path, 150 Hz louder below it.
        Equal loudness marks a slope of about 3° down to the runway.
      </p>
    ),
    visual: <GlideslopeVisual />,
  },
  {
    title: 'Two needles',
    body: (
      <p>
        In the cockpit a <Term id="cdi">CDI</Term> shows both at once. The vertical needle is the localizer, the horizontal one the glideslope. Each
        points towards where the path is: fly towards the needles to centre them.
      </p>
    ),
    visual: <NeedlesVisual />,
  },
  {
    title: 'Markers along the way',
    body: (
      <p>
        <Term id="marker-beacon">Marker beacons</Term> on the ground beam straight up. As the aircraft passes over one, a lamp flashes and a tone
        sounds, so the pilot knows how far there is to go: outer marker a few miles out, middle marker close in.
      </p>
    ),
    visual: <MarkersVisual />,
  },
  {
    title: 'How low in fog?',
    body: (
      <p>
        Every approach has a <Term id="decision-height">decision height</Term>. Arriving there, the pilot must see the{' '}
        <Term id="approach-lights">approach lights</Term> or the runway, or <Term id="go-around">go around</Term>. Better ILS equipment and crews allow
        lower categories: <Term id="ils-category">CAT I, II and III</Term>, down to landing in fog with the autopilot.
      </p>
    ),
    visual: <MinimumsVisual />,
  },
  {
    title: 'Keeping it honest',
    body: (
      <p>
        Anything big near the antennas reflects the signal and bends the beam, so a <Term id="critical-area">critical area</Term> is kept clear. A{' '}
        <Term id="ils-monitor">monitor</Term> checks the signal all the time and switches the ILS off within seconds if it goes wrong. The pilot then sees
        a <Term id="warning-flag">warning flag</Term>.
      </p>
    ),
    visual: <HonestVisual />,
  },
]

const quiz: QuizQuestion[] = [
  {
    question: 'On final approach, the 150 Hz tone of the localizer is stronger than the 90 Hz tone. Where are you?',
    options: ['Left of the centreline: fly right', 'Right of the centreline: fly left', 'Below the glide path: fly up', 'Exactly on the centreline'],
    answer: 1,
    explanation:
      'For a pilot approaching the runway, 150 Hz is stronger on the right. So you are right of the centreline, and the needle sits left of centre to tell you to fly left.',
  },
  {
    question: 'The glideslope needle is above the centre of the instrument. What should you do?',
    options: ['Fly down', 'Fly up', 'Turn left', 'Nothing: it means you are on the path'],
    answer: 1,
    explanation: 'The needles point to where the path is. A needle above centre means the glide path is above you: you are low, so fly up.',
  },
  {
    question: 'Why must vehicles stay out of the ILS critical area?',
    options: [
      'They block the pilot’s view of the runway',
      'They reflect the signal and bend the beam, so the needles show a wrong path',
      'Their engines make the tones louder',
      'They set off the marker beacons',
    ],
    answer: 1,
    explanation:
      'A large reflecting object near the antennas adds a reflected copy of the signal. The two mix and move the place where both tones are equal, so the needles look fine while guiding you off the real centreline.',
  },
  {
    question: 'On a CAT I approach you reach 200 ft and still see nothing but fog. What now?',
    options: ['Continue down to 100 ft and look again', 'Go around', 'Switch to CAT II', 'Land using the needles only'],
    answer: 1,
    explanation:
      'The decision height is the point where the approach lights or the runway must be in sight. If they are not, the pilot must go around. Lower minimums need CAT II or III equipment, crews and runways.',
  },
  {
    question: 'Flying much too high, the glideslope needle suddenly centres at about 9°. What is happening?',
    options: [
      'You have found the real glide path',
      'The glideslope has failed',
      'You are on a false glide path, where the two tones happen to be equal again',
      'The marker beacon is interfering',
    ],
    answer: 2,
    explanation:
      'The glideslope pattern repeats upward, with places at about 6° and 9° where both tones are equal. No flag appears, because the signal is strong. That is why pilots always intercept the glide path from below.',
  },
]

function IlsPage() {
  const { engine, store, clock } = useIls()
  const failures = useIlsState((s) => s.failures)
  const running = useClock(clock, (c) => c.running)
  const s = store.getState()

  const stage: StageSpec = {
    scene: (t) => <IlsHero t={t} engine={engine} />,
    shots: SHOTS,
    howShots: HOW_SHOTS,
    kicker: `Localizer ${engine.site.locMHz.toFixed(2)} MHz · glide path ${engine.site.pathDeg}°`,
    labels: [SCALE_LABEL, TONE_LABEL, FIELD_LABEL],
    telemetry: <IlsTelemetry />,
    clock: { getTimeS: () => engine.timeS, running, sub: 'Sim time' },
    label:
      'A tabletop model of runway 09 and its approach: the localizer array beyond the far end and the glide path mast beside the runway. The ground is tinted by which tone is louder, cyan with lines where 90 Hz is louder and amber with dots where 150 Hz is louder, and a vertical field shows the glide path. The aircraft flies the approach exactly as the simulator says.',
  }
  const cond = useSampled(() => {
    const e = engine
    const el = glideslopeElevationDeg(e.site, e.aircraft.pos, e.aircraft.altitudeFt)
    return {
      outside: e.receiver.loc.severity > 0.3 || e.receiver.gs.severity > 0.3,
      high: e.phase === 'approach' && e.distanceToThresholdNm > 0.5 && e.distanceToThresholdNm < GS_COVERAGE.rangeNm && el > 1.75 * e.site.pathDeg,
    }
  }, 300)

  const handOver = () => s.setGuidance(false)

  const experiments: Experiment[] = [
    {
      id: 'left',
      question: 'Which tone gets stronger when you drift left?',
      action: <p>CNS101 is 8 NM out, a little left of the centreline, flying parallel to it. Look at the tone bars under the needle and at the top view.</p>,
      setup: () => {
        s.setWeather('clear')
        engine.resetApproach(8, { lateralNm: -0.3 })
        handOver()
      },
      notice: (
        <p>
          The 90 Hz bar is much longer than the 150 Hz bar (about 27% against 13%), and the needle swings almost fully right: fly right. On the top view
          the aircraft sits in the 90 Hz area with the diagonal lines. Steer right (heading about 100°) and the bars even out as you reach the
          centreline.
        </p>
      ),
    },
    {
      id: 'truck',
      question: 'What does a truck in the critical area do to a landing?',
      action: <p>A truck is parked near the localizer. The autopilot flies the needles down to the runway on a clear day. Watch the needle and the runway.</p>,
      setup: () => {
        s.setWeather('clear')
        s.setFailure('locFault', false)
        s.setFailure('truck', true)
        s.resetApproach(6)
      },
      notice: (
        <p>
          The localizer needle wobbles about a dot either way as the aircraft flies through the bent beam, and the course the needles show (the bent line on
          the top view) drifts to the right near the runway. The autopilot follows the needles faithfully and touches down about 30 m right of the
          centreline: beside the runway. Nothing in the cockpit warned about it.
        </p>
      ),
    },
    {
      id: 'false',
      question: 'Is there more than one glide path?',
      action: <p>From 5 NM, climb steeply (+1,500 ft/min) and watch the glideslope needle and the side view.</p>,
      setup: () => {
        s.setWeather('clear')
        engine.resetApproach(5)
        s.setSelectedVs(1500)
      },
      notice: (
        <p>
          The needle first goes fully down: you are above the path, fly down. At about 6° it swings back through the centre and up, telling you to fly up
          although you are far too high: the sensing is reversed. At about 9° it centres again, working normally. No flag ever appears. That is why pilots
          intercept the glide path from below.
        </p>
      ),
    },
    {
      id: 'fog',
      question: 'How much can you see in CAT I fog, and in CAT III?',
      action: (
        <p>
          The autopilot flies from 4 NM in CAT I fog. Watch the 3D view and the minimums call. Then choose CAT IIIB and press “Stable approach from 4 NM”.
        </p>
      ),
      setupLabel: 'Set up CAT I',
      setup: () => {
        s.setThickFog(false)
        s.setWeather('I')
        s.setView('cockpit')
        s.resetApproach(4)
      },
      notice: (
        <p>
          In CAT I fog the approach lights come out of the fog at about 300 ft, before the 200 ft minimums, so the approach continues; the runway itself
          appears at about 140 ft. In CAT IIIB fog nothing shows until about 60 ft, moments before touchdown. There is no decision height: only an
          autoland can fly that.
        </p>
      ),
    },
    {
      id: 'sensitivity',
      question: 'Why does the needle get more sensitive near the runway?',
      action: <p>CNS101 flies parallel to the centreline, 100 m to the right of it, from 8 NM. Watch the localizer needle as the runway gets closer.</p>,
      setup: () => {
        s.setWeather('clear')
        engine.resetApproach(8, { lateralNm: 100 / 1852 })
        handOver()
      },
      notice: (
        <p>
          At 8 NM the needle is less than one dot left. By the threshold the same 100 m pegs it almost fully left. The beam is an angle, about ±2° wide,
          so it narrows towards the runway: exactly what a pilot needs for a precise touchdown.
        </p>
      ),
    },
  ]

  const failureItems: FailureItem[] = [
    {
      id: 'truck',
      title: 'Vehicle in the critical area',
      explanation: (
        <p>
          A truck parked near the localizer reflects its signal. The reflection mixes with the real signal and bends the course (
          <Term id="scalloping">scalloping</Term>), so the needles can look perfect while leading you off the centreline.
        </p>
      ),
      watch: 'the bent course line on the top view and where the autopilot touches down.',
      checked: failures.truck,
      onChange: (v) => s.setFailure('truck', v),
    },
    {
      id: 'false',
      title: 'False glideslopes above the real one',
      explanation: (
        <p>
          The glideslope pattern repeats upward. At about 6° and 9° the two tones are equal again: <Term id="false-glideslope">false glide paths</Term>.
          Switching this on puts CNS101 level at 3,500 ft, 6 NM out, far above the real path.
        </p>
      ),
      watch: 'the glideslope needle centring, and even working backwards, while the aircraft is much too high.',
      checked: cond.high,
      onChange: (v) => {
        if (v) {
          engine.placeHigh()
          handOver()
        } else s.resetApproach(10)
      },
    },
    {
      id: 'coverage',
      title: 'Flying outside the coverage area',
      explanation: (
        <p>
          The ILS is only guaranteed inside its <Term id="ils-coverage">coverage area</Term>. Outside it the signal is weak or unreliable: the needles jump
          and the <Term id="warning-flag">flag</Term> appears. Switching this on puts CNS101 45° off the centreline, heading in to intercept.
        </p>
      ),
      watch: 'the NAV and GS flags on the instrument, then the localizer coming alive as you turn in.',
      checked: cond.outside,
      onChange: (v) => {
        if (v) {
          engine.placeOutsideCoverage()
          handOver()
        } else s.resetApproach(10)
      },
    },
    {
      id: 'monitor',
      title: 'Localizer shut down by its monitor',
      explanation: (
        <p>
          A fault shifts the course. The <Term id="ils-monitor">monitor</Term> sees a shift of more than about 10 m at the threshold and, within a few
          seconds, switches the localizer off. The flag appears and the ident stops, so no pilot keeps following a wrong beam.
        </p>
      ),
      watch: 'the course line moving on the top view, then the NAV flag and "Ident: none".',
      checked: failures.locFault,
      onChange: (v) => s.setFailure('locFault', v),
    },
  ]

  return (
    <ModuleLayout
      moduleId="ils"
      stage={stage}
      nextId="gnss"
      idea={{
        analogy: (
          <p>
            Imagine walking down a long hallway with headphones on: a different song plays in each ear, from speakers on each side. When both songs are
            equally loud, you are exactly in the middle. If one gets louder, you step away from it. An ILS does the same with two radio tones, for left
            and right, and again for up and down.
          </p>
        ),
        what: (
          <>
            <p>
              The <Term id="ils">Instrument Landing System</Term> guides an aircraft down to the runway when the pilot cannot see it. The{' '}
              <Term id="localizer">localizer</Term> shows left or right of the centreline, the <Term id="glideslope">glideslope</Term> above or below a
              3° descent.
            </p>
            <p>Each beam is two overlapping signals. The aircraft compares how loud they are, and two needles show which way to fly.</p>
          </>
        ),
        where: (
          <ul>
            <li>At most large airports, on the runways used in bad weather.</li>
            <li>For landings in fog (CAT III), where the autopilot lands the aircraft.</li>
            <li>
              Often with a <Link to="/modules/dme" className="font-medium text-primary underline underline-offset-2">DME</Link> for the distance to the
              runway. Satellite approaches (<Link to="/modules/gnss" className="font-medium text-primary underline underline-offset-2">GNSS</Link>) are
              slowly joining it.
            </li>
          </ul>
        ),
      }}
      simulator={<IlsSimulator />}
      howItWorks={steps}
      tryThis={experiments}
      failures={failureItems}
      goDeeper={<Deeper />}
      quiz={quiz}
    />
  )
}

export default function IlsModule() {
  return (
    <IlsProvider>
      <IlsPage />
    </IlsProvider>
  )
}
