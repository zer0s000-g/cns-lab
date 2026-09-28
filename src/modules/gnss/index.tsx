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
import type { Shot } from '@/stage/types'
import Deeper from './deeper.mdx'
import { DEFAULT_ENV, type GnssEnv } from './engine'
import { formatMetres } from './format'
import { EARTH_RADIUS_KM_LABEL, R_U } from './heroScale'
import { GnssSimulator } from './Simulator'
import { GnssProvider, useGnss, useGnssState } from './state'
import { BroadcastVisual, ClockVisual, CorrectionsVisual, GeometryVisual, RaimVisual, SpheresVisual, TravelTimeVisual } from './visuals'

// The 3D scene is its own chunk, so the page text appears before three.js loads.
const GnssHero = lazy(() => import('./Hero3D'))

const steps: Step[] = [
  {
    title: 'Satellites broadcast the time',
    body: (
      <>
        <p>
          About 30 <Term id="gps">GPS</Term> satellites circle the Earth, 20,200 km up, in a <Term id="constellation">constellation</Term> of six
          orbits. Each carries <Term id="atomic-clock">atomic clocks</Term>.
        </p>
        <p>
          Each one keeps broadcasting a simple message: who it is, exactly where it is, and exactly what time it was when the message left.
          The receiver only listens; it never transmits.
        </p>
      </>
    ),
    visual: <BroadcastVisual />,
  },
  {
    title: 'Travel time becomes distance',
    body: (
      <>
        <p>
          The signal travels at the <Term id="speed-of-light">speed of light</Term> and takes about 0.07 seconds to arrive. The receiver compares
          the time in the message with the time on its own clock. Travel time multiplied by the speed of light gives the distance.
        </p>
        <p>The timing has to be superb: a millionth of a second of error is 300 m of distance.</p>
      </>
    ),
    visual: <TravelTimeVisual />,
  },
  {
    title: 'Distances meet at one point',
    body: (
      <>
        <p>
          Knowing you are 20,100 km from one satellite puts you somewhere on a huge sphere around it. A second satellite's sphere cuts the first
          in a circle. A third cuts that circle at two points, and one of them is far out in space. This is{' '}
          <Term id="trilateration">trilateration</Term>.
        </p>
        <p>So three satellites would be enough, if the receiver's clock were perfect.</p>
      </>
    ),
    visual: <SpheresVisual />,
  },
  {
    title: 'The fourth satellite fixes the clock',
    body: (
      <>
        <p>
          A receiver has a cheap quartz clock, not an atomic one. Its <Term id="receiver-clock-error">clock error</Term> makes every distance
          wrong by the same amount. These measured distances are called <Term id="pseudorange">pseudoranges</Term>.
        </p>
        <p>
          With a wrong clock, the spheres no longer meet at one point. The receiver adjusts its clock until all of them meet. That needs one more
          measurement: 3 unknowns for the position plus 1 for the clock means at least 4 satellites.
        </p>
      </>
    ),
    visual: <ClockVisual />,
  },
  {
    title: 'Geometry matters',
    body: (
      <>
        <p>
          Every distance has a little error, so each sphere is really a thick shell. Where the shells cross, the receiver could be anywhere in a
          small region.
        </p>
        <p>
          Satellites spread across the sky make the shells cross squarely: a small region. Satellites bunched together make them cross at a
          shallow angle: a long, stretched region. The <Term id="dop">DOP</Term> number measures this stretching.
        </p>
      </>
    ),
    visual: <GeometryVisual />,
  },
  {
    title: 'Errors and corrections',
    body: (
      <>
        <p>
          The biggest error comes from the <Term id="ionosphere">ionosphere</Term>, a layer of electrically charged air high up that slows the
          signals down. Satellite clocks and orbits are slightly off too, and signals can bounce off buildings, which is called{' '}
          <Term id="multipath">multipath</Term>. Together they give a <Term id="ranging-error">ranging error</Term> of a few metres per
          satellite.
        </p>
        <p>
          <Term id="sbas">SBAS</Term> measures these errors with ground stations across a whole region and broadcasts corrections from a satellite
          that stays over one spot of the equator. <Term id="gbas">GBAS</Term> measures them right at an airport and sends corrections to landing
          aircraft by radio.
        </p>
      </>
    ),
    visual: <CorrectionsVisual />,
  },
  {
    title: 'Checking the satellites',
    body: (
      <>
        <p>
          A wrong position without a warning is dangerous, so aviation receivers check their own <Term id="integrity">integrity</Term>.{' '}
          <Term id="raim">RAIM</Term> uses spare satellites: if one distance does not fit with the others, something is wrong.
        </p>
        <p>
          With 5 satellites RAIM can tell that one is wrong. With 6 or more it can usually find which one, leave it out and carry on: this is
          called <Term id="fde">fault detection and exclusion</Term>.
        </p>
      </>
    ),
    visual: <RaimVisual />,
  },
]

const quiz: QuizQuestion[] = [
  {
    question: 'Why does a GNSS receiver need at least four satellites to work out its position?',
    options: [
      'Three unknowns for the position, plus one for the error of its own clock',
      'Three for the position and one spare in case a satellite fails',
      'The fourth one corrects for the ionosphere',
      'One of the four is always hidden behind the Earth',
    ],
    answer: 0,
    explanation:
      "The receiver's clock is not an atomic clock, so every measured distance is wrong by the same unknown amount. Together with east, north and height that makes four unknowns, and four unknowns need four measurements.",
  },
  {
    question: 'A receiver clock is one microsecond (a millionth of a second) wrong and nothing corrects it. How wrong is each distance?',
    options: ['About 3 cm', 'About 3 m', 'About 300 m', 'About 300 km'],
    answer: 2,
    explanation:
      'Light travels about 300,000 km per second, which is 300 m in a millionth of a second. That is why the receiver must work out its clock error instead of simply trusting its clock.',
  },
  {
    question: 'The four satellites a receiver uses are bunched close together in one part of the sky. What happens?',
    options: [
      'The position is extra accurate because the signals are so similar',
      'The DOP is high, so small ranging errors turn into a large position error',
      'The receiver cannot hear bunched satellites',
      'Nothing: only the number of satellites matters',
    ],
    answer: 1,
    explanation:
      'The distance spheres then cross at shallow angles, so a small error in each distance slides the meeting point a long way. The DOP number measures this; spread-out satellites keep it small.',
  },
  {
    question: 'With 5 satellites in use, RAIM finds that one measurement does not fit. What can it do?',
    options: [
      'Work out which satellite is faulty and leave it out',
      'Warn that the position must not be used, without knowing which satellite is to blame',
      "Correct the faulty satellite's clock",
      'Nothing: RAIM only works with 4 satellites',
    ],
    answer: 1,
    explanation:
      'With 5 satellites there is only one spare measurement: enough to see that something is inconsistent, not enough to find the culprit. With 6 or more, RAIM can leave each satellite out in turn and find the one that does not fit.',
  },
  {
    question: 'GNSS is being jammed near an airport. Which of these can the pilot still use?',
    options: ['ADS-B position reports', 'An RNP approach', 'The ILS', 'A GBAS landing (GLS)'],
    answer: 2,
    explanation:
      'The ILS uses its own radio beams from the runway and does not need GNSS at all. ADS-B, RNP approaches and GBAS landings all depend on a GNSS position, so they are lost while the jammer is on.',
  },
]


// ---------------------------------------------------------------------------
// Stage: camera shots, telemetry and honesty labels
// ---------------------------------------------------------------------------

/**
 * A shot that puts `subject` `shift` units right of the centre of the frame,
 * so it sits clear of the chapter panel on the left. Plain vector maths: no three.js here.
 */
function framed(position: [number, number, number], subject: [number, number, number], shift: number, fov: number): Shot {
  const f = [subject[0] - position[0], subject[1] - position[1], subject[2] - position[2]]
  // right = forward × up
  const r = [-f[2], 0, f[0]]
  const n = Math.hypot(r[0], r[2]) || 1
  return { position, target: [subject[0] - (r[0] / n) * shift, subject[1], subject[2] - (r[2] / n) * shift], fov }
}

/** The receiver sits on top of the small Earth; the Earth's centre is the origin. */
const RX: [number, number, number] = [0, R_U, 0]

const SHOTS: StageSpec['shots'] = {
  idea: framed([17, 8, 25], [0, 0.8, 0], 5.2, 34),
  simulator: framed([0, 14.5, 5.5], [0, R_U + 0.7, 0], 0.4, 40),
  how: framed([-21, 6, 24], [0, 0.6, 0], 3.4, 34),
  try: framed([-11, 9, 15], RX, 3.4, 38),
  wrong: framed([-2.6, 2.6, 3.9], [0, R_U + 0.25, 0], 0.85, 40),
  deeper: framed([26, 5, 9], [0, 1, 0], 6.5, 34),
  quiz: framed([0, 34, 2], [0, 0, 0], 6, 36),
}

/** Close-ups for the seven "How it works" steps. */
const HOW_SHOTS: StageSpec['howShots'] = [
  // 1 Satellites broadcast the time: the whole constellation on its six orbits.
  framed([-21, 6, 24], [0, 0.6, 0], 3.4, 34),
  // 2 Travel time: from beside the receiver, looking up the lines of sight.
  framed([4.2, 2.4, 6.2], [0, R_U + 1.6, 0], 1.4, 44),
  // 3 Distances meet: three-quarter view of the receiver and the satellites in use.
  framed([13, 13, 17], RX, 4.2, 38),
  // 4 The fourth satellite: close on the receiver and its sky dome.
  framed([2.1, 2.5, 3.3], [0, R_U + 0.35, 0], 0.75, 38),
  // 5 Geometry: straight down on the sky dome, like the sky plot.
  framed([0, 13, 0.9], [0, R_U, 0], 2.1, 40),
  // 6 Errors and corrections: the ionosphere shell and the SBAS satellite overhead.
  framed([18, 4, 12], [0, 4.6, 0], 4.4, 38),
  // 7 Checking the satellites: three-quarter view with the lines of sight.
  framed([9, 7, 11], [0, R_U + 1.2, 0], 2.4, 40),
]

const SCALE_LABEL = `Earth and orbits to scale (Earth radius ${EARTH_RADIUS_KM_LABEL.toLocaleString('en-US')} km)`

function GnssTelemetry() {
  const { engine } = useGnss()
  const v = useSampled(
    () => {
      const r = engine.result
      return {
        up: engine.sats.filter((s) => s.elDeg > 0).length,
        tracked: r.nTracked,
        used: r.usedIds.length,
        pdop: r.dop?.pdop ?? null,
        h95: r.kind === 'fix' && r.h95M > 0 ? r.h95M : null,
        kind: r.kind,
      }
    },
    300,
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  )
  return (
    <div className="hud-panel flex flex-col rounded-md px-3.5 py-2.5">
      <TelemetryRow label="Above horizon" value={v.up} />
      <TelemetryRow label="Received" value={v.tracked} />
      <TelemetryRow label="In use" value={v.used} tone={v.used >= 4 ? 'signal' : 'brass'} />
      <TelemetryRow label="PDOP" value={v.pdop !== null && Number.isFinite(v.pdop) ? v.pdop.toFixed(1) : '—'} />
      <TelemetryRow label="95% circle" value={v.h95 !== null ? formatMetres(v.h95) : '—'} />
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="hud-label">Fix</span>
        <BarMeter orientation="horizontal" value={Math.min(1, v.used / 8)} segments={8} label="Satellites in use, out of eight" />
      </div>
    </div>
  )
}

function useGnssStage(): StageSpec {
  const { engine, clock, store } = useGnss()
  const running = useClock(clock, (c) => c.running)
  const speed = useClock(clock, (c) => c.speed)
  const env = useGnssState((s) => s.env)
  const site = useGnssState((s) => s.settings.site)
  const gbas = useGnssState((s) => s.settings.gbas)
  const followEarth = useGnssState((s) => s.view.followEarth)
  const nearby = env.jamming || env.spoofing || gbas || (env.blocked && site === 'ground')
  return {
    scene: (t) => <GnssHero t={t} engine={engine} store={store} />,
    shots: SHOTS,
    howShots: HOW_SHOTS,
    kicker: 'L1 · 1575.42 MHz',
    labels: [
      SCALE_LABEL,
      'Satellites and receiver larger than life',
      'Simplified coastlines · ionosphere as a shell 350 km up',
      ...(speed > 1 ? [`Time sped up ×${speed}`] : []),
      ...(nearby ? ['Buildings, jammer and GBAS station not to scale'] : []),
      ...(followEarth ? [] : ['View fixed in space: the Earth turns']),
    ],
    telemetry: <GnssTelemetry />,
    clock: { getTimeS: () => engine.timeS, running, sub: speed > 1 ? `Sim time ×${speed}` : 'Sim time' },
    label:
      'A small Earth on a stand with the GPS satellites on their six orbits around it. The receiver sits on top under a sky dome; cyan lines join it to the satellites in use, satellites it cannot receive are dimmed, and a brass line marks the SBAS satellite when its corrections are in use.',
  }
}

function GnssPage() {
  const { store, clock } = useGnss()
  const stage = useGnssStage()
  const env = useGnssState((s) => s.env)
  const s = store.getState()

  /** Switch off every failure except the ones given, and go back to standard settings. */
  const cleanSlate = (keep: Partial<GnssEnv> = {}) => {
    const st = store.getState()
    const target = { ...DEFAULT_ENV, ...keep }
    for (const k of Object.keys(target) as (keyof GnssEnv)[]) st.setEnv(k, target[k])
    st.setSetting('sbas', false)
    st.setSetting('gbas', false)
    st.setSetting('clockMode', 'solve')
    st.setSetting('clockGuessNs', 0)
  }

  const experiments: Experiment[] = [
    {
      id: 'three',
      question: 'Why are three satellites not enough?',
      action: (
        <p>
          We will use three satellites spread across the sky and let you guess the receiver's clock error. Move the slider "My guess is off by"
          (under Receiver clock) and watch the ground view and the height strip beside it.
        </p>
      ),
      setup: () => {
        cleanSlate()
        clock.getState().setSpeed(1)
        s.setSetting('site', 'ground')
        s.applyPreset('spread3')
        s.setSetting('clockMode', 'guess')
        s.setSetting('clockGuessNs', 400)
        s.setView('showLines', true)
      },
      notice: (
        <>
          <p>
            Whatever you guess, the three distance lines still meet at one point, so every guess looks equally good and the misfit stays at
            zero. The possible answers form the orange line: a different position for every clock error, several hundred metres per microsecond
            and mostly up and down.
          </p>
          <p>
            Now click a fourth satellite on the sky plot, one well away from the other three. The four lines only meet when your guess is close
            to 0; the misfit readout shows how far they miss, and it grows as your guess gets worse. The receiver does this automatically: the
            fourth satellite is how it finds its clock error. (If the fourth satellite is badly placed, the misfit hardly changes and the DOP
            meter shows why: those four cannot tell a clock error from a change in height.)
          </p>
        </>
      ),
    },
    {
      id: 'geometry',
      question: 'Does it matter where the satellites are in the sky?',
      action: (
        <p>
          We will use four satellites bunched together. Look at the DOP meter, the 95% circle and the scatter of recent answers. Then press{' '}
          <strong>4 spread out</strong> under Quick picks and compare.
        </p>
      ),
      setup: () => {
        cleanSlate()
        clock.getState().setSpeed(1)
        clock.getState().play()
        s.setSetting('site', 'ground')
        s.applyPreset('clustered4')
      },
      notice: (
        <p>
          Bunched, the PDOP is 8 or more (moderate to poor): the radius of the 95% circle grows to many tens of metres, sometimes hundreds, and the dots of
          recent answers scatter more widely. Spread out, the PDOP drops to about 2 to 3 and the circle shrinks to roughly 15 to 20 m,
          although each satellite's distance is just as accurate as before. The geometry multiplies the ranging error.
        </p>
      ),
    },
    {
      id: 'raim',
      question: 'What happens when a satellite breaks?',
      action: (
        <p>
          We will use 5 satellites and give one of them a clock fault: its distance error grows by 4 m every second. Watch the integrity check
          (RAIM). When the alarm appears, press <strong>6</strong> under Quick picks.
        </p>
      ),
      setupLabel: 'Set it up (5 satellites)',
      setup: () => {
        cleanSlate()
        s.setSetting('site', 'ground')
        s.applyPreset('five')
        clock.getState().setSpeed(1)
        clock.getState().play()
        store.getState().setEnv('faultySat', true)
      },
      notice: (
        <>
          <p>
            After roughly 10 to 25 seconds RAIM raises an alarm: the five measurements no longer agree. With only one spare measurement it cannot
            tell which satellite is to blame, so the position must not be used.
          </p>
          <p>
            With a sixth satellite RAIM tries leaving each one out in turn. Only the group without the faulty satellite agrees, so that one is
            crossed out on the sky plot and the position snaps back. Switch RAIM off to compare: the faulty satellite pulls the answer tens of
            metres away and nobody is warned.
          </p>
        </>
      ),
    },
    {
      id: 'jamming',
      question: 'Which navigation aids still work when GNSS is jammed?',
      action: (
        <p>
          We will switch on a jammer 10 km from the airport. Watch the signal bars and the L1 spectrum, then read "What still works?". Afterwards
          move the jammer further away, and try again with the receiver at 35,000 ft.
        </p>
      ),
      setup: () => {
        cleanSlate({ jamming: true })
        s.setSetting('site', 'ground')
        s.setSetting('selectMode', 'all')
        s.setSetting('jammerKm', 10)
      },
      notice: (
        <p>
          The jammer arrives more than 50 dB (100,000 times) stronger than the satellites, so every signal is lost, SBAS included. VOR, DME, ILS,
          radar and voice radio keep working: they use other frequencies and do not need GNSS. Inertial navigation keeps going but slowly drifts.
          ADS-B position reports and GNSS (RNP) approaches stop. On the ground the jammer drops behind the horizon beyond about 20 km; at 35,000
          ft it still blinds the receiver more than 100 km away.
        </p>
      ),
    },
    {
      id: 'corrections',
      question: 'How much do SBAS and GBAS help?',
      action: (
        <p>
          An ionospheric storm is on. Note the ranging error and the 95% circle. Then switch on SBAS, and after that GBAS. Finally switch the
          storm off and compare again.
        </p>
      ),
      setup: () => {
        cleanSlate({ ionoStorm: true })
        s.setSetting('site', 'ground')
        s.setSetting('selectMode', 'all')
      },
      notice: (
        <p>
          In the storm each distance is off by about 25 m and the 95% circle has a radius of about 40 m. SBAS corrections remove most of the ionosphere and
          satellite errors and shrink the circle to about 6 m. GBAS, measured right at the airport, brings it down to little more than 1 m. On a quiet day SBAS
          gives about 1.5 m and GBAS about half a metre: good enough to guide an aircraft down to the runway.
        </p>
      ),
    },
  ]

  const failures: FailureItem[] = [
    {
      id: 'fault',
      title: 'A faulty satellite',
      explanation: (
        <p>
          Very rarely a satellite's clock or orbit goes wrong while it keeps broadcasting as if all were fine. Until the ground control notices
          and marks it unhealthy, every receiver using it gets a growing distance error.
        </p>
      ),
      watch: 'the red-ringed satellite on the sky plot and its red distance line drifting away from the others.',
      checked: env.faultySat,
      onChange: (v) => s.setEnv('faultySat', v),
    },
    {
      id: 'raim',
      kind: 'fix',
      title: 'The fix: RAIM integrity check',
      explanation: (
        <p>
          <Term id="raim">RAIM</Term> compares the measurements with each other. It needs a spare satellite: with 5 it can detect a fault, with 6
          or more it can find and exclude it. SBAS and GBAS also watch every satellite from the ground and broadcast "do not use" within seconds.
        </p>
      ),
      watch: 'the integrity check panel, and crossed-out satellites on the sky plot.',
      checked: env.raim,
      onChange: (v) => s.setEnv('raim', v),
    },
    {
      id: 'storm',
      title: 'Ionospheric storm',
      explanation: (
        <p>
          Bursts of activity on the Sun charge up the <Term id="ionosphere">ionosphere</Term>, which then delays the signals several times more
          than usual. Low satellites suffer most, because their signals cross the layer at a slant. SBAS and GBAS remove most of the extra error.
        </p>
      ),
      watch: 'the ranging error readout and the 95% circle growing.',
      checked: env.ionoStorm,
      onChange: (v) => s.setEnv('ionoStorm', v),
    },
    {
      id: 'blocked',
      title: 'Buildings and terrain block satellites',
      explanation: (
        <p>
          A hangar, city buildings or a mountainside hide part of the sky. Fewer satellites remain, and those left are bunched in the open part of
          the sky, so the DOP and the error grow. Aircraft in flight rarely have this problem.
        </p>
      ),
      watch: 'the hatched area on the sky plot and the DOP meter (with the receiver on the runway).',
      checked: env.blocked,
      onChange: (v) => s.setEnv('blocked', v),
    },
    {
      id: 'jamming',
      title: 'Jamming',
      explanation: (
        <p>
          GNSS signals arrive at about −130 dBm, weaker than the receiver's own noise. A <Term id="jamming">jammer</Term> only has to add a little
          noise on the same frequency to drown them. Small illegal jammers in cars and military jammers near conflict zones regularly cause
          aircraft to lose GNSS.
        </p>
      ),
      watch: 'the signal bars dropping to nothing and the "What still works?" list.',
      checked: env.jamming,
      onChange: (v) => s.setEnv('jamming', v),
    },
    {
      id: 'spoofing',
      title: 'Spoofing',
      explanation: (
        <p>
          A <Term id="spoofing">spoofer</Term> transmits fake but consistent satellite signals. The receiver locks on to them and calculates a false
          position that slowly drifts away. RAIM does not notice, because the fake signals agree with each other perfectly.
        </p>
      ),
      watch: 'the GNSS position drifting away while the DOP and RAIM look fine, and the DME/DME cross-check.',
      checked: env.spoofing,
      onChange: (v) => s.setEnv('spoofing', v),
    },
  ]

  return (
    <ModuleLayout
      moduleId="gnss"
      stage={stage}
      nextId="vhf"
      idea={{
        analogy: (
          <>
            <p>
              If you know you are 10 km from town A, 15 km from town B and 12 km from town C, only one spot on the map fits all three distances.
            </p>
            <p>
              Now imagine each town rings a bell exactly on the hour, and you work out the distance from how late you hear it, like counting the
              seconds between lightning and thunder. That works only if your own watch is right. If it is not, listening to one more town lets you
              work out your watch error too.
            </p>
          </>
        ),
        what: (
          <>
            <p>
              <Term id="gnss">GNSS</Term> satellites broadcast "this is my position and this is the exact time". A receiver measures how long each
              signal took to arrive, turns the times into distances and finds the one place that fits them all. Four satellites are needed: three
              for the position and one to correct the receiver's own clock.
            </p>
            <p>
              For aviation, being accurate is not enough: the receiver must also warn when it cannot be trusted. That is the job of RAIM, and of
              the SBAS and GBAS correction systems, which also make GNSS precise enough to land with.
            </p>
          </>
        ),
        where: (
          <ul>
            <li>In almost every aircraft, for en-route navigation and for approaches without any ground beacon (RNP approaches).</li>
            <li>As the position source for ADS-B, which lets controllers and other aircraft see where an aircraft is.</li>
            <li>With SBAS (WAAS, EGNOS and others) for approaches with vertical guidance, and with GBAS for precision landings at some airports.</li>
            <li>
              As the time source for radar, communication and{' '}
              <Link to="/modules/mlat" className="font-medium text-primary underline underline-offset-2">
                multilateration
              </Link>{' '}
              networks.
            </li>
          </ul>
        ),
      }}
      simulator={<GnssSimulator />}
      howItWorks={steps}
      tryThis={experiments}
      failures={failures}
      failuresNote={
        <>
          <h3>How aircraft cross-check GNSS</h3>
          <p>
            Pilots and aircraft do not trust GNSS blindly. The flight computer compares the GNSS position with positions from{' '}
            <Link to="/modules/dme" className="font-medium text-primary underline underline-offset-2">
              DME
            </Link>{' '}
            distances to two ground beacons (DME/DME), from a VOR with DME, and from <Term id="inertial-navigation">inertial navigation</Term>. Air
            traffic controllers see the aircraft on radar, which does not depend on GNSS at all. When the positions disagree, the crew is alerted
            and switches to the ground-based aids. That is why VOR, DME and ILS are kept as a backup network even though GNSS does most of the work.
          </p>
        </>
      }
      goDeeper={<Deeper />}
      quiz={quiz}
    />
  )
}

export default function GnssModule() {
  return (
    <GnssProvider>
      <GnssPage />
    </GnssProvider>
  )
}
