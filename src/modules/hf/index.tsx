import { Link } from 'react-router'
import { lazyRetry } from '@/lib/lazyRetry'
import { ModuleLayout, type StageSpec } from '@/components/module/ModuleLayout'
import type { FailureItem } from '@/components/module/FailureList'
import type { Experiment } from '@/components/module/TryThis'
import type { QuizQuestion } from '@/components/module/Quiz'
import type { Step } from '@/components/module/Stepper'
import { Term } from '@/components/Term'
import { HF_CHANNELS_MHZ, hfQuality, ionosphereAt, pathMuf, skipZoneNm, suggestChannel } from '@/core/hf'
import { radioLineOfSightNm } from '@/core/propagation'
import Deeper from './deeper.mdx'
import { HfSimulator } from './Simulator'
import { CRUISE_FT, OTHER_AIRCRAFT, TIMELAPSE_H_PER_S } from './engine'
import { QUALITY_TEXT, formatHour, kmText } from './labels'
import { HfProvider, useHf, useHfState } from './state'
import { BeyondHorizonVisual, BounceVisual, DayNightVisual, IonosphereVisual, SelcalVisual, SkipZoneVisual } from './visuals'
import { useClock } from '@/hooks/useSimClock'
import { useSampled } from '@/hooks/useSampled'
import { TelemetryRow } from '@/hud/Telemetry'
import { HERO_D_MAX, HERO_D_MIN, HERO_HEIGHT_X } from './heroScale'

// The 3D scene is its own chunk, so the page text appears before three.js loads.
const HfHero = lazyRetry(() => import('./Hero3D'))

/** Honesty labels: what is to scale in the Earth slice and what is not. */
const sliceLabel = `Earth slice ${(HERO_D_MAX - HERO_D_MIN).toLocaleString('en-US')} NM long · heights and curve ×${HERO_HEIGHT_X}`
const sizeLabel = 'Station and aircraft larger than life · one ray every 3°'
const skyLabel = 'One ionosphere for the whole path · the Sun shows the time of day'

const SHOTS: StageSpec['shots'] = {
  idea: { position: [-8, 5, 38], target: [-8.5, -0.3, 0], fov: 36 },
  simulator: { position: [-3.5, 6, 30], target: [-4.3, -0.5, 0], fov: 36 },
  how: { position: [-8, 5, 38], target: [-8.5, -0.3, 0], fov: 36 },
  try: { position: [-8, 6, 40], target: [-9.5, 0, 0], fov: 36 },
  wrong: { position: [-12, 5, 36], target: [-9, -0.3, 0], fov: 36 },
  deeper: { position: [-4, 10, 40], target: [-8.5, 0, 0], fov: 36 },
  quiz: { position: [-6, 24, 20], target: [-6.5, -1, 0], fov: 36 },
}

/** One shot per "How it works" step (panels sit on the left, so the subject is framed right of centre). */
const HOW_SHOTS: StageSpec['howShots'] = [
  // 1 Too far for VHF: the station, the curve and the aircraft beyond the horizon.
  { position: [-8, 5, 38], target: [-8.5, -0.3, 0], fov: 36 },
  // 2 A mirror made by the Sun: the layers, from higher up.
  { position: [-6, 9, 34], target: [-7.5, 0.8, 0], fov: 36 },
  // 3 Bounce or escape: the fan of rays leaving the station.
  { position: [-7, 3, 20], target: [-10.5, -1.6, 0], fov: 36 },
  // 4 Skipping over: the sea near the station, where nothing arrives.
  { position: [-6, 10, 24], target: [-9, -1.8, 0], fov: 36 },
  // 5 Day and night: the whole slice with the Sun or Moon.
  { position: [-6, 6, 42], target: [-9.5, 0.8, 0], fov: 36 },
  // 6 A doorbell for HF: the aircraft on the path.
  { position: [-2, 3.5, 12], target: [-4, 0.5, 0], fov: 36 },
]

function HfTelemetry() {
  const { engine } = useHf()
  const r = useSampled(
    () => {
      const rx = engine.reception()
      const skip = engine.skipZone()
      return {
        f: engine.freqMHz,
        hour: engine.params.hour,
        day: engine.day,
        muf: engine.muf()?.mufMHz ?? null,
        q: hfQuality(rx),
        skip: skip ? `${Math.round(skip.fromNm)}–${Math.round(skip.toNm).toLocaleString('en-US')}` : 'none',
      }
    },
    250,
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  )
  return (
    <div className="hud-panel flex flex-col rounded-md px-3.5 py-2.5">
      <TelemetryRow label="Frequency" value={r.f.toFixed(3)} unit="MHz" tone="signal" />
      <TelemetryRow label="Local time" value={`${formatHour(r.hour)} ${r.day ? 'day' : 'night'}`} />
      <TelemetryRow label="MUF" value={r.muf ? r.muf.toFixed(1) : '—'} unit={r.muf ? 'MHz' : undefined} />
      <TelemetryRow label="CNS101" value={QUALITY_TEXT[r.q]} tone={r.q === 'clear' ? 'ok' : r.q === 'noisy' ? 'brass' : 'alert'} />
      <TelemetryRow label="Skip zone" value={r.skip} unit={r.skip === 'none' ? undefined : 'NM'} />
    </div>
  )
}

const ch = (mhz: number) => HF_CHANNELS_MHZ.indexOf(mhz)
const D_LONG = 1350

// Numbers quoted in "What you should notice", computed with the same model the simulator uses.
const mufDay = pathMuf(ionosphereAt(13), D_LONG, CRUISE_FT)!.mufMHz
const mufNight = pathMuf(ionosphereAt(23), D_LONG, CRUISE_FT)!.mufMHz
const nightSuggest = suggestChannel(ionosphereAt(23), D_LONG, CRUISE_FT)!.mHz
const skip = skipZoneNm(ionosphereAt(2), 8.864)!
const skipLow = skipZoneNm(ionosphereAt(2), 5.616)!
const vhfRange = radioLineOfSightNm(100, CRUISE_FT)

const steps: Step[] = [
  {
    title: 'Too far for VHF',
    body: (
      <>
        <p>
          <Term id="vhf">VHF</Term> travels in straight lines, so it only reaches about {Math.round(vhfRange)} NM from an antenna, even to a jet at
          cruise. In the middle of an ocean there is no antenna that close.
        </p>
        <p>
          <Term id="hf">HF</Term> waves, at 3 to 30 MHz, can be bent back down by the upper atmosphere and come down beyond the horizon, thousands of
          kilometres away.
        </p>
      </>
    ),
    visual: <BeyondHorizonVisual />,
  },
  {
    title: 'A mirror made by the Sun',
    body: (
      <>
        <p>
          Sunlight frees electrons high above the Earth. That electrified region is the <Term id="ionosphere">ionosphere</Term>. It has layers: the
          low <Term id="d-layer">D layer</Term> (only by day), the E layer, and the high <Term id="f-layer">F layer</Term>, the main mirror for HF.
        </p>
        <p>Because the Sun makes it, the ionosphere changes all the time: between day and night, with the seasons and with the Sun's 11-year cycle.</p>
      </>
    ),
    visual: <IonosphereVisual />,
  },
  {
    title: 'Bounce or escape',
    body: (
      <>
        <p>
          Whether a wave comes back depends on its frequency and its angle. Straight up, a layer only returns frequencies below its{' '}
          <Term id="critical-frequency">critical frequency</Term>. A slanting wave is bent back much more easily.
        </p>
        <p>
          So for each distance there is a <Term id="muf">maximum usable frequency</Term>. Above it, the wave goes straight through into space.
        </p>
      </>
    ),
    visual: <BounceVisual />,
  },
  {
    title: 'Skipping over',
    body: (
      <>
        <p>
          Close to the station you hear the <Term id="ground-wave">ground wave</Term>. The steep waves that would come down nearby escape, so the
          first <Term id="sky-wave">sky wave</Term> lands far away. In between is the <Term id="skip-zone">skip zone</Term>: nothing is heard there.
        </p>
        <p>
          Beyond, the wave can bounce off the sea and go up again: a second <Term id="hop">hop</Term>, and a third, like a stone skipping on water.
        </p>
      </>
    ),
    visual: <SkipZoneVisual />,
  },
  {
    title: 'Day and night',
    body: (
      <>
        <p>
          By day the D layer soaks up low frequencies, while the strong F layer returns high ones. At night the D layer disappears and the F layer
          weakens, so only lower frequencies come back.
        </p>
        <p>
          Operators follow the Sun: higher frequencies by day, lower at night, aiming a little below the MUF (the{' '}
          <Term id="owf">optimum working frequency</Term>).
        </p>
      </>
    ),
    visual: <DayNightVisual />,
  },
  {
    title: 'A doorbell for HF',
    body: (
      <>
        <p>
          HF is full of hiss and crackle, and listening to it for a ten-hour flight is exhausting. With <Term id="selcal">SELCAL</Term> the crew turns
          the volume down and waits.
        </p>
        <p>The ground station sends the aircraft's four-letter code as two pairs of tones. Only that aircraft chimes; then the crew picks up the call.</p>
      </>
    ),
    visual: <SelcalVisual />,
  },
]

const quiz: QuizQuestion[] = [
  {
    question: 'A pilot in the middle of the Atlantic cannot reach a controller on VHF. Why not?',
    options: ['VHF radios are switched off over the ocean', 'VHF travels in straight lines and the curve of the Earth is in the way', 'Sea water absorbs VHF', 'VHF is too slow'],
    answer: 1,
    explanation:
      'VHF only reaches about as far as a straight line can "see", a couple of hundred nautical miles from a high aircraft. Over the middle of an ocean the nearest antenna is far below the horizon.',
  },
  {
    question: 'An operator stays on 17.9 MHz from the afternoon into the night, and the signal disappears. What happened?',
    options: [
      'The transmitter overheated',
      'At night the ionosphere can no longer bend such a high frequency back, so it escapes into space',
      'The D layer absorbed it',
      'The aircraft flew into the skip zone of the ground wave',
    ],
    answer: 1,
    explanation:
      'After dark the F layer weakens and its maximum usable frequency drops. A frequency that bounced nicely at 3 pm passes straight through at night: time to change to a lower band.',
  },
  {
    question: 'What is the skip zone?',
    options: [
      'The area directly under the ionosphere',
      'A zone where HF is not allowed',
      'The ring between the end of the ground wave and where the first sky wave comes down, where nothing is heard',
      'The part of the ocean with no aircraft',
    ],
    answer: 2,
    explanation:
      'Close in, the ground wave reaches you. Far out, the sky wave comes down. In between, the steep waves that would land there have escaped into space, so a nearby station can be silent while a distant one hears you clearly.',
  },
  {
    question: 'A big solar flare erupts at midday. What happens to HF on the sunlit side of the Earth?',
    options: ['Nothing', 'Signals get stronger', 'The D layer absorbs almost everything: an HF blackout', 'Only the night side is affected'],
    answer: 2,
    explanation:
      "The flare's X-rays make the D layer much denser. It then soaks up HF waves before they reach the reflecting layers, for minutes to hours. The night side, facing away from the Sun, is not affected.",
  },
  {
    question: 'What does SELCAL do?',
    options: [
      'It picks the best HF frequency',
      'It rings a chime in only the called aircraft, so the crew does not have to listen to the noise',
      'It turns HF voice into text',
      'It blocks other aircraft from transmitting',
    ],
    answer: 1,
    explanation: "The ground station sends the aircraft's code as two pairs of tones. Every aircraft hears them, but only the decoder with that code rings.",
  },
]

function HfPage() {
  const { engine, clock } = useHf()
  const failures = useHfState((s) => s.failures)
  // Re-render when the frequency or time changes, so the "wrong frequency" card follows the simulator.
  useHfState((s) => s.params)
  const { setParam, setFailure, setSelcalTarget } = useHfState((s) => s)
  const wrong = engine.wrongFrequency()
  const play = () => clock.getState().play()
  const running = useClock(clock, (c) => c.running)
  const timelapse = useHfState((s) => s.params.timelapse)

  const stage: StageSpec = {
    scene: (t) => <HfHero t={t} engine={engine} />,
    shots: SHOTS,
    howShots: HOW_SHOTS,
    kicker: 'HF voice · 2.8–22 MHz',
    labels: [sliceLabel, sizeLabel, skyLabel, ...(timelapse ? [`Sped up: 1 hour every ${Math.round(1 / TIMELAPSE_H_PER_S)} s`] : [])],
    telemetry: <HfTelemetry />,
    clock: { getTimeS: () => engine.timeS, running, sub: timelapse ? 'Time-lapse' : 'Real time' },
    label:
      'A slice of the round Earth over the ocean: an HF station on the coast sends a fan of radio rays up to the glowing ionosphere layers. Some bounce back down to the sea and to the aircraft far away, some escape into space, and a skip zone near the station hears nothing.',
  }
  const base = (hour: number, mhz: number, d: number) => {
    setFailure('flare', false)
    setFailure('storm', false)
    setParam('timelapse', false)
    setParam('hour', hour)
    setParam('channelIndex', ch(mhz))
    setParam('distanceNm', d)
  }

  const experiments: Experiment[] = [
    {
      id: 'night',
      question: 'What happens to a daytime frequency at night?',
      action: (
        <p>
          It is 13:00 and CNS101, {D_LONG.toLocaleString('en-US')} NM away, works the station on 17.946 MHz. Move the time of day to 23:00, or switch on
          "Let the day go by".
        </p>
      ),
      setup: () => {
        base(13, 17.946, D_LONG)
        play()
      },
      notice: (
        <p>
          By day the MUF for this path is about {mufDay.toFixed(0)} MHz and 17.946 MHz comes back down. At night it falls to about{' '}
          {mufNight.toFixed(0)} MHz: every ray escapes into space and CNS101 hears nothing. The suggested frequency drops to {nightSuggest.toFixed(3)}{' '}
          MHz, which brings the signal back.
        </p>
      ),
    },
    {
      id: 'skip',
      question: 'Can a nearby station hear you?',
      action: (
        <p>
          At 02:00 on 8.864 MHz, CNS101 is 400 NM from the station, closer than the other two aircraft. Look at the band under the sea and at CNS101's
          status. Then try 5.616 MHz.
        </p>
      ),
      setup: () => {
        base(2, 8.864, 400)
        play()
      },
      notice: (
        <p>
          The skip zone runs from about {Math.round(skip.fromNm)} to {Math.round(skip.toNm)} NM ({kmText(skip.fromNm)} to {kmText(skip.toNm)}). CNS101,
          in the middle of it, hears nothing, while CNS202 ({OTHER_AIRCRAFT.CNS202.distanceNm} NM) and CNS303 ({OTHER_AIRCRAFT.CNS303.distanceNm.toLocaleString('en-US')}{' '}
          NM) hear the station well. On 5.616 MHz the first sky wave comes down at about {Math.round(skipLow.toNm)} NM, so CNS101 hears it too.
        </p>
      ),
    },
    {
      id: 'audio',
      question: 'How does HF sound compared with VHF?',
      action: <p>Press "Hear it on HF", then "Hear it on VHF". Then switch on Thunderstorm static and listen to HF again.</p>,
      setup: () => {
        base(2, 8.864, D_LONG)
        play()
      },
      notice: (
        <p>
          HF is narrow and hissy, with slow fading and crackles, even when it works well. VHF is clear, but only within about {Math.round(vhfRange)} NM
          of an antenna, which is why it is no use here. Thunderstorm static makes HF much worse, especially at the low frequencies used at night.
        </p>
      ),
    },
    {
      id: 'flare',
      question: 'What does a solar flare do to HF?',
      action: <p>It is noon on the suggested frequency. Switch on the solar flare, try every frequency, then move the time of day into the night.</p>,
      setup: () => {
        base(12, 21.964, D_LONG)
        setFailure('flare', true)
        play()
      },
      notice: (
        <p>
          Every ray dies in the D layer, on every channel: an HF blackout, and no frequency is suggested. At night the same flare has no effect,
          because it only strengthens the D layer on the side of the Earth facing the Sun.
        </p>
      ),
    },
    {
      id: 'selcal',
      question: 'How does the pilot know they are being called?',
      action: <p>Send the SELCAL for CNS202 and watch the lights. Then choose CNS101 (you) and send again.</p>,
      setupLabel: 'Set it up for me',
      setup: () => {
        base(13, 21.964, D_LONG)
        setSelcalTarget('CNS202')
        play()
      },
      notice: (
        <p>
          The tones go out to everyone on the frequency, but only CNS202's decoder recognises {OTHER_AIRCRAFT.CNS202.code} and lights up. When you call
          CNS101, its chime rings and the message follows. If an aircraft is in the skip zone, the tones never arrive and it misses the call.
        </p>
      ),
    },
  ]

  const failureItems: FailureItem[] = [
    {
      id: 'flare',
      title: 'Solar flare (HF blackout)',
      explanation: (
        <p>
          A <Term id="solar-flare">solar flare</Term> makes the D layer absorb so strongly that HF waves never reach the reflecting layers. It lasts
          minutes to hours and only affects the sunlit side of the Earth.
        </p>
      ),
      watch: 'every ray ending with × in the D layer (by day).',
      checked: failures.flare,
      onChange: (v) => setFailure('flare', v),
    },
    {
      id: 'wrong',
      title: 'Wrong frequency for the time of day',
      explanation: (
        <p>
          A daytime frequency at night is above the MUF and escapes into space. A night-time frequency by day is soaked up by the D layer. Switching
          this on picks the wrong channel for the current time; switching it off picks the suggested one.
        </p>
      ),
      watch: 'dashed rays escaping to space, or rays ending in the D layer.',
      checked: wrong,
      onChange: (v) => {
        if (v) setParam('channelIndex', engine.wrongChannelIndex())
        else {
          const s = engine.suggestion()
          if (s) setParam('channelIndex', s.index)
        }
      },
    },
    {
      id: 'storm',
      title: 'Atmospheric noise (thunderstorms)',
      explanation: (
        <p>
          Lightning makes crashes of <Term id="atmospheric-noise">static</Term> that travel thousands of kilometres on HF. It buries weak signals,
          most of all at the low frequencies.
        </p>
      ),
      watch: 'the noise readout rising and CNS101 turning "noisy" or "too weak".',
      checked: failures.storm,
      onChange: (v) => setFailure('storm', v),
    },
  ]

  return (
    <ModuleLayout
      moduleId="hf"
      stage={stage}
      nextId="cpdlc"
      idea={{
        analogy: (
          <p>
            Think of skipping a stone on a lake. Thrown at a shallow angle, it bounces off the water and travels much farther than it could fly. HF
            radio waves do the same: they bounce between the sky and the sea to get far beyond the horizon. Throw too steeply, or too hard, and they
            do not come back at all.
          </p>
        ),
        what: (
          <>
            <p>
              <Term id="hf">HF</Term> radio lets aircraft talk to ground stations thousands of kilometres away, by bouncing off the{' '}
              <Term id="ionosphere">ionosphere</Term>. It works where there is no VHF antenna in sight: over oceans, deserts and the poles.
            </p>
            <p>The catch: the ionosphere is made by the Sun, so the best frequency changes between day and night, and some days HF hardly works at all.</p>
          </>
        ),
        where: (
          <ul>
            <li>Oceanic airspace: the North Atlantic, the Pacific, the Indian Ocean.</li>
            <li>Remote land areas and polar routes.</li>
            <li>
              Increasingly as a backup, now that{' '}
              <Link to="/modules/cpdlc" className="font-medium text-primary underline underline-offset-2">
                text messages (CPDLC)
              </Link>{' '}
              and{' '}
              <Link to="/modules/satcom" className="font-medium text-primary underline underline-offset-2">
                satellites
              </Link>{' '}
              carry most oceanic messages.
            </li>
          </ul>
        ),
      }}
      simulator={<HfSimulator />}
      howItWorks={steps}
      tryThis={experiments}
      failures={failureItems}
      goDeeper={<Deeper />}
      quiz={quiz}
    />
  )
}

export default function HfModule() {
  return (
    <HfProvider>
      <HfPage />
    </HfProvider>
  )
}
