# CNS Lab: Design System ("Flight Deck")

This file is the single source of design truth for CNS Lab, and every UI change must
follow it. The live reference is `/instruments`, which renders the style guide
(`src/pages/StyleGuide.tsx`) above the instrument library.

## 1. Design language

The site should feel like an instrument console in a dark studio. Each module opens
on a **tabletop diorama**: a lit miniature of the system on a terrain table, framed by
**HUD chrome** (hairlines, corner brackets, mono labels, telemetry). The simulations
are the heroes. The chrome is precise and quiet around them.

- **Dark first.** The default theme is dark (graphite). Light theme is fully supported.
  Stages, scopes and cockpit instruments stay night-scene in both themes.
- **One accent pair.**
  - Cyan `--signal` means live signal, focus and the primary action.
  - Brass `--brass` means hardware, the analogy and a second signal.
  - Red `--destructive` is only for alarms and failures. Green `--success` is only
    for OK or completed. Neither is used for decoration.
- **Hairlines, not boxes.** Surfaces are separated by 1px `--hud-line` rules and
  `hud-panel` glass: a translucent `--hud-panel` fill with a backdrop blur. Radius is
  small: 4–6px on panels and 3–4px on controls. There are no drop shadows. A glow
  (`shadow-[0_0_Npx_var(--signal)]`) marks only live or active things.
- **Type.**

  | Role | Font | Where |
  |---|---|---|
  | Display | Michroma, `.hud-title` (uppercase, wide) | Titles, panel names, chapter heads |
  | Reading | Inter Tight | Prose, 15–18px |
  | Data | JetBrains Mono, `.hud-label` / `.hud-value` | Labels (uppercase, tracked, 10–11px) and numbers |

  All numbers use tabular figures.
- **Motion teaches.**
  - Camera moves between chapter shots, and pen-plot edges reveal the miniatures.
  - Sweeps, pulses and needles show what the physics does.
  - Everything respects reduced motion: the camera snaps and decorative motion stops.
- **Never:**
  - hex or rgb literals in components;
  - Tailwind palette classes (`bg-blue-500`);
  - emoji;
  - decoration that contradicts the physics.

## 2. Tokens (`src/globals.css`)

Every colour is a CSS variable. Tailwind classes reference the variables.
- Canvas code reads `tokens[...]` via `useThemeTokens()`.
- three.js code uses `col(t, 'token')` from `@/stage/Stage`.

| Group | Tokens | Notes |
|---|---|---|
| Core | `--background --foreground --card --popover --primary --secondary --muted --muted-foreground --accent --border --input --ring` | shadcn theming. In dark, `--primary` is the signal cyan. |
| Flight Deck | `--signal --brass --hud-line --hud-panel` | Accent pair, hairline, glass |
| Semantic | `--destructive --success --warning` | Meaning only |
| Stage (3D) | `--stage-bg --stage-floor --stage-fog --stage-line --stage-metal --stage-metal-dark --stage-paint --stage-terrain --stage-terrain-high --stage-water --stage-signal --stage-brass --stage-alert --stage-glass` | Night scene in both themes |
| Maps | `--sim-*` | Follow the theme |
| Scopes | `--scope-*` | Dark in both themes |
| Cockpit instruments | `--instrument-*` | Dark in both themes |
| ILS lobes, marker lamps | `--lobe-90 --lobe-150 --marker-*` | Always labelled |

Stage chrome sits inside a `dark` class scope, so HUD text on a night stage stays
legible in the light theme too.

## 3. Components

- **HUD kit** (`src/hud`):
  - `HudFrame`: `CornerBrackets`, `TitleBlock`, `StatusLamp`, `HudPanel`.
  - `Telemetry`: `TelemetryRow`, `BigReadout`, `BarMeter` (vertical or horizontal), `NeedleGauge`.
  - `Controls`: `Dial`, `LeverSwitch`, `Segmented`, `HudButton`.
  - Also `ChapterScrubber` and `MissionClock`.
  - Every control is keyboard operable and labelled. `Dial` is a `role="slider"` with
    arrow, Page and Home/End keys.
- **Stage** (`src/stage`):
  - `Stage`: WebGL check, performance tiers, bloom, vignette and grain, reduced-motion snap.
  - `CameraRig` (eased shots), `StudioLights`, `StudioFloor`, `PenPlot` (edge-draw reveal).
  - `Callout3D`: a world-anchored DOM label.
  - `Diorama`: the 60 NM terrain table from `core/world`, `RadarTower`, `AircraftModel`, `toU`.
- **shadcn/ui** primitives (`src/components/ui`) are restyled to this file: mono
  uppercase buttons, hairline outlines, brass slider thumb. Use them for anything the
  HUD kit does not cover (Select, Popover, Tooltip, Sheet and so on).
- **Instruments** (`src/instruments`) are reused everywhere. Never duplicate one.

## 4. Layout

- **Header:** blurred bar with the CNS LAB wordmark, `// module · pillar` and mono nav.
- **Module page with a hero** (`ModuleLayout` with `stage`):
  - A sticky full-bleed stage sits under the header. The 7 chapters (Idea, Simulator,
    How, Try, Failures, Spec, Quiz) scroll over it in `hud-panel`s.
  - Each chapter has its own camera shot. "How it works" steps can have one shot each.
  - A fixed bottom `ChapterScrubber` shows the chapters; ←/→ move between them.
  - The Simulator chapter is a console: the view on the left, the control deck on the
    right, the stage visible between them, and a slow-motion panel below.
- **Module page without a hero yet:** the same chrome with the chapters in flow (the
  flat layout).
- **Breakpoints:**

  | Width | Stage | Panels |
  |---|---|---|
  | 1440 | Full height, behind everything | 3 columns in the Simulator chapter |
  | 768 | Full height | 2 columns |
  | 390 | 42svh sticky strip on top | Content in one column below |

  No page may scroll sideways at any width.
- **Home:** a hero diorama of every CNS system (labels link to modules, with a pillar
  filter), then the learning-path track, then the typographic module index.
- **Footer on every page:** "For educational use only, not for operational use."

## 5. Accessibility

- Contrast is at least 4.5:1 for body text in both themes. Stage text sits on a scrim
  or in `hud-panel`s.
- Every control has a visible label, and focus rings are visible (`--ring`).
- Colour never carries meaning alone.
- Stages and canvases have `role="img"` with a text description. Keyboard users reach
  every 3D link through an equivalent list: the Home 3D labels duplicate the module
  index and are taken out of the tab order.
- Audio always has a caption.

## 6. Honesty labels

Every stage shows what is not to scale, for example "Table 120 NM across · heights ×3.6 ·
radar and aircraft larger than life" or "Not to scale · airport drawn 10× larger · time ×20".
Slow-motion replays show "Slowed down so you can see it" and freeze the world.

## 7. Verification

Take screenshots at 1440, 768 and 390 px, in dark and light, before calling any UI
change done. Also run `npm test`, `npx tsc -b` and `npm run build`.
