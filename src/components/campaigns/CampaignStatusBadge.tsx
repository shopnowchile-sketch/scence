import { cn } from '@/lib/utils'
import type { CampaignStatus } from '@/types'

const CONFIG: Record<CampaignStatus, { label: string; cls: string; dot: string }> = {
  draft:            { label: 'Draft',          cls: 'badge-gray',   dot: 'bg-gray-400' },
  pending_approval: { label: 'En aprobación',  cls: 'badge-orange', dot: 'bg-amber-400' },
  active:           { label: 'Activa',         cls: 'badge-green',  dot: 'bg-emerald-500' },
  paused:           { label: 'Pausada',        cls: 'badge-orange', dot: 'bg-amber-500' },
  completed:        { label: 'Completada',     cls: 'badge-blue',   dot: 'bg-blue-500' },
  canceled:         { label: 'Cancelada',      cls: 'badge-red',    dot: 'bg-red-500' },
}

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  const { label, cls, dot } = CONFIG[status]
  return (
    <span className={cn('badge', cls)}>
      <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', dot)} />
      {label}
    </span>
  )
}

export function campaignStatusLabel(s: CampaignStatus) { return CONFIG[s].label }
