'use client'

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { useInfluencers } from '@/hooks/useInfluencers'
import { InfluencerRanking } from '@/components/influencers/InfluencerRanking'

export default function AdminInfluencersRankingPage() {
  const { influencers, loading, error } = useInfluencers(undefined, '/api/influencers')

  return (
    <div className="space-y-5">
      <div>
        <Link href="/admin-influencers" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800">
          <ArrowLeft className="h-4 w-4" />
          Influencers
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight mt-3">Ranking de influencers</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Ranking global de influencers de Scence.
        </p>
      </div>

      {error ? (
        <div className="card p-6 text-sm text-red-500">{error}</div>
      ) : (
        <InfluencerRanking influencers={influencers} loading={loading} />
      )}
    </div>
  )
}
