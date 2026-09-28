/**
 * Small diagrams for "How it works". Screens drawn here use the dark
 * instrument tokens, like the real cockpit display.
 */

function Frame({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <svg viewBox="0 0 360 200" role="img" aria-label={label} className="h-auto w-full rounded-md border bg-sim-bg">
      {children}
    </svg>
  )
}

function Plane({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <path d="M-14 0 L10 -3 L14 0 L10 3 Z M-2 -1 L-8 -12 L-4 -12 L4 -1 Z M-2 1 L-8 12 L-4 12 L4 1 Z M-12 -1 L-15 -6 L-13 -6 L-9 -1 Z" className="fill-sim-ink" />
    </g>
  )
}

function Centre({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <g>
      <rect x={x - 26} y={y - 16} width="52" height="32" rx="4" className="fill-sim-land stroke-sim-ink" />
      <rect x={x - 14} y={y - 8} width="28" height="12" className="fill-sim-ink" />
      <text x={x} y={y + 30} textAnchor="middle" className="fill-sim-ink text-[10px] font-semibold">
        {label}
      </text>
    </g>
  )
}

function Screen({ x, y, w, h, lines }: { x: number; y: number; w: number; h: number; lines: { t: string; dim?: boolean; big?: boolean }[] }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="6" className="fill-instrument-face stroke-instrument-bezel" strokeWidth="3" />
      {lines.map((l, k) => (
        <text key={k} x={x + 10} y={y + 20 + k * 18} className={`${l.dim ? 'fill-instrument-dim' : 'fill-instrument-marking'} font-mono ${l.big ? 'text-[13px] font-bold' : 'text-[10px]'}`}>
          {l.t}
        </text>
      ))}
    </g>
  )
}

export function LogonVisual() {
  return (
    <Frame label="The aircraft sends a logon with its flight number, registration and aircraft address. The centre checks them against the flight plan and then opens a connection.">
      <Plane x={46} y={60} />
      <Centre x={300} y={60} label="ATC centre" />
      <line x1="66" y1="54" x2="270" y2="54" className="stroke-sim-signal" strokeWidth="2" markerEnd="url(#cp-arrow)" />
      <text x="168" y="46" textAnchor="middle" className="fill-sim-ink font-mono text-[10px]">
        LOGON CNS123 · PK-CNS · 8A1C23
      </text>
      <line x1="270" y1="74" x2="66" y2="74" className="stroke-sim-ok" strokeWidth="2" markerEnd="url(#cp-arrow2)" />
      <text x="168" y="90" textAnchor="middle" className="fill-sim-ink font-mono text-[10px]">
        matches flight plan: CONNECT
      </text>
      <defs>
        <marker id="cp-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0 L8 4 L0 8 Z" className="fill-sim-signal" />
        </marker>
        <marker id="cp-arrow2" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0 L8 4 L0 8 Z" className="fill-sim-ok" />
        </marker>
      </defs>
      <rect x="30" y="120" width="300" height="46" rx="6" className="fill-sim-land stroke-sim-grid-strong" />
      <text x="46" y="140" className="fill-sim-ink text-[11px] font-semibold">
        Flight plan CNS123: aircraft 8A1C23, PK-CNS
      </text>
      <text x="46" y="157" className="fill-sim-muted text-[10px]">
        A logon from any other aircraft is refused.
      </text>
      <text x="12" y="190" className="fill-sim-muted text-[11px]">
        Like signing in before you can receive messages.
      </text>
    </Frame>
  )
}

export function MessageVisual() {
  return (
    <Frame label="A cockpit data link screen showing the standard message CLIMB TO FL370 from the ATC centre, with WILCO, UNABLE and STANDBY keys.">
      <Screen
        x={40}
        y={18}
        w={280}
        h={120}
        lines={[
          { t: 'FROM XLAB · MIN 4 · 1423Z', dim: true },
          { t: 'CLIMB TO FL370', big: true },
          { t: 'UM20: a standard message element', dim: true },
        ]}
      />
      {['WILCO', 'UNABLE', 'STANDBY'].map((k, i) => (
        <g key={k}>
          <rect x={52 + i * 88} y="100" width="78" height="24" rx="4" className="fill-instrument-bezel" />
          <text x={91 + i * 88} y="116" textAnchor="middle" className="fill-instrument-marking font-mono text-[10px] font-semibold">
            {k}
          </text>
        </g>
      ))}
      <text x="12" y="166" className="fill-sim-ink text-[11px]">
        Every instruction has a fixed wording and a number.
      </text>
      <text x="12" y="184" className="fill-sim-muted text-[11px]">
        Nothing to mishear, nothing to write down.
      </text>
    </Frame>
  )
}

export function ReplyVisual() {
  const rows = [
    { t: 'XLAB  MIN 4', m: 'CLIMB TO FL370', up: true },
    { t: 'CNS123 MIN 2 MRN 4', m: 'STANDBY', up: false },
    { t: 'CNS123 MIN 3 MRN 4', m: 'WILCO', up: false },
  ]
  return (
    <Frame label="A conversation: the centre sends message number 4; the pilot answers STANDBY, then WILCO, and each answer refers to message 4.">
      {rows.map((r, k) => (
        <g key={k}>
          <rect x={r.up ? 20 : 140} y={16 + k * 46} width="200" height="36" rx="8" className={r.up ? 'fill-sim-land stroke-sim-signal' : 'fill-sim-land stroke-sim-ok'} strokeWidth="1.5" />
          <text x={(r.up ? 20 : 140) + 10} y={30 + k * 46} className="fill-sim-muted font-mono text-[9px]">
            {r.t}
          </text>
          <text x={(r.up ? 20 : 140) + 10} y={45 + k * 46} className="fill-sim-ink font-mono text-[11px] font-semibold">
            {r.m}
          </text>
        </g>
      ))}
      <text x="12" y="172" className="fill-sim-ink text-[11px]">
        Replies carry the number of the message they answer (MRN).
      </text>
      <text x="12" y="190" className="fill-sim-muted text-[11px]">
        STANDBY means “wait”; WILCO or UNABLE ends it.
      </text>
    </Frame>
  )
}

export function PathVisual() {
  const paths = [
    // Widths in proportion to the typical delays used in the simulator (5, 20 and 60 s): 4 px per second.
    { y: 44, name: 'VHF data link', t: 'a few seconds', w: 20 },
    { y: 96, name: 'SATCOM', t: 'tens of seconds', w: 80 },
    { y: 148, name: 'HF data link', t: 'about a minute', w: 240 },
  ]
  return (
    <Frame label="Three paths for the same message: VHF data link takes a few seconds, SATCOM tens of seconds, HF data link about a minute.">
      {paths.map((p) => (
        <g key={p.name}>
          <text x="20" y={p.y - 10} className="fill-sim-ink text-[11px] font-semibold">
            {p.name}
          </text>
          <rect x="20" y={p.y} width={p.w} height="14" rx="3" className="fill-sim-signal" />
          <text x={28 + p.w} y={p.y + 11} className="fill-sim-muted text-[10px]">
            {p.t}
          </text>
        </g>
      ))}
      <text x="12" y="192" className="fill-sim-muted text-[10px]">
        Typical one-way times used here (illustrative), bars to scale.
      </text>
    </Frame>
  )
}

export function AddressVisual() {
  return (
    <Frame label="A message addressed to aircraft 8A1C23 reaches two nearby aircraft. CNS123 accepts it; CNS132, whose address is different, ignores it.">
      <Centre x={50} y={70} label="XLAB" />
      <path d="M 80 64 C 160 30, 220 30, 270 46" className="fill-none stroke-sim-signal" strokeWidth="2" />
      <path d="M 80 74 C 160 110, 220 120, 270 128" className="fill-none stroke-sim-signal" strokeWidth="2" strokeDasharray="4 4" />
      <text x="170" y="30" textAnchor="middle" className="fill-sim-ink font-mono text-[10px]">
        TO 8A1C23: CLIMB TO FL370
      </text>
      <Plane x={296} y={46} />
      <text x="296" y="72" textAnchor="middle" className="fill-sim-ok text-[10px] font-semibold">
        CNS123 · 8A1C23 · mine
      </text>
      <Plane x={296} y={128} />
      <text x="296" y="154" textAnchor="middle" className="fill-sim-muted text-[10px] font-semibold">
        CNS132 · 8A1C32 · ignore
      </text>
      <text x="12" y="190" className="fill-sim-muted text-[11px]">
        On voice, CNS132 might have taken it. By data link it cannot.
      </text>
    </Frame>
  )
}

export function HandoverVisual() {
  return (
    <Frame label="Near the boundary the current centre names the next one, the next centre connects in the background, and END SERVICE hands the connection over.">
      <Centre x={60} y={50} label="XLAB (current)" />
      <Centre x={300} y={50} label="XHBR (next)" />
      <line x1="180" y1="20" x2="180" y2="92" className="stroke-sim-grid-strong" strokeDasharray="4 4" />
      <text x="180" y="104" textAnchor="middle" className="fill-sim-muted text-[10px]">
        boundary
      </text>
      <text x="20" y="130" className="fill-sim-ink font-mono text-[10px]">
        1 NEXT DATA AUTHORITY XHBR
      </text>
      <text x="20" y="148" className="fill-sim-ink font-mono text-[10px]">
        2 XHBR connects, waiting (inactive)
      </text>
      <text x="20" y="166" className="fill-sim-ink font-mono text-[10px]">
        3 CONTACT XHBR 132.350 · END SERVICE → WILCO
      </text>
      <text x="20" y="190" className="fill-sim-muted text-[11px]">
        One connection at a time is active: never two controllers.
      </text>
    </Frame>
  )
}

export function TimerVisual() {
  const x210 = 20 + (210 / 240) * 320
  return (
    <Frame label="A timer bar: the answer should normally come within 210 seconds and must come within 240 seconds. If not, the controller uses voice.">
      <text x="20" y="26" className="fill-sim-ink text-[11px] font-semibold">
        Waiting for WILCO…
      </text>
      <text x={x210} y="42" textAnchor="middle" className="fill-sim-ink font-mono text-[10px]">
        210 s: 95 %
      </text>
      <rect x="20" y="50" width="320" height="16" rx="8" className="fill-sim-grid" />
      <rect x="20" y="50" width="250" height="16" rx="8" className="fill-sim-warning" />
      <line x1={x210} y1="46" x2={x210} y2="70" className="stroke-sim-ink" strokeWidth="2" />
      <line x1="340" y1="46" x2="340" y2="70" className="stroke-sim-alert" strokeWidth="2" />
      <text x="340" y="84" textAnchor="end" className="fill-sim-alert font-mono text-[10px] font-semibold">
        240 s: the limit
      </text>
      <text x="20" y="118" className="fill-sim-ink text-[11px]">
        No answer in time, or the link is lost?
      </text>
      <text x="20" y="136" className="fill-sim-ink text-[11px] font-semibold">
        Pick up the radio: HF, VHF or satellite voice.
      </text>
      <text x="12" y="188" className="fill-sim-muted text-[11px]">
        RCP 240: the whole exchange within 240 s.
      </text>
    </Frame>
  )
}
