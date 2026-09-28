# CNS Lab — Design System

Single source of design truth for CNS Lab. Every UI change must follow this file.
It applies the enterprise UI rules (shadcn/ui, blue and white, responsive, both themes)
to an educational simulation site.

## 1. Design language

- **Feel:** calm, professional, dense but breathable. The simulations are the stars;
  the chrome around them stays quiet.
- **Palette:** blue and white. Blue (`--primary`) is the only accent colour.
  Red (`--destructive`), green (`--success`) and amber (`--warning`) are used only
  for their meaning (alert, OK, caution), never for decoration.
- **Surfaces:** white (light) or slate-950 (dark) backgrounds, 1px borders,
  no drop shadows beyond `shadow-sm`. Depth comes from borders and spacing.
- **Radius:** 8px cards and panels (`rounded-lg`), 6px inputs and buttons (`rounded-md`).
- **Type:** Inter for UI, JetBrains Mono for numeric readouts.
  13px UI text (`text-sm`), 12px meta (`text-xs`), 15px reading prose (`.prose-lab`,
  `text-prose`). Headings `font-semibold`. All numbers use `tabular-nums`.
- **Spacing:** 4px grid. Section padding 24px, card padding 16–24px, list rows ≥ 40px.
- **Icons:** `lucide-react` only, 16px inline, 20px in toolbars. No emoji.
- **Never:** gradients, glassmorphism, animated page backgrounds, decorative illustrations.
  Animation is allowed only where it teaches (signals, sweeps, needles) and it always
  respects the reduced-motion setting.

## 2. Tokens

All colour values live in `src/globals.css` as CSS variables. Tailwind classes reference
them (`bg-primary`, `text-muted-foreground`, `bg-scope-bg`). Canvas and three.js code reads
them at runtime through `useThemeTokens()` (`src/hooks/useThemeTokens.ts`).
Hex values in components are forbidden.

| Group | Tokens | Notes |
|---|---|---|
| Core | `--background --foreground --card --popover --primary --secondary --muted --muted-foreground --accent --border --input --ring` | shadcn theming |
| Semantic | `--destructive --success --warning` | meaning only |
| Charts | `--chart-1 … --chart-5` | blue monochrome series |
| Maps and diagrams | `--sim-bg --sim-land --sim-water --sim-terrain --sim-terrain-high --sim-grid --sim-grid-strong --sim-ink --sim-muted --sim-signal --sim-signal-2 --sim-neutral --sim-coverage --sim-shadow-zone --sim-warning --sim-alert --sim-ok --sim-sky --sim-fog` | follow the theme |
| Screens and scopes | `--scope-bg --scope-grid --scope-grid-strong --scope-trace --scope-trace-2 --scope-blip --scope-text --scope-dim --scope-clutter --scope-warning --scope-alert` | dark in both themes, like real displays |
| Cockpit instruments | `--instrument-face --instrument-bezel --instrument-marking --instrument-dim --instrument-needle --instrument-accent --instrument-flag` | dark in both themes |
| ILS lobes | `--lobe-90 --lobe-150` | always paired with a label and a hatch pattern |
| Marker lamps | `--marker-outer --marker-middle --marker-inner` | real cockpit colours, always labelled O / M / I |

Light core values: primary `221 83% 53%`, background white, foreground `222 47% 11%`,
muted-foreground `215 16% 47%`, border `214 32% 91%`, destructive `0 72% 51%`.
Dark: white ↔ slate-950 inversion, primary lightened to `217 91% 60%` with dark text on it
(keeps contrast ≥ 4.5:1).

## 3. Components

- Everything interactive comes from shadcn/ui in `src/components/ui`
  (Button, Card, Slider, Switch, Tabs, Tooltip, Popover, Accordion, Collapsible, RadioGroup,
  Badge, Separator, Select, Input, Label, Sheet, Progress, Alert, DropdownMenu, Table,
  Toggle, ToggleGroup, ScrollArea, Skeleton, Kbd). They have been tuned to this file:
  6px radius, 36px controls on desktop and 40px on touch screens (`pointer-coarse:`),
  `shadow-sm` at most.
- Project patterns in `src/components` compose those primitives:
  `ModuleLayout`, `Section`, `ControlsPanel`, `ControlSlider`, `ControlSwitch`,
  `Readout`, `Term` (glossary popover), `Stepper`, `TryThis`, `FailureCard`, `GoDeeper`,
  `Quiz`, `SimLabel` ("Slowed down so you can see it"), `CnsMap`, `SiteHeader`, `SiteFooter`.
- Instruments in `src/instruments` are drawn on canvas or SVG with instrument tokens and
  are reused by every module. Never duplicate an instrument.

## 4. Layout

- Site header: CNS Lab wordmark, module name, pillar badge, Home link, theme toggle.
- Module pages use the 7 standard sections in this order:
  1 The simple idea · 2 Simulator · 3 How it works · 4 Try this ·
  5 When things go wrong · 6 Go deeper (collapsed) · 7 Quick quiz.
- Desktop (≥ 1024px): simulator view on the left, controls panel (320px) on the right,
  an "On this page" rail on wide screens (≥ 1440px).
- Tablet (768px): simulator full width, controls below in two columns.
- Phone (390px): simulator above the controls, one column, no horizontal page scroll.
- Footer on every page: "For educational use only, not for operational use."

## 5. Accessibility

- Contrast ≥ 4.5:1 for body text in both themes.
- Every control has a visible label; icon-only buttons have `aria-label`.
- Focus ring visible on every interactive element (2px `--ring`).
- Colour never carries meaning alone: add a label, a shape, a pattern or a text readout.
- Canvases have `role="img"` with a live text alternative, and keyboard alternatives
  (sliders, arrow keys) for anything that can be dragged.
- Audio always has a caption.
- Reduced motion: decorative motion stops; simulations start paused and can be stepped.

## 6. Honesty labels

When a view slows down, speeds up or simplifies reality, show a `SimLabel` on the view,
for example "Slowed down so you can see it" or "Distances not to scale".
