'use client'

import { useCallback, useState, useEffect, useRef } from 'react'
import {
  Search, SlidersHorizontal, X, LayoutGrid, List, ChevronDown, Trophy
} from 'lucide-react'
import { cn, PLATFORM_ICONS, CATEGORY_OPTIONS, COUNTRY_OPTIONS } from '@/lib/utils'
import type { InfluencerFilters, SocialPlatform } from '@/types'

const PLATFORMS: { value: SocialPlatform; label: string }[] = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'tiktok',    label: 'TikTok' },
  { value: 'youtube',   label: 'YouTube' },
  { value: 'twitter',   label: 'X/Twitter' },
  { value: 'twitch',    label: 'Twitch' },
]

const TIERS = [
  { value: 'nano',  label: 'Nano (1K–10K)' },
  { value: 'micro', label: 'Micro (10K–100K)' },
  { value: 'macro', label: 'Macro (100K–1M)' },
  { value: 'mega',  label: 'Mega (1M+)' },
]

export type InfluencerView = 'grid' | 'list' | 'ranking'

interface Props {
  filters: InfluencerFilters
  onChange: (f: Partial<InfluencerFilters>) => void
  onReset: () => void
  view: InfluencerView
  onViewChange: (v: InfluencerView) => void
  total: number
  filtered: number
}

export function InfluencerFilters({
  filters, onChange, onReset, view, onViewChange, total, filtered
}: Props) {
  // Local search state — decoupled from parent to prevent input losing focus on re-render
  const [localSearch, setLocalSearch] = useState(filters.search)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Track previous parent search value to only sync when parent resets externally (e.g. "Limpiar filtros")
  const prevParentSearch = useRef(filters.search)
  useEffect(() => {
    // Only override local state if parent changed search externally (reset), not from our own debounce
    if (filters.search !== prevParentSearch.current) {
      prevParentSearch.current = filters.search
      // Only sync if parent cleared it (reset) to avoid overwriting mid-typing
      if (filters.search === '') setLocalSearch('')
    }
  }, [filters.search])

  function handleSearchChange(value: string) {
    setLocalSearch(value)
    prevParentSearch.current = value // keep in sync so useEffect doesn't interfere
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      prevParentSearch.current = value
      onChange({ search: value })
    }, 350)
  }

  function handleSearchClear() {
    setLocalSearch('')
    prevParentSearch.current = ''
    if (debounceRef.current) clearTimeout(debounceRef.current)
    onChange({ search: '' })
  }

  const togglePlatform = useCallback((p: SocialPlatform) => {
    const next = filters.platforms.includes(p)
      ? filters.platforms.filter(x => x !== p)
      : [...filters.platforms, p]
    onChange({ platforms: next })
  }, [filters.platforms, onChange])

  const toggleCategory = useCallback((c: string) => {
    const next = filters.categories.includes(c)
      ? filters.categories.filter(x => x !== c)
      : [...filters.categories, c]
    onChange({ categories: next })
  }, [filters.categories, onChange])

  const hasActiveFilters =
    localSearch ||
    filters.platforms.length > 0 ||
    filters.categories.length > 0 ||
    filters.tier ||
    filters.country ||
    filters.isVerified !== null ||
    filters.minEngagement > 0 ||
    filters.statusFilter !== 'all'

  return (
    <div className="space-y-3">
      {/* Row 1: Search + View toggle + Sort */}
      <div className="flex items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar por nombre, @handle, ciudad..."
            value={localSearch}
            onChange={e => handleSearchChange(e.target.value)}
            className="input-base pl-9"
            autoComplete="off"
          />
          {localSearch && (
            <button
              onClick={handleSearchClear}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Sort */}
        <div className="relative">
          <select
            value={`${filters.sortBy}:${filters.sortOrder}`}
            onChange={e => {
              const [sortBy, sortOrder] = e.target.value.split(':') as [typeof filters.sortBy, typeof filters.sortOrder]
              onChange({ sortBy, sortOrder })
            }}
            className="input-base pr-8 appearance-none cursor-pointer"
          >
            <option value="followers:desc">Mayor seguidores</option>
            <option value="engagement_rate:desc">Mayor engagement</option>
            <option value="rating:desc">Mejor rating</option>
            <option value="display_name:asc">Nombre A–Z</option>
            <option value="created_at:desc">Más recientes</option>
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
        </div>

        {/* Reset */}
        {hasActiveFilters && (
          <button
            onClick={onReset}
            className="flex items-center gap-1.5 text-xs font-medium text-violet-600 hover:text-violet-700 px-3 py-2 rounded-lg hover:bg-violet-50 transition-colors"
          >
            <X className="h-3.5 w-3.5" /> Limpiar filtros
          </button>
        )}

        <div className="ml-auto flex items-center gap-1 bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => onViewChange('grid')}
            className={cn(
              'p-1.5 rounded-md transition-all',
              view === 'grid' ? 'bg-white shadow-sm text-violet-600' : 'text-gray-400 hover:text-gray-600'
            )}
            title="Vista grid"
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            onClick={() => onViewChange('list')}
            className={cn(
              'p-1.5 rounded-md transition-all',
              view === 'list' ? 'bg-white shadow-sm text-violet-600' : 'text-gray-400 hover:text-gray-600'
            )}
            title="Vista lista"
          >
            <List className="h-4 w-4" />
          </button>
          <button
            onClick={() => onViewChange('ranking')}
            className={cn(
              'p-1.5 rounded-md transition-all',
              view === 'ranking' ? 'bg-white shadow-sm text-amber-500' : 'text-gray-400 hover:text-gray-600'
            )}
            title="Ranking"
          >
            <Trophy className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Row 2: Platforms + Tier + Country + Verified */}
      <div className="flex items-center gap-2 flex-wrap">

        {/* Plataformas — dropdown, chip activo con X */}
        {filters.platforms.length > 0 ? (
          filters.platforms.map(p => {
            const label = PLATFORMS.find(pl => pl.value === p)?.label ?? p
            return (
              <span key={p} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-violet-600 text-white border border-violet-600">
                <span>{PLATFORM_ICONS[p]}</span>
                {label}
                <button onClick={() => togglePlatform(p)} className="hover:opacity-70">
                  <X className="h-3 w-3" />
                </button>
              </span>
            )
          })
        ) : null}
        <div className="relative">
          <select
            value=""
            onChange={e => { if (e.target.value) togglePlatform(e.target.value as SocialPlatform) }}
            className="appearance-none cursor-pointer px-3 py-1.5 rounded-full text-xs font-semibold border pr-6 transition-all bg-white text-gray-600 border-gray-200 hover:border-violet-300"
          >
            <option value="" disabled>Plataforma</option>
            {PLATFORMS.filter(p => !filters.platforms.includes(p.value)).map(p => (
              <option key={p.value} value={p.value}>{PLATFORM_ICONS[p.value]} {p.label}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 pointer-events-none opacity-60" />
        </div>

        {/* Tier */}
        {filters.tier ? (
          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-violet-600 text-white border border-violet-600">
            {TIERS.find(t => t.value === filters.tier)?.label ?? filters.tier}
            <button onClick={() => onChange({ tier: '' })} className="hover:opacity-70">
              <X className="h-3 w-3" />
            </button>
          </span>
        ) : (
          <div className="relative">
            <select
              value=""
              onChange={e => onChange({ tier: e.target.value as typeof filters.tier })}
              className="appearance-none cursor-pointer px-3 py-1.5 rounded-full text-xs font-semibold border pr-6 transition-all bg-white text-gray-600 border-gray-200 hover:border-violet-300"
            >
              <option value="" disabled>Tamaño</option>
              {TIERS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 pointer-events-none opacity-60" />
          </div>
        )}

        {/* País */}
        {filters.country ? (
          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-violet-600 text-white border border-violet-600">
            {COUNTRY_OPTIONS.find(c => c.code === filters.country)?.label ?? filters.country}
            <button onClick={() => onChange({ country: '' })} className="hover:opacity-70">
              <X className="h-3 w-3" />
            </button>
          </span>
        ) : (
          <div className="relative">
            <select
              value=""
              onChange={e => onChange({ country: e.target.value })}
              className="appearance-none cursor-pointer px-3 py-1.5 rounded-full text-xs font-semibold border pr-6 transition-all bg-white text-gray-600 border-gray-200 hover:border-violet-300"
            >
              <option value="" disabled>País</option>
              {COUNTRY_OPTIONS.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
            <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 pointer-events-none opacity-60" />
          </div>
        )}

        {/* Estado */}
        <div className="relative">
          <select
            value={filters.statusFilter ?? 'all'}
            onChange={e => {
              const v = e.target.value as InfluencerFilters['statusFilter']
              if (v === 'active') onChange({ statusFilter: v, isActive: true })
              else if (v === 'draft' || v === 'inactive') onChange({ statusFilter: v, isActive: false })
              else onChange({ statusFilter: 'all', isActive: null })
            }}
            className={cn(
              'appearance-none cursor-pointer px-3 py-1.5 rounded-full text-xs font-semibold border pr-6 transition-all',
              filters.statusFilter && filters.statusFilter !== 'all'
                ? 'bg-violet-600 text-white border-violet-600'
                : 'bg-white text-gray-600 border-gray-200 hover:border-violet-300'
            )}
          >
            <option value="all">Estado</option>
            <option value="active">✅ Activos</option>
            <option value="draft">📋 Draft</option>
            <option value="inactive">❌ Inactivos</option>
          </select>
          <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 pointer-events-none opacity-60" />
        </div>

        {/* Verificado */}
        <button
          onClick={() => onChange({ isVerified: filters.isVerified === true ? null : true })}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all',
            filters.isVerified === true
              ? 'bg-violet-600 text-white border-violet-600'
              : 'bg-white text-gray-600 border-gray-200 hover:border-violet-300'
          )}
        >
          ✓ Verificados
          {filters.isVerified === true && <X className="h-3 w-3 ml-0.5 opacity-80" />}
        </button>

        {/* Engagement mínimo */}
        <button
          onClick={() => onChange({ minEngagement: filters.minEngagement > 0 ? 0 : 3 })}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all',
            filters.minEngagement > 0
              ? 'bg-violet-600 text-white border-violet-600'
              : 'bg-white text-gray-600 border-gray-200 hover:border-violet-300'
          )}
        >
          🔥 Eng. {'>'} 3%
          {filters.minEngagement > 0 && <X className="h-3 w-3 ml-0.5 opacity-80" />}
        </button>
      </div>

      {/* Row 3: Categorías */}
      <div className="flex items-center gap-2 flex-wrap">
        {CATEGORY_OPTIONS.map(cat => {
          const active = filters.categories.includes(cat)
          return (
            <button
              key={cat}
              onClick={() => toggleCategory(cat)}
              className={cn(
                'flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border transition-all',
                active
                  ? 'bg-violet-50 text-violet-700 border-violet-200'
                  : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300 hover:text-gray-700'
              )}
            >
              {cat}
              {active && <X className="h-3 w-3 ml-0.5 opacity-70" />}
            </button>
          )
        })}
      </div>

      {/* Results count */}
      <div className="flex items-center gap-1.5 text-xs text-gray-400">
        <SlidersHorizontal className="h-3.5 w-3.5" />
        <span>
          Mostrando <strong className="text-gray-600">{filtered}</strong> de{' '}
          <strong className="text-gray-600">{total}</strong> influencers
        </span>
      </div>
    </div>
  )
}
