import { Suspense } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowLeft, Hammer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PillarBadge } from '@/components/PillarBadge'
import { MODULE_BY_ID, getModuleComponent } from '@/modules/registry'
import { PageFallback } from '@/components/PageFallback'
import NotFound from '@/pages/NotFound'

export default function ModulePage() {
  const { id = '' } = useParams()
  const meta = MODULE_BY_ID.get(id)
  if (!meta || meta.id === 'sandbox') return <NotFound />
  const Component = getModuleComponent(id)
  if (!Component) return <ComingSoon id={id} />
  return (
    <Suspense fallback={<PageFallback />}>
      <Component />
    </Suspense>
  )
}

export function ComingSoon({ id }: { id: string }) {
  const meta = MODULE_BY_ID.get(id)!
  return (
    <div className="mx-auto flex max-w-3xl flex-col items-start gap-4 px-4 py-16 md:px-6">
      <PillarBadge pillar={meta.pillar} />
      <h1 className="text-2xl font-semibold tracking-tight">{meta.name}</h1>
      <p className="text-[15px] text-muted-foreground">{meta.summary}</p>
      <div className="flex items-center gap-3 rounded-lg border bg-card p-4">
        <Hammer className="size-5 text-primary" aria-hidden />
        <p className="text-sm">This module is being built (phase {meta.phase}). Check back soon.</p>
      </div>
      <Button asChild variant="outline">
        <Link to="/">
          <ArrowLeft aria-hidden /> Back to all modules
        </Link>
      </Button>
    </div>
  )
}
