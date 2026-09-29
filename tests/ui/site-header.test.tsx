// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { SiteHeader } from '@/components/SiteHeader'

beforeAll(() => {
  // jsdom lacks matchMedia (the theme toggle reads it).
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia
})
afterEach(cleanup)

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <SiteHeader />
    </MemoryRouter>,
  )

describe('site header', () => {
  it('lists Home and Sandbox, then the reference pages', () => {
    renderAt('/')
    const nav = screen.getByRole('navigation', { name: 'Main' })
    const links = within(nav).getAllByRole('link')
    expect(links.map((l) => l.textContent)).toEqual(['Home', 'Sandbox', 'Glossary', 'Frequency chart'])
    expect(links[1].getAttribute('href')).toBe('/sandbox')
  })

  it('marks the Sandbox as the current page when on it', () => {
    renderAt('/sandbox')
    const nav = screen.getByRole('navigation', { name: 'Main' })
    const sandbox = within(nav).getByRole('link', { name: 'Sandbox' })
    expect(sandbox.getAttribute('aria-current')).toBe('page')
    // Shown in the signal colour (on the inner span, where .hud-label cannot override it).
    expect(within(sandbox).getByText('Sandbox').className).toContain('text-signal')
    expect(within(nav).getByRole('link', { name: 'Home' }).getAttribute('aria-current')).toBeNull()
  })

  it('puts the Sandbox near the top of the mobile menu, once, with no lone Integration heading', () => {
    renderAt('/')
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    const menu = screen.getByRole('navigation', { name: 'Mobile' })
    const links = within(menu).getAllByRole('link')
    expect(links.slice(0, 4).map((l) => l.textContent)).toEqual(['Home', 'Sandbox', 'Glossary', 'Frequency chart'])
    expect(links.filter((l) => l.getAttribute('href') === '/sandbox')).toHaveLength(1)
    expect(within(menu).queryByText('Integration')).toBeNull()
    // The three pillars and their modules are still listed.
    for (const p of ['Communication', 'Navigation', 'Surveillance']) expect(within(menu).getByText(p)).toBeTruthy()
    expect(links.length).toBe(4 + 14) // 4 top links + the 14 system modules
  })
})
