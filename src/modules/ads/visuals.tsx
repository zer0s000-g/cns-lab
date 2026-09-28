import { useReducedMotion } from '@/stores/prefs'

/**
 * Small diagrams for "How it works". Animations use SVG <animate> and are
 * left out when the learner prefers reduced motion.
 */

function Frame({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <svg viewBox="0 0 360 200" role="img" aria-label={label} className="h-auto w-full rounded-md border bg-sim-bg">
      {children}
    </svg>
  )
}

function Plane({ x, y, label, dim }: { x: number; y: number; label?: string; dim?: boolean }) {
  return (
    <g transform={`translate(${x} ${y})`} opacity={dim ? 0.5 : 1}>
      <path d="M-14 0 L10 -3 L14 0 L10 3 Z M-2 -1 L-8 -12 L-4 -12 L4 -1 Z M-2 1 L-8 12 L-4 12 L4 1 Z M-12 -1 L-15 -6 L-13 -6 L-9 -1 Z" className="fill-sim-ink" />
      {label && (
        <text x="0" y="-16" textAnchor="middle" className="fill-sim-ink text-[10px] font-semibold">
          {label}
        </text>
      )}
    </g>
  )
}

function Satellite({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x="-4" y="-4" width="8" height="8" className="fill-sim-signal" />
      <rect x="-16" y="-2" width="10" height="4" className="fill-sim-signal" opacity="0.6" />
      <rect x="6" y="-2" width="10" height="4" className="fill-sim-signal" opacity="0.6" />
    </g>
  )
}

function Receiver({ x, y, label }: { x: number; y: number; label?: string }) {
  return (
    <g>
      <path d={`M ${x} ${y - 9} L ${x + 8} ${y + 6} L ${x - 8} ${y + 6} Z`} className="fill-sim-bg stroke-sim-signal" strokeWidth="2" />
      {label && (
        <text x={x} y={y + 20} textAnchor="middle" className="fill-sim-ink text-[10px] font-semibold">
          {label}
        </text>
      )}
    </g>
  )
}

export function GnssVisual() {
  return (
    <Frame label="Several GNSS satellites send timing signals; the aircraft's receiver works out its own position from them.">
      {[60, 150, 240, 310].map((x, i) => (
        <g key={x}>
          <Satellite x={x} y={28 + (i % 2) * 14} />
          <line x1={x} y1={34 + (i % 2) * 14} x2="180" y2="128" className="stroke-sim-grid-strong" strokeDasharray="4 4" />
        </g>
      ))}
      <Plane x={180} y={132} label="I am here" />
      <text x="180" y="186" textAnchor="middle" className="fill-sim-muted text-[11px]">
        The aircraft finds its own position with GNSS
      </text>
    </Frame>
  )
}

export function BroadcastVisual() {
  const reduced = useReducedMotion()
  return (
    <Frame label="The aircraft broadcasts its position, speed and callsign on 1090 megahertz about twice a second, to anyone listening.">
      <Plane x={180} y={90} label="CNS101" />
      {[0, 1, 2].map((i) =>
        reduced ? (
          <circle key={i} cx="180" cy="90" r={30 + i * 30} className="fill-none stroke-sim-signal" opacity={0.6 - i * 0.15} />
        ) : (
          <circle key={i} cx="180" cy="90" r="10" className="fill-none stroke-sim-signal" strokeWidth="2">
            <animate attributeName="r" from="10" to="100" dur="1.5s" begin={`${i * 0.5}s`} repeatCount="indefinite" />
            <animate attributeName="opacity" from="0.8" to="0" dur="1.5s" begin={`${i * 0.5}s`} repeatCount="indefinite" />
          </circle>
        ),
      )}
      <rect x="226" y="120" width="124" height="54" rx="4" className="fill-sim-bg stroke-sim-grid-strong" />
      <text x="234" y="136" className="fill-sim-ink font-mono text-[10px]">
        CNS101 · 8A01A1
      </text>
      <text x="234" y="150" className="fill-sim-ink font-mono text-[10px]">
        5.70°S 106.97°E
      </text>
      <text x="234" y="164" className="fill-sim-ink font-mono text-[10px]">
        FL120 · 280 kt · 090°
      </text>
      <text x="16" y="186" className="fill-sim-muted text-[11px]">
        About twice a second, on 1090 MHz
      </text>
    </Frame>
  )
}

export function ReceiversVisual() {
  return (
    <Frame label="Ground receivers pick up the broadcasts when they have a straight line of sight to the aircraft. A higher aircraft can be heard from further away, because the curve of the Earth hides low aircraft.">
      <path d="M 0 170 Q 180 140 360 170 L 360 200 L 0 200 Z" className="fill-sim-land" />
      <Receiver x={90} y={150} label="Receiver" />
      <Plane x={290} y={40} label="high: heard" />
      <Plane x={320} y={150} label="low: hidden" dim />
      <line x1="90" y1="142" x2="280" y2="44" className="stroke-sim-signal" strokeWidth="1.5" />
      <line x1="90" y1="142" x2="306" y2="150" className="stroke-sim-muted" strokeDasharray="3 3" />
      <text x="16" y="24" className="fill-sim-ink text-[11px] font-semibold">
        No rotating antenna: just listen
      </text>
      <text x="16" y="40" className="fill-sim-muted text-[10.5px]">
        Coverage = line of sight, like any VHF-and-up radio
      </text>
    </Frame>
  )
}

export function QualityVisual() {
  return (
    <Frame label="Each position comes with quality numbers. A high NACp means a small uncertainty circle; a low NACp means a large one.">
      <g>
        <circle cx="95" cy="95" r="8" className="fill-sim-signal" opacity="0.2" />
        <circle cx="95" cy="95" r="8" className="fill-none stroke-sim-signal" strokeDasharray="3 3" />
        <path d="M 95 88 L 102 95 L 95 102 L 88 95 Z" className="fill-sim-ink" />
        <text x="95" y="140" textAnchor="middle" className="fill-sim-ink text-[11px] font-semibold">
          NACp 10
        </text>
        <text x="95" y="155" textAnchor="middle" className="fill-sim-muted text-[10px]">
          within 10 m
        </text>
      </g>
      <g>
        <circle cx="255" cy="90" r="46" className="fill-sim-warning" opacity="0.12" />
        <circle cx="255" cy="90" r="46" className="fill-none stroke-sim-warning" strokeDasharray="4 4" />
        <path d="M 262 70 L 269 77 L 262 84 L 255 77 Z" className="fill-sim-ink" />
        <text x="255" y="152" textAnchor="middle" className="fill-sim-ink text-[11px] font-semibold">
          NACp 6
        </text>
        <text x="255" y="167" textAnchor="middle" className="fill-sim-muted text-[10px]">
          within 0.3 NM (556 m)
        </text>
      </g>
      <text x="16" y="190" className="fill-sim-muted text-[11px]">
        The true position is somewhere inside the circle (95% of the time)
      </text>
    </Frame>
  )
}

export function AdsbInVisual() {
  return (
    <Frame label="With ADS-B In, the pilot's display shows other aircraft around their own, each with its height difference in hundreds of feet.">
      <rect x="0" y="0" width="360" height="200" className="fill-instrument-bezel" />
      <circle cx="180" cy="100" r="88" className="fill-instrument-face" />
      <circle cx="180" cy="100" r="40" className="fill-none stroke-instrument-dim" strokeDasharray="2 4" />
      <circle cx="180" cy="100" r="78" className="fill-none stroke-instrument-dim" strokeDasharray="2 4" />
      <path d="M 180 88 L 184 104 L 180 100 L 176 104 Z" className="fill-instrument-marking" />
      <path d="M 225 60 L 230 72 L 225 69 L 220 72 Z" className="fill-instrument-accent" />
      <text x="234" y="64" className="fill-instrument-accent font-mono text-[11px] font-semibold">
        +05↑
      </text>
      <path d="M 130 128 L 135 140 L 130 137 L 125 140 Z" className="fill-instrument-accent" transform="rotate(200 130 134)" />
      <text x="96" y="152" className="fill-instrument-accent font-mono text-[11px] font-semibold">
        −12
      </text>
      <text x="12" y="20" className="fill-instrument-dim text-[10px]">
        +05 = 500 ft above you
      </text>
    </Frame>
  )
}

export function AdscVisual() {
  const reduced = useReducedMotion()
  return (
    <Frame label="ADS-C: over the ocean, the aircraft sends its reports only to one control centre, through a satellite, at agreed times or when something changes.">
      <path d="M 0 150 L 60 150 Q 70 170 60 200 L 0 200 Z" className="fill-sim-land" />
      <rect x="60" y="150" width="300" height="50" className="fill-sim-water" />
      <Satellite x={180} y={24} />
      <Plane x={280} y={120} label="CNS808" />
      <path d="M 20 146 L 28 132 L 36 146 Z" className="fill-sim-bg stroke-sim-signal" strokeWidth="2" />
      <text x="30" y="166" textAnchor="middle" className="fill-sim-ink text-[10px] font-semibold">
        Oceanic
      </text>
      <text x="30" y="178" textAnchor="middle" className="fill-sim-ink text-[10px] font-semibold">
        centre
      </text>
      <path d="M 280 112 L 180 30 L 30 132" className="fill-none stroke-sim-grid-strong" strokeDasharray="4 4" />
      <circle r="4" className="fill-sim-warning" cx={reduced ? 230 : undefined} cy={reduced ? 71 : undefined}>
        {!reduced && <animateMotion path="M 280 112 L 180 30 L 30 132" dur="3s" repeatCount="indefinite" />}
      </circle>
      <text x="200" y="176" className="fill-sim-ink text-[10.5px]">
        Every 14 min, or when something changes
      </text>
      <text x="200" y="190" className="fill-sim-muted text-[10px]">
        Only this centre receives it
      </text>
    </Frame>
  )
}

export function DependencyVisual() {
  return (
    <Frame label="ADS-B depends on GNSS. If GNSS is jammed, the aircraft loses its position and ADS-B shows nothing, while radar still sees the aircraft. A fake ADS-B target has no radar echo behind it.">
      <text x="16" y="28" className="fill-sim-ink text-[12px] font-semibold">
        GNSS jammed
      </text>
      <path d="M 20 60 L 28 76 L 20 70 L 12 76 Z" className="fill-sim-ink" transform="rotate(90 20 70)" />
      <text x="40" y="74" className="fill-sim-ink text-[11px]">
        ADS-B: position lost
      </text>
      <rect x="14" y="88" width="12" height="12" className="fill-none stroke-sim-ink" strokeWidth="1.8" />
      <text x="40" y="99" className="fill-sim-ink text-[11px]">
        Radar: still there
      </text>
      <text x="196" y="28" className="fill-sim-ink text-[12px] font-semibold">
        Spoofed ghost
      </text>
      <path d="M 210 64 L 218 72 L 210 80 L 202 72 Z" className="fill-none stroke-sim-warning" strokeWidth="1.8" />
      <text x="226" y="70" className="fill-sim-ink text-[11px]">
        ADS-B: "CNS777"
      </text>
      <text x="226" y="86" className="fill-sim-warning text-[11px] font-semibold">
        NO RADAR
      </text>
      <text x="16" y="150" className="fill-sim-ink text-[11px]">
        Radar and multilateration measure the aircraft themselves,
      </text>
      <text x="16" y="166" className="fill-sim-ink text-[11px]">
        so they catch both problems.
      </text>
    </Frame>
  )
}
