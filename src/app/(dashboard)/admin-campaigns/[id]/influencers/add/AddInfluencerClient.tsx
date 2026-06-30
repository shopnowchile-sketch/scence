'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, Search, Plus, Loader2, Check } from 'lucide-react'
import { toast } from 'sonner'
import { useInfluencersList } from '@/hooks/useInfluencersList'
import { formatFollowers, PLATFORM_ICONS, cn } from '@/lib/utils'

interface Props {
  campaignId: string
}

export function AddInfluencerClient({ campaignId }: Props) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState<string | null>(null)
  const [added, setAdded] = useState<Set<string>>(new Set())
  const [fee, setFee] = useState<Record<string, string>>({})

  const { data, isLoading } = useInfluencersList({
    search: search || undefined,
    limit: 30,
  })

  const influencers = data?.data ?? []

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
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href={`/admin-campaigns/${campaignId}`}
          className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-500">
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Agregar influencer</h1>
          <p className="text-sm text-gray-400">Busca y agrega influencers a esta campaña</p>
        </div>
      </div>

      {/* Búsqueda */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-300" />
        <input
          type="text"
          placeholder="Buscar por nombre, email o ciudad…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="input-base w-full pl-10"
        />
      </div>

      {/* Lista */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 text-violet-400 animate-spin" />
        </div>
      ) : (
        <div className="card overflow-x-auto">
          {influencers.length === 0 ? (
            <p className="text-center text-gray-400 py-10 text-sm">
              {search ? 'No se encontraron influencers' : 'Sin influencers en el roster'}
            </p>
          ) : (
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  {['Influencer', 'Plataforma principal', 'Seguidores', 'Fee (opcional)', ''].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {influencers.map(inf => {
                  const primary = inf.social_profiles?.find(s => s.is_primary) ?? inf.social_profiles?.[0]
                  const isAdded = added.has(inf.id)
                  const isAdding = adding === inf.id

                  return (
                    <tr key={inf.id} className={cn('transition-colors', isAdded ? 'bg-emerald-50/50' : 'hover:bg-gray-50/70')}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-violet-100 flex items-center justify-center text-violet-700 text-xs font-bold flex-shrink-0">
                            {inf.display_name[0]?.toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-gray-900">{inf.display_name}</p>
                            {inf.city && <p className="text-xs text-gray-400">{inf.city}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {primary ? (
                          <span className="flex items-center gap-1.5">
                            {PLATFORM_ICONS[primary.platform]}
                            {primary.username ? `@${primary.username}` : primary.platform}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold text-gray-900">
                        {primary ? formatFollowers(primary.followers ?? 0) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="number"
                          placeholder="0.00"
                          min="0"
                          step="100"
                          disabled={isAdded}
                          value={fee[inf.id] ?? ''}
                          onChange={e => setFee(prev => ({ ...prev, [inf.id]: e.target.value }))}
                          className="input-base w-28 text-sm disabled:opacity-50"
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isAdded ? (
                          <span className="flex items-center gap-1.5 text-emerald-600 text-sm font-semibold">
                            <Check className="h-4 w-4" /> Agregado
                          </span>
                        ) : (
                          <button
                            onClick={() => handleAdd(inf.id)}
                            disabled={!!adding}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-white bg-violet-600 rounded-lg hover:bg-violet-700 disabled:opacity-50 transition-colors ml-auto"
                          >
                            {isAdding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                            Agregar
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex justify-between items-center">
        <p className="text-sm text-gray-400">
          {added.size > 0 ? `${added.size} influencer${added.size !== 1 ? 's' : ''} agregado${added.size !== 1 ? 's' : ''}` : ''}
        </p>
        <Link href={`/admin-campaigns/${campaignId}`}
          className="flex items-center gap-2 px-4 py-2.5 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700 transition-colors">
          Ver campaña
        </Link>
      </div>
    </div>
  )
}
