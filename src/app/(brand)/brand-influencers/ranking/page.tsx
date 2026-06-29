import type { Metadata } from 'next'
import { InfluencersClient } from '@/app/(dashboard)/admin-influencers/InfluencersClient'

export const metadata: Metadata = { title: 'Ranking de influencers' }

export default function BrandInfluencerRankingPage() {
  return <InfluencersClient portal="brand" initialView="ranking" />
}
