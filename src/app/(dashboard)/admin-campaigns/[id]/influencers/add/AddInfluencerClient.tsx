'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { ChevronLeft, Plus, Loader2, Check } from 'lucide-react'
import { toast } from 'sonner'
import { InfluencerRanking } from '@/components/influencers/InfluencerRanking'
import type { RankingInfluencerRow } from '@/lib/influencers/ranking'

interface Props {
  campaignId: string
}

// Antes esta vista tenía su propia tabla ad-hoc (solo búsqueda libre, sin sort
// ni filtros de comuna/campañas colaboradas). Se reemplaza por InfluencerRanking
// (mismo componente que /admin-influencers/ranking) en modo selección vía
// renderAction, para reusar sort/filtros/columnas ya existentes sin duplicar
// una vista reducida. No se toca el ranking admin general (mismo componente,
// prop nueva opcional).
export function AddInfluencerClient({ campaignId }: Props) {
  const [influencers, setInfluencers] = useState<RankingInfluencerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState<string | null>(null)
  const [added, setAdded] = useState<Set<string>>(new Set())
  const [fee, setFee] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [rankingRes, campaignInfRes] = await Promise.all([
        fetch('/api/influencers/ranking?limit=500&sort_by=followers&sort_dir=desc'),
        fetch(`/api/campaigns/${campaignId}/influencers`),
      ])

      const rankingJson = await rankingRes.json()
      if (!rankingRes.ok) throw new Error(rankingJson.error ?? 'Error cargando influencers')
      setInfluencers(rankingJson.data ?? [])

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

  async function handleAdd(influencerId: string) {
    setAdding(influencerId)
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/influencers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          influencer_id: influencerId,
          fee: fee[influencerId] ? Number(fee[influencerId]) : null,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Error al agregar')
      }
      setAdded(prev => { const next = new Set(prev); next.add(influencerId); return next })
      toast.success('Influencer agregado a la campaña')
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
          <p className="text-sm text-gray-400">Busca, filtra y agrega influencers a esta campaña</p>
        </div>
      </div>

      <InfluencerRanking
        influencers={influencers}
        loading={loading}
        basePath="/admin-influencers"
        actionLabel="Agregar"
        renderAction={inf => {
          const isAdded = added.has(inf.id)
          const isAdding = adding === inf.id

          if (isAdded) {
            return (
              <span className="inline-flex items-center gap-1.5 text-emerald-600 text-sm font-semibold whitespace-nowrap">
                <Check className="h-4 w-4" /> Agregado
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
      />

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
