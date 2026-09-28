import { Link } from 'react-router'
import { ArrowLeft, SearchX } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-start gap-4 px-4 py-20 md:px-6">
      <SearchX className="size-8 text-muted-foreground" aria-hidden />
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="text-[15px] text-muted-foreground">
        This signal did not return an echo. The page may have moved, or the address may be mistyped.
      </p>
      <Button asChild>
        <Link to="/">
          <ArrowLeft aria-hidden /> Back to CNS Lab
        </Link>
      </Button>
    </div>
  )
}
