import { useReducedMotion } from '@/stores/prefs'
import { Frame, Mast, Plane } from '@/modules/vhf/visuals'

/** Diagrams for "How it works" (animations left out when motion is reduced). */

const EARTH = 'M -10 175 Q 180 115 370 175 L 370 210 L -10 210 Z'

export function BeyondHorizonVisual() {
  return (
    <Frame label="Over the ocean, a straight VHF line from the coast passes above an aircraft beyond the horizon. An HF wave bounces off the upper atmosphere and comes down to reach it.">
      <path d="M -10 60 Q 180 0 370 60" className="fill-none stroke-sim-signal-2" strokeWidth="10" opacity="0.25" />
      <text x="180" y="22" textAnchor="middle" className="fill-sim-muted text-[10px]">
        ionosphere
      </text>
      <path d={EARTH} className="fill-sim-water stroke-sim-grid-strong" strokeWidth="1.5" />
      <Mast x={40} y={158} />
      <line x1="40" y1="126" x2="330" y2="96" className="stroke-sim-muted" strokeWidth="1.5" strokeDasharray="5 4" />
      <text x="250" y="96" textAnchor="middle" className="fill-sim-muted text-[10px]">
        VHF: straight, misses
      </text>
      <path d="M 40 126 L 180 32 L 318 150" className="fill-none stroke-sim-signal" strokeWidth="2" />
      <Plane x={320} y={150} />
      <text x="300" y="130" textAnchor="middle" className="fill-sim-ink text-[11px] font-semibold">
        HF: bounces
      </text>
    </Frame>
  )
}

export function IonosphereVisual() {
  const reduced = useReducedMotion()
  const band = (y: number, h: number, label: string, o: number) => (
    <g>
      <rect x="60" y={y} width="290" height={h} className="fill-sim-signal-2" opacity={o} />
      <text x="66" y={y + h / 2 + 4} className="fill-sim-ink text-[11px] font-semibold">
        {label}
      </text>
    </g>
  )
  return (
    <Frame label="Layers of the ionosphere above the Earth, made by sunlight: D lowest, then E, then F1 and F2 highest. The Sun shines on them from the left.">
      <circle cx="28" cy="40" r="14" className="fill-sim-warning">
        {!reduced && <animate attributeName="r" values="13;15;13" dur="3s" repeatCount="indefinite" />}
      </circle>
      {band(20, 34, 'F2  250–400 km', 0.3)}
      {band(66, 16, 'F1  about 200 km (day)', 0.22)}
      {band(98, 14, 'E  about 110 km', 0.2)}
      <rect x="60" y="128" width="290" height="16" className="fill-sim-neutral" opacity="0.3" />
      <text x="66" y="140" className="fill-sim-ink text-[11px] font-semibold">
        D  60–90 km: absorbs (day)
      </text>
      <rect x="0" y="170" width="360" height="30" className="fill-sim-water" />
      <text x="180" y="190" textAnchor="middle" className="fill-sim-muted text-[11px]">
        Earth · not to scale
      </text>
    </Frame>
  )
}

export function BounceVisual() {
  return (
    <Frame label="Two waves leave at the same angle. The lower frequency is bent back down by the layer; the higher frequency passes through into space. A slanting wave bounces more easily than one going straight up.">
      <rect x="0" y="36" width="360" height="22" className="fill-sim-signal-2" opacity="0.25" />
      <text x="354" y="30" textAnchor="end" className="fill-sim-muted text-[10px]">
        F layer
      </text>
      <rect x="0" y="170" width="360" height="30" className="fill-sim-water" />
      <path d="M 30 170 L 130 47 L 230 170" className="fill-none stroke-sim-signal" strokeWidth="2" />
      <text x="235" y="160" className="fill-sim-ink text-[11px] font-semibold">
        8 MHz: comes back
      </text>
      <path d="M 30 170 L 150 22" className="fill-none stroke-sim-signal-2" strokeWidth="2" strokeDasharray="7 5" />
      <path d="M 150 22 l -2 9 l 7 -5 z" className="fill-sim-signal-2" />
      <text x="160" y="18" className="fill-sim-ink text-[11px] font-semibold">
        20 MHz: escapes
      </text>
      <text x="180" y="120" textAnchor="middle" className="fill-sim-muted text-[10px]">
        same angle, different frequency
      </text>
    </Frame>
  )
}

export function SkipZoneVisual() {
  return (
    <Frame label="Steep waves escape into space, so the first wave to come back lands far from the station. Between the end of the ground wave and that landing point is the skip zone, where nothing is heard.">
      <rect x="0" y="34" width="360" height="20" className="fill-sim-signal-2" opacity="0.25" />
      <rect x="0" y="160" width="360" height="40" className="fill-sim-water" />
      <path d="M 20 160 L 60 18" className="fill-none stroke-sim-signal-2" strokeWidth="1.5" strokeDasharray="6 4" />
      <path d="M 20 160 L 92 18" className="fill-none stroke-sim-signal-2" strokeWidth="1.5" strokeDasharray="6 4" />
      <path d="M 20 160 L 150 44 L 280 160" className="fill-none stroke-sim-signal" strokeWidth="2" />
      <path d="M 20 160 L 185 44 L 350 160" className="fill-none stroke-sim-signal" strokeWidth="1.5" opacity="0.6" />
      <rect x="20" y="160" width="40" height="10" className="fill-sim-signal" />
      <rect x="60" y="160" width="220" height="10" className="fill-sim-warning" opacity="0.35" />
      <rect x="280" y="160" width="80" height="10" className="fill-sim-signal" />
      <text x="40" y="186" textAnchor="middle" className="fill-sim-ink text-[10px]">
        ground wave
      </text>
      <text x="170" y="186" textAnchor="middle" className="fill-sim-ink text-[11px] font-semibold">
        skip zone: nothing heard
      </text>
      <text x="320" y="186" textAnchor="middle" className="fill-sim-ink text-[10px]">
        heard
      </text>
    </Frame>
  )
}

export function DayNightVisual() {
  return (
    <Frame label="By day the D layer absorbs low frequencies and a high frequency is used. At night the D layer disappears, the F layer can only return lower frequencies, and a low frequency is used.">
      <line x1="180" y1="10" x2="180" y2="190" className="stroke-sim-grid-strong" />
      <text x="90" y="22" textAnchor="middle" className="fill-sim-ink text-[12px] font-semibold">
        Day
      </text>
      <text x="270" y="22" textAnchor="middle" className="fill-sim-ink text-[12px] font-semibold">
        Night
      </text>
      <rect x="0" y="40" width="178" height="20" className="fill-sim-signal-2" opacity="0.35" />
      <rect x="182" y="46" width="178" height="16" className="fill-sim-signal-2" opacity="0.2" />
      <rect x="0" y="120" width="178" height="16" className="fill-sim-neutral" opacity="0.35" />
      <text x="8" y="132" className="fill-sim-ink text-[10px]">
        D absorbs
      </text>
      <rect x="0" y="170" width="360" height="30" className="fill-sim-water" />
      <path d="M 20 170 L 90 48 L 160 170" className="fill-none stroke-sim-signal" strokeWidth="2" />
      <text x="90" y="100" textAnchor="middle" className="fill-sim-ink text-[10px] font-semibold">
        high f: 13–22 MHz
      </text>
      <path d="M 200 170 L 270 54 L 340 170" className="fill-none stroke-sim-signal" strokeWidth="2" />
      <text x="270" y="100" textAnchor="middle" className="fill-sim-ink text-[10px] font-semibold">
        low f: 3–10 MHz
      </text>
      <text x="270" y="140" textAnchor="middle" className="fill-sim-muted text-[10px]">
        D layer gone
      </text>
    </Frame>
  )
}

export function SelcalVisual() {
  const reduced = useReducedMotion()
  return (
    <Frame label="The ground station sends two pairs of tones, for example A and B together, then C and D. Only the aircraft whose code is AB-CD rings a chime and lights its SELCAL light.">
      <text x="20" y="32" className="fill-sim-ink text-[11px] font-semibold">
        Station sends
      </text>
      <rect x="20" y="44" width="90" height="24" rx="4" className="fill-sim-signal" />
      <text x="65" y="60" textAnchor="middle" className="fill-primary-foreground text-[11px] font-semibold">
        A + B (1 s)
      </text>
      <rect x="120" y="44" width="90" height="24" rx="4" className="fill-sim-signal" />
      <text x="165" y="60" textAnchor="middle" className="fill-primary-foreground text-[11px] font-semibold">
        C + D (1 s)
      </text>
      <text x="115" y="84" textAnchor="middle" className="fill-sim-muted text-[10px]">
        short gap
      </text>
      <g>
        <circle cx="70" cy="140" r="14" className="fill-sim-signal">
          {!reduced && <animate attributeName="opacity" values="1;0.4;1" dur="1s" repeatCount="indefinite" />}
        </circle>
        <text x="70" y="144" textAnchor="middle" className="fill-primary-foreground text-[10px] font-bold">
          SC
        </text>
        <text x="96" y="136" className="fill-sim-ink text-[11px] font-semibold">
          AB-CD: chime
        </text>
        <text x="96" y="150" className="fill-sim-muted text-[10px]">
          this is me
        </text>
      </g>
      <g>
        <circle cx="240" cy="140" r="14" className="fill-sim-land stroke-sim-grid-strong" />
        <text x="240" y="144" textAnchor="middle" className="fill-sim-muted text-[10px] font-bold">
          SC
        </text>
        <text x="264" y="136" className="fill-sim-ink text-[11px] font-semibold">
          AF-GM
        </text>
        <text x="264" y="150" className="fill-sim-muted text-[10px]">
          stays quiet
        </text>
      </g>
      <text x="180" y="190" textAnchor="middle" className="fill-sim-muted text-[11px]">
        The pilot does not have to listen to hours of noise
      </text>
    </Frame>
  )
}
