'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { InfluencerRanking } from '@/components/influencers/InfluencerRanking'
import type { RankingInfluencerRow } from '@/lib/influencers/ranking'

export default function AdminInfluencersRankingPage() {
  const [influencers, setInfluencers] = useState<RankingInfluencerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError(null)

      try {
        const res = await fetch('/api/influencers/ranking?limit=300&sort_by=followers&sort_dir=desc')
        if (!res.ok) throw new Error('Error cargando ranking')

        const json = await res.json()
        setInfluencers(json.data ?? [])
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error cargando ranking')
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [])

  return (
    <div className="space-y-5">
      <div>
        <Link href="/admin-influencers" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800">
          <ArrowLeft className="h-4 w-4" />
          Influencers
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight mt-3">Ranking de influencers</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Ranking configurable por KPI: seguidores, engagement, rating, campañas, entregables y cumplimiento.
        </p>
      </div>

      {error ? (
        <div className="card p-6 text-sm text-red-500">{error}</div>
      ) : (
        <InfluencerRanking influencers={influencers} loading={loading} basePath="/admin-influencers" />
      )}
    </div>
  )
}
