# Module authoring guide

How to build a CNS Lab module so it matches the rest of the site. The reference
implementation is **`src/modules/psr`** (Primary Surveillance Radar). Read it first:
`index.tsx` (content + page), `state.tsx` (store + context), `engine.ts` (scenario),
`Simulator.tsx` (views + controls + loop), `TruthMap.tsx`, `PulseView.tsx`,
`Antenna3D.tsx`, `visuals.tsx` (How-it-works diagrams), `deeper.mdx`.

Also read `CLAUDE.md`, `design.md` and the module's section in
`docs/ATM_Simulation_Development_Guide.md`.

## 1. Files for a module `<id>`

| File | Purpose |
|---|---|
| `src/modules/<id>/index.tsx` | Default export: the page. Wraps content in the module's provider and renders `<ModuleLayout moduleId="<id>" …>` with all 7 sections. |
| `src/modules/<id>/state.tsx` | Zustand store (UI parameters and failure toggles) + React context holding the engine and clock. |
| `src/modules/<id>/engine.ts` | Scenario engine (mutable state, stepping). Uses only pure functions from `src/core`. |
| `src/modules/<id>/Simulator.tsx` | Views, controls panel, readouts and the simulation loop. |
| `src/modules/<id>/visuals.tsx` | Small SVG diagrams for "How it works" (animations omitted when reduced motion is on). |
| `src/modules/<id>/deeper.mdx` | "Go deeper" content: formulas, frequencies, specifications. `Formula`, `Note` and `Term` are available without importing. GFM tables work. |
| `src/core/<topic>.ts` | Pure physics / signal / geometry functions for the module. No DOM, no React, no randomness except through a passed-in generator. |
| `tests/core/<topic>.test.ts` | Vitest tests for every exported core function. |
| `tests/modules/<id>-engine.test.ts` | Tests for the engine's behaviour (one per important claim the module makes). |
| `src/content/glossary/<id>.json` | New jargon terms: `[{ "id", "term", "definition" }]`. ids are lowercase-kebab and unique across **all** glossary files (grep before adding; reuse an existing id instead of duplicating). |

The route (`/modules/<id>`) and home-page card already exist in `src/modules/registry.ts`;
creating `src/modules/<id>/index.tsx` makes the module "ready" automatically.

## 2. Shared building blocks (do not duplicate, do not modify)

- **Layout** `@/components/module/ModuleLayout` → `<ModuleLayout moduleId nextId idea={{ analogy, what, where }} simulator howItWorks tryThis failures failuresNote? goDeeper quiz />`
  - `howItWorks: Step[]` (`{ title, body, visual? }`) from `@/components/module/Stepper`
  - `tryThis: Experiment[]` (`{ id, question, action, notice, setup?, setupLabel? }`), 3–5 items; `setup` configures the simulator and scrolls to it
  - `failures: FailureItem[]` (`{ id, title, explanation, watch?, checked, onChange }`) — bound to the SAME store as the simulator toggles
  - `quiz: QuizQuestion[]` (`{ question, options, answer, explanation }`), exactly 5, friendly explanations
- **Controls** `@/components/sim/Controls`: `ControlsPanel`, `ControlGroup`, `ControlSlider`, `ControlSwitch`, `ControlChoice`, `Readout`, `ReadoutGrid`, `SimLabel`, `AudioCaption`, `ClockControls`, `ClockSpeedLabel`.
- **Canvas** `@/components/sim/Canvas2D` (`draw(ctx, { width, height, dt, now, tokens })`, 60 fps, DPR-aware, pauses off-screen, `label` for screen readers, pointer/key handlers).
- **Maps** `@/components/sim/MapCanvas` (north-up map, terrain, draggable aircraft, arrow-key nudging, `drawOverlay`/`drawTop`) and `@/components/sim/mapDraw` (`drawAircraftIcon`, `drawStation`, `drawRangeRing`, `drawBeamWedge`, `haloText`).
- **3D** `@/components/sim/Scene3D` (react-three-fiber canvas with themed background, WebGL fallback, `tc(t, 'token')` colour helper). See `psr/Antenna3D.tsx`. three.js: east = +x, up = +y, north = −z; use `worldToThree` and `bearingToThreeRotationY` from `@/core/geometry`.
- **Instruments** `@/instruments`: `CDI` (CDI/HSI, OBS, TO/FROM, glideslope), `ADF` (ADF/RMI), `DMEReadout`, `RadarScope` (PPI with phosphor, tracks with labels and shape-coded symbols), `Oscilloscope`, `Spectrum`. They take a `read()` callback that is called every frame; keep it cheap.
- **Clock** `@/hooks/useSimClock`: `useSimClock({ speeds? })`, `useSimulationLoop(clock, (dt, realDt) => …)`, `useClock(clock, selector)`. Speeds default to 0.25×–4×; pass custom `speeds` only when the scenario really needs time-lapse (e.g. ocean crossings) and label it.
- **Readouts** `@/hooks/useSampled` (poll a getter ~10 Hz for text readouts; never re-render React every frame).
- **Colours** `@/hooks/useThemeTokens` (`tokens` in draw callbacks; `useThemeTokens()` in React), `@/lib/color` (`withAlpha`, `mix`).
- **Audio** `@/lib/audio`: `audio.keyed(segments, hz, { loopPeriodS })`, `audio.tone`, `audio.noise`, `audio.heterodyne`, `audio.selcal`, `audio.stopAll()`, and `caption(text, seconds)`. Every sound must post a caption. Morse and marker timings come from `@/core/morse`.
- **Core** `@/core/units`, `@/core/geometry`, `@/core/propagation`, `@/core/world`, `@/core/clock`, `@/core/morse`, `@/core/random`, `@/core/radar`.
- **UI primitives** only from `@/components/ui/*` (shadcn/ui). Icons only from `lucide-react`.
- **Glossary** `<Term id="...">words</Term>` from `@/components/Term`.

If you need a capability that is missing, implement it inside your module folder
(or your own `src/core/<topic>.ts`) and mention it in your final report. Do not edit
files outside your module(s), your core/test files and your glossary file.

## 3. Physics consistency rules (non-negotiable)

1. **Units**: NM, ft, kt, seconds, µs for radio timing, degrees TRUE internally. Magnetic values
   only at the display edge via `trueToMagnetic`/`magneticToTrue` (variation East positive).
   Use constants from `@/core/units` (speed of light, NM, ft) — never retype them.
2. **One world, one clock**: aircraft move only through `stepAircraft`/`stepAircraftFine`
   (turn ≤ 3°/s, climb/descent limits, no teleporting except explicit learner drags or
   "Set it up" buttons). Everything time-based uses the simulator clock.
3. **Slow motion freezes the world**: a microsecond-scale replay (pulses, replies, echoes)
   pauses world time while it plays and shows `SimLabel` "Slowed down so you can see it"
   with `slowMotionLabel`. Aircraft never move during a microsecond event.
4. **Geometry must agree across views**: the same engine state drives every view (map,
   scope, 3D, side view, instruments). A bearing on the map equals the sweep on the scope
   equals the rotation in 3D. Use the shared conversion helpers.
5. **Line of sight** uses `lineOfSight` / `radioLineOfSightNm` from `@/core/propagation`
   (they agree with the 1.23·(√h₁+√h₂) rule). Side views with a curved Earth draw the
   ground with `earthDropFt` so a straight ray is straight on screen.
6. **Signs and conventions** are documented in the core functions (e.g. CDI `lateral` +1 =
   fly right; glideslope `vertical` +1 = fly up; `crossTrackNm` positive = right of course).
   Test them.
7. **Randomness** only through a seeded generator from `@/core/random` passed into the
   engine, so tests are deterministic.
8. **Never invent a specification.** Every frequency, timing or limit either matches ICAO
   Annex 10 (or the relevant ICAO document) or carries a `// TODO(expert-review): …` comment
   (in MDX: `{/* TODO(expert-review): … */}`). Teaching simplifications are labelled on screen.

## 4. Content rules

- Section 1 starts with the everyday analogy. Plain language, short sentences.
- First use of a technical word gets a `<Term>`. Every Term id must exist in a glossary file.
- Formulas and exact specifications appear **only** in `deeper.mdx`.
- 3–5 "Try this" experiments, each with a question, an action, a "What you should notice", and
  a `setup` where the simulator can be configured automatically.
- 5 quiz questions; each explanation says why, kindly.
- No emoji. No exclamation-heavy tone.

## 5. Visual rules (from design.md)

- Colours only from tokens: Tailwind token classes (`bg-card`, `text-muted-foreground`,
  `fill-sim-signal`, `stroke-scope-grid`, …) or `tokens['sim-signal']` in canvas code.
  **Never** hex, rgb literals, or Tailwind palette classes such as `bg-blue-500`.
- Maps follow the theme (`--sim-*`); radar scopes and cockpit instruments are dark in both
  themes (`--scope-*`, `--instrument-*`).
- Meaning is never carried by colour alone: add a label, shape, dash pattern or text.
- Layout like PSR: views in a `grid gap-4 md:grid-cols-2` (or full width), controls in
  `ControlsPanel` in a right column at `xl` (`xl:grid-cols-[minmax(0,1fr)_320px]`), stacked
  below on smaller screens. Must work at 390, 768 and 1440 px without horizontal scrolling.
- Each view gets a `figcaption` (title + one-line hint) and honesty `SimLabel`s where needed.
- Canvases get a meaningful `label` (screen-reader text) that updates with the state.
- Draggable things also have a keyboard or slider alternative.

## 6. Checks before you finish

```bash
npx tsc -p tsconfig.test.json --noEmit 2>&1 | grep -E "<your paths>"   # must print nothing
npx vitest run tests/core/<topic>.test.ts tests/modules/<id>-engine.test.ts tests/content
npx oxlint src/modules/<id> src/core/<topic>.ts
```

Other modules are being built at the same time: ignore type errors in files that are not yours,
never edit them. The dev server runs at http://localhost:5173; for visual checks use
the screenshot helper described in your task (1440 × 900 and 390 × 844, light and dark), and
fix what you see: overlapping text, clipped labels, unreadable contrast, empty states.
