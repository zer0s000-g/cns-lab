import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
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

export const MODULES: ModuleMeta[] = [
  // Surveillance (flagship first)
  { id: 'psr', name: 'Primary Surveillance Radar', short: 'Primary radar', pillar: 'surveillance', phase: 1, minutes: 20, icon: Radar, path: '/modules/psr', summary: 'Finds aircraft by bouncing radio pulses off them, with no help from the aircraft.' },
  { id: 'ssr', name: 'Secondary Surveillance Radar and Mode S', short: 'SSR / Mode S', pillar: 'surveillance', phase: 1, minutes: 20, icon: RadioTower, path: '/modules/ssr', summary: 'Asks each aircraft "who are you and how high?" and reads the answer.' },
  { id: 'ads', name: 'ADS-B and ADS-C', short: 'ADS-B / ADS-C', pillar: 'surveillance', phase: 1, minutes: 20, icon: Antenna, path: '/modules/ads', summary: 'Aircraft broadcast their own satellite position twice a second.' },
  { id: 'mlat', name: 'Multilateration (MLAT and WAM)', short: 'MLAT / WAM', pillar: 'surveillance', phase: 5, minutes: 15, icon: Crosshair, path: '/modules/mlat', summary: 'Pinpoints an aircraft from tiny differences in when its signal arrives.' },
  { id: 'surface', name: 'Surface Movement Radar and A-SMGCS', short: 'Surface radar', pillar: 'surveillance', phase: 5, minutes: 15, icon: ScanLine, path: '/modules/surface', summary: 'A live map of every aircraft and vehicle on the airport, even in fog.' },
  // Navigation
  { id: 'ndb', name: 'NDB and ADF', short: 'NDB / ADF', pillar: 'navigation', phase: 2, minutes: 15, icon: Radio, path: '/modules/ndb', summary: 'A beacon that sends the same signal everywhere; the needle points at it.' },
  { id: 'dvor', name: 'VOR (Conventional and Doppler)', short: 'VOR', pillar: 'navigation', phase: 2, minutes: 25, icon: Compass, path: '/modules/dvor', summary: 'Two signals ticking out of step tell you your direction from the station.' },
  { id: 'dme', name: 'Distance Measuring Equipment', short: 'DME', pillar: 'navigation', phase: 2, minutes: 15, icon: Ruler, path: '/modules/dme', summary: 'Ask the ground "how far?", time the answer, and get the distance.' },
  { id: 'ils', name: 'Instrument Landing System', short: 'ILS', pillar: 'navigation', phase: 2, minutes: 25, icon: PlaneLanding, path: '/modules/ils', summary: 'Two radio beams guide the aircraft down to the runway in fog.' },
  { id: 'gnss', name: 'GNSS with SBAS and GBAS', short: 'GNSS', pillar: 'navigation', phase: 3, minutes: 25, icon: Satellite, path: '/modules/gnss', summary: 'Satellites broadcast the exact time; the receiver works out where it is.' },
  // Communication
  { id: 'vhf', name: 'VHF and UHF Air-Ground Radio', short: 'VHF radio', pillar: 'communication', phase: 4, minutes: 15, icon: Radio, path: '/modules/vhf', summary: 'Press to talk: straight-line radio whose range depends on height.' },
  { id: 'hf', name: 'HF Radio', short: 'HF radio', pillar: 'communication', phase: 4, minutes: 15, icon: Waves, path: '/modules/hf', summary: 'Radio waves that bounce off the sky to reach across oceans.' },
  { id: 'cpdlc', name: 'Controller–Pilot Data Link (CPDLC)', short: 'CPDLC', pillar: 'communication', phase: 4, minutes: 15, icon: MessageSquareText, path: '/modules/cpdlc', summary: 'Standard text messages instead of crowded voice radio.' },
  { id: 'satcom', name: 'Satellite Communication (SATCOM)', short: 'SATCOM', pillar: 'communication', phase: 4, minutes: 15, icon: SatelliteDish, path: '/modules/satcom', summary: 'Talking to ATC through satellites over oceans and poles.' },
  // Integration
  { id: 'sandbox', name: 'Airspace Sandbox', short: 'Sandbox', pillar: 'integration', phase: 6, minutes: 30, icon: Network, path: '/sandbox', summary: 'Every system working together, and what happens when one fails.' },
]

export const MODULE_BY_ID = new Map(MODULES.map((m) => [m.id, m]))

export const LEARNING_PATH = ['psr', 'ssr', 'ads', 'dvor', 'dme', 'ils', 'gnss', 'vhf', 'satcom', 'sandbox']

/** Every module folder exposes a default-exported page component from index.tsx. */
const loaders = import.meta.glob<{ default: ComponentType }>('./*/index.tsx')

const lazyCache = new Map<string, LazyExoticComponent<ComponentType>>()

/** Lazy page component for a module, or null if the module is not built yet. */
export function getModuleComponent(id: string): LazyExoticComponent<ComponentType> | null {
  const loader = loaders[`./${id}/index.tsx`]
  if (!loader) return null
  let c = lazyCache.get(id)
  if (!c) {
    c = lazy(loader)
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
