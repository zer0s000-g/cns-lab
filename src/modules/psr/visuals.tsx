import { useReducedMotion } from '@/stores/prefs'

/**
 * Small animated diagrams for "How it works". Animations use SVG <animate>
 * and are left out entirely when the learner prefers reduced motion.
 */

function Frame({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <svg viewBox="0 0 360 200" role="img" aria-label={label} className="h-auto w-full rounded-md border bg-sim-bg">
      {children}
    </svg>
  )
}

function Radar({ x = 40, y = 150 }: { x?: number; y?: number }) {
  return (
    <g>
      <rect x={x - 4} y={y - 4} width="8" height="30" className="fill-sim-neutral" />
      <path d={`M ${x - 18} ${y - 18} Q ${x} ${y + 6} ${x + 18} ${y - 18}`} className="fill-none stroke-sim-signal" strokeWidth="4" />
      <text x={x} y={y + 42} textAnchor="middle" className="fill-sim-ink text-[11px] font-semibold">
        Radar
      </text>
    </g>
  )
}

function Plane({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d="M-14 0 L10 -3 L14 0 L10 3 Z M-2 -1 L-8 -12 L-4 -12 L4 -1 Z M-2 1 L-8 12 L-4 12 L4 1 Z M-12 -1 L-15 -6 L-13 -6 L-9 -1 Z" className="fill-sim-ink" />
    </g>
  )
}

export function PulseOutVisual() {
  const reduced = useReducedMotion()
  return (
    <Frame label="A radar dish sends a short pulse of radio energy toward the sky.">
      <Radar />
      {[0, 1, 2].map((i) => (
        <path key={i} d="M 70 120 q 20 -20 0 -40" className="fill-none stroke-sim-signal" strokeWidth="3" opacity={reduced ? 1 - i * 0.3 : 0} transform={reduced ? `translate(${i * 60} ${-i * 25})` : undefined}>
          {!reduced && (
            <>
              <animateTransform attributeName="transform" type="translate" from="0 0" to="240 -100" dur="2.4s" begin={`${i * 0.8}s`} repeatCount="indefinite" />
              <animate attributeName="opacity" values="1;1;0" dur="2.4s" begin={`${i * 0.8}s`} repeatCount="indefinite" />
            </>
          )}
        </path>
      ))}
      <text x="200" y="185" textAnchor="middle" className="fill-sim-muted text-[11px]">
        Pulse lasts about one millionth of a second
      </text>
    </Frame>
  )
}

export function EchoVisual() {
  const reduced = useReducedMotion()
  return (
    <Frame label="The pulse hits an aircraft and a tiny part of it bounces back to the radar as an echo.">
      <Radar />
      <Plane x={290} y={50} />
      <line x1="50" y1="130" x2="280" y2="55" className="stroke-sim-grid-strong" strokeDasharray="4 4" />
      <circle r="5" className="fill-sim-signal">
        {!reduced ? <animateMotion path="M 50 130 L 280 55" dur="1.6s" repeatCount="indefinite" /> : null}
      </circle>
      <circle r="3.5" className="fill-sim-ink" cx={reduced ? 160 : undefined} cy={reduced ? 94 : undefined}>
        {!reduced ? <animateMotion path="M 280 55 L 50 130" dur="1.6s" begin="0.8s" repeatCount="indefinite" /> : null}
      </circle>
      <text x="180" y="185" textAnchor="middle" className="fill-sim-muted text-[11px]">
        The echo is billions of times weaker than the pulse
      </text>
    </Frame>
  )
}

export function TimingVisual() {
  return (
    <Frame label="A timeline: the echo time is split into the trip out and the trip back, so the distance is half the time multiplied by the speed of light.">
      <text x="20" y="40" className="fill-sim-ink text-[12px] font-semibold">
        Time from pulse to echo
      </text>
      <rect x="20" y="60" width="160" height="28" rx="4" className="fill-sim-signal" opacity="0.85" />
      <rect x="180" y="60" width="160" height="28" rx="4" className="fill-sim-signal-2" opacity="0.6" />
      <text x="100" y="79" textAnchor="middle" className="fill-primary-foreground text-[11px] font-semibold">
        trip out
      </text>
      <text x="260" y="79" textAnchor="middle" className="fill-sim-ink text-[11px] font-semibold">
        trip back
      </text>
      <text x="20" y="120" className="fill-sim-ink text-[12px]">
        An echo after 494 µs means 247 µs each way.
      </text>
      <text x="20" y="142" className="fill-sim-ink text-[12px]">
        Radio covers 1 NM in about 6.2 µs, so 247 µs ≈ 40 NM.
      </text>
      <text x="20" y="175" className="fill-sim-muted text-[11px]">
        That is why we halve the time.
      </text>
    </Frame>
  )
}

export function DirectionVisual() {
  const reduced = useReducedMotion()
  return (
    <Frame label="Seen from above, the narrow beam turns like a lighthouse. The direction it points when the echo returns is the aircraft's bearing.">
      <circle cx="180" cy="100" r="85" className="fill-none stroke-sim-grid" />
      <circle cx="180" cy="100" r="45" className="fill-none stroke-sim-grid" />
      <g>
        <path d="M 180 100 L 176 15 L 184 15 Z" className="fill-sim-signal" opacity="0.6" />
        {!reduced && <animateTransform attributeName="transform" type="rotate" from="0 180 100" to="360 180 100" dur="4.8s" repeatCount="indefinite" />}
      </g>
      <circle cx="180" cy="100" r="5" className="fill-sim-signal" />
      <text x="180" y="12" textAnchor="middle" className="fill-sim-muted text-[10px] font-semibold">
        N
      </text>
      <Plane x={245} y={60} />
      <text x="20" y="190" className="fill-sim-muted text-[11px]">
        One full turn every few seconds
      </text>
    </Frame>
  )
}

export function ScreenVisual() {
  return (
    <Frame label="A radar screen with range rings. Each echo is drawn as a glowing blip that fades until the sweep comes round again.">
      <rect x="0" y="0" width="360" height="200" className="fill-scope-bg" />
      {[30, 60, 90].map((r) => (
        <circle key={r} cx="180" cy="100" r={r} className="fill-none stroke-scope-grid" />
      ))}
      <line x1="180" y1="100" x2="250" y2="36" className="stroke-scope-trace" strokeWidth="2" />
      <rect x="226" y="52" width="10" height="4" rx="2" className="fill-scope-blip" />
      <rect x="120" y="130" width="10" height="4" rx="2" className="fill-scope-blip" opacity="0.5" />
      <rect x="200" y="160" width="10" height="4" rx="2" className="fill-scope-blip" opacity="0.25" />
      <text x="12" y="190" className="fill-scope-dim text-[11px]">
        Older blips fade: the screen shows one turn of memory
      </text>
    </Frame>
  )
}

export function LimitsVisual() {
  return (
    <Frame label="A blip shows only a position. It does not say which aircraft it is or how high it flies.">
      <rect x="0" y="0" width="360" height="200" className="fill-scope-bg" />
      <rect x="160" y="80" width="14" height="5" rx="2" className="fill-scope-blip" />
      <text x="190" y="80" className="fill-scope-text text-[14px] font-semibold">
        ?
      </text>
      <text x="200" y="100" className="fill-scope-dim text-[11px]">
        Who are you?
      </text>
      <text x="200" y="116" className="fill-scope-dim text-[11px]">
        How high are you?
      </text>
      <text x="12" y="190" className="fill-scope-dim text-[11px]">
        Primary radar cannot answer either question
      </text>
    </Frame>
  )
}
