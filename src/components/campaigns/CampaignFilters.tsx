'use client'

import { Search, X, ChevronDown } from 'lucide-react'
import { cn, PLATFORM_ICONS } from '@/lib/utils'
import type { CampaignFilters } from '@/types'
import type { CampaignStatus, CampaignType, SocialPlatform } from '@/types'

const STATUSES: { value: CampaignStatus; label: string }[] = [
  { value: 'draft',            label: 'Draft' },
  { value: 'pending_approval', label: 'En aprobación' },
  { value: 'active',           label: 'Activa' },
  { value: 'paused',           label: 'Pausada' },
  { value: 'completed',        label: 'Completada' },
  { value: 'canceled',         label: 'Cancelada' },
]

const TYPES: { value: CampaignType; label: string }[] = [
  { value: 'sponsored_post',    label: 'Sponsored Post' },
  { value: 'event_appearance',  label: 'Evento' },
  { value: 'ambassador',        label: 'Ambassador' },
  { value: 'product_seeding',   label: 'Product Seeding' },
  { value: 'ugc',               label: 'UGC' },
  { value: 'live',              label: 'Live' },
]

const PLATFORMS: { value: SocialPlatform; label: string }[] = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'tiktok',    label: 'TikTok' },
  { value: 'youtube',   label: 'YouTube' },
]

const STATUS_COLORS: Record<CampaignStatus, string> = {
  draft:            'bg-gray-100 text-gray-600 border-gray-200',
  pending_approval: 'bg-amber-50 text-amber-700 border-amber-200',
  active:           'bg-emerald-50 text-emerald-700 border-emerald-200',
  paused:           'bg-amber-50 text-amber-600 border-amber-200',
  completed:        'bg-blue-50 text-blue-700 border-blue-200',
  canceled:         'bg-red-50 text-red-600 border-red-200',
}

interface Props {
  filters: CampaignFilters
  onChange: (f: Partial<CampaignFilters>) => void
  onReset: () => void
  total: number
}

export function CampaignFilters({ filters, onChange, onReset, total }: Props) {
  const hasActive = filters.search || filters.status || filters.type || filters.platform

  return (
    <div className="space-y-3">
      {/* Row 1 */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar campañas..."
            value={filters.search}
            onChange={e => onChange({ search: e.target.value })}
            className="input-base pl-9"
          />
          {filters.search && (
            <button onClick={() => onChange({ search: '' })} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Tipo */}
        <div className="relative">
          <select
            value={filters.type}
            onChange={e => onChange({ type: e.target.value as CampaignType | '' })}
            className={cn('input-base appearance-none pr-8 cursor-pointer',
              filters.type && 'border-violet-400 text-violet-700')}
          >
            <option value="">Todos los tipos</option>
            {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
        </div>

        {/* Plataforma */}
        <div className="relative">
          <select
            value={filters.platform}
            onChange={e => onChange({ platform: e.target.value as SocialPlatform | '' })}
            className={cn('input-base appearance-none pr-8 cursor-pointer',
              filters.platform && 'border-violet-400 text-violet-700')}
          >
            <option value="">Todas las plataformas</option>
            {PLATFORMS.map(p => (
              <option key={p.value} value={p.value}>{PLATFORM_ICONS[p.value]} {p.label}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
        </div>

        {/* Fechas */}
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={filters.dateFrom}
            onChange={e => onChange({ dateFrom: e.target.value })}
            className="input-base w-36 text-xs"
          />
          <span className="text-gray-300 text-sm">→</span>
          <input
            type="date"
            value={filters.dateTo}
            onChange={e => onChange({ dateTo: e.target.value })}
            className="input-base w-36 text-xs"
          />
        </div>

        {hasActive && (
          <button onClick={onReset} className="flex items-center gap-1.5 text-xs font-medium text-violet-600 hover:text-violet-700 px-3 py-2 rounded-lg hover:bg-violet-50 transition-colors">
            <X className="h-3.5 w-3.5" /> Limpiar
          </button>
        )}

        <span className="ml-auto text-xs text-gray-400">{total} campaña{total !== 1 ? 's' : ''}</span>
      </div>

      {/* Row 2: Status pills */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-gray-400 font-medium">Estado:</span>
        <button
          onClick={() => onChange({ status: '' })}
          className={cn(
            'px-3 py-1 rounded-full text-xs font-semibold border transition-all',
            !filters.status ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
          )}
        >
          Todos
        </button>
        {STATUSES.map(s => (
          <button
            key={s.value}
            onClick={() => onChange({ status: filters.status === s.value ? '' : s.value })}
            className={cn(
              'px-3 py-1 rounded-full text-xs font-semibold border transition-all',
              filters.status === s.value
                ? STATUS_COLORS[s.value]
                : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300 hover:text-gray-700'
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  )
}
