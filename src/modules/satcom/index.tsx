import { useMemo } from 'react'
import { Link } from 'react-router'
import { ModuleLayout } from '@/components/module/ModuleLayout'
import type { FailureItem } from '@/components/module/FailureList'
import type { Experiment } from '@/components/module/TryThis'
import type { QuizQuestion } from '@/components/module/Quiz'
import type { Step } from '@/components/module/Stepper'
import { Term } from '@/components/Term'
import { geoMaxLatitudeDeg, GEO_MASK_DEG } from '@/core/satcom'
import Deeper from './deeper.mdx'
import { HANDOVER_GAP_S, HEAVY_RAIN_MM_H, RAIN_HEIGHT_KM } from './engine'
import { atlanticFacts, delayFacts, polarGapFacts, turnFacts } from './facts'
import { formatMs } from './format'
import { SatcomSimulator } from './Simulator'
import { SatcomProvider, useSatcom, useSatcomState } from './state'
import { BankVisual, DelayVisual, GeoVisual, LeoVisual, RainVisual, UpDownVisual, UsesVisual } from './visuals'

const TURN_SETUP_NM = 600

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']
const compass = (az: number) => COMPASS[Math.round((((az % 360) + 360) % 360) / 45) % 8]

const steps: Step[] = [
  {
    title: 'Up to space and back down',
    body: (
      <>
        <p>
          Far from land there is no radar and VHF radio does not reach. So the aircraft sends its messages up to a satellite. The satellite sends them
          down to a <Term id="ground-earth-station">ground station</Term>, and ordinary networks carry them on to the air traffic control centre.
        </p>
        <p>
          A small antenna on the roof of the aircraft does the talking, in the <Term id="l-band">L-band</Term> of radio frequencies.
        </p>
      </>
    ),
    visual: <UpDownVisual />,
  },
  {
    title: 'A tall tower that stands still (GEO)',
    body: (
      <>
        <p>
          A <Term id="geostationary-orbit">geostationary</Term> satellite sits 35,786 km above the equator. It goes round once in the time the Earth
          turns once, so from the ground it seems to hang in one spot, like a very tall tower.
        </p>
        <p>
          From so high up it sees almost half the Earth. But the poles are beyond its horizon, so near the poles there is no GEO coverage at all.
        </p>
      </>
    ),
    visual: <GeoVisual />,
  },
  {
    title: 'A relay team of runners (LEO)',
    body: (
      <>
        <p>
          A <Term id="low-earth-orbit">low-orbit</Term> constellation flies only about 780 km up. Each satellite races round the Earth in about 100 minutes
          and is overhead for only a few minutes, so the aircraft keeps switching to the next one: a{' '}
          <Term id="satellite-handover">handover</Term>.
        </p>
        <p>
          The satellites pass messages to each other over <Term id="inter-satellite-link">inter-satellite links</Term>, like runners passing a baton,
          until one can hand it down to a gateway. Their rings cross over the poles, so the whole Earth is covered.
        </p>
      </>
    ),
    visual: <LeoVisual />,
  },
  {
    title: 'Every trip takes time',
    body: (
      <>
        <p>
          Radio travels at the <Term id="speed-of-light">speed of light</Term>, but the distances are huge. Up to a GEO satellite and down again is
          more than 70,000 km: about a quarter of a second one way, so a question and its answer take about half a second. That delay is called{' '}
          <Term id="latency">latency</Term>.
        </p>
        <p>Low satellites are about 45 times closer, so the trip takes only a few hundredths of a second, even with several hops.</p>
      </>
    ),
    visual: <DelayVisual />,
  },
  {
    title: 'The antenna on the roof',
    body: (
      <p>
        The antenna sits on top of the fuselage and looks at the sky. When the aircraft banks steeply, its roof tilts too. A low satellite on the
        high-wing side can end up behind the aircraft’s own body, and the link drops until the wings are level again.
      </p>
    ),
    visual: <BankVisual />,
  },
  {
    title: 'Rain and radio frequencies',
    body: (
      <p>
        Safety links use L-band, around 1.6 GHz, whose waves are much longer than raindrops, so even heavy rain barely weakens them. Passenger Wi-Fi often
        uses the higher <Term id="ku-band">Ku</Term> and <Term id="ka-band">Ka</Term> bands, which carry far more data but suffer{' '}
        <Term id="rain-fade">rain fade</Term>.
      </p>
    ),
    visual: <RainVisual />,
  },
  {
    title: 'What travels over the link',
    body: (
      <>
        <p>
          Voice calls to the oceanic controller (<Term id="satvoice">SATVOICE</Term>), text clearances by{' '}
          <Link to="/modules/cpdlc" className="font-medium text-primary underline underline-offset-2">
            CPDLC
          </Link>
          , and automatic position reports (<Term id="ads-c">ADS-C</Term>).
        </p>
        <p>
          Some low-orbit satellites also carry receivers that listen for the aircraft’s normal{' '}
          <Link to="/modules/ads" className="font-medium text-primary underline underline-offset-2">
            ADS-B
          </Link>{' '}
          broadcasts: <Term id="space-based-ads-b">space-based ADS-B</Term> lets controllers see aircraft over the middle of the ocean.
        </p>
      </>
    ),
    visual: <UsesVisual />,
  },
]

const quiz: QuizQuestion[] = [
  {
    question: 'A controller asks a pilot a question through a geostationary satellite. Leaving out equipment delays, how long until the answer can start to arrive?',
    options: ['About 0.005 seconds', 'About 0.05 seconds', 'About half a second', 'About 5 seconds'],
    answer: 2,
    explanation:
      'The question goes up to the satellite and down to the aircraft (more than 70,000 km, about a quarter of a second), and the answer makes the same trip back. Together that is about half a second, which is why satellite voice calls feel a little slow.',
  },
  {
    question: 'Why does a flight over the North Pole lose contact with geostationary satellites?',
    options: [
      'It is too cold for the satellites to work',
      'GEO satellites sit above the equator, so near the poles they are below the horizon',
      'The Earth’s magnetic field blocks the signal',
      'The satellites switch off over the poles',
    ],
    answer: 1,
    explanation: `All GEO satellites are over the equator. From very high latitudes they sit below the horizon, so beyond about ${Math.round(geoMaxLatitudeDeg(GEO_MASK_DEG))}° north or south there is no usable GEO link. Low-orbit constellations, whose rings cross the poles, fill that gap.`,
  },
  {
    question: 'An aircraft using a low-orbit constellation keeps switching satellites. Why?',
    options: [
      'The satellites are unreliable',
      'Each low satellite is overhead for only a few minutes before it sets',
      'The pilot has to choose a new one every minute',
      'Rain forces a switch',
    ],
    answer: 1,
    explanation:
      'Low satellites orbit the Earth in about 100 minutes, so each one crosses the sky in roughly ten minutes or less. Before it sets, the link is handed over to the next satellite rising: a handover.',
  },
  {
    question: 'In a heavy downpour, which link is most likely to fade?',
    options: ['The L-band safety link', 'A Ka-band passenger Wi-Fi link', 'Both fade the same', 'Neither: rain never affects radio'],
    answer: 1,
    explanation:
      'Raindrops absorb and scatter short radio waves. At Ku and Ka band (about 12 to 30 GHz) heavy rain can take away many decibels, while at L-band (about 1.6 GHz) the loss is tiny. That is one reason safety services use L-band.',
  },
  {
    question: 'During a steep turn to the right, the satellite link drops for a while. Where was the satellite most likely?',
    options: ['Straight above the aircraft', 'Low in the sky on the left', 'Low in the sky on the right', 'Directly ahead'],
    answer: 1,
    explanation:
      'In a right turn the left wing rises and the roof of the aircraft tilts to the right. A low satellite on the left is then below the antenna’s tilted horizon, hidden by the aircraft’s body, until the wings are level again.',
  },
]

function PolarNotice() {
  const f = useMemo(() => polarGapFacts(), [])
  return (
    <p>
      With GEO, the link turns to “No satellite in view” as the aircraft passes about {Math.round(f.fromLat)}°N, and stays that way for about{' '}
      {f.gapHours.toFixed(1)} hours of flight, until it is back down to about {Math.round(f.toLat)}°N on the other side of the pole. (Even directly under a
      satellite, GEO ends at about {Math.round(geoMaxLatitudeDeg(GEO_MASK_DEG))}°.) Messages sent then wait in a queue. With
      LEO the link never drops: you only see a handover every few minutes, because the rings of satellites cross over the pole.
    </p>
  )
}

function DelayNotice() {
  const f = useMemo(() => delayFacts(), [])
  return (
    <p>
      Through GEO the trip through space is about {formatMs(f.geoOneWayS)} one way, so a question and its answer need about{' '}
      {(2 * f.geoOneWayS).toFixed(2)} seconds before any equipment delay. Through LEO it is about {formatMs(f.leoOneWayS)}, even with a few hops between
      satellites: roughly {Math.round(f.geoOneWayS / f.leoOneWayS)} times quicker. The ground network and processing (shown separately, and only
      illustrative) add the same amount to both.
    </p>
  )
}

function AtlanticNotice() {
  const f = useMemo(() => atlanticFacts(), [])
  return (
    <p>
      The flight starts on {f.from}, which London sees low in the southern sky. Around {Math.round(f.handoverNm / 10) * 10} NM from London, {f.to} over the Americas is
      clearly higher in the sky and the aircraft hands over: the coloured strip under Link status changes name. GEO satellites never move in the sky, so that
      is the only change. Switch to LEO and replay the flight: there is a handover about every {Math.round(f.leoMinutes)} minutes.
    </p>
  )
}

function TurnNotice() {
  const f = useMemo(() => turnFacts(TURN_SETUP_NM), [])
  return (
    <p>
      {f.sat} is only about {Math.round(f.satElDeg)}° up, toward the {compass(f.satAzDeg)}. Each time it is on the aircraft’s left, the high-wing side of the
      right turn, it falls into the hatched zone on the sky view: the roof faces away and the body is in the way. In one full circle of about {Math.round(f.circleS)} s the link is lost for
      about {Math.round(f.blockedS)} s. Switch the turn off: the aircraft finishes the circle, rolls wings level, and the link comes back.
    </p>
  )
}

function SatcomPage() {
  const { store, clock } = useSatcom()
  const env = useSatcomState((s) => s.env)
  const routeId = useSatcomState((s) => s.routeId)
  const s = store.getState()
  const go = (speed: number) => {
    clock.getState().setSpeed(speed)
    clock.getState().play()
  }

  const experiments: Experiment[] = [
    {
      id: 'polar',
      question: 'Can satellites reach an aircraft over the North Pole?',
      action: <p>Fly the polar route with GEO satellites only and watch the link status as the aircraft goes north. Then switch to LEO and fly it again.</p>,
      setup: () => {
        s.setEnv('steepTurn', false)
        s.setConstellation('geo')
        s.setRoute('polar')
        s.setDistance(1700)
        s.setView('near')
        s.setFollow(true)
        go(240)
      },
      notice: <PolarNotice />,
    },
    {
      id: 'delay',
      question: 'How much delay does a satellite add to a voice call?',
      action: <p>Over the middle of the Atlantic, send a voice call through GEO. Then switch to LEO and send another. Compare the two rows in the table.</p>,
      setup: () => {
        s.setEnv('steepTurn', false)
        s.setRoute('atlantic')
        s.setConstellation('geo')
        s.setDistance(1500)
        s.setService('voice')
        go(60)
      },
      notice: <DelayNotice />,
    },
    {
      id: 'atlantic',
      question: 'Does the aircraft keep the same satellite all the way across the ocean?',
      action: <p>Follow a flight from London to New York with GEO satellites and watch the coloured strip under Link status.</p>,
      setup: () => {
        s.setEnv('steepTurn', false)
        s.setConstellation('geo')
        s.setRoute('atlantic')
        s.setDistance(0)
        s.setView('near')
        s.setFollow(true)
        go(240)
      },
      notice: <AtlanticNotice />,
    },
    {
      id: 'turn',
      question: 'Can the aircraft block its own satellite link?',
      action: <p>West of Ireland, put the aircraft into a steep turn to the right and watch the sky view and the link status.</p>,
      setup: () => {
        s.setConstellation('geo')
        s.setRoute('atlantic')
        s.setDistance(TURN_SETUP_NM)
        s.setView('near')
        s.setFollow(true)
        s.setEnv('steepTurn', true)
      },
      notice: <TurnNotice />,
    },
    {
      id: 'rain',
      question: 'Does heavy rain cut the satellite link?',
      action: <p>Switch on heavy rain while the aircraft is still at London, then let it take off and climb. Watch the three bars in “Rain on the path”.</p>,
      setup: () => {
        s.setEnv('steepTurn', false)
        s.setConstellation('geo')
        s.setRoute('atlantic')
        s.setDistance(0)
        s.setEnv('heavyRain', true)
        go(10)
      },
      notice: (
        <p>
          The L-band safety link loses only about a hundredth of a decibel and stays connected. The Ku and Ka-band passenger links lose many decibels and
          drop out. As the aircraft climbs above the rain (about {RAIN_HEIGHT_KM} km, some 16,000 ft), less and less of the path is wet, the Ku link returns
          first, then Ka, and at cruise nothing is lost at all.
        </p>
      ),
    },
  ]

  const failures: FailureItem[] = [
    {
      id: 'polar',
      title: 'Polar route outside GEO coverage',
      explanation: (
        <p>
          Geostationary satellites sit above the equator. Near the poles they are below the horizon, so a flight over the Arctic has hours without any GEO
          link. Crews then rely on HF radio, or on a low-orbit constellation.
        </p>
      ),
      watch: 'the link status turning to “No satellite in view” as the aircraft goes north, and the red part of the coverage strip.',
      checked: routeId === 'polar',
      onChange: (v) => s.setRoute(v ? 'polar' : 'atlantic'),
    },
    {
      id: 'turn',
      title: 'Antenna blocked in a steep turn',
      explanation: (
        <p>
          The SATCOM antenna is on the roof. In a 45° bank the roof tilts, and a low satellite on the high-wing side ends up behind the aircraft’s own body.
          The link is lost until the aircraft turns further or rolls wings level.
        </p>
      ),
      watch: 'the hatched zone on the sky view sweeping over the satellite, and a dashed red line on the globe.',
      checked: env.steepTurn,
      onChange: (v) => s.setEnv('steepTurn', v),
    },
    {
      id: 'handover',
      title: 'Satellite handover',
      explanation: (
        <p>
          Switching to another satellite takes a moment. Here it is made much slower (about {HANDOVER_GAP_S.leo.trouble} s for LEO,{' '}
          {HANDOVER_GAP_S.geo.trouble} s for GEO, illustrative), so you can see the gap: messages sent during it wait in a queue and arrive late.
        </p>
      ),
      watch: 'amber “Switching satellites” in the link status and amber marks in the coverage strip. With LEO this happens every few minutes.',
      checked: env.handoverTrouble,
      onChange: (v) => s.setEnv('handoverTrouble', v),
    },
    {
      id: 'rain',
      title: 'Heavy rain',
      explanation: (
        <p>
          Heavy rain (about {HEAVY_RAIN_MM_H} mm per hour) below {RAIN_HEIGHT_KM} km. It barely touches the L-band safety link, but a Ku or Ka-band link on
          the same path fades badly. At cruise the aircraft flies above the rain, so only climb and descent are affected.
        </p>
      ),
      watch: 'the three bars in “Rain on the path” while the aircraft is low.',
      checked: env.heavyRain,
      onChange: (v) => s.setEnv('heavyRain', v),
    },
  ]

  return (
    <ModuleLayout
      moduleId="satcom"
      nextId="sandbox"
      idea={{
        analogy: (
          <p>
            A geostationary satellite is like a <strong>very tall tower</strong> standing still over the equator: it sees a huge area, but anything you say
            has a long way to climb. A low-orbit constellation is like a <strong>relay team of runners</strong>: each one is close by, and they pass your
            message from hand to hand around the whole world, poles included.
          </p>
        ),
        what: (
          <>
            <p>
              <Term id="satcom">Satellite communication</Term> lets aircraft talk to air traffic control and send data where there is no radar and VHF radio
              cannot reach: over oceans, deserts and the poles.
            </p>
            <p>
              Different satellite systems make different trade-offs. High satellites cover a huge area from one fixed spot, but add delay and miss the
              poles. Low satellites move fast, so the aircraft keeps switching between them, but together they cover the whole globe with little delay.
            </p>
          </>
        ),
        where: (
          <ul>
            <li>
              Over the North Atlantic, the Pacific and other remote areas that used to rely only on <Term id="hf">HF</Term> radio: for voice, CPDLC text
              messages and ADS-C position reports.
            </li>
            <li>
              <Term id="inmarsat">Inmarsat</Term> (geostationary) and <Term id="iridium">Iridium</Term> (low orbit) are the main systems for safety
              services.
            </li>
            <li>Space-based ADS-B lets controllers see aircraft over the middle of the ocean.</li>
          </ul>
        ),
      }}
      simulator={<SatcomSimulator />}
      howItWorks={steps}
      tryThis={experiments}
      failures={failures}
      failuresNote={
        <p>
          These switches also appear under “Things that go wrong” in the simulator controls. Satellites themselves rarely fail; most real problems come
          from geometry: where the aircraft is, how it is flying, and which satellite it can see.
        </p>
      }
      goDeeper={<Deeper />}
      quiz={quiz}
    />
  )
}

export default function SatcomModule() {
  return (
    <SatcomProvider>
      <SatcomPage />
    </SatcomProvider>
  )
}
