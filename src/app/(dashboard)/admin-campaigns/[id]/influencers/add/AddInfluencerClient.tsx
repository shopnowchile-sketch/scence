'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import Link from 'next/link'
import { ChevronLeft, Plus, Loader2, Check, Search } from 'lucide-react'
import { toast } from 'sonner'
import { InfluencerTable } from '@/components/influencers/InfluencerTable'
import type { Influencer, InfluencerFilters } from '@/types'

interface Props {
  campaignId: string
}

export function AddInfluencerClient({ campaignId }: Props) {
  const [influencers, setInfluencers] = useState<Influencer[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState<string | null>(null)
  const [added, setAdded] = useState<Set<string>>(new Set())
  const [fee, setFee] = useState<Record<string, string>>({})
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<InfluencerFilters['sortBy']>('followers')
  const [sortOrder, setSortOrder] = useState<InfluencerFilters['sortOrder']>('desc')
  const [page, setPage] = useState(1)
  const pageSize = 100

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [influencersRes, campaignInfRes] = await Promise.all([
        fetch('/api/influencers?limit=5000&sort_by=followers&sort_dir=desc'),
        fetch(`/api/campaigns/${campaignId}/influencers`),
      ])

      const influencersJson = await influencersRes.json()
      if (!influencersRes.ok) throw new Error(influencersJson.error ?? 'Error cargando influencers')
      setInfluencers(influencersJson.data ?? [])

      if (campaignInfRes.ok) {
        const campaignInfJson = await campaignInfRes.json()
        const existingIds = (campaignInfJson.data ?? [])
          .map((ci: { influencer_id?: string | null }) => ci.influencer_id)
          .filter(Boolean) as string[]
        setAdded(new Set(existingIds))
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error cargando influencers')
    }
    setLoading(false)
  }, [campaignId])

  useEffect(() => { load() }, [load])

  const filteredInfluencers = useMemo(() => {
    const query = search.trim().toLowerCase().replace(/^@+/, '')
    const rows = query
      ? influencers.filter(influencer => {
        const handles = (influencer.social_profiles ?? []).map(profile => (profile.username ?? '').replace(/^@+/, '')).join(' ')
        return [influencer.display_name, influencer.email ?? '', influencer.commune ?? influencer.city ?? '', handles]
          .join(' ').toLowerCase().includes(query)
      })
      : [...influencers]

    const primary = (influencer: Influencer) => influencer.social_profiles?.find(profile => profile.is_primary) ?? influencer.social_profiles?.[0]
    return rows.sort((left, right) => {
      let comparison = 0
      if (sortBy === 'followers') comparison = (primary(left)?.followers ?? -1) - (primary(right)?.followers ?? -1)
      else if (sortBy === 'engagement_rate') comparison = (primary(left)?.engagement_rate ?? -1) - (primary(right)?.engagement_rate ?? -1)
      else if (sortBy === 'rating') comparison = (left.rating ?? -1) - (right.rating ?? -1)
      else if (sortBy === 'display_name') comparison = left.display_name.localeCompare(right.display_name, 'es')
      else if (sortBy === 'commune') comparison = (left.commune ?? left.city ?? '').localeCompare(right.commune ?? right.city ?? '', 'es')
      else comparison = String(left[sortBy as keyof Influencer] ?? '').localeCompare(String(right[sortBy as keyof Influencer] ?? ''), 'es')
      return sortOrder === 'asc' ? comparison : -comparison
    })
  }, [influencers, search, sortBy, sortOrder])

  useEffect(() => { setPage(1) }, [search, sortBy, sortOrder])
  const totalPages = Math.max(1, Math.ceil(filteredInfluencers.length / pageSize))
  const visibleInfluencers = filteredInfluencers.slice((page - 1) * pageSize, page * pageSize)

  function handleSort(column: InfluencerFilters['sortBy']) {
    if (sortBy === column) setSortOrder(current => current === 'asc' ? 'desc' : 'asc')
    else {
      setSortBy(column)
      setSortOrder('desc')
    }
  }

  async function handleAdd(influencerId: string) {
    setAdding(influencerId)
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/influencers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
          influencer_id: influencerId,
          fee: fee[influencerId] ? Number(fee[influencerId]) : null,
          // Alta directa: aunque las postulaciones estén cerradas queda aceptada
          // de inmediato. Si la campaña tiene asistencia, la API crea esa tarea
          // y envía el email individual para confirmarla.
          invite: false,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Error al agregar')
      }
      setAdded(prev => { const next = new Set(prev); next.add(influencerId); return next })
      toast.success('Influencer agregada como aceptada · email de asistencia enviado')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setAdding(null)
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href={`/admin-campaigns/${campaignId}`}
          className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-500">
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Agregar influencer</h1>
          <p className="text-sm text-gray-400">Funciona incluso con postulaciones cerradas. Queda aceptada de inmediato y, si es un evento, solo debe confirmar su asistencia.</p>
        </div>
      </div>

      <div className="relative max-w-lg">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={event => setSearch(event.target.value)}
          placeholder="Buscar por nombre, Instagram, email o comuna"
          className="input-base py-2.5 pl-9"
        />
      </div>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 8 }).map((_, index) => <div key={index} className="h-16 animate-pulse rounded-xl bg-gray-100" />)}</div>
      ) : <InfluencerTable
        influencers={visibleInfluencers}
        onSort={handleSort}
        sortBy={sortBy}
        sortOrder={sortOrder}
        renderAction={inf => {
          const isAdded = added.has(inf.id)
          const isAdding = adding === inf.id

          if (isAdded) {
            return (
              <span className="inline-flex items-center gap-1.5 text-emerald-600 text-sm font-semibold whitespace-nowrap">
                <Check className="h-4 w-4" /> Aceptada
              </span>
            )
          }

          return (
            <div className="inline-flex items-center gap-2">
              <input
                type="number"
                placeholder="Fee"
                min="0"
                step="100"
                value={fee[inf.id] ?? ''}
                onClick={e => e.stopPropagation()}
                onChange={e => setFee(prev => ({ ...prev, [inf.id]: e.target.value }))}
                className="w-20 px-2 py-1.5 rounded-lg border border-gray-200 text-xs"
              />
              <button
                onClick={() => handleAdd(inf.id)}
                disabled={!!adding}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-violet-600 rounded-lg hover:bg-violet-700 disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                {isAdding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                Agregar
              </button>
            </div>
          )
        }}
      />}

      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>{filteredInfluencers.length} influencers · Página {page} de {totalPages}</span>
          <div className="flex gap-2">
            <button type="button" disabled={page === 1} onClick={() => setPage(current => Math.max(1, current - 1))} className="rounded-lg border px-3 py-1.5 disabled:opacity-40">Anterior</button>
            <button type="button" disabled={page === totalPages} onClick={() => setPage(current => Math.min(totalPages, current + 1))} className="rounded-lg border px-3 py-1.5 disabled:opacity-40">Siguiente</button>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex justify-between items-center">
        <p className="text-sm text-gray-400">
          {added.size > 0 ? `${added.size} influencer${added.size !== 1 ? 's' : ''} en la campaña` : ''}
        </p>
        <Link href={`/admin-campaigns/${campaignId}`}
          className="flex items-center gap-2 px-4 py-2.5 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700 transition-colors">
          Ver campaña
        </Link>
      </div>
    </div>
  )
}
