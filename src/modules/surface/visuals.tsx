import type { ReactNode } from 'react'
import { useReducedMotion } from '@/stores/prefs'

/**
 * Small diagrams for "How it works". Animations use SVG <animate> and are
 * left out entirely when the learner prefers reduced motion.
 */

function Frame({ children, label, dark }: { children: ReactNode; label: string; dark?: boolean }) {
  return (
    <svg viewBox="0 0 360 200" role="img" aria-label={label} className={dark ? 'h-auto w-full rounded-md border bg-scope-bg' : 'h-auto w-full rounded-md border bg-sim-bg'}>
      {children}
    </svg>
  )
}

/** Top view of an airliner, nose to the right, centred on (x, y). */
function PlaneTop({ x, y, s = 1, className = 'fill-sim-ink' }: { x: number; y: number; s?: number; className?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M20 0 L16 -2 L2 -2 L-6 -17 L-9 -17 L-5 -2 L-15 -2 L-19 -7 L-21 -7 L-19 0 L-21 7 L-19 7 L-15 2 L-5 2 L-9 17 L-6 17 L2 2 L16 2 Z" className={className} />
    </g>
  )
}

export function FogVisual() {
  const reduced = useReducedMotion()
  return (
    <Frame label="In fog the controller in the tower cannot see the runway, but the surveillance display still shows every aircraft.">
      <rect x="0" y="0" width="360" height="200" className="fill-sim-sky" />
      <rect x="0" y="120" width="360" height="80" className="fill-sim-land" />
      <rect x="130" y="138" width="230" height="12" className="fill-sim-neutral" />
      <PlaneTop x={260} y={140} s={0.9} />
      <rect x="0" y="0" width="360" height="200" className="fill-sim-fog" opacity={reduced ? 0.8 : 0.2}>
        {!reduced && <animate attributeName="opacity" values="0.1;0.9;0.9;0.1" dur="6s" repeatCount="indefinite" />}
      </rect>
      <rect x="18" y="60" width="16" height="80" className="fill-sim-muted" />
      <rect x="10" y="48" width="32" height="14" className="fill-sim-ink" />
      <text x="26" y="160" textAnchor="middle" className="fill-sim-ink text-[11px] font-semibold">
        Tower
      </text>
      <text x="200" y="30" textAnchor="middle" className="fill-sim-ink text-[12px] font-semibold">
        In thick fog the window shows nothing
      </text>
    </Frame>
  )
}

export function SmrVisual() {
  const reduced = useReducedMotion()
  const cells: { x: number; y: number }[] = []
  for (let x = -18; x <= 18; x += 3) cells.push({ x, y: 0 })
  for (let k = 1; k <= 5; k++) cells.push({ x: -2 - k * 1.5, y: -3 * k }, { x: -2 - k * 1.5, y: 3 * k })
  cells.push({ x: -18, y: -5 }, { x: -18, y: 5 })
  return (
    <Frame dark label="A fast-turning radar with very short pulses and a very narrow beam paints the outline of an aircraft as many small dots.">
      <circle cx="40" cy="160" r="6" className="fill-scope-trace" />
      <g>
        <path d="M 40 160 L 350 70 L 350 90 Z" className="fill-scope-trace" opacity="0.18" />
        {!reduced && <animateTransform attributeName="transform" type="rotate" values="-8 40 160; 8 40 160; -8 40 160" dur="3s" repeatCount="indefinite" />}
      </g>
      {cells.map((c, i) => (
        <rect key={i} x={250 + c.x * 2.2 - 2.5} y={95 + c.y * 2.2 - 1.5} width="5" height="3" rx="1" className="fill-scope-blip" />
      ))}
      <text x="16" y="24" className="fill-scope-text text-[11px] font-semibold">
        One turn per second, detail of a few metres
      </text>
      <text x="16" y="190" className="fill-scope-dim text-[11px]">
        The shape shows. The name does not.
      </text>
    </Frame>
  )
}

export function NamesVisual() {
  return (
    <Frame dark label="The same aircraft seen by the radar as a shape, and by multilateration and ADS-B as a labelled position.">
      <PlaneTop x={90} y={100} s={1.6} className="fill-scope-blip" />
      <text x="90" y="160" textAnchor="middle" className="fill-scope-dim text-[11px]">
        SMR: shape only
      </text>
      <path d="M250 82 L262 104 L238 104 Z" className="fill-none stroke-scope-text" strokeWidth="1.6" />
      <path d="M250 110 L262 122 L250 134 L238 122 Z" className="fill-none stroke-scope-text" strokeWidth="1.6" />
      <text x="270" y="98" className="fill-scope-text font-mono text-[11px] font-semibold">
        CNS220
      </text>
      <text x="250" y="160" textAnchor="middle" className="fill-scope-dim text-[11px]">
        MLAT and ADS-B: position and name
      </text>
      <text x="16" y="24" className="fill-scope-text text-[11px] font-semibold">
        Transponder signals add the identity
      </text>
    </Frame>
  )
}

export function FusionVisual() {
  return (
    <Frame dark label="Three sensor reports of the same aircraft are combined into one labelled track. A van without a transponder gets a track without a name.">
      <rect x="40" y="70" width="10" height="5" rx="2" className="fill-scope-blip" />
      <path d="M45 88 L52 100 L38 100 Z" className="fill-none stroke-scope-text" strokeWidth="1.5" />
      <path d="M45 108 L52 115 L45 122 L38 115 Z" className="fill-none stroke-scope-text" strokeWidth="1.5" />
      <path d="M 70 96 L 150 96" className="stroke-scope-dim" strokeWidth="1.5" markerEnd="url(#sfc-arrow)" />
      <defs>
        <marker id="sfc-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0 0 L8 4 L0 8 Z" className="fill-scope-dim" />
        </marker>
      </defs>
      <path d="M190 84 L202 96 L190 108 L178 96 Z" className="fill-scope-text" />
      <text x="208" y="86" className="fill-scope-text font-mono text-[11px] font-semibold">
        CNS220
      </text>
      <text x="208" y="100" className="fill-scope-dim font-mono text-[10px]">
        15 kt SMA
      </text>
      <circle cx="190" cy="150" r="4" className="fill-scope-text" />
      <text x="208" y="148" className="fill-scope-text font-mono text-[11px] font-semibold">
        Unknown
      </text>
      <text x="208" y="162" className="fill-scope-dim font-mono text-[10px]">
        12 kt S
      </text>
      <text x="16" y="24" className="fill-scope-text text-[11px] font-semibold">
        Three reports, one track
      </text>
      <text x="16" y="190" className="fill-scope-dim text-[11px]">
        No transponder: seen by the radar only, no name
      </text>
    </Frame>
  )
}

export function StopBarVisual() {
  const reduced = useReducedMotion()
  return (
    <Frame label="A taxiway meets the runway. At the holding position a row of red stop bar lights says do not enter. A car driving past it while an aircraft lands sets off the alert.">
      <rect x="0" y="120" width="360" height="40" className="fill-sim-neutral" />
      <line x1="10" y1="140" x2="350" y2="140" className="stroke-sim-bg" strokeWidth="2" strokeDasharray="14 10" />
      <rect x="160" y="20" width="36" height="100" className="fill-sim-neutral" opacity="0.7" />
      <line x1="160" y1="80" x2="196" y2="80" className="stroke-sim-warning" strokeWidth="2" />
      {[165, 172, 179, 186, 193].map((x) => (
        <circle key={x} cx={x - 1} cy="86" r="2.6" className="fill-sim-alert" />
      ))}
      <text x="204" y="90" className="fill-sim-ink text-[11px] font-semibold">
        Stop bar: red = do not enter
      </text>
      <rect x="171" y={reduced ? 100 : 40} width="14" height="9" rx="2" className="fill-sim-signal">
        {!reduced && <animate attributeName="y" values="40;112;112;40" dur="5s" repeatCount="indefinite" />}
      </rect>
      <PlaneTop x={60} y={140} s={0.9} />
      <text x="16" y="186" className="fill-sim-alert text-[11px] font-semibold">
        Past a red stop bar while an aircraft lands: ALERT
      </text>
    </Frame>
  )
}

export function LevelsVisual() {
  const rows = [
    { t: 'Surveillance', d: 'Where everything is, with names' },
    { t: 'Alerting (safety nets)', d: 'Warn about runway incursions' },
    { t: 'Routing', d: 'Plan each taxi route' },
    { t: 'Guidance', d: 'Lights show the way: follow the greens' },
  ]
  return (
    <Frame label="The four A-SMGCS services stacked: surveillance, alerting, routing and guidance.">
      {rows.map((r, i) => (
        <g key={r.t}>
          <rect x="20" y={12 + i * 46} width="320" height="40" rx="6" className="fill-sim-bg stroke-sim-signal" strokeWidth="1.5" />
          <text x="34" y={29 + i * 46} className="fill-sim-ink text-[12px] font-semibold">
            {i + 1}. {r.t}
          </text>
          <text x="34" y={44 + i * 46} className="fill-sim-muted text-[11px]">
            {r.d}
          </text>
        </g>
      ))}
    </Frame>
  )
}
