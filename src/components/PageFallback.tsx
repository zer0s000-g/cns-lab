import { Skeleton } from '@/components/ui/skeleton'

/** Skeleton shown while a lazily loaded page or module downloads. */
export function PageFallback() {
  return (
    <div className="mx-auto flex min-h-[calc(100svh-3.5rem)] max-w-[1440px] flex-col gap-4 px-4 py-8 md:px-6" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-6 w-32" />
      <Skeleton className="h-9 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="mt-6 h-[420px] w-full" />
    </div>
  )
}
