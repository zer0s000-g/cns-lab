import { describe, expect, it } from 'vitest'
import { FT_PER_NM } from '@/core/units'
import { formatMissionTime } from '@/hud/MissionClock'
import { isChunkLoadError } from '@/lib/lazyRetry'
import { MODULE_BY_ID } from '@/modules/registry'
import { AIRPORT_ZOOM, RUNWAY_HALF_NM, WORLD_SITES } from '@/pages/home/worldSites'
import { HEIGHT_EXAGGERATION, S, TABLE_RADIUS_NM, TABLE_RADIUS_U, V, toU } from '@/stage/scale'

describe('mission clock', () => {
  it('formats simulation seconds as T+HH:MM:SS', () => {
    expect(formatMissionTime(0)).toBe('T+00:00:00')
    expect(formatMissionTime(3725.9)).toBe('T+01:02:05')
    expect(formatMissionTime(-4)).toBe('T+00:00:00')
  })
})

describe('diorama scale', () => {
  it('maps the table rim to its radius in scene units', () => {
    expect(TABLE_RADIUS_NM * S).toBeCloseTo(TABLE_RADIUS_U)
  })

  it('uses east = +x, north = -z, up = +y', () => {
    expect(toU({ x: 6, y: 0 })).toEqual([1, 0, -0])
    expect(toU({ x: 0, y: 6 })[2]).toBeCloseTo(-1)
    expect(toU({ x: 0, y: 0 }, 10000)[1]).toBeCloseTo(1)
  })

  it('reports the true height exaggeration shown in the honesty label', () => {
    // One NM of height would be S units at true scale; heights are drawn at V units per foot.
    expect(HEIGHT_EXAGGERATION).toBeCloseTo((V * FT_PER_NM) / S, 10)
    expect(Math.round(HEIGHT_EXAGGERATION * 10) / 10).toBe(3.6)
  })
})

describe('home diorama sites', () => {
  it('link only to real modules', () => {
    for (const s of WORLD_SITES) expect(MODULE_BY_ID.has(s.id), s.id).toBe(true)
  })

  it('all sit on the table', () => {
    for (const s of WORLD_SITES) expect(Math.hypot(s.pos.x, s.pos.y), s.id).toBeLessThan(TABLE_RADIUS_NM)
  })

  it('draw the runway at the labelled airport zoom (3,000 m ≈ 1.62 NM real)', () => {
    expect(RUNWAY_HALF_NM * 2).toBeCloseTo(1.62 * AIRPORT_ZOOM)
  })
})

describe('chunk load errors', () => {
  it('recognises failed dynamic imports from the main browsers', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/psr-1.js'))).toBe(true)
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isChunkLoadError(new Error('error loading dynamically imported module'))).toBe(true)
  })

  it('does not treat ordinary crashes as a new deploy', () => {
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'pos')"))).toBe(false)
  })
})
