// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Dial } from '@/hud/Controls'

afterEach(cleanup)

function Harness({ start, min = 0, max = 10, step = 1, wrap = false }: { start: number; min?: number; max?: number; step?: number; wrap?: boolean }) {
  const [v, setV] = useState(start)
  return <Dial label="Level" value={v} min={min} max={max} step={step} onChange={setV} wrap={wrap} />
}

const wheel = (el: Element, deltaY: number) => {
  const e = new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true })
  act(() => {
    el.dispatchEvent(e)
  })
  return e
}
const value = () => Number(screen.getByRole('slider').getAttribute('aria-valuenow'))

describe('Dial', () => {
  it('ignores the wheel while the page scrolls past it (not focused)', () => {
    render(<Harness start={5} />)
    const e = wheel(screen.getByRole('slider'), -100)
    expect(value()).toBe(5)
    expect(e.defaultPrevented).toBe(false)
  })

  it('turns with the wheel once focused, and stops the page scrolling', () => {
    render(<Harness start={5} />)
    const el = screen.getByRole('slider')
    act(() => el.focus())
    const e = wheel(el, -100)
    expect(value()).toBe(6)
    expect(e.defaultPrevented).toBe(true)
    wheel(el, 100)
    expect(value()).toBe(5)
  })

  it('a sideways swipe (deltaY 0) does not change the value', () => {
    render(<Harness start={5} />)
    const el = screen.getByRole('slider')
    act(() => el.focus())
    wheel(el, 0)
    expect(value()).toBe(5)
  })

  it('from a value above its range, "up" never moves it down', () => {
    render(<Harness start={23.9} max={23.75} step={0.25} />)
    const el = screen.getByRole('slider')
    fireEvent.keyDown(el, { key: 'ArrowUp' })
    expect(value()).toBe(23.9)
    fireEvent.keyDown(el, { key: 'ArrowDown' })
    expect(value()).toBe(23.75)
  })

  it('a wrapping dial (24-hour clock) goes from 23:45 to 00:00 and back', () => {
    render(<Harness start={23.75} max={23.75} step={0.25} wrap />)
    const el = screen.getByRole('slider')
    fireEvent.keyDown(el, { key: 'ArrowUp' })
    expect(value()).toBe(0)
    fireEvent.keyDown(el, { key: 'ArrowDown' })
    expect(value()).toBe(23.75)
    fireEvent.keyDown(el, { key: 'End' })
    expect(value()).toBe(23.75)
  })
  it('reaches its exact maximum when the range is not a whole number of steps', () => {
    render(<Harness start={2.5} min={Math.log10(5)} max={3} step={0.01} />)
    const el = screen.getByRole('slider')
    fireEvent.keyDown(el, { key: 'End' })
    expect(value()).toBe(3)
    fireEvent.keyDown(el, { key: 'ArrowDown' })
    fireEvent.keyDown(el, { key: 'ArrowUp' })
    fireEvent.keyDown(el, { key: 'ArrowUp' })
    expect(value()).toBe(3)
  })
})
