import { useMemo } from 'react'
import { Link } from 'react-router'
import { ModuleLayout } from '@/components/module/ModuleLayout'
import type { FailureItem } from '@/components/module/FailureList'
import type { Experiment } from '@/components/module/TryThis'
import type { QuizQuestion } from '@/components/module/Quiz'
import type { Step } from '@/components/module/Stepper'
import { Term } from '@/components/Term'
import { averageChallenge, RCP } from '@/core/cpdlc'
import { mulberry32 } from '@/core/random'
import Deeper from './deeper.mdx'
import { EXTRA_DELAY_S, NEXT_CENTRE } from './engine'
import { CpdlcSimulator } from './Simulator'
import { CpdlcProvider, useCpdlc, useCpdlcState } from './state'
import { AddressVisual, HandoverVisual, LogonVisual, MessageVisual, PathVisual, ReplyVisual, TimerVisual } from './visuals'

const steps: Step[] = [
  {
    title: 'Log on first',
    body: (
      <>
        <p>
          Before any message can flow, the aircraft introduces itself with a <Term id="logon">logon</Term>: its flight number, its registration and its{' '}
          <Term id="icao-address">aircraft address</Term>.
        </p>
        <p>
          The centre checks these against the flight plan, then opens a connection. That centre is now the <Term id="current-data-authority">current data authority</Term>: the only one allowed to send the aircraft instructions.
        </p>
      </>
    ),
    visual: <LogonVisual />,
  },
  {
    title: 'Standard messages, not chat',
    body: (
      <p>
        <Term id="cpdlc">CPDLC</Term> uses a fixed list of <Term id="message-element">message elements</Term>, each with a number: UM20 is “CLIMB TO [level]”,
        UM117 is “CONTACT [unit] [frequency]”. The controller picks one, fills in the level, and sends it. The pilot reads exactly the same words.
      </p>
    ),
    visual: <MessageVisual />,
  },
  {
    title: 'Every clearance needs an answer',
    body: (
      <>
        <p>
          A clearance must be answered WILCO (will comply) or UNABLE. STANDBY means “wait, I will answer soon”, and a final answer must still follow.
        </p>
        <p>
          Every message has a number, and each reply says which message it answers. So the controller always knows which clearance a WILCO belongs to.
        </p>
      </>
    ),
    visual: <ReplyVisual />,
  },
  {
    title: 'The message takes a path',
    body: (
      <p>
        The text travels over a <Term id="data-link">data link</Term>: a <Term id="vhf">VHF</Term> data link within radio range, a{' '}
        <Link to="/modules/satcom" className="font-medium text-primary underline underline-offset-2">
          satellite
        </Link>{' '}
        over the oceans, or <Term id="hf-data-link">HF data link</Term> almost anywhere. Each one adds its own delay: a few seconds, tens of seconds, or longer.
      </p>
    ),
    visual: <PathVisual />,
  },
  {
    title: 'Addressed to one aircraft only',
    body: (
      <p>
        Every uplink carries the address of the aircraft it is for. Other aircraft may hear the radio signal, but their equipment ignores anything not addressed to
        them. On voice, a pilot with a similar callsign can take someone else’s clearance; by data link that cannot happen.
      </p>
    ),
    visual: <AddressVisual />,
  },
  {
    title: 'Handing over to the next centre',
    body: (
      <p>
        Before the boundary the current centre names the <Term id="next-data-authority">next data authority</Term>. The next centre connects in the background.
        Then “CONTACT … END SERVICE” hands the connection over: at any moment, only one centre is in charge.
      </p>
    ),
    visual: <HandoverVisual />,
  },
  {
    title: 'When data link is not enough',
    body: (
      <p>
        The controller’s screen times every open message. Under <Term id="rcp">RCP 240</Term> the whole exchange must be complete within 240 seconds. If an answer
        is too late, or the connection is lost, the controller simply picks up the radio.
      </p>
    ),
    visual: <TimerVisual />,
  },
]

const quiz: QuizQuestion[] = [
  {
    question: 'The pilot answers a CPDLC clearance with STANDBY. What does the controller now know?',
    options: ['The pilot has accepted the clearance', 'The pilot has refused it', 'A final answer, WILCO or UNABLE, will follow', 'The message was lost'],
    answer: 2,
    explanation:
      'STANDBY means “I have it, give me a moment.” The clearance is not accepted yet, so the controller keeps waiting (the timer keeps running) for WILCO or UNABLE.',
  },
  {
    question: 'The pilot replies UNABLE to “CLIMB TO FL390”. What is true?',
    options: [
      'The aircraft climbs anyway, a little later',
      'The clearance is not in force; the controller must plan something else',
      'The controller must send the same message again',
      'The data link connection is closed',
    ],
    answer: 1,
    explanation:
      'UNABLE is a firm no. The aircraft keeps its level, and the controller finds another solution: a different level, a different route, or a quick word on voice.',
  },
  {
    question: 'Two aircraft, CNS123 and CNS132, are close together. Why can CNS132 not act on a CPDLC clearance meant for CNS123?',
    options: [
      'Because the message is sent only in the morning',
      'Because every uplink carries CNS123’s aircraft address, over the connection opened at CNS123’s logon',
      'Because CNS132 flies higher',
      'It can: CPDLC has the same risk as voice',
    ],
    answer: 1,
    explanation:
      'The logon was checked against CNS123’s flight plan, and each message is addressed to CNS123’s own address. CNS132’s equipment ignores it. (The controller still has to pick the right aircraft from the list.)',
  },
  {
    question: 'An aircraft is about to fly into the next oceanic centre’s airspace. In what order does the data link hand-over happen?',
    options: [
      'END SERVICE first, then the crew calls the next centre',
      'NEXT DATA AUTHORITY, the next centre connects in the background, then END SERVICE makes it current',
      'Both centres send clearances at the same time for a while',
      'Nothing: one centre controls the whole ocean',
    ],
    answer: 1,
    explanation:
      'The current centre names the next one (NEXT DATA AUTHORITY). The next centre connects, but its connection stays inactive. CONTACT with END SERVICE then swaps them, so there is never a gap and never two centres in charge.',
  },
  {
    question: 'The data link fails while a clearance is still waiting for WILCO. What should the controller do?',
    options: ['Wait: it will arrive eventually', 'Send it again by data link', 'Give the clearance by voice (HF, VHF or satellite voice)', 'Nothing, the pilot will guess'],
    answer: 2,
    explanation:
      'A lost connection means the message may never arrive. The controller falls back to voice at once, and when the data link returns the crew logs on again.',
  },
]

function ChallengeNotice() {
  const a5 = useMemo(() => averageChallenge(5, 200, mulberry32, 'vhf'), [])
  const a10 = useMemo(() => averageChallenge(10, 200, mulberry32, 'vhf'), [])
  return (
    <p>
      With 5 aircraft the two finish at about the same time (on average {Math.round(a5.voiceTotalS)} s by voice, {Math.round(a5.cpdlcTotalS)} s by CPDLC). Yet
      one CPDLC exchange takes about {Math.round(a5.cpdlcOneS)} s against about {Math.round(a5.voiceOneS)} s on voice: CPDLC wins by running the exchanges side by
      side, not by being quick. With 10 aircraft CPDLC is clearly ahead ({Math.round(a10.cpdlcTotalS)} s against {Math.round(a10.voiceTotalS)} s). On voice about{' '}
      {Math.round((a10.voiceMisheardPerRun / 10) * 100)} clearances in 100 are misheard and nobody notices; by CPDLC none are. In a single run you may be lucky:
      compare the average row.
    </p>
  )
}

function CpdlcPage() {
  const { engine, store, clock } = useCpdlc()
  const env = useCpdlcState((s) => s.env)
  const s = store.getState()
  const go = (speed: number) => {
    clock.getState().setSpeed(speed)
    clock.getState().play()
  }
  const fresh = (path: 'vhf' | 'satcom' = 'vhf') => {
    s.resetAll()
    if (engine.standard !== 'fans') s.setStandard('fans')
    s.setPath(path)
    engine.quickConnect()
    s.touch()
  }

  const experiments: Experiment[] = [
    {
      id: 'voice',
      question: 'Is data link faster than voice?',
      action: <p>Deliver 5 clearances by voice and by CPDLC at the same time, and compare. Then try 10 aircraft.</p>,
      setup: () => {
        s.resetAll()
        s.setPath('vhf')
        s.setChallengeN(5)
        engine.startChallenge(5)
        s.touch()
        go(4)
      },
      setupLabel: 'Run the challenge for me',
      notice: <ChallengeNotice />,
    },
    {
      id: 'unable',
      question: 'What happens when the pilot says UNABLE?',
      action: <p>A “CLIMB TO FL390” is on its way to CNS123. As the pilot, answer UNABLE. Then look at the controller’s screen.</p>,
      setup: () => {
        fresh()
        engine.sendUplink('CNS123', [{ id: 'UM20', values: { level: 390 } }])
        s.touch()
        go(1)
      },
      notice: (
        <p>
          The controller gets an alert: the clearance is not in force and CNS123 stays at FL350. The controller must plan something else: here the screen offers
          FL380 instead, or a word on voice. The pilot could also send a REQUEST for the level they can accept.
        </p>
      ),
    },
    {
      id: 'lost',
      question: 'What if the data link fails during a clearance?',
      action: <p>A “CLIMB TO FL370” is travelling by satellite. While its blue dot is still on the path, switch on “Lost connection”.</p>,
      setup: () => {
        fresh('satcom')
        engine.sendUplink('CNS123', [{ id: 'UM20', values: { level: 370 } }])
        s.touch()
        go(1)
      },
      notice: (
        <p>
          The message is lost on the way and never reaches the cockpit. The controller gets an alert and the open clearance turns to “use voice”: press “Give it by
          voice” and the aircraft climbs. The cockpit shows DATA LINK LOST; once the link is back the crew has to log on again from the start.
        </p>
      ),
    },
    {
      id: 'handover',
      question: 'How does the aircraft move to the next centre?',
      action: (
        <p>
          Send UM160 NEXT DATA AUTHORITY. Watch XHBR connect in the hand-over steps. Then send “UM117 CONTACT + UM161 END SERVICE” and answer WILCO in the cockpit.
        </p>
      ),
      setup: () => {
        fresh()
        go(2)
      },
      notice: (
        <p>
          After NEXT DATA AUTHORITY the cockpit shows NEXT ATC XHBR, and XHBR connects in the background (READY). When you answer WILCO to the END SERVICE message, the
          cockpit switches to ACT ATC XHBR and XLAB can no longer send to CNS123. Try it without NEXT DATA AUTHORITY: the aircraft is left with no connection and
          the crew must log on to XHBR by hand.
        </p>
      ),
    },
    {
      id: 'late',
      question: 'How long can the controller wait for an answer?',
      action: <p>With “Message delay” on, a clearance is on its way. Answer WILCO as soon as it appears, and watch the controller’s timer.</p>,
      setup: () => {
        fresh()
        s.setEnv('delay', true)
        engine.sendUplink('CNS123', [{ id: 'UM20', values: { level: 370 } }])
        s.touch()
        go(8)
      },
      notice: (
        <p>
          The message needs about {EXTRA_DELAY_S} s just to arrive, and the WILCO as long again. At {RCP[240].tt95S} s the timer turns amber (slower than 95 % of
          exchanges should be); at {RCP[240].expirationS} s it turns red and the controller is told to use voice, before the WILCO even gets back.
        </p>
      ),
    },
  ]

  const failures: FailureItem[] = [
    {
      id: 'delay',
      title: 'Message delay',
      explanation: (
        <p>
          A congested network makes every message take minutes instead of seconds. The controller’s timer shows how long each clearance has been waiting; past{' '}
          {RCP[240].expirationS} s the controller must stop waiting and use voice.
        </p>
      ),
      watch: 'the timer bar under “Waiting for an answer” turning amber, then red.',
      checked: env.delay,
      onChange: (v) => s.setEnv('delay', v),
    },
    {
      id: 'lost',
      title: 'Lost connection',
      explanation: (
        <p>
          The data link fails. Messages on their way are lost, the connection is gone on both sides, and anything still open must be handled by voice. When the
          link returns, the crew has to log on again.
        </p>
      ),
      watch: 'DATA LINK LOST on the cockpit display and a red alert on the controller’s screen.',
      checked: env.lost,
      onChange: (v) => s.setEnv('lost', v),
    },
    {
      id: 'wrong',
      title: 'A message for the wrong aircraft',
      explanation: (
        <p>
          The crew of CNS132 types CNS123 by mistake and logs on. The centre compares the logon with CNS123’s flight plan: the aircraft address and registration do
          not match, so it is rejected. And when CNS123’s clearances go out, CNS132 hears the radio signal but ignores it: it is not addressed to 8A1C32. What
          CPDLC cannot stop is a controller choosing the wrong aircraft from the list, so both still check.
        </p>
      ),
      watch: 'a “Logon rejected” alert, and the NEARBY CNS132 panel under the cockpit display.',
      checked: env.wrongAircraft,
      onChange: (v) => s.setEnv('wrongAircraft', v),
    },
  ]

  return (
    <ModuleLayout
      moduleId="cpdlc"
      nextId="satcom"
      idea={{
        analogy: (
          <p>
            Voice radio is like a <strong>busy phone call</strong> on a party line: everyone waits their turn, and a word can be misheard. CPDLC is like a{' '}
            <strong>text message</strong> with standard phrases and a read receipt: it takes a moment to arrive, but it says exactly what was meant, and only the
            right person gets it.
          </p>
        ),
        what: (
          <>
            <p>
              <Term id="cpdlc">Controller–pilot data link communications</Term> lets controllers and pilots exchange standard text messages instead of speaking.
              The controller sends a clearance such as CLIMB TO FL370; the pilot reads it on a screen and answers WILCO, UNABLE or STANDBY.
            </p>
            <p>
              It avoids misheard instructions and keeps crowded frequencies free. Voice stays available for anything urgent, and as the backup when the data link
              fails.
            </p>
          </>
        ),
        where: (
          <ul>
            <li>
              Over the oceans and remote areas, where it replaces long, crackly <Term id="hf">HF</Term> radio calls (<Term id="fans-1a">FANS 1/A</Term>, often by{' '}
              <Link to="/modules/satcom" className="font-medium text-primary underline underline-offset-2">
                satellite
              </Link>
              ).
            </li>
            <li>
              In busy European airspace above FL285 (<Term id="atn-b1">ATN Baseline 1</Term>) for routine messages such as frequency changes.
            </li>
            <li>At some airports, where departure clearances are also sent by data link before start-up.</li>
          </ul>
        ),
      }}
      simulator={<CpdlcSimulator />}
      howItWorks={steps}
      tryThis={experiments}
      failures={failures}
      failuresNote={
        <p>
          The next centre in this scenario is {NEXT_CENTRE.id} ({NEXT_CENTRE.name}), on {NEXT_CENTRE.frequency}. Both centres and all callsigns are fictional.
        </p>
      }
      goDeeper={<Deeper />}
      quiz={quiz}
    />
  )
}

export default function CpdlcModule() {
  return (
    <CpdlcProvider>
      <CpdlcPage />
    </CpdlcProvider>
  )
}
