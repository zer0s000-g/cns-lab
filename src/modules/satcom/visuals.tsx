import { useReducedMotion } from '@/stores/prefs'

/**
 * Small diagrams for "How it works". Distances are not to scale (a real GEO
 * satellite is almost six Earth radii away); each diagram says so.
 */

function Frame({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <svg viewBox="0 0 360 200" role="img" aria-label={label} className="h-auto w-full rounded-md border bg-sim-bg">
      {children}
    </svg>
  )
}

function Plane({ x, y, rot = 0, scale = 1 }: { x: number; y: number; rot?: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${scale})`}>
      <path d="M-14 0 L10 -3 L14 0 L10 3 Z M-2 -1 L-8 -12 L-4 -12 L4 -1 Z M-2 1 L-8 12 L-4 12 L4 1 Z M-12 -1 L-15 -6 L-13 -6 L-9 -1 Z" className="fill-sim-ink" />
    </g>
  )
}

function Sat({ x, y, label }: { x: number; y: number; label?: string }) {
  return (
    <g>
      <rect x={x - 5} y={y - 5} width="10" height="10" className="fill-sim-ink" />
      <rect x={x - 22} y={y - 2} width="14" height="4" className="fill-sim-signal-2" />
      <rect x={x + 8} y={y - 2} width="14" height="4" className="fill-sim-signal-2" />
      {label && (
        <text x={x} y={y - 10} textAnchor="middle" className="fill-sim-ink text-[10px] font-semibold">
          {label}
        </text>
      )}
    </g>
  )
}

function Dish({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <g>
      <path d={`M ${x - 10} ${y - 6} Q ${x} ${y + 6} ${x + 10} ${y - 6}`} className="fill-none stroke-sim-signal" strokeWidth="3" />
      <rect x={x - 2} y={y} width="4" height="12" className="fill-sim-neutral" />
      <text x={x} y={y + 24} textAnchor="middle" className="fill-sim-ink text-[10px] font-semibold">
        {label}
      </text>
    </g>
  )
}

export function UpDownVisual() {
  const reduced = useReducedMotion()
  return (
    <Frame label="The aircraft sends a signal up to a satellite, which sends it down to a ground station; from there it goes to air traffic control over ordinary networks.">
      <line x1="0" y1="150" x2="360" y2="150" className="stroke-sim-grid-strong" />
      <Plane x={60} y={104} />
      <Sat x={180} y={30} label="Satellite" />
      <Dish x={300} y={132} label="Ground station" />
      <path d="M 66 98 L 178 38 L 298 128" className="fill-none stroke-sim-signal" strokeWidth="1.5" strokeDasharray="4 4" />
      <circle r="4" className="fill-sim-warning" cx={reduced ? 178 : undefined} cy={reduced ? 38 : undefined}>
        {!reduced && <animateMotion path="M 66 98 L 178 38 L 298 128" dur="2.6s" repeatCount="indefinite" />}
      </circle>
      <text x="60" y="132" textAnchor="middle" className="fill-sim-ink text-[10px] font-semibold">
        Aircraft
      </text>
      <text x="12" y="178" className="fill-sim-muted text-[11px]">
        Then on to ATC over ground networks.
      </text>
      <text x="12" y="193" className="fill-sim-muted text-[10px]">
        Not to scale.
      </text>
    </Frame>
  )
}

export function GeoVisual() {
  // Earth radius 42 px, satellite 130 px from the centre (really 6.6 Earth radii: not to scale).
  // Tangent points: cos α = 42 / 130 → α ≈ 71°, i.e. (173.5, 60.2) and (173.5, 139.8).
  return (
    <Frame label="A geostationary satellite above the equator. Its coverage reaches most of one side of the Earth, but not the regions near the poles, where it is below the horizon.">
      <circle cx="160" cy="100" r="42" className="fill-sim-water stroke-sim-grid-strong" />
      <line x1="112" y1="100" x2="208" y2="100" className="stroke-sim-grid-strong" strokeDasharray="3 3" />
      <line x1="290" y1="100" x2="173.5" y2="60.2" className="stroke-sim-signal" />
      <line x1="290" y1="100" x2="173.5" y2="139.8" className="stroke-sim-signal" />
      <path d="M 173.5 60.2 A 42 42 0 0 1 173.5 139.8" className="fill-none stroke-sim-signal" strokeWidth="5" />
      <path d="M 173.5 60.2 A 42 42 0 0 0 146.5 60.2" className="fill-none stroke-sim-alert" strokeWidth="5" strokeDasharray="3 2" />
      <path d="M 146.5 139.8 A 42 42 0 0 0 173.5 139.8" className="fill-none stroke-sim-alert" strokeWidth="5" strokeDasharray="3 2" />
      <Sat x={290} y={100} label="GEO satellite" />
      <text x="160" y="48" textAnchor="middle" className="fill-sim-alert text-[10px] font-semibold">
        No coverage near the poles
      </text>
      <text x="108" y="104" textAnchor="end" className="fill-sim-muted text-[10px]">
        equator
      </text>
      <text x="228" y="148" className="fill-sim-signal text-[10px] font-semibold">
        covered
      </text>
      <text x="12" y="180" className="fill-sim-muted text-[11px]">
        35,786 km up, one turn per day: it stays over one spot.
      </text>
      <text x="12" y="194" className="fill-sim-muted text-[10px]">
        Not to scale.
      </text>
    </Frame>
  )
}

export function LeoVisual() {
  const reduced = useReducedMotion()
  const cx = 180
  const cy = 92
  const R = 74
  const sats = Array.from({ length: 10 }, (_, k) => ((k * 36 + 18) * Math.PI) / 180).map((a) => ({ x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) }))
  return (
    <Frame label="Low-orbit satellites circle close to the Earth. The message hops from satellite to satellite, like runners passing a baton, until one can send it down to a gateway.">
      <circle cx={cx} cy={cy} r="56" className="fill-sim-water stroke-sim-grid-strong" />
      <circle cx={cx} cy={cy} r={R} className="fill-none stroke-sim-grid-strong" strokeDasharray="3 4" />
      <g>
        <polyline points={sats.slice(0, 3).map((p) => `${p.x},${p.y}`).join(' ')} className="fill-none stroke-sim-signal" strokeWidth="2" />
        {sats.map((p, k) => (
          <circle key={k} cx={p.x} cy={p.y} r="4.5" className={k < 3 ? 'fill-sim-signal' : 'fill-sim-ink'} />
        ))}
        {!reduced && <animateTransform attributeName="transform" type="rotate" from={`0 ${cx} ${cy}`} to={`360 ${cx} ${cy}`} dur="40s" repeatCount="indefinite" />}
      </g>
      <Plane x={130} y={92} rot={-90} scale={0.7} />
      <text x="142" y="96" className="fill-sim-ink text-[10px] font-semibold">
        Aircraft
      </text>
      <text x="300" y="30" textAnchor="middle" className="fill-sim-ink text-[10px] font-semibold">
        Each passes overhead
      </text>
      <text x="300" y="43" textAnchor="middle" className="fill-sim-ink text-[10px] font-semibold">
        in about 10 minutes
      </text>
      <text x="300" y="150" textAnchor="middle" className="fill-sim-signal text-[10px] font-semibold">
        hop, hop, hop
      </text>
      <text x="12" y="192" className="fill-sim-muted text-[11px]">
        About 780 km up: 66 satellites cover the whole Earth, poles too.
      </text>
    </Frame>
  )
}

export function DelayVisual() {
  // Bar lengths in proportion: GEO one way ~260 ms, LEO ~30 ms. Scale 1 px = 1 ms.
  return (
    <Frame label="Bars comparing travel time. Through a GEO satellite the signal needs about a quarter of a second each way; through LEO satellites only a few hundredths of a second.">
      <text x="20" y="36" className="fill-sim-ink text-[12px] font-semibold">
        Trip through space, one way
      </text>
      <rect x="20" y="52" width="260" height="22" rx="3" className="fill-sim-signal" />
      <text x="286" y="68" className="fill-sim-ink text-[11px] font-semibold">
        GEO ≈ 0.26 s
      </text>
      <rect x="20" y="88" width="30" height="22" rx="3" className="fill-sim-signal-2" />
      <text x="58" y="104" className="fill-sim-ink text-[11px] font-semibold">
        LEO ≈ 0.03 s
      </text>
      <text x="20" y="140" className="fill-sim-ink text-[12px]">
        Question and answer via GEO: about half a second.
      </text>
      <text x="20" y="160" className="fill-sim-ink text-[12px]">
        Enough to notice in a conversation.
      </text>
      <text x="20" y="186" className="fill-sim-muted text-[11px]">
        Bars drawn to scale: 1 pixel = 1 millisecond.
      </text>
    </Frame>
  )
}

export function BankVisual() {
  return (
    <Frame label="An aircraft seen from behind, banked to the right. The antenna on its roof now faces right, and a low satellite on the left is hidden behind the aircraft's own body.">
      <line x1="0" y1="180" x2="360" y2="180" className="stroke-sim-grid-strong" />
      <g transform="translate(180 110) rotate(30)">
        <rect x="-70" y="-3" width="140" height="6" rx="3" className="fill-sim-ink" />
        <circle cx="0" cy="0" r="14" className="fill-sim-ink" />
        <rect x="-4" y="-22" width="8" height="8" className="fill-sim-signal" />
        <line x1="0" y1="-22" x2="0" y2="-70" className="stroke-sim-signal" strokeDasharray="4 3" />
      </g>
      <Sat x={40} y={70} label="Satellite" />
      <line x1="48" y1="74" x2="168" y2="104" className="stroke-sim-alert" strokeWidth="2" strokeDasharray="5 4" />
      <text x="40" y="104" className="fill-sim-alert text-[10px] font-semibold">
        blocked by the body
      </text>
      <text x="200" y="40" className="fill-sim-ink text-[10px] font-semibold">
        antenna on the roof
      </text>
      <text x="12" y="196" className="fill-sim-muted text-[11px]">
        Banking away from a low satellite hides it. Wings level: it is back.
      </text>
    </Frame>
  )
}

export function RainVisual() {
  const drops = Array.from({ length: 30 }, (_, k) => ({ x: 14 + ((k * 47) % 330), y: 44 + ((k * 29) % 120) }))
  const halo = { paintOrder: 'stroke' as const, strokeWidth: 4, strokeLinejoin: 'round' as const }
  return (
    <Frame label="Raindrops are much smaller than an L-band wave, which passes almost untouched. Ku and Ka-band waves are short enough for the rain to absorb and scatter them.">
      {drops.map((d, k) => (
        <line key={k} x1={d.x} y1={d.y} x2={d.x - 3} y2={d.y + 9} className="stroke-sim-signal-2" strokeWidth="1.5" opacity="0.55" />
      ))}
      <path d="M 20 70 C 45 40, 70 100, 95 70 S 145 40, 170 70 S 220 100, 245 70 S 295 40, 340 70" className="fill-none stroke-sim-signal" strokeWidth="2.5" />
      <text x="20" y="28" className="fill-sim-ink stroke-sim-bg text-[11px] font-semibold" style={halo}>
        L-band, 1.6 GHz: long wave, rain barely matters
      </text>
      <path d="M 20 150 q 5 -12 10 0 t 10 0 t 10 0 t 10 0 t 10 0 t 10 0 t 10 0 t 10 0 t 10 0 t 10 0 t 10 0 t 10 0 t 10 0 t 10 0 t 10 0 t 10 0 t 10 0 t 10 0 t 10 0 t 10 0 t 10 0 t 10 0 t 10 0 t 10 0 t 10 0 t 10 0 t 10 0 t 10 0 t 10 0 t 10 0 t 10 0 t 10 0" className="fill-none stroke-sim-warning" strokeWidth="2" opacity="0.9" />
      <text x="20" y="126" className="fill-sim-ink stroke-sim-bg text-[11px] font-semibold" style={halo}>
        Ku / Ka, 12–30 GHz: fades in heavy rain
      </text>
      <text x="12" y="190" className="fill-sim-muted text-[11px]">
        Safety services use L-band for exactly this reason.
      </text>
    </Frame>
  )
}

export function UsesVisual() {
  const items = [
    { x: 46, t1: 'Voice', t2: 'SATVOICE' },
    { x: 134, t1: 'CPDLC', t2: 'text clearances' },
    { x: 222, t1: 'ADS-C', t2: 'position reports' },
    { x: 310, t1: 'ADS-B', t2: 'heard from space' },
  ]
  return (
    <Frame label="Four uses of satellite links in air traffic management: voice calls, CPDLC text messages, ADS-C position reports, and ADS-B broadcasts received by satellites.">
      <Sat x={180} y={34} />
      {items.map((it) => (
        <g key={it.t1}>
          <line x1="180" y1="44" x2={it.x} y2="112" className="stroke-sim-grid-strong" strokeDasharray="3 3" />
          <rect x={it.x - 42} y="112" width="84" height="44" rx="6" className="fill-sim-land stroke-sim-grid-strong" />
          <text x={it.x} y="131" textAnchor="middle" className="fill-sim-ink text-[12px] font-semibold">
            {it.t1}
          </text>
          <text x={it.x} y="147" textAnchor="middle" className="fill-sim-muted text-[9px]">
            {it.t2}
          </text>
        </g>
      ))}
      <text x="12" y="188" className="fill-sim-muted text-[11px]">
        Over oceans and poles, where there is no radar and no VHF radio.
      </text>
    </Frame>
  )
}
