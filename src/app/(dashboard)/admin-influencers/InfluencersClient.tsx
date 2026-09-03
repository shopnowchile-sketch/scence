'use client'

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Plus, Upload, Users, TrendingUp, Globe, ChevronLeft, ChevronRight, ShieldCheck, Trash2, X, Loader2, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { useInfluencers } from '@/hooks/useInfluencers'
import { useIsAdmin } from '@/hooks/useIsAdmin'
import { InfluencerFilters } from '@/components/influencers/InfluencerFilters'
import { InfluencerTable } from '@/components/influencers/InfluencerTable'
import { BulkUploadModal } from '@/components/influencers/BulkUploadModal'
import { cn, formatFollowers } from '@/lib/utils'
import type { Influencer } from '@/types'
import Link from 'next/link'
import { fetchJsonCached } from '@/lib/client/requestCache'

interface InfluencersClientProps {
  portal?: 'admin' | 'brand'
  initialView?: 'list'
}

export function InfluencersClient({ portal = 'admin', initialView }: InfluencersClientProps) {
  const isBrandPortal = portal === 'brand'
  const [showBulk, setShowBulk] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const { isAdmin } = useIsAdmin()

  // Modo "asignar a marca" — se llega acá desde el tab Influencers del
  // detalle de marca en admin (?assignToBrand=<id>&assignToBrandName=...).
  // Reutiliza esta misma lista/filtros/paginación en vez de crear un picker
  // aparte; la asignación se hace vía la barra de selección que ya existe.
  const searchParams = useSearchParams()
  const assignToBrand = searchParams.get('assignToBrand')
  const assignToBrandName = searchParams.get('assignToBrandName')

  // Filtros que llegan por URL desde /admin-influencers/data-quality (pedido
  // Pri: tarjetas clickeables que "abren la tabla con el filtro correcto").
  // `status` reusa el filtro isActive que YA existe end-to-end (server +
  // hook) — se aplica una sola vez al montar. `data_quality=missing_instagram`
  // no tiene un filtro server-side equivalente; se resuelve client-side sobre
  // la página ya cargada, mismo patrón que el filtro de postulaciones de
  // campaña (CampaignDetail.tsx) — sin crear endpoint ni campo nuevo en
  // useInfluencers.
  const statusParam = searchParams.get('status')
  const missingInstagram = searchParams.get('data_quality') === 'missing_instagram'

  // Ranking por comuna/nicho de la misma pantalla de Data Quality (pedido Pri
  // 2026-07-13). Valor real -> reusa filters.commune / filters.categories
  // (ya soportados end-to-end por /api/influencers). Sentinel "__none__"
  // ("Sin comuna"/"Sin nicho") no tiene equivalente server-side (no hay
  // filtro "IS NULL"), se resuelve client-side igual que missingInstagram.
  const communeParam = searchParams.get('commune')
  const nicheParam = searchParams.get('niche')
  const noCommune = communeParam === '__none__'
  const noNiche = nicheParam === '__none__'

  const {
    influencers,
    total,
    filtered,
    loading,
    error,
    filters,
    view,
    setView,
    updateFilter,
    resetFilters,
    toggleSort,
    refetch,
    page,
    setPage,
    totalPages,
    pageSize,
  } = useInfluencers(undefined, isBrandPortal ? '/api/brand/influencers' : '/api/influencers')

  const initialViewApplied = useRef(false)

  useEffect(() => {
    if (initialViewApplied.current) return
    setView('list')
    initialViewApplied.current = true
  }, [setView])

  const urlFiltersApplied = useRef(false)
  useEffect(() => {
    if (urlFiltersApplied.current) return
    if (statusParam === 'active') updateFilter({ isActive: true })
    else if (statusParam === 'inactive') updateFilter({ isActive: false })
    if (communeParam && !noCommune) updateFilter({ commune: communeParam })
    if (nicheParam && !noNiche) updateFilter({ categories: [nicheParam] })
    urlFiltersApplied.current = true
  }, [statusParam, communeParam, noCommune, nicheParam, noNiche, updateFilter])

  // Filtro Plan (Todos/PRO/Gratis) — solo portal admin. is_pro/pro_source ya
  // vienen calculados por el servidor desde PayPal (subscriptions) + override
  // manual (ver getInfluencerProStatuses en src/lib/influencer-pro.ts); no hay
  // columna is_pro en la tabla influencers. Sin equivalente server-side (es
  // derivado, no una columna), se resuelve client-side sobre la página ya
  // cargada — mismo patrón que los filtros de abajo.
  const [planFilter, setPlanFilter] = useState<'' | 'pro' | 'free'>('')

  // "Sin Instagram" / "Sin comuna" / "Sin nicho" — sin equivalente de filtro
  // server-side ("IS NULL" / array vacío), se resuelven client-side sobre la
  // página ya cargada (mismo patrón para los 3).
  const visibleInfluencers = influencers.filter(inf => {
    if (missingInstagram && inf.social_profiles?.some(sp => sp.platform === 'instagram' && (sp.username || sp.profile_url))) return false
    if (noCommune && inf.commune?.trim()) return false
    if (noNiche && inf.categories && inf.categories.length > 0) return false
    if (!isBrandPortal && planFilter === 'pro' && !inf.is_pro) return false
    if (!isBrandPortal && planFilter === 'free' && inf.is_pro) return false
    return true
  })

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function toggleAll() {
    setSelectedIds(prev => {
      const allOnPage = influencers.every(i => prev.has(i.id))
      if (allOnPage) return new Set()
      return new Set(influencers.map(i => i.id))
    })
  }
  function clearSelection() { setSelectedIds(new Set()) }

  async function bulkDelete(hard: boolean) {
    const ids = Array.from(selectedIds)
    if (!ids.length) return
    const verb = hard ? 'eliminar permanentemente' : 'desactivar'
    if (!confirm(`¿${hard ? 'Eliminar permanentemente' : 'Desactivar'} ${ids.length} influencer(s)? ${hard ? 'Esta acción no se puede deshacer.' : ''}`)) return
    setDeleting(true)
    try {
      const r = await fetch('/api/influencers/bulk-delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, hard }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error)
      toast.success(hard ? `${j.deleted} eliminados` : `${j.deactivated} desactivados`)
      clearSelection()
      refetch?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Error al ${verb}`)
    } finally { setDeleting(false) }
  }

  async function assignSelectedToBrand() {
    if (!assignToBrand) return
    const ids = Array.from(selectedIds)
    if (!ids.length) return
    setAssigning(true)
    try {
      const r = await fetch(`/api/brands/${assignToBrand}/influencers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ influencer_ids: ids }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error)
      toast.success(`${ids.length} influencer(s) asignado(s) a ${assignToBrandName ?? 'la marca'}`)
      clearSelection()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al asignar')
    } finally {
      setAssigning(false)
    }
  }

  async function deleteOne(inf: Influencer) {
    if (!confirm(`¿Eliminar permanentemente a "${inf.display_name}"? Esta acción no se puede deshacer.`)) return
    try {
      const r = await fetch(`/api/influencers/${inf.id}?hard=true`, { method: 'DELETE' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error)
      toast.success('Influencer eliminado')
      refetch?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al eliminar')
    }
  }

  // Resumen liviano del servidor. Antes esta sección descargaba hasta 5.000
  // perfiles completos (incluyendo tarifas) además de la página visible.
  const [rosterSummary, setRosterSummary] = useState({ followers: 0, avg_engagement: 0, verified: 0 })
  useEffect(() => {
    const params = new URLSearchParams({ summary: '1' })
    if (filters.search)                             params.set('search', filters.search)
    if (filters.platforms.length === 1)             params.set('platform', filters.platforms[0])
    if (filters.categories.length === 1)            params.set('category', filters.categories[0])
    if (filters.country)                            params.set('country', filters.country)
    if (filters.commune)                            params.set('commune', filters.commune)
    if (filters.isVerified !== null)                params.set('verified', String(filters.isVerified))
    if (filters.isActive === false)                 params.set('is_active', 'false')
    else if (filters.isActive === true)             params.set('is_active', 'true')

    const url = `${isBrandPortal ? '/api/brand/influencers' : '/api/influencers'}?${params}`
    let cancelled = false
    fetchJsonCached<{ summary?: { followers?: number; avg_engagement?: number; verified?: number } }>(url, 15_000)
      .then(json => {
        if (cancelled) return
        setRosterSummary({
          followers: Number(json.summary?.followers ?? 0),
          avg_engagement: Number(json.summary?.avg_engagement ?? 0),
          verified: Number(json.summary?.verified ?? 0),
        })
      })
      .catch(() => { if (!cancelled) setRosterSummary({ followers: 0, avg_engagement: 0, verified: 0 }) })
    return () => { cancelled = true }
  }, [isBrandPortal, filters.search, filters.platforms, filters.categories, filters.country, filters.commune, filters.isVerified, filters.isActive])

  const totalFollowers = rosterSummary.followers
  const avgEngagement = rosterSummary.avg_engagement
  const verifiedCount = rosterSummary.verified

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Influencers</h1>
          <p className="text-sm text-gray-500 mt-0.5">Gestiona tu roster de talento</p>
        </div>
        <div className="flex items-center gap-2">
          {!isBrandPortal && (
            <Link
              href="/admin-influencers/data-quality"
              className="flex items-center gap-2 px-4 py-2 bg-white text-gray-700 text-sm font-semibold rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
            >
              <ShieldCheck className="h-4 w-4" />
              Data Quality
            </Link>
          )}
          {!isBrandPortal && (
            <>
              <button
                onClick={() => setShowBulk(true)}
                className="flex items-center gap-2 px-4 py-2 bg-white text-gray-700 text-sm font-semibold rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
              >
                <Upload className="h-4 w-4" />
                Importar CSV
              </button>
              <Link
                href="/admin-influencers/new"
                className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white text-sm font-semibold rounded-lg hover:bg-violet-700 transition-colors"
              >
                <Plus className="h-4 w-4" />
                Agregar influencer
              </Link>
            </>
          )}
          {isBrandPortal && (
            <>
              <Link
                href="/brand-campaigns"
                className="flex items-center gap-2 px-4 py-2 bg-white text-gray-700 text-sm font-semibold rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
              >
                Ir a mis campañas
              </Link>
              <Link
                href="/brand-influencers/new"
                className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white text-sm font-semibold rounded-lg hover:bg-violet-700 transition-colors"
              >
                <Plus className="h-4 w-4" />
                Agregar influencer
              </Link>
            </>
          )}
        </div>
      </div>
      {isBrandPortal && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-4 py-3 rounded-xl bg-violet-50 border border-violet-100">
          <p className="text-sm text-violet-800">
            Aquí aparecen las influencers privadas de tu marca.
          </p>
          <Link
            href="/brand-settings/plan"
            className="text-xs font-semibold text-violet-700 hover:underline"
          >
            Explorar todo el catálogo con Pro
          </Link>
        </div>
      )}

      {showBulk && (
        <BulkUploadModal
          onClose={() => setShowBulk(false)}
          onSuccess={() => { setShowBulk(false); refetch?.() }}
        />
      )}

      {assignToBrand && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-violet-50 border border-violet-100 text-sm text-violet-700">
          <span className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 flex-shrink-0" />
            Selecciona influencers de la lista para asignarlas a <strong>{assignToBrandName ?? 'la marca'}</strong>.
          </span>
          <Link
            href={`/admin-brands/${assignToBrand}?tab=influencers`}
            className="font-semibold hover:underline whitespace-nowrap"
          >
            ← Volver a la marca
          </Link>
        </div>
      )}

      {/* KPIs del roster */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-violet-100 flex items-center justify-center flex-shrink-0">
              <Users className="h-4 w-4 text-violet-600" />
            </div>
            <div>
              <div className="text-xl font-bold text-gray-900">{total}</div>
              <div className="text-xs text-gray-400">En roster</div>
            </div>
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
              <Globe className="h-4 w-4 text-blue-600" />
            </div>
            <div>
              <div className="text-xl font-bold text-gray-900">{formatFollowers(totalFollowers)}</div>
              <div className="text-xs text-gray-400">Alcance total</div>
            </div>
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center flex-shrink-0">
              <TrendingUp className="h-4 w-4 text-emerald-600" />
            </div>
            <div>
              <div className="text-xl font-bold text-gray-900">{avgEngagement.toFixed(1)}%</div>
              <div className="text-xs text-gray-400">Eng. promedio</div>
            </div>
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
              <span className="text-sm">✓</span>
            </div>
            <div>
              <div className="text-xl font-bold text-gray-900">
                {verifiedCount}
              </div>
              <div className="text-xs text-gray-400">Verificados</div>
            </div>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="card p-4 space-y-3">
        <InfluencerFilters
          filters={filters}
          onChange={updateFilter}
          onReset={resetFilters}
          total={total}
          filtered={filtered}
          apiBase={isBrandPortal ? '/api/brand/influencers' : '/api/influencers'}
        />
        {!isBrandPortal && (
          <div className="flex items-center gap-1.5">
            {([['', 'Todos'], ['pro', 'PRO'], ['free', 'Gratis']] as const).map(([value, label]) => (
              <button
                key={value || 'all'}
                onClick={() => setPlanFilter(value)}
                className={cn('px-3 py-1 rounded-lg text-xs font-medium transition-colors',
                  planFilter === value ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="card p-4 animate-pulse">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-12 h-12 rounded-full bg-gray-100" />
                <div className="flex-1">
                  <div className="h-4 bg-gray-100 rounded w-32 mb-2" />
                  <div className="h-3 bg-gray-100 rounded w-24" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {[1, 2, 3].map(j => (
                  <div key={j} className="h-14 bg-gray-100 rounded-lg" />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="card p-6 text-center">
          <p className="text-red-500 text-sm">{error}</p>
        </div>
      )}

      {/* Barra de selección (solo admin, vista lista) */}
      {!isBrandPortal && selectedIds.size > 0 && (
        <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-violet-600 text-white animate-fade-in">
          <div className="flex items-center gap-3 text-sm font-medium">
            <button onClick={clearSelection} className="p-1 rounded hover:bg-white/20"><X className="h-4 w-4" /></button>
            {selectedIds.size} seleccionado(s)
          </div>
          <div className="flex items-center gap-2">
            {assignToBrand && (
              <button onClick={assignSelectedToBrand} disabled={assigning}
                className="px-3 py-1.5 text-sm font-semibold rounded-lg bg-white text-violet-700 hover:bg-violet-50 disabled:opacity-50">
                {assigning ? 'Asignando…' : `Asignar a ${assignToBrandName ?? 'la marca'}`}
              </button>
            )}
            <button onClick={() => bulkDelete(false)} disabled={deleting}
              className="px-3 py-1.5 text-sm font-semibold rounded-lg bg-white/15 hover:bg-white/25 disabled:opacity-50">
              Desactivar
            </button>
            {isAdmin && (
              <button onClick={() => bulkDelete(true)} disabled={deleting}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-lg bg-white text-red-600 hover:bg-red-50 disabled:opacity-50">
                {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                Eliminar seleccionados
              </button>
            )}
          </div>
        </div>
      )}

      {/* Empty state marca: sin influencers en roster */}
      {!loading && !error && isBrandPortal && influencers.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 bg-white rounded-2xl border border-gray-100 text-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-violet-50 flex items-center justify-center">
            <Users className="h-6 w-6 text-violet-400" />
          </div>
          <p className="text-sm font-semibold text-gray-700">Aún no tienes influencers en tu roster</p>
          <p className="text-xs text-gray-400 max-w-xs">
            Agrega una influencer propia o solicita al equipo SCENCE que la asigne a tu marca.
          </p>
          <Link
            href="/brand-influencers/new"
            className="mt-2 flex items-center gap-2 px-5 py-2.5 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Agregar influencer
          </Link>
        </div>
      )}

      {/* Vista Lista */}
      {!loading && !error && (
        <div className="animate-fade-in">
          <InfluencerTable
            influencers={visibleInfluencers}
            onSort={toggleSort}
            sortBy={filters.sortBy}
            sortOrder={filters.sortOrder}
            selectable
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onToggleAll={toggleAll}
            onDelete={isAdmin ? deleteOne : undefined}
            portal={portal}
          />
        </div>
      )}

      {/* Pagination */}
      {!loading && !error && totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-sm text-gray-400">
            Página {page} de {totalPages} · {total.toLocaleString()} influencers en total
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Anterior
            </button>

            {/* Page numbers — show up to 5 around current */}
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const start = Math.max(1, Math.min(page - 2, totalPages - 4))
              return start + i
            }).map(p => (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={`w-8 h-8 text-sm font-medium rounded-lg transition-colors ${
                  p === page
                    ? 'bg-violet-600 text-white'
                    : 'text-gray-600 bg-white border border-gray-200 hover:bg-gray-50'
                }`}
              >
                {p}
              </button>
            ))}

            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Siguiente <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
