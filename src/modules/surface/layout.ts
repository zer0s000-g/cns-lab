/**
 * Layout of the CNS Lab airport surface, in metres (x east, y north, origin at
 * the airport reference point). Runway 09/27 comes from LAB_AIRPORT; the rest is
 * a simple, plausible layout: one parallel taxiway, connecting taxiways with
 * stop bars, an apron with stands, a terminal, a hangar and the control tower.
 */

import type { Vec2 } from '@/core/geometry'
import { labRunway, makePath, type Box, type Path, type Wall } from '@/core/surface'

export const RWY = labRunway()

/** Parallel taxiway A, north of the runway. */
// TODO(expert-review): runway–parallel taxiway separation for code letter E (Annex 14 Table 3-1, 182.5 m used here).
export const TWY_A_Y = 182.5
export const TWY_HALF_WIDTH = 11.5
export const TAXILANE_Y = 300
export const STAND_Y = 370

/** Connecting taxiways (runway ↔ taxiway A), with a stop bar where each meets the runway protected area. */
export const CONNECTORS = [
  { id: 'A1', x: -1470 },
  { id: 'A2', x: -700 },
  { id: 'A3', x: 100 },
  { id: 'A4', x: 800 },
  { id: 'A5', x: 1470 },
] as const
export type ConnectorId = (typeof CONNECTORS)[number]['id']

/** Stop bars sit on the runway-holding position line. */
export const STOP_BAR_Y = RWY.centreY + RWY.holdingDistM

/** Apron links between taxiway A and the apron taxilane. */
export const APRON_LINKS = [-650, 100, 500]

export const STANDS: Record<string, Vec2> = {
  S1: { x: -540, y: STAND_Y },
  S2: { x: -400, y: STAND_Y },
  S3: { x: -260, y: STAND_Y },
  S4: { x: -120, y: STAND_Y },
  S5: { x: 240, y: STAND_Y },
  S6: { x: 380, y: STAND_Y },
}

export const APRON: Box = { minX: -760, maxX: 560, minY: 215, maxY: 470 }
export const TERMINAL: Box = { minX: -760, maxX: 560, minY: 470, maxY: 560 }
export const HANGAR: Box = { minX: 620, maxX: 860, minY: 360, maxY: 520 }
export const TOWER_POS: Vec2 = { x: -900, y: 400 }
export const TOWER_BOX: Box = { minX: -908, maxX: -892, minY: 392, maxY: 408 }
/** Landside car park behind the terminal (where ghost targets tend to appear). */
export const CAR_PARK: Box = { minX: -700, maxX: 500, minY: 590, maxY: 900 }
export const BUILDINGS: { id: string; name: string; box: Box; heightM: number }[] = [
  { id: 'terminal', name: 'Terminal', box: TERMINAL, heightM: 20 },
  { id: 'hangar', name: 'Hangar', box: HANGAR, heightM: 25 },
  { id: 'tower', name: 'Tower', box: TOWER_BOX, heightM: 55 },
]

/** The terminal's airside glass face: the reflector that makes ghost targets. */
export const TERMINAL_FACE: Wall = { a: { x: TERMINAL.minX, y: TERMINAL.minY }, b: { x: TERMINAL.maxX, y: TERMINAL.minY } }

/** The SMR antenna sits on the control tower roof. */
export const SMR_SITE: Vec2 = { ...TOWER_POS }
export const SMR_HEIGHT_M = 60
/** Controller's eye height in the tower cab, m. */
export const TOWER_EYE_M = 55

/** Perimeter road south of the runway and the service road at the head of the stands. */
export const SOUTH_ROAD_Y = -220
export const SOUTH_ROAD_X: [number, number] = [-1600, 1600]
export const SERVICE_ROAD_Y = 440
export const SERVICE_ROAD_X: [number, number] = [-720, 520]

/** Airport MLAT receivers (antennas on short masts). */
export interface SurfaceReceiver {
  id: string
  pos: Vec2
  heightM: number
}
export const MLAT_RECEIVERS: SurfaceReceiver[] = [
  { id: 'M1', pos: { x: -1690, y: -300 }, heightM: 10 },
  { id: 'M2', pos: { x: -250, y: -380 }, heightM: 10 },
  { id: 'M3', pos: { x: 1300, y: -330 }, heightM: 10 },
  { id: 'M4', pos: { x: -1650, y: 650 }, heightM: 12 },
  { id: 'M5', pos: { x: 900, y: 700 }, heightM: 12 },
  { id: 'M6', pos: { x: 1900, y: 380 }, heightM: 10 },
]
/** The receiver the "MLAT receiver failure" switch takes out. */
export const FAILING_RECEIVER = 'M1'
/** On the ground each receiver hears only nearby transmitters (low antennas, blocking by aircraft and buildings). */
// TODO(expert-review): usable surface range of an airport MLAT receiver (2.5 km used here).
export const MLAT_RANGE_M = 2500

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const TOUCHDOWN_X = RWY.thresholdX + 300
export const TURNOFF_X = 60

/** Landing roll, exit at A3, taxi to a stand. */
export function arrivalPath(stand: Vec2): Path {
  return makePath([
    { x: TOUCHDOWN_X, y: 0 },
    { x: TURNOFF_X, y: 0 },
    { x: 88, y: 12 },
    { x: 100, y: 40 },
    { x: 100, y: TWY_A_Y },
    { x: 100, y: TAXILANE_Y - 25 },
    { x: 80, y: TAXILANE_Y },
    { x: stand.x + 25, y: TAXILANE_Y },
    { x: stand.x, y: TAXILANE_Y + 25 },
    { x: stand.x, y: stand.y },
  ])
}

/** Where the arrival has turned off the runway onto A3 (along-path distance), m. */
export function turnoffAlong(path: Path): number {
  return path.cum[1]
}

/** Pushback (the aircraft moves tail first) ending on the taxilane facing west. */
export function pushbackWestPath(stand: Vec2): Path {
  return makePath([
    { x: stand.x, y: stand.y },
    { x: stand.x, y: TAXILANE_Y + 30 },
    { x: stand.x + 15, y: TAXILANE_Y + 8 },
    { x: stand.x + 45, y: TAXILANE_Y },
  ])
}

/** Pushback ending on the taxilane facing east. */
export function pushbackEastPath(stand: Vec2): Path {
  return makePath([
    { x: stand.x, y: stand.y },
    { x: stand.x, y: TAXILANE_Y + 30 },
    { x: stand.x - 15, y: TAXILANE_Y + 8 },
    { x: stand.x - 45, y: TAXILANE_Y },
  ])
}

export const HOLD_A1: Vec2 = { x: -1470, y: STOP_BAR_Y + 25 }

/** From the end of pushback to the holding point at A1, via the west apron link and taxiway A. */
export function taxiOutPath(from: Vec2): Path {
  return makePath([
    from,
    { x: -625, y: TAXILANE_Y },
    { x: -650, y: TAXILANE_Y - 25 },
    { x: -650, y: TWY_A_Y + 25 },
    { x: -675, y: TWY_A_Y },
    { x: -1445, y: TWY_A_Y },
    { x: -1470, y: TWY_A_Y - 25 },
    HOLD_A1,
  ])
}

export const LINEUP_POINT: Vec2 = { x: RWY.thresholdX + 70, y: 0 }

/** From the A1 stop bar onto the runway, lined up for runway 09. */
export function lineupPath(): Path {
  return makePath([HOLD_A1, { x: -1470, y: 30 }, { x: -1455, y: 6 }, LINEUP_POINT])
}

export function takeoffPath(from: Vec2 = LINEUP_POINT): Path {
  return makePath([from, { x: RWY.endX + 60, y: 0 }])
}

/** Back along the runway to the line-up point (after a rejected take-off). */
export function backtrackPath(from: Vec2): Path {
  return makePath([from, LINEUP_POINT])
}

/** Cargo aircraft: in from the cargo area (east, off the map) to stand S6. */
export function cargoInPath(): Path {
  const s = STANDS.S6
  return makePath([
    { x: 2300, y: TWY_A_Y },
    { x: 525, y: TWY_A_Y },
    { x: 500, y: TWY_A_Y + 25 },
    { x: 500, y: TAXILANE_Y - 25 },
    { x: 475, y: TAXILANE_Y },
    { x: s.x + 25, y: TAXILANE_Y },
    { x: s.x, y: TAXILANE_Y + 25 },
    s,
  ])
}

export function cargoOutPath(from: Vec2): Path {
  return makePath([
    from,
    { x: 475, y: TAXILANE_Y },
    { x: 500, y: TAXILANE_Y - 25 },
    { x: 500, y: TWY_A_Y + 25 },
    { x: 525, y: TWY_A_Y },
    { x: 2300, y: TWY_A_Y },
  ])
}

export function southRoadPath(eastbound: boolean): Path {
  const [a, b] = SOUTH_ROAD_X
  return makePath(eastbound ? [{ x: a, y: SOUTH_ROAD_Y }, { x: b, y: SOUTH_ROAD_Y }] : [{ x: b, y: SOUTH_ROAD_Y }, { x: a, y: SOUTH_ROAD_Y }])
}

export function serviceRoadPath(eastbound: boolean): Path {
  const [a, b] = SERVICE_ROAD_X
  return makePath(eastbound ? [{ x: a, y: SERVICE_ROAD_Y }, { x: b, y: SERVICE_ROAD_Y }] : [{ x: b, y: SERVICE_ROAD_Y }, { x: a, y: SERVICE_ROAD_Y }])
}

/** A vehicle leaving the south road and driving onto the runway centreline. */
export function toRunwayPath(from: Vec2, x: number): Path {
  return makePath([from, { x, y: SOUTH_ROAD_Y + 20 }, { x, y: -30 }, { x, y: 0 }])
}
