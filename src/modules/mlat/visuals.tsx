import type { ReactNode } from 'react'
import { useReducedMotion } from '@/stores/prefs'

/**
 * Small diagrams for "How it works". Animations use SVG <animate> and are
 * left out entirely when the learner prefers reduced motion.
 */

type P = { x: number; y: number }

function Frame({ children, label }: { children: ReactNode; label: string }) {
  return (
    <svg viewBox="0 0 360 200" role="img" aria-label={label} className="h-auto w-full rounded-md border bg-sim-bg">
      {children}
    </svg>
  )
}

function Plane({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M-14 0 L10 -3 L14 0 L10 3 Z M-2 -1 L-8 -12 L-4 -12 L4 -1 Z M-2 1 L-8 12 L-4 12 L4 1 Z M-12 -1 L-15 -6 L-13 -6 L-9 -1 Z" className="fill-sim-ink" />
    </g>
  )
}

function Receiver({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <g>
      <path d={`M ${x} ${y - 8} L ${x + 8} ${y + 6} L ${x - 8} ${y + 6} Z`} className="fill-sim-bg stroke-sim-signal" strokeWidth="2" />
      <text x={x} y={y + 20} textAnchor="middle" className="fill-sim-ink text-[11px] font-semibold">
        {label}
      </text>
    </g>
  )
}

/**
 * SVG path of the hyperbola branch through P with foci F1 and F2: every point
 * whose distance to F1 minus its distance to F2 equals that of P.
 */
function hyperbolaPath(f1: P, f2: P, p: P, tMax = 2.2): string {
  const d = Math.hypot(p.x - f1.x, p.y - f1.y) - Math.hypot(p.x - f2.x, p.y - f2.y)
  const c = Math.hypot(f2.x - f1.x, f2.y - f1.y) / 2
  const a = d / 2
  const b = Math.sqrt(Math.max(1e-6, c * c - a * a))
  const m = { x: (f1.x + f2.x) / 2, y: (f1.y + f2.y) / 2 }
  const ang = Math.atan2(f2.y - f1.y, f2.x - f1.x)
  const cos = Math.cos(ang)
  const sin = Math.sin(ang)
  const pts: string[] = []
  for (let i = 0; i <= 40; i++) {
    const t = -tMax + (2 * tMax * i) / 40
    // Positive a: closer to F2, which sits at +c in the local frame.
    const lx = a * Math.cosh(t)
    const ly = b * Math.sinh(t)
    pts.push(`${(m.x + lx * cos - ly * sin).toFixed(1)} ${(m.y + lx * sin + ly * cos).toFixed(1)}`)
  }
  return `M ${pts.join(' L ')}`
}

export function TransmitVisual() {
  const reduced = useReducedMotion()
  return (
    <Frame label="An aircraft's transponder sends its usual reply on 1090 MHz. Nothing new is needed on board.">
      <Plane x={180} y={90} s={1.2} />
      {[0, 1, 2].map((i) => (
        <circle key={i} cx="180" cy="90" r={reduced ? 30 + i * 28 : 10} className="fill-none stroke-sim-signal" strokeWidth="2" opacity={reduced ? 0.8 - i * 0.25 : 0}>
          {!reduced && (
            <>
              <animate attributeName="r" from="10" to="110" dur="2.4s" begin={`${i * 0.8}s`} repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.9;0" dur="2.4s" begin={`${i * 0.8}s`} repeatCount="indefinite" />
            </>
          )}
        </circle>
      ))}
      <text x="180" y="186" textAnchor="middle" className="fill-sim-muted text-[11px]">
        The usual transponder reply or ADS-B message, 1090 MHz
      </text>
    </Frame>
  )
}

export function ArrivalVisual() {
  const reduced = useReducedMotion()
  const ac = { x: 120, y: 70 }
  const rx = [
    { x: 70, y: 150, l: 'A' },
    { x: 200, y: 160, l: 'B' },
    { x: 310, y: 80, l: 'C' },
  ]
  const far = Math.max(...rx.map((r) => Math.hypot(r.x - ac.x, r.y - ac.y)))
  return (
    <Frame label="The signal spreads out and reaches receivers A, B and C one after the other, because they are at different distances.">
      {rx.map((r) => (
        <Receiver key={r.l} x={r.x} y={r.y} label={r.l} />
      ))}
      <Plane x={ac.x} y={ac.y} />
      <circle cx={ac.x} cy={ac.y} r={reduced ? far * 0.6 : 0} className="fill-none stroke-sim-signal" strokeWidth="2">
        {!reduced && <animate attributeName="r" from="0" to={far + 10} dur="3s" repeatCount="indefinite" />}
      </circle>
      <text x="16" y="24" className="fill-sim-ink text-[11px] font-semibold">
        First A, then B, then C
      </text>
      <text x="16" y="190" className="fill-sim-muted text-[11px]">
        Farther receivers hear it later: 3.3 µs later per kilometre
      </text>
    </Frame>
  )
}

export function DifferenceVisual() {
  return (
    <Frame label="A timeline. Nobody knows when the signal left the aircraft, but receiver B heard it 12 microseconds after A, which means B is 3.6 kilometres farther away.">
      <line x1="30" y1="60" x2="30" y2="160" className="stroke-sim-grid-strong" strokeDasharray="4 3" />
      <text x="34" y="52" className="fill-sim-muted text-[10px]">
        sent: unknown moment
      </text>
      {[
        { y: 80, x: 150, l: 'A' },
        { y: 115, x: 222, l: 'B' },
        { y: 150, x: 290, l: 'C' },
      ].map((r) => (
        <g key={r.l}>
          <text x="12" y={r.y + 4} className="fill-sim-ink text-[11px] font-semibold">
            {r.l}
          </text>
          <line x1="30" y1={r.y} x2="340" y2={r.y} className="stroke-sim-grid" />
          <line x1={r.x} y1={r.y - 9} x2={r.x} y2={r.y + 9} className="stroke-sim-signal" strokeWidth="3" />
        </g>
      ))}
      <path d="M 150 95 L 222 95" className="stroke-sim-ink" strokeWidth="1.2" markerEnd="url(#mlat-arrow)" />
      <defs>
        <marker id="mlat-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0 0 L8 4 L0 8 Z" className="fill-sim-ink" />
        </marker>
      </defs>
      <text x="186" y="91" textAnchor="middle" className="fill-sim-ink text-[10px] font-semibold">
        12 µs
      </text>
      <text x="16" y="186" className="fill-sim-ink text-[11px]">
        12 µs later ⇒ B is 3.6 km farther away than A
      </text>
    </Frame>
  )
}

export function CurveVisual() {
  const a = { x: 110, y: 130 }
  const b = { x: 250, y: 130 }
  const p = { x: 215, y: 60 }
  return (
    <Frame label="Two receivers A and B. The curve shows every place that is the same amount closer to B than to A. The aircraft is somewhere on it.">
      <path d={hyperbolaPath(a, b, p, 1.25)} className="fill-none stroke-sim-signal-2" strokeWidth="2.5" />
      <Receiver x={a.x} y={a.y} label="A" />
      <Receiver x={b.x} y={b.y} label="B" />
      <Plane x={p.x} y={p.y} />
      <line x1={a.x} y1={a.y} x2={p.x} y2={p.y} className="stroke-sim-grid-strong" strokeDasharray="3 3" />
      <line x1={b.x} y1={b.y} x2={p.x} y2={p.y} className="stroke-sim-grid-strong" strokeDasharray="3 3" />
      <text x="16" y="22" className="fill-sim-ink text-[11px] font-semibold">
        One time difference = one curve
      </text>
      <text x="16" y="40" className="fill-sim-muted text-[11px]">
        Every point on it is the same
      </text>
      <text x="16" y="54" className="fill-sim-muted text-[11px]">
        distance closer to B than to A
      </text>
    </Frame>
  )
}

export function CrossVisual() {
  const r = [
    { x: 70, y: 150, l: 'A' },
    { x: 290, y: 155, l: 'B' },
    { x: 190, y: 30, l: 'C' },
  ]
  const p = { x: 170, y: 105 }
  return (
    <Frame label="Three receivers give two independent curves. Where they cross is the aircraft.">
      <path d={hyperbolaPath(r[0], r[1], p, 1.1)} className="fill-none stroke-sim-signal-2" strokeWidth="2" />
      <path d={hyperbolaPath(r[0], r[2], p, 1.1)} className="fill-none stroke-sim-signal-2" strokeWidth="2" />
      <path d={hyperbolaPath(r[1], r[2], p, 1.1)} className="fill-none stroke-sim-signal-2" strokeWidth="1.2" strokeDasharray="4 3" />
      {r.map((q) => (
        <Receiver key={q.l} x={q.x} y={q.y} label={q.l} />
      ))}
      <circle cx={p.x} cy={p.y} r="9" className="fill-none stroke-sim-ink" strokeWidth="1.5" />
      <text x="16" y="190" className="fill-sim-muted stroke-sim-bg text-[11px]" strokeWidth="4" paintOrder="stroke">
        The dashed third curve adds nothing new, but checks the others
      </text>
    </Frame>
  )
}

export function GeometryVisual() {
  const good = [
    { x: 35, y: 150 },
    { x: 150, y: 162 },
    { x: 70, y: 55 },
  ]
  const fix = { x: 100, y: 112 }
  return (
    <Frame label="Left: receivers around the aircraft, the curves cross at a steep angle and the fix is sharp. Right: the aircraft far outside, the curves are nearly parallel and the fix is smeared out.">
      <text x="20" y="22" className="fill-sim-ink text-[11px] font-semibold">
        Inside: sharp
      </text>
      <path d={hyperbolaPath(good[0], good[1], fix, 0.9)} className="fill-none stroke-sim-signal-2" strokeWidth="2" />
      <path d={hyperbolaPath(good[0], good[2], fix, 0.9)} className="fill-none stroke-sim-signal-2" strokeWidth="2" />
      {good.map((q, i) => (
        <path key={i} d={`M ${q.x} ${q.y - 7} L ${q.x + 7} ${q.y + 5} L ${q.x - 7} ${q.y + 5} Z`} className="fill-sim-bg stroke-sim-signal" strokeWidth="2" />
      ))}
      <ellipse cx={fix.x} cy={fix.y} rx="5" ry="5" className="fill-sim-signal" opacity="0.35" />
      <line x1="180" y1="20" x2="180" y2="180" className="stroke-sim-grid" />
      <text x="196" y="22" className="fill-sim-ink text-[11px] font-semibold">
        Outside: smeared
      </text>
      {[
        { x: 200, y: 160 },
        { x: 240, y: 170 },
        { x: 220, y: 130 },
      ].map((q, i) => (
        <path key={i} d={`M ${q.x} ${q.y - 7} L ${q.x + 7} ${q.y + 5} L ${q.x - 7} ${q.y + 5} Z`} className="fill-sim-bg stroke-sim-signal" strokeWidth="2" />
      ))}
      <path d="M 250 40 Q 300 58 345 66" className="fill-none stroke-sim-signal-2" strokeWidth="2" />
      <path d="M 252 52 Q 300 62 345 64" className="fill-none stroke-sim-signal-2" strokeWidth="2" />
      <ellipse cx="300" cy="60" rx="34" ry="6" transform="rotate(14 300 60)" className="fill-sim-signal" opacity="0.3" />
      <text x="196" y="195" className="fill-sim-muted text-[10px]">
        Nearly parallel: a long, blurry fix
      </text>
    </Frame>
  )
}
