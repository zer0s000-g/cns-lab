import { type ComponentType } from 'react'
import { lazyRetry } from '@/lib/lazyRetry'
import catalog from './catalog.json'
import {
  Antenna,
  Compass,
  Crosshair,
  MessageSquareText,
  Network,
  PlaneLanding,
  Radar,
  Radio,
  RadioTower,
  Ruler,
  Satellite,
  SatelliteDish,
  ScanLine,
  Waves,
  type LucideIcon,
} from 'lucide-react'

export type Pillar = 'communication' | 'navigation' | 'surveillance' | 'integration'

export const PILLARS: { id: Pillar; name: string; question: string }[] = [
  { id: 'communication', name: 'Communication', question: 'How do pilots and controllers talk?' },
  { id: 'navigation', name: 'Navigation', question: 'How does the aircraft know where it is and where to go?' },
  { id: 'surveillance', name: 'Surveillance', question: 'How does the controller see where aircraft are?' },
  { id: 'integration', name: 'Integration', question: 'How does everything work together?' },
]

export interface ModuleMeta {
  id: string
  /** Full name shown in the module header. */
  name: string
  /** Short name for chips and maps. */
  short: string
  pillar: Pillar
  phase: number
  /** One plain-language line. */
  summary: string
  minutes: number
  icon: LucideIcon
  path: string
}

/** Icon per module id. The module data itself lives in catalog.json, which the build scripts read too. */
const ICONS: Record<string, LucideIcon> = {
  psr: Radar,
  ssr: RadioTower,
  ads: Antenna,
  mlat: Crosshair,
  surface: ScanLine,
  ndb: Radio,
  dvor: Compass,
  dme: Ruler,
  ils: PlaneLanding,
  gnss: Satellite,
  vhf: Radio,
  hf: Waves,
  cpdlc: MessageSquareText,
  satcom: SatelliteDish,
  sandbox: Network,
}

// Surveillance first (flagship), then navigation, communication and integration: the order of catalog.json.
export const MODULES: ModuleMeta[] = catalog.map((m) => ({ ...m, pillar: m.pillar as Pillar, icon: ICONS[m.id] ?? Network }))

export const MODULE_BY_ID = new Map(MODULES.map((m) => [m.id, m]))

export const LEARNING_PATH = ['psr', 'ssr', 'ads', 'dvor', 'dme', 'ils', 'gnss', 'vhf', 'satcom', 'sandbox']

/** Every module folder exposes a default-exported page component from index.tsx. */
const loaders = import.meta.glob<{ default: ComponentType }>('./*/index.tsx')

const lazyCache = new Map<string, ComponentType>()

/** Lazy page component for a module, or null if the module is not built yet. */
export function getModuleComponent(id: string): ComponentType | null {
  const loader = loaders[`./${id}/index.tsx`]
  if (!loader) return null
  let c = lazyCache.get(id)
  if (!c) {
    c = lazyRetry(loader)
    lazyCache.set(id, c)
  }
  return c
}

export function isModuleReady(id: string): boolean {
  if (id === 'sandbox') return sandboxReady
  return Boolean(loaders[`./${id}/index.tsx`])
}

const sandboxLoaders = import.meta.glob<{ default: ComponentType }>('../pages/Sandbox/index.tsx')
const sandboxReady = Object.keys(sandboxLoaders).length > 0

export const pillarName = (p: Pillar) => PILLARS.find((x) => x.id === p)?.name ?? p

export const modulesByPillar = (p: Pillar) => MODULES.filter((m) => m.pillar === p)
