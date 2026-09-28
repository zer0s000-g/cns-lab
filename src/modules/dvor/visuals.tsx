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

const halo = { strokeWidth: 4, paintOrder: 'stroke' as const }

function wave(x0: number, y0: number, w: number, amp: number, shiftDeg: number, cycles = 2) {
  const pts: string[] = []
  for (let i = 0; i <= 120; i++) {
    const t = i / 120
    const ph = 2 * Math.PI * cycles * t - (shiftDeg * Math.PI) / 180
    pts.push(`${(x0 + t * w).toFixed(1)},${(y0 - amp * Math.cos(ph)).toFixed(1)}`)
  }
  return pts.join(' ')
}

export function LighthouseVisual() {
  const reduced = useReducedMotion()
  return (
    <Frame label="A lighthouse flashes in every direction when its turning beam points north. Someone to the east sees the flash, then a quarter turn later the beam: the delay tells them they are east.">
      <circle cx="120" cy="100" r="8" className="fill-sim-signal" />
      <circle cx="120" cy="100" r="30" className="fill-none stroke-sim-signal" strokeWidth="2" opacity={reduced ? 0.6 : 0}>
        {!reduced && (
          <>
            <animate attributeName="r" values="10;90" dur="4s" begin="0s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.9;0" dur="4s" begin="0s" repeatCount="indefinite" />
          </>
        )}
      </circle>
      <g>
        <path d="M120 100 L112 22 L128 22 Z" className="fill-sim-warning" opacity="0.55" />
        {!reduced && <animateTransform attributeName="transform" type="rotate" from="0 120 100" to="360 120 100" dur="4s" repeatCount="indefinite" />}
      </g>
      <text x="120" y="14" textAnchor="middle" className="fill-sim-muted text-[10px] font-semibold">
        N
      </text>
      <circle cx="215" cy="100" r="5" className="fill-sim-ink" />
      <text x="225" y="96" className="fill-sim-ink text-[11px] font-semibold">
        you, to the east
      </text>
      <text x="200" y="140" className="fill-sim-ink text-[11px]">
        1. Flash (everyone at once)
      </text>
      <text x="200" y="156" className="fill-sim-ink text-[11px]">
        2. Beam arrives a ¼ turn later
      </text>
      <text x="200" y="176" className="fill-sim-muted text-[11px]">
        ¼ turn = 90°: you are east
      </text>
    </Frame>
  )
}

export function PhaseVisual() {
  return (
    <Frame label="Two 30 hertz waves. The variable wave peaks a quarter of a cycle after the reference wave: a phase difference of 90 degrees, so the aircraft is on radial 090.">
      <text x="14" y="30" className="fill-sim-ink text-[11px] font-semibold">
        REF
      </text>
      <polyline points={wave(50, 50, 290, 22, 0)} className="fill-none stroke-sim-signal" strokeWidth="2.5" />
      <text x="14" y="110" className="fill-sim-ink text-[11px] font-semibold">
        VAR
      </text>
      <polyline points={wave(50, 130, 290, 22, 90)} className="fill-none stroke-sim-ink" strokeWidth="2.5" strokeDasharray="6 4" />
      <rect x="50" y="20" width="36.25" height="140" className="fill-sim-signal" opacity="0.14" />
      <line x1="50" y1="20" x2="50" y2="160" className="stroke-sim-muted" strokeDasharray="3 3" />
      <line x1="86.25" y1="20" x2="86.25" y2="160" className="stroke-sim-muted" strokeDasharray="3 3" />
      <text x="96" y="186" className="fill-sim-ink text-[12px] font-semibold">
        ¼ cycle late = 90° = radial 090
      </text>
    </Frame>
  )
}

export function CvorVisual() {
  const reduced = useReducedMotion()
  const pts: string[] = []
  for (let a = 0; a <= 360; a += 6) {
    const t = (a * Math.PI) / 180
    const r = 44 * (1 + 0.55 * Math.cos(t))
    pts.push(`${(100 + Math.sin(t) * r).toFixed(1)},${(100 - Math.cos(t) * r).toFixed(1)}`)
  }
  return (
    <Frame label="A conventional VOR: a radiation pattern with a bulge turns clockwise 30 times a second, so each direction sees the signal grow stronger and weaker once per turn. A separate tone carries the reference.">
      <g>
        <polygon points={pts.join(' ')} className="fill-sim-signal stroke-sim-signal" fillOpacity="0.2" strokeWidth="2" />
        {!reduced && <animateTransform attributeName="transform" type="rotate" from="0 100 100" to="360 100 100" dur="5s" repeatCount="indefinite" />}
      </g>
      <rect x="92" y="92" width="16" height="16" className="fill-sim-neutral stroke-sim-ink" />
      <text x="100" y="192" textAnchor="middle" className="fill-sim-muted text-[10px]">
        turns clockwise (slowed down)
      </text>
      <text x="200" y="56" className="fill-sim-ink text-[12px] font-semibold">
        Conventional VOR
      </text>
      <text x="200" y="80" className="fill-sim-ink text-[11px]">
        VAR: strength rises and falls
      </text>
      <text x="200" y="96" className="fill-sim-muted text-[11px]">
        (30 Hz AM)
      </text>
      <text x="200" y="122" className="fill-sim-ink text-[11px]">
        REF: a 9960 Hz tone that
      </text>
      <text x="200" y="138" className="fill-sim-ink text-[11px]">
        wobbles in pitch
      </text>
      <text x="200" y="154" className="fill-sim-muted text-[11px]">
        (30 Hz FM)
      </text>
    </Frame>
  )
}

export function DvorVisual() {
  const reduced = useReducedMotion()
  const posts = Array.from({ length: 24 }, (_, i) => {
    const t = (i * 15 * Math.PI) / 180
    return { x: 100 + Math.sin(t) * 60, y: 100 - Math.cos(t) * 60 }
  })
  return (
    <Frame label="A Doppler VOR: a ring of antennas around a centre antenna. The signal is switched from antenna to antenna counter-clockwise, so it seems to move in a circle. Moving toward you, its frequency rises; moving away, it falls.">
      <circle cx="100" cy="100" r="60" className="fill-none stroke-sim-grid-strong" strokeWidth="1.5" />
      {posts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="3" className="fill-sim-ink" />
      ))}
      <circle cx="100" cy="100" r="6" className="fill-sim-signal-2" />
      <g>
        <circle cx="160" cy="100" r="7" className="fill-sim-signal" />
        {!reduced && <animateTransform attributeName="transform" type="rotate" from="0 100 100" to="-360 100 100" dur="5s" repeatCount="indefinite" />}
      </g>
      <path d="M 176 60 A 72 72 0 0 0 140 34" className="fill-none stroke-sim-ink" strokeWidth="1.5" markerEnd="" />
      <path d="M 140 34 l 10 -1 l -5 8 z" className="fill-sim-ink" />
      <text x="100" y="192" textAnchor="middle" className="fill-sim-muted text-[10px]">
        switched counter-clockwise, slowed
      </text>
      <text x="196" y="50" className="fill-sim-ink text-[12px] font-semibold">
        Doppler VOR
      </text>
      <text x="196" y="72" className="fill-sim-ink text-[11px]">
        Coming toward you: pitch up
      </text>
      <text x="196" y="88" className="fill-sim-ink text-[11px]">
        Going away: pitch down
      </text>
      <text x="196" y="104" className="fill-sim-muted text-[11px]">
        VAR is now the 30 Hz FM
      </text>
      <text x="196" y="128" className="fill-sim-ink text-[11px]">
        REF: 30 Hz AM from the
      </text>
      <text x="196" y="144" className="fill-sim-ink text-[11px]">
        centre antenna, the same
      </text>
      <text x="196" y="160" className="fill-sim-ink text-[11px]">
        in every direction
      </text>
    </Frame>
  )
}

export function CdiVisual() {
  return (
    <Frame label="Map: the course 090 runs east through the station. The aircraft is south of it, flying east toward the station. On the course indicator the needle is left of centre and the flag says TO: fly left to get back on course.">
      <line x1="10" y1="70" x2="190" y2="70" className="stroke-sim-signal" strokeWidth="2" strokeDasharray="8 4" />
      <text x="14" y="62" className="fill-sim-signal stroke-sim-bg text-[10px] font-semibold" {...halo}>
        course 090
      </text>
      <path d="M150 64 l6 6 l-6 6 l-6 -6 z" className="fill-sim-bg stroke-sim-signal" strokeWidth="2" />
      <text x="150" y="92" textAnchor="middle" className="fill-sim-ink text-[10px] font-semibold">
        VOR
      </text>
      <g transform="translate(60 108) rotate(90)">
        <path d="M0 -10 L1.6 -3 L10 1 L10 3 L1.6 1 L1 6 L4 8.5 L4 10 L0 9 L-4 10 L-4 8.5 L-1 6 L-1.6 1 L-10 3 L-10 1 L-1.6 -3 Z" className="fill-sim-ink" />
      </g>
      <text x="40" y="136" className="fill-sim-ink text-[10px]">
        you: south of the course
      </text>
      <circle cx="275" cy="92" r="62" className="fill-instrument-bezel" />
      <circle cx="275" cy="92" r="55" className="fill-instrument-face" />
      {[-5, -4, -3, -2, -1, 1, 2, 3, 4, 5].map((d) => (
        <circle key={d} cx={275 + d * 8.5} cy="92" r="2.5" className="fill-none stroke-instrument-marking" strokeWidth="1.2" />
      ))}
      <line x1="249.5" y1="50" x2="249.5" y2="134" className="stroke-instrument-accent" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M300 62 l-8 12 l16 0 z" className="fill-instrument-marking" />
      <text x="300" y="86" textAnchor="middle" className="fill-instrument-marking text-[9px] font-semibold">
        TO
      </text>
      <text x="275" y="46" textAnchor="middle" className="fill-instrument-marking text-[9px] font-semibold">
        CRS 090
      </text>
      <text x="275" y="176" textAnchor="middle" className="fill-sim-ink text-[11px] font-semibold">
        needle left: fly left
      </text>
    </Frame>
  )
}

export function LimitsVisual() {
  return (
    <Frame label="Three limits: above the station a cone where the signal cannot be used; a nearby building that reflects the signal and bends the course; and a monitor that switches the station off if its signal goes wrong.">
      <path d="M 20 170 L 140 170" className="stroke-sim-ink" strokeWidth="2" />
      <path d="M 80 168 L 30 40 L 130 40 Z" className="fill-sim-warning stroke-sim-warning" fillOpacity="0.2" strokeWidth="1.5" />
      <path d="M 74 170 L 80 158 L 86 170 Z" className="fill-sim-signal" />
      <text x="80" y="32" textAnchor="middle" className="fill-sim-ink text-[11px] font-semibold">
        Cone of confusion
      </text>
      <text x="80" y="188" textAnchor="middle" className="fill-sim-muted text-[10px]">
        needle swings, flag OFF
      </text>
      <rect x="220" y="40" width="30" height="34" className="fill-sim-neutral stroke-sim-ink" />
      <path d="M 180 110 L 232 74 L 330 60" className="fill-none stroke-sim-signal" strokeWidth="1.5" strokeDasharray="4 3" />
      <path d="M 180 110 L 330 90" className="fill-none stroke-sim-signal" strokeWidth="2" />
      <path d="M 176 106 l4 4 l-4 4 l-4 -4 z" className="fill-sim-signal" />
      <text x="258" y="36" className="fill-sim-ink text-[11px] font-semibold">
        Reflections
      </text>
      <text x="190" y="128" className="fill-sim-muted text-[10px]">
        a wavy, bent course: scalloping
      </text>
      <rect x="196" y="146" width="130" height="34" rx="6" className="fill-sim-bg stroke-sim-ink" />
      <text x="261" y="161" textAnchor="middle" className="fill-sim-ink text-[11px] font-semibold">
        Monitor
      </text>
      <text x="261" y="175" textAnchor="middle" className="fill-sim-muted text-[10px]">
        wrong by 1°? switch off
      </text>
    </Frame>
  )
}
