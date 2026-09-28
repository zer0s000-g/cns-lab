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

function Mast({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <line x1={x} y1={y} x2={x} y2={y - 46} className="stroke-sim-ink" strokeWidth="3" />
      <line x1={x - 16} y1={y} x2={x} y2={y - 46} className="stroke-sim-neutral" strokeWidth="1.5" />
      <line x1={x + 16} y1={y} x2={x} y2={y - 46} className="stroke-sim-neutral" strokeWidth="1.5" />
      <circle cx={x} cy={y - 48} r="3" className="fill-sim-signal" />
    </g>
  )
}

/** Plane seen from above, nose up, centred at (x, y). */
function PlaneTop({ x, y, rot = 0, s = 1 }: { x: number; y: number; rot?: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${s})`}>
      <path d="M0 -14 L2 -5 L13 1 L13 4 L2 1 L1.6 8 L5 11 L5 13 L0 11.5 L-5 13 L-5 11 L-1.6 8 L-2 1 L-13 4 L-13 1 L-2 -5 Z" className="fill-sim-ink" />
    </g>
  )
}

export function BeaconVisual() {
  const reduced = useReducedMotion()
  return (
    <Frame label="A radio mast sends the same signal in every direction. The waves spread out in circles and hug the ground, following the curve of the Earth.">
      <path d="M 0 170 Q 180 140 360 170 L 360 200 L 0 200 Z" className="fill-sim-land" />
      <Mast x={180} y={152} />
      {[0, 1, 2, 3].map((i) => (
        <circle
          key={i}
          cx="180"
          cy="104"
          r={reduced ? 20 + i * 30 : 10}
          className="fill-none stroke-sim-signal"
          strokeWidth="2"
          opacity={reduced ? 0.8 - i * 0.18 : 0}
        >
          {!reduced && (
            <>
              <animate attributeName="r" from="8" to="130" dur="3.2s" begin={`${i * 0.8}s`} repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.9;0.5;0" dur="3.2s" begin={`${i * 0.8}s`} repeatCount="indefinite" />
            </>
          )}
        </circle>
      ))}
      <text x="12" y="22" className="fill-sim-ink stroke-sim-bg text-[12px] font-semibold" strokeWidth="4" paintOrder="stroke">
        Same signal, every direction
      </text>
      <text x="12" y="38" className="fill-sim-muted stroke-sim-bg text-[11px]" strokeWidth="4" paintOrder="stroke">
        Long waves (hundreds of metres) follow the ground
      </text>
    </Frame>
  )
}

function Lobes({ cx, cy, r, axis, cardioid }: { cx: number; cy: number; r: number; axis: number; cardioid: boolean }) {
  const pts: string[] = []
  const heart: string[] = []
  for (let a = 0; a <= 360; a += 4) {
    const rad = ((a - axis) * Math.PI) / 180
    const rr = r * Math.abs(Math.cos(rad))
    const t = (a * Math.PI) / 180
    pts.push(`${(cx + Math.sin(t) * rr).toFixed(1)},${(cy - Math.cos(t) * rr).toFixed(1)}`)
    const rh = (r * (1 + Math.cos(rad))) / 2
    heart.push(`${(cx + Math.sin(t) * rh).toFixed(1)},${(cy - Math.cos(t) * rh).toFixed(1)}`)
  }
  return (
    <g>
      <polyline points={pts.join(' ')} className="fill-none stroke-sim-ink" strokeWidth="1.8" strokeDasharray="5 4" />
      {cardioid && (
        <>
          <circle cx={cx} cy={cy} r={r / 2} className="fill-none stroke-sim-muted" strokeWidth="1.5" strokeDasharray="1.5 3" />
          <polygon points={heart.join(' ')} className="fill-sim-signal stroke-sim-signal" fillOpacity="0.2" strokeWidth="2" />
        </>
      )}
    </g>
  )
}

export function LoopVisual() {
  return (
    <Frame label="The loop antenna hears the beacon strongly along one line, both ways, and not at all side-on. So it cannot tell whether the beacon is in front or behind.">
      <Lobes cx={120} cy={100} r={70} axis={0} cardioid={false} />
      <PlaneTop x={120} y={100} />
      <line x1="120" y1="100" x2="120" y2="20" className="stroke-sim-signal" strokeWidth="2.5" />
      <path d="M120 14 L114 26 L126 26 Z" className="fill-sim-signal" />
      <line x1="120" y1="100" x2="120" y2="180" className="stroke-sim-warning" strokeWidth="2.5" strokeDasharray="4 3" />
      <path d="M120 186 L114 174 L126 174 Z" className="fill-sim-warning" />
      <text x="132" y="24" className="fill-sim-ink text-[11px] font-semibold">
        beacon here?
      </text>
      <text x="132" y="184" className="fill-sim-warning text-[11px] font-semibold">
        or here?
      </text>
      <text x="215" y="80" className="fill-sim-ink text-[12px] font-semibold">
        Loop antenna
      </text>
      <text x="215" y="98" className="fill-sim-muted text-[11px]">
        Strong both ways along
      </text>
      <text x="215" y="112" className="fill-sim-muted text-[11px]">
        one line, silent side-on
      </text>
      <text x="215" y="134" className="fill-sim-muted text-[11px]">
        Two answers, 180° apart
      </text>
    </Frame>
  )
}

export function SenseVisual() {
  return (
    <Frame label="Adding a simple sense antenna, which hears every direction equally, turns the loop's figure of eight into a heart shape that points only one way.">
      <Lobes cx={120} cy={104} r={72} axis={0} cardioid />
      <PlaneTop x={120} y={104} />
      <line x1="120" y1="104" x2="120" y2="22" className="stroke-sim-signal" strokeWidth="2.5" />
      <path d="M120 16 L114 28 L126 28 Z" className="fill-sim-signal" />
      <text x="132" y="24" className="fill-sim-ink text-[11px] font-semibold">
        beacon
      </text>
      <text x="215" y="70" className="fill-sim-ink text-[12px] font-semibold">
        Loop + sense
      </text>
      <text x="215" y="90" className="fill-sim-muted text-[11px]">
        - - loop: two-way
      </text>
      <text x="215" y="106" className="fill-sim-muted text-[11px]">
        ··· sense: all round
      </text>
      <text x="215" y="122" className="fill-sim-signal text-[11px] font-semibold">
        together: one way
      </text>
    </Frame>
  )
}

function Dial({ cx, cy, r, needle, card = 0, label, cardinals = false }: { cx: number; cy: number; r: number; needle: number; card?: number; label: string; cardinals?: boolean }) {
  const ticks = []
  for (let a = 0; a < 360; a += 30) {
    const t = ((a + card) * Math.PI) / 180
    ticks.push(
      <g key={a}>
        <line
          x1={cx + Math.sin(t) * r}
          y1={cy - Math.cos(t) * r}
          x2={cx + Math.sin(t) * (r - 7)}
          y2={cy - Math.cos(t) * (r - 7)}
          className="stroke-instrument-marking"
          strokeWidth="1.5"
        />
        <text x={cx + Math.sin(t) * (r - 16)} y={cy - Math.cos(t) * (r - 16) + 4} textAnchor="middle" className="fill-instrument-marking text-[9px] font-semibold">
          {cardinals && a % 90 === 0 ? ['N', 'E', 'S', 'W'][a / 90] : a / 10}
        </text>
      </g>,
    )
  }
  return (
    <g>
      <circle cx={cx} cy={cy} r={r + 6} className="fill-instrument-bezel" />
      <circle cx={cx} cy={cy} r={r} className="fill-instrument-face" />
      {ticks}
      <path d={`M${cx} ${cy - r - 1} l-5 -7 l10 0 z`} className="fill-instrument-accent" />
      <g transform={`rotate(${needle} ${cx} ${cy})`}>
        <line x1={cx} y1={cy + r * 0.72} x2={cx} y2={cy - r * 0.6} className="stroke-instrument-accent" strokeWidth="3.5" strokeLinecap="round" />
        <path d={`M${cx} ${cy - r * 0.8} l-7 14 l14 0 z`} className="fill-instrument-accent" />
        <path d={`M${cx - 6} ${cy + r * 0.78} L${cx} ${cy + r * 0.66} L${cx + 6} ${cy + r * 0.78}`} className="fill-none stroke-instrument-accent" strokeWidth="2" />
      </g>
      <text x={cx} y={cy + r + 20} textAnchor="middle" className="fill-sim-ink text-[11px] font-semibold">
        {label}
      </text>
    </g>
  )
}

export function NeedleVisual() {
  return (
    <Frame label="Seen from above, the beacon is 45 degrees to the right of the aircraft's nose. The ADF needle points 45 degrees right of the top of the dial: that is the relative bearing.">
      <PlaneTop x={70} y={120} s={1.5} />
      <circle cx="140" cy="50" r="7" className="fill-sim-bg stroke-sim-signal" strokeWidth="2" />
      <circle cx="140" cy="50" r="2.5" className="fill-sim-signal" />
      <text x="152" y="46" className="fill-sim-ink text-[11px] font-semibold">
        beacon
      </text>
      <line x1="70" y1="120" x2="70" y2="40" className="stroke-sim-muted" strokeWidth="1.5" strokeDasharray="4 3" />
      <line x1="70" y1="120" x2="136" y2="54" className="stroke-sim-signal" strokeWidth="2" />
      <path d="M 70 84 A 36 36 0 0 1 95 95" className="fill-none stroke-sim-ink" strokeWidth="1.5" />
      <text x="84" y="78" className="fill-sim-ink text-[11px] font-semibold">
        45°
      </text>
      <text x="20" y="180" className="fill-sim-muted text-[11px]">
        Angle from the nose
      </text>
      <Dial cx={270} cy={92} r={52} needle={45} label="ADF needle: 045" />
    </Frame>
  )
}

export function RmiVisual() {
  return (
    <Frame label="An RMI card turns with the heading. Heading 300 plus relative bearing 45 gives magnetic bearing 345 to the beacon, read under the needle head.">
      <Dial cx={80} cy={90} r={54} needle={45} card={-300} label="RMI: card turned to 300" cardinals />
      <text x="164" y="58" className="fill-sim-ink text-[12px] font-semibold">
        heading + relative bearing
      </text>
      <text x="164" y="82" className="fill-sim-ink font-mono text-[13px]">
        300° + 045° = 345°
      </text>
      <text x="164" y="106" className="fill-sim-muted text-[11px]">
        = magnetic bearing TO it
      </text>
      <text x="164" y="124" className="fill-sim-muted text-[11px]">
        Tail: 165°, the bearing FROM it
      </text>
      <text x="164" y="154" className="fill-sim-muted text-[11px]">
        Past 360°? Take 360 away.
      </text>
    </Frame>
  )
}

export function LimitsVisual() {
  return (
    <Frame label="Four things that fool the needle: waves bouncing off the sky at night, lightning, the signal bending at a coastline, and reflections from mountains.">
      <path d="M 0 60 Q 90 30 180 60" className="fill-none stroke-sim-muted" strokeWidth="1.5" strokeDasharray="5 4" />
      <text x="10" y="24" className="fill-sim-muted text-[10px]">
        night sky (ionosphere)
      </text>
      <Mast x={30} y={170} />
      <path d="M 30 122 L 95 52 L 160 150" className="fill-none stroke-sim-signal" strokeWidth="1.8" strokeDasharray="4 3" />
      <line x1="30" y1="160" x2="160" y2="160" className="stroke-sim-signal" strokeWidth="2" />
      <PlaneTop x={165} y={150} rot={90} s={0.8} />
      <text x="54" y="186" className="fill-sim-ink text-[11px] font-semibold">
        Night: sky wave
      </text>
      <path d="M 238 20 L 228 44 L 236 44 L 224 72" className="fill-none stroke-sim-warning" strokeWidth="2.5" strokeLinejoin="round" />
      <text x="246" y="46" className="fill-sim-ink text-[11px] font-semibold">
        Lightning
      </text>
      <path d="M 300 104 L 318 70 L 336 104 Z" className="fill-sim-terrain-high" />
      <text x="286" y="122" className="fill-sim-ink text-[11px] font-semibold">
        Mountains
      </text>
      <rect x="200" y="138" width="80" height="40" className="fill-sim-water" />
      <rect x="200" y="138" width="36" height="40" className="fill-sim-land" />
      <path d="M 202 176 L 236 156 L 278 146" className="fill-none stroke-sim-signal" strokeWidth="2" />
      <text x="206" y="194" className="fill-sim-ink text-[11px] font-semibold">
        Coast
      </text>
    </Frame>
  )
}
