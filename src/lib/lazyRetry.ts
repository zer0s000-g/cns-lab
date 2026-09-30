import { createElement, lazy, type ComponentProps, type ComponentType, type LazyExoticComponent } from 'react'

/** True when a lazily loaded chunk (JS or CSS) failed to download: a dropped connection, or a deploy that removed it. */
export function isChunkLoadError(error: unknown): boolean {
  const msg = error instanceof Error ? `${error.name} ${error.message}` : String(error)
  return /dynamically imported module|Importing a module script failed|error loading dynamically|ChunkLoadError|Failed to fetch|Unable to preload CSS|NetworkError when attempting to fetch|Load failed/i.test(
    msg,
  )
}

/** Lazy components whose last download failed, each with a function that arms a fresh download. */
const failed = new Set<() => void>()

/**
 * Let every lazy component whose download failed try again on its next mount.
 * Error boundaries call this once they show the error (the failed component is no
 * longer rendered), so a persistent failure (offline) never turns into a retry loop.
 */
export function resetFailedLazies() {
  for (const reset of [...failed]) reset()
  failed.clear()
}

/**
 * React.lazy that can try again. React.lazy remembers a failed download for good,
 * so after one network blip the page would fail every time it is opened until a full
 * reload. Here the error still reaches the nearest error boundary; once the boundary
 * has shown it (resetFailedLazies), the next mount, e.g. reopening the page or the
 * boundary's "Try again", asks for the chunk again.
 * Browsers differ on what happens next: Chromium remembers a failed module import for
 * the life of the document, so there only a reload helps, which is why the error
 * screens always offer one.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- same constraint as React.lazy
export function lazyRetry<T extends ComponentType<any>>(loader: () => Promise<{ default: T }>): T {
  let current: LazyExoticComponent<T>
  const reset = () => {
    current = lazy(load)
  }
  const load = () =>
    loader().catch((error: unknown) => {
      failed.add(reset)
      throw error
    })
  current = lazy(load)
  function LazyRetry(props: ComponentProps<T>) {
    return createElement(current, props)
  }
  return LazyRetry as unknown as T
}
