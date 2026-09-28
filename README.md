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
| Integration | Airspace Sandbox (data fusion, controller display, STCA and MSAW safety nets) |

Every module follows the same seven sections: the simple idea, a simulator, how it works,
guided experiments, failure toggles, a collapsed "Go deeper" with formulas and
specifications, and a five-question quiz (progress is kept in the browser's localStorage).

Also: a glossary (every jargon word has a tooltip), a frequency chart of the radio
spectrum, and an instrument library page (`/instruments`).

## Requirements

- Node.js 20 or newer (developed with Node 22) and npm.

## Run, test and build

```bash
npm install
npm run dev          # development server at http://localhost:5173
npm run test         # Vitest unit tests for the simulation core and module engines
npm run typecheck    # TypeScript project check
npm run lint         # oxlint
npm run build        # type-check and production build into dist/
npm run preview      # serve the production build locally
npm run expert-review  # regenerate docs/EXPERT_REVIEW.md from TODO(expert-review) comments
```

## Deploy as a static site

`npm run build` produces a fully static site in `dist/` (no backend). Because CNS Lab is a
single-page app with routes such as `/modules/psr`, the host must send unknown paths to
`index.html`:

- **Netlify**: `public/_redirects` is copied into `dist/` and does this automatically.
- **Vercel**: `vercel.json` contains the rewrite.
- **GitHub Pages**: the build also writes `dist/404.html` (a copy of `index.html`). If the site
  lives under a sub-path, build with that base, for example
  `npx vite build --base=/cns-lab/` (the router reads the base automatically).
- **Any other static server** (nginx, S3 + CloudFront, Azure Static Web Apps): configure a
  fallback to `/index.html` for 404s.

## Project structure

```
src/
  core/          Pure TypeScript simulation logic (unit tested in tests/core)
  instruments/   Reusable instruments: CDI/HSI, ADF/RMI, DME readout, radar scope, oscilloscope, spectrum
  components/    UI: shadcn/ui primitives (ui/), module layout (module/), simulator building blocks (sim/)
  modules/       One folder per module, plus registry.ts (names, pillars, routes)
  content/       Glossary JSON files and the frequency chart data
  pages/         Home, Glossary, Frequency chart, Instruments, Airspace Sandbox
  stores/        Preferences (theme, sound, captions, reduced motion) and quiz progress
tests/           Vitest tests (core physics, module engines, content integrity)
docs/            Development guide, module authoring guide, expert review list
design.md        Design system (single source of design truth)
CLAUDE.md        Project rules
```

## Design and accessibility

- Enterprise blue-and-white design system with light and dark themes (`design.md`); colours
  come only from CSS variables in `src/globals.css`, including every canvas and 3D scene.
- Keyboard accessible controls with visible focus, labelled sliders and switches, screen-reader
  descriptions for every canvas, captions for every sound, a reduced-motion mode, and no
  information carried by colour alone.
- Responsive at 390, 768 and 1440 px; on phones the simulator sits above its controls.

## Accuracy

Simulations simplify reality to teach principles, and say so on screen ("Slowed down so you
can see it", "Heights exaggerated", "Illustrative model"). Values that should be confirmed
against ICAO Annex 10 are marked `TODO(expert-review)` in the code and collected in
`docs/EXPERT_REVIEW.md`, together with the review checklist in section 15 of
`docs/ATM_Simulation_Development_Guide.md`.
