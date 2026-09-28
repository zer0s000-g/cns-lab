import { Link } from 'react-router'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CornerBrackets } from '@/hud/HudFrame'

export default function NotFound() {
  return (
    <div className="mx-auto max-w-[760px] px-4 py-20 md:px-10">
      <div className="relative px-6 py-10 md:px-10">
        <CornerBrackets inset={0} />
        <p className="hud-label mb-3 text-signal">Error 404 · no echo</p>
        <h1 className="hud-title text-[24px] leading-8 text-foreground md:text-[30px]">Page not found</h1>
        <p className="mt-3 max-w-[56ch] text-[15px] leading-7 text-muted-foreground">
          This signal did not return an echo. The page may have moved, or the address may be mistyped.
        </p>
        <Button asChild className="mt-6">
          <Link to="/">
            <ArrowLeft aria-hidden /> Back to CNS Lab
          </Link>
        </Button>
      </div>
    </div>
  )
}
