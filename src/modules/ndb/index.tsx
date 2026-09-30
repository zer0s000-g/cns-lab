import { Link } from 'react-router'
import { lazyRetry } from '@/lib/lazyRetry'
import { ModuleLayout, type StageSpec } from '@/components/module/ModuleLayout'
import type { FailureItem } from '@/components/module/FailureList'
import type { Experiment } from '@/components/module/TryThis'
import type { QuizQuestion } from '@/components/module/Quiz'
import type { Step } from '@/components/module/Stepper'
import { Term } from '@/components/Term'
import { normalize180 } from '@/core/geometry'
import { SKY_WAVE, skyWaveRatio } from '@/core/ndb'
import { useClock } from '@/hooks/useSimClock'
import { useSampled } from '@/hooks/useSampled'
import { BarMeter, TelemetryRow } from '@/hud/Telemetry'
import { fmt3 } from '@/instruments/draw'
import { HEIGHT_EXAGGERATION, TABLE_RADIUS_NM, toU } from '@/stage/scale'
import type { Shot } from '@/stage/types'
import Deeper from './deeper.mdx'
import { NdbSimulator } from './Simulator'
import { NdbProvider, useNdb, useNdbState } from './state'
import { BeaconVisual, LimitsVisual, LoopVisual, NeedleVisual, RmiVisual, SenseVisual } from './visuals'
import { DEFAULT_STATION } from './engine'

// The 3D scene is its own chunk, so the page text appears before three.js loads.
const NdbHero = lazyRetry(() => import('./Hero3D'))

/** Honesty labels: what is to scale on the table and what is not. */
const tableScaleLabel = `Table ${TABLE_RADIUS_NM * 2} NM across · heights ×${Math.round(HEIGHT_EXAGGERATION * 10) / 10} · masts and aircraft larger than life`
const wavesLabel = 'Radio waves drawn slowed down'
const skyLabel = `Sky-wave hop not to scale: the layer is about ${SKY_WAVE.layerHeightKm} km up`

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

const BEACON = toU(DEFAULT_STATION.pos)
const MASTS: V3 = [BEACON[0], 0.5, BEACON[2]]
/** Between the beacon and where the aircraft starts. */
const MIDDLE: V3 = [1.2, 0.3, 0.4]

const SHOTS: StageSpec['shots'] = {
  idea: frame(MASTS, [4.2, 2.2, 6.2], 34, 1.4),
  simulator: { position: [1.4, 14, 9.6], target: [1.2, 0, 0.2], fov: 38 },
  how: frame(MASTS, [3.2, 1.5, 4.6], 34, 1.3),
  try: frame(MIDDLE, [-4, 9, 12], 38, 3.4),
  wrong: frame([2, 0.4, 0], [-7, 7, 10], 38, 2.6),
  deeper: frame([0, 0, 0], [16, 10, 16], 30, 4),
  quiz: { position: [-4, 30, 0.1], target: [-4, 0, 0], fov: 34 },
}

/** Close-ups for the six "How it works" steps. */
const HOW_SHOTS: StageSpec['howShots'] = [
  // 1 A beacon hums in every direction: the masts and the first rings.
  frame(MASTS, [3.2, 1.5, 4.6], 34, 1.3),
  // 2 The loop finds the line: from behind the aircraft, looking at the beacon.
  frame(MIDDLE, [-4.4, 2.6, 5.2], 36, 1.6),
  // 3 The sense antenna removes the doubt: the same line from the other side.
  frame(MIDDLE, [4.6, 3.2, 5.4], 36, 1.6),
  // 4 The needle points at the beacon: from above.
  { position: [0.2, 11, 6.5], target: [1.2, 0, 0.4], fov: 38 },
  // 5 Add the heading: high three-quarter.
  frame(MIDDLE, [-2, 8, 8], 38, 1.8),
  // 6 Limits: mountains to the north-west, the coast to the east.
  frame([0, 0.3, -1], [0, 13, 15], 38, 3),
]

function NdbTelemetry() {
  const { engine } = useNdb()
  const v = useSampled(() => {
    const ind = engine.last
    return {
      rel: ind.relative,
      needle: ind.bearingTrue,
      truth: ind.truth.bearingTrue,
      err: ind.relative == null ? null : ind.ambiguous ? 180 : normalize180(ind.errors.total),
      dist: ind.truth.distanceNm,
      margin: ind.marginDb,
      signal: ind.signal,
    }
  }, 250)
  const e = v.err == null ? null : Math.abs(v.err)
  return (
    <div className="hud-panel flex flex-col rounded-md px-3.5 py-2.5">
      <TelemetryRow label="Needle (relative)" value={v.rel == null ? '—' : fmt3(v.rel)} unit="°" tone="signal" />
      <TelemetryRow label="Needle points" value={v.needle == null ? '—' : fmt3(v.needle)} unit="°T" />
      <TelemetryRow label="Beacon really at" value={fmt3(v.truth)} unit="°T" />
      <TelemetryRow
        label="Needle error"
        value={e == null ? '—' : `${e >= 0.5 && v.err! < 0 ? '−' : e >= 0.5 ? '+' : ''}${e.toFixed(e < 10 ? 1 : 0)}`}
        unit={e == null ? undefined : '°'}
        tone={e == null ? 'muted' : e >= 5 ? 'brass' : 'ok'}
      />
      <TelemetryRow label="Distance" value={v.dist.toFixed(1)} unit="NM" />
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="hud-label">Signal</span>
        <BarMeter
          orientation="horizontal"
          value={v.signal ? Math.min(1, Math.max(0.04, v.margin / 40)) : 0}
          segments={14}
          label={v.signal ? `Signal ${Math.round(v.margin)} dB above the minimum` : 'No usable signal'}
        />
      </div>
    </div>
  )
}

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
  const running = useClock(clock, (c) => c.running)
  const s = store.getState()
  // The sky-wave arch appears on the table only while it matters (checked a few times a second).
  const skyOn = useSampled(() => skyWaveRatio(engine.last.truth.distanceNm, engine.env.hour) > 0.02, 500)

  const stage: StageSpec = {
    scene: (t) => <NdbHero t={t} engine={engine} />,
    shots: SHOTS,
    howShots: HOW_SHOTS,
    kicker: `LF/MF · ${engine.station.freqKhz} kHz`,
    labels: [tableScaleLabel, wavesLabel, ...(skyOn ? [skyLabel] : [])],
    telemetry: <NdbTelemetry />,
    clock: { getTimeS: () => engine.timeS, running, sub: 'Sim time' },
    label: `A tabletop model of the area around the ${engine.station.ident} beacon: two masts hold a wire aerial that sends the same signal in every direction, drawn as rings spreading over the terrain. An aircraft flies above. A solid cyan line shows where its ADF needle points and a dashed line shows where the beacon really is; when they split, the needle is wrong.`,
  }

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
      stage={stage}
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
