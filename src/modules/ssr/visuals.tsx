import { encodeGillham, REPLY_SLOTS, slotTimeUs, squawkToBits, type CodeBits } from '@/core/ssr'
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

function Radar({ x = 40, y = 150 }: { x?: number; y?: number }) {
  return (
    <g>
      <rect x={x - 4} y={y - 4} width="8" height="30" className="fill-sim-neutral" />
      <rect x={x - 20} y={y - 14} width="40" height="7" rx="1.5" className="fill-sim-signal" />
      <text x={x} y={y + 42} textAnchor="middle" className="fill-sim-ink text-[11px] font-semibold">
        Radar
      </text>
    </g>
  )
}

function Plane({ x, y, label }: { x: number; y: number; label?: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d="M-14 0 L10 -3 L14 0 L10 3 Z M-2 -1 L-8 -12 L-4 -12 L4 -1 Z M-2 1 L-8 12 L-4 12 L4 1 Z M-12 -1 L-15 -6 L-13 -6 L-9 -1 Z" className="fill-sim-ink" />
      {label && (
        <text x="0" y="-16" textAnchor="middle" className="fill-sim-ink text-[10px] font-semibold">
          {label}
        </text>
      )}
    </g>
  )
}

export function AskVisual() {
  const reduced = useReducedMotion()
  return (
    <Frame label="The radar sends three short pulses, P1, P2 and P3, on 1030 megahertz. The aircraft's transponder answers on 1090 megahertz.">
      <Radar />
      <Plane x={290} y={55} label="Transponder" />
      <line x1="60" y1="128" x2="275" y2="62" className="stroke-sim-grid-strong" strokeDasharray="4 4" />
      {[0, 1, 2].map((i) => (
        <rect key={i} width="4" height="12" className="fill-sim-signal" x={reduced ? 120 + i * 9 : 0} y={reduced ? 100 - i * 3 : 0}>
          {!reduced && <animateMotion path={`M ${60 + i * 9} ${122 - i * 3} L ${265 + i * 9} ${58 - i * 3}`} dur="2.4s" repeatCount="indefinite" />}
        </rect>
      ))}
      {[0, 1].map((i) => (
        <rect key={i} width="3" height="10" className="fill-sim-signal-2" x={reduced ? 200 + i * 6 : 0} y={reduced ? 90 : 0}>
          {!reduced && <animateMotion path={`M ${265 + i * 6} ${70} L ${70 + i * 6} ${130}`} dur="2.4s" begin="1.2s" repeatCount="indefinite" />}
        </rect>
      ))}
      <text x="130" y="84" className="fill-sim-signal text-[11px] font-semibold" transform="rotate(-17 130 84)">
        Question · 1030 MHz
      </text>
      <text x="175" y="128" className="fill-sim-signal-2 text-[11px] font-semibold" transform="rotate(-17 175 128)">
        Answer · 1090 MHz
      </text>
      <text x="180" y="190" textAnchor="middle" className="fill-sim-muted text-[11px]">
        Two different frequencies, so the question and the answer never mix
      </text>
    </Frame>
  )
}

export function SideLobeVisual() {
  return (
    <Frame label="Seen from above, the antenna sends P1 in a narrow main beam plus weak side lobes. P2 is sent equally in all directions, weaker than the main beam but stronger than the side lobes. An aircraft in the main beam hears P1 much stronger than P2 and answers; an aircraft in a side lobe hears P2 stronger and stays silent.">
      <circle cx="90" cy="110" r="42" className="fill-none stroke-sim-warning" strokeDasharray="5 4" strokeWidth="1.6" />
      <path d="M 90 110 L 185 96 Q 196 110 185 124 Z" className="fill-sim-signal" opacity="0.35" />
      <path d="M 90 110 L 185 96 Q 196 110 185 124 Z" className="fill-none stroke-sim-signal" strokeWidth="1.4" />
      {[40, 80, 140, 200, 250, 300].map((a) => {
        const r = 26 - (a % 3) * 3
        const rad = (a * Math.PI) / 180
        const x = 90 + Math.cos(rad) * r
        const y = 110 + Math.sin(rad) * r
        return <ellipse key={a} cx={(90 + x) / 2} cy={(110 + y) / 2} rx={r / 2} ry="4" transform={`rotate(${a} ${(90 + x) / 2} ${(110 + y) / 2})`} className="fill-sim-signal" opacity="0.3" />
      })}
      <circle cx="90" cy="110" r="4" className="fill-sim-signal" />
      <Plane x={172} y={110} />
      <Plane x={70} y={72} />
      <text x="90" y="175" textAnchor="middle" className="fill-sim-warning text-[10px] font-semibold">
        dashed: P2 from the control antenna
      </text>
      {/* Level bars */}
      <g transform="translate(222 32)">
        <text x="0" y="0" className="fill-sim-ink text-[11px] font-semibold">
          Main beam aircraft
        </text>
        <rect x="0" y="8" width="96" height="10" className="fill-sim-signal" />
        <text x="100" y="17" className="fill-sim-ink text-[10px]">
          P1
        </text>
        <rect x="0" y="22" width="40" height="10" className="fill-sim-warning" />
        <text x="44" y="31" className="fill-sim-ink text-[10px]">
          P2 → answers
        </text>
        <text x="0" y="64" className="fill-sim-ink text-[11px] font-semibold">
          Side-lobe aircraft
        </text>
        <rect x="0" y="72" width="18" height="10" className="fill-sim-signal" />
        <text x="22" y="81" className="fill-sim-ink text-[10px]">
          P1
        </text>
        <rect x="0" y="86" width="40" height="10" className="fill-sim-warning" />
        <text x="44" y="95" className="fill-sim-ink text-[10px]">
          P2 → silent
        </text>
      </g>
      <text x="222" y="150" className="fill-sim-muted text-[10px]">
        Reply only if P1 is at least
      </text>
      <text x="222" y="163" className="fill-sim-muted text-[10px]">
        9 dB stronger than P2
      </text>
    </Frame>
  )
}

function Train({ bits, y, spi }: { bits: CodeBits; y: number; spi?: boolean }) {
  const x0 = 20
  const k = 13 // px per µs
  return (
    <g>
      <line x1={x0} x2={x0 + 25 * k} y1={y} y2={y} className="stroke-sim-grid-strong" />
      <rect x={x0} y={y - 26} width="5" height="26" className="fill-sim-ink" />
      <rect x={x0 + 20.3 * k} y={y - 26} width="5" height="26" className="fill-sim-ink" />
      <text x={x0 + 2} y={y - 30} textAnchor="middle" className="fill-sim-ink text-[9px] font-semibold">
        F1
      </text>
      <text x={x0 + 20.3 * k + 2} y={y - 30} textAnchor="middle" className="fill-sim-ink text-[9px] font-semibold">
        F2
      </text>
      {REPLY_SLOTS.map((s) => {
        const x = x0 + slotTimeUs(s) * k
        const on = s !== 'X' && bits[s]
        return (
          <g key={s}>
            {on ? <rect x={x} y={y - 26} width="5" height="26" className="fill-sim-signal" /> : <rect x={x} y={y - 3} width="5" height="3" className="fill-sim-grid-strong" />}
            <text x={x + 2.5} y={y + 11} textAnchor="middle" className="fill-sim-muted text-[8px]">
              {s}
            </text>
          </g>
        )
      })}
      {spi && (
        <>
          <rect x={x0 + 24.65 * k} y={y - 26} width="5" height="26" className="fill-sim-warning" />
          <text x={x0 + 24.65 * k + 2} y={y - 30} textAnchor="middle" className="fill-sim-ink text-[9px] font-semibold">
            SPI
          </text>
        </>
      )}
    </g>
  )
}

export function ReplyVisual() {
  return (
    <Frame label="The reply: two framing pulses F1 and F2, 20.3 microseconds apart, with up to 12 code pulses between them. This example is squawk 7700. The SPI pulse after F2 is added when the pilot presses IDENT.">
      <text x="20" y="30" className="fill-sim-ink text-[12px] font-semibold">
        Reply for squawk 7700, with IDENT
      </text>
      <Train bits={squawkToBits('7700')} y={100} spi />
      <text x="20" y="140" className="fill-sim-ink text-[11px]">
        A = A4 + A2 + A1 = 4 + 2 + 1 = 7, and B = 7 too
      </text>
      <text x="20" y="158" className="fill-sim-ink text-[11px]">
        C and D pulses are all missing, so C = 0 and D = 0
      </text>
      <text x="20" y="185" className="fill-sim-muted text-[11px]">
        F1 and F2 frame the answer; X is never sent
      </text>
    </Frame>
  )
}

export function RangeVisual() {
  return (
    <Frame label="A timeline: the question travels out, the transponder waits 3 microseconds, the answer travels back. Distance is the speed of light times the time minus 3 microseconds, divided by two.">
      <text x="20" y="34" className="fill-sim-ink text-[12px] font-semibold">
        From P3 leaving to F1 arriving
      </text>
      <rect x="20" y="52" width="140" height="26" rx="4" className="fill-sim-signal" opacity="0.85" />
      <rect x="160" y="52" width="24" height="26" rx="2" className="fill-sim-neutral" />
      <rect x="184" y="52" width="140" height="26" rx="4" className="fill-sim-signal-2" opacity="0.7" />
      <text x="90" y="70" textAnchor="middle" className="fill-primary-foreground text-[11px] font-semibold">
        trip out
      </text>
      <text x="172" y="98" textAnchor="middle" className="fill-sim-ink text-[10px]">
        3 µs
      </text>
      <text x="254" y="70" textAnchor="middle" className="fill-sim-ink text-[11px] font-semibold">
        trip back
      </text>
      <text x="20" y="128" className="fill-sim-ink text-[12px]">
        Reply after 250 µs: take away the 3 µs wait,
      </text>
      <text x="20" y="146" className="fill-sim-ink text-[12px]">
        then halve: about 123 µs each way ≈ 20 NM.
      </text>
      <text x="20" y="178" className="fill-sim-muted text-[11px]">
        The antenna direction gives the bearing, as for primary radar
      </text>
    </Frame>
  )
}

export function AltitudeVisual() {
  const rows = [12000, 12100, 12200]
  return (
    <Frame label="Mode C altitude code: 12,000, 12,100 and 12,200 feet. Each 100 foot step changes exactly one pulse, so a reply caught mid-change is never wildly wrong.">
      <text x="20" y="26" className="fill-sim-ink text-[12px] font-semibold">
        Climbing 100 ft changes one pulse
      </text>
      {rows.map((alt, r) => {
        const bits = encodeGillham(alt)!
        const prev = r > 0 ? encodeGillham(rows[r - 1])! : null
        return (
          <g key={alt} transform={`translate(0 ${50 + r * 44})`}>
            <text x="20" y="14" className="fill-sim-ink font-mono text-[11px]">
              {alt.toLocaleString('en-US')} ft
            </text>
            {REPLY_SLOTS.filter((s) => s !== 'X').map((s, i) => {
              const on = bits[s as Exclude<typeof s, 'X'>]
              const changed = prev && prev[s as Exclude<typeof s, 'X'>] !== on
              return (
                <g key={s}>
                  <rect x={100 + i * 20} y="0" width="14" height="18" rx="2" className={on ? 'fill-sim-signal' : 'fill-none stroke-sim-grid-strong'} />
                  {changed && <rect x={98 + i * 20} y="-2" width="18" height="22" rx="3" className="fill-none stroke-sim-warning" strokeWidth="2" />}
                  {r === 0 && (
                    <text x={107 + i * 20} y="-4" textAnchor="middle" className="fill-sim-muted text-[8px]">
                      {s}
                    </text>
                  )}
                </g>
              )
            })}
          </g>
        )
      })}
      <text x="20" y="192" className="fill-sim-muted text-[11px]">
        Outlined: the one pulse that changed (a Gray code)
      </text>
    </Frame>
  )
}

export function ModeSVisual() {
  return (
    <Frame label="Mode S. The radar first sends an all-call to learn each aircraft's unique 24-bit address. After that it calls each aircraft by its address, and only that aircraft answers, so two aircraft close together never answer at the same time.">
      <Radar x={40} y={150} />
      <Plane x={250} y={60} label="8A01A1" />
      <Plane x={290} y={100} label="8A06F6" />
      <line x1="60" y1="130" x2="235" y2="64" className="stroke-sim-signal" strokeWidth="2" />
      <line x1="60" y1="134" x2="275" y2="104" className="stroke-sim-grid-strong" strokeDasharray="4 4" />
      <text x="120" y="80" className="fill-sim-signal text-[11px] font-semibold" transform="rotate(-20 120 80)">
        "8A01A1, answer"
      </text>
      <text x="220" y="140" className="fill-sim-muted text-[10px]">
        8A06F6 stays silent:
      </text>
      <text x="220" y="153" className="fill-sim-muted text-[10px]">
        not its address
      </text>
      <text x="20" y="192" className="fill-sim-muted text-[11px]">
        16,777,216 addresses: one per aircraft in the world
      </text>
    </Frame>
  )
}

export function LabelVisual() {
  return (
    <Frame label="The controller's screen shows a label next to each target: the code or callsign, the flight level, and a word such as EMERGENCY for special codes.">
      <rect x="0" y="0" width="360" height="200" className="fill-scope-bg" />
      {[40, 80, 120].map((r) => (
        <circle key={r} cx="60" cy="170" r={r} className="fill-none stroke-scope-grid" />
      ))}
      <rect x="146" y="86" width="10" height="10" className="fill-none stroke-scope-text" strokeWidth="1.6" />
      <line x1="156" y1="86" x2="170" y2="72" className="stroke-scope-text" />
      <text x="172" y="54" className="fill-scope-text font-mono text-[12px] font-semibold">
        CNS101
      </text>
      <text x="172" y="68" className="fill-scope-text font-mono text-[12px] font-semibold">
        120
      </text>
      <rect x="246" y="130" width="10" height="10" className="fill-none stroke-scope-alert" strokeWidth="1.6" />
      <rect x="241" y="125" width="20" height="20" className="fill-none stroke-scope-alert" />
      <text x="266" y="118" className="fill-scope-alert font-mono text-[12px] font-semibold">
        7700
      </text>
      <text x="266" y="132" className="fill-scope-alert font-mono text-[12px] font-semibold">
        080
      </text>
      <text x="266" y="146" className="fill-scope-alert font-mono text-[12px] font-semibold">
        EMERGENCY
      </text>
      <text x="12" y="20" className="fill-scope-dim text-[11px]">
        Who (code or callsign) and how high (flight level)
      </text>
    </Frame>
  )
}
