import { Component, type ReactNode } from 'react'

/**
 * Keeps a 3D failure (lost WebGL context, shader error, chunk that failed to
 * download) from taking the whole page down: the page and its 2D simulator
 * keep working and the stage shows `fallback` instead.
 */
export class StageBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    if (import.meta.env.DEV) console.error('3D stage failed', error)
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
