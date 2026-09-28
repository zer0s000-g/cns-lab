import { Eye, MessagesSquare, Navigation, Network, type LucideIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { pillarName, type Pillar } from '@/modules/registry'
import { cn } from '@/lib/utils'

export const PILLAR_ICON: Record<Pillar, LucideIcon> = {
  communication: MessagesSquare,
  navigation: Navigation,
  surveillance: Eye,
  integration: Network,
}

/** Pillar tag: icon + name, so the pillar is never shown by colour alone. */
export function PillarBadge({ pillar, className }: { pillar: Pillar; className?: string }) {
  const Icon = PILLAR_ICON[pillar]
  return (
    <Badge variant="outline" className={cn('gap-1 border-primary/30 bg-accent text-accent-foreground', className)}>
      <Icon aria-hidden />
      {pillarName(pillar)}
    </Badge>
  )
}
