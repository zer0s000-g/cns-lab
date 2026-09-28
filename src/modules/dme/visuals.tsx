import { useReducedMotion } from '@/stores/prefs'

/**
 * Small diagrams for "How it works". Animations use SVG <animate> and are
 * left out entirely when the learner prefers reduced motion.
 */

function Frame({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <svg viewBox="0 0 360 200" role="img" aria-label={label} className="h-auto w-full rounded-md border bg-sim-bg">
      {children}
    </svg>
  )
}

function Plane({ x, y, flip = false }: { x: number; y: number; flip?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${flip ? -1 : 1} 1)`}>
      <path d="M-14 0 L10 -3 L14 0 L10 3 Z M-2 -1 L-8 -12 L-4 -12 L4 -1 Z M-2 1 L-8 12 L-4 12 L4 1 Z M-12 -1 L-15 -6 L-13 -6 L-9 -1 Z" className="fill-sim-ink" />
    </g>
  )
}

function Station({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <rect x={x - 3} y={y - 28} width="6" height="28" className="fill-sim-neutral" />
      <rect x={x - 9} y={y - 36} width="18" height="10" rx="2" className="fill-sim-signal" />
      <text x={x} y={y + 14} textAnchor="middle" className="fill-sim-ink text-[11px] font-semibold">
        DME station
      </text>
    </g>
  )
}

/** Two short bars: a pulse pair. */
function PulsePair({ gap = 10, className = 'fill-sim-signal' }: { gap?: number; className?: string }) {
  return (
    <g>
      <rect x={-gap / 2 - 2} y={-9} width="4" height="18" rx="2" className={className} />
      <rect x={gap / 2 - 2} y={-9} width="4" height="18" rx="2" className={className} />
    </g>
  )
}

export function AskVisual() {
  const reduced = useReducedMotion()
  return (
    <Frame label="The aircraft sends a question to the ground station: two short radio pulses, a pulse pair.">
      <Plane x={50} y={60} />
      <Station x={300} y={170} />
      <line x1="64" y1="66" x2="296" y2="134" className="stroke-sim-grid-strong" strokeDasharray="4 4" />
      <g transform={reduced ? 'translate(180 100)' : undefined}>
        {!reduced && <animateMotion path="M 64 66 L 296 134" dur="2.4s" repeatCount="indefinite" />}
        <PulsePair />
      </g>
      <text x="20" y="190" className="fill-sim-muted text-[11px]">
        Question: two pulses 12 µs apart
      </text>
    </Frame>
  )
}

export function WaitVisual() {
  const reduced = useReducedMotion()
  return (
    <Frame label="The ground station hears the question, waits exactly 50 microseconds, then answers.">
      <Station x={180} y={170} />
      <circle cx="180" cy="80" r="34" className="fill-none stroke-sim-grid-strong" strokeWidth="8" />
      <circle
        cx="180"
        cy="80"
        r="34"
        className="fill-none stroke-sim-signal"
        strokeWidth="8"
        strokeDasharray="213.6"
        strokeDashoffset={reduced ? 60 : 213.6}
        transform="rotate(-90 180 80)"
      >
        {!reduced && <animate attributeName="stroke-dashoffset" values="213.6;0;0" keyTimes="0;0.8;1" dur="2.4s" repeatCount="indefinite" />}
      </circle>
      <text x="180" y="78" textAnchor="middle" className="fill-sim-ink text-[15px] font-semibold">
        50 µs
      </text>
      <text x="180" y="94" textAnchor="middle" className="fill-sim-muted text-[10px]">
        always the same
      </text>
      <text x="20" y="30" className="fill-sim-muted text-[11px]">
        Like the cliff that politely counts before shouting back
      </text>
    </Frame>
  )
}

export function AnswerVisual() {
  const reduced = useReducedMotion()
  return (
    <Frame label="The station sends its answer, another pulse pair, back to the aircraft. The aircraft stops its stopwatch.">
      <Plane x={50} y={60} />
      <Station x={300} y={170} />
      <line x1="64" y1="66" x2="296" y2="134" className="stroke-sim-grid-strong" strokeDasharray="4 4" />
      <g transform={reduced ? 'translate(180 100)' : undefined}>
        {!reduced && <animateMotion path="M 296 134 L 64 66" dur="2.4s" repeatCount="indefinite" />}
        <PulsePair className="fill-sim-signal-2" />
      </g>
      <text x="20" y="190" className="fill-sim-muted text-[11px]">
        Answer on a frequency 63 MHz away from the question
      </text>
    </Frame>
  )
}

export function MathVisual() {
  return (
    <Frame label="A timeline: trip out, the fixed 50 microsecond wait, and trip back. Take away the wait, halve the rest, and convert to distance.">
      <text x="20" y="34" className="fill-sim-ink text-[12px] font-semibold">
        Stopwatch after 421 µs (aircraft 30 NM away)
      </text>
      <rect x="20" y="50" width="140" height="28" rx="4" className="fill-sim-signal" opacity="0.85" />
      <rect x="160" y="50" width="40" height="28" className="fill-sim-neutral" opacity="0.5" />
      <rect x="200" y="50" width="140" height="28" rx="4" className="fill-sim-signal-2" opacity="0.6" />
      <text x="90" y="69" textAnchor="middle" className="fill-primary-foreground text-[11px] font-semibold">
        out 185 µs
      </text>
      <text x="180" y="69" textAnchor="middle" className="fill-sim-ink text-[10px] font-semibold">
        50
      </text>
      <text x="270" y="69" textAnchor="middle" className="fill-sim-ink text-[11px] font-semibold">
        back 185 µs
      </text>
      <text x="20" y="112" className="fill-sim-ink text-[12px]">
        421 − 50 = 371 µs there and back
      </text>
      <text x="20" y="134" className="fill-sim-ink text-[12px]">
        Each NM there and back takes 12.36 µs
      </text>
      <text x="20" y="156" className="fill-sim-ink text-[12px] font-semibold">
        371 ÷ 12.36 ≈ 30 NM
      </text>
    </Frame>
  )
}

export function SlantVisual() {
  return (
    <Frame label="A right triangle: the ground distance along the bottom, the height up the side and the slant range on the diagonal. The DME measures the diagonal.">
      <line x1="40" y1="160" x2="300" y2="160" className="stroke-sim-ink" strokeWidth="2" />
      <line x1="300" y1="160" x2="300" y2="50" className="stroke-sim-muted" strokeWidth="2" strokeDasharray="4 3" />
      <line x1="40" y1="160" x2="300" y2="50" className="stroke-primary" strokeWidth="3" />
      <Station x={40} y={160} />
      <Plane x={300} y={44} />
      <text x="170" y="178" textAnchor="middle" className="fill-sim-ink text-[11px] font-semibold">
        ground distance
      </text>
      <text x="306" y="110" className="fill-sim-muted text-[11px]">
        height
      </text>
      <text x="150" y="92" textAnchor="middle" transform="rotate(-23 150 92)" className="fill-primary text-[11px] font-semibold">
        slant range (DME)
      </text>
      <text x="20" y="22" className="fill-sim-muted text-[11px]">
        Right over the station, slant range = height
      </text>
    </Frame>
  )
}

export function SpeedVisual() {
  return (
    <Frame label="Flying straight at the station, the distance shrinks as fast as you fly. Circling the station, the distance does not change, so the DME groundspeed reads zero.">
      <circle cx="250" cy="100" r="60" className="fill-none stroke-sim-grid-strong" strokeDasharray="4 4" />
      <rect x="244" y="94" width="12" height="12" className="fill-sim-signal" />
      <line x1="30" y1="100" x2="150" y2="100" className="stroke-primary" strokeWidth="2" markerEnd="url(#dme-arrow)" />
      <defs>
        <marker id="dme-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0 0 L10 5 L0 10 Z" className="fill-primary" />
        </marker>
      </defs>
      <Plane x={40} y={82} />
      <Plane x={250} y={40} />
      <text x="30" y="130" className="fill-sim-ink text-[11px]">
        Straight in: DME speed = true speed
      </text>
      <text x="196" y="186" className="fill-sim-ink text-[11px]">
        Circling: DME speed ≈ 0
      </text>
    </Frame>
  )
}

export function ManyVisual() {
  return (
    <Frame label="Many aircraft ask the same station. Each spaces its questions randomly, so only its own answers keep coming back at the same delay. If too many ask, the station answers the closest first.">
      <Station x={180} y={162} />
      {[
        [50, 56],
        [110, 40],
        [260, 46],
        [320, 76],
        [30, 116],
        [330, 136],
      ].map(([x, y], i) => (
        <Plane key={i} x={x} y={y} flip={x > 180} />
      ))}
      {[40, 80, 120].map((r) => (
        <circle key={r} cx="180" cy="130" r={r} className="fill-none stroke-sim-grid" />
      ))}
      <text x="12" y="20" className="fill-sim-muted text-[11px]">
        Up to about 100 aircraft share one station
      </text>
    </Frame>
  )
}
