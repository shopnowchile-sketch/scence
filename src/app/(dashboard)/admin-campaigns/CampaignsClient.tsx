'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Plus, Target, DollarSign, Clock, Sparkles } from 'lucide-react'
import { useCampaignsList } from '@/hooks/useCampaignsList'
import { AICampaignBuilder } from '@/components/campaigns/AICampaignBuilder'
import { CampaignFilters } from '@/components/campaigns/CampaignFilters'
import { CampaignStatusBadge } from '@/components/campaigns/CampaignStatusBadge'
import { formatCurrency, formatDate, PLATFORM_ICONS } from '@/lib/utils'
import type { Campaign, CampaignFilters as CampaignFiltersType } from '@/types'

// ── KPI summary ───────────────────────────────────────
function KPIs({ campaigns }: { campaigns: Campaign[] }) {
  const active      = campaigns.filter(c => c.status === 'active').length
  const totalBudget = campaigns.reduce((s, c) => s + (c.budget_total ?? 0), 0)
  const totalSpent  = campaigns.reduce((s, c) => s + c.budget_spent, 0)
  const pending     = campaigns.reduce((s, c) => s + ((c.deliverable_count ?? 0) - (c.deliverable_done ?? 0)), 0)

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      {[
        { icon: Target,     color: 'violet',  label: 'Campañas activas',   value: active },
        { icon: DollarSign, color: 'emerald', label: 'Budget total',       value: formatCurrency(totalBudget, 'CLP') },
        { icon: DollarSign, color: 'blue',    label: 'Total gastado',      value: formatCurrency(totalSpent, 'CLP') },
        { icon: Clock,      color: 'amber',   label: 'Deliverables pend.', value: pending },
      ].map(({ icon: Icon, color, label, value }) => (
        <div key={label} className="card p-4">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-lg bg-${color}-100 flex items-center justify-center flex-shrink-0`}>
              <Icon className={`h-4 w-4 text-${color}-600`} />
            </div>
            <div>
              <div className="text-xl font-bold text-gray-900">{value}</div>
              <div className="text-xs text-gray-400">{label}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Progress bar ──────────────────────────────────────
function ProgressBar({ done, total, pct }: { done: number; total: number; pct: number }) {
  const color = pct === 100 ? 'bg-emerald-500' : pct > 60 ? 'bg-violet-500' : pct > 30 ? 'bg-amber-400' : 'bg-gray-300'
  return (
    <div>
      <div className="flex justify-between text-xs text-gray-400 mb-1">
        <span>{done}/{total} entregables</span>
        <span>{pct}%</span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

// ── Avatar group ──────────────────────────────────────
const GRADIENTS = [
  'from-pink-400 to-violet-500', 'from-blue-400 to-cyan-500',
  'from-emerald-400 to-teal-500', 'from-orange-400 to-red-500',
]
function AvatarGroup({ count, campaignId, base = '/admin-campaigns' }: { count: number; campaignId: string; base?: string }) {
  const shown = Math.min(count, 3)
  return (
    <Link href={`${base}/${campaignId}?tab=influencers`}
      className="flex items-center gap-1.5 hover:opacity-80 transition-opacity" title="Ver influencers asignados">
      <div className="flex">
        {Array.from({ length: shown }).map((_, i) => (
          <div key={i}
            className={`w-6 h-6 rounded-full border-2 border-white bg-gradient-to-br ${GRADIENTS[i % 4]}`}
            style={{ marginLeft: i === 0 ? 0 : -6 }}
          />
        ))}
        {count > 3 && (
          <div className="w-6 h-6 rounded-full border-2 border-white bg-gray-100 flex items-center justify-center text-gray-500 text-[9px] font-bold" style={{ marginLeft: -6 }}>
            +{count - 3}
          </div>
        )}
      </div>
      <span className="text-xs font-medium text-violet-600 underline-offset-2 hover:underline">{count} influencer{count !== 1 ? 's' : ''}</span>
    </Link>
  )
}

// ── Skeleton ─────────────────────────────────────────
function Skeleton() {
  return (
    <div className="card overflow-hidden animate-pulse">
      <table className="w-full min-w-[640px]">
        <tbody>
          {Array.from({ length: 5 }).map((_, i) => (
            <tr key={i} className="border-b border-gray-50">
              {Array.from({ length: 8 }).map((_, j) => (
                <td key={j} className="px-4 py-4">
                  <div className="h-3 bg-gray-100 rounded-full" style={{ width: `${40 + (j * 7) % 40}%` }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────
interface CampaignsClientProps {
  portal?: 'admin' | 'brand'
}

type CampaignColumnKey =
  | 'campaign'
  | 'type'
  | 'platforms'
  | 'influencers'
  | 'progress'
  | 'budget'
  | 'dates'
  | 'status'

type SortKey = CampaignColumnKey
type SortOrder = 'asc' | 'desc'

const CAMPAIGN_COLUMNS: Array<{ key: CampaignColumnKey; label: string }> = [
  { key: 'campaign',    label: 'Campaña' },
  { key: 'type',        label: 'Tipo' },
  { key: 'platforms',   label: 'Plataformas' },
  { key: 'influencers', label: 'Influencers' },
  { key: 'progress',    label: 'Progreso' },
  { key: 'budget',      label: 'Budget' },
  { key: 'dates',       label: 'Fechas' },
  { key: 'status',      label: 'Estado' },
]

export function CampaignsClient({ portal = 'admin' }: CampaignsClientProps) {
  const isBrandPortal = portal === 'brand'
  const [filters, setFilters]   = useState<Partial<CampaignFiltersType>>({})
  const [showAIBuilder, setShowAIBuilder] = useState(false)
  const [showColumns, setShowColumns] = useState(false)
  const [visibleColumns, setVisibleColumns] = useState<Record<CampaignColumnKey, boolean>>({
    campaign: true,
    type: true,
    platforms: true,
    influencers: true,
    progress: true,
    budget: true,
    dates: true,
    status: true,
  })
  const [sortKey, setSortKey] = useState<SortKey>('dates')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')

  const { data, isLoading, error } = useCampaignsList({
    status:   filters.status,
    type:     filters.type,
    platform: filters.platform,
    apiBase:  isBrandPortal ? '/api/brand/campaigns' : '/api/campaigns',
    search:   filters.search,
    limit:    100,
  })

  const rawCampaigns: Campaign[] = data?.data ?? []

  function toggleSort(key: SortKey) {
    setSortOrder(prev => sortKey === key && prev === 'desc' ? 'asc' : 'desc')
    setSortKey(key)
  }

  function toggleColumn(key: CampaignColumnKey) {
    setVisibleColumns(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const campaigns = useMemo(() => {
    const sorted = [...rawCampaigns]
    sorted.sort((a, b) => {
      const progressA = a.deliverable_count ? ((a.deliverable_done ?? 0) / a.deliverable_count) : 0
      const progressB = b.deliverable_count ? ((b.deliverable_done ?? 0) / b.deliverable_count) : 0

      const getValue = (c: Campaign) => {
        switch (sortKey) {
          case 'campaign':    return c.name ?? ''
          case 'type':        return c.type ?? ''
          case 'platforms':   return c.platforms?.join(',') ?? ''
          case 'influencers': return c.influencer_count ?? 0
          case 'progress':    return c === a ? progressA : progressB
          case 'budget':      return c.budget_total ?? 0
          case 'dates':       return c.start_date ?? ''
          case 'status':      return c.status ?? ''
          default:            return ''
        }
      }

      const av = getValue(a)
      const bv = getValue(b)
      const result = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv))

      return sortOrder === 'asc' ? result : -result
    })
    return sorted
  }, [rawCampaigns, sortKey, sortOrder])

  const visibleColumnList = CAMPAIGN_COLUMNS.filter(c => visibleColumns[c.key])
  const visibleColSpan = visibleColumnList.length + 1

  function setFilter(f: Partial<CampaignFiltersType>) {
    setFilters((prev: Partial<CampaignFiltersType>) => ({ ...prev, ...f }))
  }
  function resetFilters() { setFilters({}) }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Campañas</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {isLoading ? 'Cargando…' : `${data?.total ?? 0} campañas en total`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!isBrandPortal && (
            <button
              onClick={() => setShowAIBuilder(true)}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-semibold rounded-lg hover:from-violet-700 hover:to-indigo-700 transition-all shadow-sm shadow-violet-200"
            >
              <Sparkles className="h-4 w-4" /> Crear con IA
            </button>
          )}
          <Link href={isBrandPortal ? '/brand-campaigns/new' : '/admin-campaigns/new'}
            className="flex items-center gap-2 px-4 py-2 bg-white text-gray-700 text-sm font-semibold rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
            <Plus className="h-4 w-4" /> Nueva campaña
          </Link>
        </div>
      </div>

      {showAIBuilder && <AICampaignBuilder onClose={() => setShowAIBuilder(false)} />}

      {error ? (
        <div className="card p-6 text-center text-sm text-red-500">
          Error al cargar campañas. Verifica tu conexión a Supabase.
        </div>
      ) : (
        <>
          <KPIs campaigns={campaigns} />

          {/* Filtros */}
          <div className="card p-4">
            <CampaignFilters
              filters={{ search: '', status: '', type: '', platform: '', dateFrom: '', dateTo: '', ...filters } as CampaignFiltersType}
              onChange={setFilter}
              onReset={resetFilters}
              total={campaigns.length}
            />
          </div>

          {/* Columnas */}
          <div className="relative flex justify-end">
            <button
              type="button"
              onClick={() => setShowColumns(v => !v)}
              className="px-3 py-2 text-sm font-semibold text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              Columnas
            </button>

            {showColumns && (
              <div className="absolute right-0 top-11 z-20 w-56 rounded-xl border border-gray-200 bg-white shadow-lg p-3">
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Mostrar columnas</div>
                <div className="space-y-2">
                  {CAMPAIGN_COLUMNS.map(col => (
                    <label key={col.key} className="flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={visibleColumns[col.key]}
                        onChange={() => toggleColumn(col.key)}
                      />
                      {col.label}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Tabla */}
          {isLoading ? <Skeleton /> : (
            <div className="card overflow-x-auto">
              <table className="w-full min-w-[640px]">
                <thead>
                  <tr className="border-b border-gray-100">
                    {visibleColumnList.map(col => (
                      <th key={col.key} className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider bg-gray-50">
                        <button
                          type="button"
                          onClick={() => toggleSort(col.key)}
                          className="flex items-center gap-1 hover:text-violet-600 transition-colors"
                        >
                          {col.label}
                          {sortKey === col.key && <span>{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                        </button>
                      </th>
                    ))}
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider bg-gray-50" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {campaigns.length === 0 ? (
                    <tr>
                      <td colSpan={visibleColSpan} className="px-4 py-12 text-center text-sm text-gray-400">
                        No hay campañas. <Link href={isBrandPortal ? '/brand-campaigns/new' : '/admin-campaigns/new'} className="text-violet-600 hover:underline">Crea la primera</Link>
                      </td>
                    </tr>
                  ) : campaigns.map(c => {
                    const pct = c.deliverable_count
                      ? Math.round(((c.deliverable_done ?? 0) / c.deliverable_count) * 100) : 0
                    const budgetPct = c.budget_total
                      ? Math.round((c.budget_spent / c.budget_total) * 100) : 0

                    return (
                      <tr key={c.id} className="hover:bg-gray-50/70 transition-colors group">
                        {visibleColumns.campaign && (
                          <td className="px-4 py-3 max-w-[200px]">
                            <Link href={`${isBrandPortal ? '/brand-campaigns' : '/admin-campaigns'}/${c.id}`} className="block">
                              <div className="text-sm font-semibold text-gray-900 hover:text-violet-700 transition-colors line-clamp-1">{c.name}</div>
                              {c.description && <div className="text-xs text-gray-400 line-clamp-1 mt-0.5">{c.description}</div>}
                            </Link>
                          </td>
                        )}
                        {visibleColumns.type && (
                          <td className="px-4 py-3">
                            <span className="badge badge-gray capitalize text-[11px]">{c.type.replace(/_/g, ' ')}</span>
                          </td>
                        )}
                        {visibleColumns.platforms && (
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1">
                              {c.platforms?.map(p => <span key={p} className="text-base" title={p}>{PLATFORM_ICONS[p]}</span>)}
                              {(!c.platforms || c.platforms.length === 0) && <span className="text-xs text-gray-300">—</span>}
                            </div>
                          </td>
                        )}
                        {visibleColumns.influencers && (
                          <td className="px-4 py-3">
                            <AvatarGroup count={c.influencer_count ?? 0} campaignId={c.id} base={isBrandPortal ? '/brand-campaigns' : '/admin-campaigns'} />
                          </td>
                        )}
                        {visibleColumns.progress && (
                          <td className="px-4 py-3 min-w-[140px]">
                            {(c.deliverable_count ?? 0) > 0
                              ? <ProgressBar done={c.deliverable_done ?? 0} total={c.deliverable_count ?? 0} pct={pct} />
                              : <span className="text-xs text-gray-300">Sin deliverables</span>}
                          </td>
                        )}
                        {visibleColumns.budget && (
                          <td className="px-4 py-3">
                            {c.budget_total ? (
                              <div>
                                <div className="text-sm font-semibold text-gray-900">{formatCurrency(c.budget_total, c.currency)}</div>
                                <div className="text-xs text-gray-400 mt-0.5">
                                  {formatCurrency(c.budget_spent, c.currency)} gastado
                                  {c.budget_total > 0 && (
                                    <span className={budgetPct > 90 ? ' text-red-500 font-medium' : ''}> ({budgetPct}%)</span>
                                  )}
                                </div>
                              </div>
                            ) : <span className="text-xs text-gray-300">Sin budget</span>}
                          </td>
                        )}
                        {visibleColumns.dates && (
                          <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                            {c.start_date ? (
                              <div>
                                <div>{formatDate(c.start_date, 'd MMM yy')}</div>
                                <div className="text-gray-300">→ {c.end_date ? formatDate(c.end_date, 'd MMM yy') : '—'}</div>
                              </div>
                            ) : <span className="text-gray-300">Sin fechas</span>}
                          </td>
                        )}
                        {visibleColumns.status && (
                          <td className="px-4 py-3">
                            <CampaignStatusBadge status={c.status} />
                            {c.brand && (
                              <span className="text-xs text-gray-400 flex items-center gap-1">
                                🏢 {c.brand.name}
                              </span>
                            )}
                          </td>
                        )}
                        <td className="px-4 py-3">
                          <Link href={`${isBrandPortal ? '/brand-campaigns' : '/admin-campaigns'}/${c.id}`}
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-xs font-medium text-violet-600 hover:underline whitespace-nowrap">
                            Ver →
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
