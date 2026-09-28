import type { ReactNode } from 'react'
import { useReducedMotion } from '@/stores/prefs'

/**
 * Small diagrams for "How it works". Animations use SVG <animate> and are
 * left out when the learner prefers reduced motion.
 */

export function Frame({ children, label }: { children: ReactNode; label: string }) {
  return (
    <svg viewBox="0 0 360 200" role="img" aria-label={label} className="h-auto w-full rounded-md border bg-sim-bg">
      {children}
    </svg>
  )
}

export function Plane({ x, y, flip = false, className = 'fill-sim-ink' }: { x: number; y: number; flip?: boolean; className?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${flip ? -1 : 1} 1)`}>
      <path d="M-14 0 L10 -3 L14 0 L10 3 Z M-2 -1 L-8 -12 L-4 -12 L4 -1 Z M-2 1 L-8 12 L-4 12 L4 1 Z M-12 -1 L-15 -6 L-13 -6 L-9 -1 Z" className={className} />
    </g>
  )
}

export function Mast({ x, y, label }: { x: number; y: number; label?: string }) {
  return (
    <g>
      <path d={`M ${x - 7} ${y} L ${x} ${y - 30} L ${x + 7} ${y} Z`} className="fill-sim-bg stroke-sim-signal" strokeWidth="2" />
      <circle cx={x} cy={y - 32} r="3" className="fill-sim-signal" />
      {label && (
        <text x={x} y={y + 14} textAnchor="middle" className="fill-sim-ink text-[11px] font-semibold">
          {label}
        </text>
      )}
    </g>
  )
}

/** Waves spreading from a point to the right (static arcs when motion is reduced). */
function Waves({ x, y, dir = 1, n = 3 }: { x: number; y: number; dir?: 1 | -1; n?: number }) {
  const reduced = useReducedMotion()
  return (
    <g>
      {Array.from({ length: n }, (_, i) => (
        <path
          key={i}
          d={`M ${x + dir * (10 + i * 12)} ${y - 10 - i * 4} q ${dir * (8 + i * 2)} ${10 + i * 4} 0 ${20 + i * 8}`}
          className="fill-none stroke-sim-signal"
          strokeWidth="2"
          opacity={reduced ? 1 - i * 0.25 : 0}
        >
          {!reduced && <animate attributeName="opacity" values="0;1;0" dur="1.5s" begin={`${i * 0.3}s`} repeatCount="indefinite" />}
        </path>
      ))}
    </g>
  )
}

function Handset({ x, y, label, talking }: { x: number; y: number; label: string; talking?: boolean }) {
  return (
    <g>
      <rect x={x - 14} y={y - 30} width="28" height="52" rx="5" className="fill-sim-land stroke-sim-ink" strokeWidth="1.5" />
      <line x1={x + 6} y1={y - 30} x2={x + 6} y2={y - 50} className="stroke-sim-ink" strokeWidth="2" />
      <rect x={x - 8} y={y - 22} width="16" height="10" rx="2" className={talking ? 'fill-sim-signal' : 'fill-sim-grid-strong'} />
      <text x={x} y={y + 38} textAnchor="middle" className="fill-sim-ink text-[11px] font-semibold">
        {label}
      </text>
    </g>
  )
}

export function PressToTalkVisual() {
  return (
    <Frame label="Two radios. The one on the left has its button pressed and sends; the one on the right is listening. Only one talks at a time.">
      <Handset x={70} y={105} label="Button held: talking" talking />
      <Waves x={80} y={80} />
      <Handset x={290} y={105} label="Button up: listening" />
      <text x="180" y="185" textAnchor="middle" className="fill-sim-muted text-[11px]">
        The same frequency is used both ways, one way at a time
      </text>
    </Frame>
  )
}

export function LineOfSightVisual() {
  return (
    <Frame label="A curved Earth with a radio antenna on the left. A straight line reaches a high aircraft far away. A low aircraft at the same distance is hidden below the radio horizon.">
      <path d="M -10 170 Q 180 70 370 170 L 370 210 L -10 210 Z" className="fill-sim-land stroke-sim-grid-strong" strokeWidth="1.5" />
      <Mast x={40} y={147} />
      <line x1="40" y1="115" x2="300" y2="42" className="stroke-sim-signal" strokeWidth="2" />
      <Plane x={305} y={40} />
      <text x="300" y="26" textAnchor="middle" className="fill-sim-ink text-[11px] font-semibold">
        High: in range
      </text>
      <line x1="40" y1="115" x2="145" y2="121.7" className="stroke-sim-alert" strokeWidth="2" strokeDasharray="5 4" />
      <line x1="145" y1="121.7" x2="296" y2="131.4" className="stroke-sim-alert" strokeWidth="1.5" strokeDasharray="2 4" opacity="0.6" />
      <path d="M 140 116.7 l 10 10 M 150 116.7 l -10 10" className="stroke-sim-alert" strokeWidth="2" />
      <Plane x={305} y={131} />
      <text x="310" y="112" textAnchor="middle" className="fill-sim-ink text-[11px] font-semibold">
        Low: blocked
      </text>
      <text x="200" y="102" textAnchor="middle" className="fill-sim-muted text-[10px]">
        the Earth bulges in between
      </text>
      <text x="180" y="196" textAnchor="middle" className="fill-sim-muted text-[11px]">
        Heights exaggerated
      </text>
    </Frame>
  )
}

export function OneAtATimeVisual() {
  const reduced = useReducedMotion()
  return (
    <Frame label="Two aircraft transmit at the same moment. At the ground antenna their two carriers mix into a squeal, and neither message can be understood.">
      <Plane x={60} y={50} />
      <Plane x={300} y={50} flip />
      <Mast x={180} y={170} label="Controller hears: squeal" />
      <line x1="72" y1="56" x2="176" y2="136" className="stroke-sim-signal" strokeWidth="2" />
      <line x1="288" y1="56" x2="184" y2="136" className="stroke-sim-signal-2" strokeWidth="2" />
      <path d="M 150 110 l 8 -10 l 8 10 l 8 -10 l 8 10 l 8 -10 l 8 10 l 8 -10" className="fill-none stroke-sim-alert" strokeWidth="2">
        {!reduced && <animate attributeName="opacity" values="1;0.3;1" dur="0.4s" repeatCount="indefinite" />}
      </path>
      <text x="60" y="30" textAnchor="middle" className="fill-sim-ink text-[11px] font-semibold">
        Talking
      </text>
      <text x="300" y="30" textAnchor="middle" className="fill-sim-ink text-[11px] font-semibold">
        Talking too
      </text>
    </Frame>
  )
}

export function SquelchVisual() {
  return (
    <Frame label="Signal strength over time. Noise stays below the squelch line, so the receiver is silent. A station rises above the line and the receiver opens.">
      <line x1="30" y1="170" x2="340" y2="170" className="stroke-sim-grid-strong" />
      <text x="30" y="186" className="fill-sim-muted text-[10px]">
        time
      </text>
      <path d="M 30 150 l 10 -6 l 10 8 l 10 -5 l 10 4 l 10 -7 l 10 6 l 10 -3 l 10 5 l 10 -6 L 130 150 L 140 60 L 250 58 L 260 150 l 10 -5 l 10 6 l 10 -4 l 10 5 l 10 -6 l 10 4 l 10 -3" className="fill-none stroke-sim-signal" strokeWidth="2" />
      <line x1="30" y1="110" x2="340" y2="110" className="stroke-sim-ink" strokeWidth="1.5" strokeDasharray="6 4" />
      <text x="336" y="104" textAnchor="end" className="fill-sim-ink text-[11px] font-semibold">
        squelch line
      </text>
      <text x="80" y="132" textAnchor="middle" className="fill-sim-muted text-[10px]">
        noise: silent
      </text>
      <text x="195" y="50" textAnchor="middle" className="fill-sim-ink text-[11px] font-semibold">
        a station: you hear it
      </text>
      <text x="300" y="132" textAnchor="middle" className="fill-sim-muted text-[10px]">
        silent again
      </text>
    </Frame>
  )
}

export function ChannelsVisual() {
  const row = (y: number, n: number, label: string) => (
    <g>
      <text x="20" y={y - 6} className="fill-sim-ink text-[11px] font-semibold">
        {label}
      </text>
      {Array.from({ length: n }, (_, i) => {
        const w = 300 / n
        return <rect key={i} x={30 + i * w + 1.5} y={y} width={w - 3} height="26" rx="3" className={i === Math.floor(n / 2) ? 'fill-sim-signal' : 'fill-sim-land stroke-sim-grid-strong'} />
      })}
    </g>
  )
  return (
    <Frame label="The same 75 kilohertz of spectrum holds three 25 kilohertz channels, or nine 8.33 kilohertz channels.">
      {row(46, 3, '25 kHz spacing: 3 channels')}
      {row(120, 9, '8.33 kHz spacing: 9 channels in the same space')}
      <text x="180" y="186" textAnchor="middle" className="fill-sim-muted text-[11px]">
        More channels, but neighbours sit much closer
      </text>
    </Frame>
  )
}

export function GroundSystemVisual() {
  return (
    <Frame label="The controller's headset and panel connect through the voice switch to a remote radio site with a main and a standby transmitter, receivers, and the antenna.">
      <rect x="14" y="70" width="84" height="56" rx="6" className="fill-sim-land stroke-sim-ink" strokeWidth="1.5" />
      <text x="56" y="94" textAnchor="middle" className="fill-sim-ink text-[11px] font-semibold">
        Controller
      </text>
      <text x="56" y="110" textAnchor="middle" className="fill-sim-muted text-[10px]">
        headset, keys
      </text>
      <rect x="128" y="70" width="84" height="56" rx="6" className="fill-sim-land stroke-sim-signal" strokeWidth="1.5" />
      <text x="170" y="94" textAnchor="middle" className="fill-sim-ink text-[11px] font-semibold">
        Voice switch
      </text>
      <text x="170" y="110" textAnchor="middle" className="fill-sim-muted text-[10px]">
        VCCS
      </text>
      <rect x="242" y="30" width="96" height="36" rx="6" className="fill-sim-land stroke-sim-ink" strokeWidth="1.5" />
      <text x="290" y="52" textAnchor="middle" className="fill-sim-ink text-[11px]">
        Main transmitter
      </text>
      <rect x="242" y="80" width="96" height="36" rx="6" className="fill-sim-land stroke-sim-ink" strokeWidth="1.5" strokeDasharray="4 3" />
      <text x="290" y="102" textAnchor="middle" className="fill-sim-ink text-[11px]">
        Standby (spare)
      </text>
      <rect x="242" y="130" width="96" height="36" rx="6" className="fill-sim-land stroke-sim-ink" strokeWidth="1.5" />
      <text x="290" y="152" textAnchor="middle" className="fill-sim-ink text-[11px]">
        Receivers
      </text>
      <path d="M 98 98 H 128 M 212 98 H 226 M 226 48 V 148 M 226 48 H 242 M 226 98 H 242 M 226 148 H 242" className="fill-none stroke-sim-grid-strong" strokeWidth="2" />
      <text x="180" y="190" textAnchor="middle" className="fill-sim-muted text-[11px]">
        Radio sites can be far from the control centre
      </text>
    </Frame>
  )
}
