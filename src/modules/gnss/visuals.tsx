import type { ReactNode } from 'react'
import { useReducedMotion } from '@/stores/prefs'

/**
 * Small diagrams for "How it works". Animations use SVG <animate> and are
 * left out entirely when the learner prefers reduced motion.
 */

function Frame({ children, label }: { children: ReactNode; label: string }) {
  return (
    <svg viewBox="0 0 360 200" role="img" aria-label={label} className="h-auto w-full rounded-md border bg-sim-bg">
      {children}
    </svg>
  )
}

/** SVG text with a background-coloured outline so it stays readable over lines. */
function Halo({ children, className, ...rest }: React.SVGProps<SVGTextElement>) {
  return (
    <text {...rest} className={`stroke-sim-bg ${className ?? ''}`} strokeWidth={3.5} paintOrder="stroke" strokeLinejoin="round">
      {children}
    </text>
  )
}

function Sat({ x, y, label, dim }: { x: number; y: number; label?: string; dim?: boolean }) {
  return (
    <g transform={`translate(${x} ${y})`} opacity={dim ? 0.5 : 1}>
      <rect x="-5" y="-5" width="10" height="10" rx="1.5" className="fill-sim-signal" />
      <rect x="-19" y="-3" width="11" height="6" className="fill-sim-signal-2" />
      <rect x="8" y="-3" width="11" height="6" className="fill-sim-signal-2" />
      {label && (
        <text x="0" y="-10" textAnchor="middle" className="fill-sim-ink font-mono text-[10px] font-semibold">
          {label}
        </text>
      )}
    </g>
  )
}

function Receiver({ x, y, label = 'Receiver' }: { x: number; y: number; label?: string }) {
  return (
    <g>
      <path d={`M ${x} ${y - 8} L ${x + 7} ${y + 5} L ${x - 7} ${y + 5} Z`} className="fill-sim-bg stroke-primary" strokeWidth="2" />
      <text x={x} y={y + 18} textAnchor="middle" className="fill-sim-ink text-[10px] font-semibold">
        {label}
      </text>
    </g>
  )
}

function EarthArc() {
  return <path d="M -20 205 Q 180 150 380 205 Z" className="fill-sim-land stroke-sim-grid-strong" />
}

export function BroadcastVisual() {
  const reduced = useReducedMotion()
  const sats = [
    { x: 60, y: 40, id: 'G07' },
    { x: 180, y: 26, id: 'G12' },
    { x: 300, y: 44, id: 'G21' },
  ]
  return (
    <Frame label="Three satellites each broadcast a message: who they are, where they are, and the exact time the message left. A receiver on the ground listens.">
      <EarthArc />
      {sats.map((s, i) => (
        <g key={s.id}>
          <Sat x={s.x} y={s.y} label={s.id} />
          {[0, 1].map((k) => (
            <circle key={k} cx={s.x} cy={s.y} r={reduced ? 22 + k * 22 : 6} className="fill-none stroke-sim-signal" strokeWidth="1.5" opacity={reduced ? 0.6 - k * 0.25 : 0}>
              {!reduced && (
                <>
                  <animate attributeName="r" from="6" to="120" dur="2.4s" begin={`${i * 0.5 + k * 1.2}s`} repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.8;0" dur="2.4s" begin={`${i * 0.5 + k * 1.2}s`} repeatCount="indefinite" />
                </>
              )}
            </circle>
          ))}
        </g>
      ))}
      <Receiver x={180} y={158} />
      <rect x="196" y="66" width="156" height="38" rx="4" className="fill-sim-bg stroke-sim-grid-strong" />
      <text x="204" y="81" className="fill-sim-ink text-[10px] font-semibold">
        "I am G12, I am here,
      </text>
      <text x="204" y="95" className="fill-sim-ink text-[10px] font-semibold">
        it is exactly 12:00:00.000"
      </text>
    </Frame>
  )
}

export function TravelTimeVisual() {
  const reduced = useReducedMotion()
  return (
    <Frame label="The signal takes about 0.07 seconds to come down from a satellite 20,000 km up. Travel time multiplied by the speed of light gives the distance.">
      <EarthArc />
      <Sat x={70} y={34} label="G12" />
      <Receiver x={70} y={160} />
      <line x1="70" y1="46" x2="70" y2="148" className="stroke-sim-grid-strong" strokeDasharray="3 3" />
      <circle r="4.5" className="fill-sim-signal" cx={reduced ? 70 : undefined} cy={reduced ? 100 : undefined}>
        {!reduced && <animateMotion path="M 70 46 L 70 148" dur="1.8s" repeatCount="indefinite" />}
      </circle>
      <text x="112" y="50" className="fill-sim-ink text-[11px]">
        Sent at 12:00:00.000
      </text>
      <text x="112" y="68" className="fill-sim-ink text-[11px]">
        Received at 12:00:00.067
      </text>
      <text x="112" y="96" className="fill-sim-ink text-[11px] font-semibold">
        0.067 s × 300,000 km/s ≈ 20,100 km
      </text>
      <text x="112" y="122" className="fill-sim-muted text-[10px]">
        One millionth of a second too early or late
      </text>
      <text x="112" y="136" className="fill-sim-muted text-[10px]">
        means 300 m of error.
      </text>
    </Frame>
  )
}

export function SpheresVisual() {
  return (
    <Frame label="Flat picture of the idea: three circles, one around each satellite, drawn with the measured distances. They cross at only one point, the receiver's position.">
      <circle cx="90" cy="70" r="106.4" className="fill-sim-signal/5 stroke-sim-signal" strokeWidth="1.5" />
      <circle cx="270" cy="60" r="126.7" className="fill-sim-signal-2/5 stroke-sim-signal-2" strokeWidth="1.5" />
      <circle cx="230" cy="180" r="71.8" className="fill-sim-neutral/5 stroke-sim-neutral" strokeWidth="1.5" strokeDasharray="5 3" />
      <Sat x={90} y={70} label="A" />
      <Sat x={270} y={60} label="B" />
      <Sat x={230} y={180} label="C" />
      <circle cx="171" cy="139" r="5" className="fill-primary" />
      <Halo x="164" y="134" textAnchor="end" className="fill-sim-ink text-[11px] font-semibold">
        You are here
      </Halo>
      <Halo x="8" y="16" className="fill-sim-muted text-[10px]">
        Flat picture. In space each distance is a sphere.
      </Halo>
    </Frame>
  )
}

export function ClockVisual() {
  return (
    <Frame label="If the receiver's clock is wrong, every distance is too long by the same amount and the circles no longer meet at one point. Shrinking them all by the same amount until they meet reveals the clock error.">
      <defs>
        <clipPath id="gnss-clock-half">
          <rect x="0" y="22" width="179" height="156" />
        </clipPath>
      </defs>
      <text x="90" y="16" textAnchor="middle" className="fill-sim-ink text-[11px] font-semibold">
        Clock wrong
      </text>
      <text x="90" y="194" textAnchor="middle" className="fill-sim-muted text-[10px]">
        No single meeting point
      </text>
      <g clipPath="url(#gnss-clock-half)">
        <circle cx="40" cy="70" r="89.2" className="fill-none stroke-sim-signal" strokeWidth="1.3" />
        <circle cx="150" cy="64" r="95" className="fill-none stroke-sim-signal-2" strokeWidth="1.3" />
        <circle cx="96" cy="176" r="58" className="fill-none stroke-sim-neutral" strokeWidth="1.3" strokeDasharray="5 3" />
        <path d="M 94.2 140.9 L 74.7 122 L 113.5 120.7 Z" className="fill-sim-warning/40 stroke-sim-warning" strokeWidth="1.2" />
      </g>
      <line x1="180" y1="26" x2="180" y2="186" className="stroke-sim-grid" />
      <text x="270" y="16" textAnchor="middle" className="fill-sim-ink text-[11px] font-semibold">
        Clock corrected
      </text>
      <text x="270" y="194" textAnchor="middle" className="fill-sim-muted text-[10px]">
        Shrink all equally: they meet
      </text>
      <g transform="translate(180 0)" clipPath="url(#gnss-clock-half)">
        <circle cx="40" cy="70" r="79.2" className="fill-none stroke-sim-signal" strokeWidth="1.3" />
        <circle cx="150" cy="64" r="85" className="fill-none stroke-sim-signal-2" strokeWidth="1.3" />
        <circle cx="96" cy="176" r="48" className="fill-none stroke-sim-neutral" strokeWidth="1.3" strokeDasharray="5 3" />
        <circle cx="94" cy="128" r="4" className="fill-primary" />
      </g>
    </Frame>
  )
}

export function GeometryVisual() {
  const band = (cx: number, cy: number, angle: number, cls: string) => (
    <rect x={cx - 90} y={cy - 9} width="180" height="18" transform={`rotate(${angle} ${cx} ${cy})`} className={cls} />
  )
  return (
    <Frame label="Each distance has some error, so it is a band, not a thin line. Satellites spread across the sky give bands that cross squarely: a small area. Bunched satellites give bands that cross at a shallow angle: a long, uncertain area.">
      <defs>
        <clipPath id="gnss-geo-l">
          <rect x="0" y="22" width="178" height="150" />
        </clipPath>
        <clipPath id="gnss-geo-r">
          <rect x="182" y="22" width="178" height="150" />
        </clipPath>
      </defs>
      <text x="90" y="16" textAnchor="middle" className="fill-sim-ink text-[11px] font-semibold">
        Spread out: small error
      </text>
      <text x="270" y="16" textAnchor="middle" className="fill-sim-ink text-[11px] font-semibold">
        Bunched: large error
      </text>
      <g clipPath="url(#gnss-geo-l)">
        {band(90, 98, 45, 'fill-sim-signal/20 stroke-sim-signal')}
        {band(90, 98, -45, 'fill-sim-signal-2/20 stroke-sim-signal-2')}
        <path d="M 90 85 L 103 98 L 90 111 L 77 98 Z" className="fill-sim-warning/50 stroke-sim-warning" />
      </g>
      <g clipPath="url(#gnss-geo-r)">
        {band(270, 98, 10, 'fill-sim-signal/20 stroke-sim-signal')}
        {band(270, 98, -10, 'fill-sim-signal-2/20 stroke-sim-signal-2')}
        <path d="M 218 98 L 270 89 L 322 98 L 270 107 Z" className="fill-sim-warning/50 stroke-sim-warning" />
      </g>
      <line x1="180" y1="24" x2="180" y2="172" className="stroke-sim-grid" />
      <text x="180" y="190" textAnchor="middle" className="fill-sim-muted text-[10px]">
        Shaded: where the receiver could be
      </text>
    </Frame>
  )
}

export function CorrectionsVisual() {
  return (
    <Frame label="The ionosphere, a layer of charged air high up, slows the signals. SBAS: ground stations measure the errors and a geostationary satellite broadcasts corrections over a whole region. GBAS: a station at the airport measures the errors and sends corrections by VHF radio to landing aircraft.">
      <rect x="0" y="52" width="360" height="22" className="fill-sim-signal-2/15" />
      <path d="M -20 210 Q 180 160 380 210 Z" className="fill-sim-land" />
      <line x1="48" y1="34" x2="92" y2="178" className="stroke-sim-signal" strokeWidth="1.3" />
      <line x1="48" y1="34" x2="220" y2="146" className="stroke-sim-signal" strokeWidth="1.3" />
      <line x1="250" y1="34" x2="232" y2="140" className="stroke-sim-signal-2" strokeWidth="1.3" strokeDasharray="4 3" />
      <Halo x="354" y="67" textAnchor="end" className="fill-sim-signal-2 text-[10px] font-semibold">
        Ionosphere: slows the signal
      </Halo>
      <Sat x={48} y={24} label="GPS" />
      <path d="M 250 16 L 259 25 L 250 34 L 241 25 Z" className="fill-sim-signal-2" />
      <text x="264" y="29" className="fill-sim-ink text-[10px] font-semibold">
        SBAS satellite
      </text>
      {/* SBAS ground reference station */}
      <rect x="86" y="178" width="12" height="9" className="fill-sim-bg stroke-sim-ink" strokeWidth="1.5" />
      <text x="104" y="186" className="fill-sim-ink text-[10px]">
        SBAS ground station
      </text>
      {/* Aircraft on approach and the GBAS station at the airport */}
      <path
        d="M-14 0 L10 -3 L14 0 L10 3 Z M-2 -1 L-8 -12 L-4 -12 L4 -1 Z M-2 1 L-8 12 L-4 12 L4 1 Z M-12 -1 L-15 -6 L-13 -6 L-9 -1 Z"
        transform="translate(234 148) rotate(12)"
        className="fill-sim-ink"
      />
      <rect x="306" y="176" width="12" height="9" className="fill-sim-bg stroke-sim-ink" strokeWidth="1.5" />
      <path d="M 306 174 q -24 -26 -56 -24" className="fill-none stroke-sim-warning" strokeWidth="1.5" strokeDasharray="3 3" />
      <text x="354" y="198" textAnchor="end" className="fill-sim-ink text-[10px]">
        GBAS at the airport (VHF)
      </text>
    </Frame>
  )
}

export function RaimVisual() {
  const L = 76
  return (
    <Frame label="Five distance lines. Four cross at one point; the fifth misses by a long way. With a spare measurement the receiver can see that something is wrong.">
      {[20, 70, 115, 160].map((a) => (
        <line
          key={a}
          x1={180 - L * Math.cos((a * Math.PI) / 180)}
          y1={88 - L * Math.sin((a * Math.PI) / 180)}
          x2={180 + L * Math.cos((a * Math.PI) / 180)}
          y2={88 + L * Math.sin((a * Math.PI) / 180)}
          className="stroke-sim-signal-2"
          strokeWidth="1.5"
        />
      ))}
      <line x1="60" y1="22" x2="330" y2="62" className="stroke-sim-alert" strokeWidth="2" strokeDasharray="6 3" />
      <Halo x="330" y="80" textAnchor="end" className="fill-sim-alert text-[11px] font-semibold">
        The odd one out
      </Halo>
      <circle cx="180" cy="88" r="5" className="fill-primary" />
      <text x="12" y="176" className="fill-sim-ink text-[11px]">
        5 satellites: "something is wrong"
      </text>
      <text x="12" y="192" className="fill-sim-ink text-[11px]">
        6 or more: "it is this one", and leave it out
      </text>
    </Frame>
  )
}
