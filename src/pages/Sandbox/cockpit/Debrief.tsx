import { useMemo } from 'react'
import { Link } from 'react-router'
import { RotateCcw } from 'lucide-react'
import { Quiz, type QuizQuestion } from '@/components/module/Quiz'
import { HudButton } from '@/hud/Controls'
import { CornerBrackets } from '@/hud/HudFrame'
import { distanceNm } from '@/core/geometry'
import { MODULE_BY_ID } from '@/modules/registry'
import { useReducedMotion } from '@/stores/prefs'
import { PHASE_UNIT, UNITS, type AtcUnit } from '../atc'
import { FLIGHT_PHASES, TICK_S } from '../journey'
import { getJourneyIndex } from '../phases'
import { useSandbox, useSandboxState } from '../state'

export const QUIZ: QuizQuestion[] = [
  {
    question: 'The radars fail. Why do most aircraft stay on the controller’s screen?',
    options: ['The screen freezes the last picture', 'ADS-B and multilateration still report them', 'Pilots read out their positions', 'The radar has batteries'],
    answer: 1,
    explanation:
      'ADS-B comes from the aircraft itself and multilateration times the transponder signals, so neither needs the radar. Only an aircraft with no transponder would vanish.',
  },
  {
    question: 'GNSS is jammed near the airport. Which of these still gives the controller a position?',
    options: ['ADS-B', 'Secondary radar', 'RNP approach', 'None of them'],
    answer: 1,
    explanation: 'Secondary radar measures the reply time and the antenna direction itself. ADS-B broadcasts the aircraft’s GNSS position, so it fails with GNSS.',
  },
  {
    question: 'Who may clear CNS700 to take off?',
    options: ['Ground control', 'The tower', 'Departure radar', 'The pilot, once the runway looks clear'],
    answer: 1,
    explanation: 'The tower owns the runway. Ground control moves aircraft on the taxiways but never onto the runway; departure radar takes over once the aircraft is airborne.',
  },
  {
    question: 'Far out over the ocean, how does the controller get CNS700’s position?',
    options: ['Approach radar', 'VHF voice every minute', 'ADS-C reports via satellite every few minutes', 'Multilateration'],
    answer: 2,
    explanation:
      'Ground radar, ADS-B stations and VHF only reach a few hundred miles. ADS-C reports travel via a geostationary satellite, so they work over the ocean, but they arrive every few minutes and with a delay.',
  },
  {
    question: 'On the final approach the PAPI shows two white and two red lights. What does that tell the pilot?',
    options: ['Too high', 'Too low', 'On the correct glide path', 'The runway is closed'],
    answer: 2,
    explanation: 'Each PAPI unit looks white from above its set angle and red from below. On the 3° path the two units nearer the runway look red and the two farther ones white.',
  },
]

/** After landing: what the flight involved, a short quiz, and fly again. */
export function Debrief() {
  const { clock } = useSandbox()
  const flyAgain = useSandboxState((s) => s.flyAgain)
  const reduced = useReducedMotion()
  const summary = useMemo(() => {
    const idx = getJourneyIndex()
    const tick = (k: string) => idx.events.find((e) => e.kind === k)!.tick
    const blockMin = Math.round(((tick('onBlocks') - tick('pushback')) * TICK_S) / 60)
    let nm = 0
    for (let i = 1; i < idx.samples.length; i++) nm += distanceNm(idx.samples[i - 1].pos, idx.samples[i].pos)
    const units = FLIGHT_PHASES.map((p) => PHASE_UNIT[p]).filter((u, i, a) => i === 0 || u !== a[i - 1])
    const topFl = Math.round(Math.max(...idx.samples.map((s) => s.altitudeFt)) / 100)
    return { blockMin, nm: Math.round(nm), units, topFl }
  }, [])
  const modules = ['psr', 'ssr', 'ads', 'mlat', 'surface', 'dvor', 'ils', 'gnss', 'vhf', 'cpdlc', 'satcom', 'hf'].map((id) => MODULE_BY_ID.get(id)!).filter(Boolean)
  return (
    <section id="debrief" aria-labelledby="debrief-title" className="relative mx-auto max-w-[1100px] scroll-mt-20 px-4 py-12 md:px-8">
      <CornerBrackets inset={0} />
      <div className="flex flex-col gap-8 px-2 md:px-6">
        <header className="flex flex-col gap-2">
          <p className="hud-label flex items-center gap-2">
            <span className="inline-block size-1.5 bg-brass" aria-hidden /> Debrief
          </p>
          <h2 id="debrief-title" className="hud-title text-[20px] leading-tight md:text-[26px]">
            One flight, {new Set(summary.units).size} controllers
          </h2>
          <p className="max-w-[640px] text-[15px] leading-7 text-foreground/85">
            CNS700 was handed from controller to controller as it moved, and at every moment several systems watched it, guided it and let it
            talk. When one failed, another took over.
          </p>
        </header>
        <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[
            ['Off-block to on-block', `${Math.floor(summary.blockMin / 60)} h ${summary.blockMin % 60} min`],
            ['Distance flown', `${summary.nm.toLocaleString('en-US')} NM`],
            ['Highest level', `FL${summary.topFl}`],
            ['Handovers', `${summary.units.length - 1}`],
          ].map(([k, v]) => (
            <div key={k} className="hud-panel rounded-md px-4 py-3">
              <dt className="hud-label">{k}</dt>
              <dd className="hud-value mt-1 text-[18px] text-foreground">{v}</dd>
            </div>
          ))}
        </dl>
        <div>
          <h3 className="hud-label mb-3">Who controlled CNS700, in order</h3>
          <ol className="flex flex-wrap items-center gap-2 text-[13px]">
            {summary.units.map((u: AtcUnit, i) => (
              <li key={`${u}-${i}`} className="flex items-center gap-2">
                <span className="hud-panel rounded-[4px] px-2 py-1">
                  {UNITS[u].name} <span className="hud-value text-[11px] text-signal">{UNITS[u].vhfMHz ?? 'CPDLC · HF'}</span>
                </span>
                {i < summary.units.length - 1 && <span aria-hidden className="text-muted-foreground">→</span>}
              </li>
            ))}
          </ol>
        </div>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div className="hud-panel rounded-md p-5 md:p-7">
            <h3 className="hud-title mb-4 text-[15px]">Quick quiz</h3>
            <Quiz moduleId="sandbox" questions={QUIZ} />
          </div>
          <div className="flex flex-col gap-4">
            <HudButton
              variant="solid"
              className="min-h-11 self-start"
              onClick={() => {
                flyAgain()
                clock.getState().play()
                window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' })
              }}
            >
              <RotateCcw aria-hidden /> Fly the journey again
            </HudButton>
            <div>
              <h3 className="hud-label mb-2">Explore each system on its own</h3>
              <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-[13.5px]">
                {modules.map((m) => (
                  <li key={m.id}>
                    <Link to={m.path} className="inline-flex min-h-8 items-center underline-offset-4 hover:text-signal hover:underline">
                      {m.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
