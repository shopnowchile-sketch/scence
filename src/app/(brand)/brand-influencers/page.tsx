import type { Metadata } from 'next'
import { InfluencersClient } from '@/app/(dashboard)/admin-influencers/InfluencersClient'

export const metadata: Metadata = { title: 'Influencers' }

export default function BrandInfluencersPage() {
  return <InfluencersClient portal="brand" />
}
