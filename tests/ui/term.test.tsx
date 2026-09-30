// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { Term } from '@/components/Term'
import { getTerm } from '@/content/glossary'

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})
afterEach(cleanup)

describe('Term (definitions load after the page)', () => {
  it('shows its word at once and the definition once the glossary has loaded', async () => {
    const entry = getTerm('echo')!
    expect(entry).toBeDefined()
    render(
      <MemoryRouter>
        <p>
          The <Term id="echo">echo</Term> comes back.
        </p>
      </MemoryRouter>,
    )
    const button = screen.getByRole('button', { name: 'echo: show definition' })
    fireEvent.click(button)
    expect(await screen.findByText(entry.definition)).toBeTruthy()
  })

  it('an unknown id renders plain text once the glossary is known', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(
      <MemoryRouter>
        <Term id="no-such-term">mystery</Term>
      </MemoryRouter>,
    )
    await vi.waitFor(() => expect(screen.queryByRole('button')).toBeNull())
    expect(screen.getByText('mystery')).toBeTruthy()
    warn.mockRestore()
  })
})
