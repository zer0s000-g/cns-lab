import { Suspense, lazy, type ComponentType } from 'react'
import { PageFallback } from '@/components/PageFallback'
import { ComingSoon } from '@/pages/ModulePage'

const loaders = import.meta.glob<{ default: ComponentType }>('./Sandbox/index.tsx')
const loader = loaders['./Sandbox/index.tsx']
const Sandbox = loader ? lazy(loader) : null

export default function SandboxRoute() {
  if (!Sandbox) return <ComingSoon id="sandbox" />
  return (
    <Suspense fallback={<PageFallback />}>
      <Sandbox />
    </Suspense>
  )
}
