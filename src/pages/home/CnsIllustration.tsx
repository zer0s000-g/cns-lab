import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { PILLAR_ICON } from '@/components/PillarBadge'
import { MODULE_BY_ID, isModuleReady, pillarName, type Pillar } from '@/modules/registry'
import { cn } from '@/lib/utils'

type Filter = 'all' | Exclude<Pillar, 'integration'>

interface MapItem {
  id: string
  /** Short label drawn on the map. */
  label: string
  /** One-line plain description shown on hover, focus or tap. */
  desc: string
  /** Anchor point for the label (SVG units). */
  at: [number, number]
  labelDx?: number
  labelDy?: number
  art: ReactNode
}

const GROUND = 420

/** Drawn with token classes only; each item is a link to its module. */
const ITEMS: MapItem[] = [
  {
    id: 'ndb',
    label: 'NDB',
    desc: 'A simple beacon sending the same signal in every direction; the cockpit needle points at it.',
    at: [78, 300],
    art: (
      <g>
        <line x1="60" y1={GROUND} x2="60" y2="320" strokeWidth="3" />
        <line x1="96" y1={GROUND} x2="96" y2="320" strokeWidth="3" />
        <line x1="60" y1="322" x2="96" y2="322" strokeWidth="2" />
        <line x1="78" y1="322" x2="78" y2={GROUND} strokeWidth="1.5" />
      </g>
    ),
  },
  {
    id: 'dvor',
    label: 'VOR',
    desc: 'Tells an aircraft its direction from the station using two signals ticking out of step.',
    at: [168, 352],
    art: (
      <g>
        <rect x="128" y="392" width="80" height="8" rx="2" />
        {[132, 144, 156, 168, 180, 192, 204].map((x) => (
          <line key={x} x1={x} y1="392" x2={x} y2="378" strokeWidth="2" />
        ))}
        <rect x="163" y="370" width="10" height="22" rx="2" />
        <line x1="168" y1="400" x2="168" y2={GROUND} strokeWidth="3" />
      </g>
    ),
  },
  {
    id: 'dme',
    label: 'DME',
    desc: 'Answers the aircraft’s radio question so the aircraft can time the reply and work out its distance.',
    at: [232, 352],
    art: (
      <g>
        <line x1="232" y1={GROUND} x2="232" y2="372" strokeWidth="3" />
        <rect x="224" y="360" width="16" height="14" rx="3" />
      </g>
    ),
  },
  {
    id: 'psr',
    label: 'Radar',
    desc: 'Primary radar bounces pulses off aircraft; the secondary radar on top asks them who they are.',
    at: [310, 282],
    art: (
      <g>
        <path d={`M 298 ${GROUND} L 304 346 L 316 346 L 322 ${GROUND} Z`} />
        <rect x="300" y="336" width="20" height="10" rx="2" />
        <path d="M 286 318 Q 310 350 334 318" fill="none" strokeWidth="5" />
        <rect x="296" y="304" width="28" height="6" rx="2" />
      </g>
    ),
  },
  {
    id: 'ssr',
    label: 'SSR',
    desc: 'Secondary radar asks each aircraft "who are you and how high?" and reads the transponder’s answer.',
    at: [352, 300],
    labelDx: 6,
    art: (
      <g>
        <line x1="324" y1="307" x2="346" y2="304" strokeWidth="2" strokeDasharray="3 3" />
      </g>
    ),
  },
  {
    id: 'ils',
    label: 'ILS',
    desc: 'Two radio beams at the runway guide aircraft left-right and up-down down to the ground in fog.',
    at: [700, 372],
    art: (
      <g>
        {[684, 692, 700, 708, 716].map((x) => (
          <line key={x} x1={x} y1={GROUND} x2={x} y2="398" strokeWidth="3" />
        ))}
        <line x1="682" y1="398" x2="718" y2="398" strokeWidth="2" />
        <line x1="438" y1={GROUND} x2="438" y2="370" strokeWidth="3" />
        <line x1="432" y1="378" x2="444" y2="378" strokeWidth="2" />
        <line x1="432" y1="390" x2="444" y2="390" strokeWidth="2" />
      </g>
    ),
  },
  {
    id: 'surface',
    label: 'Surface radar',
    desc: 'A fast-spinning, very sharp radar on the tower that sees every aircraft and vehicle on the ground.',
    at: [560, 232],
    art: (
      <g>
        <rect x="548" y="246" width="24" height="5" rx="2" />
        <line x1="560" y1="251" x2="560" y2="258" strokeWidth="2" />
      </g>
    ),
  },
  {
    id: 'vhf',
    label: 'VHF radio',
    desc: 'Voice radio between pilots and controllers: press to talk, and the range depends on height.',
    at: [598, 292],
    labelDx: 8,
    art: (
      <g>
        <path d={`M 548 ${GROUND} L 552 290 L 568 290 L 572 ${GROUND} Z`} />
        <path d="M 538 290 L 582 290 L 576 262 L 544 262 Z" />
        <line x1="578" y1="262" x2="578" y2="240" strokeWidth="2" />
        <line x1="542" y1="262" x2="542" y2="244" strokeWidth="2" />
      </g>
    ),
  },
  {
    id: 'mlat',
    label: 'MLAT receivers',
    desc: 'Several receivers time the same aircraft signal; tiny differences in arrival time pinpoint the aircraft.',
    at: [640, 440],
    labelDy: 20,
    art: (
      <g>
        {[480, 640, 800].map((x) => (
          <path key={x} d={`M ${x} ${GROUND - 16} L ${x + 8} ${GROUND} L ${x - 8} ${GROUND} Z`} />
        ))}
      </g>
    ),
  },
  {
    id: 'ads',
    label: 'ADS-B station',
    desc: 'Listens to aircraft broadcasting their own satellite position about twice a second.',
    at: [856, 324],
    art: (
      <g>
        <line x1="856" y1={GROUND} x2="856" y2="340" strokeWidth="3" />
        <line x1="846" y1="352" x2="866" y2="352" strokeWidth="2" />
        <circle cx="856" cy="338" r="4" />
      </g>
    ),
  },
  {
    id: 'cpdlc',
    label: 'Control centre',
    desc: 'Controllers can send standard text messages to cockpits instead of speaking: CPDLC.',
    at: [760, 344],
    art: (
      <g>
        <rect x="730" y="364" width="60" height="56" rx="3" />
        {[740, 756, 772].map((x) => (
          <rect key={x} x={x} y="376" width="10" height="8" rx="1" className="fill-sim-bg" />
        ))}
      </g>
    ),
  },
  {
    id: 'hf',
    label: 'HF station',
    desc: 'HF radio waves bounce off the upper atmosphere to reach aircraft thousands of kilometres away.',
    at: [922, 302],
    art: (
      <g>
        <line x1="906" y1={GROUND} x2="906" y2="320" strokeWidth="3" />
        <line x1="938" y1={GROUND} x2="938" y2="320" strokeWidth="3" />
        <path d="M 906 324 L 922 314 L 938 324" fill="none" strokeWidth="2" />
      </g>
    ),
  },
  {
    id: 'gnss',
    label: 'GNSS satellite',
    desc: 'Satellites broadcast the exact time; a receiver measures the delays and works out where it is.',
    at: [236, 96],
    art: (
      <g>
        <rect x="224" y="52" width="24" height="18" rx="3" />
        <rect x="188" y="56" width="30" height="10" rx="1" />
        <rect x="254" y="56" width="30" height="10" rx="1" />
      </g>
    ),
  },
  {
    id: 'satcom',
    label: 'SATCOM satellite',
    desc: 'Aircraft over oceans and poles talk to ATC and send data through communication satellites.',
    at: [1044, 96],
    art: (
      <g>
        <rect x="1032" y="50" width="24" height="20" rx="3" />
        <rect x="994" y="54" width="32" height="12" rx="1" />
        <rect x="1062" y="54" width="32" height="12" rx="1" />
        <path d="M 1036 70 Q 1044 80 1052 70" fill="none" strokeWidth="2" />
      </g>
    ),
  },
]

function Aircraft({ x, y, angle = 0 }: { x: number; y: number; angle?: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle})`} className="fill-sim-ink">
      <path d="M -22 0 L 16 -3 L 22 0 L 16 3 Z M -4 -2 L -12 -16 L -6 -16 L 6 -2 Z M -4 2 L -12 16 L -6 16 L 6 2 Z M -19 -2 L -23 -9 L -20 -9 L -14 -2 Z" />
    </g>
  )
}

/** Interactive airport-and-airspace illustration. Every system links to its module. */
export function CnsIllustration() {
  const [filter, setFilter] = useState<Filter>('all')
  const [active, setActive] = useState<string>('psr')
  const navigate = useNavigate()
  const activeItem = ITEMS.find((i) => i.id === active) ?? ITEMS[0]
  const activeMeta = MODULE_BY_ID.get(activeItem.id)!
  const matches = useMemo(() => (id: string) => filter === 'all' || MODULE_BY_ID.get(id)?.pillar === filter, [filter])

  const go = (id: string) => {
    const m = MODULE_BY_ID.get(id)
    if (m) navigate(m.path)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToggleGroup
          type="single"
          variant="outline"
          spacing={0}
          value={filter}
          onValueChange={(v) => v && setFilter(v as Filter)}
          aria-label="Show systems for a pillar"
          className="flex-wrap"
        >
          <ToggleGroupItem value="all" className="px-3 text-xs">
            All
          </ToggleGroupItem>
          {(['communication', 'navigation', 'surveillance'] as const).map((p) => {
            const Icon = PILLAR_ICON[p]
            return (
              <ToggleGroupItem key={p} value={p} className="gap-1.5 px-3 text-xs">
                <Icon aria-hidden /> {pillarName(p)}
              </ToggleGroupItem>
            )
          })}
        </ToggleGroup>
        <p className="text-xs text-muted-foreground">Hover, tap or tab to a system. Click to open its module.</p>
      </div>

      <div className="relative overflow-hidden rounded-lg border bg-sim-sky">
        <svg viewBox="0 0 1200 520" className="block h-auto w-full" role="group" aria-label="Illustration of an airport and its airspace with every CNS system">
          {/* Sky, ground and sea */}
          <rect x="0" y="0" width="1200" height={GROUND} className="fill-sim-sky" />
          <rect x="0" y={GROUND} width="880" height={520 - GROUND} className="fill-sim-land" />
          <rect x="880" y={GROUND} width="320" height={520 - GROUND} className="fill-sim-water" />
          <line x1="0" y1={GROUND} x2="1200" y2={GROUND} className="stroke-sim-grid-strong" strokeWidth="1.5" />
          {/* Runway (side view) and approach path */}
          <rect x="380" y={GROUND - 4} width="300" height="6" rx="1" className="fill-sim-neutral" />
          <text x="530" y={GROUND + 22} textAnchor="middle" className="fill-sim-muted text-[13px]">
            Runway
          </text>
          <line x1="120" y1="250" x2="400" y2={GROUND - 3} className="stroke-sim-signal" strokeDasharray="6 6" strokeWidth="1.5" opacity="0.6" />
          <Aircraft x={260} y={333} angle={31} />
          <Aircraft x={600} y={140} />
          <Aircraft x={1080} y={200} />
          {/* Signal hints */}
          <line x1="600" y1="140" x2="236" y2="70" className="stroke-sim-signal-2" strokeDasharray="3 6" opacity="0.6" />
          <line x1="1080" y1="200" x2="1044" y2="72" className="stroke-sim-signal-2" strokeDasharray="3 6" opacity="0.6" />
          <line x1="1080" y1="200" x2="922" y2="320" className="stroke-sim-signal-2" strokeDasharray="3 6" opacity="0.4" />
          <text x="1080" y="236" textAnchor="middle" className="fill-sim-muted text-[12px]">
            Over the ocean
          </text>

          {ITEMS.map((it) => {
            const on = matches(it.id)
            const isActive = it.id === active
            const meta = MODULE_BY_ID.get(it.id)!
            return (
              <g
                key={it.id}
                role="link"
                tabIndex={0}
                aria-label={`${meta.name}: ${it.desc}${isModuleReady(it.id) ? '' : ' (coming soon)'}`}
                className={cn('cursor-pointer outline-none transition-opacity', !on && 'opacity-25')}
                onPointerEnter={(e) => e.pointerType === 'mouse' && setActive(it.id)}
                onFocus={() => setActive(it.id)}
                onClick={(e) => {
                  // On touch the first tap selects, the second opens.
                  if ((e.nativeEvent as PointerEvent).pointerType === 'touch' && active !== it.id) {
                    setActive(it.id)
                    return
                  }
                  go(it.id)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    go(it.id)
                  }
                }}
              >
                <g className={cn(isActive ? 'fill-primary stroke-primary' : 'fill-sim-ink stroke-sim-ink')}>{it.art}</g>
                <text
                  x={it.at[0] + (it.labelDx ?? 0)}
                  y={it.at[1] + (it.labelDy ?? 0)}
                  textAnchor="middle"
                  className={cn('text-[17px] font-semibold', isActive ? 'fill-primary' : 'fill-sim-ink')}
                  style={{ paintOrder: 'stroke', stroke: 'var(--sim-sky)', strokeWidth: 4 }}
                >
                  {it.label}
                </text>
                {isActive && (
                  <circle
                    cx={it.at[0] + (it.labelDx ?? 0)}
                    cy={it.at[1] + (it.labelDy ?? 0) - 5}
                    r="30"
                    className="fill-none stroke-primary"
                    strokeWidth="2"
                    strokeDasharray="4 4"
                  />
                )}
              </g>
            )
          })}
        </svg>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-center sm:justify-between" aria-live="polite">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground">
            <activeMeta.icon className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold">
              {activeMeta.name} <span className="ml-1 text-xs font-normal text-muted-foreground">· {pillarName(activeMeta.pillar)}</span>
            </p>
            <p className="text-sm text-muted-foreground">{activeItem.desc}</p>
          </div>
        </div>
        <Button size="sm" onClick={() => go(activeItem.id)} className="shrink-0">
          {isModuleReady(activeItem.id) ? 'Open module' : 'See what is coming'} <ArrowRight aria-hidden />
        </Button>
      </div>

      <ul className="flex flex-wrap gap-1.5" aria-label="All systems on the map">
        {ITEMS.filter((it) => matches(it.id)).map((it) => (
          <li key={it.id}>
            <button
              type="button"
              onClick={() => setActive(it.id)}
              onDoubleClick={() => go(it.id)}
              aria-pressed={it.id === active}
              className={cn(
                'inline-flex h-8 items-center rounded-md border px-2.5 text-xs font-medium hover:bg-muted pointer-coarse:h-10',
                it.id === active && 'border-primary bg-accent text-accent-foreground',
              )}
            >
              {MODULE_BY_ID.get(it.id)?.short}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
