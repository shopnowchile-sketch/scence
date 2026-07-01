'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowDown, ArrowUp, BarChart3, CheckCircle2, Columns3, Search, Star, TrendingUp, Users } from 'lucide-react'
import { cn, formatFollowers, PLATFORM_ICONS } from '@/lib/utils'
import type { RankingInfluencerRow, RankingSortBy } from '@/lib/influencers/ranking'
import { getPrimarySocial, getRankingValue, sortRankingRows } from '@/lib/influencers/ranking'

type Props = {
  influencers: RankingInfluencerRow[]
  loading?: boolean
  basePath?: string
  initialSortBy?: RankingSortBy
}

type VisibleColumns = {
  followers: boolean
  engagement: boolean
  rating: boolean
  campaigns: boolean
  deliverables: boolean
  completion: boolean
  city: boolean
  lastConnection: boolean
}

const SORT_OPTIONS: { value: RankingSortBy; label: string; icon: React.ReactNode }[] = [
  { value: 'followers', label: 'Seguidores', icon: <Users className="h-3.5 w-3.5" /> },
  { value: 'engagement', label: 'Engagement', icon: <TrendingUp className="h-3.5 w-3.5" /> },
  { value: 'rating', label: 'Rating', icon: <Star className="h-3.5 w-3.5" /> },
  { value: 'campaigns', label: 'Campañas', icon: <BarChart3 className="h-3.5 w-3.5" /> },
  { value: 'deliverables_completed', label: 'Entregables', icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  { value: 'completion_rate', label: 'Cumplimiento', icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
]

function formatPercent(value: number) {
  return `${Math.round(value)}%`
}

export function InfluencerRanking({
  influencers,
  loading,
  basePath = '/admin-influencers',
  initialSortBy = 'followers',
}: Props) {
  const [sortBy, setSortBy] = useState<RankingSortBy>(initialSortBy)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [search, setSearch] = useState('')
  const [platform, setPlatform] = useState('')
  const [connectionFilter, setConnectionFilter] = useState('all')
  const [showColumns, setShowColumns] = useState(false)
  const [visible, setVisible] = useState<VisibleColumns>({
    followers: true,
    engagement: true,
    rating: true,
    campaigns: true,
    deliverables: true,
    completion: true,
    city: true,
    lastConnection: true,
  })

  const platforms = useMemo(() => {
    const values = new Set<string>()
    for (const inf of influencers) {
      for (const sp of inf.social_profiles ?? []) {
        if (sp.platform) values.add(sp.platform)
      }
    }
    return Array.from(values).sort()
  }, [influencers])

  const ranked = useMemo(() => {
    let rows = [...influencers]

    if (search.trim()) {
      const q = search.trim().toLowerCase()
      rows = rows.filter(inf =>
        String(inf.display_name ?? '').toLowerCase().includes(q) ||
        String(inf.email ?? '').toLowerCase().includes(q) ||
        String(inf.commune ?? inf.city ?? '').toLowerCase().includes(q)
      )
    }

    if (platform) {
      rows = rows.filter(inf =>
        inf.social_profiles?.some(sp => sp.platform === platform)
      )
    }

    if (connectionFilter !== 'all') {
      const now = Date.now()

      rows = rows.filter(inf => {
        const last = inf.last_sign_in_at ? new Date(inf.last_sign_in_at).getTime() : null

        if (connectionFilter === 'connected_any') return Boolean(last)
        if (connectionFilter === 'last_7_days') return Boolean(last && now - last <= 7 * 24 * 60 * 60 * 1000)
        if (connectionFilter === 'last_30_days') return Boolean(last && now - last <= 30 * 24 * 60 * 60 * 1000)
        if (connectionFilter === 'never_connected') return Boolean(inf.user_id) && !last
        if (connectionFilter === 'no_access') return !inf.user_id

        return true
      })
    }

    return sortRankingRows(rows, sortBy, sortDir)
  }, [influencers, search, platform, connectionFilter, sortBy, sortDir])

  function toggleSort(next: RankingSortBy) {
    if (sortBy === next) {
      setSortDir(prev => prev === 'desc' ? 'asc' : 'desc')
    } else {
      setSortBy(next)
      setSortDir('desc')
    }
  }

  function toggleColumn(key: keyof VisibleColumns) {
    setVisible(prev => ({ ...prev, [key]: !prev[key] }))
  }

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-gray-400 mr-1">Ordenar por:</span>
          {SORT_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => toggleSort(opt.value)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all',
                sortBy === opt.value
                  ? 'bg-violet-600 text-white border-violet-600'
                  : 'bg-white text-gray-500 border-gray-200 hover:border-violet-300 hover:text-violet-600'
              )}
            >
              {opt.icon}
              {opt.label}
              {sortBy === opt.value && (
                sortDir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
              )}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar influencer, email o comuna..."
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-100 focus:border-violet-300"
            />
          </div>

          <select
            value={platform}
            onChange={e => setPlatform(e.target.value)}
            className="px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white"
          >
            <option value="">Todas las plataformas</option>
            {platforms.map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>

          <select
            value={connectionFilter}
            onChange={e => setConnectionFilter(e.target.value)}
            className="px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white"
          >
            <option value="all">Todas las conexiones</option>
            <option value="connected_any">Con conexión</option>
            <option value="last_7_days">Últimos 7 días</option>
            <option value="last_30_days">Últimos 30 días</option>
            <option value="never_connected">Invitadas sin conexión</option>
            <option value="no_access">Sin acceso</option>
          </select>

          <button
            type="button"
            onClick={() => setShowColumns(prev => !prev)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:border-violet-300 hover:text-violet-600"
          >
            <Columns3 className="h-4 w-4" />
            Columnas
          </button>
        </div>

        {showColumns && (
          <div className="flex flex-wrap gap-2 pt-1">
            {Object.entries({
              followers: 'Seguidores',
              engagement: 'Engagement',
              rating: 'Rating',
              campaigns: 'Campañas',
              deliverables: 'Entregables',
              completion: 'Cumplimiento',
              city: 'Comuna',
              lastConnection: 'Última conexión',
            } satisfies Record<keyof VisibleColumns, string>).map(([key, label]) => (
              <label key={key} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-gray-50 text-xs text-gray-600">
                <input
                  type="checkbox"
                  checked={visible[key as keyof VisibleColumns]}
                  onChange={() => toggleColumn(key as keyof VisibleColumns)}
                />
                {label}
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="text-xs text-gray-400">
        Mostrando {ranked.length} influencers. Ranking según KPI seleccionado, sin score compuesto.
      </div>

      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left text-xs font-semibold text-gray-400 px-4 py-3 w-12">#</th>
              <th className="text-left text-xs font-semibold text-gray-400 px-4 py-3">Influencer</th>
              {visible.followers && <th className="text-right text-xs font-semibold text-gray-400 px-4 py-3">Seguidores</th>}
              {visible.engagement && <th className="text-right text-xs font-semibold text-gray-400 px-4 py-3">Engagement</th>}
              {visible.rating && <th className="text-right text-xs font-semibold text-gray-400 px-4 py-3">Rating</th>}
              {visible.campaigns && <th className="text-right text-xs font-semibold text-gray-400 px-4 py-3">Campañas</th>}
              {visible.deliverables && <th className="text-right text-xs font-semibold text-gray-400 px-4 py-3">Entregables</th>}
              {visible.completion && <th className="text-right text-xs font-semibold text-gray-400 px-4 py-3">Cumplimiento</th>}
              {visible.city && <th className="text-right text-xs font-semibold text-gray-400 px-4 py-3">Comuna</th>}
              {visible.lastConnection && <th className="text-right text-xs font-semibold text-gray-400 px-4 py-3">Última conexión</th>}
            </tr>
          </thead>

          <tbody>
            {ranked.map((inf, idx) => {
              const primary = getPrimarySocial(inf)
              const followers = Number(primary?.followers ?? 0)
              const engagement = Number(primary?.engagement_rate ?? 0)
              const currentValue = getRankingValue(inf, sortBy)

              return (
                <tr key={inf.id} className="border-b border-gray-50 hover:bg-violet-50/40 transition-colors">
                  <td className="px-4 py-3">
                    <span className={cn(
                      'text-sm font-bold',
                      idx < 3 ? 'text-violet-600' : 'text-gray-300'
                    )}>
                      #{idx + 1}
                    </span>
                  </td>

                  <td className="px-4 py-3">
                    <Link href={`${basePath}/${inf.id}`} className="flex items-center gap-3 hover:underline">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-400 to-pink-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                        {inf.display_name?.[0]?.toUpperCase() ?? '?'}
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-gray-900">{inf.display_name}</div>
                        <div className="text-xs text-gray-400">
                          {primary ? `${PLATFORM_ICONS[primary.platform ?? 'instagram'] ?? ''} @${primary.username ?? '—'}` : inf.email ?? '—'}
                        </div>
                      </div>
                    </Link>
                  </td>

                  {visible.followers && (
                    <td className="px-4 py-3 text-right">
                      <span className={cn('text-sm font-semibold', sortBy === 'followers' ? 'text-violet-600' : 'text-gray-700')}>
                        {followers > 0 ? formatFollowers(followers) : '—'}
                      </span>
                    </td>
                  )}

                  {visible.engagement && (
                    <td className="px-4 py-3 text-right">
                      <span className={cn('text-sm font-semibold', sortBy === 'engagement' ? 'text-violet-600' : 'text-gray-700')}>
                        {engagement > 0 ? `${engagement.toFixed(1)}%` : '—'}
                      </span>
                    </td>
                  )}

                  {visible.rating && (
                    <td className="px-4 py-3 text-right">
                      <span className={cn('text-sm font-semibold', sortBy === 'rating' ? 'text-violet-600' : 'text-gray-700')}>
                        {Number(inf.rating ?? 0) > 0 ? `${Number(inf.rating).toFixed(1)} ★` : '—'}
                      </span>
                    </td>
                  )}

                  {visible.campaigns && (
                    <td className="px-4 py-3 text-right">
                      <span className={cn('text-sm font-semibold', sortBy === 'campaigns' ? 'text-violet-600' : 'text-gray-700')}>
                        {inf.campaign_count}
                      </span>
                    </td>
                  )}

                  {visible.deliverables && (
                    <td className="px-4 py-3 text-right">
                      <span className={cn('text-sm font-semibold', sortBy === 'deliverables_completed' ? 'text-violet-600' : 'text-gray-700')}>
                        {inf.deliverables_completed}/{inf.deliverables_total}
                      </span>
                    </td>
                  )}

                  {visible.completion && (
                    <td className="px-4 py-3 text-right">
                      <span className={cn('text-sm font-semibold', sortBy === 'completion_rate' ? 'text-violet-600' : 'text-gray-700')}>
                        {formatPercent(inf.completion_rate)}
                      </span>
                    </td>
                  )}

                  {visible.city && (
                    <td className="px-4 py-3 text-right text-sm text-gray-600">
                      {inf.commune ?? inf.city ?? '—'}
                    </td>
                  )}

                  {visible.lastConnection && (
                    <td className="px-4 py-3 text-right text-sm text-gray-600">
                      {inf.last_sign_in_at
                        ? new Date(inf.last_sign_in_at).toLocaleDateString('es-CL', {
                            day: '2-digit',
                            month: '2-digit',
                            year: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : inf.user_id ? 'Sin conexión' : 'Sin acceso'}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>

        {ranked.length === 0 && (
          <div className="text-center py-12 text-gray-400 text-sm">
            No hay influencers para mostrar en el ranking
          </div>
        )}
      </div>
    </div>
  )
}
