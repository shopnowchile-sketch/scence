'use client'

import { Search } from 'lucide-react'

export type InfluencerView = 'list'

type SortBy = 'created_at' | 'followers' | 'engagement_rate' | 'rating' | 'display_name'

type Filters = {
  search?: string
  sortBy?: SortBy
  sortOrder?: 'asc' | 'desc'
}

interface InfluencerFiltersProps {
  filters: Filters
  onChange: (filters: Partial<Filters>) => void
  onReset: () => void
  total: number
  filtered: number
}

export function InfluencerFilters({
  filters,
  onChange,
  total,
  filtered,
}: InfluencerFiltersProps) {
  const sortValue = `${filters.sortBy ?? 'created_at'}:${filters.sortOrder ?? 'desc'}`

  function handleSort(value: string) {
    const [sortBy, sortOrder] = value.split(':') as [SortBy, 'asc' | 'desc']
    onChange({ sortBy, sortOrder })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between">
        <div className="relative flex-1 max-w-2xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            value={filters.search ?? ''}
            onChange={e => onChange({ search: e.target.value })}
            placeholder="Buscar por nombre, @handle, ciudad..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm outline-none focus:border-violet-400"
          />
        </div>

        <div className="flex items-center gap-2">
          <select
            value={sortValue}
            onChange={e => handleSort(e.target.value)}
            className="px-3 py-2.5 rounded-xl border border-gray-200 bg-white text-sm text-gray-700 outline-none focus:border-violet-400"
          >
            <option value="created_at:desc">Más recientes</option>
            <option value="display_name:asc">Nombre A-Z</option>
            <option value="followers:desc">Más seguidores</option>
            <option value="engagement_rate:desc">Mayor engagement</option>
          </select>


        </div>
      </div>

      <p className="text-xs text-gray-400">
        Mostrando <span className="font-semibold text-gray-600">{filtered}</span> de <span className="font-semibold text-gray-600">{total}</span> influencers
      </p>
    </div>
  )
}
