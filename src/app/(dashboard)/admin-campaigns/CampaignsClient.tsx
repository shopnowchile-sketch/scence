'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Columns3, Filter, Plus, Target, DollarSign, Clock, Sparkles } from 'lucide-react'
import { useCampaignsList, useCampaignsSummary, type CampaignSummary } from '@/hooks/useCampaignsList'
import { AICampaignBuilder } from '@/components/campaigns/AICampaignBuilder'
import { CampaignFilters } from '@/components/campaigns/CampaignFilters'
import { CampaignStatusBadge } from '@/components/campaigns/CampaignStatusBadge'
import { SortableTH } from '@/components/ui/SortableTH'
import { formatCurrency, formatDate, formatDatetime, PLATFORM_ICONS } from '@/lib/utils'
import type { Campaign, CampaignFilters as CampaignFiltersType } from '@/types'
import { useLocalStorageState } from '@/hooks/useLocalStorageState'
import { useColumnWidths } from '@/hooks/useColumnWidths'

// ── KPI summary ───────────────────────────────────────
function KPIs({ summary }: { summary: CampaignSummary }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      {[
        { icon: Target,     color: 'violet',  label: 'Campañas activas',   value: summary.active },
        { icon: DollarSign, color: 'emerald', label: 'Budget total',       value: formatCurrency(summary.totalBudget, 'CLP') },
        { icon: DollarSign, color: 'blue',    label: 'Total gastado',      value: formatCurrency(summary.totalSpent, 'CLP') },
        { icon: Clock,      color: 'amber',   label: 'Deliverables pend.', value: summary.pendingDeliverables },
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
  | 'brand'
  | 'type'
  | 'visibility'
  | 'platforms'
  | 'influencers'
  | 'views'
  | 'engagement'
  | 'progress'
  | 'budget'
  | 'dates'
  | 'createdAt'
  | 'status'

type SortKey = CampaignColumnKey
type SortOrder = 'asc' | 'desc'

const CAMPAIGN_COLUMNS: Array<{ key: CampaignColumnKey; label: string }> = [
  { key: 'campaign',    label: 'Campaña' },
  { key: 'brand',       label: 'Marca' },
  { key: 'type',        label: 'Tipo' },
  { key: 'visibility',  label: 'Público/Privado' },
  { key: 'platforms',   label: 'Plataformas' },
  { key: 'influencers', label: 'Influencers' },
  { key: 'views',       label: 'Visualizaciones' },
  { key: 'engagement',  label: 'Engagement' },
  { key: 'progress',    label: 'Progreso' },
  { key: 'budget',      label: 'Budget' },
  { key: 'dates',       label: 'Fechas' },
  { key: 'createdAt',   label: 'Fecha creación' },
  { key: 'status',      label: 'Estado' },
]

const DEFAULT_COLUMN_WIDTHS: Record<CampaignColumnKey, number> = {
  campaign: 330,
  brand: 180,
  type: 150,
  visibility: 160,
  platforms: 140,
  influencers: 180,
  views: 145,
  engagement: 140,
  progress: 190,
  budget: 170,
  dates: 160,
  createdAt: 190,
  status: 130,
}

function normalizeColumnOrder(order: CampaignColumnKey[]) {
  const known = new Set(CAMPAIGN_COLUMNS.map(column => column.key))
  const unique = order.filter((key, index) => known.has(key) && order.indexOf(key) === index)
  return [...unique, ...CAMPAIGN_COLUMNS.map(column => column.key).filter(key => !unique.includes(key))]
}

// Color estable por marca: la misma marca conserva siempre su color en Admin
// y Portal Marca, sin depender del orden en que lleguen las campañas.
const BRAND_COLORS = [
  'bg-violet-50 text-violet-700 ring-violet-200',
  'bg-blue-50 text-blue-700 ring-blue-200',
  'bg-emerald-50 text-emerald-700 ring-emerald-200',
  'bg-amber-50 text-amber-700 ring-amber-200',
  'bg-rose-50 text-rose-700 ring-rose-200',
  'bg-cyan-50 text-cyan-700 ring-cyan-200',
  'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200',
  'bg-orange-50 text-orange-700 ring-orange-200',
] as const

function brandColor(seed: string) {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0
  return BRAND_COLORS[Math.abs(hash) % BRAND_COLORS.length]
}

let brandOptionsRequest: Promise<{ id: string; name: string }[]> | null = null

function loadBrandOptions() {
  if (!brandOptionsRequest) {
    brandOptionsRequest = fetch('/api/brands?options=1&limit=5000')
      .then(r => {
        if (!r.ok) throw new Error('No se pudieron cargar las marcas')
        return r.json()
      })
      .then(j => (j.data ?? []).map((b: { id: string; name: string }) => ({ id: b.id, name: b.name })))
      .catch(error => {
        brandOptionsRequest = null
        throw error
      })
  }
  return brandOptionsRequest
}

export function CampaignsClient({ portal = 'admin' }: CampaignsClientProps) {
  const isBrandPortal = portal === 'brand'
  const searchParams = useSearchParams()
  const [filters, setFilters]   = useState<Partial<CampaignFiltersType>>(() => ({ status: (searchParams.get('status') ?? undefined) as CampaignFiltersType['status'] }))
  const [showAIBuilder, setShowAIBuilder] = useState(false)
  const [showColumns, setShowColumns] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [visibleColumns, setVisibleColumns] = useLocalStorageState<Record<CampaignColumnKey, boolean>>(
    `scence:${portal}:campaigns:columns`,
    {
      campaign: true,
      brand: true,
      type: true,
      visibility: true,
      platforms: true,
      influencers: true,
      views: true,
      engagement: true,
      progress: true,
      budget: true,
      dates: true,
      createdAt: true,
      status: true,
    }
  )
  const [sortKey, setSortKey] = useLocalStorageState<SortKey>(`scence:${portal}:campaigns:sortKey`, 'dates')
  const [sortOrder, setSortOrder] = useLocalStorageState<SortOrder>(`scence:${portal}:campaigns:sortOrder`, 'desc')
  const [columnOrder, setColumnOrder] = useLocalStorageState<CampaignColumnKey[]>(
    `scence:${portal}:campaigns:columnOrder`,
    CAMPAIGN_COLUMNS.map(column => column.key),
  )
  const { widths, startResize, resetWidths } = useColumnWidths<CampaignColumnKey>(
    `scence:${portal}:campaigns:widths`,
    DEFAULT_COLUMN_WIDTHS,
  )
  const [draggedColumn, setDraggedColumn] = useState<CampaignColumnKey | null>(null)

  const { data, isLoading, error } = useCampaignsList({
    status:     filters.status,
    type:       filters.type,
    platform:   filters.platform,
    visibility: filters.visibility,
    brandId:    filters.brandId,
    apiBase:    isBrandPortal ? '/api/brand/campaigns' : '/api/campaigns',
    search:     filters.search,
    dateFrom:   filters.dateFrom,
    dateTo:     filters.dateTo,
    limit:      100,
  })

  const rawCampaigns = useMemo<Campaign[]>(() => data?.data ?? [], [data?.data])

  // Resumen liviano: mantiene los KPI exactos sin descargar miles de campañas
  // completas ni sus relaciones solo para sumar cuatro valores.
  const { data: statsSummary } = useCampaignsSummary({
    status:     filters.status,
    type:       filters.type,
    platform:   filters.platform,
    visibility: filters.visibility,
    brandId:    filters.brandId,
    search:     filters.search,
    dateFrom:   filters.dateFrom,
    dateTo:     filters.dateTo,
    enabled:    !isBrandPortal,
  })
  const localSummary = useMemo<CampaignSummary>(() => ({
    active: rawCampaigns.filter(c => c.status === 'active').length,
    totalBudget: rawCampaigns.reduce((sum, c) => sum + (c.budget_total ?? 0), 0),
    totalSpent: rawCampaigns.reduce((sum, c) => sum + (c.budget_spent ?? 0), 0),
    pendingDeliverables: rawCampaigns.reduce(
      (sum, c) => sum + Math.max(0, (c.deliverable_count ?? 0) - (c.deliverable_done ?? 0)),
      0
    ),
    pendingApprovalCount: rawCampaigns.filter(c => c.status === 'pending_approval').length,
  }), [rawCampaigns])
  const summary = isBrandPortal ? localSummary : (statsSummary ?? localSummary)

  // Lista de marcas para el filtro (solo admin) — reutiliza /api/brands, ya
  // usado por BrandSelector en el form de creación/edición.
  const [brands, setBrands] = useState<{ id: string; name: string }[]>([])
  useEffect(() => {
    if (isBrandPortal) return
    loadBrandOptions()
      .then(setBrands)
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pendingApprovalCount = isBrandPortal ? 0 : summary.pendingApprovalCount

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
          case 'brand':       return c.brand?.name ?? ''
          case 'type':        return c.type ?? ''
          case 'visibility':  return c.visibility ?? ''
          case 'platforms':   return c.platforms?.join(',') ?? ''
          case 'influencers': return c.influencer_count ?? 0
          case 'views':       return c.total_views ?? -1
          case 'engagement':  return c.engagement_average ?? -1
          case 'progress':    return c === a ? progressA : progressB
          case 'budget':      return c.budget_total ?? 0
          case 'dates':       return c.start_date ?? ''
          case 'createdAt':   return c.created_at ?? ''
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

  const orderedColumns = normalizeColumnOrder(columnOrder)
  const visibleColumnList = orderedColumns
    .map(key => CAMPAIGN_COLUMNS.find(column => column.key === key)!)
    .filter(column => visibleColumns[column.key])
  const visibleColSpan = visibleColumnList.length + 1

  function moveColumn(from: CampaignColumnKey, to: CampaignColumnKey) {
    if (from === to) return
    setColumnOrder(previous => {
      const next = normalizeColumnOrder(previous)
      const fromIndex = next.indexOf(from)
      const toIndex = next.indexOf(to)
      next.splice(fromIndex, 1)
      next.splice(toIndex, 0, from)
      return next
    })
  }

  function setFilter(f: Partial<CampaignFiltersType>) {
    setFilters((prev: Partial<CampaignFiltersType>) => ({ ...prev, ...f }))
  }
  function resetFilters() { setFilters({}) }

  function renderCampaignCell(c: Campaign, key: CampaignColumnKey, pct: number, budgetPct: number) {
    switch (key) {
      case 'campaign': return <td className="px-4 py-3 overflow-hidden"><Link href={`${isBrandPortal ? '/brand-campaigns' : '/admin-campaigns'}/${c.id}`} className="block"><div className="flex min-w-0 items-center gap-3"><div className="relative h-11 w-14 shrink-0 overflow-hidden rounded-lg border border-gray-100 bg-gradient-to-br from-violet-100 via-fuchsia-50 to-amber-50">{c.cover_url && <img src={c.cover_url} alt="" className="h-full w-full object-cover" />}</div><div className="min-w-0"><div className="text-sm font-semibold text-gray-900 hover:text-violet-700 transition-colors line-clamp-1">{c.name}</div>{c.description && <div className="text-xs text-gray-400 line-clamp-1 mt-0.5">{c.description}</div>}</div></div></Link></td>
      case 'brand': return <td className="px-4 py-3">{c.brand ? <span className={`inline-flex max-w-[180px] items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${brandColor(c.brand.id ?? c.brand.name)}`}><span className="truncate">{c.brand.name}</span></span> : <span className="text-xs text-gray-300">—</span>}</td>
      case 'type': return <td className="px-4 py-3"><span className="badge badge-gray capitalize text-[11px]">{c.type.replace(/_/g, ' ')}</span></td>
      case 'visibility': return <td className="px-4 py-3">{c.visibility ? <span className={`badge text-[11px] ${c.visibility === 'open' ? 'badge-green' : 'badge-gray'}`}>{c.visibility === 'open' ? 'Pública' : 'Privada'}</span> : <span className="text-xs text-gray-300">—</span>}</td>
      case 'platforms': return <td className="px-4 py-3"><div className="flex items-center gap-1">{c.platforms?.map(p => <span key={p} className="text-base" title={p}>{PLATFORM_ICONS[p]}</span>)}{(!c.platforms || c.platforms.length === 0) && <span className="text-xs text-gray-300">—</span>}</div></td>
      case 'influencers': return <td className="px-4 py-3"><AvatarGroup count={c.influencer_count ?? 0} campaignId={c.id} base={isBrandPortal ? '/brand-campaigns' : '/admin-campaigns'} /></td>
      case 'views': return <td className="px-4 py-3 text-sm font-semibold text-gray-700 tabular-nums">{c.status === 'completed' && c.total_views !== null && c.total_views !== undefined ? c.total_views.toLocaleString('es-CL') : <span className="text-gray-300">—</span>}</td>
      case 'engagement': return <td className="px-4 py-3 text-sm font-semibold text-violet-600 tabular-nums">{c.status === 'completed' && c.engagement_average !== null && c.engagement_average !== undefined ? `${c.engagement_average.toFixed(2)}%` : <span className="text-gray-300">—</span>}</td>
      case 'progress': return <td className="px-4 py-3 overflow-hidden">{(c.deliverable_count ?? 0) > 0 ? <ProgressBar done={c.deliverable_done ?? 0} total={c.deliverable_count ?? 0} pct={pct} /> : <span className="text-xs text-gray-300">Sin deliverables</span>}</td>
      case 'budget': return <td className="px-4 py-3">{c.budget_total ? <div><div className="text-sm font-semibold text-gray-900">{formatCurrency(c.budget_total, c.currency)}</div><div className="text-xs text-gray-400 mt-0.5">{formatCurrency(c.budget_spent, c.currency)} gastado{c.budget_total > 0 && <span className={budgetPct > 90 ? ' text-red-500 font-medium' : ''}> ({budgetPct}%)</span>}</div></div> : <span className="text-xs text-gray-300">Sin budget</span>}</td>
      case 'dates': return <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{c.start_date ? <div><div>{formatDate(c.start_date, 'd MMM yy')}</div><div className="text-gray-300">→ {c.end_date ? formatDate(c.end_date, 'd MMM yy') : '—'}</div></div> : <span className="text-gray-300">Sin fechas</span>}</td>
      case 'createdAt': return <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{c.created_at ? formatDatetime(c.created_at) : <span className="text-gray-300">—</span>}</td>
      case 'status': return <td className="px-4 py-3"><CampaignStatusBadge status={c.status} /></td>
    }
  }

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

      {/* Pestañas: Todas / Pendientes de aprobación — solo admin. Reutiliza el
          mismo filtro por status que ya funciona (pill "En aprobación" en
          CampaignFilters), solo le da un lugar más visible y con contador. */}
      {!isBrandPortal && (
        <div className="flex items-center gap-1 border-b border-gray-100">
          <button
            type="button"
            onClick={() => setFilter({ status: '' })}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors -mb-px ${
              filters.status !== 'pending_approval'
                ? 'border-violet-600 text-violet-700'
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            Todas las campañas
          </button>
          <button
            type="button"
            onClick={() => setFilter({ status: 'pending_approval' })}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors -mb-px flex items-center gap-1.5 ${
              filters.status === 'pending_approval'
                ? 'border-violet-600 text-violet-700'
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            Pendientes de aprobación
            {pendingApprovalCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[11px] font-bold">
                {pendingApprovalCount}
              </span>
            )}
          </button>
        </div>
      )}

      {error ? (
        <div className="card p-6 text-center text-sm text-red-500">
          Error al cargar campañas. Verifica tu conexión a Supabase.
        </div>
      ) : (
        <>
          <KPIs summary={summary} />

          {/* Barra compacta: los controles completos se mantienen dentro de Filtros. */}
          <div className="relative flex items-center justify-between gap-3">
            <span className="text-sm text-gray-500">{campaigns.length} campaña{campaigns.length !== 1 ? 's' : ''}</span>
            <div className="relative flex items-center gap-2">
              <button
                type="button"
                onClick={() => { setShowFilters(v => !v); setShowColumns(false) }}
                title="Filtros"
                aria-label="Filtros"
                className={`inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-semibold transition-colors ${showFilters || Object.values(filters).some(Boolean) ? 'border-violet-300 bg-violet-50 text-violet-700' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'}`}
              >
                <Filter className="h-4 w-4" /> Filtros
              </button>
              <button
                type="button"
                onClick={() => { setShowColumns(v => !v); setShowFilters(false) }}
                title="Columnas"
                aria-label="Columnas"
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
              >
                <Columns3 className="h-4 w-4" />
              </button>

              {showFilters && (
                <div className="absolute right-0 top-12 z-30 w-[min(760px,calc(100vw-3rem))] rounded-xl border border-gray-200 bg-white p-4 shadow-xl">
                  <CampaignFilters
                    filters={{ search: '', status: '', type: '', platform: '', visibility: '', brandId: '', dateFrom: '', dateTo: '', ...filters } as CampaignFiltersType}
                    onChange={setFilter}
                    onReset={resetFilters}
                    total={campaigns.length}
                    brands={isBrandPortal ? undefined : brands}
                  />
                </div>
              )}

              {showColumns && (
                <div className="absolute right-0 top-12 z-30 w-56 rounded-xl border border-gray-200 bg-white shadow-lg p-3">
                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Mostrar columnas</div>
                  <button
                    type="button"
                    onClick={() => {
                      setColumnOrder(CAMPAIGN_COLUMNS.map(column => column.key))
                      resetWidths()
                    }}
                    className="mb-2 text-xs font-semibold text-violet-600 hover:text-violet-700"
                  >
                    Restablecer orden y tamaños
                  </button>
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
          </div>

          {/* Tabla */}
          {isLoading ? <Skeleton /> : (
            <div className="card overflow-x-auto">
              <table className="min-w-[640px]" style={{ tableLayout: 'fixed', width: 'max-content', minWidth: '100%' }}>
                <colgroup>
                  {visibleColumnList.map(column => <col key={column.key} style={{ width: widths[column.key] }} />)}
                  <col style={{ width: 68 }} />
                </colgroup>
                <thead>
                  <tr className="border-b border-gray-100">
                    {visibleColumnList.map(col => (
                      <SortableTH
                        key={col.key}
                        col={col.key}
                        sortBy={sortKey}
                        sortDir={sortOrder}
                        onSort={toggleSort}
                        onResizeStart={event => startResize(col.key, event)}
                        dragProps={{
                          draggable: true,
                          onDragStart: event => {
                            event.dataTransfer.effectAllowed = 'move'
                            event.dataTransfer.setData('text/plain', col.key)
                            setDraggedColumn(col.key)
                          },
                          onDragOver: event => event.preventDefault(),
                          onDrop: event => {
                            event.preventDefault()
                            const source = (event.dataTransfer.getData('text/plain') || draggedColumn) as CampaignColumnKey | null
                            if (source) moveColumn(source, col.key)
                            setDraggedColumn(null)
                          },
                          onDragEnd: () => setDraggedColumn(null),
                          title: `${col.label}: arrastra para ordenar`,
                        }}
                      >
                        {col.label}
                      </SortableTH>
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
                        {visibleColumnList.map(column => <Fragment key={column.key}>{renderCampaignCell(c, column.key, pct, budgetPct)}</Fragment>)}
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
