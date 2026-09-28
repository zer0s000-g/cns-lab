import { useReducedMotion } from '@/stores/prefs'

function Frame({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <svg viewBox="0 0 360 200" role="img" aria-label={label} className="h-auto w-full rounded-md border bg-sim-bg">
      {children}
    </svg>
  )
}

export function FusionVisual() {
  const reduced = useReducedMotion()
  return (
    <Frame label="Radar, ADS-B and multilateration each report a position; the tracker merges them into one track.">
      {[
        { x: 50, y: 40, t: 'Radar' },
        { x: 50, y: 100, t: 'ADS-B' },
        { x: 50, y: 160, t: 'WAM' },
      ].map((s) => (
        <g key={s.t}>
          <circle cx={s.x} cy={s.y} r="14" className="fill-sim-bg stroke-sim-signal" strokeWidth="2" />
          <text x={s.x} y={s.y + 30} textAnchor="middle" className="fill-sim-ink text-[11px] font-semibold">
            {s.t}
          </text>
          <line x1={s.x + 16} y1={s.y} x2="250" y2="100" className="stroke-sim-grid-strong" strokeDasharray="4 4" />
          <circle r="4" className="fill-sim-signal">
            {!reduced && <animateMotion path={`M ${s.x + 16} ${s.y} L 250 100`} dur="1.8s" begin={`${s.y / 200}s`} repeatCount="indefinite" />}
          </circle>
        </g>
      ))}
      <path d="M 262 92 L 272 100 L 262 108 L 252 100 Z" className="fill-sim-ink" />
      <text x="262" y="130" textAnchor="middle" className="fill-sim-ink text-[12px] font-semibold">
        One track
      </text>
      <text x="262" y="146" textAnchor="middle" className="fill-sim-muted text-[10px]">
        CNS700 · FL350 · 460 kt
      </text>
    </Frame>
  )
}

export function TrackVisual() {
  return (
    <Frame label="Noisy position reports scattered around a smooth track; after the last report the track continues as a dashed prediction and is marked as coasting.">
      <path d="M 20 150 Q 120 130 200 90" className="fill-none stroke-sim-signal" strokeWidth="3" />
      <path d="M 200 90 Q 250 64 320 40" className="fill-none stroke-sim-signal" strokeWidth="2" strokeDasharray="6 6" />
      {[
        [30, 154],
        [58, 140],
        [84, 146],
        [110, 128],
        [132, 132],
        [158, 112],
        [180, 104],
        [198, 86],
      ].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="3" className="fill-sim-ink" />
      ))}
      <circle cx="300" cy="48" r="10" className="fill-none stroke-sim-muted" strokeDasharray="3 3" strokeWidth="2" />
      <text x="24" y="182" className="fill-sim-muted text-[11px]">
        Dots: sensor reports
      </text>
      <text x="200" y="182" className="fill-sim-muted text-[11px]">
        Dashes: coasting, no data
      </text>
    </Frame>
  )
}

export function SafetyNetVisual() {
  return (
    <Frame label="Left: two aircraft whose predicted paths meet trigger a conflict alert. Right: an aircraft whose predicted descent meets a hill triggers a terrain alert.">
      <line x1="20" y1="40" x2="100" y2="100" className="stroke-sim-ink" strokeWidth="2" />
      <line x1="100" y1="100" x2="140" y2="130" className="stroke-sim-ink" strokeDasharray="4 4" strokeWidth="2" />
      <line x1="170" y1="40" x2="110" y2="100" className="stroke-sim-ink" strokeWidth="2" />
      <line x1="110" y1="100" x2="80" y2="130" className="stroke-sim-ink" strokeDasharray="4 4" strokeWidth="2" />
      <circle cx="105" cy="104" r="16" className="fill-none stroke-sim-alert" strokeWidth="2" />
      <text x="105" y="160" textAnchor="middle" className="fill-sim-alert text-[12px] font-semibold">
        STCA
      </text>
      <path d="M 200 170 L 250 170 L 300 90 L 350 170 Z" className="fill-sim-terrain" />
      <line x1="200" y1="60" x2="260" y2="90" className="stroke-sim-ink" strokeWidth="2" />
      <line x1="260" y1="90" x2="300" y2="110" className="stroke-sim-ink" strokeDasharray="4 4" strokeWidth="2" />
      <circle cx="296" cy="106" r="14" className="fill-none stroke-sim-alert" strokeWidth="2" />
      <text x="290" y="190" textAnchor="middle" className="fill-sim-alert text-[12px] font-semibold">
        MSAW
      </text>
    </Frame>
  )
}

export function RedundancyVisual() {
  const rows = ['Primary radar', 'Secondary radar', 'ADS-B', 'WAM', 'ADS-C']
  return (
    <Frame label="Five surveillance layers; one is failed and crossed out, the others still carry the aircraft.">
      {rows.map((r, i) => {
        const failed = i === 1
        return (
          <g key={r}>
            <text x="20" y={36 + i * 32} className="fill-sim-ink text-[11px] font-semibold">
              {r}
            </text>
            <rect x="130" y={24 + i * 32} width="210" height="16" rx="3" className={failed ? 'fill-sim-grid' : 'fill-sim-signal'} opacity={failed ? 1 : 0.8} />
            {failed && <line x1="130" y1={32 + i * 32} x2="340" y2={32 + i * 32} className="stroke-sim-alert" strokeWidth="2" />}
          </g>
        )
      })}
    </Frame>
  )
}

export function JourneyVisual() {
  return (
    <Frame label="Altitude profile of the journey: climb, cruise over the ocean, descent and the ILS approach, with the systems used in each stage.">
      <path d="M 20 170 L 70 60 L 290 60 L 330 150 L 345 170" className="fill-none stroke-sim-signal" strokeWidth="3" />
      <line x1="10" y1="172" x2="350" y2="172" className="stroke-sim-grid-strong" />
      <text x="36" y="190" className="fill-sim-muted text-[10px]">
        Radar · VHF · WAM
      </text>
      <text x="130" y="48" className="fill-sim-muted text-[10px]">
        Ocean: ADS-C · SATCOM · HF
      </text>
      <text x="262" y="190" className="fill-sim-muted text-[10px]">
        ILS · radar · VHF
      </text>
      <text x="170" y="120" textAnchor="middle" className="fill-sim-ink text-[11px] font-semibold">
        GNSS and inertial all the way
      </text>
    </Frame>
  )
}
