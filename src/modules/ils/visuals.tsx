import { useId } from 'react'
import { useReducedMotion } from '@/stores/prefs'

/**
 * Small diagrams for "How it works". The two ILS tones always come with a
 * pattern and a label as well as a colour: 90 Hz lines, 150 Hz dots.
 */

function Frame({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <svg viewBox="0 0 360 200" role="img" aria-label={label} className="h-auto w-full rounded-md border bg-sim-bg">
      {children}
    </svg>
  )
}

/** Pattern definitions for the two tones; returns their fill urls. */
function useTonePatterns() {
  const id = useId().replace(/:/g, '')
  const p90 = `v90-${id}`
  const p150 = `v150-${id}`
  const defs = (
    <defs>
      <pattern id={p90} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="7" className="stroke-lobe-90" strokeWidth="2" />
      </pattern>
      <pattern id={p150} width="7" height="7" patternUnits="userSpaceOnUse">
        <circle cx="3.5" cy="3.5" r="1.4" className="fill-lobe-150" />
      </pattern>
    </defs>
  )
  return { defs, f90: `url(#${p90})`, f150: `url(#${p150})` }
}

function Plane({ x, y, rotate = 0 }: { x: number; y: number; rotate?: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rotate})`}>
      <path d="M-14 0 L10 -3 L14 0 L10 3 Z M-2 -1 L-8 -12 L-4 -12 L4 -1 Z M-2 1 L-8 12 L-4 12 L4 1 Z M-12 -1 L-15 -6 L-13 -6 L-9 -1 Z" className="fill-sim-ink" />
    </g>
  )
}

export function TwoBeamsVisual() {
  return (
    <Frame label="An aircraft approaching a runway. The localizer beam shows left and right; the glideslope beam shows up and down.">
      <path d="M 180 175 L 150 60 L 210 60 Z" className="fill-sim-neutral" opacity="0.25" />
      <rect x="170" y="110" width="20" height="70" className="fill-sim-ink" opacity="0.85" />
      <line x1="180" y1="178" x2="180" y2="112" className="stroke-sim-bg" strokeDasharray="6 5" strokeWidth="2" />
      <path d="M 70 70 L 290 70" className="stroke-primary" strokeWidth="2" markerEnd="url(#tb-a)" markerStart="url(#tb-a)" />
      <path d="M 320 40 L 320 130" className="stroke-primary" strokeWidth="2" markerEnd="url(#tb-a)" markerStart="url(#tb-a)" />
      <defs>
        <marker id="tb-a" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 Z" className="fill-primary" />
        </marker>
      </defs>
      <Plane x={180} y={40} rotate={90} />
      <text x="70" y="62" className="fill-sim-ink text-[11px] font-semibold">
        Localizer: left or right?
      </text>
      <text x="296" y="150" textAnchor="middle" className="fill-sim-ink text-[11px] font-semibold">
        Glideslope:
      </text>
      <text x="296" y="164" textAnchor="middle" className="fill-sim-ink text-[11px] font-semibold">
        up or down?
      </text>
      <text x="20" y="192" className="fill-sim-muted text-[11px]">
        Two separate radio beams, one needle each
      </text>
    </Frame>
  )
}

export function LocalizerVisual() {
  const { defs, f90, f150 } = useTonePatterns()
  return (
    <Frame label="Seen from above: the localizer at the far end of the runway sends two overlapping lobes. For a pilot approaching, the 90 Hz lobe is on the left and the 150 Hz lobe on the right.">
      {defs}
      <path d="M 330 100 Q 180 20 20 44 L 20 100 Z" className="fill-lobe-90" opacity="0.22" />
      <path d="M 330 100 Q 180 20 20 44 L 20 100 Z" fill={f90} />
      <path d="M 330 100 Q 180 180 20 156 L 20 100 Z" className="fill-lobe-150" opacity="0.22" />
      <path d="M 330 100 Q 180 180 20 156 L 20 100 Z" fill={f150} />
      <line x1="20" y1="100" x2="330" y2="100" className="stroke-sim-ink" strokeWidth="1.5" strokeDasharray="5 4" />
      <rect x="250" y="96" width="70" height="8" className="fill-sim-ink" />
      <rect x="330" y="90" width="4" height="20" className="fill-sim-signal" />
      <text x="336" y="86" textAnchor="end" className="fill-sim-ink text-[10px] font-semibold">
        Localizer
      </text>
      <Plane x={60} y={100} />
      <text x="40" y="60" className="fill-sim-ink text-[11px] font-semibold">
        90 Hz lobe (pilot's left)
      </text>
      <text x="40" y="150" className="fill-sim-ink text-[11px] font-semibold">
        150 Hz lobe (pilot's right)
      </text>
      <text x="150" y="94" className="fill-sim-muted text-[10px]">
        both equal: the centreline
      </text>
    </Frame>
  )
}

function Bars({ x, a, b, title, note, f90, f150 }: { x: number; a: number; b: number; title: string; note: string; f90: string; f150: string }) {
  return (
    <g>
      <text x={x} y="40" className="fill-sim-ink text-[11px] font-semibold">
        {title}
      </text>
      <rect x={x} y="52" width={a} height="16" className="fill-lobe-90" opacity="0.35" />
      <rect x={x} y="52" width={a} height="16" fill={f90} />
      <text x={x + a + 4} y="64" className="fill-sim-ink text-[10px]">
        90 Hz
      </text>
      <rect x={x} y="76" width={b} height="16" className="fill-lobe-150" opacity="0.35" />
      <rect x={x} y="76" width={b} height="16" fill={f150} />
      <text x={x + b + 4} y="88" className="fill-sim-ink text-[10px]">
        150 Hz
      </text>
      <text x={x} y="112" className="fill-sim-muted text-[10px]">
        {note}
      </text>
    </g>
  )
}

export function CompareVisual() {
  const { defs, f90, f150 } = useTonePatterns()
  return (
    <Frame label="Two cases. On the centreline both tones are equally strong and the needle is centred. Left of it, the 90 Hz tone is stronger and the needle moves right: fly right.">
      {defs}
      <Bars x={20} a={80} b={80} title="On the centreline" note="Equal: needle centred" f90={f90} f150={f150} />
      <Bars x={200} a={115} b={45} title="Left of the centreline" note="90 Hz louder: fly right" f90={f90} f150={f150} />
      <text x="20" y="150" className="fill-sim-ink text-[12px]">
        The receiver only compares the two tones:
      </text>
      <text x="20" y="170" className="fill-sim-ink text-[12px] font-semibold">
        difference = 90 Hz − 150 Hz (the DDM)
      </text>
    </Frame>
  )
}

export function GlideslopeVisual() {
  const { defs, f90, f150 } = useTonePatterns()
  return (
    <Frame label="Seen from the side: the glideslope sends 90 Hz above the path and 150 Hz below it. Where they are equal is the 3 degree glide path down to the runway.">
      {defs}
      <path d="M 330 170 L 20 40 L 20 10 L 330 10 Z" className="fill-lobe-90" opacity="0.2" />
      <path d="M 330 170 L 20 40 L 20 10 L 330 10 Z" fill={f90} />
      <path d="M 330 170 L 20 40 L 20 170 Z" className="fill-lobe-150" opacity="0.2" />
      <path d="M 330 170 L 20 40 L 20 170 Z" fill={f150} />
      <line x1="330" y1="170" x2="20" y2="40" className="stroke-sim-ink" strokeWidth="2" />
      <rect x="270" y="170" width="80" height="6" className="fill-sim-ink" />
      <Plane x={110} y={78} rotate={23} />
      <text x="40" y="28" className="fill-sim-ink text-[11px] font-semibold">
        90 Hz louder above: fly down
      </text>
      <text x="40" y="160" className="fill-sim-ink text-[11px] font-semibold">
        150 Hz louder below: fly up
      </text>
      <text x="190" y="98" className="fill-sim-ink text-[11px] font-semibold" transform="rotate(23 190 98)">
        glide path about 3°
      </text>
      <text x="220" y="192" className="fill-sim-muted text-[10px]">
        Heights exaggerated
      </text>
    </Frame>
  )
}

export function NeedlesVisual() {
  return (
    <Frame label="The cockpit display: a vertical needle for the localizer and a horizontal needle for the glideslope. The needles point to where the path is.">
      <rect x="110" y="10" width="140" height="140" rx="12" className="fill-instrument-bezel" />
      <circle cx="180" cy="80" r="62" className="fill-instrument-face" />
      {[-2, -1, 1, 2].map((k) => (
        <circle key={k} cx={180 + k * 20} cy="80" r="3" className="fill-none stroke-instrument-marking" strokeWidth="1.5" />
      ))}
      {[-2, -1, 1, 2].map((k) => (
        <circle key={`v${k}`} cx="226" cy={80 + k * 16} r="3" className="fill-none stroke-instrument-marking" strokeWidth="1.5" />
      ))}
      <line x1="200" y1="35" x2="200" y2="125" className="stroke-instrument-needle" strokeWidth="3.5" strokeLinecap="round" />
      <line x1="140" y1="64" x2="220" y2="64" className="stroke-instrument-needle" strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="180" cy="80" r="5" className="fill-none stroke-instrument-marking" strokeWidth="1.5" />
      <text x="20" y="176" className="fill-sim-ink text-[11px]">
        Needle right of centre: the course is to the right, fly right.
      </text>
      <text x="20" y="193" className="fill-sim-ink text-[11px]">
        Needle above centre: the path is above you, fly up.
      </text>
    </Frame>
  )
}

export function MarkersVisual() {
  const reduced = useReducedMotion()
  const cones = [
    { x: 80, label: 'O', cls: 'fill-marker-outer', name: 'Outer 400 Hz', w: 46 },
    { x: 220, label: 'M', cls: 'fill-marker-middle', name: 'Middle 1300 Hz', w: 30 },
    { x: 300, label: 'I', cls: 'fill-sim-neutral', name: 'Inner 3000 Hz', w: 20 },
  ]
  return (
    <Frame label="Marker beacons along the approach beam straight up. Flying over one, a lamp lights and a tone sounds: outer (blue, 400 hertz), middle (amber, 1300 hertz), inner (white, 3000 hertz).">
      <line x1="20" y1="170" x2="340" y2="170" className="stroke-sim-ink" strokeWidth="2" />
      {cones.map((c) => (
        <g key={c.label}>
          <path d={`M ${c.x} 170 L ${c.x - c.w} 30 L ${c.x + c.w} 30 Z`} className={c.cls} opacity="0.25" />
          <circle cx={c.x} cy="170" r="8" className={c.cls} />
          <text x={c.x} y="174" textAnchor="middle" className="fill-scope-bg text-[10px] font-bold">
            {c.label}
          </text>
          <text x={c.x} y="190" textAnchor="middle" className="fill-sim-ink text-[10px]">
            {c.name}
          </text>
        </g>
      ))}
      <line x1="20" y1="40" x2="340" y2="160" className="stroke-sim-grid-strong" strokeDasharray="4 4" />
      <g>
        {!reduced && <animateMotion path="M 20 40 L 330 156" dur="6s" repeatCount="indefinite" />}
        <g transform={reduced ? 'translate(80 62)' : undefined}>
          <Plane x={0} y={0} rotate={21} />
        </g>
      </g>
    </Frame>
  )
}

export function MinimumsVisual() {
  return (
    <Frame label="Fog over the approach. At the decision height, 200 feet for CAT I, the pilot must see the approach lights or the runway, or else go around. Lower categories allow lower decision heights in thicker fog.">
      <rect x="0" y="60" width="360" height="120" className="fill-sim-fog" opacity="0.7" />
      <line x1="20" y1="30" x2="300" y2="170" className="stroke-sim-ink" strokeWidth="1.5" strokeDasharray="4 3" />
      <line x1="20" y1="120" x2="340" y2="120" className="stroke-sim-alert" strokeDasharray="6 4" />
      <text x="24" y="114" className="fill-sim-alert text-[11px] font-semibold">
        Decision height: see the lights, or go around
      </text>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <circle key={i} cx={210 + i * 14} cy="172" r="3" className="fill-sim-ink" />
      ))}
      <rect x="296" y="168" width="60" height="6" className="fill-sim-ink" />
      <text x="20" y="194" className="fill-sim-muted text-[10px]">
        CAT I 200 ft · CAT II 100 ft · CAT III lower
      </text>
    </Frame>
  )
}

export function HonestVisual() {
  return (
    <Frame label="A truck parked near the localizer reflects its signal and bends the course. A monitor watches the signal and switches the ILS off if it goes wrong.">
      <rect x="20" y="96" width="220" height="10" className="fill-sim-ink" />
      <rect x="300" y="84" width="6" height="34" className="fill-sim-signal" />
      <rect x="258" y="62" width="30" height="16" rx="2" className="fill-sim-warning" />
      <text x="273" y="56" textAnchor="middle" className="fill-sim-ink text-[10px] font-semibold">
        truck
      </text>
      <path d="M 300 101 Q 200 101 140 90 T 20 70" className="fill-none stroke-sim-warning" strokeWidth="2" strokeDasharray="5 3" />
      <line x1="300" y1="101" x2="20" y2="101" className="stroke-sim-bg" strokeWidth="1.5" strokeDasharray="4 4" />
      <text x="20" y="60" className="fill-sim-ink text-[11px] font-semibold">
        Bent course: the needle lies
      </text>
      <rect x="250" y="140" width="96" height="36" rx="6" className="fill-card stroke-sim-grid-strong" />
      <text x="298" y="156" textAnchor="middle" className="fill-sim-ink text-[10px] font-semibold">
        Monitor
      </text>
      <text x="298" y="170" textAnchor="middle" className="fill-sim-muted text-[10px]">
        wrong? switch off
      </text>
      <text x="20" y="160" className="fill-sim-muted text-[11px]">
        Keep the critical area clear,
      </text>
      <text x="20" y="176" className="fill-sim-muted text-[11px]">
        and trust the flag.
      </text>
    </Frame>
  )
}
