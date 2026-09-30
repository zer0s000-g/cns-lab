# CNS Lab

An interactive web laboratory that shows general learners how the equipment behind
Air Traffic Management works: **Communication, Navigation and Surveillance (CNS)**.
Learners drag aircraft, turn knobs and switch failures on and off, and watch the physics
respond: signals, timing, geometry and cockpit instruments.

> **For educational use only, not for operational use.** Technical content must be reviewed
> by a qualified CNS/ATSEP engineer against ICAO Annex 10 before publication — see
> [`docs/EXPERT_REVIEW.md`](docs/EXPERT_REVIEW.md).

## What is inside

| Pillar | Modules |
|---|---|
| Surveillance | Primary radar, SSR and Mode S, ADS-B and ADS-C, MLAT and WAM, Surface radar and A-SMGCS |
| Navigation | NDB and ADF, VOR (CVOR and DVOR), DME, ILS, GNSS with SBAS and GBAS |
| Communication | VHF/UHF radio, HF radio, CPDLC, SATCOM |
| Integration | Airspace Sandbox: one aircraft, gate to gate, with every system at work |

Every module follows the same seven sections: the simple idea, a simulator, how it works,
guided experiments, failure toggles, a collapsed "Go deeper" with formulas and
specifications, and a five-question quiz (progress is kept in the browser's localStorage).

The **Airspace Sandbox** is a single interactive page instead. It follows CNS700 from boarding
at the gate through push-back, taxi, take-off, a flight out over the ocean and back, the ILS
approach and landing to the gate again. The view follows the controller who owns the flight:
the airport as a true-scale digital twin (with passengers, ground crew and vehicles), the
terminal area on the terrain table, and a region map over the ocean. Panels show what is
happening, the radio and data-link traffic, the systems in use, and failures to try; a debrief
with the quiz ends the journey.

Also: a glossary (every jargon word has a tooltip), and a frequency chart of the radio
spectrum.

## Requirements

- Node.js 22 or newer (CI uses Node 24) and npm.

## Run, test and build

```bash
npm install
npm run dev          # development server at http://localhost:5173
npm run test         # Vitest unit tests for the simulation core and module engines
npm run typecheck    # TypeScript project check
npm run lint         # oxlint
npm run build        # type-check, production build into dist/, route pages, bundle budget check
npm run budget       # re-run the first-load size budget on every page in dist/ (250 kB JS / 50 kB CSS gzip)
npm run preview      # serve the production build locally
npm run expert-review  # regenerate docs/EXPERT_REVIEW.md from TODO(expert-review) comments
```

## Deploy as a static site

`npm run build` produces a fully static site in `dist/` (no backend). It writes one HTML file
per route (`dist/modules/psr.html`, `dist/glossary.html`, ...) with that page's title,
description and preload hints, so deep links load fast and return a normal 200. It also adds a
small service worker (`sw.js`) so pages opened once keep working offline, and a web app manifest.
For paths that have no file, the host should fall back to `index.html`:

- **Netlify**: `public/_redirects` is copied into `dist/` and does this automatically.
- **Vercel**: `vercel.json` contains the rewrite.
- **GitHub Pages**: `.github/workflows/deploy.yml` lints, tests, runs `npm run build` with
  `BASE_PATH` set to the repository sub-path (which also checks the budget) and deploys on
  every push to `main`. Unknown paths get `dist/404.html`
  (a copy of `index.html`).
- **Any other static server** (nginx, S3 + CloudFront, Azure Static Web Apps): configure a
  fallback to `/index.html` for 404s.

## Project structure

```
src/
  core/          Pure TypeScript simulation logic (unit tested in tests/core)
  instruments/   Reusable instruments: CDI/HSI, ADF/RMI, DME readout, radar scope, oscilloscope, spectrum
  hud/           Flight Deck HUD kit: panels, telemetry, dials, levers, chapter scrubber, mission clock
  stage/         3D stage (lazy three.js), terrain diorama table, camera shots, pen-plot reveal, callouts
  components/    UI: shadcn/ui primitives (ui/), module layout (module/), simulator building blocks (sim/)
  modules/       One folder per module (engine, simulator console, Hero3D stage scene), plus registry.ts
  content/       Glossary JSON files and the frequency chart data
  pages/         Home, Glossary, Frequency chart, Airspace Sandbox
  stores/        Preferences (theme, sound, captions, reduced motion) and quiz progress
tests/           Vitest tests (core physics, module engines, content integrity, presentation helpers)
scripts/         postbuild (route pages, 404, service worker stamp), budget check, expert-review list
docs/            Development guide, module authoring guide, expert review list
design.md        Design system (single source of design truth)
CLAUDE.md        Project rules
```

## Design and accessibility

- "Flight Deck" design system (`design.md`): dark-first
  HUD chrome over 3D tabletop dioramas, with a full light theme. Each module's 3D stage is
  driven by the same engine as its 2D views, and every exaggeration is labelled on screen.
  Colours come only from CSS variables in `src/globals.css`, including every canvas and 3D scene.
- Fast and light: about 181 kB gzip of JavaScript on first load; three.js loads only after the
  page is up. Measured LCP under 2.5 s and CLS under 0.03 on a throttled mobile profile.
- No axe violations on any route in either theme. Keyboard accessible controls with visible focus, labelled sliders and switches, screen-reader
  descriptions for every canvas, captions for every sound, a reduced-motion mode, and no
  information carried by colour alone.
- Responsive at 390, 768 and 1440 px; on phones the simulator sits above its controls.

## Accuracy

Simulations simplify reality to teach principles, and say so on screen ("Slowed down so you
can see it", "Heights exaggerated", "Illustrative model"). Values that should be confirmed
against ICAO Annex 10 are marked `TODO(expert-review)` in the code and collected in
`docs/EXPERT_REVIEW.md`, together with the review checklist in section 15 of
`docs/ATM_Simulation_Development_Guide.md`.
