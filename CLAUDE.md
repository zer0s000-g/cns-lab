# CNS Lab

Educational web platform that teaches general learners how Air Traffic
Management CNS equipment works (Communication, Navigation, Surveillance).
Full plan: docs/ATM_Simulation_Development_Guide.md
Module authoring rules and conventions: docs/MODULE_AUTHORING.md

## Stack
React + TypeScript + Vite, Tailwind, shadcn/ui, react-three-fiber, Canvas/SVG,
Web Audio, Zustand, MDX, React Router, Vitest.

## Rules
- Simulation logic lives in src/core as pure TypeScript functions, separate
  from rendering, and every function has unit tests (tests/core).
- Every module uses the standard 7-section ModuleLayout.
- Reuse instruments from src/instruments; do not create duplicates.
- Plain language for general learners. Analogy first. Jargon gets tooltips
  (`<Term id="...">`). Formulas only inside "Go deeper".
- Technical values must match ICAO Annex 10. Never invent a specification.
  If unsure, add a `// TODO(expert-review):` comment.
- When a simulation slows down or simplifies reality, show a label on
  screen, for example "Slowed down so you can see it."
- Every page footer: "For educational use only, not for operational use."
- Physics must stay self-consistent: one world model, one clock, one set of
  units (NM, ft, kt, seconds, true degrees internally). A slowed-down signal
  view freezes the world; it never lets an aircraft move during a microsecond event.

## Design
design.md is the single source of design truth: the "Flight Deck" system (dark-first
graphite, cyan signal and brass accents, HUD chrome, 3D tabletop dioramas; light and
dark themes; 390/768/1440 px). The live style guide is /instruments. Colours come only
from the CSS variables in src/globals.css; canvases read them with useThemeTokens(),
three.js with col(t, 'token'). The UI kit lives in src/hud and src/stage.

## Commands
npm run dev | npm run test | npm run build | npm run typecheck
