// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { ReactNode } from 'react'
import { SandboxProvider, useSandbox } from '@/pages/Sandbox/state'
import { JourneyTimeline } from '@/pages/Sandbox/cockpit/JourneyTimeline'
import { StopCard } from '@/pages/Sandbox/cockpit/StopCard'
import { ControlsStrip } from '@/pages/Sandbox/cockpit/TopBar'
import { Debrief, QUIZ } from '@/pages/Sandbox/cockpit/Debrief'
import { getJourneyIndex } from '@/pages/Sandbox/phases'
import type { SandboxEngine } from '@/pages/Sandbox/engine'
import type { SimClock } from '@/hooks/useSimClock'
import type { StoreApi } from 'zustand'
import type { SandboxState } from '@/pages/Sandbox/state'

beforeAll(() => {
  // jsdom lacks these browser APIs.
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia
  window.scrollTo = (() => {}) as typeof window.scrollTo
  getJourneyIndex()
})
afterEach(cleanup)

let ctx: { engine: SandboxEngine; clock: SimClock; store: StoreApi<SandboxState> }
function Grab() {
  ctx = useSandbox()
  return null
}
function renderWith(ui: ReactNode) {
  return render(
    <MemoryRouter>
      <SandboxProvider>
        <Grab />
        {ui}
      </SandboxProvider>
    </MemoryRouter>,
  )
}

describe('journey timeline', () => {
  it('shows the twelve phases, marks the current one, and jumps when one is pressed', () => {
    renderWith(<JourneyTimeline />)
    const nav = screen.getByRole('navigation', { name: 'Journey phases' })
    const buttons = within(nav).getAllByRole('button')
    expect(buttons).toHaveLength(12)
    expect(buttons[0].getAttribute('aria-current')).toBe('step')
    expect(buttons[0].getAttribute('aria-label')).toMatch(/^01 At the gate \(now\)\./)
    fireEvent.click(within(nav).getByRole('button', { name: /^04 Take-off/ }))
    expect(ctx.engine.phase).toBe('takeoff')
  })
})

describe('guided stop', () => {
  it('explains the moment, takes focus, and Continue resumes the journey', () => {
    renderWith(<StopCard />)
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => {
      ctx.clock.getState().pause()
      ctx.store.getState().showStop('takeoffClearance')
    })
    const dialog = screen.getByRole('dialog', { name: 'Cleared for take-off' })
    const cont = within(dialog).getByRole('button', { name: 'Continue' })
    expect(document.activeElement).toBe(cont)
    fireEvent.click(cont)
    expect(ctx.store.getState().activeStop).toBeNull()
    expect(ctx.clock.getState().running).toBe(true)
    expect(ctx.store.getState().stopsEnabled).toBe(true)
  })

  it('can turn the stops off, and Escape also continues', () => {
    renderWith(<StopCard />)
    act(() => ctx.store.getState().showStop('touchdown'))
    fireEvent.click(screen.getByRole('button', { name: 'Continue without stops' }))
    expect(ctx.store.getState().stopsEnabled).toBe(false)
    act(() => ctx.store.getState().showStop('locCapture'))
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'On the localizer' }), { key: 'Escape' })
    expect(ctx.store.getState().activeStop).toBeNull()
  })
})

describe('time-lapse control', () => {
  it('picking a speed switches to manual; Auto hands control back', () => {
    renderWith(<ControlsStrip />)
    expect(screen.getByRole('radiogroup', { name: 'Clock speed' })).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'Sped up 16×' }))
    expect(ctx.store.getState().timeMode).toBe('manual')
    expect(ctx.clock.getState().speed).toBe(16)
    const auto = screen.getByRole('button', { name: 'Automatic time-lapse' })
    expect(auto.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(auto)
    expect(ctx.store.getState().timeMode).toBe('auto')
    expect(auto.getAttribute('aria-pressed')).toBe('true')
  })

  it('the view choice and guided stops are labelled controls', () => {
    renderWith(<ControlsStrip />)
    fireEvent.click(screen.getByRole('radio', { name: 'Region map' }))
    expect(ctx.store.getState().viewChoice).toBe('map')
    fireEvent.click(screen.getByRole('switch', { name: /Guided stops/ }))
    expect(ctx.store.getState().stopsEnabled).toBe(false)
  })
})

describe('debrief', () => {
  it('sums up the flight, asks the quiz and flies again', () => {
    renderWith(<Debrief />)
    expect(screen.getByRole('heading', { name: /One flight, 7 controllers/ })).toBeTruthy()
    expect(screen.getByText('9')).toBeTruthy() // handovers
    expect(QUIZ).toHaveLength(5)
    expect(screen.getByText(QUIZ[0].question)).toBeTruthy()
    act(() => ctx.store.getState().jumpTo('arrived'))
    fireEvent.click(screen.getByRole('button', { name: /Fly the journey again/ }))
    expect(ctx.engine.phase).toBe('gate')
    expect(ctx.clock.getState().running).toBe(true)
  })
})
