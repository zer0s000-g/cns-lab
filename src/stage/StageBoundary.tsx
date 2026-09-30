import { Component, type ReactNode } from 'react'
import { resetFailedLazies } from '@/lib/lazyRetry'

export interface StageFailure {
  error: unknown
  /** Clear the failure and render the stage again (a failed download is fetched again). */
  retry: () => void
  /** How many times the stage has failed so far (2+ means a retry failed too). */
  attempts: number
}

/**
 * Keeps a 3D failure (lost WebGL context, shader error, chunk that failed to
 * download) from taking the whole page down: the page and its 2D simulator
 * keep working and the stage shows `fallback` instead.
 */
export class StageBoundary extends Component<{ children: ReactNode; fallback: (f: StageFailure) => ReactNode }, { error: unknown; failed: boolean; attempts: number }> {
  state = { error: null as unknown, failed: false, attempts: 0 }
  static getDerivedStateFromError(error: unknown) {
    return { error, failed: true }
  }
  componentDidCatch(error: unknown) {
    if (import.meta.env.DEV) console.error('3D stage failed', error)
    this.setState((s) => ({ attempts: s.attempts + 1 }))
    // The failed part is no longer rendered: a later mount or "Try again" may download it again.
    resetFailedLazies()
  }
  retry = () => this.setState({ error: null, failed: false })
  render() {
    return this.state.failed ? this.props.fallback({ error: this.state.error, retry: this.retry, attempts: this.state.attempts }) : this.props.children
  }
}
