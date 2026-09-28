# CNS Lab: Development Guide for an Air Traffic Management Simulation Platform

**Purpose:** Plan and prompt pack for building "CNS Lab", an interactive web laboratory that teaches general learners how the equipment behind Air Traffic Management (ATM) works.
**Build tool:** Claude Code
**Audience of the platform:** General learners (no aviation or engineering background)
**Status:** Planning complete, ready for Phase 0

> **Disclaimer:** CNS Lab is for educational use only and must not be used for operational purposes. Technical content should be reviewed by a qualified CNS/ATSEP engineer against ICAO Annex 10 before publication.

---

## Table of contents

1. [How to use this guide with Claude Code](#1-how-to-use-this-guide-with-claude-code)
2. [Product vision](#2-product-vision)
3. [The CNS framework](#3-the-cns-framework)
4. [Architecture and project structure](#4-architecture-and-project-structure)
5. [Development phases](#5-development-phases)
6. [CLAUDE.md project memory file](#6-claudemd-project-memory-file)
7. [Master prompt (Phase 0)](#7-master-prompt-phase-0)
8. [Module prompt wrapper](#8-module-prompt-wrapper)
9. [Navigation modules](#9-navigation-modules)
10. [Surveillance modules](#10-surveillance-modules)
11. [Communication modules](#11-communication-modules)
12. [Integration: Airspace Sandbox](#12-integration-airspace-sandbox)
13. [Home page prompt](#13-home-page-prompt)
14. [Final polish prompt (Phase 6)](#14-final-polish-prompt-phase-6)
15. [Technical accuracy review checklist](#15-technical-accuracy-review-checklist)

---

## 1. How to use this guide with Claude Code

1. Create a project folder, for example `atm_simulation/cns-lab/`.
2. Put this file in the project at `docs/ATM_Simulation_Development_Guide.md`.
3. Create a `CLAUDE.md` file in the project root using the content in [Section 6](#6-claudemd-project-memory-file). Claude Code reads it as standing project context.
4. Start Claude Code in the project folder and send the **Master prompt** from [Section 7](#7-master-prompt-phase-0). Review and run the result before moving on.
5. Build one module per session. Send the **Module prompt wrapper** from [Section 8](#8-module-prompt-wrapper) with the module-specific section for that module pasted in.
6. After each module: run the app, test every toggle and "Try this" experiment, run the unit tests, and commit to git.
7. Finish with the Airspace Sandbox, the home page, and the polish phase.

**Tip:** You can also tell Claude Code, "Read docs/ATM_Simulation_Development_Guide.md and build the [module name] module from Section 9", instead of pasting the prompt.

---

## 2. Product vision

CNS Lab is an interactive laboratory in which every piece of ATM equipment can be explored hands-on. Learners change parameters, drag aircraft, and switch failures on and off, and they immediately see the physical principle respond: signals, timing, geometry, and cockpit instruments.

**Style:** interactive explorable explainers. Learners click on a system's components to learn about them and move sliders to watch live visual feedback.

**Teaching principles for general learners:**

- Every module opens with an everyday analogy before any technical term.
- Plain language and short sentences. Each technical term is explained the first time it appears, and hovering over a jargon word shows its definition.
- Learning by doing: every concept is tied to something the learner can move or switch.
- Formulas and exact specifications live in a collapsible "Go deeper" panel, never in the main flow.

---

## 3. The CNS framework

ICAO and air navigation service providers organize ATM equipment into three pillars. The platform follows the same structure.

| Pillar | Question it answers | Systems in CNS Lab |
|---|---|---|
| **Communication** | How do pilots and controllers talk? | VHF/UHF radio, HF radio, CPDLC (datalink), SATCOM |
| **Navigation** | How does the aircraft know where it is and where to go? | NDB/ADF, CVOR/DVOR, DME, ILS, GNSS with SBAS and GBAS |
| **Surveillance** | How does the controller see where aircraft are? | Primary radar (PSR), Secondary radar (SSR/Mode S), ADS-B/ADS-C, MLAT/WAM, Surface Movement Radar and A-SMGCS |
| **Integration** | How does everything work together? | Airspace Sandbox (data fusion, controller display, safety nets) |

---

## 4. Architecture and project structure

### Technology stack

| Layer | Choice | Used for |
|---|---|---|
| Framework | React + TypeScript + Vite | App structure and pages |
| Styling | Tailwind CSS | Design system and layout |
| 3D | three.js via react-three-fiber | Antenna arrays, 3D approach views, satellite orbits |
| 2D rendering | HTML Canvas and SVG | Radar scopes, oscilloscopes, diagrams |
| Audio | Web Audio API | Morse idents, radio audio, marker tones |
| State | Zustand | Simulation and UI state |
| Content | MDX | Explanations, analogies, quizzes |
| Routing | React Router | Home page and module pages |
| Testing | Vitest | Unit tests for simulation logic |

No backend in version 1. Quiz progress can be stored in browser localStorage.

### Project structure

```
cns-lab/
├── CLAUDE.md
├── docs/
│   └── ATM_Simulation_Development_Guide.md
├── src/
│   ├── core/                 # Pure TypeScript simulation logic (unit tested)
│   │   ├── world.ts          # Airport, terrain, aircraft model
│   │   ├── propagation.ts    # Line-of-sight, path loss, slant range, timing
│   │   ├── geometry.ts       # Bearings, distances, coordinate conversions
│   │   └── clock.ts          # Simulation clock (play, pause, speed)
│   ├── instruments/          # Reusable instrument components
│   │   ├── CDI.tsx           # CDI/HSI with OBS knob and TO/FROM flag
│   │   ├── ADF.tsx           # ADF and RMI needle
│   │   ├── DMEReadout.tsx
│   │   ├── RadarScope.tsx    # PPI scope with sweep and fading trails
│   │   ├── Oscilloscope.tsx  # Dual-trace
│   │   └── Spectrum.tsx
│   ├── components/           # UI: ModuleLayout, ControlsPanel, Tooltip, Quiz, TryThis, GoDeeper
│   ├── modules/              # One folder per module
│   │   ├── ndb/
│   │   ├── dvor/
│   │   ├── dme/
│   │   └── ...
│   ├── content/              # MDX text, glossary, quiz data
│   └── pages/                # Home, Glossary, Frequency chart, Sandbox
└── tests/
```

### Standard module layout

Every module follows the same seven sections:

1. **The simple idea:** analogy, what the system does, where it is used, and a small CNS map highlighting its pillar.
2. **Simulator:** large interactive view, controls panel, and live readouts.
3. **How it works:** step-by-step animated explanation with Next and Back buttons.
4. **Try this:** 3 to 5 guided experiments, each with a question, an action, and a revealed "What you should notice."
5. **When things go wrong:** error and failure toggles inside the simulator, each with a plain explanation.
6. **Go deeper (collapsed):** frequencies, formulas, specifications.
7. **Quick quiz:** 5 multiple-choice questions with friendly explanations.

---

## 5. Development phases

| Phase | Scope | Done when |
|---|---|---|
| **0. Foundation** | Scaffold, design system, simulation core, instrument library, module layout, placeholder home page | Instrument demo page works and core tests pass |
| **1. Flagship modules** | Primary radar, SSR/Mode S, ADS-B/ADS-C | Three modules complete and the look is approved |
| **2. Navigation** | NDB/ADF, CVOR/DVOR, DME, ILS | Four modules complete |
| **3. Satellite navigation** | GNSS with SBAS and GBAS | Module complete |
| **4. Communication** | VHF/UHF, HF, CPDLC, SATCOM | Four modules complete |
| **5. Advanced surveillance** | MLAT/WAM, Surface Movement Radar and A-SMGCS | Two modules complete |
| **6. Integration** | Airspace Sandbox and final home page | Every system appears in the sandbox |
| **7. Polish and review** | Accessibility, mobile layout, performance, expert technical review, deployment | Review checklist signed off and site deployed |

The flagship modules come first because they are the most visual and flow into each other (radar → secondary radar → ADS-B). Once they look right, every later module matches them.

---

## 6. CLAUDE.md project memory file

Save the following as `CLAUDE.md` in the project root.

```markdown
# CNS Lab

Educational web platform that teaches general learners how Air Traffic
Management CNS equipment works (Communication, Navigation, Surveillance).
Full plan: docs/ATM_Simulation_Development_Guide.md

## Stack
React + TypeScript + Vite, Tailwind, react-three-fiber, Canvas/SVG,
Web Audio, Zustand, MDX, React Router, Vitest.

## Rules
- Simulation logic lives in src/core as pure TypeScript functions, separate
  from rendering, and every function has unit tests.
- Every module uses the standard 7-section ModuleLayout.
- Reuse instruments from src/instruments; do not create duplicates.
- Plain language for general learners. Analogy first. Jargon gets tooltips.
  Formulas only inside "Go deeper".
- Technical values must match ICAO Annex 10. Never invent a specification.
  If unsure, add a `// TODO(expert-review):` comment.
- When a simulation slows down or simplifies reality, show a label on
  screen, for example "Slowed down so you can see it."
- Every page footer: "For educational use only, not for operational use."

## Design tokens
Background #0B1220, panels #121A2B, accent #4ADE80, warning #F59E0B,
alert #EF4444, text #E5E7EB. Sans-serif UI font, monospace for readouts.

## Commands
npm run dev | npm run test | npm run build
```

---

## 7. Master prompt (Phase 0)

Send this first, in a new Claude Code session.

```
ROLE
You are a senior front-end engineer and educational simulation designer.
Read CLAUDE.md and docs/ATM_Simulation_Development_Guide.md first.

TASK
Build Phase 0 (Foundation) of "CNS Lab", an interactive laboratory that
teaches general learners (no aviation or engineering background) how the
equipment behind air traffic management works, organized into
Communication, Navigation, and Surveillance (CNS).

TECH STACK
React + TypeScript + Vite, Tailwind CSS, react-three-fiber, HTML Canvas and
SVG, Web Audio API, Zustand, MDX, React Router, Vitest. No backend.

BUILD NOW
1. Project scaffold with the folder structure from Section 4 of the guide.
2. Design system: the design tokens in CLAUDE.md, typography, buttons,
   sliders, toggles, panels, and a Tooltip component for jargon words.
3. Simulation core in src/core (pure TypeScript, unit tested):
   - world.ts: an airport at the origin, a simple terrain height map, and an
     aircraft model (lat/lon, altitude, heading, speed) that can be dragged
     or flown with heading, speed, and altitude controls.
   - propagation.ts: radio line-of-sight range in NM,
     1.23 * (sqrt(h_tx_ft) + sqrt(h_rx_ft)); terrain blocking; free-space
     path loss; slant range; signal travel time at the speed of light.
   - geometry.ts: bearing and distance between points, magnetic vs true
     bearing (a configurable variation), and coordinate conversion.
   - clock.ts: simulation clock with play, pause, and speed 0.25x to 4x,
     plus a "slow motion" factor for visualizing radio signals.
4. Instrument library in src/instruments: CDI/HSI with OBS knob and TO/FROM
   flag, ADF and RMI needle, DME readout, radar PPI scope with rotating
   sweep and fading trails, dual-trace oscilloscope, spectrum view.
5. A demo page at /instruments showing every instrument with test controls.
6. The ModuleLayout component with the 7 standard sections: The simple
   idea, Simulator, How it works (stepper), Try this, When things go wrong,
   Go deeper (collapsed), Quick quiz. Include a top bar with "CNS Lab", the
   module name, a pillar tag, and a Home link, and the footer disclaimer.
7. A placeholder home page listing the planned modules grouped by pillar.
8. A glossary page driven by a JSON file, reused by the Tooltip component.

QUALITY
- 60 fps canvas rendering. Responsive from desktop down to tablet.
- Keyboard accessible, labeled controls, colorblind-safe color choices
  (never use color alone to carry meaning).
- Run the tests and the dev server, fix any errors, and summarize what you
  built and how to run it.
```

---

## 8. Module prompt wrapper

For each module, start a new Claude Code session (or continue the current one) and send this, with the module-specific section pasted in place of the bracketed text.

```
Read CLAUDE.md. Using the existing CNS Lab project, simulation core,
instrument library, and ModuleLayout, build the module: [MODULE NAME].

[PASTE THE MODULE-SPECIFIC SECTION HERE]

REQUIREMENTS
- Place the module in src/modules/[module-folder] and add its route and
  home page entry.
- Follow the 7-section ModuleLayout. The main flow uses plain language for
  general learners; formulas and specifications go only in "Go deeper".
- Put the signal and geometry logic in pure functions with Vitest unit
  tests. Reuse existing instruments and core functions.
- Add any new jargon words to the glossary JSON.
- Write 5 quiz questions with friendly explanations.
- Mark any technical value you are not sure about with
  // TODO(expert-review).
- Match the look of the existing modules.
- Run the tests and the dev server, fix errors, and summarize what you
  built.
```

---

## 9. Navigation modules

### 9.1 NDB (Non-Directional Beacon) and ADF

**Folder:** `src/modules/ndb` · **Pillar:** Navigation · **Phase:** 2

```
LEARNING GOAL
An NDB is a simple radio transmitter that sends the same signal in all
directions. The aircraft's ADF instrument finds the direction the signal
comes from, and its needle points at the station.

ANALOGY
Like turning your head toward a sound in the dark: you can't see the
lighthouse, but you can tell which direction the foghorn comes from.

SIMULATOR
- Top-down map with an NDB station. The aircraft can be dragged or flown
  with heading and speed controls.
- An ADF gauge whose needle always points to the station. Show relative
  bearing (the angle measured from the aircraft's nose) and, on an RMI,
  magnetic bearing.
- A readout of the formula "Magnetic bearing = heading + relative
  bearing" that updates live.
- Expanding radio waves drawn from the station. Play the Morse ident audio.

WHEN THINGS GO WRONG (toggles)
Night effect (the needle wanders because of signals reflected from the
sky), thunderstorm (the needle swings toward lightning), coastal
refraction (the signal bends when crossing a coastline), and mountain
reflection.

TRY THIS
1. Fly in a circle around the station and watch the needle.
2. Point the needle at the nose, then fly straight to the station.
3. Turn on a thunderstorm nearby and see what the needle does.
4. Switch between day and night.

GO DEEPER
Frequency band 190–1750 kHz (mostly 190–535 kHz), LF/MF ground wave. Loop
antenna plus sense antenna. Explain why NDBs are being phased out in favor
of GNSS.
```

### 9.2 CVOR and DVOR (Conventional and Doppler VOR)

**Folder:** `src/modules/dvor` · **Pillar:** Navigation · **Phase:** 2

```
LEARNING GOAL
The station sends two signals, like two clocks ticking. How far apart they
tick (their phase difference) tells the aircraft which direction it is
from the station, called its "radial". In a DVOR, one of those signals is
created by a ring of antennas that are switched on one after another, so
the signal seems to spin and its frequency shifts slightly (the Doppler
effect).

ANALOGY
Like a lighthouse that flashes once in all directions when its beam points
north: count the time from the flash until the rotating beam reaches you,
and you know your direction.

SIMULATOR
- A top-down and 3D view of the station: the central carrier antenna and a
  ring of about 48 sideband antennas. Animate the switching sequence
  (simulated rotation at 30 revolutions per second), slowed down, with the
  label "Slowed down so you can see it."
- Drag the aircraft around the station. Show a live dual oscilloscope
  (REF 30 Hz and VAR 30 Hz), the phase-difference readout, and the
  resulting radial.
- A CDI with an OBS knob and TO/FROM flag. Show the cone of confusion above
  the station.
- Play the Morse ident through Web Audio. Show the frequency band
  (108.00–117.95 MHz).
- A CVOR comparison toggle showing which signal is AM and which is FM in
  each system, with a plain explanation of why a DVOR is less affected by
  reflections from nearby buildings and terrain.

WHEN THINGS GO WRONG (toggles)
Reflections from nearby buildings (the course becomes wavy, "scalloping";
compare CVOR and DVOR), station alarm and automatic shutdown, ident
removed during maintenance, and flying through the cone of confusion.

TRY THIS
1. Fly a full circle around the station and watch the phase difference
   move through 0 to 360 degrees.
2. Set the OBS to 090 and fly TO and FROM the station.
3. Add a building close to the station and compare the error in CVOR and
   DVOR modes.
4. Climb over the station and watch the cone of confusion.

GO DEEPER
CVOR: the reference signal is 30 Hz FM on a 9960 Hz subcarrier, and the
variable signal is 30 Hz AM from a rotating pattern. DVOR: the roles are
reversed. The reference is 30 Hz AM from the carrier, and the variable
signal is 30 Hz FM produced by Doppler shift from the commutated sideband
ring (about 13.5 m diameter). Explain why the larger aperture reduces site
error. Monitoring and integrity. VOR/DME pairing.
```

### 9.3 DME (Distance Measuring Equipment)

**Folder:** `src/modules/dme` · **Pillar:** Navigation · **Phase:** 2

```
LEARNING GOAL
The aircraft asks "how far?" by sending a radio pulse. The ground station
waits exactly 50 microseconds and replies. The aircraft converts the total
round-trip time into distance.

ANALOGY
Shouting at a cliff and timing the echo, except the cliff politely waits
a fixed moment before shouting back.

SIMULATOR
- Side view (altitude) and top view. Show pulse pairs travelling from the
  aircraft to the station and back, slowed down with an on-screen label.
- A timeline bar split into outbound time, the 50 µs station delay, and
  return time. The DME readout shows distance in NM.
- An altitude slider showing slant range (the true diagonal distance) vs
  ground distance. Directly over the station at 6,000 ft, the DME shows
  about 1 NM.
- Groundspeed readout, with a note that it is only correct when flying
  straight toward or away from the station.

WHEN THINGS GO WRONG (toggles)
Station overload (too many aircraft asking at once, which leaves the
station unable to answer everyone), out of line-of-sight range, and
confusing another aircraft's replies with your own (show how each aircraft
spaces its pulses randomly, "jitter", so it can recognize its own replies).

TRY THIS
1. Fly directly over the station at high altitude and watch the DME
   reading stop at a minimum instead of reaching zero.
2. Fly a circle around the station and watch groundspeed read nearly zero
   even though you are moving.
3. Add 150 aircraft and watch the station saturate.

GO DEEPER
UHF band 962–1213 MHz. X and Y channels (reply delay 50 µs and 56 µs).
Distance = (round-trip time − delay) × c / 2. One nautical mile takes about
12.36 µs round trip. DME is frequency-paired with VOR and ILS channels.
```

### 9.4 ILS (Instrument Landing System)

**Folder:** `src/modules/ils` · **Pillar:** Navigation · **Phase:** 2

```
LEARNING GOAL
ILS guides an aircraft down to the runway in bad weather using two radio
beams. The localizer shows left or right of the centerline. The glideslope
shows above or below the correct descent path. Each beam is made of two
overlapping signals, and the aircraft compares their strength.

ANALOGY
Like walking down a hallway with a different song playing in each ear:
when both songs are equally loud, you are exactly in the middle.

SIMULATOR
- A 3D approach view, plus a top view (localizer) and a side view
  (glideslope). Show the two lobes in two colors (90 Hz and 150 Hz) and
  label them so color is not the only cue.
- The learner flies the aircraft with sliders or arrow keys. The pilot's
  ILS display (two needles on a CDI) moves live, with a "difference in
  strength" meter under each needle.
- A roughly 3° glideslope. Marker beacons with lights and tones (outer
  400 Hz, middle 1300 Hz, inner 3000 Hz).
- A category selector (CAT I, II, III) showing how low the aircraft may
  descend before the runway must be visible, with fog density adjusted to
  match.

WHEN THINGS GO WRONG (toggles)
A vehicle or aircraft parked in the ILS critical area (the beam bends and
the needles lie), false glideslopes above the real one, flying outside the
coverage area, and localizer shutdown when the monitor detects an error.

TRY THIS
1. Fly left of the centerline and watch which signal becomes stronger.
2. Park a truck in the critical area and try to land.
3. Climb steeply and find the false glideslope.
4. Land in CAT I fog, then CAT III fog.

GO DEEPER
Localizer 108.10–111.95 MHz (odd tenths only), glideslope 329.15–335 MHz,
paired with the localizer. DDM (difference in depth of modulation). Markers
at 75 MHz. Typical minimums: CAT I 200 ft decision height, CAT II 100 ft,
CAT III lower. Monitoring and integrity.
```

### 9.5 GNSS (GPS) with SBAS and GBAS

**Folder:** `src/modules/gnss` · **Pillar:** Navigation · **Phase:** 3

```
LEARNING GOAL
Each satellite broadcasts "this is my position and this is the exact
time." The receiver measures how long each signal took to arrive and works
out its own position. Four satellites are needed: three for position and
one to correct the receiver's clock.

ANALOGY
If you know you are 10 km from town A, 15 km from town B, and 12 km from
town C, only one spot on the map fits all three.

SIMULATOR
- An orbit view (3D Earth with satellites that can be rotated) and a
  ground view of the receiver.
- The learner selects satellites. Range circles or spheres appear and
  intersect, and the position solution and error circle update live.
- A satellite-geometry meter (DOP): spread-out satellites give a small
  error; clustered satellites give a large error.
- An SBAS toggle: a geostationary satellite sends corrections and the
  error circle shrinks. A GBAS toggle: an airport ground station sends
  corrections for precision approaches.

WHEN THINGS GO WRONG (toggles)
A faulty satellite (show RAIM detecting it with 5 satellites and excluding
it with 6), ionospheric delay, buildings and terrain blocking satellites,
jamming (the signal disappears), and spoofing (the receiver is fooled into
a false position). Explain how aircraft cross-check against ground-based
aids.

TRY THIS
1. Use only 3 satellites and see why the answer is ambiguous.
2. Pick 4 satellites clustered together, then 4 spread out, and compare
   the error.
3. Break one satellite and watch RAIM respond.
4. Turn on jamming and see which other navigation aids still work.

GO DEEPER
GPS L1 at 1575.42 MHz. Pseudorange. GPS, Galileo, GLONASS, BeiDou. SBAS
systems (WAAS, EGNOS, and others). GBAS. Performance-Based Navigation
(RNAV and RNP).
```

---

## 10. Surveillance modules

### 10.1 Primary Surveillance Radar (PSR)

**Folder:** `src/modules/psr` · **Pillar:** Surveillance · **Phase:** 1

```
LEARNING GOAL
Primary radar sends out a pulse of radio energy and listens for the echo.
The time until the echo returns gives the distance, and the direction the
antenna is pointing gives the bearing. It works even if the aircraft
cooperates in no way at all.

ANALOGY
Like a bat using echoes, or shining a rotating flashlight into the dark
and seeing what reflects back.

SIMULATOR
- A 3D rotating antenna, and a radar scope with a rotating sweep and
  fading blips.
- Pulses travel out and echoes come back, slowed down. The readout
  calculates distance from the echo time.
- Controls for rotation speed (update rate), pulse rate (PRF), beam width,
  and transmitter power. Show how each affects range, detail, and update
  speed.
- Multiple aircraft of different sizes. A blip shows position only, with
  no identity or altitude.

WHEN THINGS GO WRONG (toggles)
Ground clutter (hills and buildings create false echoes), weather clutter
(rain appears on the scope), birds and wind farms, a small aircraft far
away disappearing, and second-trace echoes when the pulse rate is too
high. Add an MTI (moving target indication) toggle that hides stationary
echoes.

TRY THIS
1. Increase the pulse rate until distant aircraft show up at the wrong
   range.
2. Turn on rain, then MTI, and compare.
3. Fly an aircraft behind a mountain.
4. Ask: "Which aircraft is which, and how high?" Show that primary radar
   can't answer, which leads into the SSR module.

GO DEEPER
Range = c × t / 2. Maximum unambiguous range = c / (2 × PRF). Radar range
grows with the fourth root of transmitter power. Typical approach radar is
S-band (about 2.7–2.9 GHz) rotating every 4–5 s. En-route radar is L-band,
rotating every 10–12 s. Radar cross-section.
```

### 10.2 SSR (Secondary Surveillance Radar) and Mode S

**Folder:** `src/modules/ssr` · **Pillar:** Surveillance · **Phase:** 1

```
LEARNING GOAL
Secondary radar asks each aircraft a question, and a device on board (the
transponder) answers with its identity code and altitude. It needs the
aircraft to cooperate, but it tells the controller who the aircraft is and
how high it is.

ANALOGY
Primary radar is seeing someone in the dark. Secondary radar is calling
"who's there?" and having them answer with their name and floor number.

SIMULATOR
- Ground interrogator on 1030 MHz, aircraft replying on 1090 MHz. Animate
  the question pulses and answer pulses.
- The learner types a 4-digit squawk code (0000–7777, digits 0–7 only) and
  an altitude. A reply pulse train builds live, with framing pulses F1 and
  F2 and the code pulses between them.
- The radar scope shows a label with code, altitude (flight level), and
  callsign when using Mode S.
- A Mode A/C vs Mode S toggle: Mode A/C asks everyone at once; Mode S asks
  one aircraft by its unique 24-bit address.

WHEN THINGS GO WRONG (toggles)
Garbling (two aircraft close together answer at the same time and their
replies overlap), FRUIT (replies triggered by other radar stations appear
on your scope), answers from antenna side lobes (show how the P2 pulse
suppresses them), and transponder failure (the label disappears and only
a primary blip remains).

TRY THIS
1. Set special codes and see the display react: 7600 (radio failure) and
   7700 (emergency).
2. Bring two aircraft close together in Mode A/C, then switch to Mode S.
3. Switch off an aircraft's transponder.

GO DEEPER
Mode A (identity, 4096 codes, P1 to P3 spacing 8 µs) and Mode C (pressure
altitude, 21 µs spacing). F1 and F2 framing pulses 20.3 µs apart. SPI
pulse ("ident"). Mode S addresses, Elementary and Enhanced Surveillance
(downlinked aircraft parameters).
```

### 10.3 ADS-B and ADS-C

**Folder:** `src/modules/ads` · **Pillar:** Surveillance · **Phase:** 1

```
LEARNING GOAL
With ADS-B, the aircraft works out its own position using GNSS and
broadcasts it about twice per second to anyone listening, with no radar
needed. ADS-C is a private "contract": the aircraft sends position reports
to a specific ATC center at agreed times, often via satellite, over oceans.

ANALOGY
ADS-B is like posting your location on a public board every second.
ADS-C is like texting your location to one friend every 15 minutes, or
whenever something changes.

SIMULATOR
- A map with aircraft broadcasting "rings", and ground receivers with
  coverage circles. Show the message contents in a side panel (callsign,
  position, altitude, speed, position-quality indicator).
- A split-screen comparison: radar updating every 4–12 s vs ADS-B updating
  every 0.5 s. Watch how smoothly each track moves.
- An ADS-B In toggle: the pilot sees other traffic on a cockpit display.
- ADS-C mode: aircraft over an ocean sending periodic reports via a
  satellite to an oceanic center. The learner sets up a contract (periodic
  interval, or event-based such as a change of altitude).

WHEN THINGS GO WRONG (toggles)
GNSS jamming (ADS-B positions become wrong or disappear, which shows why
it depends on GNSS), a spoofed "ghost" aircraft (explain conceptually why
cross-checking with MLAT or radar matters), an aircraft without ADS-B
equipment (invisible), and low position quality.

TRY THIS
1. Compare the radar and ADS-B tracks during a turn.
2. Jam GNSS and see what radar still shows.
3. Fly across an ocean and switch from ADS-B coverage to ADS-C.

GO DEEPER
1090 MHz Extended Squitter, and UAT 978 MHz (US only). NIC and NACp
quality indicators. Space-based ADS-B (receivers carried on satellites).
ADS-C via FANS 1/A.
```

### 10.4 MLAT and WAM (Multilateration)

**Folder:** `src/modules/mlat` · **Pillar:** Surveillance · **Phase:** 5

```
LEARNING GOAL
Several ground receivers hear the same aircraft signal at slightly
different times. Comparing those time differences pinpoints the aircraft,
without relying on the aircraft's own position report.

ANALOGY
Hearing thunder at different moments in different towns tells you where
the lightning struck.

SIMULATOR
- Map with draggable ground receivers and an aircraft emitting a pulse.
- The arrival time at each receiver is shown. For each pair of receivers,
  draw the curve (hyperbola) of possible positions. Where the curves meet
  is the aircraft.
- Add or remove receivers (3 for a 2D position using the altitude report,
  4 or more for 3D) and watch the accuracy change.
- An accuracy map (heatmap): accuracy is good inside the receiver network
  and poor outside it.

WHEN THINGS GO WRONG (toggles)
A receiver failing, a timing error at one receiver, bad geometry (all
receivers in a line), and an aircraft outside the receiver network.

TRY THIS
1. Place all receivers in a straight line and watch the accuracy collapse.
2. Remove receivers one by one until the solution fails.
3. Compare the MLAT position with a spoofed ADS-B position (MLAT isn't
   fooled).

GO DEEPER
TDOA (time difference of arrival). Time synchronization between receivers.
Airport MLAT vs Wide Area Multilateration (WAM). It uses existing
transponder signals, so no new aircraft equipment is needed.
```

### 10.5 Surface Movement Radar and A-SMGCS

**Folder:** `src/modules/surface` · **Pillar:** Surveillance · **Phase:** 5

```
LEARNING GOAL
At busy airports, controllers must see aircraft and vehicles on runways
and taxiways, even in fog. A special high-detail radar, combined with
MLAT and ADS-B, builds a live map of the ground, and the system warns
when someone enters a runway they shouldn't.

ANALOGY
Like a live traffic map of an airport's roads, with an alarm when someone
runs a red light.

SIMULATOR
- A top-down airport with runways, taxiways, aircraft, and vehicles moving
  on the ground.
- A layer toggle: SMR only (shapes without labels), + MLAT, + ADS-B, and
  the fused picture (labeled tracks).
- A visibility slider from clear to thick fog: the tower window view fades
  while the display stays clear.
- Runway incursion alert: drag a vehicle onto an active runway while an
  aircraft is landing, and the alert fires.

WHEN THINGS GO WRONG (toggles)
Heavy rain reducing SMR detail, a vehicle without a transponder (seen only
by SMR), reflections off terminal buildings, and an MLAT receiver failure.

TRY THIS
1. Turn up the fog and compare the window view with the display.
2. Create a runway incursion.
3. Remove the SMR layer and find what disappears.

GO DEEPER
SMR in X-band (about 9 GHz), fast rotation, high resolution. A-SMGCS
levels (surveillance, alerting, routing, guidance). Stop bars.
```

---

## 11. Communication modules

### 11.1 VHF/UHF Air-Ground Radio

**Folder:** `src/modules/vhf` · **Pillar:** Communication · **Phase:** 4

```
LEARNING GOAL
Pilots and controllers talk by VHF radio. VHF travels in straight lines,
so the range depends on how high the aircraft is. Only one person on a
frequency can talk at a time.

ANALOGY
Like a walkie-talkie: press to talk, release to listen, and if two people
press at once, nobody hears anything.

SIMULATOR
- A side view with a ground antenna, terrain, and the curve of the Earth.
  An altitude slider shows the radio horizon, and aircraft beyond it lose
  contact.
- A range readout calculated live.
- A press-to-talk exercise: the learner and a simulated second pilot
  transmit; if both transmit at once, the learner hears a squeal and no
  message gets through (blocked transmission).
- Squelch slider (noise vs silence), a comparison between 25 kHz and
  8.33 kHz channel spacing on a frequency strip, and the guard frequency
  121.5 MHz.
- Main and standby transmitters and a simple voice switch panel (VCCS) on
  the controller's side.

WHEN THINGS GO WRONG (toggles)
Stuck microphone (one aircraft blocks the whole frequency), a mountain
blocking the signal, transmitter failure (switch to standby), and
interference from a nearby frequency.

TRY THIS
1. Descend and find the altitude at which contact is lost.
2. Transmit at the same moment as the other pilot.
3. Turn on a stuck microphone and see how the controller works around it.

GO DEEPER
VHF aeronautical band 118–136.975 MHz, AM. UHF military 225–400 MHz. Radio
line-of-sight range ≈ 1.23 × (√h_tx + √h_rx) NM, with heights in feet.
Explain why the 8.33 kHz spacing was introduced (frequency congestion).
```

### 11.2 HF Radio

**Folder:** `src/modules/hf` · **Pillar:** Communication · **Phase:** 4

```
LEARNING GOAL
Over oceans and remote areas, VHF can't reach. HF radio waves bounce off a
layer of the upper atmosphere (the ionosphere) and can travel thousands of
kilometres. The ionosphere changes between day and night, so the best
frequency changes too.

ANALOGY
Like skipping a stone on water: the signal bounces between the sky and
the ground to get over the horizon.

SIMULATOR
- A side view of the curved Earth with ionosphere layers (D, E, F). The
  learner picks a frequency and a time of day and watches the wave path:
  absorbed, reflected, or passing into space.
- Skip zone visualization (areas the signal passes over without being
  heard).
- A day/night slider, with frequency recommendations updating (lower at
  night, higher by day).
- A SELCAL demo: the pilot doesn't have to listen to the noise all the
  time; a chime sounds when the ground station calls this aircraft.
- Audio: noisy HF voice vs clear VHF voice.

WHEN THINGS GO WRONG (toggles)
Solar flare (radio blackout), wrong frequency for the time of day, and
atmospheric noise.

TRY THIS
1. Use a daytime frequency at night and see the signal lost.
2. Find the skip zone where a nearby station can't hear you.
3. Compare the audio quality of HF and VHF.

GO DEEPER
HF aeronautical bands between about 2.85 and 22 MHz, single sideband
(USB). Explain why CPDLC and SATCOM are replacing HF voice in many oceanic
regions.
```

### 11.3 CPDLC (Controller–Pilot Data Link Communications)

**Folder:** `src/modules/cpdlc` · **Pillar:** Communication · **Phase:** 4

```
LEARNING GOAL
Instead of speaking, controllers and pilots can exchange standard text
messages, like texting. This avoids misheard instructions and congested
frequencies.

ANALOGY
Voice radio is a busy phone call; CPDLC is a precise text message with
standard phrases and a "read" receipt.

SIMULATOR
- Split screen with a controller workstation and an aircraft cockpit
  datalink display.
- Logon sequence animation (the aircraft connects to the ATC center).
- The learner (as controller) sends standard messages, such as CLIMB TO
  FL350 or CONTACT the next sector. The learner (as pilot) responds with
  WILCO, UNABLE, or STANDBY.
- A message path view: VHF datalink or satellite, with delay shown.
- A "voice vs datalink" challenge: a busy frequency with 10 aircraft;
  compare how long clearances take and how many are misheard.

WHEN THINGS GO WRONG (toggles)
Message delay (the controller waits too long for a response), a lost
connection (fall back to voice), and a message sent to the wrong aircraft
(explain how the logon and addressing prevent it).

TRY THIS
1. Deliver 5 clearances by voice, then by CPDLC, and compare.
2. Reply UNABLE and see what the controller must do.
3. Disconnect the datalink during a clearance.

GO DEEPER
FANS 1/A (over ACARS, by satellite or VHF) vs ATN Baseline 1 (VDL Mode 2).
Message sets. Performance requirements for latency and reliability.
```

### 11.4 SATCOM (Satellite Communication)

**Folder:** `src/modules/satcom` · **Pillar:** Communication · **Phase:** 4

```
LEARNING GOAL
Over oceans and poles, aircraft can talk to ATC and send data through
satellites. Different satellite constellations trade coverage for delay:
high satellites cover a huge area but add delay, while low satellites
move fast but cover the whole globe, including the poles.

ANALOGY
A geostationary satellite is like a tall tower standing still over the
equator; a low-orbit constellation is like a relay team of runners
passing your message along.

SIMULATOR
- A rotatable 3D Earth with a GEO vs LEO toggle.
  GEO: about 35,786 km up, fixed over the equator, with coverage
  footprints and a gap near the poles.
  LEO: about 780 km, a moving constellation (Iridium-style), with coverage
  everywhere and handovers between satellites.
- Fly an aircraft on a route across an ocean or over the pole, and watch
  which satellite links up.
- Latency meter: send a message and watch the delay add up.
- Show the uses: voice, CPDLC, ADS-C, and space-based ADS-B.

WHEN THINGS GO WRONG (toggles)
Polar route outside GEO coverage, the aircraft antenna blocked by its own
body during a steep turn, satellite handover, and heavy rain affecting the
link.

TRY THIS
1. Fly over the North Pole using GEO only, then using LEO.
2. Compare GEO and LEO delays for a voice call.
3. Follow a transatlantic flight and watch the satellite links change.

GO DEEPER
L-band aeronautical SATCOM. Latency: GEO round trip roughly 0.5 s for a
two-way exchange; LEO much less. Inmarsat (GEO) and Iridium (LEO).
Required communication performance.
```

---

## 12. Integration: Airspace Sandbox

**Folder:** `src/pages/Sandbox` · **Pillar:** Integration · **Phase:** 6

```
LEARNING GOAL
No single system does everything. Controllers rely on many overlapping
systems at once, and the combination is what keeps air traffic safe even
when one part fails.

ANALOGY
Like an orchestra: each instrument plays its part, and if one stops, the
music continues.

SIMULATOR
- A regional map with an airport, en-route airspace, a mountain range,
  and an ocean.
- All CNS systems placed on the map, each with a coverage overlay that can
  be switched on and off (radar, ADS-B, MLAT, VHF, VOR/DME, ILS, SATCOM).
  Reuse the logic from the existing modules in src/core and src/modules.
- One aircraft flies a full journey: departure → climb → en-route →
  ocean → return and ILS approach. A timeline shows which systems it uses
  at each stage (communication, navigation, surveillance).
- Controller display view: a fused track with a label, and a "sources"
  panel showing which systems are contributing to that track.
- Safety nets: STCA (two aircraft getting too close) and MSAW (an aircraft
  descending too close to terrain), each with an alert on screen.
- Every system on the map links to its own module.

WHEN THINGS GO WRONG (scenario buttons)
- Radar outage: the tracks continue using ADS-B and MLAT.
- GNSS jamming: ADS-B and GNSS navigation fail; radar, MLAT, and VOR/DME
  continue.
- VHF failure: switch to the standby frequency or CPDLC.
- Mountain terrain: coverage gaps and an MSAW alert.
For each scenario, show what fails, what still works, and what the
controller and pilot do next.

TRY THIS
1. Turn off systems one by one. When does the aircraft finally disappear
   from the controller's screen?
2. Jam GNSS and list what still works.
3. Put two aircraft on a collision course and watch STCA fire.

GO DEEPER
Surveillance data fusion (tracking), redundancy and "graceful
degradation", and a short introduction to how each pillar supports
Performance-Based Navigation and future ATM concepts.
```

---

## 13. Home page prompt

Send this after the Airspace Sandbox is complete.

```
Read CLAUDE.md. Replace the placeholder home page of CNS Lab with the final
version.

HERO
A short welcome in plain language: "Every day, around a hundred thousand
flights cross the sky safely. Explore the invisible radio systems that
make it possible." Add a subtle animated background (radar sweep or
flight paths) that respects the reduced-motion setting.

CNS MAP
An interactive illustration of an airport and the surrounding airspace
showing every system: radar towers, VOR/DME station, NDB, ILS antennas at
the runway, ground receivers, satellites, and aircraft. Hovering over a
system highlights it and shows a one-line description. Clicking opens its
module. Filter buttons: Communication, Navigation, Surveillance, All.

MODULE CARDS
Cards grouped by pillar. Each card shows an icon, the module name, a
one-line plain-language summary, estimated time, and a "Completed" badge
from the learner's quiz progress (stored in localStorage).

SUGGESTED LEARNING PATH
"Start here" path: Primary radar → SSR → ADS-B → VOR → DME → ILS → GNSS →
VHF radio → SATCOM → Airspace Sandbox.

ALSO
Links to the Glossary, a frequency-band reference chart showing where every
system sits in the radio spectrum, and the disclaimer.
```

---

## 14. Final polish prompt (Phase 6)

```
Read CLAUDE.md. Review and polish the whole CNS Lab project.

1. Consistency: every module follows the 7-section ModuleLayout, uses the
   shared instruments, and matches the design tokens.
2. Accessibility: keyboard navigation for every control, visible focus
   states, ARIA labels, a reduced-motion mode, captions or text alternatives
   for audio, and information never carried by color alone.
3. Responsiveness: test desktop and tablet layouts; on phones, show the
   simulator above the controls.
4. Performance: canvas and 3D scenes hold 60 fps; lazy-load each module;
   pause animations in background tabs.
5. Content: plain language throughout the main flow; every jargon word has
   a glossary entry; every quiz question has an explanation.
6. Accuracy: list every // TODO(expert-review) comment in a file
   docs/EXPERT_REVIEW.md, grouped by module, for a CNS engineer to check.
7. Testing: all Vitest tests pass; add tests for any core function without
   one.
8. Build: production build succeeds; add a README with how to run, build,
   and deploy as a static site.
Summarize every change you made.
```

---

## 15. Technical accuracy review checklist

Give this checklist, together with `docs/EXPERT_REVIEW.md`, to a qualified CNS/ATSEP engineer before publishing.

| Module | Values to verify |
|---|---|
| NDB/ADF | Frequency band, error types, bearing formula |
| CVOR/DVOR | Frequency band, 30 Hz reference and variable signals, 9960 Hz subcarrier, DVOR antenna ring, cone of confusion |
| DME | Frequency band, 50 µs and 56 µs reply delays, X/Y channels, slant range behavior, capacity |
| ILS | Localizer and glideslope bands, 90/150 Hz modulation, glide angle, marker frequencies and tones, CAT minimums, critical areas |
| GNSS | Satellite count requirements, RAIM detection and exclusion, SBAS and GBAS description, L1 frequency |
| PSR | Range and PRF formulas, typical bands and rotation rates, MTI description |
| SSR/Mode S | 1030/1090 MHz, Mode A/C pulse spacing, F1/F2 spacing, special codes, Mode S addressing |
| ADS-B/ADS-C | Update rates, 1090ES and UAT, quality indicators, ADS-C contract types |
| MLAT/WAM | Receiver count requirements, TDOA description |
| SMR/A-SMGCS | Frequency band, A-SMGCS service levels |
| VHF/UHF | Frequency bands, 8.33 kHz spacing, guard frequency, line-of-sight formula |
| HF | Frequency range, ionosphere behavior, SELCAL |
| CPDLC | FANS 1/A vs ATN B1, message responses |
| SATCOM | Orbit altitudes, coverage limits, latency values |
| Sandbox | Safety net behavior (STCA, MSAW), fallback logic in each failure scenario |

**Primary reference:** ICAO Annex 10, Aeronautical Telecommunications (Volumes I to IV), plus relevant ICAO manuals and local ANSP documentation.

---

*End of guide. For educational use only, not for operational use.*
