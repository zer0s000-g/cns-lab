import { Link } from 'react-router'
import { ModuleLayout } from '@/components/module/ModuleLayout'
import type { FailureItem } from '@/components/module/FailureList'
import type { Experiment } from '@/components/module/TryThis'
import type { QuizQuestion } from '@/components/module/Quiz'
import type { Step } from '@/components/module/Stepper'
import { Term } from '@/components/Term'
import Deeper from './deeper.mdx'
import { FAILING_RECEIVER } from './layout'
import { SurfaceSimulator } from './Simulator'
import { SurfaceProvider, useSurface, useSurfaceState } from './state'
import { FogVisual, FusionVisual, LevelsVisual, NamesVisual, SmrVisual, StopBarVisual } from './visuals'

const steps: Step[] = [
  {
    title: 'The problem: seeing the ground',
    body: (
      <>
        <p>
          A busy airport has aircraft landing, taking off and taxiing, plus fuel trucks, buses and cars, all on the same
          network of runways and <Term id="taxiway">taxiways</Term>. Controllers watch it from the tower.
        </p>
        <p>In fog, or at night, they cannot see it. The most dangerous place is the runway.</p>
      </>
    ),
    visual: <FogVisual />,
  },
  {
    title: 'A radar made for the ground',
    body: (
      <p>
        A <Term id="smr">surface movement radar</Term> is a primary radar tuned for detail. Its pulses are a few
        hundredths of a microsecond long and its beam is very narrow, so it resolves a few metres. It turns once a
        second, and it sees the shape of every aircraft and vehicle, whether they cooperate or not. But it cannot tell
        who they are.
      </p>
    ),
    visual: <SmrVisual />,
  },
  {
    title: 'Adding names',
    body: (
      <p>
        Aircraft (and many airport vehicles) carry a <Term id="transponder">transponder</Term>. Airport{' '}
        <Term id="multilateration">multilateration</Term> times its signals at receivers around the field, and{' '}
        <Term id="ads-b">ADS-B</Term> broadcasts the object's own satellite position. Both carry the callsign.
      </p>
    ),
    visual: <NamesVisual />,
  },
  {
    title: 'One picture from three sensors',
    body: (
      <p>
        <Term id="data-fusion">Data fusion</Term> combines the reports into one <Term id="track">track</Term> per object,
        with a name when one is known. If a sensor drops out, the track carries on with the others. A vehicle without a
        transponder stays a nameless track that only the radar sees.
      </p>
    ),
    visual: <FusionVisual />,
  },
  {
    title: 'Stop bars and the safety net',
    body: (
      <>
        <p>
          Where each taxiway meets the runway there is a holding position with a <Term id="stop-bar">stop bar</Term>: a
          row of red lights across the taxiway. It goes out only for the aircraft cleared onto the runway.
        </p>
        <p>
          A <Term id="safety-net">safety net</Term> watches the <Term id="runway-protected-area">runway protected area</Term>.
          Anyone entering it while an aircraft is landing or taking off triggers a{' '}
          <Term id="runway-incursion">runway incursion</Term> alert.
        </p>
      </>
    ),
    visual: <StopBarVisual />,
  },
  {
    title: 'A-SMGCS: four services',
    body: (
      <p>
        Put together, this is an <Term id="a-smgcs">A-SMGCS</Term>. It starts with surveillance, adds alerting, then
        planning each taxi route, and finally guidance: taxiway lights that switch on ahead of each aircraft, so pilots
        just "follow the greens".
      </p>
    ),
    visual: <LevelsVisual />,
  },
]

const quiz: QuizQuestion[] = [
  {
    question: 'Why can a surface movement radar show the shape of an aircraft, when an approach radar shows only a blip?',
    options: [
      'It is much more powerful',
      'Its pulses are very short and its beam very narrow, so it resolves a few metres',
      'It reads the shape from the transponder',
      'It uses a camera as well',
    ],
    answer: 1,
    explanation:
      'Detail depends on the size of the radar\'s "cells": pulse length sets the depth, beam width the width. With 20 ns pulses and a 0.35° beam the cells are a few metres, so an aircraft covers dozens of them and its outline appears.',
  },
  {
    question: 'A van with no transponder drives across the apron. Which sensor can see it?',
    options: ['Multilateration', 'ADS-B', 'The surface movement radar', 'None of them'],
    answer: 2,
    explanation:
      'MLAT and ADS-B both need a transponder signal. The radar sees anything that reflects, so it is the only one that sees the van, but it cannot tell the controller who it is.',
  },
  {
    question: 'Thick fog covers the airport. What happens to the surveillance display?',
    options: ['It fades like the view from the window', 'It stays clear: radio waves pass through fog', 'It shows only the runway', 'It switches off'],
    answer: 1,
    explanation:
      'Fog droplets are far too small to affect these radio waves much, so the display looks the same. That is exactly why airports rely on it in low visibility.',
  },
  {
    question: 'A pilot sees a row of red lights across the taxiway ahead. What does it mean?',
    options: ['Slow down', 'Stop: do not enter the runway', 'The taxiway is closed for good', 'Follow these lights'],
    answer: 1,
    explanation:
      'That is a stop bar at the runway-holding position. It is switched off only for the aircraft cleared onto the runway. Crossing it while lit is a runway incursion.',
  },
  {
    question: 'An unnamed aircraft appears in the car park behind the terminal. What is the most likely cause?',
    options: ['A light aircraft landed there', 'A reflection off the terminal building makes a ghost', 'Rain clutter', 'A transponder fault'],
    answer: 1,
    explanation:
      'The radar pulse can bounce off the building\'s face to a real aircraft and back. The echo then appears at the aircraft\'s mirror image behind the wall. It has no transponder data, so the fused picture shows it without a name.',
  },
]

function SurfacePage() {
  const { engine, store } = useSurface()
  const env = useSurfaceState((s) => s.env)
  const s = store.getState()

  const experiments: Experiment[] = [
    {
      id: 'fog',
      question: 'What does the controller lose in fog, and what do they keep?',
      action: <p>Turn the visibility down to about 150 m. Compare the tower window with the controller's display.</p>,
      setup: () => {
        s.setVisibility(150)
        s.setZoom('airport')
        s.setPreset('fused')
      },
      notice: (
        <p>
          The window view turns grey. The nearest edge of the runway is almost 400 m from the tower, so at 150 m
          visibility nothing on it can be made out. The display looks exactly as before, because radio waves pass through
          fog. Below about 400 m, airports switch to low visibility procedures and rely on this picture.
        </p>
      ),
    },
    {
      id: 'incursion',
      question: 'What happens if a car drives onto the runway while an aircraft is landing?',
      action: (
        <p>
          Drag OPS1 from the road south of the runway across the dashed holding line onto the runway, or press "Drive OPS1
          onto the runway". Watch the display and the arriving aircraft.
        </p>
      ),
      setup: () => {
        engine.sendVehiclesBack()
        engine.placeOnRoad('OPS1', -300)
        engine.arrivalNow()
        s.setZoom('airport')
        s.setPreset('fused')
        s.select('OPS1')
      },
      notice: (
        <p>
          As soon as OPS1 is inside the holding lines, the protected area turns amber: "Runway entered without clearance".
          When the arrival comes within about a minute (or 2 NM) of the runway it turns red, RUNWAY INCURSION, with both
          targets boxed. At 1 NM the aircraft goes around. If a departure happens to be rolling, the alert is immediate.
          Press "Send vehicles back" to clear the runway.
        </p>
      ),
    },
    {
      id: 'no-smr',
      question: 'What would the controller miss without the surface radar?',
      action: <p>Switch off "Surface movement radar" in the controls and look for what disappears from the display.</p>,
      setup: () => {
        s.setPreset('fused')
        s.setEnv('noTransponder', true)
        s.setEnv('reflections', true)
        s.setZoom('airport')
      },
      notice: (
        <p>
          VAN2 (no transponder), the parked CNS440 (transponder off) and the ghost targets behind the terminal all vanish:
          only the radar could see them. Everything with a transponder keeps its label, now from MLAT and ADS-B alone. The
          alerting is blind to VAN2 too: drag it onto the runway and no alert appears until the radar is back.
        </p>
      ),
    },
    {
      id: 'rain',
      question: 'Why does heavy rain matter for this radar?',
      action: <p>Turn on heavy rain and compare the shapes near the tower with those far away. Then switch on circular polarisation.</p>,
      setup: () => {
        s.setEnv('heavyRain', true)
        s.setEnv('circularPol', false)
        s.setPreset('smr')
        s.setZoom('airport')
      },
      notice: (
        <p>
          Speckle from the rain fills the display, and far from the radar the shapes break up: the car on the south road
          flickers or disappears while nearby objects stay solid. Circular polarisation removes most of the rain echo and
          brings the distant shapes back.
        </p>
      ),
    },
    {
      id: 'mlat-gap',
      question: 'What if part of the airport loses MLAT?',
      action: <p>Fail receiver {FAILING_RECEIVER} and zoom in on the west end, where departures wait at A1.</p>,
      setup: () => {
        s.setEnv('mlatFailure', true)
        s.setPreset('fused')
        s.setZoom('west')
      },
      notice: (
        <p>
          The hatched area now has fewer than three receivers, so there is no MLAT position there: the letter M disappears
          from the labels. The tracks keep their names, because the radar and ADS-B still see them and the tracker
          remembers who they are. The picture <Term id="graceful-degradation">degrades gracefully</Term> instead of losing aircraft.
        </p>
      ),
    },
  ]

  const failures: FailureItem[] = [
    {
      id: 'rain',
      title: 'Heavy rain',
      explanation: (
        <p>
          Raindrops scatter and absorb the radar's short (about 3 cm) waves. The display fills with rain echo, and far from
          the radar small targets lose detail or disappear.
        </p>
      ),
      watch: 'speckle everywhere, and the car on the south road breaking up.',
      checked: env.heavyRain,
      onChange: (v) => s.setEnv('heavyRain', v),
    },
    {
      id: 'transponder',
      title: 'A vehicle without a transponder',
      explanation: (
        <p>
          VAN2 carries no transponder. MLAT and ADS-B cannot see it; only the radar paints it, as a shape with no name. If
          the radar is off or cannot see it, the vehicle is invisible to the whole system.
        </p>
      ),
      watch: 'an "Unknown" track, with only the letter S when you select it or zoom in.',
      checked: env.noTransponder,
      onChange: (v) => s.setEnv('noTransponder', v),
    },
    {
      id: 'reflections',
      title: 'Reflections off the terminal',
      explanation: (
        <p>
          The terminal's big glass face acts like a mirror for the radar. Echoes that bounce off it appear as{' '}
          <Term id="ghost-target">ghost targets</Term> at the mirror image of real aircraft, behind the building.
        </p>
      ),
      watch: 'nameless targets in the car park, moving like mirror images.',
      checked: env.reflections,
      onChange: (v) => s.setEnv('reflections', v),
    },
    {
      id: 'mlat',
      title: 'An MLAT receiver fails',
      explanation: (
        <p>
          Receiver {FAILING_RECEIVER} at the south-west corner stops working. Around the west end fewer than three receivers
          can hear each transponder, so MLAT gives no position there. SMR and ADS-B keep the tracks going.
        </p>
      ),
      watch: 'the hatched "No MLAT here" area and the missing M in labels.',
      checked: env.mlatFailure,
      onChange: (v) => s.setEnv('mlatFailure', v),
    },
    {
      id: 'cp',
      title: 'The fix for rain: circular polarisation',
      explanation: (
        <p>
          Raindrops are nearly round, and round drops send circularly polarised waves back with the opposite twist. An
          antenna set to <Term id="circular-polarisation">circular polarisation</Term> rejects much of the rain echo, at a
          small cost to the targets.
        </p>
      ),
      checked: env.circularPol,
      onChange: (v) => s.setEnv('circularPol', v),
    },
  ]

  return (
    <ModuleLayout
      moduleId="surface"
      nextId="vhf"
      idea={{
        analogy: (
          <p>
            Think of a live traffic map of a small town's roads, where every car, bus and delivery van shows up, even at
            night and in fog. Now add traffic lights at every junction with the main road, and an alarm that sounds the
            moment someone drives through a red light while a truck is coming.
          </p>
        ),
        what: (
          <>
            <p>
              At an airport the "main road" is the runway. A <Term id="smr">surface movement radar</Term> sees the shape of
              everything on the ground. <Term id="multilateration">Multilateration</Term> and <Term id="ads-b">ADS-B</Term>{' '}
              add each aircraft's name. Combined, they give the controller a live map that works in any weather.
            </p>
            <p>
              The system also guards the runway: if anyone crosses a red <Term id="stop-bar">stop bar</Term> onto it while
              an aircraft is landing, it raises an alert. This whole package is called <Term id="a-smgcs">A-SMGCS</Term>.
            </p>
          </>
        ),
        where: (
          <ul>
            <li>At large and busy airports, and at any airport that operates in fog.</li>
            <li>In the control tower, next to the view out of the window.</li>
            <li>
              Together with <Link to="/modules/mlat" className="font-medium text-primary underline underline-offset-2">multilateration</Link>{' '}
              and <Link to="/modules/psr" className="font-medium text-primary underline underline-offset-2">primary radar</Link>, which it builds on.
            </li>
          </ul>
        ),
      }}
      simulator={<SurfaceSimulator />}
      howItWorks={steps}
      tryThis={experiments}
      failures={failures}
      goDeeper={<Deeper />}
      quiz={quiz}
    />
  )
}

export default function SurfaceModule() {
  return (
    <SurfaceProvider>
      <SurfacePage />
    </SurfaceProvider>
  )
}
